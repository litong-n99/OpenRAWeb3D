/**
 * ForceModifiersOrderGenerator.ts — 强制修饰符装饰器：将修饰键（Ctrl/Alt/Shift）注入鼠標输入，
 * 委托给 UnitOrderGenerator 处理
 * OpenRA 对照: OpenRA.Mods.Common/Orders/ForceModifiersOrderGenerator.cs (46 lines)
 *
 * 核心范式转换:
 * - C# mi.Modifiers |= Modifiers 位或 → TS 创建修改后的 modifiedMi 对象
 * - C# base.OrderInner(..., mi) → TS super.orderInner(..., modifiedMi) 装饰器模式
 * - C# base.GetCursor(..., mi) → TS super.getCursor(..., modifiedMi)
 * - C# Game.Settings.Game 全局单例 → TS 构造器注入 IMouseSettings
 * - C# Modifiers.Shift 键盘修饰 → TS TargetModifiers.ForceQueue 对应位
 *
 * 用于：强制攻击 (Ctrl + 点击)、强制移动 (Alt + 点击)、队列指令 (Shift + 点击)。
 * cancelOnFirstUse=true 时，第一次非 Shift 点击后自动取消模式。
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IMouseSettings,
  WorldStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  MouseActionType,
  TargetModifiers,
  TargetModifiersExts,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Order } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  UnitOrderGenerator,
  type IUnitOrderGeneratorWorld,
  type IUnitOrderMouseInput,
} from './UnitOrderGenerator.js'

// ---------------------------------------------------------------------------
// ForceModifiersOrderGenerator
// ---------------------------------------------------------------------------

/**
 * Order generator decorator that forces modifier keys into mouse input
 * before delegating to UnitOrderGenerator.
 *
 * OpenRA 对照: ForceModifiersOrderGenerator : UnitOrderGenerator
 *
 * Used for:
 * - Force-attack (Ctrl+click): `new ForceModifiersOrderGenerator(world, settings, ForceAttack, true)`
 * - Force-move (Alt+click): `new ForceModifiersOrderGenerator(world, settings, ForceMove, true)`
 * - Queued orders (Shift+click): `new ForceModifiersOrderGenerator(world, settings, ForceQueue, false)`
 *
 * The decorator pattern works by intercepting orderInner() and getCursor(),
 * OR-ing the forced modifiers into the mouse input, and then calling the
 * parent UnitOrderGenerator's methods with the modified input.
 */
export class ForceModifiersOrderGenerator extends UnitOrderGenerator {
  // ---------------------------------------------------------------------------
  // Instance fields
  // ---------------------------------------------------------------------------

  protected readonly actionType: MouseActionType = MouseActionType.ConfirmOrder

  /** The modifier flags to force into mouse input.
   *
   * OpenRA 对照: public readonly Modifiers Modifiers
   */
  private readonly _modifiers: TargetModifiers

  /** Whether to cancel the input mode after the first non-shift use.
   *
   * OpenRA 对照: readonly bool cancelOnFirstUse
   */
  private readonly _cancelOnFirstUse: boolean

  /** Typed world reference for cancelInputMode.
   *
   * Stored separately from the parent's private _uow for direct access.
   */
  private readonly _fw: IUnitOrderGeneratorWorld

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param world — the game world (with cancelInputMode)
   * @param settings — mouse settings for button resolution
   * @param modifiers — modifier flags to force (Ctrl→ForceAttack, Alt→ForceMove, Shift→ForceQueue)
   * @param cancelOnFirstUse — if true, auto-cancel after first use (force-attack/force-move)
   */
  constructor(
    world: IUnitOrderGeneratorWorld,
    settings: IMouseSettings,
    modifiers: TargetModifiers,
    cancelOnFirstUse: boolean,
  ) {
    // OpenRA 对照: base(world)
    super(world, settings)
    this._fw = world
    this._modifiers = modifiers
    this._cancelOnFirstUse = cancelOnFirstUse
  }

  // ---------------------------------------------------------------------------
  // orderInner — force modifiers then delegate
  // ---------------------------------------------------------------------------

  /**
   * Force the configured modifiers into the mouse input, optionally cancel
   * the input mode on first use, then delegate to the parent.
   *
   * OpenRA 对照: protected override IEnumerable<Order> OrderInner(World, CPos, int2, MouseInput)
   *
   * Logic:
   * 1. mi.modifiers |= this._modifiers  (OR the forced modifiers into input)
   * 2. If (cancelOnFirstUse && !shift) or cancel button pressed → cancel input mode
   * 3. Delegate to super.orderInner with modified input
   *
   * @param _world — the game world
   * @param cell — the map cell under the cursor
   * @param _modifiers — keyboard modifiers (also OR'd with forced)
   * @param mi — mouse input event (will be modified)
   */
  protected *orderInner(
    _world: WorldStub,
    cell: CPos,
    _modifiers: TargetModifiers,
    mi: unknown,
  ): Generator<Order | null> {
    const input = mi as IUnitOrderMouseInput | undefined
    if (!input) return

    // 1. Force OR the modifiers into the mouse input
    // OpenRA 对照: mi.Modifiers |= Modifiers
    const modifiedModifiers = (input.modifiers | this._modifiers) as TargetModifiers
    const modifiedMi: IUnitOrderMouseInput = {
      button: input.button,
      event: input.event,
      modifiers: modifiedModifiers,
    }

    // 2. Cancel input mode if applicable
    // OpenRA 对照:
    //   if ((cancelOnFirstUse && !mi.Modifiers.HasModifier(Modifiers.Shift)) || mi.Button == CancelButton)
    //     world.CancelInputMode()
    if (
      (this._cancelOnFirstUse &&
        !TargetModifiersExts.hasModifier(
          modifiedModifiers,
          TargetModifiers.ForceQueue,
        )) ||
      modifiedMi.button === this.cancelButton
    ) {
      this._fw.cancelInputMode()
    }

    // 3. Delegate to parent with modified input
    // OpenRA 对照: return base.OrderInner(world, cell, worldPixel, mi)
    // Also OR the modifiers into the _modifiers parameter for consistency
    const combinedModifiers = (_modifiers | this._modifiers) as TargetModifiers
    yield* super['orderInner'](_world, cell, combinedModifiers, modifiedMi)
  }

  // ---------------------------------------------------------------------------
  // getCursor — force modifiers then delegate
  // ---------------------------------------------------------------------------

  /**
   * Force modifiers into mouse input and delegate cursor resolution to parent.
   *
   * OpenRA 对照: public override string GetCursor(World, CPos, int2, MouseInput)
   *
   * @param _world — the game world
   * @param cell — the map cell under the cursor
   * @param _worldPixel — screen pixel position
   * @param mi — mouse input event (will be modified)
   * @returns cursor name from parent's resolution with forced modifiers
   */
  override getCursor(
    _world: WorldStub,
    cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    mi?: unknown,
  ): string {
    const input = mi as IUnitOrderMouseInput | undefined
    if (!input) return super.getCursor(_world, cell, _worldPixel, mi)

    // OpenRA 对照: mi.Modifiers |= Modifiers
    const modifiedModifiers = (input.modifiers | this._modifiers) as TargetModifiers
    const modifiedMi: IUnitOrderMouseInput = {
      button: input.button,
      event: input.event,
      modifiers: modifiedModifiers,
    }

    // OpenRA 对照: return base.GetCursor(world, cell, worldPixel, mi)
    return super.getCursor(_world, cell, _worldPixel, modifiedMi)
  }

  // ---------------------------------------------------------------------------
  // clearSelectionOnLeftClick — false
  // ---------------------------------------------------------------------------

  /**
   * Prevent left-click from clearing selection during force-modifier mode.
   *
   * OpenRA 对照: public override bool ClearSelectionOnLeftClick => false
   */
  override get clearSelectionOnLeftClick(): boolean {
    return false
  }

  // ---------------------------------------------------------------------------
  // deactivate — cleanup
  // ---------------------------------------------------------------------------

  /**
   * Deactivate this generator. No extra resources to clean up.
   *
   * OpenRA 对照: implicit — no explicit deactivate override in C#
   */
  override deactivate(): void {
    super.deactivate()
  }
}
