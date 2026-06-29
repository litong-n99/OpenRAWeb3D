/**
 * ButtonWidget.ts — 交互式按钮 widget
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ButtonWidget.cs (298 lines)
 *
 * 核心范式转换:
 * - C# SpriteFont.DrawText() bitmap 字形渲染 → CSS font-family + color (DOM 渲染)
 * - C# stateful sprite images (-disabled, -pressed, -hover) → CSS data-state 属性 + background-color
 * - C# WidgetUtils.DrawPanel 9-slice 面板 → CSS border-image () / background-color 模拟
 * - C# HandleMouseInput(MouseInput) + Depressed 状态机 → DOM pointerdown/pointerup/pointermove
 * - C# HandleKeyPress(KeyInput) + HotkeyReference → DOM keydown + Hotkey.IsActivatedBy
 * - C# MouseEntered/MouseExited 工具提示 → DOM mouseenter/mouseleave + ITooltipContainer
 * - C# Game.Sound.PlayNotification → 可替换的静态 SoundCallback
 * - C# TooltipContainerWidget Lazy<T> 延迟初始化 → _tooltipContainerResolver 模式
 * - C# RenderOrigin + ChildOrigin Depressed 偏移 → CSS transform: translate()
 * - C# Color 结构体 → CSS 颜色字符串
 * - C# CachedTransform (Fluent 文本缓存) → 闭包缓存
 */

import { InputWidget, boundsContains } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs, WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'
import { TextAlign } from './TextAlign.js'
import type { Color } from './LabelWidget.js'

// ---------------------------------------------------------------------------
// HotkeyReference import (Ch7 Phase B)
// ---------------------------------------------------------------------------

import { Hotkey } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { KeyCode, keyName } from '../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'

// ---------------------------------------------------------------------------
// Sound callback — 可替换的声音播放回调
// OpenRA 对照: Game.Sound.PlayNotification(ModRules, null, "Sounds", name, null)
// ---------------------------------------------------------------------------

/** 声音播放回调类型。
 *
 * 迁移方案：由于 Game.Sound.PlayNotification 尚未完全迁移，
 * 提供静态可替换回调。测试或运行时注入实现。
 *
 * OpenRA 对照: Game.Sound.PlayNotification(ModRules, null, "Sounds", name, null)
 */
export type SoundCallback = (soundName: string) => void

// ---------------------------------------------------------------------------
// ITooltipContainer — 工具提示容器最小接口
// OpenRA 对照: TooltipContainerWidget
// ---------------------------------------------------------------------------

/** TooltipContainerWidget 的最小接口。
 *
 * 仅暴露 ButtonWidget 所需的 setTooltip / removeTooltip 方法。
 * 避免完整 TooltipContainerWidget 的循环依赖。
 *
 * OpenRA 对照: TooltipContainerWidget
 */
export interface ITooltipContainer {
  setTooltip(template: string, args: WidgetArgs): void
  removeTooltip(): void
}

// ---------------------------------------------------------------------------
// ButtonWidget — 交互式按钮
// OpenRA 对照: public class ButtonWidget : InputWidget
// ---------------------------------------------------------------------------

/**
 * 交互式按钮 widget。
 *
 * 支持：
 * - 鼠标交互（左键按下/释放，双击，按下状态追踪，按钮移动检测）
 * - 键盘激活（通过 HotkeyReference，支持禁用重复按键和按键音效）
 * - 状态感知背景（禁用/按下/悬停/高亮 — 通过 data-state 属性 + CSS）
 * - 文本标签（对齐、左右边距、对比/阴影效果）
 * - 工具提示（通过 TooltipContainerWidget 集成）
 * - 声音反馈（点击/禁用点击声音 — 通过可替换 SoundCallback）
 * - Clone 复制构造函数模式
 *
 * OpenRA 对照: public class ButtonWidget : InputWidget
 */
export class ButtonWidget extends InputWidget {
  // ---- 静态声音回调（可替换用于测试/运行时） ----

  /** 可替换的声音播放器。
   *
   * 测试时可以替换为 mock 实现。
   * OpenRA 对照: Game.Sound.PlayNotification(...)
   */
  static soundPlayer: SoundCallback | null = null

  // ---- 文本属性 ----

  /** 按钮文本。OpenRA 对照: ButtonWidget.Text */
  text: string = ''

  /** 文本水平对齐。OpenRA 对照: ButtonWidget.Align */
  align: TextAlign = TextAlign.Center

  /** 左内边距（像素）。OpenRA 对照: ButtonWidget.LeftMargin */
  leftMargin: number = 5

  /** 右内边距（像素）。OpenRA 对照: ButtonWidget.RightMargin */
  rightMargin: number = 5

  /** 背景面板名称（ChromeProvider 集合键）。
   * OpenRA 对照: ButtonWidget.Background */
  background: string = 'button'

  /** 是否处于按下（视觉下沉）状态。OpenRA 对照: ButtonWidget.Depressed */
  depressed: boolean = false

  /** 视觉高度偏移（按下状态时像素）。OpenRA 对照: ButtonWidget.VisualHeight */
  visualHeight: number = 2

  /** CSS font 字符串（e.g. "14px Arial"）。
   * OpenRA 对照: ButtonWidget.Font (string) */
  font: string = '14px Arial'

  /** 文本颜色（CSS 字符串）。OpenRA 对照: ButtonWidget.TextColor (Color) */
  textColor: Color = '#FFFFFF'

  /** 禁用状态文本颜色。OpenRA 对照: ButtonWidget.TextColorDisabled (Color) */
  textColorDisabled: Color = '#888888'

  /** 是否使用对比色文字效果。OpenRA 对照: ButtonWidget.Contrast */
  contrast: boolean = false

  /** 是否使用文字阴影。OpenRA 对照: ButtonWidget.Shadow */
  shadow: boolean = false

  /** 对比色-暗（CSS 字符串）。OpenRA 对照: ButtonWidget.ContrastColorDark */
  contrastColorDark: Color = '#000000'

  /** 对比色-亮（CSS 字符串）。OpenRA 对照: ButtonWidget.ContrastColorLight */
  contrastColorLight: Color = '#FFFFFF'

  /** 对比半径（阴影偏移像素）。OpenRA 对照: ButtonWidget.ContrastRadius */
  contrastRadius: number = 1

  /** 点击声音名称。OpenRA 对照: ButtonWidget.ClickSound */
  clickSound: string = 'button-click'

  /** 禁用点击声音名称。OpenRA 对照: ButtonWidget.ClickDisabledSound */
  clickDisabledSound: string = 'button-disabled'

  /** 是否高亮。OpenRA 对照: ButtonWidget.Highlighted */
  highlighted: boolean = false

  // ---- Func 委托 ----
  // 对应 OpenRA 的 Func<string> / Func<Color> / Func<bool>

  /** 获取显示文本的委托。OpenRA 对照: ButtonWidget.GetText */
  getText: () => string

  /** 获取文本颜色的委托。OpenRA 对照: ButtonWidget.GetColor */
  getColor: () => Color

  /** 获取禁用文本颜色的委托。OpenRA 对照: ButtonWidget.GetColorDisabled */
  getColorDisabled: () => Color

  /** 获取对比色-暗的委托。OpenRA 对照: ButtonWidget.GetContrastColorDark */
  getContrastColorDark: () => Color

  /** 获取对比色-亮的委托。OpenRA 对照: ButtonWidget.GetContrastColorLight */
  getContrastColorLight: () => Color

  /** 高亮状态委托。OpenRA 对照: ButtonWidget.IsHighlighted */
  isHighlighted: () => boolean

  // ---- 工具提示 ----

  /** 工具提示容器 ID。OpenRA 对照: ButtonWidget.TooltipContainer */
  tooltipContainerId: string | null = null

  /** 工具提示模板名。OpenRA 对照: ButtonWidget.TooltipTemplate */
  tooltipTemplate: string = 'BUTTON_TOOLTIP'

  /** 工具提示文本。OpenRA 对照: ButtonWidget.TooltipText */
  tooltipText: string | null = null

  /** 获取工具提示文本的委托。OpenRA 对照: ButtonWidget.GetTooltipText */
  getTooltipText: (() => string) | null = null

  /** 工具提示描述文本。OpenRA 对照: ButtonWidget.TooltipDesc */
  tooltipDesc: string | null = null

  /** 获取工具提示描述的委托。OpenRA 对照: ButtonWidget.GetTooltipDesc */
  getTooltipDesc: (() => string) | null = null

  // ---- 热键 ----

  /** 激活此按钮的热键。OpenRA 对照: ButtonWidget.Key (HotkeyReference) */
  key: Hotkey | null = null

  /** 是否禁用重复按键。OpenRA 对照: ButtonWidget.DisableKeyRepeat */
  disableKeyRepeat: boolean = false

  /** 是否禁用按键声音。OpenRA 对照: ButtonWidget.DisableKeySound */
  disableKeySound: boolean = false

  // ---- 事件动作 ----
  // 对应 OpenRA 的 Action / Action<MouseInput> / Action<KeyInput>

  /** 点击动作。OpenRA 对照: ButtonWidget.OnClick */
  onClick: () => void

  /** 双击动作（可为 null）。OpenRA 对照: ButtonWidget.OnDoubleClick */
  onDoubleClick: (() => void) | null = null

  /** 鼠标按下动作。OpenRA 对照: ButtonWidget.OnMouseDown */
  onMouseDown: ((event: WidgetEvent) => void) | null = null

  /** 鼠标释放动作。OpenRA 对照: ButtonWidget.OnMouseUp */
  onMouseUp: ((event: WidgetEvent) => void) | null = null

  /** 键盘按下动作。OpenRA 对照: ButtonWidget.OnKeyPress */
  onKeyPress: ((event: WidgetEvent) => void) | null = null

  // ---- 光标 ----

  /** 此按钮的光标 CSS 值。OpenRA 对照: ButtonWidget.Cursor */
  cursor: string = 'pointer'

  // ---- 内部状态 ----

  /** 鼠标是否悬停在按钮上。 */
  private _hovered: boolean = false

  /** 工具提示容器查找函数（延迟初始化）。
   *
   * OpenRA 对照: Exts.Lazy(() => Ui.Root.Get<TooltipContainerWidget>(TooltipContainer))
   */
  private _tooltipContainerResolver: (() => ITooltipContainer | null) | null =
    null

  /** 缓存的工具提示容器实例。 */
  private _tooltipContainerCache: ITooltipContainer | null = null

  /** 工具提示容器是否已创建。OpenRA 对照: Lazy<T>.IsValueCreated */
  private _tooltipContainerCreated: boolean = false

  // ---------------------------------------------------------------------------
  // ChromeMetrics 默认键
  // ---------------------------------------------------------------------------

  static readonly DEFAULT_FONT_KEY = 'ButtonFont'
  static readonly DEFAULT_TEXT_COLOR_KEY = 'ButtonTextColor'
  static readonly DEFAULT_TEXT_COLOR_DISABLED_KEY = 'ButtonTextColorDisabled'
  static readonly DEFAULT_CONTRAST_KEY = 'ButtonTextContrast'
  static readonly DEFAULT_SHADOW_KEY = 'ButtonTextShadow'
  static readonly DEFAULT_CONTRAST_DARK_KEY = 'ButtonTextContrastColorDark'
  static readonly DEFAULT_CONTRAST_LIGHT_KEY = 'ButtonTextContrastColorLight'
  static readonly DEFAULT_CONTRAST_RADIUS_KEY = 'ButtonTextContrastRadius'
  static readonly DEFAULT_CLICK_SOUND_KEY = 'ClickSound'
  static readonly DEFAULT_CLICK_DISABLED_SOUND_KEY = 'ClickDisabledSound'
  static readonly DEFAULT_CURSOR_KEY = 'ButtonCursor'

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: ButtonWidget(ModData) / ButtonWidget(ButtonWidget)
  // ---------------------------------------------------------------------------

  /**
   * 构造 ButtonWidget。
   *
   * OpenRA 对照: public ButtonWidget(ModData modData)
   *
   * 初始化委托为默认值（直通属性），并尝试从 ChromeMetrics 加载默认值。
   *
   * @param _modData — ModData 引用（保留用于未来 Fluent/ModRules 集成）
   */
  constructor(_modData?: unknown) {
    super()

    // 委托初始化（OpenRA: CachedTransform + FluentProvider.GetMessage）
    // NOTE: Fluent 本地化暂未迁移，使用直通缓存。
    let textCache: string | null = null
    let textCacheInput: string | null = null
    this.getText = () => {
      const raw = this.text
      if (raw !== textCacheInput) {
        textCacheInput = raw
        textCache = raw && raw.length > 0 ? raw : ''
      }
      return textCache || ''
    }

    this.getColor = () => this.textColor
    this.getColorDisabled = () => this.textColorDisabled
    this.getContrastColorDark = () => this.contrastColorDark
    this.getContrastColorLight = () => this.contrastColorLight
    this.isHighlighted = () => this.highlighted
    this.onClick = () => {}

    // OpenRA: OnMouseUp = _ => OnClick()
    this.onMouseUp = (_event: WidgetEvent) => this.onClick()

    // OpenRA: OnKeyPress = _ => OnClick()
    this.onKeyPress = (_event: WidgetEvent) => this.onClick()

    // 从 ChromeMetrics 加载默认值（如果可用）
    this._loadDefaults()
  }

  /**
   * 从 ChromeMetrics 加载默认值。
   * 如果 ChromeMetrics 不可用，优雅降级为类字段默认值。
   */
  private _loadDefaults(): void {
    try {
      const fontVal = ChromeMetrics.tryGet<string>(ButtonWidget.DEFAULT_FONT_KEY)
      if (fontVal) this.font = fontVal as string
    } catch {
      /* graceful degradation */
    }
    try {
      const colorVal = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_TEXT_COLOR_KEY,
      )
      if (colorVal) this.textColor = colorVal as string
    } catch {
      /* graceful degradation */
    }
    try {
      const colorDisVal = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_TEXT_COLOR_DISABLED_KEY,
      )
      if (colorDisVal) this.textColorDisabled = colorDisVal as string
    } catch {
      /* graceful degradation */
    }
    try {
      const contrastVal = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_CONTRAST_KEY,
      )
      if (contrastVal !== undefined) this.contrast = contrastVal === 'True'
    } catch {
      /* graceful degradation */
    }
    try {
      const shadowVal = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_SHADOW_KEY,
      )
      if (shadowVal !== undefined) this.shadow = shadowVal === 'True'
    } catch {
      /* graceful degradation */
    }
    try {
      const cDark = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_CONTRAST_DARK_KEY,
      )
      if (cDark) this.contrastColorDark = cDark as string
    } catch {
      /* graceful degradation */
    }
    try {
      const cLight = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_CONTRAST_LIGHT_KEY,
      )
      if (cLight) this.contrastColorLight = cLight as string
    } catch {
      /* graceful degradation */
    }
    try {
      const radiusStr = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_CONTRAST_RADIUS_KEY,
      )
      if (radiusStr)
        this.contrastRadius = parseInt(radiusStr as string, 10) || 1
    } catch {
      /* graceful degradation */
    }
    try {
      const clickSoundVal = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_CLICK_SOUND_KEY,
      )
      if (clickSoundVal) this.clickSound = clickSoundVal as string
    } catch {
      /* graceful degradation */
    }
    try {
      const disabledSoundVal = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_CLICK_DISABLED_SOUND_KEY,
      )
      if (disabledSoundVal) this.clickDisabledSound = disabledSoundVal as string
    } catch {
      /* graceful degradation */
    }
    try {
      const cursorVal = ChromeMetrics.tryGet<string>(
        ButtonWidget.DEFAULT_CURSOR_KEY,
      )
      if (cursorVal) this.cursor = cursorVal as string
    } catch {
      /* graceful degradation */
    }
  }

  /**
   * 复制构造函数（用于 Clone）。
   *
   * OpenRA 对照: protected ButtonWidget(ButtonWidget other) : base(other)
   */
  protected copyFrom(other: ButtonWidget): void {
    this.text = other.text
    this.align = other.align
    this.leftMargin = other.leftMargin
    this.rightMargin = other.rightMargin
    this.font = other.font
    this.textColor = other.textColor
    this.textColorDisabled = other.textColorDisabled
    this.contrast = other.contrast
    this.shadow = other.shadow
    this.depressed = other.depressed
    this.background = other.background
    this.visualHeight = other.visualHeight
    this.getText = other.getText
    this.getColor = other.getColor
    this.getColorDisabled = other.getColorDisabled
    this.contrastColorDark = other.contrastColorDark
    this.contrastColorLight = other.contrastColorLight
    this.contrastRadius = other.contrastRadius
    this.getContrastColorDark = other.getContrastColorDark
    this.getContrastColorLight = other.getContrastColorLight
    this.onMouseDown = other.onMouseDown
    this.disabled = other.disabled
    this.highlighted = other.highlighted
    this.isHighlighted = other.isHighlighted

    // NOTE: OpenRA 的复制构造函数将 OnMouseUp/OnKeyPress 设置为 _ => OnClick()
    // 即使源有不同的 OnMouseUp。我们保持相同语义。
    this.onMouseUp = (_event: WidgetEvent) => this.onClick()
    this.onKeyPress = (_event: WidgetEvent) => this.onClick()

    this.tooltipTemplate = other.tooltipTemplate
    this.tooltipText = other.tooltipText
    this.getTooltipText = other.getTooltipText
    this.tooltipDesc = other.tooltipDesc
    this.getTooltipDesc = other.getTooltipDesc
    this.tooltipContainerId = other.tooltipContainerId
    this._tooltipContainerResolver = other._tooltipContainerResolver
    this.key = other.key
    this.disableKeyRepeat = other.disableKeyRepeat
    this.disableKeySound = other.disableKeySound
    this.onDoubleClick = other.onDoubleClick
    this.clickSound = other.clickSound
    this.clickDisabledSound = other.clickDisabledSound
    this.cursor = other.cursor
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

  /** 工具提示容器是否已创建（延迟工厂是否已调用）。
   * OpenRA 对照: Lazy<T>.IsValueCreated */
  get isTooltipContainerCreated(): boolean {
    return this._tooltipContainerCreated
  }

  /**
   * 设置工具提示容器查找函数。
   *
   * 模拟 OpenRA 的 `Exts.Lazy(() => Ui.Root.Get<TooltipContainerWidget>(...))`。
   * 调用方在 Ui.Root 建立后注入此函数。
   */
  setTooltipContainerResolver(resolver: () => ITooltipContainer | null): void {
    this._tooltipContainerResolver = resolver
  }

  // ---------------------------------------------------------------------------
  // YieldMouseFocus — 释放焦点时重置 Depressed
  // OpenRA 对照: ButtonWidget.YieldMouseFocus(MouseInput)
  // ---------------------------------------------------------------------------

  /**
   * 释放鼠标焦点，重置按下状态和下划线。
   *
   * OpenRA 对照: public override bool YieldMouseFocus(MouseInput mi)
   */
  override yieldMouseFocus(): boolean {
    this.depressed = false
    return super.yieldMouseFocus()
  }

  // ---------------------------------------------------------------------------
  // Event handling — HandleMouseInput + HandleKeyPress
  // OpenRA 对照: ButtonWidget.HandleMouseInput(MouseInput)
  //              ButtonWidget.HandleKeyPress(KeyInput)
  // ---------------------------------------------------------------------------

  /**
   * 处理事件（鼠标和键盘）。
   *
   * 根据事件类型分发：
   * - 'mousedown' / 'mouseup' / 'mousemove': 鼠标输入处理
   * - 'keydown': 键盘输入处理
   *
   * OpenRA 对照: HandleMouseInput(MouseInput) + HandleKeyPress(KeyInput)
   */
  override handleEvent(event: WidgetEvent): boolean {
    const eventType = event.type

    // 键盘事件
    if (eventType === 'keydown') {
      return this._handleKeyEvent(event)
    }

    // 鼠标/触摸事件
    if (
      eventType === 'mousedown' ||
      eventType === 'mouseup' ||
      eventType === 'mousemove' ||
      eventType === 'pointerdown' ||
      eventType === 'pointerup' ||
      eventType === 'pointermove'
    ) {
      return this._handleMouseEvent(event)
    }

    return false
  }

  /**
   * 处理鼠标事件（精确匹配 OpenRA 的 HandleMouseInput 逻辑）。
   *
   * OpenRA 对照: public override bool HandleMouseInput(MouseInput mi)
   *
   * 状态机：
   * - Left button only — 如果 mi.Button != MouseButton.Left → return false
   * - Down: 尝试获取鼠标焦点 → 失败返回 false → onMouseDown → depressed=true → 播放声音
   * - Up (双击): hasMouseFocus && multitap==2 && onDoubleClick != null → onDoubleClick → yield
   * - Up (单击): hasMouseFocus && depressed && !disabled → onMouseUp → yield
   * - Move: hasMouseFocus → depressed = RenderBounds.Contains(location)
   * - 返回 depressed（Down 后为 true 即按钮保持焦点）
   */
  private _handleMouseEvent(event: WidgetEvent): boolean {
    const eventType = event.type
    const disabled = this.isDisabled()
    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number

    // Left button only check
    // OpenRA: if (mi.Button != MouseButton.Left) return false
    const button = (event['button'] as number) ?? 0
    if (button !== 0) return false

    // ---- Down ----
    // OpenRA: mi.Event == MouseInputEvent.Down
    if (eventType === 'mousedown' || eventType === 'pointerdown') {
      // if (!TakeMouseFocus(mi)) return false
      if (!this.takeMouseFocus()) return false

      if (!disabled) {
        // OpenRA: OnMouseDown(mi); Depressed = true; PlayNotification
        this.onMouseDown?.(event)
        this.depressed = true
        ButtonWidget._playSound(this.clickSound)
      } else {
        // OpenRA: YieldMouseFocus(mi); PlayNotification(disabled)
        this.yieldMouseFocus()
        ButtonWidget._playSound(this.clickDisabledSound)
      }
      return this.depressed
    }

    // ---- Up ----
    // OpenRA: mi.Event == MouseInputEvent.Up
    if (eventType === 'mouseup' || eventType === 'pointerup') {
      if (!this.hasMouseFocus) return false

      const multiTapCount = (event['multiTapCount'] as number) ?? 1

      // 双击检测
      // OpenRA: HasMouseFocus && mi.Event == Up && mi.MultiTapCount == 2 && OnDoubleClick != null
      if (multiTapCount === 2 && this.onDoubleClick) {
        if (!disabled) {
          this.onDoubleClick()
          return this.yieldMouseFocus()
        }
      }
      // 单击检测
      // OpenRA: HasMouseFocus && mi.Event == Up
      // 仅当 depressed 且未禁用时才触发
      else if (this.depressed && !disabled) {
        this.onMouseUp?.(event)
      }

      // OpenRA: return YieldMouseFocus(mi)
      return this.yieldMouseFocus()
    }

    // ---- Move (when has focus) ----
    // OpenRA: mi.Event == MouseInputEvent.Move && HasMouseFocus
    if (eventType === 'mousemove' || eventType === 'pointermove') {
      if (!this.hasMouseFocus) return false

      // OpenRA: Depressed = RenderBounds.Contains(mi.Location)
      this.depressed = this._renderBoundsContains(x, y)
      return this.depressed
    }

    return false
  }

  /**
   * 处理键盘事件（精确匹配 OpenRA 的 HandleKeyPress 逻辑）。
   *
   * OpenRA 对照: public override bool HandleKeyPress(KeyInput e)
   *
   * 条件：
   * - Key.IsActivatedBy(e) 必须为 true
   * - e.Event 必须是 KeyInputEvent.Down
   * - 如果 DisableKeyRepeat 且 e.IsRepeat → return false
   * - 未禁用时：调用 OnKeyPress + 播放 ClickSound
   * - 禁用时：播放 ClickDisabledSound
   * - 始终返回 true（消费事件）
   */
  private _handleKeyEvent(event: WidgetEvent): boolean {
    // 检查热键匹配
    // OpenRA: if (!Key.IsActivatedBy(e))
    if (!this.key) return false

    const keyStr = (event.key || '').toLowerCase()
    // Convert SDL KeyCode to key name for comparison
    const hotkeyKey = keyName(this.key.key).toLowerCase()

    // Match: check if event key matches hotkey's key name
    // Also try to match by the KeyCode display name (e.g., "Enter" for RETURN)
    const eventKeyCode = this._keyStringToKeyCode(event.key || '')
    const keyMatches =
      keyStr === hotkeyKey ||
      (eventKeyCode !== KeyCode.UNKNOWN && eventKeyCode === this.key.key)

    if (!keyMatches) return false

    // OpenRA: Hotkey.IsActivatedBy does exact modifier equality check
    // (Key == e.Key && Modifiers == e.Modifiers)
    // Build modifier bitmask from DOM event to compare against hotkey's modifiers
    let eventModifiers = Modifiers.None
    if (event.ctrlKey) eventModifiers |= Modifiers.Ctrl
    if (event.altKey) eventModifiers |= Modifiers.Alt
    if (event.shiftKey) eventModifiers |= Modifiers.Shift
    if (event.metaKey) eventModifiers |= Modifiers.Meta

    const modifiersMatch = eventModifiers === this.key.modifiers
    if (!modifiersMatch) return false

    // OpenRA: e.Event != KeyInputEvent.Down → return false
    if (event.type !== 'keydown') return false

    // OpenRA: DisableKeyRepeat && e.IsRepeat → return false
    const isRepeat = event['repeat'] === true
    if (this.disableKeyRepeat && isRepeat) {
      // 仍然消费事件但不触发动作
      return true
    }

    const disabled = this.isDisabled()

    if (!disabled) {
      // OpenRA: OnKeyPress(e)
      this.onKeyPress?.(event)

      // OpenRA: if (!DisableKeySound) Game.Sound.PlayNotification(...)
      if (!this.disableKeySound) {
        ButtonWidget._playSound(this.clickSound)
      }
    } else {
      // OpenRA: Game.Sound.PlayNotification(...ClickDisabledSound...)
      if (!this.disableKeySound) {
        ButtonWidget._playSound(this.clickDisabledSound)
      }
    }

    return true
  }

  /**
   * 检查坐标是否在按钮的渲染边界内。
   *
   * OpenRA 对照: RenderBounds.Contains(mi.Location)
   */
  private _renderBoundsContains(px: number, py: number): boolean {
    return boundsContains(this.bounds, px, py)
  }

  /**
   * 将键盘事件的 key 字符串转换为 KeyCode。
   * 用于比较 DOM key 值与 SDL KeyCode 热键。
   */
  private _keyStringToKeyCode(key: string): KeyCode {
    switch (key) {
      case 'Enter':
        return KeyCode.RETURN
      case 'Escape':
        return KeyCode.ESCAPE
      case 'Backspace':
        return KeyCode.BACKSPACE
      case 'Tab':
        return KeyCode.TAB
      case ' ':
        return KeyCode.SPACE
      case 'ArrowUp':
        return KeyCode.UP
      case 'ArrowDown':
        return KeyCode.DOWN
      case 'ArrowLeft':
        return KeyCode.LEFT
      case 'ArrowRight':
        return KeyCode.RIGHT
      case 'Home':
        return KeyCode.HOME
      case 'End':
        return KeyCode.END
      case 'PageUp':
        return KeyCode.PAGEUP
      case 'PageDown':
        return KeyCode.PAGEDOWN
      case 'Insert':
        return KeyCode.INSERT
      case 'Delete':
        return KeyCode.DELETE
      case 'F1':
        return KeyCode.F1
      case 'F2':
        return KeyCode.F2
      case 'F3':
        return KeyCode.F3
      case 'F4':
        return KeyCode.F4
      case 'F5':
        return KeyCode.F5
      case 'F6':
        return KeyCode.F6
      case 'F7':
        return KeyCode.F7
      case 'F8':
        return KeyCode.F8
      case 'F9':
        return KeyCode.F9
      case 'F10':
        return KeyCode.F10
      case 'F11':
        return KeyCode.F11
      case 'F12':
        return KeyCode.F12
      default:
        // 字母键: keyName 返回 'a'..'z'，对应 KeyCode.a..KeyCode.z
        if (key.length === 1 && /^[a-z]$/i.test(key)) {
          const code = KeyCode[key.toUpperCase() as keyof typeof KeyCode]
          if (typeof code === 'number') return code as KeyCode
          return key.toLowerCase().charCodeAt(0) as KeyCode
        }
        // 数字键
        if (key.length === 1 && /^[0-9]$/.test(key)) {
          const code = KeyCode[`D${key}` as keyof typeof KeyCode]
          if (typeof code === 'number') return code as KeyCode
        }
        return KeyCode.UNKNOWN
    }
  }

  /** 播放声音（如果 soundPlayer 已设置）。 */
  private static _playSound(soundName: string): void {
    ButtonWidget.soundPlayer?.(soundName)
  }

  // ---------------------------------------------------------------------------
  // MouseEntered / MouseExited — 工具提示集成
  // OpenRA 对照: ButtonWidget.MouseEntered() / MouseExited()
  // ---------------------------------------------------------------------------

  /**
   * 鼠标进入按钮时悬停状态置位，显示工具提示。
   *
   * OpenRA 对照: public override void MouseEntered()
   */
  override mouseEntered(): void {
    this._hovered = true

    // 工具提示逻辑
    // OpenRA: if (TooltipContainer == null) return
    if (!this.tooltipContainerId) return

    // OpenRA: if (GetTooltipText != null)
    if (!this.getTooltipText) return

    const container = this.tooltipContainer
    if (!container) return

    container.setTooltip(this.tooltipTemplate, ({
      button: this,
      getText: this.getTooltipText,
      getDesc: this.getTooltipDesc,
    } as unknown) as WidgetArgs)
  }

  /**
   * 鼠标离开按钮时清除悬停状态，移除工具提示。
   *
   * OpenRA 对照: public override void MouseExited()
   */
  override mouseExited(): void {
    this._hovered = false

    // OpenRA: if (TooltipContainer == null || !tooltipContainer.IsValueCreated) return
    if (!this.tooltipContainerId || !this._tooltipContainerCreated) return

    const container = this.tooltipContainer
    if (!container) return

    // OpenRA: tooltipContainer.Value.RemoveTooltip()
    container.removeTooltip()
  }

  // ---------------------------------------------------------------------------
  // Cursor / ChildOrigin
  // OpenRA 对照: GetCursor / ChildOrigin
  // ---------------------------------------------------------------------------

  /**
   * 返回此按钮的光标 CSS 值。
   *
   * OpenRA 对照: public override string GetCursor(int2 pos)
   */
  override getCursor(_pos: { x: number; y: number }): string | null {
    return this.cursor
  }

  /**
   * 子 widget 原点偏移（按下时应用视觉高度偏移）。
   *
   * OpenRA 对照: public override int2 ChildOrigin =>
   *   RenderOrigin + (Depressed ? new int2(VisualHeight, VisualHeight) : int2.Zero)
   */
  get childOrigin(): { x: number; y: number } {
    if (this.depressed) {
      return { x: this.visualHeight, y: this.visualHeight }
    }
    return { x: 0, y: 0 }
  }

  /**
   * 获取可用宽度。
   *
   * OpenRA 对照: ButtonWidget.UsableWidth → Bounds.Width
   *
   * NOTE: 返回 bounds.width (不含边距) 以匹配 OpenRA。
   * DOM 渲染中文本居中由 CSS flexbox 处理，左右边距通过 paddingLeft/paddingRight
   * 在 _renderText() 中单独应用。外部代码（如 DropDownButtonWidget）访问此属性
   * 进行布局计算时获得与 OpenRA 一致的值。
   */
  get usableWidth(): number {
    return this.bounds.width
  }

  // ---------------------------------------------------------------------------
  // CSS text-shadow 生成（与 LabelWidget DrawInner 相同的逻辑）
  // OpenRA 对照: font.DrawTextWithContrast / font.DrawTextWithShadow
  // ---------------------------------------------------------------------------

  /**
   * 生成 CSS `text-shadow` 值来模拟 OpenRA 的对比/阴影文字效果。
   *
   * OpenRA 对照:
   * - Contrast: 4 个对角方向偏移，使用 bgDark + bgLight
   * - Shadow: 1 个底部-右侧偏移，使用 bgDark
   */
  private _computeTextShadow(): string {
    const r = this.contrastRadius

    if (this.contrast) {
      const bgDark = this.getContrastColorDark()
      const bgLight = this.getContrastColorLight()
      return [
        `-${r}px -${r}px 0 ${bgDark}`,
        `${r}px -${r}px 0 ${bgLight}`,
        `${r}px ${r}px 0 ${bgDark}`,
        `-${r}px ${r}px 0 ${bgLight}`,
      ].join(', ')
    }

    if (this.shadow) {
      const bgDark = this.getContrastColorDark()
      const offset = Math.max(r, 1)
      return `${offset}px ${offset}px 0 ${bgDark}`
    }

    return 'none'
  }

  // ---------------------------------------------------------------------------
  // DrawBackground — 静态 9 片面板背景样式（OpenRA: WidgetUtils.DrawPanel）
  // ---------------------------------------------------------------------------

  /**
   * 获取按钮背景的 CSS 样式（状态感知 9 片面板背景）。
   *
   * OpenRA 对照:
   * - public static void DrawBackground(string baseName, Rectangle rect, bool disabled, bool pressed, bool hover, bool highlighted)
   * - WidgetUtils.GetStatefulImageName(variantName, disabled, pressed, hover)
   * - WidgetUtils.DrawPanel(imageName, rect)
   *
   * 迁移方案：
   * 使用 CSS background-color 和 box-shadow 模拟状态感知面板。
   * 完整 9 片面板（ChromeProvider → CSS border-image）在  中完成。
   *
   * 变体后缀规则（OpenRA: WidgetUtils.GetStatefulImageName）：
   * - disabled + pressed → "{baseName}-disabled-pressed"
   * - disabled              → "{baseName}-disabled"
   * - pressed               → "{baseName}-pressed"
   * - hover                 → "{baseName}-hover"
   * - highlighted           → "{baseName}-highlighted"
   * - 否则                   → baseName
   */
  static getBackgroundStyle(
    baseName: string,
    disabled: boolean,
    pressed: boolean,
    hover: boolean,
    highlighted: boolean,
  ): Partial<CSSStyleDeclaration> {
    if (!baseName) return {}

    const variantName = highlighted ? `${baseName}-highlighted` : baseName
    const imageName = ButtonWidget._getStatefulImageName(
      variantName,
      disabled,
      pressed,
      hover,
    )

    const style: Record<string, string> = {}
    style['--button-bg-name'] = imageName

    if (disabled) {
      style['backgroundColor'] = '#555555'
      style['borderColor'] = '#333333'
    } else if (pressed) {
      style['backgroundColor'] = '#1a3a5c'
      style['borderColor'] = '#0d1f33'
      style['boxShadow'] = 'inset 0 2px 4px rgba(0,0,0,0.4)'
    } else if (hover || highlighted) {
      style['backgroundColor'] = '#2a5a8c'
      style['borderColor'] = '#1a3a5c'
      style['boxShadow'] = '0 0 8px rgba(100,180,255,0.3)'
    } else {
      style['backgroundColor'] = '#1e4d7a'
      style['borderColor'] = '#0d2a4a'
    }

    style['border'] = '2px solid'
    style['borderRadius'] = '3px'

    return style as unknown as Partial<CSSStyleDeclaration>
  }

  /**
   * 获取状态变更后的图像名称。
   *
   * OpenRA 对照: WidgetUtils.GetStatefulImageName(string, bool, bool, bool)
   */
  private static _getStatefulImageName(
    baseName: string,
    disabled: boolean,
    pressed: boolean,
    hover: boolean,
  ): string {
    if (disabled && pressed) return `${baseName}-disabled-pressed`
    if (disabled) return `${baseName}-disabled`
    if (pressed) return `${baseName}-pressed`
    if (hover) return `${baseName}-hover`
    return baseName
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: ButtonWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * 将按钮渲染为 DOM 元素。
   *
   * 使用 data-state 属性进行 CSS 样式设置：
   * - data-state="disabled" 当禁用时
   * - data-state="pressed" 当按下时
   * - data-state="hover" 当悬停时
   * - data-state="normal" 默认状态
   *
   * OpenRA 对照: public override void Draw()
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'button-widget')
    el.style.position = 'absolute'
    el.style.cursor = this.isDisabled() ? 'not-allowed' : this.cursor
    el.style.userSelect = 'none'
    el.style.overflow = 'hidden'
    el.style.boxSizing = 'border-box'

    // 确定状态
    const disabled = this.isDisabled()
    const highlighted = this.isHighlighted()

    if (disabled) {
      el.setAttribute('data-state', 'disabled')
    } else if (this.depressed) {
      el.setAttribute('data-state', 'pressed')
    } else if (this._hovered) {
      el.setAttribute('data-state', 'hover')
    } else {
      el.setAttribute('data-state', 'normal')
    }

    if (highlighted) {
      el.setAttribute('data-highlighted', 'true')
    } else {
      el.removeAttribute('data-highlighted')
    }

    if (this.id) {
      el.setAttribute('data-widget-id', this.id)
    }

    // 背景面板名称
    el.setAttribute('data-background', this.background)

    // 应用背景样式
    const bgStyle = ButtonWidget.getBackgroundStyle(
      this.background,
      disabled,
      this.depressed,
      this._hovered,
      highlighted,
    )
    for (const [key, value] of Object.entries(bgStyle)) {
      if (value !== undefined && key !== 'setProperty') {
        ;(el.style as unknown as Record<string, string>)[key] =
          value as string
      }
    }

    // 文本渲染
    this._renderText(el)

    // 重新挂载子 widget（保护 data-button-text span）
    this._remountChildren(el)

    return el
  }

  /**
   * 渲染按钮文本内容。
   *
   * OpenRA 对照: GetTextPosition + font.DrawText/DrawTextWithContrast/DrawTextWithShadow
   */
  private _renderText(el: HTMLElement): void {
    // 移除旧的文本元素
    const oldSpan = el.querySelector('[data-button-text]')
    if (oldSpan) oldSpan.remove()

    const text = this.getText()
    if (!text) return

    const disabled = this.isDisabled()
    const color = disabled ? this.getColorDisabled() : this.getColor()

    const span = document.createElement('span')
    span.setAttribute('data-button-text', 'true')
    span.textContent = text
    span.style.position = 'absolute'
    span.style.inset = '0'
    span.style.display = 'flex'
    span.style.alignItems = 'center'

    // 水平对齐
    switch (this.align) {
      case TextAlign.Left:
        span.style.justifyContent = 'flex-start'
        span.style.paddingLeft = `${this.leftMargin}px`
        span.style.paddingRight = `${this.rightMargin}px`
        break
      case TextAlign.Center:
        span.style.justifyContent = 'center'
        break
      case TextAlign.Right:
        span.style.justifyContent = 'flex-end'
        span.style.paddingRight = `${this.rightMargin}px`
        break
    }

    span.style.color = color
    span.style.font = this.font
    span.style.textShadow = this._computeTextShadow()

    // 按下状态下的文本偏移
    // OpenRA: position + stateOffset via normal or contrast/shadow draw
    if (this.depressed && this.visualHeight > 0) {
      span.style.transform = `translate(${this.visualHeight}px, ${this.visualHeight}px)`
    }

    // 如果启用，应用文本溢出省略
    span.style.whiteSpace = 'nowrap'
    span.style.overflow = 'hidden'
    span.style.textOverflow = 'ellipsis'

    el.appendChild(span)
  }

  /**
   * 清理陈旧的非文本子元素（保留 data-button-text span）。
   *
   * NOTE: Widget 子元素的挂载已由 Widget.renderOuter() 统一处理，
   * 此方法仅负责移除上一帧遗留的非文本 DOM 节点。
   */
  private _remountChildren(el: HTMLElement): void {
    // 移除旧的 widget 子元素（保留 data-button-text span）
    const toRemove: ChildNode[] = []
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) {
        const htmlEl = child as HTMLElement
        if (!htmlEl.hasAttribute('data-button-text')
            && !htmlEl.hasAttribute('data-widget-child')) {
          toRemove.push(child)
        }
      }
    }
    for (const child of toRemove) {
      el.removeChild(child)
    }

    // NOTE: Widget 子元素的挂载由 Widget.renderOuter() 统一处理，
    // 不再在此处重复挂载，避免产生重复 DOM 元素。
  }

  // ---------------------------------------------------------------------------
  // Clone
  // OpenRA 对照: ButtonWidget.Clone()
  // ---------------------------------------------------------------------------

  /**
   * 克隆此 ButtonWidget。
   *
   * OpenRA 对照: public override ButtonWidget Clone()
   */
  override clone(): ButtonWidget {
    const b = new ButtonWidget()
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

