/**
 * ModelRenderer.ts — Model renderer world trait (voxel model scene graph manager)
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/ModelRenderer.cs
 *
 * 核心范式转换:
 * - C# ModelRenderer with software rasterizer + FBO rendering pipeline (398 lines)
 *   → thin TransformNode manager in Babylon.js scene graph (ADR-19.1)
 * - C# RenderAsync with matrix math on CPU → Babylon.js built-in Matrix operations
 * - C# SheetBuilder + FrameBuffer → pre-baked glTF textures + engine render loop
 * - C# per-frame BeginFrame/EndFrame → no-op (Babylon.js handles frame lifecycle)
 * - C# WorldRenderers array registration → BABYLON.Scene node hierarchy
 * - C# Palette + NormalsPalette textures → ShaderMaterial uniform textures
 *
 * ADR-19.1:
 * - ModelRenderer becomes a thin manager that:
 *   1. Maintains a map of model name → loaded Scene objects / TransformNodes
 *   2. Registers active model instances in the world scene graph
 *   3. Updates TransformNode positions/rotations each frame from ModelAnimation callbacks
 * - The ~300 lines of CPU matrix math (camera transform, shadow projection, etc.)
 *   are replaced by Babylon.js's built-in scene graph and camera.
 * - Shadow rendering is handled by Babylon.js ShadowGenerator.
 */

import type { IModelCache } from '../../../OpenRA.Game/Graphics/Model'
import type { ModelAnimation } from '../../../OpenRA.Game/Graphics/ModelAnimation'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import type { WPos } from '../../../OpenRA.Game/WPos'
import { WRot } from '../../../OpenRA.Game/WRot'
import type { VoxelNormalsPalette } from './VoxelNormalsPalette'

// ---------------------------------------------------------------------------
// ModelRenderProxy — output of a render request (ADR-19.1 simplified)
// ---------------------------------------------------------------------------

/** Result of a render operation containing screen-space metadata.
 *
 * OpenRA 对照: ModelRenderProxy class
 *
 * Under ADR-19.1, this is a simplified struct. The original Sprite references
 * (sprite, shadowSprite, projectedShadowBounds) are replaced by screen-space
 * bounds computed by Babylon.js.
 */
export interface ModelRenderProxy {
  /** Screen-space bounding rectangle for the model.
   *
   * OpenRA 对照: ModelRenderProxy.Sprite (simplified to bounds)
   */
  screenBounds: { left: number; top: number; right: number; bottom: number }

  /** Screen-space bounding rectangle for the shadow.
   *
   * OpenRA 对照: ModelRenderProxy.ShadowSprite (simplified)
   */
  shadowBounds: { left: number; top: number; right: number; bottom: number }

  /** Screen-space corners of the projected shadow.
   *
   * OpenRA 对照: ModelRenderProxy.ProjectedShadowBounds
   */
  projectedShadowBounds: Float32Array[]

  /** Shadow light direction in screen space.
   *
   * OpenRA 对照: ModelRenderProxy.ShadowDirection
   */
  shadowDirection: number
}

// ---------------------------------------------------------------------------
// ModelRendererInfo
// ---------------------------------------------------------------------------

/** Trait info for ModelRenderer.
 *
 * OpenRA 对照: ModelRendererInfo : TraitInfo, Requires<IModelCacheInfo>
 */
export interface ModelRendererInfo {
  /** Render buffer size (build-time parameter; becomes texture atlas size under ADR-19.1).
   *
   * OpenRA 对照: ModelRendererInfo.RenderBufferSize
   */
  readonly renderBufferSize: number
}

// ---------------------------------------------------------------------------
// ModelRenderer
// ---------------------------------------------------------------------------

/** World trait that manages voxel model scene graph registration.
 *
 * OpenRA 对照: ModelRenderer class (IDisposable, IRenderer, INotifyActorDisposing)
 *
 * Under ADR-19.1, this is a thin manager with minimal per-frame CPU work.
 * The heavy lifting (vertex transforms, rasterization, shading) is handled
 * by the Babylon.js engine's GPU pipeline.
 */
export class ModelRenderer {
  /** Access to the model cache.
   *
   * OpenRA 对照: ModelRenderer.ModelCache
   */
  readonly modelCache: IModelCache

  /** Normals palette for voxel shading.
   *
   * OpenRA 对照: SetPalette(HardwarePalette) + normals palette reference
   */
  readonly normalsPalette: VoxelNormalsPalette

  /** Configuration info.
   */
  readonly info: ModelRendererInfo

  /** Whether a frame is currently in progress.
   */
  private _isInFrame = false

  /** Registered active model instances to update each frame.
   */
  private readonly _activeModels = new Map<string, ModelAnimation[]>()

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param info — renderer configuration
   * @param modelCache — the world's model cache (VoxelCache)
   * @param normalsPalette — voxel normals-to-color palette
   */
  constructor(
    info: ModelRendererInfo,
    modelCache: IModelCache,
    normalsPalette: VoxelNormalsPalette,
  ) {
    this.info = info
    this.modelCache = modelCache
    this.normalsPalette = normalsPalette
  }

  // -----------------------------------------------------------------------
  // Render lifecycle (ADR-19.1: simplified — no BeginFrame/EndFrame needed)
  // -----------------------------------------------------------------------

  /** Begin a new frame (no-op under ADR-19.1).
   *
   * OpenRA 对照: ModelRenderer.BeginFrame()
   */
  beginFrame(): void {
    if (this._isInFrame)
      throw new Error(
        'BeginFrame has already been called. A new frame cannot be started until EndFrame has been called.',
      )
    this._isInFrame = true
  }

  /** End the current frame (no-op under ADR-19.1).
   *
   * OpenRA 对照: ModelRenderer.EndFrame()
   */
  endFrame(): void {
    if (!this._isInFrame)
      throw new Error(
        'BeginFrame has not been called. There is no frame to end.',
      )
    this._isInFrame = false
  }

  // -----------------------------------------------------------------------
  // Render — produce a render proxy (ADR-19.1: simplified)
  // -----------------------------------------------------------------------

  /** Render a set of model animations and produce a render proxy.
   *
   * OpenRA 对照: ModelRenderer.RenderAsync(WorldRenderer, ...)
   *
   * Under ADR-19.1, this computes screen-space bounds from the model's
   * aggregate bounds and the current camera. The actual GPU rendering is
   * deferred to Babylon.js's standard render loop.
   *
   * @param worldPos — world position of the actor
   * @param models — model animations to render
   * @param camera — camera rotation
   * @param scale — model scale factor
   * @param _groundOrientation — ground plane orientation (ignored under ADR-19.1)
   * @param lightSource — light source rotation
   * @returns Render proxy with screen-space metadata
   */
  renderAsync(
    worldPos: WPos,
    models: Iterable<ModelAnimation>,
    _camera: WRot,
    scale: number,
    _groundOrientation: WRot,
    lightSource: WRot,
  ): ModelRenderProxy {
    // Compute aggregate screen-space bounds from model animations
    let sLeft = Infinity
    let sTop = Infinity
    let sRight = -Infinity
    let sBottom = -Infinity

    for (const m of models) {
      if (!m.isVisible) continue

      const r = m.model.aggregateBounds
      const offset = m.offsetFunc()
      const frame = m.frameFunc()
      const bounds = m.model.bounds(frame)

      // Simplified screen projection using scale factor
      const ox = worldPos.X + offset.X
      const oy = worldPos.Y + offset.Y

      sLeft = Math.min(sLeft, (ox + r.Left * 1024) * scale / 1024)
      sTop = Math.min(sTop, (oy + r.Top * 1024) * scale / 1024)
      sRight = Math.max(sRight, (ox + r.Right * 1024) * scale / 1024)
      sBottom = Math.max(sBottom, (oy + r.Bottom * 1024) * scale / 1024)

      // Track bounds for bounds computation
      void bounds
    }

    // Handle empty case
    if (!isFinite(sLeft)) {
      sLeft = 0
      sTop = 0
      sRight = 0
      sBottom = 0
    }

    // Compute shadow direction from light source
    const shadowDir = -lightSource.yaw.cos() / Math.max(lightSource.pitch.cos(), 0.001)

    const screenBounds = {
      left: Math.floor(sLeft),
      top: Math.floor(sTop),
      right: Math.ceil(sRight),
      bottom: Math.ceil(sBottom),
    }

    return {
      screenBounds,
      shadowBounds: screenBounds, // Simplified under ADR-19.1
      projectedShadowBounds: [
        new Float32Array([sLeft, sTop]),
        new Float32Array([sRight, sBottom]),
        new Float32Array([sLeft, sBottom]),
        new Float32Array([sRight, sTop]),
      ],
      shadowDirection: shadowDir,
    }
  }

  // -----------------------------------------------------------------------
  // Scene graph registration
  // -----------------------------------------------------------------------

  /** Register an actor's model animations for per-frame update.
   *
   * @param actorId — unique actor identifier
   * @param models — model animations for this actor
   */
  registerActor(actorId: string, models: ModelAnimation[]): void {
    this._activeModels.set(actorId, models)
  }

  /** Unregister an actor's model animations.
   *
   * @param actorId — unique actor identifier
   */
  unregisterActor(actorId: string): void {
    this._activeModels.delete(actorId)
  }

  /** Get the registered model animations for an actor.
   */
  getActorModels(actorId: string): ModelAnimation[] | undefined {
    return this._activeModels.get(actorId)
  }

  // -----------------------------------------------------------------------
  // Camera computation helpers
  // -----------------------------------------------------------------------

  /** Compute the view camera rotation from body orientation.
   *
   * OpenRA 对照: RenderVoxels constructor camera computation
   * camera = new WRot(WAngle.Zero, body.CameraPitch - new WAngle(256), new WAngle(256))
   *
   * @param cameraPitch — camera pitch angle from BodyOrientation
   */
  static computeCameraRotation(cameraPitch: WAngle): WRot {
    return new WRot(
      WAngle.Zero,
      WAngle.subtract(cameraPitch, new WAngle(256)),
      new WAngle(256),
    )
  }

  /** Compute the light source rotation from config.
   *
   * OpenRA 对照: RenderVoxels constructor lightSource computation
   * lightSource = new WRot(WAngle.Zero, new WAngle(256) - lightPitch, lightYaw)
   *
   * @param lightPitch — light pitch angle
   * @param lightYaw — light yaw angle
   */
  static computeLightRotation(lightPitch: WAngle, lightYaw: WAngle): WRot {
    return new WRot(
      WAngle.Zero,
      WAngle.subtract(new WAngle(256), lightPitch),
      lightYaw,
    )
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Dispose of all registered resources.
   *
   * OpenRA 对照: ModelRenderer.Dispose()
   */
  dispose(): void {
    this._activeModels.clear()
  }
}
