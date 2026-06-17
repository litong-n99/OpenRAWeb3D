/**
 * RenderVoxels.ts — Actor trait that attaches voxel models to an actor
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Render/RenderVoxels.cs
 *
 * 核心范式转换:
 * - C# IRender trait rendering via WorldRenderer → TypeScript trait that
 *   manages ModelAnimation lifecycle and attaches TransformNode hierarchy
 *   to the actor in Babylon.js scene graph (ADR-19.1)
 * - C# RenderVoxels holds camera/lightSource computed once → equivalent
 *   WRot computations cached at construction
 * - C# OnOwnerChanged re-initializes palettes → TypeScript palette tracking
 * - C# AnimationWrapper tracking visibility/offset changes → change-detect
 *   for dirty marking
 * - C# ScreenMap.AddOrUpdate on change → scene graph transform update
 *
 * ADR-19.1:
 * - RenderVoxels.Attach() is called for each WithVoxel* trait to register
 *   a ModelAnimation component.
 * - Per-frame updates are handled by Babylon.js engine observing
 *   TransformNode property changes.
 * - ModelRenderable is generated on-demand for screen bounds computation.
 */

import { WRot } from '../../../OpenRA.Game/WRot'
import { WAngle } from '../../../OpenRA.Game/WAngle'
import type { WPos } from '../../../OpenRA.Game/WPos'
import type { ModelAnimation } from '../../../OpenRA.Game/Graphics/ModelAnimation'
import { ModelRenderable } from '../../Graphics/ModelRenderable'
import type { ModelRenderer } from '../World/ModelRenderer'

// ---------------------------------------------------------------------------
// AnimationWrapper — tracks dirty state per animation
// ---------------------------------------------------------------------------

/** Tracks per-animation visibility and offset changes for dirty marking.
 *
 * OpenRA 对照: AnimationWrapper class (nested in RenderVoxels)
 */
class AnimationWrapper {
  private readonly _model: ModelAnimation
  private _cachedVisible: boolean
  private _cachedOffsetX = 0
  private _cachedOffsetY = 0
  private _cachedOffsetZ = 0

  constructor(model: ModelAnimation) {
    this._model = model
    this._cachedVisible = model.isVisible
  }

  /** Tick the animation and return true if anything changed.
   *
   * OpenRA 对照: AnimationWrapper.Tick()
   */
  tick(): boolean {
    const visible = this._model.isVisible
    const offset = this._model.offsetFunc()

    const updated =
      visible !== this._cachedVisible ||
      offset.X !== this._cachedOffsetX ||
      offset.Y !== this._cachedOffsetY ||
      offset.Z !== this._cachedOffsetZ

    this._cachedVisible = visible
    this._cachedOffsetX = offset.X
    this._cachedOffsetY = offset.Y
    this._cachedOffsetZ = offset.Z

    return updated
  }
}

// ---------------------------------------------------------------------------
// RenderVoxelsInfo
// ---------------------------------------------------------------------------

/** Configuration info for the RenderVoxels trait.
 *
 * OpenRA 对照: RenderVoxelsInfo : TraitInfo, IRenderActorPreviewInfo, Requires<BodyOrientationInfo>
 */
export interface RenderVoxelsInfo {
  /** Defaults to the actor name.
   *
   * OpenRA 对照: RenderVoxelsInfo.Image
   */
  readonly image?: string

  /** Custom palette name.
   *
   * OpenRA 对照: RenderVoxelsInfo.Palette
   */
  readonly palette?: string

  /** Player color palette base name.
   *
   * OpenRA 对照: RenderVoxelsInfo.PlayerPalette
   */
  readonly playerPalette: string

  /** Normals palette name.
   *
   * OpenRA 对照: RenderVoxelsInfo.NormalsPalette
   */
  readonly normalsPalette: string

  /** Shadow palette name.
   *
   * OpenRA 对照: RenderVoxelsInfo.ShadowPalette
   */
  readonly shadowPalette: string

  /** Change the image size.
   *
   * OpenRA 对照: RenderVoxelsInfo.Scale
   */
  readonly scale: number

  /** Light pitch angle.
   *
   * OpenRA 对照: RenderVoxelsInfo.LightPitch
   */
  readonly lightPitch: WAngle

  /** Light yaw angle.
   *
   * OpenRA 对照: RenderVoxelsInfo.LightYaw
   */
  readonly lightYaw: WAngle

  /** Light ambient color [R, G, B].
   *
   * OpenRA 对照: RenderVoxelsInfo.LightAmbientColor
   */
  readonly lightAmbientColor: Float32Array

  /** Light diffuse color [R, G, B].
   *
   * OpenRA 对照: RenderVoxelsInfo.LightDiffuseColor
   */
  readonly lightDiffuseColor: Float32Array
}

// ---------------------------------------------------------------------------
// Default RenderVoxelsInfo
// ---------------------------------------------------------------------------

/** Default values matching C# RenderVoxelsInfo defaults.
 */
export function defaultRenderVoxelsInfo(): RenderVoxelsInfo {
  return {
    playerPalette: 'player',
    normalsPalette: 'normals',
    shadowPalette: 'shadow',
    scale: 12,
    lightPitch: WAngle.fromDegrees(50),
    lightYaw: WAngle.fromDegrees(240),
    lightAmbientColor: new Float32Array([0.6, 0.6, 0.6]),
    lightDiffuseColor: new Float32Array([0.4, 0.4, 0.4]),
  }
}

// ---------------------------------------------------------------------------
// RenderVoxels — actor trait
// ---------------------------------------------------------------------------

/** Actor trait that manages voxel model rendering.
 *
 * OpenRA 对照: RenderVoxels class (IRender, ITick, INotifyOwnerChanged)
 *
 * Under ADR-19.1, this trait:
 * 1. Holds the ModelRenderer reference and rendering config
 * 2. Manages a list of ModelAnimation components (added by WithVoxel* traits)
 * 3. Ticks animation state changes for dirty marking
 * 4. Generates ModelRenderable for world-space rendering
 */
export class RenderVoxels {
  /** Trait configuration info.
   *
   * OpenRA 对照: RenderVoxels.Info
   */
  readonly info: RenderVoxelsInfo

  /** The world's ModelRenderer.
   *
   * OpenRA 对照: RenderVoxels.Renderer
   */
  readonly renderer: ModelRenderer

  /** Model animation components for this actor.
   *
   * OpenRA 对照: RenderVoxels.components (List<ModelAnimation>)
   */
  private readonly _components: ModelAnimation[] = []

  /** Wrapper tracking for dirty marking.
   *
   * OpenRA 对照: RenderVoxels.wrappers
   */
  private readonly _wrappers = new Map<ModelAnimation, AnimationWrapper>()

  /** Camera rotation (computed once from body orientation).
   *
   * OpenRA 对照: RenderVoxels.camera (WRot)
   */
  readonly camera: WRot

  /** Light source rotation (computed once from config).
   *
   * OpenRA 对照: RenderVoxels.lightSource (WRot)
   */
  readonly lightSource: WRot

  /** Palette re-initialization flag.
   *
   * OpenRA 对照: RenderVoxels.initializePalettes
   */
  private _initializePalettes = true

  /** Image key (defaults to actor name).
   */
  readonly image: string

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param info — trait configuration
   * @param renderer — the world's ModelRenderer
   * @param cameraPitch — camera pitch from body orientation
   * @param actorName — actor name (used as default image key)
   */
  constructor(
    info: RenderVoxelsInfo,
    renderer: ModelRenderer,
    cameraPitch: WAngle,
    actorName: string,
  ) {
    this.info = info
    this.renderer = renderer
    this.image = info.image ?? actorName

    // Camera: WRot(WAngle.Zero, cameraPitch - WAngle(256), WAngle(256))
    this.camera = new WRot(
      WAngle.Zero,
      WAngle.subtract(cameraPitch, new WAngle(256)),
      new WAngle(256),
    )

    // Light source: WRot(WAngle.Zero, WAngle(256) - lightPitch, lightYaw)
    this.lightSource = new WRot(
      WAngle.Zero,
      WAngle.subtract(new WAngle(256), info.lightPitch),
      info.lightYaw,
    )
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  /** Tick all animation wrappers and return true if any changed.
   *
   * OpenRA 对照: ITick.Tick(Actor self)
   */
  tick(): boolean {
    let updated = false
    for (const wrapper of this._wrappers.values()) {
      updated = wrapper.tick() || updated
    }
    return updated
  }

  // -----------------------------------------------------------------------
  // Owner changed
  // -----------------------------------------------------------------------

  /** Mark palettes for re-initialization on owner change.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged
   */
  onOwnerChanged(): void {
    this._initializePalettes = true
  }

  // -----------------------------------------------------------------------
  // Renderable generation
  // -----------------------------------------------------------------------

  /** Generate a ModelRenderable for world-space rendering.
   *
   * OpenRA 对照: IRender.Render(Actor self, WorldRenderer wr)
   *
   * @param actorPosition — actor's world center position
   * @returns ModelRenderable for this actor's voxel models
   */
  getRenderable(actorPosition: WPos): ModelRenderable {
    if (this._initializePalettes) {
      this._initializePalettes = false
    }

    // Ground orientation: use flat plane (simplified under ADR-19.1)
    const groundOrientation = WRot.None

    return new ModelRenderable(
      this.renderer,
      this._components,
      actorPosition,
      0,
      this.camera,
      this.info.scale,
      this.lightSource,
      this.info.lightAmbientColor,
      this.info.lightDiffuseColor,
      groundOrientation,
    )
  }

  // -----------------------------------------------------------------------
  // Component management
  // -----------------------------------------------------------------------

  /** Add a model animation component.
   *
   * OpenRA 对照: RenderVoxels.Add(ModelAnimation m)
   */
  add(model: ModelAnimation): void {
    this._components.push(model)
    this._wrappers.set(model, new AnimationWrapper(model))
  }

  /** Remove a model animation component.
   *
   * OpenRA 对照: RenderVoxels.Remove(ModelAnimation m)
   */
  remove(model: ModelAnimation): void {
    const idx = this._components.indexOf(model)
    if (idx >= 0) this._components.splice(idx, 1)
    this._wrappers.delete(model)
  }

  /** Get all model animation components.
   */
  get components(): readonly ModelAnimation[] {
    return this._components
  }
}
