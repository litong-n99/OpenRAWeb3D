/**
 * VoxelCache.ts — Voxel model cache world trait (LRU model cache)
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/VoxelCache.cs
 *
 * 核心范式转换:
 * - C# VoxelCache:IModelCache trait with VoxelLoader → TypeScript IModelCache
 *   wrapper with VoxelLoader (ADR-19.1)
 * - C# Dictionary<string, Dictionary<string, IModel>> for sequences →
 *   TypeScript Map<string, Map<string, Voxel>>
 * - C# MiniYaml model sequence definitions → runtime model sequence map
 * - C# FileNotFoundException handling for missing assets → graceful degradation
 *
 * ADR-19.1:
 * - The build-time SheetSize parameter becomes the glTF texture atlas size.
 * - Runtime cache stores Voxel instances keyed by model name + sequence name.
 * - Model sequences are defined at build time (via YAML/JSON config).
 * - Under ADR-19.1, the bulk loading logic is simplified since individual
 *   voxel faces are no longer rasterized into a shared Sheet.
 */

import type {
  IModelCache,
  IModelCacheInfo,
} from '../../../OpenRA.Game/Graphics/Model'
import type { IModel } from '../../../OpenRA.Game/Graphics/Model'
import { VoxelLoader } from '../../Graphics/VoxelLoader'
import type { Voxel } from '../../Graphics/Voxel'

// ---------------------------------------------------------------------------
// VoxelCacheInfo
// ---------------------------------------------------------------------------

/** Trait info for VoxelCache.
 *
 * OpenRA 对照: VoxelCacheInfo : TraitInfo, IModelCacheInfo
 */
export interface VoxelCacheInfo extends IModelCacheInfo {
  /** Sheet size for the texture atlas (build-time parameter).
   *
   * OpenRA 对照: VoxelCacheInfo.SheetSize
   *
   * Under ADR-19.1, this becomes the glTF texture atlas maximum size.
   */
  readonly sheetSize: number
}

// ---------------------------------------------------------------------------
// VoxelCache
// ---------------------------------------------------------------------------

/** World trait that loads and caches voxel models.
 *
 * OpenRA 对照: VoxelCache class (IModelCache, INotifyActorDisposing, IDisposable)
 *
 * Under ADR-19.1, this is a thin wrapper around VoxelLoader that maintains
 * a per-sequence model cache. It implements IModelCache for consumption by
 * RenderVoxels and WithVoxel* traits.
 */
export class VoxelCache implements IModelCache {
  readonly loader: VoxelLoader

  /** Model sequences: modelName → (sequenceName → IModel).
   *
   * OpenRA 对照: VoxelCache.models (Dictionary<string, Dictionary<string, IModel>>)
   */
  private readonly models = new Map<string, Map<string, IModel>>()

  /** Model sequence definitions loaded from rules.
   *
   * Maps model name → sequence definitions (e.g., "e1" → { "idle": "e1", "run": "e1,e1run" }).
   */
  private readonly modelSequences = new Map<string, Map<string, string>>()

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /**
   * @param info — trait configuration
   * @param modelSequences — sequence definitions from game rules
   *   (Map<modelName, Map<sequenceName, definitionValue>>)
   */
  constructor(
    _info: VoxelCacheInfo,
    modelSequences: Map<string, Map<string, string>> = new Map(),
  ) {
    this.modelSequences = modelSequences
    this.loader = new VoxelLoader(this)
  }

  // -----------------------------------------------------------------------
  // IModelCache.GetModel
  // -----------------------------------------------------------------------

  /** Get a model by name (same base name for VXL and HVA).
   *
   * OpenRA 对照: VoxelCache.GetModel(string model)
   */
  getModel(model: string): IModel {
    return this.loader.loadSameName(model)
  }

  // -----------------------------------------------------------------------
  // IModelCache.GetModelSequence
  // -----------------------------------------------------------------------

  /** Get a model by model name and sequence name.
   *
   * OpenRA 对照: VoxelCache.GetModelSequence(string model, string sequence)
   *
   * @param model — model base name
   * @param sequence — sequence name (e.g., "idle", "run", "turret")
   * @throws if model doesn't have the requested sequence
   */
  getModelSequence(model: string, sequence: string): IModel {
    const modelSeqs = this.models.get(model)
    if (modelSeqs) {
      const seqModel = modelSeqs.get(sequence)
      if (seqModel) return seqModel
      throw new Error(
        `Model "${model}" does not have a sequence "${sequence}".`,
      )
    }

    // Try to load using the sequence definition
    const seqDef = this.modelSequences.get(model)
    if (!seqDef) {
      // No sequences defined — load the base model
      const m = this.loader.loadSameName(model)
      const seqMap = new Map<string, IModel>()
      seqMap.set(sequence, m)
      seqMap.set('idle', m)
      this.models.set(model, seqMap)
      if (sequence === 'idle') return m
      throw new Error(
        `Model "${model}" does not have any sequences defined.`,
      )
    }

    // Look up the sequence definition
    const def = seqDef.get(sequence)
    if (!def) {
      throw new Error(
        `Model "${model}" does not have a sequence "${sequence}".`,
      )
    }

    // Parse the definition: "vxlName,hvaName" or just "name"
    let vxl = model
    let hva = model
    if (def) {
      const parts = def.split(',').map((s) => s.trim())
      if (parts.length >= 1 && parts[0]) {
        vxl = parts[0]
        hva = parts[0]
      }
      if (parts.length >= 2 && parts[1]) {
        hva = parts[1]
      }
    }

    const m = this.loader.load(vxl, hva)
    let seqMap = this.models.get(model)
    if (!seqMap) {
      seqMap = new Map()
      this.models.set(model, seqMap)
    }
    seqMap.set(sequence, m)
    return m
  }

  // -----------------------------------------------------------------------
  // IModelCache.HasModelSequence
  // -----------------------------------------------------------------------

  /** Check if a model has a specific sequence defined.
   *
   * OpenRA 对照: VoxelCache.HasModelSequence(string model, string sequence)
   *
   * @throws if the model has no sequence definitions at all
   */
  hasModelSequence(model: string, sequence: string): boolean {
    const modelSeqs = this.models.get(model)
    if (modelSeqs) return modelSeqs.has(sequence)

    const seqDef = this.modelSequences.get(model)
    if (!seqDef) {
      throw new Error(
        `Model "${model}" does not have any sequences defined.`,
      )
    }

    return seqDef.has(sequence)
  }

  // -----------------------------------------------------------------------
  // Caching
  // -----------------------------------------------------------------------

  /** Pre-cache a model from its definition.
   *
   * OpenRA 对照: VoxelCache.CacheModel(string model, MiniYaml definition)
   *
   * @param model — model name
   * @param sequences — sequence name → definition value map
   */
  cacheModel(model: string, sequences: Map<string, string>): void {
    this.modelSequences.set(model, sequences)
    const seqMap = new Map<string, IModel>()

    for (const [seqName, def] of sequences) {
      let vxl = model
      let hva = model
      if (def) {
        const parts = def.split(',').map((s) => s.trim())
        if (parts.length >= 1 && parts[0]) {
          vxl = parts[0]
          hva = parts[0]
        }
        if (parts.length >= 2 && parts[1]) {
          hva = parts[1]
        }
      }

      try {
        const vox = this.loader.load(vxl, hva)
        seqMap.set(seqName, vox)
      } catch (err) {
        // Eat FileNotFound exceptions for missing models
        console.warn(`Failed to load voxel model "${model}" sequence "${seqName}": ${err}`)
      }
    }

    this.models.set(model, seqMap)
  }

  /** Get a cached model directly (used by VoxelLoader).
   *
   * @internal
   */
  getCachedModel(model: string, sequence: string): Voxel | undefined {
    const seqMap = this.models.get(model)
    if (!seqMap) return undefined
    const m = seqMap.get(sequence)
    if (m) return m as unknown as Voxel
    return undefined
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Dispose all cached models and the loader.
   *
   * OpenRA 对照: VoxelCache.Dispose()
   */
  dispose(): void {
    this.models.clear()
    this.modelSequences.clear()
    this.loader.dispose()
  }
}
