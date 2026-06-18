/**
 * FallsToEarth.ts — Aircraft death husk fall behavior
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Air/FallsToEarth.cs (71 lines)
 *
 * 核心范式转换:
 * - C# IEffectiveOwner, INotifyCreated → TS interfaces (same pattern)
 * - C# EffectiveOwnerInit init system → TS constructor parameter + actor fallback
 * - C# FallToEarth Activity → TS activity stub (deferred to Ch14 Phase C)
 * - C# WeaponInfo from Ruleset.Weapons → TS duck-typed weapon registry lookup
 * - C# WAngle? / WDist struct → TS WAngle | null / WDist class
 *
 * 3D 集成:
 * - animate TransformNode.position.y toward 0 at velocity rate
 * - Apply spin rotation if maximumSpinSpeed is set
 * - Horizontal momentum when moves=true
 * - On ground contact: trigger explosion weapon, dispose actor
 */

import {
  Component,
  type IGameActor,
  type ITraitInfo,
  type IEffectiveOwner,
  type INotifyCreated,
  type PlayerStub,
  type ActivityStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// FallsToEarthInfo
// OpenRA 对照: FallsToEarthInfo (TraitInfo, IRulesetLoaded, Requires<AircraftInfo>)
// ---------------------------------------------------------------------------

/** Configuration for FallsToEarth trait — causes aircraft husks to crash to the ground.
 *
 * OpenRA 对照: FallsToEarthInfo
 */
export class FallsToEarthInfo implements ITraitInfo {
  /** Optional instance name for disambiguation. */
  readonly instanceName?: string

  /** Explosion weapon that triggers when hitting ground.
   *
   * OpenRA 对照: FallsToEarthInfo.Explosion (default "UnitExplode")
   */
  readonly explosion: string

  /** Limit the maximum spin (in angle units per tick) that can be achieved while
   * crashing. 0 disables spinning. null means no limit.
   *
   * OpenRA 对照: FallsToEarthInfo.MaximumSpinSpeed (default null)
   */
  readonly maximumSpinSpeed: WAngle | null

  /** Does the aircraft husk move forward at aircraft speed?
   *
   * OpenRA 对照: FallsToEarthInfo.Moves (default false)
   */
  readonly moves: boolean

  /** Velocity (per tick) at which aircraft falls to ground.
   *
   * OpenRA 对照: FallsToEarthInfo.Velocity (default WDist(43))
   */
  readonly velocity: WDist

  /** Resolved explosion weapon info (set at ruleset load time).
   *
   * OpenRA 对照: FallsToEarthInfo.ExplosionWeapon
   */
  explosionWeapon: unknown | null = null

  constructor(params: {
    instanceName?: string
    explosion?: string
    maximumSpinSpeed?: WAngle | null
    moves?: boolean
    velocity?: WDist
  } = {}) {
    this.instanceName = params.instanceName
    this.explosion = params.explosion ?? 'UnitExplode'
    this.maximumSpinSpeed = params.maximumSpinSpeed ?? null
    this.moves = params.moves ?? false
    this.velocity = params.velocity ?? new WDist(43)
    this.explosionWeapon = null
  }

  /** Resolve the explosion weapon from a weapon registry (ruleset load equivalent).
   *
   * OpenRA 对照: FallsToEarthInfo.RulesetLoaded()
   *
   * In C#, RulesetLoaded looks up the weapon by toLower name and throws if not found.
   * In TS, the caller passes the resolved weapon info. If the weapon name is empty
   * or null, this is a no-op (matching C#'s string.IsNullOrEmpty check).
   *
   * @param weapon — the resolved weapon info, or null to clear
   */
  resolveExplosionWeapon(weapon: unknown | null): void {
    this.explosionWeapon = weapon
  }
}

// ---------------------------------------------------------------------------
// FallsToEarth
// OpenRA 对照: FallsToEarth (IEffectiveOwner, INotifyCreated)
// ---------------------------------------------------------------------------

/** Causes aircraft husks spawned in the air to crash to the ground.
 *
 * OpenRA 对照: FallsToEarth
 *
 * Implements IEffectiveOwner for kill credit attribution (the original owner
 * gets credit for the unit's destruction). Implements INotifyCreated to
 * initiate the fall sequence when the actor is created.
 */
export class FallsToEarth
  extends Component
  implements IEffectiveOwner, INotifyCreated
{
  /** Trait dictionary registration keys.
   *
   * OpenRA 对照: N/A (C# uses reflection; TS uses explicit string registration)
   */
  static readonly interfaces = ['IEffectiveOwner', 'INotifyCreated', 'component']

  /** Trait configuration. */
  readonly info: FallsToEarthInfo

  /** Cached effective owner (resolved from init or fallback to actor owner).
   *
   * OpenRA 对照: FallsToEarth.effectiveOwner
   */
  private _effectiveOwner: PlayerStub | null = null

  // ---------------------------------------------------------------------------
  // IEffectiveOwner
  // ---------------------------------------------------------------------------

  /** Effective owner is always disguised (kill credit goes to original owner).
   *
   * OpenRA 对照: IEffectiveOwner.Disguised => true
   */
  readonly disguised: boolean = true

  /** The effective owner of this actor for kill credit.
   *
   * OpenRA 对照: IEffectiveOwner.Owner => effectiveOwner
   *
   * Returns null if neither an effective owner was provided at construction
   * nor a fallback was resolved via created(). In practice, created() is
   * always called before the owner is queried, so this will always return
   * a valid owner.
   */
  get owner(): PlayerStub | null {
    return this._effectiveOwner
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(info: FallsToEarthInfo, effectiveOwner?: PlayerStub) {
    super()
    this.info = info
    this._effectiveOwner = effectiveOwner ?? null
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // ---------------------------------------------------------------------------

  /** Initiate the fall sequence when the actor is created.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor self)
   *
   * Resolves the effective owner (if not already set via init) and queues the
   * FallToEarth activity. If no effective owner was provided at construction,
   * the actor's own owner is used as fallback (matching C#'s
   * init.GetValue<EffectiveOwnerInit, Player>(info, init.Self.Owner) pattern).
   *
   * @param actor — the actor this trait is attached to
   */
  created(actor: IGameActor): void {
    // Resolve effective owner: init-provided value takes priority, otherwise
    // fall back to the actor's owner (matching C# behavior).
    if (!this._effectiveOwner) {
      this._effectiveOwner = actor.owner ?? null
    }

    // Create actual FallToEarth activity class (Ch14 Phase C).
    //   In C#: self.QueueActivity(false, new FallToEarth(self, info))
    //   The activity handles: descending altitude to 0 at velocity rate,
    //   optional spin (capped by maximumSpinSpeed), horizontal momentum
    //   when moves=true, and explosion on ground contact.
    //   For now, queue a stub activity that does nothing.
    const stubActivity = {
      queue: (_next: ActivityStub): void => { /* stub */ },
      cancel: (_actor: IGameActor): void => { /* stub */ },
      onActorDisposeOuter: (_actor: IGameActor): void => { /* stub */ },
    }
    actor.queueActivity?.(stubActivity)
  }
}
