/**
 * ILayout.ts — 子 widget 布局策略接口
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ScrollPanelWidget.cs (lines 19-23, ILayout interface)
 *
 * 核心范式转换:
 * - OpenRA CPU-side child positioning (AdjustChild 设置 Bounds.Y) → TypeScript
 *   ILayout.adjustChild() 设置 widget Bounds
 * - OpenRA ILayout 是无状态接口 → TypeScript 接口完全相同
 *
 * Implementations: ListLayout (vertical stacking), GridLayout (grid-based)
 */

import type { Widget } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// ILayout — 布局策略接口
// OpenRA 对照: public interface ILayout
// ---------------------------------------------------------------------------

/** 子 widget 布局策略接口。
 *
 * 实现类负责在 ScrollPanelWidget 的坐标空间中定位子 widget。
 *
 * OpenRA 对照: ILayout (ScrollPanelWidget.cs:19-23)
 */
export interface ILayout {
  /** 在子 widget 首次添加时调整其 bounds。
   *
   * 此方法在 ScrollPanelWidget.AddChild 中调用，设置子 widget 的
   * Y 坐标，并更新 ScrollPanelWidget.ContentHeight。
   *
   * OpenRA 对照: ILayout.AdjustChild(Widget)
   *
   * @param w — 刚添加的子 widget
   */
  adjustChild(w: Widget): void

  /** 重新计算所有子 widget 的 bounds。
   *
   * 此方法在子 widget 被移除或 ContentHeight 需要重新计算时调用。
   * OpenRA 对照: ILayout.AdjustChildren()
   */
  adjustChildren(): void
}
