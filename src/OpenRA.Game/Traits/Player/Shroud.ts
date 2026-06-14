/**
 * Shroud.ts — Per-player visibility state tracker (fog of war)
 * OpenRA 对照: OpenRA.Game/Traits/Player/Shroud.cs
 *
 * 核心范式转换:
 * - C# ProjectedCellLayer<short> count arrays → Int16Array direct indexing (no JS boxing)
 * - C# ProjectedCellLayer<bool> / ProjectedCellLayer<ShroudCellType> → Uint8Array
 * - C# Span.IndexOf(true) dirty scan → TypedArray.indexOf(1) loop
 * - C# event Action<PPos> → callback field onShroudChanged: ((puv: PPos) => void) | null
 * - C# Dictionary<object, ShroudSource> → Map<unknown, ShroudSource>
 * - C# Actor.World.Map reference → stored map + worldTick for sync hash
 */

import { PPos, MPos } from '../../MPos'
import { CPos } from '../../CPos'
import { WPos } from '../../WPos'
import { WDist } from '../../WDist'
import { Map as GameMap } from '../../Map/Map'
import {
  type ISync,
  type INotifyCreated,
  type ITick,
  type IGameActor,
} from '../TraitsInterfaces'
import { HashPlayer } from '../../Sync'
import { WinState } from '../../Player'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Source type for shroud visibility accounting.
 *
 * OpenRA 对照: Shroud.SourceType
 */
export const SourceType = {
  PassiveVisibility: 0,
  Shroud: 1,
  Visibility: 2,
} as const

export type SourceType = (typeof SourceType)[keyof typeof SourceType]

/** Combined visibility state per cell (bitflags).
 *
 * OpenRA 对照: Shroud.CellVisibility
 *
 * NOTE: Visible is NOT a superset of Explored. IsExplored may return false
 * even if IsVisible returns true.
 */
export const CellVisibility = {
  Hidden: 0x0,
  Explored: 0x1,
  Visible: 0x2,
} as const

export type CellVisibility = (typeof CellVisibility)[keyof typeof CellVisibility]

/** Internal resolved cell type (shroud/fog/visible).
 *
 * OpenRA 对照: Shroud.ShroudCellType (private enum)
 */
const ShroudCellType = {
  Shroud: 0,
  Fog: 1,
  Visible: 2,
} as const

type ShroudCellType = (typeof ShroudCellType)[keyof typeof ShroudCellType]

// ---------------------------------------------------------------------------
// ShroudInfo — minimal data class (lobby UI deferred)
// ---------------------------------------------------------------------------

/**
 * Configuration for the Shroud trait.
 *
 * OpenRA 对照: ShroudInfo
 *
 * NOTE: ILobbyOptions fields (checkbox labels, display order) are deferred
 * since the lobby UI is not yet migrated. Only runtime-relevant fields are kept.
 */
export class ShroudInfo {
  /** Default fog enabled state. */
  readonly fogCheckboxEnabled: boolean = true
  /** Default explored map enabled state. */
  readonly exploredMapCheckboxEnabled: boolean = false
}

// ---------------------------------------------------------------------------
// ShroudSource — internal record
// ---------------------------------------------------------------------------

/**
 * A visibility source entry (type + affected cells).
 *
 * OpenRA 对照: Shroud.ShroudSource (readonly record struct)
 */
interface ShroudSource {
  readonly type: SourceType
  readonly projectedCells: readonly PPos[]
}

// ---------------------------------------------------------------------------
// Shroud
// ---------------------------------------------------------------------------

/**
 * Per-player visibility state tracker.
 *
 * OpenRA 对照: Shroud
 *
 * Tracks which cells are hidden (unexplored black), explored (fogged but
 * terrain visible), or fully visible (live units/animations). Each player has
 * an independent Shroud instance. Visibility is source-based with reference
 * counting: multiple RevealsShroud traits can overlap, and removing one
 * source only decrements the count.
 *
 * ## Performance
 * - Count layers use Int16Array (no JS number boxing)
 * - Boolean layers use Uint8Array (0/1 values)
 * - Dirty cell scanning uses TypedArray.indexOf() (equivalent to C# Span.IndexOf)
 * - Hot-path UpdateCell() avoids allocation
 */
export class Shroud implements ISync, INotifyCreated, ITick {
  // -------------------------------------------------------------------------
  // Public state
  // -------------------------------------------------------------------------

  /** Callback fired when a cell's visibility changes.
   *
   * OpenRA 对照: Shroud.OnShroudChanged (event Action<PPos>)
   */
  onShroudChanged: ((puv: PPos) => void) | null = null

  /** Number of currently visible cells.
   *
   * OpenRA 对照: Shroud.RevealedCells
   */
  revealedCells: number = 0

  /** Sync hash for network determinism.
   *
   * OpenRA 对照: Shroud.Hash
   */
  private _hash: number = 0

  get hash(): number {
    return this._hash
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  private readonly _info: ShroudInfo
  private readonly _map: GameMap

  // -------------------------------------------------------------------------
  // Source tracking
  // -------------------------------------------------------------------------

  /** Visibility sources by key object (reference-counted). */
  private readonly _sources = new Map<unknown, ShroudSource>()

  // -------------------------------------------------------------------------
  // Per-cell count layers (Int16Array for performance)
  // -------------------------------------------------------------------------

  /** Passive visibility count per cell (RevealsShroud without generated shroud). */
  private readonly _passiveVisibleCount: Int16Array
  /** Active visibility count per cell. */
  private readonly _visibleCount: Int16Array
  /** Generated shroud count per cell (CreatesShroud). */
  private readonly _generatedShroudCount: Int16Array

  // -------------------------------------------------------------------------
  // Per-cell boolean layers (Uint8Array for performance)
  // -------------------------------------------------------------------------

  /** Whether this cell has ever been explored. */
  private readonly _explored: Uint8Array
  /** Dirty flag — cell needs re-resolution in next Tick(). */
  private readonly _touched: Uint8Array
  /** Whether any cell is currently dirty. */
  private _anyCellTouched: boolean

  // -------------------------------------------------------------------------
  // Resolved cache
  // -------------------------------------------------------------------------

  /** Cached resolved cell type per cell (Shroud/Fog/Visible). */
  private readonly _resolvedType: Uint8Array

  // -------------------------------------------------------------------------
  // Runtime flags
  // -------------------------------------------------------------------------

  /** Whether the shroud is disabled (all cells visible). */
  private _disabled: boolean = false
  /** Whether Disabled changed (needs full re-resolution). */
  private _disabledChanged: boolean = false
  /** Whether fog of war is enabled. */
  private _fogEnabled: boolean = false
  /** Whether the map starts fully explored. */
  private _exploreMapEnabled: boolean = false
  /** Whether any shroud generation source has been added. */
  private _shroudGenerationEnabled: boolean = false
  /** Whether any passive visibility source has been added. */
  private _passiveVisibilityEnabled: boolean = false

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Construct a Shroud trait.
   *
   * OpenRA 对照: Shroud(Actor, ShroudInfo)
   *
   * @param self — the player actor (owner)
   * @param info — shroud configuration
   */
  constructor(self: IGameActor, info: ShroudInfo) {
    this._info = info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._map = (self.world as any).map as GameMap

    const cellCount = this._map.mapSize.width * this._map.mapSize.height

    this._passiveVisibleCount = new Int16Array(cellCount)
    this._visibleCount = new Int16Array(cellCount)
    this._generatedShroudCount = new Int16Array(cellCount)
    this._explored = new Uint8Array(cellCount)
    this._touched = new Uint8Array(cellCount)
    this._anyCellTouched = true

    // Defaults to 0 = ShroudCellType.Shroud
    this._resolvedType = new Uint8Array(cellCount)
  }

  // -------------------------------------------------------------------------
  // INotifyCreated
  // -------------------------------------------------------------------------

  /**
   * Initialize fog/explored settings from lobby options.
   *
   * OpenRA 对照: INotifyCreated.Created(Actor)
   */
  created(_self: IGameActor): void {
    // NOTE: Lobby options (gs.OptionOrDefault) are deferred since Session/
    // LobbyInfo is not yet migrated. Use info defaults directly.
    this._fogEnabled = this._info.fogCheckboxEnabled
    this._exploreMapEnabled = this._info.exploredMapCheckboxEnabled

    if (this._exploreMapEnabled) {
      this.exploreAll()
    }

    if (!this._fogEnabled && this._exploreMapEnabled) {
      this.revealedCells = this._map.projectedCells.length
    }
  }

  // -------------------------------------------------------------------------
  // ITick
  // -------------------------------------------------------------------------

  /**
   * Resolve dirty cells and update visibility state.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   *
   * PERF: Hot-path loop. Uses direct index iteration, converting to PPos
   * only when needed (the uncommon case). Skips entirely when no cells
   * are dirty and disabled hasn't changed.
   */
  tick(self: IGameActor): void {
    if (!this._anyCellTouched && !this._disabledChanged) {
      return
    }

    this._anyCellTouched = false

    const maxIndex = this._touched.length

    if (this._disabledChanged) {
      // Full re-resolution needed
      this._touched.fill(0)
      for (let index = 0; index < maxIndex; index++) {
        this._updateCell(index, self)
      }
    } else {
      // Partial: only dirty cells
      // PERF: Use indexOf for fast scanning (equivalent to C# Span.IndexOf)
      let index = this._touched.indexOf(1)
      while (index !== -1) {
        this._touched[index] = 0
        this._updateCell(index, self)

        // Scan from next position
        if (index < maxIndex - 1) {
          const nextIndex = this._touched.indexOf(1, index + 1)
          index = nextIndex
        } else {
          index = -1
        }
      }
    }

    // Update sync hash
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owner = (self as any).owner
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const worldTick = (self.world as any).worldTick ?? 0
    this._hash = HashPlayer(owner) + worldTick
    this._disabledChanged = false
  }

  // -------------------------------------------------------------------------
  // Cell resolution (private hot-path)
  // -------------------------------------------------------------------------

  /**
   * Resolve a single cell's visibility state.
   *
   * OpenRA 对照: Shroud.UpdateCell(int, Actor)
   *
   * PERF: Most cells are unchanged — only fires OnShroudChanged when
   * resolved type actually changes.
   */
  private _updateCell(index: number, self: IGameActor): void {
    let type: ShroudCellType = ShroudCellType.Shroud

    if (this._explored[index] !== 0) {
      let count = this._visibleCount[index]
      if (
        !this._shroudGenerationEnabled ||
        count > 0 ||
        this._generatedShroudCount[index] === 0
      ) {
        if (this._passiveVisibilityEnabled) {
          count += this._passiveVisibleCount[index]
        }

        type = count > 0 ? ShroudCellType.Visible : ShroudCellType.Fog
      }
    }

    // PERF: Most cells are unchanged
    const oldResolvedType = this._resolvedType[index]
    if (type !== oldResolvedType || this._disabledChanged) {
      this._resolvedType[index] = type

      const puv = this._pposFromIndex(index)
      if (this._map.contains(puv)) {
        this.onShroudChanged?.(puv)
      }

      if (!this._disabledChanged && (this._fogEnabled || !this._exploreMapEnabled)) {
        if (type === ShroudCellType.Visible) {
          this.revealedCells++
        } else if (
          this._fogEnabled &&
          oldResolvedType === ShroudCellType.Visible
        ) {
          this.revealedCells--
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const owner = (self as any).owner
      if (owner && owner.winState === WinState.Lost) {
        this.revealedCells = 0
      }
    }
  }

  // -------------------------------------------------------------------------
  // Index helpers
  // -------------------------------------------------------------------------

  /** Convert PPos to flat array index.
   *
   * OpenRA 对照: ProjectedCellLayer.Index(PPos)
   */
  private _index(puv: PPos): number {
    return puv.V * this._map.mapSize.width + puv.U
  }

  /** Convert flat array index to PPos.
   *
   * OpenRA 对照: ProjectedCellLayer.PPosFromIndex(int)
   */
  private _pposFromIndex(index: number): PPos {
    return new PPos(index % this._map.mapSize.width, (index / this._map.mapSize.width) | 0)
  }

  // -------------------------------------------------------------------------
  // Public API: Source management
  // -------------------------------------------------------------------------

  /**
   * Add a visibility source.
   *
   * OpenRA 对照: Shroud.AddSource(object, SourceType, PPos[])
   *
   * @param key — unique identifier for this source (usually the trait instance)
   * @param type — the type of visibility source
   * @param projectedCells — the cells this source affects
   * @throws Error if a source with the same key already exists
   */
  addSource(
    key: unknown,
    type: SourceType,
    projectedCells: readonly PPos[],
  ): void {
    if (this._sources.has(key)) {
      throw new Error('Attempting to add duplicate shroud source')
    }

    this._sources.set(key, { type, projectedCells })

    for (const puv of projectedCells) {
      // Force cells outside the visible bounds invisible
      if (!this._map.contains(puv)) {
        continue
      }

      const index = this._index(puv)
      this._touched[index] = 1
      this._anyCellTouched = true

      switch (type) {
        case SourceType.PassiveVisibility:
          this._passiveVisibilityEnabled = true
          this._passiveVisibleCount[index]++
          this._explored[index] = 1
          break
        case SourceType.Visibility:
          this._visibleCount[index]++
          this._explored[index] = 1
          break
        case SourceType.Shroud:
          this._shroudGenerationEnabled = true
          this._generatedShroudCount[index]++
          break
      }
    }
  }

  /**
   * Remove a visibility source.
   *
   * OpenRA 对照: Shroud.RemoveSource(object)
   *
   * @param key — the key of the source to remove
   */
  removeSource(key: unknown): void {
    const state = this._sources.get(key)
    if (!state) {
      return
    }

    this._sources.delete(key)

    for (const puv of state.projectedCells) {
      // Cells outside the visible bounds don't increment counts
      if (this._map.contains(puv)) {
        const index = this._index(puv)
        this._touched[index] = 1
        this._anyCellTouched = true

        switch (state.type) {
          case SourceType.PassiveVisibility:
            this._passiveVisibleCount[index]--
            break
          case SourceType.Visibility:
            this._visibleCount[index]--
            break
          case SourceType.Shroud:
            this._generatedShroudCount[index]--
            break
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API: Exploration
  // -------------------------------------------------------------------------

  /**
   * Mark projected cells as explored.
   *
   * OpenRA 对照: Shroud.ExploreProjectedCells(IEnumerable<PPos>)
   *
   * @param cells — the cells to explore
   */
  exploreProjectedCells(cells: Iterable<PPos>): void {
    for (const puv of cells) {
      if (this._map.contains(puv)) {
        const index = this._index(puv)
        if (this._explored[index] === 0) {
          this._touched[index] = 1
          this._anyCellTouched = true
          this._explored[index] = 1
        }
      }
    }
  }

  /**
   * Copy explored state from another shroud.
   *
   * OpenRA 对照: Shroud.Explore(Shroud)
   *
   * NOTE: Deferred — throws Error. Full implementation requires
   * map bounds comparison and cross-shroud exploration copy.
   * TODO-12.DEFERRED.6
   *
   * @param _other — the shroud to copy from
   */
  explore(_other: Shroud): void {
    throw new Error('Shroud.explore(other) is not yet implemented. TODO-12.DEFERRED.6')
  }

  /**
   * Explore all cells on the map.
   *
   * OpenRA 对照: Shroud.ExploreAll()
   */
  exploreAll(): void {
    for (const puv of this._map.projectedCells) {
      const index = this._index(puv)
      if (this._explored[index] === 0) {
        this._touched[index] = 1
        this._anyCellTouched = true
        this._explored[index] = 1
      }
    }
  }

  /**
   * Reset exploration to only currently visible cells.
   *
   * OpenRA 对照: Shroud.ResetExploration()
   */
  resetExploration(): void {
    for (const puv of this._map.projectedCells) {
      const index = this._index(puv)
      this._touched[index] = 1
      this._explored[index] =
        this._visibleCount[index] + this._passiveVisibleCount[index] > 0 ? 1 : 0
    }

    this._anyCellTouched = true
  }

  // -------------------------------------------------------------------------
  // Public API: Queries
  // -------------------------------------------------------------------------

  /**
   * Check whether a cell has been explored (was ever visible).
   *
   * OpenRA 对照: Shroud.IsExplored(WPos)
   *
   * @param pos — world position
   */
  isExplored(pos: WPos): boolean
  /**
   * Check whether a cell has been explored.
   *
   * OpenRA 对照: Shroud.IsExplored(CPos)
   *
   * @param cell — cell position
   */
  isExplored(cell: CPos): boolean
  /**
   * Check whether a map position has been explored.
   *
   * OpenRA 对照: Shroud.IsExplored(MPos)
   *
   * @param uv — map position
   */
  isExplored(uv: MPos): boolean
  /**
   * Check whether a projected position has been explored.
   *
   * OpenRA 对照: Shroud.IsExplored(PPos)
   *
   * @param puv — projected position
   */
  isExplored(puv: PPos): boolean
  isExplored(arg: WPos | CPos | MPos | PPos): boolean {
    if (arg instanceof WPos) {
      return this.isExplored(this._map.projectedCellCovering(arg))
    }
    if (arg instanceof CPos) {
      return this.isExplored(arg.toMPos(this._map.grid.type))
    }
    if (arg instanceof MPos) {
      if (!this._map.contains(arg)) {
        return false
      }
      for (const puv of this._map.projectedCellsCovering(arg)) {
        if (this.isExplored(puv)) {
          return true
        }
      }
      return false
    }
    // PPos
    if (this._disabled) {
      return this._map.contains(arg)
    }
    const index = this._index(arg)
    return this._resolvedType[index] > ShroudCellType.Shroud
  }

  /**
   * Check whether a cell is currently visible.
   *
   * OpenRA 对照: Shroud.IsVisible(WPos)
   *
   * @param pos — world position
   */
  isVisible(pos: WPos): boolean
  /**
   * Check whether a cell is currently visible.
   *
   * OpenRA 对照: Shroud.IsVisible(CPos)
   *
   * @param cell — cell position
   */
  isVisible(cell: CPos): boolean
  /**
   * Check whether a map position is currently visible.
   *
   * OpenRA 对照: Shroud.IsVisible(MPos)
   *
   * @param uv — map position
   */
  isVisible(uv: MPos): boolean
  /**
   * Check whether a projected position is currently visible.
   *
   * OpenRA 对照: Shroud.IsVisible(PPos)
   *
   * @param puv — projected position
   */
  isVisible(puv: PPos): boolean
  isVisible(arg: WPos | CPos | MPos | PPos): boolean {
    if (arg instanceof WPos) {
      return this.isVisible(this._map.projectedCellCovering(arg))
    }
    if (arg instanceof CPos) {
      return this.isVisible(arg.toMPos(this._map.grid.type))
    }
    if (arg instanceof MPos) {
      for (const puv of this._map.projectedCellsCovering(arg)) {
        if (this.isVisible(puv)) {
          return true
        }
      }
      return false
    }
    // PPos
    if (!this.fogEnabled) {
      return this._map.contains(arg)
    }
    const index = this._index(arg)
    return this._resolvedType[index] === ShroudCellType.Visible
  }

  /**
   * Check whether a projected position is within the map bounds.
   *
   * OpenRA 对照: Shroud.Contains(PPos)
   */
  contains(puv: PPos): boolean {
    return this._map.contains(puv)
  }

  /**
   * Get the combined visibility state for a world position.
   *
   * OpenRA 对照: Shroud.GetVisibility(WPos)
   *
   * @param pos — world position
   */
  getVisibility(pos: WPos): CellVisibility
  /**
   * Get the combined visibility state for a projected position.
   *
   * OpenRA 对照: Shroud.GetVisibility(PPos)
   *
   * PERF: Combines IsExplored and IsVisible in one call.
   *
   * @param puv — projected position
   */
  getVisibility(puv: PPos): CellVisibility
  getVisibility(arg: WPos | PPos): CellVisibility {
    if (arg instanceof WPos) {
      return this.getVisibility(this._map.projectedCellCovering(arg))
    }

    const puv = arg
    let state: CellVisibility = CellVisibility.Hidden

    if (this._disabled) {
      if (this._fogEnabled) {
        // Shroud disabled, Fog enabled
        if (this._map.contains(puv)) {
          state |= CellVisibility.Explored
          const index = this._index(puv)
          if (this._resolvedType[index] === ShroudCellType.Visible) {
            state |= CellVisibility.Visible
          }
        }
      } else if (this._map.contains(puv)) {
        state |= CellVisibility.Explored | CellVisibility.Visible
      }
    } else {
      if (this._fogEnabled) {
        // Shroud and Fog enabled
        if (this._map.contains(puv)) {
          const index = this._index(puv)
          const rt = this._resolvedType[index]
          if (rt === ShroudCellType.Visible) {
            state |= CellVisibility.Explored | CellVisibility.Visible
          } else if (rt > ShroudCellType.Shroud) {
            state |= CellVisibility.Explored
          }
        }
      } else if (this._map.contains(puv)) {
        // We do not set Explored since IsExplored may return false.
        const index = this._index(puv)
        state |= CellVisibility.Visible
        if (this._resolvedType[index] > ShroudCellType.Shroud) {
          state |= CellVisibility.Explored
        }
      }
    }

    return state as CellVisibility
  }

  // -------------------------------------------------------------------------
  // Public API: Properties
  // -------------------------------------------------------------------------

  /** Whether the shroud is disabled (all cells visible). */
  get disabled(): boolean {
    return this._disabled
  }

  set disabled(value: boolean) {
    if (this._disabled === value) {
      return
    }
    this._disabled = value
    this._disabledChanged = true
  }

  /** Whether fog of war is enabled (shroud not disabled). */
  get fogEnabled(): boolean {
    return !this._disabled && this._fogEnabled
  }

  /** Whether the map starts fully explored. */
  get exploreMapEnabled(): boolean {
    return this._exploreMapEnabled
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /**
   * Find all projected cells within a range from a world position.
   *
   * OpenRA 对照: Shroud.ProjectedCellsInRange(Map, WPos, WDist, WDist, int)
   *
   * @param map — the map
   * @param pos — center world position
   * @param minRange — minimum range (donut reveal)
   * @param maxRange — maximum range
   * @param maxHeightDelta — maximum height difference (-1 = no limit)
   * @returns array of projected cells within range
   */
  static projectedCellsInRange(
    map: GameMap,
    pos: WPos,
    minRange: WDist,
    maxRange: WDist,
    maxHeightDelta: number = -1,
  ): PPos[] {
    // Account for potential extra half-cell from odd-height terrain
    const r = ((maxRange.length + 1023 + 512) / 1024) | 0
    const minLimit = minRange.lengthSquared
    const maxLimit = maxRange.lengthSquared

    // Project actor position into the shroud plane
    const projectedPos = new WPos(pos.X, pos.Y - pos.Z, 0)
    const projectedCell = map.cellContaining(projectedPos)
    const projectedHeight = (pos.Z / 512) | 0

    const result: PPos[] = []

    for (const c of map.findTilesInAnnulus(projectedCell, (minRange.length / 1024) | 0, r, true)) {
      const center = map.centerOfCell(c)
      const dx = center.X - projectedPos.X
      const dy = center.Y - projectedPos.Y
      const dist = dx * dx + dy * dy
      if (dist <= maxLimit && (dist === 0 || dist > minLimit)) {
        const puv = PPos.fromMPos(c.toMPos(map.grid.type))
        if (maxHeightDelta < 0 || map.projectedHeight(puv) < projectedHeight + maxHeightDelta) {
          result.push(puv)
        }
      }
    }

    return result
  }

  /**
   * Find all projected cells within a range from a cell position.
   *
   * OpenRA 对照: Shroud.ProjectedCellsInRange(Map, CPos, WDist, int)
   *
   * @param map — the map
   * @param cell — center cell position
   * @param range — maximum range
   * @param maxHeightDelta — maximum height difference (-1 = no limit)
   * @returns array of projected cells within range
   */
  static projectedCellsInRangeFromCell(
    map: GameMap,
    cell: CPos,
    range: WDist,
    maxHeightDelta: number = -1,
  ): PPos[] {
    return Shroud.projectedCellsInRange(map, map.centerOfCell(cell), WDist.Zero, range, maxHeightDelta)
  }
}
