/**
 * ChronoVortexRenderer.ts — 超时空涡旋渲染器（世界后处理特效）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/ChronoVortexRenderer.cs (114 lines)
 *
 * 核心范式转换:
 * - C# IRenderPostProcessPass + INotifyActorDisposing → TypeScript interfaces
 * - C# IShader + IVertexBuffer + Sheet → TypeScript stubs (WebGL deferred)
 * - C# .lut file loading via Stream → TypeScript resource access stub
 * - C# Sheet(512,512) + 48-frame lookup texture → TypeScript logical tracking
 * - C# DrawBatch with 6 vertices per vortex frame → TypeScript draw call stub
 * - C# renderer.WorldFrameBufferSize / WorldDownscaleFactor → TypeScript stubs
 * - C# float3 / float2 → TypeScript { X, Y, Z } objects
 *
 * NOTE: The actual GPU rendering (shader, vertex buffer, sheet texture,
 * draw calls) is deferred to the Babylon.js rendering pipeline. This class
 * handles the logical vortex tracking and provides the data for rendering.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IRenderable } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Vertex data structures (stubs)
// OpenRA 对照: RenderPostProcessPassTexturedVertex
// ---------------------------------------------------------------------------

/** A single vertex for the vortex quad (position + UV).
 *
 * OpenRA 对照: RenderPostProcessPassTexturedVertex(float2 xy, float2 uv)
 */
interface VortexVertex {
  x: number
  y: number
  u: number
  v: number
}

// ---------------------------------------------------------------------------
// VortexData
// ---------------------------------------------------------------------------

/** Data for a single vortex instance to be rendered this frame.
 *
 * OpenRA 对照: (float3 pos, int frame) tuple
 */
export interface VortexData {
  pos: { X: number; Y: number; Z: number }
  frame: number
}

// ---------------------------------------------------------------------------
// ChronoVortexRendererInfo
// OpenRA 对照: ChronoVortexRendererInfo : TraitInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the ChronoVortexRenderer world trait.
 *
 * OpenRA 对照: ChronoVortexRendererInfo
 *
 * @traitLocation SystemActors.World | SystemActors.EditorWorld
 */
export class ChronoVortexRendererInfo implements ITraitInfo {
  readonly instanceName?: string

  create(init: IGameActor): ChronoVortexRenderer {
    return new ChronoVortexRenderer(init)
  }
}

// ---------------------------------------------------------------------------
// ChronoVortexRenderer — world trait implementation
// OpenRA 对照: ChronoVortexRenderer : IRenderPostProcessPass, INotifyActorDisposing
// ---------------------------------------------------------------------------

/**
 * World trait that renders chrono-vortex effect at teleport points.
 *
 * OpenRA 对照: ChronoVortexRenderer
 *
 * Collects vortex draw requests during the frame (via DrawVortex) and
 * renders them as post-process effects after the world pass.
 */
export class ChronoVortexRenderer {
  /** Pre-computed vertex buffer for 48 frames (6 vertices each).
   *
   * OpenRA 对照: ChronoVortexRenderer.vortexBuffer (288 vertices)
   */
  private _vertices: readonly VortexVertex[]

  /** Queued vortex draw requests for this frame.
   *
   * OpenRA 对照: ChronoVortexRenderer.vortices
   */
  private _vortices: VortexData[] = []

  /** Whether the renderer has been disposed.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing
   */
  private _disposed: boolean = false

  constructor(_self: IGameActor) {
    // Build 48-frame vertex buffer (48 frames x 6 vertices = 288)
    // Each frame is a quad: -32..32 with corresponding UV sub-region
    const vertices: VortexVertex[] = []

    for (let f = 0; f < 48; f++) {
      const row = Math.floor(f / 8)
      const col = f % 8

      const tl = { u: col / 8, v: row / 8 }
      const br = { u: (col + 1) / 8, v: (row + 1) / 8 }

      // Two triangles per quad (6 vertices, triangle list)
      vertices.push(
        { x: -32, y: -32, u: tl.u, v: tl.v }, // Triangle 1
        { x: 32, y: -32, u: br.u, v: tl.v },
        { x: 32, y: 32, u: br.u, v: br.v },
        { x: 32, y: 32, u: br.u, v: br.v }, // Triangle 2
        { x: -32, y: 32, u: tl.u, v: br.v },
        { x: -32, y: -32, u: tl.u, v: tl.v },
      )
    }

    this._vertices = vertices

    // NOTE: In OpenRA, this would:
    // 1. Create a shader with "vortex" bindings
    // 2. Create a 512x512 BGRA sheet
    // 3. Load 48 .lut files (hole0000.lut - hole0047.lut)
    // 4. Fill the sheet data from .lut byte streams
    // 5. Create a vertex buffer from the pre-computed vertices
    // 6. Commit the buffered sheet data
    // These GPU operations are deferred to the Babylon.js rendering pipeline.
  }

  // ---------------------------------------------------------------------------
  // DrawVortex
  // OpenRA 对照: ChronoVortexRenderer.DrawVortex(float3 pos, int frame)
  // ---------------------------------------------------------------------------

  /**
   * Queue a vortex to be rendered this frame.
   *
   * OpenRA 对照: ChronoVortexRenderer.DrawVortex(float3, int)
   *
   * @param pos — world position of the vortex
   * @param frame — animation frame index (0-47)
   */
  drawVortex(pos: { X: number; Y: number; Z: number }, frame: number): void {
    if (frame < 0 || frame >= 48) return
    this._vortices.push({ pos, frame })
  }

  // ---------------------------------------------------------------------------
  // Type / Enabled (PostProcessPass properties)
  // OpenRA 对照: IRenderPostProcessPass.Type / Enabled
  // ---------------------------------------------------------------------------

  /** PostProcess pass type (always AfterWorld).
   *
   * OpenRA 对照: IRenderPostProcessPass.Type → AfterWorld
   */
  get passType(): string {
    return 'AfterWorld'
  }

  /** Whether the post-process pass is active this frame.
   *
   * OpenRA 对照: IRenderPostProcessPass.Enabled
   */
  get enabled(): boolean {
    return this._vortices.length > 0
  }

  // ---------------------------------------------------------------------------
  // Draw
  // OpenRA 对照: ChronoVortexRenderer.Draw(WorldRenderer)
  // ---------------------------------------------------------------------------

  /**
   * Execute the draw pass for all queued vortices.
   *
   * OpenRA 对照: ChronoVortexRenderer.Draw(WorldRenderer)
   *
   * For each vortex, draws 6 vertices starting at `6 * frame`.
   */
  draw(_worldRenderer: unknown): readonly IRenderable[] {
    // NOTE: In OpenRA, this method:
    // 1. Sets shader uniforms (Scroll, p1, p2)
    // 2. Sets shader textures (SourceTexture, VortexTexture)
    // 3. Prepares render
    // 4. Draws batches for each vortex
    // 5. Clears the vortices list
    // These GPU operations are deferred to the Babylon.js rendering pipeline.

    const vortices = [...this._vortices]
    this._vortices = []
    void vortices // Reserved for rendering pass
    void _worldRenderer

    return []
  }

  // ---------------------------------------------------------------------------
  // Disposing
  // OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
  // ---------------------------------------------------------------------------

  /**
   * Clean up GPU resources when the world actor is disposed.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor)
   */
  disposing(_self: IGameActor): void {
    this._disposed = true
    this._vortices = []
    // NOTE: In OpenRA: vortexSheet.Dispose(); vortexBuffer.Dispose();
  }

  // ---------------------------------------------------------------------------
  // Public accessors (for testing)
  // ---------------------------------------------------------------------------

  /** Whether the renderer has been disposed.
   *
   * OpenRA 对照: disposed state
   */
  get isDisposed(): boolean {
    return this._disposed
  }

  /** Number of queued vortices for this frame.
   *
   * OpenRA 对照: ChronoVortexRenderer.vortices.Count
   */
  get vortexCount(): number {
    return this._vortices.length
  }

  /** The pre-computed vertex buffer (for testing).
   *
   * OpenRA 对照: ChronoVortexRenderer.vortexBuffer
   */
  get vertices(): readonly VortexVertex[] {
    return this._vertices
  }

  /** Queued vortices (for testing).
   *
   * OpenRA 对照: ChronoVortexRenderer.vortices
   */
  get queuedVortices(): readonly VortexData[] {
    return this._vortices
  }
}
