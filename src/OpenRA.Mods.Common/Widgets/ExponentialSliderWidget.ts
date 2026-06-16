/**
 * ExponentialSliderWidget.ts — 指数映射滑块（用于音量等非线性控制）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ExponentialSliderWidget.cs (50 lines)
 *
 * 核心范式转换:
 * - C# override ValueFromPx/PxFromValue 指数映射
 *   → TypeScript override valueFromPx/pxFromValue
 * - C# Math.Exp / Math.Log (double precision)
 *   → JavaScript Math.exp / Math.log (IEEE 754 double)
 * - 指数公式: value = ExpA * exp(ExpB * position)
 *   其中 position ∈ [0, 1] 为线性滑块位置
 * - 参考: https://www.dr-lex.be/info-stuff/volumecontrols.html
 * - 用途: 音频音量控制（人类感知为对数/指数）
 *
 * NOTE: ExponentialSliderWidget 继承了 SliderWidget 的所有属性，
 * 仅覆盖像素↔值映射方法。渲染和交互行为完全由基类处理。
 */

import { SliderWidget } from './SliderWidget.js'

// ---------------------------------------------------------------------------
// ExponentialSliderWidget — 指数映射滑块
// OpenRA 对照: public class ExponentialSliderWidget : SliderWidget
// ---------------------------------------------------------------------------

/**
 * 指数映射滑块 — 将线性滑块位置转换为指数增长的值。
 *
 * 内部表示: 滑块位置按线性 0-1 范围操作，
 * 但显示/输出的值按指数公式映射:
 *
 *   value = MinimumValue + (MaximumValue - MinimumValue) * ExpFromLinear(position)
 *   position = LinearFromExp((value - MinimumValue) / (MaximumValue - MinimumValue))
 *
 * 其中:
 *   ExpFromLinear(x) = ExpA * exp(ExpB * x)      (clamped to [0, 1])
 *   LinearFromExp(x)  = log(x / ExpA) / ExpB      (clamped to [0, 1])
 *
 * 典型用途: 音频音量滑块（音量感知为对数）。
 *
 * OpenRA 对照: public class ExponentialSliderWidget : SliderWidget
 *
 * 参数参考: https://www.dr-lex.be/info-stuff/volumecontrols.html
 */
export class ExponentialSliderWidget extends SliderWidget {
  // ---------------------------------------------------------------------------
  // Properties — OpenRA 对照: ExponentialSliderWidget 字段
  // ---------------------------------------------------------------------------

  /**
   * 指数参数 A（缩放因子）。
   *
   * 默认 1.0e-3，约为 -60 dB 的最小声级。
   * 此值定义了滑块位置为 0 时的最小输出值。
   *
   * OpenRA 对照: public double ExpA = 1.0e-3
   */
  expA: number = 1.0e-3

  /**
   * 指数参数 B（增长率）。
   *
   * 默认 6.908，约为 60 dB 的动态范围 (ln(1000) ≈ 6.908)。
   *
   * OpenRA 对照: public double ExpB = 6.908
   */
  expB: number = 6.908

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * 构造 ExponentialSliderWidget。
   *
   * OpenRA 对照: public ExponentialSliderWidget()
   */
  constructor() {
    super()
  }

  // ---------------------------------------------------------------------------
  // Copy from another ExponentialSliderWidget
  // ---------------------------------------------------------------------------

  /**
   * 从另一个 ExponentialSliderWidget 复制属性。
   *
   * OpenRA 对照: public ExponentialSliderWidget(ExponentialSliderWidget other) : base(other)
   */
  protected copyExponentialFrom(other: ExponentialSliderWidget): void {
    this.copySliderFrom(other)
    this.expA = other.expA
    this.expB = other.expB
  }

  // ---------------------------------------------------------------------------
  // Exponential mapping functions
  // OpenRA 对照: ExpFromLinear(float), LinearFromExp(float)
  // ---------------------------------------------------------------------------

  /**
   * 将线性位置 [0, 1] 转换为指数输出值 [0, 1]。
   *
   * 公式: ExpA * exp(ExpB * x), clamped to [0, 1]
   *
   * OpenRA 对照: float ExpFromLinear(float x)
   *
   * @param x — 线性位置（0.0 到 1.0）
   * @returns 指数映射后的值（0.0 到 1.0）
   */
  expFromLinear(x: number): number {
    if (x <= 0) return 0

    const result = this.expA * Math.exp(this.expB * x)
    return this._clamp(result, 0, 1)
  }

  /**
   * 将指数输出值 [0, 1] 转换为线性位置 [0, 1]（expFromLinear 的逆函数）。
   *
   * 公式: log(x / ExpA) / ExpB, clamped to [0, 1]
   *
   * OpenRA 对照: float LinearFromExp(float x)
   *
   * @param x — 指数值（0.0 到 1.0）
   * @returns 线性位置（0.0 到 1.0）
   */
  linearFromExp(x: number): number {
    if (x <= 0) return 0

    const result = Math.log(x / this.expA) / this.expB
    return this._clamp(result, 0, 1)
  }

  // ---------------------------------------------------------------------------
  // Override pixel ↔ value conversion
  // OpenRA 对照: override ValueFromPx, override PxFromValue
  // ---------------------------------------------------------------------------

  /**
   * 将像素 x 坐标转换为滑块值（使用指数映射）。
   *
   * OpenRA 对照: protected override float ValueFromPx(int x)
   *
   * 首先计算线性比例，然后通过 ExpFromLinear 映射。
   */
  override valueFromPx(x: number): number {
    const w = this.bounds.width
    const h = this.bounds.height
    if (w <= h) return this.minimumValue

    const linearRatio = (x - 0.5 * h) / (w - h)
    const clippedLinear = this._clamp(linearRatio, 0, 1)
    const expRatio = this.expFromLinear(clippedLinear)

    return this.minimumValue + (this.maximumValue - this.minimumValue) * expRatio
  }

  /**
   * 将滑块值转换为像素 x 坐标（使用指数映射的逆函数）。
   *
   * OpenRA 对照: protected override int PxFromValue(float x)
   *
   * 首先计算输出比例，然后通过 LinearFromExp 映射回线性位置。
   */
  override pxFromValue(x: number): number {
    const w = this.bounds.width
    const h = this.bounds.height
    if (this.maximumValue === this.minimumValue) return 0.5 * h

    const outputRatio = (x - this.minimumValue) / (this.maximumValue - this.minimumValue)
    const clippedOutput = this._clamp(outputRatio, 0, 1)
    const linearRatio = this.linearFromExp(clippedOutput)

    return Math.round(0.5 * h + (w - h) * linearRatio)
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: 无显式 Clone()，C# 回退到基类
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 ExponentialSliderWidget。
   */
  override clone(): ExponentialSliderWidget {
    const c = new ExponentialSliderWidget()
    c.copyExponentialFrom(this)
    c.id = this.id
    c._xExpr = this._xExpr
    c._yExpr = this._yExpr
    c._widthExpr = this._widthExpr
    c._heightExpr = this._heightExpr
    c.logic = [...this.logic]
    c.visible = this.visible
    c.disabled = this.disabled
    c.isDisabled = this.isDisabled
    c.isVisible = this.isVisible
    c.ignoreMouseOver = this.ignoreMouseOver
    c.ignoreChildMouseOver = this.ignoreChildMouseOver
    c.bounds = { ...this.bounds }
    for (const child of this.children) {
      c.addChild(child.clone())
    }
    return c
  }
}
