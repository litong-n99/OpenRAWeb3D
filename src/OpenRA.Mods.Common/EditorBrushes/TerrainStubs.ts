/**
 * TerrainStubs.ts — Stub interfaces for unmigrated terrain dependencies
 * OpenRA 对照: OpenRA.Mods.Common/Terrain/ITemplatedTerrainInfo.cs,
 *   OpenRA.Mods.Common/Terrain/ITiledTerrainRenderer.cs,
 *   OpenRA.Mods.Common/Terrain/TerrainTemplateInfo.cs
 *
 * 核心范式转换:
 * - C# ITemplatedTerrainInfo / ITiledTerrainRenderer (full terrain system)
 *   → TypeScript minimal stub interfaces with TODO markers
 * - C# TerrainTemplateInfo class → TypeScript interface stub
 * - C# CellLayer<T> checked Contains(cell) → explicit bounds checking
 *
 * These stubs are minimal interfaces needed by EditorTileBrush to compile
 * and unit-test. Full terrain template/renderer migration is deferred to
 * a future chapter (MapGenerator namespace).
 *
 * Migration:  — Chapter 21 Phase B Wave 2
 */

import type { CPos } from '../../OpenRA.Game/CPos.js'
import type { WPos } from '../../OpenRA.Game/WPos.js'
import type { TerrainTile } from '../../OpenRA.Game/Map/TileReference.js'
import type { WorldRendererStub, IRenderable } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// TerrainTemplateInfo stub (对应 OpenRA TerrainTemplateInfo)
// ---------------------------------------------------------------------------

/**
 * Stub: Template-based terrain tile info. Describes a multi-cell template
 * pattern that can be painted by the tile brush.
 *
 * OpenRA 对照: TerrainTemplateInfo class
 *
 * Only the properties actually used by EditorTileBrush are modeled here.
 * Full template data (Images, Tiles array, PickAny, PickAnyVariations, etc.)
 * is deferred until the TerrainInfo template system is migrated.
 *
 * TODO-21.B.2-DEFER-1: Replace with full TerrainTemplateInfo from TerrainInfo
 */
export interface TerrainTemplateInfoStub {
  /** Template ID (ushort in C#). */
  readonly id: number
  /** Template size in cells. */
  readonly size: { readonly x: number; readonly y: number }
  /** Check if this template contains tile index `i` (0-based row-major). */
  contains(index: number): boolean
  /** Get the TerrainTileInfo at index `i`, or null. */
  tileAt(index: number): TerrainTileInfoStub | null
  /** If true, pick a random tile variant on placement. */
  readonly pickAny: boolean
  /** Number of tile variants (used when PickAny=true). */
  readonly tilesCount: number
}

/**
 * Stub: Single tile within a terrain template.
 *
 * OpenRA 对照: TerrainTileInfo
 */
export interface TerrainTileInfoStub {
  /** Height offset of this tile from the template base. */
  readonly height: number
  /** Template ID (ushort in C#). */
  readonly template: number
  /** Tile index within the template. */
  readonly tile: number
}

// ---------------------------------------------------------------------------
// ITemplatedTerrainInfo stub (对应 OpenRA ITemplatedTerrainInfo)
// ---------------------------------------------------------------------------

/**
 * Stub: Terrain info that provides template data.
 *
 * OpenRA 对照: ITemplatedTerrainInfo
 *
 * EditorTileBrush checks that the terrain info implements this interface and
 * uses it to look up templates by ID.
 *
 * TODO-21.B.2-DEFER-1: Replace with full ITemplatedTerrainInfo from TerrainInfo
 */
export interface ITemplatedTerrainInfoStub {
  /** Map of template ID to template info. */
  readonly templates: ReadonlyMap<number, TerrainTemplateInfoStub>
}

// ---------------------------------------------------------------------------
// ITiledTerrainRenderer stub (对应 OpenRA ITiledTerrainRenderer)
// ---------------------------------------------------------------------------

/**
 * Stub: Terrain renderer that can produce brush previews.
 *
 * OpenRA 对照: ITiledTerrainRenderer
 *
 * EditorTileBrush uses this to render a preview of the template at the
 * cursor position.
 *
 * TODO-21.B.2-DEFER-1: Replace with full ITiledTerrainRenderer
 */
export interface ITiledTerrainRendererStub {
  /**
   * Generate render previews for a template at the given world position.
   *
   * OpenRA 对照: ITiledTerrainRenderer.RenderPreview(wr, template, wPos)
   *
   * @param _wr — the world renderer
   * @param _template — the terrain template to preview
   * @param _pos — world position where the preview is centered
   * @returns array of renderable objects for the preview
   */
  renderPreview(
    _wr: WorldRendererStub,
    _template: TerrainTemplateInfoStub,
    _pos: WPos,
  ): readonly IRenderable[]
}

// ---------------------------------------------------------------------------
// EditorMapStub — minimal map interface for tile brush operations
// ---------------------------------------------------------------------------

/**
 * Stub: Map interface exposing terrain tile and height access.
 *
 * OpenRA 对照: Map class (Tiles, Height, Contains, Grid, CenterOfCell)
 *
 * Only the properties and methods actually used by EditorTileBrush are modeled.
 *
 * TODO-21.B.2-DEFER-1: Replace with full Map interface from Ch4
 */
export interface EditorMapStub {
  /** Terrain tile layer (cell → TerrainTile). */
  readonly tiles: EditorTileLayerStub
  /** Height layer (cell → byte). */
  readonly height: EditorHeightLayerStub
  /** Check if a cell is within the map bounds. */
  contains(cell: CPos): boolean
  /** Map grid constants. */
  readonly grid: { readonly maximumTerrainHeight: number }
  /** Get the world-space center of a map cell. */
  centerOfCell(cell: CPos): WPos
}

/**
 * Stub: Tile layer indexed by cell position.
 *
 * OpenRA 对照: CellLayer<TerrainTile>
 */
export interface EditorTileLayerStub {
  /** Check if a cell has a tile entry. */
  contains(cell: CPos): boolean
  /** Get the tile at a cell. */
  get(cell: CPos): TerrainTile
  /** Set the tile at a cell. */
  set(cell: CPos, tile: TerrainTile): void
}

/**
 * Stub: Height layer indexed by cell position.
 *
 * OpenRA 对照: CellLayer<byte>
 */
export interface EditorHeightLayerStub {
  /** Check if a cell has a height entry. */
  contains(cell: CPos): boolean
  /** Get the height at a cell. */
  get(cell: CPos): number
  /** Set the height at a cell. */
  set(cell: CPos, height: number): void
}
