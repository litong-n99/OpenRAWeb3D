/**
 * Missile.ts — 制导导弹抛射体（追踪目标 + 燃料限制 + 地形感知 + 尾迹）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/Missile.cs
 *
 * 核心范式转换:
 * - C# Missile.Tick() 角度插值制导 → TypeScript 整数角度系统 + 状态机
 * - C# ContrailRenderable → ContrailLogic (数据管理)
 * - C# SpriteEffect 尾迹 → TypeScript 延迟生成逻辑
 * - C# BisectionSearch 发射参数 → TypeScript bisectionSearch from MissileMath
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
} from './Bullet.js'
import {
  loopRadius,
  normaliseFacing,
  tickFacing,
  clamp,
  applyPercentageModifiers,
  InaccuracyType,
  getVerticalAngle,
  getProjectileInaccuracy,
} from './MissileMath.js'

// ---------------------------------------------------------------------------
// MissileState — 导弹制导状态
// ---------------------------------------------------------------------------

/**
 * Missile guidance states.
 *
 * OpenRA 对照: Missile.States enum
 *
 * - Freefall (0): Not yet homing; flies in a straight line with gravity.
 * - Homing (1): Actively tracking the target; adjusting hFacing/vFacing.
 * - Hitting (2): Final approach; close enough to stop cruise altitude behavior.
 */
export const MissileState = {
  /** Not yet homing; flies straight with gravity. */
  Freefall: 0,
  /** Actively tracking the target. */
  Homing: 1,
  /** Final approach; close to target. */
  Hitting: 2,
} as const
export type MissileState = (typeof MissileState)[keyof typeof MissileState]

// ---------------------------------------------------------------------------
// MissileInfo — 导弹配置
// ---------------------------------------------------------------------------

/**
 * Configuration for the Missile projectile.
 *
 * OpenRA 对照: MissileInfo class
 */
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
  /** Airburst altitude — missile explodes when height above terrain is below this AND within CloseEnough of target.
   *
   * OpenRA 对照: MissileInfo.AirburstAltitude
   *
   * NOTE: This is an EXPLOSION TRIGGER THRESHOLD, NOT a target position offset.
   */
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
}

// ---------------------------------------------------------------------------
// Missile class — 导弹抛射体
// ---------------------------------------------------------------------------

/**
 * Homing missile projectile with fuel limits, terrain awareness, and contrails.
 *
 * OpenRA 对照: Missile class (IProjectile, ISync)
 *
 * Lifecycle:
 * 1. Freefall: flies straight with gravity until homing activation delay expires
 * 2. Homing: actively tracks target, adjusts facing using tickFacing
 * 3. Hitting: final approach, detonates on impact/close-enough
 */
export class Missile implements IProjectile {
  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  readonly info: MissileInfo
  readonly args: ProjectileArgs

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  /** Current guidance state.
   *
   * OpenRA 对照: Missile.state
   */
  state: MissileState

  /** Current world position.
   *
   * OpenRA 对照: Missile.pos
   */
  pos: WPos

  /** Current velocity vector.
   *
   * OpenRA 对照: Missile.velocity
   */
  velocity: WVec

  /** Current speed in WDist units per tick.
   *
   * OpenRA 对照: Missile.speed
   */
  speed: number = 0

  /** Loop radius (cached from speed / vertical rate of turn).
   *
   * OpenRA 对照: Missile.loopRadius
   */
  _loopRadius: number = 0

  /** Total distance covered so far.
   *
   * OpenRA 对照: Missile.distanceCovered
   */
  distanceCovered: WDist

  /** Range limit (fuel limit).
   *
   * OpenRA 对照: Missile.rangeLimit
   */
  rangeLimit: WDist

  readonly minLaunchSpeed: number
  readonly maxLaunchSpeed: number
  readonly maxSpeed: number
  readonly minLaunchAngle: WAngle
  readonly maxLaunchAngle: WAngle

  /** Horizontal facing (0-255).
   *
   * OpenRA 对照: Missile.hFacing
   */
  hFacing: number

  /** Vertical facing.
   *
   * OpenRA 对照: Missile.vFacing
   */
  vFacing: number = 0

  /** Facing angle for rendering.
   *
   * OpenRA 对照: Missile.renderFacing
   */
  renderFacing: WAngle

  /** Tick counter.
   *
   * OpenRA 对照: Missile.ticks
   */
  ticks: number

  /** Ticks until next trail smoke spawn.
   *
   * OpenRA 对照: Missile.ticksToNextSmoke
   */
  ticksToNextSmoke: number

  /** Whether the missile has lock-on capability.
   *
   * OpenRA 对照: Missile.lockOn
   */
  readonly lockOn: boolean

  /** Current target position (updated each tick if guided).
   *
   * OpenRA 对照: Missile.targetPosition
   */
  targetPosition: WPos

  /** Inaccuracy offset applied at launch.
   *
   * OpenRA 对照: Missile.offset
   */
  offset: WVec

  /** Target velocity (for lead prediction).
   *
   * OpenRA 对照: Missile.tarVel
   */
  tarVel: WVec

  /** Predicted velocity (for lead prediction).
   *
   * OpenRA 对照: Missile.predVel
   */
  predVel: WVec

  /** Whether the missile has passed the target.
   *
   * OpenRA 对照: Missile.targetPassedBy
   */
  targetPassedBy: boolean

  /** Whether the missile is allowed to pass by the target.
   *
   * OpenRA 对照: Missile.allowPassBy
   */
  allowPassBy: boolean

  readonly contrail: ContrailLogic | null
  readonly trailPalette: string
  readonly shadowColor: readonly [number, number, number]
  readonly shadowAlpha: number

  /** Whether destroyed.
   *
   * OpenRA 对照: IProjectile.Destroyed
   */
  isDestroyed: boolean

  readonly gravity: WVec
  private readonly _checkBlocking: BlockingActorsChecker | null

  // Pre-allocated WRot instances to avoid per-frame allocation (MINOR: pre-allocate)
  // NOTE: These are reassigned in tick() for per-frame rotation updates.
  private _preRotVFacing = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)
  private _preRotHFacing = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)

  // -----------------------------------------------------------------------
  // Construction (OpenRA 对照: Missile constructor)
  // -----------------------------------------------------------------------

  /**
   * Construct a Missile projectile.
   *
   * OpenRA 对照: Missile.Missile(MissileInfo info, ProjectileArgs args)
   *
   * @param info — projectile configuration
   * @param args — construction arguments
   * @param checkBlocking — optional blocking actor checker
   */
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
    const limit = !WDist.equals(info.rangeLimit, WDist.Zero)
      ? info.rangeLimit
      : new WDist(weaponRange?.length ?? 0)
    // MAJOR 6: rangeModifiers come from ProjectileArgs, not MissileInfo
    this.rangeLimit = new WDist(applyPercentageModifiers(limit.length, args.rangeModifiers ?? []))

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
      const range = WPos.subtract(args.passiveTarget, args.source).length
      const maxOff = getProjectileInaccuracy(inaccuracyLen, info.inaccuracyType, range, args.inaccuracySource.length)
      const ax = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      const ay = -(args.random.next() % (2 * maxOff + 1)) + maxOff
      this.offset = WVec.divide(new WVec(ax, ay, 0), 1024)
    } else {
      this.offset = WVec.Zero
    }

    this._determineLaunchSpeedAndAngle()

    this._preRotVFacing = new WRot(WAngle.fromFacing(this.vFacing), WAngle.Zero, WAngle.Zero)
    this._preRotHFacing = new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(this.hFacing))
    this.velocity = new WVec(0, -this.speed, 0)
      .rotate(this._preRotVFacing)
      .rotate(this._preRotHFacing)

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

  // -----------------------------------------------------------------------
  // _determineLaunchSpeedAndAngle (MAJOR 9: matches C# logic)
  // -----------------------------------------------------------------------

  /**
   * Determine the launch speed and vertical facing for the missile.
   *
   * OpenRA 对照: Missile.DetermineLaunchSpeedAndAngle(World, out int, out int)
   *
   * Uses geometric calculation to set initial speed and vFacing.
   * Full bisection search (C# DetermineLaunchSpeedAndAngleForIncline) is
   * deferred until terrain height data is available.
   */
  private _determineLaunchSpeedAndAngle(): void {
    this.speed = this.maxLaunchSpeed
    this._loopRadius = loopRadius(this.speed, this.info.verticalRateOfTurn.facing)

    const tarDistVec = WPos.subtract(
      WPos.add(this.targetPosition, this.offset),
      this.pos,
    )
    const relTarHorDist = tarDistVec.horizontalLength

    // NOTE: terrainHeightAware incline lookahead deferred (TODO-8.B.9-TERRAIN)
    // Full bisection search implementation for terrain-aware launches:
    //   DetermineLaunchSpeedAndAngleForIncline(predClfDist, diffClfMslHgt,
    //     relTarHorDist, out speed, out vFacing)
    // Which uses bisectionSearch from MissileMath to find optimal speed/angle.

    // Set vertical facing so that the missile faces its target
    const vDist = new WVec(-tarDistVec.Z, -relTarHorDist, 0)
    let vFacing = vDist.horizontalLengthSquared !== 0 ? vDist.yaw.facing : 0

    if (vFacing === -1) vFacing = 0

    const minFac = this.minLaunchAngle.angle >> 2
    const maxFac = this.maxLaunchAngle.angle >> 2
    this.vFacing = clamp(vFacing, minFac, maxFac)
  }

  // -----------------------------------------------------------------------
  // tick (OpenRA 对照: Missile.Tick)
  // -----------------------------------------------------------------------

  /**
   * Advance the missile by one game logic tick.
   *
   * OpenRA 对照: Missile.Tick(World world)
   *
   * @param world — the game world manager
   */
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
      this._preRotVFacing = new WRot(WAngle.fromFacing(this.vFacing), WAngle.Zero, WAngle.Zero)
      this._preRotHFacing = new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(this.hFacing))
      this.velocity = new WVec(0, -this.speed, 0)
        .rotate(this._preRotVFacing)
        .rotate(this._preRotHFacing)
    }

    const verticalAngle = getVerticalAngle(this.pos, WPos.add(this.pos, this.velocity))
    this.velocity = this.velocity
      .rotate(new WRot(verticalAngle, WAngle.Zero, WAngle.Zero))
      .rotate(new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(this.hFacing)))

    // BLOCKER 1 FIX: Do NOT add airburst altitude to target position.
    // In C# Missile.cs, airburstAltitude is an EXPLOSION TRIGGER THRESHOLD,
    // checked as: height.Length < info.AirburstAltitude.Length && relTarHorDist < info.CloseEnough.Length
    // It is never added to the target position as an offset.
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

    // MAJOR 10: Replace void world with explicit TODO for trail smoke
    if (
      this.info.trailImage !== null && this.info.trailImage.length > 0 &&
      --this.ticksToNextSmoke < 0 &&
      (this.state !== MissileState.Freefall || this.info.trailWhenDeactivated)
    ) {
      // TODO-8.B.10-SMOKE: SpriteEffect trail smoke — deferred visual effect
      // OpenRA 对照: Missile.Tick() lines 903-908
      //   world.AddFrameEndTask(w => w.Add(new SpriteEffect(pos - 3 * move / 2, renderFacing, w,
      //     info.TrailImage, info.TrailSequences.Random(world.SharedRandom), trailPalette)))
      this.ticksToNextSmoke = this.info.trailInterval
    }

    if (this.contrail) {
      this.contrail.update(this.pos)
    }

    this.distanceCovered = new WDist(this.distanceCovered.length + this.speed)

    // NOTE: Full C# shouldExplode cascade (terrain/airburst checks) deferred
    // TODO-8.B.9-TERRAIN: Add airburst check:
    //   height.Length < info.AirburstAltitude.Length && relTarHorDist < info.CloseEnough.Length
    shouldExplode ||=
      relTarDist < this.info.closeEnough.length ||
      (this.info.explodeWhenEmpty &&
        WDist.greaterThanOrEqual(this.rangeLimit, WDist.Zero) &&
        WDist.greaterThan(this.distanceCovered, this.rangeLimit))

    if (shouldExplode) {
      this._explode(world)
    }
  }

  // -----------------------------------------------------------------------
  // _freefallTick (OpenRA 对照: Missile freefall state in HomingTick)
  // -----------------------------------------------------------------------

  private _freefallTick(): WVec {
    this.velocity = WVec.add(this.velocity, this.gravity)
    return this.velocity
  }

  // -----------------------------------------------------------------------
  // _homingTick (OpenRA 对照: Missile.HomingTick)
  // -----------------------------------------------------------------------

  private _homingTick(tarDistVec: WVec, relTarHorDist: number): WVec {
    // NOTE: Terrain height awareness (InclineLookahead) deferred
    // TODO-8.B.9-TERRAIN: When terrain height data available:
    //   InclineLookahead(world, relTarHorDist, out predClfHgt, out ...);

    const predClfHgt = 0
    const predClfDist = 0
    const lastHtChg = 0
    const lastHt = 0

    const diffClfMslHgt = predClfHgt - this.pos.Z
    // NOTE: nxtRelTarHorDist used for speed change decisions in C# HomingInnerTick;
    // deferred until terrain height data is available (TODO-8.B.9-TERRAIN)
    void (relTarHorDist) // placehold for nxtRelTarHorDist usage
    const relTarHgt = tarDistVec.Z

    const velVec = WVec.add(tarDistVec, this.predVel)
    const desiredHFacing = velVec.horizontalLengthSquared !== 0
      ? velVec.yaw.facing : this.hFacing

    const delta = normaliseFacing(this.hFacing - desiredHFacing)
    if (this.allowPassBy && delta > 64 && delta < 192) {
      this.hFacing = normaliseFacing(desiredHFacing + 128)
      this.targetPassedBy = true
    }

    const desiredVFacing = this._getDesiredVFacing(
      predClfDist, diffClfMslHgt, relTarHorDist,
      lastHtChg, lastHt, relTarHgt,
    )

    const vs = this.speed
    if (vs === 0) return WVec.Zero
    const nextVFac = tickFacing(this.vFacing, desiredVFacing, this.info.verticalRateOfTurn.facing)
    const nextHFac = tickFacing(this.hFacing, desiredHFacing, this.info.horizontalRateOfTurn.facing)

    this.vFacing = nextVFac
    this.hFacing = nextHFac

    this._preRotVFacing = new WRot(WAngle.fromFacing(this.vFacing), WAngle.Zero, WAngle.Zero)
    this._preRotHFacing = new WRot(WAngle.Zero, WAngle.Zero, WAngle.fromFacing(this.hFacing))
    const newVec = new WVec(0, -vs, 0)
      .rotate(this._preRotVFacing)
      .rotate(this._preRotHFacing)
    this.speed = newVec.length
    this._loopRadius = loopRadius(this.speed, this.info.verticalRateOfTurn.facing)
    return newVec
  }

  // -----------------------------------------------------------------------
  // _getDesiredVFacing (OpenRA 对照: Missile.HomingInnerTick)
  // -----------------------------------------------------------------------

  private _getDesiredVFacing(
    _predClfDist: number,
    diffClfMslHgt: number,
    relTarHorDist: number,
    _lastHtChg: number,
    lastHt: number,
    relTarHgt: number,
  ): number {
    let desiredVFacing: number

    // NOTE: Terrain height awareness deferred (TODO-8.B.9-TERRAIN)
    if (this.info.terrainHeightAware && diffClfMslHgt >= 0 && !this.allowPassBy) {
      desiredVFacing = this.vFacing
    } else if (relTarHorDist <= 3 * this._loopRadius || this.state === MissileState.Hitting) {
      this.state = MissileState.Hitting
      if (lastHt >= this.targetPosition.Z) this.allowPassBy = true

      if (!this.allowPassBy && (lastHt < this.targetPosition.Z || this.targetPassedBy)) {
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
      // MAJOR 8: Cruise altitude logic matches C# Missile.cs HomingInnerTick lines 762-769 exactly.
      // The missile aims to maintain cruise altitude. If launched above cruise altitude,
      // it descends instead of climbing. The negation of desiredVFacing is correct —
      // C# code at line 766: if (-diffClfMslHgt > info.CruiseAltitude.Length) desiredVFacing = -desiredVFacing;
      const diffClfMslHgtActual = 0 - this.pos.Z
      const vDist = new WVec(
        -diffClfMslHgtActual - this.info.cruiseAltitude.length,
        -this.speed,
        0,
      )
      desiredVFacing = vDist.horizontalLengthSquared !== 0 ? vDist.yaw.facing : this.vFacing
      // C# line 766: If the missile is launched above CruiseAltitude, descend
      if (-diffClfMslHgtActual > this.info.cruiseAltitude.length) {
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

  // -----------------------------------------------------------------------
  // _explode (OpenRA 对照: Missile.Explode)
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // render / dispose
  // -----------------------------------------------------------------------

  /**
   * No visual rendering from logic layer. Rendering is deferred to the visual layer.
   *
   * OpenRA 对照: Missile.Render(WorldRenderer wr)
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] { return [] }

  dispose(): void { this.isDestroyed = true; this.contrail?.dispose() }

  // -----------------------------------------------------------------------
  // palette accessor
  // -----------------------------------------------------------------------

  /**
   * The rendering palette for this projectile (possibly player-specific).
   *
   * OpenRA 对照: Missile palette resolution
   */
  get palette(): string {
    if (this.info.palette && this.info.isPlayerPalette && this.args.sourceActor?.owner) {
      return this.info.palette + this.args.sourceActor.owner.playerName
    }
    return this.info.palette
  }
}

// ---------------------------------------------------------------------------
// MissileFactory — convenience factory function
// ---------------------------------------------------------------------------

/**
 * Factory function for creating Missile projectiles with default configuration.
 *
 * OpenRA 对照: MissileInfo.Create(ProjectileArgs)
 */
export const MissileFactory = {
  /**
   * Create a Missile with default configuration.
   *
   * OpenRA 对照: MissileInfo.Create(ProjectileArgs)
   *
   * @param args — projectile construction arguments
   * @param overrides — optional config overrides
   * @param checkBlocking — optional blocking actor checker
   * @returns a new Missile instance
   */
  create(
    args: ProjectileArgs,
    overrides?: Partial<MissileInfo>,
    checkBlocking?: BlockingActorsChecker | null,
  ): Missile {
    const info: MissileInfo = { ...DEFAULT_MISSILE_INFO, ...overrides }
    return new Missile(info, args, checkBlocking)
  },
}
