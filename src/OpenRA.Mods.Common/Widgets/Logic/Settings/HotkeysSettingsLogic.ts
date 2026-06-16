/**
 * HotkeysSettingsLogic.ts — 热键绑定设置面板逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Settings/HotkeysSettingsLogic.cs (379 lines)
 *
 * 核心范式转换:
 * - C# HotkeyDefinition (Name, Default, Description, Types, Contexts, Readonly)
 *   → TypeScript HotkeyDef 接口
 * - C# HotkeyManager (Definitions, [name], GetFirstDuplicate, Save)
 *   → HotkeysManager 接口（可替换用于测试）
 * - C# WidgetUtils.TruncateButtonToTooltip → 直接设置 button.text
 * - C# ButtonWidget.Clone() 模板克隆 → ButtonWidget.clone()
 * - C# CachedTransform<HotkeyDefinition, string> → 闭包缓存
 * - C# ChromeMetrics.Get<Color> → 硬编码颜色字符串
 * - C# FluentProvider.GetMessage → 硬编码字符串
 * - C# HashSet<HotkeyDefinition> 去重 → Set<HotkeyDef>
 * - C# IEnumerable<string>.Overlaps → Set intersection 检查
 */

import { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ChromeLogic } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { SettingsLogic } from './SettingsLogic.js'
import { ButtonWidget } from '../../ButtonWidget.js'
import { ScrollPanelWidget } from '../../ScrollPanelWidget.js'
import { ScrollItemWidget } from '../../ScrollItemWidget.js'
import { TextFieldWidget } from '../../TextFieldWidget.js'
import { DropDownButtonWidget } from '../../DropDownButtonWidget.js'
import { HotkeyEntryWidget } from '../../HotkeyEntryWidget.js'
import { Hotkey } from '../../../../OpenRA.Game/Input/HotkeyReference.js'

// ---------------------------------------------------------------------------
// HotkeyDef — 热键定义接口
// OpenRA 对照: HotkeyDefinition class
// ---------------------------------------------------------------------------

/** 热键定义。
 *
 * OpenRA 对照: public sealed class HotkeyDefinition
 */
export interface HotkeyDef {
  /** 热键名称（唯一标识符）。 */
  name: string
  /** 默认热键值。 */
  default: Hotkey
  /** 描述文本（Fluent 键名，暂未本地化）。 */
  description: string
  /** 热键类型标签集（用于分组）。 */
  types: Set<string>
  /** 上下文标签集（用于筛选）。 */
  contexts: Set<string>
  /** 是否为只读（不可重新绑定）。 */
  readonly: boolean
  /** 是否有重复冲突。 */
  hasDuplicates: boolean
}

// ---------------------------------------------------------------------------
// HotkeysManager — 热键管理器接口
// OpenRA 对照: HotkeyManager
// ---------------------------------------------------------------------------

/** 热键管理器接口。
 *
 * 提供热键定义查询、值存取、冲突检测和持久化功能。
 *
 * OpenRA 对照: HotkeyManager (modData.Hotkeys)
 */
export interface HotkeysManager {
  /** 所有热键定义。 */
  definitions: HotkeyDef[]
  /** 获取命名热键的当前值。 */
  get(name: string): Hotkey
  /** 设置命名热键的值。 */
  set(name: string, value: Hotkey): void
  /** 保存热键配置。 */
  save(): void
  /** 查找与给定热键和上下文的第一个冲突定义。 */
  getFirstDuplicate(hd: HotkeyDef, key: Hotkey): HotkeyDef | null
}

// ---------------------------------------------------------------------------
// CachedTransform — 缓存值转换
// ---------------------------------------------------------------------------

/** 缓存值转换器。 */
class CachedTransform<T> {
  private lastInput: T | undefined
  private lastOutput: string = ''
  private transform: (input: T) => string

  constructor(transform: (input: T) => string) {
    this.transform = transform
  }

  update(input: T): string {
    if (
      this.lastInput === undefined ||
      this.lastInput !== input
    ) {
      this.lastInput = input
      this.lastOutput = this.transform(input)
    }
    return this.lastOutput
  }
}

// ---------------------------------------------------------------------------
// HotkeysSettingsLogic — 热键设置面板
// OpenRA 对照: public class HotkeysSettingsLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 热键绑定设置面板逻辑。
 *
 * 列出所有可配置热键（按类别分组），允许重新绑定。
 * 支持冲突检测、上下文筛选、文本搜索过滤。
 *
 * OpenRA 对照: public class HotkeysSettingsLogic : ChromeLogic
 */
export class HotkeysSettingsLogic extends ChromeLogic {
  // ---- 依赖 ----
  private readonly hotkeysManager: HotkeysManager
  private readonly logicArgs: Record<string, unknown>

  // ---- 状态变量 ----
  private hotkeyList: ScrollPanelWidget | null = null
  private selectedHotkeyButton: ButtonWidget | null = null
  private hotkeyEntryWidget: HotkeyEntryWidget | null = null
  private duplicateHotkeyDefinition: HotkeyDef | null = null
  private selectedHotkeyDefinition: HotkeyDef | null = null
  private validHotkeyEntryWidth: number = 0
  private invalidHotkeyEntryWidth: number = 0
  private isHotkeyValid: boolean = true
  private isHotkeyDefault: boolean = true

  /** 当前上下文筛选器。 */
  private currentContext: string = 'hotkey-context-any'

  /** 所有上下文。 */
  private readonly contexts: Set<string> = new Set(['hotkey-context-any'])

  /** 热键分组 (groupName → typeSet)。 */
  private readonly hotkeyGroups: Map<string, Set<string>> = new Map()

  /** 文本筛选输入。 */
  private filterInput: TextFieldWidget | null = null

  /** 头部模板。 */
  private headerTemplate: Widget | null = null

  /** 条目模板。 */
  private template: Widget | null = null

  /** 空列表消息 widget。 */
  private emptyListMessage: Widget | null = null

  /** 重新映射对话框 widget。 */
  private remapDialog: Widget | null = null

  // ---- 常量 ----
  private readonly hotkeyValidColor = '#FFFFFF'
  private readonly hotkeyInvalidColor = '#FF4444'

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: HotkeysSettingsLogic(ModData, SettingsLogic, string, string, Dict)
  // ---------------------------------------------------------------------------

  /**
   * 构造热键设置面板。
   *
   * @param settingsLogic — 父设置路由
   * @param panelID — 面板 ID
   * @param label — 面板标签
   * @param hotkeysManager — 热键管理器
   * @param logicArgs — 配置参数（包含 HotkeyGroups）
   */
  constructor(
    settingsLogic: SettingsLogic,
    panelID: string,
    label: string,
    hotkeysManager: HotkeysManager,
    logicArgs: Record<string, unknown>,
  ) {
    super()
    this.hotkeysManager = hotkeysManager
    this.logicArgs = logicArgs

    // 收集所有上下文
    for (const hd of hotkeysManager.definitions) {
      for (const ctx of hd.contexts) {
        this.contexts.add(ctx)
      }
    }

    settingsLogic.registerSettingsPanel(
      panelID,
      label,
      (panel) => this.initPanel(panel),
      (_panel) => this.resetPanel(),
    )
  }

  // ---------------------------------------------------------------------------
  // InitPanel
  // OpenRA 对照: Func<bool> InitPanel(Widget panel)
  // ---------------------------------------------------------------------------

  private initPanel(panel: Widget): () => boolean {
    this.hotkeyList = panel.get<ScrollPanelWidget>('HOTKEY_LIST')
    // NOTE: OpenRA sets hotkeyList.Layout = new GridLayout(hotkeyList)
    // In our DOM-based system, layout is implicit in the CSS.

    this.headerTemplate = this.hotkeyList.get('HEADER')
    this.template = this.hotkeyList.get('TEMPLATE')
    this.emptyListMessage = panel.get('HOTKEY_EMPTY_LIST')
    this.remapDialog = panel.get('HOTKEY_REMAP_DIALOG')

    // 设置文本筛选输入
    this.filterInput = panel.get<TextFieldWidget>('FILTER_INPUT')
    this.filterInput.onTextEdited = () => this.initHotkeyList()
    this.filterInput.onEscapeKey = () => {
      if (
        !this.filterInput ||
        this.filterInput.text.length === 0
      ) {
        this.filterInput?.yieldKeyboardFocus()
      } else {
        this.filterInput!.text = ''
        this.filterInput.onTextEdited?.()
      }
      return true
    }

    // 上下文筛选下拉菜单
    const contextDropdown =
      panel.getOrNull<DropDownButtonWidget>('CONTEXT_DROPDOWN')
    if (contextDropdown) {
      contextDropdown.onMouseDown = () =>
        this.showContextDropdown(contextDropdown)
      const contextName = new CachedTransform<string>(
        (ctx) => this.getContextDisplayName(ctx),
      )
      contextDropdown.getText = () =>
        contextName.update(this.currentContext)
    }

    // 解析热键分组
    const hotkeyGroupsYaml = this.logicArgs['HotkeyGroups']
    if (hotkeyGroupsYaml && typeof hotkeyGroupsYaml === 'object') {
      const groups = hotkeyGroupsYaml as Record<string, unknown>
      for (const [groupKey, groupValue] of Object.entries(groups)) {
        if (groupValue && typeof groupValue === 'object') {
          const gv = groupValue as Record<string, unknown>
          const typesNode = gv['Types']
          if (typeof typesNode === 'string') {
            // Types 是一个逗号分隔的字符串
            this.hotkeyGroups.set(
              groupKey,
              new Set(typesNode.split(',').map((t) => t.trim())),
            )
          }
        }
      }
    }

    // 初始化热键重新映射对话框
    this.initHotkeyRemapDialog(panel)

    // 初始化热键列表
    this.initHotkeyList()

    // 离开面板操作
    return () => {
      // 保存当前正在编辑的热键
      if (
        this.selectedHotkeyDefinition &&
        this.hotkeyEntryWidget
      ) {
        this.hotkeyEntryWidget.key =
          this.hotkeysManager.get(
            this.selectedHotkeyDefinition.name,
          )
      }
      this.hotkeyEntryWidget?.forceYieldKeyboardFocus()
      return false // 热键更改不需要重启
    }
  }

  // ---------------------------------------------------------------------------
  // ResetPanel
  // OpenRA 对照: Action ResetPanel(Widget panel)
  // ---------------------------------------------------------------------------

  private resetPanel(): () => void {
    return () => {
      for (const hd of this.hotkeysManager.definitions) {
        this.hotkeysManager.set(hd.name, hd.default)
      }
      // 刷新列表
      this.initHotkeyList()
    }
  }

  // ---------------------------------------------------------------------------
  // InitHotkeyList — 重建热键列表
  // OpenRA 对照: InitHotkeyList()
  // ---------------------------------------------------------------------------

  private initHotkeyList(): void {
    if (!this.hotkeyList || !this.template || !this.headerTemplate) return

    this.hotkeyList.removeChildren()
    this.selectedHotkeyDefinition = null

    for (const [groupName, typesInGroup] of this.hotkeyGroups) {
      const keysInGroup = this.hotkeysManager.definitions.filter(
        (hd) =>
          this.isHotkeyVisibleInFilter(hd) &&
          this.setOverlaps(hd.types, typesInGroup),
      )

      if (keysInGroup.length === 0) continue

      // 添加组标题
      const header = this.headerTemplate.clone()
      header.id = `header-${groupName}`
      // NOTE: OpenRA uses header.Get<LabelWidget>("LABEL").GetText = () => groupName
      // In DOM system, labels are set via child widget text properties.
      this.hotkeyList.addChild(header)

      // 去重并按类型顺序添加
      const added = new Set<string>()
      for (const type of typesInGroup) {
        for (const hd of keysInGroup.filter((k) => k.types.has(type))) {
          if (!added.has(hd.name)) {
            added.add(hd.name)

            if (!this.selectedHotkeyDefinition) {
              this.selectedHotkeyDefinition = hd
            }

            this.bindHotkeyPref(hd, this.template)
          }
        }
      }
    }

    // 空列表消息
    if (this.emptyListMessage) {
      this.emptyListMessage.visible =
        this.selectedHotkeyDefinition === null
    }
    if (this.remapDialog) {
      this.remapDialog.visible =
        this.selectedHotkeyDefinition !== null
    }

    this.hotkeyList.scrollToTop()
  }

  // ---------------------------------------------------------------------------
  // BindHotkeyPref — 绑定热键条目到列表
  // OpenRA 对照: BindHotkeyPref(HotkeyDefinition hd, Widget template)
  // ---------------------------------------------------------------------------

  private bindHotkeyPref(hd: HotkeyDef, template: Widget): void {
    if (!this.hotkeyList) return

    const key = template.clone()
    key.id = hd.name
    key.visible = true
    key.isVisible = () => true

    // 设置功能描述标签
    // NOTE: OpenRA uses key.Get<LabelWidget>("FUNCTION").GetText = () => desc
    // In DOM system, child label widget would be accessed similarly.

    const remapButton = key.get<ButtonWidget>('HOTKEY')
    this.truncateButtonToTooltip(
      remapButton,
      this.hotkeysManager.get(hd.name).displayString(),
    )

    remapButton.isHighlighted = () =>
      this.selectedHotkeyDefinition === hd

    remapButton.getColor = () =>
      hd.hasDuplicates
        ? this.hotkeyInvalidColor
        : this.hotkeyValidColor

    // 如果当前选中的是此热键，设置初始状态
    if (this.selectedHotkeyDefinition === hd) {
      this.selectedHotkeyButton = remapButton
      if (this.hotkeyEntryWidget) {
        this.hotkeyEntryWidget.key =
          this.hotkeysManager.get(hd.name)
      }
      this.validateHotkey()
    }

    remapButton.onClick = () => {
      this.selectedHotkeyDefinition = hd
      this.selectedHotkeyButton = remapButton
      if (this.hotkeyEntryWidget) {
        this.hotkeyEntryWidget.key =
          this.hotkeysManager.get(hd.name)
      }
      this.validateHotkey()

      if (hd.readonly) {
        this.hotkeyEntryWidget?.yieldKeyboardFocus()
      } else {
        this.hotkeyEntryWidget?.takeKeyboardFocus()
      }
    }

    this.hotkeyList.addChild(key)
  }

  // ---------------------------------------------------------------------------
  // InitHotkeyRemapDialog — 初始化重新映射对话框
  // OpenRA 对照: InitHotkeyRemapDialog(Widget panel)
  // ---------------------------------------------------------------------------

  private initHotkeyRemapDialog(panel: Widget): void {
    // 热键标签
    const label = panel.get('HOTKEY_LABEL')
    label.isVisible = () => this.selectedHotkeyDefinition !== null
    // NOTE: In OpenRA, label.GetText = () => labelText.Update(selectedHotkeyDefinition)
    // Our DOM-based rendering uses child label widget text properties instead.

    // 重复通知
    const duplicateNotice = panel.get('DUPLICATE_NOTICE')
    duplicateNotice.isVisible = () => !this.isHotkeyValid

    // 原始热键通知
    const originalNotice = panel.get('ORIGINAL_NOTICE')
    originalNotice.isVisible = () =>
      this.isHotkeyValid && !this.isHotkeyDefault

    // 只读通知
    const readonlyNotice = panel.get('READONLY_NOTICE')
    readonlyNotice.isVisible = () =>
      this.selectedHotkeyDefinition?.readonly === true

    // 重置按钮
    const resetButton = panel.get<ButtonWidget>('RESET_HOTKEY_BUTTON')
    resetButton.isDisabled = () =>
      this.isHotkeyDefault ||
      this.selectedHotkeyDefinition?.readonly === true
    resetButton.onClick = () => this.resetHotkey()

    // 清除按钮
    const clearButton = panel.get<ButtonWidget>('CLEAR_HOTKEY_BUTTON')
    clearButton.isDisabled = () =>
      this.selectedHotkeyDefinition?.readonly === true ||
      !this.hotkeyEntryWidget?.key.isValid()
    clearButton.onClick = () => this.clearHotkey()

    // 覆盖按钮
    const overrideButton =
      panel.get<ButtonWidget>('OVERRIDE_HOTKEY_BUTTON')
    overrideButton.isDisabled = () => this.isHotkeyValid
    overrideButton.isVisible = () =>
      !this.isHotkeyValid &&
      !(this.duplicateHotkeyDefinition?.readonly === true)
    overrideButton.onClick = () => this.overrideHotkey()

    // 热键输入 widget
    this.hotkeyEntryWidget =
      panel.get<HotkeyEntryWidget>('HOTKEY_ENTRY')
    this.hotkeyEntryWidget.isValid = () => this.isHotkeyValid
    this.hotkeyEntryWidget.onLoseFocus = () => this.validateHotkey()
    this.hotkeyEntryWidget.onEscKey = () => {
      if (this.selectedHotkeyDefinition?.name) {
        this.hotkeyEntryWidget!.key =
          this.hotkeysManager.get(
            this.selectedHotkeyDefinition.name,
          )
      }
    }
    this.hotkeyEntryWidget.isDisabled = () =>
      this.selectedHotkeyDefinition?.readonly === true

    this.validHotkeyEntryWidth =
      this.hotkeyEntryWidget.bounds.width
    this.invalidHotkeyEntryWidth =
      this.validHotkeyEntryWidth -
      (clearButton.bounds.x - overrideButton.bounds.x)
  }

  // ---------------------------------------------------------------------------
  // ValidateHotkey — 验证当前热键
  // OpenRA 对照: ValidateHotkey()
  // ---------------------------------------------------------------------------

  private validateHotkey(): void {
    if (
      !this.selectedHotkeyDefinition ||
      !this.hotkeyEntryWidget
    )
      return

    this.duplicateHotkeyDefinition =
      this.hotkeysManager.getFirstDuplicate(
        this.selectedHotkeyDefinition,
        this.hotkeyEntryWidget.key,
      )
    this.isHotkeyValid =
      this.duplicateHotkeyDefinition === null ||
      this.selectedHotkeyDefinition.readonly
    this.isHotkeyDefault =
      this.hotkeyEntryWidget.key.equals(
        this.selectedHotkeyDefinition.default,
      ) ||
      (!this.hotkeyEntryWidget.key.isValid() &&
        !this.selectedHotkeyDefinition.default.isValid())

    if (this.isHotkeyValid) {
      this.hotkeyEntryWidget.bounds.width =
        this.validHotkeyEntryWidth
      this.saveHotkey()
    } else {
      this.hotkeyEntryWidget.bounds.width =
        this.duplicateHotkeyDefinition?.readonly === true
          ? this.validHotkeyEntryWidth
          : this.invalidHotkeyEntryWidth
      this.hotkeyEntryWidget.takeKeyboardFocus()
    }
  }

  // ---------------------------------------------------------------------------
  // SaveHotkey — 保存当前热键绑定
  // OpenRA 对照: SaveHotkey()
  // ---------------------------------------------------------------------------

  private saveHotkey(): void {
    if (!this.selectedHotkeyDefinition) return
    if (this.selectedHotkeyDefinition.readonly) return

    if (this.selectedHotkeyButton && this.hotkeyEntryWidget) {
      this.truncateButtonToTooltip(
        this.selectedHotkeyButton,
        this.hotkeyEntryWidget.key.displayString(),
      )
    }
    this.hotkeysManager.set(
      this.selectedHotkeyDefinition.name,
      this.hotkeyEntryWidget!.key,
    )
    this.hotkeysManager.save()
  }

  // ---------------------------------------------------------------------------
  // ResetHotkey — 重置当前热键到默认值
  // OpenRA 对照: ResetHotkey()
  // ---------------------------------------------------------------------------

  private resetHotkey(): void {
    if (!this.selectedHotkeyDefinition || !this.hotkeyEntryWidget)
      return

    this.hotkeyEntryWidget.key =
      this.selectedHotkeyDefinition.default
    this.hotkeyEntryWidget.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // ClearHotkey — 清除当前热键
  // OpenRA 对照: ClearHotkey()
  // ---------------------------------------------------------------------------

  private clearHotkey(): void {
    if (!this.hotkeyEntryWidget) return

    this.hotkeyEntryWidget.key = Hotkey.Invalid
    this.hotkeyEntryWidget.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // OverrideHotkey — 覆盖冲突热键
  // OpenRA 对照: OverrideHotkey()
  // ---------------------------------------------------------------------------

  private overrideHotkey(): void {
    if (
      !this.duplicateHotkeyDefinition ||
      !this.hotkeyList ||
      !this.hotkeyEntryWidget
    )
      return

    this.hotkeysManager.set(
      this.duplicateHotkeyDefinition.name,
      Hotkey.Invalid,
    )
    this.hotkeysManager.save()
    this.hotkeyEntryWidget.yieldKeyboardFocus()
  }

  // ---------------------------------------------------------------------------
  // Filter helper
  // ---------------------------------------------------------------------------

  private isHotkeyVisibleInFilter(hd: HotkeyDef): boolean {
    if (!this.filterInput) return true

    const filter = this.filterInput.text.trim().toLowerCase()
    const isFilteredByName =
      filter.length === 0 ||
      hd.description.toLowerCase().includes(filter)
    const isFilteredByContext =
      this.currentContext === 'hotkey-context-any' ||
      hd.contexts.has(this.currentContext)

    return isFilteredByName && isFilteredByContext
  }

  // ---------------------------------------------------------------------------
  // ShowContextDropdown
  // OpenRA 对照: ShowContextDropdown(DropDownButtonWidget)
  // ---------------------------------------------------------------------------

  private showContextDropdown(
    dropdown: DropDownButtonWidget,
  ): void {
    this.hotkeyEntryWidget?.yieldKeyboardFocus()

    const contextName = new CachedTransform<string>(
      (ctx) => this.getContextDisplayName(ctx),
    )

    dropdown.showDropDown(
      'LABEL_DROPDOWN_TEMPLATE',
      280,
      [...this.contexts],
      (context: string, template: unknown) => {
        const item = ScrollItemWidget.setup(
          template as ScrollItemWidget,
          () => this.currentContext === context,
          () => {
            this.currentContext = context
            this.initHotkeyList()
          },
        )
        item.text = contextName.update(context)
        return item
      },
    )
  }

  // ---------------------------------------------------------------------------
  // getContextDisplayName — 获取上下文的显示名称
  // OpenRA 对照: GetContextDisplayName(string)
  // ---------------------------------------------------------------------------

  private getContextDisplayName(context: string): string {
    // NOTE: OpenRA uses FluentProvider.GetMessage(context)
    // Since Fluent is not migrated, we strip the prefix for display.
    const anyContext = 'hotkey-context-any'
    if (!context || context === anyContext) {
      return 'Any'
    }
    // Strip "hotkey-context-" prefix
    const prefix = 'hotkey-context-'
    if (context.startsWith(prefix)) {
      return context.substring(prefix.length)
    }
    return context
  }

  // ---------------------------------------------------------------------------
  // Set overlap helper — 检查两个集合是否有交集
  // OpenRA 对照: hd.Types.Overlaps(typesInGroup)
  // ---------------------------------------------------------------------------

  private setOverlaps(a: Set<string>, b: Set<string>): boolean {
    for (const item of a) {
      if (b.has(item)) return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // TruncateButtonToTooltip — 截断按钮文本到工具提示
  // OpenRA 对照: WidgetUtils.TruncateButtonToTooltip(ButtonWidget, string)
  // ---------------------------------------------------------------------------

  private truncateButtonToTooltip(
    button: ButtonWidget,
    text: string,
  ): void {
    button.text = text
    button.getText = () => button.text
    // NOTE: OpenRA also sets tooltip if text is truncated.
    // In DOM-based rendering, CSS text-overflow handles truncation.
  }

  // ---------------------------------------------------------------------------
  // Per-frame tick
  // ---------------------------------------------------------------------------

  override tick(): void {
    // 无每帧更新逻辑
  }
}
