/**
 * LineBuild.ts — 墙壁/线性建筑连接 trait：连接线段与节点
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/LineBuild.cs (124 lines)
 *
 * 核心范式转换:
 * - C# LineBuildDirection enum → TS LineBuildDirection const object
 * - C# ValueActorInit<T> → TS ValueActorInit<T> (from ActorInitializer.ts)
 * - C# FrozenSet<string> → TS ReadonlySet<string>
 * - C# Actor[] parentNodes → TS IGameActor[] _parentNodes
 * - C# TraitsImplementing<T>() → TS actor.traitsImplementing?.(interfaceId)
 * - C# Actor.Dispose()/Kill() → TS actor.dispose?.()/kill?.(attacker)
 */

import {
  ValueActorInit,
  type ISingleInstanceInit,
  type ActorInitializer,
} from '../../../OpenRA.Game/ActorInitializer.js'
import type {
  IGameActor,
  ITraitInfo,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
  INotifyKilled,
  AttackInfo,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// LineBuildDirection
// OpenRA 对照: public enum LineBuildDirection { Unset, X, Y }
// ---------------------------------------------------------------------------

/** Direction for wall line building.
 *
 * OpenRA 对照: LineBuildDirection
 */
export const LineBuildDirection = {
  Unset: 0,
  X: 1,
  Y: 2,
} as const

export type LineBuildDirection =
  (typeof LineBuildDirection)[keyof typeof LineBuildDirection]

// ---------------------------------------------------------------------------
// LineBuildDirectionInit
// OpenRA 对照: LineBuildDirectionInit : ValueActorInit<LineBuildDirection>, ISingleInstanceInit
// ---------------------------------------------------------------------------

/** Initialization parameter for the line build direction.
 *
 * OpenRA 对照: LineBuildDirectionInit
 */
export class LineBuildDirectionInit
  extends ValueActorInit<LineBuildDirection>
  implements ISingleInstanceInit
{
  readonly key = 'lineBuildDirection'

  constructor(value: LineBuildDirection) {
    super(value)
  }
}

// ---------------------------------------------------------------------------
// LineBuildParentInit
// OpenRA 对照: LineBuildParentInit : ValueActorInit<string[]>, ISingleInstanceInit
// ---------------------------------------------------------------------------

/** Initialization parameter for the parent node actors of a line build segment.
 *
 * OpenRA 对照: LineBuildParentInit
 *
 * In OpenRA, this includes a direct Actor[] constructor path (when actors
 * are passed directly) and a string[] resolution path (resolving actor names
 * via SpawnMapActors). The TS migration preserves both paths:
 * - `ActorValue` receives the world and resolves parents from stored actors
 *   or from actor name resolution.
 */
export class LineBuildParentInit
  extends ValueActorInit<string[]>
  implements ISingleInstanceInit
{
  readonly key = 'lineBuildParent'

  /** Direct parent actor references (set when actors are known at init time). */
  private readonly _parentActors: IGameActor[] | null

  /** Create a LineBuildParentInit with pre-resolved parent actors.
   *
   * OpenRA 对照: LineBuildParentInit(Actor[] value)
   *
   * @param parents — the parent actor references (directly known)
   */
  constructor(parents: IGameActor[] | null | string[]) {
    // C# base([]) — string[] type for the ValueActorInit base
    super([])
    if (parents && parents.length > 0 && typeof parents[0] !== 'string') {
      this._parentActors = parents as IGameActor[]
    } else {
      this._parentActors = null
    }
  }

  /** Resolve parent actors from the world.
   *
   * OpenRA 对照: LineBuildParentInit.ActorValue(World world)
   *
   * @param _world — the game world (used for string name resolution)
   * @returns the resolved parent actors
   */
  actorValue(_world?: unknown): IGameActor[] {
    if (this._parentActors) {
      return this._parentActors
    }

    // NOTE: string-based resolution via SpawnMapActors is not yet available.
    // When SpawnMapActors is migrated, this will resolve actor names.
    // TODO-11.B.X: Implement SpawnMapActors resolution when migrated.
    return []
  }
}

// ---------------------------------------------------------------------------
// INotifyLineBuildSegmentsChanged
// OpenRA 对照: INotifyLineBuildSegmentsChanged interface
// ---------------------------------------------------------------------------

/** Notified when a line build segment is added or removed from a node.
 *
 * OpenRA 对照: INotifyLineBuildSegmentsChanged
 *
 * LineBuild implements this interface to track child segments.
 * The INTERFACE_ID constant is used for `traitsImplementing()` lookup.
 */
export interface INotifyLineBuildSegmentsChanged {
  segmentAdded(self: IGameActor, segment: IGameActor): void
  segmentRemoved(self: IGameActor, segment: IGameActor): void
}

/** Interface identifier for `traitsImplementing()` lookup.
 *
 * OpenRA 对照: typeof(INotifyLineBuildSegmentsChanged)
 */
export const INotifyLineBuildSegmentsChanged_ID =
  'INotifyLineBuildSegmentsChanged'

// ---------------------------------------------------------------------------
// LineBuildInfo
// OpenRA 对照: LineBuildInfo : TraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the LineBuild trait.
 *
 * OpenRA 对照: LineBuildInfo
 *
 * Defines the parameters for wall/line building: which node types to connect to,
 * the segment actor type, maximum line length, and segment lifecycle behavior.
 */
export class LineBuildInfo implements ITraitInfo {
  readonly instanceName?: string

  /** The maximum allowed length of the line in cells.
   *
   * OpenRA 对照: LineBuildInfo.Range (default 5)
   */
  readonly range: number

  /** Node type tags this LineBuild actor can attach to.
   *
   * OpenRA 对照: LineBuildInfo.NodeTypes (FrozenSet<string>)
   *
   * Default: `new Set(["wall"])` matching OpenRA's default.
   */
  readonly nodeTypes: ReadonlySet<string>

  /** Actor type for line-built segments.
   *
   * OpenRA 对照: LineBuildInfo.SegmentType
   *
   * If null, defaults to the same actor type as the parent.
   */
  readonly segmentType: string | null

  /** When true, generated segments are deleted when their parent node
   * is destroyed or sold.
   *
   * OpenRA 对照: LineBuildInfo.SegmentsRequireNode (default false)
   */
  readonly segmentsRequireNode: boolean

  constructor(params: {
    instanceName?: string
    range?: number
    nodeTypes?: readonly string[]
    segmentType?: string | null
    segmentsRequireNode?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.range = params.range ?? 5
    this.nodeTypes = new Set(params.nodeTypes ?? ['wall'])
    this.segmentType = params.segmentType ?? null
    this.segmentsRequireNode = params.segmentsRequireNode ?? false
  }

  /** Create the LineBuild trait from this info and an initializer.
   *
   * OpenRA 对照: LineBuildInfo.Create(ActorInitializer init)
   *
   * @param init — the actor initializer (contains LineBuildParentInit)
   * @returns a new LineBuild instance
   */
  create(init: ActorInitializer): LineBuild {
    return new LineBuild(init, this)
  }
}

// ---------------------------------------------------------------------------
// LineBuild
// OpenRA 对照: LineBuild : INotifyKilled, INotifyAddedToWorld,
//   INotifyRemovedFromWorld, INotifyLineBuildSegmentsChanged
// ---------------------------------------------------------------------------

/** Handles wall/line building — connects segments between nodes.
 *
 * OpenRA 对照: LineBuild
 *
 * This trait is placed on both line build nodes and their child segments.
 * When a segment is created, it registers with its parent nodes via
 * INotifyLineBuildSegmentsChanged. When a segment is removed, it unregisters.
 * If SegmentsRequireNode is true, destroying a node also destroys its segments.
 */
export class LineBuild
  implements
    INotifyAddedToWorld,
    INotifyRemovedFromWorld,
    INotifyKilled,
    INotifyLineBuildSegmentsChanged
{
  /** The configuration info for this trait. */
  readonly info: LineBuildInfo

  /** Connected parent node actors.
   *
   * OpenRA 对照: LineBuild.parentNodes (Actor[])
   */
  private readonly _parentNodes: IGameActor[]

  /** Child segment actors spawned by this node.
   *
   * OpenRA 对照: LineBuild.segments (HashSet<Actor>)
   */
  private _segments: Set<IGameActor> | null = null

  /** Construct a LineBuild trait.
   *
   * OpenRA 对照: LineBuild(ActorInitializer init, LineBuildInfo info)
   *
   * @param init — the actor initializer for resolving parent nodes
   * @param info — configuration for this trait
   */
  constructor(init: ActorInitializer, info: LineBuildInfo) {
    this.info = info

    // Resolve parent nodes from the initializer
    const lineBuildParentInit = init.get<LineBuildParentInit>('lineBuildParent')
    if (lineBuildParentInit) {
      this._parentNodes = lineBuildParentInit.actorValue(init.world)
    } else {
      this._parentNodes = []
    }
  }

  /** Child segments of this node.
   *
   * OpenRA 对照: LineBuild.segments
   */
  get segments(): ReadonlySet<IGameActor> {
    return this._segments ?? new Set()
  }

  // -----------------------------------------------------------------------
  // INotifyLineBuildSegmentsChanged
  // OpenRA 对照: INotifyLineBuildSegmentsChanged.SegmentAdded / SegmentRemoved
  // -----------------------------------------------------------------------

  /** Called when a child segment is added.
   *
   * OpenRA 对照: INotifyLineBuildSegmentsChanged.SegmentAdded(Actor self, Actor segment)
   *
   * @param _self — the parent actor (this is attached to)
   * @param segment — the newly created segment actor
   */
  segmentAdded(_self: IGameActor, segment: IGameActor): void {
    if (!this._segments) {
      this._segments = new Set()
    }
    this._segments.add(segment)
  }

  /** Called when a child segment is removed.
   *
   * OpenRA 对照: INotifyLineBuildSegmentsChanged.SegmentRemoved(Actor self, Actor segment)
   *
   * @param _self — the parent actor
   * @param segment — the segment actor being removed
   */
  segmentRemoved(_self: IGameActor, segment: IGameActor): void {
    this._segments?.delete(segment)
  }

  // -----------------------------------------------------------------------
  // INotifyAddedToWorld
  // OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor self)
  // -----------------------------------------------------------------------

  /** Called when this actor is added to the world.
   *
   * OpenRA 对照: INotifyAddedToWorld.AddedToWorld(Actor self)
   *
   * Registers this segment with all parent node actors by calling
   * segmentAdded on each parent's INotifyLineBuildSegmentsChanged traits.
   */
  addedToWorld(self: IGameActor): void {
    for (const parent of this._parentNodes) {
      if (parent.disposed) continue

      // Find traits on the parent that handle line build segment changes
      const handlers = parent.traitsImplementing?.(
        INotifyLineBuildSegmentsChanged_ID,
      ) as INotifyLineBuildSegmentsChanged[] | undefined

      if (handlers) {
        for (const handler of handlers) {
          handler.segmentAdded(parent, self)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // INotifyRemovedFromWorld
  // OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
  // -----------------------------------------------------------------------

  /** Called when this actor is removed from the world.
   *
   * OpenRA 对照: INotifyRemovedFromWorld.RemovedFromWorld(Actor self)
   *
   * Unregisters this segment from all parent nodes. If SegmentsRequireNode
   * is true, also disposes all child segments.
   */
  removedFromWorld(self: IGameActor): void {
    // Notify parent nodes that this segment is being removed
    for (const parent of this._parentNodes) {
      if (parent.disposed) continue

      const handlers = parent.traitsImplementing?.(
        INotifyLineBuildSegmentsChanged_ID,
      ) as INotifyLineBuildSegmentsChanged[] | undefined

      if (handlers) {
        for (const handler of handlers) {
          handler.segmentRemoved(parent, self)
        }
      }
    }

    // If segments depend on this node, dispose them
    if (this.info.segmentsRequireNode && this._segments) {
      for (const s of this._segments) {
        s.dispose?.()
      }
    }
  }

  // -----------------------------------------------------------------------
  // INotifyKilled
  // OpenRA 对照: INotifyKilled.Killed(Actor self, AttackInfo e)
  // -----------------------------------------------------------------------

  /** Called when this actor is killed.
   *
   * OpenRA 对照: INotifyKilled.Killed(Actor self, AttackInfo e)
   *
   * If SegmentsRequireNode is true, kills all child segments with the
   * same attacker.
   */
  killed(_self: IGameActor, e: AttackInfo): void {
    if (this.info.segmentsRequireNode && this._segments) {
      for (const s of this._segments) {
        s.kill?.(e.attacker)
      }
    }
  }
}
