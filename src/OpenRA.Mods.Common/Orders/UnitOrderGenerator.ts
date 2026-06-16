/**
 * UnitOrderGenerator.ts — 单位指令序生成器：所有标准单位命令（移动、攻击、维修、俘获等）的核心生成器
 * OpenRA 对照: OpenRA.Mods.Common/Orders/UnitOrderGenerator.cs (224 lines)
 *
 * 核心范式转换:
 * - C# ScreenMap.ActorsAtMouse(mi) 2D 屏幕哈希 → TS ActorMap.getActorsAt(cell) CPU 空间哈希
 * - C# LINQ .SelectMany(trait => trait.Orders) → TS .flatMap()
 * - C# ref TargetModifiers / ref string cursor → TS TargetModifiers 值类型 + getCursor() 输出
 * - C# sealed class UnitOrderResult → TS { actor, order, trait, cursor, target } 对象字面量
 * - C# CheckSameOrder(IOrderTargeter, Order) 调试校验 → TS console.debug
 * - C# Game.Settings.Game 全局单例 → TS 构造器注入 IMouseSettings
 *
 * 所有标准单位命令通过此生成器：右击敌对单位=攻击，右击空地=移动，
 * 右击友方建筑=维修，右击友方运输工具=进入，等等。
 * 具体行为由各 actor 的 IIssueOrder traits 和 IOrderTargeter 实例决定。
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type { WPos } from '../../OpenRA.Game/WPos.js'
import type {
  IGameActor,
  IOrderTargeter,
  IIssueOrder,
  IMouseSettings,
  WorldStub,
  WorldRendererStub,
  PlayerStub,
  ActorInfoStub,
  TargetStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  MouseActionType,
  TargetModifiers,
  TargetModifiersExts,
  PlayerRelationship,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.js'
import { Target, TargetType, type Target as TargetType2 } from '../../OpenRA.Game/Traits/Target.js'
import {
  OrderGenerator,
  type IOrderGeneratorWorld,
} from './OrderGenerator.js'

// ---------------------------------------------------------------------------
// Extended interfaces for UnitOrderGenerator dependencies
// ---------------------------------------------------------------------------

/**
 * Extended world interface with actor map, shroud, and selection capabilities.
 *
 * OpenRA 对照: World.ScreenMap, World.ActorMap, World.Selection, World.Map
 */
export interface IUnitOrderGeneratorWorld extends IOrderGeneratorWorld {
  /** ActorMap for cell-level actor lookup.
   *
   * OpenRA 对照: World.ActorMap.GetActorsAt(CPos)
   */
  readonly actorMap: {
    getActorsAt(cell: CPos): readonly IGameActor[]
  }

  /** Shroud for fog-of-war visibility checks.
   *
   * OpenRA 对照: World.FogObscures(Actor)
   */
  readonly shroud: {
    fogObscures(actor: IGameActor): boolean
  } | null

  /** The local player.
   *
   * OpenRA 对照: World.LocalPlayer
   */
  readonly localPlayer: IUnitOrderPlayer | null

  /** The render player (player whose perspective is shown).
   *
   * OpenRA 对照: World.RenderPlayer
   */
  readonly renderPlayer: IUnitOrderPlayer | null

  /** Selection with actor array.
   *
   * OpenRA 对照: World.Selection (has .Actors property)
   */
  readonly selection: {
    readonly actors: readonly IGameActor[]
    clear(): void
  } | null

  /** Whether the game is over.
   *
   * OpenRA 对照: World.IsGameOver
   */
  readonly isGameOver: boolean

  /** Map for coordinate conversion.
   *
   * OpenRA 对照: World.Map.CellContaining(WPos)
   */
  readonly map: {
    cellContaining(pos: WPos): CPos
  } | null

  /** Frozen actor layer for fog-of-war target resolution.
   *
   * OpenRA 对照: World.ScreenMap.FrozenActorsAtMouse(Player, MouseInput)
   *
   * Optional — if null, frozen actor targeting is skipped.
   */
  readonly frozenActorLayer?: {
    frozenActorsAt(
      cell: CPos,
      renderPlayer: IUnitOrderPlayer,
    ): readonly IFrozenActorForOrder[]
  } | null
}

/**
 * Extended player interface with diplomacy and WinState checks.
 *
 * OpenRA 对照: Player (subset: Owner, WinState, PlayerActor, IsAlliedWith)
 */
export interface IUnitOrderPlayer extends PlayerStub {
  /** Win state — if not Undefined, game is over for this player.
   *
   * OpenRA 对照: Player.WinState
   */
  readonly winState: number

  /** The player's representative actor.
   *
   * OpenRA 对照: Player.PlayerActor
   */
  readonly playerActor: IGameActor | null

  /** Check if this player is allied with another.
   *
   * OpenRA 对照: Player.IsAlliedWith(Player)
   */
  isAlliedWith(other: IUnitOrderPlayer): boolean

  /** Get the diplomatic relationship with another player.
   *
   * OpenRA 对照: Player.RelationshipWith(Player)
   */
  relationshipWith(other: IUnitOrderPlayer): PlayerRelationship
}

/**
 * Frozen actor for order targeting.
 *
 * OpenRA 对照: FrozenActor (subset: Info, Visible, HasRenderables)
 */
export interface IFrozenActorForOrder {
  /** Whether this frozen actor is valid (not disposed). */
  readonly isValid: boolean

  /** Whether this frozen actor is currently visible. */
  readonly visible: boolean

  /** Whether this frozen actor has renderable visuals. */
  readonly hasRenderables: boolean

  /** The frozen actor's center position. */
  readonly centerPosition: WPos

  /** The frozen actor's trait metadata.
   *
   * OpenRA 对照: FrozenActor.Info
   */
  readonly info: IUnitOrderActorInfo
}

/**
 * Extended ActorInfo for target filtering.
 *
 * OpenRA 对照: ActorInfo.HasTraitInfo<T>()
 */
export interface IUnitOrderActorInfo extends ActorInfoStub {
  /** Check if this actor info has a specific trait.
   *
   * OpenRA 对照: ActorInfo.HasTraitInfo<TraitInfoInterface>()
   */
  hasTraitInfo(traitKey: string): boolean

  /** Get all trait infos for the given interface.
   *
   * OpenRA 对照: ActorInfo.TraitInfos<T>()
   */
  traitInfos<T>(interfaceId: string): readonly T[]
}

/**
 * Extended actor interface with owner, info, and trait lookup.
 *
 * OpenRA 对照: Actor (subset used by UnitOrderGenerator)
 */
export interface IUnitOrderActor extends IGameActor {
  owner: IUnitOrderPlayer
  info: IUnitOrderActorInfo
  isDead: boolean
  disposed: boolean
  traitsImplementing(interfaceId: string): unknown[]
}

// ---------------------------------------------------------------------------
// MouseInput — minimal mouse input for order generation
// ---------------------------------------------------------------------------

/**
 * Mouse input event data passed to order generators.
 *
 * OpenRA 对照: MouseInput (struct: Button, Event, Modifiers, Location)
 */
export interface IUnitOrderMouseInput {
  readonly button: number
  readonly event: string // 'Down' | 'Up' | 'Move'
  /** TargetModifiers bitmap (Ctrl→ForceAttack, Shift→ForceQueue, Alt→ForceMove).
   *
   * OpenRA 对照: MouseInput.Modifiers (mapped from Modifiers enum)
   */
  readonly modifiers: TargetModifiers
}

// ---------------------------------------------------------------------------
// UnitOrderResult — return type for orderForUnit()
// ---------------------------------------------------------------------------

/**
 * Result of resolving an order for a single actor against a target.
 *
 * OpenRA 对照: UnitOrderResult (sealed inner class of UnitOrderGenerator)
 */
export interface UnitOrderResult {
  readonly actor: IUnitOrderActor
  readonly order: IOrderTargeter
  readonly trait: IIssueOrder
  readonly cursor: string | null
  readonly target: TargetType2
}

// ---------------------------------------------------------------------------
// UnitOrderGenerator
// ---------------------------------------------------------------------------

/**
 * Core order generator for all standard unit commands.
 *
 * OpenRA 对照: UnitOrderGenerator : IOrderGenerator
 *
 * Handles all right-click contextual orders: attack, move, repair, capture,
 * guard, deploy, and any custom order defined by IIssueOrder traits.
 *
 * The generator works by:
 * 1. Resolving the target at the clicked cell (actor > frozen actor > cell)
 * 2. For each selected actor, finding the highest-priority IOrderTargeter
 *    that can target the resolved target
 * 3. Yielding a CreateGroup order (APM tracking) followed by each resolved order
 *
 * @param worldSelectCursor — cursor name for selectable actors (default "select")
 * @param worldDefaultCursor — cursor name for empty ground (default "default")
 */
export class UnitOrderGenerator extends OrderGenerator {
  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /** Debug validation that a targeter's OrderID matches the produced Order's OrderString.
   *
   * OpenRA 对照: static CheckSameOrder(IOrderTargeter, Order)
   */
  static checkSameOrder(iot: IOrderTargeter, order: Order | null): Order | null {
    if (order === null && iot.orderID !== null && iot.orderID !== '') {
      console.debug(
        `BUG: in order targeter - decided on ${iot.orderID} but then didn't order`,
      )
    } else if (order !== null && iot.orderID !== order.orderName) {
      console.debug(
        `BUG: in order targeter - decided on ${iot.orderID} but ordered ${order.orderName}`,
      )
    }
    return order
  }

  /**
   * Resolve a click target: live actor > frozen actor > cell.
   *
   * OpenRA 对照: protected static TargetForInput(World, CPos, int2, MouseInput)
   *
   * Priority order (matching C#):
   * 1. Live, non-dead, targetable, non-fog-obscured actor with highest priority
   * 2. Visible frozen actor with renderables and ITargetableInfo
   * 3. The map cell itself
   *
   * @param world — the game world
   * @param cell — the map cell under the cursor
   * @param _worldPixel — screen pixel position (unused — cell-based lookup replaces ScreenMap)
   * @param mi — mouse input event
   * @returns the resolved target
   */
  static targetForInput(
    world: IUnitOrderGeneratorWorld,
    cell: CPos,
    _worldPixel: { readonly x: number; readonly y: number },
    _mi: IUnitOrderMouseInput,
  ): TargetType2 {
    // 1. Live actors at the cell
    // OpenRA 对照: world.ScreenMap.ActorsAtMouse(mi)
    //   .Where(a => !a.Actor.IsDead && a.Actor.Info.HasTraitInfo<ITargetableInfo>() && !world.FogObscures(a.Actor))
    //   .WithHighestSelectionPriority(worldPixel, mi.Modifiers)
    const actorsAtCell = world.actorMap.getActorsAt(cell)
    const liveActors = actorsAtCell.filter((a) => {
      const actor = a as Partial<IUnitOrderActor>
      if (actor.isDead) return false
      if (!actor.info?.hasTraitInfo('ITargetableInfo')) return false
      if (world.shroud?.fogObscures(a) ?? false) return false
      return true
    })

    // Select highest priority live actor
    const highestPriLive = UnitOrderGenerator.pickHighestPriority(
      liveActors as IUnitOrderActor[],
    )
    if (highestPriLive) {
      return Target.fromActor(highestPriLive as unknown as IActorRef)
    }

    // 2. Frozen actors at the cell
    // OpenRA 对照: world.ScreenMap.FrozenActorsAtMouse(world.RenderPlayer, mi)
    //   .Where(a => a.Info.HasTraitInfo<ITargetableInfo>() && a.Visible && a.HasRenderables)
    //   .WithHighestSelectionPriority(worldPixel, mi.Modifiers)
    if (world.frozenActorLayer && world.renderPlayer) {
      const frozenActors = world.frozenActorLayer.frozenActorsAt(
        cell,
        world.renderPlayer,
      )
      for (const fa of frozenActors) {
        if (
          fa.info.hasTraitInfo('ITargetableInfo') &&
          fa.visible &&
          fa.hasRenderables
        ) {
          return Target.fromFrozenActor({
            isValid: fa.isValid,
            visible: fa.visible,
            hidden: !fa.visible,
            centerPosition: fa.centerPosition,
            targetablePositions: null,
          })
        }
      }
    }

    // 3. Fallback to cell target
    // OpenRA 对照: return Target.FromCell(world, cell)
    return Target.fromCell(cell)
  }

  /**
   * Pick the actor with the highest selection priority.
   *
   * OpenRA 对照: LINQ .WithHighestSelectionPriority(int2, Modifiers)
   *
   * In C#, this sorts by ISelectableInfo.SelectionPriority descending
   * and returns the first. In TS, we implement the same sorting logic.
   */
  private static pickHighestPriority(
    actors: readonly IUnitOrderActor[],
  ): IUnitOrderActor | null {
    if (actors.length === 0) return null

    // Sort by selection priority descending, then by actorId ascending (stable tiebreak)
    const sorted = [...actors].sort((a, b) => {
      const pa = (a as unknown as { selectionPriority?: number }).selectionPriority ?? 0
      const pb = (b as unknown as { selectionPriority?: number }).selectionPriority ?? 0
      if (pb !== pa) return pb - pa
      return a.actorId - b.actorId
    })
    return sorted[0]
  }

  // ---------------------------------------------------------------------------
  // Instance fields
  // ---------------------------------------------------------------------------

  protected readonly actionType: MouseActionType = MouseActionType.Contextual

  /** Cursor name for selectable actors.
   *
   * OpenRA 对照: readonly string worldSelectCursor = ChromeMetrics.Get<string>("WorldSelectCursor")
   */
  private readonly _worldSelectCursor: string

  /** Cursor name for empty ground.
   *
   * OpenRA 对照: readonly string worldDefaultCursor = ChromeMetrics.Get<string>("WorldDefaultCursor")
   */
  private readonly _worldDefaultCursor: string

  /** Injected mouse settings for button resolution and control style.
   *
   * OpenRA 对照: readonly GameSettings gameSettings
   */
  private readonly _gameSettings: IMouseSettings

  /** Injected world with full capabilities (actorMap, shroud, etc.).
   *
   * Stored separately from the base class _world for typed access.
   */
  private readonly _uow: IUnitOrderGeneratorWorld

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param world — the game world (must implement IUnitOrderGeneratorWorld)
   * @param settings — mouse settings for button resolution
   * @param worldSelectCursor — cursor name for selectable actors (default "select")
   * @param worldDefaultCursor — cursor name for empty ground (default "default")
   */
  constructor(
    world: IUnitOrderGeneratorWorld,
    settings: IMouseSettings,
    worldSelectCursor: string = 'select',
    worldDefaultCursor: string = 'default',
  ) {
    // OpenRA 对照: base(world) — but our OrderGenerator takes (key, world, settings)
    super('UnitOrderGenerator', world, settings)
    this._uow = world
    this._gameSettings = settings
    this._worldSelectCursor = worldSelectCursor
    this._worldDefaultCursor = worldDefaultCursor
  }

  // ---------------------------------------------------------------------------
  // OrderInner — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Produce orders for the clicked cell.
   *
   * OpenRA 对照: protected virtual IEnumerable<Order> OrderInner(World, CPos, int2, MouseInput)
   *
   * Pipeline: targetForInput → orderForUnit for each selected actor → CreateGroup → yield orders
   *
   * @param _world — the game world (unused — we use typed _uow)
   * @param cell — the map cell under the cursor
   * @param _modifiers — keyboard modifiers (unused — we extract from mi)
   * @param mi — mouse input event with modifiers
   */
  protected *orderInner(
    _world: WorldStub,
    cell: CPos,
    _modifiers: TargetModifiers,
    mi: unknown,
  ): Generator<Order | null> {
    const input = mi as IUnitOrderMouseInput | undefined
    if (!input) return

    const worldPixel = { x: 0, y: 0 } // cell-based lookup doesn't need pixel
    const target = UnitOrderGenerator.targetForInput(
      this._uow,
      cell,
      worldPixel,
      input,
    )

    const selectedActors = this._uow.selection?.actors ?? []
    if (selectedActors.length === 0) return

    const results = selectedActors
      .map((a) => this.orderForUnit(a as IUnitOrderActor, target, cell, input))
      .filter((o): o is UnitOrderResult => o !== null)

    const actorsInvolved = [...new Set(results.map((o) => o.actor))]
    if (actorsInvolved.length === 0) return

    // HACK: This is required by the hacky player actions-per-minute calculation
    // TODO: Reimplement APM properly and then remove this
    // OpenRA 对照: yield return new Order("CreateGroup", actorsInvolved[0].Owner.PlayerActor, false, actorsInvolved)
    yield {
      orderName: 'CreateGroup',
      targetString: actorsInvolved[0].owner?.playerName ?? '',
      extraData: {
        playerActor: actorsInvolved[0].owner?.playerActor ?? null,
        queued: false,
        actors: actorsInvolved,
      },
    }

    const queued = TargetModifiersExts.hasModifier(
      input.modifiers,
      TargetModifiers.ForceQueue,
    )

    for (const o of results) {
      const order = o.trait.issueOrder(o.actor, o.order, o.target as unknown as TargetStub, queued)
      yield UnitOrderGenerator.checkSameOrder(o.order, order)
    }
  }

  // ---------------------------------------------------------------------------
  // orderForUnit — per-actor targeter resolution
  // ---------------------------------------------------------------------------

  /**
   * Returns the most appropriate order for a given actor and target.
   * First priority is given to orders that interact with the given actors.
   * Second priority is given to actors in the given cell.
   *
   * OpenRA 对照: protected UnitOrderResult OrderForUnit(Actor, Target, CPos, MouseInput)
   *
   * Two-pass resolution (matching C#):
   * Pass 1: try all targeters against the actor/frozen-actor target
   * Pass 2: if no match, try all targeters against the cell target
   *
   * @param self — the actor issuing the order
   * @param target — the resolved target
   * @param xy — the cell under the cursor
   * @param mi — mouse input event
   * @returns the resolved order result, or null if no order applies
   */
  orderForUnit(
    self: IUnitOrderActor,
    target: TargetType2,
    xy: CPos,
    mi: IUnitOrderMouseInput,
  ): UnitOrderResult | null {
    // OpenRA 对照: if (self.Owner != self.World.LocalPlayer) return null
    if (self.owner !== this._uow.localPlayer) return null

    // OpenRA 对照: if (self.World.IsGameOver) return null
    if (this._uow.isGameOver) return null

    // OpenRA 对照: if (self.Disposed || !target.IsValidFor(self)) return null
    if (self.disposed || !target.isValidFor(self as unknown as IActorRef)) return null

    // Build TargetModifiers from keyboard modifier states
    // OpenRA 对照: var modifiers = TargetModifiers.None ... Ctrl→ForceAttack ...
    let modifiers: TargetModifiers = TargetModifiers.None
    if (TargetModifiersExts.hasModifier(mi.modifiers, TargetModifiers.ForceAttack))
      modifiers = (modifiers | TargetModifiers.ForceAttack) as TargetModifiers
    if (TargetModifiersExts.hasModifier(mi.modifiers, TargetModifiers.ForceQueue))
      modifiers = (modifiers | TargetModifiers.ForceQueue) as TargetModifiers
    if (TargetModifiersExts.hasModifier(mi.modifiers, TargetModifiers.ForceMove))
      modifiers = (modifiers | TargetModifiers.ForceMove) as TargetModifiers

    // Collect all IIssueOrder traits, flatten IOrderTargeter[], sort by priority desc
    // OpenRA 对照: self.TraitsImplementing<IIssueOrder>()
    //   .SelectMany(trait => trait.Orders.Select(x => new { Trait = trait, Order = x }))
    //   .OrderByDescending(x => x.Order.OrderPriority).ToList()
    const issOrders = (self.traitsImplementing('IIssueOrder') ?? []) as IIssueOrder[]
    const flatOrders = issOrders.flatMap((trait) =>
      (trait.orders ?? []).map((order) => ({
        trait,
        order,
      })),
    )
    flatOrders.sort((a, b) => b.order.orderPriority - a.order.orderPriority)

    // Two-pass resolution (matching C# for-loop i=0, i=1)
    // Pass 1: actor / frozen-actor target
    // Pass 2: cell target
    let currentTarget = target
    for (let pass = 0; pass < 2; pass++) {
      for (const { trait, order } of flatOrders) {
        if (order.canTarget(
          self as unknown as IGameActor,
          currentTarget as unknown as TargetStub,
          modifiers,
          '',
        )) {
          // Resolve cursor: try getCursor if available, otherwise null
          let cursor: string | null = null
          const targeterWithCursor = order as unknown as { getCursor?(): string }
          if (typeof targeterWithCursor.getCursor === 'function') {
            cursor = targeterWithCursor.getCursor()
          }
          return {
            actor: self,
            order,
            trait,
            cursor,
            target: currentTarget,
          }
        }
      }

      // No valid orders, so check for orders against the cell
      // OpenRA 对照: target = Target.FromCell(self.World, xy)
      currentTarget = Target.fromCell(xy)
    }

    return null
  }

  // ---------------------------------------------------------------------------
  // getCursor — cursor resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve the cursor for the current cell.
   *
   * OpenRA 对照: public virtual string GetCursor(World, CPos, int2, MouseInput)
   *
   * Classic mode: select cursor if target is selectable and not overriding selection
   * Standard mode: highest-priority order cursor, or select cursor for selectable actors
   *
   * @param _world — the game world (unused)
   * @param cell — the map cell under the cursor
   * @param _worldPixel — screen pixel position
   * @param mi — mouse input event
   * @returns cursor name string
   */
  getCursor(
    _world: WorldStub,
    cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): string {
    const input = mi as IUnitOrderMouseInput | undefined
    if (!input) return this._worldDefaultCursor

    const worldPixel = _worldPixel ?? { x: 0, y: 0 }
    const target = UnitOrderGenerator.targetForInput(
      this._uow,
      cell,
      worldPixel,
      input,
    )

    let useSelect: boolean

    if (
      this._gameSettings.mouseControlStyle === 'classic' &&
      !this.inputOverridesSelection(this._uow, worldPixel, input)
    ) {
      // Classic mode: use select cursor if target is a selectable actor
      // OpenRA 对照: useSelect = target.Type == TargetType.Actor && target.Actor.Info.HasTraitInfo<ISelectableInfo>()
      useSelect =
        target.type === TargetType.Actor &&
        this.isTargetSelectable(target)
    } else {
      // Standard mode: check orders for cursor
      // OpenRA 对照: var ordersWithCursor = world.Selection.Actors.Select(a => OrderForUnit(...)).Where(o => o != null && o.Cursor != null)
      const selectedActors = this._uow.selection?.actors ?? []
      const ordersWithCursor = selectedActors
        .map((a) =>
          this.orderForUnit(a as IUnitOrderActor, target, cell, input),
        )
        .filter(
          (o): o is UnitOrderResult =>
            o !== null && o.cursor !== null && o.cursor !== '',
        )

      // Highest priority order with a cursor
      // OpenRA 对照: var cursorOrder = ordersWithCursor.MaxByOrDefault(o => o.Order.OrderPriority)
      let cursorOrder: UnitOrderResult | null = null
      for (const o of ordersWithCursor) {
        if (
          !cursorOrder ||
          o.order.orderPriority > cursorOrder.order.orderPriority
        ) {
          cursorOrder = o
        }
      }

      useSelect =
        target.type === TargetType.Actor &&
        this.isTargetSelectable(target) &&
        (cursorOrder === null ||
          selectedActors.length === 0 ||
          !this.inputOverridesSelection(this._uow, worldPixel, input))

      if (!useSelect && cursorOrder !== null) {
        return cursorOrder.cursor!
      }
    }

    return useSelect ? this._worldSelectCursor : this._worldDefaultCursor
  }

  // ---------------------------------------------------------------------------
  // inputOverridesSelection — check if click is an order vs selection
  // ---------------------------------------------------------------------------

  /**
   * Determine if a click should be an order rather than a selection.
   *
   * OpenRA 对照: public virtual bool InputOverridesSelection(World, int2, MouseInput)
   *
   * Logic:
   * 1. Find an actor at the mouse position (not dead, selectable, visible)
   * 2. If no actor → selection IS overridden (click is an order)
   * 3. For each selected actor, check if any targeter overrides selection
   * 4. If any does → selection IS overridden
   *
   * @param world — the game world
   * @param _xy — screen pixel position (unused — cell-based lookup)
   * @param mi — mouse input event
   * @returns true if the click should produce an order instead of selection
   */
  inputOverridesSelection(
    world: IUnitOrderGeneratorWorld,
    _xy: { readonly x: number; readonly y: number },
    mi: IUnitOrderMouseInput,
  ): boolean {
    // Find actors at the mouse position (we use a cell-based approximation here)
    // OpenRA 对照: world.ScreenMap.ActorsAtMouse(xy)
    //   .Where(a => !a.Actor.IsDead && a.Actor.Info.HasTraitInfo<ISelectableInfo>()
    //     && (a.Actor.Owner.IsAlliedWith(world.RenderPlayer) || !world.FogObscures(a.Actor)))
    //   .WithHighestSelectionPriority(xy, mi.Modifiers)
    //
    // NOTE: Without ScreenMap, we search all actors in the world and filter.
    // Full implementation should use actorMap with viewport projection.
    const selectableActors: IUnitOrderActor[] = []
    for (const a of world.actors) {
      const actor = a as unknown as IUnitOrderActor
      if (actor.isDead) continue
      if (!actor.info?.hasTraitInfo?.('ISelectableInfo')) continue
      const renderPlayer = world.renderPlayer
      if (renderPlayer) {
        const allied = actor.owner?.isAlliedWith?.(renderPlayer) ?? false
        const obscured = world.shroud?.fogObscures(a) ?? false
        if (!allied && obscured) continue
      }
      selectableActors.push(actor)
    }

    const actor = UnitOrderGenerator.pickHighestPriority(selectableActors)

    // No actor at mouse → order overrides selection
    // OpenRA 对照: if (actor == null) return true
    if (!actor) return true

    const target = Target.fromActor(actor as unknown as IActorRef)
    const centerPos = target.centerPosition
    const cell = world.map?.cellContaining(centerPos) ?? new CPos(0, 0)
    const actorsAt = world.actorMap.getActorsAt(cell)

    // Build TargetModifiers
    // OpenRA 对照: var modifiers = TargetModifiers.None; Ctrl→ForceAttack ...
    let modifiers: TargetModifiers = TargetModifiers.None
    if (TargetModifiersExts.hasModifier(mi.modifiers, TargetModifiers.ForceAttack))
      modifiers = (modifiers | TargetModifiers.ForceAttack) as TargetModifiers
    if (TargetModifiersExts.hasModifier(mi.modifiers, TargetModifiers.ForceQueue))
      modifiers = (modifiers | TargetModifiers.ForceQueue) as TargetModifiers
    if (TargetModifiersExts.hasModifier(mi.modifiers, TargetModifiers.ForceMove))
      modifiers = (modifiers | TargetModifiers.ForceMove) as TargetModifiers

    // Check each selected actor's targeters
    // OpenRA 对照: foreach (var a in world.Selection.Actors) { var o = OrderForUnit(...); if (o?.Order.TargetOverridesSelection(...)) return true; }
    const selectedActors = world.selection?.actors ?? []
    for (const a of selectedActors) {
      const o = this.orderForUnit(a as IUnitOrderActor, target, cell, mi)
      if (o) {
        if (
          o.order.targetOverridesSelection(
            o.actor as unknown as IGameActor,
            o.target as unknown as TargetStub,
            actorsAt as readonly IGameActor[],
            cell,
            modifiers,
          )
        ) {
          return true
        }
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // clearSelectionOnLeftClick — virtual getter
  // ---------------------------------------------------------------------------

  /**
   * Whether left-click should clear the current selection.
   *
   * OpenRA 对照: public virtual bool ClearSelectionOnLeftClick => true
   */
  get clearSelectionOnLeftClick(): boolean {
    return true
  }

  // ---------------------------------------------------------------------------
  // deactivate — cleanup
  // ---------------------------------------------------------------------------

  /**
   * Deactivate this generator. No-op for the default unit order generator.
   *
   * OpenRA 对照: public void Deactivate() { }
   */
  override deactivate(): void {
    // No resources to clean up
    super.deactivate()
  }

  // ---------------------------------------------------------------------------
  // render / tick overrides — no-op for this generator
  // ---------------------------------------------------------------------------

  /**
   * Render above-shroud visual feedback. No-op.
   *
   * OpenRA 对照: public virtual IEnumerable<IRenderable> RenderAboveShroud(...) { yield break; }
   */
  renderAboveShroud(_worldRenderer: WorldRendererStub, _world: WorldStub): void {
    // no-op
  }

  /**
   * Render annotations. No-op.
   *
   * OpenRA 对照: public virtual IEnumerable<IRenderable> RenderAnnotations(...) { yield break; }
   */
  renderAnnotations(_worldRenderer: WorldRendererStub, _world: WorldStub): void {
    // no-op
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Check if a target is a selectable actor.
   *
   * OpenRA 对照: target.Type == TargetType.Actor && target.Actor.Info.HasTraitInfo<ISelectableInfo>()
   */
  private isTargetSelectable(target: TargetType2): boolean {
    if (target.type !== TargetType.Actor) return false
    const actor = target.actor
    if (!actor) return false
    // Use unknown cast to access info with hasTraitInfo method
    const info = (actor as unknown as { info?: { hasTraitInfo?(key: string): boolean } }).info
    return info?.hasTraitInfo?.('ISelectableInfo') ?? false
  }
}
