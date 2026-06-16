/**
 * SettingsLogic.ts — Settings 菜单主路由逻辑 (ISettingsLogic 接口 + 实现)
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Settings/SettingsLogic.cs (197 lines)
 *
 * 核心范式转换:
 * - C# ISettingsLogic 接口 → TypeScript ISettingsLogic 接口
 * - C# ChromeLogic + IncludeChromeLogicArgsFluentReferences → ChromeLogic 子类 + 手动参数
 * - C# Game.LoadWidget + Clone 模板实例化 → 手动子 widget 创建 + 克隆
 * - C# FluentProvider.GetMessage 本地化 → 硬编码标签（Fluent 暂未迁移）
 * - C# ConfirmationDialogs.ButtonPrompt → ConfirmCallbacks 接口（可替换用于测试）
 * - C# Game.Settings.Save() / Game.SwitchToExternalMod → 可替换回调
 * - C# Dictionary<string, Func<bool>> / Dictionary<string, Action> → Map<string, ...>
 */

import { Widget, ContainerWidget, ChromeLogic } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ButtonWidget } from '../../ButtonWidget.js'

// ---------------------------------------------------------------------------
// ISettingsLogic — 设置面板注册接口
// OpenRA 对照: public interface ISettingsLogic
// ---------------------------------------------------------------------------

/** 设置面板注册接口。
 *
 * 每块设置面板在构建时调用 RegisterSettingsPanel 注册自身。
 * SettingsLogic 作为实现者，管理面板切换和生命周期。
 *
 * OpenRA 对照: public interface ISettingsLogic
 */
export interface ISettingsLogic {
  /**
   * 注册设置面板。
   *
   * OpenRA 对照: RegisterSettingsPanel(string panelID, string label,
   *   Func<Widget, Func<bool>> init, Func<Widget, Action> reset)
   *
   * @param panelID — 面板的唯一标识符（对应 YAML widget ID）
   * @param label — 面板的显示标签（标签页按钮文本）
   * @param init — 面板初始化函数，接收面板 widget，返回 leavePanelAction
   *               leavePanelAction: 离开面板时调用，返回 true 表示需要重启
   * @param reset — 面板重置函数，接收面板 widget，返回 resetAction
   *                resetAction: 重置设置到默认值
   */
  registerSettingsPanel(
    panelID: string,
    label: string,
    init: (panel: Widget) => () => boolean,
    reset: (panel: Widget) => () => void,
  ): void
}

// ---------------------------------------------------------------------------
// SettingsSaveCallbacks — 设置保存/重启回调接口
// OpenRA 对照: Game.Settings.Save() / Game.SwitchToExternalMod / ConfirmationDialogs
// ---------------------------------------------------------------------------

/** 设置保存和重启回调接口。
 *
 * 允许测试在不依赖完整 Game/Sound/Renderer 系统的前提下注入回调。
 *
 * OpenRA 对照: Game.Settings.Save(), Game.SwitchToExternalMod(), ConfirmationDialogs.ButtonPrompt()
 */
export interface SettingsSaveCallbacks {
  /** 保存设置到持久化存储。 */
  saveSettings: () => void
  /** 切换到外部 MOD（需要重启）。返回 true 如果支持重启（有 ExternalMod）。 */
  hasExternalMod: () => boolean
  /** 执行外部 MOD 切换。 */
  switchToExternalMod: () => void
  /** 显示确认对话框 — 2 按钮（确认/取消）。 */
  showConfirmDialog: (
    title: string,
    text: string,
    onConfirm: () => void,
    confirmText: string,
    onCancel: () => void,
    cancelText: string,
  ) => void
  /** 显示存储提示对话框 — 无确认按钮。 */
  showSavePrompt: (
    title: string,
    text: string,
    onCancel: () => void,
    cancelText: string,
  ) => void
  /** 关闭设置窗口。 */
  closeWindow: () => void
}

// ---------------------------------------------------------------------------
// SettingsPanelEntry — 面板条目
// ---------------------------------------------------------------------------

/** 内部面板条目。 */
interface SettingsPanelEntry {
  /** 面板 widget（从模板克隆）。 */
  container: ContainerWidget
  /** 离开面板时的操作（返回 true 表示需要重启）。 */
  leaveAction: (() => boolean) | null
  /** 重置面板时的操作。 */
  resetAction: (() => void) | null
  /** 标签页按钮。 */
  tab: ButtonWidget | null
}

// ---------------------------------------------------------------------------
// SettingsLogic — 设置菜单主路由
// OpenRA 对照: public class SettingsLogic : ChromeLogic, ISettingsLogic
// ---------------------------------------------------------------------------

/**
 * 设置菜单主路由逻辑。
 *
 * 管理标签页式的设置面板：
 * - 从 logicArgs["Panels"] 加载面板
 * - 为每个面板创建标签页按钮
 * - 处理面板切换（离开/进入生命周期）
 * - 处理保存、重置和退出确认
 *
 * OpenRA 对照: public class SettingsLogic : ChromeLogic, ISettingsLogic
 */
export class SettingsLogic extends ChromeLogic implements ISettingsLogic {
  // ---- 面板管理 ----

  /** 已注册的面板条目。 */
  private readonly panels: Map<string, SettingsPanelEntry> = new Map()

  /** 标签页按钮列表。 */
  private readonly buttons: ButtonWidget[] = []

  /** 当前活动面板 ID。 */
  private activePanel: string = ''

  /** 面板容器 widget。 */
  private readonly panelContainer: Widget

  /** 标签页容器 widget。 */
  private readonly tabContainer: Widget

  /** 标签页按钮模板（用于克隆）。 */
  private readonly tabTemplate: ButtonWidget

  /** 面板模板（用于克隆）。 */
  private readonly panelTemplate: ContainerWidget

  /** 按钮布局步长（X 和 Y 间距）。 */
  private readonly buttonStride: { x: number; y: number }

  /** 是否需要重启。 */
  private needsRestart: boolean = false

  /** 保存回调。 */
  private readonly saveCallbacks: SettingsSaveCallbacks

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SettingsLogic(Widget, Action, WorldRenderer, Dictionary, ModData)
  // ---------------------------------------------------------------------------

  /**
   * 构建设置路由。
   *
   * OpenRA 对照:
   *   public SettingsLogic(Widget widget, Action onExit, WorldRenderer worldRenderer,
   *     Dictionary<string, MiniYaml> logicArgs, ModData modData)
   *
   * @param widget — 根设置 widget
   * @param onExit — 退出回调（关闭设置窗口时调用）
   * @param logicArgs — YAML/JSON 配置参数
   * @param saveCallbacks — 设置保存/重启回调（可替换用于测试）
   */
  constructor(
    widget: Widget,
    onExit: () => void,
    logicArgs: Record<string, unknown>,
    saveCallbacks: SettingsSaveCallbacks,
  ) {
    super()
    this.saveCallbacks = saveCallbacks

    // 获取面板容器和模板
    this.panelContainer = widget.get('PANEL_CONTAINER')
    this.panelTemplate =
      this.panelContainer.get<ContainerWidget>('PANEL_TEMPLATE')
    this.panelContainer.removeChild(this.panelTemplate)

    // 获取标签页容器和模板
    this.tabContainer = widget.get('SETTINGS_TAB_CONTAINER')
    this.tabTemplate =
      this.tabContainer.get<ButtonWidget>('BUTTON_TEMPLATE')
    this.tabContainer.removeChild(this.tabTemplate)

    // 解析 ButtonStride
    const buttonStrideNode = logicArgs['ButtonStride']
    if (
      buttonStrideNode &&
      typeof buttonStrideNode === 'object' &&
      buttonStrideNode !== null
    ) {
      const bs = buttonStrideNode as Record<string, unknown>
      this.buttonStride = {
        x: (bs['X'] as number) ?? 0,
        y: (bs['Y'] as number) ?? 0,
      }
    } else {
      this.buttonStride = { x: 0, y: 0 }
    }

    // 从 logicArgs["Panels"] 加载面板
    // OpenRA: logicArgs.TryGetValue("Panels", out var settingsPanels)
    const panelsConfig = logicArgs['Panels']
    if (Array.isArray(panelsConfig)) {
      for (const panelEntry of panelsConfig) {
        if (typeof panelEntry === 'object' && panelEntry !== null) {
          const pe = panelEntry as Record<string, unknown>
          for (const [panelId, _panelLabel] of Object.entries(pe)) {
            // 克隆面板模板并添加到容器
            const container = this.panelTemplate.clone()
            container.id = panelId
            this.panelContainer.addChild(container)

            // 存储面板条目
            this.panels.set(panelId, {
              container,
              leaveAction: null,
              resetAction: null,
              tab: null,
            })
          }
        }
      }
    }

    // ---- 返回按钮 ----
    // OpenRA: widget.Get<ButtonWidget>("BACK_BUTTON").OnClick = ...
    const backButton = widget.get<ButtonWidget>('BACK_BUTTON')
    backButton.onClick = () => {
      // 执行离开面板操作
      const panel = this.panels.get(this.activePanel)
      if (panel?.leaveAction) {
        const needsRestartFromLeave = panel.leaveAction()
        if (needsRestartFromLeave) {
          this.needsRestart = true
        }
      }
      saveCallbacks.saveSettings()

      const closeAndExit = () => {
        saveCallbacks.closeWindow()
        onExit()
      }

      if (this.needsRestart) {
        if (saveCallbacks.hasExternalMod()) {
          // 有外部 MOD — 显示重启确认
          saveCallbacks.showConfirmDialog(
            'Restart Required',
            'Some settings require a restart to take effect. Would you like to restart now?',
            () => saveCallbacks.switchToExternalMod(),
            'Restart Now',
            closeAndExit,
            'Cancel',
          )
        } else {
          // 无外部 MOD — 显示保存提示
          saveCallbacks.showSavePrompt(
            'Settings Saved',
            'Some settings require a restart to take effect.',
            closeAndExit,
            'OK',
          )
        }
      } else {
        closeAndExit()
      }
    }

    // ---- 重置按钮 ----
    // OpenRA: widget.Get<ButtonWidget>("RESET_BUTTON").OnClick = ...
    const resetButton = widget.get<ButtonWidget>('RESET_BUTTON')
    resetButton.onClick = () => {
      const panel = this.panels.get(this.activePanel)
      if (!panel?.resetAction) return

      const panelLabel = this.getPanelLabel(this.activePanel)
      saveCallbacks.showConfirmDialog(
        `Reset "${panelLabel}" Settings`,
        `Are you sure you want to reset all "${panelLabel}" settings to their defaults?`,
        () => {
          panel.resetAction!()
          saveCallbacks.saveSettings()
        },
        'Reset',
        () => {
          /* cancelled — no-op */
        },
        'Cancel',
      )
    }
  }

  // ---------------------------------------------------------------------------
  // ISettingsLogic Implementation
  // OpenRA 对照: RegisterSettingsPanel(string, string, Func<Widget, Func<bool>>, Func<Widget, Action>)
  // ---------------------------------------------------------------------------

  /**
   * 注册设置面板。
   *
   * 创建标签页按钮，设置面板可见性委托，存储初始化和重置函数。
   *
   * OpenRA 对照: RegisterSettingsPanel(...)
   */
  registerSettingsPanel(
    panelID: string,
    label: string,
    init: (panel: Widget) => () => boolean,
    reset: (panel: Widget) => () => void,
  ): void {
    const entry = this.panels.get(panelID)
    if (!entry) return

    const panel = entry.container

    // 设置默认活动面板
    if (!this.activePanel) {
      this.activePanel = panelID
    }

    // 面板可见性委托
    // OpenRA: panel.IsVisible = () => activePanel == panelID
    panel.isVisible = () => this.activePanel === panelID

    // 存储初始化和重置函数
    entry.leaveAction = init(panel)
    entry.resetAction = reset(panel)

    // 创建标签页按钮
    const tab = this.tabTemplate.clone()
    const lastButton = this.buttons.length > 0
      ? this.buttons[this.buttons.length - 1]
      : null

    if (lastButton) {
      tab.bounds = {
        x: lastButton.bounds.x + this.buttonStride.x,
        y: lastButton.bounds.y + this.buttonStride.y,
        width: tab.bounds.width,
        height: tab.bounds.height,
      }
    }

    tab.id = panelID
    tab.getText = () => label
    tab.isHighlighted = () => this.activePanel === panelID
    tab.onClick = () => {
      // 先执行离开面板操作
      const currentPanel = this.panels.get(this.activePanel)
      if (currentPanel?.leaveAction) {
        const needsRestartFromLeave = currentPanel.leaveAction()
        if (needsRestartFromLeave) {
          this.needsRestart = true
        }
      }
      this.saveCallbacks.saveSettings()
      this.activePanel = panelID
    }

    this.tabContainer.addChild(tab)
    entry.tab = tab
    this.buttons.push(tab)
  }

  // ---------------------------------------------------------------------------
  // Per-frame tick
  // ---------------------------------------------------------------------------

  /** 每帧更新。OpenRA 对照: ChromeLogic.Tick() */
  override tick(): void {
    // 无每帧更新逻辑 — 设置菜单是事件驱动的
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** 获取面板的显示标签。 */
  private getPanelLabel(panelID: string): string {
    const entry = this.panels.get(panelID)
    if (entry?.tab) {
      return entry.tab.getText()
    }
    return panelID
  }
}
