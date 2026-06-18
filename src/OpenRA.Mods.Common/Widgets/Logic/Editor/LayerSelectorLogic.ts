/**
 * LayerSelectorLogic.ts — 资源图层类型浏览器
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/LayerSelectorLogic.cs (79 lines)
 *
 * 核心范式转换:
 * - C# IResourceRenderer.ResourceTypes → 桩接口（TODO-21.C.13-DEFER-1）
 * - C# ResourcePreviewWidget.SetResourceType → 桩（TODO-21.C.13-DEFER-2）
 * - C# Panel.Layout = new GridLayout(Panel) → panel.layout = new GridLayout(host)
 * - C# ScrollItemWidget.Setup → TypeScript ScrollItemWidget.setup()
 * - C# FluentProvider.GetMessage → 硬编码英文字符串（TODO-21.C-DEFER-1）
 * - C# PascalCase widget delegates → TypeScript camelCase
 *
 * Migration:  — Chapter 21 Phase C Wave 2
 */

import {
  type Widget,
  ChromeLogic,
} from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ScrollPanelWidget } from '../../../Widgets/ScrollPanelWidget.js'
import { ScrollItemWidget } from '../../../Widgets/ScrollItemWidget.js'
import { GridLayout, type IGridLayoutHost } from '../../../Widgets/GridLayout.js'
import { EditorResourceBrush } from '../../../EditorBrushes/EditorResourceBrush.js'
import type { EditorViewportControllerWidget } from '../../../Widgets/EditorViewportControllerWidget.js'

// ---------------------------------------------------------------------------
// IResourceRenderer stub
// ---------------------------------------------------------------------------

interface IResourceRendererStub {
  readonly resourceTypes: readonly string[]
}

// ---------------------------------------------------------------------------
// LayerSelectorLogic
// ---------------------------------------------------------------------------

export class LayerSelectorLogic extends ChromeLogic {
  private readonly editor: EditorViewportControllerWidget
  private readonly worldRenderer: {
    world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
  }
  private readonly layerTemplateList: ScrollPanelWidget
  private readonly layerPreviewTemplate: ScrollItemWidget

  constructor(
    widget: Widget,
    worldRenderer: {
      world: { map: Record<string, unknown>; worldActor: Record<string, unknown> }
    },
  ) {
    super()

    this.worldRenderer = worldRenderer

    // 通过 parent 链解析 EditorViewportControllerWidget
    const parentP = widget.parent as unknown as { parent: Widget | null } | null
    const editorParent = parentP?.parent
    if (!editorParent) {
      throw new Error(
        'LayerSelectorLogic: widget.parent.parent is null — cannot resolve MAP_EDITOR',
      )
    }
    this.editor = editorParent.get<EditorViewportControllerWidget>('MAP_EDITOR')

    this.layerTemplateList = widget.get<ScrollPanelWidget>('LAYERTEMPLATE_LIST')
    this.layerTemplateList.layout = new GridLayout(
      this.layerTemplateList as unknown as IGridLayoutHost,
    )
    this.layerPreviewTemplate = this.layerTemplateList.get<ScrollItemWidget>(
      'LAYERPREVIEW_TEMPLATE',
    )

    this.initializeLayerPreview()
  }

  // ---------------------------------------------------------------------------
  // tick (对应 OpenRA ChromeLogic.Tick — no-op)
  // ---------------------------------------------------------------------------

  tick(): void {
    // no-op
  }

  // ---------------------------------------------------------------------------
  // initializeLayerPreview (对应 OpenRA void IntializeLayerPreview())
  // ---------------------------------------------------------------------------

  private initializeLayerPreview(): void {
    this.layerTemplateList.removeChildren()

    const worldActor =
      this.worldRenderer.world.worldActor as Record<string, unknown>
    const resourceRenderers =
      (worldActor.resourceRenderers as IResourceRendererStub[] | undefined) ?? []

    for (const resourceRenderer of resourceRenderers) {
      const resourceTypes = resourceRenderer.resourceTypes
      if (!resourceTypes) continue

      for (const resourceType of resourceTypes) {
        const item = ScrollItemWidget.setup(
          this.layerPreviewTemplate,
          () => {
            const brush = this.editor.currentBrush
            return (
              brush instanceof EditorResourceBrush &&
              brush.resourceType === resourceType
            )
          },
          () => {
            this.editor.setBrush(
              new EditorResourceBrush(
                this.editor,
                resourceType,
                this.worldRenderer,
              ),
            )
          },
        )

        // NOTE: ResourcePreviewWidget 未迁移（TODO-21.C.13-DEFER-2）
        const previewWidget = item.getOrNull<Widget>('LAYER_PREVIEW')
        if (previewWidget) {
          const preview = previewWidget as unknown as Record<string, unknown>
          if (typeof preview.setResourceType === 'function') {
            preview.setResourceType(resourceType)
          }
        }

        // NOTE: 预览缩放推迟到 ResourcePreviewWidget 迁移后
        // TODO-21.C.13-DEFER-2: 实现预览缩放
        item.isVisible = () => true
        item.getTooltipText = () => resourceType

        this.layerTemplateList.addChild(item)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.layerTemplateList.removeChildren()
    super.dispose()
  }
}
