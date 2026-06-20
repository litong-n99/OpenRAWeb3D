/**
 * ChronoVortexRenderable.ts — 时空涡旋可渲染体（传送出发/到达点的旋转涡旋效果）
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/ChronoVortexRenderable.cs (67 lines)
 *
 * 核心范式转换:
 * - C# IRenderable + IFinalizedRenderable (CPU 2D 渲染) → TS 3D Billboard + ShaderMaterial
 * - C# renderer.DrawVortex(wr.Screen3DPxPosition(Pos), frame) → TS Billboard at world pos
 * - C# Rectangle ScreenBounds → TS bounding box for frustum culling
 * - C# RenderDebugGeometry → TS debug overlay (development only)
 * - C# 48-frame animation + .lut files → TS spiral UV animation in fragment shader
 *
 * Phase C 变更 (Chapter 24 Phase C):
 * - 添加 renderingGroupId 支持: billboard.renderingGroupId = RenderGroup.Actor (1)
 * - 添加 tickUpdate(tickCount) 方法: 基于游戏 tick 的动画计时（替代硬编码 1/60 帧增量）
 * - renderingGroupId 通过构造函数参数可配置（默认 1）
 *
 * 时空涡旋使用自定义 ShaderMaterial 在 Billboard 上渲染旋转涡旋效果。
 * 片段着色器执行 atan2 + 半径扭曲，生成随时间旋转的螺旋图案。
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
import { RenderGroup } from '../../OpenRA.Game/Graphics/WorldRenderer.js'

// ---------------------------------------------------------------------------
// ChronoVortexShaderMaterial
// ---------------------------------------------------------------------------

/** Custom ShaderMaterial for chrono-vortex spiral UV animation.
 *
 * OpenRA 对照: C# vortex shader with scroll/lookup uniforms
 *
 * Fragment shader computes:
 *   angle = atan2(v_uv.y - 0.5, v_uv.x - 0.5) + time * speed
 *   radius distortion outward over vortex lifetime
 *
 * Uniforms:
 *   - time: elapsed time in seconds for animation
 *   - progress: 0-1 lifetime progress for fade effects
 *   - color: base tint color (cyan/purple)
 *   - intensity: brightness multiplier
 */
export class ChronoVortexShaderMaterial {
  /** The underlying Babylon.js ShaderMaterial. */
  readonly material: ShaderMaterial

  private _time: number = 0
  private _progress: number = 0
  private _intensity: number = 1.0

  /** Create a ChronoVortexShaderMaterial.
   *
   * Registers custom vertex and fragment shaders in Effect.ShadersStore.
   *
   * @param name — unique name for this material
   * @param scene — the Babylon.js scene
   * @param color — base vortex color (default: cyan)
   */
  constructor(name: string, scene: Scene, color: Color3 = new Color3(0.2, 0.8, 1.0)) {
    const shaderName = `chronoVortex_${name}`

    // Register custom shaders in Effect.ShadersStore
    // TODO-Ch24.C: Shader should be registered once and reused across vortex instances
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
      uniform float u_time;
      uniform float u_progress;
      uniform vec3 u_color;
      uniform float u_intensity;
      const float PI = 3.14159265359;

      void main(void) {
        // Center UV around (0.5, 0.5)
        vec2 centered = v_uv - vec2(0.5, 0.5);
        float dist = length(centered);

        // Angle with time-based rotation
        float angle = atan(centered.y, centered.x) + u_time * 3.0;

        // Spiral pattern: radius distortion outward
        float spiral = sin(dist * 20.0 - angle * 3.0 + u_time * 5.0) * 0.5 + 0.5;

        // Radial falloff (inner bright, outer dim)
        float radialMask = 1.0 - smoothstep(0.0, 0.5, dist);

        // Lifetime fade: fully opaque at progress=0, fading out at progress=1
        float fade = 1.0 - u_progress;

        // Combine: spiral pattern modulated by radial mask and fade
        float alpha = spiral * radialMask * fade * u_intensity;

        // Outer glow ring
        float ring = smoothstep(0.35, 0.45, dist) * (1.0 - smoothstep(0.45, 0.5, dist));
        alpha = max(alpha, ring * fade * 0.6);

        // Color with subtle variation based on distance
        vec3 vortexColor = u_color * (1.0 + dist * 0.5);
        gl_FragColor = vec4(vortexColor, alpha);
      }
    `

    this.material = new ShaderMaterial(name, scene, shaderName, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'u_time', 'u_progress', 'u_color', 'u_intensity'],
    })

    // Set initial uniform values
    this.material.setColor3('u_color', color)
    this.material.setFloat('u_time', 0)
    this.material.setFloat('u_progress', 0)
    this.material.setFloat('u_intensity', 1.0)

    // Enable transparency
    this.material.needAlphaBlending = () => true
    this.material.needAlphaTesting = () => true
    this.material.backFaceCulling = false
  }

  /** Get the current time uniform value. */
  get time(): number { return this._time }
  /** Get the current progress uniform value (0-1). */
  get progress(): number { return this._progress }
  /** Get the current intensity. */
  get intensity(): number { return this._intensity }

  /** Set the time uniform (elapsed seconds for animation).
   *
   * @param t — elapsed time in seconds
   */
  setTime(t: number): void {
    this._time = t
    this.material.setFloat('u_time', t)
  }

  /** Set the progress uniform (0-1 lifetime fraction).
   *
   * @param p — progress from 0 (start) to 1 (complete)
   */
  setProgress(p: number): void {
    this._progress = Math.max(0, Math.min(1, p))
    this.material.setFloat('u_progress', this._progress)
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

  /** Dispose the underlying ShaderMaterial. */
  dispose(): void {
    this.material.dispose()
  }

  /** Create a shared ChronoVortexShaderMaterial for material pooling.
   *
   * Shared materials reduce GPU state changes when rendering multiple
   * vortex instances with the same shader. Each instance still calls
   * setTime/setProgress/setIntensity per-frame, but the underlying
   * ShaderMaterial and shader program are shared.
   *
   * TODO-22.B.4: Full material pooling — ChronoVortexRenderer should own
   * one shared material and pass it to all ChronoVortexRenderable instances.
   *
   * @param scene — the Babylon.js scene
   * @param name — unique name for the shared material (default: 'chronoVortex_shared')
   * @param color — base vortex color (default: cyan)
   * @returns a new ChronoVortexShaderMaterial suitable for sharing
   */
  static createSharedMaterial(
    scene: Scene,
    name: string = 'chronoVortex_shared',
    color?: Color3,
  ): ChronoVortexShaderMaterial {
    return new ChronoVortexShaderMaterial(name, scene, color)
  }
}

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

/** A renderable that draws a chrono-vortex animation at a world position.
 *
 * OpenRA 对照: ChronoVortexRenderable : IRenderable, IFinalizedRenderable
 *
 * The chrono-vortex renderable shows a swirling vortex effect at
 * chronoshift departure and arrival points. In 3D, it renders as a
 * Billboard with ChronoVortexShaderMaterial — the shader handles
 * spiral animation via time uniform, replacing the 48-frame .lut lookup.
 *
 * The Billboard always faces the camera and maintains constant world-space size.
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
  private readonly _scene: Scene | null

  /** Optional shared shader material (pooled across vortex instances).
   *
   * TODO-22.B.4: Full material pooling — ChronoVortexRenderer should own
   * a shared material and pass it to all ChronoVortexRenderable instances.
   */
  private readonly _sharedMaterial: ChronoVortexShaderMaterial | null

  /** The Billboard mesh (created on first render call). */
  private _billboard: Mesh | null = null

  /** The shader material for the vortex spiral effect (shared or per-instance). */
  private _shaderMaterial: ChronoVortexShaderMaterial | null = null

  /** Elapsed time tracker for shader animation. */
  private _elapsedTime: number = 0

  /** Whether tick-based timing is active (Phase C).
   *
   * When true, render3D() skips the frame-based 1/60 time increment,
   * avoiding time drift-and-snap conflict between tickUpdate() and render3D().
   * Reset to false on dispose() so reused instances behave correctly.
   */
  private _usingTickUpdate: boolean = false

  /** Rendering group ID for the billboard mesh.
   *
   * Phase C: defaults to RenderGroup.Actor (1) for the effects layer.
   * Configurable via constructor for shared material pooling scenarios.
   */
  private readonly _renderingGroupId: number

  /** Create a ChronoVortexRenderable.
   *
   * OpenRA 对照: ChronoVortexRenderable constructor
   *
   * @param renderer — the vortex renderer (for legacy 2D delegate)
   * @param pos — world position for the vortex
   * @param frame — animation frame (0-47)
   * @param scene — optional Babylon.js scene for 3D rendering
   * @param sharedMaterial — optional shared ChronoVortexShaderMaterial (pooled)
   * @param renderingGroupId — rendering group ID for the billboard (default: RenderGroup.Actor = 1)
   * @throws if frame is out of range [0, 47]
   */
  constructor(
    renderer: IChronoVortexRendererAccess,
    pos: WPos,
    frame: number,
    scene?: Scene,
    sharedMaterial?: ChronoVortexShaderMaterial,
    renderingGroupId: number = RenderGroup.Actor,
  ) {
    if (frame < 0 || frame >= 48) {
      throw new RangeError(
        `frame must be in the range 0-47, got ${frame}`,
      )
    }

    this._renderer = renderer
    this.pos = pos
    this._frame = frame
    this._scene = scene ?? null
    this._sharedMaterial = sharedMaterial ?? null
    this._renderingGroupId = renderingGroupId
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
   * In 3D mode (scene provided): creates/updates a Billboard with
   * ChronoVortexShaderMaterial for spiral UV animation.
   *
   * In 2D fallback mode (no scene): delegates to ChronoVortexRenderer.
   *
   * @param wr — the world renderer
   */
  render(wr: IChronoVortexWorldRenderer): void {
    if (this._scene) {
      this.render3D(wr)
    } else {
      // Legacy 2D fallback
      const screenPos = wr.screen3DPxPosition(this.pos)
      this._renderer.drawVortex(screenPos, this._frame)
    }
  }

  /** 3D Billboard rendering with spiral shader.
   *
   * Creates a Billboard on first call, updates time/progress uniforms each frame.
   * The Billboard is positioned at the world-space coordinates of this.pos
   * (not screen pixels), so it participates correctly in the Babylon.js
   * scene graph with proper depth testing and frustum culling.
   *
   * @param _wr — the world renderer (unused in 3D path)
   */
  private render3D(_wr: IChronoVortexWorldRenderer): void {
    if (!this._billboard) {
      // Use optional shared material or create a new ShaderMaterial
      // TODO-22.B.4: Full material pooling — use sharedMaterial from renderer
      if (!this._shaderMaterial) {
        this._shaderMaterial = this._sharedMaterial
          ?? new ChronoVortexShaderMaterial(
            `chronoVortex_${this.pos.X}_${this.pos.Y}`,
            this._scene!,
          )
      }

      // Create a plane mesh for the billboard
      // NOTE: Billboard size (64 world units) is appropriate for the default
      // orthographic RTS camera. For adjustable camera distances, make this
      // configurable via ChronoVortexRendererInfo.
      const billboardSize = 64
      this._billboard = MeshBuilder.CreatePlane(
        `chronoVortexBillboard_${this.pos.X}_${this.pos.Y}`,
        { width: billboardSize, height: billboardSize },
        this._scene!,
      )
      this._billboard.material = this._shaderMaterial.material
      this._billboard.billboardMode = Mesh.BILLBOARDMODE_ALL
      this._billboard.isPickable = false
      this._billboard.renderingGroupId = this._renderingGroupId
    }

    // Position at world-space coordinates (not screen pixels)
    this._billboard.position.set(this.pos.X, this.pos.Y, this.pos.Z)

    // Update shader uniforms
    // NOTE: When tickUpdate() is active, skip frame-based time increment
    // to avoid time drift-and-snap conflict (MAJOR fix, Round 2)
    if (!this._usingTickUpdate) {
      this._elapsedTime += 1 / 60 // assume ~60fps per render call
    }
    this._shaderMaterial!.setTime(this._elapsedTime)
    this._shaderMaterial!.setProgress(this._frame / 47) // frame-based progress
  }

  // -------------------------------------------------------------------------
  // tickUpdate (Phase C — 游戏 tick 驱动的动画计时)
  // -------------------------------------------------------------------------

  /** Update vortex animation using game tick count.
   *
   * Phase C 变更: 替代硬编码 1/60 帧增量的游戏 tick 驱动计时。
   * 每游戏 tick = 40ms (25 ticks/s)，用绝对时间替代逐帧累加。
   *
   * If tickUpdate() is not called, render3D() falls back to frame-based
   * time increment (1/60 per render call) for backward compatibility.
   *
   * @param tickCount — cumulative game tick count
   */
  tickUpdate(tickCount: number): void {
    this._usingTickUpdate = true
    this._elapsedTime = tickCount * 0.04 // 40ms per game tick at 25 ticks/s
    if (this._shaderMaterial) {
      this._shaderMaterial.setTime(this._elapsedTime)
      this._shaderMaterial.setProgress(this._frame / 47)
    }
  }

  // -------------------------------------------------------------------------
  // RenderDebugGeometry
  // 对照: IFinalizedRenderable.RenderDebugGeometry(WorldRenderer wr)
  // -------------------------------------------------------------------------

  /** Render debug visualization of the vortex bounding area.
   *
   * OpenRA 对照: ChronoVortexRenderable.RenderDebugGeometry(WorldRenderer)
   *
   * @param wr — the world renderer
   */
  renderDebugGeometry(wr: IChronoVortexWorldRenderer): void {
    // TODO-24.C.2: Implement debug geometry rendering for vortex bounds visualization
    const screenPos = wr.screen3DPxPosition(this.pos)
    void screenPos
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

  // -------------------------------------------------------------------------
  // 3D Billboard access (for testing)
  // -------------------------------------------------------------------------

  /** The Billboard mesh (null until first render call in 3D mode). */
  get billboard(): Mesh | null {
    return this._billboard
  }

  /** The custom shader material (null until first render call in 3D mode). */
  get shaderMaterial(): ChronoVortexShaderMaterial | null {
    return this._shaderMaterial
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  /** Dispose GPU resources (billboard mesh + shader material). */
  dispose(): void {
    if (this._billboard) {
      this._billboard.dispose()
      this._billboard = null
    }
    if (this._shaderMaterial) {
      this._shaderMaterial.dispose()
      this._shaderMaterial = null
    }
    this._usingTickUpdate = false
  }
}
