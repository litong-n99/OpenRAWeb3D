/**
 * SettingsUtils.ts — Settings 辅助绑定函数
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsUtils.cs (77 lines)
 *
 * 核心范式转换:
 * - C# 反射 (FieldInfo.GetValue/SetValue) → TypeScript 属性访问回调 (getter/setter)
 * - C# SliderWidget.OnChange += x => field.SetValue(group, x) → onChange 回调
 * - C# CheckboxWidget.IsChecked / OnClick 委托绑定 → isChecked / onClick 委托
 * - C# AdjustSettingsScrollPanelLayout → 等效 TypeScript 可见性调整
 */

import { type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { CheckboxWidget } from '../../CheckboxWidget.js'
import { SliderWidget } from '../../SliderWidget.js'
import { DropDownButtonWidget } from '../../DropDownButtonWidget.js'
import { ScrollPanelWidget } from '../../ScrollPanelWidget.js'

// ---------------------------------------------------------------------------
// SettingsUtils — 静态辅助类
// OpenRA 对照: public static class SettingsUtils
// ---------------------------------------------------------------------------

/**
 * Settings 绑定辅助工具 — 将设置属性绑定到 UI widget。
 *
 * 提供复选框、滑块和下拉框的声明式绑定。
 * 替代了 C# 基于反射的字段绑定。
 *
 * OpenRA 对照: public static class SettingsUtils
 */
export class SettingsUtils {
  // ---------------------------------------------------------------------------
  // BindCheckboxPref — 绑定 CheckboxWidget 到布尔设置属性
  // OpenRA 对照: BindCheckboxPref(Widget parent, string id, object group, string pref)
  // ---------------------------------------------------------------------------

  /**
   * 将 CheckboxWidget 绑定到布尔设置属性。
   *
   * OpenRA 对照: BindCheckboxPref(Widget, string, object, string)
   *
   * @param parent — 包含复选框的父 widget
   * @param id — 复选框 widget 的 ID
   * @param get — 获取当前设置的 getter 函数
   * @param set — 设置当前值的 setter 函数
   */
  static bindCheckboxPref(
    parent: Widget,
    id: string,
    get: () => boolean,
    set: (v: boolean) => void,
  ): void {
    const cb = parent.get<CheckboxWidget>(id)
    cb.isChecked = () => get()
    cb.onClick = () => set(!cb.isChecked())
  }

  // ---------------------------------------------------------------------------
  // BindSliderPref — 绑定 SliderWidget 到浮点设置属性
  // OpenRA 对照: BindSliderPref(Widget parent, string id, object group, string pref)
  // ---------------------------------------------------------------------------

  /**
   * 将 SliderWidget 绑定到浮点设置属性。
   *
   * OpenRA 对照: BindSliderPref(Widget, string, object, string)
   *
   * @param parent — 包含滑块的父 widget
   * @param id — 滑块 widget 的 ID
   * @param get — 获取当前值的 getter 函数
   * @param set — 设置当前值的 setter 函数
   */
  static bindSliderPref(
    parent: Widget,
    id: string,
    get: () => number,
    set: (v: number) => void,
  ): void {
    const ss = parent.get<SliderWidget>(id)
    ss.value = get()
    ss.onChange = (x: number) => set(x)
  }

  // ---------------------------------------------------------------------------
  // BindIntSliderPref — 绑定 SliderWidget 到整数设置属性
  // OpenRA 对照: BindIntSliderPref(Widget parent, string id, object group, string pref)
  // ---------------------------------------------------------------------------

  /**
   * 将 SliderWidget 绑定到整数设置属性。
   *
   * OpenRA 对照: BindIntSliderPref(Widget, string, object, string)
   *
   * @param parent — 包含滑块的父 widget
   * @param id — 滑块 widget 的 ID
   * @param get — 获取当前值的 getter 函数
   * @param set — 设置当前值的 setter 函数（接收整数）
   */
  static bindIntSliderPref(
    parent: Widget,
    id: string,
    get: () => number,
    set: (v: number) => void,
  ): void {
    const ss = parent.get<SliderWidget>(id)
    ss.value = get()
    ss.onChange = (x: number) => set(Math.round(x))
  }

  // ---------------------------------------------------------------------------
  // BindDropdownPref — 绑定 DropDownButtonWidget 到设置属性
  // OpenRA 对照: 无直接对照（C# 在 Logic 类中手动绑定下拉菜单）
  // ---------------------------------------------------------------------------

  /**
   * 将 DropDownButtonWidget 绑定到字符串设置属性。
   *
   * NOTE: OpenRA 中下拉菜单的绑定由各 Logic 类手动完成。
   * 此方法提供统一的下拉菜单设置同步。
   *
   * @param parent — 包含下拉按钮的父 widget
   * @param id — 下拉按钮 widget 的 ID
   * @param getText — 获取当前显示文本的 getter 函数
   * @param onMouseDown — 下拉菜单打开回调
   */
  static bindDropdown(
    parent: Widget,
    id: string,
    getText: () => string,
    onMouseDown: (event: unknown) => void,
  ): void {
    const dropdown = parent.get<DropDownButtonWidget>(id)
    dropdown.getText = getText
    dropdown.onMouseDown = onMouseDown
  }

  // ---------------------------------------------------------------------------
  // AdjustSettingsScrollPanelLayout — 调整设置滚动面板布局
  // OpenRA 对照: AdjustSettingsScrollPanelLayout(ScrollPanelWidget scrollPanel)
  // ---------------------------------------------------------------------------

  /**
   * 调整设置滚动面板的布局 — 隐藏无可见子 widget 的行。
   *
   * OpenRA 对照: AdjustSettingsScrollPanelLayout(ScrollPanelWidget)
   *
   * 遍历所有子 widget 行：
   * - 如果某行的所有容器都没有可见子 widget，则隐藏该行
   * - 然后调用 scrollPanel.layout.AdjustChildren()
   *
   * @param scrollPanel — 要调整的滚动面板
   */
  static adjustSettingsScrollPanelLayout(
    scrollPanel: ScrollPanelWidget,
  ): void {
    for (const row of scrollPanel.children) {
      if (row.children.length === 0) continue

      let hasVisibleChildren = false
      for (const container of row.children) {
        if (container.isVisible()) {
          hasVisibleChildren = true
          break
        }
      }

      if (!hasVisibleChildren) {
        row.isVisible = () => false
      }
    }

    // NOTE: OpenRA calls scrollPanel.Layout.AdjustChildren()
    // In our DOM-based widget system, layout adjustment is implicit
    // in the render pass. No explicit AdjustChildren() needed.
  }

  // ---------------------------------------------------------------------------
  // Setting changed callback type
  // ---------------------------------------------------------------------------

  /** Settings 变更回调类型 — 用于通知设置面板有值变更。
   *
   * OpenRA 对照: 无直接对照（C# 中设置通过字段赋值直接更改）
   */
  static settingChanged(_name: string, _newValue: unknown): void {
    // NOTE: In OpenRA, setting changes are persisted by the parent
    // SettingsLogic when leaving a panel. Per-panel change tracking
    // is handled by the leavePanelActions return value.
    // This stub provides an optional hook for global setting change listeners.
  }
}
