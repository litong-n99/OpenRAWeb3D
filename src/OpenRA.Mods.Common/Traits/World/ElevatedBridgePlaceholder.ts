/**
 * ElevatedBridgePlaceholder.ts — 高架桥梁占位符 (bridge footprint editor config)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ElevatedBridgePlaceholder.cs
 *
 * 核心范式转换:
 * - C# enum ElevatedBridgePlaceholderOrientation → TypeScript const enum
 * - C# FieldLoader.Require attributes → constructor parameter validation
 * - C# TraitInfo<T> generic base → TypeScript class implements ITraitInfo
 * - C# IEnumerable<CPos> (yield return) → TypeScript Array<CPos> (pre-computed)
 *
 * NOTE: This is a map editor trait. Placed during map creation to define
 * which cells form an elevated bridge footprint. The bridge cells and end
 * cells are computed from Location, Orientation, and Length.
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { CVec } from '../../../OpenRA.Game/CVec'
import type { ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// ElevatedBridgePlaceholderOrientation enum
// ---------------------------------------------------------------------------

/** Bridge orientation in the map.
 *
 * OpenRA 对照: ElevatedBridgePlaceholderOrientation enum { X, Y }
 *
 * X-oriented bridges extend horizontally (east-west in cell coordinates).
 * Y-oriented bridges extend vertically (north-south in cell coordinates).
 */
export const ElevatedBridgePlaceholderOrientation = {
  X: 0,
  Y: 1,
} as const

/** Type for ElevatedBridgePlaceholderOrientation values. */
export type ElevatedBridgePlaceholderOrientation =
  (typeof ElevatedBridgePlaceholderOrientation)[keyof typeof ElevatedBridgePlaceholderOrientation]

// ---------------------------------------------------------------------------
// ElevatedBridgePlaceholderInfo
// 对应 OpenRA ElevatedBridgePlaceholderInfo
// ---------------------------------------------------------------------------

/**
 * Placeholder configuration for an elevated bridge footprint on a map.
 *
 * OpenRA 对照: ElevatedBridgePlaceholderInfo (TraitInfo<ElevatedBridgePlaceholder>)
 *
 * Defines the bridge footprint: where the bridge is located, its orientation,
 * length, height above ground, and terrain type. The actual bridge cells and
 * end cells are derived from Location + Orientation + Length.
 *
 * A bridge is 3 cells wide and (Length+1) cells long.
 * The footprint cells plus end cells define elevated bridge passability.
 */
export class ElevatedBridgePlaceholderInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Location of the bridge top-left corner.
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo.Location
   */
  readonly Location: CPos

  /** Orientation of the bridge.
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo.Orientation
   */
  readonly Orientation: ElevatedBridgePlaceholderOrientation

  /** Length of the bridge (in cells, excluding start cell).
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo.Length
   *
   * The total bridge span is (Length + 1) cells in the direction of Orientation.
   */
  readonly Length: number

  /** Height of the bridge in map height steps.
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo.Height
   *
   * Each step is CellHeightStep.Length (512 WDist units). The bridge deck
   * sits at Height * CellHeightStep above ground zero.
   */
  readonly Height: number

  /** Terrain type of the bridge surface.
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo.TerrainType
   */
  readonly TerrainType: string

  /**
   * Create an ElevatedBridgePlaceholderInfo.
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo (FieldLoader.Require fields)
   *
   * @param opts — bridge configuration
   * @param opts.location — top-left corner cell position
   * @param opts.orientation — X or Y orientation
   * @param opts.length — bridge length in cells
   * @param opts.height — bridge height in map height steps
   * @param opts.terrainType — terrain type name (default "Road")
   * @param opts.instanceName — optional instance name for trait disambiguation
   */
  constructor(opts: {
    location: CPos
    orientation: ElevatedBridgePlaceholderOrientation
    length: number
    height: number
    terrainType?: string
    instanceName?: string
  }) {
    this.instanceName = opts.instanceName
    this.Location = opts.location
    this.Orientation = opts.orientation
    this.Length = opts.length
    this.Height = opts.height
    this.TerrainType = opts.terrainType ?? 'Road'
  }

  // ---------------------------------------------------------------------------
  // BridgeCells — all cells of the bridge footprint
  // ---------------------------------------------------------------------------

  /**
   * Enumerate all cells that form the bridge footprint.
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo.BridgeCells()
   *
   * The bridge is 3 cells wide and (Length + 1) cells long.
   * For X orientation: width = Length+1 along X, height = 3 along Y.
   * For Y orientation: width = 3 along X, height = Length+1 along Y.
   *
   * @returns array of all cells in the bridge footprint
   */
  bridgeCells(): CPos[] {
    const dimensions =
      this.Orientation === ElevatedBridgePlaceholderOrientation.X
        ? { X: this.Length + 1, Y: 3 }
        : { X: 3, Y: this.Length + 1 }

    const result: CPos[] = []
    for (let y = 0; y < dimensions.Y; y++) {
      for (let x = 0; x < dimensions.X; x++) {
        result.push(CPos.add(this.Location, new CVec(x, y)))
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // EndCells — entry/exit cells at the ends of the bridge
  // ---------------------------------------------------------------------------

  /**
   * Enumerate the cells at both ends of the bridge (entry/exit points).
   *
   * OpenRA 对照: ElevatedBridgePlaceholderInfo.EndCells()
   *
   * For X orientation: both ends along X axis, 3 cells each.
   * For Y orientation: both ends along Y axis, 3 cells each.
   *
   * These cells allow transition between ground layer and bridge layer.
   *
   * @returns array of all end-point cells
   */
  endCells(): CPos[] {
    const result: CPos[] = []

    if (this.Orientation === ElevatedBridgePlaceholderOrientation.X) {
      for (let y = 0; y < 3; y++) {
        result.push(CPos.add(this.Location, new CVec(0, y)))
        result.push(CPos.add(this.Location, new CVec(this.Length, y)))
      }
    } else {
      for (let x = 0; x < 3; x++) {
        result.push(CPos.add(this.Location, new CVec(x, 0)))
        result.push(CPos.add(this.Location, new CVec(x, this.Length)))
      }
    }

    return result
  }
}

// ---------------------------------------------------------------------------
// ElevatedBridgePlaceholder — empty trait marker class
// 对应 OpenRA ElevatedBridgePlaceholder
// ---------------------------------------------------------------------------

/**
 * Empty trait marker for the ElevatedBridgePlaceholder.
 *
 * OpenRA 对照: ElevatedBridgePlaceholder (empty class)
 *
 * NOTE: In OpenRA, this is an empty class — all data lives in the Info
 * (TraitInfo). The ElevatedBridgeLayer reads the Info data from the
 * world actor's trait infos.
 */
export class ElevatedBridgePlaceholder {
  // intentionally empty — all data is in ElevatedBridgePlaceholderInfo
}
