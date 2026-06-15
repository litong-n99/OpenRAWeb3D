/**
 * AffectsShroud.ts — Abstract base trait for shroud-affecting actors (reveals/generates shroud)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AffectsShroud.cs
 *
 * 核心范式转换:
 * - C# HashSet<PPos> footprint → TS Set<number> (linear index: v*width+u, avoids PPos reference-equality bugs)
 * - C# INotifyMoving.MovementTypeChanged(MovementType.None) → TS INotifyFinishedMoving.onNotifyFinishedMoving()
 * - C# self.OccupiesSpace / self.CenterPosition → TS traitOrDefault('IOccupySpace') lookup
 * - C# MoveRecalculationThreshold.Length/LengthSquared → TS WDist.length/lengthSquared
 * - C# event-driven shroud updates → TS direct Shroud.addSource/removeSource calls via Player.shroud
 *
 * 已知子类: RevealsShroud (TODO-12.A.6), CreatesShroud (TODO-12.A.7)
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { PPos } from '../../OpenRA.Game/MPos.js'
import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type ISync,
  type ITick,
  type IOccupySpace,
  type OccupiedCell,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Shroud } from '../../OpenRA.Game/Traits/Player/Shroud.js'
import type { Map as GameMap } from '../../OpenRA.Game/Map/Map.js'
import type { Player } from '../../OpenRA.Game/Player.js'

// ---------------------------------------------------------------------------
// VisibilityType (对应 OpenRA VisibilityType enum)
// ---------------------------------------------------------------------------

/** Determines how the visibility range is measured relative to the actor.
 *
 * OpenRA 对照: VisibilityType enum
 */
export const VisibilityType = {
  /** Measure range from the actor's center position. */
  CenterPosition: 0,
  /** Measure range from the actor's ground position (center minus terrain height). */
  GroundPosition: 1,
  /** Measure range from each cell in the actor's footprint. */
  Footprint: 2,
} as const

export type VisibilityType = (typeof VisibilityType)[keyof typeof VisibilityType]

// ---------------------------------------------------------------------------
// AffectsShroudInfo (对应 OpenRA AffectsShroudInfo)
// ---------------------------------------------------------------------------

/** Configuration for AffectsShroud traits.
 *
 * OpenRA 对照: AffectsShroudInfo (abstract class, extends ConditionalTraitInfo)
 */
export abstract class AffectsShroudInfo implements ConditionalTraitInfo {
  /** Optional instance name for trait disambiguation. */
  readonly instanceName?: string

  /** Optional condition expression that must be satisfied for the trait to be active. */
  readonly requiresCondition?: string

  /** Inner radius for donut-shaped visibility reveal. Cells within this range stay hidden. */
  readonly minRange: WDist = WDist.Zero

  /** Outer radius for visibility reveal. */
  readonly range: WDist = WDist.Zero

  /**
   * If >= 0, prevent cells that are this much higher than the actor from being revealed.
   *
   * OpenRA 对照: MaxHeightDelta
   */
  readonly maxHeightDelta: number = -1

  /**
   * If > 0, force visibility to be recalculated if the unit moves within a cell
   * by more than this distance.
   *
   * OpenRA 对照: MoveRecalculationThreshold (default new(256))
   */
  readonly moveRecalculationThreshold: WDist = new WDist(256)

  /** Determines whether range is measured from the actor's center or its footprint. */
  readonly type: VisibilityType = VisibilityType.Footprint

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    minRange?: WDist
    range?: WDist
    maxHeightDelta?: number
    moveRecalculationThreshold?: WDist
    type?: VisibilityType
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    if (params.minRange) this.minRange = params.minRange
    if (params.range) this.range = params.range
    if (params.maxHeightDelta !== undefined) this.maxHeightDelta = params.maxHeightDelta
    if (params.moveRecalculationThreshold) this.moveRecalculationThreshold = params.moveRecalculationThreshold
    if (params.type !== undefined) this.type = params.type
  }
}

// ---------------------------------------------------------------------------
// AffectsShroud (对应 OpenRA AffectsShroud)
// ---------------------------------------------------------------------------

/** Abstract base trait for actors that affect the shroud (reveal or generate fog).
 *
 * OpenRA 对照: AffectsShroud
 *
 * Subclasses must implement {@link addCellsToPlayerShroud} and
 * {@link removeCellsFromPlayerShroud}. This class handles all lifecycle hooks
 * (added-to-world, removed-from-world, tick, movement completion, center
 * position change) and computes the projected cells that the actor reveals.
 *
 * ## Visibility Types
 *
 * - **CenterPosition**: range from the actor's center world position
 * - **GroundPosition**: range from the actor's center projected to ground level
 * - **Footprint**: union of range-areas around each cell the actor occupies
 */
export abstract class AffectsShroud<TInfo extends AffectsShroudInfo>
  extends ConditionalTrait<TInfo>
  implements ISync, ITick
{
  /** Pre-allocated empty array — avoids per-frame allocation. */
  private static readonly NO_CELLS: readonly PPos[] = []

  /** Per-frame reusable footprint set (linear index keys: v*mapWidth+u).
   *
   * OpenRA 对照: footprint HashSet<PPos>
   *
   * PERF: Set<number> avoids PPos reference-equality issues. Linear index
   * key = v * mapWidth + u. Cleared after each use.
   */
  private readonly _footprint: Set<number> | null = null

  /** Cached projected cell location for move recalculation threshold check. */
  private _cachedLocation: CPos | null = null

  /** Cached range for detecting range changes in tick(). */
  private _cachedRange: WDist | null = null

  /** Whether the trait was disabled in the previous tick. */
  protected cachedTraitDisabled: boolean = false

  /** Cached world position for move recalculation threshold check. */
  private _cachedPos: WPos | null = null

  /** Cached IOccupySpace reference (looked up once in addedToWorld). */
  private _cachedOccupiesSpace: IOccupySpace | null = null

  constructor(info: TInfo) {
    super(info)

    if (info.type === VisibilityType.Footprint) {
      this._footprint = new Set<number>()
    }
  }

  // -------------------------------------------------------------------------
  // Abstract methods (子类必须实现)
  // -------------------------------------------------------------------------

  /** Add visibility cells for this actor to a player's shroud.
   *
   * OpenRA 对照: AffectsShroud.AddCellsToPlayerShroud(Actor, Player, PPos[])
   *
   * Called during shroud update for each player. Subclasses should call
   * `player.shroud.addSource(this, sourceType, cells)` with the appropriate
   * {@link SourceType}.
   *
   * @param self — the actor this trait is attached to
   * @param player — the player whose shroud to modify
   * @param cells — the projected cells to add as a visibility/source region
   */
  protected abstract addCellsToPlayerShroud(
    self: IGameActor,
    player: Player,
    cells: readonly PPos[],
  ): void

  /** Remove this actor's visibility contribution from a player's shroud.
   *
   * OpenRA 对照: AffectsShroud.RemoveCellsFromPlayerShroud(Actor, Player)
   *
   * Called when the actor leaves the world, moves, or changes range.
   * Subclasses should call `player.shroud.removeSource(this)` to remove
   * the previously registered source.
   *
   * @param self — the actor this trait is attached to
   * @param player — the player whose shroud to modify
   */
  protected abstract removeCellsFromPlayerShroud(
    self: IGameActor,
    player: Player,
  ): void

  // -------------------------------------------------------------------------
  // Public properties
  // -------------------------------------------------------------------------

  /** The effective range of this trait. Returns WDist.Zero when the trait is
   * disabled (e.g., by conditions).
   *
   * OpenRA 对照: AffectsShroud.Range (virtual)
   *
   * Subclasses can override to implement additional range logic. The OpenRA
   * implementation returns `CachedTraitDisabled ? WDist.Zero : Info.Range`.
   */
  get range(): WDist {
    return this.isTraitDisabled ? WDist.Zero : this.info.range
  }

  // -------------------------------------------------------------------------
  // ProjectedCells (对应 OpenRA ProjectedCells)
  // -------------------------------------------------------------------------

  /** Compute the projected cells that this actor reveals.
   *
   * OpenRA 对照: AffectsShroud.ProjectedCells(Actor)
   *
   * The computation depends on {@link VisibilityType}:
   * - Footprint: union of range areas around each occupied cell
   * - GroundPosition: range from center position projected to ground level
   * - CenterPosition: range from the actor's center world position
   *
   * @param self — the actor this trait is attached to
   * @returns array of projected cell positions within the visibility range
   */
  protected projectedCells(self: IGameActor): readonly PPos[] {
    const map = this._getMap(self)
    if (!map) return AffectsShroud.NO_CELLS

    const { minRange, maxHeightDelta } = this.info
    const maxRange = this.range

    if (maxRange.length <= minRange.length) {
      return AffectsShroud.NO_CELLS
    }

    if (this.info.type === VisibilityType.Footprint && this._footprint) {
      return this._projectedCellsFootprint(self, map, minRange, maxRange, maxHeightDelta)
    }

    // CenterPosition or GroundPosition
    return this._projectedCellsPosition(self, map, minRange, maxRange, maxHeightDelta)
  }

  /** Compute projected cells for Footprint visibility type.
   *
   * Iterates over each cell the actor occupies and unions the range-areas
   * around each cell's center.
   */
  private _projectedCellsFootprint(
    self: IGameActor,
    map: GameMap,
    minRange: WDist,
    maxRange: WDist,
    maxHeightDelta: number,
  ): readonly PPos[] {
    const footprint = this._footprint!
    const mapWidth = map.mapSize.width

    const occupiedCells = this._getOccupiedCells(self)
    for (const oc of occupiedCells) {
      const center = map.centerOfCell(oc.cell)
      const cells = Shroud.projectedCellsInRange(
        map, center, minRange, maxRange, maxHeightDelta,
      )
      for (const puv of cells) {
        footprint.add(puv.V * mapWidth + puv.U)
      }
    }

    const result: PPos[] = []
    if (footprint.size > 0) {
      for (const index of footprint) {
        result.push(this._pposFromIndex(index, mapWidth))
      }
      footprint.clear()
    }
    return result
  }

  /** Compute projected cells for CenterPosition or GroundPosition visibility types. */
  private _projectedCellsPosition(
    self: IGameActor,
    map: GameMap,
    minRange: WDist,
    maxRange: WDist,
    maxHeightDelta: number,
  ): readonly PPos[] {
    let pos = this._getCenterPosition(self)
    if (!pos) return AffectsShroud.NO_CELLS

    if (this.info.type === VisibilityType.GroundPosition) {
      const aboveTerrain = map.distanceAboveTerrain(pos)
      pos = WPos.subtractVec(pos, new WVec(0, 0, aboveTerrain.length))
    }

    return Shroud.projectedCellsInRange(map, pos, minRange, maxRange, maxHeightDelta)
  }

  // -------------------------------------------------------------------------
  // Shroud cell update (对应 OpenRA UpdateShroudCells)
  // -------------------------------------------------------------------------

  /** Recompute and update the shroud cells for all players.
   *
   * OpenRA 对照: AffectsShroud.UpdateShroudCells(Actor)
   *
   * Computes new projected cells, then for each player: removes the old
   * source and adds the new source. Called whenever the actor moves,
   * range changes, or enabled/disabled state changes.
   */
  private _updateShroudCells(self: IGameActor): void {
    const cells = this.projectedCells(self)
    const players = this._getPlayers(self)
    if (!players) return

    for (const p of players) {
      this.removeCellsFromPlayerShroud(self, p)
      this.addCellsToPlayerShroud(self, p, cells)
    }
  }

  // -------------------------------------------------------------------------
  // INotifyCenterPositionChanged (对应 OpenRA CenterPositionChanged)
  // -------------------------------------------------------------------------

  /** Called when the actor's center position changes.
   *
   * OpenRA 对照: INotifyCenterPositionChanged.CenterPositionChanged(Actor, byte, byte)
   *
   * Recalculates visibility if the actor has moved beyond the
   * MoveRecalculationThreshold or changed its projected map cell.
   */
  onCenterPositionChanged(self: IGameActor): void {
    if (!self.isInWorld) return

    const centerPosition = this._getCenterPosition(self)
    if (!centerPosition) return

    // Project center position onto the ground plane
    const projectedPos = WPos.subtractVec(
      centerPosition,
      new WVec(0, centerPosition.Z, centerPosition.Z),
    )
    const map = this._getMap(self)
    if (!map) return

    const projectedLocation = map.cellContaining(projectedPos)
    const pos = centerPosition

    const threshold = this.info.moveRecalculationThreshold
    let dirty = false
    if (threshold.length > 0 && this._cachedPos) {
      const delta = WPos.subtract(pos, this._cachedPos)
      if (delta.lengthSquared > threshold.lengthSquared) {
        dirty = true
      }
    }

    if (!dirty && this._cachedLocation && CPos.equals(this._cachedLocation, projectedLocation)) {
      return
    }

    this._cachedLocation = projectedLocation
    this._cachedPos = pos

    this._updateShroudCells(self)
  }

  // -------------------------------------------------------------------------
  // ITick (对应 OpenRA Tick)
  // -------------------------------------------------------------------------

  /** Called each game tick. Recalculates visibility if range or disabled state changed.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   */
  tick(self: IGameActor): void {
    if (!self.isInWorld) return

    const traitDisabled = this.isTraitDisabled
    const range = this.range

    if (
      this._cachedRange &&
      WDist.equals(this._cachedRange, range) &&
      traitDisabled === this.cachedTraitDisabled
    ) {
      return
    }

    this._cachedRange = range
    this.cachedTraitDisabled = traitDisabled

    this._updateShroudCells(self)
  }

  // -------------------------------------------------------------------------
  // INotifyAddedToWorld (对应 OpenRA AddedToWorld)
  // -------------------------------------------------------------------------

  /** Called when the actor is added to the world.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor)
   *
   * Initializes cached state and adds visibility cells for all players.
   */
  addedToWorld(self: IGameActor): void {
    const centerPosition = this._getCenterPosition(self)
    if (centerPosition) {
      const projectedPos = WPos.subtractVec(
        centerPosition,
        new WVec(0, centerPosition.Z, centerPosition.Z),
      )
      const map = this._getMap(self)
      if (map) {
        this._cachedLocation = map.cellContaining(projectedPos)
      }
      this._cachedPos = centerPosition
    } else {
      this._cachedLocation = null
      this._cachedPos = null
    }

    this.cachedTraitDisabled = this.isTraitDisabled

    const players = this._getPlayers(self)
    if (!players) return

    const cells = this.projectedCells(self)

    for (const p of players) {
      this.addCellsToPlayerShroud(self, p, cells)
    }
  }

  // -------------------------------------------------------------------------
  // INotifyRemovedFromWorld (对应 OpenRA RemovedFromWorld)
  // -------------------------------------------------------------------------

  /** Called when the actor is removed from the world.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   *
   * Removes visibility cells for all players.
   */
  removedFromWorld(self: IGameActor): void {
    const players = this._getPlayers(self)
    if (!players) return

    for (const p of players) {
      this.removeCellsFromPlayerShroud(self, p)
    }
  }

  // -------------------------------------------------------------------------
  // INotifyFinishedMoving (对应 OpenRA MovementTypeChanged → MovementType.None)
  // -------------------------------------------------------------------------

  /** Called when the actor finishes moving.
   *
   * OpenRA 对照: INotifyMoving.MovementTypeChanged(Actor, MovementType.None)
   *
   * Recalculates visibility at the actor's final stop position.
   */
  onNotifyFinishedMoving(self: IGameActor): void {
    if (!self.isInWorld) return

    const centerPosition = this._getCenterPosition(self)
    if (centerPosition) {
      const projectedPos = WPos.subtractVec(
        centerPosition,
        new WVec(0, centerPosition.Z, centerPosition.Z),
      )
      const map = this._getMap(self)
      if (map) {
        this._cachedLocation = map.cellContaining(projectedPos)
      }
      this._cachedPos = centerPosition
    }

    this._updateShroudCells(self)
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /** Release resources. */
  override dispose(): void {
    this._footprint?.clear()
    this._cachedOccupiesSpace = null
    this._cachedLocation = null
    this._cachedPos = null
    this._cachedRange = null
    super.dispose()
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Get the game map from the actor's world.
   *
   * Returns null if the world or map is not yet available (e.g., during tests).
   */
  private _getMap(self: IGameActor): GameMap | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    if (!world || !world.map) return null
    return world.map as GameMap
  }

  /** Get all players in the world.
   *
   * Returns null if the world is not yet available.
   */
  private _getPlayers(self: IGameActor): readonly Player[] | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const world = self.world as any
    if (!world || !world.players) return null
    return world.players as readonly Player[]
  }

  /** Get the actor's center position via IOccupySpace trait.
   *
   * Caches the IOccupySpace reference on first successful lookup.
   */
  private _getCenterPosition(self: IGameActor): WPos | null {
    if (!this._cachedOccupiesSpace) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._cachedOccupiesSpace = (self as any).traitOrDefault?.('IOccupySpace') as IOccupySpace | null
    }
    return this._cachedOccupiesSpace?.centerPosition ?? null
  }

  /** Get the actor's occupied cells via IOccupySpace trait. */
  private _getOccupiedCells(self: IGameActor): readonly OccupiedCell[] {
    if (!this._cachedOccupiesSpace) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this._cachedOccupiesSpace = (self as any).traitOrDefault?.('IOccupySpace') as IOccupySpace | null
    }
    return this._cachedOccupiesSpace?.occupiedCells() ?? []
  }

  /** Convert a linear index to PPos (inverse of v * width + u).
   *
   * OpenRA 对照: ProjectedCellLayer.PPosFromIndex(int)
   */
  private _pposFromIndex(index: number, width: number): PPos {
    return new PPos(index % width, (index / width) | 0)
  }
}

