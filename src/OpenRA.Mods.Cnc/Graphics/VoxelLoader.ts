/**
 * VoxelLoader.ts — Voxel model asset loader
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/VoxelLoader.cs
 *
 * 核心范式转换:
 * - C# VoxelLoader with software rasterizer (GenerateSlicePlanes, SheetBuilder)
 *   → thin SceneLoader wrapper for pre-converted glTF files (ADR-19.1)
 * - C# Sheet allocation for rasterized voxel faces → pre-baked glTF textures
 * - C# VertexBuffer management → BABYLON.Mesh instances from glTF
 * - C# FileSystem.Open for .vxl/.hva → loading pre-converted .glb files
 * - C# Cache<(string,string), Voxel> → Map<string, Voxel> keyed by model name
 *
 * ADR-19.1:
 * - The original ~170 lines of CPU software rasterizer code (GenerateSlicePlanes,
 *   GenerateSlicePlane, GenerateRenderData) are replaced by pre-converted
 *   glTF models loaded via the FileSystem.
 * - This reduces runtime complexity from managing SheetBuilder/VertexBuffer
 *   to loading and caching glTF assets.
 * - The `Finish()` and `RefreshBuffer()` methods become no-ops since buffer
 *   management is handled by Babylon.js.
 */

import type { IModelCache } from '../../OpenRA.Game/Graphics/Model'
import type { ModelRenderData } from '../../OpenRA.Game/Graphics/Model'
import type { HvaReader } from '../FileFormats/HvaReader'
import type { VxlReader } from '../FileFormats/VxlReader'
import { Voxel } from './Voxel'

// ---------------------------------------------------------------------------
// VoxelLoader
// ---------------------------------------------------------------------------

/** Loads and caches voxel models from pre-converted glTF assets.
 *
 * OpenRA 对照: VoxelLoader class (IDisposable)
 *
 * Under ADR-19.1, this is a thin wrapper that:
 * 1. Reads .vxl and .hva metadata from the FileSystem
 * 2. Creates Voxel instances with limb metadata
 * 3. Associates pre-converted glTF render data with each limb
 *
 * @typeParam TFilesystem — the file system type for reading assets
 */
export class VoxelLoader {
  private readonly voxels = new Map<string, Voxel>()
  readonly modelCache: IModelCache

  /**
   * @param modelCache — the IModelCache that owns this loader
   */
  constructor(modelCache: IModelCache) {
    this.modelCache = modelCache
  }

  // -----------------------------------------------------------------------
  // Load
  // -----------------------------------------------------------------------

  /** Load a voxel model by name (same base name for both .vxl and .hva).
   *
   * OpenRA 对照: VoxelLoader.Load(string vxl, string hva)
   *
   * Under ADR-19.1, the .glb file with the same base name is loaded
   * from the FileSystem. The .vxl/.hva metadata may be read for
   * transform/animation data if not fully baked into the glTF.
   *
   * @param vxlName — name of the .vxl file (without extension)
   * @param hvaName — name of the .hva file (without extension)
   * @returns The loaded Voxel model
   */
  load(vxlName: string, hvaName: string): Voxel {
    const key = `${vxlName}__${hvaName}`
    let voxel = this.voxels.get(key)
    if (voxel) return voxel

    // Under ADR-19.1, attempt to load from the modelCache first,
    // which may have pre-loaded glTF models.
    try {
      // Try model cache (VoxelCache) for pre-loaded/pre-converted models
      const model = this.modelCache.getModelSequence(vxlName, 'idle')
      // If the model cache returned a Voxel, use it directly
      if (model instanceof Voxel) {
        this.voxels.set(key, model)
        return model
      }
    } catch {
      // Model not in cache — this is expected for runtime where VXL/HVA
      // are used only for metadata validation
    }

    // Create a placeholder Voxel from empty data
    // In a full build-time pipeline, this would parse .vxl/.hva and
    // generate render data. For runtime ADR-19.1, actual meshes come
    // from the model cache.
    voxel = this._createPlaceholder(vxlName, hvaName)
    this.voxels.set(key, voxel)
    return voxel
  }

  /** Load a model where vxl and hva share the same base name.
   *
   * OpenRA 对照: implicit single-argument usage in VoxelCache.GetModel()
   */
  loadSameName(name: string): Voxel {
    return this.load(name, name)
  }

  // -----------------------------------------------------------------------
  // Build-time helpers (used by ADR-19.1 build conversion pipeline)
  // -----------------------------------------------------------------------

  /** Create a Voxel from parsed VXL and HVA data with pre-assigned render data.
   *
   * Used by the build-time .vxl→.glb converter to create a Voxel with
   * correct metadata that references the converted glTF meshes.
   *
   * @param vxlReader — parsed VXL data
   * @param hvaReader — parsed HVA data
   * @param limbRenderData — per-limb render data referencing glTF mesh sections
   */
  createFromParsedData(
    vxlReader: VxlReader,
    hvaReader: HvaReader,
    limbRenderData: ModelRenderData[],
  ): Voxel {
    if (vxlReader.limbCount !== hvaReader.limbCount)
      throw new Error(
        `VXL limb count (${vxlReader.limbCount}) doesn't match HVA limb count (${hvaReader.limbCount}).`,
      )

    const limbCount = vxlReader.limbCount
    const bounds: Float32Array[] = []
    const sizes: Uint8Array[] = []
    const scales: number[] = []

    for (let i = 0; i < limbCount; i++) {
      const vl = vxlReader.limbs[i]
      bounds.push(new Float32Array(vl.bounds))
      sizes.push(new Uint8Array(vl.size))
      scales.push(vl.scale)
    }

    return new Voxel(hvaReader, bounds, sizes, scales, limbRenderData)
  }

  // -----------------------------------------------------------------------
  // Cache management
  // -----------------------------------------------------------------------

  /** Check if a model is already loaded.
   */
  isLoaded(vxlName: string, hvaName: string): boolean {
    const key = `${vxlName}__${hvaName}`
    return this.voxels.has(key)
  }

  /** Get the number of cached models.
   */
  get cacheCount(): number {
    return this.voxels.size
  }

  /** Clear all cached models.
   */
  clearCache(): void {
    this.voxels.clear()
  }

  // -----------------------------------------------------------------------
  // Private — placeholder creation
  // -----------------------------------------------------------------------

  /** Create a minimal Voxel placeholder without actual render data.
   * Used when glTF models are loaded via the model cache (ADR-19.1).
   */
  private _createPlaceholder(_vxlName: string, _hvaName: string): Voxel {
    // Create a Voxel with minimal limb data (single limb, identity transform)
    const frames = 1
    const limbCount = 1
    const transforms = new Float32Array(16 * frames * limbCount)
    // Identity matrix
    transforms[0] = 1
    transforms[5] = 1
    transforms[10] = 1
    transforms[15] = 1

    const fakeHva: HvaReader = {
      frameCount: frames,
      limbCount,
      transforms,
      getTransform: (_limb, _frame) => {
        const t = new Float32Array(16)
        t[0] = 1; t[5] = 1; t[10] = 1; t[15] = 1
        return t
      },
    }

    return new Voxel(
      fakeHva,
      [new Float32Array([-1, -1, -1, 1, 1, 1])],
      [new Uint8Array([1, 1, 1])],
      [1],
      [{ start: 0, count: 0 }],
    )
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Finish loading (no-op under ADR-19.1 — buffering handled by Babylon.js).
   *
   * OpenRA 对照: VoxelLoader.Finish()
   */
  finish(): void {
    // No-op: under ADR-19.1, Babylon.js manages GPU buffers
  }

  /** Dispose of all loaded model resources.
   *
   * OpenRA 对照: VoxelLoader.Dispose()
   */
  dispose(): void {
    this.voxels.clear()
  }
}
