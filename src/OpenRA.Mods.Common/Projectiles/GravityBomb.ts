/**
 * GravityBomb.ts — 重力炸弹抛射体（欧拉积分的弹道轨迹）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/GravityBomb.cs
 *
 * 核心范式转换:
 * - C# GravityBomb.Tick() Euler 积分弹道 → TypeScript 同样整数积分
 * - C# pos.Z <= args.PassiveTarget.Z 地面碰撞 → TypeScript 同样高度检查
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { WorldRendererStub, IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import {
  type IProjectile,
  type ProjectileArgs,
  type WarheadArgsStub,
} from './Bullet.js'

export interface GravityBombInfo {
  image: string | null
  sequences: readonly string[]
  openSequence: string | null
  palette: string
  isPlayerPalette: boolean
  shadow: boolean
  shadowColor: readonly [number, number, number, number]
  velocity: WVec
  acceleration: WVec
}

export const DEFAULT_GRAVITY_BOMB_INFO: GravityBombInfo = {
  image: null,
  sequences: ['idle'],
  openSequence: null,
  palette: 'effect',
  isPlayerPalette: false,
  shadow: false,
  shadowColor: [140, 0, 0, 0],
  velocity: WVec.Zero,
  acceleration: new WVec(0, 0, -15),
}

export class GravityBomb implements IProjectile {
  readonly info: GravityBombInfo
  readonly args: ProjectileArgs
  velocity: WVec
  readonly _acceleration: WVec
  pos: WPos
  lastPos: WPos
  readonly shadowColor: readonly [number, number, number]
  readonly shadowAlpha: number
  isDestroyed: boolean

  constructor(info: GravityBombInfo, args: ProjectileArgs) {
    this.info = info
    this.args = args
    this.pos = args.source
    this.lastPos = args.source
    this.isDestroyed = false

    const convertedVelocity = new WVec(info.velocity.Y, -info.velocity.X, info.velocity.Z)
    this.velocity = convertedVelocity.rotate(WRot.fromYaw(args.facing))
    this._acceleration = new WVec(info.acceleration.Y, -info.acceleration.X, info.acceleration.Z)

    this.shadowColor = [info.shadowColor[0]! / 255, info.shadowColor[1]! / 255, info.shadowColor[2]! / 255] as const
    this.shadowAlpha = info.shadowColor[3]! / 255
  }

  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return
    this.lastPos = this.pos
    this.pos = WPos.add(this.pos, this.velocity)
    this.velocity = WVec.add(this.velocity, this._acceleration)

    if (this.pos.Z <= this.args.passiveTarget.Z) {
      this.pos = WPos.add(this.pos, new WVec(0, 0, this.args.passiveTarget.Z - this.pos.Z))
      world.addFrameEndTask(() => { world.removeEffect(this) })
      const warheadArgs: WarheadArgsStub = {
        firedBy: this.args.sourceActor,
        facing: this.args.facing,
        impactOrientation: new WRot(WAngle.Zero, this._getVerticalAngle(this.lastPos, this.pos), this.args.facing),
        impactPosition: this.pos,
        weapon: this.args.weapon,
      }
      this.args.weapon.impact(Target.fromPos(this.pos), warheadArgs)
      this.isDestroyed = true
    }
  }

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }
  dispose(): void { this.isDestroyed = true }

  get palette(): string {
    if (this.info.palette && this.info.isPlayerPalette && this.args.sourceActor?.owner) {
      return this.info.palette + this.args.sourceActor.owner.playerName
    }
    return this.info.palette
  }

  private _getVerticalAngle(from: WPos, to: WPos): WAngle {
    const delta = WPos.subtract(to, from)
    const horizontalDelta = delta.horizontalLength
    if (horizontalDelta === 0) return WAngle.Zero
    return new WVec(-delta.Z, -horizontalDelta, 0).yaw
  }
}

export const GravityBombFactory = {
  create(args: ProjectileArgs, overrides?: Partial<GravityBombInfo>): GravityBomb {
    const info: GravityBombInfo = { ...DEFAULT_GRAVITY_BOMB_INFO, ...overrides }
    return new GravityBomb(info, args)
  },
}
