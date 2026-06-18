/**
 * PlaceBuildingOrderGenerator.ts — 建筑放置序生成器：处理鼠标驱动的建筑放置，
 *   含脚印预览、变体切换、墙体连线
 * OpenRA 对照: OpenRA.Mods.Common/Orders/PlaceBuildingOrderGenerator.cs (337 lines)
 *
 * 核心范式转换:
 * - C# IOrderGenerator (interface + IOrderGenerator.Order/IOrderGenerator.Tick) → TS IOrderGenerator 接口实现
 * - C# IPlaceBuildingPreview (3D 建筑预览渲染) → TS 桩返回空数组 (3D 预览延后至 Ch15)
 * - C# `new Order(...)` + object initializer → TS `Order.withTarget()` + mutable fields
 * - C# Game.GetModifierKeys() / Game.Settings.Game → TS 回调 / 配置对象注入
 * - C# Game.Sound.PlayNotification → TS 桩 (TODO-8.F)
 * - C# AIUtils.ClearBlockersOrders → TS 返回空数组 (TODO-14.AI)
 * - C# ChromeMetrics.Get<string>("WorldDefaultCursor") → TS 默认字符串 "default"
 * - C# Shroud.IsExplored → TS 默认 true (Shroud 系统 = Ch12)
 *
 * PlaceBuildingOrderGenerator 是 Chapter 11 Phase B 中最复杂的序生成器。
 * 当生产队列中有已完成的建筑项目时，此序生成器被激活，允许玩家通过鼠标
 * 在地图上放置建筑。
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import { Order as NetworkOrder } from '../../OpenRA.Game/Network/Order.js'

import type { Int2, Vec2, WPos } from '../../OpenRA.Game/Graphics/WorldRenderer.js'
import type {
  IGameActor,
  IOrderGenerator,
  IPlaceBuildingPreviewGeneratorInfo,
  IPlaceBuildingPreview,
  WorldRendererStub,
  WorldStub,
  PlayerStub,
  ActorInfoStub,
  Order,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  PlaceBuildingCellType,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Minimal dependency interfaces for easy unit testing
// OpenRA 对照: N/A (C# uses extension methods on World / Game globals)
// ---------------------------------------------------------------------------

/**
 * Minimal actor info for building placement queries.
 *
 * OpenRA 对照: ActorInfo (子集: Name, TraitInfo<T>, TraitInfoOrDefault<T>, TraitInfos<T>, HasTraitInfo<T>)
 */
export interface IPlaceBuildingOGActorInfo extends ActorInfoStub {
  readonly name: string

  /** Get a single trait info by name (or null if absent).
   *
   * OpenRA 对照: ActorInfo.TraitInfo<T>()
   */
  getTraitInfo(traitName: string): IPlaceBuildingOGTraitInfo | null

  /** Get a single trait info by name, returning null if absent.
   *
   * OpenRA 对照: ActorInfo.TraitInfoOrDefault<T>()
   */
  getTraitInfoOrDefault(traitName: string): IPlaceBuildingOGTraitInfo | null

  /** Get all instances of a trait info by name.
   *
   * OpenRA 对照: ActorInfo.TraitInfos<T>()
   */
  getTraitInfos(traitName: string): readonly IPlaceBuildingOGTraitInfo[]

  /** Check if a trait info type exists.
   *
   * OpenRA 对照: ActorInfo.HasTraitInfo<T>()
   */
  hasTraitInfo(traitName: string): boolean
}

/**
 * Minimal trait info queried during building placement.
 *
 * OpenRA 对照: Various TraitInfo types (BuildingInfo, PlugInfo, LineBuildInfo, etc.)
 */
export interface IPlaceBuildingOGTraitInfo {
  /** Trait class name (e.g. "BuildingInfo", "PlugInfo"). */
  readonly type: string

  /** Building dimensions (for BuildingInfo). */
  readonly dimensions?: CVec

  /** Terrain types the building can be placed on (for BuildingInfo). */
  readonly terrainTypes?: ReadonlySet<string>

  /** Whether invalid placement is allowed (for BuildingInfo). */
  readonly allowInvalidPlacement?: boolean

  /** Whether building requires a base provider (for BuildingInfo). */
  readonly requiresBaseProvider?: boolean

  /** Plug type string (for PlugInfo). */
  readonly plugType?: string | null

  /** Maximum search range for line build (for LineBuildInfo). */
  readonly range?: number

  /** Node types for line build connectors (for LineBuildInfo). */
  readonly nodeTypes?: ReadonlySet<string>

  /** Segment actor type for line build (for LineBuildInfo). */
  readonly segmentType?: string | null

  /** Variant actor names (for PlaceBuildingVariantsInfo). */
  readonly actors?: readonly string[]

  /** Preview type string (for IPlaceBuildingPreviewGeneratorInfo). */
  readonly previewType?: string

  /** Replaceable type tags (for ReplacementInfo). */
  readonly replaceableTypes?: ReadonlySet<string>

  /** Force faction override (for BuildableInfo). */
  readonly forceFaction?: string | null

  /** Build sounds (for BuildingInfo). */
  readonly buildSounds?: readonly string[]

  /** Arbitrary additional data (for duck-typing). */
  readonly [key: string]: unknown
}

/**
 * Minimal map interface for building placement.
 *
 * OpenRA 对照: Map (子集: Contains, Rules.Actors)
 */
export interface IPlaceBuildingOGMap {
  /** Check if a cell is within map bounds. */
  contains(cell: CPos): boolean

  /** Ruleset for actor type lookups. */
  readonly rules: IPlaceBuildingOGRules
}

/**
 * Minimal ruleset.
 *
 * OpenRA 对照: Ruleset (子集: Actors indexer)
 */
export interface IPlaceBuildingOGRules {
  /** Get actor info by name. */
  getActorInfo(name: string): IPlaceBuildingOGActorInfo | undefined
}

/**
 * Minimal actor map for cell queries.
 *
 * OpenRA 对照: ActorMap (子集: GetActorsAt)
 */
export interface IPlaceBuildingOGActorMap {
  /** Get all actors at a cell. */
  getActorsAt(cell: CPos): IGameActor[]
}

/**
 * Minimal building influence for occupancy checks.
 *
 * OpenRA 对照: BuildingInfluence (子集: AnyBuildingAt)
 */
export interface IPlaceBuildingOGInfluence {
  /** Check if any building occupies a cell. */
  anyBuildingAt(cell: CPos): boolean
}

/**
 * Minimal shroud for visibility checks.
 *
 * OpenRA 对照: Shroud (子集: IsExplored)
 *
 * NOTE: Full Shroud implementation is Chapter 12.
 * Stub implementation always returns true.
 */
export interface IPlaceBuildingOGShroud {
  /** Check if a cell has been explored. */
  isExplored(cell: CPos): boolean
}

/**
 * Minimal selection interface.
 *
 * OpenRA 对照: ISelection (子集: Clear)
 */
export interface IPlaceBuildingOGSelection {
  /** Clear the current selection. */
  clear(): void
}

/**
 * Complete world abstraction for PlaceBuildingOrderGenerator.
 *
 * OpenRA 对照: World (子集: Map, ActorMap, BuildingInfluence,
 *   CanPlaceBuilding, IsCellBuildable, CancelInputMode, Selection,
 *   LocalPlayer, Shroud, Paused)
 */
export interface IPlaceBuildingOGWorld extends WorldStub {
  /** The map. */
  readonly map: IPlaceBuildingOGMap

  /** The actor map. */
  readonly actorMap: IPlaceBuildingOGActorMap

  /** Building influence layer. */
  readonly buildingInfluence: IPlaceBuildingOGInfluence

  /** Shroud for visibility checks. */
  readonly shroud: IPlaceBuildingOGShroud

  /** Selection manager. */
  readonly selection: IPlaceBuildingOGSelection | null

  /** The local player (may be null in spec mode). */
  readonly localPlayer: PlayerStub | null

  /** Whether the game is paused. */
  readonly paused: boolean

  /** Cancel the current input mode. */
  cancelInputMode(): void

  /** Check if a full building footprint can be placed at given position.
   *
   * OpenRA 对照: BuildingUtils.CanPlaceBuilding(World, CPos, ActorInfo, BuildingInfo, Actor)
   */
  canPlaceBuilding(
    topLeft: CPos,
    actorInfo: IPlaceBuildingOGActorInfo,
    buildingInfo: IPlaceBuildingOGTraitInfo,
    toIgnore: IGameActor | null,
  ): boolean

  /** Check if a single cell is buildable for a given actor type.
   *
   * OpenRA 对照: BuildingUtils.IsCellBuildable(World, CPos, ActorInfo, BuildingInfo, Actor)
   */
  isCellBuildable(
    cell: CPos,
    actorInfo: IPlaceBuildingOGActorInfo,
    buildingInfo: IPlaceBuildingOGTraitInfo,
  ): boolean
}

/**
 * Minimal keyboard modifier state for shift/ctrl detection.
 *
 * OpenRA 对照: Modifiers (Flags enum) + Game.GetModifierKeys()
 */
export interface IPlaceBuildingOGModifiers {
  /** Check if a specific modifier is active. */
  hasModifier(mod: number): boolean
}

/** Shift modifier flag value.
 *
 * OpenRA 对照: Modifiers.Shift
 */
export const ModifierFlag = {
  Shift: 1,
  Ctrl: 2,
  Alt: 4,
} as const

/**
 * Game settings subset for mouse control logic.
 *
 * OpenRA 对照: GameSettings.Game 子集
 */
export interface IPlaceBuildingOGSettings {
  /** Mouse control style. */
  readonly mouseControlStyle: 'classic' | 'standard' | string

  /** Resolve the action button for place building. */
  resolveActionButtonForPlaceBuilding(): number

  /** Resolve the cancel button for place building. */
  resolveCancelButtonForPlaceBuilding(): number
}

/**
 * Sound notification system stub.
 *
 * OpenRA 对照: Game.Sound.PlayNotification
 *
 * TODO-8.F: Wire up to real Sound system.
 */
export interface IPlaceBuildingOGSound {
  /** Play a notification sound. */
  playNotification(
    rules: IPlaceBuildingOGRules | null,
    player: PlayerStub,
    channel: string,
    notification: string | null,
    faction: string,
  ): void

  /** Add a transient text notification line. */
  addTransientLine(player: PlayerStub, text: string | null): void
}

/**
 * Production item stub for queue interaction.
 *
 * OpenRA 对照: ProductionItem (子集: Done, Item)
 */
export interface IPlaceBuildingOGProductionItem {
  /** Whether this item has completed production. */
  readonly done: boolean

  /** The actor type name being produced. */
  readonly item: string
}

/**
 * Production queue stub for the order generator.
 *
 * OpenRA 对照: ProductionQueue (子集: AllQueued, MostLikelyProducer)
 */
export interface IPlaceBuildingOGQueue {
  /** The actor this queue is attached to. */
  readonly actor: IGameActor

  /** Get all queued items. */
  allQueued(): readonly IPlaceBuildingOGProductionItem[]

  /** Get the most likely producer. */
  mostLikelyProducer(): IPlaceBuildingOGProducer | null

  /** Configuration info for this queue. */
  readonly info: IPlaceBuildingOGQueueInfo
}

/**
 * Queue info for audio notification.
 *
 * OpenRA 对照: ProductionQueueInfo (子集: CannotPlaceAudio)
 */
export interface IPlaceBuildingOGQueueInfo {
  readonly cannotPlaceAudio: string | null
}

/**
 * Minimal producer reference.
 *
 * OpenRA 对照: Production (子集: Faction, IsTraitDisabled)
 */
export interface IPlaceBuildingOGProducer {
  /** The producing actor. */
  readonly actor: IGameActor | null

  /** The faction of this producer (from trait). */
  readonly faction?: string | null
}

/**
 * PlaceBuildingInfo subset for the order generator.
 *
 * OpenRA 对照: PlaceBuildingInfo (子集)
 */
export interface IPlaceBuildingOGPlaceBuildingInfo {
  /** Notification played when placement is not possible. */
  readonly cannotPlaceNotification: string | null

  /** Text notification for cannot-place. */
  readonly cannotPlaceTextNotification: string | null

  /** Hotkey for toggling variants. */
  readonly toggleVariantKey: { isActivatedBy(e: IPlaceBuildingOGKeyInput): boolean }
}

/**
 * Minimal key input event.
 *
 * OpenRA 对照: KeyInput
 */
export interface IPlaceBuildingOGKeyInput {
  readonly key: string
  readonly event: string
  readonly modifiers: number
}

/**
 * Player info exposed by the owner's ActorInfo for trait queries.
 *
 * OpenRA 对照: Player.PlayerActor.Info (ActorInfo)
 *
 * Provides access to trait info objects like PlaceBuildingInfo.
 */
export interface IPlaceBuildingOGPlayerInfo {
  /** Get a single trait info by name, or null if absent. */
  getTraitInfo(name: string): IPlaceBuildingOGPlaceBuildingInfo | null
  /** Get a single trait info by name, returning null if absent. */
  getTraitInfoOrDefault(name: string): IPlaceBuildingOGPlaceBuildingInfo | null
  /** Get all instances of a trait info by name. */
  getTraitInfos(name: string): readonly IPlaceBuildingOGPlaceBuildingInfo[]
  /** Check if a trait info exists. */
  hasTraitInfo(name: string): boolean
}

// ---------------------------------------------------------------------------
// VariantWrapper — inner class holding variant info + preview
// OpenRA 对照: PlaceBuildingOrderGenerator.VariantWrapper (sealed class)
// ---------------------------------------------------------------------------

/**
 * Wrapper holding one building variant's configuration and preview renderer.
 *
 * OpenRA 对照: PlaceBuildingOrderGenerator.VariantWrapper
 *
 * Each variant contains the full ActorInfo for that variant, plus parsed
 * sub-infos (BuildingInfo, PlugInfo, LineBuildInfo) and an optional
 * preview renderer.
 */
export class VariantWrapper {
  /** The actor type info for this variant.
   *
   * OpenRA 对照: VariantWrapper.ActorInfo
   */
  readonly actorInfo: IPlaceBuildingOGActorInfo

  /** Parsed building info (always present — buildings must have this).
   *
   * OpenRA 对照: VariantWrapper.BuildingInfo
   */
  readonly buildingInfo: IPlaceBuildingOGTraitInfo

  /** Parsed plug info (null if this building type is not a plug).
   *
   * OpenRA 对照: VariantWrapper.PlugInfo
   */
  readonly plugInfo: IPlaceBuildingOGTraitInfo | null

  /** Parsed line build info (null if not a line-buildable building).
   *
   * OpenRA 对照: VariantWrapper.LineBuildInfo
   */
  readonly lineBuildInfo: IPlaceBuildingOGTraitInfo | null

  /** Preview renderer (null if no preview generator info is available).
   *
   * OpenRA 对照: VariantWrapper.Preview
   */
  readonly preview: IPlaceBuildingPreview | null

  /**
   * Construct a VariantWrapper from an actor info and production queue context.
   *
   * OpenRA 对照: VariantWrapper(WorldRenderer, ProductionQueue, ActorInfo)
   *
   * Extracts trait info sub-objects and attempts to create a preview
   * renderer via IPlaceBuildingPreviewGeneratorInfo if present.
   *
   * @param worldRenderer — the world renderer (pass null / stub for test)
   * @param queue — the production queue that completed the item
   * @param actorInfo — the actor type info for this variant
   */
  constructor(
    worldRenderer: WorldRendererStub | null,
    queue: IPlaceBuildingOGQueue,
    actorInfo: IPlaceBuildingOGActorInfo,
  ) {
    this.actorInfo = actorInfo
    this.buildingInfo = actorInfo.getTraitInfo('BuildingInfo')!
    this.plugInfo = actorInfo.getTraitInfoOrDefault('PlugInfo')
    this.lineBuildInfo = actorInfo.getTraitInfoOrDefault('LineBuildInfo')

    // Attempt to create a preview renderer
    const previewGeneratorInfo = actorInfo.getTraitInfoOrDefault(
      'IPlaceBuildingPreviewGeneratorInfo',
    ) as IPlaceBuildingPreviewGeneratorInfo | null
    if (previewGeneratorInfo && worldRenderer) {
      // Resolve faction
      let faction: string
      const buildableInfo = actorInfo.getTraitInfoOrDefault('BuildableInfo')
      if (buildableInfo?.forceFaction) {
        faction = buildableInfo.forceFaction
      } else {
        const mostLikelyProducer = queue.mostLikelyProducer()
        faction =
          mostLikelyProducer?.faction ??
          ((queue.actor.owner as unknown as Record<string, unknown>)
            .factionInternalName as string) ??
          'random'
      }

      // Build TypeDictionary equivalent as Map<string, unknown>
      const td = new Map<string, unknown>()
      td.set('faction', faction)
      td.set('owner', queue.actor.owner)

      this.preview = previewGeneratorInfo.createPreview(
        worldRenderer,
        actorInfo,
        td,
      )
    } else {
      this.preview = null
    }
  }

  /**
   * Get variant actor names from PlaceBuildingVariants infos.
   *
   * OpenRA 对照: PlaceBuildingVariantsInfo.Actors
   *
   * @returns array of actor type names that are variants of this type
   */
  getVariantActors(): readonly string[] {
    const result: string[] = []
    for (const pv of this.actorInfo.getTraitInfos('PlaceBuildingVariantsInfo')) {
      if (pv.actors) {
        for (const a of pv.actors) {
          result.push(a)
        }
      }
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// PlaceBuildingOrderGenerator
// OpenRA 对照: PlaceBuildingOrderGenerator : IOrderGenerator
// ---------------------------------------------------------------------------

/**
 * Order generator for building placement.
 *
 * OpenRA 对照: PlaceBuildingOrderGenerator : IOrderGenerator
 *
 * Activated when a production queue has a completed building item.
 * Allows the player to:
 * - Place the building on the map (left click)
 * - Cancel placement (right click)
 * - Toggle between building variants (hotkey)
 * - See a footprint preview with valid/invalid cell coloring
 * - Line build walls with shift-click modifiers
 * - Place plugs on pluggable buildings
 */
export class PlaceBuildingOrderGenerator implements IOrderGenerator {
  /** Unique key for this order generator.
   *
   * OpenRA 对照: 约定 (C# 无此字段，TS 需要用于序列化)
   */
  readonly orderGeneratorKey = 'PlaceBuildingOrderGenerator'

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  /** The production queue that triggered this placement. */
  readonly queue: IPlaceBuildingOGQueue

  /** All available variants (base + PlaceBuildingVariants alternates). */
  readonly variants: readonly VariantWrapper[]

  /** Current variant index. */
  private _variant: number = 0

  /** PlaceBuildingInfo configuration. */
  private readonly _placeBuildingInfo: IPlaceBuildingOGPlaceBuildingInfo

  /** World reference for coordinate transforms and validation. */
  private readonly _world: IPlaceBuildingOGWorld

  /** Viewport for world-to-screen coordinate transforms. */
  private readonly _viewport: IPlaceBuildingOGViewport

  /** Game settings for button resolution. */
  private readonly _gameSettings: IPlaceBuildingOGSettings

  /** Modifier getter for shift/ctrl detection. */
  private readonly _getModifiers: () => IPlaceBuildingOGModifiers

  /** Sound system stub for notification playback. */
  private readonly _sound: IPlaceBuildingOGSound | null

  /** Default cursor string. */
  private readonly _worldDefaultCursor: string

  /** Last mouse button pressed (for button routing in order()).
   *
   * OpenRA 对照: MouseInput.Button
   */
  private _lastMouseButton: number = -1

  /** Last mouse event type (for checking Down vs Up vs Move).
   *
   * OpenRA 对照: MouseInput.Event
   */
  private _lastMouseEvent: string = ''

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param queue — the production queue with a completed building item
   * @param name — the actor type name of the building to place
   * @param worldRenderer — the world renderer (null for headless/test)
   * @param world — the game world
   * @param viewport — the viewport for coordinate transforms
   * @param gameSettings — game settings for mouse button resolution
   * @param getModifiers — function returning current keyboard modifier state
   * @param sound — sound system stub (null for headless)
   * @param worldDefaultCursor — default cursor name string
   */
  constructor(
    queue: IPlaceBuildingOGQueue,
    name: string,
    worldRenderer: WorldRendererStub | null,
    world: IPlaceBuildingOGWorld,
    viewport: IPlaceBuildingOGViewport,
    gameSettings: IPlaceBuildingOGSettings,
    getModifiers: () => IPlaceBuildingOGModifiers,
    sound: IPlaceBuildingOGSound | null = null,
    worldDefaultCursor: string = 'default',
  ) {
    this.queue = queue
    this._world = world
    this._viewport = viewport
    this._gameSettings = gameSettings
    this._getModifiers = getModifiers
    this._sound = sound
    this._worldDefaultCursor = worldDefaultCursor

    // Resolve PlaceBuildingInfo from the player actor's info.
    // The owner is a PlayerStub at the interface level, but at runtime it is
    // a full Player with an `info` property (PlayerActor.Info) that exposes
    // trait queries. We narrow the type to access this.
    const ownerInfo = (queue.actor.owner as unknown as {
      info?: IPlaceBuildingOGPlayerInfo
    }).info
    this._placeBuildingInfo = ownerInfo?.getTraitInfo?.('PlaceBuildingInfo') ?? {
      cannotPlaceNotification: null,
      cannotPlaceTextNotification: null,
      toggleVariantKey: { isActivatedBy: () => false },
    }

    // Classic mouse control style: clear selection on placement start
    if (gameSettings.mouseControlStyle === 'classic') {
      world.selection?.clear()
    }

    // Build variants list: base actor + PlaceBuildingVariants alternates
    const rules = world.map.rules
    const baseAi = rules.getActorInfo(name)
    if (!baseAi) {
      this.variants = []
      return
    }

    const variantsList: VariantWrapper[] = [
      new VariantWrapper(worldRenderer, queue, baseAi),
    ]

    // Expand variants from PlaceBuildingVariantsInfo
    const baseVariant = variantsList[0]
    for (const actorName of baseVariant.getVariantActors()) {
      const variantAi = rules.getActorInfo(actorName)
      if (variantAi) {
        variantsList.push(new VariantWrapper(worldRenderer, queue, variantAi))
      }
    }

    this.variants = variantsList
  }

  // ---------------------------------------------------------------------------
  // IOrderGenerator implementation
  // ---------------------------------------------------------------------------

  /**
   * Process mouse input and yield orders.
   *
   * OpenRA 对照: IOrderGenerator.Order(World, CPos, int2, MouseInput)
   *
   * Handles left-click (place) and right-click (cancel).
   * The C# pattern checks `mi.Button == actionButton && mi.Event == Down`
   * for placement and `mi.Button == cancelButton && mi.Event == Down`
   * for cancellation. In the TS architecture, MouseInput is received
   * separately via `handleMouseInput()` and the button/event state is
   * stored for use here.
   *
   * @param _worldStub — the world (stub, unused — real world is _world field)
   * @param _cell — the cell under the cursor
   * @param _modifiers — keyboard modifiers stub
   */
  *order(
    _worldStub: WorldStub,
    _cell: CPos,
    _modifiers: TargetModifiers,
  ): Generator<Order | null> {
    const actionButton = this._gameSettings.resolveActionButtonForPlaceBuilding()
    const cancelButton = this._gameSettings.resolveCancelButtonForPlaceBuilding()

    if (actionButton === 0 && cancelButton === 0) {
      return
    }

    // Only respond to button-down events (matching C# MouseInputEvent.Down check)
    if (this._lastMouseEvent !== 'Down') {
      return
    }

    // Right-click / cancel button → cancel input mode (matching C# cancel branch)
    if (
      cancelButton !== 0 &&
      this._lastMouseButton === cancelButton
    ) {
      this._world.cancelInputMode()
      return
    }

    // Non-action button → ignore (matching C# fall-through behavior)
    if (
      actionButton === 0 ||
      this._lastMouseButton !== actionButton
    ) {
      return
    }

    // Left-click / action button → try to produce orders
    const ret = Array.from(this.innerOrder(this._world))

    // If there was a successful placement order, cancel input mode
    if (
      ret.some(
        (o) =>
          o?.orderString === 'PlaceBuilding' ||
          o?.orderString === 'LineBuild' ||
          o?.orderString === 'PlacePlug',
      )
    ) {
      this._world.cancelInputMode()
    }

    for (const o of ret) {
      // NOTE: Cast to Order (OrderStub) for interface compatibility.
      // NetworkOrder structurally overlaps with OrderStub for the fields used
      // by consumers (orderName, targetString, extraData).
      yield o as unknown as Order
    }
  }

  /**
   * Called each logic tick to check queue state and update previews.
   *
   * OpenRA 对照: IOrderGenerator.Tick(World)
   */
  tick(_worldStub: WorldStub): void {
    // If no queued items match the base variant name, cancel placement
    const baseName = this.variants.length > 0 ? this.variants[0].actorInfo.name : ''
    if (baseName) {
      const allItems = this.queue.allQueued()
      let hasCompletedItem = false
      for (const item of allItems) {
        if (item.done && item.item === baseName) {
          hasCompletedItem = true
          break
        }
      }
      if (!hasCompletedItem) {
        this._world.cancelInputMode()
        return
      }
    }

    // Tick preview renders
    for (const v of this.variants) {
      if (v.preview) v.preview.tick()
    }
  }

  /**
   * Render above the shroud layer (footprint preview).
   *
   * OpenRA 对照: IOrderGenerator.RenderAboveShroud(WorldRenderer, World)
   *
   * Computes the building footprint cells and colors them by validity.
   *
   * NOTE: Preview rendering is delegated to IPlaceBuildingPreview.
   * For Phase B, the preview system returns empty arrays (deferred to Ch15).
   */
  renderAboveShroud(
    worldRenderer: WorldRendererStub,
    _worldStub: WorldStub,
  ): void {
    const topLeft = this._computeTopLeft()
    const activeVariant = this.variants[this._variant]
    if (!activeVariant) return

    const actorInfo = activeVariant.actorInfo
    const buildingInfo = activeVariant.buildingInfo
    const plugInfo = activeVariant.plugInfo
    const lineBuildInfo = activeVariant.lineBuildInfo
    const preview = activeVariant.preview
    const owner = this.queue.actor.owner
    const world = this._world
    const localPlayer = world.localPlayer

    // Build footprint map keyed by CPos.Bits for efficient lookup
    const footprint = new Map<number, PlaceBuildingCellType>()

    if (plugInfo) {
      // Plug: 1x1 check at topLeft
      const dims = buildingInfo.dimensions
      if (dims && (dims.X !== 1 || dims.Y !== 1)) {
        throw new Error('Plug requires a 1x1 sized Building')
      }
      footprint.set(
        topLeft.Bits,
        makeCellType(this._acceptsPlug(topLeft, plugInfo)),
      )
    } else if (lineBuildInfo && localPlayer) {
      // Line build for walls
      const dims = buildingInfo.dimensions
      if (dims && (dims.X !== 1 || dims.Y !== 1)) {
        throw new Error('LineBuild requires a 1x1 sized Building')
      }

      const modifiers = this._getModifiers()
      if (!modifiers.hasModifier(ModifierFlag.Shift)) {
        // Resolve segment info
        let segmentInfo = actorInfo
        let segmentBuildingInfo = buildingInfo
        if (lineBuildInfo.segmentType && lineBuildInfo.segmentType !== '') {
          const segAi = world.map.rules.getActorInfo(lineBuildInfo.segmentType)
          if (segAi) {
            segmentInfo = segAi
            const segBi = segAi.getTraitInfo('BuildingInfo')
            if (segBi) {
              segmentBuildingInfo = segBi
            }
          }
        }

        // Get line build cells
        const lineCells = this._getLineBuildCells(
          topLeft,
          actorInfo,
          buildingInfo,
          owner,
          segmentInfo,
          segmentBuildingInfo,
        )
        for (const lc of lineCells) {
          const lineBuildable = world.isCellBuildable(lc.cell, segmentInfo, segmentBuildingInfo)
          const lineCloseEnough = this._isCloseEnoughToBase(segmentBuildingInfo, lc.cell)
          footprint.set(
            lc.cell.Bits,
            makeCellType(lineBuildable && lineCloseEnough, true),
          )
        }
      }

      // Mark topLeft cell itself
      const buildable = world.isCellBuildable(topLeft, actorInfo, buildingInfo)
      const closeEnough = this._isCloseEnoughToBase(buildingInfo, topLeft)
      footprint.set(
        topLeft.Bits,
        makeCellType(buildable && closeEnough),
      )
    } else {
      // Normal footprint: all tiles
      const isCloseEnough = this._isCloseEnoughToBase(buildingInfo, topLeft)
      for (const t of this._buildingTiles(topLeft, buildingInfo)) {
        footprint.set(
          t.Bits,
          makeCellType(
            isCloseEnough && world.isCellBuildable(t, actorInfo, buildingInfo),
          ),
        )
      }
    }

    // Delegate to preview renderer (returns empty for Phase B stubs)
    if (preview) {
      preview.render(
        worldRenderer,
        topLeft,
        footprint,
      )
    }
  }

  /**
   * Render annotations (delegate to preview).
   *
   * OpenRA 对照: IOrderGenerator.RenderAnnotations(WorldRenderer, World)
   */
  renderAnnotations(
    worldRenderer: WorldRendererStub,
    _worldStub: WorldStub,
  ): void {
    const preview = this.variants[this._variant]?.preview
    if (preview) {
      preview.renderAnnotations(worldRenderer, this._computeTopLeft())
    }
  }

  /**
   * Get the cursor for the given cell.
   *
   * OpenRA 对照: IOrderGenerator.GetCursor(World, CPos, int2, MouseInput)
   *
   * @returns the cursor name string
   */
  getCursor(_worldStub: WorldStub, _cell: CPos): string {
    return this._worldDefaultCursor
  }

  /**
   * Handle a keyboard input event (variant cycling).
   *
   * OpenRA 对照: IOrderGenerator.HandleKeyPress(KeyInput)
   *
   * Checks if the toggle variant hotkey was pressed and cycles
   * to the next variant if so.
   *
   * @param e — the key input event
   * @returns true if the event was handled
   */
  handleKeyPress(e: unknown): boolean {
    if (this.variants.length <= 1) return false

    const keyInput = e as IPlaceBuildingOGKeyInput
    if (!keyInput || !this._placeBuildingInfo.toggleVariantKey.isActivatedBy(keyInput)) {
      return false
    }

    this._variant++
    if (this._variant >= this.variants.length) {
      this._variant = 0
    }
    return true
  }

  /**
   * Handle a mouse input event.
   *
   * OpenRA 对照: N/A (C# mouse input is routed through World.OrderGenerator
   *   which calls IOrderGenerator.Order)
   *
   * In the TS architecture, mouse input is received here before `order()`
   * is invoked. We store the last button and event type so that `order()`
   * can route to the correct branch (action → place, cancel → exit).
   *
   * @param mouseInput — the mouse input event with button/event fields
   * @returns false (unhandled, delegate to order())
   */
  handleMouseInput(mouseInput: unknown): boolean {
    const mi = mouseInput as { button?: number; event?: string } | undefined
    if (mi?.button !== undefined) {
      this._lastMouseButton = mi.button
    }
    if (mi?.event !== undefined) {
      this._lastMouseEvent = mi.event
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Inner order resolution
  // OpenRA 对照: PlaceBuildingOrderGenerator.InnerOrder(World, CPos, MouseInput)
  // ---------------------------------------------------------------------------

  /**
   * Generate placement orders after validating location.
   *
   * OpenRA 对照: PlaceBuildingOrderGenerator.InnerOrder(World, CPos, MouseInput)
   *
   * Checks:
   * - World not paused
   * - Floor acceptance (for plugs)
   * - Building placement validity + base proximity (for normal/line build)
   * - Line build detection (no shift modifier = line build)
   *
   * @param world — the game world
   * @returns iterator of orders
   */
  *innerOrder(
    world: IPlaceBuildingOGWorld,
  ): Generator<NetworkOrder | null> {
    if (world.paused) return

    const owner = this.queue.actor.owner
    if (!owner) return

    const ai = this.variants[this._variant].actorInfo
    const bi = this.variants[this._variant].buildingInfo
    const notification =
      this.queue.info.cannotPlaceAudio ??
      this._placeBuildingInfo.cannotPlaceNotification

    let orderType = 'PlaceBuilding'
    const topLeft = this._computeTopLeft()

    const plugInfo = ai.getTraitInfoOrDefault('PlugInfo')
    if (plugInfo && plugInfo.plugType) {
      orderType = 'PlacePlug'
      if (!this._acceptsPlug(topLeft, plugInfo)) {
        if (notification && this._sound) {
          const factionStr =
            (owner as unknown as Record<string, unknown>).factionInternalName as string ?? 'random'
          this._sound.playNotification(
            world.map.rules,
            owner,
            'Speech',
            notification,
            factionStr,
          )
        }
        if (this._placeBuildingInfo.cannotPlaceTextNotification && this._sound) {
          this._sound.addTransientLine(
            owner,
            this._placeBuildingInfo.cannotPlaceTextNotification,
          )
        }
        return
      }
    } else {
      if (
        !world.canPlaceBuilding(topLeft, ai, bi, null) ||
        !this._isCloseEnoughToBase(bi, topLeft)
      ) {
        // Yield blocker-clearing orders (stub — returns empty)
        for (const order of this._clearBlockersOrders()) {
          yield order
        }

        if (notification && this._sound) {
          const factionStr =
            (owner as unknown as Record<string, unknown>).factionInternalName as string ?? 'random'
          this._sound.playNotification(
            world.map.rules,
            owner,
            'Speech',
            notification,
            factionStr,
          )
        }
        if (this._placeBuildingInfo.cannotPlaceTextNotification && this._sound) {
          this._sound.addTransientLine(
            owner,
            this._placeBuildingInfo.cannotPlaceTextNotification,
          )
        }
        return
      }

      if (
        ai.hasTraitInfo('LineBuildInfo') &&
        !this._getModifiers().hasModifier(ModifierFlag.Shift)
      ) {
        orderType = 'LineBuild'
      }
    }

    // Resolve subject ID (player actor)
    const playerActor = owner as unknown as Record<string, unknown>
    const subjectId: number =
      typeof playerActor.actorId === 'number'
        ? (playerActor.actorId as number)
        : 0

    // Create target from cell — pass a compatible interface
    const target = Target.fromCell(topLeft)

    // Build the order using Order.withTarget and set mutable fields
    const order = NetworkOrder.withTarget(
      orderType,
      subjectId,
      target,
      false, // not queued
    )

    // Building to place
    order.targetString = this.variants[0].actorInfo.name

    // Actor ID to associate with placement
    order.extraData = this.queue.actor.actorId

    // Actor variant index packed in CPos
    order.extraLocation = new CPos(this._variant, 0)

    // Suppress visual feedback (targeting lines, etc.)
    order.suppressVisualFeedback = true

    yield order
  }

  // ---------------------------------------------------------------------------
  // Plug acceptance check
  // OpenRA 对照: PlaceBuildingOrderGenerator.AcceptsPlug(CPos, PlugInfo)
  // ---------------------------------------------------------------------------

  /**
   * Check if a cell contains an actor that accepts the given plug type.
   *
   * OpenRA 对照: PlaceBuildingOrderGenerator.AcceptsPlug(CPos, PlugInfo)
   *
   * Iterates all actors at the cell and checks if any Pluggable trait
   * accepts the plug type.
   *
   * @param cell — the target cell
   * @param plugInfo — the plug info with type string
   * @returns true if at least one actor at the cell accepts the plug
   */
  private _acceptsPlug(
    cell: CPos,
    plugInfo: IPlaceBuildingOGTraitInfo,
  ): boolean {
    const plugType = plugInfo.plugType
    if (!plugType) return false

    for (const a of this._world.actorMap.getActorsAt(cell)) {
      if (!a.traitsImplementing) continue

      const pluggables = a.traitsImplementing('Pluggable')
      if (!pluggables) continue

      for (const p of pluggables) {
        const pl = p as { acceptsPlug?: (type: string) => boolean }
        if (typeof pl.acceptsPlug === 'function' && pl.acceptsPlug(plugType)) {
          return true
        }
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Base proximity check
  // OpenRA 对照: BuildingInfo.IsCloseEnoughToBase(World, Player, ActorInfo, CPos)
  // ---------------------------------------------------------------------------

  /**
   * Check if the placement position is close enough to an existing base.
   *
   * OpenRA 对照: BuildingInfo.IsCloseEnoughToBase(World, Player, ActorInfo, CPos)
   *
   * NOTE: Full base provider range check requires iterating actors with
   * BaseProvider traits and checking distance. For Phase B, if the
   * building requires a base provider, we conservatively allow placement.
* Implement full BaseProvider range check.
   *
   * @param buildingInfo — the building info
   * @param _topLeft — the top-left cell of the footprint
   * @returns true if close enough to base
   */
  private _isCloseEnoughToBase(
    buildingInfo: IPlaceBuildingOGTraitInfo,
    _topLeft: CPos,
  ): boolean {
    // If base provider is not required, always close enough
    if (!buildingInfo.requiresBaseProvider) return true

    // Check if local player exists (null = always allow)
    if (!this._world.localPlayer) return true

    // NOTE: Full BaseProvider range check deferred ()
    return true
  }

  // ---------------------------------------------------------------------------
  // Building tile computation
  // OpenRA 对照: BuildingInfo.Tiles(CPos)
  // ---------------------------------------------------------------------------

  /**
   * Compute all footprint tiles for a building at topLeft.
   *
   * OpenRA 对照: BuildingInfo.Tiles(CPos)
   *
   * @param topLeft — the top-left cell
   * @param buildingInfo — the building info with dimensions
   * @returns array of all footprint cells
   */
  private _buildingTiles(
    topLeft: CPos,
    buildingInfo: IPlaceBuildingOGTraitInfo,
  ): CPos[] {
    const dims = buildingInfo.dimensions ?? (new CVec(1, 1))
    const result: CPos[] = []
    for (let y = 0; y < dims.Y; y++) {
      for (let x = 0; x < dims.X; x++) {
        result.push(CPos.add(topLeft, new CVec(x, y)))
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // TopLeft computation
  // OpenRA 对照: PlaceBuildingOrderGenerator.TopLeft (property)
  // ---------------------------------------------------------------------------

  /**
   * Compute the top-left cell for the current mouse position.
   *
   * OpenRA 对照: PlaceBuildingOrderGenerator.TopLeft
   *
   * Uses the viewport's last mouse position and the active variant's
   * preview offset to calculate the actual top-left cell.
   *
   * @returns the top-left cell position
   */
  private _computeTopLeft(): CPos {
    let offsetPos = this._viewport.lastMousePos
    const activeVariant = this.variants[this._variant]
    if (activeVariant?.preview) {
      const previewOffset = activeVariant.preview.topLeftScreenOffset
      const worldPx = this._viewport.viewToWorldPx(offsetPos)
      // NOTE: WPos here is the WorldRenderer's WPos interface (lowercase x,y,z),
      // NOT the WPos class from OpenRA.Game/WPos.ts (uppercase X,Y,Z).
      // The viewport interface (IPlaceBuildingOGViewport) uses the WorldRenderer
      // shape for forward/backward coordinate transforms in viewport space.
      const adjustedWPos: WPos = {
        x: worldPx.x + previewOffset.x,
        y: worldPx.y + previewOffset.y,
        z: worldPx.z,
      }
      offsetPos = this._viewport.worldToViewPx(adjustedWPos)
    }

    return this._viewport.viewToWorld(offsetPos)
  }

  // ---------------------------------------------------------------------------
  // Line build cell computation
  // OpenRA 对照: BuildingUtils.GetLineBuildCells (via world extension)
  // ---------------------------------------------------------------------------

  /**
   * Find cells and connector actors for wall line-building.
   *
   * OpenRA 对照: BuildingUtils.GetLineBuildCells(World, CPos, ActorInfo, BuildingInfo, Player)
   *
   * Simplified version for the order generator — searches four cardinal
   * directions from topLeft to find existing connectors.
   *
   * @returns array of line build cells
   */
  private _getLineBuildCells(
    topLeft: CPos,
    _actorInfo: IPlaceBuildingOGActorInfo,
    _buildingInfo: IPlaceBuildingOGTraitInfo,
    _owner: PlayerStub | undefined,
    segmentInfo: IPlaceBuildingOGActorInfo,
    segmentBuildingInfo: IPlaceBuildingOGTraitInfo,
  ): readonly { cell: CPos; connector: IGameActor | null }[] {
    const results: { cell: CPos; connector: IGameActor | null }[] = []

    // Always include the initial cell
    if (
      this._world.map.contains(topLeft) &&
      this._world.isCellBuildable(topLeft, segmentInfo, segmentBuildingInfo)
    ) {
      results.push({ cell: topLeft, connector: null })
    }

    // Search four cardinal directions for connectors
    const vecs: readonly CVec[] = [
      new CVec(1, 0),
      new CVec(0, 1),
      new CVec(-1, 0),
      new CVec(0, -1),
    ]
    const lineBuildInfo = this.variants[this._variant].lineBuildInfo
    const range = lineBuildInfo?.range ?? 5

    for (let d = 0; d < 4; d++) {
      let dirLimit = -1
      let connector: IGameActor | null = null

      for (let i = 1; i <= range; i++) {
        const c = CPos.add(
          topLeft,
          new CVec(i * vecs[d].X, i * vecs[d].Y),
        )

        if (!this._world.map.contains(c)) {
          dirLimit = -1
          break
        }

        // If cell is buildable or not visible, continue searching
        if (
          this._world.isCellBuildable(c, segmentInfo, segmentBuildingInfo) ||
          !this._world.shroud.isExplored(c)
        ) {
          continue
        }

        // Cell is occupied — check if any actor is a LineBuildNode
        for (const a of this._world.actorMap.getActorsAt(c)) {
          if (!a.traitsImplementing) continue
          const nodes = a.traitsImplementing('LineBuildNode')
          if (!nodes) continue

          for (const n of nodes) {
            const node = n as { info?: { nodeTypes?: ReadonlySet<string> } }
            if (!node.info?.nodeTypes) continue

            // Check type overlap
            let typeMatches = false
            for (const nt of node.info.nodeTypes) {
              const nodeTypeSet = lineBuildInfo?.nodeTypes
              if (nodeTypeSet?.has(nt)) {
                typeMatches = true
                break
              }
            }
            if (!typeMatches) continue

            connector = a
            break
          }
          if (connector) break
        }

        dirLimit = connector !== null ? i : -1
        break
      }

      // Place intermediate line sections
      if (dirLimit > 1 && connector) {
        for (let i = 1; i < dirLimit; i++) {
          const cell = CPos.add(
            topLeft,
            new CVec(i * vecs[d].X, i * vecs[d].Y),
          )
          results.push({ cell, connector })
        }
      }
    }

    // Deduplicate — exclude results where cell overlaps the topLeft (already added initially)
    // and results already in the list
    const seenBits = new Set<number>()
    seenBits.add(topLeft.Bits)
    const deduped: { cell: CPos; connector: IGameActor | null }[] = [
      { cell: topLeft, connector: null },
    ]
    for (const r of results) {
      if (!seenBits.has(r.cell.Bits)) {
        seenBits.add(r.cell.Bits)
        deduped.push(r)
      }
    }

    // Return only deduped results (excluding the initial cell which was validated)
    return deduped.filter((r) => r.cell.Bits !== topLeft.Bits)
  }

  // ---------------------------------------------------------------------------
  // ClearBlockersOrders — generate orders to clear blocking actors
  // OpenRA 对照: AIUtils.ClearBlockersOrders(List<CPos>, Player)
  // ---------------------------------------------------------------------------

  /**
   * Generate orders to clear blocking actors from the building footprint.
   *
   * OpenRA 对照: AIUtils.ClearBlockersOrders(buildingInfo.Tiles(topLeft).ToList(), owner)
   *
   * TODO-14.AI: Implement full AI blocker-clearing logic. Currently returns
   * an empty generator — blocker handling deferred to AI system migration.
   *
   * @returns iterator of orders to clear blockers (currently empty)
   */
  private *_clearBlockersOrders(): Generator<NetworkOrder | null> {
    // TODO-14.AI: Implement AIUtils.ClearBlockersOrders
    // Returns empty — clearing blockers is deferred to AI system migration
    // (always yields nothing)
  }

  // ---------------------------------------------------------------------------
  // Public helpers (exposed for testing)
  // ---------------------------------------------------------------------------

  /**
   * Get the current variant index (exposed for testing).
   *
   * OpenRA 对照: PlaceBuildingOrderGenerator.variant (field)
   */
  get variant(): number {
    return this._variant
  }
}

// ---------------------------------------------------------------------------
// IPlaceBuildingOGViewport — minimal viewport interface
// OpenRA 对照: Viewport (子集)
// ---------------------------------------------------------------------------

/**
 * Minimal viewport interface for coordinate transforms.
 *
 * OpenRA 对照: Viewport (子集: LastMousePos, ViewToWorldPx, WorldToViewPx, ViewToWorld)
 */
export interface IPlaceBuildingOGViewport {
  /** Last mouse position in viewport pixels. */
  readonly lastMousePos: Int2

  /** Convert viewport pixel to world position. */
  viewToWorldPx(viewPos: Int2): WPos

  /** Convert world position to viewport pixel. */
  worldToViewPx(worldPos: WPos): Vec2

  /** Convert viewport pixel to world cell. */
  viewToWorld(viewPos: Int2): CPos
}

// ---------------------------------------------------------------------------
// Helper: MakeCellType
// OpenRA 对照: PlaceBuildingOrderGenerator.MakeCellType(bool, bool)
// ---------------------------------------------------------------------------

/**
 * Compute a PlaceBuildingCellType flag value from validity and line-build status.
 *
 * OpenRA 对照: PlaceBuildingOrderGenerator.MakeCellType(bool valid, bool lineBuild = false)
 *
 * @param valid — whether the cell is valid for placement
 * @param lineBuild — whether this is a line-build cell
 * @returns the combined PlaceBuildingCellType flags
 */
function makeCellType(
  valid: boolean,
  lineBuild: boolean = false,
): PlaceBuildingCellType {
  const cell = valid ? PlaceBuildingCellType.Valid : PlaceBuildingCellType.Invalid
  if (lineBuild) {
    return (cell | PlaceBuildingCellType.LineBuild) as PlaceBuildingCellType
  }
  return cell
}
