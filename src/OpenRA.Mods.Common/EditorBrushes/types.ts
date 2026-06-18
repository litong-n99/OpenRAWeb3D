/**
 * types.ts — Editor brush shared data structures
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/ (multiple files)
 *
 * 核心范式转换:
 * - C# EditorSelection (class in EditorDefaultBrush.cs) → TypeScript EditorSelection class
 * - C# [Flags] MapBlitFilters → TypeScript numeric const enum
 * - C# record struct BlitTile / EditorBlitSource → TypeScript interfaces
 * - C# record struct UndoTile (EditorTileBrush.cs) → TypeScript interface
 * - C# record struct CellResource (EditorResourceBrush.cs) → TypeScript interface
 * - C# readonly struct PaintMarkerTile (EditorMarkerLayerBrush.cs) → TypeScript interface
 * - C# EditorDefaultBrush.setSelection/selection → TypeScript ISelectionController interface
 *
 * Migration:  — Chapter 21 Phase B
 */

import type { CPos } from '../../OpenRA.Game/CPos.js'
import type { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import type { TerrainTile, ResourceTile } from '../../OpenRA.Game/Map/TileReference.js'
import type { EditorActorPreview } from '../Traits/World/EditorActorPreview.js'
import type { ResourceLayerContents } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// ISelectionController — brush selection delegation interface
// ---------------------------------------------------------------------------

/**
 * Interface for controlling the editor brush selection state.
 *
 * OpenRA 对照: EditorDefaultBrush.SetSelection() + EditorDefaultBrush.Selection { get; }
 *
 * Editor actions use this interface to change/restore selection state without
 * depending on the concrete EditorDefaultBrush class (which also handles mouse
 * input, drag, and other concerns). This follows the Dependency Inversion
 * Principle and enables unit testing of actions without the full brush.
 */
export interface ISelectionController {
  /**
   * Replace the current selection.
   *
   * OpenRA 对照: EditorDefaultBrush.SetSelection(EditorSelection selection)
   *
   * @param selection — the new selection state (area, actor, or empty)
   */
  setSelection(selection: EditorSelection): void

  /**
   * The current selection state.
   *
   * OpenRA 对照: EditorDefaultBrush.Selection { get; private set; }
   */
  readonly selection: EditorSelection
}

// ---------------------------------------------------------------------------
// MapBlitFilters — flags for controlling what gets copied/deleted
// ---------------------------------------------------------------------------

/**
 * Bit flags controlling which map data categories are affected by a blit or
 * delete operation.
 *
 * OpenRA 对照: [Flags] MapBlitFilters { None=0, Terrain=1, Resources=2, Actors=4, All=7 }
 */
export const MapBlitFilters = {
  None: 0,
  Terrain: 1 << 0,
  Resources: 1 << 1,
  Actors: 1 << 2,
  All: (1 << 0) | (1 << 1) | (1 << 2),
} as const

export type MapBlitFilters = number

// ---------------------------------------------------------------------------
// EditorSelection
// ---------------------------------------------------------------------------

/**
 * Represents the current editor selection state (area, actor, or none).
 *
 * OpenRA 对照: EditorSelection { CellCoordsRegion? Area; EditorActorPreview Actor; bool HasSelection }
 *
 * This is a mutable data holder — the EditorDefaultBrush mutates the `area`
 * and `actor` fields directly during mouse input handling.
 */
export class EditorSelection {
  /** Selected region (drag selection box), or null if no area selection.
   *
   * OpenRA 对照: EditorSelection.Area
   */
  area: CellCoordsRegion | null = null

  /** Selected actor preview, or null if no actor selected.
   *
   * OpenRA 对照: EditorSelection.Actor
   */
  actor: EditorActorPreview | null = null

  /** Whether any selection exists.
   *
   * OpenRA 对照: EditorSelection.HasSelection => Area.HasValue || Actor != null
   */
  get hasSelection(): boolean {
    return this.area !== null || this.actor !== null
  }
}

// ---------------------------------------------------------------------------
// BlitTile — snapshot of a single cell for copy/paste/undo
// ---------------------------------------------------------------------------

/**
 * Snapshot of a single map cell's state for undo/redo within blit operations.
 *
 * OpenRA 对照: readonly record struct BlitTile(TerrainTile TerrainTile, ResourceTile ResourceTile, ResourceLayerContents? ResourceLayerContents, byte Height)
 *
 * Captures the terrain tile, resource map tile, editor resource layer contents,
 * and elevation at a single cell. Used by CopyRegionContents() and the commit/revert
 * blit engine.
 */
export interface BlitTile {
  /** Terrain tile (template id + tile index). */
  readonly terrainTile: TerrainTile
  /** Resource map tile (type byte + density). */
  readonly resourceTile: ResourceTile
  /** Editor resource layer contents (type name + density), or null if none. */
  readonly resourceLayerContents: ResourceLayerContents | null
  /** Terrain elevation at this cell (byte, 0-255). */
  readonly height: number
}

// ---------------------------------------------------------------------------
// EditorBlitSource — complete region snapshot
// ---------------------------------------------------------------------------

/**
 * Complete snapshot of a rectangular map region for copy/paste/undo operations.
 *
 * OpenRA 对照: readonly record struct EditorBlitSource(CellCoordsRegion CellCoords, Dictionary<string, EditorActorPreview> Actors, Dictionary<CPos, BlitTile> Tiles)
 *
 * Contains the bounding region, captured actor previews (keyed by actor ID),
 * and captured tile data (keyed by "X,Y" string cell positions).
 * The tiles map is sparse — only cells that actually contain blit data are included.
 */
export interface EditorBlitSource {
  /** The source region bounds (inclusive on both ends). */
  readonly cellCoords: CellCoordsRegion
  /** Captured actor previews, keyed by actor ID string. */
  readonly actors: ReadonlyMap<string, EditorActorPreview>
  /** Captured tile data, keyed by "X,Y" cell position strings (sparse — only occupied cells). */
  readonly tiles: ReadonlyMap<string, BlitTile>
}

// ---------------------------------------------------------------------------
// UndoTile — undo data for tile brush operations
// ---------------------------------------------------------------------------

/**
 * Captures the previous tile state for a single cell before a brush operation.
 *
 * OpenRA 对照: sealed record UndoTile(CPos Cell, TerrainTile MapTile, byte Height)
 *   (defined in EditorTileBrush.cs line 382)
 *
 * Used by PaintTileEditorAction and FloodFillEditorAction to restore cells
 * on undo. Only stores the OLD values — the new tile is determined by the
 * brush template, not stored per-cell.
 */
export interface UndoTile {
  /** The cell position being modified.
   *
   * OpenRA 对照: UndoTile.Cell
   */
  readonly cell: CPos

  /** The terrain tile before the brush operation.
   *
   * OpenRA 对照: UndoTile.MapTile (TerrainTile: ushort Type, byte Index)
   */
  readonly mapTile: TerrainTile

  /** The terrain height before the brush operation.
   *
   * OpenRA 对照: UndoTile.Height (byte)
   */
  readonly height: number
}

// ---------------------------------------------------------------------------
// CellResource — undo data for resource brush operations
// ---------------------------------------------------------------------------

/**
 * Captures the previous resource state for a single cell before a resource
 * brush operation.
 *
 * OpenRA 对照: readonly record struct CellResource(CPos Cell, ResourceLayerContents OldResourceTile)
 *   (defined in EditorResourceBrush.cs line 111)
 *
 * Used by AddResourcesEditorAction to accumulate cells modified in a single
 * brush stroke. Each entry stores the cell position and the previous resource
 * contents so undo can restore them.
 */
export interface CellResource {
  /** The cell position being modified.
   *
   * OpenRA 对照: CellResource.Cell
   */
  readonly cell: CPos

  /** The resource contents before the brush operation.
   *
   * OpenRA 对照: CellResource.OldResourceTile (ResourceLayerContents)
   */
  readonly oldResourceTile: ResourceLayerContents
}

// ---------------------------------------------------------------------------
// PaintMarkerTile — undo data for marker layer brush operations
// ---------------------------------------------------------------------------

/**
 * Captures the previous marker state for a single cell before a marker brush
 * operation.
 *
 * OpenRA 对照: readonly struct PaintMarkerTile(CPos Cell, int? Previous)
 *   (defined in EditorMarkerLayerBrush.cs lines 131-141)
 *
 * Used by PaintMarkerTileEditorAction to restore marker values on undo.
 * `previous` is null if the cell had no marker before the brush stroke.
 */
export interface PaintMarkerTile {
  /** The cell position being modified.
   *
   * OpenRA 对照: PaintMarkerTile.Cell
   */
  readonly cell: CPos

  /** The marker value at this cell before the brush operation, or null.
   *
   * OpenRA 对照: PaintMarkerTile.Previous (int?)
   */
  readonly previous: number | null
}

// ---------------------------------------------------------------------------
// Helper: encode CPos to a string key "X,Y"
// ---------------------------------------------------------------------------

/**
 * Encode a CPos to a string key "X,Y" for Map-based storage.
 *
 * OpenRA 对照: implicit cell → key conversion via CellLayer index
 *
 * Used by BlitTile dictionaries and DeleteAreaAction undo snapshots.
 *
 * @param cell — the cell position
 * @returns a deterministic string key
 */
export function cposKey(cell: CPos): string {
  return `${cell.X},${cell.Y}`
}
