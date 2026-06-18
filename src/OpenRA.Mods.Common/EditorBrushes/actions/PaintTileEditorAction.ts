/**
 * PaintTileEditorAction.ts — Single template placement undo/redo action
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.cs
 *   sealed class PaintTileEditorAction : IEditorAction (lines 172-242)
 *
 * 核心范式转换:
 * - C# Queue<UndoTile>.Enqueue/Dequeue → TS Array + index cursor (O(1) dequeue)
 * - C# Game.CosmeticRandom → Math.random()
 * - C# FluentProvider.GetMessage → template literal
 *
 * Migration:  — Chapter 21 Phase B Wave 2
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import type { IEditorAction } from '../../Traits/World/EditorActionManager.js'
import type { UndoTile } from '../types.js'
import type {
  TerrainTemplateInfoStub,
  ITemplatedTerrainInfoStub,
  EditorMapStub,
} from '../TerrainStubs.js'

// ---------------------------------------------------------------------------
// Clamp utility
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// PaintTileEditorAction
// OpenRA 对照: sealed class PaintTileEditorAction : IEditorAction
// ---------------------------------------------------------------------------

/**
 * Paints a single terrain template placement onto the map.
 *
 * OpenRA 对照: PaintTileEditorAction (inner class in EditorTileBrush.cs)
 *
 * Iterates the template grid (size.X x size.Y), setting each contained
 * tile's terrain tile and height. Stores undo data (original tiles/heights)
 * in a queue for restoration on undo.
 *
 * Supports PickAny mode: randomly selects tile variants using Math.random().
 */
export class PaintTileEditorAction implements IEditorAction {
  /** Human-readable action description. */
  readonly text: string

  private readonly template: number
  private readonly map: EditorMapStub
  private readonly cell: CPos

  /** Undo tiles buffer. Use an index cursor for O(1) dequeue instead of shift(). */
  private readonly undoTiles: UndoTile[] = []
  private _undoIndex: number = 0

  /** The terrain template info. */
  private readonly terrainTemplate: TerrainTemplateInfoStub

  /**
   * Create a new PaintTileEditorAction.
   *
   * @param template — the template ID to paint
   * @param map — the map to paint onto
   * @param cell — the top-left cell where the template is placed
   */
  constructor(template: number, map: EditorMapStub, cell: CPos) {
    this.template = template
    this.map = map
    this.cell = cell

    const rules = (map as unknown as { rules: { terrainInfo: ITemplatedTerrainInfoStub } }).rules
    const terrainInfo = rules.terrainInfo
    const tmpl = terrainInfo.templates.get(template)
    if (!tmpl) {
      throw new Error(`Template with ID ${template} not found`)
    }
    this.terrainTemplate = tmpl
    this.text = `Added tile template: ${this.terrainTemplate.id}`
  }

  execute(): void {
    this.redo()
  }

  redo(): void {
    const mapTiles = this.map.tiles
    const mapHeight = this.map.height
    const baseHeight = mapHeight.contains(this.cell) ? mapHeight.get(this.cell) : 0

    let i = 0
    for (let y = 0; y < this.terrainTemplate.size.y; y++) {
      for (let x = 0; x < this.terrainTemplate.size.x; x++, i++) {
        if (
          !this.terrainTemplate.contains(i) ||
          this.terrainTemplate.tileAt(i) === null
        ) {
          continue
        }

        const tileInfo = this.terrainTemplate.tileAt(i)!
        const index = this.terrainTemplate.pickAny
          ? Math.floor(Math.random() * this.terrainTemplate.tilesCount)
          : i

        const c = CPos.add(this.cell, new CVec(x, y))
        if (!mapTiles.contains(c)) continue

        this.undoTiles.push({
          cell: c,
          mapTile: { type: mapTiles.get(c).type, index: mapTiles.get(c).index },
          height: mapHeight.get(c),
        })

        mapTiles.set(c, { type: this.template, index })
        mapHeight.set(
          c,
          clamp(
            baseHeight + tileInfo.height,
            0,
            this.map.grid.maximumTerrainHeight,
          ),
        )
      }
    }
  }

  /**
   * Undo the paint operation — restores original tiles and heights.
   * Uses index cursor for O(1) dequeue instead of O(N) shift().
   */
  undo(): void {
    const mapTiles = this.map.tiles
    const mapHeight = this.map.height

    while (this._undoIndex < this.undoTiles.length) {
      const undoTile = this.undoTiles[this._undoIndex++]
      mapTiles.set(undoTile.cell, undoTile.mapTile)
      mapHeight.set(undoTile.cell, undoTile.height)
    }
  }
}
