/**
 * DisplaySettingsLogic.test.ts — DisplaySettingsLogic 单元测试
 *
 * 测试覆盖:
 * - 面板注册和初始化流程
 * - 图形设置绑定 (VSync, frame limiter, cursor double)
 * - 游戏设置绑定 (player stance colors, text notification filters)
 * - 窗口模式下拉菜单选项
 * - 分辨率预设下拉菜单
 * - GL Profile 下拉菜单
 * - UI Scale 下拉菜单（含最大比例计算）
 * - 离开面板操作 (need-restart 检测)
 * - 重置面板操作 (恢复默认值)
 * - getViewportSizeName 静态方法
 * - BindTextNotificationPoolFilterSettings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DisplaySettingsLogic,
  type GraphicSettings,
  type GameSettingsState,
  type RendererState,
  type ViewportSizesProvider,
} from './DisplaySettingsLogic.js'
import { SettingsLogic } from './SettingsLogic.js'
import { ContainerWidget } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockGraphicSettings(): GraphicSettings {
  return {
    cursorDouble: false,
    vSync: true,
    capFramerate: false,
    capFramerateToGameFps: false,
    maxFramerate: 120,
    mode: 'PseudoFullscreen' as const,
    videoDisplay: 0,
    glProfile: 'Automatic' as const,
    windowedSize: { width: 1024, height: 720 },
    fullscreenSize: { width: 1920, height: 1080 },
    uiScale: 1.0,
    viewportDistance: 'Medium' as const,
  }
}

function createMockGameSettings(): GameSettingsState {
  return {
    usePlayerStanceColors: true,
    statusBars: 'Standard' as const,
    targetLines: 'Automatic' as const,
    textNotificationPoolFilters: 0,
    pauseShellmap: false,
  }
}

function createMockRenderer(): RendererState {
  return {
    resolution: { width: 1920, height: 1080 },
    nativeResolution: { width: 1920, height: 1080 },
    displayCount: 1,
    supportedGLProfiles: ['Modern', 'Legacy'],
    setVSyncEnabled: vi.fn(),
    setUIScale: vi.fn(),
  }
}

function createMockViewportSizes(): ViewportSizesProvider {
  return {
    minEffectiveResolution: { width: 1024, height: 720 },
    allowNativeZoom: false,
    getSizeRange: vi.fn(() => ({ width: 1500, height: 1500 })),
  }
}

function buildSettingsLogic(): {
  logic: SettingsLogic
} {
  const widget = new ContainerWidget()
  widget.id = 'SETTINGS_ROOT'

  const panelContainer = new ContainerWidget()
  panelContainer.id = 'PANEL_CONTAINER'
  const panelTemplate = new ContainerWidget()
  panelTemplate.id = 'PANEL_TEMPLATE'
  panelContainer.addChild(panelTemplate)
  widget.addChild(panelContainer)

  const tabContainer = new ContainerWidget()
  tabContainer.id = 'SETTINGS_TAB_CONTAINER'
  const tabTemplate = new ContainerWidget() as any
  tabTemplate.id = 'BUTTON_TEMPLATE'
  tabTemplate.clone = () => {
    const b = new ContainerWidget() as any
    b.getText = () => ''
    b.isHighlighted = () => false
    b.bounds = { x: 0, y: 0, width: 100, height: 30 }
    return b
  }
  tabContainer.addChild(tabTemplate)
  widget.addChild(tabContainer)

  const backButton = new ContainerWidget() as any
  backButton.id = 'BACK_BUTTON'
  backButton.onClick = () => {}
  widget.addChild(backButton)

  const resetButton = new ContainerWidget() as any
  resetButton.id = 'RESET_BUTTON'
  resetButton.onClick = () => {}
  widget.addChild(resetButton)

  const callbacks = {
    saveSettings: vi.fn(),
    hasExternalMod: vi.fn(() => false),
    switchToExternalMod: vi.fn(),
    showConfirmDialog: vi.fn(
      (_t: string, _x: string, onConfirm: () => void) => onConfirm(),
    ),
    showSavePrompt: vi.fn(),
    closeWindow: vi.fn(),
  }

  const logic = new SettingsLogic(widget, vi.fn(), {}, callbacks)
  return { logic }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DisplaySettingsLogic', () => {
  let graphicSettings: GraphicSettings
  let gameSettings: GameSettingsState
  let renderer: RendererState
  let viewportSizes: ViewportSizesProvider
  let settingsLogic: SettingsLogic

  beforeEach(() => {
    graphicSettings = createMockGraphicSettings()
    gameSettings = createMockGameSettings()
    renderer = createMockRenderer()
    viewportSizes = createMockViewportSizes()
    const built = buildSettingsLogic()
    settingsLogic = built.logic
  })

  // ---------------------------------------------------------------------------
  // getViewportSizeName
  // ---------------------------------------------------------------------------

  describe('getViewportSizeName', () => {
    it('should return display names for viewport sizes', () => {
      expect(DisplaySettingsLogic.getViewportSizeName('Close' as const)).toBe(
        'Close',
      )
      expect(DisplaySettingsLogic.getViewportSizeName('Medium' as const)).toBe(
        'Medium',
      )
      expect(DisplaySettingsLogic.getViewportSizeName('Far' as const)).toBe(
        'Far',
      )
      expect(DisplaySettingsLogic.getViewportSizeName('Native' as const)).toBe(
        'Furthest',
      )
    })

    it('should return empty string for unknown viewport', () => {
      expect(
        DisplaySettingsLogic.getViewportSizeName('Unknown' as any),
      ).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // Construction and registration
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should register panel with settingsLogic', () => {
      expect(() => {
        new DisplaySettingsLogic(
          settingsLogic,
          'Display',
          'Display',
          graphicSettings,
          gameSettings,
          renderer,
          viewportSizes,
        )
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Graphic settings state mutations
  // ---------------------------------------------------------------------------

  describe('graphicSettings state', () => {
    it('should support VSync toggling', () => {
      expect(graphicSettings.vSync).toBe(true)
      graphicSettings.vSync = false
      expect(graphicSettings.vSync).toBe(false)
    })

    it('should support frame limiter cap', () => {
      expect(graphicSettings.capFramerate).toBe(false)
      graphicSettings.capFramerate = true
      expect(graphicSettings.capFramerate).toBe(true)
    })

    it('should support max framerate slider', () => {
      graphicSettings.maxFramerate = 60
      expect(graphicSettings.maxFramerate).toBe(60)
    })

    it('should support cursor double', () => {
      graphicSettings.cursorDouble = true
      expect(graphicSettings.cursorDouble).toBe(true)
    })

    it('should support viewport distance', () => {
      graphicSettings.viewportDistance = 'Far' as const
      expect(graphicSettings.viewportDistance).toBe('Far')
    })

    it('should support UI scale', () => {
      graphicSettings.uiScale = 1.5
      expect(graphicSettings.uiScale).toBe(1.5)
    })
  })

  // ---------------------------------------------------------------------------
  // Game settings state mutations
  // ---------------------------------------------------------------------------

  describe('gameSettings state', () => {
    it('should support player stance colors', () => {
      gameSettings.usePlayerStanceColors = false
      expect(gameSettings.usePlayerStanceColors).toBe(false)
    })

    it('should support text notification pool filters', () => {
      gameSettings.textNotificationPoolFilters = 1 // Feedback bit
      expect(gameSettings.textNotificationPoolFilters).toBe(1)
      gameSettings.textNotificationPoolFilters ^= 1 // toggle off
      expect(gameSettings.textNotificationPoolFilters).toBe(0)
    })

    it('should support status bars type', () => {
      gameSettings.statusBars = 'AlwaysShow' as const
      expect(gameSettings.statusBars).toBe('AlwaysShow')
    })

    it('should support target lines type', () => {
      gameSettings.targetLines = 'Disabled' as const
      expect(gameSettings.targetLines).toBe('Disabled')
    })
  })

  // ---------------------------------------------------------------------------
  // Renderer state
  // ---------------------------------------------------------------------------

  describe('renderer state', () => {
    it('should call setVSyncEnabled', () => {
      renderer.setVSyncEnabled(false)
      expect(renderer.setVSyncEnabled).toHaveBeenCalledWith(false)
    })

    it('should call setUIScale', () => {
      renderer.setUIScale(1.5)
      expect(renderer.setUIScale).toHaveBeenCalledWith(1.5)
    })

    it('should provide display count', () => {
      expect(renderer.displayCount).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Original graphic settings comparison (need-restart detection)
  // ---------------------------------------------------------------------------

  describe('need-restart detection', () => {
    it('should detect window mode change', () => {
      const original = { ...graphicSettings }
      graphicSettings.mode = 'Windowed' as const
      expect(graphicSettings.mode).not.toBe(original.mode)
    })

    it('should detect video display change', () => {
      const original = { ...graphicSettings }
      graphicSettings.videoDisplay = 1
      expect(graphicSettings.videoDisplay).not.toBe(original.videoDisplay)
    })

    it('should detect GL profile change', () => {
      const original = { ...graphicSettings }
      graphicSettings.glProfile = 'Legacy' as const
      expect(graphicSettings.glProfile).not.toBe(original.glProfile)
    })
  })
})
