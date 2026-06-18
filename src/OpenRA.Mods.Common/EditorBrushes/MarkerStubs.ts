/**
 * MarkerStubs.ts — Minimal stub interface for MarkerLayerOverlay (待迁移)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/MarkerLayerOverlay.cs (~350 lines C#)
 *
 * 核心范式转换:
 * - C# MarkerLayerOverlay trait → TypeScript IMarkerLayer interface (stub)
 * - C# CellLayer<int?> → Map<string, number | null> (in-memory)
 * - C# Dictionary<int, CPos[]> → Map<number, readonly CPos[]>
 * - C# CalculateMirrorPositions → stub returning just the cell (mirror mode deferred)
 *
 * MarkerLayerOverlay is a large editor trait providing marker annotation on a
 * special overlay layer. Full migration is deferred (TODO-21.B.2-DEFER-8).
 * For Phase B testing, this stub interface provides minimal in-memory storage
 * and mirror-like behavior.
 *
 * Migration: TODO-21.B.8 — Chapter 21 Phase B Wave 3
 */

import type { CPos } from '../../OpenRA.Game/CPos.js'
import { cposKey } from './types.js'

// ---------------------------------------------------------------------------
// IMarkerLayer — minimal interface for marker layer operations
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the marker layer overlay.
 *
 * OpenRA 对照: MarkerLayerOverlay (subset used by EditorMarkerLayerBrush)
 *
 * Provides setters and getters for marker cells, plus mirror position
 * calculation for symmetric map editing.
 */
export interface IMarkerLayer {
  /** Set a marker tile at the given cell.
   *
   * OpenRA 对照: MarkerLayerOverlay.SetTile(CPos, int?)
   */
  setTile(cell: CPos, type: number | null): void

  /** Get the marker tile at the given cell.
   *
   * OpenRA 对照: MarkerLayerOverlay.CellLayer[cell] indexer
   */
  getTile(cell: CPos): number | null

  /** Calculate mirror positions for a given cell (for symmetric maps).
   *
   * OpenRA 对照: MarkerLayerOverlay.CalculateMirrorPositions(CPos)
   */
  calculateMirrorPositions(cell: CPos): CPos[]

  /** Clear all markers of a given type.
   *
   * OpenRA 对照: MarkerLayerOverlay.ClearSelected(int tile)
   */
  clearSelected(tile: number): void

  /** Clear all marker types.
   *
   * OpenRA 对照: MarkerLayerOverlay.ClearAll()
   */
  clearAll(): void

  /** Set all cells for a given marker type (batch restore).
   *
   * OpenRA 对照: MarkerLayerOverlay.SetSelected(int tile, ReadOnlySpan<CPos>)
   */
  setSelected(tile: number, cells: readonly CPos[]): void

  /** Set all marker cells (batch restore after ClearAll).
   *
   * OpenRA 对照: MarkerLayerOverlay.SetAll(FrozenDictionary<int, ImmutableArray<CPos>>)
   */
  setAll(tiles: ReadonlyMap<number, readonly CPos[]>): void

  /** Get all marker cells grouped by type.
   *
   * OpenRA 对照: MarkerLayerOverlay.Tiles property
   */
  readonly tiles: ReadonlyMap<number, readonly CPos[]>
}

// ---------------------------------------------------------------------------
// InMemoryMarkerLayer — simple in-memory implementation for testing
// ---------------------------------------------------------------------------

/**
 * Simple in-memory implementation of IMarkerLayer for unit testing.
 *
 * Uses a Map<string, number|null> for cell storage and Map<number, CPos[]>
 * for type-grouped tile lists. Mirror positions are defaulted to just the
 * original cell (no symmetric map mirroring in the stub).
 */
export class InMemoryMarkerLayer implements IMarkerLayer {
  private readonly _cells = new Map<string, number | null>()
  private readonly _tiles = new Map<number, CPos[]>()

  // ---- Cell-level operations ----

  setTile(cell: CPos, type: number | null): void {
    const key = cposKey(cell)
    const old = this._cells.get(key)

    // Remove from old type list
    if (old !== undefined && old !== null) {
      const arr = this._tiles.get(old)
      if (arr) {
        const idx = arr.findIndex((c) => cposKey(c) === key)
        if (idx >= 0) arr.splice(idx, 1)
      }
    }

    // Set new value
    if (type === null) {
      this._cells.delete(key)
    } else {
      this._cells.set(key, type)

      // Add to type list
      let arr = this._tiles.get(type)
      if (!arr) {
        arr = []
        this._tiles.set(type, arr)
      }
      // Avoid duplicates
      if (!arr.some((c) => cposKey(c) === key)) {
        arr.push(cell)
      }
    }
  }

  getTile(cell: CPos): number | null {
    const val = this._cells.get(cposKey(cell))
    return val === undefined ? null : val
  }

  // ---- Mirror positions (stub — returns only the cell itself) ----

  calculateMirrorPositions(cell: CPos): CPos[] {
    // TODO-21.B.2-DEFER-8: Implement full mirror mode calculation
    // For now, return just the original cell (no symmetric mirroring)
    return [cell]
  }

  // ---- Batch operations ----

  clearSelected(tile: number): void {
    const arr = this._tiles.get(tile)
    if (!arr) return
    for (const cell of [...arr]) {
      this._cells.delete(cposKey(cell))
    }
    this._tiles.delete(tile)
  }

  clearAll(): void {
    this._cells.clear()
    this._tiles.clear()
  }

  setSelected(tile: number, cells: readonly CPos[]): void {
    // Clear existing
    this.clearSelected(tile)
    // Set all
    const arr: CPos[] = []
    for (const cell of cells) {
      this._cells.set(cposKey(cell), tile)
      arr.push(cell)
    }
    this._tiles.set(tile, arr)
  }

  setAll(tiles: ReadonlyMap<number, readonly CPos[]>): void {
    this._cells.clear()
    this._tiles.clear()
    for (const [tile, cells] of tiles) {
      const arr: CPos[] = []
      for (const cell of cells) {
        this._cells.set(cposKey(cell), tile)
        arr.push(cell)
      }
      this._tiles.set(tile, arr)
    }
  }

  get tiles(): ReadonlyMap<number, readonly CPos[]> {
    return this._tiles
  }
}
