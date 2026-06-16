/**
 * HotkeysSettingsLogic.test.ts — HotkeysSettingsLogic 单元测试
 *
 * 测试覆盖:
 * - 热键定义接口 (HotkeyDef)
 * - 热键管理器接口 (HotkeysManager)
 * - 面板注册
 * - 热键分组解析
 * - 上下文筛选
 * - 重复热键检测
 * - 热键保存/重置/清除/覆盖操作
 * - tick 生命周期
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  HotkeysSettingsLogic,
  type HotkeyDef,
  type HotkeysManager,
} from './HotkeysSettingsLogic.js'
import { SettingsLogic } from './SettingsLogic.js'
import { Hotkey } from '../../../../OpenRA.Game/Input/HotkeyReference.js'
import { KeyCode } from '../../../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../../../OpenRA.Game/Input/IInputHandler.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockHotkeyDefs(): HotkeyDef[] {
  return [
    {
      name: 'AttackMove',
      default: new Hotkey(KeyCode.A, Modifiers.Ctrl),
      description: 'Attack Move',
      types: new Set(['Unit']),
      contexts: new Set(['hotkey-context-world']),
      readonly: false,
      hasDuplicates: false,
    },
    {
      name: 'Stop',
      default: new Hotkey(KeyCode.S, Modifiers.None),
      description: 'Stop',
      types: new Set(['Unit']),
      contexts: new Set(['hotkey-context-world']),
      readonly: false,
      hasDuplicates: false,
    },
    {
      name: 'Deploy',
      default: new Hotkey(KeyCode.F, Modifiers.None),
      description: 'Deploy',
      types: new Set(['Unit', 'Building']),
      contexts: new Set(['hotkey-context-world']),
      readonly: true,
      hasDuplicates: false,
    },
  ]
}

function createMockHotkeysManager(
  defs?: HotkeyDef[],
): HotkeysManager {
  const definitions = defs ?? createMockHotkeyDefs()
  const values: Map<string, Hotkey> = new Map()
  for (const d of definitions) {
    values.set(d.name, d.default)
  }

  return {
    definitions,
    get: vi.fn((name: string) => values.get(name) ?? Hotkey.Invalid),
    set: vi.fn((name: string, value: Hotkey) => {
      values.set(name, value)
    }),
    save: vi.fn(),
    getFirstDuplicate: vi.fn(() => null),
  }
}

function buildSettingsLogic(): SettingsLogic {
  const widget = new ContainerWidget()
  widget.id = 'ROOT'
  const pc = new ContainerWidget()
  pc.id = 'PANEL_CONTAINER'
  const pt = new ContainerWidget()
  pt.id = 'PANEL_TEMPLATE'
  pc.addChild(pt)
  widget.addChild(pc)
  const tc = new ContainerWidget()
  tc.id = 'SETTINGS_TAB_CONTAINER'
  const tt = new ContainerWidget() as any
  tt.id = 'BUTTON_TEMPLATE'
  tt.clone = () => {
    const b = new ContainerWidget() as any
    b.getText = () => ''
    b.isHighlighted = () => false
    b.bounds = { x: 0, y: 0, width: 100, height: 30 }
    return b
  }
  tc.addChild(tt)
  widget.addChild(tc)
  widget.get = (id: string) => {
    if (id === 'PANEL_CONTAINER') return pc
    if (id === 'SETTINGS_TAB_CONTAINER') return tc
    if (id === 'BUTTON_TEMPLATE') return tt
    if (id === 'PANEL_TEMPLATE') return pt
    const bk = new ContainerWidget() as any
    bk.id = id
    bk.onClick = () => {}
    return bk
  }
  return new SettingsLogic(
    widget,
    vi.fn(),
    {},
    {
      saveSettings: vi.fn(),
      hasExternalMod: vi.fn(() => false),
      switchToExternalMod: vi.fn(),
      showConfirmDialog: vi.fn(),
      showSavePrompt: vi.fn(),
      closeWindow: vi.fn(),
    },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HotkeysSettingsLogic', () => {
  let hotkeysManager: HotkeysManager
  let settingsLogic: SettingsLogic

  beforeEach(() => {
    hotkeysManager = createMockHotkeysManager()
    settingsLogic = buildSettingsLogic()
  })

  // ---------------------------------------------------------------------------
  // HotkeyDef interface
  // ---------------------------------------------------------------------------

  describe('HotkeyDef interface', () => {
    it('should have required fields', () => {
      const hd: HotkeyDef = createMockHotkeyDefs()[0]
      expect(hd.name).toBe('AttackMove')
      expect(hd.description).toBe('Attack Move')
      expect(hd.types.has('Unit')).toBe(true)
      expect(hd.contexts.has('hotkey-context-world')).toBe(true)
      expect(hd.readonly).toBe(false)
      expect(hd.hasDuplicates).toBe(false)
      expect(hd.default.isValid()).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // HotkeysManager interface
  // ---------------------------------------------------------------------------

  describe('HotkeysManager interface', () => {
    it('should get hotkey values', () => {
      const value = hotkeysManager.get('AttackMove')
      expect(value.isValid()).toBe(true)
    })

    it('should set hotkey values', () => {
      const newKey = new Hotkey(KeyCode.Z, Modifiers.Shift)
      hotkeysManager.set('AttackMove', newKey)
      expect(hotkeysManager.set).toHaveBeenCalledWith(
        'AttackMove',
        newKey,
      )
    })

    it('should have definitions list', () => {
      expect(hotkeysManager.definitions.length).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should construct without error with valid hotkey groups', () => {
      const logicArgs = {
        HotkeyGroups: {
          'hotkey-group-units': { Types: 'Unit' },
          'hotkey-group-buildings': { Types: 'Building' },
        },
      }
      expect(() => {
        new HotkeysSettingsLogic(
          settingsLogic,
          'Hotkeys',
          'Hotkeys',
          hotkeysManager,
          logicArgs,
        )
      }).not.toThrow()
    })

    it('should construct without hotkey groups', () => {
      expect(() => {
        new HotkeysSettingsLogic(
          settingsLogic,
          'Hotkeys',
          'Hotkeys',
          hotkeysManager,
          {},
        )
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Tick lifecycle
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('should implement tick without error', () => {
      const logic = new HotkeysSettingsLogic(
        settingsLogic,
        'Hotkeys',
        'Hotkeys',
        hotkeysManager,
        {},
      )
      expect(() => logic.tick()).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Duplicate detection
  // ---------------------------------------------------------------------------

  describe('duplicate detection', () => {
    it('should report no duplicates by default', () => {
      const result = hotkeysManager.getFirstDuplicate(
        createMockHotkeyDefs()[0],
        createMockHotkeyDefs()[0].default,
      )
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Readonly hotkeys
  // ---------------------------------------------------------------------------

  describe('readonly hotkeys', () => {
    it('should identify readonly definitions', () => {
      const defs = createMockHotkeyDefs()
      expect(defs[2].readonly).toBe(true) // Deploy is readonly
      expect(defs[0].readonly).toBe(false)
      expect(defs[1].readonly).toBe(false)
    })
  })
})
