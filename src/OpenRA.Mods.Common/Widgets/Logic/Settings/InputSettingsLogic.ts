/**
 * InputSettingsLogic.ts — 输入设置面板逻辑（鼠标/键盘控件设置）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Settings/InputSettingsLogic.cs (232 lines)
 *
 * 核心范式转换:
 * - C# MouseControlStyle / MouseScrollType / Modifiers 枚举 → 字符串常量 + 数值
 * - C# GameSettings 字段绑定 via 反射 → 回调 getter/setter
 * - C# Game.Renderer.GrabWindowMouseFocus / ReleaseWindowMouseFocus → 可替换回调
 * - C# FluentProvider.GetMessage → 硬编码字符串
 * - C# CachedTransform<Modifiers, string> → 简单字符串替换
 */

import { Widget, ChromeLogic } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { SettingsLogic } from './SettingsLogic.js'
import { SettingsUtils } from './SettingsUtils.js'
import { CheckboxWidget } from '../../CheckboxWidget.js'
import { SliderWidget } from '../../SliderWidget.js'
import { DropDownButtonWidget } from '../../DropDownButtonWidget.js'
import { ScrollPanelWidget } from '../../ScrollPanelWidget.js'
import { ScrollItemWidget } from '../../ScrollItemWidget.js'
import { Modifiers } from '../../../../OpenRA.Game/Input/IInputHandler.js'
import { modsDisplayString } from '../../../../OpenRA.Game/Input/HotkeyReference.js'

// ---------------------------------------------------------------------------
// 常量 — OpenRA 对照: 枚举值
// ---------------------------------------------------------------------------

/** 鼠标控制样式。OpenRA 对照: MouseControlStyle */
const MouseControlStyle = {
  Classic: 'Classic',
  Modern: 'Modern',
  OtherRTS: 'OtherRTS',
} as const
type MouseControlStyle =
  (typeof MouseControlStyle)[keyof typeof MouseControlStyle]

/** 鼠标滚动类型。OpenRA 对照: MouseScrollType */
const MouseScrollType = {
  Disabled: 'Disabled',
  Standard: 'Standard',
  Inverted: 'Inverted',
  Joystick: 'Joystick',
} as const
type MouseScrollType =
  (typeof MouseScrollType)[keyof typeof MouseScrollType]

// ---------------------------------------------------------------------------
// MouseFocusCallbacks — 鼠标焦点回调接口
// ---------------------------------------------------------------------------

/** 鼠标焦点回调接口（可替换用于测试）。
 *
 * OpenRA 对照: Game.Renderer.GrabWindowMouseFocus() / ReleaseWindowMouseFocus()
 */
export interface MouseFocusCallbacks {
  grabWindowMouseFocus(): void
  releaseWindowMouseFocus(): void
}

// ---------------------------------------------------------------------------
// InputSettings — 输入设置状态对象
// ---------------------------------------------------------------------------

/** 输入设置状态。OpenRA 对照: GameSettings (子集) */
export interface InputSettings {
  useAlternateScrollButton: boolean
  viewportEdgeScroll: boolean
  lockMouseWindow: boolean
  zoomSpeed: number
  viewportEdgeScrollStep: number
  uiScrollSpeed: number
  mouseControlStyle: MouseControlStyle
  mouseScroll: MouseScrollType
  zoomModifier: Modifiers
}

// ---------------------------------------------------------------------------
// InputSettingsLogic — 输入设置面板
// OpenRA 对照: public class InputSettingsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 输入设置面板逻辑。
 *
 * 绑定鼠标灵敏度、滚动速度、鼠标控制样式、缩放修饰键等设置。
 *
 * OpenRA 对照: public class InputSettingsLogic : ChromeLogic
 */
/**
 * NOTE: ADR-16.2 — InputSettingsLogic extends ChromeLogic for OpenRA parity.
 */
export class InputSettingsLogic extends ChromeLogic {
  private readonly inputSettings: InputSettings
  private readonly mouseFocusCallbacks: MouseFocusCallbacks

  /** 控件样式标签映射。 */
  private readonly controlTypeLabels: Record<MouseControlStyle, string> = {
    [MouseControlStyle.Classic]: 'Classic (Left-click orders)',
    [MouseControlStyle.Modern]: 'Modern (Right-click orders)',
    [MouseControlStyle.OtherRTS]: 'Other RTS (Alt+Click orders)',
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * 构造输入设置面板。
   *
   * @param settingsLogic — 父设置路由
   * @param panelID — 面板 ID
   * @param label — 面板标签
   * @param inputSettings — 输入设置状态
   * @param mouseFocusCallbacks — 鼠标焦点回调（可替换用于测试）
   */
  constructor(
    settingsLogic: SettingsLogic,
    panelID: string,
    label: string,
    inputSettings: InputSettings,
    mouseFocusCallbacks: MouseFocusCallbacks,
  ) {
    super()

    this.inputSettings = inputSettings
    this.mouseFocusCallbacks = mouseFocusCallbacks

    settingsLogic.registerSettingsPanel(
      panelID,
      label,
      (panel) => this.initPanel(panel),
      (panel) => this.resetPanel(panel),
    )
  }

  // ---------------------------------------------------------------------------
  // InitPanel
  // ---------------------------------------------------------------------------

  private initPanel(panel: Widget): () => boolean {
    const scrollPanel =
      panel.get<ScrollPanelWidget>('SETTINGS_SCROLLPANEL')

    // ---- 复选框绑定 ----
    SettingsUtils.bindCheckboxPref(
      panel,
      'ALTERNATE_SCROLL_CHECKBOX',
      () => this.inputSettings.useAlternateScrollButton,
      (v) => {
        this.inputSettings.useAlternateScrollButton = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'EDGESCROLL_CHECKBOX',
      () => this.inputSettings.viewportEdgeScroll,
      (v) => {
        this.inputSettings.viewportEdgeScroll = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'LOCKMOUSE_CHECKBOX',
      () => this.inputSettings.lockMouseWindow,
      (v) => {
        this.inputSettings.lockMouseWindow = v
      },
    )

    // ---- 滑块绑定 ----
    SettingsUtils.bindSliderPref(
      panel,
      'ZOOMSPEED_SLIDER',
      () => this.inputSettings.zoomSpeed,
      (v) => {
        this.inputSettings.zoomSpeed = v
      },
    )

    SettingsUtils.bindSliderPref(
      panel,
      'SCROLLSPEED_SLIDER',
      () => this.inputSettings.viewportEdgeScrollStep,
      (v) => {
        this.inputSettings.viewportEdgeScrollStep = v
      },
    )

    SettingsUtils.bindSliderPref(
      panel,
      'UI_SCROLLSPEED_SLIDER',
      () => this.inputSettings.uiScrollSpeed,
      (v) => {
        this.inputSettings.uiScrollSpeed = v
      },
    )

    // ---- 鼠标控制样式下拉菜单 ----
    const mouseControlDropdown = panel.get<DropDownButtonWidget>(
      'MOUSE_CONTROL_DROPDOWN',
    )
    mouseControlDropdown.onMouseDown = () =>
      this.showMouseControlDropdown(mouseControlDropdown)
    mouseControlDropdown.getText = () =>
      this.controlTypeLabels[this.inputSettings.mouseControlStyle]

    // ---- 鼠标滚动类型下拉菜单 ----
    const mouseScrollDropdown = panel.get<DropDownButtonWidget>(
      'MOUSE_SCROLL_TYPE_DROPDOWN',
    )
    mouseScrollDropdown.onMouseDown = () =>
      this.showMouseScrollDropdown(mouseScrollDropdown)
    mouseScrollDropdown.getText = () =>
      this.inputSettings.mouseScroll

    // ---- 控件样式描述 ----
    const mouseControlDescClassic = panel.get('MOUSE_CONTROL_DESC_CLASSIC')
    mouseControlDescClassic.isVisible = () =>
      this.inputSettings.mouseControlStyle === MouseControlStyle.Classic

    const mouseControlDescModern = panel.get('MOUSE_CONTROL_DESC_MODERN')
    mouseControlDescModern.isVisible = () =>
      this.inputSettings.mouseControlStyle === MouseControlStyle.Modern

    const mouseControlDescOtherRTS = panel.get('MOUSE_CONTROL_DESC_OTHERRTS')
    mouseControlDescOtherRTS.isVisible = () =>
      this.inputSettings.mouseControlStyle === MouseControlStyle.OtherRTS

    // 每个描述容器中的子 widget 可见性
    for (const container of [
      mouseControlDescClassic,
      mouseControlDescModern,
      mouseControlDescOtherRTS,
    ]) {
      try {
        const scrollRight = container.get('DESC_SCROLL_RIGHT')
        scrollRight.isVisible = () =>
          (this.inputSettings.mouseControlStyle ===
            MouseControlStyle.Classic) !==
          this.inputSettings.useAlternateScrollButton
      } catch {
        /* optional */
      }

      try {
        const scrollMiddle = container.get('DESC_SCROLL_MIDDLE')
        scrollMiddle.isVisible = () =>
          (this.inputSettings.mouseControlStyle !==
            MouseControlStyle.Classic) !==
          this.inputSettings.useAlternateScrollButton
      } catch {
        /* optional */
      }

      try {
        const zoomDesc = container.get('DESC_ZOOM')
        zoomDesc.isVisible = () =>
          this.inputSettings.zoomModifier === Modifiers.None
      } catch {
        /* optional */
      }
    }

    // ---- 立即应用鼠标焦点设置 ----
    const lockMouseCheckbox =
      panel.get<CheckboxWidget>('LOCKMOUSE_CHECKBOX')
    const oldOnClick = lockMouseCheckbox.onClick
    lockMouseCheckbox.onClick = () => {
      oldOnClick()
      this.makeMouseFocusSettingsLive()
    }

    // ---- 缩放修饰键下拉菜单 ----
    const zoomModifierDropdown = panel.get<DropDownButtonWidget>(
      'ZOOM_MODIFIER',
    )
    zoomModifierDropdown.onMouseDown = () =>
      this.showZoomModifierDropdown(zoomModifierDropdown)
    zoomModifierDropdown.getText = () =>
      modsDisplayString(this.inputSettings.zoomModifier) || 'None'

    // ---- 调整布局 ----
    SettingsUtils.adjustSettingsScrollPanelLayout(scrollPanel)

    return () => false // 输入设置不需要重启
  }

  // ---------------------------------------------------------------------------
  // ResetPanel
  // ---------------------------------------------------------------------------

  private resetPanel(panel: Widget): () => void {
    return () => {
      this.inputSettings.mouseControlStyle = MouseControlStyle.Classic
      this.inputSettings.mouseScroll = MouseScrollType.Standard
      this.inputSettings.useAlternateScrollButton = false
      this.inputSettings.lockMouseWindow = false
      this.inputSettings.viewportEdgeScroll = true
      this.inputSettings.viewportEdgeScrollStep = 10
      this.inputSettings.zoomSpeed = 0.04
      this.inputSettings.uiScrollSpeed = 10
      this.inputSettings.zoomModifier = Modifiers.None

      // 更新滑块显示值
      try {
        panel
          .get<SliderWidget>('SCROLLSPEED_SLIDER')
          .value = this.inputSettings.viewportEdgeScrollStep
      } catch {
        /* optional */
      }
      try {
        panel
          .get<SliderWidget>('UI_SCROLLSPEED_SLIDER')
          .value = this.inputSettings.uiScrollSpeed
      } catch {
        /* optional */
      }

      this.makeMouseFocusSettingsLive()
    }
  }

  // ---------------------------------------------------------------------------
  // Show Mouse Control Dropdown
  // ---------------------------------------------------------------------------

  private showMouseControlDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const options = Object.entries(this.controlTypeLabels).map(
      ([value, label]) => ({
        label,
        value: value as MouseControlStyle,
      }),
    )

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      options,
      (option: (typeof options)[0], template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.inputSettings.mouseControlStyle === option.value,
          () => {
            this.inputSettings.mouseControlStyle = option.value
          },
        )
        item.text = option.label
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show Mouse Scroll Dropdown
  // ---------------------------------------------------------------------------

  private showMouseScrollDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const options = [
      { label: 'Disabled', value: MouseScrollType.Disabled as MouseScrollType },
      { label: 'Standard', value: MouseScrollType.Standard as MouseScrollType },
      { label: 'Inverted', value: MouseScrollType.Inverted as MouseScrollType },
      { label: 'Joystick', value: MouseScrollType.Joystick as MouseScrollType },
    ]

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      options,
      (option: (typeof options)[0], template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.inputSettings.mouseScroll === option.value,
          () => {
            this.inputSettings.mouseScroll = option.value
          },
        )
        item.text = option.label
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show Zoom Modifier Dropdown
  // ---------------------------------------------------------------------------

  private showZoomModifierDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const modifierEntries = [
      { key: Modifiers.Alt },
      { key: Modifiers.Ctrl },
      { key: Modifiers.Meta },
      { key: Modifiers.Shift },
      { key: Modifiers.None },
    ]

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      modifierEntries,
      (modEntry: (typeof modifierEntries)[0], template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.inputSettings.zoomModifier === modEntry.key,
          () => {
            this.inputSettings.zoomModifier = modEntry.key
          },
        )
        item.text = modsDisplayString(modEntry.key) || 'None'
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Make Mouse Focus Settings Live — 立即应用鼠标焦点设置
  // ---------------------------------------------------------------------------

  private makeMouseFocusSettingsLive(): void {
    if (this.inputSettings.lockMouseWindow) {
      this.mouseFocusCallbacks.grabWindowMouseFocus()
    } else {
      this.mouseFocusCallbacks.releaseWindowMouseFocus()
    }
  }

  // ---------------------------------------------------------------------------
  // ChromeLogic interface
  // ---------------------------------------------------------------------------

  tick(): void {
    // No per-frame logic needed.
  }

  override dispose(): void {
    super.dispose()
  }
}
