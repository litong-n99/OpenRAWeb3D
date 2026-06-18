/**
 * PathFinder.ts -- World-level pathfinding coordinator
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/PathFinder.cs
 *
 * 核心范式转换:
 * - C# Dictionary<Locomotor, HierarchicalPathFinder> → Map<ILocomotor, HierarchicalPathFinder>
 * - C# Func<CPos, int> customCost delegate → (cell: CPos) => number callback
 * - C# IEnumerable<CPos> sources → CPos[] array
 * - C# Actor self parameter → IGameActor
 * - C# World / WorldRenderer → IGameWorld (minimal subset)
 * - C# Requires<LocomotorInfo> attribute → worldLoaded() accepts ILocomotor[] array
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type { IGameWorld } from '../../../OpenRA.Game/World'
import type { ILocomotor, ILocomotorActor } from './Locomotor'
import type { BlockedByActor } from '../BlockedByActor'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import { PathSearch, NoPath as PathSearchNoPath, type IRecorder } from '../../Pathfinder/PathSearch'
import { HierarchicalPathFinder } from '../../Pathfinder/HierarchicalPathFinder'
import type { GraphConnection } from '../../Pathfinder/IPathGraph'

// ---------------------------------------------------------------------------
// PathFinder overlay stubs (匹配 OpenRA PathFinderOverlay)
// ---------------------------------------------------------------------------

/**
 * Stub interface for PathFinderOverlay recording.
 *
 * OpenRA 对照: PathFinderOverlay
 *
 * STUB: Full overlay will be implemented in a later phase.
 * TODO-9.X: Implement full PathFinderOverlay with debug visualization.
 */
export interface IPathFinderOverlay {
  /** Start a new recording session for a path search.
   *
   * OpenRA 对照: PathFinderOverlay.NewRecording(Actor, IEnumerable<CPos>, CPos)
   */
  newRecording(owner: IGameActor, sources: Iterable<CPos>, target: CPos | null): void

  /** Get a recorder callback for local edge recording.
   *
   * OpenRA 对照: PathFinderOverlay.RecordLocalEdges(Actor)
   */
  recordLocalEdges(self: IGameActor): IRecorder | null
}

// ---------------------------------------------------------------------------
// PathResult -- search result type
// ---------------------------------------------------------------------------

/**
 * Result of a pathfinding search.
 *
 * OpenRA 对照: No direct equivalent (C# returns List<CPos> directly).
 * TypeScript adapts with a result wrapper for additional metadata.
 */
export interface PathResult {
  /** The path from target to source (reversed), or null if no path exists. */
  path: CPos[] | null

  /** The estimated cost of the path. */
  cost: number
}

// ---------------------------------------------------------------------------
// NO_PATH sentinel
// ---------------------------------------------------------------------------

/**
 * Sentinel value returned when no path can be found.
 *
 * OpenRA 对照: PathFinder.NoPath (static readonly List<CPos>)
 */
export const NO_PATH: CPos[] = []

// ---------------------------------------------------------------------------
// Helper: retrieve ILocomotor from an actor (matching OpenRA GetActorLocomotor)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for an actor that provides a Locomotor through its
 * Mobile / OccupiesSpace trait.
 *
 * OpenRA 对照: Mobile.Locomotor property (accessed via OccupiesSpace)
 *
 * NOTE: Mobile is being developed concurrently.
 * This interface defines the contract needed by PathFinder.
* Replace with full Mobile interface when available.
 */
interface ILocomotorProvider {
  readonly locomotor: ILocomotor
}

/**
 * Extract the ILocomotor from an actor.
 *
 * OpenRA 对照: PathFinder.GetActorLocomotor(Actor)
 *
 * PERF: This PathFinder trait requires the use of Mobile, so we can be sure
 * that it is in use. We can save some performance by avoiding querying for the
 * Locomotor trait and retrieving it directly from Mobile.
 *
 * @param self -- the actor (must have Mobile trait)
 * @returns the actor's ILocomotor
 * @throws if the actor does not have a Locomotor provider
 */
function getActorLocomotor(self: IGameActor): ILocomotor {
  // PERF: Match OpenRA's direct pattern — cast through OccupiesSpace → Mobile → Locomotor
  const mobile = (self as unknown as { occupiesSpace?: ILocomotorProvider }).occupiesSpace
  if (!mobile) {
    throw new Error(
      `PathFinder requires the actor (id=${self.actorId}) to have the Mobile trait which provides a Locomotor`,
    )
  }
  const locomotor = mobile.locomotor
  if (!locomotor) {
    throw new Error(
      `PathFinder requires the actor (id=${self.actorId}) to have a Locomotor via its Mobile trait`,
    )
  }
  return locomotor
}

// ---------------------------------------------------------------------------
// PathFinderInfo -- trait configuration (对应 OpenRA PathFinderInfo)
// ---------------------------------------------------------------------------

/**
 * Configuration for the PathFinder trait.
 *
 * OpenRA 对照: PathFinderInfo (TraitInfo)
 *
 * Attached to the world actor. Requires LocomotorInfo to be present.
 */
export class PathFinderInfo {
  /**
   * The search will aim for the shortest path when given a weight of 100%.
   * We can allow the search to find paths that aren't optimal by changing the
   * weight. The weight limits the worst case length of the path,
   * e.g. a weight of 110% will find a path no more than 10% longer than the
   * shortest possible. The benefit of allowing the search to return suboptimal
   * paths is faster computation time. The search can skip some areas of the
   * search space, meaning it has less work to do. Defaults to 125%.
   *
   * OpenRA 对照: PathFinderInfo.HeuristicWeightPercentage
   */
  readonly heuristicWeightPercentage: number

  /**
   * Create a new PathFinderInfo.
   *
   * OpenRA 对照: PathFinderInfo (default constructor with field initializer)
   *
   * @param heuristicWeightPercentage -- heuristic weight percentage (default 125)
   */
  constructor(heuristicWeightPercentage: number = 125) {
    this.heuristicWeightPercentage = heuristicWeightPercentage
  }
}

// ---------------------------------------------------------------------------
// PathFinder -- world-level pathfinding coordinator (对应 OpenRA PathFinder)
// ---------------------------------------------------------------------------

/**
 * Calculates routes for mobile actors with locomotors based on the A* search
 * algorithm. Attach this to the world actor.
 *
 * OpenRA 对照: PathFinder (class, implements IPathFinder, IWorldLoaded)
 *
 * The PathFinder is the bridge between the trait system (Locomotor) and the
 * pathfinding engine (HierarchicalPathFinder). It maintains per-Locomotor
 * HierarchicalPathFinder instances for both BlockedByActor.None (terrain-only)
 * and BlockedByActor.Immovable (terrain + immovable actors) blocking levels.
 *
 * NOTE: Some parameters from the C# signature (customCost, laneBias, inReverse)
 * are accepted but may not be fully utilized until the HierarchicalPathFinder
 * is extended to support them.
 * TODO-9.X: Extend HierarchicalPathFinder to support customCost, laneBias, inReverse fully.
 */
export class PathFinder {
  // ---------------------------------------------------------------------------
  // Static
  // ---------------------------------------------------------------------------

  /** Sentinel for no path found.
   *
   * OpenRA 对照: PathFinder.NoPath
   */
  static readonly NoPath: CPos[] = []

  // ---------------------------------------------------------------------------
  // Instance fields
  // ---------------------------------------------------------------------------

  /** The game world (set in worldLoaded).
   *
   * OpenRA 对照: PathFinder.world
   */
  private world: IGameWorld | null = null

  /** Trait configuration.
   *
   * OpenRA 对照: PathFinder.info
   */
  private readonly info: PathFinderInfo

  /** Optional debug overlay recorder.
   *
   * OpenRA 对照: PathFinder.pathFinderOverlay
   */
  private pathFinderOverlay: IPathFinderOverlay | null = null

  /** HPF instances keyed by Locomotor, for BlockedByActor.None.
   *
   * OpenRA 对照: PathFinder.hierarchicalPathFindersBlockedByNoneByLocomotor
   */
  private hierarchicalPathFindersBlockedByNoneByLocomotor: Map<ILocomotor, HierarchicalPathFinder> | null = null

  /** HPF instances keyed by Locomotor, for BlockedByActor.Immovable.
   *
   * OpenRA 对照: PathFinder.hierarchicalPathFindersBlockedByImmovableByLocomotor
   */
  private hierarchicalPathFindersBlockedByImmovableByLocomotor: Map<ILocomotor, HierarchicalPathFinder> | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a new PathFinder.
   *
   * OpenRA 对照: PathFinder(Actor, PathFinderInfo)
   *
   * @param info -- the trait configuration
   */
  constructor(info: PathFinderInfo) {
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  /**
   * Heuristic weight percentage, clamped to minimum of 100.
   *
   * OpenRA 对照: PathFinder.HeuristicWeightPercentage (private property)
   *
   * When the weight is 100%, the search will aim for the shortest path.
   * Higher values allow suboptimal but faster-computed paths.
   */
  get heuristicWeightPercentage(): number {
    return Math.max(100, this.info.heuristicWeightPercentage)
  }

  // ---------------------------------------------------------------------------
  // IWorldLoaded equivalent (对应 OpenRA PathFinder.WorldLoaded)
  // ---------------------------------------------------------------------------

  /**
   * Called when the world is loaded. Creates HierarchicalPathFinder instances
   * for each registered Locomotor.
   *
   * OpenRA 对照: PathFinder.WorldLoaded(World, WorldRenderer)
   *
   * Requires<LocomotorInfo> ensures all Locomotors have been initialized
   * before this method is called.
   *
   * @param world -- the game world
   * @param locomotors -- all Locomotors registered in the world
   */
  worldLoaded(world: IGameWorld, locomotors: ILocomotor[]): void {
    this.world = world

    // NOTE: pathFinderOverlay discovery is deferred until the overlay trait is migrated.
    // OpenRA does: pathFinderOverlay = world.WorldActor.TraitOrDefault<PathFinderOverlay>();
    // TODO-9.X: Discover PathFinderOverlay from world actor when migrated.

    this.hierarchicalPathFindersBlockedByNoneByLocomotor = new Map(
      locomotors.map(
        (locomotor) =>
          [
            locomotor,
            new HierarchicalPathFinder(world, locomotor, null, 0 /* BlockedByActor.None */),
          ] as const,
      ),
    )

    this.hierarchicalPathFindersBlockedByImmovableByLocomotor = new Map(
      locomotors.map(
        (locomotor) =>
          [
            locomotor,
            new HierarchicalPathFinder(world, locomotor, null, 1 /* BlockedByActor.Immovable */),
          ] as const,
      ),
    )
  }

  // ---------------------------------------------------------------------------
  // findPathToTargetCell -- main entry point, multi-source to single target
  // (对应 OpenRA PathFinder.FindPathToTargetCell)
  // ---------------------------------------------------------------------------

  /**
   * Calculates a path for the actor from multiple possible sources to target.
   * Returned path is *reversed* and given target to source.
   * The shortest path between a source and the target is returned.
   *
   * OpenRA 对照: PathFinder.FindPathToTargetCell(Actor, IEnumerable<CPos>, CPos, BlockedByActor, Func, Actor, bool)
   *
   * It is allowed for an actor to occupy an inaccessible space and move out of
   * it if another adjacent cell is accessible, but it is not allowed to move
   * into an inaccessible target space. Therefore it is vitally important to not
   * mix up the source and target locations.
   *
   * Searches that provide multiple source cells are slower than those that
   * provide only a single source cell, as optimizations are possible for the
   * single source case. Use searches from multiple source cells sparingly.
   *
   * @param self -- the actor requesting the path
   * @param sources -- possible starting cell positions
   * @param target -- target cell position
   * @param check -- blocking check level
   * @param customCost -- optional custom cost function
   * @param ignoreActor -- actor to ignore during blocking (null = none)
   * @param laneBias -- whether to apply lane bias (default true)
   * @returns array of CPos from target to source (reversed), or NO_PATH
   */
  findPathToTargetCell(
    self: IGameActor,
    sources: CPos[],
    target: CPos,
    check: BlockedByActor,
    customCost: ((cell: CPos) => number) | null = null,
    ignoreActor: IGameActor | null = null,
    laneBias: boolean = true,
  ): CPos[] {
    return this.findPathToTarget(
      self,
      sources,
      target,
      check,
      customCost,
      ignoreActor,
      false, // inReverse
      laneBias,
    )
  }

  // ---------------------------------------------------------------------------
  // findPathToTargetCells -- single source to multiple targets
  // (对应 OpenRA PathFinder.FindPathToTargetCells)
  // ---------------------------------------------------------------------------

  /**
   * Calculates a path for the actor from source to multiple possible targets.
   * Returned path is *reversed* and given target to source.
   * The shortest path between the source and a target is returned.
   *
   * OpenRA 对照: PathFinder.FindPathToTargetCells(Actor, CPos, IEnumerable<CPos>, BlockedByActor, Func, Actor, bool)
   *
   * We can reuse existing search infrastructure by swapping the single source
   * and multiple targets, and calling the existing methods that allow multiple
   * sources and one target. However there is a case of asymmetry we must
   * handle: an actor may move out of an inaccessible source, but may not move
   * onto an inaccessible target. We must account for this when performing
   * the swap.
   *
   * Searches that provide multiple target cells are slower than those that
   * provide only a single target cell, as optimizations are possible for the
   * single target case. Use searches to multiple target cells sparingly.
   *
   * @param self -- the actor requesting the path
   * @param source -- starting cell position
   * @param targets -- possible target cell positions
   * @param check -- blocking check level
   * @param customCost -- optional custom cost function
   * @param ignoreActor -- actor to ignore during blocking (null = none)
   * @param laneBias -- whether to apply lane bias (default true)
   * @returns array of CPos from target to source (reversed), or NO_PATH
   */
  findPathToTargetCells(
    self: IGameActor,
    source: CPos,
    targets: CPos[],
    check: BlockedByActor,
    customCost: ((cell: CPos) => number) | null = null,
    ignoreActor: IGameActor | null = null,
    laneBias: boolean = true,
  ): CPos[] {
    if (targets.length === 0) return NO_PATH

    const locomotor = getActorLocomotor(self)
    const world = this.requireWorld()

    // As targets must be accessible, determine accessible targets in advance so
    // when they become the sources we don't accidentally allow an inaccessible
    // position to become viable.
    const accessibleTargets: CPos[] = []
    for (const target of targets) {
      if (
        PathSearch.cellAllowsMovement(world, locomotor, target, customCost) &&
        // NOTE: MovementCostToEnterCell overload 2: (destNode, check, ignoreActor, ignoreSelf=true)
        locomotor.movementCostToEnterCell(
          self as unknown as ILocomotorActor,
          target,
          check,
          ignoreActor as unknown as ILocomotorActor | null,
          true,
        ) !== PathGraph.MovementCostForUnreachableCell
      ) {
        accessibleTargets.push(target)
      }
    }
    if (accessibleTargets.length === 0) return NO_PATH

    // When checking if the source location is accessible, we must also ignore
    // self, so that when it becomes a target we don't consider the location
    // blocked by ourselves!
    let path: CPos[]
    const sourceIsAccessible =
      PathSearch.cellAllowsMovement(world, locomotor, source, customCost) &&
      locomotor.movementCostToEnterCell(
        self as unknown as ILocomotorActor,
        source,
        check,
        ignoreActor as unknown as ILocomotorActor | null,
        true,
      ) !== PathGraph.MovementCostForUnreachableCell

    if (sourceIsAccessible) {
      // As both ends are accessible, we can freely swap them.
      path = this.findPathToTarget(
        self,
        accessibleTargets,
        source,
        check,
        customCost,
        ignoreActor,
        true, // inReverse — because we swapped source/target
        laneBias,
      )
    } else {
      // When we treat the source as a target, we need to be able to path to it.
      // We know this would fail as it is inaccessible but we need an exception
      // to be made. A hierarchical path search doesn't support this ability,
      // but the local pathfinder can deal with it when doing reverse searches.
      this.pathFinderOverlay?.newRecording(self, accessibleTargets, source)

      const search = PathSearch.toTargetCell(
        world,
        locomotor,
        self,
        accessibleTargets,
        source,
        check,
        this.heuristicWeightPercentage,
        customCost,
        ignoreActor,
        laneBias,
        true, // inReverse
        null, // heuristic
        null, // grid
        this.pathFinderOverlay?.recordLocalEdges(self) ?? null,
      )
      path = search.findPath()
      search.dispose()
    }

    // Since we swapped the positions, we need to reverse the path to swap it back.
    path.reverse()
    return path
  }

  // ---------------------------------------------------------------------------
  // findPathToTargetCellByPredicate -- multi-source, predicate-based target
  // (对应 OpenRA PathFinder.FindPathToTargetCellByPredicate)
  // ---------------------------------------------------------------------------

  /**
   * Calculates a path for the actor from multiple possible sources, whilst
   * searching for an acceptable target. Returned path is *reversed* and given
   * target to source. The shortest path between a source and a discovered
   * target is returned.
   *
   * OpenRA 对照: PathFinder.FindPathToTargetCellByPredicate(Actor, IEnumerable<CPos>, Func<CPos, bool>, BlockedByActor, Func, Actor, bool)
   *
   * Searches with this method are slower than findPathToTargetCell due to the
   * need to search for and discover an acceptable target cell. Use this search
   * sparingly.
   *
   * @param self -- the actor requesting the path
   * @param sources -- possible starting cell positions
   * @param targetPredicate -- predicate identifying acceptable target cells
   * @param check -- blocking check level
   * @param customCost -- optional custom cost function
   * @param ignoreActor -- actor to ignore during blocking (null = none)
   * @param laneBias -- whether to apply lane bias (default true)
   * @returns array of CPos from target to source (reversed), or NO_PATH
   */
  findPathToTargetCellByPredicate(
    self: IGameActor,
    sources: CPos[],
    targetPredicate: (cell: CPos) => boolean,
    check: BlockedByActor,
    customCost: ((cell: CPos) => number) | null = null,
    ignoreActor: IGameActor | null = null,
    laneBias: boolean = true,
  ): CPos[] {
    const world = this.requireWorld()

    this.pathFinderOverlay?.newRecording(self, sources, null)

    // With no pre-specified target location, we can only use a unidirectional search.
    const search = PathSearch.toTargetCellByPredicate(
      world,
      getActorLocomotor(self),
      self,
      sources,
      targetPredicate,
      check,
      customCost,
      ignoreActor,
      laneBias,
      this.pathFinderOverlay?.recordLocalEdges(self) ?? null,
    )
    const path = search.findPath()
    search.dispose()
    return path
  }

  // ---------------------------------------------------------------------------
  // Path existence checks (对应 OpenRA PathExists / PathMightExist)
  // ---------------------------------------------------------------------------

  /**
   * Determines if a path exists between source and target.
   * Only terrain is taken into account, i.e. as if BlockedByActor.None was
   * given. This would apply for any actor using the given Locomotor.
   *
   * OpenRA 对照: PathFinder.PathExistsForLocomotor(Locomotor, CPos, CPos)
   *
   * @param locomotor -- the locomotor to use
   * @param source -- starting cell position
   * @param target -- target cell position
   * @returns true if a path exists
   */
  pathExistsForLocomotor(
    locomotor: ILocomotor,
    source: CPos,
    target: CPos,
  ): boolean {
    const hpf = this.hierarchicalPathFindersBlockedByNoneByLocomotor?.get(locomotor)
    if (!hpf) {
      throw new Error(
        `No HierarchicalPathFinder registered for locomotor "${locomotor.Info.Name}". Was worldLoaded() called?`,
      )
    }
    return hpf.pathExists(source, target)
  }

  /**
   * Determines if a path exists between source and target.
   * Terrain and a *subset* of immovable actors are taken into account, i.e. as
   * if a subset of BlockedByActor.Immovable was given. This would apply for any
   * actor using the given Locomotor.
   *
   * OpenRA 对照: PathFinder.PathMightExistForLocomotorBlockedByImmovable(Locomotor, CPos, CPos)
   *
   * As only a subset of immovable actors are taken into account, this method
   * can return false positives, indicating a path might exist where none is
   * possible.
   *
   * @param locomotor -- the locomotor to use
   * @param source -- starting cell position
   * @param target -- target cell position
   * @returns true if a path might exist
   */
  pathMightExistForLocomotorBlockedByImmovable(
    locomotor: ILocomotor,
    source: CPos,
    target: CPos,
  ): boolean {
    const hpf = this.hierarchicalPathFindersBlockedByImmovableByLocomotor?.get(locomotor)
    if (!hpf) {
      throw new Error(
        `No HierarchicalPathFinder registered for locomotor "${locomotor.Info.Name}". Was worldLoaded() called?`,
      )
    }
    return hpf.pathExists(source, target)
  }

  // ---------------------------------------------------------------------------
  // getOverlayDataForLocomotor -- debug overlay support
  // (对应 OpenRA PathFinder.GetOverlayDataForLocomotor)
  // ---------------------------------------------------------------------------

  /**
   * Get debug overlay data for a Locomotor at a specific blocking level.
   *
   * OpenRA 对照: PathFinder.GetOverlayDataForLocomotor(Locomotor, BlockedByActor)
   *
   * @param locomotor -- the locomotor to get data for
   * @param check -- the blocking check level
   * @returns abstract graph and domain data, or null if not available
   */
  getOverlayDataForLocomotor(
    locomotor: ILocomotor,
    check: BlockedByActor,
  ): {
    abstractGraph: ReadonlyMap<number, GraphConnection[]>
    abstractDomains: ReadonlyMap<number, number>
  } | null {
    return this.getHierarchicalPathFinder(locomotor, check, null).getOverlayData()
  }

  // ---------------------------------------------------------------------------
  // Private: findPathToTarget -- internal pathfinding logic
  // (对应 OpenRA PathFinder.FindPathToTarget)
  // ---------------------------------------------------------------------------

  /**
   * Internal pathfinding logic shared by all public entry points.
   *
   * OpenRA 对照: PathFinder.FindPathToTarget(Actor, List<CPos>, CPos, BlockedByActor, Func, Actor, bool, bool)
   *
   * @param self -- the actor requesting the path
   * @param sources -- starting cell positions
   * @param target -- target cell position
   * @param check -- blocking check level
   * @param customCost -- optional custom cost function
   * @param ignoreActor -- actor to ignore during blocking (null = none)
   * @param inReverse -- whether the search is in reverse direction
   * @param laneBias -- whether to apply lane bias
   * @returns array of CPos from target to source (reversed), or NO_PATH
   */
  private findPathToTarget(
    self: IGameActor,
    sources: CPos[],
    target: CPos,
    check: BlockedByActor,
    customCost: ((cell: CPos) => number) | null,
    ignoreActor: IGameActor | null,
    inReverse: boolean,
    laneBias: boolean,
  ): CPos[] {
    if (sources.length === 0) return NO_PATH

    // NOTE: laneBias is accepted but not yet passed to HPF (HPF stub limitation)
    // TODO-9.X: Pass laneBias through HierarchicalPathFinder when it supports it.
    void laneBias

    const locomotor = getActorLocomotor(self)
    const world = this.requireWorld()

    // If the target cell is inaccessible, bail early.
    // The destination cell must allow movement and also have a reachable
    // movement cost.
    if (
      !PathSearch.cellAllowsMovement(world, locomotor, target, customCost) ||
      // NOTE: MovementCostToEnterCell overload 2: (destNode, check, ignoreActor, ignoreSelf=inReverse)
      locomotor.movementCostToEnterCell(
        self as unknown as ILocomotorActor,
        target,
        check,
        ignoreActor as unknown as ILocomotorActor | null,
        inReverse,
      ) === PathGraph.MovementCostForUnreachableCell
    ) {
      return NO_PATH
    }

    // When searching from only one source cell, some optimizations are possible.
    if (sources.length === 1) {
      const source = sources[0]

      // For adjacent cells on the same layer, we can return the path without
      // invoking a full search.
      if (source.Layer === target.Layer) {
        const diff = CPos.subtract(source, target)
        if (diff.lengthSquared < 3) {
          // If the source cell is inaccessible, there is no path.
          // Unlike the destination cell, the source cell is allowed to have an
          // unreachable movement cost.
          if (!PathSearch.cellAllowsMovement(world, locomotor, source, customCost)) {
            return NO_PATH
          }
          return [target, source]
        }
      }

      // Use a hierarchical path search, which performs a guided bidirectional search.
      const hpf = this.getHierarchicalPathFinder(locomotor, check, ignoreActor)
      const hpPath = hpf.findPath(source, target)
      if (hpPath === PathSearchNoPath || hpPath.length === 0) return NO_PATH

      // NOTE: TypeScript HPF returns source→target.
      // C# HPF returns target→source. We must reverse to match C# convention.
      hpPath.reverse()
      return hpPath
    }

    // Use a hierarchical path search, which performs a guided unidirectional search.
    // Since the TS HPF only supports single-source findPath, we try each source
    // individually and return the shortest path.
    // NOTE: This is less efficient than C#'s true multi-source search.
    // TODO-9.X: Extend HierarchicalPathFinder to support multi-source findPath.
    let bestPath: CPos[] = NO_PATH
    let bestCost = Number.MAX_SAFE_INTEGER

    const hpf = this.getHierarchicalPathFinder(locomotor, check, ignoreActor)
    for (const source of sources) {
      const hpPath = hpf.findPath(source, target)
      if (hpPath !== PathSearchNoPath && hpPath.length > 0 && hpPath.length < bestCost) {
        // NOTE: TypeScript HPF returns source→target, reverse to match C# convention
        hpPath.reverse()
        bestPath = [...hpPath]
        bestCost = hpPath.length
      }
    }

    return bestPath
  }

  // ---------------------------------------------------------------------------
  // Private: getHierarchicalPathFinder -- select the correct HPF
  // (对应 OpenRA PathFinder.GetHierarchicalPathFinder)
  // ---------------------------------------------------------------------------

  /**
   * Select the appropriate HierarchicalPathFinder for a given Locomotor and
   * blocking check level.
   *
   * OpenRA 对照: PathFinder.GetHierarchicalPathFinder(Locomotor, BlockedByActor, Actor)
   *
   * If there is an actor to ignore, we cannot use an HPF that accounts for any
   * blocking actors, because one of the blocking actors might be the one we
   * need to ignore!
   *
   * @param locomotor -- the locomotor to get the HPF for
   * @param check -- the blocking check level
   * @param ignoreActor -- actor to ignore, forces BlockedByActor.None HPF
   * @returns the appropriate HierarchicalPathFinder
   * @throws if no HPF is registered for the given locomotor
   */
  private getHierarchicalPathFinder(
    locomotor: ILocomotor,
    check: BlockedByActor,
    ignoreActor: IGameActor | null,
  ): HierarchicalPathFinder {
    // If there is an actor to ignore, we cannot use an HPF that accounts for
    // any blocking actors. One of the blocking actors might be the one we need
    // to ignore!
    const hpfs =
      check === 0 /* BlockedByActor.None */ || ignoreActor !== null
        ? this.hierarchicalPathFindersBlockedByNoneByLocomotor
        : this.hierarchicalPathFindersBlockedByImmovableByLocomotor

    if (!hpfs) {
      throw new Error(
        `HierarchicalPathFinder maps not initialized. Was worldLoaded() called with locomotors?`,
      )
    }

    const hpf = hpfs.get(locomotor)
    if (!hpf) {
      throw new Error(
        `No HierarchicalPathFinder registered for locomotor "${locomotor.Info.Name}". ` +
        `Registered locomotors: [${[...hpfs.keys()].map((l) => l.Info.Name).join(', ')}]`,
      )
    }

    return hpf
  }

  // ---------------------------------------------------------------------------
  // Private: requireWorld -- ensure world reference is available
  // ---------------------------------------------------------------------------

  /**
   * Get the world reference, throwing if not yet set.
   *
   * @returns the game world
   * @throws if worldLoaded() was not called
   */
  private requireWorld(): IGameWorld {
    if (!this.world) {
      throw new Error(
        'PathFinder.world is not set. worldLoaded() must be called before pathfinding operations.',
      )
    }
    return this.world
  }
}
