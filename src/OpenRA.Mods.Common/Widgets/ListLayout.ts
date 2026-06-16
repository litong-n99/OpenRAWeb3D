/**
 * ListLayout.ts — 垂直列表布局策略
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ListLayout.cs (47 lines)
 *
 * 核心范式转换:
 * - OpenRA CPU-side child Y positioning → TypeScript bounds.y 直接设置
 * - OpenRA CollapseHiddenChildren → TypeScript visible 检查
 *
 * ListLayout 用于 ScrollPanelWidget 的默认垂直列表布局。
 * 子 widget 从上到下堆叠，有可配置的间距。
 */

import type { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { ILayout } from './ILayout.js'

// ---------------------------------------------------------------------------
// ILayoutHost — ListLayout 所需的宿主接口
// OpenRA 对照: ScrollPanelWidget 的可变状态，被 ListLayout 修改
// ---------------------------------------------------------------------------

/** ListLayout 修改的宿主状态。避免 ScrollPanelWidget 的循环依赖。 */
export interface ILayoutHost {
  /** 子 widget 列表。OpenRA 对照: ScrollPanelWidget.Children */
  children: Widget[]

  /** 总内容高度。OpenRA 对照: ScrollPanelWidget.ContentHeight */
  contentHeight: number

  /** 顶部和底部间距。OpenRA 对照: ScrollPanelWidget.TopBottomSpacing */
  topBottomSpacing: number

  /** 条目间距。OpenRA 对照: ScrollPanelWidget.ItemSpacing */
  itemSpacing: number

  /** 是否折叠隐藏的子 widget。OpenRA 对照: ScrollPanelWidget.CollapseHiddenChildren */
  collapseHiddenChildren: boolean
}

// ---------------------------------------------------------------------------
// ListLayout — 垂直列表布局
// OpenRA 对照: public class ListLayout : ILayout
// ---------------------------------------------------------------------------

/** 垂直列表布局策略。
 *
 * 子 widget 从上到下堆叠，间距由 ItemSpacing 控制。
 * 顶部和底部由 TopBottomSpacing 提供额外空间。
 *
 * OpenRA 对照: ListLayout
 */
export class ListLayout implements ILayout {
  private readonly _host: ILayoutHost

  /** 创建 ListLayout。
   *
   * OpenRA 对照: public ListLayout(ScrollPanelWidget w)
   *
   * @param host — 布局目标（ScrollPanelWidget 或其接口）
   */
  constructor(host: ILayoutHost) {
    this._host = host
  }

  /** 调整新添加的子 widget。
   *
   * 如果这是第一个子 widget，初始化 ContentHeight 以包含上间距。
   * 将子 widget 的 Y 坐标设置为当前 ContentHeight（减去上间距，加上条目间距）。
   * 如果子 widget 可见（或未启用折叠），增加 ContentHeight。
   *
   * OpenRA 对照: ListLayout.AdjustChild(Widget)
   */
  adjustChild(w: Widget): void {
    if (this._host.children.length === 0) {
      this._host.contentHeight =
        2 * this._host.topBottomSpacing - this._host.itemSpacing
    }

    w.bounds.y =
      this._host.contentHeight -
      this._host.topBottomSpacing +
      this._host.itemSpacing
    if (
      !this._host.collapseHiddenChildren ||
      w.visible
    ) {
      this._host.contentHeight += w.bounds.height + this._host.itemSpacing
    }
  }

  /** 重新计算所有子 widget 的 bounds。
   *
   * 从上到下遍历子 widget，重新设置每个 widget 的 Y 坐标。
   * 用上间距初始化 ContentHeight，然后为每个可见子 widget 递增高度。
   * 最后添加下间距。
   *
   * OpenRA 对照: ListLayout.AdjustChildren()
   */
  adjustChildren(): void {
    this._host.contentHeight = this._host.topBottomSpacing
    for (const w of this._host.children) {
      w.bounds.y = this._host.contentHeight
      if (
        !this._host.collapseHiddenChildren ||
        w.visible
      ) {
        this._host.contentHeight += w.bounds.height + this._host.itemSpacing
      }
    }
    // 将最后一个条目后的额外 ItemSpacing 替换为下间距
    this._host.contentHeight +=
      this._host.topBottomSpacing - this._host.itemSpacing
  }
}
