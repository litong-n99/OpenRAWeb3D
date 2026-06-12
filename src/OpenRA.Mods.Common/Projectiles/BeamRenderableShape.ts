/**
 * BeamRenderableShape.ts -- beam rendering shape enum shared by beam projectiles
 * OpenRA 对照: OpenRA.Mods.Common.Graphics.BeamRenderableShape
 *
 * 核心范式转换:
 * - C# enum BeamRenderableShape → TypeScript const object + type alias
 * - C# RgbaColorRenderer.DrawLine (Cylindrical) / FillRect (Flat) →
 *   Babylon.js LinesMesh (Cylindrical) / Plane mesh (Flat)
 */

export const BeamRenderableShape = {
  /** Line-thickness beam (Cylindrical). */
  Cylindrical: 0,
  /** Flat ribbon beam. */
  Flat: 1,
} as const
export type BeamRenderableShape = (typeof BeamRenderableShape)[keyof typeof BeamRenderableShape]
