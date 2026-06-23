/**
 * AreaBeam.ts — 范围光束抛射体（行进头/尾 + 持续伤害区间）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/AreaBeam.cs
 *
 * 核心范式转换:
 * - C# 行进头/尾的 LerpQuadratic 插值 → TypeScript 相同 WPos 插值
 * - C# world.FindActorsOnLine → FindActorsOnLineCallback 回调
 * - C# BeamRenderable → Babylon.js LinesMesh (deferred)
 * - C# int2.Lerp 衰减计算 → TypeScript 线性插值
 * - C# args.RangeModifiers → ProjectileArgs.rangeModifiers (MAJOR 6, 7)
 * - C# args.DamageModifiers.Append(falloff) → WarheadArgsStub.damageModifiers (MAJOR 4)
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { WorldRendererStub, IRenderable, IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import {
  type IProjectile,
  type ProjectileArgs,
  type WarheadArgsStub,
  type BlockingActorsChecker,
} from './Bullet.js'
import { BeamRenderableShape } from './BeamRenderableShape.js'
import type { BeamRenderableShape as BeamShapeType } from './BeamRenderableShape.js'
import {
  InaccuracyType,
  getVerticalAngle,
  getProjectileInaccuracy,
  applyPercentageModifiers,
} from './MissileMath.js'

// ---------------------------------------------------------------------------
// FindActorsOnLineCallback
// ---------------------------------------------------------------------------

export type FindActorsOnLineCallback = (
  world: GameWorldManager,
  from: WPos,
  to: WPos,
  width: WDist,
) => IGameActor[]

// ---------------------------------------------------------------------------
// AreaBeamInfo
// ---------------------------------------------------------------------------

export interface AreaBeamInfo {
  speed: readonly WDist[]
  duration: number
  damageInterval: number
  width: WDist
  shape: BeamShapeType
  beyondTargetRange: WDist
  minDistance: WDist
  falloff: readonly number[]
  range: readonly WDist[]
  inaccuracy: WDist
  inaccuracyType: typeof InaccuracyType[keyof typeof InaccuracyType]
  blockable: boolean
  trackTarget: boolean
  renderBeam: boolean
  zOffset: number
  color: readonly [number, number, number, number]
  usePlayerColor: boolean
}

export const DEFAULT_AREA_BEAM_INFO: AreaBeamInfo = {
  speed: [new WDist(128)],
  duration: 10,
  damageInterval: 3,
  width: new WDist(512),
  shape: BeamRenderableShape.Cylindrical,
  beyondTargetRange: new WDist(0),
  minDistance: WDist.Zero,
  falloff: [100, 100],
  range: [WDist.Zero, new WDist(2147483647)],
  inaccuracy: WDist.Zero,
  inaccuracyType: InaccuracyType.Maximum,
  blockable: false,
  trackTarget: false,
  renderBeam: true,
  zOffset: 0,
  color: [255, 0, 0, 255],
  usePlayerColor: false,
}

// ---------------------------------------------------------------------------
// ExtendedProjectileArgs — shared interface for beam projectiles (MINOR: define proper interface)
// ---------------------------------------------------------------------------

/**
 * Extended projectile args for beam-type projectiles that need current source tracking.
 *
 * OpenRA 对照: args.CurrentSource(), args.DamageModifiers
 */
export interface ExtendedProjectileArgs extends ProjectileArgs {
  /** Callback for current source position (from turret/muzzle). */
  currentSource?: () => WPos
  /** Damage modifiers from source actor traits. */
  damageModifiers?: number[]
}

// ---------------------------------------------------------------------------
// AreaBeam class
// ---------------------------------------------------------------------------

/**
 * Beam projectile with travelling head/tail and periodic line damage.
 *
 * OpenRA 对照: AreaBeam class (IProjectile, ISync)
 */
export class AreaBeam implements IProjectile {
  readonly info: AreaBeamInfo
  readonly args: ProjectileArgs
  readonly color: readonly [number, number, number, number]
  readonly speed: WDist
  readonly weaponRange: WDist
  headPos: WPos
  tailPos: WPos
  target: WPos
  length: number
  towardsTargetFacing: WAngle
  headTicks: number
  tailTicks: number
  isHeadTravelling: boolean
  isTailTravelling: boolean
  continueTracking: boolean
  isDestroyed: boolean
  private readonly _checkBlocking: BlockingActorsChecker | null
  private readonly _findActorsOnLine: FindActorsOnLineCallback | null

  /**
   * Whether the beam is fully complete (head and tail both arrived).
   *
   * OpenRA 对照: AreaBeam.IsBeamComplete
   */
  get isBeamComplete(): boolean {
    return (
      !this.isHeadTravelling &&
      this.headTicks >= this.length &&
      !this.isTailTravelling &&
      this.tailTicks >= this.length
    )
  }

  /**
   * Construct an AreaBeam projectile.
   *
   * OpenRA 对照: AreaBeam.AreaBeam(AreaBeamInfo, ProjectileArgs, Color)
   *
   * @param info — beam configuration
   * @param args — projectile construction arguments
   * @param checkBlocking — optional blocking actor checker
   * @param findActorsOnLine — optional line-damage actor finder
   */
  constructor(
    info: AreaBeamInfo,
    args: ProjectileArgs,
    checkBlocking?: BlockingActorsChecker | null,
    findActorsOnLine?: FindActorsOnLineCallback | null,
  ) {
    this.info = info
    this.args = args
    this.isDestroyed = false
    this._checkBlocking = checkBlocking ?? null
    this._findActorsOnLine = findActorsOnLine ?? null
    this.color = info.color

    if (info.speed.length > 1) {
      const min = info.speed[0]!.length
      const max = info.speed[1]!.length
      this.speed = new WDist(min + (args.random.next() % (max - min + 1)))
    } else {
      this.speed = info.speed[0] ?? new WDist(128)
    }

    this.headPos = args.source
    this.tailPos = args.source

    this.target = args.passiveTarget
    if (WDist.greaterThan(info.inaccuracy, WDist.Zero)) {
      const range = WPos.subtract(args.passiveTarget, args.source).length
      const maxOff = getProjectileInaccuracy(info.inaccuracy.length, info.inaccuracyType, range, args.inaccuracySource.length)
      const ax = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      const ay = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      this.target = WPos.add(this.target, new WVec(Math.trunc(ax / 1024), Math.trunc(ay / 1024), 0))
    }

    this.towardsTargetFacing = WPos.subtract(this.target, this.headPos).yaw
    const dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(this.towardsTargetFacing))
    const srcCenter = (args.sourceActor as unknown as Record<string, unknown>).centerPosition as WPos | undefined
    const srcPos = srcCenter ?? args.source
    const dist = WPos.subtract(this.target, srcPos).length
    let extraDist: number
    if (info.minDistance.length > dist) {
      extraDist = info.minDistance.length - dist < info.beyondTargetRange.length
        ? info.beyondTargetRange.length
        : info.minDistance.length - dist
    } else {
      extraDist = info.beyondTargetRange.length
    }
    this.target = WPos.add(this.target, WVec.divide(WVec.multiply(dir, extraDist), 1024))
    const headDist = WPos.subtract(this.target, this.headPos).length
    this.length = Math.max(Math.trunc(headDist / this.speed.length), 1)

    // MAJOR 6 + MAJOR 7: rangeModifiers from ProjectileArgs, apply percentage modifiers
    const weaponRange = (args.weapon as unknown as Record<string, unknown>).range as { length: number } | undefined
    const rawRange = weaponRange?.length ?? 0
    this.weaponRange = new WDist(applyPercentageModifiers(rawRange, args.rangeModifiers ?? []))

    this.isHeadTravelling = true
    this.isTailTravelling = false
    this.continueTracking = true
    this.headTicks = 0
    this.tailTicks = 0
  }

  // -----------------------------------------------------------------------
  // tick (OpenRA 对照: AreaBeam.Tick)
  // -----------------------------------------------------------------------

  /**
   * Advance the beam by one game logic tick.
   *
   * OpenRA 对照: AreaBeam.Tick(World world)
   *
   * MAJOR 4: Falloff modifier is applied as a damage modifier to WarheadArgs,
   * matching C# AreaBeam.Tick() lines 250-260.
   */
  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return

    if (this.info.trackTarget) this._trackTarget()

    this.headTicks++
    if (this.headTicks >= this.length) {
      this.headPos = this.target
      this.isHeadTravelling = false
    } else if (this.isHeadTravelling) {
      this.headPos = WPos.lerpQuadratic(this.args.source, this.target, WAngle.Zero, this.headTicks, this.length)
    }

    if (this.tailTicks <= 0) {
      const extArgs = this.args as unknown as ExtendedProjectileArgs
      const newSource = extArgs.currentSource?.() ?? this.args.source
      this.tailPos = newSource
    }

    const outOfRange =
      this.weaponRange.length + this.info.beyondTargetRange.length <
      WPos.subtract(this.args.passiveTarget, this.args.source).length

    if (
      (this.headTicks >= this.info.duration && !this.isTailTravelling) ||
      this.args.sourceActor.isDead ||
      outOfRange
    ) {
      this._stopTargeting()
    }

    if (this.isTailTravelling) {
      this.tailTicks++
      if (this.tailTicks >= this.length) {
        this.tailPos = this.target
        this.isTailTravelling = false
      } else {
        this.tailPos = WPos.lerpQuadratic(this.args.source, this.target, WAngle.Zero, this.tailTicks, this.length)
      }
    }

    if (this.info.blockable && this._checkBlocking && this.args.sourceActor?.owner) {
      const blockedPos = this._checkBlocking(
        world, this.args.sourceActor.owner, this.tailPos, this.headPos, this.info.width,
      )
      if (blockedPos !== null) {
        this.headPos = blockedPos
        this.target = this.headPos
        this.length = Math.min(this.headTicks, this.length)
      }
    }

    // MAJOR 4 FIX: Apply falloff modifier to WarheadArgs as damage modifier
    // OpenRA C# AreaBeam.Tick() lines 250-260:
    //   var adjustedModifiers = args.DamageModifiers.Append(GetFalloff((args.Source - a.CenterPosition).Length));
    //   var warheadArgs = new WarheadArgs(args) { ..., DamageModifiers = adjustedModifiers.ToArray() };
    if (this.headTicks % this.info.damageInterval === 0 && this._findActorsOnLine) {
      const actors = this._findActorsOnLine(world, this.tailPos, this.headPos, this.info.width)
      for (const a of actors) {
        const actorCenter = (a as unknown as Record<string, unknown>).centerPosition as WPos | undefined
        const dist = WPos.subtract(this.args.source, actorCenter ?? new WPos(0, 0, 0)).length
        const falloffMod = this._getFalloff(dist)

        const extArgs = this.args as unknown as ExtendedProjectileArgs
        const baseModifiers = extArgs.damageModifiers ?? []
        const adjustedModifiers = [...baseModifiers, falloffMod]

        const warheadArgs: WarheadArgsStub = {
          firedBy: this.args.sourceActor,
          facing: this.args.facing,
          impactOrientation: new WRot(WAngle.Zero, getVerticalAngle(this.args.source, this.target), this.args.facing),
          impactPosition: actorCenter ?? this.headPos,
          weapon: this.args.weapon,
          damageModifiers: adjustedModifiers,
        }
        this.args.weapon.impact(Target.fromPos(actorCenter ?? this.headPos), warheadArgs)
      }
    }

    if (this.isBeamComplete) {
      this.isDestroyed = true
      world.addFrameEndTask(() => { world.removeEffect(this) })
    }
  }

  // -----------------------------------------------------------------------
  // render / dispose
  // -----------------------------------------------------------------------

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }
  dispose(): void { this.isDestroyed = true }

  // -----------------------------------------------------------------------
  // _trackTarget (OpenRA 对照: AreaBeam.TrackTarget)
  // -----------------------------------------------------------------------

  private _trackTarget(): void {
    if (!this.continueTracking) return
    if (this.args.guidedTarget.isValidFor(this.args.sourceActor as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef)) {
      const guidedPos = this.args.guidedTarget.centerPosition
      const targetDistance = new WDist(WPos.subtract(guidedPos, this.args.source).length)
      if (targetDistance.length > this.weaponRange.length + this.info.beyondTargetRange.length) {
        this._stopTargeting()
      } else {
        this.target = guidedPos
        this.towardsTargetFacing = WPos.subtract(this.target, this.args.source).yaw
        const dir = new WVec(0, -1024, 0).rotate(WRot.fromYaw(this.towardsTargetFacing))
        this.target = WPos.add(this.target, WVec.divide(WVec.multiply(dir, this.info.beyondTargetRange.length), 1024))
      }
    }
  }

  // -----------------------------------------------------------------------
  // _stopTargeting (OpenRA 对照: AreaBeam.StopTargeting)
  // -----------------------------------------------------------------------

  private _stopTargeting(): void {
    this.continueTracking = false
    this.isTailTravelling = true
  }

  // -----------------------------------------------------------------------
  // _getFalloff (OpenRA 对照: AreaBeam.GetFalloff)
  // -----------------------------------------------------------------------

  private _getFalloff(distance: number): number {
    let inner = this.info.range[0]!.length
    for (let i = 1; i < this.info.range.length; i++) {
      const outer = this.info.range[i]!.length
      if (outer > distance) {
        return this._int2Lerp(this.info.falloff[i - 1]!, this.info.falloff[i]!, distance - inner, outer - inner)
      }
      inner = outer
    }
    return 0
  }

  private _int2Lerp(a: number, b: number, mu: number, div: number): number {
    if (div <= 0) return a
    return Math.trunc(a + ((b - a) * mu) / div)
  }
}

// ---------------------------------------------------------------------------
// AreaBeamFactory
// ---------------------------------------------------------------------------

/**
 * Factory function for creating AreaBeam projectiles with default configuration.
 *
 * OpenRA 对照: AreaBeamInfo.Create(ProjectileArgs)
 */
export const AreaBeamFactory = {
  /**
   * Create an AreaBeam with default configuration.
   *
   * OpenRA 对照: AreaBeamInfo.Create(ProjectileArgs)
   *
   * @param args — projectile construction arguments
   * @param overrides — optional config overrides
   * @param checkBlocking — optional blocking actor checker
   * @param findActorsOnLine — optional line-damage actor finder
   * @returns a new AreaBeam instance
   */
  create(
    args: ProjectileArgs,
    overrides?: Partial<AreaBeamInfo>,
    checkBlocking?: BlockingActorsChecker | null,
    findActorsOnLine?: FindActorsOnLineCallback | null,
  ): AreaBeam {
    const info: AreaBeamInfo = { ...DEFAULT_AREA_BEAM_INFO, ...overrides }
    return new AreaBeam(info, args, checkBlocking, findActorsOnLine)
  },
}
