/**
 * SonicBlastRenderer.ts — D2K 音波爆炸后处理渲染器（2D → 3D 范式转换）
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/World/SonicBlastRenderer.cs (95 lines)
 *
 * 核心范式转换:
 * - C# IRenderPostProcessPass + IShader + IVertexBuffer<Vertex>
 *   → TS 3D renderer managing wave ring Mesh instances
 * - C# 每帧收集 positions + 批量 DrawBatch (2D 四边形后处理)
 *   → TS 3D scene graph: 每个音波爆炸是一个 disc Mesh with ShaderMaterial
 * - C# CreateShader("sonic") + SetVec/SetTexture uniforms
 *   → TS SonicBlastShaderMaterial with expanding ring uniforms
 * - C# Game.Renderer.CreateVertexBuffer / DrawBatch
 *   → TS mesh buffer management via Babylon.js
 *
 * In 3D: each draw() call creates a SonicBlastRenderable with a horizontal
 * disc Mesh. The update() method advances the ring radius for all active
 * blasts. Completed blasts (radius >= maxRadius) are disposed automatically.
 */

import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { SonicBlastRenderable } from '../../Graphics/SonicBlastRenderable.js'
import { Scene } from '@babylonjs/core'

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

  /** Maximum number of concurrent sonic blasts (prevents unbounded growth).
   * Default: 20.
   */
  readonly maxBlasts: number

  constructor(params: { size?: number; zoom?: number; maxBlasts?: number } = {}) {
    this.size = params.size ?? 16
    this.zoom = params.zoom ?? 2.5
    this.maxBlasts = params.maxBlasts ?? 20
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
 * to register their position. The renderer creates wave ring Mesh instances
 * and advances their radii each frame.
 *
 * In 3D mode (scene provided): creates SonicBlastRenderable instances with
 * disc Meshes and SonicBlastShaderMaterial. The update() method advances
 * ring radii and disposes completed blasts.
 */
export class SonicBlastRenderer {
  readonly info: SonicBlastRendererInfo

  /** Active 3D sonic blast renderables.
   *
   * OpenRA 对照: positions List<float3> + per-position quad rendering
   */
  private readonly _activeBlasts: SonicBlastRenderable[] = []

  /** Legacy 2D positions (fallback when no scene). */
  private readonly _positions: Float3[] = []

  /** Optional Babylon.js scene for 3D rendering. */
  private readonly _scene: Scene | null

  /** Whether this renderer has been disposed. */
  private _disposed: boolean = false

  constructor(info: SonicBlastRendererInfo, scene?: Scene) {
    this.info = info
    this._scene = scene ?? null
  }

  // -----------------------------------------------------------------------
  // Draw (对应 OpenRA SonicBlastRenderer.Draw)
  // -----------------------------------------------------------------------

  /** Queue a sonic blast drawing at the given position.
   *
   * OpenRA 对照: SonicBlastRenderer.Draw(float3 pos)
   *
   * In 3D mode: creates a new SonicBlastRenderable with a disc Mesh
   * at the given world position. The ring expands over subsequent ticks.
   *
   * In 2D fallback: collects the position for batch rendering.
   *
   * @param pos — 3D world position of the sonic blast center
   */
  draw(pos: Float3): void {
    if (this._disposed) return

    if (this._scene) {
      // 3D mode: create a new blast renderable
      // Enforce max concurrent blasts limit
      if (this._activeBlasts.length >= this.info.maxBlasts) {
        // Filter completed blasts first (non-disruptive cleanup)
        const completed = this._activeBlasts.filter(b => b.isComplete)
        completed.forEach(b => b.dispose())
        // Remove disposed blasts from active list
        for (const blast of completed) {
          const idx = this._activeBlasts.indexOf(blast)
          if (idx >= 0) this._activeBlasts.splice(idx, 1)
        }
        // If still over limit after removing completed blasts,
        // force-dispose the oldest active blast
        if (this._activeBlasts.length >= this.info.maxBlasts) {
          console.warn(
            `SonicBlastRenderer: maxBlasts (${this.info.maxBlasts}) exceeded. ` +
            'Force-disposing oldest active blast.',
          )
          const oldest = this._activeBlasts.shift()
          oldest?.dispose()
        }
      }

      const blast = new SonicBlastRenderable(
        {
          info: { size: this.info.size },
          draw: (_p: Float3) => { void _p },
        },
        // Use a basic WPos wrapper — the blast tracks position via pos
        { X: pos.x, Y: pos.y, Z: pos.z } as unknown as import('../../../OpenRA.Game/WPos').WPos,
        this._scene,
        this.info.size * 15, // maxRadius
      )
      blast.setTerrainHeight(pos.y) // Disc sits flat on terrain at this Y
      blast.setExpansionRate(this.info.zoom * 2)

      this._activeBlasts.push(blast)
    } else {
      // 2D fallback
      this._positions.push(pos)
    }
  }

  // -----------------------------------------------------------------------
  // Update (对应 OpenRA tick-driven ring expansion)
  // -----------------------------------------------------------------------

  /** Advance all active sonic blast rings by one tick.
   *
   * OpenRA 对照: per-frame uniform updates in Draw(WorldRenderer)
   *
   * Increments the radius of each active blast. Completed blasts
   * (radius >= maxRadius) are disposed and removed.
   *
   * Called each game tick from the world update loop.
   */
  update(): void {
    if (!this._scene) return

    // Advance radii and collect completed blasts
    const completed: SonicBlastRenderable[] = []

    for (const blast of this._activeBlasts) {
      blast.tickRadius()
      if (blast.isComplete) {
        completed.push(blast)
      }
    }

    // Dispose completed blasts
    for (const blast of completed) {
      blast.dispose()
      const idx = this._activeBlasts.indexOf(blast)
      if (idx >= 0) this._activeBlasts.splice(idx, 1)
    }
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
    return (this._activeBlasts.length > 0 || this._positions.length > 0) && !this._disposed
  }

  // -----------------------------------------------------------------------
  // RenderPass / DrawPass (对应 OpenRA IRenderPostProcessPass.Draw)
  // -----------------------------------------------------------------------

  /** Execute the post-process rendering pass.
   *
   * OpenRA 对照: IRenderPostProcessPass.Draw(WorldRenderer wr)
   *
   * In 3D mode: blasts are already rendered as Meshes in the scene,
   * so this is a no-op for the 3D path. The radius update happens in update().
   *
   * In 2D mode: clears the legacy positions array (matching OpenRA behavior).
   *
   * @param _wr — the world renderer
   */
  drawPass(_wr?: unknown): void {
    if (this._scene) {
      // 3D: meshes render automatically in scene, no batch draw needed
      return
    }

    // 2D fallback: clear positions (actual rendering would happen here)
    this._positions.length = 0
  }

  // -----------------------------------------------------------------------
  // Disposing (对应 OpenRA INotifyActorDisposing.Disposing)
  // -----------------------------------------------------------------------

  /** Dispose of this renderer's resources.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor self)
   *
   * Cleans up all active blast meshes and their shader materials.
   */
  disposing(_self: IGameActor): void {
    if (this._disposed) return
    this._disposed = true

    // Dispose all active 3D blasts
    for (const blast of this._activeBlasts) {
      blast.dispose()
    }
    this._activeBlasts.length = 0

    // Clear legacy positions
    this._positions.length = 0
  }

  // -----------------------------------------------------------------------
  // Public accessors (for testing)
  // -----------------------------------------------------------------------

  /** Whether this renderer has been disposed. */
  get isDisposed(): boolean {
    return this._disposed
  }

  /** Number of queued 2D positions (for testing, fallback mode). */
  get positionCount(): number {
    return this._positions.length
  }

  /** Number of active 3D blast renderables (for testing). */
  get activeBlastCount(): number {
    return this._activeBlasts.length
  }

  /** Readonly access to active blasts (for testing). */
  get activeBlasts(): readonly SonicBlastRenderable[] {
    return this._activeBlasts
  }
}
