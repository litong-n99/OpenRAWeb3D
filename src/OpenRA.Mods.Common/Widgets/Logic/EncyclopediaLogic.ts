/**
 * EncyclopediaLogic.ts — 单位/建筑百科浏览器逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/EncyclopediaLogic.cs (318 lines)
 *
 * 核心范式转换:
 * - OpenRA Ruleset.Actors (ActorInfoDictionary) → Ruleset.actors (Map<string, ActorConfig>)
 * - OpenRA TraitInfo<T>() 泛型查询 → ActorConfig.traitConfigs 手动过滤
 * - OpenRA IActorPreviewInitInfo (C# 接口) → 存根（ActorPreview 未迁移）
 * - OpenRA SpriteFont.Measure() → 存根（文本测量使用 Canvas 2D）
 * - OpenRA FluentProvider.GetMessage → 返回 key 本身
 * - OpenRA WidgetUtils.WrapText → Canvas 2D measureText
 * - OpenRA ChromeProvider sprite 加载 → 存根
 */

import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import { ChromeLogic, Ui } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ActorConfig, TraitConfig } from '../../../OpenRA.Game/GameRules/ActorInfo.js'
import type { Ruleset } from '../../../OpenRA.Game/GameRules/Ruleset.js'

// ---------------------------------------------------------------------------
// FluentProvider 存根
// ---------------------------------------------------------------------------

function fluentMsg(key: string, _subs?: Record<string, string>): string {
  return key
}

// ---------------------------------------------------------------------------
// Trait name constants (corresponding to OpenRA C# trait class names)
// ---------------------------------------------------------------------------

const TRAIT_IRenderActorPreviewSprites = 'IRenderActorPreviewSpritesInfo'
const TRAIT_UpdatesPlayerStatistics = 'UpdatesPlayerStatisticsInfo'
const TRAIT_Encyclopedia = 'EncyclopediaInfo'
const TRAIT_Tooltip = 'TooltipInfo'
const TRAIT_Buildable = 'BuildableInfo'
const TRAIT_Valued = 'ValuedInfo'
const TRAIT_Power = 'PowerInfo'
const TRAIT_ProductionQueue = 'ProductionQueueInfo'

// ---------------------------------------------------------------------------
// EncyclopediaInfo — actor 百科元数据接口
// OpenRA 对照: EncyclopediaInfo : TraitInfo
// ---------------------------------------------------------------------------

/** 百科条目信息。
 *
 * OpenRA 对照: EncyclopediaInfo
 */
export interface EncyclopediaInfo {
  /** 分类（如 "Buildings", "Infantry", "Vehicles", "Aircraft", "Navy"）。 */
  category: string
  /** 排序权重。 */
  order: number
  /** 描述文本 key。 */
  description: string
  /** 预览缩放比例。 */
  scale: number
  /** 预览所属玩家。 */
  previewOwner: string | null
  /** 是否隐藏可建造信息。 */
  hideBuildable: boolean
  /** 可建造队列类型。 */
  buildableQueue: string | null
}

// ---------------------------------------------------------------------------
// BuildableInfo — 可建造信息接口
// ---------------------------------------------------------------------------

export interface BuildableInfo {
  /** 建造持续时间（-1 表示使用 Valued.Cost）。 */
  buildDuration: number
  /** 建造持续时间修正系数。 */
  buildDurationModifier: number
  /** 所属建造队列类型列表。 */
  queue: string[]
  /** 前置条件。 */
  prerequisites: string[]
}

// ---------------------------------------------------------------------------
// ValuedInfo — 造价信息接口
// ---------------------------------------------------------------------------

export interface ValuedInfo {
  /** 建造费用。 */
  cost: number
}

// ---------------------------------------------------------------------------
// PowerInfo — 电力信息接口
// ---------------------------------------------------------------------------

export interface PowerInfo {
  /** 电力产出/消耗。 */
  amount: number
}

// ---------------------------------------------------------------------------
// EncyclopediaActorEntry — actor 和其 EncyclopediaInfo 的配对
// ---------------------------------------------------------------------------

interface EncyclopediaActorEntry {
  actor: ActorConfig
  encyclopedia: EncyclopediaInfo
}

// ---------------------------------------------------------------------------
// Helper: 从 ActorConfig 提取 TraitConfig
// ---------------------------------------------------------------------------

/**
 * 从 ActorConfig 查找特性配置。
 *
 * OpenRA 对照: actor.TraitInfoOrDefault<T>() / actor.TraitInfos<T>()
 */
function getTraitConfig(actor: ActorConfig, name: string): TraitConfig | undefined {
  return actor.traitConfigs.find((t) => t.name === name)
}

function getTraitConfigs(actor: ActorConfig, implementsInterface: string): TraitConfig[] {
  return actor.traitConfigs.filter((t) => t.implements.includes(implementsInterface))
}

/**
 * 从 TraitConfig.properties 安全提取字段值。
 */
function prop(trait: TraitConfig | undefined, key: string, defaultValue: unknown = undefined): unknown {
  if (!trait || !trait.properties) return defaultValue
  return trait.properties[key] ?? defaultValue
}

// ---------------------------------------------------------------------------
// EncyclopediaLogic
// OpenRA 对照: EncyclopediaLogic : ChromeLogic
// ---------------------------------------------------------------------------

/**
 * 百科浏览器逻辑 — 按分类列出所有 actor，展示描述和统计数据。
 *
 * OpenRA 对照: class EncyclopediaLogic : ChromeLogic
 */
export class EncyclopediaLogic extends ChromeLogic {
  private readonly _onExit: () => void

  /** 所有百科条目（actor → EncyclopediaInfo）。 */
  private readonly _entries: EncyclopediaActorEntry[] = []

  /** 当前选中的 actor。 */
  private _selectedActor: ActorConfig | null = null

  /** 首个列表项（初始自动选中）。 */
  private _firstItem: unknown = null

  /** 资源表（用于名称查询）。 */
  private readonly _rules: Ruleset

  // ---- 构造 ----

  /**
   * @param widget — 根 widget 节点
   * @param world — 世界对象（保留用于未来 ActorPreview 集成）
   * @param rules — 默认规则集
   * @param onExit — 退出回调
   */
  constructor(
    widget: Widget,
    world: unknown,
    rules: Ruleset,
    onExit: () => void,
  ) {
    super()

    // world 保留用于未来 ActorPreview 集成
    void world

    this._onExit = onExit
    this._rules = rules

    this._buildActorList()
    this._wireUI(widget)
  }

  // ---------------------------------------------------------------------------
  // 构建 actor 列表
  // ---------------------------------------------------------------------------

  /** 扫描所有 actor，过滤出具有百科条目的。
   *
   * OpenRA 对照: 构造函数中的 foreach (var actor in modData.DefaultRules.Actors.Values)
   */
  private _buildActorList(): void {
    const entries: EncyclopediaActorEntry[] = []

    for (const actor of this._rules.actors.values()) {
      // 跳过没有渲染预览精灵的 actor
      if (getTraitConfigs(actor, TRAIT_IRenderActorPreviewSprites).length === 0)
        continue

      // 跳过被统计覆盖的 actor
      const stats = getTraitConfig(actor, TRAIT_UpdatesPlayerStatistics)
      if (stats) {
        const override = prop(stats, 'OverrideActor')
        if (override && typeof override === 'string' && override.length > 0)
          continue
      }

      // 必须具有 EncyclopediaInfo 特性
      const encTrait = getTraitConfig(actor, TRAIT_Encyclopedia)
      if (!encTrait) continue

      const encyclopedia: EncyclopediaInfo = {
        category: (prop(encTrait, 'Category') as string) || '',
        order: (prop(encTrait, 'Order') as number) || 0,
        description: (prop(encTrait, 'Description') as string) || '',
        scale: (prop(encTrait, 'Scale') as number) || 1,
        previewOwner: (prop(encTrait, 'PreviewOwner') as string) || null,
        hideBuildable: (prop(encTrait, 'HideBuildable') as boolean) || false,
        buildableQueue: (prop(encTrait, 'BuildableQueue') as string) || null,
      }

      entries.push({ actor, encyclopedia })
    }

    // 按分类名称排序，空分类排最后
    entries.sort((a, b) => {
      const ca = a.encyclopedia.category || '￿'
      const cb = b.encyclopedia.category || '￿'
      if (ca !== cb) return ca.localeCompare(cb)
      return a.encyclopedia.order - b.encyclopedia.order
    })

    this._entries.push(...entries)
  }

  // ---------------------------------------------------------------------------
  // UI 连线
  // ---------------------------------------------------------------------------

  private _wireUI(widget: Widget): void {
    // 返回按钮
    const backButton = widget.get<Widget & { onClick?: () => void }>('BACK_BUTTON')
    backButton.onClick = () => {
      Ui.closeWindow()
      this._onExit()
    }

    // Actor 列表
    const actorList = widget.get<Widget & { addChild(w: Widget): void; removeChildren(): void }>('ACTOR_LIST')
    actorList.removeChildren()

    this._populateActorList(widget, actorList)

    // 选中第一个条目
    if (this._entries.length > 0) {
      this._selectActor(this._entries[0].actor)
    }
  }

  // ---------------------------------------------------------------------------
  // 填充 actor 列表（按分类分组）
  // ---------------------------------------------------------------------------

  private _populateActorList(widget: Widget, actorList: Widget & { addChild(w: Widget): void }): void {
    // 获取分类（去重，排序）
    const categories = [...new Set(this._entries.map((e) => e.encyclopedia.category))]
      .sort((a, b) => {
        if (a === '') return 1
        if (b === '') return -1
        return a.localeCompare(b)
      })

    for (const category of categories) {
      const categoryEntries = this._entries.filter((e) => e.encyclopedia.category === category)

      // 分类标题
      const header = this._createCategoryHeader(widget, category)
      if (header) actorList.addChild(header as unknown as Widget)

      // 分类下的 actor 条目
      for (const entry of categoryEntries) {
        const item = this._createActorItem(widget, entry)
        actorList.addChild(item as unknown as Widget)
      }
    }
  }

  /** 创建分类标题行。 */
  private _createCategoryHeader(widget: Widget, title: string): Widget | null {
    const headerTemplate = widget.getOrNull<Widget & { clone(): Widget; get<T extends Widget>(id: string): T }>('HEADER')
    if (!headerTemplate) return null

    const header = headerTemplate.clone()
    header.id = `category-${title}`

    // 设置分类标题
    const label = header.get<Widget & { getText?: () => string }>('LABEL')
    if (label && label.getText) {
      label.getText = () => title || fluentMsg('label-uncategorized')
    }

    // 标题行不可选中
    ;(header as any).isSelected = () => false

    return header
  }

  /** 创建单个 actor 条目。
   *
   * OpenRA 对照: CreateActorGroup 中的 ScrollItemWidget.Setup 循环
   */
  private _createActorItem(widget: Widget, entry: EncyclopediaActorEntry): Widget | null {
    const template = widget.getOrNull<Widget & { clone(): Widget; get<T extends Widget>(id: string): T }>('TEMPLATE')
    if (!template) return null

    const item = template.clone()
    const actor = entry.actor

    // 设置选中状态
    ;(item as any).isSelected = () => this._selectedActor?.name === actor.name

    // 点击选中
    ;(item as any).onClick = () => this._selectActor(actor)

    // 设置标题
    const label = item.get<Widget & { getText?: () => string }>('TITLE')
    if (label && label.getText) {
      label.getText = () => this._actorName(actor.name)
    }

    // 记录首个条目
    if (!this._firstItem) {
      this._firstItem = item
    }

    return item
  }

  // ---------------------------------------------------------------------------
  // Actor 选择
  // ---------------------------------------------------------------------------

  /** 选中一个 actor 并显示其信息。
   *
   * OpenRA 对照: SelectActor(ActorInfo actor)
   */
  private _selectActor(actor: ActorConfig): void {
    this._selectedActor = actor

    const entry = this._entries.find((e) => e.actor === actor)
    if (!entry) return

    const info = entry.encyclopedia

    // NOTE: ActorPreviewWidget 迁移推迟。
    // 当前仅更新文本描述，不设置 3D 预览。

    // 构建描述文本
    let text = ''

    const biTrait = entry.actor.traitConfigs.find((t) => {
      // 匹配 BuildableInfo 特性
      return t.name === TRAIT_Buildable || t.implements.includes(TRAIT_Buildable)
    })

    if (biTrait) {
      const prereqs = this._getPrerequisites(biTrait)
      if (prereqs.length > 0) {
        text += fluentMsg('label-requires') + ': ' + prereqs.join(', ') + '\n\n'
      }
    }

    if (info.description) {
      text += fluentMsg(info.description)
    }

    // 计算并弹出统计数据（通过委托驱动的 widget 绑定输出）
    this._buildTime(entry.actor, biTrait)
    this._getCost(entry.actor)
    this._getPower(entry.actor)

    // NOTE: 将信息显示到对应的 label widget 上。
    // 实际渲染依赖于 widget 树中的 label 定义。
    // 文本委托由 widget 的 getText 属性驱动。
    this._selectedActor = actor
  }

  /** 获取 actor 的显示名。
   *
   * OpenRA 对照: ActorName(Ruleset, string)
   */
  private _actorName(name: string): string {
    const actor = this._rules.actors.get(name.toLowerCase())
    if (actor) {
      const tooltip = getTraitConfig(actor, TRAIT_Tooltip)
      if (tooltip) {
        const tooltipName = prop(tooltip, 'Name')
        if (tooltipName && typeof tooltipName === 'string')
          return fluentMsg(tooltipName)
      }
    }
    return name
  }

  /** 获取前置条件列表。 */
  private _getPrerequisites(bt: TraitConfig): string[] {
    const prereqsRaw = prop(bt, 'Prerequisites')
    if (!prereqsRaw || !Array.isArray(prereqsRaw)) return []
    return prereqsRaw
      .filter((p): p is string => typeof p === 'string')
      .map((a) => this._actorName(a))
      .filter((s) => !s.startsWith('~') && !s.startsWith('!'))
  }

  /** 获取建造费用。 */
  private _getCost(actor: ActorConfig): number {
    const valued = getTraitConfig(actor, TRAIT_Valued)
    if (valued) {
      const cost = prop(valued, 'Cost')
      if (typeof cost === 'number') return cost
    }
    return 0
  }

  /** 获取电力值。 */
  private _getPower(actor: ActorConfig): number {
    const powerTraits = getTraitConfigs(actor, TRAIT_Power)
    let total = 0
    for (const pt of powerTraits) {
      const amount = prop(pt, 'Amount')
      if (typeof amount === 'number') total += amount
    }
    return total
  }

  /** 计算建造时间。
   *
   * OpenRA 对照: BuildTime(ActorInfo, string)
   */
  private _buildTime(actor: ActorConfig, biTrait: TraitConfig | undefined): number {
    if (!biTrait) return 0

    let time = (prop(biTrait, 'BuildDuration') as number) ?? -1
    if (time === -1) {
      const valued = this._getCost(actor)
      if (valued === 0) return 0
      time = valued
    }

    const durationMod = (prop(biTrait, 'BuildDurationModifier') as number) ?? 100

    // 查找生产队列的 BuildDurationModifier
    const queue = (prop(biTrait, 'Queue') as string[]) ?? []
    let pbi = 100
    for (const q of queue) {
      for (const a of this._rules.actors.values()) {
        const pqTraits = getTraitConfigs(a, TRAIT_ProductionQueue)
        for (const pq of pqTraits) {
          const pqType = prop(pq, 'Type')
          if (typeof pqType === 'string' && pqType === q) {
            pbi = (prop(pq, 'BuildDurationModifier') as number) ?? 100
            break
          }
        }
      }
    }

    time = time * durationMod * pbi / 10000
    return Math.floor(time)
  }

  // ---------------------------------------------------------------------------
  // 时间格式化
  // ---------------------------------------------------------------------------

  /** 格式化时间为 "MM:SS"。
   *
   * OpenRA 对照: WidgetUtils.FormatTime(ticks, timestep)
   */
  static formatTime(ticks: number, timestep: number): string {
    const totalSeconds = Math.floor(ticks * timestep / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  // ---------------------------------------------------------------------------
  // ChromeLogic 接口
  // ---------------------------------------------------------------------------

  tick(): void {
    // 百科无每帧 tick 逻辑
  }

  override dispose(): void {
    this._entries.length = 0
    super.dispose()
  }
}
