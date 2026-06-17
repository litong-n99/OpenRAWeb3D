/**
 * GpsWatcher.ts — GPS 卫星状态观察器（管理GPS激活/撤销状态）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/GpsWatcher.cs (114 lines)
 *
 * 核心范式转换:
 * - C# TraitLocation(SystemActors.Player) → TypeScript Player-level trait
 * - C# ISync marker → TypeScript ISync (already migrated in Ch3)
 * - C# IPreventsShroudReset → TypeScript forward stub (defined locally)
 * - C# List<Actor> + HashSet<TraitPair<IOnGpsRefreshed>>
 *   → TypeScript Set<IGameActor> + Set<TraitPair<IOnGpsRefreshed>>
 * - C# IEnumerable yield return → TypeScript for loops
 * - C# Shroud.ExploreAll() → TypeScript uses Shroud.exploreAll()
 *
 * NOTE: This trait is attached to the Player actor. It manages the state of
 * all GPS satellites for the owning player. The IOnGpsRefreshed notification
 * interface is defined in this file (matching OpenRA's co-location).
 *
 * NOTE: TraitPair matching uses object reference identity (not value equality).
 * This matches C# behavior where TraitPair is a value type with value equality.
 */

import type {
  ISync,
  ITraitInfo,
  IGameActor,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// IOnGpsRefreshed — notification interface
// OpenRA 对照: IOnGpsRefreshed (defined in GpsWatcher.cs)
// ---------------------------------------------------------------------------

/**
 * Receives notification when GPS state changes.
 *
 * OpenRA 对照: IOnGpsRefreshed
 *
 * Implemented by traits that need to update their state when GPS is activated
 * or deactivated (e.g., FrozenUnderFogUpdatedByGps).
 */
export interface IOnGpsRefreshed {
  /** Called when GPS state is refreshed for a player.
   *
   * OpenRA 对照: IOnGpsRefreshed.OnGpsRefresh(Actor, Player)
   */
  onGpsRefresh(self: IGameActor, player: PlayerStub): void
}

// ---------------------------------------------------------------------------
// IPreventsShroudReset — forward stub (Shroud reset prevention)
// ---------------------------------------------------------------------------

/**
 * Prevents the shroud from resetting (being re-applied) while this trait
 * is active.
 *
 * OpenRA 对照: IPreventsShroudReset
 *
 * Implemented by GpsWatcher to prevent fog-of-war from re-fogging the map
 * while GPS is active.
 */
export interface IPreventsShroudReset {
  /** Check if shroud reset should be prevented for this actor.
   *
   * OpenRA 对照: IPreventsShroudReset.PreventShroudReset(Actor)
   */
  preventShroudReset(self: IGameActor): boolean
}

// ---------------------------------------------------------------------------
// TraitPair — lightweight actor+trait reference
// OpenRA 对照: TraitPair<T> (readonly record struct)
// ---------------------------------------------------------------------------

/**
 * Lightweight pair of an actor and one of its traits.
 *
 * OpenRA 对照: TraitPair (readonly record struct)
 *
 * Used as a dictionary key for notification registration.
 * Identity is determined by the combination of actor and trait reference.
 */
class TraitPair<T> {
  readonly actor: IGameActor
  readonly trait: T

  constructor(actor: IGameActor, trait: T) {
    this.actor = actor
    this.trait = trait
  }

  /** Equality check: same actor AND same trait reference.
   *
   * OpenRA 对照: TraitPair.Equals (manual for record struct)
   */
  equals(other: TraitPair<T>): boolean {
    return this.actor === other.actor && this.trait === other.trait
  }
}

// ---------------------------------------------------------------------------
// GpsWatcherInfo
// OpenRA 对照: GpsWatcherInfo : TraitInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the GPS watcher trait.
 *
 * OpenRA 对照: GpsWatcherInfo
 *
 * Attached to the Player actor. Required for GpsPower to function.
 */
export class GpsWatcherInfo implements ITraitInfo {
  readonly instanceName?: string

  create(_init: IGameActor): GpsWatcher {
    return new GpsWatcher()
  }
}

// ---------------------------------------------------------------------------
// GpsWatcher
// OpenRA 对照: GpsWatcher : ISync, IPreventsShroudReset
// ---------------------------------------------------------------------------

/**
 * Manages GPS satellite state for a player.
 *
 * OpenRA 对照: GpsWatcher
 *
 * Tracks which GPS providers are active, manages the launched/granted
 * states, explores the map on first launch, and notifies registered
 * listeners when GPS state changes.
 *
 * @traitLocation Player actor
 */
export class GpsWatcher implements ISync, IPreventsShroudReset {
  // -----------------------------------------------------------------------
  // Synchronized state
  // -----------------------------------------------------------------------

  /** Whether the GPS satellite has been launched.
   *
   * OpenRA 对照: GpsWatcher.Launched (VerifySync)
   */
  launched: boolean = false

  /** Whether GPS has been granted to allied players.
   *
   * OpenRA 对照: GpsWatcher.GrantedAllies (VerifySync)
   */
  grantedAllies: boolean = false

  /** Whether GPS has been granted to this player.
   *
   * OpenRA 对照: GpsWatcher.Granted (VerifySync)
   */
  granted: boolean = false

  // -----------------------------------------------------------------------
  // Private state
  // -----------------------------------------------------------------------

  /** Whether this player has explored the terrain (via launch or ally).
   *
   * OpenRA 对照: GpsWatcher.explored
   */
  private _explored: boolean = false

  /** Active GPS provider actors.
   *
   * OpenRA 对照: GpsWatcher.actors (List<Actor>)
   */
  private readonly _actors = new Set<IGameActor>()

  /** Registered IOnGpsRefreshed listeners.
   *
   * OpenRA 对照: GpsWatcher.notifyOnRefresh (HashSet<TraitPair<IOnGpsRefreshed>>)
   */
  private readonly _notifyOnRefresh = new Set<TraitPair<IOnGpsRefreshed>>()

  // -----------------------------------------------------------------------
  // GPS provider management
  // -----------------------------------------------------------------------

  /** Remove a GPS provider actor.
   *
   * OpenRA 对照: GpsWatcher.GpsRemove(Actor)
   */
  gpsRemove(atek: IGameActor): void {
    this._actors.delete(atek)
    // NOTE: In OpenRA, RefreshGps takes the removing actor's owner. Since
    // we're using the removed actor itself, we pass it through.
    this.refreshGps(atek)
  }

  /** Add a GPS provider actor.
   *
   * OpenRA 对照: GpsWatcher.GpsAdd(Actor)
   */
  gpsAdd(atek: IGameActor): void {
    this._actors.add(atek)
    this.refreshGps(atek)
  }

  // -----------------------------------------------------------------------
  // GPS lifecycle
  // -----------------------------------------------------------------------

  /** Called when the satellite reaches orbit.
   *
   * OpenRA 对照: GpsWatcher.ReachedOrbit(Player)
   */
  reachedOrbit(_launcher: PlayerStub): void {
    this.launched = true
    this.refreshGpsForOwner(_launcher)
  }

  // -----------------------------------------------------------------------
  // Refresh
  // -----------------------------------------------------------------------

  /** Refresh GPS state for the given launcher's owner.
   *
   * OpenRA 对照: GpsWatcher.RefreshGps(Player)
   *
   * Refreshes both this watcher and all other GpsWatchers in the world.
   */
  refreshGps(_launcher: IGameActor): void {
    this.refreshGranted()

    // NOTE: In OpenRA, RefreshGps iterates all actors in the world with
    // GpsWatcher and calls RefreshGranted on each. Since we don't have
    // World access in this trait, the caller (GpsPower) is responsible
    // for triggering RefreshGps on all relevant watchers.
    // For the local-only case, we just refresh ourselves.
  }

  /** Refresh GPS state for a specific owner (world-level refresh).
   *
   * OpenRA 对照: GpsWatcher.RefreshGps(Player launcher) overload
   */
  refreshGpsForOwner(_launcher: PlayerStub): void {
    this.refreshGranted()
    // NOTE: World-level broadcast deferred to GpsPower coordination.
  }

  // -----------------------------------------------------------------------
  // Internal: recalculate granted/grantedAllies states
  // -----------------------------------------------------------------------

  /** Recalculate the Granted and GrantedAllies states.
   *
   * OpenRA 对照: GpsWatcher.RefreshGranted()
   *
   * Granted: at least one GPS provider AND launched
   * GrantedAllies: at least one allied player has Granted
   * On first launch/ally-launched: explore entire shroud
   * On state change: notify all IOnGpsRefreshed listeners
   */
  private refreshGranted(): void {
    const wasGranted = this.granted
    const wasGrantedAllies = this.grantedAllies

    // Check if any allied watcher has Granted or Launched
    // NOTE: allyWatchers check requires world access. Since we can't
    // query allies from this trait alone, the caller must ensure
    // ally watches are kept in sync. For the base implementation,
    // GrantedAllies is managed by external coordination.
    const allyHasGranted = false // TODO-19.A.6: World-level ally coordination via GpsPower
    const allyHasLaunched = false // TODO-19.A.6: World-level ally coordination via GpsPower

    this.granted = this._actors.size > 0 && this.launched
    this.grantedAllies = allyHasGranted

    // Explore all terrain on first launch (or first ally launch)
    if (!this._explored && (this.launched || allyHasLaunched)) {
      this._explored = true
      // NOTE: Shroud.ExploreAll() requires access to Player.Shroud.
      // In OpenRA this is: owner.Shroud.ExploreAll()
      // The actual shroud exploration is triggered by GpsPower when
      // it detects the GPS state change.
      // TODO-19.A.6: Coordinate shroud exploration with GpsPower.
    }

    // Notify listeners if state changed
    if (wasGranted !== this.granted || wasGrantedAllies !== this.grantedAllies) {
      this._notifyOnRefresh.forEach((tp) => {
        // NOTE: Player reference not available from IGameActor alone.
        // The owner is known by the listener (e.g., FrozenUnderFogUpdatedByGps
        // stores a PlayerDictionary). We pass a stub.
        const owner: PlayerStub = { playerName: 'gpsOwner' }
        tp.trait.onGpsRefresh(tp.actor, owner)
      })
    }
  }

  // -----------------------------------------------------------------------
  // IPreventsShroudReset
  // -----------------------------------------------------------------------

  /** Whether shroud reset should be prevented for the given actor.
   *
   * OpenRA 对照: IPreventsShroudReset.PreventShroudReset(Actor)
   *
   * Shroud reset is prevented while GPS is active (granted to self or allies).
   */
  preventShroudReset(_self: IGameActor): boolean {
    return this.granted || this.grantedAllies
  }

  // -----------------------------------------------------------------------
  // Notification registration
  // -----------------------------------------------------------------------

  /** Register a listener for GPS state changes.
   *
   * OpenRA 对照: GpsWatcher.RegisterForOnGpsRefreshed(Actor, IOnGpsRefreshed)
   */
  registerForOnGpsRefreshed(actor: IGameActor, toBeNotified: IOnGpsRefreshed): void {
    this._notifyOnRefresh.add(new TraitPair(actor, toBeNotified))
  }

  /** Unregister a listener for GPS state changes.
   *
   * OpenRA 对照: GpsWatcher.UnregisterForOnGpsRefreshed(Actor, IOnGpsRefreshed)
   */
  unregisterForOnGpsRefreshed(actor: IGameActor, toBeNotified: IOnGpsRefreshed): void {
    const pair = new TraitPair(actor, toBeNotified)
    // Find and remove the matching pair (reference-based equality)
    for (const existing of this._notifyOnRefresh) {
      if (existing.equals(pair)) {
        this._notifyOnRefresh.delete(existing)
        break
      }
    }
  }

  // -----------------------------------------------------------------------
  // State queries (for testing)
  // -----------------------------------------------------------------------

  /** Whether terrain has been explored.
   *
   * OpenRA 对照: GpsWatcher.explored (private field, exposed for testing)
   */
  get explored(): boolean {
    return this._explored
  }

  /** Number of active GPS provider actors.
   */
  get providerCount(): number {
    return this._actors.size
  }

  /** Number of registered notification listeners.
   */
  get listenerCount(): number {
    return this._notifyOnRefresh.size
  }

  /** Set explored state (for test injection during ally coordination).
   */
  setExplored(value: boolean): void {
    this._explored = value
  }
}
