/**
 * ColorMixerWidget.ts — HSV 颜色选择器 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ColorMixerWidget.cs (189 lines)
 *
 * 核心范式转换:
 * - OpenRA Sheet + Sprite (GPU 纹理 + 精灵) → HTML Canvas 2D 绘图
 * - OpenRA RenderBounds → CSS bounds (x, y, width, height)
 * - OpenRA HandleMouseInput (SDL2 MouseInput) → DOM mousemove/mousedown/mouseup
 * - OpenRA Color.FromAhsv / ToAhsv → hsvToRgb / rgbToHsv (Color.ts)
 * - OpenRA ChromeProvider.GetImage (colorpicker sprite) → CSS 渲染
 * - OpenRA OnChange event → TypeScript onChange 回调函数
 *
 * HSV→RGB 转换完全匹配 OpenRA 的算法（基于 lolengine.net 的快速 HSV 方法），
 * 精度在 ±1/255 以内。
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type {
  WidgetArgs,
  WidgetEvent,
} from '../../OpenRA.Game/Widgets/Widget.js'
import { hsvToRgb, rgbToHsv, toArgb, fromArgb } from '../../OpenRA.Game/Primitives/Color.js'

// ---------------------------------------------------------------------------
// ARGB color type — uint32 编码，与 OpenRA Color.ToArgb() / FromArgb() 对齐
// ---------------------------------------------------------------------------

/** uint32 ARGB 颜色值（格式: 0xAARRGGBB）。OpenRA 对照: Color.ToArgb() */
type ArgbColor = number

/** 从 ARGB 颜色值转换为十六进制 CSS 颜色字符串 (如 "#RRGGBB")。 */
function argbToHex(argb: number): string {
  const { r, g, b } = fromArgb(argb)
  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  ).toUpperCase()
}

/** 从十六进制 CSS 颜色字符串 (如 "#RRGGBB") 解析为 ARGB 颜色值。 */
function hexToArgb(hex: string): number {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  }
  if (h.length !== 6) return 0xffffffff
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 0xffffffff
  return toArgb(255, r, g, b)
}

/** 从 HSV 分量构建 ARGB 颜色。OpenRA 对照: Color.FromAhsv(float, float, float) */
function fromAhsv(h: number, s: number, v: number): ArgbColor {
  const { r, g, b } = hsvToRgb(h, s, v)
  return toArgb(255, Math.round(r * 255), Math.round(g * 255), Math.round(b * 255))
}

/** 将 ARGB 颜色分解为 HSV 分量。OpenRA 对照: Color.ToAhsv() */
function toAhsv(argb: number): { h: number; s: number; v: number } {
  const { r, g, b } = fromArgb(argb)
  return rgbToHsv(r / 255, g / 255, b / 255)
}

/** 将值钳位于 [min, max] 范围。 */
function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x
}

// ---------------------------------------------------------------------------
// ColorMixerWidget — HSV 颜色选择器
// OpenRA 对照: public class ColorMixerWidget : Widget
// ---------------------------------------------------------------------------

/**
 * HSV 颜色选择器 widget。
 *
 * 包含三个交互组件：
 * - SV（饱和度/亮度）方形：Canvas 渲染的 HSL 网格（固定 H 值），
 *   可拖动选择 S 和 V 值。
 * - H（色相）滑块：HTML `<input type="range">`，控制当前色相。
 * - RGB 十六进制文本输入：直接输入颜色值。
 * - 颜色预览色块：显示当前选中颜色。
 *
 * 用于玩家颜色选择、设置界面等场景。
 *
 * OpenRA 对照: public class ColorMixerWidget : Widget
 */
export class ColorMixerWidget extends Widget {
  // ---- 颜色状态 (OpenRA 对照: public float H / S / V) ----

  /** 色相 (0.0 到 1.0)。OpenRA 对照: H */
  private _h: number = 0

  /** 饱和度 (0.0 到 1.0)。OpenRA 对照: S */
  private _s: number = 1

  /** 亮度 (0.0 到 1.0)。OpenRA 对照: V */
  private _v: number = 1

  /** 饱和度下限。OpenRA 对照: minSat */
  private _minSat: number = 0

  /** 饱和度上限。OpenRA 对照: maxSat */
  private _maxSat: number = 1

  /** 亮度下限。OpenRA 对照: minVal */
  private _minVal: number = 0

  /** 亮度上限。OpenRA 对照: maxVal */
  private _maxVal: number = 1

  // ---- 事件 (OpenRA 对照: public event Action OnChange) ----

  /** 颜色变更回调。OpenRA 对照: OnChange */
  onChange: () => void = () => {}

  /** 鼠标拖动标志。OpenRA 对照: isMoving */
  private _isMoving: boolean = false

  // ---- DOM 元素缓存 ----

  /** SV 方形 Canvas 元素 */
  private _svCanvas: HTMLCanvasElement | null = null

  /** H 滑块元素 */
  private _hSlider: HTMLInputElement | null = null

  /** 十六进制文本输入元素 */
  private _hexInput: HTMLInputElement | null = null

  /** 颜色预览色块元素 */
  private _previewSwatch: HTMLElement | null = null

  // ---- Public accessors ----

  /** 获取当前色相。OpenRA 对照: H */
  get h(): number {
    return this._h
  }

  /** 获取当前饱和度。OpenRA 对照: S */
  get s(): number {
    return this._s
  }

  /** 获取当前亮度。OpenRA 对照: V */
  get v(): number {
    return this._v
  }

  /** 获取当前颜色（ARGB uint32）。OpenRA 对照: Color Color */
  get color(): ArgbColor {
    return fromAhsv(this._h, this._s, this._v)
  }

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: 默认构造函数 / ColorMixerWidget(other) 复制构造
  // ---------------------------------------------------------------------------

  constructor() {
    super()
  }

  // ---------------------------------------------------------------------------
  // Initialize
  // OpenRA 对照: public override void Initialize(WidgetArgs args)
  // ---------------------------------------------------------------------------

  override initialize(args: WidgetArgs): void {
    super.initialize(args)
  }

  // ---------------------------------------------------------------------------
  // SetColorLimits — 设置 S/V 范围
  // OpenRA 对照: public void SetColorLimits(...)
  // ---------------------------------------------------------------------------

  /**
   * 设置饱和度和亮度的有效范围。可选指定新的色相值。
   *
   * 在更新 S/V 限制后重新绘制 SV 方形 Canvas。
   *
   * OpenRA 对照: public void SetColorLimits(float minSaturation, float maxSaturation,
   *                                          float minValue, float maxValue, float? newHue = null)
   *
   * @param minSat — 最小饱和度 (0.0-1.0)
   * @param maxSat — 最大饱和度 (0.0-1.0)
   * @param minVal — 最小亮度 (0.0-1.0)
   * @param maxVal — 最大亮度 (0.0-1.0)
   * @param newHue — 可选的新的色相值 (0.0-1.0)，null 则保持当前值
   */
  setColorLimits(
    minSat: number,
    maxSat: number,
    minVal: number,
    maxVal: number,
    newHue?: number,
  ): void {
    this._minSat = clamp(minSat, 0, 1)
    this._maxSat = clamp(maxSat, 0, 1)
    this._minVal = clamp(minVal, 0, 1)
    this._maxVal = clamp(maxVal, 0, 1)

    if (newHue !== undefined) {
      this._h = clamp(newHue, 0, 1)
    }

    // 钳制当前 S 和 V 到新范围
    this._s = clamp(this._s, this._minSat, this._maxSat)
    this._v = clamp(this._v, this._minVal, this._maxVal)

    // 重绘 SV 方形
    this._renderSvCanvas()
  }

  // ---------------------------------------------------------------------------
  // GetColor / SetColor — 颜色存取
  // OpenRA 对照: Color Color { get } / void Set(Color color)
  // ---------------------------------------------------------------------------

  /**
   * 设置颜色选择器为最接近给定 ARGB 颜色的有效值。
   * 饱和度和亮度会被钳制到当前范围。
   *
   * OpenRA 对照: public void Set(Color color)
   *
   * @param argb — ARGB 颜色值
   */
  setColor(argb: ArgbColor): void {
    const { h, s, v } = toAhsv(argb)
    const clampedS = clamp(s, this._minSat, this._maxSat)
    const clampedV = clamp(v, this._minVal, this._maxVal)

    if (this._h !== h || this._s !== clampedS || this._v !== clampedV) {
      this._h = h
      this._s = clampedS
      this._v = clampedV
      this._renderSvCanvas()
      this._syncAllControls()
      this.onChange()
    }
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: public override void Draw()
  //
  // 渲染三个区域:
  // 1. SV 方形 (Canvas)
  // 2. H 滑块 + RGB 输入
  // 3. 颜色预览色块
  // ---------------------------------------------------------------------------

  /**
   * 渲染完整颜色选择器为 DOM 元素。
   *
   * 布局（水平排列）：
   * - 左侧: SV 方形（正方形 Canvas）
   * - 中间: H 色相条 + RGB 十六进制输入
   * - 右侧: 颜色预览色块
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'color-mixer-widget')
    el.style.position = 'absolute'
    el.style.display = 'flex'
    el.style.gap = '8px'
    el.style.alignItems = 'stretch'
    el.style.userSelect = 'none'
    el.style.boxSizing = 'border-box'

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 清除旧子元素
    while (el.firstChild) {
      el.removeChild(el.firstChild)
    }

    // ---- 区域 1: SV 方形 ----
    const svWrapper = this._createSvArea()
    el.appendChild(svWrapper)

    // ---- 区域 2: H 滑块 + 十六进制输入 ----
    const controlColumn = document.createElement('div')
    controlColumn.style.display = 'flex'
    controlColumn.style.flexDirection = 'column'
    controlColumn.style.gap = '6px'
    controlColumn.style.justifyContent = 'center'
    controlColumn.style.flex = '0 0 auto'

    controlColumn.appendChild(this._createHueSlider())
    controlColumn.appendChild(this._createHexInput())

    el.appendChild(controlColumn)

    // ---- 区域 3: 颜色预览色块 ----
    el.appendChild(this._createPreviewSwatch())

    return el
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
  //
  // 鼠标事件通过 DOM 直接在 SV Canvas 上处理。
  // ---------------------------------------------------------------------------

  override handleEvent(_event: WidgetEvent): boolean {
    // SV Canvas 上的鼠标事件由内部处理器直接处理
    return false
  }

  override getCursor(_pos: { x: number; y: number }): string | null {
    return null
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: 复制构造函数支持
  // ---------------------------------------------------------------------------

  override clone(): ColorMixerWidget {
    const cloned = new ColorMixerWidget()
    cloned.id = this.id
    cloned._xExpr = this._xExpr
    cloned._yExpr = this._yExpr
    cloned._widthExpr = this._widthExpr
    cloned._heightExpr = this._heightExpr
    cloned.logic = [...this.logic]
    cloned.visible = this.visible
    cloned.ignoreMouseOver = this.ignoreMouseOver
    cloned.ignoreChildMouseOver = this.ignoreChildMouseOver
    cloned.isVisible = this.isVisible
    cloned.bounds = { ...this.bounds }

    cloned._h = this._h
    cloned._s = this._s
    cloned._v = this._v
    cloned._minSat = this._minSat
    cloned._maxSat = this._maxSat
    cloned._minVal = this._minVal
    cloned._maxVal = this._maxVal
    cloned.onChange = this.onChange

    for (const child of this.children) {
      cloned.addChild(child.clone())
    }
    return cloned
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  override dispose(): void {
    this._svCanvas = null
    this._hSlider = null
    this._hexInput = null
    this._previewSwatch = null
    super.dispose()
  }

  // ===================================================================
  // Private: SV 方形区域
  // ===================================================================

  /**
   * 创建 SV 方形区域（Canvas + 标记覆盖层）。
   */
  private _createSvArea(): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.style.position = 'relative'
    wrapper.style.flex = '1 1 auto'
    wrapper.style.aspectRatio = '1'
    wrapper.style.minWidth = '0'
    wrapper.style.minHeight = '0'
    wrapper.style.cursor = 'crosshair'

    // SV Canvas
    this._svCanvas = document.createElement('canvas')
    this._svCanvas.style.position = 'absolute'
    this._svCanvas.style.width = '100%'
    this._svCanvas.style.height = '100%'
    this._svCanvas.style.left = '0'
    this._svCanvas.style.top = '0'
    wrapper.appendChild(this._svCanvas)

    // 选择指示器（十字准线点）
    const indicator = document.createElement('div')
    indicator.className = 'sv-indicator'
    indicator.style.position = 'absolute'
    indicator.style.width = '8px'
    indicator.style.height = '8px'
    indicator.style.borderRadius = '50%'
    indicator.style.border = '2px solid #fff'
    indicator.style.boxShadow = '0 0 2px rgba(0,0,0,0.5)'
    indicator.style.pointerEvents = 'none'
    indicator.style.transform = 'translate(-50%, -50%)'
    indicator.style.zIndex = '1'
    wrapper.appendChild(indicator)

    // 首次渲染 Canvas 内容
    this._renderSvCanvas()

    // 鼠标事件
    this._setupSvMouseEvents(wrapper, indicator)

    return wrapper
  }

  /**
   * 在 Canvas 上渲染 SV 方形（给定当前 H）。
   *
   * 绘制 256×256 的 HSV 网格：
   * - 水平轴: V（亮度），从左到右递增 (0→1)
   * - 垂直轴: S（饱和度），从下到上递增 (0→1)
   *
   * OpenRA 对照: SetColorLimits 中的 palette 生成循环
   */
  private _renderSvCanvas(): void {
    const canvas = this._svCanvas
    if (!canvas) return

    // 使用固定分辨率 256×256 匹配 OpenRA
    const size = 256
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const imageData = ctx.createImageData(size, size)
    const data = imageData.data

    // 计算有效范围
    const vMin = Math.round(this._minVal * (size - 1))
    const vMax = Math.round(this._maxVal * (size - 1))
    const sMin = Math.round((1 - this._maxSat) * (size - 1))
    const sMax = Math.round((1 - this._minSat) * (size - 1))

    for (let sy = 0; sy < size; sy++) {
      for (let vx = 0; vx < size; vx++) {
        const idx = (sy * size + vx) * 4

        // Y 轴从上到下: S = 1 (top) → 0 (bottom)
        // C#: s = 1 - sIndex / 255f
        const s = 1 - sy / (size - 1)
        const vVal = vx / (size - 1)

        // 检查是否在有效范围内
        const inRange =
          vx >= vMin && vx <= vMax && sy >= sMin && sy <= sMax

        if (inRange) {
          const { r, g, b } = hsvToRgb(this._h, s, vVal)
          data[idx] = Math.round(r * 255)
          data[idx + 1] = Math.round(g * 255)
          data[idx + 2] = Math.round(b * 255)
          data[idx + 3] = 255
        } else {
          // 范围外区域显示为浅灰色
          data[idx] = 200
          data[idx + 1] = 200
          data[idx + 2] = 200
          data[idx + 3] = 255
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
  }

  /**
   * 为 SV 方形设置鼠标事件。
   */
  private _setupSvMouseEvents(wrapper: HTMLElement, indicator: HTMLElement): void {
    const getSvFromEvent = (e: MouseEvent): { s: number; v: number } | null => {
      const rect = wrapper.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null

      const px = (e.clientX - rect.left) / rect.width
      const py = (e.clientY - rect.top) / rect.height

      // C#: v = Lerp(minVal, maxVal, x / Width)
      // C#: s = Lerp(minSat, maxSat, 1 - y / Height)
      const v = this._minVal + px * (this._maxVal - this._minVal)
      const s = this._minSat + (1 - py) * (this._maxSat - this._minSat)

      return {
        s: clamp(s, this._minSat, this._maxSat),
        v: clamp(v, this._minVal, this._maxVal),
      }
    }

    const updateIndicator = (s: number, v: number): void => {
      // 反转计算以获取像素位置
      // v → px, s → py
      const ratioV = this._maxVal !== this._minVal
        ? (v - this._minVal) / (this._maxVal - this._minVal)
        : 0.5
      const ratioS = this._maxSat !== this._minSat
        ? 1 - (s - this._minSat) / (this._maxSat - this._minSat)
        : 0.5
      indicator.style.left = `${ratioV * 100}%`
      indicator.style.top = `${ratioS * 100}%`
    }

    // 初始指示器位置
    updateIndicator(this._s, this._v)

    wrapper.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      this._isMoving = true

      const result = getSvFromEvent(e)
      if (result) {
        this._s = result.s
        this._v = result.v
        updateIndicator(this._s, this._v)
        this._syncAllControls()
        this.onChange()
      }
    })

    const onMove = (e: MouseEvent): void => {
      if (!this._isMoving) return
      const result = getSvFromEvent(e)
      if (result) {
        this._s = result.s
        this._v = result.v
        updateIndicator(this._s, this._v)
        this._syncAllControls()
        this.onChange()
      }
    }

    const onUp = (): void => {
      this._isMoving = false
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)

    // 存储清理函数引用
    const cleanupKey = '__svCleanup'
    ;(wrapper as any)[cleanupKey] = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }

  // ===================================================================
  // Private: H 色相滑块
  // ===================================================================

  /**
   * 创建色相滑块（HTML range input）。
   *
   * OpenRA 对照: HueSliderWidget（独立的色相滑块 widget）
   */
  private _createHueSlider(): HTMLElement {
    const container = document.createElement('div')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '2px'

    const label = document.createElement('label')
    label.textContent = 'H'
    label.style.fontSize = '11px'
    label.style.color = '#ccc'

    this._hSlider = document.createElement('input')
    this._hSlider.type = 'range'
    this._hSlider.min = '0'
    this._hSlider.max = '360'
    this._hSlider.step = '1'
    this._hSlider.value = String(Math.round(this._h * 360))
    this._hSlider.style.width = '120px'
    this._hSlider.style.cursor = 'pointer'
    this._hSlider.style.background =
      'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'
    this._hSlider.style.height = '16px'
    this._hSlider.style.borderRadius = '8px'
    this._hSlider.style.appearance = 'none'
    this._hSlider.style.outline = 'none'

    this._hSlider.addEventListener('input', () => {
      if (!this._hSlider) return
      const deg = parseInt(this._hSlider.value, 10)
      this._h = clamp(deg / 360, 0, 1)
      this._renderSvCanvas()
      this._syncAllControls()
      this.onChange()
    })

    container.appendChild(label)
    container.appendChild(this._hSlider)
    return container
  }

  // ===================================================================
  // Private: RGB 十六进制输入
  // ===================================================================

  /**
   * 创建十六进制颜色文本输入。
   */
  private _createHexInput(): HTMLElement {
    const container = document.createElement('div')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '2px'

    const label = document.createElement('label')
    label.textContent = 'Hex'
    label.style.fontSize = '11px'
    label.style.color = '#ccc'

    this._hexInput = document.createElement('input')
    this._hexInput.type = 'text'
    this._hexInput.value = argbToHex(this.color)
    this._hexInput.maxLength = 7
    this._hexInput.style.width = '120px'
    this._hexInput.style.padding = '3px 6px'
    this._hexInput.style.fontSize = '13px'
    this._hexInput.style.fontFamily = 'monospace'
    this._hexInput.style.background = '#333'
    this._hexInput.style.color = '#fff'
    this._hexInput.style.border = '1px solid #555'
    this._hexInput.style.borderRadius = '3px'
    this._hexInput.style.outline = 'none'

    this._hexInput.addEventListener('input', () => {
      if (!this._hexInput) return
      const hex = this._hexInput.value.trim()
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        const argb = hexToArgb(hex)
        const { h, s, v } = toAhsv(argb)
        this._h = h
        this._s = clamp(s, this._minSat, this._maxSat)
        this._v = clamp(v, this._minVal, this._maxVal)
        this._renderSvCanvas()
        this._syncAllControls(true)
        this.onChange()
      }
    })

    // 失焦时规范化十六进制值
    this._hexInput.addEventListener('blur', () => {
      if (!this._hexInput) return
      this._hexInput.value = argbToHex(this.color)
    })

    container.appendChild(label)
    container.appendChild(this._hexInput)
    return container
  }

  // ===================================================================
  // Private: 颜色预览色块
  // ===================================================================

  /**
   * 创建颜色预览色块。
   */
  private _createPreviewSwatch(): HTMLElement {
    this._previewSwatch = document.createElement('div')
    this._previewSwatch.style.width = '40px'
    this._previewSwatch.style.minHeight = '40px'
    this._previewSwatch.style.border = '1px solid #555'
    this._previewSwatch.style.borderRadius = '3px'
    this._previewSwatch.style.alignSelf = 'center'
    this._previewSwatch.style.backgroundColor = argbToHex(this.color)
    return this._previewSwatch
  }

  // ===================================================================
  // Private: 同步所有控件到当前 HSV 值
  // ===================================================================

  /**
   * 将所有控件同步到当前 HSV 值。
   *
   * @param skipHex — 如果为 true，跳过十六进制输入更新（由 hexInput handler 调用时）
   */
  private _syncAllControls(skipHex: boolean = false): void {
    // 更新 H 滑块
    if (this._hSlider) {
      this._hSlider.value = String(Math.round(this._h * 360))
    }

    // 更新十六进制输入
    if (this._hexInput && !skipHex) {
      this._hexInput.value = argbToHex(this.color)
    }

    // 更新预览色块
    if (this._previewSwatch) {
      this._previewSwatch.style.backgroundColor = argbToHex(this.color)
    }
  }
}
