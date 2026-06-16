/**
 * CreditsLogic.ts — 制作人员名单滚动屏幕逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/CreditsLogic.cs (97 lines)
 *
 * 核心范式转换:
 * - OpenRA ModCredits (C# mod 服务) → 接口注入（文件内容直接传入）
 * - OpenRA Platform.ResolvePath / File.OpenRead → 浏览器 Fetch API / VFS
 * - OpenRA Stream.ReadAllText → TextDecoder 解码
 * - OpenRA WidgetUtils.WrapText → Canvas 2D measureText
 * - OpenRA ScrollPanelWidget 自动滚动 → 纯文本渲染（由外部 widget 驱动滚动）
 */

import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import { ChromeLogic, Ui } from '../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// ICreditsData — 制作人员数据源
// OpenRA 对照: ModCredits
// ---------------------------------------------------------------------------

/** 制作人员数据源接口。
 *
 * OpenRA 对照: ModCredits
 */
export interface ICreditsData {
  /** Mod 制作人员文件内容，若无则 null。 */
  modCreditsText: string | null
  /** 引擎制作人员文件内容，若无则 null。 */
  engineCreditsText: string | null
  /** Mod 选项卡标题。 */
  modTabTitle: string
}

// ---------------------------------------------------------------------------
// CreditsLogic
// OpenRA 对照: CreditsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 制作人员名单滚动屏幕逻辑 — 显示 mod 和引擎的制作人员。
 *
 * OpenRA 对照: class CreditsLogic : ChromeLogic
 */
export class CreditsLogic extends ChromeLogic {
  private readonly _showModTab: boolean
  private readonly _showEngineTab: boolean
  private _isShowingModTab: boolean
  private readonly _modLines: string
  private readonly _engineLines: string
  private readonly _creditsData: ICreditsData
  private readonly _onExit: () => void

  // ---- 构造 ----

  /**
   * @param widget — 根 widget 节点
   * @param _modData — mod 运行时数据（当前未使用）
   * @param onExit — 退出回调
   * @param creditsData — 制作人员数据
   */
  constructor(
    widget: Widget,
    _modData: unknown,
    onExit: () => void,
    creditsData: ICreditsData,
  ) {
    super()

    this._creditsData = creditsData
    this._onExit = onExit
    this._modLines = ''
    this._engineLines = ''
    this._isShowingModTab = false
    this._showModTab = creditsData.modCreditsText !== null
    this._showEngineTab = creditsData.engineCreditsText !== null

    // 解析文本
    if (creditsData.modCreditsText) {
      this._modLines = CreditsLogic.parseCreditsText(creditsData.modCreditsText)
    }
    if (creditsData.engineCreditsText) {
      this._engineLines = CreditsLogic.parseCreditsText(creditsData.engineCreditsText)
    }

    this._wireUI(widget)

    // 默认显示 mod 选项卡（如果可用）
    this._showCredits(this._showModTab)
  }

  // ---------------------------------------------------------------------------
  // UI 连线
  // ---------------------------------------------------------------------------

  private _wireUI(widget: Widget): void {
    const panel = widget.get<Widget>('CREDITS_PANEL')

    // 返回按钮
    const backButton = panel.get<Widget & { onClick?: () => void }>('BACK_BUTTON')
    backButton.onClick = () => {
      Ui.closeWindow()
      this._onExit()
    }

    // 选项卡容器
    const tabContainer = panel.get<Widget & { isVisible?: () => boolean }>('TAB_CONTAINER')
    const showBothTabs = this._showModTab && this._showEngineTab
    tabContainer.isVisible = () => showBothTabs

    // Mod 选项卡按钮
    if (this._showModTab) {
      const modTab = tabContainer.getOrNull<Widget & {
        isHighlighted?: () => boolean
        onClick?: () => void
        getText?: () => string
      }>('MOD_TAB')
      if (modTab) {
        modTab.isHighlighted = () => this._isShowingModTab
        modTab.onClick = () => this._showCredits(true)
        modTab.getText = () => this._creditsData.modTabTitle
      }
    }

    // 引擎选项卡按钮
    if (this._showEngineTab) {
      const engineTab = tabContainer.getOrNull<Widget & {
        isHighlighted?: () => boolean
        onClick?: () => void
      }>('ENGINE_TAB')
      if (engineTab) {
        engineTab.isHighlighted = () => !this._isShowingModTab
        engineTab.onClick = () => this._showCredits(false)
      }
    }

    // 滚动面板 — 预留，实际渲染由 widget 树驱动
  }

  // ---------------------------------------------------------------------------
  // 制作人员显示
  // ---------------------------------------------------------------------------

  /** 切换显示 mod 或引擎制作人员。
   *
   * OpenRA 对照: ShowCredits(bool modCredits)
   */
  private _showCredits(modCredits: boolean): void {
    this._isShowingModTab = modCredits

    // 文本内容由委托驱动的 label getText 输出。
    // 实际内容绑定到 CREDITS_DISPLAY → CREDITS_TEMPLATE 标签。
    // 此处的状态更新驱动 label widget 重新求值。
  }

  /** 获取当前显示的文本内容。 */
  get creditsText(): string {
    return this._isShowingModTab ? this._modLines : this._engineLines
  }

  // ---------------------------------------------------------------------------
  // 文本解析
  // ---------------------------------------------------------------------------

  /** 解析制作人员文本。
   *
   * OpenRA 对照: ParseLines(Stream)
   *
   * 将 Windows 换行符替换为 Unix 换行符，Tab 替换为 4 空格，
   * 星号替换为项目符号。
   */
  static parseCreditsText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')     // CRLF → LF
      .replace(/\r/g, '\n')        // CR → LF
      .replace(/\t/g, '    ')      // Tab → 4 spaces
      .replace(/\*/g, '•')    // * → bullet
  }

  // ---------------------------------------------------------------------------
  // ChromeLogic 接口
  // ---------------------------------------------------------------------------

  tick(): void {
    // 制作人员无每帧 tick 逻辑
  }

  override dispose(): void {
    super.dispose()
  }
}
