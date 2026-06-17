/**
 * TSTiberiumRenderer.ts — 泰伯利亚之日泰伯利亚资源渲染器
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/TSTiberiumRenderer.cs (96 lines)
 *
 * 核心范式转换:
 * - C# ResourceRenderer (extends) → TypeScript ResourceRenderer delegation
 * - C# ISpriteSequence variant lookup → TypeScript sequence name mapping
 * - C# FrozenDictionary ramp sequences → TypeScript ReadonlyMap
 * - C# World.LocalRandom → TypeScript random variant selection
 * - C# ramp type specific variants → TypeScript switch-based variant dispatch
 *
 * NOTE: Visual rendering of resource sprites is deferred to the ResourceRenderer
 * from Chapter 10. This trait provides TS-specific variant selection for
 * sloped terrain (ramp types 1-4).
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// TSTiberiumRendererInfo
// OpenRA 对照: TSTiberiumRendererInfo : ResourceRendererInfo
// ---------------------------------------------------------------------------

/** Configuration for the TS Tiberium renderer.
 *
 * OpenRA 对照: TSTiberiumRendererInfo
 *
 * @traitLocation World | EditorWorld
 */
export class TSTiberiumRendererInfo implements ITraitInfo {
  /** Sequences for ramp type 1. Map of resource type → sequence names.
   *
   * OpenRA 对照: TSTiberiumRendererInfo.Ramp1Sequences
   */
  readonly ramp1Sequences: ReadonlyMap<string, ReadonlySet<string>>

  /** Sequences for ramp type 2.
   *
   * OpenRA 对照: TSTiberiumRendererInfo.Ramp2Sequences
   */
  readonly ramp2Sequences: ReadonlyMap<string, ReadonlySet<string>>

  /** Sequences for ramp type 3.
   *
   * OpenRA 对照: TSTiberiumRendererInfo.Ramp3Sequences
   */
  readonly ramp3Sequences: ReadonlyMap<string, ReadonlySet<string>>

  /** Sequences for ramp type 4.
   *
   * OpenRA 对照: TSTiberiumRendererInfo.Ramp4Sequences
   */
  readonly ramp4Sequences: ReadonlyMap<string, ReadonlySet<string>>

  /** Resource type configurations (delegated from base).
   *
   * OpenRA 对照: ResourceRendererInfo.ResourceTypes
   */
  readonly resourceTypes: ReadonlyMap<string, unknown>

  constructor(params?: {
    ramp1Sequences?: ReadonlyMap<string, ReadonlySet<string>>
    ramp2Sequences?: ReadonlyMap<string, ReadonlySet<string>>
    ramp3Sequences?: ReadonlyMap<string, ReadonlySet<string>>
    ramp4Sequences?: ReadonlyMap<string, ReadonlySet<string>>
    resourceTypes?: ReadonlyMap<string, unknown>
  }) {
    this.ramp1Sequences = params?.ramp1Sequences ?? new Map()
    this.ramp2Sequences = params?.ramp2Sequences ?? new Map()
    this.ramp3Sequences = params?.ramp3Sequences ?? new Map()
    this.ramp4Sequences = params?.ramp4Sequences ?? new Map()
    this.resourceTypes = params?.resourceTypes ?? new Map()
  }

  create(init: IGameActor): TSTiberiumRenderer {
    return new TSTiberiumRenderer(init, this)
  }
}

// ---------------------------------------------------------------------------
// TSTiberiumRenderer
// OpenRA 对照: TSTiberiumRenderer : ResourceRenderer
// ---------------------------------------------------------------------------

/** Renders Tiberian Sun Tiberium resources with ramp-specific variants.
 *
 * OpenRA 对照: TSTiberiumRenderer
 *
 * Extends the base ResourceRenderer to support TS-specific visual variants
 * for resources placed on sloped terrain. Each ramp type (1-4) can have
 * different sprite sequences per resource type.
 */
export class TSTiberiumRenderer {
  readonly info: TSTiberiumRendererInfo

  /** Default variants (flat terrain). Map of resource type → available sequences.
   *
   * OpenRA 对照: TSTiberiumRenderer.Variants
   */
  readonly variants: ReadonlyMap<string, ReadonlySet<string>>

  /** Ramp 1 variants by resource type.
   *
   * OpenRA 对照: TSTiberiumRenderer.ramp1Variants
   */
  private readonly _ramp1Variants: ReadonlyMap<string, ReadonlySet<string>>

  /** Ramp 2 variants by resource type.
   *
   * OpenRA 对照: TSTiberiumRenderer.ramp2Variants
   */
  private readonly _ramp2Variants: ReadonlyMap<string, ReadonlySet<string>>

  /** Ramp 3 variants by resource type.
   *
   * OpenRA 对照: TSTiberiumRenderer.ramp3Variants
   */
  private readonly _ramp3Variants: ReadonlyMap<string, ReadonlySet<string>>

  /** Ramp 4 variants by resource type.
   *
   * OpenRA 对照: TSTiberiumRenderer.ramp4Variants
   */
  private readonly _ramp4Variants: ReadonlyMap<string, ReadonlySet<string>>

  /** World reference for map queries.
   */
  private readonly _world: unknown

  constructor(self: IGameActor, info: TSTiberiumRendererInfo) {
    this.info = info
    this._world = (self as any).world
    this.variants = this._loadVariants(null) // Default variants from base
    this._ramp1Variants = info.ramp1Sequences
    this._ramp2Variants = info.ramp2Sequences
    this._ramp3Variants = info.ramp3Sequences
    this._ramp4Variants = info.ramp4Sequences
  }

  /** Load variant sequences for a ramp type.
   *
   * OpenRA 对照: LoadVariants(FrozenDictionary, Dictionary)
   */
  private _loadVariants(
    _rampSequences: ReadonlyMap<string, ReadonlySet<string>> | null,
  ): ReadonlyMap<string, ReadonlySet<string>> {
    // NOTE: In C#, this resolves sequence names from the world map's sequence provider:
    //   sequences.GetSequence(resourceInfo.Image, v)
    // Sequence resolution requires the full sprite sequence infrastructure (Phase C).
    return new Map()
  }

  /** Choose a variant sequence for the given resource type and cell.
   *
   * OpenRA 对照: ChooseVariant(string, CPos)
   *
   * Selects from ramp-specific variants based on the cell's ramp type,
   * falling back to default variants for flat terrain.
   *
   * @param resourceType — the resource type to render
   * @param cell — the cell being rendered
   * @returns a randomly selected variant sequence name
   */
  chooseVariant(resourceType: string, cell: CPos): string | null {
    const world = this._world as any
    const ramp = world?.map?.ramp?.(cell) ?? 0

    let variants: ReadonlyMap<string, ReadonlySet<string>>
    switch (ramp) {
      case 1:
        variants = this._ramp1Variants
        break
      case 2:
        variants = this._ramp2Variants
        break
      case 3:
        variants = this._ramp3Variants
        break
      case 4:
        variants = this._ramp4Variants
        break
      default:
        variants = this.variants
        break
    }

    const variantSet = variants.get(resourceType)
    if (!variantSet || variantSet.size === 0) return null

    // Random selection
    const arr = [...variantSet]
    // C#: variants[resourceType].Values.Random(world.LocalRandom)
    const rng = world?.localRandom as { nextInt(max: number): number } | undefined
    const idx = rng ? rng.nextInt(arr.length) : Math.floor(Math.random() * arr.length)
    return arr[idx] ?? null
  }

  /** Resource type names that this renderer handles.
   *
   * OpenRA 对照: IResourceRenderer.ResourceTypes
   */
  get resourceTypes(): ReadonlySet<string> {
    // Combine all resource types from all variant maps
    const all = new Set<string>()
    for (const map of [
      this.variants,
      this._ramp1Variants,
      this._ramp2Variants,
      this._ramp3Variants,
      this._ramp4Variants,
    ]) {
      for (const key of map.keys()) {
        all.add(key)
      }
    }
    return all
  }

  /** Get the rendered resource type at a given cell.
   *
   * OpenRA 对照: IResourceRenderer.GetRenderedResourceType(CPos)
   */
  getRenderedResourceType(_cell: CPos): string | null {
    return null // Delegate to base renderer
  }
}
