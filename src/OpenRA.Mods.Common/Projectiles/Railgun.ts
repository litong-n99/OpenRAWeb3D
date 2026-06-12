/**
 * Railgun.ts — 电磁轨道炮抛射体（快速直线弹道 + 螺旋光束视觉效果）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/Railgun.cs
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { WorldRendererStub, IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import {
  type IProjectile,
  type ProjectileArgs,
  type WarheadArgsStub,
  type BlockingActorsChecker,
  InaccuracyType,
} from './Bullet.js'
import { BeamRenderableShape } from './BeamRenderableShape.js'
import type { BeamRenderableShape as BeamShapeType } from './BeamRenderableShape.js'

export interface RailgunInfo {
  damageActorsInLine: boolean
  inaccuracy: WDist
  inaccuracyType: typeof InaccuracyType[keyof typeof InaccuracyType]
  blockable: boolean
  duration: number
  zOffset: number
  beamWidth: WDist
  beamShape: BeamShapeType
  beamColor: readonly [number, number, number, number]
  beamPlayerColor: boolean
  beamAlphaDeltaPerTick: number
  helixThickness: WDist
  helixRadius: WDist
  helixPitch: WDist
  helixRadiusDeltaPerTick: number
  helixAlphaDeltaPerTick: number
  helixAngleDeltaPerTick: WAngle
  quantizationCount: number
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

export class Railgun implements IProjectile {
  readonly args: ProjectileArgs
  readonly info: RailgunInfo
  readonly beamColor: readonly [number, number, number, number]
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

  constructor(
    args: ProjectileArgs,
    info: RailgunInfo,
    checkBlocking?: BlockingActorsChecker | null,
  ) {
    this.args = args
    this.info = info
    this.ticks = 0
    this.animationComplete = false
    this.isDestroyed = false
    this._checkBlocking = checkBlocking ?? null
    this.target = args.passiveTarget

    if (WDist.greaterThan(info.inaccuracy, WDist.Zero)) {
      const maxOff = this._getProjectileInaccuracy(info, args)
      const ax = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      const ay = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      this.target = WPos.add(this.target, new WVec(Math.trunc(ax / 1024), Math.trunc(ay / 1024), 0))
    }

    this.beamColor = info.beamPlayerColor
      ? ([info.beamColor[3], 0, 0, 0] as readonly [number, number, number, number])
      : info.beamColor
    this.helixColor = info.helixColor

    this._calculateVectors()
  }

  private _calculateVectors(): void {
    if (this.info.blockable && this._checkBlocking && this.args.sourceActor?.owner) {
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

  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return

    if (this.ticks === 0) {
      if (this.info.hitAnim !== null && this.info.hitAnim.length > 0) {
        this.animationComplete = true
      } else {
        this.animationComplete = true
      }

      if (!this.info.damageActorsInLine) {
        const warheadArgs: WarheadArgsStub = {
          firedBy: this.args.sourceActor,
          facing: this.args.facing,
          impactOrientation: new WRot(WAngle.Zero, this._getVerticalAngle(this.args.source, this.target), this.args.facing),
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

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }
  dispose(): void { this.isDestroyed = true }

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

  get beamAlpha(): number {
    const alpha = this.info.beamColor[0]! + this.info.beamAlphaDeltaPerTick * this.ticks
    return Math.max(0, Math.min(255, alpha))
  }
  get helixAlpha(): number {
    const alpha = this.info.helixColor[0]! + this.info.helixAlphaDeltaPerTick * this.ticks
    return Math.max(0, Math.min(255, alpha))
  }

  private _getVerticalAngle(from: WPos, to: WPos): WAngle {
    const delta = WPos.subtract(to, from)
    const horizontalDelta = delta.horizontalLength
    if (horizontalDelta === 0) return WAngle.Zero
    return new WVec(-delta.Z, -horizontalDelta, 0).yaw
  }

  private _getProjectileInaccuracy(info: RailgunInfo, args: ProjectileArgs): number {
    const range = WPos.subtract(args.passiveTarget, args.source).length
    const type = info.inaccuracyType
    switch (type) {
      case InaccuracyType.Maximum:
        return Math.min(info.inaccuracy.length, Math.trunc(range / Math.max(1, args.inaccuracySource.length)))
      case InaccuracyType.PerCellIncrement:
        return Math.max(0, Math.trunc(range / 1024)) * info.inaccuracy.length
      case InaccuracyType.Absolute: return info.inaccuracy.length
      default: return 0
    }
  }
}

export const RailgunFactory = {
  create(
    args: ProjectileArgs,
    overrides?: Partial<RailgunInfo>,
    checkBlocking?: BlockingActorsChecker | null,
  ): Railgun {
    const info: RailgunInfo = { ...DEFAULT_RAILGUN_INFO, ...overrides }
    return new Railgun(args, info, checkBlocking)
  },
}
