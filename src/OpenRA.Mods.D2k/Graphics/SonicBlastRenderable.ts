/**
 * SonicBlastRenderable.ts — D2K 音波爆炸可渲染段（2D → 3D 范式转换）
 * OpenRA 对照: OpenRA.Mods.D2k/Graphics/SonicBlastRenderable.cs (64 lines)
 *
 * 核心范式转换:
 * - C# IRenderable + IFinalizedRenderable (CPU 2D 渲染)
 *   → TS renderable descriptor（3D 场景图中作为 LinesMesh 或粒子效果）
 * - C# renderer.Draw(wr.Screen3DPxPosition(Pos)) → TS 3D 世界空间位置
 * - C# Rectangle ScreenBounds → TS bounding box for frustum culling
 * - C# RenderDebugGeometry → TS debug overlay (development only)
 *
 * 注意: 原始 2D 渲染使用 `SonicBlastRenderer.Draw(float3 pos)` 每帧提交
 * 四边形到后处理通道。在 3D 迁移中，音波爆炸可视化为一个扩展的"环"效果 —
 * 使用 CylinderMesh + ShaderMaterial 或 LinesMesh 在源和目标之间渲染。
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import type { WVec } from '../../OpenRA.Game/WVec.js'

// ---------------------------------------------------------------------------
// Forward interface: SonicBlastRenderer (minimal)
// ---------------------------------------------------------------------------

/** Minimal interface for SonicBlastRenderer consumed by SonicBlastRenderable.
 *
 * OpenRA 对照: SonicBlastRenderer.Draw(float3 pos)
 */
export interface ISonicBlastRendererAccess {
  readonly info: { readonly size: number }
  /** Queue a sonic blast drawing at the given 3D position.
   *
   * OpenRA 对照: SonicBlastRenderer.Draw(float3 pos)
   */
  draw(pos: { x: number; y: number; z: number }): void
}

// ---------------------------------------------------------------------------
// Minimal WorldRenderer interface for screen space projection
// ---------------------------------------------------------------------------

/** Minimal WorldRenderer for screen-space coordinate projection.
 *
 * OpenRA 对照: WorldRenderer.Screen3DPxPosition(WPos)
 */
export interface ISonicBlastWorldRenderer {
  screen3DPxPosition(pos: WPos): { x: number; y: number; z: number }
  viewport?: {
    worldToViewPx(pos: { x: number; y: number; z: number }): { x: number; y: number; z: number }
  }
}

// ---------------------------------------------------------------------------
// SonicBlastRenderable
// ---------------------------------------------------------------------------

/** A renderable that draws a sonic blast effect at a world position.
 *
 * OpenRA 对照: SonicBlastRenderable : IRenderable, IFinalizedRenderable
 *
 * The sonic blast renders as an expanding ring/wave effect centered at Pos.
 * In 3D, this maps to a semi-transparent disc or ring mesh with a custom
 * shader effect showing the sonic wave propagation.
 *
 * TODO-19.B.16: Full 3D implementation requires SonicBlastShaderMaterial
 * with wave propagation uniforms. Currently renders via the 2D → 3D
 * adapter in SonicBlastRenderer.
 */
export class SonicBlastRenderable {
  /** Empty renderable collection — used as a sentinel.
   *
   * OpenRA 对照: SonicBlastRenderable.None (static)
   */
  static readonly None: readonly SonicBlastRenderable[] = []

  /** The world-space position of the sonic blast effect.
   *
   * OpenRA 对照: SonicBlastRenderable.Pos
   */
  readonly pos: WPos

  /** Z-ordering offset (always 0 for sonic blasts).
   *
   * OpenRA 对照: SonicBlastRenderable.ZOffset
   */
  readonly zOffset: number = 0

  /** Whether this is a decoration (not subject to highlight flash).
   *
   * OpenRA 对照: SonicBlastRenderable.IsDecoration
   */
  readonly isDecoration: boolean = false

  private readonly _renderer: ISonicBlastRendererAccess
  private readonly _halfSize: { x: number; y: number; z: number }

  constructor(renderer: ISonicBlastRendererAccess, pos: WPos) {
    this._renderer = renderer
    this.pos = pos
    const r = renderer.info.size * 0.5
    this._halfSize = { x: r, y: r, z: 0 }
  }

  // -----------------------------------------------------------------------
  // Z-offset / offset (对应 OpenRA IRenderable methods)
  // -----------------------------------------------------------------------

  /** Return a copy with a new Z offset.
   *
   * OpenRA 对照: IRenderable.WithZOffset(int)
   *
   * @param _newOffset — ignored (always 0 for sonic blast)
   */
  withZOffset(_newOffset: number): SonicBlastRenderable {
    return this
  }

  /** Return a copy with a positional offset.
   *
   * OpenRA 对照: IRenderable.OffsetBy(in WVec)
   *
   * @param _offset — ignored (rendered at fixed world position)
   */
  offsetBy(_offset: WVec): SonicBlastRenderable {
    return this
  }

  /** Return a copy marked as decoration.
   *
   * OpenRA 对照: IRenderable.AsDecoration()
   */
  asDecoration(): SonicBlastRenderable {
    return this
  }

  // -----------------------------------------------------------------------
  // PrepareRender (对应 OpenRA IFinalizedRenderable.PrepareRender)
  // -----------------------------------------------------------------------

  /** Pre-finalize this renderable for rendering.
   *
   * OpenRA 对照: IRenderable.PrepareRender(WorldRenderer wr)
   */
  prepareRender(_wr: ISonicBlastWorldRenderer): SonicBlastRenderable {
    return this
  }

  // -----------------------------------------------------------------------
  // Render (对应 OpenRA IFinalizedRenderable.Render)
  // -----------------------------------------------------------------------

  /** Render the sonic blast effect.
   *
   * OpenRA 对照: IFinalizedRenderable.Render(WorldRenderer wr)
   *
   * In the 2D version, this calls renderer.Draw(screenPosition).
   * In 3D, this would update the wave ring mesh position and uniforms.
   *
   * @param wr — the world renderer for screen-space conversion
   */
  render(wr: ISonicBlastWorldRenderer): void {
    const screenPos = wr.screen3DPxPosition(this.pos)
    this._renderer.draw(screenPos)
  }

  // -----------------------------------------------------------------------
  // ScreenBounds (对应 OpenRA IRenderable.ScreenBounds)
  // -----------------------------------------------------------------------

  /** Compute the screen-space bounding rectangle for frustum culling.
   *
   * OpenRA 对照: IRenderable.ScreenBounds(WorldRenderer wr)
   *
   * @param wr — the world renderer
   * @returns screen-space bounding box
   */
  screenBounds(wr: ISonicBlastWorldRenderer): {
    x: number; y: number; width: number; height: number
  } {
    const screenPos = wr.screen3DPxPosition(this.pos)
    const hs = this._halfSize
    const tl = wr.viewport?.worldToViewPx?.({
      x: screenPos.x - hs.x,
      y: screenPos.y - hs.y,
      z: screenPos.z,
    }) ?? { x: screenPos.x - hs.x, y: screenPos.y - hs.y, z: 0 }
    const br = wr.viewport?.worldToViewPx?.({
      x: screenPos.x + hs.x,
      y: screenPos.y + hs.y,
      z: screenPos.z,
    }) ?? { x: screenPos.x + hs.x, y: screenPos.y + hs.y, z: 0 }

    return {
      x: tl.x,
      y: tl.y,
      width: br.x - tl.x,
      height: br.y - tl.y,
    }
  }

  // -----------------------------------------------------------------------
  // RenderDebugGeometry (对应 OpenRA IFinalizedRenderable.RenderDebugGeometry)
  // -----------------------------------------------------------------------

  /** Render debug visualization of the bounding area.
   *
   * OpenRA 对照: IFinalizedRenderable.RenderDebugGeometry(WorldRenderer wr)
   *
   * @param wr — the world renderer
   */
  renderDebugGeometry(wr: ISonicBlastWorldRenderer): void {
    const screenPos = wr.screen3DPxPosition(this.pos)
    const hs = this._halfSize
    // In 2D: Game.Renderer.RgbaColorRenderer.DrawRect(tl, br, 1, Color.Red)
    // In 3D: render a wireframe bounding box (development only)
    void screenPos
    void hs
    // TODO-19.B.16: Implement 3D debug geometry rendering
  }
}
