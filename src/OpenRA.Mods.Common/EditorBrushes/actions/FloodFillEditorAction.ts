/**
 * FloodFillEditorAction.ts — BFS flood fill undo/redo action for terrain tiles
 * OpenRA 对照: OpenRA.Mods.Common/EditorBrushes/EditorTileBrush.cs
 *   sealed class FloodFillEditorAction : IEditorAction (lines 244-380)
 *
 * 核心范式转换:
 * - C# CellLayer<bool> visited tracking → Uint8Array (one byte per cell, less overhead)
 * - C# Queue<UndoTile>.Enqueue/Dequeue → TS Array + index cursor (O(1) dequeue)
 * - C# Queue<CPos> → TS Array (push/shift matches Enqueue/Dequeue semantics)
 * - C# Game.CosmeticRandom → Math.random()
 * - C# FluentProvider.GetMessage → template literal
 *
 * Migration: TODO-21.B.3 — Chapter 21 Phase B Wave 2
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
// FloodFillEditorAction
// OpenRA 对照: sealed class FloodFillEditorAction : IEditorAction
// ---------------------------------------------------------------------------

/**
 * Flood fill a contiguous region of same-type terrain tiles with the brush
 * template.
 *
 * Uses a BFS algorithm with a Uint8Array visited tracker (replacing C#
 * CellLayer<bool>). The algorithm scans horizontally to find the left and
 * right extent of matching cells at each BFS step, then paints the whole
 * horizontal span and enqueues vertical neighbors for further expansion.
 *
 * PERF: Uint8Array replaces C# CellLayer<bool> for efficient memory usage.
 */
export class FloodFillEditorAction implements IEditorAction {
  readonly text: string

  private readonly template: number
  private readonly map: EditorMapStub
  private readonly cell: CPos

  /** Undo tiles buffer. Use an index cursor for O(1) dequeue instead of shift(). */
  private readonly undoTiles: UndoTile[] = []
  private _undoIndex: number = 0

  private readonly terrainTemplate: TerrainTemplateInfoStub
  private readonly gridWidth: number
  private readonly gridHeight: number

  /**
   * Create a new FloodFillEditorAction.
   *
   * @param template — the template ID to flood fill with
   * @param map — the map to operate on
   * @param cell — the starting cell for flood fill
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

    const mapExt = map as unknown as { allCells?: CPos[] }
    if (mapExt.allCells?.length) {
      let maxX = 0
      let maxY = 0
      for (const c of mapExt.allCells) {
        if (c.X > maxX) maxX = c.X
        if (c.Y > maxY) maxY = c.Y
      }
      this.gridWidth = maxX + 1
      this.gridHeight = maxY + 1
    } else {
      this.gridWidth = 256
      this.gridHeight = 256
    }

    this.text = `Flood filled tile: ${this.terrainTemplate.id}`
  }

  execute(): void {
    this.redo()
  }

  /**
   * Apply the flood fill using BFS with horizontal span scanning.
   */
  redo(): void {
    const mapTiles = this.map.tiles
    const replace = mapTiles.get(this.cell)

    // Uint8Array as a boolean visited tracker (0 = untouched, 1 = visited)
    const touched = new Uint8Array(this.gridWidth * this.gridHeight)
    const getIndex = (c: CPos): number => c.Y * this.gridWidth + c.X

    // BFS queue
    const queue: CPos[] = []

    // NOTE: C# checks `map.Contains(cell)` here — a probable upstream bug
    // that captures the start cell from the constructor closure instead of
    // `newCell`. TS correctly checks the parameter `newCell`.
    const maybeEnqueue = (newCell: CPos): void => {
      if (this.map.contains(newCell) && touched[getIndex(newCell)] === 0) {
        queue.push(newCell)
        touched[getIndex(newCell)] = 1
      }
    }

    const shouldPaint = (cellToCheck: CPos): boolean => {
      for (let y = 0; y < this.terrainTemplate.size.y; y++) {
        for (let x = 0; x < this.terrainTemplate.size.x; x++) {
          const c = CPos.add(cellToCheck, new CVec(x, y))
          if (!this.map.contains(c) || mapTiles.get(c).type !== replace.type) {
            return false
          }
        }
      }
      return true
    }

    const findEdge = (refCell: CPos, direction: CVec): CPos => {
      let current = refCell
      while (true) {
        const newCell = CPos.add(current, direction)
        if (!shouldPaint(newCell)) return current
        current = newCell
      }
    }

    const paintSingleCell = (cellToPaint: CPos): void => {
      const baseHeight = this.map.height.contains(cellToPaint)
        ? this.map.height.get(cellToPaint)
        : 0

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

          const c = CPos.add(cellToPaint, new CVec(x, y))
          if (!mapTiles.contains(c)) continue

          this.undoTiles.push({
            cell: c,
            mapTile: { type: mapTiles.get(c).type, index: mapTiles.get(c).index },
            height: this.map.height.get(c),
          })

          mapTiles.set(c, { type: this.template, index })
          this.map.height.set(
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

    queue.push(this.cell)
    touched[getIndex(this.cell)] = 1

    while (queue.length > 0) {
      const queuedCell = queue.shift()!
      if (!shouldPaint(queuedCell)) continue

      const previousCell = findEdge(
        queuedCell,
        new CVec(-1 * this.terrainTemplate.size.x, 0),
      )
      const nextCell = findEdge(
        queuedCell,
        new CVec(1 * this.terrainTemplate.size.x, 0),
      )

      for (let x = previousCell.X; x <= nextCell.X; x += this.terrainTemplate.size.x) {
        paintSingleCell(new CPos(x, queuedCell.Y))

        const upperCell = new CPos(x, queuedCell.Y - 1 * this.terrainTemplate.size.y)
        const lowerCell = new CPos(x, queuedCell.Y + 1 * this.terrainTemplate.size.y)

        if (shouldPaint(upperCell)) maybeEnqueue(upperCell)
        if (shouldPaint(lowerCell)) maybeEnqueue(lowerCell)
      }
    }
  }

  /**
   * Undo the flood fill — restores all original tiles and heights.
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
