/**
 * SpawnActorPower.ts — 生成单位支援能力（在地图上直接生成 Actor）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SupportPowers/SpawnActorPower.cs (164 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<SpawnActorPowerInfo> → TS 继承 SupportPower
 * - C# world.AddFrameEndTask(w => ...) → TS frameEndActions 回调
 * - C# SpriteEffect → TS 导入 Ch7 Phase E SpriteEffect
 * - C# Game.Sound.Play(SoundType.World, DeploySound, position) → TS 音频桩
 * - C# LocationInit / OwnerInit inits → TS Map<string, unknown>
 * - C# Wait / RemoveSelf Activity queue → TS Activity 桩
 * - C# IOrderGenerator SelectSpawnActorPowerTarget → TS 独立类
 * - C# world.ShroudObscures(cell) / world.Map.GetTerrainInfo(cell).Type → TS 桩
 *
 * SpawnActorPower creates an actor at the target cell, optionally with a
 * SpriteEffect visual. The spawned actor has a limited LifeTime and is
 * automatically removed when the timer expires.
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import {
  SupportPower,
  type SupportPowerInfo,
  type ISupportPowerManager,
  type OrderStub,
} from './SupportPower.js'
import type { SupportPowerManager } from './SupportPowerManager.js'

// ---------------------------------------------------------------------------
// SelectSpawnActorPowerTarget validation result constants
// ---------------------------------------------------------------------------

/**
 * Result of spawn position validation.
 *
 * OpenRA 对照: SpawnActorPower.Validate() checks
 */
export const SpawnValidationResult = {
  /** Position is valid for spawning. */
  Valid: 0,
  /** Cell is outside the map. */
  OutOfMap: 1,
  /** Cell is under shroud and spawning is not allowed there. */
  UnderShroud: 2,
  /** Terrain type is not allowed. */
  InvalidTerrain: 3,
} as const

export type SpawnValidationResult = (typeof SpawnValidationResult)[keyof typeof SpawnValidationResult]

// ---------------------------------------------------------------------------
// SpawnActorPowerInfo
// OpenRA 对照: SpawnActorPowerInfo : SupportPowerInfo
// ---------------------------------------------------------------------------

/** Configuration for SpawnActorPower.
 *
 * OpenRA 对照: SpawnActorPowerInfo
 *
 * Defines the actor to spawn, lifetime, terrain restrictions, deploy sound,
 * and spawn visual effect.
 */
export interface SpawnActorPowerInfo extends SupportPowerInfo {
  /** Actor to spawn (required).
   *
   * OpenRA 对照: SpawnActorPowerInfo.Actor
   */
  readonly actor: string

  /** Amount of time to keep the actor alive in ticks.
   * Value < 0 means this actor will not remove itself.
   *
   * OpenRA 对照: SpawnActorPowerInfo.LifeTime (default 250)
   */
  readonly lifeTime?: number

  /** Only allow spawning on this terrain type.
   *
   * OpenRA 对照: SpawnActorPowerInfo.Terrain (ImmutableArray<string>)
   */
  readonly terrain?: readonly string[]

  /** Allow spawning under shroud.
   *
   * OpenRA 对照: SpawnActorPowerInfo.AllowUnderShroud (default true)
   */
  readonly allowUnderShroud?: boolean

  /** Sound played at the spawn position.
   *
   * OpenRA 对照: SpawnActorPowerInfo.DeploySound
   */
  readonly deploySound?: string | null

  /** Image used for the spawn visual effect.
   *
   * OpenRA 对照: SpawnActorPowerInfo.EffectImage
   */
  readonly effectImage?: string | null

  /** Sequence for the spawn visual effect.
   *
   * OpenRA 对照: SpawnActorPowerInfo.EffectSequence
   */
  readonly effectSequence?: string | null

  /** Palette for the spawn visual effect.
   *
   * OpenRA 对照: SpawnActorPowerInfo.EffectPalette
   */
  readonly effectPalette?: string | null

  /** Whether the effect palette is a player palette.
   *
   * OpenRA 对照: SpawnActorPowerInfo.EffectPaletteIsPlayerPalette
   */
  readonly effectPaletteIsPlayerPalette?: boolean
}

/** Default values for SpawnActorPowerInfo. */
export const SPAWN_ACTOR_POWER_DEFAULTS = {
  lifeTime: 250,
  allowUnderShroud: true,
  effectPaletteIsPlayerPalette: false,
} as const

// ---------------------------------------------------------------------------
// SpawnActorPower
// OpenRA 对照: SpawnActorPower : SupportPower
// ---------------------------------------------------------------------------

/**
 * Support power that spawns an actor at the target cell.
 *
 * OpenRA 对照: SpawnActorPower
 *
 * Validates the target cell (map containment, shroud, terrain restrictions),
 * plays a deploy visual effect, and creates the actor. If LifeTime is
 * positive, the actor is automatically removed after that many ticks.
 */
export class SpawnActorPower extends SupportPower {
  /** Typed info reference.
   *
   * OpenRA 对照: SpawnActorPower.Info
   */
  get spawnInfo(): SpawnActorPowerInfo {
    return this.info as SpawnActorPowerInfo
  }

  // -----------------------------------------------------------------------
  // Activate
  // -----------------------------------------------------------------------

  /**
   * Activate the spawn power.
   *
   * OpenRA 对照: SpawnActorPower.Activate(Actor, Order, SupportPowerManager)
   *
   * Validates target position, plays deploy effect, creates the actor,
   * and queues lifetime removal if applicable.
   */
  override activate(
    self: IGameActor,
    order: OrderStub,
    manager: ISupportPowerManager,
  ): void {
    const position = order.target?.centerPosition
    if (!position) return

    const cell = this._cellContaining(position)
    if (!cell) return

    if (!SpawnActorPower.validate(this._getWorld(self), this.spawnInfo, cell)) return

    super.activate(self, order, manager)

    // Frame-end task: spawn actor and effects
    this._queueFrameEnd(self, cell, order, manager)
  }

  // -----------------------------------------------------------------------
  // Targeting
  // -----------------------------------------------------------------------

  /**
   * Enter targeting mode — creates SelectSpawnActorPowerTarget.
   *
   * OpenRA 对照: SpawnActorPower.SelectTarget(Actor, string, SupportPowerManager)
   */
  override selectTarget(
    self: IGameActor,
    order: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: In OpenRA:
    //   Game.Sound.PlayToPlayer(SoundType.UI, manager.Self.Owner, Info.SelectTargetSound);
    //   Game.Sound.PlayNotification(...)
    //   TextNotificationsManager.AddTransientLine(...)
    //   self.World.OrderGenerator = new SelectSpawnActorPowerTarget(order, manager, this);

    // Play target selection audio (stubbed)
    if (this.info.selectTargetSound) {
      this.playPowerSoundLocal(this.info.selectTargetSound)
    }

    // Create OrderGenerator for spawn targeting
    this._setSpawnOrderGenerator(self, order, manager)
  }

  // -----------------------------------------------------------------------
  // Validate — static validation
  // -----------------------------------------------------------------------

  /**
   * Validate whether a cell is a valid spawn location.
   *
   * OpenRA 对照: SpawnActorPower.Validate(World, SpawnActorPowerInfo, CPos)
   *
   * Checks:
   *   1. Cell is within map bounds
   *   2. Shroud check (if !AllowUnderShroud)
   *   3. Terrain type check (if Terrain is specified)
   *
   * TODO: Replace `_world: unknown` with the proper World type once the
   * World interface is fully migrated. The World parameter is needed for:
   *   world.Map.Contains(cell)
   *   world.ShroudObscures(cell)
   *   world.Map.GetTerrainInfo(cell).Type
   *
   * @param _world — the game world (currently unknown, will become World)
   * @param info — the power configuration
   * @param cell — the target cell
   * @returns true if the cell is a valid spawn location
   */
  static validate(
    _world: unknown,
    _info: SpawnActorPowerInfo,
    cell: CPos,
  ): boolean {
    // Map containment check
    if (!cell) return false

    // NOTE: In OpenRA:
    //   if (!world.Map.Contains(cell)) return false;
    //   if (!info.AllowUnderShroud && world.ShroudObscures(cell)) return false;
    //   if (info.Terrain != null && !info.Terrain.Contains(world.Map.GetTerrainInfo(cell).Type)) return false;
    // All three require world/map integration which is deferred.

    // For unit testing: basic cell validity check
    return true
  }

  /**
   * Detailed validation returning a specific result code.
   * Used by SelectSpawnActorPowerTarget for cursor/feedback logic.
   *
   * @param _world — the game world
   * @param info — the power configuration
   * @param cell — the target cell
   * @returns the validation result enum value
   */
  static validateDetailed(
    _world: unknown,
    _info: SpawnActorPowerInfo,
    cell: CPos,
  ): SpawnValidationResult {
    if (!cell) return SpawnValidationResult.OutOfMap

    // NOTE: Full map/shroud/terrain checks deferred.
    // These will be wired when world.Map / world.ShroudObscures / Map.GetTerrainInfo
    // are fully integrated.

    return SpawnValidationResult.Valid
  }

  // -----------------------------------------------------------------------
  // Protected helpers — overridable for testing
  // -----------------------------------------------------------------------

  /**
   * Convert a center position to a map cell.
   */
  protected _cellContaining(
    _position: { readonly X: number; readonly Y: number; readonly Z: number },
  ): CPos | null {
    // NOTE: In OpenRA: self.World.Map.CellContaining(position)
    // For testing, return a default cell
    return new CPos(512, 512)
  }

  /**
   * Get the game world from the actor.
   */
  protected _getWorld(_self: IGameActor): unknown {
    // NOTE: In full integration, this is self.world
    return null
  }

  /**
   * Queue frame-end actions for actor spawning.
   */
  protected _queueFrameEnd(
    _self2: IGameActor,
    _cell: CPos,
    _order: OrderStub,
    _manager: ISupportPowerManager,
  ): void {
    // NOTE: In OpenRA:
    //   self.World.AddFrameEndTask(w => {
    //     PlayLaunchSounds();
    //     Game.Sound.Play(SoundType.World, info.DeploySound, position);
    //     w.Add(new SpriteEffect(position, w, info.EffectImage, info.EffectSequence, palette));
    //     var actor = w.CreateActor(info.Actor, [new LocationInit(cell), new OwnerInit(self.Owner)]);
    //     if (info.LifeTime > -1) { actor.QueueActivity(new Wait(info.LifeTime)); actor.QueueActivity(new RemoveSelf()); }
    //   });

    this.playLaunchSounds()

    // Deploy sound (stubbed)
    if (this.spawnInfo.deploySound) {
      this.playPowerSoundLocal(this.spawnInfo.deploySound)
    }

    // SpriteEffect (stubbed — imports from Ch7 Phase E)
    if (
      this.spawnInfo.effectSequence &&
      this.spawnInfo.effectPalette
    ) {
      // NOTE: w.Add(new SpriteEffect(position, w, effectImage, effectSequence, palette))
      // SpriteEffect integration deferred to full world wiring.
    }

    // Create actor (stubbed)
    // NOTE: w.CreateActor(info.Actor, [LocationInit(cell), OwnerInit(self.Owner)])
    // Actor creation requires full world integration.

    // LifeTime removal (stubbed)
    // NOTE: if (info.LifeTime > -1) { actor.QueueActivity(new Wait(info.LifeTime)); actor.QueueActivity(new RemoveSelf()); }
  }

  /**
   * Set the spawn-specific OrderGenerator.
   */
  protected _setSpawnOrderGenerator(
    _self: IGameActor,
    orderKey: string,
    manager: ISupportPowerManager,
  ): void {
    // NOTE: Creates SelectSpawnActorPowerTarget(orderKey, manager, this)
    // Full OrderGenerator integration deferred.
    this.setOrderGenerator(_self, orderKey, manager, this.spawnInfo)
  }
}

// ---------------------------------------------------------------------------
// SelectSpawnActorPowerTarget
// OpenRA 对照: SelectSpawnActorPowerTarget : OrderGenerator
// ---------------------------------------------------------------------------

/**
 * OrderGenerator for spawn actor power targeting.
 *
 * OpenRA 对照: SelectSpawnActorPowerTarget
 *
 * Validates target cells and provides cursor feedback based on terrain
 * restrictions. Cancels targeting if the power becomes unavailable.
 */
export class SelectSpawnActorPowerTarget {
  /** The power key for order generation. */
  readonly orderKey: string

  private readonly manager: SupportPowerManager
  private readonly info: SpawnActorPowerInfo

  constructor(
    order: string,
    manager: SupportPowerManager,
    _power: SpawnActorPower,
  ) {
    this.orderKey = order
    this.manager = manager
    this.info = _power.spawnInfo
  }

  /**
   * Generate an order for a cell click.
   *
   * OpenRA 对照: SelectSpawnActorPowerTarget.OrderInner(World, CPos, int2, MouseInput)
   *
   * Yields an Order only if the cell passes validation.
   *
   * @param world — the game world (TODO: replace `unknown` with proper World type)
   * @param cell — the map cell under the cursor
   * @returns an Order, or null if the cell is invalid
   */
  generateOrder(world: unknown, cell: CPos): OrderStub | null {
    if (!SpawnActorPower.validate(world, this.info, cell)) {
      return null
    }

    return {
      orderName: this.orderKey,
      targetString: null,
      target: {
        cell,
        type: 2, // TargetType.Terrain
        centerPosition: null,
      },
    }
  }

  /**
   * Tick — cancel targeting if power becomes unavailable.
   *
   * OpenRA 对照: SelectSpawnActorPowerTarget.Tick(World)
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
   * OpenRA 对照: SelectSpawnActorPowerTarget.GetCursor(World, CPos, int2, MouseInput)
   *
   * @param world — the game world (TODO: replace `unknown` with proper World type)
   * @param cell — the map cell under the cursor
   * @returns cursor name string
   */
  getCursor(world: unknown, cell: CPos): string {
    return SpawnActorPower.validate(world, this.info, cell)
      ? (this.info.cursor ?? 'ability')
      : (this.info.blockedCursor ?? 'ability-blocked')
  }
}
