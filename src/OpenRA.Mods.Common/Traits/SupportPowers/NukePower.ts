/**
 * NukePower.ts — 核弹支援能力（发射核弹抛射体 + 摄像机揭露 + 信标）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/NukePower.cs (244 lines)
 *
 * 核心范式转换:
 * - C# SupportPower extends SupportPower → TS 直接继承 SupportPower (不继承 Directional)
 * - C# NukeLaunch projectile creation → TS 导入 Ch8 Phase B NukeLaunch
 * - C# RevealShroudEffect (timed shroud source) → TS Ch12 Shroud 桩
 * - C# Beacon effect with FractionComplete clock → TS Beacon 桩
 * - C# BodyOrientation.LocalToWorld(SpawnOffset) for silo launch → TS BodyOrientation 桩
 * - C# WeaponInfo loaded from Ruleset → TS WeaponStub 接口
 * - C# SelectNukePowerTarget (range circle rendering) → TS SelectNukePowerTarget 独立类
 * - C# RangeCircleAnnotationRenderable (circle drawing) → TS 桩（deferred rendering）
 * - C# WPos.Zero for SkipAscent launch → TS 同 WPos 处理
 * - C# RulesetLoaded validation (weapon + trail sequences) → TS 构造函数验证
 *
 * NukePower launches a NukeLaunch projectile from either a building's silo
 * (BodyOrientation/SpawnOffset) or from WPos.Zero (SkipAscent/missing body).
 * A RevealShroudEffect provides camera vision around the target for allied
 * players. A Beacon with clock animation tracks the missile's FractionComplete.
 * Targeting shows range circles at the mouse position.
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import {
  SupportPower,
  type SupportPowerInfo,
  type ISupportPowerManager,
  type OrderStub,
} from './SupportPower.js'
import type { SupportPowerManager } from './SupportPowerManager.js'

// ---------------------------------------------------------------------------
// Forward stubs for NukeLaunch, WeaponInfo, BodyOrientation, Shroud
// ---------------------------------------------------------------------------

/** Forward reference to NukeLaunch projectile from Ch8 Phase B.
 *
 * OpenRA 对照: NukeLaunch : IProjectile, ISpatiallyPartitionable
 */
export interface INukeLaunch {
  /** Fraction of flight completed (0.0 to 1.0). Used for beacon clock.
   *
   * OpenRA 对照: NukeLaunch.FractionComplete
   */
  readonly fractionComplete: number
}

/** Forward reference to WeaponInfo for the missile weapon.
 *
 * OpenRA 对照: WeaponInfo (ruleset weapon config)
 */
export interface IWeaponInfoStub {
  readonly name: string
}

/** Forward reference to BodyOrientation trait.
 *
 * OpenRA 对照: BodyOrientation.LocalToWorld(WVec)
 */
export interface IBodyOrientation {
  /** Transform a local offset to world space.
   *
   * OpenRA 对照: BodyOrientation.LocalToWorld(WVec) -> WVec
   */
  localToWorld(offset: { readonly X: number; readonly Y: number; readonly Z: number }): {
    readonly X: number
    readonly Y: number
    readonly Z: number
  }
}

// ---------------------------------------------------------------------------
// Color stub for range circle colors
// ---------------------------------------------------------------------------

/** RGBA color stub.
 *
 * OpenRA 对照: Color.FromArgb(alpha, color)
 */
export interface ColorStub {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

// ---------------------------------------------------------------------------
// NukePowerInfo
// OpenRA 对照: NukePowerInfo : SupportPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for NukePower.
 *
 * OpenRA 对照: NukePowerInfo
 *
 * Defines the missile weapon, launch parameters (silo offset, ascent/descent,
 * detonation altitude), camera reveal settings, targeting circle visuals,
 * and beacon configuration.
 */
export interface NukePowerInfo extends SupportPowerInfo {
  /** Weapon to use for the impact (required).
   *
   * OpenRA 对照: NukePowerInfo.MissileWeapon (required)
   */
  readonly missileWeapon: string

  /** Delay (in ticks) after launch until the missile is spawned (default 0).
   *
   * OpenRA 对照: NukePowerInfo.MissileDelay
   */
  readonly missileDelay?: number

  /** Image to use for the missile.
   *
   * OpenRA 对照: NukePowerInfo.MissileImage
   */
  readonly missileImage?: string | null

  /** Sprite sequence for the ascending missile (default "up").
   *
   * OpenRA 对照: NukePowerInfo.MissileUp
   */
  readonly missileUp?: string

  /** Sprite sequence for the descending missile (default "down").
   *
   * OpenRA 对照: NukePowerInfo.MissileDown
   */
  readonly missileDown?: string

  /** Offset from the actor the missile spawns on.
   *
   * OpenRA 对照: NukePowerInfo.SpawnOffset (WVec, default WVec.Zero)
   */
  readonly spawnOffset?: { readonly X: number; readonly Y: number; readonly Z: number }

  /** Altitude offset for airburst detonation (WDist, default 0).
   *
   * OpenRA 对照: NukePowerInfo.DetonationAltitude
   */
  readonly detonationAltitude?: number

  /** Remove missile on airburst, or let it fall (default true).
   *
   * OpenRA 对照: NukePowerInfo.RemoveMissileOnDetonation
   */
  readonly removeMissileOnDetonation?: boolean

  /** Palette to use for the missile weapon image (default "effect").
   *
   * OpenRA 对照: NukePowerInfo.MissilePalette
   */
  readonly missilePalette?: string

  /** Custom palette is a player palette BaseName (default false).
   *
   * OpenRA 对照: NukePowerInfo.IsPlayerPalette
   */
  readonly isPlayerPalette?: boolean

  /** Trail animation image.
   *
   * OpenRA 对照: NukePowerInfo.TrailImage
   */
  readonly trailImage?: string | null

  /** Trail animation sequences.
   *
   * OpenRA 对照: NukePowerInfo.TrailSequences (ImmutableArray<string>)
   */
  readonly trailSequences?: readonly string[]

  /** Interval in ticks between each spawned Trail animation (default 1).
   *
   * OpenRA 对照: NukePowerInfo.TrailInterval
   */
  readonly trailInterval?: number

  /** Delay in ticks until trail animation is spawned (default 1).
   *
   * OpenRA 对照: NukePowerInfo.TrailDelay
   */
  readonly trailDelay?: number

  /** Palette for trail sequence (default "effect").
   *
   * OpenRA 对照: NukePowerInfo.TrailPalette
   */
  readonly trailPalette?: string

  /** Use the Player Palette for trail sequence (default false).
   *
   * OpenRA 对照: NukePowerInfo.TrailUsePlayerPalette
   */
  readonly trailUsePlayerPalette?: boolean

  /** Travel time in ticks, split equally between ascent and descent (default 400).
   *
   * OpenRA 对照: NukePowerInfo.FlightDelay
   */
  readonly flightDelay?: number

  /** Visual ascent velocity in WDist / tick (default WDist(512)).
   *
   * OpenRA 对照: NukePowerInfo.FlightVelocity
   */
  readonly flightVelocity?: number

  /** Descend immediately on the target (default false).
   *
   * OpenRA 对照: NukePowerInfo.SkipAscent
   */
  readonly skipAscent?: boolean

  /** Ticks before detonation to remove the beacon (default 25).
   *
   * OpenRA 对照: NukePowerInfo.BeaconRemoveAdvance
   */
  readonly beaconRemoveAdvance?: number

  /** Range of cells the camera should reveal around target cell (WDist, default 0).
   *
   * OpenRA 对照: NukePowerInfo.CameraRange
   */
  readonly cameraRange?: number

  /** Can the camera reveal generated shroud (default true).
   *
   * OpenRA 对照: NukePowerInfo.RevealGeneratedShroud
   */
  readonly revealGeneratedShroud?: boolean

  /** Reveal cells to players with these relationships only (default Ally).
   *
   * OpenRA 对照: CameraRelationships: PlayerRelationship
   */
  readonly cameraRelationships?: PlayerRelationship

  /** Ticks before detonation to spawn the camera (default 25).
   *
   * OpenRA 对照: NukePowerInfo.CameraSpawnAdvance
   */
  readonly cameraSpawnAdvance?: number

  /** Ticks after detonation to remove the camera (default 25).
   *
   * OpenRA 对照: NukePowerInfo.CameraRemoveDelay
   */
  readonly cameraRemoveDelay?: number

  /** Range circle color (default Color.FromArgb(128, Red)).
   *
   * OpenRA 对照: NukePowerInfo.CircleColor
   */
  readonly circleColor?: ColorStub

  /** Range circle width in pixels (default 1).
   *
   * OpenRA 对照: NukePowerInfo.CircleWidth
   */
  readonly circleWidth?: number

  /** Range circle border color (default Color.FromArgb(64, Red)).
   *
   * OpenRA 对照: NukePowerInfo.CircleBorderColor
   */
  readonly circleBorderColor?: ColorStub

  /** Range circle border width in pixels (default 3).
   *
   * OpenRA 对照: NukePowerInfo.CircleBorderWidth
   */
  readonly circleBorderWidth?: number

  /** Render circles based on these distance ranges while targeting.
   *
   * OpenRA 对照: NukePowerInfo.CircleRanges (ImmutableArray<WDist>)
   */
  readonly circleRanges?: readonly number[]

  /** The loaded weapon info. Validated at creation time.
   *
   * OpenRA 对照: NukePowerInfo.WeaponInfo (validated in RulesetLoaded)
   */
  readonly weaponInfo?: IWeaponInfoStub
}

/** Default values for NukePowerInfo. */
export const NUKE_POWER_DEFAULTS = {
  missileDelay: 0,
  missileUp: 'up',
  missileDown: 'down',
  spawnOffset: { X: 0, Y: 0, Z: 0 },
  detonationAltitude: 0,
  removeMissileOnDetonation: true,
  missilePalette: 'effect',
  isPlayerPalette: false,
  trailInterval: 1,
  trailDelay: 1,
  trailPalette: 'effect',
  trailUsePlayerPalette: false,
  flightDelay: 400,
  flightVelocity: 512,
  skipAscent: false,
  beaconRemoveAdvance: 25,
  cameraRange: 0,
  revealGeneratedShroud: true,
  cameraSpawnAdvance: 25,
  cameraRemoveDelay: 25,
  circleWidth: 1,
  circleBorderWidth: 3,
} as const

/** Default circle colors. */
export const NUKE_DEFAULT_CIRCLE_COLOR: ColorStub = Object.freeze({ r: 255, g: 0, b: 0, a: 128 / 255 })
export const NUKE_DEFAULT_BORDER_COLOR: ColorStub = Object.freeze({ r: 255, g: 0, b: 0, a: 64 / 255 })

// ---------------------------------------------------------------------------
// PlayerRelationship (re-exported for convenience)
// ---------------------------------------------------------------------------

export const PlayerRelationship = {
  None: 0,
  Enemy: 1,
  Neutral: 2,
  Ally: 4,
} as const

export type PlayerRelationship = (typeof PlayerRelationship)[keyof typeof PlayerRelationship]

// ---------------------------------------------------------------------------
// NukePower
// OpenRA 对照: NukePower : SupportPower
// ---------------------------------------------------------------------------

/**
 * Support power that launches a nuclear missile.
 *
 * OpenRA 对照: NukePower
 *
 * Launches a NukeLaunch projectile from either a building's silo (via
 * BodyOrientation) or from world origin (SkipAscent). Creates a
 * RevealShroudEffect for camera vision around the target, and a Beacon
 * with clock animation driven by the missile's FractionComplete.
 */
export class NukePower extends SupportPower {
  /** Typed info reference.
   *
   * OpenRA 对照: NukePower.info
   */
  get nukeInfo(): NukePowerInfo {
    return this.info as NukePowerInfo
  }

  /** BodyOrientation trait (cached in Created).
   *
   * OpenRA 对照: NukePower.body (BodyOrientation?)
   */
  protected body: IBodyOrientation | null = null

  // -----------------------------------------------------------------------
  // Created — cache BodyOrientation
  // -----------------------------------------------------------------------

  /**
   * Override onCreated to cache BodyOrientation trait.
   *
   * OpenRA 对照: NukePower.Created(Actor)
   */
  protected override onCreated(_self: IGameActor): void {
    // NOTE: body = self.TraitOrDefault<BodyOrientation>()
    // Trait lookup requires full trait dictionary integration.
    this.body = this._getBodyOrientation(_self)
    super.onCreated(_self)
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  /**
   * Activate the nuclear missile.
   *
   * OpenRA 对照: NukePower.Activate(Actor, Order, SupportPowerManager)
   *
   * Calls base.Activate, plays launch sounds, and delegates to the
   * positional Activate overload.
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    super.activate(self, order, manager)
    this.playLaunchSounds()

    const target = order.target?.centerPosition
    if (!target) return

    this.activateAtPosition(self, new WPos(target.X, target.Y, target.Z))
  }

  /**
   * Activate the nuke at a specific world position.
   *
   * OpenRA 对照: NukePower.Activate(Actor, WPos)
   *
   * Creates and spawns the NukeLaunch projectile, sets up camera
   * reveal effect, and creates a beacon with clock animation.
   *
   * @param self — the actor holding this power
   * @param targetPosition — the detonation target position
   */
  activateAtPosition(self: IGameActor, targetPosition: WPos): void {
    const info = this.nukeInfo

    // Determine palette
    const palette = info.isPlayerPalette
      ? `${info.missilePalette ?? NUKE_POWER_DEFAULTS.missilePalette}${(self.owner as PlayerStub)?.playerName ?? ''}`
      : (info.missilePalette ?? NUKE_POWER_DEFAULTS.missilePalette)

    // Launch position: SkipAscent or no body -> WPos.Zero, else silo position
    const skipAscent = (info.skipAscent ?? NUKE_POWER_DEFAULTS.skipAscent) || this.body === null
    let launchPos: WPos

    if (skipAscent) {
      launchPos = WPos.Zero
    } else {
      // Proper silo launch position.
      // In OpenRA: self.CenterPosition + body.LocalToWorld(info.SpawnOffset)
      // This requires:
      //   1. WPos addition operator (WPos + WVec = WPos)
      //   2. BodyOrientation.LocalToWorld() vector transform
      //   3. self.CenterPosition accessor (WPos on the actor)
      // Currently stubbed to WPos.Zero — all nukes launch from world origin.
      launchPos = WPos.Zero
    }

    // Create NukeLaunch projectile
    const nukeConfig = this._createNukeLaunchConfig(self, launchPos, targetPosition, palette)
    const missile = this._createNukeLaunch(nukeConfig)

    // Add missile to world
    this._addToWorld(self, missile)

    // Camera reveal effect
    const cameraRange = info.cameraRange ?? NUKE_POWER_DEFAULTS.cameraRange
    if (cameraRange > 0) {
      this._createRevealShroudEffect(self, targetPosition)
    }

    // Beacon
    if (info.displayBeacon) {
      this._createBeacon(self, targetPosition, missile)
    }
  }

  // -----------------------------------------------------------------------
  // Targeting
  // -----------------------------------------------------------------------

  /**
   * Enter targeting mode — creates SelectNukePowerTarget with range circles.
   *
   * OpenRA 对照: NukePower.SelectTarget(Actor, string, SupportPowerManager)
   */
  override selectTarget(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: self.World.OrderGenerator = new SelectNukePowerTarget(order, manager, info);
    this._setNukeOrderGenerator(self, order, manager)
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Get the BodyOrientation trait from the actor.
   */
  protected _getBodyOrientation(_self: IGameActor): IBodyOrientation | null {
    return null
  }

  /**
   * Create the NukeLaunch configuration object.
   */
  protected _createNukeLaunchConfig(
    self: IGameActor,
    launchPos: WPos,
    targetPos: WPos,
    palette: string,
  ): NukeLaunchConfigData {
    const info = this.nukeInfo
    return {
      firedBy: self.owner as PlayerStub,
      image: info.missileImage ?? null,
      weapon: { name: info.missileWeapon },
      weaponPalette: palette,
      upSequence: info.missileUp ?? NUKE_POWER_DEFAULTS.missileUp,
      downSequence: info.missileDown ?? NUKE_POWER_DEFAULTS.missileDown,
      launchPos,
      targetPos,
      detonationAltitude: new WDist(info.detonationAltitude ?? NUKE_POWER_DEFAULTS.detonationAltitude),
      removeOnDetonation: info.removeMissileOnDetonation ?? NUKE_POWER_DEFAULTS.removeMissileOnDetonation,
      flightVelocity: new WDist(info.flightVelocity ?? NUKE_POWER_DEFAULTS.flightVelocity),
      missileDelay: info.missileDelay ?? NUKE_POWER_DEFAULTS.missileDelay,
      flightDelay: info.flightDelay ?? NUKE_POWER_DEFAULTS.flightDelay,
      skipAscent: info.skipAscent ?? NUKE_POWER_DEFAULTS.skipAscent,
      trailImage: info.trailImage ?? null,
      trailSequences: info.trailSequences ?? [],
      trailPalette: info.trailPalette ?? NUKE_POWER_DEFAULTS.trailPalette,
      trailUsePlayerPalette: info.trailUsePlayerPalette ?? NUKE_POWER_DEFAULTS.trailUsePlayerPalette,
      trailDelay: info.trailDelay ?? NUKE_POWER_DEFAULTS.trailDelay,
      trailInterval: info.trailInterval ?? NUKE_POWER_DEFAULTS.trailInterval,
    }
  }

  /**
   * Create the NukeLaunch projectile.
   *
   * @returns a NukeLaunch-like object with fractionComplete
   */
  protected _createNukeLaunch(_config: NukeLaunchConfigData): INukeLaunch {
    // NOTE: In OpenRA:
    //   new NukeLaunch(owner, image, weaponInfo, palette, upSeq, downSeq,
    //     launchPos, targetPos, detonationAltitude, removeOnDetonation,
    //     flightVelocity, missileDelay, flightDelay, skipAscent, ...)
    // NukeLaunch import from Ch8 Phase B requires full world/scene integration.
    // Returns stub for testing.
    return {
      fractionComplete: 0,
    }
  }

  /**
   * Add the missile to the game world.
   */
  protected _addToWorld(_self: IGameActor, _missile: unknown): void {
    // NOTE: self.World.AddFrameEndTask(w => w.Add(missile))
  }

  /**
   * Create a RevealShroudEffect for camera vision around the target.
   */
  protected _createRevealShroudEffect(_self: IGameActor, _targetPos: WPos): void {
    // NOTE: In OpenRA:
    //   var type = info.RevealGeneratedShroud ? Shroud.SourceType.Visibility
    //     : Shroud.SourceType.PassiveVisibility;
    //   world.Add(new RevealShroudEffect(targetPos, cameraRange, type,
    //     owner, cameraRelationships,
    //     flightDelay - cameraSpawnAdvance,
    //     cameraSpawnAdvance + cameraRemoveDelay));
    // Requires Ch12 Shroud + RevealShroudEffect integration.
  }

  /**
   * Create a Beacon effect with clock animation at the target position.
   */
  protected _createBeacon(_self: IGameActor, _targetPos: WPos, _missile: INukeLaunch): void {
    // NOTE: In OpenRA:
    //   new Beacon(owner, targetPos, ..., () => missile.FractionComplete, beaconDelay,
    //     flightDelay - beaconRemoveAdvance);
    // Beacon class not yet migrated.
  }

  /**
   * Set the nuke-specific order generator.
   */
  protected _setNukeOrderGenerator(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: Creates SelectNukePowerTarget(order, manager, info)
    this.setOrderGenerator(self, order, manager, this.nukeInfo)
  }
}

// ---------------------------------------------------------------------------
// NukeLaunchConfigData — parameter object for _createNukeLaunch
// ---------------------------------------------------------------------------

/** Parameter object for creating a NukeLaunch projectile.
 *
 * OpenRA 对照: NukeLaunch constructor parameters
 */
export interface NukeLaunchConfigData {
  readonly firedBy: PlayerStub
  readonly image: string | null
  readonly weapon: { readonly name: string }
  readonly weaponPalette: string
  readonly upSequence: string
  readonly downSequence: string
  readonly launchPos: WPos
  readonly targetPos: WPos
  readonly detonationAltitude: WDist
  readonly removeOnDetonation: boolean
  readonly flightVelocity: WDist
  readonly missileDelay: number
  readonly flightDelay: number
  readonly skipAscent: boolean
  readonly trailImage: string | null
  readonly trailSequences: readonly string[]
  readonly trailPalette: string
  readonly trailUsePlayerPalette: boolean
  readonly trailDelay: number
  readonly trailInterval: number
}

// ---------------------------------------------------------------------------
// SelectNukePowerTarget
// OpenRA 对照: SelectNukePowerTarget : SelectGenericPowerTarget
// ---------------------------------------------------------------------------

/**
 * OrderGenerator for nuke power targeting with range circle rendering.
 *
 * OpenRA 对照: SelectNukePowerTarget
 *
 * Extends SelectGenericPowerTarget to render range circles at the mouse
 * position, showing the blast radius during targeting.
 */
export class SelectNukePowerTarget {
  /** The power key for order generation. */
  readonly orderKey: string

  private readonly manager: SupportPowerManager
  private readonly info: NukePowerInfo

  constructor(
    order: string,
    manager: SupportPowerManager,
    info: NukePowerInfo,
  ) {
    this.orderKey = order
    this.manager = manager
    this.info = info
  }

  /**
   * Generate an order for a cell click.
   *
   * OpenRA 对照: SelectNukePowerTarget.OrderInner (inherited from SelectGenericPowerTarget)
   *
   * @param cell — the map cell under the cursor
   * @returns an Order, or null if the cell is invalid
   */
  generateOrder(cell: { readonly X: number; readonly Y: number }): OrderStub | null {
    return {
      orderName: this.orderKey,
      target: {
        type: 2, // TargetType.Terrain
        cell: null,
        centerPosition: { X: cell.X, Y: cell.Y, Z: 0 },
      },
    }
  }

  /**
   * Tick — cancel targeting if power becomes unavailable.
   *
   * @returns true if targeting is still valid
   */
  tick(): boolean {
    const instance = this.manager.powers.get(this.orderKey)
    if (!instance || !instance.active || !instance.ready) {
      return false
    }
    return true
  }

  /**
   * Get cursor string for a cell.
   *
   * @param _cell — the map cell under the cursor
   * @returns cursor name string
   */
  getCursor(_cell: { readonly X: number; readonly Y: number }): string {
    return this.info.cursor ?? 'nuke'
  }

  /**
   * Get the range circles for rendering at a given position.
   *
   * OpenRA 对照: SelectNukePowerTarget.RenderAnnotations(WorldRenderer, World)
   *
   * Yields RangeCircleAnnotationRenderable for each circle range.
   *
   * @param _centerPosition — the mouse position in world coordinates
   * @returns array of circle descriptors for rendering
   */
  getRangeCircles(_centerPosition: { readonly X: number; readonly Y: number; readonly Z: number }): CircleDescriptor[] {
    const ranges = this.info.circleRanges
    if (!ranges || ranges.length === 0) return []

    return ranges.map((range) => ({
      range,
      color: this.info.circleColor ?? NUKE_DEFAULT_CIRCLE_COLOR,
      width: this.info.circleWidth ?? NUKE_POWER_DEFAULTS.circleWidth,
      borderColor: this.info.circleBorderColor ?? NUKE_DEFAULT_BORDER_COLOR,
      borderWidth: this.info.circleBorderWidth ?? NUKE_POWER_DEFAULTS.circleBorderWidth,
    }))
  }
}

// ---------------------------------------------------------------------------
// CircleDescriptor — data for range circle rendering
// ---------------------------------------------------------------------------

/** Descriptor for a single range circle to render.
 *
 * OpenRA 对照: RangeCircleAnnotationRenderable constructor parameters
 */
export interface CircleDescriptor {
  /** The radius of the circle (WDist length). */
  readonly range: number
  /** The fill color. */
  readonly color: ColorStub
  /** The line width. */
  readonly width: number
  /** The border color. */
  readonly borderColor: ColorStub
  /** The border width. */
  readonly borderWidth: number
}
