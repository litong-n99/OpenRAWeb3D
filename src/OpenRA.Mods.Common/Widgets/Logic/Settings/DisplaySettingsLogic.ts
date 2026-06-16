/**
 * DisplaySettingsLogic.ts — 显示/图形设置面板逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Settings/DisplaySettingsLogic.cs (575 lines)
 *
 * 核心范式转换:
 * - C# WorldViewportSizes / WorldViewport enum → TypeScript 配置对象
 * - C# WindowMode enum { Windowed, Fullscreen, PseudoFullscreen } → 字符串常量
 * - C# GLProfile enum { Automatic, Modern, Legacy, Embedded } → 字符串常量
 * - C# StatusBarsType / TargetLinesType → 字符串常量
 * - C# TextNotificationPoolFilters 位标志 → 数值位标志
 * - C# CachedTransform<T, string> → 闭包缓存 (cache input → recompute)
 * - C# Game.Renderer.SetVSyncEnabled / SetUIScale → 可替换渲染回调
 * - C# FluentProvider.GetMessage → 硬编码字符串（Fluent 暂未迁移）
 * - C# System.Collections.Frozen.FrozenSet<Size> → readonly 数组
 * - C# Game.Renderer.Resolution / DisplayCount / NativeResolution → 渲染状态回调
 */

import { Widget, ChromeLogic } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { SettingsLogic } from './SettingsLogic.js'
import { SettingsUtils } from './SettingsUtils.js'
import { CheckboxWidget } from '../../CheckboxWidget.js'
import { SliderWidget } from '../../SliderWidget.js'
import { DropDownButtonWidget } from '../../DropDownButtonWidget.js'
import { ScrollPanelWidget } from '../../ScrollPanelWidget.js'
import { ScrollItemWidget } from '../../ScrollItemWidget.js'
import { TextFieldWidget } from '../../TextFieldWidget.js'

// ---------------------------------------------------------------------------
// Size 类型 — 对照 C# System.Drawing.Size
// ---------------------------------------------------------------------------

/** 整数尺寸。OpenRA 对照: System.Drawing.Size */
interface Size {
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// 常量 — 对照 OpenRA 枚举值
// ---------------------------------------------------------------------------

/** 窗口模式常量。OpenRA 对照: WindowMode enum */
const WindowMode = {
  Windowed: 'Windowed',
  Fullscreen: 'Fullscreen',
  PseudoFullscreen: 'PseudoFullscreen',
} as const
type WindowMode = (typeof WindowMode)[keyof typeof WindowMode]

/** GL 配置常量。OpenRA 对照: GLProfile enum */
const GLProfile = {
  Automatic: 'Automatic',
  Modern: 'Modern',
  Legacy: 'Legacy',
  Embedded: 'Embedded',
} as const
type GLProfile = (typeof GLProfile)[keyof typeof GLProfile]

/** 状态栏显示类型。OpenRA 对照: StatusBarsType */
const StatusBarsType = {
  Standard: 'Standard',
  DamageShow: 'DamageShow',
  AlwaysShow: 'AlwaysShow',
} as const
type StatusBarsType = (typeof StatusBarsType)[keyof typeof StatusBarsType]

/** 目标线类型。OpenRA 对照: TargetLinesType */
const TargetLinesType = {
  Automatic: 'Automatic',
  Manual: 'Manual',
  Disabled: 'Disabled',
} as const
type TargetLinesType = (typeof TargetLinesType)[keyof typeof TargetLinesType]

/** 视口距离。OpenRA 对照: WorldViewport */
const WorldViewport = {
  Close: 'Close',
  Medium: 'Medium',
  Far: 'Far',
  Native: 'Native',
} as const
type WorldViewport = (typeof WorldViewport)[keyof typeof WorldViewport]

/** 文本通知池过滤器 (位标志)。OpenRA 对照: TextNotificationPoolFilters */
const TextNotificationPoolFilters = {
  None: 0,
  Feedback: 1 << 0,
  Transients: 1 << 1,
} as const

// ---------------------------------------------------------------------------
// 通用分辨率列表
// OpenRA 对照: static readonly FrozenSet<Size> CommonResolutions
// ---------------------------------------------------------------------------

const COMMON_RESOLUTIONS: readonly Size[] = [
  { width: 1024, height: 720 },  // OpenRA minimum
  { width: 1024, height: 768 },  // XGA
  { width: 1280, height: 720 },  // HD 720p
  { width: 1366, height: 768 },  // HD (laptop standard)
  { width: 1440, height: 900 },  // WXGA+
  { width: 1600, height: 900 },  // HD+
  { width: 1920, height: 1080 }, // Full HD
  { width: 2560, height: 1440 }, // QHD
  { width: 3840, height: 2160 }, // 4K UHD
]

// ---------------------------------------------------------------------------
// GraphicSettings — 图形设置状态对象
// OpenRA 对照: GraphicSettings class
// ---------------------------------------------------------------------------

/** 图形设置状态对象。OpenRA 对照: GraphicSettings */
export interface GraphicSettings {
  cursorDouble: boolean
  vSync: boolean
  capFramerate: boolean
  capFramerateToGameFps: boolean
  maxFramerate: number
  mode: WindowMode
  videoDisplay: number
  glProfile: GLProfile
  windowedSize: Size
  fullscreenSize: Size
  uiScale: number
  viewportDistance: WorldViewport
}

/** 游戏设置状态对象。OpenRA 对照: GameSettings (子集) */
export interface GameSettingsState {
  usePlayerStanceColors: boolean
  statusBars: StatusBarsType
  targetLines: TargetLinesType
  textNotificationPoolFilters: number
  pauseShellmap: boolean
}

/** 视口尺寸提供者。OpenRA 对照: WorldViewportSizes */
export interface ViewportSizesProvider {
  minEffectiveResolution: Size
  allowNativeZoom: boolean
  getSizeRange(viewport: WorldViewport): Size
}

/** 渲染器状态接口（用于设置面板）。OpenRA 对照: Game.Renderer */
export interface RendererState {
  resolution: Size
  nativeResolution: Size
  displayCount: number
  supportedGLProfiles: GLProfile[]
  setVSyncEnabled(enabled: boolean): void
  setUIScale(scale: number): void
}

// ---------------------------------------------------------------------------
// displaySettingChanged — 设置变更回调
// OpenRA 对照: 无（C# 中通过字段直接赋值）
// ---------------------------------------------------------------------------

/** 显示设置变更回调类型。 */
export type DisplaySettingChanged = (
  name: string,
  newValue: unknown,
) => void

// ---------------------------------------------------------------------------
// CachedTransform 工具 — 缓存值转换（OpenRA C# 对照: CachedTransform）
// ---------------------------------------------------------------------------

/** 缓存值转换器。仅当输入值改变时才重新计算。
 *
 * OpenRA 对照: CachedTransform<T, string>
 */
class CachedTransform<T> {
  private lastInput: T | undefined
  private lastOutput: string = ''
  private transform: (input: T) => string

  constructor(transform: (input: T) => string) {
    this.transform = transform
  }

  /** 如果输入自上次调用以来发生了变化，则更新缓存值。
   * 返回当前缓存的输出。 */
  update(input: T): string {
    if (
      this.lastInput === undefined ||
      !this.inputEquals(this.lastInput, input)
    ) {
      this.lastInput = input
      this.lastOutput = this.transform(input)
    }
    return this.lastOutput
  }

  private inputEquals(a: T, b: T): boolean {
    if (a === b) return true
    if (typeof a === 'number' && typeof b === 'number') return a === b
    return JSON.stringify(a) === JSON.stringify(b)
  }
}

// ---------------------------------------------------------------------------
// DisplaySettingsLogic — 显示设置面板
// OpenRA 对照: public class DisplaySettingsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 显示/图形设置面板逻辑。
 *
 * 绑定 resolution、fullscreen、vsync、frame limiter、UI scale、
 * status bars、target lines 等设置控件。
 *
 * OpenRA 对照: public class DisplaySettingsLogic : ChromeLogic
 */
/**
 * NOTE: ADR-16.2 — DisplaySettingsLogic extends ChromeLogic for OpenRA parity.
 * tick() is a no-op in web rendering since widget delegates handle frame updates;
 * dispose() is a no-op since settings state is owned externally.
 */
export class DisplaySettingsLogic extends ChromeLogic {
  private readonly graphicSettings: GraphicSettings
  private readonly gameSettings: GameSettingsState
  private readonly renderer: RendererState
  private readonly viewportSizes: ViewportSizesProvider

  /** 原始图形设置（用于变更检测）。 */
  private readonly originalGraphicSettings: GraphicSettings

  // ---- 本地化字符串（硬编码，Fluent 暂未迁移） ----


  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: DisplaySettingsLogic(ModData, SettingsLogic, string, string, WorldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * 构造显示设置面板。
   *
   * OpenRA 对照:
   *   public DisplaySettingsLogic(ModData modData, SettingsLogic settingsLogic,
   *     string panelID, string label, WorldRenderer worldRenderer)
   *
   * @param settingsLogic — 父设置路由
   * @param panelID — 面板 ID
   * @param label — 面板标签
   * @param graphicSettings — 图形设置状态
   * @param gameSettings — 游戏设置状态
   * @param renderer — 渲染器状态接口
   * @param viewportSizes — 视口尺寸提供者
   */
  constructor(
    settingsLogic: SettingsLogic,
    panelID: string,
    label: string,
    graphicSettings: GraphicSettings,
    gameSettings: GameSettingsState,
    renderer: RendererState,
    viewportSizes: ViewportSizesProvider,
  ) {
    super()

    this.graphicSettings = graphicSettings
    this.gameSettings = gameSettings
    this.renderer = renderer
    this.viewportSizes = viewportSizes
    this.originalGraphicSettings = { ...graphicSettings }

    settingsLogic.registerSettingsPanel(
      panelID,
      label,
      (panel) => this.initPanel(panel),
      (panel) => this.resetPanel(panel),
    )
  }

  // ---------------------------------------------------------------------------
  // Static: GetViewportSizeName
  // OpenRA 对照: GetViewportSizeName(ModData, WorldViewport) → string
  // ---------------------------------------------------------------------------

  /**
   * 获取视口尺寸的显示名称。
   *
   * OpenRA 对照: GetViewportSizeName(ModData, WorldViewport)
   */
  static getViewportSizeName(viewport: WorldViewport): string {
    switch (viewport) {
      case WorldViewport.Close:
        return 'Close'
      case WorldViewport.Medium:
        return 'Medium'
      case WorldViewport.Far:
        return 'Far'
      case WorldViewport.Native:
        return 'Furthest'
      default:
        return ''
    }
  }

  // ---------------------------------------------------------------------------
  // InitPanel — 初始化面板 widget 并绑定设置控件
  // OpenRA 对照: Func<bool> InitPanel(Widget panel)
  // ---------------------------------------------------------------------------

  /**
   * 初始化面板 — 绑定所有控件到设置属性。
   *
   * OpenRA 对照: Func<bool> InitPanel(Widget panel)
   *
   * @returns leavePanelAction — 返回 true 表示需要重启
   */
  private initPanel(panel: Widget): () => boolean {
    const scrollPanel = panel.get<ScrollPanelWidget>('SETTINGS_SCROLLPANEL')

    // ---- 复选框绑定 ----
    SettingsUtils.bindCheckboxPref(
      panel,
      'CURSORDOUBLE_CHECKBOX',
      () => this.graphicSettings.cursorDouble,
      (v) => {
        this.graphicSettings.cursorDouble = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'VSYNC_CHECKBOX',
      () => this.graphicSettings.vSync,
      (v) => {
        this.graphicSettings.vSync = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'FRAME_LIMIT_CHECKBOX',
      () => this.graphicSettings.capFramerate,
      (v) => {
        this.graphicSettings.capFramerate = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'FRAME_LIMIT_GAMESPEED_CHECKBOX',
      () => this.graphicSettings.capFramerateToGameFps,
      (v) => {
        this.graphicSettings.capFramerateToGameFps = v
      },
    )

    SettingsUtils.bindIntSliderPref(
      panel,
      'FRAME_LIMIT_SLIDER',
      () => this.graphicSettings.maxFramerate,
      (v) => {
        this.graphicSettings.maxFramerate = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'PLAYER_STANCE_COLORS_CHECKBOX',
      () => this.gameSettings.usePlayerStanceColors,
      (v) => {
        this.gameSettings.usePlayerStanceColors = v
      },
    )

    // 可选: PAUSE_SHELLMAP_CHECKBOX
    const pauseShellmapCb = panel.getOrNull<CheckboxWidget>(
      'PAUSE_SHELLMAP_CHECKBOX',
    )
    if (pauseShellmapCb) {
      SettingsUtils.bindCheckboxPref(
        panel,
        'PAUSE_SHELLMAP_CHECKBOX',
        () => this.gameSettings.pauseShellmap,
        (v) => {
          this.gameSettings.pauseShellmap = v
        },
      )
    }

    // ---- 窗口模式下拉菜单 ----
    const windowModeDropdown = panel.get<DropDownButtonWidget>(
      'MODE_DROPDOWN',
    )
    windowModeDropdown.onMouseDown = () =>
      this.showWindowModeDropdown(windowModeDropdown, scrollPanel)
    windowModeDropdown.getText = () => {
      switch (this.graphicSettings.mode) {
        case WindowMode.Windowed:
          return 'Windowed'
        case WindowMode.Fullscreen:
          return 'Legacy Fullscreen'
        default:
          return 'Fullscreen'
      }
    }

    // ---- 显示器选择下拉菜单 ----
    const displayDropdown = panel.get<DropDownButtonWidget>(
      'DISPLAY_SELECTION_DROPDOWN',
    )
    displayDropdown.onMouseDown = () =>
      this.showDisplaySelectionDropdown(displayDropdown)
    const displayLabel = new CachedTransform<number>(
      (i) => `Display ${i + 1}`,
    )
    displayDropdown.getText = () =>
      displayLabel.update(this.graphicSettings.videoDisplay)
    displayDropdown.isDisabled = () => this.renderer.displayCount < 2

    // ---- GL Profile 下拉菜单 ----
    const glProfileDropdown = panel.get<DropDownButtonWidget>(
      'GL_PROFILE_DROPDOWN',
    )
    const glProfileLabel = new CachedTransform<GLProfile>((p) => p)
    glProfileDropdown.onMouseDown = () =>
      this.showGLProfileDropdown(glProfileDropdown)
    glProfileDropdown.getText = () =>
      glProfileLabel.update(this.graphicSettings.glProfile)
    glProfileDropdown.isDisabled = () =>
      this.renderer.supportedGLProfiles.length < 2 &&
      this.graphicSettings.glProfile === GLProfile.Automatic

    // ---- 状态栏下拉菜单 ----
    const statusBarsDropdown = panel.get<DropDownButtonWidget>(
      'STATUS_BAR_DROPDOWN',
    )
    statusBarsDropdown.onMouseDown = () =>
      this.showStatusBarsDropdown(statusBarsDropdown)
    statusBarsDropdown.getText = () => {
      switch (this.gameSettings.statusBars) {
        case StatusBarsType.Standard:
          return 'Standard'
        case StatusBarsType.DamageShow:
          return 'Show on Damage'
        default:
          return 'Always Show'
      }
    }

    // ---- 目标线下拉菜单 ----
    const targetLinesDropdown = panel.get<DropDownButtonWidget>(
      'TARGET_LINES_DROPDOWN',
    )
    targetLinesDropdown.onMouseDown = () =>
      this.showTargetLinesDropdown(targetLinesDropdown)
    targetLinesDropdown.getText = () => {
      switch (this.gameSettings.targetLines) {
        case TargetLinesType.Automatic:
          return 'Automatic'
        case TargetLinesType.Manual:
          return 'Manual'
        default:
          return 'Disabled'
      }
    }

    // ---- 战场相机下拉菜单 ----
    const battlefieldDropdown = panel.get<DropDownButtonWidget>(
      'BATTLEFIELD_CAMERA_DROPDOWN',
    )
    const battlefieldLabel = new CachedTransform<WorldViewport>((vs) =>
      DisplaySettingsLogic.getViewportSizeName(vs),
    )
    battlefieldDropdown.onMouseDown = () =>
      this.showBattlefieldCameraDropdown(battlefieldDropdown)
    battlefieldDropdown.getText = () =>
      battlefieldLabel.update(this.graphicSettings.viewportDistance)

    // ---- 绑定文本通知池过滤器设置 ----
    this.bindTextNotificationPoolFilterSettings(panel)

    // ---- 立即应用 VSync ----
    const vsyncCheckbox = panel.get<CheckboxWidget>('VSYNC_CHECKBOX')
    const origVsyncOnClick = vsyncCheckbox.onClick
    vsyncCheckbox.onClick = () => {
      origVsyncOnClick()
      this.renderer.setVSyncEnabled(this.graphicSettings.vSync)
    }

    // ---- UI Scale 下拉菜单 ----
    const uiScaleDropdown = panel.get<DropDownButtonWidget>(
      'UI_SCALE_DROPDOWN',
    )
    const uiScaleLabel = new CachedTransform<number>(
      (s) => `${Math.round(100 * s)}%`,
    )
    uiScaleDropdown.onMouseDown = () =>
      this.showUIScaleDropdown(uiScaleDropdown)
    uiScaleDropdown.getText = () =>
      uiScaleLabel.update(this.graphicSettings.uiScale)

    const minResolution = this.viewportSizes.minEffectiveResolution
    const resolution = this.renderer.resolution
    const disableUIScale =
      resolution.width * this.graphicSettings.uiScale <
        1.25 * minResolution.width ||
      resolution.height * this.graphicSettings.uiScale <
        1.25 * minResolution.height
    uiScaleDropdown.isDisabled = () => disableUIScale

    // ---- 窗口分辨率输入 ----
    panel
      .get('DISPLAY_SELECTION_CONTAINER')
      .isVisible = () =>
      this.graphicSettings.mode !== WindowMode.Windowed
    panel
      .get('WINDOW_RESOLUTION_CONTAINER')
      .isVisible = () =>
      this.graphicSettings.mode === WindowMode.Windowed

    const windowWidth = panel.get<TextFieldWidget>('WINDOW_WIDTH')
    const origWidthText =
      (windowWidth.text =
        this.graphicSettings.windowedSize.width.toString())

    const windowHeight = panel.get<TextFieldWidget>('WINDOW_HEIGHT')
    const origHeightText =
      (windowHeight.text =
        this.graphicSettings.windowedSize.height.toString())

    // ---- 分辨率预设下拉菜单 ----
    const resolutionPresetDropdown =
      panel.getOrNull<DropDownButtonWidget>('RESOLUTION_PRESET_DROPDOWN')
    if (resolutionPresetDropdown) {
      resolutionPresetDropdown.getText = () => {
        const w = parseInt(windowWidth.text, 10)
        const h = parseInt(windowHeight.text, 10)
        if (
          !isNaN(w) &&
          !isNaN(h) &&
          COMMON_RESOLUTIONS.some(
            (r) => r.width === w && r.height === h,
          )
        ) {
          return `${w}x${h}`
        }
        return 'Select Preset'
      }
      resolutionPresetDropdown.onMouseDown = () =>
        this.showResolutionPresetDropdown(
          resolutionPresetDropdown,
          windowWidth,
          windowHeight,
        )
    }

    // ---- 重启提示描述 ----
    const restartDesc = panel.get('VIDEO_RESTART_REQUIRED_DESC')
    restartDesc.isVisible = () =>
      this.graphicSettings.mode !== this.originalGraphicSettings.mode ||
      this.graphicSettings.videoDisplay !==
        this.originalGraphicSettings.videoDisplay ||
      this.graphicSettings.glProfile !==
        this.originalGraphicSettings.glProfile ||
      (this.graphicSettings.mode === WindowMode.Windowed &&
        (origWidthText !== windowWidth.text ||
          origHeightText !== windowHeight.text))

    // ---- 帧率限制交互 ----
    const frameLimitCheckbox = panel.get<CheckboxWidget>(
      'FRAME_LIMIT_CHECKBOX',
    )
    const frameLimitLabel = new CachedTransform<number>(
      (fps) => `Frame Limiter: ${fps} FPS`,
    )
    frameLimitCheckbox.getText = () =>
      frameLimitLabel.update(this.graphicSettings.maxFramerate)
    frameLimitCheckbox.isDisabled = () =>
      this.graphicSettings.capFramerateToGameFps

    panel
      .get<SliderWidget>('FRAME_LIMIT_SLIDER')
      .isDisabled = () =>
      !frameLimitCheckbox.isChecked() ||
      frameLimitCheckbox.isDisabled()

    // ---- 调整滚动面板布局 ----
    SettingsUtils.adjustSettingsScrollPanelLayout(scrollPanel)

    // ---- 离开面板操作 ----
    return () => {
      const w = parseInt(windowWidth.text, 10)
      const h = parseInt(windowHeight.text, 10)
      if (!isNaN(w) && !isNaN(h)) {
        this.graphicSettings.windowedSize = {
          width: w,
          height: h,
        }
      }

      return (
        this.graphicSettings.mode !== this.originalGraphicSettings.mode ||
        this.graphicSettings.videoDisplay !==
          this.originalGraphicSettings.videoDisplay ||
        this.graphicSettings.windowedSize.width !==
          this.originalGraphicSettings.windowedSize.width ||
        this.graphicSettings.windowedSize.height !==
          this.originalGraphicSettings.windowedSize.height ||
        this.graphicSettings.glProfile !==
          this.originalGraphicSettings.glProfile
      )
    }
  }

  // ---------------------------------------------------------------------------
  // ResetPanel — 重置面板到默认值
  // OpenRA 对照: Action ResetPanel(Widget panel)
  // ---------------------------------------------------------------------------

  /**
   * 重置面板到默认值。
   *
   * OpenRA 对照: Action ResetPanel(Widget panel)
   */
  private resetPanel(_panel: Widget): () => void {
    return () => {
      // 重置图形设置
      this.graphicSettings.capFramerate = false
      this.graphicSettings.maxFramerate = 120
      this.graphicSettings.capFramerateToGameFps = false
      this.graphicSettings.glProfile = GLProfile.Automatic
      this.graphicSettings.mode = WindowMode.PseudoFullscreen
      this.graphicSettings.videoDisplay = 0
      this.graphicSettings.windowedSize = {
        width: 1024,
        height: 720,
      }
      this.graphicSettings.cursorDouble = false
      this.graphicSettings.viewportDistance = WorldViewport.Medium
      this.graphicSettings.uiScale = 1.0
      this.gameSettings.textNotificationPoolFilters = 0
    }
  }

  // ---------------------------------------------------------------------------
  // BindTextNotificationPoolFilterSettings
  // OpenRA 对照: BindTextNotificationPoolFilterSettings(Widget, GameSettings)
  // ---------------------------------------------------------------------------

  /**
   * 绑定文本通知池过滤器设置。
   *
   * OpenRA 对照: BindTextNotificationPoolFilterSettings(Widget, GameSettings)
   */
  private bindTextNotificationPoolFilterSettings(panel: Widget): void {
    const feedbackCheckbox = panel.getOrNull<CheckboxWidget>(
      'UI_FEEDBACK_CHECKBOX',
    )
    if (feedbackCheckbox) {
      feedbackCheckbox.isChecked = () =>
        (this.gameSettings.textNotificationPoolFilters &
          TextNotificationPoolFilters.Feedback) !==
        0
      feedbackCheckbox.onClick = () => {
        this.gameSettings.textNotificationPoolFilters ^=
          TextNotificationPoolFilters.Feedback
      }
    }

    const transientsCheckbox = panel.getOrNull<CheckboxWidget>(
      'TRANSIENTS_CHECKBOX',
    )
    if (transientsCheckbox) {
      transientsCheckbox.isChecked = () =>
        (this.gameSettings.textNotificationPoolFilters &
          TextNotificationPoolFilters.Transients) !==
        0
      transientsCheckbox.onClick = () => {
        this.gameSettings.textNotificationPoolFilters ^=
          TextNotificationPoolFilters.Transients
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Show WindowMode Dropdown
  // OpenRA 对照: ShowWindowModeDropdown(...)
  // ---------------------------------------------------------------------------

  private showWindowModeDropdown(
    dropdown: DropDownButtonWidget,
    _scrollPanel: ScrollPanelWidget,
  ): void {
    const options = [
      { label: 'Fullscreen', value: WindowMode.PseudoFullscreen as WindowMode },
      {
        label: 'Legacy Fullscreen',
        value: WindowMode.Fullscreen as WindowMode,
      },
      { label: 'Windowed', value: WindowMode.Windowed as WindowMode },
    ]

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      options,
      (option: (typeof options)[0], template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.graphicSettings.mode === option.value,
          () => {
            this.graphicSettings.mode = option.value
          },
        )
        item.text = option.label
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show Display Selection Dropdown
  // OpenRA 对照: ShowDisplaySelectionDropdown(...)
  // ---------------------------------------------------------------------------

  private showDisplaySelectionDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const options = Array.from(
      { length: this.renderer.displayCount },
      (_, i) => i,
    )

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      options,
      (displayIdx: number, template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.graphicSettings.videoDisplay === displayIdx,
          () => {
            this.graphicSettings.videoDisplay = displayIdx
          },
        )
        item.text = `Display ${displayIdx + 1}`
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show Resolution Preset Dropdown
  // OpenRA 对照: ShowResolutionPresetDropdown(...)
  // ---------------------------------------------------------------------------

  private showResolutionPresetDropdown(
    dropdown: DropDownButtonWidget,
    windowWidth: TextFieldWidget,
    windowHeight: TextFieldWidget,
  ): void {
    const sortedModes = [...COMMON_RESOLUTIONS].sort((a, b) => {
      if (a.width !== b.width) return a.width - b.width
      return a.height - b.height
    })

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      300,
      sortedModes,
      (resolution: Size, template: unknown) => {
        const currentWidth = parseInt(windowWidth.text, 10) || 0
        const currentHeight = parseInt(windowHeight.text, 10) || 0

        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () =>
            currentWidth === resolution.width && currentHeight === resolution.height,
          () => {
            windowWidth.text = resolution.width.toString()
            windowHeight.text = resolution.height.toString()
          },
        )
        item.text = `${resolution.width}x${resolution.height}`
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show GL Profile Dropdown
  // OpenRA 对照: ShowGLProfileDropdown(...)
  // ---------------------------------------------------------------------------

  private showGLProfileDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const profiles: GLProfile[] = [
      GLProfile.Automatic,
      ...this.renderer.supportedGLProfiles,
    ]

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      profiles,
      (profile: GLProfile, template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.graphicSettings.glProfile === profile,
          () => {
            this.graphicSettings.glProfile = profile
          },
        )
        item.text = profile
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show Status Bars Dropdown
  // OpenRA 对照: ShowStatusBarsDropdown(...)
  // ---------------------------------------------------------------------------

  private showStatusBarsDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const options = [
      { label: 'Standard', value: StatusBarsType.Standard as StatusBarsType },
      {
        label: 'Show on Damage',
        value: StatusBarsType.DamageShow as StatusBarsType,
      },
      {
        label: 'Always Show',
        value: StatusBarsType.AlwaysShow as StatusBarsType,
      },
    ]

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      options,
      (option: (typeof options)[0], template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.gameSettings.statusBars === option.value,
          () => {
            this.gameSettings.statusBars = option.value
          },
        )
        item.text = option.label
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show Target Lines Dropdown
  // OpenRA 对照: ShowTargetLinesDropdown(...)
  // ---------------------------------------------------------------------------

  private showTargetLinesDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const options = [
      {
        label: 'Automatic',
        value: TargetLinesType.Automatic as TargetLinesType,
      },
      {
        label: 'Manual',
        value: TargetLinesType.Manual as TargetLinesType,
      },
      {
        label: 'Disabled',
        value: TargetLinesType.Disabled as TargetLinesType,
      },
    ]

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      options,
      (option: (typeof options)[0], template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.gameSettings.targetLines === option.value,
          () => {
            this.gameSettings.targetLines = option.value
          },
        )
        item.text = option.label
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show Battlefield Camera Dropdown
  // OpenRA 对照: ShowBattlefieldCameraDropdown(...)
  // ---------------------------------------------------------------------------

  private showBattlefieldCameraDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const windowHeight = this.renderer.nativeResolution.height

    const validSizes: WorldViewport[] = [WorldViewport.Close]
    if (this.viewportSizes.getSizeRange(WorldViewport.Medium).width < windowHeight)
      validSizes.push(WorldViewport.Medium)
    const farRange = this.viewportSizes.getSizeRange(WorldViewport.Far)
    if (farRange.width < windowHeight) validSizes.push(WorldViewport.Far)
    if (
      this.viewportSizes.allowNativeZoom &&
      farRange.height < windowHeight
    )
      validSizes.push(WorldViewport.Native)

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      validSizes,
      (size: WorldViewport, template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.graphicSettings.viewportDistance === size,
          () => {
            this.graphicSettings.viewportDistance = size
          },
        )
        item.text = DisplaySettingsLogic.getViewportSizeName(size)
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // Show UI Scale Dropdown
  // OpenRA 对照: ShowUIScaleDropdown(...)
  // ---------------------------------------------------------------------------

  private showUIScaleDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    const maxScales = {
      x:
        this.renderer.nativeResolution.width /
        this.viewportSizes.minEffectiveResolution.width,
      y:
        this.renderer.nativeResolution.height /
        this.viewportSizes.minEffectiveResolution.height,
    }
    const maxScale = Math.min(maxScales.x, maxScales.y)

    const allScales = [1.0, 1.25, 1.5, 1.75, 2.0]
    const validScales = allScales.filter((x) => x <= maxScale)

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      500,
      validScales,
      (scale: number, template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.graphicSettings.uiScale === scale,
          () => {
            this.graphicSettings.uiScale = scale
            this.renderer.setUIScale(scale)
          },
        )
        item.text = `${Math.round(100 * scale)}%`
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // ChromeLogic interface
  // ---------------------------------------------------------------------------

  /** Per-frame tick. No-op — widget delegates handle visual updates.
   *
   * OpenRA 对照: ChromeLogic.Tick()
   */
  tick(): void {
    // No per-frame logic needed — widget delegates (isVisible/getText)
    // handle frame-dependent state via closure over settings objects.
  }

  /** Clean up resources.
   *
   * OpenRA 对照: ChromeLogic.Dispose()
   */
  override dispose(): void {
    // Settings state is owned externally; no GPU resources to release.
    super.dispose()
  }
}
