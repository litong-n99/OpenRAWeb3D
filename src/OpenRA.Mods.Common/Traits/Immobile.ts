/**
 * Immobile.ts — IOccupySpace for static actors (buildings, walls)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Immobile.cs
 *
 * 核心范式转换:
 * - C# ImmobileInfo : TraitInfo, IOccupySpaceInfo → TypeScript class implements IOccupySpaceInfo
 * - C# Immobile : IOccupySpace, ISync → TypeScript class implements IOccupySpace
 * - C# ActorInitializer.LocationInit → constructor parameter
 * - C# Map.CenterOfCell() → static helper centerOfCell() using rectangular grid formula
 */

import {
  type IGameActor,
  type ITraitInfo,
  type IOccupySpace,
  type IOccupySpaceInfo,
  type OccupiedCell,
  type INotifyAddedToWorld,
  type INotifyRemovedFromWorld,
  type ISync,
  type ActorInfoStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { SubCell as SubCellEnum } from '../../OpenRA.Game/Traits/SubCell.js'
import { SubCell } from '../../OpenRA.Game/Traits/SubCell.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// ImmobileInfo
// OpenRA 对照: ImmobileInfo (TraitInfo, IOccupySpaceInfo)
// ---------------------------------------------------------------------------

/** Configuration for the Immobile trait.
 *
 * OpenRA 对照: ImmobileInfo (sealed class, TraitInfo, IOccupySpaceInfo)
 */
export class ImmobileInfo implements ITraitInfo, IOccupySpaceInfo {
  readonly instanceName?: string

  /** Whether this actor occupies space on the map.
   *
   * OpenRA 对照: ImmobileInfo.OccupiesSpace (default true)
   */
  readonly occupiesSpace: boolean

  constructor(params: {
    instanceName?: string
    occupiesSpace?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.occupiesSpace = params.occupiesSpace ?? true
  }

  // ---------------------------------------------------------------------------
  // IOccupySpaceInfo
  // OpenRA 对照: IOccupySpaceInfo.OccupiedCells(ActorInfo, CPos, SubCell)
  // ---------------------------------------------------------------------------

  /** Compute which cells this actor occupies at the given location.
   *
   * OpenRA 对照: IOccupySpaceInfo.OccupiedCells(ActorInfo, CPos, SubCell)
   *
   * @param _info — actor type info (not used in this simple case)
   * @param location — the cell position to occupy
   * @param _subCell — sub-cell position (ignored, always FullCell)
   * @returns a Map of {location → SubCell.FullCell} if occupiesSpace, empty otherwise
   */
  occupiedCells(
    _info: ActorInfoStub,
    location: CPos,
    _subCell?: SubCellEnum,
  ): ReadonlyMap<CPos, SubCellEnum> {
    if (!this.occupiesSpace) {
      return new Map()
    }
    const map = new Map<CPos, SubCellEnum>()
    map.set(location, SubCell.FullCell)
    return map
  }

  /** Whether this actor shares cells with other actors.
   *
   * OpenRA 对照: IOccupySpaceInfo.SharesCell => false
   *
   * Immobile actors (buildings, walls) never share cells.
   */
  get sharesCell(): boolean {
    return false
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Create an Immobile trait instance from this info and an initial CPos.
   *
   * OpenRA 对照: ImmobileInfo.Create(ActorInitializer init)
   *
   * @param cpos — the top-left cell position (from LocationInit)
   * @param centerPosition — the world-space center position (computed by caller via Map.centerOfCell)
   * @returns a new Immobile trait instance
   */
  create(cpos: CPos, centerPosition: WPos): Immobile {
    return new Immobile(cpos, centerPosition, this)
  }
}

// ---------------------------------------------------------------------------
// Immobile
// OpenRA 对照: Immobile (IOccupySpace, ISync, INotifyAddedToWorld, INotifyRemovedFromWorld)
// ---------------------------------------------------------------------------

/** IOccupySpace implementation for static actors (buildings, walls).
 *
 * OpenRA 对照: Immobile (sealed class)
 *
 * Provides cell occupation tracking for actors that cannot move.
 * Registers with the world's spatial index when added/removed.
 */
export class Immobile
  implements IOccupySpace, ISync, INotifyAddedToWorld, INotifyRemovedFromWorld
{
  /** Pre-computed occupied cells array (no per-frame allocation).
   *
   * OpenRA 对照: Immobile.occupied field (readonly (CPos, SubCell)[])
   */
  private readonly _occupied: readonly OccupiedCell[]

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Construct an Immobile trait.
   *
   * OpenRA 对照: Immobile(ActorInitializer init, ImmobileInfo info)
   *
   * @param cpos — the top-left cell position (from LocationInit)
   * @param centerPosition — the world-space center position (computed via Map.centerOfCell)
   * @param info — the trait configuration
   */
  constructor(
    cpos: CPos,
    centerPosition: WPos,
    info: ImmobileInfo,
  ) {
    this._topLeft = cpos
    this._centerPosition = centerPosition

    // Pre-compute the occupied cells array — never changes for immobile actors
    if (info.occupiesSpace) {
      this._occupied = [{ cell: cpos, subCell: SubCell.FullCell }]
    } else {
      this._occupied = []
    }
  }

  // ---------------------------------------------------------------------------
  // IOccupySpace — Position
  // ---------------------------------------------------------------------------

  private readonly _topLeft: CPos

  /** Top-left cell position of this actor.
   *
   * OpenRA 对照: Immobile.TopLeft [VerifySync]
   */
  get topLeft(): CPos {
    return this._topLeft
  }

  private readonly _centerPosition: WPos

  /** Center position in world coordinates.
   *
   * OpenRA 对照: Immobile.CenterPosition [VerifySync]
   */
  get centerPosition(): WPos {
    return this._centerPosition
  }

  // ---------------------------------------------------------------------------
  // IOccupySpace — Occupied Cells
  // ---------------------------------------------------------------------------

  /** Get the cells this actor occupies.
   *
   * OpenRA 对照: Immobile.OccupiedCells()
   *
   * Returns a pre-computed array — no allocation on every call.
   * @returns array of OccupiedCell entries (1 cell if occupiesSpace, empty otherwise)
   */
  occupiedCells(): readonly OccupiedCell[] {
    return this._occupied
  }

  // ---------------------------------------------------------------------------
  // INotifyAddedToWorld
  // OpenRA 对照: Immobile.AddedToWorld(Actor)
  // ---------------------------------------------------------------------------

  /** Register this actor's spatial presence when added to the world.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor)
   *
   * Calls World.AddToMaps(self, this) to register cell occupation.
   * Uses duck-typing since WorldStub does not declare addToMaps yet.
   *
   * @param self — the actor being added to the world
   */
  addedToWorld(self: IGameActor): void {
    if (self.world) {
      const worldAny = self.world as unknown as {
        addToMaps?: (actor: IGameActor, ios: IOccupySpace) => void
      }
      if (worldAny.addToMaps) {
        worldAny.addToMaps(self, this)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // OpenRA 对照: Immobile.RemovedFromWorld(Actor)
  // ---------------------------------------------------------------------------

  /** Unregister this actor's spatial presence when removed from the world.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor)
   *
   * Calls World.RemoveFromMaps(self, this) to unregister cell occupation.
   * Uses duck-typing since WorldStub does not declare removeFromMaps yet.
   *
   * @param self — the actor being removed from the world
   */
  removedFromWorld(self: IGameActor): void {
    if (self.world) {
      const worldAny = self.world as unknown as {
        removeFromMaps?: (actor: IGameActor, ios: IOccupySpace) => void
      }
      if (worldAny.removeFromMaps) {
        worldAny.removeFromMaps(self, this)
      }
    }
  }
}
