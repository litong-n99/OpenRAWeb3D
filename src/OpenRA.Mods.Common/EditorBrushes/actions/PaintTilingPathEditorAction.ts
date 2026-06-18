/**
 * PaintTilingPathEditorAction.ts — Undoable tiling path paint (commit path tiles to map)
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorTilingPathBrush.cs
 *   sealed class PaintTilingPathEditorAction : IEditorAction (lines 331-379)
 *
 * 核心范式转换:
 * - C# FluentProvider.GetMessage → template literal strings (TODO-21.B.2-DEFER-7)
 *
 * Migration: TODO-21.B.9 — Chapter 21 Phase B Wave 3
 */

import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import { EditorBlit, type MapBlitData, type EditorActorLayerBlitInterface } from '../EditorBlit.js'
import { MapBlitFilters } from '../types.js'
import { PathPlan, type TilingPathTool } from '../../Traits/World/TilingPathTool.js'
import type { IResourceLayer } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { EditorActorLayer } from '../../Traits/World/EditorActorLayer.js'

/**
 * Undoable action for painting the tiling path onto the map.
 *
 * OpenRA 对照: PaintTilingPathEditorAction
 */
export class PaintTilingPathEditorAction implements IEditorAction {
  text: string

  private readonly tool: TilingPathTool
  private readonly plan: PathPlan | null
  private readonly editorBlit: EditorBlit | null

  /**
   * Create a paint action for the current tiling path.
   *
   * @param tool — the TilingPathTool
   * @param resourceLayer — resource layer (null for terrain-only)
   * @param editorActorLayer — editor actor layer
   * @param mapData — map data for terrain/height/resource access
   */
  constructor(
    tool: TilingPathTool,
    resourceLayer: IResourceLayer | null,
    editorActorLayer: EditorActorLayer & EditorActorLayerBlitInterface,
    mapData: MapBlitData,
  ) {
    this.tool = tool
    this.plan = tool.plan

    // TODO-21.B.2-DEFER-7: FluentProvider
    this.text = 'Painted tiling path'

    const blitSource = tool.editorBlitSource
    if (blitSource) {
      this.editorBlit = new EditorBlit(
        MapBlitFilters.Terrain | MapBlitFilters.Actors,
        resourceLayer!,
        blitSource.cellCoords.TopLeft,
        mapData,
        blitSource,
        editorActorLayer,
        false, // respectBounds = false for tiling path paint
      )
    } else {
      this.editorBlit = null
    }
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    this.tool.setPlan(null)
    if (this.editorBlit) {
      this.editorBlit.commit()
    }
  }

  undo(): void {
    if (this.editorBlit) {
      this.editorBlit.revert()
    }
    this.tool.setPlan(this.plan)
  }
}
