/**
 * SonicBlastRenderer.ts — D2K 音波爆炸后处理渲染器（2D → 3D 范式转换）
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/World/SonicBlastRenderer.cs (95 lines)
 *
 * 核心范式转换:
 * - C# IRenderPostProcessPass + IShader + IVertexBuffer<Vertex>
 *   → TS 3D renderer managing sonic blast effect instances
 * - C# 每帧收集 positions + 批量 DrawBatch (2D 四边形后处理)
 *   → TS 3D scene graph: 每个音波爆炸是一个 Mesh/粒子效果实例
 * - C# CreateShader("sonic") + SetVec/SetTexture uniforms
 *   → TS ShaderMaterial with wave expansion uniforms
 * - C# Game.Renderer.CreateVertexBuffer / DrawBatch
 *   → TS mesh buffer management via Babylon.js
 *
 * 注意: 原始实现使用自定义后处理通道，渲染缩放/位移的源纹理四边形。
 * 在 3D 迁移中，音波爆炸效果改为:
 * 1. 独立 Mesh 实例（环或 disc）带有 ShaderMaterial
 * 2. 位置、缩放和波扩展由每帧 update() 驱动
 * 3. 无需后处理 — 直接在 3D 场景中渲染
 *
* Full 3D sonic blast (wave ring Mesh + ShaderMaterial).
 * Current implementation provides the interface and position collection;
 * actual 3D rendering deferred to material system integration.
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// SonicBlastRendererInfo
// ---------------------------------------------------------------------------

/** Configuration for the sonic blast renderer.
 *
 * OpenRA 对照: SonicBlastRendererInfo : TraitInfo
 */
export class SonicBlastRendererInfo {
  /** Diameter of the sonic effect circle.
   *
   * OpenRA 对照: SonicBlastRendererInfo.Size
   */
  readonly size: number

  /** Amount to scale the visuals within the effect circle.
   *
   * OpenRA 对照: SonicBlastRendererInfo.Zoom
   */
  readonly zoom: number

  constructor(params: { size?: number; zoom?: number } = {}) {
    this.size = params.size ?? 16
    this.zoom = params.zoom ?? 2.5
  }

  /** Create the runtime trait instance.
   *
   * OpenRA 对照: SonicBlastRendererInfo.Create(ActorInitializer init)
   */
  create(): SonicBlastRenderer {
    return new SonicBlastRenderer(this)
  }
}

// ---------------------------------------------------------------------------
// 3D position type
// ---------------------------------------------------------------------------

/** A 3-component vector for world-space positions.
 *
 * OpenRA 对照: float3
 */
export interface Float3 {
  x: number
  y: number
  z: number
}

// ---------------------------------------------------------------------------
// SonicBlastRenderer
// ---------------------------------------------------------------------------

/** Manages sonic blast visual effects in the world.
 *
 * OpenRA 对照: SonicBlastRenderer : IRenderPostProcessPass, INotifyActorDisposing
 *
 * Attach to the WorldActor. SonicBlast projectiles call draw() each tick
 * to register their position. The renderer collects all positions and
 * renders them in a single batch at the post-process pass stage.
 *
 * In the 3D migration, the collected positions drive the creation/update
 * of wave ring Mesh instances in the scene graph.
 */
export class SonicBlastRenderer {
  readonly info: SonicBlastRendererInfo

  /** Collected 3D positions of active sonic blast effects.
   *
   * OpenRA 对照: positions List<float3>
   */
  private readonly _positions: Float3[] = []

  /** Whether this renderer has been disposed.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing
   */
  private _disposed: boolean = false

  constructor(info: SonicBlastRendererInfo) {
    this.info = info
  }

  // -----------------------------------------------------------------------
  // Draw (对应 OpenRA SonicBlastRenderer.Draw)
  // -----------------------------------------------------------------------

  /** Queue a sonic blast drawing at the given position.
   *
   * OpenRA 对照: SonicBlastRenderer.Draw(float3 pos)
   *
   * The position is collected and rendered in the next draw phase.
   * In the 3D version, this creates or updates a wave ring Mesh instance
   * at the given world position.
   *
   * @param pos — 3D screen/world position of the sonic blast center
   */
  draw(pos: Float3): void {
    if (this._disposed) return
    this._positions.push(pos)
  }

  // -----------------------------------------------------------------------
  // IRenderPostProcessPass (对应 OpenRA)
  // -----------------------------------------------------------------------

  /** Post process pass type.
   *
   * OpenRA 对照: IRenderPostProcessPass.Type
   */
  get postProcessType(): 'AfterWorld' {
    return 'AfterWorld'
  }

  /** Whether this post-process pass has work to do.
   *
   * OpenRA 对照: IRenderPostProcessPass.Enabled
   */
  get enabled(): boolean {
    return this._positions.length > 0 && !this._disposed
  }

  // -----------------------------------------------------------------------
  // RenderPass / Draw (对应 OpenRA IRenderPostProcessPass.Draw)
  // -----------------------------------------------------------------------

  /** Execute the post-process rendering pass.
   *
   * OpenRA 对照: IRenderPostProcessPass.Draw(WorldRenderer wr)
   *
   * In the 2D version, this iterates all positions and renders
   * a quad with the sonic shader for each one. In the 3D version,
   * this updates the wave ring Meshes and their ShaderMaterials.
   *
   * @param _wr — the world renderer (unused in 3D, positions are in world space)
   */
  drawPass(_wr?: unknown): void {
    if (this._positions.length === 0) return

    // For each position, update or create a wave ring Mesh
    // instance in the 3D scene with the sonic blast ShaderMaterial.
    //
    // In the 2D version:
    //   shader.SetVec("Scroll", scroll.X, scroll.Y);
    //   shader.SetVec("p1", width, height);
    //   shader.SetVec("p2", -1, -1);
    //   shader.SetTexture("SourceTexture", snapshot);
    //   foreach (var pos in positions)
    //     renderer.DrawBatch(buffer, shader, 0, 6, TriangleList);
    //
    // In the 3D version:
    //   for (const pos of this._positions) {
    //     updateWaveRingMesh(pos, this.info);
    //   }

    // Clear positions after rendering (matching OpenRA behavior)
    this._positions.length = 0
  }

  // -----------------------------------------------------------------------
  // Disposing (对应 OpenRA INotifyActorDisposing.Disposing)
  // -----------------------------------------------------------------------

  /** Dispose of this renderer's resources.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor self)
   *
   * Cleans up the vertex buffer (in 2D) or wave ring meshes (in 3D).
   */
  disposing(_self: IGameActor): void {
    if (this._disposed) return
    this._disposed = true
    this._positions.length = 0

    // Dispose wave ring meshes and ShaderMaterials
  }

  /** Whether this renderer has been disposed. */
  get isDisposed(): boolean {
    return this._disposed
  }

  /** Number of queued positions (for testing). */
  get positionCount(): number {
    return this._positions.length
  }
}
