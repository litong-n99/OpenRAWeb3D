/**
 * LabelWithTooltipWidget.ts — 带工具提示的标签 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/LabelWithTooltipWidget.cs (64 lines)
 *
 * 核心范式转换:
 * - C# LabelWidget + Lazy<TooltipContainerWidget> → TypeScript LabelWidget + 延迟容器查找
 * - C# MouseEntered/MouseExited 覆盖 → TypeScript mouseEntered/mouseExited 覆盖
 * - C# Ui.Root.Get<TooltipContainerWidget>(TooltipContainer) → TypeScript 容器查找函数
 * - C# WidgetArgs { { "getText", GetTooltipText } } → TypeScript Record<string, unknown>
 * - C# Exts.Lazy + IsValueCreated → TypeScript 手动标记模式
 */

import { LabelWidget } from './LabelWidget.js'
import type { WidgetArgs } from '../../OpenRA.Game/Widgets/Widget.js'
import type { ITooltipContainer } from './ButtonWidget.js'

// ---------------------------------------------------------------------------
// LabelWithTooltipWidget — 带工具提示的标签
// OpenRA 对照: public class LabelWithTooltipWidget : LabelWidget
// ---------------------------------------------------------------------------

/**
 * 带工具提示的标签 widget。
 *
 * 鼠标进入时通过 TooltipContainerWidget 显示工具提示。
 * 鼠标离开时移除工具提示。
 *
 * OpenRA 对照: LabelWithTooltipWidget
 */
export class LabelWithTooltipWidget extends LabelWidget {
  /** 工具提示模板名。OpenRA 对照: LabelWithTooltipWidget.TooltipTemplate */
  tooltipTemplate: string = 'LABEL_WITH_TOOLTIP'

  /** 工具提示容器 ID。OpenRA 对照: LabelWithTooltipWidget.TooltipContainer */
  tooltipContainerId: string | null = null

  /** 获取工具提示文本的委托。OpenRA 对照: LabelWithTooltipWidget.GetTooltipText */
  getTooltipText: () => string = () => ''

  /** 工具提示容器查找函数（延迟初始化）。
   *
   * OpenRA 对照: Exts.Lazy(() => Ui.Root.Get<TooltipContainerWidget>(TooltipContainer))
   */
  private _tooltipContainerResolver: (() => ITooltipContainer | null) | null = null

  /** 缓存的工具提示容器实例。 */
  private _tooltipContainerCache: ITooltipContainer | null = null

  /** 工具提示容器是否已创建。OpenRA 对照: Lazy<T>.IsValueCreated */
  private _tooltipContainerCreated: boolean = false

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: LabelWithTooltipWidget(ModData) / LabelWithTooltipWidget(LabelWithTooltipWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 LabelWithTooltipWidget。
   *
   * OpenRA 对照: public LabelWithTooltipWidget(ModData modData) : base(modData)
   */
  constructor(_modData?: unknown) {
    super(_modData)
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected LabelWithTooltipWidget(LabelWithTooltipWidget other) : base(other)
   */
  protected copyFrom(other: LabelWithTooltipWidget): void {
    super.copyFrom(other)
    this.tooltipTemplate = other.tooltipTemplate
    this.tooltipContainerId = other.tooltipContainerId
    this.getTooltipText = other.getTooltipText
    this._tooltipContainerResolver = other._tooltipContainerResolver

    // 重置 Lazy 状态
    this._tooltipContainerCreated = false
    this._tooltipContainerCache = null
  }

  // ---------------------------------------------------------------------------
  // TooltipContainer 延迟初始化
  // OpenRA 对照: Exts.Lazy(() => Ui.Root.Get<TooltipContainerWidget>(...))
  // ---------------------------------------------------------------------------

  /**
   * 获取工具提示容器（延迟初始化，首次访问时调用工厂函数）。
   *
   * OpenRA 对照: Lazy<TooltipContainerWidget>.Value
   */
  get tooltipContainer(): ITooltipContainer | null {
    if (!this._tooltipContainerCreated) {
      this._tooltipContainerCreated = true
      if (this._tooltipContainerResolver) {
        this._tooltipContainerCache = this._tooltipContainerResolver()
      }
    }
    return this._tooltipContainerCache
  }

  /**
   * 工具提示容器是否已创建。
   * OpenRA 对照: Lazy<T>.IsValueCreated
   */
  get isTooltipContainerCreated(): boolean {
    return this._tooltipContainerCreated
  }

  /**
   * 设置工具提示容器查找函数。
   *
   * 模拟 OpenRA 的 `Exts.Lazy(() => Ui.Root.Get<TooltipContainerWidget>(...))`。
   */
  setTooltipContainerResolver(resolver: () => ITooltipContainer | null): void {
    this._tooltipContainerResolver = resolver
  }

  // ---------------------------------------------------------------------------
  // MouseEntered / MouseExited — 工具提示生命周期
  // OpenRA 对照: MouseEntered() / MouseExited()
  // ---------------------------------------------------------------------------

  /**
   * 鼠标进入时显示工具提示。
   *
   * OpenRA 对照: public override void MouseEntered()
   */
  override mouseEntered(): void {
    if (!this.tooltipContainerId) return

    const container = this.tooltipContainer
    if (!container) return

    const args: WidgetArgs = {
      getText: this.getTooltipText,
    }
    container.setTooltip(this.tooltipTemplate, args)
  }

  /**
   * 鼠标离开时移除工具提示。
   *
   * OpenRA 对照: public override void MouseExited()
   */
  override mouseExited(): void {
    // OpenRA: 仅当容器已创建时才尝试移除，避免崩溃
    if (!this.tooltipContainerId || !this._tooltipContainerCreated) return

    const container = this.tooltipContainer
    if (!container) return

    container.removeTooltip()
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: public override LabelWithTooltipWidget Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 LabelWithTooltipWidget。
   *
   * OpenRA 对照: public override LabelWithTooltipWidget Clone()
   */
  override clone(): LabelWithTooltipWidget {
    const w = new LabelWithTooltipWidget()
    w.copyFrom(this)
    w.id = this.id
    w._xExpr = this._xExpr
    w._yExpr = this._yExpr
    w._widthExpr = this._widthExpr
    w._heightExpr = this._heightExpr
    w.logic = [...this.logic]
    w.visible = this.visible
    w.bounds = { ...this.bounds }
    return w
  }
}
