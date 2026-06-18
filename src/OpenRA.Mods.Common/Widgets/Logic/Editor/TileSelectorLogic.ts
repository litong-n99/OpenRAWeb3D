/**
 * TileSelectorLogic.ts — 地形瓦片浏览器
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/TileSelectorLogic.cs (144 lines)
 *
 * 核心范式转换:
 * - C# ITemplatedTerrainInfo / TerrainTemplateInfo.Categories
 *   → 桩接口带扩展属性（TODO-21.C.12-DEFER-1/2: 完整地形模板系统未迁移）
 * - C# TerrainTemplatePreviewWidget → 桩预览（仅设置模板，无视觉渲染）
 * - C# ImmutableArray<TileSelectorTemplate> → TypeScript readonly TileSelectorTemplate[]
 * - C# ScrollItemWidget.Setup → TypeScript ScrollItemWidget.setup()
 * - C# FluentProvider.GetMessage → 硬编码英文字符串（TODO-21.C-DEFER-1）
 * - C# PascalCase widget delegates → TypeScript camelCase
 *
 * Migration: TODO-21.C.12 — Chapter 21 Phase C Wave 2
 */

import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ScrollItemWidget } from '../../../Widgets/ScrollItemWidget.js'
import { EditorTileBrush } from '../../../EditorBrushes/EditorTileBrush.js'
import { CommonSelectorLogic } from './CommonSelectorLogic.js'
import type { TerrainTemplateInfoStub } from '../../../EditorBrushes/TerrainStubs.js'

// ---------------------------------------------------------------------------
// Extended stub interfaces
// ---------------------------------------------------------------------------

/** 扩展的地形模板桩 — 添加 Categories 属性。
 *
 * TODO-21.C.12-DEFER-1: 完整 TerrainTemplateInfo 迁移后替换 */
interface TileSelectorTemplateInfo extends TerrainTemplateInfoStub {
  readonly categories: readonly string[]
}

/** 扩展的模板化地形桩。
 *
 * TODO-21.C.12-DEFER-1: 完整 ITemplatedTerrainInfo 迁移后替换 */
interface ITileSelectorTerrainInfo {
  readonly templatesInDefinitionOrder: readonly TileSelectorTemplateInfo[]
  readonly editorTemplateOrder: readonly string[]
  readonly templates: ReadonlyMap<number, TileSelectorTemplateInfo>
}

// ---------------------------------------------------------------------------
// TileSelectorTemplate (对应 OpenRA sealed class TileSelectorTemplate)
// ---------------------------------------------------------------------------

interface TileSelectorTemplateData {
  readonly template: TileSelectorTemplateInfo
  readonly categories: readonly string[]
  readonly searchTerms: readonly string[]
  readonly tooltip: string
}

// ---------------------------------------------------------------------------
// TileSelectorLogic
// ---------------------------------------------------------------------------

export class TileSelectorLogic extends CommonSelectorLogic {
  private readonly terrainInfo: ITileSelectorTerrainInfo
  private readonly allTemplates: readonly TileSelectorTemplateData[]

  constructor(
    widget: Widget,
    modData: Record<string, unknown>,
    world: Record<string, unknown>,
    worldRenderer: {
      world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
    },
  ) {
    super(
      widget,
      modData,
      world,
      worldRenderer,
      'TILETEMPLATE_LIST',
      'TILEPREVIEW_TEMPLATE',
    )

    const map = world.map as Record<string, unknown>
    const rules = map.rules as Record<string, unknown>
    const ti = rules.terrainInfo
    if (!ti || typeof ti !== 'object' || !('templatesInDefinitionOrder' in ti)) {
      throw new Error('TileSelectorLogic requires a template-based tileset.')
    }
    this.terrainInfo = ti as unknown as ITileSelectorTerrainInfo

    this.allTemplates = this.terrainInfo.templatesInDefinitionOrder.map((t) => ({
      template: t,
      categories: t.categories,
      tooltip: String(t.id),
      searchTerms: [String(t.id)],
    }))

    this.allCategories = this.allTemplates
      .flatMap((td) => [...td.categories])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => this._categoryOrder(a) - this._categoryOrder(b))

    for (const c of this.allCategories) {
      this.selectedCategories.add(c)
      this.filteredCategories.push(c)
    }

    // 搜索文本编辑处理
    this.searchTextField.onTextEdited = () => {
      this.searchFilter = (this.searchTextField.text ?? '').trim()
      this.filteredCategories.length = 0

      if (this.searchFilter && this.searchFilter.length > 0) {
        const searchLower = this.searchFilter.toLowerCase()
        const matchingCategories = new Set<string>()
        for (const td of this.allTemplates) {
          const matches = td.searchTerms.some((s) =>
            s.toLowerCase().includes(searchLower),
          )
          if (matches) {
            for (const c of td.categories) {
              matchingCategories.add(c)
            }
          }
        }
        const sorted = [...matchingCategories].sort(
          (a, b) => this._categoryOrder(a) - this._categoryOrder(b),
        )
        this.filteredCategories.push(...sorted)
      } else {
        this.filteredCategories.push(...this.allCategories)
      }

      this.initializePreviews()
    }

    this.initializePreviews()
  }

  // ---------------------------------------------------------------------------
  // tick (对应 OpenRA ChromeLogic.Tick — no-op)
  // ---------------------------------------------------------------------------

  tick(): void {
    // no-op
  }

  // ---------------------------------------------------------------------------
  // categoryOrder (对应 OpenRA int CategoryOrder(string category))
  // ---------------------------------------------------------------------------

  private _categoryOrder(category: string): number {
    const i = this.terrainInfo.editorTemplateOrder.indexOf(category)
    return i >= 0 ? i : Number.MAX_SAFE_INTEGER
  }

  // ---------------------------------------------------------------------------
  // initializePreviews (对应 OpenRA InitializePreviews)
  // ---------------------------------------------------------------------------

  protected override initializePreviews(): void {
    this.panel.removeChildren()

    if (this.selectedCategories.size === 0) return

    const searchLower = this.searchFilter ? this.searchFilter.toLowerCase() : ''

    for (const td of this.allTemplates) {
      const hasCategory = td.categories.some((c) =>
        this.selectedCategories.has(c),
      )
      if (!hasCategory) continue

      if (
        searchLower &&
        !td.searchTerms.some((s) => s.toLowerCase().includes(searchLower))
      ) {
        continue
      }

      const tileId = td.template.id

      const item = ScrollItemWidget.setup(
        this.itemTemplate,
        () => {
          const brush = this.editor.currentBrush
          return (
            brush instanceof EditorTileBrush &&
            brush.terrainTemplate.id === tileId
          )
        },
        () => {
          this.editor.setBrush(
            new EditorTileBrush(this.editor, tileId, this.worldRenderer),
          )
        },
      )

      // NOTE: TerrainTemplatePreviewWidget 未迁移
      // TODO-21.C.12-DEFER-2: 实现视觉预览
      const previewWidget = item.getOrNull<Widget>('TILE_PREVIEW')
      if (previewWidget) {
        const preview = previewWidget as unknown as Record<string, unknown>
        if (typeof preview.setTemplate === 'function') {
          preview.setTemplate(this.terrainInfo.templates.get(tileId))
        }
      }

      // NOTE: 预览缩放推迟到 TerrainTemplatePreviewWidget 迁移后
      // TODO-21.C.12-DEFER-2: 实现预览缩放
      item.isVisible = () => true
      item.getTooltipText = () => td.tooltip

      this.panel.addChild(item)
    }
  }
}
