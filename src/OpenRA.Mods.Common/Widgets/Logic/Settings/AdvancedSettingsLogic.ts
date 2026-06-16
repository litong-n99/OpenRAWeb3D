/**
 * AdvancedSettingsLogic.ts — 高级/调试设置面板逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Settings/AdvancedSettingsLogic.cs (91 lines)
 *
 * 核心范式转换:
 * - C# DebugSettings (PerfText, PerfGraph, BotDebug, LuaDebug, ...) → 设置接口
 * - C# GameSettings.FetchNews → 设置接口
 * - C# ServerSettings.DiscoverNatDevices → 设置接口
 * - C# 复选框绑定 via SettingsUtils.BindCheckboxPref → 回调 getter/setter
 * - C# Developer settings visibility toggle → 可见性委托
 */

import { Widget, ChromeLogic } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { SettingsLogic } from './SettingsLogic.js'
import { SettingsUtils } from './SettingsUtils.js'
import { CheckboxWidget } from '../../CheckboxWidget.js'
import { ScrollPanelWidget } from '../../ScrollPanelWidget.js'

// ---------------------------------------------------------------------------
// 设置接口 — OpenRA 对照: DebugSettings / GameSettings / ServerSettings
// ---------------------------------------------------------------------------

/** 调试设置。OpenRA 对照: DebugSettings */
export interface DebugSettings {
  perfText: boolean
  perfGraph: boolean
  botDebug: boolean
  luaDebug: boolean
  enableDebugCommandsInReplays: boolean
  syncCheckUnsyncedCode: boolean
  syncCheckBotModuleCode: boolean
  enableSimulationPerfLogging: boolean
  sendSystemInformation: boolean
  checkVersion: boolean
  displayDeveloperSettings: boolean
}

/** 高级游戏设置。OpenRA 对照: GameSettings (子集) */
export interface AdvancedGameSettings {
  fetchNews: boolean
}

/** 高级服务器设置。OpenRA 对照: ServerSettings */
export interface AdvancedServerSettings {
  discoverNatDevices: boolean
}

// ---------------------------------------------------------------------------
// AdvancedSettingsLogic — 高级/调试设置面板
// OpenRA 对照: public class AdvancedSettingsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 高级/调试设置面板逻辑。
 *
 * 绑定性能文本/图、bot 调试、Lua 调试、同步检查、
 * NAT 发现、版本检查等调试和开发设置。
 *
 * OpenRA 对照: public class AdvancedSettingsLogic : ChromeLogic
 */
/**
 * NOTE: ADR-16.2 — AdvancedSettingsLogic extends ChromeLogic for OpenRA parity.
 */
export class AdvancedSettingsLogic extends ChromeLogic {
  private readonly debugSettings: DebugSettings
  private readonly gameSettings: AdvancedGameSettings
  private readonly serverSettings: AdvancedServerSettings

  /** 原始服务器设置（用于变更检测）。 */
  private readonly originalServerSettings: AdvancedServerSettings

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * 构造高级设置面板。
   *
   * @param settingsLogic — 父设置路由
   * @param panelID — 面板 ID
   * @param label — 面板标签
   * @param debugSettings — 调试设置
   * @param gameSettings — 游戏设置
   * @param serverSettings — 服务器设置
   */
  constructor(
    settingsLogic: SettingsLogic,
    panelID: string,
    label: string,
    debugSettings: DebugSettings,
    gameSettings: AdvancedGameSettings,
    serverSettings: AdvancedServerSettings,
  ) {
    super()

    this.debugSettings = debugSettings
    this.gameSettings = gameSettings
    this.serverSettings = serverSettings
    this.originalServerSettings = { ...serverSettings }

    settingsLogic.registerSettingsPanel(
      panelID,
      label,
      (panel) => this.initPanel(panel),
      (_panel) => this.resetPanel(),
    )
  }

  // ---------------------------------------------------------------------------
  // InitPanel
  // ---------------------------------------------------------------------------

  private initPanel(panel: Widget): () => boolean {
    const scrollPanel =
      panel.get<ScrollPanelWidget>('SETTINGS_SCROLLPANEL')

    // ---- 高级设置复选框 ----
    SettingsUtils.bindCheckboxPref(
      panel,
      'NAT_DISCOVERY',
      () => this.serverSettings.discoverNatDevices,
      (v) => {
        this.serverSettings.discoverNatDevices = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'PERFTEXT_CHECKBOX',
      () => this.debugSettings.perfText,
      (v) => {
        this.debugSettings.perfText = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'PERFGRAPH_CHECKBOX',
      () => this.debugSettings.perfGraph,
      (v) => {
        this.debugSettings.perfGraph = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'FETCH_NEWS_CHECKBOX',
      () => this.gameSettings.fetchNews,
      (v) => {
        this.gameSettings.fetchNews = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'SENDSYSINFO_CHECKBOX',
      () => this.debugSettings.sendSystemInformation,
      (v) => {
        this.debugSettings.sendSystemInformation = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'CHECK_VERSION_CHECKBOX',
      () => this.debugSettings.checkVersion,
      (v) => {
        this.debugSettings.checkVersion = v
      },
    )

    // ---- SendSysInfo 复选框依赖于 FetchNews ----
    const ssi = panel.get<CheckboxWidget>('SENDSYSINFO_CHECKBOX')
    ssi.isDisabled = () => !this.gameSettings.fetchNews

    // ---- 开发者设置 ----
    SettingsUtils.bindCheckboxPref(
      panel,
      'BOTDEBUG_CHECKBOX',
      () => this.debugSettings.botDebug,
      (v) => {
        this.debugSettings.botDebug = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'LUADEBUG_CHECKBOX',
      () => this.debugSettings.luaDebug,
      (v) => {
        this.debugSettings.luaDebug = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'REPLAY_COMMANDS_CHECKBOX',
      () => this.debugSettings.enableDebugCommandsInReplays,
      (v) => {
        this.debugSettings.enableDebugCommandsInReplays = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'CHECKUNSYNCED_CHECKBOX',
      () => this.debugSettings.syncCheckUnsyncedCode,
      (v) => {
        this.debugSettings.syncCheckUnsyncedCode = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'CHECKBOTSYNC_CHECKBOX',
      () => this.debugSettings.syncCheckBotModuleCode,
      (v) => {
        this.debugSettings.syncCheckBotModuleCode = v
      },
    )

    SettingsUtils.bindCheckboxPref(
      panel,
      'PERFLOGGING_CHECKBOX',
      () => this.debugSettings.enableSimulationPerfLogging,
      (v) => {
        this.debugSettings.enableSimulationPerfLogging = v
      },
    )

    // ---- 开发者设置可见性控制 ----
    // OpenRA: 开发者设置容器仅在 DisplayDeveloperSettings 为 true 时可见
    panel
      .get('BOTDEBUG_CHECKBOX_CONTAINER')
      .isVisible = () =>
      this.debugSettings.displayDeveloperSettings
    panel
      .get('CHECKUNSYNCED_CHECKBOX_CONTAINER')
      .isVisible = () =>
      this.debugSettings.displayDeveloperSettings
    panel
      .get('CHECKBOTSYNC_CHECKBOX_CONTAINER')
      .isVisible = () =>
      this.debugSettings.displayDeveloperSettings
    panel
      .get('LUADEBUG_CHECKBOX_CONTAINER')
      .isVisible = () =>
      this.debugSettings.displayDeveloperSettings
    panel
      .get('REPLAY_COMMANDS_CHECKBOX_CONTAINER')
      .isVisible = () =>
      this.debugSettings.displayDeveloperSettings
    panel
      .get('PERFLOGGING_CHECKBOX_CONTAINER')
      .isVisible = () =>
      this.debugSettings.displayDeveloperSettings
    panel
      .get('DEBUG_HIDDEN_CONTAINER')
      .isVisible = () =>
      !this.debugSettings.displayDeveloperSettings

    SettingsUtils.adjustSettingsScrollPanelLayout(scrollPanel)

    return () => {
      return (
        this.serverSettings.discoverNatDevices !==
        this.originalServerSettings.discoverNatDevices
      )
    }
  }

  // ---------------------------------------------------------------------------
  // ResetPanel
  // ---------------------------------------------------------------------------

  private resetPanel(): () => void {
    return () => {
      this.serverSettings.discoverNatDevices = false
      this.debugSettings.perfText = false
      this.debugSettings.perfGraph = false
      this.debugSettings.syncCheckUnsyncedCode = false
      this.debugSettings.syncCheckBotModuleCode = false
      this.debugSettings.botDebug = false
      this.debugSettings.luaDebug = false
      this.debugSettings.sendSystemInformation = false
      this.debugSettings.checkVersion = true
      this.debugSettings.enableDebugCommandsInReplays = false
      this.debugSettings.enableSimulationPerfLogging = false
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
