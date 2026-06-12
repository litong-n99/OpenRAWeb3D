/**
 * Missile.ts — 制导导弹抛射体（追踪目标 + 燃料限制 + 地形感知 + 尾迹）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/Missile.cs
 *
 * 核心范式转换:
 * - C# Missile.Tick() 角度插值制导 → TypeScript 整数角度系统 + 状态机
 * - C# ContrailRenderable → ContrailLogic (数据管理)
 * - C# SpriteEffect 尾迹 → TypeScript 延迟生成逻辑
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
  ContrailLogic,
  InaccuracyType,
} from './Bullet.js'
import {
  loopRadius,
  normaliseFacing,
  tickFacing,
  clamp,
  applyPercentageModifiers,
} from './MissileMath.js'

// ---------------------------------------------------------------------------
// MissileState
// ---------------------------------------------------------------------------

export const MissileState = {
  Freefall: 0,
  Homing: 1,
  Hitting: 2,
} as const
export type MissileState = (typeof MissileState)[keyof typeof MissileState]

// ---------------------------------------------------------------------------
// MissileInfo
// ---------------------------------------------------------------------------

export interface MissileInfo {
  image: string | null
  sequences: readonly string[]
  palette: string
  isPlayerPalette: boolean
  shadow: boolean
  shadowColor: readonly [number, number, number, number]
  minimumLaunchAngle: WAngle
  maximumLaunchAngle: WAngle
  minimumLaunchSpeed: WDist
  maximumLaunchSpeed: WDist
  speed: WDist
  acceleration: WDist
  arm: number
  blockable: boolean
  terrainHeightAware: boolean
  width: WDist
  inaccuracy: WDist
  inaccuracyType: typeof InaccuracyType[keyof typeof InaccuracyType]
  lockOnInaccuracy: WDist
  lockOnProbability: number
  horizontalRateOfTurn: WAngle
  verticalRateOfTurn: WAngle
  gravity: number
  rangeLimit: WDist
  explodeWhenEmpty: boolean
  airburstAltitude: WDist
  cruiseAltitude: WDist
  homingActivationDelay: number
  trailImage: string | null
  trailSequences: readonly string[]
  trailPalette: string
  trailUsePlayerPalette: boolean
  trailInterval: number
  trailWhenDeactivated: boolean
  contrailLength: number
  contrailDelay: number
  contrailZOffset: number
  contrailStartWidth: WDist
  contrailEndWidth: WDist | null
  contrailStartColor: readonly [number, number, number, number]
  contrailStartColorUsePlayerColor: boolean
  contrailStartColorAlpha: number
  contrailEndColor: readonly [number, number, number, number] | null
  contrailEndColorUsePlayerColor: boolean
  contrailEndColorAlpha: number
  jammable: boolean
  jammedDiversionRange: number
  boundToTerrainType: string
  allowSnapping: boolean
  closeEnough: WDist
  rangeModifiers: number[]
}

export const DEFAULT_MISSILE_INFO: MissileInfo = {
  image: null,
  sequences: ['idle'],
  palette: 'effect',
  isPlayerPalette: false,
  shadow: false,
  shadowColor: [140, 0, 0, 0],
  minimumLaunchAngle: new WAngle(-64),
  maximumLaunchAngle: new WAngle(128),
  minimumLaunchSpeed: new WDist(-1),
  maximumLaunchSpeed: new WDist(-1),
  speed: new WDist(384),
  acceleration: new WDist(5),
  arm: 0,
  blockable: true,
  terrainHeightAware: false,
  width: new WDist(1),
  inaccuracy: WDist.Zero,
  inaccuracyType: InaccuracyType.Absolute,
  lockOnInaccuracy: new WDist(-1),
  lockOnProbability: 100,
  horizontalRateOfTurn: new WAngle(20),
  verticalRateOfTurn: new WAngle(24),
  gravity: 10,
  rangeLimit: WDist.Zero,
  explodeWhenEmpty: true,
  airburstAltitude: WDist.Zero,
  cruiseAltitude: new WDist(512),
  homingActivationDelay: 0,
  trailImage: null,
  trailSequences: ['idle'],
  trailPalette: 'effect',
  trailUsePlayerPalette: false,
  trailInterval: 2,
  trailWhenDeactivated: false,
  contrailLength: 0,
  contrailDelay: 1,
  contrailZOffset: 2047,
  contrailStartWidth: new WDist(64),
  contrailEndWidth: null,
  contrailStartColor: [255, 255, 255, 255],
  contrailStartColorUsePlayerColor: false,
  contrailStartColorAlpha: 255,
  contrailEndColor: null,
  contrailEndColorUsePlayerColor: false,
  contrailEndColorAlpha: 0,
  jammable: true,
  jammedDiversionRange: 20,
  boundToTerrainType: '',
  allowSnapping: false,
  closeEnough: new WDist(298),
  rangeModifiers: [],
}

// ---------------------------------------------------------------------------
// Missile class
// ---------------------------------------------------------------------------

export class Missile implements IProjectile {
  readonly info: MissileInfo
  readonly args: ProjectileArgs
  state: MissileState
  pos: WPos
  velocity: WVec
  speed: number = 0
  _loopRadius: number = 0
  distanceCovered: WDist
  rangeLimit: WDist
  readonly minLaunchSpeed: number
  readonly maxLaunchSpeed: number
  readonly maxSpeed: number
  readonly minLaunchAngle: WAngle
  readonly maxLaunchAngle: WAngle
  hFacing: number
  vFacing: number = 0
  renderFacing: WAngle
  ticks: number
  ticksToNextSmoke: number
  readonly lockOn: boolean
  targetPosition: WPos
  offset: WVec
  tarVel: WVec
  predVel: WVec
  targetPassedBy: boolean
  allowPassBy: boolean
  readonly contrail: ContrailLogic | null
  readonly trailPalette: string
  readonly shadowColor: readonly [number, number, number]
  readonly shadowAlpha: number
  isDestroyed: boolean
  readonly gravity: WVec
  private readonly _checkBlocking: BlockingActorsChecker | null

  constructor(
    info: MissileInfo,
    args: ProjectileArgs,
    checkBlocking?: BlockingActorsChecker | null,
  ) {
    this.info = info
    this.args = args
    this.isDestroyed = false
    this._checkBlocking = checkBlocking ?? null

    this.pos = args.source
    this.hFacing = args.facing.facing
    this.gravity = new WVec(0, 0, -info.gravity)
    this.targetPosition = args.passiveTarget

    const weaponRange = (args.weapon as unknown as { range?: { length: number } }).range
    // OpenRA: info.RangeLimit != WDist.Zero ? info.RangeLimit : args.Weapon.Range
    // Negative rangeLimit means unlimited fuel; only use weapon range when rangeLimit is exactly 0
    const limit = !WDist.equals(info.rangeLimit, WDist.Zero)
      ? info.rangeLimit
      : new WDist(weaponRange?.length ?? 0)
    this.rangeLimit = new WDist(applyPercentageModifiers(limit.length, info.rangeModifiers))

    this.minLaunchSpeed = info.minimumLaunchSpeed.length > -1 ? info.minimumLaunchSpeed.length : info.speed.length
    this.maxLaunchSpeed = info.maximumLaunchSpeed.length > -1 ? info.maximumLaunchSpeed.length : info.speed.length
    this.maxSpeed = info.speed.length
    this.minLaunchAngle = info.minimumLaunchAngle
    this.maxLaunchAngle = info.maximumLaunchAngle
    this.renderFacing = args.facing

    this.lockOn = args.random.next() % 100 <= info.lockOnProbability

    const inaccuracyLen = this.lockOn && info.lockOnInaccuracy.length > -1
      ? info.lockOnInaccuracy.length
      : info.inaccuracy.length
    if (inaccuracyLen > 0) {
      const maxOff = this._getProjectileInaccuracy(inaccuracyLen, info.inaccuracyType, args)
      const ax = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      const ay = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      this.offset = WVec.divide(new WVec(ax, ay, 0), 1024)
    } else {
      this.offset = WVec.Zero
    }

    this._determineLaunchSpeedAndAngle()

    this.velocity = new WVec(0, -this.speed, 0)
      .rotate(new WRot(WAngle.fromFacing(this.vFacing), WAngle.Zero, WAngle.Zero))
      .rotate(new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(this.hFacing)))

    if (info.contrailLength > 0) {
      const startColor: [number, number, number, number] = [
        info.contrailStartColor[0]!, info.contrailStartColor[1]!,
        info.contrailStartColor[2]!, info.contrailStartColorAlpha,
      ]
      const endColorVal = info.contrailEndColor ?? info.contrailStartColor
      const endColor: [number, number, number, number] = [
        endColorVal[0]!, endColorVal[1]!, endColorVal[2]!, info.contrailEndColorAlpha,
      ]
      this.contrail = new ContrailLogic(
        info.contrailLength, info.contrailDelay, info.contrailZOffset,
        info.contrailStartWidth, info.contrailEndWidth ?? info.contrailStartWidth,
        startColor, info.contrailStartColorUsePlayerColor,
        endColor, info.contrailEndColorUsePlayerColor,
      )
    } else {
      this.contrail = null
    }

    this.trailPalette = info.trailPalette
    if (info.trailUsePlayerPalette && args.sourceActor?.owner) {
      this.trailPalette += args.sourceActor.owner.playerName
    }

    this.shadowColor = [info.shadowColor[0]! / 255, info.shadowColor[1]! / 255, info.shadowColor[2]! / 255] as const
    this.shadowAlpha = info.shadowColor[3]! / 255

    this.state = MissileState.Freefall
    this.ticks = 0
    this.ticksToNextSmoke = info.trailInterval
    this.targetPassedBy = false
    this.allowPassBy = false
    this.distanceCovered = WDist.Zero
    this.tarVel = WVec.Zero
    this.predVel = WVec.Zero
  }

  private _determineLaunchSpeedAndAngle(): void {
    this.speed = this.maxLaunchSpeed
    this._loopRadius = loopRadius(this.speed, this.info.verticalRateOfTurn.facing)

    const tarDistVec = WPos.subtract(
      WPos.add(this.targetPosition, this.offset),
      this.pos,
    )
    const relTarHorDist = tarDistVec.horizontalLength

    const vDist = new WVec(-tarDistVec.Z, -relTarHorDist, 0)
    let vFacing = vDist.horizontalLengthSquared !== 0 ? vDist.yaw.facing : 0

    if (vFacing === -1) vFacing = 0

    const minFac = this.minLaunchAngle.angle >> 2
    const maxFac = this.maxLaunchAngle.angle >> 2
    this.vFacing = clamp(vFacing, minFac, maxFac)
  }

  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return
    this.ticks++

    if (this.ticks === this.info.homingActivationDelay + 1) {
      this.state = MissileState.Homing
      this.speed = this.velocity.length
      this._loopRadius = loopRadius(this.speed, this.info.verticalRateOfTurn.facing)
    }

    if (
      WDist.greaterThanOrEqual(this.rangeLimit, WDist.Zero) &&
      WDist.greaterThan(this.distanceCovered, this.rangeLimit)
    ) {
      this.state = MissileState.Freefall
      this.velocity = new WVec(0, -this.speed, 0)
        .rotate(new WRot(WAngle.fromFacing(this.vFacing), WAngle.Zero, WAngle.Zero))
        .rotate(new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(this.hFacing)))
    }

    let newTarPos = this.targetPosition
    if (this.args.guidedTarget.isValidFor(
      this.args.sourceActor as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef,
    ) && this.lockOn) {
      const w = this.args.weapon as unknown as Record<string, unknown>
      if (w.targetActorCenter) {
        newTarPos = this.args.guidedTarget.centerPosition
      } else {
        const posList = this.args.guidedTarget.positions as unknown as { closestToIgnoringPath?: (pos: WPos) => WPos } | null
        newTarPos = posList?.closestToIgnoringPath
          ? posList.closestToIgnoringPath(this.args.source)
          : this.args.guidedTarget.centerPosition
      }
      newTarPos = WPos.add(newTarPos, new WVec(0, 0, this.info.airburstAltitude.length))
    }

    const yaw1 = this.tarVel.horizontalLengthSquared !== 0 ? this.tarVel.yaw : WAngle.fromFacing(this.hFacing)
    this.tarVel = WPos.subtract(newTarPos, this.targetPosition)
    const yaw2 = this.tarVel.horizontalLengthSquared !== 0 ? this.tarVel.yaw : WAngle.fromFacing(this.hFacing)
    this.predVel = this.tarVel.rotate(WRot.fromYaw(WAngle.subtract(yaw2, yaw1)))
    this.targetPosition = newTarPos

    const tarDistVec = WPos.subtract(
      WPos.add(this.targetPosition, this.offset),
      this.pos,
    )
    const relTarDist = tarDistVec.length
    const relTarHorDist = tarDistVec.horizontalLength

    let move: WVec
    if (this.state === MissileState.Freefall) {
      move = this._freefallTick()
    } else {
      move = this._homingTick(tarDistVec, relTarHorDist)
    }

    this.renderFacing = new WVec(move.X, move.Y - move.Z, 0).yaw

    const lastPos = this.pos
    if (this.info.allowSnapping && this.state !== MissileState.Freefall && relTarDist < move.length) {
      this.pos = WPos.add(this.targetPosition, this.offset)
    } else {
      this.pos = WPos.add(this.pos, move)
    }

    let shouldExplode = false
    if (this.info.blockable && this._checkBlocking && this.args.sourceActor?.owner) {
      const blockedPos = this._checkBlocking(
        world, this.args.sourceActor.owner, lastPos, this.pos, this.info.width,
      )
      if (blockedPos !== null) {
        this.pos = blockedPos
        shouldExplode = true
      }
    }

    if (
      this.info.trailImage !== null && this.info.trailImage.length > 0 &&
      --this.ticksToNextSmoke < 0 &&
      (this.state !== MissileState.Freefall || this.info.trailWhenDeactivated)
    ) {
      void world
      this.ticksToNextSmoke = this.info.trailInterval
    }

    if (this.contrail) {
      this.contrail.update(this.pos)
    }

    this.distanceCovered = new WDist(this.distanceCovered.length + this.speed)

    shouldExplode ||=
      relTarDist < this.info.closeEnough.length ||
      (this.info.explodeWhenEmpty &&
        WDist.greaterThanOrEqual(this.rangeLimit, WDist.Zero) &&
        WDist.greaterThan(this.distanceCovered, this.rangeLimit))

    if (shouldExplode) {
      this._explode(world)
    }
  }

  private _freefallTick(): WVec {
    const halfGravity = WVec.divide(this.gravity, 2)
    const move = WVec.add(this.velocity, halfGravity)
    this.velocity = WVec.add(this.velocity, this.gravity)

    const velLen = this.velocity.length
    if (velLen > 0) {
      const velRatio = Math.trunc((this.maxSpeed * 1024) / velLen)
      if (velRatio < 1024) {
        this.velocity = WVec.divide(WVec.multiply(this.velocity, velRatio), 1024)
      }
    }
    return move
  }

  private _homingTick(tarDistVec: WVec, relTarHorDist: number): WVec {
    const velVec = WVec.add(tarDistVec, this.predVel)
    let desiredHFacing = velVec.horizontalLengthSquared !== 0 ? velVec.yaw.facing : this.hFacing

    const delta = normaliseFacing(this.hFacing - desiredHFacing)
    if (this.allowPassBy && delta > 64 && delta < 192) {
      desiredHFacing = (desiredHFacing + 128) & 0xFF
      this.targetPassedBy = true
    } else {
      this.targetPassedBy = false
    }

    const relTarHgt = tarDistVec.Z
    let desiredVFacing = this._homingInnerTick(relTarHorDist, relTarHgt)

    if (
      tarDistVec.horizontalLength <
      Math.trunc((this.speed * WAngle.fromFacing(this.vFacing).cos()) / 1024)
    ) {
      this.targetPassedBy = true
    }

    // Jamming stub — TODO-8.B.1-JAMMING
    if (!this.args.guidedTarget.isValidFor(
      this.args.sourceActor as unknown as import('../../OpenRA.Game/Traits/IActorRef.js').IActorRef,
    )) {
      desiredHFacing = this.hFacing
    }

    this.hFacing = tickFacing(this.hFacing, desiredHFacing, this.info.horizontalRateOfTurn.facing)
    this.vFacing = tickFacing(this.vFacing, desiredVFacing, this.info.verticalRateOfTurn.facing)

    const rawMove = new WVec(0, -1024 * this.speed, 0)
      .rotate(new WRot(WAngle.fromFacing(this.vFacing), WAngle.Zero, WAngle.Zero))
      .rotate(new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(this.hFacing)))
    return WVec.divide(rawMove, 1024)
  }

  private _homingInnerTick(relTarHorDist: number, relTarHgt: number): number {
    let desiredVFacing: number

    if (relTarHorDist <= 3 * this._loopRadius || this.state === MissileState.Hitting) {
      this.state = MissileState.Hitting

      if (!this.allowPassBy && !this.targetPassedBy) {
        const vDist = new WVec(-relTarHgt, -relTarHorDist, 0)
        desiredVFacing = vDist.horizontalLengthSquared !== 0 ? vDist.yaw.facing : this.vFacing
        if (desiredVFacing === -1) desiredVFacing = 0

        if (this.targetPassedBy) {
          desiredVFacing = clamp(
            desiredVFacing,
            -this.info.verticalRateOfTurn.facing,
            this.info.verticalRateOfTurn.facing,
          )
        }
      } else {
        const vDist = new WVec(
          -relTarHgt,
          this.targetPassedBy ? relTarHorDist : -relTarHorDist,
          0,
        )
        desiredVFacing = vDist.horizontalLengthSquared !== 0 ? vDist.yaw.facing : this.vFacing
        if (desiredVFacing < 0 && this.info.verticalRateOfTurn.facing < this.vFacing) {
          desiredVFacing = 0
        }
      }
    } else {
      const diffClfMslHgt = 0 - this.pos.Z
      const vDist = new WVec(
        -diffClfMslHgt - this.info.cruiseAltitude.length,
        -this.speed,
        0,
      )
      desiredVFacing = vDist.horizontalLengthSquared !== 0 ? vDist.yaw.facing : this.vFacing
      if (-diffClfMslHgt > this.info.cruiseAltitude.length) {
        desiredVFacing = -desiredVFacing
      }
      desiredVFacing = clamp(
        desiredVFacing,
        -this.info.verticalRateOfTurn.facing,
        this.info.verticalRateOfTurn.facing,
      )
    }

    return desiredVFacing
  }

  private _explode(world: GameWorldManager): void {
    world.addFrameEndTask(() => {
      world.removeEffect(this)
    })

    if (this.ticks <= this.info.arm) return

    const warheadArgs: WarheadArgsStub = {
      firedBy: this.args.sourceActor,
      facing: this.args.facing,
      impactOrientation: new WRot(
        WAngle.Zero,
        WAngle.fromFacing(this.vFacing),
        WAngle.fromFacing(this.hFacing),
      ),
      impactPosition: this.pos,
      weapon: this.args.weapon,
    }

    this.args.weapon.impact(Target.fromPos(this.pos), warheadArgs)
    this.isDestroyed = true
  }

  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }
  dispose(): void { this.isDestroyed = true; this.contrail?.dispose() }

  get palette(): string {
    if (this.info.palette && this.info.isPlayerPalette && this.args.sourceActor?.owner) {
      return this.info.palette + this.args.sourceActor.owner.playerName
    }
    return this.info.palette
  }

  private _getProjectileInaccuracy(
    inaccuracy: number,
    type: typeof InaccuracyType[keyof typeof InaccuracyType],
    args: ProjectileArgs,
  ): number {
    const range = WPos.subtract(args.passiveTarget, args.source).length
    switch (type) {
      case InaccuracyType.Maximum:
        return Math.min(inaccuracy, Math.trunc(range / Math.max(1, args.inaccuracySource.length)))
      case InaccuracyType.PerCellIncrement:
        return Math.max(0, Math.trunc(range / 1024)) * inaccuracy
      case InaccuracyType.Absolute: return inaccuracy
      default: return 0
    }
  }
}

export const MissileFactory = {
  create(
    info: MissileInfo,
    args: ProjectileArgs,
    checkBlocking?: BlockingActorsChecker | null,
  ): Missile {
    return new Missile(info, args, checkBlocking)
  },
}
