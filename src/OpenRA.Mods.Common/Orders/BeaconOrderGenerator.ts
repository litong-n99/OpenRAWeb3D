/**
 * BeaconOrderGenerator.ts — 信标放置序生成器：单次点击放置信标并立即退出输入模式
 * OpenRA 对照: OpenRA.Mods.Common/Orders/BeaconOrderGenerator.cs (39 lines)
 *
 * 核心范式转换:
 * - C# world.CancelInputMode() → TS cancelInputMode() 回调
 * - C# SuppressVisualFeedback = true → TS extraData.suppressVisualFeedback
 * - C# Order 对象 → TS OrderStub 字面量
 *
 * 信标是一次性操作：点击一次放置信标并自动退出信标放置模式。
 * 信标的视觉渲染由 Beacon 特效 trait 负责（Chapter 13）。
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
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

// ---------------------------------------------------------------------------
// BeaconOrderGenerator
// ---------------------------------------------------------------------------

/**
 * Order generator for beacon placement.
 *
 * OpenRA 对照: BeaconOrderGenerator : OrderGenerator
 *
 * One-shot generator: the first click places a beacon at the clicked cell
 * using the PlaceBeacon order and immediately cancels the input mode.
 * Visual feedback (beacon marker) is handled by the Beacon effect trait
 * (Chapter 13 Support Powers), not by this generator.
 */
export class BeaconOrderGenerator extends OrderGenerator {
  // ---------------------------------------------------------------------------
  // Instance
  // ---------------------------------------------------------------------------

  protected readonly actionType: MouseActionType = MouseActionType.PlaceBuilding

  /** World reference for cancelInputMode (distinct from base class _world). */
  private readonly _beaconWorld: IOrderGeneratorWorld

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param world — the game world (must provide cancelInputMode)
   * @param settings — mouse settings for button resolution
   */
  constructor(
    world: IOrderGeneratorWorld,
    settings: IMouseSettings,
  ) {
    super('BeaconOrderGenerator', world, settings)
    this._beaconWorld = world
  }

  // ---------------------------------------------------------------------------
  // orderInner — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Produce a PlaceBeacon order and cancel input mode.
   *
   * OpenRA 对照: protected override IEnumerable<Order> OrderInner(World, CPos, int2, MouseInput)
   *   world.CancelInputMode();
   *   yield return new Order("PlaceBeacon", world.LocalPlayer.PlayerActor, Target.FromCell(world, cell), false)
   *     { SuppressVisualFeedback = true }
   *
   * @param _worldStub — the game world (unused)
   * @param cell — the map cell to place the beacon
   * @param _modifiers — keyboard modifiers (unused)
   * @param _mi — mouse input event (unused)
   */
  protected *orderInner(
    _worldStub: WorldStub,
    cell: CPos,
    _modifiers: TargetModifiers,
    _mi: unknown,
  ): Generator<Order | null> {
    // Cancel input mode immediately (one-shot)
    // OpenRA 对照: world.CancelInputMode()
    this._beaconWorld.cancelInputMode()

    // OpenRA 对照: yield return new Order("PlaceBeacon", ..., false) { SuppressVisualFeedback = true }
    yield {
      orderName: 'PlaceBeacon',
      targetString: `${cell.X},${cell.Y}`,
      extraData: {
        suppressVisualFeedback: true,
        queued: false,
        cell,
      },
    }
  }

  // ---------------------------------------------------------------------------
  // getCursor — abstract override
  // ---------------------------------------------------------------------------

  /**
   * Return the cursor name for beacon placement.
   *
   * OpenRA 对照: protected override string GetCursor(World, CPos, int2, MouseInput)
   *   return "ability"; // TODO: [CursorReference]
   */
  getCursor(
    _world: WorldStub,
    _cell: CPos,
    _worldPixel?: { readonly x: number; readonly y: number },
    _mi?: unknown,
  ): string {
    return 'ability'
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
    // no-op — beacon visual handled by Beacon effect trait
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
