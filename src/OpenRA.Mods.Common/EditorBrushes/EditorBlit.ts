/**
 * EditorBlit.ts — 共享地形拷贝引擎，供 EditorTileBrush 和 EditorCopyPasteBrush 使用
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorBlit.cs (363 lines)
 *
 * 核心范式转换:
 * - C# HashSet<CPos> cell mask → Set<number> (CPos.Bits)
 * - C# Dictionary<CPos, BlitTile> → Map<string, BlitTile> (key="X,Y")
 * - C# Span/ReadOnlySpan → readonly TypeScript Array
 * - C# PerfTimer using() → performance.now() dev-only wrapper
 * - C# CollectionsMarshal.AsSpan → Array spread
 * - C# TryAdd() → .has() guard + .set()
 *
 * EditorBlit 不是 IEditorBrush，而是一个共享工具类，提供 commit/revert 模式
 * 用于区域复制/粘贴操作：
 * - EditorDefaultBrush.DeleteAreaAction — 删除选区
 * - EditorCopyPasteBrush.CopyPasteEditorAction — 粘贴剪贴板
 * - TilingPathTool.PaintTilingPathEditorAction — 绘制铺设路径
 *
 * Migration:  — Chapter 21 Phase B
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import type { CVec } from '../../OpenRA.Game/CVec.js'
import { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import type { TerrainTile, ResourceTile } from '../../OpenRA.Game/Map/TileReference.js'
import { ResourceLayerContentsEmpty } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IResourceLayer } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { EditorActorPreview, ActorReferenceMap } from '../Traits/World/EditorActorPreview.js'
import type { LocationInit } from '../Traits/World/EditorActorPreview.js'
import { MapBlitFilters } from './types.js'
import type { BlitTile, EditorBlitSource } from './types.js'
import { cposKey } from './types.js'

// ---------------------------------------------------------------------------
// Minimal map interface for blit operations
// ---------------------------------------------------------------------------

/** Minimal map data access interface required by EditorBlit.
 *
 * OpenRA 对照: Map.Tiles, Map.Height, Map.Resources, Map.Contains()
 *
 * Defines just the accessors that EditorBlit uses — terrain tiles, height,
 * resource map tiles, and map bounds checking.
 */
export interface MapBlitData {
  readonly tiles: {
    contains(cell: CPos): boolean
    get(cell: CPos): TerrainTile
    set(cell: CPos, tile: TerrainTile): void
  }
  readonly height: {
    contains(cell: CPos): boolean
    get(cell: CPos): number
    set(cell: CPos, height: number): void
  }
  readonly resources: {
    contains(cell: CPos): boolean
    get(cell: CPos): ResourceTile
    set(cell: CPos, tile: ResourceTile): void
  }
  /** Map bounds check — returns true if the cell is within the playable map area.
   *
   * OpenRA 对照: Map.Contains(CPos)
   */
  contains(cell: CPos): boolean
}

// ---------------------------------------------------------------------------
// EditorBlit
// OpenRA 对照: public sealed class EditorBlit
// ---------------------------------------------------------------------------

/**
 * Core implementation for editor actions which overwrite a region of the map
 * (copy-paste, delete area, tiling path paint).
 *
 * OpenRA 对照: EditorBlit
 *
 * Before blitting, the constructor captures the original cell data from the
 * target area as `revertBlitSource`. The `Commit()` method writes the user's
 * data; `Revert()` restores the original data. This is tied to brush mouse-up
 * events — the action wraps an EditorBlit and calls Commit/Undo.
 *
 * Only changed cells are stored in the blit source maps (sparse masks).
 */
export class EditorBlit {
  private readonly blitFilters: MapBlitFilters
  private readonly resourceLayer: IResourceLayer
  private readonly editorActorLayer: EditorActorLayerBlitInterface
  private readonly commitBlitSource: EditorBlitSource
  private readonly revertBlitSource: EditorBlitSource
  private readonly blitPosition: CPos
  private readonly map: MapBlitData
  private readonly respectBounds: boolean

  // -------------------------------------------------------------------------
  // Constructor
  // OpenRA 对照: EditorBlit(MapBlitFilters, IResourceLayer, CPos, Map, EditorBlitSource, EditorActorLayer, bool)
  // -------------------------------------------------------------------------

  /**
   * Create a blit operation.
   *
   * OpenRA 对照: EditorBlit.EditorBlit(...)
   *
   * Captures the current map state at the target location as the revert source.
   * The commit source is the user-supplied blit data (clipboard/selection).
   *
   * @param blitFilters — which map categories to blit (terrain/resources/actors)
   * @param resourceLayer — the resource layer for resource operations
   * @param blitPosition — top-left cell position to place the blit at
   * @param map — the map data for terrain/height/resource manipulation
   * @param blitSource — the source data to commit
   * @param editorActorLayer — the editor actor layer for actor operations
   * @param respectBounds — if true, skip cells outside map bounds
   */
  constructor(
    blitFilters: MapBlitFilters,
    resourceLayer: IResourceLayer,
    blitPosition: CPos,
    map: MapBlitData,
    blitSource: EditorBlitSource,
    editorActorLayer: EditorActorLayerBlitInterface,
    respectBounds: boolean,
  ) {
    this.blitFilters = blitFilters
    this.resourceLayer = resourceLayer
    this.blitPosition = blitPosition
    this.editorActorLayer = editorActorLayer
    this.map = map
    this.respectBounds = respectBounds

    const blitSize = CPos.subtract(
      blitSource.cellCoords.BottomRight,
      blitSource.cellCoords.TopLeft,
    )

    // Only include cells that would actually be modified by the commit blit
    // into the revert blit source. This creates a sparse revert snapshot.
    const mask = EditorBlit.getBlitSourceMask(
      blitSource,
      CPos.subtract(blitPosition, blitSource.cellCoords.TopLeft),
    )

    this.commitBlitSource = blitSource
    this.revertBlitSource = EditorBlit.copyRegionContents(
      map,
      editorActorLayer,
      resourceLayer,
      new CellCoordsRegion(blitPosition, CPos.add(blitPosition, blitSize)),
      blitFilters,
      mask,
    )
  }

  // -------------------------------------------------------------------------
  // CopyRegionContents (static)
  // OpenRA 对照: EditorBlit.CopyRegionContents(Map, EditorActorLayer, IResourceLayer, CellCoordsRegion, MapBlitFilters, IReadOnlySet<CPos>?)
  // -------------------------------------------------------------------------

  /**
   * Capture the current map contents for a given region into an EditorBlitSource.
   *
   * OpenRA 对照: EditorBlit.CopyRegionContents()
   *
   * If a mask is supplied, only tiles and actors (fully or partially) overlapping
   * the mask are included. This produces a sparse blit source that only contains
   * the cells that will actually be affected by the blit.
   *
   * @param map — the map data
   * @param editorActorLayer — the editor actor layer
   * @param resourceLayer — the resource layer (null-safe for terrain-only)
   * @param region — the region to snapshot
   * @param blitFilters — which categories to capture
   * @param mask — optional mask of cell bits to filter by (sparse blit)
   * @returns the captured region contents
   */
  static copyRegionContents(
    map: MapBlitData,
    editorActorLayer: EditorActorLayerBlitInterface,
    resourceLayer: IResourceLayer | null,
    region: CellCoordsRegion,
    blitFilters: MapBlitFilters,
    mask?: ReadonlySet<number>,
  ): EditorBlitSource {
    const mapTiles = map.tiles
    const mapHeight = map.height
    const mapResources = map.resources

    const actors = new Map<string, EditorActorPreview>()
    const tiles = new Map<string, BlitTile>()

    if (
      (blitFilters & MapBlitFilters.Terrain) !== 0 ||
      (blitFilters & MapBlitFilters.Resources) !== 0
    ) {
      for (const cell of region) {
        if (!mapTiles.contains(cell) || (mask !== undefined && !mask.has(cell.Bits)))
          continue

        tiles.set(
          cposKey(cell),
          {
            terrainTile: mapTiles.get(cell),
            resourceTile: mapResources.get(cell),
            resourceLayerContents: resourceLayer?.getResource(cell) ?? ResourceLayerContentsEmpty,
            height: mapHeight.get(cell),
          },
        )
      }
    }

    if ((blitFilters & MapBlitFilters.Actors) !== 0) {
      for (const preview of editorActorLayer.previewsInCellRegion(region)) {
        if (mask === undefined || EditorBlit._actorFootprintOverlapsMask(preview, mask)) {
          // C# TryAdd: keep the first actor with a given ID; ignore duplicates
          if (!actors.has(preview.id))
            actors.set(preview.id, preview)
        }
      }
    }

    return { cellCoords: region, actors, tiles }
  }

  // -------------------------------------------------------------------------
  // GetBlitSourceMask (static)
  // OpenRA 对照: EditorBlit.GetBlitSourceMask(EditorBlitSource, CVec)
  // -------------------------------------------------------------------------

  /**
   * Find the set of cells within an EditorBlitSource that are actually occupied
   * by a BlitTile or actor.
   *
   * OpenRA 对照: EditorBlit.GetBlitSourceMask()
   *
   * All tiles must be inside the cell coords region. All actors must be at least
   * partially inside. For actors partially outside the region, only the cells
   * within the region are included.
   *
   * The returned mask uses `cell.Bits` as the set element — the cells are offset
   * by the given CVec (for commit target position computation).
   *
   * NOTE: Mask operations assume all cells are on Layer=0 (the ground layer).
   *   CPos.Bits encodes X, Y, and Layer in a 32-bit integer. Cells on different
   *   layers (e.g., tunnel or bridge layers) would have different Bits values
   *   even for the same (X, Y) pair. Editor blit operations currently only
   *   operate on Layer=0 — multi-layer support would require Layer-aware mask
   *   comparison (TODO-21.B.6-DEFER-4).
   *
   * @param blitSource — the blit source to compute a mask for
   * @param offset — offset to apply to cell positions (blitPosition - TopLeft)
   * @returns a Set of CPos.Bits values for all occupied cells in the target area
   */
  static getBlitSourceMask(
    blitSource: EditorBlitSource,
    offset: CVec,
  ): Set<number> {
    const mask = new Set<number>()

    const sourceCellCoords = blitSource.cellCoords

    for (const [key] of blitSource.tiles) {
      // Parse "X,Y" key back to CPos
      const [xStr, yStr] = key.split(',')
      const cpos = new CPos(Number(xStr), Number(yStr))

      if (!sourceCellCoords.contains(cpos))
        throw new Error('EditorBlitSource contains a BlitTile outside of its CellRegion')

      mask.add(CPos.add(cpos, offset).Bits)
    }

    for (const [, editorActorPreview] of blitSource.actors) {
      let anyContained = false
      for (const [cpos] of editorActorPreview.footprint) {
        if (sourceCellCoords.contains(cpos)) {
          mask.add(CPos.add(cpos, offset).Bits)
          anyContained = true
        }
      }

      if (!anyContained)
        throw new Error('EditorBlitSource contains an actor entirely outside of its CellRegion')
    }

    return mask
  }

  // -------------------------------------------------------------------------
  // Blit (private) — core commit/revert logic
  // OpenRA 对照: void Blit(bool isRevert)
  // -------------------------------------------------------------------------

  /**
   * Core blit logic shared by Commit() and Revert().
   *
   * OpenRA 对照: EditorBlit.Blit(bool isRevert)
   *
   * For commit (isRevert=false): writes the commit source data to the map at
   * blitPosition, using commitBlitVec to offset source cells to target cells.
   *
   * For revert (isRevert=true): restores the revert source data to its
   * original positions (blitVec is zero — revert source was captured at target).
   *
   * @param isRevert — true for undo (revert), false for commit
   */
  private blit(isRevert: boolean): void {
    const source = isRevert ? this.revertBlitSource : this.commitBlitSource
    const blitPos = isRevert ? source.cellCoords.TopLeft : this.blitPosition
    const blitVec = CPos.subtract(blitPos, source.cellCoords.TopLeft)
    const blitSize = CPos.subtract(
      source.cellCoords.BottomRight,
      source.cellCoords.TopLeft,
    )
    const blitRegion = new CellCoordsRegion(
      blitPos,
      CPos.add(blitPos, blitSize),
    )

    // ---- Clear existing actors in the paste cells ----
    if ((this.blitFilters & MapBlitFilters.Actors) !== 0) {
      // Use the commit mask (not revert mask) to determine which actors to
      // remove. The revert mask may be a superset of the commit mask if the
      // original revert source contained actors that were partially outside
      // the commit blit's sparse mask.
      const commitBlitVec = CPos.subtract(
        this.blitPosition,
        this.commitBlitSource.cellCoords.TopLeft,
      )
      const mask = EditorBlit.getBlitSourceMask(this.commitBlitSource, commitBlitVec)
      this.editorActorLayer.removeRegionWithMask(blitRegion, mask)
    }

    // ---- Apply tiles (terrain + resources) ----
    for (const [tileKey, tile] of source.tiles) {
      const [xStr, yStr] = tileKey.split(',')
      const sourceCell = new CPos(Number(xStr), Number(yStr))
      const position = CPos.add(sourceCell, blitVec)

      if (
        !this.map.tiles.contains(position) ||
        (this.respectBounds && !this.map.contains(position))
      )
        continue

      // Clear any existing resources before writing new ones
      if ((this.blitFilters & MapBlitFilters.Resources) !== 0) {
        this.resourceLayer.clearResources(position)
      }

      const resourceLayerContents = tile.resourceLayerContents
      const resType = resourceLayerContents?.type?.trim() ?? ''

      // Write terrain tile + height
      if ((this.blitFilters & MapBlitFilters.Terrain) !== 0) {
        this.map.tiles.set(position, tile.terrainTile)
        this.map.height.set(position, tile.height)
      }

      // Write resources (if the resource type is valid)
      if (
        (this.blitFilters & MapBlitFilters.Resources) !== 0 &&
        resType !== '' &&
        this.resourceLayer.canAddResource(resType, position)
      ) {
        this.resourceLayer.addResource(
          resType,
          position,
          resourceLayerContents!.density,
        )
      }
    }

    // ---- Apply actors ----
    if ((this.blitFilters & MapBlitFilters.Actors) !== 0) {
      if (isRevert) {
        // For reverts, place the original actors back exactly as they were
        const originalPreviews: EditorActorPreview[] = []
        for (const [, preview] of source.actors) {
          originalPreviews.push(preview)
        }
        this.editorActorLayer.addRangePreviews(originalPreviews)
      } else {
        // Create copies of the original actors, update their locations, and place
        const copies: ActorReferenceMap[] = []
        for (const [, actorPreview] of source.actors) {
          const copy = actorPreview.export()
          const locationInit = copy.get('LocationInit') as LocationInit | undefined
          if (locationInit) {
            const actorPosition = CPos.add(locationInit.value, blitVec)
            if (this.respectBounds && !this.map.contains(actorPosition))
              continue

            copy.delete('LocationInit')
            copy.set('LocationInit', {
              type: 'LocationInit',
              value: actorPosition,
            } satisfies LocationInit)
          }

          copies.push(copy)
        }

        this.editorActorLayer.addRange(copies)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Commit / Revert
  // OpenRA 对照: EditorBlit.Commit() / EditorBlit.Revert()
  // -------------------------------------------------------------------------

  /** Apply the blit data to the map.
   *
   * OpenRA 对照: EditorBlit.Commit()
   */
  commit(): void {
    this.blit(false)
  }

  /** Undo the blit, restoring original map data.
   *
   * OpenRA 对照: EditorBlit.Revert()
   */
  revert(): void {
    this.blit(true)
  }

  // -------------------------------------------------------------------------
  // TileCount / ActorCount
  // OpenRA 对照: EditorBlit.TileCount() / EditorBlit.ActorCount()
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // PreviewBlitSource (static)
  // OpenRA 对照: EditorBlit.PreviewBlitSource(EditorBlitSource, MapBlitFilters, CVec, WorldRenderer, bool)
  // -------------------------------------------------------------------------

  /**
   * Generate preview renderables showing what a blit source would look like
   * at a target offset position.
   *
   * OpenRA 对照: EditorBlit.PreviewBlitSource()
   *
   * Returns an empty array in Phase B. Full implementation requires:
   *
   * TODO-21.B.6-DEFER-1: ITiledTerrainRenderer.RenderPreview() for terrain tile
   *   preview meshes. The terrain renderer is not yet migrated — render preview
   *   calls will need ColorRamp-based tinting at the cell center WPos.
   *
   * TODO-21.B.6-DEFER-2: IResourceRenderer.RenderPreview() for resource deposit
   *   preview visuals (billboard sprites or colored quads at cell positions).
   *
   * TODO-21.B.6-DEFER-3: CellLayerUtils.CPosToWPos() and CVecToWVec() for
   *   converting cell coordinates to 3D world-space positions for preview
   *   placement. These live in the unmigrated MapGenerator namespace.
   *
   * @param _blitSource — the blit source to preview
   * @param _filters — which categories to preview (terrain/resources/actors)
   * @param _offset — cell offset to apply (target - source top-left)
   * @param _wr — the world renderer (for terrain/resource/actor render trait access)
   * @param _stickToGround — if true, use ground height; if false, preserve source heights
   * @returns empty array (stub — full preview pending deferred renderer migrations)
   */
  static previewBlitSource(
    _blitSource: EditorBlitSource,
    _filters: MapBlitFilters,
    _offset: CVec,
    _wr: unknown,
    _stickToGround: boolean,
  ): readonly unknown[] {
    // TODO-21.B.6-DEFER-1/2/3: Full preview pipeline
    return []
  }

  // -------------------------------------------------------------------------
  // TileCount / ActorCount
  // OpenRA 对照: EditorBlit.TileCount() / EditorBlit.ActorCount()
  // -------------------------------------------------------------------------

  /** Number of tiles in the commit blit source.
   *
   * OpenRA 对照: EditorBlit.TileCount()
   */
  tileCount(): number {
    return this.commitBlitSource.tiles.size
  }

  /** Number of actors in the commit blit source.
   *
   * OpenRA 对照: EditorBlit.ActorCount()
   */
  actorCount(): number {
    return this.commitBlitSource.actors.size
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Check if an editor actor preview's footprint overlaps the given mask.
   *
   * OpenRA 对照: preview.Footprint.Keys.Any(mask.Contains)
   *
   * @param preview — the actor preview to check
   * @param mask — a Set of CPos.Bits values
   * @returns true if at least one footprint cell is in the mask
   */
  private static _actorFootprintOverlapsMask(
    preview: EditorActorPreview,
    mask: ReadonlySet<number>,
  ): boolean {
    for (const [cpos] of preview.footprint) {
      if (mask.has(cpos.Bits)) return true
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// EditorActorLayerBlitInterface — minimal interface for EditorActorLayer
// OpenRA 对照: The subset of EditorActorLayer methods used by EditorBlit
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the EditorActorLayer that EditorBlit needs.
 *
 * OpenRA 对照: EditorActorLayer (subset: PreviewsInCellRegion, RemoveRegion, AddRange)
 *
 * Extracted as an interface to allow unit testing with mock actor layers.
 */
export interface EditorActorLayerBlitInterface {
  /** Get all previews in a cell region.
   *
   * OpenRA 对照: EditorActorLayer.PreviewsInCellRegion(CellCoordsRegion)
   */
  previewsInCellRegion(region: CellCoordsRegion): EditorActorPreview[]

  /** Remove actors in a region that overlap the given mask.
   *
   * OpenRA 对照: EditorActorLayer.RemoveRegion(CellCoordsRegion, HashSet<CPos>)
   *
   * @param region — the region to check
   * @param mask — Set of CPos.Bits values for overlap testing
   */
  removeRegionWithMask(region: CellCoordsRegion, mask: ReadonlySet<number>): void

  /** Add actors from actor references (auto-generates names).
   *
   * OpenRA 对照: EditorActorLayer.AddRange(ReadOnlySpan<ActorReference>)
   */
  addRange(references: readonly ActorReferenceMap[]): void

  /** Add pre-built editor actor previews (for revert).
   *
   * OpenRA 对照: EditorActorLayer.AddRange(ReadOnlySpan<EditorActorPreview>)
   */
  addRangePreviews(previews: readonly EditorActorPreview[]): void
}
