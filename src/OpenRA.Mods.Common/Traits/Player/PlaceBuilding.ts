/**
 * PlaceBuilding.ts — 建筑放置处理器：处理放置建筑/线性建筑/插头订单，
 *   创建 actor、触发通知、结束生产队列项
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/PlaceBuilding.cs (268 lines)
 *
 * 核心范式转换:
 * - C# RuntimeFlagInit → TS PlaceBuildingInit extends ActorInit<void>
 * - C# TraitInfo<T> → TS ITraitInfo 接口实现
 * - C# HotkeyReference → TS 导入真实 HotkeyReference (已迁移)
 * - C# Game.Sound.PlayToPlayer / PlayNotification → TS 桩 (TODO-8.F)
 * - C# TextNotificationsManager.AddTransientLine → TS 桩 (TODO-16.X)
 * - C# WorldExtensions trait queries → TS 显式回调接口
 * - C# frameEndTask → TS 直接执行 (无帧尾任务调度，单线程)
 * - C# LINQ (AllQueued, FirstOrDefault, SelectMany, Distinct) → TS 显式循环
 */

import type {
  IGameActor,
  ITraitInfo,
  ITick,
  IResolveOrder,
  PlayerStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../../OpenRA.Game/Traits/Target.js'
import { HotkeyReference } from '../../../OpenRA.Game/Input/HotkeyReference.js'
import {
  ActorInit,
  type ISingleInstanceInit,
} from '../../../OpenRA.Game/ActorInitializer.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type { CVec } from '../../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// Minimal dependency interfaces for easy unit testing
// OpenRA 对照: 各 C# 类型子集（World, Actor, ProductionQueue, ...）
// ---------------------------------------------------------------------------

/** Minimal actor info for PlaceBuilding logic.
 *
 * OpenRA 对照: ActorInfo (子集: Name, TraitInfoOrDefault, TraitInfos)
 */
export interface IPlaceBuildingActorInfo {
  /** Unique actor type name. */
  readonly name: string

  /** Check if a trait info type exists. */
  hasTraitInfo(traitName: string): boolean

  /** Get all instances of a trait info by name. */
  getTraitInfos(traitName: string): readonly IPlaceBuildingTraitInfo[]

  /** Get a single trait info or null. */
  getTraitInfo(traitName: string): IPlaceBuildingTraitInfo | null
}

/** Minimal trait info queried during placement.
 *
 * OpenRA 对照: various trait info types (BuildingInfo, ReplacementInfo, PlugInfo, ...)
 */
export interface IPlaceBuildingTraitInfo {
  /** The trait class name (e.g. "BuildingInfo", "ReplacementInfo"). */
  readonly type: string

  /** The building dimensions, if this is a BuildingInfo. */
  readonly dimensions?: CVec

  /** Build sound names, if this is a BuildingInfo. */
  readonly buildSounds?: readonly string[]

  /** Whether building requires a base provider. */
  readonly requiresBaseProvider?: boolean

  /** Whether invalid placement is allowed (debug mode). */
  readonly allowInvalidPlacement?: boolean

  /** Replacement type tags, if this is a ReplacementInfo. */
  readonly replaceableTypes?: ReadonlySet<string>

  /** Node types for line build. */
  readonly nodeTypes?: ReadonlySet<string>

  /** Segment actor type for line build. */
  readonly segmentType?: string | null

  /** Plug type, if this is a PlugInfo. */
  readonly plugType?: string | null

  /** Force faction override. */
  readonly forceFaction?: string | null

  /** Offset for plug placement. */
  readonly offset?: CVec

  /** Arbitrary additional data (for duck-typing variant traits). */
  readonly [key: string]: unknown
}

/** Minimal production item visible to PlaceBuilding.
 *
 * OpenRA 对照: ProductionItem (子集: Done, Item)
 */
export interface IPlaceBuildingProductionItem {
  /** Whether this item has completed production. */
  readonly done: boolean

  /** The actor name being produced. */
  readonly item: string
}

/** Minimal production queue interface for PlaceBuilding.
 *
 * OpenRA 对照: ProductionQueue (子集: CanBuild, AllQueued, EndProduction,
 *   MostLikelyProducer, BuildableItems)
 */
export interface IPlaceBuildingProductionQueue {
  /** Check if this queue can build the given actor type. */
  canBuild(actorInfo: IPlaceBuildingActorInfo): boolean

  /** Get all queued items (both in-progress and completed). */
  allQueued(): readonly IPlaceBuildingProductionItem[]

  /** End production of a completed item. */
  endProduction(item: IPlaceBuildingProductionItem): void

  /** Get the most likely producer for this queue. */
  mostLikelyProducer(): IPlaceBuildingProducer | null

  /** Get all buildable item names. */
  buildableItems(): readonly IPlaceBuildingActorInfo[]
}

/** Minimal producer reference for PlaceBuilding.
 *
 * OpenRA 对照: ProductionQueue.ProducerInfo.MostLikelyProducer()
 */
export interface IPlaceBuildingProducer {
  /** The producing actor (may be null). */
  readonly actor: IGameActor | null

  /** The producing trait itself (may have Faction). */
  readonly trait?: { readonly faction?: string } | null
}

/** Minimal map abstraction for cell containment.
 *
 * OpenRA 对照: Map (子集: CellContaining, Contains, Rules)
 */
export interface IPlaceBuildingMap {
  /** Convert a world position to a cell coordinate. */
  cellContaining(pos: unknown): CPos

  /** Check if a cell is within the map bounds. */
  contains(cell: CPos): boolean

  /** The ruleset for actor type lookups. */
  readonly rules: IPlaceBuildingRules
}

/** Minimal ruleset abstraction.
 *
 * OpenRA 对照: Ruleset (子集: Actors indexer)
 */
export interface IPlaceBuildingRules {
  /** Get actor info by name. */
  getActorInfo(name: string): IPlaceBuildingActorInfo | undefined
}

/** Minimal building-influence abstraction for building occupancy checks.
 *
 * OpenRA 对照: BuildingInfluence (子集: AnyBuildingAt)
 */
export interface IPlaceBuildingInfluence {
  /** Check if any building occupies a cell. */
  anyBuildingAt(cell: CPos): boolean
}

/** Minimal actor-map abstraction.
 *
 * OpenRA 对照: ActorMap (子集: GetActorsAt)
 */
export interface IPlaceBuildingActorMap {
  /** Get all actors at a cell. */
  getActorsAt(cell: CPos): IGameActor[]
}

/** Minimal base provider abstraction.
 *
 * OpenRA 对照: BaseProvider (子集: BeginCooldown)
 */
export interface IPlaceBuildingBaseProvider {
  /** Start the cooldown after building placement. */
  beginCooldown(): void
}

/** Minimal building utils abstraction for placement validation.
 *
 * OpenRA 对照: BuildingUtils (子集: canPlaceBuilding, getLineBuildCells)
 */
export interface IPlaceBuildingUtils {
  /** Check if a full building footprint can be placed at the given position. */
  canPlaceBuilding(
    world: IPlaceBuildingWorld,
    topLeft: CPos,
    actorInfo: IPlaceBuildingActorInfo,
    buildingInfo: IPlaceBuildingTraitInfo,
    toIgnore?: IGameActor | null,
  ): boolean

  /** Find cells for wall line-building. */
  getLineBuildCells(
    world: IPlaceBuildingWorld,
    topLeft: CPos,
    actorInfo: IPlaceBuildingActorInfo,
    buildingInfo: IPlaceBuildingTraitInfo,
    lineBuildInfo: IPlaceBuildingTraitInfo,
    owner: PlayerStub,
  ): readonly ILineBuildCellResult[]
}

/** Result from line build cell search. */
export interface ILineBuildCellResult {
  readonly cell: CPos
  readonly connector: IGameActor | null
}

/** Minimal building info with placement validation logic.
 *
 * OpenRA 对照: BuildingInfo (子集: Tiles, IsCloseEnoughToBase,
 *   FindBaseProvider, RequiresBaseProvider)
 */
export interface IPlaceBuildingBuildingInfo extends IPlaceBuildingTraitInfo {
  /** Compute all footprint tiles from a top-left cell. */
  tiles(topLeft: CPos): CPos[]

  /** Check if the placement is close enough to an existing base. */
  isCloseEnoughToBase(
    world: IPlaceBuildingWorld,
    owner: PlayerStub,
    actorInfo: IPlaceBuildingActorInfo,
    topLeft: CPos,
  ): boolean

  /** Find a base provider within range of topLeft. */
  findBaseProvider(
    world: IPlaceBuildingWorld,
    owner: PlayerStub,
    topLeft: CPos,
  ): IPlaceBuildingBaseProvider | null
}

/** Complete world abstraction for PlaceBuilding operations.
 *
 * OpenRA 对照: World (子集: Map, ActorMap, BuildingInfluence,
 *   GetActorById, CreateActor, Remove, ActorsWithTrait)
 */
export interface IPlaceBuildingWorld {
  /** The map. */
  readonly map: IPlaceBuildingMap

  /** The actor map for cell queries. */
  readonly actorMap: IPlaceBuildingActorMap

  /** The building influence layer. */
  readonly buildingInfluence: IPlaceBuildingInfluence

  /** Building placement validation utilities. */
  readonly buildingUtils: IPlaceBuildingUtils

  /** Get an actor by its numeric ID. */
  getActorById(id: number): IGameActor | null

  /** Create a new actor. */
  createActor(
    name: string,
    inits: ActorInit<unknown>[],
  ): IGameActor

  /** Remove an actor from the world. */
  remove(actor: IGameActor): void

  /** Get all actors implementing a given trait (by string name).
   *
   * OpenRA 对照: World.ActorsWithTrait<T>()
   */
  actorsWithTrait(
    traitName: string,
  ): Iterable<{ actor: IGameActor; trait: unknown }>

  /** The local player (may be null in headless/spec mode). */
  readonly localPlayer: PlayerStub | null
}

/** Minimal sound system stub.
 *
 * OpenRA 对照: Game.Sound (子集: PlayToPlayer, PlayNotification)
 *
 * NOTE: Full sound system is in Chapter 7 (Phase D).
 * These are stubs for PlaceBuilding logic only.
 */
export interface IPlaceBuildingSound {
  /** Play a sound to a specific player at a world position. */
  playToPlayer?(
    soundType: string,
    player: PlayerStub,
    sound: string,
    position?: unknown,
  ): void

  /** Play a notification sound. */
  playNotification?(
    rules: IPlaceBuildingRules | null,
    player: PlayerStub,
    channel: string,
    notification: string | null,
    faction: string,
  ): void

  /** Add a transient text notification line. */
  addTransientLine?(player: PlayerStub, text: string | null): void
}

// ---------------------------------------------------------------------------
// PlaceBuildingInit — marker init for placed buildings
// OpenRA 对照: PlaceBuildingInit : RuntimeFlagInit
// ---------------------------------------------------------------------------

/** Marker init indicating an actor was created through building placement
 * (not map start).
 *
 * OpenRA 对照: PlaceBuildingInit
 *
 * Extends `RuntimeFlagInit` which is not serializable — this init cannot
 * be saved to a replay file.
 */
export class PlaceBuildingInit
  extends ActorInit<void>
  implements ISingleInstanceInit
{
  readonly key = 'placeBuilding'

  get value(): void {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// PlaceBuildingInfo
// OpenRA 对照: PlaceBuildingInfo : TraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the PlaceBuilding trait.
 *
 * OpenRA 对照: PlaceBuildingInfo
 *
 * Attach this to the player actor to enable building placement order handling.
 */
export class PlaceBuildingInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Delay (in ticks) before playing the "new options available" notification
   * after building placement.
   *
   * OpenRA 对照: PlaceBuildingInfo.NewOptionsNotificationDelay (default 10)
   */
  readonly newOptionsNotificationDelay: number

  /** Speech notification to play if new construction options are available.
   *
   * OpenRA 对照: PlaceBuildingInfo.NewOptionsNotification
   */
  readonly newOptionsNotification: string | null

  /** Text notification to display if new construction options are available.
   *
   * OpenRA 对照: PlaceBuildingInfo.NewOptionsTextNotification
   */
  readonly newOptionsTextNotification: string | null

  /** Speech notification to play if building placement is not possible.
   *
   * OpenRA 对照: PlaceBuildingInfo.CannotPlaceNotification
   */
  readonly cannotPlaceNotification: string | null

  /** Text notification to display if building placement is not possible.
   *
   * OpenRA 对照: PlaceBuildingInfo.CannotPlaceTextNotification
   */
  readonly cannotPlaceTextNotification: string | null

  /** Hotkey to toggle between PlaceBuildingVariants when placing a structure.
   *
   * OpenRA 对照: PlaceBuildingInfo.ToggleVariantKey
   */
  readonly toggleVariantKey: HotkeyReference

  constructor(params: {
    instanceName?: string
    newOptionsNotificationDelay?: number
    newOptionsNotification?: string | null
    newOptionsTextNotification?: string | null
    cannotPlaceNotification?: string | null
    cannotPlaceTextNotification?: string | null
    toggleVariantKey?: HotkeyReference
  } = {}) {
    this.instanceName = params.instanceName
    this.newOptionsNotificationDelay =
      params.newOptionsNotificationDelay ?? 10
    this.newOptionsNotification = params.newOptionsNotification ?? null
    this.newOptionsTextNotification =
      params.newOptionsTextNotification ?? null
    this.cannotPlaceNotification = params.cannotPlaceNotification ?? null
    this.cannotPlaceTextNotification =
      params.cannotPlaceTextNotification ?? null
    this.toggleVariantKey =
      params.toggleVariantKey ?? new HotkeyReference()
  }
}

// ---------------------------------------------------------------------------
// PlaceBuilding
// OpenRA 对照: PlaceBuilding : IResolveOrder, ITick
// ---------------------------------------------------------------------------

/**
 * Handles building placement orders: "PlaceBuilding", "LineBuild", "PlacePlug".
 *
 * OpenRA 对照: PlaceBuilding
 *
 * Attached to the player actor. When a building order is received, this trait:
 * 1. Finds the completed production item in the appropriate queue
 * 2. Validates the placement location
 * 3. Creates the actor in the world
 * 4. Plays build sounds
 * 5. Notifies INotifyBuildingPlaced listeners
 * 6. Ends the production item
 * 7. Triggers base provider cooldown
 * 8. Checks for new build options and queues notification
 */
export class PlaceBuilding implements IResolveOrder, ITick {
  /** Configuration for this trait. */
  readonly info: PlaceBuildingInfo

  /** Whether a notification needs to be played (pending delay). */
  private _triggerNotification: boolean = false

  /** Tick counter for delayed notification. */
  private _tick: number = 0

  /** Stored sound reference for notification playback.
   *
   * OpenRA 对照: N/A (in C#, Sound is accessed via Game.Sound global)
   */
  private _sound: IPlaceBuildingSound | null = null

  constructor(info: PlaceBuildingInfo) {
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // IResolveOrder
  // OpenRA 对照: IResolveOrder.ResolveOrder(Actor self, Order order)
  // ---------------------------------------------------------------------------

  /** Resolve a "PlaceBuilding", "LineBuild", or "PlacePlug" order.
   *
   * OpenRA 对照: IResolveOrder.ResolveOrder(Actor self, Order order)
   *
   * NOTE: The world and sound dependencies are expected to have been injected
   * via setWorldContext() and setSoundContext() before resolveOrder is called.
   * This matches the pattern used by ProductionQueue which accesses world
   * through `self.world`.
   *
   * ## Frame-end task omission (vs OpenRA C#)
   *
   * OpenRA C# wraps the ENTIRE body in
   * `self.World.AddFrameEndTask(w => { ... })` to defer actor creation,
   * INotifyBuildingPlaced callbacks, and ProductionQueue.EndProduction
   * until after all in-tick logic completes. This prevents INotifyCreated
   * from firing mid-tick during world actor iteration.
   *
   * The TypeScript architecture does NOT use frame-end tasks for the
   * following reasons:
   *
   * 1. **Single-threaded execution**: TypeScript runs in a single-threaded
   *    event loop. Actor creation is synchronous and does not interleave
   *    with other callbacks (no C#-style coroutine yielding to tick).
   *
   * 2. **No intra-tick actor iteration**: The TS actor system uses
   *    explicit trait queries rather than `self.World.Actors.Values`
   *    enumeration inside tick loops. Creating actors during resolveOrder
   *    does not invalidate ongoing iterations.
   *
   * 3. **INotifyCreated ordering**: TS trait lifecycle methods
   *    (Created/AddedToWorld) fire synchronously during actor creation.
   *    Since there is no concurrent world-actor iteration, the ordering
   *    is safe: creation completes fully before any other logic runs.
   *
   * If in the future actor iteration becomes common during tick cycles,
   * a deferred action queue can be introduced to match OpenRA's
   * `AddFrameEndTask` pattern. For the current architecture, immediate
   * execution is correct and simpler.
   *
   * @param self — the player actor this trait is attached to
   * @param order — the order to resolve
   */
  resolveOrder(self: IGameActor, order: Order): void {
    // Access world through self.world (set on the actor by the game engine)
    const world = (self as unknown as Record<string, unknown>).world as
      | IPlaceBuildingWorld
      | undefined
    if (!world) return

    // Extract order string
    const os =
      (order as unknown as Record<string, unknown>).orderString as string
      ?? (order as unknown as Record<string, unknown>).orderName as string
      ?? ''
    if (os !== 'PlaceBuilding' && os !== 'LineBuild' && os !== 'PlacePlug') {
      return
    }

    const owner = self.owner
    if (!owner) return

    const prevItems = PlaceBuilding.getNumBuildables(owner, world)

    // Resolve target actor (the producer)
    const extraData =
      typeof (order as unknown as Record<string, unknown>).extraData === 'number'
        ? ((order as unknown as Record<string, unknown>).extraData as number)
        : 0
    const targetActor = world.getActorById(extraData)
    if (targetActor === null || targetActor === undefined || targetActor.isDead) {
      return
    }

    // Resolve the target location from the order's target
    const targetLocation = this._resolveTargetLocation(world, order, targetActor)

    // Find the actor info from the order's TargetString
    const targetString =
      ((order as unknown as Record<string, unknown>).targetString as string) ?? ''
    if (!targetString) return

    const rules = world.map.rules
    if (!rules) return

    let actorInfo = rules.getActorInfo(targetString)
    if (!actorInfo) return

    // Find a production queue that can build this and has a completed item
    const queue = this._findMatchingQueue(targetActor, actorInfo)
    if (!queue) return

    // Find the completed production item
    const item = this._findCompletedItem(queue, targetString)
    if (!item) return

    // ---- Handle variant override from ExtraLocation ----
    // OpenRA 对照: order.ExtraLocation.X > 0 → variant selection
    const extraLocation = (order as unknown as Record<string, unknown>).extraLocation as
      | { X?: number; Y?: number }
      | undefined
    if (extraLocation && typeof extraLocation.X === 'number' && extraLocation.X > 0) {
      const variantActors: string[] = []
      const variantInfos = actorInfo.getTraitInfos('PlaceBuildingVariantsInfo')
      for (const vi of variantInfos) {
        const actors = (vi as unknown as Record<string, unknown>).actors as
          | readonly string[]
          | undefined
        if (actors) {
          for (const a of actors) {
            variantActors.push(a)
          }
        }
      }
      const variantIndex = extraLocation.X - 1
      if (variantIndex < variantActors.length) {
        const variantInfo = rules.getActorInfo(variantActors[variantIndex])
        if (variantInfo) {
          actorInfo = variantInfo
        }
      }
    }

    // ---- Resolve faction ----
    const producer = queue.mostLikelyProducer()
    let faction =
      producer?.trait?.faction ??
      ((owner as unknown as Record<string, unknown>).faction as string) ??
      'random'
    const buildableInfo = actorInfo.getTraitInfo('BuildableInfo')
    if (buildableInfo?.forceFaction) {
      faction = buildableInfo.forceFaction as string
    }

    // ---- Resolve building info ----
    const buildingInfo = actorInfo.getTraitInfo('BuildingInfo')
    if (!buildingInfo) return

    // ---- Handle replacement logic ----
    this._handleReplacements(
      world,
      actorInfo,
      buildingInfo as IPlaceBuildingBuildingInfo,
      targetLocation,
    )

    // ---- Dispatch to specific order handler ----
    if (os === 'LineBuild') {
      this._handleLineBuild(
        self,
        world,
        actorInfo,
        buildingInfo as IPlaceBuildingBuildingInfo,
        targetLocation,
        faction,
        producer,
      )
    } else if (os === 'PlacePlug') {
      this._handlePlacePlug(
        self,
        world,
        actorInfo,
        buildingInfo,
        targetLocation,
      )
    } else {
      this._handleNormalPlacement(
        self,
        world,
        actorInfo,
        buildingInfo as IPlaceBuildingBuildingInfo,
        targetLocation,
        faction,
        producer,
      )
    }

    // ---- End the production item ----
    queue.endProduction(item)

    // ---- Trigger base provider cooldown ----
    if (buildingInfo.requiresBaseProvider) {
      const bp = (buildingInfo as IPlaceBuildingBuildingInfo).findBaseProvider?.(
        world,
        owner,
        targetLocation,
      )
      bp?.beginCooldown()
    }

    // ---- Check for new build options ----
    const newItems = PlaceBuilding.getNumBuildables(owner, world)
    if (newItems > prevItems) {
      this._triggerNotification = true
    }
  }

  // ---------------------------------------------------------------------------
  // ITick
  // OpenRA 对照: ITick.Tick(Actor self)
  // ---------------------------------------------------------------------------

  /** Tick the delayed notification timer.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   *
   * When a notification has been triggered, waits for the configured delay
   * before playing the "new options available" sound.
   *
   * @param self — the player actor this trait is attached to
   */
  tick(self: IGameActor): void {
    if (!this._triggerNotification) return

    this._tick++
    if (this._tick >= this.info.newOptionsNotificationDelay) {
      this._playNotification(self)
    }
  }

  // ---------------------------------------------------------------------------
  // Context injection (for tests and production wiring)
  // ---------------------------------------------------------------------------

  /** Inject the sound system context for notification playback.
   *
   * OpenRA 对照: N/A (C# uses Game.Sound global singleton)
   *
   * Called by the game engine or tests to provide the sound system.
   *
   * @param sound — the sound system interface
   */
  setSoundContext(sound: IPlaceBuildingSound | null): void {
    this._sound = sound
  }

  // ---------------------------------------------------------------------------
  // getNumBuildables — static utility
  // OpenRA 对照: PlaceBuilding.GetNumBuildables(Player p)
  // ---------------------------------------------------------------------------

  /** Count the number of distinct buildable items for a player.
   *
   * OpenRA 对照: PlaceBuilding.GetNumBuildables(Player p)
   *
   * This only matters for local players. For non-local players, returns 0.
   *
   * @param p — the player to count buildables for
   * @param world — the world (for trait querying)
   * @returns the distinct count of buildable actor names
   */
  static getNumBuildables(
    p: PlayerStub,
    world: IPlaceBuildingWorld,
  ): number {
    // This only matters for local players
    if (p !== world.localPlayer) return 0

    const buildableNames = new Set<string>()
    for (const { actor, trait: _trait } of world.actorsWithTrait(
      'ProductionQueue',
    )) {
      if (actor.owner !== p) continue

      const queue = _trait as IPlaceBuildingProductionQueue
      for (const bi of queue.buildableItems()) {
        buildableNames.add(bi.name)
      }
    }

    return buildableNames.size
  }

  // ---------------------------------------------------------------------------
  // Private: order resolution helpers
  // ---------------------------------------------------------------------------

  /** Resolve the target location CPos from the order's target.
   *
   * OpenRA 对照: w.Map.CellContaining(order.Target.CenterPosition)
   */
  private _resolveTargetLocation(
    world: IPlaceBuildingWorld,
    order: Order,
    fallbackActor: IGameActor,
  ): CPos {
    // Access the public `target` getter on the real Order class.
    // At runtime, the Order instance passed is the full Order class from
    // Network/Order.ts, which exposes `target: Target`.
    // NOTE: The Order type in TraitsInterfaces is OrderStub (minimal interface);
    // we narrow to the accessor shape needed here.
    const orderTarget = (order as unknown as { target: Target }).target
    try {
      return world.map.cellContaining(orderTarget.centerPosition)
    } catch {
      // Target may be Invalid; fall through to fallback
    }
    // Fallback: use target actor's location
    const loc = (fallbackActor as unknown as Record<string, unknown>).location as
      | CPos
      | undefined
    if (loc) return loc
    // Last resort: return zero cell
    return CPos.Zero
  }

  /** Find a production queue on the target actor that can build actorInfo
   * and has a completed item for it.
   */
  private _findMatchingQueue(
    targetActor: IGameActor,
    actorInfo: IPlaceBuildingActorInfo,
  ): IPlaceBuildingProductionQueue | null {
    if (!targetActor.traitsImplementing) return null

    const iter = targetActor.traitsImplementing('ProductionQueue')
    if (!iter) return null

    for (const q of iter) {
      const queue = q as IPlaceBuildingProductionQueue
      if (!queue.canBuild(actorInfo)) continue

      for (const qi of queue.allQueued()) {
        if (qi.done && qi.item === actorInfo.name) {
          return queue
        }
      }
    }

    return null
  }

  /** Find a completed production item in the queue for the given actor name. */
  private _findCompletedItem(
    queue: IPlaceBuildingProductionQueue,
    actorName: string,
  ): IPlaceBuildingProductionItem | null {
    for (const item of queue.allQueued()) {
      if (item.done && item.item === actorName) return item
    }
    return null
  }

  /** Remove replaceable actors from the building footprint before placement.
   *
   * OpenRA 对照: foreach + ActorMap.GetActorsAt + Replaceable overlap check
   */
  private _handleReplacements(
    world: IPlaceBuildingWorld,
    actorInfo: IPlaceBuildingActorInfo,
    buildingInfo: IPlaceBuildingBuildingInfo,
    targetLocation: CPos,
  ): void {
    const replaceableTypes = new Set<string>()
    const replacementInfos = actorInfo.getTraitInfos('ReplacementInfo')
    for (const ri of replacementInfos) {
      const rt = ri.replaceableTypes
      if (rt) {
        for (const t of rt) replaceableTypes.add(t)
      }
    }

    if (replaceableTypes.size === 0) return

    for (const t of buildingInfo.tiles(targetLocation)) {
      for (const a of world.actorMap.getActorsAt(t)) {
        if (!a.traitsImplementing) continue
        const replaceables = a.traitsImplementing('Replaceable')
        if (!replaceables) continue

        for (const r of replaceables) {
          const replaceable = r as {
            isTraitDisabled?: boolean
            info?: { types?: ReadonlySet<string> }
          }
          if (replaceable.isTraitDisabled) continue
          if (!replaceable.info?.types) continue

          for (const rt of replaceable.info.types) {
            if (replaceableTypes.has(rt)) {
              world.remove(a)
              break
            }
          }
        }
      }
    }
  }

  /** Handle a normal "PlaceBuilding" order.
   *
   * OpenRA 对照: PlaceBuilding.ResolveOrder else clause (line 202-225)
   */
  private _handleNormalPlacement(
    self: IGameActor,
    world: IPlaceBuildingWorld,
    actorInfo: IPlaceBuildingActorInfo,
    buildingInfo: IPlaceBuildingBuildingInfo,
    targetLocation: CPos,
    faction: string,
    producer: IPlaceBuildingProducer | null,
  ): void {
    const owner = self.owner!
    const sound = this._sound

    // Validate placement
    if (
      !world.buildingUtils.canPlaceBuilding(
        world,
        targetLocation,
        actorInfo,
        buildingInfo,
        null,
      ) ||
      !buildingInfo.isCloseEnoughToBase(world, owner, actorInfo, targetLocation)
    ) {
      // Play cannot-place notification if configured
      if (this.info.cannotPlaceNotification && sound?.playNotification) {
        sound.playNotification(
          world.map.rules,
          owner,
          'Speech',
          this.info.cannotPlaceNotification,
          faction,
        )
      }
      return
    }

    // Create the building actor
    const building = world.createActor(actorInfo.name, [
      new _LocationInit(targetLocation),
      new _OwnerInit(owner),
      new _FactionInit(faction),
      new PlaceBuildingInit(),
    ])

    // Play build sounds
    const buildSounds = buildingInfo.buildSounds
    if (buildSounds && sound?.playToPlayer) {
      const cp = (building as unknown as Record<string, unknown>).centerPosition
      for (const s of buildSounds) {
        sound.playToPlayer('World', owner, s, cp)
      }
    }

    // Notify INotifyBuildingPlaced on producer and self
    if (producer?.actor) {
      this._notifyBuildingPlaced(producer.actor, building)
    }
    this._notifyBuildingPlaced(self, building)
  }

  /** Handle a "LineBuild" order (wall placement with segments).
   *
   * OpenRA 对照: PlaceBuilding.ResolveOrder LineBuild clause (line 120-178)
   */
  private _handleLineBuild(
    self: IGameActor,
    world: IPlaceBuildingWorld,
    actorInfo: IPlaceBuildingActorInfo,
    buildingInfo: IPlaceBuildingBuildingInfo,
    targetLocation: CPos,
    faction: string,
    producer: IPlaceBuildingProducer | null,
  ): void {
    const owner = self.owner!
    const sound = this._sound

    // Build the parent actor first
    const placed = world.createActor(actorInfo.name, [
      new _LocationInit(targetLocation),
      new _OwnerInit(owner),
      new _FactionInit(faction),
      new PlaceBuildingInit(),
    ])

    // Play build sounds for parent
    const parentBuildSounds = buildingInfo.buildSounds
    if (parentBuildSounds && sound?.playToPlayer) {
      const cp = (placed as unknown as Record<string, unknown>).centerPosition
      for (const s of parentBuildSounds) {
        sound.playToPlayer('World', owner, s, cp)
      }
    }

    // Notify on producer and self
    if (producer?.actor) {
      this._notifyBuildingPlaced(producer.actor, placed)
    }
    this._notifyBuildingPlaced(self, placed)

    // Get LineBuildInfo for segment type
    const lineBuildInfo = actorInfo.getTraitInfo('LineBuildInfo')
    if (!lineBuildInfo) return

    let segmentType: string | null =
      (lineBuildInfo.segmentType as string) ?? null
    if (!segmentType || segmentType === '') {
      segmentType = actorInfo.name
    }

    // Find line build cells and create segments
    const lineCells = world.buildingUtils.getLineBuildCells(
      world,
      targetLocation,
      actorInfo,
      buildingInfo,
      lineBuildInfo,
      owner,
    )

    for (const t of lineCells) {
      // Skip the initial placement cell (already created as parent)
      if (t.cell.X === targetLocation.X && t.cell.Y === targetLocation.Y) {
        continue
      }

      const segmentInfo = world.map.rules.getActorInfo(segmentType)
      if (!segmentInfo) continue

      const segBuildingInfo = segmentInfo.getTraitInfo('BuildingInfo')
      if (!segBuildingInfo) continue

      // Handle replacement for segment type
      this._handleReplacements(
        world,
        segmentInfo,
        segBuildingInfo as IPlaceBuildingBuildingInfo,
        t.cell,
      )

      // NOTE: LineBuildDirectionInit and LineBuildParentInit are created
      // as generic inits to avoid circular module dependencies.
      // The actual LineBuild trait in LineBuild.ts resolves these at
      // addedToWorld time.
      const dirVal = t.cell.X === targetLocation.X ? 'Y' : 'X'
      const parentRefs = t.connector
        ? [t.connector, placed]
        : [placed]

      // Create segment actor
      const segment = world.createActor(segmentType, [
        new _LocationInit(t.cell),
        new _OwnerInit(owner),
        new _FactionInit(faction),
        new _GenericInit('lineBuildDirection', dirVal),
        new _GenericInit('lineBuildParent', parentRefs),
        new PlaceBuildingInit(),
      ])

      // Notify on producer and self
      if (producer?.actor) {
        this._notifyBuildingPlaced(producer.actor, segment)
      }
      this._notifyBuildingPlaced(self, segment)
    }
  }

  /** Handle a "PlacePlug" order (enable plug on target building).
   *
   * OpenRA 对照: PlaceBuilding.ResolveOrder PlacePlug clause (line 179-201)
   */
  private _handlePlacePlug(
    self: IGameActor,
    world: IPlaceBuildingWorld,
    actorInfo: IPlaceBuildingActorInfo,
    buildingInfo: IPlaceBuildingTraitInfo,
    targetLocation: CPos,
  ): void {
    const owner = self.owner!
    const sound = this._sound

    const plugInfo = actorInfo.getTraitInfo('PlugInfo')
    if (!plugInfo || !plugInfo.plugType) return

    const plugType = plugInfo.plugType as string

    for (const a of world.actorMap.getActorsAt(targetLocation)) {
      if (!a.traitsImplementing) continue

      const pluggables: unknown[] = []
      const iter = a.traitsImplementing('Pluggable')
      if (iter) {
        for (const p of iter) pluggables.push(p)
      }

      // Filter pluggables that accept this plug type
      const acceptingPluggables = pluggables.filter((p) => {
        const pl = p as { acceptsPlug?: (type: string) => boolean }
        return (
          typeof pl.acceptsPlug === 'function' &&
          pl.acceptsPlug(plugType)
        )
      })

      if (acceptingPluggables.length === 0) continue

      // Find the pluggable at the correct offset, or take the first
      let pluggable = acceptingPluggables.find((p) => {
        const pl = p as {
          info?: { offset?: { X?: number; Y?: number } }
          self?: {
            location?: { X?: number; Y?: number }
          }
        }
        const offset = pl.info?.offset
        if (!offset || offset.X === undefined || offset.Y === undefined)
          return false
        const loc = pl.self?.location
        if (!loc || loc.X === undefined || loc.Y === undefined) return false
        return (
          loc.X + offset.X === targetLocation.X &&
          loc.Y + offset.Y === targetLocation.Y
        )
      })

      if (!pluggable) {
        pluggable = acceptingPluggables[0]
      }
      if (!pluggable) return

      const pl = pluggable as {
        enablePlug?: (actor: unknown, type: string) => void
      }
      if (typeof pl.enablePlug === 'function') {
        pl.enablePlug(a, plugType)
      }

      // Play build sounds
      const buildSounds = buildingInfo.buildSounds
      if (buildSounds && sound?.playToPlayer) {
        const cp = (a as unknown as Record<string, unknown>).centerPosition
        for (const s of buildSounds) {
          sound.playToPlayer('World', owner, s, cp)
        }
      }

      // Only process the first matching actor with pluggables
      break
    }
  }

  // ---------------------------------------------------------------------------
  // Private: notification helpers
  // ---------------------------------------------------------------------------

  /** Notify INotifyBuildingPlaced listeners on an actor about a placed building.
   *
   * OpenRA 对照: INotifyBuildingPlaced.BuildingPlaced(Actor self, Actor building)
   */
  private _notifyBuildingPlaced(
    notifier: IGameActor,
    building: IGameActor,
  ): void {
    if (!notifier.traitsImplementing) return

    const notifiers = notifier.traitsImplementing('INotifyBuildingPlaced')
    if (!notifiers) return

    for (const n of notifiers) {
      const nb = n as {
        buildingPlaced?: (self: unknown, building: unknown) => void
      }
      if (typeof nb.buildingPlaced === 'function') {
        nb.buildingPlaced(notifier, building)
      }
    }
  }

  /** Play the "new options available" notification.
   *
   * OpenRA 对照: PlaceBuilding.PlayNotification(Actor self)
   */
  private _playNotification(self: IGameActor): void {
    const sound = this._sound
    const owner = self.owner!

    if (sound?.playNotification) {
      sound.playNotification(
        null,
        owner,
        'Speech',
        this.info.newOptionsNotification,
        (owner as unknown as Record<string, unknown>).faction as string ?? 'random',
      )
    }

    if (sound?.addTransientLine) {
      sound.addTransientLine(owner, this.info.newOptionsTextNotification)
    }

    this._triggerNotification = false
    this._tick = 0
  }
}

// ---------------------------------------------------------------------------
// Internal init classes used by PlaceBuilding
// OpenRA 对照: LocationInit, OwnerInit, FactionInit (from ActorInitializer)
//
// NOTE: These are prefixed with _ to avoid conflicts with the
// ActorInitializer module's own init classes. At integration time, these
// will be replaced by direct imports from ActorInitializer.ts.
// ---------------------------------------------------------------------------

/** Init specifying the top-left cell of a building placement.
 *
 * OpenRA 对照: LocationInit
 */
class _LocationInit extends ActorInit<CPos> implements ISingleInstanceInit {
  readonly key = 'location'

  constructor(value: CPos) {
    super()
    this._v = value
  }

  private readonly _v: CPos

  get value(): CPos {
    return this._v
  }
}

/** Init specifying the owning player of a placed building.
 *
 * OpenRA 对照: OwnerInit
 */
class _OwnerInit extends ActorInit<PlayerStub> implements ISingleInstanceInit {
  readonly key = 'owner'

  constructor(value: PlayerStub) {
    super()
    this._v = value
  }

  private readonly _v: PlayerStub

  get value(): PlayerStub {
    return this._v
  }
}

/** Init specifying the faction of a placed building.
 *
 * OpenRA 对照: FactionInit
 */
class _FactionInit extends ActorInit<string> implements ISingleInstanceInit {
  readonly key = 'faction'

  constructor(value: string) {
    super()
    this._v = value
  }

  private readonly _v: string

  get value(): string {
    return this._v
  }
}

/** Generic init for any key-value pair not covered by the specific init types.
 *
 * OpenRA 对照: N/A (C# uses type-keyed inits directly)
 *
 * Used for LineBuildDirectionInit and LineBuildParentInit which would
 * normally live in LineBuild.ts. This avoids circular module dependencies.
 */
class _GenericInit<T> extends ActorInit<T> implements ISingleInstanceInit {
  readonly key: string

  constructor(key: string, value: T) {
    super()
    this.key = key
    this._v = value
  }

  private readonly _v: T

  get value(): T {
    return this._v
  }
}

