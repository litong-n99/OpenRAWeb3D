/**
 * OrderGenerator.ts — 序生成器抽象基类：统一鼠标按钮分发、输入模式生命周期管理
 * OpenRA 对照: OpenRA.Mods.Common/Orders/OrderGenerator.cs (61 lines)
 *
 * 核心范式转换:
 * - C# explicit interface impl (void IOrderGenerator.Tick()) → TS 直接公开方法覆盖
 * - C# Game.Settings.Game 全局单例 → TS 构造器注入 IMouseSettings + WorldStub
 * - C# public virtual IEnumerable<Order> Order(...) → TS order() Generator 方法
 * - C# protected abstract → TS public 方法（TS 接口成员必须是 public；
 *   子类通过 override 覆盖公开方法，相当于 C# explicit impl 的效果）
 *
 * 所有具体的序生成器 (UnitOrderGenerator, RepairOrderGenerator,
 * BeaconOrderGenerator, GlobalButtonOrderGenerator 等) 均继承此类。
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IOrderGenerator,
  IMouseSettings,
  WorldStub,
  WorldRendererStub,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { MouseActionType } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Minimal selection interface (extending WorldStub for Classic mode)
// ---------------------------------------------------------------------------

/**
 * Extended world interface with selection management.
 *
 * OpenRA 对照: World.Selection.Clear()
 *
 * Used by Classic mouse control style to clear selection when entering
 * an order generation mode.
 */
export interface IOrderGeneratorWorld extends WorldStub {
  readonly selection?: {
    clear(): void
  } | null

  /** Cancel the current input mode (deactivate this generator).
   *
   * OpenRA 对照: World.CancelInputMode()
   */
  cancelInputMode(): void
}

// ---------------------------------------------------------------------------
// OrderGenerator — abstract base
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all order generators.
 *
 * OpenRA 对照: abstract class OrderGenerator : IOrderGenerator
 *
 * Centralizes button resolution (action/cancel via MouseActionType),
 * order dispatch (action button Down → orderInner, cancel button Up →
 * cancelInputMode), and default no-op implementations for optional
 * interface members (tick, handleKeyPress, selectionChanged, deactivate).
 *
 * NOTE: C# uses explicit interface implementation + protected abstract
 * methods. TS does not support explicit interface implementations, so
 * all override points are public. Subclasses override these public
 * methods directly.
 *
 * Concrete subclasses must override:
 * - {@link actionType} — which MouseActionType this generator uses
 * - {@link renderAboveShroud} — above-shroud visual feedback
 * - {@link renderAnnotations} — annotation rendering (range circles, grid)
 * - {@link getCursor} — cursor name for the current cell
 * - {@link orderInner} — the actual order production logic
 *
 * Optional overrides:
 * - {@link tick} — per-tick state update (default no-op)
 * - {@link render} — below-shroud rendering (default no-op)
 * - {@link selectionChanged} — called on selection change (default no-op)
 * - {@link handleKeyPress} — keyboard event handling (default returns false)
 * - {@link deactivate} — cleanup on generator removal (default no-op)
 */
export abstract class OrderGenerator implements IOrderGenerator {
  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /** Unique key for serialization and hotkey lookup.
   *
   * TS-only extension: OpenRA uses `GetType().Name` via C# reflection to
   * identify generators at runtime (e.g., for hotkey dispatch). TypeScript
   * has no runtime type-name reflection, so each concrete generator passes
   * its key explicitly at construction time. This field serves the same
   * purpose — serialization, logging, and hotkey-to-generator mapping —
   * without requiring a reflection API.
   */
  readonly orderGeneratorKey: string

  // ---------------------------------------------------------------------------
  // Button resolution
  // ---------------------------------------------------------------------------

  /**
   * The mouse action type for this generator.
   *
   * OpenRA 对照: protected abstract MouseActionType ActionType { get; }
   *
   * Subclasses override this to specify their action type:
   * - Contextual: right-click for context-sensitive orders (move, attack)
   * - ConfirmOrder: dedicated confirm button (force-attack, guard)
   * - PlaceBuilding: dedicated build button (building placement)
   * - GlobalCommand: dedicated global button (sell, power down, beacon)
   */
  protected abstract readonly actionType: MouseActionType

  /** Injected mouse settings for button resolution. */
  private readonly _settings: IMouseSettings

  /** Injected world reference for cancelInputMode and Classic selection. */
  private readonly _world: IOrderGeneratorWorld

  /**
   * The mouse button that triggers this generator's action.
   *
   * OpenRA 对照: OrderGenerator.ActionButton
   */
  get actionButton(): number {
    return this._settings.resolveActionButton(this.actionType)
  }

  /**
   * The mouse button that cancels this generator's input mode.
   *
   * OpenRA 对照: OrderGenerator.CancelButton
   */
  get cancelButton(): number {
    return this._settings.resolveCancelButton(this.actionType)
  }

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param orderGeneratorKey — unique key for this generator (class name)
   * @param world — the game world (with selection and cancelInputMode)
   * @param settings — mouse settings for button resolution (injected, not global)
   */
  constructor(
    orderGeneratorKey: string,
    world: IOrderGeneratorWorld,
    settings: IMouseSettings,
  ) {
    this.orderGeneratorKey = orderGeneratorKey
    this._world = world
    this._settings = settings

    // Classic mouse control style: clear selection on construction
    // OpenRA 对照: if (gameSettings.MouseControlStyle == Classic) world.Selection.Clear();
    if (settings.mouseControlStyle === 'classic') {
      world.selection?.clear()
    }
  }

  // ---------------------------------------------------------------------------
  // IOrderGenerator — order dispatch
  // ---------------------------------------------------------------------------

  /**
   * Process mouse input and dispatch to orderInner or cancelInputMode.
   *
   * OpenRA 对照: OrderGenerator.Order(World, CPos, int2, MouseInput)
   *
   * Button dispatch logic (matches C# event timing exactly):
   * - If mi.button === actionButton && mi.event === 'Down' → calls orderInner()
   * - If mi.button === cancelButton && mi.event === 'Up' → calls cancelInputMode()
   *
   * @param world — the game world
   * @param cell — the map cell under the cursor
   * @param modifiers — keyboard modifiers (forwarded to orderInner via mi)
   * @param worldPixel — screen pixel position (unused in base dispatch)
   * @param mi — mouse input event { button: number, event: string }
   * @returns an iterable of orders
   */
  order(
    world: WorldStub,
    cell: CPos,
    modifiers: TargetModifiers,
    worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): Generator<Order | null> {
    return this._orderDispatch(world, cell, modifiers, worldPixel, mi)
  }

  /** Internal dispatch function to avoid overload issues. */
  private *_orderDispatch(
    world: WorldStub,
    cell: CPos,
    modifiers: TargetModifiers,
    _worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): Generator<Order | null> {
    // OpenRA 对照: if (mi.Button == ActionButton && mi.Event == MouseInputEvent.Down)
    if (mi && typeof mi === 'object') {
      const input = mi as { button?: number; event?: string }
      if (
        input.button === this.actionButton &&
        input.event === 'Down'
      ) {
        yield* this.orderInner(world, cell, modifiers, mi)
        return
      }

      // OpenRA 对照: if (mi.Button == CancelButton && mi.Event == MouseInputEvent.Up)
      //               world.CancelInputMode(); return [];
      if (
        input.button === this.cancelButton &&
        input.event === 'Up'
      ) {
        this._world.cancelInputMode()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Abstract — subclasses MUST implement (public for TS interface compliance)
  // ---------------------------------------------------------------------------

  /**
   * Produce orders for the given click target.
   *
   * OpenRA 对照: protected abstract IEnumerable<Order> OrderInner(World, CPos, int2, MouseInput)
   *
   * Called when the action button is pressed Down over a cell.
   * NOTE: Protected in C# but TS must expose public due to interface constraints.
   * Subclasses override this protected method; external callers go through order().
   *
   * @param _world — the game world
   * @param _cell — the map cell under the cursor
   * @param _modifiers — keyboard modifiers
   * @param _mi — mouse input event
   */
  protected abstract orderInner(
    _world: WorldStub,
    _cell: CPos,
    _modifiers: TargetModifiers,
    _mi: unknown,
  ): Generator<Order | null>

  /**
   * Get the cursor name for the current cell.
   *
   * OpenRA 对照: protected abstract string GetCursor(World, CPos, int2, MouseInput)
   */
  abstract getCursor(
    world: WorldStub,
    cell: CPos,
    worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): string

  /**
   * Render above-shroud visual feedback.
   *
   * OpenRA 对照: protected abstract IEnumerable<IRenderable> RenderAboveShroud(WorldRenderer, World)
   */
  abstract renderAboveShroud(
    worldRenderer: WorldRendererStub,
    world: WorldStub,
  ): void

  /**
   * Render annotation overlays (range circles, grid lines).
   *
   * OpenRA 对照: protected abstract IEnumerable<IRenderable> RenderAnnotations(WorldRenderer, World)
   */
  abstract renderAnnotations(
    worldRenderer: WorldRendererStub,
    world: WorldStub,
  ): void

  // ---------------------------------------------------------------------------
  // Virtual (public) — subclasses MAY override
  // ---------------------------------------------------------------------------

  /**
   * Called each logic tick.
   *
   * OpenRA 对照: protected virtual void Tick(World)
   *
   * Default is a no-op. Override to auto-cancel on game over, etc.
   */
  tick(_world: WorldStub): void {
    // no-op by default
  }

  /**
   * Render below-shroud visual feedback.
   *
   * OpenRA 对照: protected abstract IEnumerable<IRenderable> Render(WorldRenderer, World)
   *
   * NOTE: OpenRA declares this as `protected abstract`, forcing every concrete
   * generator to implement it even when it has no renderables. Most generators
   * return an empty enumerable in practice, and the real render dispatch is
   * handled by {@link renderAboveShroud} and {@link renderAnnotations} via
   * `WorldInteractionControllerWidget`. This base class therefore makes it a
   * virtual no-op — subclasses only override it if they genuinely need
   * below-shroud rendering.
   */
  render(
    _worldRenderer: WorldRendererStub,
    _world: WorldStub,
  ): void {
    // no-op by default
  }

  /**
   * Called when the player's selection changes.
   *
   * OpenRA 对照: protected virtual void SelectionChanged(World, IEnumerable<Actor>)
   *
   * Default is a no-op. Override to cancel the input mode if the
   * new selection is invalid for this generator (e.g., guard mode
   * without guard-capable units).
   */
  selectionChanged(
    _world: WorldStub,
    _selected: readonly unknown[],
  ): void {
    // no-op by default
  }

  // ---------------------------------------------------------------------------
  // IOrderGenerator — optional lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Handle a keyboard input event.
   *
   * OpenRA 对照: bool IOrderGenerator.HandleKeyPress(KeyInput)
   *
   * Default returns false (event not consumed).
   * Override to intercept hotkeys or cancel on Escape.
   */
  handleKeyPress(_e: unknown): boolean {
    return false
  }

  /**
   * Handle a mouse input event.
   *
   * Default returns false (event not consumed).
   * Override to intercept mouse events before order dispatch.
   */
  handleMouseInput(_mouseInput: unknown): boolean {
    return false
  }

  /**
   * Deactivate this generator and clean up resources.
   *
   * OpenRA 对照: void IOrderGenerator.Deactivate()
   *
   * Default is a no-op. Override to dispose GPU meshes, textures,
   * and other visual feedback resources.
   */
  deactivate(): void {
    // no-op by default
  }
}
