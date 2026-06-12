/**
 * LaserZap.ts — 激光光束抛射体（即时命中 + 视觉持久光束）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/LaserZap.cs
 *
 * 核心范式转换:
 * - C# BeamRenderable (屏幕空间线段) → Babylon.js LinesMesh (世界空间线段, deferred)
 * - C# damageDuration → TypeScript 相同逻辑
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

export interface LaserZapInfo {
  width: WDist
  shape: BeamShapeType
  zOffset: number
  duration: number
  damageDuration: number
  damageInterval: number
  usePlayerColor: boolean
  color: readonly [number, number, number, number]
  trackTarget: boolean
  inaccuracy: WDist
  inaccuracyType: typeof InaccuracyType[keyof typeof InaccuracyType]
  blockable: boolean
  secondaryBeam: boolean
  secondaryBeamWidth: WDist
  secondaryBeamShape: BeamShapeType
  secondaryBeamZOffset: number
  secondaryBeamUsePlayerColor: boolean
  secondaryBeamColor: readonly [number, number, number, number]
  hitAnim: string | null
  hitAnimSequence: string
  hitAnimPalette: string
  launchEffectImage: string | null
  launchEffectSequence: string | null
  launchEffectPalette: string
}

export const DEFAULT_LASER_ZAP_INFO: LaserZapInfo = {
  width: new WDist(86),
  shape: BeamRenderableShape.Cylindrical,
  zOffset: 0,
  duration: 10,
  damageDuration: 1,
  damageInterval: 1,
  usePlayerColor: false,
  color: [255, 0, 0, 255],
  trackTarget: true,
  inaccuracy: WDist.Zero,
  inaccuracyType: InaccuracyType.Maximum,
  blockable: false,
  secondaryBeam: false,
  secondaryBeamWidth: new WDist(86),
  secondaryBeamShape: BeamRenderableShape.Cylindrical,
  secondaryBeamZOffset: 0,
  secondaryBeamUsePlayerColor: false,
  secondaryBeamColor: [255, 0, 0, 255],
  hitAnim: null,
  hitAnimSequence: 'idle',
  hitAnimPalette: 'effect',
  launchEffectImage: null,
  launchEffectSequence: null,
  launchEffectPalette: 'effect',
}

export class LaserZap implements IProjectile {
  readonly info: LaserZapInfo
  readonly args: ProjectileArgs
  readonly color: readonly [number, number, number, number]
  readonly secondaryColor: readonly [number, number, number, number]
  target: WPos
  source: WPos
  ticks: number
  interval: number
  showHitAnim: boolean
  hasLaunchEffect: boolean
  isDestroyed: boolean
  private readonly _checkBlocking: BlockingActorsChecker | null

  constructor(
    info: LaserZapInfo,
    args: ProjectileArgs,
    checkBlocking?: BlockingActorsChecker | null,
  ) {
    this.info = info
    this.args = args
    this.ticks = 0
    this.interval = info.damageInterval
    this.isDestroyed = false
    this._checkBlocking = checkBlocking ?? null
    this.color = info.color
    this.secondaryColor = info.secondaryBeamColor
    this.target = args.passiveTarget

    if (WDist.greaterThan(info.inaccuracy, WDist.Zero)) {
      const maxOff = this._getProjectileInaccuracy(info, args)
      const ax = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      const ay = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      this.target = WPos.add(this.target, new WVec(Math.trunc(ax / 1024), Math.trunc(ay / 1024), 0))
    }

    this.source = args.source
    this.showHitAnim = info.hitAnim !== null && info.hitAnim.length > 0
    this.hasLaunchEffect =
      info.launchEffectImage !== null && info.launchEffectImage.length > 0 &&
      info.launchEffectSequence !== null && info.launchEffectSequence.length > 0
  }

  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return

    // Update source
    const currentSourceFn = (this.args as unknown as Record<string, unknown>).currentSource as (() => WPos) | undefined
    this.source = currentSourceFn?.() ?? this.args.source

    if (this.hasLaunchEffect && this.ticks === 0) {
      void world
    }

    if (this.info.trackTarget && this.args.guidedTarget.isValidFor(
      this.args.sourceActor as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef,
    )) {
      // Check if weapon targets actor center
      const w = this.args.weapon as unknown as Record<string, unknown>
      const guided = this.args.guidedTarget
      if (w.targetActorCenter) {
        this.target = guided.centerPosition
      } else {
        const posList = guided.positions as unknown as { closestToIgnoringPath?: (pos: WPos) => WPos } | null
        this.target = posList?.closestToIgnoringPath
          ? posList.closestToIgnoringPath(this.source)
          : guided.centerPosition
      }
    }

    if (this.info.blockable && this._checkBlocking && this.args.sourceActor?.owner) {
      const blockedPos = this._checkBlocking(
        world, this.args.sourceActor.owner, this.source, this.target, this.info.width,
      )
      if (blockedPos !== null) this.target = blockedPos
    }

    if (this.ticks < this.info.damageDuration && --this.interval <= 0) {
      const muzzleFacingFn = (this.args as unknown as Record<string, unknown>).currentMuzzleFacing as (() => WAngle) | undefined
      const warheadArgs: WarheadArgsStub = {
        firedBy: this.args.sourceActor,
        facing: this.args.facing,
        impactOrientation: new WRot(
          WAngle.Zero,
          this._getVerticalAngle(this.source, this.target),
          muzzleFacingFn?.() ?? this.args.facing,
        ),
        impactPosition: this.target,
        weapon: this.args.weapon,
      }
      this.args.weapon.impact(Target.fromPos(this.target), warheadArgs)
      this.interval = this.info.damageInterval
    }

    this.ticks++
    if (this.ticks >= this.info.duration && !this.showHitAnim) {
      world.addFrameEndTask(() => { world.removeEffect(this) })
    }
  }

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }
  dispose(): void { this.isDestroyed = true }

  get beamAlpha(): number {
    if (this.info.duration <= 0) return 0
    const remaining = this.info.duration - this.ticks
    if (remaining <= 0) return 0
    return Math.trunc((remaining * this.color[3]!) / this.info.duration)
  }

  private _getVerticalAngle(from: WPos, to: WPos): WAngle {
    const delta = WPos.subtract(to, from)
    const horizontalDelta = delta.horizontalLength
    if (horizontalDelta === 0) return WAngle.Zero
    return new WVec(-delta.Z, -horizontalDelta, 0).yaw
  }

  private _getProjectileInaccuracy(
    info: LaserZapInfo,
    args: ProjectileArgs,
  ): number {
    const range = WPos.subtract(args.passiveTarget, args.source).length
    const type = info.inaccuracyType
    switch (type) {
      case InaccuracyType.Maximum:
        return Math.min(info.inaccuracy.length, Math.trunc(range / Math.max(1, args.inaccuracySource.length)))
      case InaccuracyType.PerCellIncrement:
        return Math.max(0, Math.trunc(range / 1024)) * info.inaccuracy.length
      case InaccuracyType.Absolute:
        return info.inaccuracy.length
      default:
        return 0
    }
  }
}

export const LaserZapFactory = {
  create(
    args: ProjectileArgs,
    overrides?: Partial<LaserZapInfo>,
    checkBlocking?: BlockingActorsChecker | null,
  ): LaserZap {
    const info: LaserZapInfo = { ...DEFAULT_LASER_ZAP_INFO, ...overrides }
    return new LaserZap(info, args, checkBlocking)
  },
}
