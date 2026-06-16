/**
 * GlobalButtonOrderGenerator.ts — 全局按钮序生成器：电力切换、出售等全局命令的抽象基类及具体实现
 * OpenRA 对照: OpenRA.Mods.Common/Orders/GlobalButtonOrderGenerator.cs (95 lines)
 *
 * 核心范式转换:
 * - C# GlobalButtonOrderGenerator<T> where T : class 泛型 → TS traitKey: string 构造器参数
 * - C# a.TraitsImplementing<T>().Any(IsValidTrait) → TS traitsImplementing(traitKey) + filter
 * - C# protected abstract override GetCursor → TS 同样 abstract override
 * - C# Order(order, underCursor, false) → TS OrderStub 字面量
 * - C# t.IsTraitEnabled() → TS trait.isTraitEnabled() 方法
 * - C# t.Info.Cursor → TS sellable.info.cursor 属性访问
 *
 * 具体子类：
 * - PowerDownOrderGenerator: 切换建筑电力状态 ("PowerDown" 指令)
 * - SellOrderGenerator: 出售建筑 ("Sell" 指令)
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  IMouseSettings,
  WorldStub,
  WorldRendererStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  MouseActionType,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  OrderGenerator,
  type IOrderGeneratorWorld,
} from './OrderGenerator.js'
import type {
  IUnitOrderPlayer,
  IUnitOrderActor,
} from './UnitOrderGenerator.js'

// ---------------------------------------------------------------------------
// Trait stubs for ToggleConditionOnOrder and Sellable
// ---------------------------------------------------------------------------

/**
 * Minimal ToggleConditionOnOrder trait interface.
 *
 * OpenRA 对照: ToggleConditionOnOrder (Chapter 14 trait)
 */
interface IToggleConditionOnOrderStub {
  /** Whether this trait is currently disabled. */
  readonly isTraitDisabled: boolean

  /** Whether this trait is currently paused. */
  readonly isTraitPaused: boolean

  /** Whether the trait is enabled (not disabled and not paused).
   *
   * OpenRA 对照: ToggleConditionOnOrder.IsTraitEnabled()
   */
  isTraitEnabled(): boolean
}

/**
 * Minimal Sellable trait interface.
 *
 * OpenRA 对照: Sellable (Chapter 11 trait)
 */
interface ISellableStub {
  /** Whether this trait is currently disabled. */
  readonly isTraitDisabled: boolean

  /** Whether the trait is enabled.
   *
   * OpenRA 对照: Sellable.IsTraitEnabled()
   */
  isTraitEnabled(): boolean

  /** Cursor info for sell action.
   *
   * OpenRA 对照: Sellable.Info.Cursor
   */
  readonly info: {
    readonly cursor: string | null
  }
}

// ---------------------------------------------------------------------------
// GlobalButtonOrderGeneratorWorld
// ---------------------------------------------------------------------------

/**
 * World interface required by GlobalButtonOrderGenerator.
 */
export interface IGlobalButtonOrderGeneratorWorld extends IOrderGeneratorWorld {
  readonly actorMap: {
    getActorsAt(cell: CPos): readonly IGameActor[]
  }
  readonly localPlayer: IUnitOrderPlayer | null
  readonly isGameOver: boolean
  cancelInputMode(): void
}

// ---------------------------------------------------------------------------
// GlobalButtonOrderGenerator — abstract base
// ---------------------------------------------------------------------------

/**
 * Abstract base for order generators triggered by global command buttons
 * (sell, power down, etc.).
 *
 * OpenRA 对照: abstract class GlobalButtonOrderGenerator<T> : OrderGenerator
 *
 * Finds the first actor under the cursor owned by the local player that has
 * an enabled trait matching the configured trait key, and issues an order
 * targeting that actor.
 *
 * Subclasses must override {@link getCursor} to provide cursor feedback.
 *
 * @param traitKey — the trait interface key to match (e.g., "ToggleConditionOnOrder", "Sellable")
 * @param order — the order name to issue (e.g., "PowerDown", "Sell")
 */
export abstract class GlobalButtonOrderGenerator extends OrderGenerator {
  // ---------------------------------------------------------------------------
  // Instance
  // ---------------------------------------------------------------------------

  protected readonly actionType: MouseActionType = MouseActionType.GlobalCommand

  /** The order name to issue. */
  private readonly _orderName: string

  /** The trait interface key to match. */
  private readonly _traitKey: string

  /** Typed world reference. */
  private readonly _gw: IGlobalButtonOrderGeneratorWorld

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param generatorKey — unique key for this generator
   * @param traitKey — the trait key to match (e.g., "ToggleConditionOnOrder")
   * @param orderName — the order name to issue (e.g., "PowerDown")
   * @param world — the game world
   * @param settings — mouse settings for button resolution
   */
  constructor(
    generatorKey: string,
    traitKey: string,
    orderName: string,
    world: IGlobalButtonOrderGeneratorWorld,
    settings: IMouseSettings,
  ) {
    super(generatorKey, world, settings)
    this._traitKey = traitKey
    this._orderName = orderName
    this._gw = world
  }

  // ---------------------------------------------------------------------------
  // isValidTrait — protected virtual (subclasses may override)
  // ---------------------------------------------------------------------------

  /**
   * Check if a trait instance is valid for this order.
   *
   * OpenRA 对照: protected virtual bool IsValidTrait(T t)
   *   return t.IsTraitEnabled();
   *
   * Default implementation checks isTraitEnabled().
   * Subclasses (like PowerDownOrderGenerator) override for additional checks.
   */
  protected isValidTrait(trait: unknown): boolean {
    const t = trait as { isTraitEnabled?(): boolean }
    return t.isTraitEnabled?.() ?? false
  }

  /** Get the trait key for subclass use in getCursor. */
  protected get traitKey(): string {
    return this._traitKey
  }

  /** Get the order name for subclass use in getCursor. */
  protected get orderName(): string {
    return this._orderName
  }

  // ---------------------------------------------------------------------------
  // orderInner — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Find actor under cursor with enabled matching trait and issue order.
   *
   * OpenRA 对照: protected override IEnumerable<Order> OrderInner(World, CPos, int2, MouseInput)
   *   var underCursor = world.ScreenMap.ActorsAtMouse(mi)
   *     .Select(a => a.Actor)
   *     .FirstOrDefault(a => a.Owner == world.LocalPlayer && a.TraitsImplementing<T>()
   *       .Any(IsValidTrait))
   *   if (underCursor == null) yield break;
   *   yield return new Order(order, underCursor, false);
   *
   * @param _world — the game world (unused)
   * @param cell — the map cell under the cursor
   * @param _modifiers — keyboard modifiers (unused)
   * @param _mi — mouse input event (unused)
   */
  protected *orderInner(
    _world: WorldStub,
    cell: CPos,
    _modifiers: TargetModifiers,
    _mi: unknown,
  ): Generator<Order | null> {
    const localPlayer = this._gw.localPlayer
    if (!localPlayer) return

    const actorsAtCell = this._gw.actorMap.getActorsAt(cell)
    const underCursor = actorsAtCell.find((a) => {
      const actor = a as unknown as IUnitOrderActor
      if (actor.owner !== localPlayer) return false
      const traits = (actor.traitsImplementing?.(this._traitKey) ?? []) as unknown[]
      return traits.some((t) => this.isValidTrait(t))
    })

    if (!underCursor) return

    yield {
      orderName: this._orderName,
      targetString: underCursor.actorId.toString(),
      extraData: {
        subject: underCursor,
        queued: false,
      },
    }
  }

  // ---------------------------------------------------------------------------
  // tick — auto-cancel on game over
  // ---------------------------------------------------------------------------

  /**
   * Auto-cancel this generator when the game is over.
   *
   * OpenRA 对照: protected override void Tick(World)
   *   if (world.LocalPlayer != null && world.LocalPlayer.WinState != WinState.Undefined)
   *     world.CancelInputMode()
   */
  override tick(_world: WorldStub): void {
    const localPlayer = this._gw.localPlayer
    if (localPlayer && localPlayer.winState !== 0) {
      this._gw.cancelInputMode()
    }
  }

  // ---------------------------------------------------------------------------
  // Render — no-op
  // ---------------------------------------------------------------------------

  /**
   * Render above-shroud visual feedback. No-op.
   *
   * OpenRA 对照: protected override IEnumerable<IRenderable> RenderAboveShroud(...) { yield break; }
   */
  renderAboveShroud(_worldRenderer: WorldRendererStub, _world: WorldStub): void {
    // no-op
  }

  /**
   * Render annotations. No-op.
   *
   * OpenRA 对照: protected override IEnumerable<IRenderable> RenderAnnotations(...) { yield break; }
   */
  renderAnnotations(_worldRenderer: WorldRendererStub, _world: WorldStub): void {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// PowerDownOrderGenerator — concrete subclass
// ---------------------------------------------------------------------------

/**
 * Order generator for power down / power on commands.
 *
 * OpenRA 对照: PowerDownOrderGenerator : GlobalButtonOrderGenerator<ToggleConditionOnOrder>
 *
 * Issues a "PowerDown" order on a building owned by the local player that has
 * a ToggleConditionOnOrder trait which is not disabled and not paused.
 */
export class PowerDownOrderGenerator extends GlobalButtonOrderGenerator {
  /**
   * @param world — the game world
   * @param settings — mouse settings for button resolution
   */
  constructor(
    world: IGlobalButtonOrderGeneratorWorld,
    settings: IMouseSettings,
  ) {
    super(
      'PowerDownOrderGenerator',
      'ToggleConditionOnOrder',
      'PowerDown',
      world,
      settings,
    )
  }

  // ---------------------------------------------------------------------------
  // isValidTrait — override for additional ToggleConditionOnOrder checks
  // ---------------------------------------------------------------------------

  /**
   * Override: PowerDown is valid when the trait is NOT disabled and NOT paused.
   *
   * OpenRA 对照: protected override bool IsValidTrait(ToggleConditionOnOrder t)
   *   return !t.IsTraitDisabled && !t.IsTraitPaused;
   */
  protected override isValidTrait(trait: unknown): boolean {
    const t = trait as IToggleConditionOnOrderStub
    return !t.isTraitDisabled && !t.isTraitPaused
  }

  // ---------------------------------------------------------------------------
  // getCursor — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Return the cursor name: "powerdown" if a valid target exists, else "powerdown-blocked".
   *
   * OpenRA 对照: protected override string GetCursor(World, CPos, int2, MouseInput)
   *   return OrderInner(world, cell, worldPixel, mi).Any() ? "powerdown" : "powerdown-blocked"
   */
  getCursor(
    _world: WorldStub,
    cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): string {
    if (!mi) return 'powerdown-blocked'

    const orders: (Order | null)[] = []
    for (const o of this['orderInner'](_world, cell, TargetModifiers.None, mi)) {
      orders.push(o)
    }

    return orders.length > 0 ? 'powerdown' : 'powerdown-blocked'
  }
}

// ---------------------------------------------------------------------------
// SellOrderGenerator — concrete subclass
// ---------------------------------------------------------------------------

/**
 * Order generator for sell commands.
 *
 * OpenRA 对照: SellOrderGenerator : GlobalButtonOrderGenerator<Sellable>
 *
 * Issues a "Sell" order on a building owned by the local player that has
 * a Sellable trait which is enabled.
 */
export class SellOrderGenerator extends GlobalButtonOrderGenerator {
  /**
   * @param world — the game world
   * @param settings — mouse settings for button resolution
   */
  constructor(
    world: IGlobalButtonOrderGeneratorWorld,
    settings: IMouseSettings,
  ) {
    super(
      'SellOrderGenerator',
      'Sellable',
      'Sell',
      world,
      settings,
    )
  }

  // ---------------------------------------------------------------------------
  // getCursor — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Return the cursor name from the Sellable trait, or "sell-blocked".
   *
   * OpenRA 对照: protected override string GetCursor(World, CPos, int2, MouseInput)
   *   var cursor = OrderInner(world, cell, worldPixel, mi)
   *     .SelectMany(o => o.Subject.TraitsImplementing<Sellable>())
   *     .Where(t => !t.IsTraitDisabled)
   *     .Select(si => si.Info.Cursor)
   *     .FirstOrDefault()
   *   return cursor ?? "sell-blocked"
   *
   * NOTE: Since OrderInner returns simple OrderStub objects (not C# Order with
   * Subject property), we look up the trait directly from the actor at the cell
   * instead of from the produced order's subject.
   */
  getCursor(
    _world: WorldStub,
    cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): string {
    if (!mi) return 'sell-blocked'

    // First check if orderInner would produce any order
    const orders: (Order | null)[] = []
    for (const o of this['orderInner'](_world, cell, TargetModifiers.None, mi)) {
      orders.push(o)
    }

    if (orders.length === 0) return 'sell-blocked'

    // Find the actor at cell and check its Sellable traits for cursor
    const gw: IGlobalButtonOrderGeneratorWorld | undefined =
      (this as unknown as { _gw?: IGlobalButtonOrderGeneratorWorld })._gw
    if (!gw) return 'sell-blocked'

    const localPlayer = gw.localPlayer
    if (!localPlayer) return 'sell-blocked'

    const actorsAtCell = gw.actorMap.getActorsAt(cell)
    for (const a of actorsAtCell) {
      const actor = a as unknown as IUnitOrderActor
      if (actor.owner !== localPlayer) continue
      const traits = (actor.traitsImplementing?.('Sellable') ?? []) as ISellableStub[]
      for (const t of traits) {
        if (!t.isTraitDisabled) {
          const cursor = t.info?.cursor
          if (cursor) return cursor
        }
      }
    }

    return 'sell-blocked'
  }
}
