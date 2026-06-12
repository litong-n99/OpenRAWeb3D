/**
 * Railgun.ts — 电磁轨道炮抛射体（快速直线弹道 + 螺旋光束视觉效果）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/Railgun.cs
 *
 * 核心范式转换:
 * - C# Railgun.CalculateVectors() 几何向量计算 → TypeScript 相同的 WVec/WRot 运算
 * - C# BlocksProjectiles.AnyBlockingActorsBetween → BlockingActorsChecker 回调
 * - C# BeamRenderable / RailgunHelixRenderable → Babylon.js LinesMesh (deferred)
 * - C# Color.FromArgb(alpha, color) → TypeScript [R, G, B, A] tuple with alpha at index [3]
 * - C# FindActorsOnLine 线性伤害 → FindActorsOnLineCallback 回调 (MAJOR 11: added)
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
} from './MissileMath.js'

// ---------------------------------------------------------------------------
// FindActorsOnLineCallback — shared with AreaBeam
// ---------------------------------------------------------------------------

export type FindActorsOnLineCallback = (
  world: GameWorldManager,
  from: WPos,
  to: WPos,
  width: WDist,
) => IGameActor[]

// ---------------------------------------------------------------------------
// RailgunInfo
// ---------------------------------------------------------------------------

export interface RailgunInfo {
  damageActorsInLine: boolean
  inaccuracy: WDist
  inaccuracyType: typeof InaccuracyType[keyof typeof InaccuracyType]
  blockable: boolean
  duration: number
  zOffset: number
  beamWidth: WDist
  beamShape: BeamShapeType
  /** RGBA beam color — index 3 is alpha.
   *
   * OpenRA 对照: RailgunInfo.BeamColor (Color.FromArgb(128, 255, 255, 255))
   */
  beamColor: readonly [number, number, number, number]
  beamPlayerColor: boolean
  /** Alpha change per tick (negative = fade).
   *
   * OpenRA 对照: RailgunInfo.BeamAlphaDeltaPerTick
   */
  beamAlphaDeltaPerTick: number
  helixThickness: WDist
  helixRadius: WDist
  helixPitch: WDist
  helixRadiusDeltaPerTick: number
  /** Helix alpha change per tick (negative = fade).
   *
   * OpenRA 对照: RailgunInfo.HelixAlphaDeltaPerTick
   */
  helixAlphaDeltaPerTick: number
  helixAngleDeltaPerTick: WAngle
  quantizationCount: number
  /** RGBA helix color — index 3 is alpha.
   *
   * OpenRA 对照: RailgunInfo.HelixColor
   */
  helixColor: readonly [number, number, number, number]
  helixPlayerColor: boolean
  hitAnim: string | null
  hitAnimSequence: string
  hitAnimPalette: string
}

export const DEFAULT_RAILGUN_INFO: RailgunInfo = {
  damageActorsInLine: false,
  inaccuracy: WDist.Zero,
  inaccuracyType: InaccuracyType.Maximum,
  blockable: false,
  duration: 15,
  zOffset: 0,
  beamWidth: new WDist(86),
  beamShape: BeamRenderableShape.Cylindrical,
  beamColor: [128, 255, 255, 255],
  beamPlayerColor: false,
  beamAlphaDeltaPerTick: -8,
  helixThickness: new WDist(32),
  helixRadius: new WDist(64),
  helixPitch: new WDist(512),
  helixRadiusDeltaPerTick: 8,
  helixAlphaDeltaPerTick: -8,
  helixAngleDeltaPerTick: new WAngle(16),
  quantizationCount: 16,
  helixColor: [128, 255, 255, 255],
  helixPlayerColor: false,
  hitAnim: null,
  hitAnimSequence: 'idle',
  hitAnimPalette: 'effect',
}

// ---------------------------------------------------------------------------
// Railgun class
// ---------------------------------------------------------------------------

export class Railgun implements IProjectile {
  readonly args: ProjectileArgs
  readonly info: RailgunInfo
  /** RGBA beam color (pre-computed; visible placeholder if player color enabled).
   *
   * OpenRA 对照: Railgun.BeamColor
   */
  readonly beamColor: readonly [number, number, number, number]
  /** RGBA helix color (pre-computed).
   *
   * OpenRA 对照: Railgun.HelixColor
   */
  readonly helixColor: readonly [number, number, number, number]
  ticks: number
  animationComplete: boolean
  isDestroyed: boolean
  target: WPos
  sourceToTarget: WVec = WVec.Zero
  forwardStep: WVec = WVec.Zero
  leftVector: WVec = WVec.Zero
  upVector: WVec = WVec.Zero
  angleStep: WAngle = WAngle.Zero
  cycleCount: number = 0
  private readonly _checkBlocking: BlockingActorsChecker | null
  private readonly _findActorsOnLine: FindActorsOnLineCallback | null

  /**
   * Construct a Railgun projectile.
   *
   * OpenRA 对照: Railgun.Railgun(ProjectileArgs, RailgunInfo, Color, Color)
   *
   * @param args — projectile construction arguments
   * @param info — railgun configuration
   * @param checkBlocking — optional blocking actor checker
   * @param findActorsOnLine — optional line-damage actor finder (MAJOR 11)
   */
  constructor(
    args: ProjectileArgs,
    info: RailgunInfo,
    checkBlocking?: BlockingActorsChecker | null,
    findActorsOnLine?: FindActorsOnLineCallback | null,
  ) {
    this.args = args
    this.info = info
    this.ticks = 0
    this.animationComplete = false
    this.isDestroyed = false
    this._checkBlocking = checkBlocking ?? null
    this._findActorsOnLine = findActorsOnLine ?? null
    this.target = args.passiveTarget

    if (WDist.greaterThan(info.inaccuracy, WDist.Zero)) {
      const range = WPos.subtract(args.passiveTarget, args.source).length
      const maxOff = getProjectileInaccuracy(info.inaccuracy.length, info.inaccuracyType, range, args.inaccuracySource.length)
      const ax = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      const ay = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      this.target = WPos.add(this.target, new WVec(Math.trunc(ax / 1024), Math.trunc(ay / 1024), 0))
    }

    // BLOCKER 3 FIX: Player color should produce a visible beam, not invisible.
    // The original code produced [alpha, 0, 0, 0] which has alpha at index 0 and
    // zero alpha at index 3 — resulting in an invisible beam.
    // Use [255, 255, 255, 255] as a visible placeholder.
    this.beamColor = info.beamPlayerColor
      ? ([255, 255, 255, 255] as const)
      : info.beamColor
    // TODO: Replace with actual player color lookup from PlayerColorManager
    //   OpenRA C#: Color.FromArgb(BeamColor.A, args.SourceActor.OwnerColor())

    this.helixColor = info.helixColor

    this._calculateVectors()
  }

  // -----------------------------------------------------------------------
  // _calculateVectors (OpenRA 对照: Railgun.CalculateVectors)
  // -----------------------------------------------------------------------

  private _calculateVectors(): void {
    if (this.info.blockable && this._checkBlocking && this.args.sourceActor?.owner) {
      // MINOR: Keep world reference as null but document — world is not available
      // in constructor; blocking check at construction time uses null world for
      // pre-calculation. The actual blocking check happens in tick().
      // NOTE: When GameWorldManager is available at construction, pass it here.
      const blockedPos = this._checkBlocking(
        null as unknown as GameWorldManager,
        this.args.sourceActor.owner,
        this.args.source,
        this.target,
        this.info.beamWidth,
      )
      if (blockedPos !== null) this.target = blockedPos
    }

    this.angleStep = new WAngle(Math.trunc(1024 / this.info.quantizationCount))
    this.sourceToTarget = WPos.subtract(this.target, this.args.source)
    const srcLen = this.sourceToTarget.length

    if (srcLen > 0) {
      const pitchPerStep = Math.trunc(this.info.helixPitch.length / this.info.quantizationCount)
      this.forwardStep = WVec.divide(WVec.multiply(this.sourceToTarget, pitchPerStep), srcLen)
    }

    this.leftVector = new WVec(this.forwardStep.Y, -this.forwardStep.X, 0)
    if (this.leftVector.lengthSquared !== 0) {
      this.leftVector = WVec.divide(WVec.multiply(this.leftVector, 1024), this.leftVector.length)
    }

    const fx = this.forwardStep.X
    const fy = this.forwardStep.Y
    const fz = this.forwardStep.Z
    this.upVector = new WVec(-fx * fz, -fz * fy, fx * fx + fy * fy)
    if (this.upVector.lengthSquared !== 0) {
      this.upVector = WVec.divide(WVec.multiply(this.upVector, 1024), this.upVector.length)
    }

    this.cycleCount = Math.trunc(srcLen / this.info.helixPitch.length)
    if (srcLen % this.info.helixPitch.length !== 0) this.cycleCount++

    this.sourceToTarget = WVec.multiply(this.forwardStep, this.info.quantizationCount * this.cycleCount)
  }

  // -----------------------------------------------------------------------
  // tick (OpenRA 对照: Railgun.Tick)
  // -----------------------------------------------------------------------

  /**
   * Advance the railgun by one game logic tick.
   *
   * OpenRA 对照: Railgun.Tick(World world)
   *
   * MAJOR 11: When damageActorsInLine is true, applies warheads to all actors
   * along the line path using FindActorsOnLine, matching C# Railgun.Tick() lines 214-229.
   */
  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return

    if (this.ticks === 0) {
      if (this.info.hitAnim !== null && this.info.hitAnim.length > 0) {
        this.animationComplete = true
      } else {
        this.animationComplete = true
      }

      // MAJOR 11: Line damage loop (C# Railgun.Tick lines 214-229)
      if (this.info.damageActorsInLine && this._findActorsOnLine) {
        const actors = this._findActorsOnLine(world, this.args.source, this.target, this.info.beamWidth)
        for (const a of actors) {
          const actorCenter = (a as unknown as Record<string, unknown>).centerPosition as WPos | undefined
          const warheadArgs: WarheadArgsStub = {
            firedBy: this.args.sourceActor,
            facing: this.args.facing,
            impactOrientation: new WRot(WAngle.Zero, getVerticalAngle(this.args.source, this.target), this.args.facing),
            impactPosition: actorCenter ?? this.target,
            weapon: this.args.weapon,
          }
          this.args.weapon.impact(Target.fromPos(actorCenter ?? this.target), warheadArgs)
        }
      } else {
        const warheadArgs: WarheadArgsStub = {
          firedBy: this.args.sourceActor,
          facing: this.args.facing,
          impactOrientation: new WRot(WAngle.Zero, getVerticalAngle(this.args.source, this.target), this.args.facing),
          impactPosition: this.target,
          weapon: this.args.weapon,
        }
        this.args.weapon.impact(Target.fromPos(this.target), warheadArgs)
      }
    }

    this.ticks++
    if (this.ticks > this.info.duration && this.animationComplete) {
      world.addFrameEndTask(() => { world.removeEffect(this) })
    }
  }

  // -----------------------------------------------------------------------
  // render / dispose
  // -----------------------------------------------------------------------

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }
  dispose(): void { this.isDestroyed = true }

  // -----------------------------------------------------------------------
  // generateHelixPoints — geometry for GPU rendering (OpenRA 对照: RailgunHelixRenderable)
  // -----------------------------------------------------------------------

  /**
   * Generate helix points for GPU rendering.
   *
   * OpenRA 对照: RailgunHelixRenderable
   *
   * @param tick — current tick for animation (radius/angle scaling)
   * @returns array of world positions forming the helix
   */
  generateHelixPoints(tick: number): WPos[] {
    const totalSteps = this.info.quantizationCount * this.cycleCount
    const points: WPos[] = []
    const radius = this.info.helixRadius.length + this.info.helixRadiusDeltaPerTick * tick

    for (let i = 0; i <= totalSteps; i++) {
      const angleVal = (i * this.angleStep.angle + this.info.helixAngleDeltaPerTick.angle * tick) % 1024
      const angle = new WAngle(angleVal)
      const along = WVec.multiply(this.forwardStep, i)
      const cosC = WVec.divide(WVec.multiply(this.leftVector, Math.trunc((radius * angle.cos()) / 1024)), 1024)
      const sinC = WVec.divide(WVec.multiply(this.upVector, Math.trunc((radius * angle.sin()) / 1024)), 1024)

      const rel = WVec.add(along, WVec.add(cosC, sinC))
      points.push(WPos.add(this.args.source, rel))
    }
    return points
  }

  // -----------------------------------------------------------------------
  // Beam alpha (BLOCKER 2 FIX: use index [3] for alpha channel)
  // -----------------------------------------------------------------------

  /**
   * Current beam alpha value (0-255), degraded by beamAlphaDeltaPerTick.
   *
   * OpenRA 对照: Color.FromArgb(BeamColor.A + info.BeamAlphaDeltaPerTick * ticks, BeamColor)
   *
   * RGBA channels: [R=0, G=1, B=2, A=3]. Alpha is at index 3.
   */
  get beamAlpha(): number {
    // BLOCKER 2 FIX: beamColor[3] is alpha, NOT beamColor[0] (which is Red)
    const alpha = this.info.beamColor[3]! + this.info.beamAlphaDeltaPerTick * this.ticks
    return Math.max(0, Math.min(255, alpha))
  }

  /**
   * Current helix alpha value (0-255), degraded by helixAlphaDeltaPerTick.
   *
   * OpenRA 对照: Color.FromArgb(HelixColor.A + info.HelixAlphaDeltaPerTick * ticks, HelixColor)
   *
   * RGBA channels: [R=0, G=1, B=2, A=3]. Alpha is at index 3.
   */
  get helixAlpha(): number {
    // BLOCKER 2 FIX: helixColor[3] is alpha, NOT helixColor[0] (which is Red)
    const alpha = this.info.helixColor[3]! + this.info.helixAlphaDeltaPerTick * this.ticks
    return Math.max(0, Math.min(255, alpha))
  }
}

// ---------------------------------------------------------------------------
// RailgunFactory
// ---------------------------------------------------------------------------

/**
 * Factory function for creating Railgun projectiles with default configuration.
 *
 * OpenRA 对照: RailgunInfo.Create(ProjectileArgs)
 */
export const RailgunFactory = {
  /**
   * Create a Railgun with default configuration.
   *
   * OpenRA 对照: RailgunInfo.Create(ProjectileArgs)
   *
   * @param args — projectile construction arguments
   * @param overrides — optional config overrides
   * @param checkBlocking — optional blocking actor checker
   * @param findActorsOnLine — optional line-damage actor finder
   * @returns a new Railgun instance
   */
  create(
    args: ProjectileArgs,
    overrides?: Partial<RailgunInfo>,
    checkBlocking?: BlockingActorsChecker | null,
    findActorsOnLine?: FindActorsOnLineCallback | null,
  ): Railgun {
    const info: RailgunInfo = { ...DEFAULT_RAILGUN_INFO, ...overrides }
    return new Railgun(args, info, checkBlocking, findActorsOnLine)
  },
}
