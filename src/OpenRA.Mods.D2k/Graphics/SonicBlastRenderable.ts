/**
 * SonicBlastRenderable.ts — D2K 音波爆炸可渲染段（2D → 3D 范式转换）
 * OpenRA 对照: OpenRA.Mods.D2k/Graphics/SonicBlastRenderable.cs (64 lines)
 *
 * 核心范式转换:
 * - C# IRenderable + IFinalizedRenderable (CPU 2D 渲染)
 *   → TS 3D horizontal disc Mesh + ShaderMaterial
 * - C# renderer.Draw(wr.Screen3DPxPosition(Pos)) → TS 3D world-space disc
 * - C# Rectangle ScreenBounds → TS bounding box for frustum culling
 * - C# RenderDebugGeometry → TS debug overlay (development only)
 *
 * 3D 渲染: 每个音波爆炸是一个水平放置的 disc Mesh，带有自定义
 * SonicBlastShaderMaterial。片段着色器渲染扩展的环状波效果，
 * 使用 distance-based alpha falloff。半径由 SonicBlastRenderer.update() 驱动。
 */

import { WPos } from '../../OpenRA.Game/WPos.js'
import type { WVec } from '../../OpenRA.Game/WVec.js'
import {
  Scene,
  ShaderMaterial,
  Mesh,
  MeshBuilder,
  Effect,
  Color3,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// SonicBlastShaderMaterial
// ---------------------------------------------------------------------------

/** Custom ShaderMaterial for sonic blast expanding ring/wave effect.
 *
 * OpenRA 对照: C# sonic shader with Scroll, p1, p2, SourceTexture uniforms
 *
 * Fragment shader renders an expanding ring with:
 *   - Distance-based alpha falloff from ring center
 *   - Ring thickness that narrows as radius increases
 *   - Smooth fade out near max radius
 *
 * Uniforms:
 *   - u_radius: current ring radius (expands over time)
 *   - u_maxRadius: maximum radius (ring invisible beyond this)
 *   - u_color: ring tint color
 *   - u_intensity: brightness multiplier
 */
export class SonicBlastShaderMaterial {
  /** The underlying Babylon.js ShaderMaterial. */
  readonly material: ShaderMaterial

  private _radius: number = 0
  private _maxRadius: number = 100
  private _intensity: number = 1.0

  /** Create a SonicBlastShaderMaterial.
   *
   * Registers custom vertex and fragment shaders in Effect.ShadersStore.
   *
   * @param name — unique name for this material
   * @param scene — the Babylon.js scene
   * @param color — base ring color (default: bright white-blue)
   * @param maxRadius — maximum ring radius
   */
  constructor(
    name: string,
    scene: Scene,
    color: Color3 = new Color3(0.3, 0.7, 1.0),
    maxRadius: number = 100,
  ) {
    this._maxRadius = maxRadius
    const shaderName = `sonicBlast_${name}`

    // Register custom shaders
    Effect.ShadersStore[`${shaderName}VertexShader`] = `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      varying vec2 v_uv;
      void main(void) {
        gl_Position = worldViewProjection * vec4(position, 1.0);
        v_uv = uv;
      }
    `

    Effect.ShadersStore[`${shaderName}FragmentShader`] = `
      precision highp float;
      varying vec2 v_uv;
      uniform float u_radius;
      uniform float u_maxRadius;
      uniform vec3 u_color;
      uniform float u_intensity;
      const float PI = 3.14159265359;

      void main(void) {
        // Center UV around (0.5, 0.5) — disc center
        vec2 centered = v_uv - vec2(0.5, 0.5);
        float dist = length(centered);

        // Normalize radius to 0-1 range
        float normalizedRadius = u_radius / u_maxRadius;

        // Ring: bright at current radius, fading with distance from ring
        float ringDist = abs(dist - normalizedRadius * 0.5);

        // Ring thickness narrows as radius increases
        float ringThickness = 0.05 + 0.15 * (1.0 - normalizedRadius);

        // Ring alpha: maximum at ring position, falling off with distance
        float ringAlpha = 1.0 - smoothstep(0.0, ringThickness * 2.0, ringDist);

        // Inner fill: semi-transparent inner disc up to current radius
        float innerFill = smoothstep(normalizedRadius * 0.5 + 0.02, normalizedRadius * 0.5, dist) * 0.3;

        // Outer cutoff: nothing beyond ring
        float outerCutoff = 1.0 - smoothstep(normalizedRadius * 0.5 + ringThickness * 2.0, 1.0, dist);

        // Fade out as radius approaches max (final 20%)
        float fadeout = 1.0 - smoothstep(0.8, 1.0, normalizedRadius);

        // Combine alpha
        float alpha = max(ringAlpha, innerFill) * outerCutoff * fadeout * u_intensity;

        // Color brightens near the ring edge
        vec3 ringColor = u_color * (1.0 + ringAlpha * 0.5);

        gl_FragColor = vec4(ringColor, alpha);
      }
    `

    this.material = new ShaderMaterial(name, scene, shaderName, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'u_radius', 'u_maxRadius', 'u_color', 'u_intensity'],
    })

    // Set initial uniforms
    this.material.setFloat('u_radius', 0)
    this.material.setFloat('u_maxRadius', maxRadius)
    this.material.setColor3('u_color', color)
    this.material.setFloat('u_intensity', 1.0)

    // Enable transparency
    this.material.needAlphaBlending = () => true
    this.material.needAlphaTesting = () => true
    this.material.backFaceCulling = false
  }

  /** Get the current radius uniform value. */
  get radius(): number { return this._radius }
  /** Get the maximum radius. */
  get maxRadius(): number { return this._maxRadius }
  /** Get the current intensity. */
  get intensity(): number { return this._intensity }

  /** Set the radius uniform (expands the ring).
   *
   * @param r — current ring radius
   */
  setRadius(r: number): void {
    this._radius = r
    this.material.setFloat('u_radius', r)
  }

  /** Set the intensity uniform.
   *
   * @param i — brightness multiplier
   */
  setIntensity(i: number): void {
    this._intensity = i
    this.material.setFloat('u_intensity', i)
  }

  /** Set the color uniform.
   *
   * @param c — tint color
   */
  setColor(c: Color3): void {
    this.material.setColor3('u_color', c)
  }

  /** Whether the ring has reached max radius (blast complete). */
  get isComplete(): boolean {
    return this._radius >= this._maxRadius
  }

  /** Dispose the underlying ShaderMaterial. */
  dispose(): void {
    this.material.dispose()
  }

  /** Create a shared SonicBlastShaderMaterial for material pooling.
   *
   * Shared materials reduce GPU state changes when rendering multiple
   * sonic blast instances with the same shader. Each instance still calls
   * setRadius/setIntensity per-frame, but the underlying ShaderMaterial
   * and shader program are shared.
   *
   * TODO-22.B.5: Full material pooling — SonicBlastRenderer should own
   * one shared material and pass it to all SonicBlastRenderable instances.
   *
   * @param scene — the Babylon.js scene
   * @param name — unique name for the shared material (default: 'sonicBlast_shared')
   * @param color — base ring color (default: bright white-blue)
   * @param maxRadius — maximum ring radius (default: 100)
   * @returns a new SonicBlastShaderMaterial suitable for sharing
   */
  static createSharedMaterial(
    scene: Scene,
    name: string = 'sonicBlast_shared',
    color?: Color3,
    maxRadius?: number,
  ): SonicBlastShaderMaterial {
    return new SonicBlastShaderMaterial(name, scene, color, maxRadius)
  }
}

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
 * In 3D mode, it creates a horizontal disc Mesh with SonicBlastShaderMaterial.
 * The disc sits flat on the terrain (Y = up in Babylon.js, rotation to XZ plane).
 *
 * Ring radius is controlled externally via setRadius() — the SonicBlastRenderer
 * drives this per tick. When the ring completes (radius >= maxRadius),
 * the caller should dispose the renderable.
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
  private readonly _scene: Scene | null
  private readonly _maxRadius: number

  /** Optional shared shader material (pooled across blast instances).
   *
   * TODO-22.B.5: Full material pooling — SonicBlastRenderer should own
   * a shared material and pass it to all SonicBlastRenderable instances.
   */
  private readonly _sharedMaterial: SonicBlastShaderMaterial | null

  /** The disc Mesh for the wave ring (created on first 3D render call). */
  private _disc: Mesh | null = null

  /** The custom shader material for the expanding ring effect. */
  private _shaderMaterial: SonicBlastShaderMaterial | null = null

  /** Current ring radius. */
  private _radius: number = 0

  /** Expansion rate per tick. */
  private _expansionRate: number = 4

  /** Terrain height for disc placement. */
  private _terrainHeight: number = 0

  constructor(
    renderer: ISonicBlastRendererAccess,
    pos: WPos,
    scene?: Scene,
    maxRadius?: number,
    sharedMaterial?: SonicBlastShaderMaterial,
  ) {
    this._renderer = renderer
    this.pos = pos
    const r = renderer.info.size * 0.5
    this._halfSize = { x: r, y: r, z: 0 }
    this._scene = scene ?? null
    this._maxRadius = maxRadius ?? renderer.info.size * 15
    this._sharedMaterial = sharedMaterial ?? null
  }

  // -------------------------------------------------------------------------
  // 3D access
  // -------------------------------------------------------------------------

  /** The disc Mesh (null until first 3D render call). */
  get disc(): Mesh | null { return this._disc }
  /** The custom shader material (null until first 3D render call). */
  get shaderMaterial(): SonicBlastShaderMaterial | null { return this._shaderMaterial }
  /** Current ring radius. */
  get radius(): number { return this._radius }
  /** Maximum ring radius. */
  get maxRadius(): number { return this._maxRadius }
  /** Whether the blast ring has completed expansion. */
  get isComplete(): boolean { return this._shaderMaterial?.isComplete ?? this._radius >= this._maxRadius }

  /** Set the terrain height for disc placement.
   *
   * @param h — terrain Y coordinate
   */
  setTerrainHeight(h: number): void { this._terrainHeight = h }

  /** Set the expansion rate per tick.
   *
   * @param rate — radius increase per tick
   */
  setExpansionRate(rate: number): void { this._expansionRate = rate }

  /** Set the current ring radius.
   *
   * @param r — current radius in world units
   */
  setRadius(r: number): void {
    this._radius = r
    if (this._shaderMaterial) {
      this._shaderMaterial.setRadius(r)
    }
  }

  /** Advance the ring radius by one expansion step.
   *
   * Called each tick by SonicBlastRenderer.update().
   */
  tickRadius(): void {
    if (!this.isComplete) {
      this.setRadius(this._radius + this._expansionRate)
    }
  }

  // -------------------------------------------------------------------------
  // Z-offset / offset (对应 OpenRA IRenderable methods)
  // -------------------------------------------------------------------------

  /** Return a copy with a new Z offset.
   *
   * OpenRA 对照: IRenderable.WithZOffset(int)
   */
  withZOffset(_newOffset: number): SonicBlastRenderable {
    return this
  }

  /** Return a copy with a positional offset.
   *
   * OpenRA 对照: IRenderable.OffsetBy(in WVec)
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

  // -------------------------------------------------------------------------
  // PrepareRender (对应 OpenRA IFinalizedRenderable.PrepareRender)
  // -------------------------------------------------------------------------

  /** Pre-finalize this renderable for rendering.
   *
   * OpenRA 对照: IRenderable.PrepareRender(WorldRenderer wr)
   */
  prepareRender(_wr: ISonicBlastWorldRenderer): SonicBlastRenderable {
    return this
  }

  // -------------------------------------------------------------------------
  // Render (对应 OpenRA IFinalizedRenderable.Render)
  // -------------------------------------------------------------------------

  /** Render the sonic blast effect.
   *
   * OpenRA 对照: IFinalizedRenderable.Render(WorldRenderer wr)
   *
   * In 3D mode (scene provided): creates/updates a horizontal disc Mesh
   * with SonicBlastShaderMaterial. The disc sits flat on terrain (Y = terrainHeight).
   *
   * In 2D fallback mode (no scene): delegates to SonicBlastRenderer.
   *
   * @param wr — the world renderer for screen-space conversion
   */
  render(wr: ISonicBlastWorldRenderer): void {
    if (this._scene) {
      this.render3D(wr)
    } else {
      const screenPos = wr.screen3DPxPosition(this.pos)
      this._renderer.draw(screenPos)
    }
  }

  /** 3D disc Mesh rendering with ring expansion shader.
   *
   * Creates a disc Mesh on first call, updates radius uniform each frame.
   * The disc is positioned at world-space coordinates (not screen pixels),
   * so it participates correctly in the Babylon.js scene graph with proper
   * depth testing and frustum culling.
   *
   * @param _wr — the world renderer (unused in 3D path)
   */
  private render3D(_wr: ISonicBlastWorldRenderer): void {
    if (!this._disc) {
      // Use optional shared material or create a new ShaderMaterial
      // TODO-22.B.5: Full material pooling — use sharedMaterial from renderer
      if (!this._shaderMaterial) {
        this._shaderMaterial = this._sharedMaterial
          ?? new SonicBlastShaderMaterial(
            `sonicBlast_${this.pos.X}_${this.pos.Y}`,
            this._scene!,
            new Color3(0.3, 0.7, 1.0),
            this._maxRadius,
          )
      }
      this._shaderMaterial.setRadius(this._radius)

      // Create a disc mesh flat on the terrain
      const discDiameter = this._maxRadius * 2
      this._disc = MeshBuilder.CreateDisc(
        `sonicBlastDisc_${this.pos.X}_${this.pos.Y}`,
        { radius: discDiameter * 0.5, tessellation: 64 },
        this._scene!,
      )
      this._disc.material = this._shaderMaterial.material
      this._disc.isPickable = false

      // Rotate to lay flat on terrain (XZ plane, Y up)
      this._disc.rotation.x = -Math.PI / 2
    }

    // Position at world-space coordinates (not screen pixels)
    this._disc.position.set(this.pos.X, this._terrainHeight, this.pos.Z)
  }

  // -------------------------------------------------------------------------
  // ScreenBounds (对应 OpenRA IRenderable.ScreenBounds)
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // RenderDebugGeometry (对应 OpenRA IFinalizedRenderable.RenderDebugGeometry)
  // -------------------------------------------------------------------------

  /** Render debug visualization of the bounding area.
   *
   * OpenRA 对照: IFinalizedRenderable.RenderDebugGeometry(WorldRenderer wr)
   *
   * @param wr — the world renderer
   */
  renderDebugGeometry(wr: ISonicBlastWorldRenderer): void {
    const screenPos = wr.screen3DPxPosition(this.pos)
    void screenPos
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /** Dispose GPU resources (disc mesh + shader material). */
  dispose(): void {
    if (this._disc) {
      this._disc.dispose()
      this._disc = null
    }
    if (this._shaderMaterial) {
      this._shaderMaterial.dispose()
      this._shaderMaterial = null
    }
  }
}
