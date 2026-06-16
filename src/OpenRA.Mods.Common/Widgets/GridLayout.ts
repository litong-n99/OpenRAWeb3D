/**
 * GridLayout.ts — 网格布局策略
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/GridLayout.cs (48 lines)
 *
 * 核心范式转换:
 * - OpenRA CPU-side child positioning (AdjustChild 设置 Bounds.X/Bounds.Y) → TypeScript
 *   Bounds 直接赋值
 * - OpenRA ScrollPanelWidget 状态 (ContentHeight, ItemSpacing, Bounds.Width, ScrollbarWidth)
 *   → TypeScript IGridLayoutHost 接口
 * - OpenRA 行优先布局 (水平填充 → 换行) → TypeScript 相同算法
 * - OpenRA ContentHeight 追踪（所有行的最小高度） → TypeScript 相同逻辑
 */

import type { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { ILayout } from './ILayout.js'

// ---------------------------------------------------------------------------
// IGridLayoutHost — GridLayout 所需的宿主接口
// OpenRA 对照: ScrollPanelWidget 的状态（被 GridLayout 修改）
// ---------------------------------------------------------------------------

/** GridLayout 修改的宿主状态。
 *
 * OpenRA 对照: ScrollPanelWidget 的 ContentHeight, ItemSpacing, TopBottomSpacing,
 *              Bounds.Width, ScrollbarWidth, Children
 */
export interface IGridLayoutHost {
  /** 子 widget 列表。 */
  children: Widget[]

  /** 所有子 widget 的总内容高度。 */
  contentHeight: number

  /** 条目间距。 */
  itemSpacing: number

  /** 顶部和底部间距。 */
  topBottomSpacing: number

  /** 宿主 widget 的宽度。 */
  boundsWidth: number

  /** 滚动条宽度（需要从可用宽度中减去）。 */
  scrollbarWidth: number

  /** 每行的列数。如果 <= 0，自动计算。 */
  columnCount?: number
}

// ---------------------------------------------------------------------------
// GridLayout — 网格布局
// OpenRA 对照: public class GridLayout : ILayout
// ---------------------------------------------------------------------------

/**
 * 网格布局策略 — 行优先顺序定位子 widget。
 *
 * 子 widget 从左到右排列；当没有空间时开始新行。
 * ContentHeight 随子 widget 增加而递增。
 *
 * OpenRA 对照: GridLayout
 */
export class GridLayout implements ILayout {
  private readonly _host: IGridLayoutHost

  /** 当前光标位置（下一个子 widget 的左上角）。OpenRA 对照: int2 pos */
  private _pos: { x: number; y: number } = { x: 0, y: 0 }

  /** 每行的列数（0 = 自动）。OpenRA 对照: 通过 Bounds 约束计算 */
  private _columnCount: number

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: public GridLayout(ScrollPanelWidget w)
  // ---------------------------------------------------------------------------

  /**
   * 创建 GridLayout。
   *
   * OpenRA 对照: public GridLayout(ScrollPanelWidget w)
   *
   * @param host — 布局目标
   * @param columnCount — 每行的列数（如果 <= 0 则自动）
   */
  constructor(host: IGridLayoutHost, columnCount: number = 0) {
    this._host = host
    this._columnCount = columnCount
    // Initialize layout state (OpenRA initializes in AdjustChild when children.Count == 0,
    // but in practice children are added before AdjustChild, so we initialize here)
    this._host.contentHeight = 2 * this._host.topBottomSpacing
    this._pos = {
      x: this._host.itemSpacing,
      y: this._host.topBottomSpacing,
    }
  }

  // ---------------------------------------------------------------------------
  // ColumnCount
  // ---------------------------------------------------------------------------

  /** 获取每行列数。 */
  get columnCount(): number {
    return this._columnCount
  }

  /** 设置每行列数。 */
  set columnCount(value: number) {
    this._columnCount = value
  }

  // ---------------------------------------------------------------------------
  // AdjustChild — 在添加子 widget 时调整其 bounds
  // OpenRA 对照: GridLayout.AdjustChild(Widget w)
  // ---------------------------------------------------------------------------

  /**
   * 调整新添加的子 widget 的 bounds。
   *
   * 如果是第一个子 widget，初始化 ContentHeight。
   * 将子 widget 定位到当前网格位置；如果没有空间则换到新行。
   * 更新 ContentHeight 以包含新行。
   *
   * OpenRA 对照: public void AdjustChild(Widget w)
   */
  adjustChild(w: Widget): void {
    // NOTE: OpenRA 使用 `widget.Children.Count == 0` 初始化，但由于
    // ScrollPanelWidget.AddChild 在 AdjustChild 之前添加子 widget，
    // Children.Count 在首次调用时已经是 1。我们使用 contentHeight === 0 替代。
    if (this._host.contentHeight === 0) {
      this._host.contentHeight =
        2 * this._host.topBottomSpacing
      this._pos = {
        x: this._host.itemSpacing,
        y: this._host.topBottomSpacing,
      }
    }

    // 计算可用宽度
    const availableWidth =
      this._host.boundsWidth - this._host.scrollbarWidth

    // 检查是否需要换行
    if (
      this._pos.x + w.bounds.width + this._host.itemSpacing >
      availableWidth
    ) {
      // 开始新行
      this._pos = {
        x: this._host.itemSpacing,
        y:
          this._host.contentHeight -
          this._host.topBottomSpacing +
          this._host.itemSpacing,
      }
    }

    // 如果是列数限制的网格，使用统一单元格宽度
    if (this._columnCount > 0) {
      const cellWidth =
        (availableWidth -
          this._host.itemSpacing * (this._columnCount + 1)) /
        this._columnCount
      w.bounds.width = Math.max(0, cellWidth)
    }

    // 设置子 widget 的 bounds
    w.bounds.x += this._pos.x
    w.bounds.y += this._pos.y

    // 前进光标
    this._pos = {
      x: this._pos.x + w.bounds.width + this._host.itemSpacing,
      y: this._pos.y,
    }

    // 更新 ContentHeight
    this._host.contentHeight = Math.max(
      this._host.contentHeight,
      this._pos.y + w.bounds.height + this._host.topBottomSpacing,
    )
  }

  // ---------------------------------------------------------------------------
  // AdjustChildren — 重新计算所有子 widget 的 bounds
  // OpenRA 对照: GridLayout.AdjustChildren()
  // ---------------------------------------------------------------------------

  /**
   * 重新计算所有子 widget 的布局。
   *
   * 遍历所有子 widget，重新应用网格布局逻辑。
   *
   * OpenRA 对照: public void AdjustChildren()
   */
  adjustChildren(): void {
    if (this._host.children.length === 0) return

    this._host.contentHeight =
      2 * this._host.topBottomSpacing
    this._pos = {
      x: this._host.itemSpacing,
      y: this._host.topBottomSpacing,
    }

    const availableWidth =
      this._host.boundsWidth - this._host.scrollbarWidth

    for (const w of this._host.children) {
      // 检查是否需要换行
      if (
        this._pos.x + w.bounds.width + this._host.itemSpacing >
        availableWidth
      ) {
        this._pos = {
          x: this._host.itemSpacing,
          y:
            this._host.contentHeight -
            this._host.topBottomSpacing +
            this._host.itemSpacing,
        }
      }

      w.bounds.x = this._pos.x
      w.bounds.y = this._pos.y

      this._pos = {
        x: this._pos.x + w.bounds.width + this._host.itemSpacing,
        y: this._pos.y,
      }

      this._host.contentHeight = Math.max(
        this._host.contentHeight,
        this._pos.y + w.bounds.height + this._host.topBottomSpacing,
      )
    }
  }
}
