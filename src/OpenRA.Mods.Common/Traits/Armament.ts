/**
 * Armament.ts -- Weapon mount: reload state, burst cycling, CheckFire(), Fire()
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Armament.cs (432 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<ArmamentInfo>, ITick → TS ConditionalTrait, ITick
 * - C# explicit interface ITick.Tick → TS tick() method
 * - C# Turreted, Hovers, BodyOrientation duck-typed access → TS duck-typing
 * - C# Game.Sound.Play() →  (sound deferred)
 * - C# projectile.Projectile.Create() → PROJECTILE_REGISTRY[type].create()
 * - C# in Target → TS Target (reference, not struct)
 */

import {
  type IGameActor,
  type ISync,
  type ITick,
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IFacing } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { WeaponInfo, type ProjectileArgs } from '../../OpenRA.Game/GameRules/WeaponInfo.js'
import { PROJECTILE_REGISTRY } from '../Projectiles/ProjectileRegistry.js'
import type {
  Barrel,
  INotifyAttack,
  INotifyBurstComplete,
  IRangeModifier,
  IReloadModifier,
  IFirepowerModifier,
  IInaccuracyModifier,
} from './CombatInterfaces.js'
import {
  isIRangeModifier,
  isIReloadModifier,
  isIFirepowerModifier,
  isIInaccuracyModifier,
  isINotifyAttack,
  isINotifyBurstComplete,
} from './CombatInterfaces.js'
import { applyPercentageModifiers } from '../Projectiles/MissileMath.js'

// NOTE: facingWithinTolerance is defined in AttackBase.ts for shared use
// by attack variants. Armament does not perform facing checks itself.

// ---------------------------------------------------------------------------
// ArmamentInfo
// OpenRA 对照: ArmamentInfo (PausableConditionalTraitInfo, Requires<AttackBaseInfo>)
// ---------------------------------------------------------------------------

/** Configuration for an Armament trait.
 *
 *  OpenRA 对照: ArmamentInfo
 */
export class ArmamentInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Name of this armament (used to link to AmmoPool).
   *
   *  OpenRA 对照: ArmamentInfo.Name
   */
  readonly name: string = 'primary'

  /** Weapon name (from weapons.yaml).
   *
   *  OpenRA 对照: ArmamentInfo.Weapon
   */
  readonly weapon: string | null = null

  /** Which turret this armament is assigned to.
   *
   *  OpenRA 对照: ArmamentInfo.Turret
   */
  readonly turret: string = 'primary'

  /** Time (in frames) until the weapon can fire again.
   *
   *  OpenRA 对照: ArmamentInfo.FireDelay
   */
  readonly fireDelay: number = 0

  /** Muzzle positions relative to turret/body (forward, right, up triples).
   *
   *  OpenRA 对照: ArmamentInfo.LocalOffset
   */
  readonly localOffset: readonly WVec[] = []

  /** Muzzle yaw relative to turret/body.
   *
   *  OpenRA 对照: ArmamentInfo.LocalYaw
   */
  readonly localYaw: readonly WAngle[] = []

  /** Move the turret backwards when firing.
   *
   *  OpenRA 对照: ArmamentInfo.Recoil
   */
  readonly recoil: WDist = WDist.Zero

  /** Recoil recovery per-frame.
   *
   *  OpenRA 对照: ArmamentInfo.RecoilRecovery
   */
  readonly recoilRecovery: WDist = new WDist(9)

  /** Muzzle flash sequence to render.
   *
   *  OpenRA 对照: ArmamentInfo.MuzzleSequence
   */
  readonly muzzleSequence: string | null = null

  /** Palette for muzzle flash.
   *
   *  OpenRA 对照: ArmamentInfo.MuzzlePalette
   */
  readonly muzzlePalette: string = 'effect'

  /** Condition to grant while reloading.
   *
   *  OpenRA 对照: ArmamentInfo.ReloadingCondition
   */
  readonly reloadingCondition: string | null = null

  /** Target relationships for regular fire.
   *
   *  OpenRA 对照: ArmamentInfo.TargetRelationships
   */
  readonly targetRelationships: number = 1 // PlayerRelationship.Enemy

  /** Target relationships for force-fire.
   *
   *  OpenRA 对照: ArmamentInfo.ForceTargetRelationships
   */
  readonly forceTargetRelationships: number = 7 // Enemy | Neutral | Ally

  /** Cursor to display when hovering over a valid target.
   *
   *  OpenRA 对照: ArmamentInfo.Cursor
   */
  readonly cursor: string = 'attack'

  /** Cursor to display when hovering over a valid target outside range.
   *
   *  OpenRA 对照: ArmamentInfo.OutsideRangeCursor
   */
  readonly outsideRangeCursor: string = 'attackoutsiderange'

  /** Ammo consumed per shot.
   *
   *  OpenRA 对照: ArmamentInfo.AmmoUsage
   */
  readonly ammoUsage: number = 1

  /** Pre-resolved weapon info (set at ruleset load).
   *
   *  OpenRA 对照: ArmamentInfo.WeaponInfo
   */
  weaponInfo: WeaponInfo | null = null

  /** Pre-computed modified range (set at ruleset load).
   *
   *  OpenRA 对照: ArmamentInfo.ModifiedRange
   */
  modifiedRange: WDist = WDist.Zero

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    name?: string
    weapon?: string | null
    turret?: string
    fireDelay?: number
    localOffset?: WVec[]
    localYaw?: WAngle[]
    recoil?: WDist
    recoilRecovery?: WDist
    muzzleSequence?: string | null
    muzzlePalette?: string
    reloadingCondition?: string | null
    targetRelationships?: number
    forceTargetRelationships?: number
    cursor?: string
    outsideRangeCursor?: string
    ammoUsage?: number
    weaponInfo?: WeaponInfo | null
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.name = params.name ?? 'primary'
    this.weapon = params.weapon ?? null
    this.turret = params.turret ?? 'primary'
    this.fireDelay = params.fireDelay ?? 0
    this.localOffset = params.localOffset ?? []
    this.localYaw = params.localYaw ?? []
    this.recoil = params.recoil ?? WDist.Zero
    this.recoilRecovery = params.recoilRecovery ?? new WDist(9)
    this.muzzleSequence = params.muzzleSequence ?? null
    this.muzzlePalette = params.muzzlePalette ?? 'effect'
    this.reloadingCondition = params.reloadingCondition ?? null
    this.targetRelationships = params.targetRelationships ?? 1
    this.forceTargetRelationships = params.forceTargetRelationships ?? 7
    this.cursor = params.cursor ?? 'attack'
    this.outsideRangeCursor = params.outsideRangeCursor ?? 'attackoutsiderange'
    this.ammoUsage = params.ammoUsage ?? 1
    this.weaponInfo = params.weaponInfo ?? null
  }
}

// ---------------------------------------------------------------------------
// Armament
// OpenRA 对照: Armament
// ---------------------------------------------------------------------------

/** Weapon mount trait. Manages firing state, barrel cycling, and projectile creation.
 *
 *  OpenRA 对照: Armament (PausableConditionalTrait<ArmamentInfo>, ITick)
 */
export class Armament
  extends ConditionalTrait<ArmamentInfo>
  implements ITick, ISync
{
  /** The weapon assigned to this armament.
   *
   *  OpenRA 对照: Armament.Weapon (WeaponInfo)
   */
  readonly weapon: WeaponInfo | null

  /** The barrels (muzzle positions) for this armament.
   *
   *  OpenRA 对照: Armament.Barrels (Barrel[])
   */
  readonly barrels: readonly Barrel[]

  /** Current recoil distance.
   *
   *  OpenRA 对照: Armament.Recoil
   */
  recoil: WDist = WDist.Zero

  /** Frames remaining until the next shot can be fired.
   *
   *  OpenRA 对照: Armament.FireDelay
   */
  fireDelay: number = 0

  /** Number of shots remaining in the current burst.
   *
   *  OpenRA 对照: Armament.Burst
   */
  burst: number = 1

  // Duck-typed companion traits
  private turret: unknown | null = null
  private hovers: unknown | null = null
  private coords: unknown | null = null
  private notifyBurstComplete: INotifyBurstComplete[] = []
  private notifyAttacks: Array<{ notifyActor: IGameActor; notify: INotifyAttack }> = []

  // Modifier caches
  private rangeModifiers: number[] = []
  private reloadModifiers: number[] = []
  private damageModifiers: number[] = []
  private inaccuracyModifiers: number[] = []

  // Condition token for reloading
  private conditionToken: number = -1

  // Internal state
  private ticksSinceLastShot: number = 0
  private currentBarrel: number = 0
  private readonly barrelCount: number

  // Delayed actions (fire delay scheduling)
  private delayedActions: Array<{ ticks: number; burst: number; func: (burst: number) => void }> = []

  /** Whether the armament is currently reloading.
   *
   *  OpenRA 对照: Armament.IsReloading
   */
  get isReloading(): boolean {
    return this.fireDelay > 0 || this.isTraitDisabled
  }

  constructor(info: ArmamentInfo) {
    super(info)
    this.weapon = info.weaponInfo

    // Build barrels from local offsets/yaws
    const barrels: Barrel[] = []
    for (let i = 0; i < info.localOffset.length; i++) {
      const offset = info.localOffset[i]!
      const yaw = info.localYaw.length > i ? info.localYaw[i]! : WAngle.Zero
      barrels.push({ offset, yaw })
    }

    if (barrels.length === 0) {
      barrels.push({ offset: WVec.Zero, yaw: WAngle.Zero })
    }

    this.barrels = barrels
    this.barrelCount = barrels.length

    if (this.weapon) {
      this.burst = this.weapon.burst
    }
  }

  // ---------------------------------------------------------------------------
  // ITick
  // ---------------------------------------------------------------------------

  /** Tick: decrement delay, recoil recovery, process delayed actions.
   *
   *  OpenRA 对照: ITick.Tick(Actor)
   */
  tick(self: IGameActor): void {
    // Update reloading condition first
    this.updateCondition(self)

    if (this.isTraitDisabled) return

    if (this.ticksSinceLastShot < (this.weapon?.reloadDelay ?? 1)) {
      this.ticksSinceLastShot++
    }

    if (this.fireDelay > 0) {
      this.fireDelay--
    }

    // Recoil recovery
    this.recoil = new WDist(
      Math.max(0, this.recoil.length - this.info.recoilRecovery.length),
    )

    // Process delayed actions
    for (let i = this.delayedActions.length - 1; i >= 0; i--) {
      const x = this.delayedActions[i]!
      if (--x.ticks <= 0) {
        x.func(x.burst)
      }
    }
    this.delayedActions = this.delayedActions.filter(a => a.ticks > 0)
  }

  // ---------------------------------------------------------------------------
  // Initialization (called after actor creation)
  // ---------------------------------------------------------------------------

  /** Initialize duck-typed references to companion traits.
   *
   *  OpenRA 对照: Armament.Created(Actor)
   */
  created(self: IGameActor): void {
    const actorAny = self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }

    // Turreted (by name match)
    const turrets = actorAny.getTraits?.<unknown>('turreted') ?? []
    this.turret = turrets.find(
      t => (t as { name?: string }).name === this.info.turret,
    ) ?? null

    // Hovers
    this.hovers = null

    // BodyOrientation
    const orientations = actorAny.getTraits?.<unknown>('bodyOrientation') ?? []
    this.coords = orientations.length > 0 ? orientations[0] : null

    // Notification traits
    const allTraits = actorAny.getTraits?.<unknown>('') ?? []
    this.notifyBurstComplete = allTraits.filter(isINotifyBurstComplete) as INotifyBurstComplete[]
    this.notifyAttacks = allTraits
      .filter(isINotifyAttack)
      .map(a => ({ notifyActor: self, notify: a as INotifyAttack }))

    // Modifier traits
    this.rangeModifiers = allTraits
      .filter(isIRangeModifier)
      .map(m => (m as IRangeModifier).getRangeModifier())
    this.reloadModifiers = allTraits
      .filter(isIReloadModifier)
      .map(m => (m as IReloadModifier).getReloadModifier())
    this.damageModifiers = allTraits
      .filter(isIFirepowerModifier)
      .map(m => (m as IFirepowerModifier).getFirepowerModifier())
    this.inaccuracyModifiers = allTraits
      .filter(isIInaccuracyModifier)
      .map(m => (m as IInaccuracyModifier).getInaccuracyModifier())
  }

  // ---------------------------------------------------------------------------
  // AttackGarrisoned support
  // ---------------------------------------------------------------------------

  /** Add external attack notifications (for garrisoned passengers).
   *
   *  OpenRA 对照: Armament.AddNotifyAttacks(Actor, INotifyAttack[])
   */
  addNotifyAttacks(attacker: IGameActor, newNotifyAttacks: INotifyAttack[]): void {
    for (const n of newNotifyAttacks) {
      this.notifyAttacks.push({ notifyActor: attacker, notify: n })
    }
  }

  /** Remove external attack notifications.
   *
   *  OpenRA 对照: Armament.RemoveNotifyAttacks(INotifyAttack[])
   */
  removeNotifyAttacks(removeList: INotifyAttack[]): void {
    this.notifyAttacks = this.notifyAttacks.filter(
      pair => !removeList.includes(pair.notify),
    )
  }

  // ---------------------------------------------------------------------------
  // Range
  // ---------------------------------------------------------------------------

  /** Maximum range with active range modifiers applied.
   *
   *  OpenRA 对照: Armament.MaxRange()
   */
  maxRange(): WDist {
    if (!this.weapon) return WDist.Zero
    return new WDist(
      applyPercentageModifiers(this.weapon.range.length, this.rangeModifiers),
    )
  }

  // ---------------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------------

  /** Check if the weapon can fire at a target (range, reload, turret, validity).
   *
   *  OpenRA 对照: Armament.CanFire(Actor, Target)
   */
  canFire(self: IGameActor, target: Target): boolean {
    if (this.isTraitPaused) return false
    if (this.isReloading) return false

    if (this.turret) {
      const turretAny = this.turret as { hasAchievedDesiredFacing?: boolean }
      if (turretAny.hasAchievedDesiredFacing === false) return false
    }

    const centerPos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const maxRange = this.maxRange()

    if (!target.isInRange(centerPos, maxRange)) return false

    if (
      this.weapon?.minRange &&
      !WDist.equals(this.weapon.minRange, WDist.Zero) &&
      target.isInRange(centerPos, this.weapon.minRange)
    ) {
      return false
    }

    const world = (self as unknown as { world?: unknown }).world ?? null
    if (this.weapon && !this.weapon.isValidAgainst(target, world as never, self)) {
      return false
    }

    return true
  }

  /** Attempt to fire at a target. Resets burst, cycles barrels, calls FireBarrel.
   *
   *  OpenRA 对照: Armament.CheckFire(Actor, IFacing, Target)
   *
   *  Note: facing is only used by legacy positioning code.
   *  The 3D world coordinate model uses Actor.Orientation.
   */
  checkFire(self: IGameActor, facing: IFacing | null, target: Target): boolean {
    if (!this.canFire(self, target)) return false

    if (this.ticksSinceLastShot >= (this.weapon?.reloadDelay ?? 1)) {
      this.burst = this.weapon?.burst ?? 1
    }

    this.ticksSinceLastShot = 0

    do {
      this.currentBarrel %= this.barrelCount
      const barrelIdx = (this.weapon?.burst ?? 1) === 1
        ? this.currentBarrel
        : this.burst % this.barrels.length
      const barrel = this.barrels[barrelIdx]!
      this.currentBarrel++

      this.fireBarrel(self, facing, target, barrel)
      this.updateBurst(self, target)
    } while (this.fireDelay === 0 && this.canFire(self, target))

    return true
  }

  /** Create projectile args and schedule delayed fire action.
   *
   *  OpenRA 对照: Armament.FireBarrel(Actor, IFacing, Target, Barrel)
   */
  protected fireBarrel(
    self: IGameActor,
    _facing: IFacing | null,
    target: Target,
    barrel: Barrel,
  ): void {
    // Notify preparing attack
    for (const pair of this.notifyAttacks) {
      pair.notify.preparingAttack(pair.notifyActor, target, this, barrel)
    }

    const muzzlePos = this.calculateMuzzlePosition(self, barrel)
    const muzzleFacing = this.calculateMuzzleOrientation(self, barrel)

    // Compute passive target position
    const centerPos = (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    let passiveTarget = this.weapon?.targetActorCenter
      ? target.centerPosition
      : this.closestTargetPosition(centerPos, target)

    // First burst offset
    const firstOffset = this.weapon?.firstBurstTargetOffset ?? WVec.Zero
    if (!WVec.equals(firstOffset, WVec.Zero)) {
      // Convert: forward,right,up -> OpenRA convention
      const converted = new WVec(firstOffset.Y, -firstOffset.X, firstOffset.Z)
      passiveTarget = WPos.add(
        passiveTarget,
        WVec.subtract(converted.rotate(muzzleFacing), WVec.Zero),
      )
    }

    // Following burst offset
    const followingOffset = this.weapon?.followingBurstTargetOffset ?? WVec.Zero
    if (!WVec.equals(followingOffset, WVec.Zero)) {
      const converted = new WVec(followingOffset.Y, -followingOffset.X, followingOffset.Z)
      const remainingBursts = (this.weapon?.burst ?? 1) - this.burst
      passiveTarget = WPos.add(
        passiveTarget,
        WVec.multiply(converted.rotate(muzzleFacing), remainingBursts),
      )
    }

    const args: ProjectileArgs = {
      weapon: this.weapon!,
      facing: muzzleFacing.yaw,
      currentMuzzleFacing: () => this.calculateMuzzleOrientation(self, barrel).yaw,
      damageModifiers: this.damageModifiers,
      inaccuracyModifiers: this.inaccuracyModifiers,
      rangeModifiers: this.rangeModifiers,
      source: muzzlePos,
      currentSource: () => muzzlePos,
      sourceActor: self,
      passiveTarget,
      guidedTarget: target,
    }

    // Schedule delayed fire
    this.scheduleDelayedAction(
      this.info.fireDelay,
      this.burst,
      (_burst: number) => {
        if (args.weapon?.projectileType) {
          const factory = PROJECTILE_REGISTRY[args.weapon.projectileType]
          if (factory) {
            const config = (args.weapon?.projectileConfig ?? {}) as Record<string, unknown>
            const projectile = factory.create(args as never, config as never)
            if (projectile) {
              const world = (self as unknown as { world?: {
                add?(_p: unknown): void
                addEffect?(_e: unknown): void
              } }).world
              world?.add?.(projectile)
            }
          }

          // Sound playback
          // Game.Sound.Play(SoundType.World, args.Weapon.Report, ...)
          // Game.Sound.Play(SoundType.World, args.Weapon.StartBurstReport, ...)
        }

        this.recoil = this.info.recoil

        // Notify attacking
        for (const pair of this.notifyAttacks) {
          pair.notify.attacking(pair.notifyActor, target, this, barrel)
        }
      },
    )
  }

  /** Update burst state after firing a barrel.
   *
   *  OpenRA 对照: Armament.UpdateBurst(Actor, Target)
   */
  protected updateBurst(self: IGameActor, target: Target): void {
    if (--this.burst > 0) {
      if (this.weapon) {
        if (this.weapon.burstDelays.length === 1) {
          this.fireDelay = this.weapon.burstDelays[0]!
        } else {
          this.fireDelay = this.weapon.burstDelays[this.weapon.burst - (this.burst + 1)]!
        }
      }
    } else {
      const modifiers = this.reloadModifiers
      this.fireDelay = applyPercentageModifiers(
        this.weapon?.reloadDelay ?? 1,
        modifiers,
      )
      if (this.fireDelay <= 0) this.fireDelay = 1

      this.burst = this.weapon?.burst ?? 1

      // AfterFireSound playback
      // ScheduleDelayedAction(Weapon.AfterFireSoundDelay, Burst, burst => ...)

      for (const nbc of this.notifyBurstComplete) {
        nbc.firedBurst(self, target, this)
      }
    }
  }

  /** Schedule a delayed action.
   *
   *  OpenRA 对照: Armament.ScheduleDelayedAction(int, int, Action<int>)
   */
  protected scheduleDelayedAction(
    ticks: number,
    burst: number,
    func: (burst: number) => void,
  ): void {
    if (ticks > 0) {
      this.delayedActions.push({ ticks, burst, func })
    } else {
      func(burst)
    }
  }

  // ---------------------------------------------------------------------------
  // Muzzle position/orientation calculations
  // ---------------------------------------------------------------------------

  /** Calculate the world-space muzzle position.
   *
   *  OpenRA 对照: Armament.CalculateMuzzleOffset(Actor, Barrel)
   */
  protected calculateMuzzlePosition(self: IGameActor, barrel: Barrel): WPos {
    const centerPos =
      (self as unknown as { centerPosition?: WPos }).centerPosition ?? WPos.Zero
    const offset = this.calculateMuzzleOffset(self, barrel)
    return WPos.add(centerPos, offset)
  }

  /** Calculate the world-space muzzle offset.
   *
   *  OpenRA 对照: Armament.CalculateMuzzleOffset(Actor, Barrel)
   */
  calculateMuzzleOffset(self: IGameActor, barrel: Barrel): WVec {
    // Weapon offset in turret coordinates, with recoil
    const recoilVec = new WVec(-this.recoil.length, 0, 0)
    let localOffset = WVec.add(barrel.offset, recoilVec)

    // Hovers visual offset
    if (this.hovers) {
      const hoversVisualOffset =
        (this.hovers as { worldVisualOffset?: WVec }).worldVisualOffset
      if (hoversVisualOffset) {
        localOffset = WVec.add(localOffset, hoversVisualOffset)
      }
    }

    // Body orientation
    const selfOrientation =
      (self as unknown as { orientation?: WRot }).orientation ?? WRot.None
    const bodyOrientation = this.quantizeOrientation(selfOrientation)

    if (this.turret) {
      const turretAny = this.turret as {
        worldOrientation?: WRot
        offset?: WVec
      }
      if (turretAny.worldOrientation) {
        localOffset = WVec.add(
          localOffset.rotate(turretAny.worldOrientation),
          (turretAny.offset ?? WVec.Zero).rotate(bodyOrientation),
        )
      }
    } else {
      localOffset = localOffset.rotate(bodyOrientation)
    }

    // Body coordinates to world coordinates
    if (this.coords) {
      const coordsAny = this.coords as {
        localToWorld?: (v: WVec) => WVec
      }
      if (coordsAny.localToWorld) {
        return coordsAny.localToWorld(localOffset)
      }
    }

    return localOffset
  }

  /** Calculate the muzzle orientation.
   *
   *  OpenRA 对照: Armament.CalculateMuzzleOrientation(Actor, Barrel)
   */
  calculateMuzzleOrientation(self: IGameActor, barrel: Barrel): WRot {
    const barrelYawRot = WRot.fromYaw(barrel.yaw)
    const turretOrientation =
      (this.turret as { worldOrientation?: WRot })?.worldOrientation
    const selfOrientation =
      (self as unknown as { orientation?: WRot }).orientation ?? WRot.None
    return barrelYawRot.rotate(turretOrientation ?? selfOrientation)
  }

  /** Muzzle offset exposed for public query.
   *
   *  OpenRA 对照: Armament.MuzzleOffset(Actor, Barrel)
   */
  muzzleOffset(self: IGameActor, barrel: Barrel): WVec {
    return this.calculateMuzzleOffset(self, barrel)
  }

  /** Muzzle orientation exposed for public query.
   *
   *  OpenRA 对照: Armament.MuzzleOrientation(Actor, Barrel)
   */
  muzzleOrientation(self: IGameActor, barrel: Barrel): WRot {
    return this.calculateMuzzleOrientation(self, barrel)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Update reloading condition token. */
  private updateCondition(self: IGameActor): void {
    if (!this.info.reloadingCondition) return

    const enabled = !this.isTraitDisabled && this.isReloading

    if (enabled && this.conditionToken === -1) {
      this.conditionToken = self.grantCondition?.(this.info.reloadingCondition) ?? -1
    } else if (!enabled && this.conditionToken !== -1) {
      self.revokeCondition?.(this.conditionToken)
      this.conditionToken = -1
    }
  }

  /** Quantize orientation to 8 discrete directions. */
  private quantizeOrientation(orientation: WRot): WRot {
    const facing = orientation.yaw.facing
    const quantized = Math.round(facing / 32) * 32
    return WRot.fromFacing((quantized + 256) % 256)
  }

  /** Find the closest target position to a given origin. */
  private closestTargetPosition(origin: WPos, target: Target): WPos {
    const positions = target.positions
    if (positions.length === 0) return target.centerPosition

    let bestPos = positions[0]!
    let bestDistSq = WPos.subtract(bestPos, origin).horizontalLengthSquared

    for (let i = 1; i < positions.length; i++) {
      const p = positions[i]!
      const distSq = WPos.subtract(p, origin).horizontalLengthSquared
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        bestPos = p
      }
    }

    return bestPos
  }
}

// Re-export Barrel
export type { Barrel }
