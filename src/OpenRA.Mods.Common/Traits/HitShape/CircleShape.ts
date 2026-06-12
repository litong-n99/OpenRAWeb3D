/**
 * CircleShape.ts -- Circular hit shape (infinite-height cylinder in 3D)
 * OpenRA 对照: OpenRA.Mods.Common/HitShapes/CircleShape.cs
 *
 * 核心范式转换:
 * - C# CircleShape : IHitShape → TS class implementing IHitShape
 * - 2D circle → infinite-height cylinder (XZ-plane circle in 3D)
 * - distance = max(0, horizontalDistance(origin, pos) - radius)
 */

import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { isqrt } from '../../../OpenRA.Game/Exts.js'
import type { IHitShape } from './IHitShape.js'

// ---------------------------------------------------------------------------
// CircleShape
// OpenRA 对照: CircleShape
// ---------------------------------------------------------------------------

/** Circular hit shape (infinite-height cylinder in 3D).
 *
 *  OpenRA 对照: CircleShape class
 *
 *  Default hit shape. Distance from edge on XZ plane:
 *  distance = max(0, horizontalDistance(origin, pos) - radius)
 */
export class CircleShape implements IHitShape {
  /** The radius of the circle.
   *
   *  OpenRA 对照: CircleShape.Radius
   */
  radius: number = 0

  constructor(params: { radius?: number } = {}) {
    this.radius = params.radius ?? 0
  }

  /** Initialize after loading (no-op for circle).
   *
   *  OpenRA 对照: CircleShape.Initialize()
   */
  initialize(): void {
    // Radius is set directly during FieldLoader.Load — no derived properties
  }

  /** Distance from edge of the circle to a point on XZ plane.
   *
   *  OpenRA 对照: CircleShape.DistanceFromEdge(WPos, WPos, WRot)
   *
   *  Calculation:
   *  ```
   *  dx = pos.X - origin.X
   *  dy = pos.Y - origin.Y
   *  hDistSq = dx*dx + dy*dy
   *  hDist = isqrt(hDistSq)
   *  distance = max(0, hDist - radius)
   *  ```
   */
  distanceFromEdge(pos: WPos, origin: WPos, _orientation: WRot): WDist {
    const dx = pos.X - origin.X
    const dy = pos.Y - origin.Y
    const hDistSq = dx * dx + dy * dy

    // Optimization: if distSq <= radiusSq, we're inside
    if (hDistSq <= this.radius * this.radius) return WDist.Zero

    const hDist = isqrt(hDistSq)
    return new WDist(hDist - this.radius)
  }
}
