/**
 * ActorSelectorLogic.ts — 编辑器 actor 类型浏览器
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/ActorSelectorLogic.cs (233 lines)
 *
 * 核心范式转换:
 * - C# sealed record ActorSelectorActor → TypeScript interface
 * - C# TraitInfo<T> 特性查询 → TypeScript 桩接口（TODO-21.C.11-DEFER-1/2）
 * - C# TypeDictionary + ActorInit → TypeScript Map<string, unknown> (ActorReferenceMap)
 * - C# ActorPreviewWidget.SetPreview → 桩（TODO-21.C.11-DEFER-1）
 * - C# FluentProvider.GetMessage → 硬编码英文字符串（TODO-21.C-DEFER-1）
 * - C# PascalCase widget delegates → TypeScript camelCase
 * - C# Editor.CurrentBrush is EditorActorBrush eab && eab.Preview.Info == actor
 *   → TypeScript instanceof check + preview 名称比较
 *
 * Migration: TODO-21.C.11 — Chapter 21 Phase C Wave 2
 */

import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ScrollItemWidget } from '../../../Widgets/ScrollItemWidget.js'
import { DropDownButtonWidget } from '../../../Widgets/DropDownButtonWidget.js'
import { LabelWidget } from '../../../Widgets/LabelWidget.js'
import { EditorActorBrush } from '../../../EditorBrushes/EditorActorBrush.js'
import { CommonSelectorLogic } from './CommonSelectorLogic.js'
import type { EditorActorLayer } from '../../../Traits/World/EditorActorLayer.js'
import { PlayerReference } from '../../../../OpenRA.Game/Map/PlayerReference.js'

// ---------------------------------------------------------------------------
// Stub interfaces
// ---------------------------------------------------------------------------

interface ActorInfoStub {
  readonly name: string
  hasTraitInfo(name: string): boolean
  traitInfoOrDefault<T>(name: string): T | undefined
  traitInfos<T>(name: string): T[]
}

interface MapEditorDataInfoStub {
  readonly categories: readonly string[]
  readonly excludeTilesets: readonly string[] | null
  readonly requireTilesets: readonly string[] | null
}

interface TooltipInfoStub {
  readonly name: string
  readonly enabledByDefault?: boolean
}

interface ActorSelectorActorData {
  readonly actor: ActorInfoStub
  readonly categories: readonly string[]
  readonly searchTerms: readonly string[]
  readonly tooltip: string
}

// ---------------------------------------------------------------------------
// Localized strings
// ---------------------------------------------------------------------------

const ACTOR_TYPE_TOOLTIP = 'Actor Type:'

// ---------------------------------------------------------------------------
// ActorSelectorLogic
// ---------------------------------------------------------------------------

export class ActorSelectorLogic extends CommonSelectorLogic {
  private readonly ownersDropDown: DropDownButtonWidget
  private readonly allActors: readonly ActorSelectorActorData[]
  private readonly editorLayer: EditorActorLayer
  private selectedOwner: PlayerReference
  private readonly tileSetId: string

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
      'ACTORTEMPLATE_LIST',
      'ACTORPREVIEW_TEMPLATE',
    )

    const map = world.map as Record<string, unknown>
    const mapRules = (map.rules as Record<string, unknown>) ?? {}
    const worldActor = world.worldActor as Record<string, unknown>
    this.editorLayer = worldActor.editorActorLayer as EditorActorLayer

    const terrainInfo = mapRules.terrainInfo as Record<string, unknown> | undefined
    this.tileSetId = (terrainInfo?.id as string) ?? ''

    this.ownersDropDown = widget.get<DropDownButtonWidget>('OWNERS_DROPDOWN')

    const playersArray = [...(this.editorLayer.Players?.players.values() ?? [])]
    if (playersArray.length === 0) {
      throw new Error('ActorSelectorLogic: no players available')
    }
    this.selectedOwner = playersArray[0]

    const setupOwnerItem = (
      option: PlayerReference,
      template: unknown,
    ): unknown => {
      const tpl = template as ScrollItemWidget
      const item = ScrollItemWidget.setup(
        tpl,
        () => this.selectedOwner === option,
        () => this._selectOwner(option),
      )

      const label = item.getOrNull<LabelWidget>('LABEL')
      if (label) {
        label.getText = () => option.name
      }
      item.getColor = () => `#${option.color.toString(16).padStart(8, '0')}`

      return item
    }

    this.editorLayer.onPlayerRemoved = () => {
      const currentPlayers = [...(this.editorLayer.Players?.players.values() ?? [])]
      if (currentPlayers.some((p) => p.name === this.selectedOwner.name)) return
      if (currentPlayers.length > 0) this._selectOwner(currentPlayers[0])
    }

    this.ownersDropDown.onClick = () => {
      const owners = [
        ...(this.editorLayer.Players?.players.values() ?? []),
      ].sort((a, b) => a.name.localeCompare(b.name))
      this.ownersDropDown.showDropDown('LABEL_DROPDOWN_TEMPLATE', 270, owners, setupOwnerItem)
    }

    const selectedOwnerName = this.selectedOwner.name
    this.ownersDropDown.getText = () => selectedOwnerName
    this.ownersDropDown.textColor =
      `#${this.selectedOwner.color.toString(16).padStart(8, '0')}`

    // Build actor list
    const actorsRecord = mapRules.actors as Record<string, ActorInfoStub> | undefined
    const allActorsTemp: ActorSelectorActorData[] = []

    if (actorsRecord) {
      const actorValues = Object.values(actorsRecord)
      for (const a of actorValues) {
        if (a.name.includes('^')) continue
        if (!a.hasTraitInfo('IRenderActorPreviewInfo')) continue
        const editorData = a.traitInfoOrDefault<MapEditorDataInfoStub>('MapEditorDataInfo')
        if (!editorData || !editorData.categories || editorData.categories.length === 0) continue
        if (
          editorData.excludeTilesets &&
          editorData.excludeTilesets.includes(this.tileSetId)
        ) continue
        if (
          editorData.requireTilesets &&
          !editorData.requireTilesets.includes(this.tileSetId)
        ) continue

        const editorOnlyTooltips = a.traitInfos<TooltipInfoStub>('EditorOnlyTooltipInfo')
        const tooltips = a.traitInfos<TooltipInfoStub>('TooltipInfo')
        const tooltip =
          editorOnlyTooltips.find((ti) => ti.enabledByDefault) ??
          tooltips.find((ti) => ti.enabledByDefault)

        const actorType = `${ACTOR_TYPE_TOOLTIP} ${a.name}`
        const searchTerms: string[] = [a.name]
        if (tooltip) {
          searchTerms.push(tooltip.name)
          allActorsTemp.push({
            actor: a,
            categories: editorData.categories,
            searchTerms,
            tooltip: `${tooltip.name}\n${actorType}`,
          })
        } else {
          allActorsTemp.push({
            actor: a,
            categories: editorData.categories,
            searchTerms,
            tooltip: actorType,
          })
        }
      }
    }

    this.allActors = allActorsTemp

    this.allCategories = this.allActors
      .flatMap((ac) => [...ac.categories])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()

    for (const c of this.allCategories) {
      this.selectedCategories.add(c)
      this.filteredCategories.push(c)
    }

    // Search text edit
    const stf = this.searchTextField as unknown as { _text: string }
    this.searchTextField.onTextEdited = () => {
      this.searchFilter = (stf._text ?? '').trim()
      this.filteredCategories.length = 0

      if (this.searchFilter && this.searchFilter.length > 0) {
        const searchLower = this.searchFilter.toLowerCase()
        const matchingCategories = new Set<string>()
        for (const actorData of this.allActors) {
          const matches = actorData.searchTerms.some((s) =>
            s.toLowerCase().includes(searchLower),
          )
          if (matches) {
            for (const c of actorData.categories) {
              matchingCategories.add(c)
            }
          }
        }
        const sorted = [...matchingCategories].sort()
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
  // selectOwner (对应 OpenRA void SelectOwner(PlayerReference option))
  // ---------------------------------------------------------------------------

  private _selectOwner(option: PlayerReference): void {
    this.selectedOwner = option
    const optionName = option.name
    this.ownersDropDown.getText = () => optionName
    this.ownersDropDown.textColor =
      `#${option.color.toString(16).padStart(8, '0')}`
    this.initializePreviews()

    const brush = this.editor.currentBrush
    if (brush instanceof EditorActorBrush) {
      const actor = brush.preview
      actor.owner = option
      actor.replaceInit('OwnerInit', {
        type: 'OwnerInit',
        value: optionName,
      } as unknown)
      actor.replaceInit('FactionInit', {
        type: 'FactionInit',
        value: option.faction,
      } as unknown)
    }
  }

  // ---------------------------------------------------------------------------
  // initializePreviews (对应 OpenRA InitializePreviews)
  // ---------------------------------------------------------------------------

  protected override initializePreviews(): void {
    this.panel.removeChildren()

    if (this.selectedCategories.size === 0) return

    const searchLower = this.searchFilter ? this.searchFilter.toLowerCase() : ''

    for (const a of this.allActors) {
      const hasCategory = a.categories.some((c) =>
        this.selectedCategories.has(c),
      )
      if (!hasCategory) continue

      if (
        searchLower &&
        !a.searchTerms.some((s) => s.toLowerCase().includes(searchLower))
      ) {
        continue
      }

      const actorInfo = a.actor
      const actorName = actorInfo.name

      const initMap = new Map<string, unknown>()
      initMap.set('OwnerInit', { type: 'OwnerInit', value: this.selectedOwner.name })
      initMap.set('FactionInit', { type: 'FactionInit', value: this.selectedOwner.faction })

      // NOTE: IActorPreviewInitInfo 未迁移（TODO-21.C.11-DEFER-2）

      const selectedOwner = this.selectedOwner
      const worldRenderer = this.worldRenderer

      try {
        const item = ScrollItemWidget.setup(
          this.itemTemplate,
          () => {
            const cb = this.editor.currentBrush
            if (!(cb instanceof EditorActorBrush)) return false
            const cbPreview = cb.preview as unknown as Record<string, unknown>
            return (cbPreview.actorName as string) === actorName
          },
          () => {
            this.editor.setBrush(
              new EditorActorBrush(
                this.editor,
                actorInfo as unknown as {
                  readonly name: string
                  traitInfoOrDefault<T>(name: string): T | undefined
                  hasTraitInfo(name: string): boolean
                },
                selectedOwner,
                worldRenderer,
              ),
            )
          },
        )

        // NOTE: ActorPreviewWidget 未迁移（TODO-21.C.11-DEFER-1）
        const previewWidget = item.getOrNull<Widget>('ACTOR_PREVIEW')
        if (previewWidget) {
          const preview = previewWidget as unknown as Record<string, unknown>
          if (typeof preview.setPreview === 'function') {
            preview.setPreview(actorInfo, initMap)
          }
        }

        // NOTE: 预览缩放推迟到 ActorPreviewWidget 迁移后
        // TODO-21.C.11-DEFER-1: 实现预览缩放
        ;(item as unknown as Widget).isVisible = () => true
        item.getTooltipText = () => a.tooltip

        this.panel.addChild(item)
      } catch {
        console.debug(
          `Map editor ignoring actor ${actorName}, because of missing sprites for tileset ${this.tileSetId}.`,
        )
      }
    }
  }
}
