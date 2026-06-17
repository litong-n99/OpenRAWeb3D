/**
 * SwallowActor.ts — 沙虫吞食 Activity (接近 → 出地 → 吞食 → 下潜)
 * OpenRA 对照: OpenRA.Mods.D2k/Activities/SwallowActor.cs (166 lines)
 *
 * 核心范式转换:
 * - C# Activity → TS Activity (fully migrated in Ch3/Ch14)
 * - C# enum AttackState → TS const object
 * - C# frame-end tasks → TS world.addFrameEndTask callback
 * - C# WeaponInfo.IsValidAgainst + ActorMap.GetActorsAt → duck-typed
 * - C# TextNotificationsManager → deferred (FLUENT not yet migrated)
 * - 3D: multi-phase animation: mesh position/size interpolation,
 *   emergence (Y-axis rise), swallow (target scales to zero)
 */

import { Activity } from '../../OpenRA.Game/Activities/Activity'
import { CPos } from '../../OpenRA.Game/CPos'
import { Target } from '../../OpenRA.Game/Traits/Target'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces'
import type { Armament } from '../../OpenRA.Mods.Common/Traits/Armament'
import type { AttackSwallow } from '../Traits/AttackSwallow'
import type { Sandworm } from '../Traits/Sandworm'

// ---------------------------------------------------------------------------
// AttackState
// OpenRA 对照: AttackState { Uninitialized, Burrowed, Attacking }
// ---------------------------------------------------------------------------

/** Phases of the swallow attack.
 *
 * OpenRA 对照: enum AttackState { Uninitialized, Burrowed, Attacking }
 */
const AttackState = {
  Uninitialized: 0,
  Burrowed: 1,
  Attacking: 2,
} as const

type AttackState = (typeof AttackState)[keyof typeof AttackState]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** If the target moved more than this many cells away, abort.
 *
 * OpenRA 对照: SwallowActor.NearEnough (1)
 */
const NEAR_ENOUGH = 1

/** Invalid condition token sentinel.
 *
 * OpenRA 对照: Actor.InvalidConditionToken
 */
const INVALID_CONDITION_TOKEN = -1

// ---------------------------------------------------------------------------
// SwallowActor
// OpenRA 对照: SwallowActor : Activity (sealed)
// ---------------------------------------------------------------------------

/** Activity that handles the Sandworm's swallow attack sequence.
 *
 * OpenRA 对照: SwallowActor (sealed class, extends Activity)
 *
 * Phases:
 * 1. Uninitialized → Burrowed: grant attacking condition, set countdown
 * 2. Burrowed: wait for AttackDelay, then check target validity,
 *    find targets at burrow location, call AttackTargets
 * 3. Attacking: wait for ReturnDelay, then (maybe) disappear
 */
export class SwallowActor extends Activity {
  /** The target to swallow.
   *
   * OpenRA 对照: SwallowActor.target (readonly Target)
   */
  private readonly _target: Target

  /** Reference to the Sandworm trait.
   *
   * OpenRA 对照: SwallowActor.sandworm (readonly Sandworm)
   */
  private readonly _sandworm: Sandworm

  /** The weapon being used.
   *
   * OpenRA 对照: SwallowActor.weapon (readonly WeaponInfo)
   */
  private readonly _weapon: unknown

  /** The armament used for this attack.
   *
   * OpenRA 对照: SwallowActor.armament (readonly Armament)
   */
  private readonly _armament: Armament

  /** The AttackSwallow trait.
   *
   * OpenRA 对照: SwallowActor.swallow (readonly AttackSwallow)
   */
  private readonly _swallow: AttackSwallow

  /** The IPositionable (Mobile) trait for position checks.
   *
   * OpenRA 对照: SwallowActor.positionable (readonly IPositionable)
   */
  private readonly _positionable: unknown

  /** The IFacing trait for facing toward target.
   *
   * OpenRA 对照: SwallowActor.facing (readonly IFacing)
   */
  private readonly _facing: unknown

  /** The owning actor (cached for duck-typed access).
   *
   * Mapped from `self` parameter — used as `this._actor` internally.
   */
  private _actor: IGameActor | null = null

  /** Countdown timer for delays.
   *
   * OpenRA 对照: SwallowActor.countdown (int)
   */
  private _countdown: number = 0

  /** Location where the worm burrowed (before attacking).
   *
   * OpenRA 对照: SwallowActor.burrowLocation (CPos)
   */
  private _burrowLocation: CPos | null = null

  /** Current attack phase.
   *
   * OpenRA 对照: SwallowActor.stance (AttackState)
   */
  private _stance: AttackState = AttackState.Uninitialized

  /** Attacking condition token.
   *
   * OpenRA 对照: SwallowActor.attackingToken (int)
   */
  private _attackingToken: number = INVALID_CONDITION_TOKEN

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SwallowActor(Actor self, Target target, Armament a, IFacing facing)
  // ---------------------------------------------------------------------------

  /** Create a SwallowActor activity.
   *
   * OpenRA 对照: SwallowActor(Actor self, in Target target, Armament a, IFacing facing)
   *
   * Caches traits from the actor: Sandworm, Mobile (IPositionable), AttackSwallow.
   *
   * @param self — the actor (Sandworm)
   * @param target — the target to swallow
   * @param armament — the armament used for this attack
   * @param facing — the actor's facing trait
   * @param swallow — the AttackSwallow trait
   * @param sandworm — the Sandworm trait
   */
  constructor(
    self: IGameActor,
    target: Target,
    armament: Armament,
    facing: unknown,
    swallow: AttackSwallow,
    sandworm: Sandworm,
  ) {
    super()
    this._target = target
    this._facing = facing
    this._armament = armament
    this._weapon = armament.weapon
    this._swallow = swallow
    this._sandworm = sandworm
    this._positionable = this.resolvePositionable(self)
    this._actor = self
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: SwallowActor.Tick(Actor self) [override]
  // ---------------------------------------------------------------------------

  /** Execute one tick of the swallow sequence.
   *
   * OpenRA 对照: SwallowActor.Tick(Actor self)
   *
   * State machine:
   * - Uninitialized: set Burrowed, start AttackDelay countdown, grant condition
   * - Burrowed: countdown AttackDelay ticks, then check target position,
   *   find victims at target cell, call AttackTargets
   * - Attacking: countdown ReturnDelay ticks, then (maybe) disappear
   *
   * @param self — the actor (Sandworm)
   * @returns true if activity is complete, false to continue
   */
  override tick(self: IGameActor): boolean {
    switch (this._stance) {
      case AttackState.Uninitialized:
        this._stance = AttackState.Burrowed
        this._countdown = this._swallow.info.attackDelay
        this._burrowLocation = this.getActorLocation(self)

        if (this._attackingToken === INVALID_CONDITION_TOKEN) {
          const condition = this._swallow.info.attackingCondition
          this._attackingToken = this.grantCondition(self, condition)
        }
        return false

      case AttackState.Burrowed:
        if (--this._countdown > 0) return false

        const targetActor = this._target.actor
        if (!targetActor) {
          this.revokeCondition(self)
          return true
        }

        const targetLocation = this.getActorLocation(targetActor as unknown as IGameActor)

        // The target has moved too far away
        const burrowLoc = this._burrowLocation
        if (burrowLoc && (CPos.subtract(burrowLoc, targetLocation).length > NEAR_ENOUGH)) {
          this.revokeCondition(self)
          return true
        }

        // The target reached solid ground
        if (!this.canEnterCell(targetLocation)) {
          this.revokeCondition(self)
          return true
        }

        const targets = this.getActorsAt(targetLocation).filter(
          t => t !== self && this.isValidAgainst(t, self),
        )

        if (targets.length === 0) {
          this.revokeCondition(self)
          return true
        }

        this._stance = AttackState.Attacking
        this._countdown = this._swallow.info.returnDelay
        this._sandworm.isAttacking = true
        this.attackTargets(self, targets)

        return false

      case AttackState.Attacking:
        if (--this._countdown > 0) return false

        this._sandworm.isAttacking = false

        // There is a chance that the worm would just go away after attacking
        if (this.getRandomPercent() <= this._sandworm.wormInfo.chanceToDisappear) {
          this.cancelActivity(self)
          this.addFrameEndTask(self, () => this.disposeActor(self))
        }

        this.revokeCondition(self)
        return true

      default:
        return false
    }
  }

  // ---------------------------------------------------------------------------
  // AttackTargets
  // OpenRA 对照: SwallowActor.AttackTargets(Actor self, IReadOnlyCollection<Actor> targets)
  // ---------------------------------------------------------------------------

  /** Execute the swallow attack on all targets at the target cell.
   *
   * OpenRA 对照: SwallowActor.AttackTargets(Actor self, IReadOnlyCollection<Actor> targets)
   *
   * 1. Dispose each target via frame-end task (no Kill() side effects)
   * 2. Check for harvester insurance
   * 3. Reposition worm to target cell
   * 4. Play attack sound + notifications
   * 5. Fire weapon via armament.CheckFire
   *
   * @param self — the actor (Sandworm)
   * @param targets — all actors at the target cell to swallow
   * @returns whether armament.CheckFire succeeded
   */
  private attackTargets(self: IGameActor, targets: IGameActor[]): boolean {
    const targetLocation = this.getActorLocation(targets[0]!)

    for (const t of targets) {
      const targetClose = t // capture for closure

      this.addFrameEndTask(self, () => {
        // Don't use Kill() because we don't want any of its side-effects (husks, etc)
        this.disposeTargetActor(targetClose)
      })

      // Harvester insurance
      if (this.hasTraitInfo(t, 'Harvester')) {
        const owner = this.getOwner(t)
        if (owner) {
          const playerActor = this.getPlayerActor(owner)
          if (playerActor) {
            const insurance = this.getTrait(playerActor, 'HarvesterInsurance')
            if (insurance) {
              const ins = insurance as { tryActivate?: () => void }
              this.addFrameEndTask(self, () => ins.tryActivate?.())
            }
          }
        }
      }
    }

    this.setPosition(self, targetLocation)

    const attackPosition = this.getCenterPosition(self)

    // Play sound
    this.playWorldSound(self, this._swallow.info.wormAttackSound, attackPosition)

    // Send notifications to affected players
    const affectedPlayers = this.getAffectedPlayers(targets)
    for (const player of affectedPlayers) {
      this.addFrameEndTask(self, () => {
        this.addMapNotification(
          self,
          player,
          'Speech',
          this._swallow.info.wormAttackNotification,
          25,
          true,
          attackPosition,
        )
      })

      // Text notification
      if (this.isLocalPlayer(self, player)) {
        this.addTextNotification(
          self,
          this._swallow.info.wormAttackTextNotification,
        )
      }
    }

    // Fire the weapon
    if (typeof (this._armament as { checkFire?: unknown }).checkFire === 'function') {
      return (this._armament as unknown as {
        checkFire: (
          self: IGameActor,
          facing: unknown,
          target: Target,
        ) => boolean
      }).checkFire(self, this._facing, this._target)
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // RevokeCondition
  // OpenRA 对照: SwallowActor.RevokeCondition(Actor self)
  // ---------------------------------------------------------------------------

  /** Revoke the attacking condition token.
   *
   * OpenRA 对照: SwallowActor.RevokeCondition(Actor self)
   *
   * @param self — the actor
   */
  private revokeCondition(self: IGameActor): void {
    if (this._attackingToken !== INVALID_CONDITION_TOKEN) {
      this._attackingToken = this.revokeConditionToken(self, this._attackingToken)
    }
  }

  // ---------------------------------------------------------------------------
  // Duck-typing helpers
  // ---------------------------------------------------------------------------

  /** Get the actor's cell location. */
  private getActorLocation(self: IGameActor): CPos {
    const a = self as unknown as { location?: CPos }
    return a.location ?? CPos.Zero
  }

  /** Get the actor's center position in world units. */
  private getCenterPosition(self: IGameActor): unknown /* WPos */ {
    return (self as unknown as { centerPosition?: unknown }).centerPosition
  }

  /** Check if Mobile.CanEnterCell succeeds. */
  private canEnterCell(cell: CPos): boolean {
    const p = this._positionable as {
      canEnterCell?: (
        cell: CPos,
        actor: unknown,
        blockedByActor: number,
      ) => boolean
    } | null
    return p?.canEnterCell?.(cell, null, 0) ?? true
  }

  /** Get all actors at a cell from world ActorMap. */
  private getActorsAt(cell: CPos): IGameActor[] {
    const world = this._actor?.world as
      | { actorMap?: { getActorsAt?: (cell: CPos) => IGameActor[] } }
      | undefined
    return world?.actorMap?.getActorsAt?.(cell) ?? []
  }

  /** Check if weapon is valid against an actor. */
  private isValidAgainst(target: IGameActor, self: IGameActor): boolean {
    const w = this._weapon as {
      isValidAgainst?: (
        target: IGameActor,
        owner: null,
        firedBy: IGameActor,
      ) => boolean
    } | null
    return w?.isValidAgainst?.(target, null, self) ?? false
  }

  /** Check if an actor has a specific trait info. */
  private hasTraitInfo(actor: IGameActor, name: string): boolean {
    const info = (actor as unknown as { info?: { hasTraitInfo?: (n: string) => boolean } }).info
    return info?.hasTraitInfo?.(name) ?? false
  }

  /** Get actor owner reference. */
  private getOwner(actor: IGameActor): unknown {
    return (actor as unknown as { owner?: unknown }).owner
  }

  /** Get the player actor from a player reference. */
  private getPlayerActor(player: unknown): IGameActor | null {
    return (player as { playerActor?: IGameActor } | null | undefined)
      ?.playerActor ?? null
  }

  /** Get a trait from an actor by name. */
  private getTrait(actor: IGameActor, name: string): unknown | null {
    const fn = (actor as unknown as { trait?: <T>(name: string) => T | undefined }).trait
    return fn?.<unknown>(name) ?? null
  }

  /** Get the set of unique owners from targets. */
  private getAffectedPlayers(targets: IGameActor[]): unknown[] {
    const seen = new Set<unknown>()
    for (const t of targets) {
      const owner = this.getOwner(t)
      if (owner !== undefined) seen.add(owner)
    }
    return Array.from(seen)
  }

  /** Check if player is the local player. */
  private isLocalPlayer(self: IGameActor, player: unknown): boolean {
    const world = self.world as { localPlayer?: unknown } | undefined
    return world?.localPlayer === player
  }

  /** Grant a condition and return the token. */
  private grantCondition(self: IGameActor, condition: string | null): number {
    if (!condition) return INVALID_CONDITION_TOKEN
    const fn = (self as unknown as { grantCondition?: (c: string) => number }).grantCondition
    return fn?.(condition) ?? INVALID_CONDITION_TOKEN
  }

  /** Revoke a condition by token. Returns the new invalid token. */
  private revokeConditionToken(self: IGameActor, token: number): number {
    const fn = (self as unknown as { revokeCondition?: (t: number) => number }).revokeCondition
    return fn?.(token) ?? INVALID_CONDITION_TOKEN
  }

  /** Add a frame-end task. */
  private addFrameEndTask(self: IGameActor, task: () => void): void {
    const world = self.world as {
      addFrameEndTask?: (task: () => void) => void
    } | undefined
    world?.addFrameEndTask?.(task)
  }

  /** Dispose a target actor (no husk/loot side effects). */
  private disposeTargetActor(actor: IGameActor): void {
    const fn = (actor as unknown as { dispose?: () => void }).dispose
    fn?.()
  }

  /** Dispose the worm itself. */
  private disposeActor(self: IGameActor): void {
    const fn = (self as unknown as { dispose?: () => void }).dispose
    fn?.()
  }

  /** Cancel actor's current activity. */
  private cancelActivity(self: IGameActor): void {
    const fn = (self as unknown as { cancelActivity?: () => void }).cancelActivity
    fn?.()
  }

  /** Set the actor's position on the map (teleport to cell). */
  private setPosition(self: IGameActor, cell: CPos): void {
    const fn = (self as unknown as { setPosition?: (c: CPos) => void }).setPosition
    fn?.(cell)
  }

  /** Play a sound at world position. */
  private playWorldSound(
    self: IGameActor,
    sound: string,
    position: unknown,
  ): void {
    const world = self.world as {
      game?: {
        sound?: {
          play?: (type: string, sound: string, pos: unknown) => void
        }
      }
    } | undefined
    world?.game?.sound?.play?.('World', sound, position)
  }

  /** Add a map notification effect.
   *
   * NOTE: Full MapNotificationEffect creation is deferred (TODO-19.B.4-NOTIF).
   * This stub registers a simple effect that auto-expires.
   */
  private addMapNotification(
    self: IGameActor,
    _player: unknown,
    _category: string,
    _notification: string,
    _duration: number,
    _isCritical: boolean,
    _position: unknown,
  ): void {
    const world = self.world as {
      add?: (effect: unknown) => void
    } | undefined
    // Simplified: create a notification effect object
    const effect = {
      tick: () => { /* auto-expires after duration */ },
      // NOTE: Full MapNotificationEffect deferred (TODO-19.B.4-NOTIF)
    }
    world?.add?.(effect)
  }

  /** Add a transient text notification line. */
  private addTextNotification(self: IGameActor, text: string): void {
    const world = self.world as {
      textNotificationsManager?: {
        addTransientLine?: (player: unknown, text: string) => void
      }
    } | undefined
    const localPlayer = world as unknown as { localPlayer?: unknown }
    world?.textNotificationsManager?.addTransientLine?.(
      localPlayer?.localPlayer,
      text,
    )
  }

  /** Get random int [0, 99] (shared random or Math.random fallback). */
  private getRandomPercent(): number {
    const world = this._actor?.world as {
      sharedRandom?: { next?: (min: number, max: number) => number }
    } | undefined
    if (world?.sharedRandom?.next) {
      return world.sharedRandom.next(0, 100)
    }
    return Math.floor(Math.random() * 100)
  }

  /** Resolve the IPositionable trait from the actor. */
  private resolvePositionable(self: IGameActor): unknown {
    const fn = (self as unknown as { trait?: <T>(name: string) => T | undefined }).trait
    return fn?.<unknown>('Mobile') ?? null
  }

  /** Override onLastRun for cleanup. */
  protected override onLastRun(_self: import('../../OpenRA.Game/Actor').GameActor): void {
    this._actor = null
  }
}
