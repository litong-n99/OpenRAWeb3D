/**
 * TilingPathTool.ts — Editor tool for planning and tiling segmented paths (roads, rivers, cliffs)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/TilingPathTool.cs (580 lines C#)
 *
 * 核心范式转换:
 * - C# PathPlan record-like class with immutable data → TypeScript class with readonly fields
 * - C# ImmutableArray<CPos> → readonly CPos[]
 * - C# TilingPath / PermittedSegments / MultiBrush → stubbed (TODO-21.B.2-DEFER-3/4)
 * - C# MersenneTwister random → not used in Phase B (TilePlan stubbed)
 * - C# CellLayerUtils.WPosToCorner/CornerToWPos → not needed (TilePlan stubbed)
 * - C# DirectionExts extension methods → Direction.ts functions
 * - C# enumeration over DirectionMask via Spread arrays → ALL_DIRECTIONS
 * - C# ITemplatedTerrainInfo → stubbed brush loading
 *
 * PathPlan implements an immutable data structure for representing editor path plans.
 * Every mutator returns a new instance (or null for removal). PointsWithRallyIndex()
 * implements a Bresenham supercover variant for 8-direction grid path interpolation.
 *
 * TilingPathTool is an IEditorTool trait attached to the editor world actor.
 * In Phase B, TilePlan() is stubbed to return null — full tiling integration
 * with TilingPath/MultiBrush is deferred.
 *
 * Migration:  — Chapter 21 Phase B Wave 3
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import {
  Direction,
  DirectionMask,
  directionToCVec,
  directionToMask,
  closestInMaskFromCVec,
  directionFromCVecNonDiagonal,
  oppositeDirection,
} from '../../EditorBrushes/Direction.js'
import type { EditorBlitSource } from '../../EditorBrushes/types.js'

// ---------------------------------------------------------------------------
// PathPlan — immutable path plan data structure
// OpenRA 对照: TilingPathTool.PathPlan (nested sealed class)
// ---------------------------------------------------------------------------

/**
 * Immutable path plan representing the user's intended path shape.
 *
 * OpenRA 对照: TilingPathTool.PathPlan
 *
 * Every mutator method returns a new PathPlan instance or null (for removal
 * of the last rally point). This ensures no mutation bugs during complex
 * drag interactions.
 *
 * The `rallies` array always has at least one element. `loop` is forced to
 * false if there are fewer than 3 rallies.
 */
export class PathPlan {
  /** Start direction override (Direction.None = auto-detect). */
  readonly start: Direction
  /** End direction override (Direction.None = auto-detect). */
  readonly end: Direction
  /** Whether the path closes back to the first rally. */
  readonly loop: boolean
  /** User-defined waypoints (at least 1). */
  readonly rallies: readonly CPos[]

  // -------------------------------------------------------------------------
  // Private full constructor
  // -------------------------------------------------------------------------

  /**
   * Full constructor — validates rallies and loop constraint.
   *
   * OpenRA 对照: PathPlan(Direction start, Direction end, bool loop, ImmutableArray<CPos> rallies) — private
   *
   * @throws if rallies is empty
   */
  private constructor(
    start: Direction,
    end: Direction,
    loop: boolean,
    rallies: readonly CPos[],
  ) {
    if (!rallies || rallies.length === 0) {
      throw new Error('rallies must have at least one point')
    }

    this.start = start
    this.end = end
    this.loop = loop && rallies.length >= 3
    this.rallies = rallies
  }

  // -------------------------------------------------------------------------
  // Static factory: single rally point
  // OpenRA 对照: public PathPlan(CPos first)
  // -------------------------------------------------------------------------

  /**
   * Create a new PathPlan with a single rally point.
   *
   * OpenRA 对照: public PathPlan(CPos first)
   *
   * NOTE: TypeScript does not support multiple constructor bodies in the same
   * class (unlike C# overloads). This static factory replaces the public
   * constructor overload.
   */
  static createSingle(first: CPos): PathPlan {
    return new PathPlan(Direction.None, Direction.None, false, [first])
  }

  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  /** The first rally point.
   *
   * OpenRA 对照: PathPlan.FirstPoint
   */
  get firstPoint(): CPos {
    return this.rallies[0]
  }

  /** The last rally point (first point if loop).
   *
   * OpenRA 对照: PathPlan.LastPoint
   */
  get lastPoint(): CPos {
    return this.loop ? this.rallies[0] : this.rallies[this.rallies.length - 1]
  }

  // -------------------------------------------------------------------------
  // autoStart / autoEnd
  // OpenRA 对照: PathPlan.AutoStart(DirectionMask) / PathPlan.AutoEnd(DirectionMask)
  // -------------------------------------------------------------------------

  /**
   * Determine the start direction (explicit or auto-detected).
   *
   * OpenRA 对照: PathPlan.AutoStart(DirectionMask mask)
   *
   * If Start is set, returns it directly. Otherwise, if there are 2+ rallies
   * and a non-empty mask, computes the closest direction from rallies[1]-rallies[0].
   */
  autoStart(mask: DirectionMask): Direction {
    if (this.start !== Direction.None) {
      return this.start
    }

    if (this.rallies.length >= 2 && mask !== DirectionMask.None) {
      const delta = CPos.subtract(this.rallies[1], this.rallies[0])
      if (!CVec.equals(delta, CVec.Zero)) {
        return closestInMaskFromCVec(delta, mask)
      }
    }

    return Direction.None
  }

  /**
   * Determine the end direction (explicit, auto-detected, or mirror of start).
   *
   * OpenRA 对照: PathPlan.AutoEnd(DirectionMask mask)
   */
  autoEnd(mask: DirectionMask): Direction {
    if (this.end !== Direction.None) {
      return this.end
    }

    if (this.loop) {
      return this.autoStart(mask)
    }

    if (this.rallies.length >= 2 && mask !== DirectionMask.None) {
      const lastIdx = this.rallies.length - 1
      const delta = CPos.subtract(this.rallies[lastIdx], this.rallies[lastIdx - 1])
      if (!CVec.equals(delta, CVec.Zero)) {
        return closestInMaskFromCVec(delta, mask)
      }
    }

    return Direction.None
  }

  // -------------------------------------------------------------------------
  // Immutable mutators
  // -------------------------------------------------------------------------

  /** Return a copy with the start direction changed.
   *
   * OpenRA 对照: PathPlan.WithStart(Direction start)
   */
  withStart(start: Direction): PathPlan {
    return new PathPlan(start, this.end, this.loop, this.rallies)
  }

  /** Return a copy with the end direction changed.
   *
   * OpenRA 对照: PathPlan.WithEnd(Direction end)
   */
  withEnd(end: Direction): PathPlan {
    return new PathPlan(this.start, end, this.loop, this.rallies)
  }

  /** Return a copy with the loop flag toggled.
   *
   * OpenRA 对照: PathPlan.WithLoop(bool loop)
   */
  withLoop(loop: boolean): PathPlan {
    return new PathPlan(this.start, this.end, loop, this.rallies)
  }

  /** Return a copy with a rally appended at the end.
   *
   * OpenRA 对照: PathPlan.WithRallyAppended(CPos cpos)
   */
  withRallyAppended(cpos: CPos): PathPlan {
    return new PathPlan(
      this.start,
      Direction.None,
      this.loop,
      [...this.rallies, cpos],
    )
  }

  /** Return a copy with the rally at `index` removed, or null if removing last rally.
   *
   * OpenRA 对照: PathPlan.WithRallyRemoved(int index)
   */
  withRallyRemoved(index: number): PathPlan | null {
    if (this.rallies.length === 1) return null

    return new PathPlan(
      index !== 0 ? this.start : Direction.None,
      index !== this.rallies.length - 1 ? this.end : Direction.None,
      this.loop,
      [...this.rallies.slice(0, index), ...this.rallies.slice(index + 1)],
    )
  }

  /** Return a copy with the rally at `index` replaced by `cpos`.
   *
   * OpenRA 对照: PathPlan.WithRallyReplaced(int index, CPos cpos)
   */
  withRallyReplaced(index: number, cpos: CPos): PathPlan {
    return new PathPlan(
      this.start,
      this.end,
      this.loop,
      [
        ...this.rallies.slice(0, index),
        cpos,
        ...this.rallies.slice(index + 1),
      ],
    )
  }

  /** Return a copy with a rally inserted before `index`.
   *
   * OpenRA 对照: PathPlan.WithRallyInserted(int index, CPos cpos)
   */
  withRallyInserted(index: number, cpos: CPos): PathPlan {
    return new PathPlan(
      this.start,
      this.end,
      this.loop,
      [
        ...this.rallies.slice(0, index),
        cpos,
        ...this.rallies.slice(index),
      ],
    )
  }

  /** Return a copy with all rallies translated by `offset`.
   *
   * OpenRA 对照: PathPlan.Moved(CVec offset)
   */
  moved(offset: CVec): PathPlan {
    const newRallies = this.rallies.map((r) => CPos.add(r, offset))
    return new PathPlan(this.start, this.end, this.loop, newRallies)
  }

  /** Return a copy with rallies reversed and directions swapped.
   *
   * OpenRA 对照: PathPlan.Reversed()
   */
  reversed(): PathPlan {
    if (this.loop) {
      // For loops: rotate rallies and reverse directions
      const reversedStart = this.end
      const reversedEnd = this.start

      let resolvedStart = reversedStart
      let resolvedEnd = reversedEnd

      if (this.start !== Direction.None && this.end === Direction.None) {
        resolvedStart = this.autoEnd(DirectionMask.All)
        resolvedEnd = Direction.None
      }

      // Rotate rallies: skip first, append first, then reverse
      const rotatedRallies = [
        ...this.rallies.slice(1),
        this.rallies[0],
      ].reverse()

      return new PathPlan(
        oppositeDirection(resolvedStart),
        oppositeDirection(resolvedEnd),
        this.loop,
        rotatedRallies,
      )
    }

    // Non-loop: just reverse everything
    return new PathPlan(
      oppositeDirection(this.end),
      oppositeDirection(this.start),
      this.loop,
      [...this.rallies].reverse(),
    )
  }

  // -------------------------------------------------------------------------
  // points() — convert rallies to dense path
  // OpenRA 对照: PathPlan.Points()
  // -------------------------------------------------------------------------

  /** Convert rally points into a dense sequence of cell positions.
   *
   * OpenRA 对照: PathPlan.Points()
   */
  points(): CPos[] {
    return this.pointsWithRallyIndex().map((p) => p.cpos)
  }

  // -------------------------------------------------------------------------
  // pointsWithRallyIndex() — Bresenham supercover variant
  // OpenRA 对照: PathPlan.PointsWithRallyIndex()
  // -------------------------------------------------------------------------

  /**
   * Convert rally points into a dense sequence of cell positions with their
   * associated rally index. For loops, the final rally index equals the number
   * of rallies.
   *
   * OpenRA 对照: PathPlan.PointsWithRallyIndex()
   *
   * This implements a Bresenham-like supercover line algorithm for 8-direction
   * grid movement. The algorithm ensures every cell the path passes through is
   * included in the result. It uses an "inertia" tracker that preserves the
   * last movement direction to produce consistent stepping on diagonal lines.
   *
   * The modulo accumulator (`xUnderModulo`, `yUnderModulo`) implements a
   * fixed-point comparison that toggles between X and Y steps to approximate
   * a diagonal line on a discrete grid. The initialization uses CROSSED values:
   * `xUnderModulo = |offset.Y|` and `yUnderModulo = |offset.X|` — this swapping
   * is intentional and matches the OpenRA C# implementation.
   *
   * @throws if there are duplicate consecutive rally points
   */
  pointsWithRallyIndex(): Array<{ cpos: CPos; rallyIndex: number }> {
    const result: Array<{ cpos: CPos; rallyIndex: number }> = []
    let currentCpos = this.rallies[0]
    result.push({ cpos: currentCpos, rallyIndex: 0 })

    if (this.rallies.length === 1) {
      return result
    }

    // Initial inertia from auto-detected start direction.
    // If autoStart returns None (e.g., zero offset between first rallies),
    // default to a zero vector — the duplicate rally check in addPointsUpTo
    // will catch immediately if rallies are identical.
    const autoStartDir = this.autoStart(DirectionMask.All)
    let inertiaCVec: CVec
    if (autoStartDir !== Direction.None) {
      inertiaCVec = directionToCVec(autoStartDir)
    } else {
      inertiaCVec = CVec.Zero
    }
    // If diagonal, keep only X component
    if (inertiaCVec.X !== 0 && inertiaCVec.Y !== 0) {
      inertiaCVec = new CVec(inertiaCVec.X, 0)
    }

    /**
     * Walk from currentCpos to target using Bresenham supercover.
     *
     * OpenRA 对照: PathPlan.AddPointsUpTo(CPos target, int i) — local function
     */
    const addPointsUpTo = (target: CPos, rallyIdx: number): void => {
      if (CPos.equals(currentCpos, target)) {
        throw new Error('there are duplicate rally points')
      }

      const offset = CPos.subtract(target, currentCpos)
      const xStep = Math.sign(offset.X)
      const yStep = Math.sign(offset.Y)

      const axisAligned = xStep === 0 || yStep === 0

      if (axisAligned) {
        // Axis-aligned: walk step by step
        while (!CPos.equals(currentCpos, target)) {
          inertiaCVec = new CVec(xStep, yStep)
          currentCpos = CPos.add(currentCpos, inertiaCVec)
          result.push({ cpos: currentCpos, rallyIndex: rallyIdx })
        }
      } else {
        // Diagonal: Bresenham supercover
        // IMPORTANT: The C# implementation initializes xUnderModulo with |offset.Y|
        // and yUnderModulo with |offset.X| (crossed). This is intentional.
        let xUnderModulo = Math.abs(offset.Y)
        let yUnderModulo = Math.abs(offset.X)

        const xModulo = xUnderModulo * 2
        const yModulo = yUnderModulo * 2

        // Initial step direction
        if (xUnderModulo < yUnderModulo) {
          inertiaCVec = new CVec(xStep, 0)
        } else if (yUnderModulo > xUnderModulo) {
          // NOTE: This branch is logically equivalent to xUnderModulo < yUnderModulo
          // and never executes in practice. Preserved for exact OpenRA parity.
          inertiaCVec = new CVec(0, yStep)
        } else {
          // Equal: use non-diagonal direction based on inertia + offset
          const checkVec = CVec.add(
            inertiaCVec,
            new CVec(xStep * 2, yStep * 2),
          )
          inertiaCVec = directionToCVec(
            directionFromCVecNonDiagonal(checkVec),
          )
        }

        // Step until we reach the target
        while (!CPos.equals(currentCpos, target)) {
          // Determine next step based on modulo accumulator
          if (xUnderModulo < yUnderModulo) {
            yUnderModulo -= xUnderModulo
            xUnderModulo = xModulo
            inertiaCVec = new CVec(xStep, 0)
          } else if (xUnderModulo > yUnderModulo) {
            xUnderModulo -= yUnderModulo
            yUnderModulo = yModulo
            inertiaCVec = new CVec(0, yStep)
          } else if (inertiaCVec.X !== 0) {
            // Equal modulos, use inertia to decide
            xUnderModulo = xModulo
            yUnderModulo = 0
          } else {
            yUnderModulo = yModulo
            xUnderModulo = 0
          }

          currentCpos = CPos.add(currentCpos, inertiaCVec)
          result.push({ cpos: currentCpos, rallyIndex: rallyIdx })
        }
      }
    }

    // Process each rally pair
    for (let i = 1; i < this.rallies.length; i++) {
      addPointsUpTo(this.rallies[i], i)
    }

    // Close the loop back to the first rally
    if (this.loop) {
      addPointsUpTo(this.rallies[0], this.rallies.length)
    }

    return result
  }
}

// ---------------------------------------------------------------------------
// Segment type stubs (待 MultiBrush 迁移后替换)
// ---------------------------------------------------------------------------

/**
 * Minimal segment info stub for brush categorization.
 *
 * OpenRA 对照: MultiBrush.Segment property
 *
 * TODO-21.B.2-DEFER-4: Full MultiBrush migration
 */
export interface SegmentStub {
  inner: string | null
  start: string
  end: string
  startDirection: Direction
  endDirection: Direction
  hasInnerType(innerType: string): boolean
  hasStartType(startType: string): boolean
  hasEndType(endType: string): boolean
}

/**
 * Minimal multi-brush stub for brush categorization.
 *
 * OpenRA 对照: MultiBrush class
 *
 * TODO-21.B.2-DEFER-4: Full MultiBrush migration
 */
export interface MultiBrushStub {
  segment: SegmentStub | null
}

// ---------------------------------------------------------------------------
// ITilingPathToolWorldRenderer — minimal world renderer interface for TilePlan
// OpenRA 对照: WorldRenderer.ProjectedPosition / World.Map.Grid.Type
// ---------------------------------------------------------------------------

/**
 * Minimal world renderer interface for TilePlan cell-to-world conversions.
 *
 * TODO-21.B.2-DEFER-3: Currently unused (TilePlan is stubbed). When the
 * full TilingPath algorithm is integrated, this interface will provide the
 * ProjectedPosition() method needed for CellLayerUtils.WPosToCorner and
 * the map grid type.
 */
export interface ITilingPathToolWorldRenderer {
  projectedPosition(wpos: { readonly x: number; readonly y: number; readonly z: number }): {
    readonly x: number; readonly y: number; readonly z: number
  }
}

// ---------------------------------------------------------------------------
// TilingPathTool — editor tool trait
// OpenRA 对照: TilingPathTool : IEditorTool, IRenderAnnotations, INotifyActorDisposing, IWorldLoaded
// ---------------------------------------------------------------------------

/**
 * Editor tool for planning and rendering tiling paths (roads, rivers, etc.).
 *
 * OpenRA 对照: TilingPathTool
 *
 * Loads all segmented brush definitions from the terrain info and categorizes
 * them by inner/start/end types. Holds the current PathPlan and provides
 * setters that trigger `Update()` to re-tile.
 *
 * In Phase B, TilePlan() is stubbed to return null — full tiling integration
 * with TilingPath/MultiBrush is deferred to TODO-21.B.2-DEFER-3/4.
 */
export class TilingPathTool {
  // ---- Static labels ----
  static readonly Label = 'Tiling Path Tool'
  static readonly PanelWidget = 'TILING_PATH_TOOL_PANEL'

  // ---- Properties ----
  readonly isEnabled: boolean

  /** Categorized segmented brushes (stubbed for Phase B). */
  readonly segmentedBrushes: readonly MultiBrushStub[]

  /** All available inner types. */
  readonly innerTypes: readonly string[]

  /** Start type choices keyed by inner type. */
  readonly startTypesByInner: ReadonlyMap<string, readonly string[]>

  /** End type choices keyed by inner type. */
  readonly endTypesByInner: ReadonlyMap<string, readonly string[]>

  // ---- Mutable state ----
  plan: PathPlan | null = null
  startType: string | null = null
  innerType: string | null = null
  endType: string | null = null
  autoStartDirectionMask: DirectionMask = DirectionMask.None
  autoEndDirectionMask: DirectionMask = DirectionMask.None
  maxDeviation = 5
  allowEndDeviation = true
  closedLoops = true
  randomSeed = 0
  editorBlitSource: EditorBlitSource | null = null

  // ---- Minimal world references ----
  /**
   * World renderer — used by TilePlan() to compute WPos from cell positions.
   *
   * TODO-21.B.2-DEFER-3: When TilePlan is fully implemented, this will need
   * the WorldRenderer's ProjectedPosition() and the world's Map.Grid.Type
   * for CellLayerUtils.WPosToCorner / CornerToWPos conversions.
   * Currently null because TilePlan() is stubbed.
   */
  readonly worldRenderer: ITilingPathToolWorldRenderer | null = null

  private disposed = false

  // -------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: TilingPathTool(Actor self, TilingPathToolInfo info)
  // -------------------------------------------------------------------------

  /**
   * Create a TilingPathTool.
   *
   * OpenRA 对照: TilingPathTool constructor
   *
   * In Phase B, segmented brushes are loaded from a minimal MapBlitData-compatible
   * terrain info. The full MultiBrush/TilingPath integration is deferred.
   *
   * @param segmentedBrushes — pre-categorized multi-brushes (stubbed for Phase B)
   * @param defaultInner — default inner type from tool info
   */
  constructor(
    segmentedBrushes: readonly MultiBrushStub[] = [],
    defaultInner?: readonly string[],
  ) {
    this.segmentedBrushes = segmentedBrushes.filter(
      (b) => b.segment !== null,
    )

    this.isEnabled = this.segmentedBrushes.length > 0

    if (!this.isEnabled) {
      this.innerTypes = []
      this.startTypesByInner = new Map()
      this.endTypesByInner = new Map()
      return
    }

    // ---- Extract inner types ----
    const innerTypeSet = new Set<string>()
    for (const brush of this.segmentedBrushes) {
      const seg = brush.segment!
      if (seg.inner !== null) {
        innerTypeSet.add(seg.inner.split('.')[0])
      } else {
        innerTypeSet.add(seg.start.split('.')[0])
        innerTypeSet.add(seg.end.split('.')[0])
      }
    }
    this.innerTypes = [...innerTypeSet].sort()

    // ---- Build start/end type maps ----
    const startTypesByInner = new Map<string, string[]>()
    const endTypesByInner = new Map<string, string[]>()

    for (const innerType of this.innerTypes) {
      const matchingBrushes = this.segmentedBrushes.filter((b) => {
        const seg = b.segment!
        if (seg.inner !== null) {
          return seg.inner.split('.')[0] === innerType
        }
        return (
          seg.start.split('.')[0] === innerType ||
          seg.end.split('.')[0] === innerType
        )
      })

      const startTypes = [
        ...new Set(
          matchingBrushes.map((b) => {
            const parts = b.segment!.start.split('.')
            return parts.slice(0, -1).join('.')
          }),
        ),
      ].sort()
      startTypesByInner.set(innerType, startTypes)

      const endTypes = [
        ...new Set(
          matchingBrushes.map((b) => {
            const parts = b.segment!.end.split('.')
            return parts.slice(0, -1).join('.')
          }),
        ),
      ].sort()
      endTypesByInner.set(innerType, endTypes)
    }

    this.startTypesByInner = startTypesByInner
    this.endTypesByInner = endTypesByInner

    // ---- Set defaults ----
    this.innerType =
      defaultInner?.find((d) => this.innerTypes.includes(d)) ??
      (this.innerTypes.length > 0 ? this.innerTypes[0] : null)

    if (this.innerType) {
      this.verifyTypes(this.innerType)
    }
  }

  // -------------------------------------------------------------------------
  // VerifyTypes — ensure start/end type consistency
  // OpenRA 对照: TilingPathTool.VerifyTypes(string innerType)
  // -------------------------------------------------------------------------

  /**
   * Ensure StartType and EndType are valid for the given inner type.
   *
   * OpenRA 对照: TilingPathTool.VerifyTypes()
   *
   * Falls back to empty string if no choices, or first choice if current is
   * invalid. Also updates direction masks.
   */
  verifyTypes(innerType: string): void {
    const startChoices = this.startTypesByInner.get(innerType) ?? []
    if (startChoices.length === 0) {
      this.startType = ''
    } else if (
      !this.startType ||
      this.startType.length === 0 ||
      !startChoices.includes(this.startType)
    ) {
      this.startType = startChoices[0]
    }

    const endChoices = this.endTypesByInner.get(innerType) ?? []
    if (endChoices.length === 0) {
      this.endType = ''
    } else if (
      !this.endType ||
      this.endType.length === 0 ||
      !endChoices.includes(this.endType)
    ) {
      this.endType = endChoices[0]
    }

    if (!innerType || innerType.length === 0) {
      this.innerType = this.innerTypes.length > 0 ? this.innerTypes[0] : null
    } else {
      this.innerType = innerType
    }

    this.updateStartDirectionMask()
    this.updateEndDirectionMask()
  }

  // -------------------------------------------------------------------------
  // Update (private) — re-tile the plan
  // OpenRA 对照: TilingPathTool.Update()
  // -------------------------------------------------------------------------

  /**
   * Re-tile the current plan. In Phase B, this always sets EditorBlitSource
   * to null because TilePlan is stubbed.
   *
   * OpenRA 对照: TilingPathTool.Update()
   */
  private update(): void {
    this.editorBlitSource = this.tilePlan(this.plan)
  }

  // -------------------------------------------------------------------------
  // TilePlan — convert PathPlan to EditorBlitSource (STUBBED)
  // OpenRA 对照: TilingPathTool.TilePlan(PathPlan plan)
  // -------------------------------------------------------------------------

  /**
   * Convert a PathPlan into an EditorBlitSource by running the TilingPath
   * algorithm.
   *
   * OpenRA 对照: TilingPathTool.TilePlan()
   *
   * TODO-21.B.2-DEFER-3: Integrate TilingPath algorithm.
   * For Phase B, returns null (path tiling not yet implemented).
   */
  private tilePlan(_plan: PathPlan | null): EditorBlitSource | null {
    // TODO-21.B.2-DEFER-3: Full TilingPath integration
    // Requires: TilingPath.cs, PermittedSegments, MultiBrush.LoadCollection,
    // MersenneTwister, CellLayerUtils
    return null
  }

  // -------------------------------------------------------------------------
  // Direction mask updates
  // -------------------------------------------------------------------------

  /**
   * Update AutoStartDirectionMask based on matching segmented brushes.
   *
   * OpenRA 对照: TilingPathTool.UpdateStartDirectionMask()
   */
  private updateStartDirectionMask(): void {
    let mask: DirectionMask = DirectionMask.None
    for (const brush of this.segmentedBrushes) {
      const seg = brush.segment
      if (
        seg &&
        seg.hasInnerType(this.innerType ?? '') &&
        seg.hasStartType(this.startType ?? '')
      ) {
        mask |= directionToMask(seg.startDirection)
      }
    }
    this.autoStartDirectionMask = mask
  }

  /**
   * Update AutoEndDirectionMask based on matching segmented brushes.
   *
   * OpenRA 对照: TilingPathTool.UpdateEndDirectionMask()
   */
  private updateEndDirectionMask(): void {
    let mask: DirectionMask = DirectionMask.None
    for (const brush of this.segmentedBrushes) {
      const seg = brush.segment
      if (
        seg &&
        seg.hasInnerType(this.innerType ?? '') &&
        seg.hasEndType(this.endType ?? '')
      ) {
        mask |= directionToMask(seg.endDirection)
      }
    }
    this.autoEndDirectionMask = mask
  }

  // -------------------------------------------------------------------------
  // State setters
  // -------------------------------------------------------------------------

  /** Set the current path plan and update the tiling.
   *
   * OpenRA 对照: TilingPathTool.SetPlan(PathPlan value)
   */
  setPlan(value: PathPlan | null): void {
    this.plan = value
    this.update()
  }

  /** Set the start type and update.
   *
   * OpenRA 对照: TilingPathTool.SetStartType(string value)
   */
  setStartType(value: string): void {
    this.startType = value
    this.updateStartDirectionMask()
    this.update()
  }

  /** Set the inner type, re-verify, and update.
   *
   * OpenRA 对照: TilingPathTool.SetInnerType(string value)
   */
  setInnerType(value: string): void {
    this.innerType = value
    this.verifyTypes(value)
    this.update()
  }

  /** Set the end type and update.
   *
   * OpenRA 对照: TilingPathTool.SetEndType(string value)
   */
  setEndType(value: string): void {
    this.endType = value
    this.updateEndDirectionMask()
    this.update()
  }

  /** Set the closed loops flag and update.
   *
   * OpenRA 对照: TilingPathTool.SetClosedLoops(bool value)
   */
  setClosedLoops(value: boolean): void {
    this.closedLoops = value
    this.update()
  }

  /** Set the random seed and update.
   *
   * OpenRA 对照: TilingPathTool.SetRandomSeed(int value)
   */
  setRandomSeed(value: number): void {
    this.randomSeed = value
    this.update()
  }

  /** Set the max deviation and update.
   *
   * OpenRA 对照: TilingPathTool.SetMaxDeviation(int value)
   */
  setMaxDeviation(value: number): void {
    this.maxDeviation = value
    this.update()
  }

  /** Set the allow end deviation flag and update.
   *
   * OpenRA 对照: TilingPathTool.SetAllowEndDeviation(bool value)
   */
  setAllowEndDeviation(value: boolean): void {
    this.allowEndDeviation = value
    this.update()
  }

  // -------------------------------------------------------------------------
  // Dispose
  // OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
  // -------------------------------------------------------------------------

  /** Clean up resources.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing()
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
  }
}
