/**
 * IHitShape.ts -- Hit shape abstraction for targeting and damage calculations
 * OpenRA 对照: OpenRA.Mods.Common/HitShapes/IHitShape.cs
 *
 * 核心范式转换:
 * - C# interface IHitShape → TypeScript interface
 * - 2D distanceFromEdge → 3D XZ plane distance
 */

import type { WPos } from '../../../OpenRA.Game/WPos.js'
import type { WRot } from '../../../OpenRA.Game/WRot.js'
import type { WDist } from '../../../OpenRA.Game/WDist.js'

// ---------------------------------------------------------------------------
// IHitShape
// OpenRA 对照: IHitShape
// ---------------------------------------------------------------------------

/** Shape for actor targeting and damage calculations.
 *
 *  OpenRA 对照: IHitShape
 *
 *  All distance calculations are on the XZ plane (horizontal only).
 */
export interface IHitShape {
  /**
   * Distance from the shape edge to a point in 3D space.
   * All distance calculations are on the XZ plane (horizontal).
   *
   *  OpenRA 对照: IHitShape.DistanceFromEdge(WPos, WPos, WRot)
   *
   *  @returns WDist where 0 means the point is on or inside the shape
   */
  distanceFromEdge(pos: WPos, origin: WPos, orientation: WRot): WDist

  /** Initialize after loading (compute derived properties).
   *
   *  OpenRA 对照: IHitShape.Initialize()
   */
  initialize(): void
}
