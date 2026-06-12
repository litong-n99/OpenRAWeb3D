/**
 * RectangleShape.ts -- Rectangle hit shape (2D rectangle on XZ plane)
 * OpenRA 对照: OpenRA.Mods.Common/HitShapes/RectangleShape.cs
 *
 * 核心范式转换:
 * - C# RectangleShape : IHitShape → TS class implementing IHitShape
 * - 2D rectangle → AABB on XZ plane, transformed by actor orientation
 * - 4 half-plane test for inside/outside determination
 * - Capsule and Polygon deferred (TODO-8.D.HITSHAPE-DEFER)
 */

import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WRot } from '../../../OpenRA.Game/WRot.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { isqrt } from '../../../OpenRA.Game/Exts.js'
import type { IHitShape } from './IHitShape.js'

// ---------------------------------------------------------------------------
// RectangleShape
// OpenRA 对照: RectangleShape
// ---------------------------------------------------------------------------

/** Rectangle hit shape (2D rectangle on XZ plane, transformed by orientation).
 *
 *  OpenRA 对照: RectangleShape class
 *
 *  Uses a 4 half-plane test:
 *  1. Transform point to local coordinates (inverse rotate by actor orientation)
 *  2. Check against axis-aligned rectangle [-halfX, +halfX] x [-halfY, +halfY]
 *  3. If inside: return WDist.Zero
 *  4. If outside: distance to nearest edge
 */
export class RectangleShape implements IHitShape {
  /** Half-width in the forward direction (X in local space).
   *
   *  OpenRA 对照: RectangleShape.OuterRadius (width / 2)
   */
  halfX: number = 0

  /** Half-height in the sideways direction (Y in local space).
   *
   *  OpenRA 对照: RectangleShape.InnerRadius (height / 2)
   */
  halfY: number = 0

  constructor(params: { halfX?: number; halfY?: number } = {}) {
    this.halfX = params.halfX ?? 0
    this.halfY = params.halfY ?? 0
  }

  /** Initialize after loading (no-op for rectangle).
   *
   *  OpenRA 对照: RectangleShape.Initialize()
   */
  initialize(): void {
    // halfX/halfY set during FieldLoader.Load
  }

  /** Distance from edge of rectangle to a point on XZ plane.
   *
   *  OpenRA 对照: RectangleShape.DistanceFromEdge(WPos, WPos, WRot)
   *
   *  Algorithm:
   *  1. Subtract origin from pos to get local position
   *  2. Inverse-rotate by orientation (negate yaw component)
   *  3. Check against AABB [-halfX, +halfX] x [-halfY, +halfY]
   *  4. Inside → WDist.Zero
   *  5. Outside → distance to nearest edge
   */
  distanceFromEdge(pos: WPos, origin: WPos, orientation: WRot): WDist {
    // Get local position (relative to origin)
    const localX = pos.X - origin.X
    const localY = pos.Y - origin.Y
    // Skip Z for 2D calculation

    // Inverse-rotate by orientation.yaw to align with rectangle axes
    // Rotate by negative yaw: x' = x*cos(-yaw) - y*sin(-yaw)
    // Since cos(-a)=cos(a), sin(-a)=-sin(a):
    // x' = x*cos(yaw) + y*sin(yaw)
    // y' = -x*sin(yaw) + y*cos(yaw)
    const yaw = orientation.yaw
    const cosVal = yaw.cos()
    const sinVal = yaw.sin()

    // Transform to local rectangle-aligned coordinates
    // (using integer trig: cosVal/sinVal are in [−1024, 1024], normalized by 1024)
    const rx = Math.trunc((localX * cosVal + localY * sinVal) / 1024)
    const ry = Math.trunc((-localX * sinVal + localY * cosVal) / 1024)

    const absRx = Math.abs(rx)
    const absRy = Math.abs(ry)

    // Inside the rectangle?
    if (absRx <= this.halfX && absRy <= this.halfY) return WDist.Zero

    // Outside: distance to nearest edge
    const dx = Math.max(0, absRx - this.halfX)
    const dy = Math.max(0, absRy - this.halfY)

    if (dx === 0 && dy === 0) return WDist.Zero

    return new WDist(isqrt(dx * dx + dy * dy))
  }
}
