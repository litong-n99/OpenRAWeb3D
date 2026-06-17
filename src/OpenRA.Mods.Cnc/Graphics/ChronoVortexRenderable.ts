/**
 * ChronoVortexRenderable.ts — 时空涡旋可渲染体（传送出发/到达点的旋转涡旋效果）
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.cs (67 lines)
 *
 * 核心范式转换:
 * - C# IRenderable + IFinalizedRenderable (CPU 2D 渲染) → TS renderable descriptor
 * - C# renderer.DrawVortex(wr.Screen3DPxPosition(Pos), frame) → TS drawVortex call
 * - C# Rectangle ScreenBounds → TS bounding box for frustum culling
 * - C# RenderDebugGeometry (红色矩形调试框) → TS debug geometry stub
 *
 * 时空涡旋有 48 帧的动画循环。每个 ChronoVortexRenderable 实例代表
 * 涡旋动画中的一帧，在世界空间中的一个固定位置渲染。
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import type { WVec } from '../../OpenRA.Game/WVec.js'

// ---------------------------------------------------------------------------
// ChronoVortexRenderer access interface
// ---------------------------------------------------------------------------

/** Minimal interface for ChronoVortexRenderer consumed by ChronoVortexRenderable.
 *
 * OpenRA 对照: ChronoVortexRenderer.DrawVortex(float3 pos, int frame)
 */
export interface IChronoVortexRendererAccess {
  /** Queue a vortex drawing at the given 3D position with the given frame.
   *
   * OpenRA 对照: ChronoVortexRenderer.DrawVortex(float3 pos, int frame)
   *
   * @param pos — 3D screen/pixel position
   * @param frame — animation frame number (0-47)
   */
  drawVortex(pos: { x: number; y: number; z: number }, frame: number): void
}

/** Minimal WorldRenderer interface.
 *
 * OpenRA 对照: WorldRenderer.Screen3DPxPosition / Viewport.WorldToViewPx
 */
export interface IChronoVortexWorldRenderer {
  screen3DPxPosition(pos: WPos): { x: number; y: number; z: number }
  viewport?: {
    worldToViewPx(pos: { x: number; y: number; z: number }): { x: number; y: number; z: number }
  }
}

// ---------------------------------------------------------------------------
// ChronoVortexRenderable
// ---------------------------------------------------------------------------

/** A renderable that draws a chrono-vortex animation frame at a world position.
 *
 * OpenRA 对照: ChronoVortexRenderable : IRenderable, IFinalizedRenderable
 *
 * The chrono-vortex renderable shows a swirling vortex effect at
 * chronoshift departure and arrival points. It plays through 48 frames.
 *
 * TODO-19.C.11: Full 3D implementation requires ChronoVortexShaderMaterial
 * with spiral UV animation. Currently renders via the 2D-to-3D adapter
 * in ChronoVortexRenderer.
 */
export class ChronoVortexRenderable {
  /** Empty renderable collection — sentinel value.
   *
   * OpenRA 对照: ChronoVortexRenderable.None (static)
   */
  static readonly None: readonly ChronoVortexRenderable[] = []

  /** The world-space position of the vortex effect.
   *
   * OpenRA 对照: ChronoVortexRenderable.Pos
   */
  readonly pos: WPos

  /** Z-ordering offset (always 0 for vortex).
   *
   * OpenRA 对照: ChronoVortexRenderable.ZOffset
   */
  readonly zOffset: number = 0

  /** Whether this is a decoration.
   *
   * OpenRA 对照: ChronoVortexRenderable.IsDecoration
   */
  readonly isDecoration: boolean = false

  private readonly _renderer: IChronoVortexRendererAccess
  private readonly _frame: number

  /** Create a ChronoVortexRenderable.
   *
   * OpenRA 对照: ChronoVortexRenderable constructor
   *
   * @param renderer — the vortex renderer
   * @param pos — world position for the vortex
   * @param frame — animation frame (0-47)
   * @throws if frame is out of range [0, 47]
   */
  constructor(
    renderer: IChronoVortexRendererAccess,
    pos: WPos,
    frame: number,
  ) {
    if (frame < 0 || frame >= 48) {
      throw new RangeError(
        `frame must be in the range 0-47, got ${frame}`,
      )
    }

    this._renderer = renderer
    this.pos = pos
    this._frame = frame
  }

  // -------------------------------------------------------------------------
  // IRenderable methods (immutable copy-on-write)
  // 对照: WithZOffset, OffsetBy, AsDecoration
  // -------------------------------------------------------------------------

  /** Return this (with new Z offset — no-op for vortex).
   *
   * OpenRA 对照: IRenderable.WithZOffset(int)
   */
  withZOffset(_newOffset: number): ChronoVortexRenderable {
    return this
  }

  /** Return this (offsets not supported for vortex).
   *
   * OpenRA 对照: IRenderable.OffsetBy(in WVec)
   */
  offsetBy(_offset: WVec): ChronoVortexRenderable {
    return this
  }

  /** Return this (already marked as needed).
   *
   * OpenRA 对照: IRenderable.AsDecoration()
   */
  asDecoration(): ChronoVortexRenderable {
    return this
  }

  // -------------------------------------------------------------------------
  // PrepareRender
  // 对照: IFinalizedRenderable.PrepareRender(WorldRenderer wr)
  // -------------------------------------------------------------------------

  /** Pre-finalize this renderable for rendering.
   *
   * OpenRA 对照: IRenderable.PrepareRender(WorldRenderer)
   */
  prepareRender(_wr: IChronoVortexWorldRenderer): ChronoVortexRenderable {
    return this
  }

  // -------------------------------------------------------------------------
  // Render
  // 对照: IFinalizedRenderable.Render(WorldRenderer wr)
  // -------------------------------------------------------------------------

  /** Render the vortex at the world position.
   *
   * OpenRA 对照: ChronoVortexRenderable.Render(WorldRenderer wr)
   *
   * Converts the world position to screen coordinates and delegates
   * to the ChronoVortexRenderer for actual drawing.
   *
   * @param wr — the world renderer
   */
  render(wr: IChronoVortexWorldRenderer): void {
    const screenPos = wr.screen3DPxPosition(this.pos)
    this._renderer.drawVortex(screenPos, this._frame)
  }

  // -------------------------------------------------------------------------
  // RenderDebugGeometry
  // 对照: IFinalizedRenderable.RenderDebugGeometry(WorldRenderer wr)
  // -------------------------------------------------------------------------

  /** Render debug visualization of the vortex bounding area.
   *
   * OpenRA 对照: ChronoVortexRenderable.RenderDebugGeometry(WorldRenderer)
   *
   * In C# 2D: draws a red rectangle around the 64x64 vortex area.
   * In 3D: renders a wireframe bounding box (development only).
   *
   * @param wr — the world renderer
   */
  renderDebugGeometry(wr: IChronoVortexWorldRenderer): void {
    const screenPos = wr.screen3DPxPosition(this.pos)
    // Debug: 64x64 pixel area
    void screenPos
    // TODO-19.C.11: Implement 3D debug rectangle
  }

  // -------------------------------------------------------------------------
  // ScreenBounds
  // 对照: IRenderable.ScreenBounds(WorldRenderer wr)
  // -------------------------------------------------------------------------

  /** Compute the screen-space bounding rectangle.
   *
   * OpenRA 对照: ChronoVortexRenderable.ScreenBounds(WorldRenderer)
   *
   * The vortex is a fixed 64x64 pixel area centered at the world position.
   *
   * @param wr — the world renderer
   * @returns screen-space bounding box
   */
  screenBounds(wr: IChronoVortexWorldRenderer): {
    x: number; y: number; width: number; height: number
  } {
    const screenPos = wr.screen3DPxPosition(this.pos)
    const size = 64
    const tl = wr.viewport?.worldToViewPx?.({
      x: screenPos.x,
      y: screenPos.y,
      z: screenPos.z,
    }) ?? { x: screenPos.x, y: screenPos.y, z: 0 }
    const br = wr.viewport?.worldToViewPx?.({
      x: screenPos.x + size,
      y: screenPos.y + size,
      z: screenPos.z,
    }) ?? { x: screenPos.x + size, y: screenPos.y + size, z: 0 }

    return {
      x: tl.x,
      y: tl.y,
      width: br.x - tl.x,
      height: br.y - tl.y,
    }
  }
}
