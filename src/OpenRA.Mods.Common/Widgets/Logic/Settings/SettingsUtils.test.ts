/**
 * SettingsUtils.test.ts — SettingsUtils 单元测试
 *
 * 测试覆盖:
 * - bindCheckboxPref: 将 CheckboxWidget 绑定到布尔 getter/setter
 * - bindSliderPref: 将 SliderWidget 绑定到浮点 getter/setter
 * - bindIntSliderPref: 将 SliderWidget 绑定到整数 getter/setter（含取整）
 * - bindDropdown: 将 DropDownButtonWidget 绑定到 getText/onMouseDown
 * - adjustSettingsScrollPanelLayout: 隐藏无可见子 widget 的行
 * - settingChanged: 设置变更回调存根
 */

import { describe, it, expect, vi } from 'vitest'
import { SettingsUtils } from './SettingsUtils.js'
import { CheckboxWidget } from '../../CheckboxWidget.js'
import { SliderWidget } from '../../SliderWidget.js'
import { DropDownButtonWidget } from '../../DropDownButtonWidget.js'
import { ScrollPanelWidget } from '../../ScrollPanelWidget.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsUtils', () => {
  // ---------------------------------------------------------------------------
  // bindCheckboxPref
  // ---------------------------------------------------------------------------

  describe('bindCheckboxPref', () => {
    it('should bind checkbox isChecked and onClick to get/set callbacks', () => {
      const parent = new ContainerWidget()
      const cb = new CheckboxWidget()
      cb.id = 'TEST_CB'
      parent.addChild(cb)

      let value = false
      const get = () => value
      const set = (v: boolean) => {
        value = v
      }

      SettingsUtils.bindCheckboxPref(parent, 'TEST_CB', get, set)

      // isChecked should reflect current value
      expect(cb.isChecked()).toBe(false)

      // onClick should toggle value
      cb.onClick()
      expect(value).toBe(true)
      expect(cb.isChecked()).toBe(true)

      cb.onClick()
      expect(value).toBe(false)
    })

    it('should throw if widget ID not found', () => {
      const parent = new ContainerWidget()

      expect(() => {
        SettingsUtils.bindCheckboxPref(
          parent,
          'NON_EXISTENT',
          () => false,
          () => {},
        )
      }).toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // bindSliderPref
  // ---------------------------------------------------------------------------

  describe('bindSliderPref', () => {
    it('should bind slider value and onChange to get/set callbacks', () => {
      const parent = new ContainerWidget()
      const slider = new SliderWidget()
      slider.id = 'TEST_SLIDER'
      parent.addChild(slider)

      let value = 0.5
      const get = () => value
      const set = (v: number) => {
        value = v
      }

      SettingsUtils.bindSliderPref(parent, 'TEST_SLIDER', get, set)

      // slider.value should be set to initial get() value
      expect(slider.value).toBe(0.5)

      // onChange should update value
      slider.onChange?.(0.75)
      expect(value).toBe(0.75)
    })
  })

  // ---------------------------------------------------------------------------
  // bindIntSliderPref
  // ---------------------------------------------------------------------------

  describe('bindIntSliderPref', () => {
    it('should bind slider with integer rounding', () => {
      const parent = new ContainerWidget()
      const slider = new SliderWidget()
      slider.id = 'INT_SLIDER'
      parent.addChild(slider)

      let value = 60
      const get = () => value
      const set = (v: number) => {
        value = v
      }

      SettingsUtils.bindIntSliderPref(parent, 'INT_SLIDER', get, set)

      expect(slider.value).toBe(60)

      // onChange should round to integer
      slider.onChange?.(120.7)
      expect(value).toBe(121)

      slider.onChange?.(30.3)
      expect(value).toBe(30)
    })
  })

  // ---------------------------------------------------------------------------
  // bindDropdown
  // ---------------------------------------------------------------------------

  describe('bindDropdown', () => {
    it('should bind dropdown getText and onMouseDown', () => {
      const parent = new ContainerWidget()
      const dropdown = new DropDownButtonWidget()
      dropdown.id = 'TEST_DROPDOWN'
      parent.addChild(dropdown)

      let displayText = 'Option A'
      const getText = () => displayText
      const onMouseDown = vi.fn()

      SettingsUtils.bindDropdown(
        parent,
        'TEST_DROPDOWN',
        getText,
        onMouseDown,
      )

      expect(dropdown.getText()).toBe('Option A')

      displayText = 'Option B'
      expect(dropdown.getText()).toBe('Option B')

      dropdown.onMouseDown?.({} as unknown as never)
      expect(onMouseDown).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // adjustSettingsScrollPanelLayout
  // ---------------------------------------------------------------------------

  describe('adjustSettingsScrollPanelLayout', () => {
    it('should hide rows with no visible children', () => {
      const scrollPanel = new ScrollPanelWidget()

      // Row with visible children
      const row1 = new ContainerWidget()
      const visibleChild = new ContainerWidget()
      visibleChild.visible = true
      visibleChild.isVisible = () => true
      row1.addChild(visibleChild)
      row1.visible = true

      // Row with no visible children
      const row2 = new ContainerWidget()
      const hiddenChild = new ContainerWidget()
      hiddenChild.visible = false
      hiddenChild.isVisible = () => false
      row2.addChild(hiddenChild)
      row2.visible = true

      scrollPanel.addChild(row1)
      scrollPanel.addChild(row2)

      SettingsUtils.adjustSettingsScrollPanelLayout(scrollPanel)

      expect(row1.visible).toBe(true) // 有可见子 widget
      expect(row2.visible).toBe(false) // 没有可见子 widget
    })

    it('should skip rows with no children', () => {
      const scrollPanel = new ScrollPanelWidget()
      const emptyRow = new ContainerWidget()
      emptyRow.visible = true
      scrollPanel.addChild(emptyRow)

      // Should not throw
      expect(() =>
        SettingsUtils.adjustSettingsScrollPanelLayout(scrollPanel),
      ).not.toThrow()
      expect(emptyRow.visible).toBe(true) // 空行保持可见
    })

    it('should handle rows where at least one container has visible children', () => {
      const scrollPanel = new ScrollPanelWidget()
      const row = new ContainerWidget()

      const hiddenContainer = new ContainerWidget()
      hiddenContainer.isVisible = () => false
      row.addChild(hiddenContainer)

      const visibleContainer = new ContainerWidget()
      visibleContainer.isVisible = () => true
      row.addChild(visibleContainer)

      row.visible = true
      scrollPanel.addChild(row)

      SettingsUtils.adjustSettingsScrollPanelLayout(scrollPanel)

      expect(row.visible).toBe(true) // 至少一个容器有可见子 widget
    })
  })

  // ---------------------------------------------------------------------------
  // settingChanged
  // ---------------------------------------------------------------------------

  describe('settingChanged', () => {
    it('should be callable without error (stub)', () => {
      expect(() =>
        SettingsUtils.settingChanged('testSetting', 'newValue'),
      ).not.toThrow()
    })
  })
})
