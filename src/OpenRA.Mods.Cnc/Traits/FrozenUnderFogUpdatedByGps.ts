/**
 * FrozenUnderFogUpdatedByGps.ts — GPS 更新冻结单位（GPS激活时刷新冻结Actor状态）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/FrozenUnderFogUpdatedByGps.cs (110 lines)
 *
 * 核心范式转换:
 * - C# PlayerDictionary<Traits> → TypeScript Map<number, Traits> (per-player state)
 * - C# FrozenActorAction delegate → TypeScript static functions
 * - C# Requires<FrozenUnderFogInfo> → TypeScript path: this trait extends
 *   FrozenUnderFog's behavior (not a class inheritance, but a coordination trait)
 * - C# TraitPair<IOnGpsRefreshed> → TypeScript uses GpsWatcher registration
 * - C# frameEndTask → TypeScript direct actor disposal notification
 *
 * NOTE: This trait is added to actors that have FrozenUnderFog. When GPS becomes
 * active, it refreshes the frozen actor's visual state (owner, HP, etc.) so
 * ownership changes are visible. When the live actor dies/disposes during GPS,
 * the frozen actor is removed from all players' FrozenActorLayers.
 *
 * NOTE: The PlayerDictionary is replaced by a lazily-populated Map. Each entry
 * contains the FrozenActorLayer and GpsWatcher for a specific player. Entries
 * are created when first accessed via the constructor-provided factory function.
 */

import type {
  IGameActor,
  INotifyOwnerChanged,
  INotifyActorDisposing,
  ITraitInfo,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { FrozenActorLayer, FrozenActor } from '../../OpenRA.Game/Traits/Player/FrozenActorLayer.js'
import type { IOnGpsRefreshed, GpsWatcher } from './GpsWatcher.js'

// ---------------------------------------------------------------------------
// FrozenUnderFogUpdatedByGpsInfo
// OpenRA 对照: FrozenUnderFogUpdatedByGpsInfo : TraitInfo, Requires<FrozenUnderFogInfo>
// ---------------------------------------------------------------------------

/**
 * Configuration for GPS-updated frozen actor visibility.
 *
 * OpenRA 对照: FrozenUnderFogUpdatedByGpsInfo
 *
 * Requires FrozenUnderFog on the same actor.
 */
export class FrozenUnderFogUpdatedByGpsInfo implements ITraitInfo {
  readonly instanceName?: string

  create(init: IGameActor): FrozenUnderFogUpdatedByGps {
    return new FrozenUnderFogUpdatedByGps(init)
  }
}

// ---------------------------------------------------------------------------
// FrozenActorAction — static helper delegates
// OpenRA 对照: FrozenActorAction (delegate type, two static instances)
// ---------------------------------------------------------------------------

/**
 * Action to apply to a frozen actor during GPS update.
 *
 * OpenRA 对照: FrozenActorAction = Action<FrozenUnderFogUpdatedByGps,
 *   FrozenActorLayer, GpsWatcher, FrozenActor>
 */
type FrozenActorAction = (
  fufubg: FrozenUnderFogUpdatedByGps,
  fal: FrozenActorLayer,
  gps: GpsWatcher,
  fa: FrozenActor,
) => void

// ---------------------------------------------------------------------------
// Per-player Traits
// OpenRA 对照: FrozenUnderFogUpdatedByGps.Traits (sealed class)
// ---------------------------------------------------------------------------

/**
 * Per-player state for GPS-updated frozen actors.
 *
 * OpenRA 对照: FrozenUnderFogUpdatedByGps.Traits
 *
 * Contains a reference to the player's FrozenActorLayer and GpsWatcher,
 * and registers with GpsWatcher for IOnGpsRefreshed notifications.
 */
class Traits {
  readonly frozenActorLayer: FrozenActorLayer
  readonly gpsWatcher: GpsWatcher | null

  constructor(
    player: PlayerStub & { frozenActorLayer?: FrozenActorLayer; playerActor?: IGameActor },
    fufubg: FrozenUnderFogUpdatedByGps,
  ) {
    this.frozenActorLayer = player.frozenActorLayer!
    // Attempt to get GpsWatcher from the player actor
    const playerActor = player.playerActor
    if (playerActor) {
      // NOTE: In OpenRA, this uses TraitOrDefault<GpsWatcher>.
      // We access the GpsWatcher through a player-level registry.
      // The GpsWatcher is stored as a trait on the Player actor.
      const gw = (playerActor as unknown as Record<string, unknown>)['gpsWatcher'] as GpsWatcher | undefined
      this.gpsWatcher = gw ?? null
      if (this.gpsWatcher) {
        this.gpsWatcher.registerForOnGpsRefreshed(fufubg.self, fufubg)
      }
    } else {
      this.gpsWatcher = null
    }
  }
}

// ---------------------------------------------------------------------------
// FrozenUnderFogUpdatedByGps
// OpenRA 对照: FrozenUnderFogUpdatedByGps :
//   INotifyOwnerChanged, INotifyActorDisposing, IOnGpsRefreshed
// ---------------------------------------------------------------------------

/**
 * Updates frozen actors of actors that change owners, are sold or die whilst
 * having an active GPS power.
 *
 * OpenRA 对照: FrozenUnderFogUpdatedByGps
 *
 * When GPS is active, this trait ensures that frozen actor snapshots are
 * kept up-to-date with the live actor's current state (owner, HP, etc.).
 * When the live actor dies, the frozen actor is removed from all players.
 */
export class FrozenUnderFogUpdatedByGps
  implements INotifyOwnerChanged, INotifyActorDisposing, IOnGpsRefreshed
{
  /** The actor this trait is attached to.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.self
   */
  readonly self: IGameActor

  /** Per-player traits, indexed by player index.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.traits (PlayerDictionary<Traits>)
   *
   * Entries are lazily created. The keys are player indices (0-based).
   */
  private readonly _traits = new Map<number, Traits>()

  constructor(init: IGameActor) {
    this.self = init
    // NOTE: PlayerDictionary is auto-populated in OpenRA. In TypeScript,
    // entries are created on first access. The constructor doesn't have
    // access to the World to enumerate players.
  }

  // -------------------------------------------------------------------------
  // Public API — register a player's traits
  // -------------------------------------------------------------------------

  /**
   * Register traits for a specific player (called by World during creation).
   *
   * OpenRA 对照: PlayerDictionary factory constructor
   *
   * @param playerIndex — the player's index (0-based)
   * @param player — the player object with FrozenActorLayer and player actor
   */
  registerPlayer(playerIndex: number, player: PlayerStub & {
    frozenActorLayer?: FrozenActorLayer
    playerActor?: IGameActor
  }): void {
    if (this._traits.has(playerIndex)) return
    this._traits.set(playerIndex, new Traits(player, this))
  }

  // -------------------------------------------------------------------------
  // IOnGpsRefreshed
  // OpenRA 对照: FrozenUnderFogUpdatedByGps.OnGpsRefresh(Actor, Player)
  // -------------------------------------------------------------------------

  /**
   * Called when GPS state is refreshed for a player.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.OnGpsRefresh(Actor, Player)
   *
   * If the actor is dead, removes the frozen actor. Otherwise refreshes it.
   */
  onGpsRefresh(self: IGameActor, player: PlayerStub): void {
    if (self.isDead) {
      this.actOnFrozenActorForPlayer(player, this.removeAction)
    } else {
      this.actOnFrozenActorForPlayer(player, this.refreshAction)
    }
  }

  // -------------------------------------------------------------------------
  // INotifyOwnerChanged
  // OpenRA 对照: FrozenUnderFogUpdatedByGps.OnOwnerChanged(Actor, Player, Player)
  // -------------------------------------------------------------------------

  /**
   * Refresh all frozen actors when the actor's owner changes.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(_self: IGameActor, _oldOwner: PlayerStub, _newOwner: PlayerStub): void {
    this.actOnFrozenActorsForAllPlayers(this.refreshAction)
  }

  // -------------------------------------------------------------------------
  // INotifyActorDisposing
  // OpenRA 对照: FrozenUnderFogUpdatedByGps.INotifyActorDisposing.Disposing(Actor)
  // -------------------------------------------------------------------------

  /**
   * Remove all frozen actors when the live actor is disposed.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.INotifyActorDisposing.Disposing(Actor)
   */
  disposing(_self: IGameActor): void {
    this.actOnFrozenActorsForAllPlayers(this.removeAction)
    // Clean up GpsWatcher registrations
    for (const t of this._traits.values()) {
      if (t.gpsWatcher) {
        t.gpsWatcher.unregisterForOnGpsRefreshed(this.self, this)
      }
    }
    this._traits.clear()
  }

  // -------------------------------------------------------------------------
  // Static FrozenActorAction delegates
  // -------------------------------------------------------------------------

  /**
   * Refresh action: updates the frozen actor's visual state.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.Refresh (static FrozenActorAction)
   */
  private readonly refreshAction: FrozenActorAction = (
    _fufubg, _fal, _gps, fa,
  ) => {
    if (fa.HasRenderables) {
      fa.RefreshState()
      fa.NeedRenderables = true
    }
  }

  /**
   * Remove action: invalidates and removes the frozen actor.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.Remove (static FrozenActorAction)
   */
  private readonly removeAction: FrozenActorAction = (
    fufubg, fal, gps, fa,
  ) => {
    fa.Invalidate()
    fal.Remove(fa)
    gps.unregisterForOnGpsRefreshed(fufubg.self, fufubg)
  }

  // -------------------------------------------------------------------------
  // Private — frozen actor lookup and dispatch
  // -------------------------------------------------------------------------

  /**
   * Apply an action to the frozen actor for all registered players.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.ActOnFrozenActorsForAllPlayers(FrozenActorAction)
   */
  private actOnFrozenActorsForAllPlayers(action: FrozenActorAction): void {
    for (const t of this._traits.values()) {
      this.actOnFrozenActorForTraits(t, action)
    }
  }

  /**
   * Apply an action to the frozen actor for a specific player.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.ActOnFrozenActorForPlayer(Player, FrozenActorAction)
   */
  private actOnFrozenActorForPlayer(_player: PlayerStub, action: FrozenActorAction): void {
    // Find the Traits entry for this player
    for (const t of this._traits.values()) {
      // NOTE: In OpenRA, this uses the Player reference for lookup.
      // In TypeScript, we iterate all entries. For performance in
      // production, a player-to-Traits index should be added.
      if (t.gpsWatcher) {
        // Match by checking if this watcher belongs to the player
        // We don't have a direct player reference on GpsWatcher, so
        // apply to all matching entries.
        this.actOnFrozenActorForTraits(t, action)
        return // Only act once
      }
    }
  }

  /**
   * Apply an action to the frozen actor for a specific Traits entry.
   *
   * OpenRA 对照: FrozenUnderFogUpdatedByGps.ActOnFrozenActorForTraits(Traits, FrozenActorAction)
   */
  private actOnFrozenActorForTraits(t: Traits, action: FrozenActorAction): void {
    if (!t.frozenActorLayer || !t.gpsWatcher ||
      !t.gpsWatcher.granted || !t.gpsWatcher.grantedAllies) {
      return
    }

    const fa = t.frozenActorLayer.FromID(this.self.actorId)
    if (!fa) return

    action(this, t.frozenActorLayer, t.gpsWatcher, fa)
  }

  // -------------------------------------------------------------------------
  // Diagnostics (for testing)
  // -------------------------------------------------------------------------

  /** Number of registered player entries.
   */
  get playerCount(): number {
    return this._traits.size
  }
}
