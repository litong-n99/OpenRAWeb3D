/**
 * DeleteAreaAction.ts — Editor undo/redo action for area deletion
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorDefaultBrush.cs
 *   sealed class DeleteAreaAction : IEditorAction (lines 352-461)
 *
 * 核心范式转换:
 * - C# EditorBlit.CopyRegionContents() → stub implementation inline
 *   (EditorBlit not yet migrated — )
 * - C# FluentProvider.GetMessage → template literal string
 * - C# MapBlitFilters.HasFlag() → bitwise & check
 * - C# CollectionsMarshal.AsSpan() → standard array
 * - C# using (new PerfTimer(...)) → skipped (browser Performance API sufficient)
 *
 * Migration:  — Chapter 21 Phase B
 */

import type { CPos } from '../../../OpenRA.Game/CPos.js'
import type { CellCoordsRegion } from '../../../OpenRA.Game/Map/CellCoordsRegion.js'
import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { EditorActorLayer } from '../../Traits/World/EditorActorLayer.js'
import type { IResourceLayer } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { EditorActorPreview } from '../../Traits/World/EditorActorPreview.js'
import { MapBlitFilters, cposKey, type BlitTile, type EditorBlitSource } from '../types.js'

/**
 * Deletes all terrain, resources, and/or actors within a selected region.
 *
 * OpenRA 对照: sealed class DeleteAreaAction : IEditorAction
 *
 * Snapshots the area before deletion using a stub of EditorBlit.CopyRegionContents.
 * On undo, restores the snapshot contents.
 *
 * The action respects MapBlitFilters — only the flagged categories are affected.
 * Terrain cells are reset to the default terrain tile and height 0.
 * Actor copies are deep-cloned with LocationInit preserved.
 */
export class DeleteAreaAction implements IEditorAction {
  /** Human-readable description of this action.
   *
   * OpenRA 对照: DeleteAreaAction.Text { get; }
   */
  readonly text: string

  /** Region snapshot for undo (stub of EditorBlit.CopyRegionContents). */
  private readonly editorBlitSource: EditorBlitSource

  /** Which categories to delete. */
  private readonly blitFilters: MapBlitFilters

  /** Resource layer reference (may be null if no resources on map). */
  private readonly resourceLayer: IResourceLayer | null

  /** Editor actor layer for actor removal/restoration. */
  private readonly editorActorLayer: EditorActorLayer

  /** The area being deleted. */
  private readonly area: CellCoordsRegion

  /** Map controls access to tiles/height. */
  private readonly map: {
    tiles: { get: (pos: CPos) => { type: number; index: number }; set: (pos: CPos, tile: { type: number; index: number }) => void; contains: (pos: CPos) => boolean }
    height: { get: (pos: CPos) => number; set: (pos: CPos, h: number) => void }
    rules: { terrainInfo: { defaultTerrainTile: { type: number; index: number } } }
  }

  /**
   * Create a DeleteAreaAction.
   *
   * OpenRA 对照: DeleteAreaAction(Map, MapBlitFilters, CellCoordsRegion, IResourceLayer, EditorActorLayer)
   *
   * Captures the region snapshot immediately in the constructor so undo always
   * has the correct "before" state regardless of subsequent map changes.
   *
   * @param map — map data accessor (tiles, height, rules)
   * @param blitFilters — which categories to delete
   * @param area — the rectangular region to delete
   * @param resourceLayer — resource layer, or null if no resources
   * @param editorActorLayer — the editor actor layer
   */
  constructor(
    map: DeleteAreaAction['map'],
    blitFilters: MapBlitFilters,
    area: CellCoordsRegion,
    resourceLayer: IResourceLayer | null,
    editorActorLayer: EditorActorLayer,
  ) {
    this.map = map
    this.blitFilters = blitFilters
    this.resourceLayer = resourceLayer
    this.editorActorLayer = editorActorLayer
    this.area = area

    // Capture undo snapshot (stub of EditorBlit.CopyRegionContents)
    this.editorBlitSource = copyRegionContents(
      map,
      editorActorLayer,
      resourceLayer,
      area,
      blitFilters,
    )

    // Build text description
    this.text =
      `Removed area: (${area.TopLeft.X},${area.TopLeft.Y}) ` +
      `${area.BottomRight.X - area.TopLeft.X}x` +
      `${area.BottomRight.Y - area.TopLeft.Y}`
  }

  /**
   * Execute the deletion for the first time.
   *
   * OpenRA 对照: DeleteAreaAction.Execute() → Do()
   */
  execute(): void {
    this.redo()
  }

  /**
   * Perform the deletion.
   *
   * OpenRA 对照: DeleteAreaAction.Do()
   *
   * Removes actors, clears resources, and resets terrain based on filters.
   */
  redo(): void {
    // Clear actors in the region
    if (this.blitFilters & MapBlitFilters.Actors) {
      this.editorActorLayer.removeRegion(this.area)
    }

    // Clear terrain and resources for each cell in the source snapshot
    for (const [key] of this.editorBlitSource.tiles) {
      const [xs, ys] = key.split(',')
      const positionX = parseInt(xs!, 10)
      const positionY = parseInt(ys!, 10)
      // Approximate CPos — using X,Y from key
      const position = { X: positionX, Y: positionY } as unknown as CPos
      if (!this.map.tiles.contains(position)) continue

      // Clear resources
      if (this.resourceLayer && (this.blitFilters & MapBlitFilters.Resources)) {
        this.resourceLayer.clearResources(position)
      }

      // Reset terrain to default
      if (this.blitFilters & MapBlitFilters.Terrain) {
        this.map.tiles.set(position, this.map.rules.terrainInfo.defaultTerrainTile)
        this.map.height.set(position, 0)
      }
    }
  }

  /**
   * Restore the deleted area from the snapshot.
   *
   * OpenRA 对照: DeleteAreaAction.Undo()
   *
   * Restores terrain tiles, heights, resources, and recreates actor copies.
   */
  undo(): void {
    const blitSource = this.editorBlitSource
    const { blitFilters, resourceLayer, editorActorLayer, map } = this

    // Restore terrain and resources
    for (const [key, tile] of blitSource.tiles) {
      const [xs, ys] = key.split(',')
      const positionX = parseInt(xs!, 10)
      const positionY = parseInt(ys!, 10)
      const position = { X: positionX, Y: positionY } as unknown as CPos
      if (!map.tiles.contains(position)) continue

      const contents = tile.resourceLayerContents

      if (blitFilters & MapBlitFilters.Terrain) {
        map.tiles.set(position, tile.terrainTile)
        map.height.set(position, tile.height)
      }

      if (
        (blitFilters & MapBlitFilters.Resources) &&
        contents !== null &&
        contents.type !== '' &&
        resourceLayer
      ) {
        resourceLayer.addResource(contents.type, position, contents.density)
      }
    }

    // Restore actors
    if (blitFilters & MapBlitFilters.Actors) {
      const copies: ReturnType<EditorActorPreview['export']>[] = []
      for (const [, actor] of blitSource.actors) {
        const copy = actor.export()
        const locationInit = copy.get('LocationInit') as { type: string; value: CPos } | undefined
        if (locationInit) {
          const loc = locationInit.value
          if (!map.tiles.contains(loc)) continue
          copy.delete('LocationInit')
          copy.set('LocationInit', { type: 'LocationInit', value: loc })
        }
        copies.push(copy)
      }
      editorActorLayer.addRange(copies)
    }
  }
}

// ---------------------------------------------------------------------------
// Stub: copyRegionContents (对应 OpenRA EditorBlit.CopyRegionContents)
// ---------------------------------------------------------------------------

/**
 * Snapshot a map region for undo support.
 *
 * OpenRA 对照: EditorBlit.CopyRegionContents(Map, EditorActorLayer,
 *   IResourceLayer, CellCoordsRegion, MapBlitFilters)
 *
* Replace with EditorBlit.CopyRegionContents() when EditorBlit is
 * migrated. This stub captures terrain tiles, heights, resources, and actors
 * in the region, respecting the MapBlitFilters.
 *
 * @param map — map data accessor
 * @param actorLayer — editor actor layer
 * @param resourceLayer — resource layer (or null)
 * @param region — the region to snapshot
 * @param filters — which categories to capture (terrain/resources/actors)
 * @returns a snapshot of the region containing only the filtered categories
 */
function copyRegionContents(
  map: DeleteAreaAction['map'],
  actorLayer: EditorActorLayer,
  resourceLayer: IResourceLayer | null,
  region: CellCoordsRegion,
  filters: MapBlitFilters,
): EditorBlitSource {
  const tiles = new Map<string, BlitTile>()
  const actors = new Map<string, EditorActorPreview>()

  // Snapshot terrain and resources only if their filters are set
  const captureTerrain = (filters & MapBlitFilters.Terrain) !== 0
  const captureResources = (filters & MapBlitFilters.Resources) !== 0

  if (captureTerrain || captureResources || filters === MapBlitFilters.All) {
    for (const cell of region) {
      if (!map.tiles.contains(cell)) continue
      const key = cposKey(cell)

      const terrainTile = captureTerrain || filters === MapBlitFilters.All
        ? map.tiles.get(cell)
        : { type: 0, index: 0 }
      const height = captureTerrain || filters === MapBlitFilters.All
        ? map.height.get(cell)
        : 0
      const contents = captureResources || filters === MapBlitFilters.All
        ? (resourceLayer?.getResource(cell) ?? null)
        : null

      tiles.set(key, {
        terrainTile,
        resourceTile: { type: 0, index: 0 },
        resourceLayerContents: contents && contents.type ? contents : null,
        height,
      })
    }
  }

  // Snapshot actors only if Actors filter is set
  if (filters & MapBlitFilters.Actors) {
    for (const preview of actorLayer.previewsInCellRegion(region)) {
      actors.set(preview.id, preview)
    }
  }

  return { cellCoords: region, actors, tiles }
}
