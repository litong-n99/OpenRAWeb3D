/**
 * Model.ts — Voxel/glTF model interfaces (foundation for Ch19 Phase C)
 * OpenRA 对照: OpenRA.Game/Graphics/Model.cs
 *
 * 核心范式转换:
 * - C# IModel interface with CPU-side matrix math → thin wrapper around
 *   pre-converted glTF TransformNode hierarchies (ADR-19.1)
 * - C# Software rasterizer VertexBuffer → BABYLON.Mesh/TransformNode scene graph
 * - ModelRenderData (start/count/sheet) → TransformNode reference with Mesh children
 * - C# IModelCache traitInfo pattern → TypeScript interface (dependency injection)
 */

import type { Rectangle } from '../Primitives/Rectangle'

// ---------------------------------------------------------------------------
// ModelRenderData — logical reference to a section's render geometry
// ---------------------------------------------------------------------------

/** Logical reference to a model section's render geometry.
 *
 * OpenRA 对照: ModelRenderData (readonly record struct)
 *
 * Under ADR-19.1, this maps to a reference to a pre-loaded glTF Mesh node
 * within a TransformNode hierarchy. The start/count fields become indices
 * into the node's child mesh array.
 */
export interface ModelRenderData {
  readonly start: number
  readonly count: number
}

// ---------------------------------------------------------------------------
// IModel — single model instance
// ---------------------------------------------------------------------------

/** Represents a single loaded voxel model (converted from .vxl/.hva to glTF).
 *
 * OpenRA 对照: IModel interface
 *
 * Under ADR-19.1:
 * - frames/sections map to glTF animation frames and node hierarchy levels
 * - transformationMatrix returns per-limb/frame transforms from HVA data
 * - renderData returns references to specific Mesh children
 * - aggregateBounds is pre-computed from glTF bounding box
 */
export interface IModel {
  /** Total number of animation frames.
   *
   * OpenRA 对照: IModel.Frames
   */
  readonly frames: number

  /** Number of limb sections.
   *
   * OpenRA 对照: IModel.Sections
   */
  readonly sections: number

  /** Get the 4x4 column-major transformation matrix for a limb at a given frame.
   *
   * OpenRA 对照: IModel.TransformationMatrix(uint, uint)
   *
   * Returns 16 floats (column-major 4x4 matrix).
   * Under ADR-19.1, these matrices are pre-extracted from .hva data.
   */
  transformationMatrix(section: number, frame: number): Float32Array<ArrayBufferLike>

  /** Overall model size (bounding box after max-pooling all limbs).
   *
   * OpenRA 对照: IModel.Size
   *
   * Returns [x, y, z] world-space extents flipped and scaled.
   */
  readonly size: Float32Array<ArrayBufferLike>

  /** Compute the axis-aligned bounding box for a specific frame.
   *
   * OpenRA 对照: IModel.Bounds(uint frame)
   *
   * Returns [minX, minY, minZ, maxX, maxY, maxZ].
   */
  bounds(frame: number): Float32Array<ArrayBufferLike>

  /** Get render data for a specific section (limb).
   *
   * OpenRA 对照: IModel.RenderData(uint section)
   */
  renderData(section: number): ModelRenderData

  /** Smallest rectangle covering all rotations of all frames.
   *
   * OpenRA 对照: IModel.AggregateBounds
   */
  readonly aggregateBounds: Rectangle
}

// ---------------------------------------------------------------------------
// IModelWidget — UI widget rendering interface
// ---------------------------------------------------------------------------

/** Interface for a UI widget displaying a model.
 *
 * OpenRA 对照: IModelWidget interface
 */
export interface IModelWidget {
  readonly palette: string
  readonly scale: number
  setup(
    isVisible: () => boolean,
    getPalette: () => string,
    getPlayerPalette: () => string,
    getScale: () => number,
    getVoxel: () => IModel,
    getRotation: () => unknown, // WRot
  ): void
}

// ---------------------------------------------------------------------------
// IModelCacheInfo — trait info marker interface
// ---------------------------------------------------------------------------

/** Marker interface for model cache trait info.
 *
 * OpenRA 对照: IModelCacheInfo : ITraitInfoInterface
 */
export interface IModelCacheInfo {
  // marker interface — no members required
}

// ---------------------------------------------------------------------------
// IModelCache — model cache trait
// ---------------------------------------------------------------------------

/** Cache and loader for voxel models.
 *
 * OpenRA 对照: IModelCache interface
 */
export interface IModelCache {
  /** Get a model by name (same for both VXL and HVA).
   *
   * OpenRA 对照: IModelCache.GetModel(string)
   */
  getModel(model: string): IModel

  /** Get a model sequence by model name and sequence name.
   *
   * OpenRA 对照: IModelCache.GetModelSequence(string, string)
   */
  getModelSequence(model: string, sequence: string): IModel

  /** Check if a model has a specific sequence defined.
   *
   * OpenRA 对照: IModelCache.HasModelSequence(string, string)
   */
  hasModelSequence(model: string, sequence: string): boolean
}
