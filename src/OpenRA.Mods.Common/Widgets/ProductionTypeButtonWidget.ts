/**
 * ProductionTypeButtonWidget.ts — 生产类型按钮 widget：具有 ProductionGroup 属性的按钮
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ProductionTypeButtonWidget.cs (28 lines)
 *
 * 核心范式转换:
 * - C# WorldButtonWidget (ButtonWidget 子类，持有 World 引用) → TS ButtonWidget + ProductionGroup 属性
 * - C# [ObjectCreator.UseCtor] 构造注入 → TS 构造函数
 *
 * ProductionTypeButtonWidget 是一个简单的按钮 widget，额外携带一个
 * ProductionGroup 属性。当点击时，相关的 Logic 将其关联的生产队列
 * 绑定到 ProductionPaletteWidget 进行显示。
 *
 * OpenRA 对照: public class ProductionTypeButtonWidget : WorldButtonWidget
 */

import { ButtonWidget } from './ButtonWidget.js'

// ---------------------------------------------------------------------------
// ProductionTypeButtonWidget
// OpenRA 对照: public class ProductionTypeButtonWidget : WorldButtonWidget
// ---------------------------------------------------------------------------

/**
 * Production type selection button.
 *
 * Each button represents a category of production (e.g., "Building", "Infantry").
 * When clicked, it sets the active production queue group, causing the
 * ProductionPaletteWidget to display the buildable items for that category.
 *
 * OpenRA 对照: public class ProductionTypeButtonWidget : WorldButtonWidget
 */
export class ProductionTypeButtonWidget extends ButtonWidget {
  /** The production group this button activates.
   *
   * OpenRA 对照: public readonly string ProductionGroup
   */
  productionGroup: string

  /**
   * Construct a ProductionTypeButtonWidget.
   *
   * OpenRA 对照: public ProductionTypeButtonWidget(ModData modData, World world) : base(modData, world)
   *
   * @param _modData — ModData reference (stub)
   */
  constructor(productionGroup: string = '', _modData?: unknown) {
    super(_modData)
    this.productionGroup = productionGroup
  }

  /**
   * Copy constructor (for Clone).
   *
   * OpenRA 对照: protected ProductionTypeButtonWidget(ProductionTypeButtonWidget other) : base(other)
   */
  protected copyFrom(other: ProductionTypeButtonWidget): void {
    super['copyFrom']?.(other as unknown as ButtonWidget)
    this.productionGroup = other.productionGroup
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: ProductionTypeButtonWidget.Clone()
  // ---------------------------------------------------------------------------

  /**
   * Clone this widget.
   *
   * OpenRA 对照: public override ButtonWidget Clone() → WorldButtonWidget.Clone()
   */
  override clone(): ProductionTypeButtonWidget {
    const b = new ProductionTypeButtonWidget(this.productionGroup)
    b.copyFrom(this)
    b.id = this.id
    b._xExpr = this._xExpr
    b._yExpr = this._yExpr
    b._widthExpr = this._widthExpr
    b._heightExpr = this._heightExpr
    b.logic = [...this.logic]
    b.visible = this.visible
    b.ignoreMouseOver = this.ignoreMouseOver
    b.ignoreChildMouseOver = this.ignoreChildMouseOver
    b.isVisible = this.isVisible
    b.isDisabled = this.isDisabled
    b.bounds = { ...this.bounds }
    for (const child of this.children) {
      b.addChild(child.clone())
    }
    return b
  }
}
