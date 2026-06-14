/**
 * LineBuildNode.ts — LineBuild 连接节点的标记 trait
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Buildings/LineBuildNode.cs (30 lines)
 *
 * 核心范式转换:
 * - C# TraitInfo<LineBuildNode> → TS ITraitInfo interface
 * - C# ImmutableArray<CVec> → TS readonly CVec[]
 * - C# FrozenSet<string> → TS ReadonlySet<string>
 */

import type { ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// LineBuildNodeInfo
// OpenRA 对照: LineBuildNodeInfo : TraitInfo<LineBuildNode>
// ---------------------------------------------------------------------------

/** Configuration for the LineBuildNode trait.
 *
 * OpenRA 对照: LineBuildNodeInfo
 *
 * LineBuild actors attach to LineBuildNodes. A LineBuild actor can connect
 * to adjacent nodes of matching Types to form walls, fences, and other
 * linear structures.
 */
export class LineBuildNodeInfo implements ITraitInfo {
  readonly instanceName?: string

  /** This actor is of LineBuild 'NodeType'...
   *
   * OpenRA 对照: LineBuildNodeInfo.Types
   *
   * Default: `new HashSet<string> { "wall" }` in C#.
   * Connection type tags used to match with LineBuild actors.
   */
  readonly types: ReadonlySet<string>

  /** Cells (outside the footprint) that contain cells that can connect to
   * this actor.
   *
   * OpenRA 对照: LineBuildNodeInfo.Connections
   *
   * Default: four cardinal directions [(1,0), (0,1), (-1,0), (0,-1)].
   */
  readonly connections: readonly CVec[]

  constructor(params: {
    instanceName?: string
    types?: readonly string[]
    connections?: readonly CVec[]
  } = {}) {
    this.instanceName = params.instanceName
    this.types = new Set(params.types ?? ['wall'])
    this.connections = params.connections ?? [
      new CVec(1, 0),
      new CVec(0, 1),
      new CVec(-1, 0),
      new CVec(0, -1),
    ]
  }
}

// ---------------------------------------------------------------------------
// LineBuildNode
// OpenRA 对照: LineBuildNode (empty marker)
// ---------------------------------------------------------------------------

/** Marker trait for LineBuild connector nodes.
 *
 * OpenRA 对照: LineBuildNode
 *
 * This is an empty marker trait. All configuration is in LineBuildNodeInfo.
 */
export class LineBuildNode {
  // intentionally empty — marker trait
}
