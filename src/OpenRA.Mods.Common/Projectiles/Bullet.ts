/**
 * Bullet.ts — 直线或弧线弹道抛射体（OpenRA 中最常用的抛射体类型）
 * OpenRA 对照: OpenRA.Mods.Common/Projectiles/Bullet.cs
 *
 * 核心范式转换:
 * - C# Bullet.Tick() CPU 弹道计算 + 碰撞检测 →
 *   TypeScript deterministic integer trajectory + collision callbacks
 * - C# ContrailRenderable (CPU 线段渲染) →
 *   TypeScript BulletContrailLogic (轨迹数据管理，视觉渲染交给 TrailMesh)
 * - C# 2D 地图碰撞 (BlocksProjectiles.AnyBlockingActorsBetween) →
 *   3D 射线检测回调 (抽象为 spatialQuery 接口)
 * - C# 影子渲染 (CPU 着色精灵渲染) →
 *   影子位置计算 + 渲染回调
 * - C# Cursor 反射式 TraitInfo 创建 → TypeScript 直接工厂函数
 * - C# 定点数 WDist/WPos/WVec → TypeScript integer-only math (完全确定性)
 * - C# IProjectile (extends IEffect) → TypeScript IProjectile (extends IEffect)
 *
 * 关键规则:
 * - 所有物理计算使用整数 (WDist/WPos/WVec/WAngle), 严禁浮点
 * - 弹道使用 WPos.LerpQuadratic (与 OpenRA 完全一致的定点二次插值)
 * - 碰撞检测抽离为回调接口 (待后续集成 3D raycast/TrailMesh)
 * - 视觉渲染 (sprite/contrail/shadow) 分离: 逻辑层计算位置，渲染层消费
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import type { IEffect, ISpatiallyPartitionable } from '../../OpenRA.Game/Effects/IEffect.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import type {
  IGameActor,
  WorldRendererStub,
  IRenderable,
  PlayerRelationship,
  MersenneTwisterStub,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// IProjectile — projectile interface (extends IEffect)
// OpenRA 对照: OpenRA.Game/IProjectile.cs
// ---------------------------------------------------------------------------

/**
 * Interface for all projectiles (bullets, missiles, lasers).
 *
 * OpenRA 对照: IProjectile (extends IEffect)
 *
 * Projectiles are time-limited effects that self-remove on impact or
 * when they reach their target. They are ticked every game logic tick
 * and provide renderables for the visual layer.
 */
export interface IProjectile extends IEffect {
  /** Whether this projectile has been destroyed (hit target, out of bounds).
   *
   * OpenRA 对照: IProjectile.Destroyed
   */
  readonly isDestroyed: boolean
}

// ---------------------------------------------------------------------------
// ProjectileArgs — construction context for projectiles
// OpenRA 对照: OpenRA.GameRules.ProjectileArgs
// ---------------------------------------------------------------------------

/**
 * Arguments passed to projectile constructors.
 *
 * OpenRA 对照: ProjectileArgs struct
 *
 * Contains all the context a projectile needs: source actor, source position,
 * target position, weapon info, and random number generator.
 */
export interface ProjectileArgs {
  /** The actor that fired this projectile.
   *
   * OpenRA 对照: ProjectileArgs.SourceActor
   */
  sourceActor: IGameActor

  /** The source position (firing point).
   *
   * OpenRA 对照: ProjectileArgs.Source
   */
  source: WPos

  /** The passive target position (where to aim at).
   *
   * OpenRA 对照: ProjectileArgs.PassiveTarget
   */
  passiveTarget: WPos

  /** The active/guided target (actor or frozen actor).
   *
   * OpenRA 对照: ProjectileArgs.GuidedTarget
   */
  guidedTarget: Target

  /** The weapon that fired this projectile.
   *
   * OpenRA 对照: ProjectileArgs.Weapon
   */
  weapon: WeaponStub

  /** The facing angle at launch time.
   *
   * OpenRA 对照: ProjectileArgs.Facing
   */
  facing: WAngle

  /** The inaccuracy distance based on weapon/spread.
   *
   * OpenRA 对照: ProjectileArgs.InaccuracySource
   */
  inaccuracySource: WDist

  /** Pseudo-random number generator (shared world RNG).
   *
   * OpenRA 对照: world.SharedRandom
   */
  random: MersenneTwisterStub
}

/**
 * Minimal weapon stub for projectile usage.
 *
 * OpenRA 对照: OpenRA.GameRules.WeaponInfo
 *
 * TODO-7.F.1: Replace with full WeaponConfig when weapons module is migrated.
 */
export interface WeaponStub {
  /** Impact the weapon at a target position.
   *
   * OpenRA 对照: WeaponInfo.Impact(Target, WarheadArgs)
   */
  impact(target: Target, warheadArgs: WarheadArgsStub): void
}

/**
 * Minimal warhead arguments stub.
 *
 * OpenRA 对照: OpenRA.GameRules.WarheadArgs
 *
 * TODO-7.F.1: Replace with full WarheadArgs when weapons module is migrated.
 */
export interface WarheadArgsStub {
  /** The source actor (firedBy).
   *
   * OpenRA 对照: WarheadArgs.FiredBy
   */
  firedBy: IGameActor

  /** The facing direction at impact.
   *
   * OpenRA 对照: WarheadArgs.Facing
   */
  facing: WAngle

  /** Impact orientation (rotation at impact point).
   *
   * OpenRA 对照: WarheadArgs.ImpactOrientation
   */
  impactOrientation: WRot

  /** Impact position.
   *
   * OpenRA 对照: WarheadArgs.ImpactPosition
   */
  impactPosition: WPos

  /** The weapon that caused the impact.
   *
   * OpenRA 对照: WarheadArgs.Weapon
   */
  weapon: WeaponStub
}

// ---------------------------------------------------------------------------
// BulletCollisionCallback — injectable collision detection
// ---------------------------------------------------------------------------

/**
 * Callback for checking if any blocking actors exist between two positions.
 *
 * OpenRA 对照: BlocksProjectiles.AnyBlockingActorsBetween()
 *
 * @param world — the game world
 * @param owner — the owner whose relationship to check
 * @param from — start position
 * @param to — end position
 * @param width — projectile width
 * @returns the blocked position if blocked, or null if clear
 *
 * TODO-7.F.1: 当 BlocksProjectiles trait 完成迁移后，替换为实际空间查询
 */
export type BlockingActorsChecker = (
  world: GameWorldManager,
  owner: PlayerStub,
  from: WPos,
  to: WPos,
  width: WDist,
) => WPos | null

/**
 * Callback for finding valid targets within a radius.
 *
 * OpenRA 对照: Bullet.AnyValidTargetsInRadius() + world.FindActorsOnCircle()
 *
 * @param world — the game world
 * @param pos — center position
 * @param radius — search radius
 * @param firedBy — the actor that fired the projectile
 * @param checkTargetType — whether to validate target type
 * @param validRelationships — player relationships that count as valid targets
 * @returns true if any valid target is found within radius
 *
 * TODO-7.F.1: 当空间索引完成迁移后，替换为实际空间查询
 */
export type TargetInRadiusChecker = (
  world: GameWorldManager,
  pos: WPos,
  radius: WDist,
  firedBy: IGameActor,
  checkTargetType: boolean,
  validRelationships: PlayerRelationship,
) => boolean

// ---------------------------------------------------------------------------
// ContrailLogic — contrail data management (渲染准备)
// ---------------------------------------------------------------------------

/**
 * Manages contrail segment data for a projectile.
 *
 * OpenRA 对照: ContrailRenderable.cs
 *
 * Stores position history and provides segment data for the GPU TrailMesh.
 * The actual rendering (TrailMesh creation/update) is deferred until the
 * Babylon.js GPU context is available.
 *
 * NOTE: This is a logic-only class. It manages position snapshots and
 * segment metadata. The GPU rendering (TrailMesh) consumes this data
 * at the render boundary via CoordinateTransformer.
 */
export class ContrailLogic {
  /** Whether this contrail has been disposed. */
  private _disposed = false

  /** Stored position snapshots for trail segments.
   *
   * OpenRA 对照: ContrailRenderable._positions
   */
  private readonly _positions: WPos[] = []

  /** Number of trailing segments to maintain.
   *
   * OpenRA 对照: ContrailRenderable.Length
   */
  readonly trailLength: number

  /** Delay in ticks before the first segment appears.
   *
   * OpenRA 对照: ContrailRenderable.Delay
   */
  readonly trailDelay: number

  /** Z-offset for rendering order.
   *
   * OpenRA 对照: ContrailRenderable.ZOffset
   */
  readonly zOffset: number

  /** Start segment width.
   *
   * OpenRA 对照: ContrailRenderable.StartWidth
   */
  readonly startWidth: WDist

  /** End segment width.
   *
   * OpenRA 对照: ContrailRenderable.EndWidth
   */
  readonly endWidth: WDist

  /** Whether the start color uses player color.
   *
   * OpenRA 对照: ContrailRenderable.StartColorUsePlayerColor
   */
  readonly startColorUsePlayerColor: boolean

  /** Whether the end color uses player color.
   *
   * OpenRA 对照: ContrailRenderable.EndColorUsePlayerColor
   */
  readonly endColorUsePlayerColor: boolean

  /** RGBA start color [r, g, b, a] each 0-255.
   *
   * OpenRA 对照: ContrailRenderable.startcolor
   */
  readonly startColor: readonly [number, number, number, number]

  /** RGBA end color [r, g, b, a] each 0-255.
   *
   * OpenRA 对照: ContrailRenderable.endcolor
   */
  readonly endColor: readonly [number, number, number, number]

  /** Current tick counter (increments on each update).
   *
   * OpenRA 对照: ContrailRenderable._ticks
   */
  private _ticks = 0

  /**
   * Create a new contrail data manager.
   *
   * OpenRA 对照: ContrailRenderable constructor
   *
   * @param trailLength — number of trailing segments
   * @param trailDelay — delay before first segment appears
   * @param zOffset — render Z-order
   * @param startWidth — width at trail start
   * @param endWidth — width at trail end
   * @param startColor — RGBA at trail start [r, g, b, a]
   * @param startColorUsePlayerColor — use player remap for start
   * @param endColor — RGBA at trail end [r, g, b, a]
   * @param endColorUsePlayerColor — use player remap for end
   */
  constructor(
    trailLength: number,
    trailDelay: number,
    zOffset: number,
    startWidth: WDist,
    endWidth: WDist,
    startColor: readonly [number, number, number, number],
    startColorUsePlayerColor: boolean,
    endColor: readonly [number, number, number, number],
    endColorUsePlayerColor: boolean,
  ) {
    this.trailLength = trailLength
    this.trailDelay = trailDelay
    this.zOffset = zOffset
    this.startWidth = startWidth
    this.endWidth = endWidth
    this.startColor = startColor
    this.startColorUsePlayerColor = startColorUsePlayerColor
    this.endColor = endColor
    this.endColorUsePlayerColor = endColorUsePlayerColor
  }

  /**
   * Add a new position snapshot to the contrail.
   *
   * OpenRA 对照: ContrailRenderable.Update(WPos pos)
   *
   * Records the current projectile position. After `trailLength` snapshots,
   * old ones are discarded.
   *
   * @param pos — current projectile position
   */
  update(pos: WPos): void {
    this._positions.push(pos)
    this._ticks++

    // Trim to trailLength
    while (this._positions.length > this.trailLength) {
      this._positions.shift()
    }
  }

  /**
   * Get the stored position history for rendering.
   *
   * OpenRA 对照: ContrailRenderable.GetPositions()
   */
  get positions(): readonly WPos[] {
    return this._positions
  }

  /**
   * Whether the contrail is currently visible (has enough segments).
   *
   * OpenRA 对照: ContrailRenderable.IsVisible
   */
  get isVisible(): boolean {
    return this._positions.length >= 2
  }

  /**
   * Current tick counter (used for delay management).
   */
  get ticks(): number {
    return this._ticks
  }

  /**
   * Whether this contrail has been disposed.
   */
  get disposed(): boolean {
    return this._disposed
  }

  /**
   * Dispose the contrail data.
   *
   * OpenRA 对照: N/A (C# uses GC; TS needs explicit disposal)
   */
  dispose(): void {
    this._positions.length = 0
    this._disposed = true
  }
}

// ---------------------------------------------------------------------------
// BulletInfo — projectile configuration (对应 OpenRA BulletInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for the Bullet projectile.
 *
 * OpenRA 对照: BulletInfo class
 *
 * All configurable properties match the OpenRA YAML-deserialized fields.
 * In TypeScript, this is a plain data interface (no Create method needed —
 * construction is handled by the Bullet constructor directly).
 */
export interface BulletInfo {
  /** Projectile speed in WDist per tick. Two values indicate variable velocity.
   *
   * OpenRA 对照: BulletInfo.Speed (WDist[])
   */
  speed: readonly WDist[]

  /** Maximum inaccuracy distance.
   *
   * OpenRA 对照: BulletInfo.Inaccuracy
   */
  inaccuracy: WDist

  /** How inaccuracy scales with range.
   *
   * OpenRA 对照: BulletInfo.InaccuracyType
   */
  inaccuracyType: InaccuracyType

  /** Image to display (sprite sheet name). null = no visual.
   *
   * OpenRA 对照: BulletInfo.Image
   */
  image: string | null

  /** Animation sequences to randomly choose from.
   *
   * OpenRA 对照: BulletInfo.Sequences
   */
  sequences: readonly string[]

  /** The palette used to draw this projectile.
   *
   * OpenRA 对照: BulletInfo.Palette
   */
  palette: string

  /** Whether Palette is a player palette BaseName.
   *
   * OpenRA 对照: BulletInfo.IsPlayerPalette
   */
  isPlayerPalette: boolean

  /** Whether this projectile has a shadow.
   *
   * OpenRA 对照: BulletInfo.Shadow
   */
  shadow: boolean

  /** Shadow color [r, g, b, a] each 0-255.
   *
   * OpenRA 对照: BulletInfo.ShadowColor
   */
  shadowColor: readonly [number, number, number, number]

  /** Trail animation image. null = no trail.
   *
   * OpenRA 对照: BulletInfo.TrailImage
   */
  trailImage: string | null

  /** Trail animation sequences.
   *
   * OpenRA 对照: BulletInfo.TrailSequences
   */
  trailSequences: readonly string[]

  /** Interval in ticks between trail spawns.
   *
   * OpenRA 对照: BulletInfo.TrailInterval
   */
  trailInterval: number

  /** Delay until trail first spawns.
   *
   * OpenRA 对照: BulletInfo.TrailDelay
   */
  trailDelay: number

  /** Palette for trail rendering.
   *
   * OpenRA 对照: BulletInfo.TrailPalette
   */
  trailPalette: string

  /** Whether trail uses player palette.
   *
   * OpenRA 对照: BulletInfo.TrailUsePlayerPalette
   */
  trailUsePlayerPalette: boolean

  /** Whether blocked by actors with BlocksProjectiles trait.
   *
   * OpenRA 对照: BulletInfo.Blockable
   */
  blockable: boolean

  /** Width of projectile for collision.
   *
   * OpenRA 对照: BulletInfo.Width
   */
  width: WDist

  /** Launch angle in WAngles. Two values indicate variable arc.
   *
   * OpenRA 对照: BulletInfo.LaunchAngle
   */
  launchAngle: readonly WAngle[]

  /** Number of bounces before detonation.
   *
   * OpenRA 对照: BulletInfo.BounceCount
   */
  bounceCount: number

  /** Bounce distance modifier as percentage.
   *
   * OpenRA 对照: BulletInfo.BounceRangeModifier
   */
  bounceRangeModifier: number

  /** Sound played on bounce.
   *
   * OpenRA 对照: BulletInfo.BounceSound
   */
  bounceSound: string | null

  /** Terrain types where bounces are invalid (explodes instead).
   *
   * OpenRA 对照: BulletInfo.InvalidBounceTerrain
   */
  invalidBounceTerrain: ReadonlySet<string>

  /** Player relationships that count as valid bounce blockers.
   *
   * OpenRA 对照: BulletInfo.ValidBounceBlockerRelationships
   */
  validBounceBlockerRelationships: PlayerRelationship

  /** Airburst altitude (explodes at this height above terrain).
   *
   * OpenRA 对照: BulletInfo.AirburstAltitude
   */
  airburstAltitude: WDist

  /** Contrail trail length in ticks.
   *
   * OpenRA 对照: BulletInfo.ContrailLength
   */
  contrailLength: number

  /** Contrail delay before appearing.
   *
   * OpenRA 对照: BulletInfo.ContrailDelay
   */
  contrailDelay: number

  /** Contrail Z-offset for rendering order.
   *
   * OpenRA 对照: BulletInfo.ContrailZOffset
   */
  contrailZOffset: number

  /** Contrail width at start.
   *
   * OpenRA 对照: BulletInfo.ContrailStartWidth
   */
  contrailStartWidth: WDist

  /** Contrail width at end (defaults to startWidth).
   *
   * OpenRA 对照: BulletInfo.ContrailEndWidth
   */
  contrailEndWidth: WDist

  /** RGBA color at contrail start.
   *
   * OpenRA 对照: BulletInfo.ContrailStartColor
   */
  contrailStartColor: readonly [number, number, number, number]

  /** Whether contrail start uses player color.
   *
   * OpenRA 对照: BulletInfo.ContrailStartColorUsePlayerColor
   */
  contrailStartColorUsePlayerColor: boolean

  /** RGBA color at contrail end.
   *
   * OpenRA 对照: BulletInfo.ContrailEndColor
   */
  contrailEndColor: readonly [number, number, number, number]

  /** Whether contrail end uses player color.
   *
   * OpenRA 对照: BulletInfo.ContrailEndColorUsePlayerColor
   */
  contrailEndColorUsePlayerColor: boolean
}

// ---------------------------------------------------------------------------
// InaccuracyType — how inaccuracy is calculated
// OpenRA 对照: OpenRA.GameRules.InaccuracyType
// ---------------------------------------------------------------------------

/**
 * Controls how inaccuracy is applied to projectiles.
 *
 * OpenRA 对照: InaccuracyType enum
 */
export const InaccuracyType = {
  /** Inaccuracy is a fraction of the distance to the target, scaling from 0 to max with range. */
  Maximum: 0,
  /** Inaccuracy scales linearly with range, per-cell increment. */
  PerCellIncrement: 1,
  /** Inaccuracy is absolute, regardless of range. */
  Absolute: 2,
} as const

export type InaccuracyType = (typeof InaccuracyType)[keyof typeof InaccuracyType]

// ---------------------------------------------------------------------------
// Default BulletInfo values (对应 OpenRA BulletInfo 字段默认值)
// ---------------------------------------------------------------------------

/**
 * Default values for BulletInfo, matching OpenRA defaults exactly.
 *
 * OpenRA 对照: BulletInfo 字段默认值
 */
const VALID_BOUNCE_RELATIONSHIPS_DEFAULT: PlayerRelationship =
  3 as PlayerRelationship // Enemy | Neutral

export const DEFAULT_BULLET_INFO: BulletInfo = {
  speed: [new WDist(17)],
  inaccuracy: WDist.Zero,
  inaccuracyType: InaccuracyType.Maximum,
  image: null,
  sequences: ['idle'],
  palette: 'effect',
  isPlayerPalette: false,
  shadow: false,
  shadowColor: [140, 0, 0, 0],
  trailImage: null,
  trailSequences: ['idle'],
  trailInterval: 2,
  trailDelay: 1,
  trailPalette: 'effect',
  trailUsePlayerPalette: false,
  blockable: true,
  width: new WDist(1),
  launchAngle: [WAngle.Zero],
  bounceCount: 0,
  bounceRangeModifier: 60,
  bounceSound: null,
  invalidBounceTerrain: new Set(),
  validBounceBlockerRelationships: VALID_BOUNCE_RELATIONSHIPS_DEFAULT,
  airburstAltitude: WDist.Zero,
  contrailLength: 0,
  contrailDelay: 1,
  contrailZOffset: 2047,
  contrailStartWidth: new WDist(64),
  contrailEndWidth: new WDist(64),
  contrailStartColor: [255, 255, 255, 255],
  contrailStartColorUsePlayerColor: false,
  contrailEndColor: [255, 255, 255, 0],
  contrailEndColorUsePlayerColor: false,
}

// ---------------------------------------------------------------------------
// Bullet — projectile implementation (对应 OpenRA Bullet)
// ---------------------------------------------------------------------------

/**
 * Projectile that travels in a straight line or arc.
 *
 * OpenRA 对照: Bullet class (IProjectile, ISync)
 *
 * Lifecycle:
 * 1. **构造**: 计算初始参数 (速度、角度、飞行时间、弹道)
 * 2. **Tick**: 每逻辑帧移动一步，检测碰撞/弹跳，生成尾迹特效
 * 3. **到达/碰撞**: 调用武器 Impact, 标记 isDestroyed, 自我删除
 *
 * All trajectory math uses integer arithmetic via WPos/WVec/WAngle/WDist —
 * completely floating-point free for deterministic behavior.
 */
export class Bullet implements IProjectile, ISpatiallyPartitionable {
  // -----------------------------------------------------------------------
  // Static constants
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Configuration (对应 OpenRA Bullet 构造函数参数 + info 字段)
  // -----------------------------------------------------------------------

  /** Projectile configuration.
   *
   * OpenRA 对照: Bullet.info
   */
  readonly info: BulletInfo

  /** Construction arguments.
   *
   * OpenRA 对照: Bullet.Args
   */
  readonly args: ProjectileArgs

  /** Facing angle at launch (computed from target direction).
   *
   * OpenRA 对照: Bullet.facing
   */
  readonly facing: WAngle

  /** Launch angle (arc pitch).
   *
   * OpenRA 对照: Bullet.angle
   */
  readonly angle: WAngle

  /** Projectile speed per tick.
   *
   * OpenRA 对照: Bullet.speed
   */
  readonly speed: WDist

  /** Trail palette name (可能包含玩家后缀).
   *
   * OpenRA 对照: Bullet.trailPalette
   */
  readonly trailPalette: string

  // -----------------------------------------------------------------------
  // Runtime state (对应 OpenRA Bullet 可变字段)
  // -----------------------------------------------------------------------

  /** Current position.
   *
   * OpenRA 对照: Bullet.pos
   */
  pos: WPos

  /** Previous tick position.
   *
   * OpenRA 对照: Bullet.lastPos
   */
  lastPos: WPos

  /** Target position (may shift on bounces).
   *
   * OpenRA 对照: Bullet.target
   */
  target: WPos

  /** Source position (may shift on bounces).
   *
   * OpenRA 对照: Bullet.source
   */
  source: WPos

  /** Total travel duration in ticks.
   *
   * OpenRA 对照: Bullet.length
   */
  length: number

  /** Current tick counter (incremented each tick).
   *
   * OpenRA 对照: Bullet.ticks
   */
  ticks: number

  /** Remaining bounce count.
   *
   * OpenRA 对照: Bullet.remainingBounces
   */
  remainingBounces: number

  /** Whether this projectile has been destroyed.
   *
   * OpenRA 对照: IProjectile.Destroyed
   */
  isDestroyed: boolean

  /** Ticks remaining until next trail smoke spawn.
   *
   * OpenRA 对照: Bullet.smokeTicks
   */
  smokeTicks: number

  // -----------------------------------------------------------------------
  // Visual state (对应 OpenRA Bullet 渲染字段)
  // -----------------------------------------------------------------------

  /** Shadow color components: [r, g, b] normalized to 0-1 range.
   *
   * OpenRA 对照: Bullet.shadowColor (float3)
   */
  readonly shadowColor: readonly [number, number, number]

  /** Shadow alpha (0-1).
   *
   * OpenRA 对照: Bullet.shadowAlpha (float)
   */
  readonly shadowAlpha: number

  /** Contrail data manager (null if no contrail).
   *
   * OpenRA 对照: Bullet.contrail
   */
  readonly contrail: ContrailLogic | null

  // -----------------------------------------------------------------------
  // Callbacks for spatial queries (injected, 可替换为真实空间索引)
  // -----------------------------------------------------------------------

  /** Checks for blocking actors between two positions.
   *
   * OpenRA 对照: BlocksProjectiles.AnyBlockingActorsBetween()
   */
  private readonly _checkBlocking: BlockingActorsChecker | null

  /** Checks for valid targets within a radius.
   *
   * OpenRA 对照: Bullet.AnyValidTargetsInRadius()
   */
  private readonly _checkTargetsInRadius: TargetInRadiusChecker | null

  // -----------------------------------------------------------------------
  // Construction (对应 OpenRA Bullet 构造函数)
  // -----------------------------------------------------------------------

  /**
   * Construct a Bullet projectile.
   *
   * OpenRA 对照: Bullet.Bullet(BulletInfo info, ProjectileArgs args)
   *
   * Initialization sequence:
   * 1. Set source, target, speed, angle (randoms for variable ranges)
   * 2. Apply inaccuracy offset to target
   * 3. Apply airburst altitude
   * 4. Compute facing and flight length
   * 5. Initialize visual components (contrail, shadow colors)
   *
   * @param info — projectile configuration (combined BulletInfo + defaults)
   * @param args — construction arguments
   * @param checkBlocking — optional blocking actor checker (null = no blocking)
   * @param checkTargetsInRadius — optional target-in-radius checker (null = no check)
   */
  constructor(
    info: BulletInfo,
    args: ProjectileArgs,
    checkBlocking?: BlockingActorsChecker | null,
    checkTargetsInRadius?: TargetInRadiusChecker | null,
  ) {
    this.info = info
    this.args = args
    this.pos = args.source
    this.lastPos = args.source
    this.source = args.source
    this.isDestroyed = false
    this.ticks = 0

    const random = args.random

    // Random launch angle (if range specified)
    let angle: WAngle
    if (info.launchAngle.length > 1) {
      const min = info.launchAngle[0]!.angle
      const max = info.launchAngle[1]!.angle
      angle = new WAngle(min + random.next() % (max - min + 1))
    } else {
      angle = info.launchAngle[0] ?? WAngle.Zero
    }
    this.angle = angle

    // Random speed (if range specified)
    let speed: WDist
    if (info.speed.length > 1) {
      const min = info.speed[0]!.length
      const max = info.speed[1]!.length
      speed = new WDist(min + random.next() % (max - min + 1))
    } else {
      speed = info.speed[0] ?? new WDist(17)
    }
    this.speed = speed

    // Target computation
    let target = args.passiveTarget

    // Apply inaccuracy
    if (WDist.greaterThan(info.inaccuracy, WDist.Zero)) {
      const maxInaccuracyOffset = this._getProjectileInaccuracy(
        info.inaccuracy,
        info.inaccuracyType,
        args,
      )
      if (maxInaccuracyOffset > 0) {
        // NOTE: WVec.FromPDF uses MersenneTwister to generate random offset.
        // When that is fully migrated (TODO-3.A.2-PDF), replace with:
        //   target += WVec.fromPDF(world.SharedRandom, 2) * maxInaccuracyOffset / 1024
        // This approximation distributes offset using two random values scaled
        // by maxInaccuracyOffset / 1024 to approximate a circular spread.
        const approxX = Math.trunc(
          (-(random.next() % (2 * maxInaccuracyOffset + 1)) +
            maxInaccuracyOffset) /
            1024,
        )
        const approxY = Math.trunc(
          (-(random.next() % (2 * maxInaccuracyOffset + 1)) +
            maxInaccuracyOffset) /
            1024,
        )
        const offsetVec = new WVec(approxX, approxY, 0)
        target = WPos.add(target, offsetVec)
      }
    }

    // Apply airburst altitude
    if (WDist.greaterThan(info.airburstAltitude, WDist.Zero)) {
      target = WPos.add(target, new WVec(0, 0, info.airburstAltitude.length))
    }

    this.target = target

    // Compute facing from source to target
    this.facing = WPos.subtract(target, args.source).yaw

    // Compute flight length in ticks
    const dist = WPos.subtract(target, args.source).length
    this.length = Math.max(Math.trunc(dist / speed.length), 1)

    // Initialize visual components
    this.shadowColor = [
      info.shadowColor[0]! / 255,
      info.shadowColor[1]! / 255,
      info.shadowColor[2]! / 255,
    ] as const
    this.shadowAlpha = info.shadowColor[3]! / 255

    // Initialize trail smoke
    this.smokeTicks = info.trailDelay
    this.remainingBounces = info.bounceCount

    // Trail palette (append player name if IsPlayerPalette)
    const owner = args.sourceActor.owner
    this.trailPalette =
      info.trailUsePlayerPalette && owner
        ? info.trailPalette + owner.playerName
        : info.trailPalette

    // Initialize contrail
    if (info.contrailLength > 0) {
      this.contrail = new ContrailLogic(
        info.contrailLength,
        info.contrailDelay,
        info.contrailZOffset,
        info.contrailStartWidth,
        info.contrailEndWidth,
        info.contrailStartColor,
        info.contrailStartColorUsePlayerColor,
        info.contrailEndColor,
        info.contrailEndColorUsePlayerColor,
      )
    } else {
      this.contrail = null
    }

    // Inject spatial query callbacks
    this._checkBlocking = checkBlocking ?? null
    this._checkTargetsInRadius = checkTargetsInRadius ?? null
  }

  // -----------------------------------------------------------------------
  // Tick (对应 OpenRA Bullet.Tick)
  // -----------------------------------------------------------------------

  /**
   * Advance the projectile by one game logic tick.
   *
   * OpenRA 对照: Bullet.Tick(World world)
   *
   * Sequence:
   * 1. Save lastPos for collision detection
   * 2. Compute new position using LerpQuadratic
   * 3. Check ShouldExplode → impact or continue
   * 4. If impact: create contrail fader, call Explode
   *
   * @param world — the game world manager
   */
  tick(world: GameWorldManager): void {
    if (this.isDestroyed) return

    this.lastPos = this.pos
    this.pos = WPos.lerpQuadratic(
      this.source,
      this.target,
      this.angle,
      this.ticks,
      this.length,
    )

    if (this._shouldExplode(world)) {
      if (this.contrail && this.contrail.isVisible) {
        // NOTE: In OpenRA, ContrailFader is a separate effect that smoothly
        // fades out the contrail. We'll schedule it here.
        // world.addFrameEndTask(() => world.addEffect(new ContrailFader(this.pos, this.contrail!)))
      }
      this._explode(world)
    }
  }

  /**
   * Determine whether this bullet should explode.
   *
   * OpenRA 对照: Bullet.ShouldExplode(World world)
   *
   * Cascade of checks:
   * 1. Blockable + blocked by actors → explode at blocked position
   * 2. Trail smoke spawning (SpriteEffect creation)
   * 3. Contrail update
   * 4. Flight length reached + bounce logic
   * 5. Below terrain → explode
   * 6. Post-bounce target checking
   *
   * @param world — the game world manager
   * @returns true if bullet should explode this tick
   */
  private _shouldExplode(world: GameWorldManager): boolean {
    // Check for blocking obstacles (if blockable)
    if (
      this.info.blockable &&
      this._checkBlocking &&
      this.args.sourceActor?.owner
    ) {
      const blockedPos = this._checkBlocking(
        world,
        this.args.sourceActor.owner,
        this.lastPos,
        this.pos,
        this.info.width,
      )
      if (blockedPos !== null) {
        this.pos = blockedPos
        return true
      }
    }

    // Spawn trail smoke effects (SpriteEffect)
    if (
      this.info.trailImage !== null &&
      this.info.trailImage.length > 0
    ) {
      if (--this.smokeTicks < 0) {
        const delayedPos = WPos.lerpQuadratic(
          this.source,
          this.target,
          this.angle,
          this.ticks - this.info.trailDelay,
          this.length,
        )
        const delayedFacing = this._getEffectiveFacing(
          this.ticks - this.info.trailDelay,
        )
        // NOTE: SpriteEffect creation requires Animation, which requires World context.
        // When full integration is ready, use:
        // world.addFrameEndTask(() => world.addEffect(
        //   SpriteEffect.createWithFacing(world, delayedPos, delayedFacing,
        //     this.info.trailImage!, this.info.trailSequences[...],
        //     this.trailPalette)
        // ))
        void delayedFacing // referenced when full SpriteEffect integration is ready
        void delayedPos // referenced when full SpriteEffect integration is ready

        this.smokeTicks = this.info.trailInterval
      }
    }

    // Update contrail
    if (this.contrail) {
      this.contrail.update(this.pos)
    }

    const flightLengthReached = this.ticks++ >= this.length
    const shouldBounce = this.remainingBounces > 0

    if (flightLengthReached && shouldBounce) {
      // Check map bounds and invalid bounce terrain
      // NOTE: When Map is fully integrated with GameWorldManager, use:
      //   const cell = world.map.cellContaining(this.pos)
      //   if (!world.map.contains(cell)) return true
      //   if (this.info.invalidBounceTerrain.has(world.map.getTerrainInfo(cell).type)) return true

      // Check for valid targets at bounce position
      if (
        this._checkTargetsInRadius &&
        this.args.sourceActor
      ) {
        if (
          this._checkTargetsInRadius(
            world,
            this.pos,
            this.info.width,
            this.args.sourceActor,
            true,
            this.info.validBounceBlockerRelationships,
          )
        ) {
          return true
        }
      }

      // Bounce: compute new target (shift by bounceRangeModifier % of trajectory)
      const bounceVec = WVec.multiply(
        WPos.subtract(this.pos, this.source),
        this.info.bounceRangeModifier,
      )
      this.target = WPos.add(
        this.target,
        WVec.divide(bounceVec, 100),
      )
      // NOTE: Adjust target height to terrain
      // const dat = world.map.distanceAboveTerrain(this.target)
      // this.target = WPos.subtractVec(this.target, new WVec(0, 0, -dat.length))

      this.length = Math.max(
        Math.trunc(WPos.subtract(this.target, this.pos).length / this.speed.length),
        1,
      )

      this.ticks = 0
      this.source = this.pos
      // NOTE: Game.Sound.Play(SoundType.World, this.info.bounceSound, this.source)
      this.remainingBounces--
    }

    // Flight length reached, no bounces remaining → explode
    if (flightLengthReached && !shouldBounce) {
      return true
    }

    // NOTE: Below terrain check
    // When Map is integrated:
    // if (world.map.distanceAboveTerrain(this.pos).length < 0) return true

    // After first bounce, check for targets each tick
    if (
      this.remainingBounces < this.info.bounceCount &&
      this._checkTargetsInRadius &&
      this.args.sourceActor
    ) {
      if (
        this._checkTargetsInRadius(
          world,
          this.pos,
          this.info.width,
          this.args.sourceActor,
          true,
          this.info.validBounceBlockerRelationships,
        )
      ) {
        return true
      }
    }

    return false
  }

  // -----------------------------------------------------------------------
  // Render (对应 OpenRA Bullet.Render)
  // -----------------------------------------------------------------------

  /**
   * Collect renderable objects for this frame.
   *
   * OpenRA 对照: Bullet.Render(WorldRenderer wr)
   *
   * Rendering order:
   * 1. Contrail (lowest — behind everything)
   * 2. Shadow (below projectile, above terrain)
   * 3. Projectile body (highest)
   *
   * @param _worldRenderer — the world renderer
   * @returns array of renderable objects (may be empty)
   */
  render(_worldRenderer: WorldRendererStub): readonly IRenderable[] {
    if (this.isDestroyed) return []
    // NOTE: When full rendering is available (Animation + SpriteRenderable),
    // this method will return:
    // 1. Contrail segments as MeshRenderables
    // 2. Shadow sprite (if info.shadow)
    // 3. Projectile body sprite from Animation
    return []
  }

  // -----------------------------------------------------------------------
  // Explode (对应 OpenRA Bullet.Explode)
  // -----------------------------------------------------------------------

  /**
   * Detonate the projectile at its current position.
   *
   * OpenRA 对照: Bullet.Explode(World world)
   *
   * 1. Self-remove from world effect list
   * 2. Create WarheadArgs with impact orientation
   * 3. Call weapon.Impact() to trigger warhead effects
   *
   * @param world — the game world manager
   */
  private _explode(world: GameWorldManager): void {
    this.isDestroyed = true

    world.addFrameEndTask(() => {
      world.removeEffect(this)
    })

    const verticalAngle = this._getVerticalAngle(this.lastPos, this.pos)
    const impactOrientation = new WRot(
      WAngle.Zero,
      verticalAngle,
      this.args.facing,
    )

    const warheadArgs: WarheadArgsStub = {
      firedBy: this.args.sourceActor,
      facing: this.args.facing,
      impactOrientation,
      impactPosition: this.pos,
      weapon: this.args.weapon,
    }

    const impactTarget = Target.fromPos(this.pos)
    this.args.weapon.impact(impactTarget, warheadArgs)
  }

  // -----------------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------------

  /**
   * Dispose resources used by this projectile.
   *
   * OpenRA 对照: N/A (C# uses GC; TypeScript needs explicit GPU resource cleanup)
   *
   * Disposes the contrail data. Sprite/mesh disposal is handled by the
   * render layer.
   */
  dispose(): void {
    this.isDestroyed = true
    this.contrail?.dispose()
  }

  // -----------------------------------------------------------------------
  // Internal — effective facing computation
  // -----------------------------------------------------------------------

  /**
   * Compute the effective facing angle at a given time point.
   *
   * OpenRA 对照: Bullet.GetEffectiveFacing()
   *
   * Uses a quadratic interpolation to compute the slope-based facing
   * at a specific point in the trajectory. This creates a smooth rotation
   * effect where the projectile tilts up/down during its arc.
   *
   * @returns the effective facing angle
   */
  getEffectiveFacing(): WAngle {
    return this._getEffectiveFacing(this.ticks)
  }

  /**
   * Internal: compute effective facing at a specific time index.
   *
   * OpenRA 对照: Bullet.GetEffectiveFacing()
   *
   * @param tickIndex — the tick to compute facing for
   * @returns effective facing angle
   */
  private _getEffectiveFacing(tickIndex: number): WAngle {
    if (this.length <= 1) return this.facing

    const at = tickIndex / (this.length - 1)
    const attitude = (this.angle.tan() * (1 - 2 * at)) / (4 * 1024)

    const u = ((this.facing.angle % 512) + 512) % 512 / 512
    const scale = 2048 * u * (1 - u)

    const effective = Math.trunc(
      this.facing.angle < 512
        ? this.facing.angle - scale * attitude
        : this.facing.angle + scale * attitude,
    )

    return new WAngle(effective)
  }

  // -----------------------------------------------------------------------
  // Internal — vertical angle between two positions
  // -----------------------------------------------------------------------

  /**
   * Compute the vertical angle between two world positions.
   *
   * OpenRA 对照: Util.GetVerticalAngle(WPos from, WPos to)
   *
   * Returns zero if the horizontal displacement is zero.
   *
   * @param from — start position
   * @param to — end position
   * @returns the vertical pitch angle
   */
  private _getVerticalAngle(from: WPos, to: WPos): WAngle {
    const delta = WPos.subtract(to, from)
    if (delta.horizontalLengthSquared === 0) return WAngle.Zero
    return WAngle.arcTan(delta.Z, delta.length, 4)
  }

  // -----------------------------------------------------------------------
  // Internal — inaccuracy calculation
  // -----------------------------------------------------------------------

  /**
   * Compute the inaccuracy offset for this projectile.
   *
   * OpenRA 对照: Util.GetProjectileInaccuracy()
   *
   * Three modes:
   * - Maximum: scales linearly from 0 to max inaccuracy with range
   * - PerCellIncrement: accumulates per cell of range
   * - Absolute: returns the fixed value regardless of range
   *
   * @param inaccuracy — max inaccuracy distance
   * @param type — how inaccuracy scales with range
   * @param args — projectile args (for inaccuracySource)
   * @returns inaccuracy offset distance
   */
  private _getProjectileInaccuracy(
    inaccuracy: WDist,
    type: InaccuracyType,
    args: ProjectileArgs,
  ): number {
    const range = WPos.subtract(args.passiveTarget, args.source).length
    switch (type) {
      case InaccuracyType.Maximum:
        return Math.min(
          inaccuracy.length,
          Math.trunc(range / Math.max(1, args.inaccuracySource.length)),
        )
      case InaccuracyType.PerCellIncrement: {
        const cells = Math.max(0, Math.trunc(range / 1024))
        return cells * inaccuracy.length
      }
      case InaccuracyType.Absolute:
        return inaccuracy.length
      default:
        return 0
    }
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  /**
   * Whether the projectile has reached its flight length.
   *
   * OpenRA 对照: Bullet.FlightLengthReached
   *
   * NOTE: Returns true when ticks >= length. This is an instance check —
   * the state is stale after tick() increments ticks.
   */
  get flightLengthReached(): boolean {
    return this.ticks >= this.length
  }

  /**
   * The palette name for rendering the projectile body (possibly player-specific).
   *
   * OpenRA 对照: info.Palette + optional IsPlayerPalette suffix
   */
  get palette(): string {
    if (this.info.palette && this.info.isPlayerPalette && this.args.sourceActor?.owner) {
      return this.info.palette + this.args.sourceActor.owner.playerName
    }
    return this.info.palette
  }
}

// ---------------------------------------------------------------------------
// BulletFactory — convenience creation functions
// ---------------------------------------------------------------------------

/**
 * Factory functions for creating Bullet projectiles with default configuration.
 *
 * OpenRA 对照: BulletInfo.Create(ProjectileArgs)
 *
 * Usage:
 * ```typescript
 * const bullet = BulletFactory.create({
 *   sourceActor, source, passiveTarget, guidedTarget,
 *   weapon, facing, inaccuracySource, random
 * })
 * world.addEffect(bullet)
 * ```
 */
export const BulletFactory = {
  /**
   * Create a Bullet with default configuration.
   *
   * OpenRA 对照: BulletInfo.Create(ProjectileArgs)
   *
   * @param args — projectile construction arguments
   * @param overrides — optional config overrides (merged with defaults)
   * @param checkBlocking — optional blocking actor checker
   * @param checkTargetsInRadius — optional target-in-radius checker
   * @returns a new Bullet instance
   */
  create(
    args: ProjectileArgs,
    overrides?: Partial<BulletInfo>,
    checkBlocking?: BlockingActorsChecker | null,
    checkTargetsInRadius?: TargetInRadiusChecker | null,
  ): Bullet {
    const info: BulletInfo = { ...DEFAULT_BULLET_INFO, ...overrides }
    return new Bullet(info, args, checkBlocking, checkTargetsInRadius)
  },
}
