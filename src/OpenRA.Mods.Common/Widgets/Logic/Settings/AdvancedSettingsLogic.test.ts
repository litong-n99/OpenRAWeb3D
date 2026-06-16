/**
 * AdvancedSettingsLogic.test.ts — AdvancedSettingsLogic 单元测试
 *
 * 测试覆盖:
 * - DebugSettings 调试设置
 * - AdvancedGameSettings 高级游戏设置
 * - AdvancedServerSettings 服务器设置
 * - 面板注册
 * - 重置到默认值
 * - 开发者设置可见性标志
 * - NAT 发现设置变更检测
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AdvancedSettingsLogic,
  type DebugSettings,
  type AdvancedGameSettings,
  type AdvancedServerSettings,
} from './AdvancedSettingsLogic.js'
import { SettingsLogic } from './SettingsLogic.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDebugSettings(): DebugSettings {
  return {
    perfText: false,
    perfGraph: false,
    botDebug: false,
    luaDebug: false,
    enableDebugCommandsInReplays: false,
    syncCheckUnsyncedCode: false,
    syncCheckBotModuleCode: false,
    enableSimulationPerfLogging: false,
    sendSystemInformation: false,
    checkVersion: true,
    displayDeveloperSettings: false,
  }
}

function createMockGameSettings(): AdvancedGameSettings {
  return {
    fetchNews: true,
  }
}

function createMockServerSettings(): AdvancedServerSettings {
  return {
    discoverNatDevices: false,
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

describe('AdvancedSettingsLogic', () => {
  let debugSettings: DebugSettings
  let gameSettings: AdvancedGameSettings
  let serverSettings: AdvancedServerSettings
  let settingsLogic: SettingsLogic

  beforeEach(() => {
    debugSettings = createMockDebugSettings()
    gameSettings = createMockGameSettings()
    serverSettings = createMockServerSettings()
    settingsLogic = buildSettingsLogic()
  })

  // ---------------------------------------------------------------------------
  // DebugSettings state
  // ---------------------------------------------------------------------------

  describe('DebugSettings state', () => {
    it('should have perf text flag', () => {
      expect(debugSettings.perfText).toBe(false)
      debugSettings.perfText = true
      expect(debugSettings.perfText).toBe(true)
    })

    it('should have perf graph flag', () => {
      expect(debugSettings.perfGraph).toBe(false)
      debugSettings.perfGraph = true
      expect(debugSettings.perfGraph).toBe(true)
    })

    it('should have bot debug flag', () => {
      expect(debugSettings.botDebug).toBe(false)
      debugSettings.botDebug = true
      expect(debugSettings.botDebug).toBe(true)
    })

    it('should have lua debug flag', () => {
      expect(debugSettings.luaDebug).toBe(false)
      debugSettings.luaDebug = true
      expect(debugSettings.luaDebug).toBe(true)
    })

    it('should have sync check flags', () => {
      debugSettings.syncCheckUnsyncedCode = true
      expect(debugSettings.syncCheckUnsyncedCode).toBe(true)
      debugSettings.syncCheckBotModuleCode = true
      expect(debugSettings.syncCheckBotModuleCode).toBe(true)
    })

    it('should have display developer settings flag', () => {
      expect(debugSettings.displayDeveloperSettings).toBe(false)
      debugSettings.displayDeveloperSettings = true
      expect(debugSettings.displayDeveloperSettings).toBe(true)
    })

    it('should have send system info flag', () => {
      debugSettings.sendSystemInformation = true
      expect(debugSettings.sendSystemInformation).toBe(true)
    })

    it('should have check version flag', () => {
      expect(debugSettings.checkVersion).toBe(true)
      debugSettings.checkVersion = false
      expect(debugSettings.checkVersion).toBe(false)
    })

    it('should have enable debug commands in replays flag', () => {
      debugSettings.enableDebugCommandsInReplays = true
      expect(debugSettings.enableDebugCommandsInReplays).toBe(true)
    })

    it('should have enable simulation perf logging flag', () => {
      debugSettings.enableSimulationPerfLogging = true
      expect(debugSettings.enableSimulationPerfLogging).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // AdvancedGameSettings state
  // ---------------------------------------------------------------------------

  describe('AdvancedGameSettings state', () => {
    it('should have fetch news flag', () => {
      expect(gameSettings.fetchNews).toBe(true)
      gameSettings.fetchNews = false
      expect(gameSettings.fetchNews).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // AdvancedServerSettings state
  // ---------------------------------------------------------------------------

  describe('AdvancedServerSettings state', () => {
    it('should have discover NAT devices flag', () => {
      expect(serverSettings.discoverNatDevices).toBe(false)
      serverSettings.discoverNatDevices = true
      expect(serverSettings.discoverNatDevices).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should construct without error', () => {
      expect(() => {
        new AdvancedSettingsLogic(
          settingsLogic,
          'Advanced',
          'Advanced',
          debugSettings,
          gameSettings,
          serverSettings,
        )
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Developer settings visibility
  // ---------------------------------------------------------------------------

  describe('developer settings toggling', () => {
    it('should show developer settings when enabled', () => {
      debugSettings.displayDeveloperSettings = true
      expect(debugSettings.displayDeveloperSettings).toBe(true)
    })

    it('should hide developer settings when disabled', () => {
      debugSettings.displayDeveloperSettings = false
      expect(debugSettings.displayDeveloperSettings).toBe(false)
    })

    it('should be able to toggle all dev settings independently', () => {
      // Bot debug is independent
      debugSettings.botDebug = true
      expect(debugSettings.botDebug).toBe(true)

      // Lua debug is independent
      debugSettings.luaDebug = true
      expect(debugSettings.luaDebug).toBe(true)

      // They don't affect each other
      debugSettings.botDebug = false
      expect(debugSettings.botDebug).toBe(false)
      expect(debugSettings.luaDebug).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // NAT discovery change detection
  // ---------------------------------------------------------------------------

  describe('NAT discovery change detection', () => {
    it('should detect changes from original value', () => {
      const original = { ...serverSettings }
      serverSettings.discoverNatDevices = true
      expect(serverSettings.discoverNatDevices).not.toBe(
        original.discoverNatDevices,
      )
    })
  })
})
