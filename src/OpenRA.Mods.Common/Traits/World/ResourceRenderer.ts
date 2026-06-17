/**
 * ResourceRenderer.ts — Renders resource sprites on the terrain via sprite layers
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/ResourceRenderer.cs (387 lines)
 *
 * 核心范式转换:
 * - C# TerrainSpriteLayer → Interface ISpriteLayer (decoupled from GPU layer)
 * - C# IWorldLoaded + IRenderOverlay + ITickRender + INotifyActorDisposing →
 *   TypeScript interfaces
 * - C# FrozenDictionary<string, ResourceTypeInfo> → Map<string, ResourceTypeInfoConfig>
 * - C# HashSet<CPos> dirty / Queue<CPos> cleanDirty → Set<number> keyed by
 *   cell hash + Array<CPos> queue
 * - C# ImmutableArray<string> Sequences → readonly string[]
 * - C# SequenceReference + Image → sequence name + image name lookup
 * - C# FluentProvider.GetMessage(name) → direct name access (FLUENT deferred)
 * - C# int2.Lerp for frame selection → lerp utility
 * - C# IRadarTerrainLayer → deferred (TODO-12.X)
 * - C# IMapPreviewSignatureInfo → deferred (TODO-12.X)
 * - C# RenderUIPreview / RenderPreview → deferred (TODO-10.X)
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import type {
  ITraitInfo,
  IWorldLoaded,
  IRenderOverlay,
  ITickRender,
  INotifyActorDisposing,
  IResourceLayer,
  IResourceRenderer,
  IGameActor,
  WorldStub,
  WorldRendererStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import type { ISpriteSequence, ISequenceSet, IPaletteRef } from '../../../OpenRA.Game/Graphics/Animation'

// ---------------------------------------------------------------------------
// IResourceLayerWithEvents — extended IResourceLayer with event subscription
// ---------------------------------------------------------------------------

/** Extended resource layer interface with CellChanged subscription methods.
 *
 * OpenRA 对照: IResourceLayer + CellChanged event
 *
 * The base IResourceLayer interface provides `onCellChanged` as a fire method
 * but does not include subscription management. This extended interface adds
 * the add/remove listener methods that ResourceRenderer needs to subscribe
 * to cell changes.
 */
export interface IResourceLayerWithEvents extends IResourceLayer {
  /** Register a callback for cell change events.
   *
   * OpenRA 对照: CellChanged += handler
   */
  addCellChangedListener(callback: (cell: CPos, resourceType: string | null) => void): void

  /** Unregister a previously registered callback.
   *
   * OpenRA 对照: CellChanged -= handler
   */
  removeCellChangedListener(callback: (cell: CPos, resourceType: string | null) => void): void
}

// ---------------------------------------------------------------------------
// IResourceRendererMap — minimal Map needed by ResourceRenderer
// ---------------------------------------------------------------------------

/** Subset of Map needed by ResourceRenderer.
 *
 * OpenRA 对照: Map class (subset used by ResourceRenderer)
 */
export interface IResourceRendererMap {
  readonly mapSize: { readonly width: number; readonly height: number }
  contains(cell: CPos): boolean
}

// ---------------------------------------------------------------------------
// IResourceRendererWorld — extended WorldStub with services
// ---------------------------------------------------------------------------

/** World interface extended with sequence and map services.
 *
 * OpenRA 对照: World class (subset used by ResourceRenderer)
 */
export interface IResourceRendererWorld extends WorldStub {
  readonly map: IResourceRendererMap
  readonly sequences: ISequenceSet
  /** The resource layer trait (must be registered on the world actor). */
  readonly resourceLayer: IResourceLayerWithEvents
}

// ---------------------------------------------------------------------------
// ISpriteLayer — minimal TerrainSpriteLayer interface
// ---------------------------------------------------------------------------

/** Minimal sprite layer interface for resource rendering.
 *
 * OpenRA 对照: TerrainSpriteLayer (subset)
 *
 * The full TerrainSpriteLayer provides vertex buffer management,
 * palette tracking, and GPU upload. This interface captures only
 * the rendering operations needed by ResourceRenderer.
 */
export interface ISpriteLayer {
  /** The blend mode used by all sprites in this layer. */
  readonly blendMode: string

  /** Clear the sprite at a cell (restore to empty).
   *
   * OpenRA 对照: TerrainSpriteLayer.Clear(CPos)
   */
  clear(cell: CPos): void

  /** Update the sprite at a cell using a sequence frame.
   *
   * OpenRA 对照: TerrainSpriteLayer.Update(CPos, ISpriteSequence,
   *   PaletteReference, int)
   */
  update(
    cell: CPos,
    sequence: ISpriteSequence | null,
    palette: IPaletteRef | null,
    frame: number,
  ): void

  /** Draw visible rows to the viewport.
   *
   * OpenRA 对照: TerrainSpriteLayer.Draw(Viewport)
   */
  draw(viewport: IResourceRendererViewport): void

  /** Dispose the layer, releasing GPU resources. */
  dispose(): void
}

// ---------------------------------------------------------------------------
// ISpriteLayerFactory — creates ISpriteLayer instances
// ---------------------------------------------------------------------------

/** Factory for creating sprite layers.
 *
 * OpenRA 对照: new TerrainSpriteLayer(World, WorldRenderer, emptySprite, ...)
 *
 * The actual TerrainSpriteLayer constructor requires vertex buffers,
 * index buffers, and other GPU resources managed by the platform layer.
 * This factory abstracts that complexity so the ResourceRenderer trait
 * does not depend on the platform layer directly.
 */
export interface ISpriteLayerFactory {
  /** Create a new sprite layer for resource rendering.
   *
   * OpenRA 对照: new TerrainSpriteLayer(w, wr, emptySprite, blendMode, restrictToBounds)
   *
   * @param emptySprite — the sprite used for empty cells (derived from
   *   the first sequence's first frame Sheet + empty Rectangle)
   * @param blendMode — blend mode for all sprites in this layer
   * @param restrictToBounds — whether to restrict rendering to viewport bounds
   * @returns a new sprite layer instance
   */
  createSpriteLayer(
    emptySprite: IResourceRendererSprite,
    blendMode: string,
    restrictToBounds: boolean,
  ): ISpriteLayer
}

// ---------------------------------------------------------------------------
// IResourceRendererViewport — minimal viewport for drawing
// ---------------------------------------------------------------------------

/** Minimal viewport interface for resource rendering.
 *
 * OpenRA 对照: Viewport (visibleCells subset)
 */
export interface IResourceRendererViewport {
  readonly visibleCells: {
    readonly firstRow: number
    readonly lastRow: number
    readonly firstCol: number
    readonly lastCol: number
  }
}

// ---------------------------------------------------------------------------
// IResourceRendererSprite — minimal sprite reference
// ---------------------------------------------------------------------------

/** Minimal sprite reference for empty sprite creation.
 *
 * OpenRA 对照: Sprite (Sheet, Rectangle, TextureChannel subset)
 *
 * Used by the sprite layer factory to create the empty sprite placeholder.
 */
export interface IResourceRendererSprite {
  readonly sheet: unknown
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly blendMode: string
  readonly channel: number
}

// ---------------------------------------------------------------------------
// IResourceRendererWorldRenderer — extended WorldRenderer
// ---------------------------------------------------------------------------

/** Extended WorldRenderer interface for ResourceRenderer.
 *
 * OpenRA 对照: WorldRenderer (subset)
 */
export interface IResourceRendererWorldRenderer {
  /** Get a palette reference by name.
   *
   * OpenRA 对照: WorldRenderer.Palette(string)
   */
  palette(name: string): IPaletteRef | null
}

// ---------------------------------------------------------------------------
// ResourceRendererTypeConfig (ResourceRendererInfo inner)
// ---------------------------------------------------------------------------

/** Configuration for a resource type's rendering within ResourceRendererInfo.
 *
 * OpenRA 对照: ResourceRendererInfo.ResourceTypeInfo
 */
export interface ResourceRendererTypeConfig {
  /** Sequence image that holds the different variants.
   *
   * OpenRA 对照: ResourceTypeInfo.Image (default "resources")
   */
  readonly image: string

  /** Randomly chosen image sequences.
   *
   * OpenRA 对照: ResourceTypeInfo.Sequences (ImmutableArray<string>)
   */
  readonly sequences: readonly string[]

  /** Palette used for rendering the resource sprites.
   *
   * OpenRA 对照: ResourceTypeInfo.Palette (default TileSet.TerrainPaletteInternalName)
   */
  readonly palette: string

  /** Resource name used by tooltips.
   *
   * OpenRA 对照: ResourceTypeInfo.Name
   */
  readonly name: string
}

// ---------------------------------------------------------------------------
// ResourceRendererInfo
// OpenRA 对照: ResourceRendererInfo : TraitInfo, Requires<IResourceLayerInfo>,
//              IMapPreviewSignatureInfo
// ---------------------------------------------------------------------------

/** Configuration for the ResourceRenderer world trait.
 *
 * OpenRA 对照: ResourceRendererInfo
 *
 * Attached to the world actor. Defines the visual representation of
 * each resource type (which sequences to use, which palette, tooltip name).
 */
export class ResourceRendererInfo implements ITraitInfo {
  /** Optional instance name for disambiguation.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string

  /** All resource type rendering configs, keyed by resource type name.
   *
   * OpenRA 对照: ResourceRendererInfo.ResourceTypes (FrozenDictionary)
   */
  readonly resourceTypes: Map<string, ResourceRendererTypeConfig>

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  /** Create a new ResourceRendererInfo.
   *
   * OpenRA 对照: ResourceRendererInfo (default parameterless constructor + FieldLoader)
   *
   * @param params — configuration parameters
   */
  constructor(params: {
    instanceName?: string
    resourceTypes?: Map<string, ResourceRendererTypeConfig>
  } = {}) {
    this.instanceName = params.instanceName
    this.resourceTypes = params.resourceTypes ?? new Map()
  }

  // -----------------------------------------------------------------------
  // Loading from JSON
  // -----------------------------------------------------------------------

  /** Load configuration from JSON (MiniYAML → JSON pipeline output).
   *
   * OpenRA 对照: LoadResourceTypes(MiniYaml)
   *
   * @param json — parsed JSON from the rules YAML
   */
  loadFromJSON(json: Record<string, unknown>): void {
    const resourceTypesRaw = json.ResourceTypes as Record<string, Record<string, unknown>> | undefined
    if (resourceTypesRaw) {
      for (const [key, rJson] of Object.entries(resourceTypesRaw)) {
        const sequencesRaw = rJson.Sequences
        let sequences: string[]
        if (Array.isArray(sequencesRaw)) {
          sequences = sequencesRaw as string[]
        } else if (typeof sequencesRaw === 'string') {
          sequences = [sequencesRaw]
        } else {
          sequences = []
        }

        this.resourceTypes.set(key, {
          image: (rJson.Image as string) ?? 'resources',
          sequences,
          palette: (rJson.Palette as string) ?? 'terrain',
          name: (rJson.Name as string) ?? key,
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RendererCellContents — per-cell render state
// OpenRA 对照: ResourceRenderer.RendererCellContents (readonly struct)
// ---------------------------------------------------------------------------

/** Per-cell rendering state for a resource.
 *
 * OpenRA 对照: ResourceRenderer.RendererCellContents
 */
export interface RendererCellContents {
  /** Resource type name, or empty if none. */
  readonly type: string
  /** Current density (affects frame selection). */
  readonly density: number
  /** The rendering config for this resource type. */
  readonly info: ResourceRendererTypeConfig | null
  /** The chosen sequence variant for this cell. */
  readonly sequence: ISpriteSequence | null
  /** The palette for rendering. */
  readonly palette: IPaletteRef | null
}

/** Sentinel value for an empty cell (no resource rendered). */
export const RendererCellContentsEmpty: RendererCellContents = Object.freeze({
  type: '',
  density: 0,
  info: null,
  sequence: null,
  palette: null,
})

// ---------------------------------------------------------------------------
// Helper: lerp (integer)
// ---------------------------------------------------------------------------

/** Linear interpolation for selecting sprite frames.
 *
 * OpenRA 对照: int2.Lerp(int, int, int, int)
 *
 * @returns the interpolated frame index
 */
function lerpFrame(a: number, b: number, mu: number, muMax: number): number {
  if (muMax <= 0) return a
  const t = mu / muMax
  return Math.round(a + (b - a) * t)
}

// ---------------------------------------------------------------------------
// Helper: simple seeded random for variant selection
// ---------------------------------------------------------------------------

/** Simple seeded random for deterministic variant selection.
 *
 * OpenRA 对照: World.LocalRandom or hash-based selection
 *
 * Uses CPos hash to deterministically choose a sequence variant for each cell.
 */
function cellVariantIndex(cell: CPos, numVariants: number): number {
  if (numVariants <= 1) return 0
  // Simple hash-based selection (OpenRA uses World.LocalRandom)
  const hash = (cell.X * 31 + cell.Y * 17) & 0x7fffffff
  return Math.abs(hash) % numVariants
}


// ---------------------------------------------------------------------------
// ResourceRenderer
// OpenRA 对照: ResourceRenderer : IResourceRenderer, IWorldLoaded,
//              IRenderOverlay, ITickRender, INotifyActorDisposing,
//              IRadarTerrainLayer
// ---------------------------------------------------------------------------

/** Visualizes the state of the ResourceLayer on the terrain.
 *
 * OpenRA 对照: ResourceRenderer
 *
 * Manages sprite layers for each resource type. Listens to CellChanged
 * events from ResourceLayer and updates the rendered sprites incrementally.
 * On each render tick, processes dirty cells in a batch.
 *
 * NOTE: IRadarTerrainLayer deferred — TODO-12.X (radar/minimap integration)
 * NOTE: IMapPreviewSignatureInfo deferred — TODO-12.X (map preview)
 * NOTE: RenderUIPreview / RenderPreview deferred — TODO-10.X
 */
export class ResourceRenderer implements IResourceRenderer, IWorldLoaded, IRenderOverlay, ITickRender, INotifyActorDisposing {
  /** Configuration for this renderer.
   *
   * OpenRA 对照: ResourceRenderer.Info
   */
  readonly info: ResourceRendererInfo

  /** The resource layer this renderer visualizes.
   *
   * OpenRA 对照: ResourceRenderer.ResourceLayer
   */
  protected readonly resourceLayer: IResourceLayerWithEvents

  /** Per-cell render state.
   *
   * OpenRA 对照: ResourceRenderer.RenderContents (CellLayer<RendererCellContents>)
   */
  protected readonly renderContents: RRCellLayer

  /** Sequence variants, keyed by resource type → variant name → sequence.
   *
   * OpenRA 对照: ResourceRenderer.Variants
   */
  protected readonly variants: Map<string, Map<string, ISpriteSequence>>

  /** The game world.
   *
   * OpenRA 对照: ResourceRenderer.World
   */
  protected readonly world: IResourceRendererWorld

  /** Dirty cell set (cells that need sprite updates).
   *
   * OpenRA 对照: ResourceRenderer.dirty (HashSet<CPos>)
   */
  private readonly _dirty = new Set<number>()

  /** Queue for withdrawing cells from dirty set after processing.
   *
   * OpenRA 对照: ResourceRenderer.cleanDirty (Queue<CPos>)
   */
  private readonly _cleanDirty: CPos[] = []

  /** Shadow sprite layer (optional — only if any sequence has shadows). */
  private _shadowLayer: ISpriteLayer | null = null

  /** Main sprite layer for resource rendering. */
  private _spriteLayer: ISpriteLayer | null = null

  /** Disposal guard.
   *
   * OpenRA 对照: ResourceRenderer.disposed
   */
  private _disposed = false

  /** Bound CellChanged handler (for cleanup). */
  private _boundCellChanged: ((cell: CPos, resourceType: string | null) => void) | null = null

  // -----------------------------------------------------------------------
  // Construction
  // OpenRA 对照: ResourceRenderer(Actor self, ResourceRendererInfo info)
  // -----------------------------------------------------------------------

  /** Create a new ResourceRenderer.
   *
   * OpenRA 对照: ResourceRenderer(Actor self, ResourceRendererInfo info)
   *
   * Initializes variant lookup dictionaries and subscribes to the
   * ResourceLayer's CellChanged event.
   *
   * @param world — the game world (with map, sequences, resource layer)
   * @param info — the rendering configuration
   */
  constructor(world: IResourceRendererWorld, info: ResourceRendererInfo) {
    this.info = info
    this.world = world
    this.resourceLayer = world.resourceLayer

    this.renderContents = new RRCellLayer(world.map.mapSize)

    // Build variant lookup: resourceType → variantName → ISpriteSequence
    this.variants = new Map()
    const sequences = world.sequences
    for (const [resourceType, resInfo] of info.resourceTypes) {
      const variantMap = new Map<string, ISpriteSequence>()
      for (const variantName of resInfo.sequences) {
        const seq = sequences.getSequence(resInfo.image, variantName)
        if (seq) {
          variantMap.set(variantName, seq)
        }
      }
      if (variantMap.size > 0) {
        this.variants.set(resourceType, variantMap)
      }
    }

    // Subscribe to cell changes
    this._boundCellChanged = this._addDirtyCell.bind(this) as (
      cell: CPos,
      resourceType: string | null,
    ) => void
    this.resourceLayer.addCellChangedListener(this._boundCellChanged)
  }

  // -----------------------------------------------------------------------
  // CellChanged handler
  // OpenRA 对照: ResourceRenderer.AddDirtyCell(CPos, string)
  // -----------------------------------------------------------------------

  /** Mark a cell as dirty (needs sprite update).
   *
   * OpenRA 对照: ResourceRenderer.AddDirtyCell(CPos, string)
   *
   * A cell is added to the dirty set when the resource type changes
   * or is cleared (resourceType === null). If a different resource
   * type (not handled by this renderer) appears, the cell is also
   * marked dirty so the old sprite can be cleared.
   *
   * @param cell — the cell that changed
   * @param resourceType — the new resource type, or null if cleared
   */
  private _addDirtyCell(cell: CPos, resourceType: string | null): void {
    if (resourceType === null || this.info.resourceTypes.has(resourceType)) {
      this._dirty.add(this._cellKey(cell))
    }
  }

  /** Convert a CPos to a numeric key for Set storage.
   *
   * Uses OpenRA's CPos.Bits packing (16 bits Y << 16 | 16 bits X).
   *
   * @param cell — the map cell
   * @returns a unique integer key
   */
  private _cellKey(cell: CPos): number {
    return ((cell.Y & 0xffff) << 16) | (cell.X & 0xffff)
  }

  // -----------------------------------------------------------------------
  // IWorldLoaded
  // OpenRA 对照: ResourceRenderer.WorldLoaded(World, WorldRenderer)
  // -----------------------------------------------------------------------

  /** Initialize sprite layers and populate initial render state.
   *
   * OpenRA 对照: ResourceRenderer.WorldLoaded(World w, WorldRenderer wr)
   *
   * Creates the TerrainSpriteLayer (and optional shadow layer) from the
   * first resource variant's first frame. Then iterates all map cells,
   * reads the current resource state, and populates the initial render
   * contents (so resources are visible through fog with Explored Map).
   *
   * @param _w — the world (not used, already stored)
   * @param _wr — the world renderer (not used directly, factory handles this)
   */
  worldLoaded(_w: WorldStub, _wr: WorldRendererStub): void {
    // Create sprite layers using the factory
    if (this._spriteLayerFactory) {
      this._createSpriteLayers()
    }

    // Initialize RenderContent with current map state
    // NOTE: In OpenRA this is done so resources are visible through fog
    // with the Explored Map option enabled.
    const allCells = this._getMapAllCells()
    for (const cell of allCells) {
      const resource = this.resourceLayer.getResource(cell)
      const rendererContents = this._createRenderCellContents(
        resource.type,
        resource.density,
        cell,
      )
      if (rendererContents.type) {
        this.renderContents.set(cell, rendererContents)
        this.updateRenderedSprite(cell, rendererContents)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Sprite layer factory (set externally before world load)
  // -----------------------------------------------------------------------

  /** Factory for creating sprite layers.
   *
   * Must be set before worldLoaded is called.
   * The factory encapsulates GPU resource creation (vertex buffers etc.)
   * so the trait stays decoupled from the platform layer.
   */
  private _spriteLayerFactory: ISpriteLayerFactory | null = null

  /** Register a sprite layer factory.
   *
   * This should be called during world setup, before worldLoaded.
   *
   * @param factory — the factory to use for creating sprite layers
   */
  setSpriteLayerFactory(factory: ISpriteLayerFactory): void {
    this._spriteLayerFactory = factory
  }

  /** Create the main sprite layer and optional shadow layer.
   *
   * OpenRA 对照: ResourceRenderer.WorldLoaded (sprite layer creation section)
   *
   * Uses the first variant of the first resource type to determine
   * the empty sprite (sheet + blend mode) for the TerrainSpriteLayer.
   */
  private _createSpriteLayers(): void {
    if (!this._spriteLayerFactory) return

    // Get the first variant's first sprite to determine sheet and blend mode
    for (const [, variantMap] of this.variants) {
      if (!variantMap || variantMap.size === 0) continue
      const firstVariant = variantMap.values().next().value
      if (!firstVariant) continue

      if (!this._spriteLayer) {
        const firstSprite = firstVariant.getSprite(0, 0)
        // Create empty sprite from same sheet but with empty rectangle
        const emptySprite: IResourceRendererSprite = {
          sheet: firstSprite.sheet,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          blendMode: firstSprite.blendMode,
          channel: firstSprite.channel,
        }
        // restrictToBounds: true for non-editor worlds
        this._spriteLayer = this._spriteLayerFactory.createSpriteLayer(
          emptySprite,
          firstSprite.blendMode,
          true /* restrictToBounds */,
        )
      }

      if (!this._shadowLayer) {
        const firstShadow = firstVariant.getShadow(0, 0)
        if (firstShadow) {
          const emptyShadowSprite: IResourceRendererSprite = {
            sheet: firstShadow.sheet,
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            blendMode: firstShadow.blendMode,
            channel: firstShadow.channel,
          }
          this._shadowLayer = this._spriteLayerFactory.createSpriteLayer(
            emptyShadowSprite,
            firstShadow.blendMode,
            true /* restrictToBounds */,
          )
        }
      }

      // All resources must share a blend mode — check for consistency
      if (this._spriteLayer) {
        for (const [, seq] of variantMap) {
          for (let frame = 0; frame < seq.length; frame++) {
            const sprite = seq.getSprite(frame, 0)
            if (sprite.blendMode !== this._spriteLayer.blendMode) {
              // NOTE: OpenRA throws InvalidDataException here.
              // We log a warning since TypeScript traits are softer.
              console.warn(
                `ResourceRenderer: resource sprites specify different blend modes. ` +
                `Use different ResourceRenderer traits for resource types with different blend modes.`,
              )
              return
            }
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // CreateRenderCellContents
  // OpenRA 对照: ResourceRenderer.CreateRenderCellContents
  // -----------------------------------------------------------------------

  /** Create a renderer cell contents entry from resource state.
   *
   * OpenRA 对照: ResourceRenderer.CreateRenderCellContents(WorldRenderer,
   *   ResourceLayerContents, CPos)
   *
   * @param resourceType — the resource type name (empty = no resource)
   * @param density — the current density
   * @param cell — the map cell (for variant selection)
   * @returns a RendererCellContents entry
   */
  private _createRenderCellContents(
    resourceType: string,
    density: number,
    cell: CPos,
  ): RendererCellContents {
    if (resourceType && density > 0 && this.info.resourceTypes.has(resourceType)) {
      const resInfo = this.info.resourceTypes.get(resourceType)!
      const sequence = this._chooseVariant(resourceType, cell)
      const palette = this._getPalette(resInfo.palette)
      return {
        type: resourceType,
        density,
        info: resInfo,
        sequence,
        palette,
      }
    }

    return RendererCellContentsEmpty
  }

  /** Get a palette reference by name.
   *
   * OpenRA 对照: wr.Palette(resourceInfo.Palette)
   *
   * NOTE: Full WorldRenderer palette integration requires the
   * WorldRenderer to be passed via the factory or a separate method.
   * For now, return a stub palette reference.
   * TODO-10.X: Integrate WorldRenderer palette system
   *
   * @param paletteName — the palette name
   * @returns a minimal palette reference
   */
  private _getPalette(paletteName: string): IPaletteRef {
    return {
      name: paletteName,
      textureIndex: 0,
      hasColorShift: false,
    }
  }

  // -----------------------------------------------------------------------
  // ChooseVariant — deterministic variant selection
  // OpenRA 对照: ResourceRenderer.ChooseVariant(string, CPos)
  // -----------------------------------------------------------------------

  /** Choose a sequence variant for a resource cell.
   *
   * OpenRA 对照: ResourceRenderer.ChooseVariant(string, CPos)
   *
   * Uses the cell's position to deterministically select one of the
   * available sequence variants. This ensures the same cell always
   * shows the same variant across frames.
   *
   * @param resourceType — the resource type
   * @param cell — the map cell
   * @returns the chosen sequence, or null if no variants available
   */
  protected chooseVariant(resourceType: string, cell: CPos): ISpriteSequence | null {
    return this._chooseVariant(resourceType, cell)
  }

  private _chooseVariant(resourceType: string, cell: CPos): ISpriteSequence | null {
    const variantMap = this.variants.get(resourceType)
    if (!variantMap || variantMap.size === 0) return null

    const variants = Array.from(variantMap.values())
    const idx = cellVariantIndex(cell, variants.length)
    return variants[idx]
  }

  // -----------------------------------------------------------------------
  // UpdateRenderedSprite — compute frame from density
  // OpenRA 对照: ResourceRenderer.UpdateRenderedSprite(CPos, RendererCellContents)
  // -----------------------------------------------------------------------

  /** Update the sprite at a cell based on its renderer contents.
   *
   * OpenRA 对照: ResourceRenderer.UpdateRenderedSprite(CPos, RendererCellContents)
   *
   * The frame index is lerped between 0 and sequence.Length-1 based on
   * density relative to max density. A full cell shows the last frame;
   * an empty cell clears the sprite.
   *
   * NOTE: Made protected (was private) to match OpenRA C# protected virtual
   * signature. D2kResourceRenderer overrides this for rounded-border logic.
   *
   * @param cell — the map cell to update
   * @param content — the current renderer cell contents
   */
  protected updateRenderedSprite(cell: CPos, content: RendererCellContents): void {
    if (!this._spriteLayer) return

    if (content.density > 0 && content.sequence) {
      const maxDensity = this.resourceLayer.getMaxDensity(content.type)
      const frame = lerpFrame(
        0,
        content.sequence.length - 1,
        content.density,
        maxDensity,
      )
      this.updateSpriteLayers(cell, content.sequence, frame, content.palette)
    } else {
      this.updateSpriteLayers(cell, null, 0, null)
    }
  }

  // -----------------------------------------------------------------------
  // UpdateSpriteLayers — delegate to sprite layers
  // OpenRA 对照: ResourceRenderer.UpdateSpriteLayers(CPos, ISpriteSequence,
  //   int, PaletteReference)
  // -----------------------------------------------------------------------

  /** Update (or clear) sprites on all layers for a cell.
   *
   * OpenRA 对照: ResourceRenderer.UpdateSpriteLayers(CPos, ISpriteSequence,
   *   int, PaletteReference)
   *
   * NOTE: Made protected (was private) to match OpenRA C# protected signature.
   * D2kResourceRenderer calls this from its rounded-border sprite logic.
   *
   * @param cell — the map cell
   * @param sequence — the sprite sequence, or null to clear
   * @param frame — the frame index within the sequence
   * @param palette — the palette to use for rendering
   */
  protected updateSpriteLayers(
    cell: CPos,
    sequence: ISpriteSequence | null,
    frame: number,
    palette: IPaletteRef | null,
  ): void {
    if (sequence) {
      if (this._shadowLayer) {
        const shadow = sequence.getShadow(frame, 0)
        if (shadow) {
          // NOTE: OpenRA calls shadowLayer.Update(cell, sequence.GetShadow(frame, 0), palette, 1f, 1f, sequence.IgnoreWorldTint)
          // For simplicity, use the same update method (shadow is baked into the sequence rendering)
          this._shadowLayer.update(cell, sequence, palette, frame)
        } else {
          this._shadowLayer.clear(cell)
        }
      }

      if (this._spriteLayer) {
        this._spriteLayer.update(cell, sequence, palette, frame)
      }
    } else {
      if (this._shadowLayer) this._shadowLayer.clear(cell)
      if (this._spriteLayer) this._spriteLayer.clear(cell)
    }
  }

  // -----------------------------------------------------------------------
  // ITickRender
  // OpenRA 对照: ITickRender.TickRender(WorldRenderer, Actor)
  // -----------------------------------------------------------------------

  /** Process dirty cells and update their sprites.
   *
   * OpenRA 对照: ResourceRenderer.TickRender(WorldRenderer, Actor)
   *
   * Called every render frame. Iterates over the dirty cell set,
   * compares current resource state with cached render state,
   * and updates sprites when the type or density changes.
   * Visible cells only (respects fog of war).
   *
   * @param _wr — the world renderer (not directly used)
   * @param _self — the actor owning this trait
   */
  tickRender(_wr: WorldRendererStub, _self: IGameActor): void {
    for (const key of this._dirty) {
      const cell = this._keyToCell(key)

      if (!this.resourceLayer.isVisible(cell)) continue

      let rendererContents: RendererCellContents = RendererCellContentsEmpty
      const contents = this.resourceLayer.getResource(cell)
      if (contents.density > 0) {
        const existing = this.renderContents.get(cell)

        // Contents are the same type, so just update the density
        if (existing.type === contents.type) {
          rendererContents = {
            type: existing.type,
            density: contents.density,
            info: existing.info,
            sequence: existing.sequence,
            palette: existing.palette,
          }
        } else {
          // Type changed or new resource — create fresh render contents
          rendererContents = this._createRenderCellContents(
            contents.type,
            contents.density,
            cell,
          )
        }
      }

      this.renderContents.set(cell, rendererContents)
      this.updateRenderedSprite(cell, rendererContents)
      this._cleanDirty.push(cell)
    }

    // Remove processed cells from the dirty set
    // (must be done outside the for-of to avoid mutation during iteration)
    while (this._cleanDirty.length > 0) {
      const cell = this._cleanDirty.shift()!
      this._dirty.delete(this._cellKey(cell))
    }
  }

  /** Convert a numeric key back to a CPos.
   *
   * @param key — the packed cell key
   * @returns the corresponding CPos
   */
  private _keyToCell(key: number): CPos {
    return new CPos(key & 0xffff, (key >> 16) & 0xffff)
  }

  // -----------------------------------------------------------------------
  // IRenderOverlay
  // OpenRA 对照: IRenderOverlay.Render(WorldRenderer)
  // -----------------------------------------------------------------------

  /** Render all resource sprite layers.
   *
   * OpenRA 对照: ResourceRenderer.Render(WorldRenderer)
   *
   * Called after the terrain is rendered. Draws resource sprites
   * on top of the terrain.
   *
   * @param wr — the world renderer (contains viewport for culling)
   */
  render(wr: WorldRendererStub): void {
    if (!this._spriteLayer) return

    // Extract viewport from the WorldRenderer
    // NOTE: The actual viewport extraction depends on the WorldRenderer's API.
    // For now, draw with a default full-map viewport.
    const viewport = this._getViewport(wr)

    if (this._shadowLayer) {
      this._shadowLayer.draw(viewport)
    }
    this._spriteLayer.draw(viewport)
  }

  /** Extract viewport from the WorldRenderer.
   *
   * OpenRA 对照: wr.Viewport.VisibleCells
   *
   * @param _wr — the world renderer
   * @returns a viewport descriptor for culling
   */
  private _getViewport(_wr: WorldRendererStub): IResourceRendererViewport {
    // NOTE: Full viewport integration requires WorldRenderer.Viewport.
    // For now, render the entire map (firstRow=0 to lastRow=mapHeight).
    // TODO-10.X: Integrate with WorldRenderer viewport for proper culling.
    const mapSize = this.world.map.mapSize
    return {
      visibleCells: {
        firstRow: 0,
        lastRow: mapSize.height - 1,
        firstCol: 0,
        lastCol: mapSize.width - 1,
      },
    }
  }

  // -----------------------------------------------------------------------
  // IResourceRenderer
  // OpenRA 对照: IResourceRenderer interface members
  // -----------------------------------------------------------------------

  /** The set of resource type strings this renderer handles.
   *
   * OpenRA 对照: IResourceRenderer.ResourceTypes
   */
  get resourceTypes(): Iterable<string> {
    return this.info.resourceTypes.keys()
  }

  /** Get the resource type rendered at a given cell.
   *
   * OpenRA 对照: IResourceRenderer.GetRenderedResourceType(CPos)
   *
   * @param cell — the map cell to query
   * @returns the resource type string, or null if no resource is rendered
   */
  getRenderedResourceType(cell: CPos): string | null {
    const contents = this.renderContents.get(cell)
    return contents.type || null
  }

  /** Get the tooltip string for resources rendered at a given cell.
   *
   * OpenRA 对照: IResourceRenderer.GetRenderedResourceTooltip(CPos)
   *
   * @param cell — the map cell to query
   * @returns the tooltip string, or null if no resource at this cell
   */
  getRenderedResourceTooltip(cell: CPos): string | null {
    const contents = this.renderContents.get(cell)
    if (!contents.type || !contents.info) return null
    return contents.info.name
  }

  // -----------------------------------------------------------------------
  // INotifyActorDisposing
  // OpenRA 对照: ResourceRenderer.Disposing(Actor)
  // -----------------------------------------------------------------------

  /** Dispose all resources held by this renderer.
   *
   * OpenRA 对照: ResourceRenderer.Disposing(Actor)
   *
   * Unsubscribes from the ResourceLayer's CellChanged event and
   * disposes sprite layers (which release GPU resources).
   *
   * @param _self — the actor being disposed
   */
  disposing(_self: IGameActor): void {
    this.dispose()
  }

  /** Dispose the renderer, releasing all resources.
   *
   * OpenRA 对照: ResourceRenderer.Disposing (content)
   */
  dispose(): void {
    if (this._disposed) return

    if (this._shadowLayer) {
      this._shadowLayer.dispose()
      this._shadowLayer = null
    }

    if (this._spriteLayer) {
      this._spriteLayer.dispose()
      this._spriteLayer = null
    }

    // Unsubscribe from CellChanged
    if (this._boundCellChanged) {
      this.resourceLayer.removeCellChangedListener(this._boundCellChanged)
      this._boundCellChanged = null
    }

    this._disposed = true
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Get all cells of the map.
   *
   * Iterates over the map dimensions to produce the full cell list.
   */
  private _getMapAllCells(): Iterable<CPos> {
    const size = this.world.map.mapSize
    const cells: CPos[] = []
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        cells.push(new CPos(x, y))
      }
    }
    return cells
  }
}

// ---------------------------------------------------------------------------
// RRCellLayer — simplified cell layer for RendererCellContents
// ---------------------------------------------------------------------------

/** Lightweight 2D cell storage for renderer cell contents.
 *
 * OpenRA 对照: CellLayer<RendererCellContents>
 *
 * Stores per-cell render state in a flat array indexed by (y * width + x).
 * This is a simplified CellLayer that doesn't need the full CPos/MPos
 * indexing or observer pattern of the main CellLayer class.
 */
class RRCellLayer {
  private readonly _data: RendererCellContents[]
  readonly width: number
  readonly height: number

  constructor(size: { readonly width: number; readonly height: number }) {
    this.width = size.width
    this.height = size.height
    this._data = new Array<RendererCellContents>(size.width * size.height)
    for (let i = 0; i < this._data.length; i++) {
      this._data[i] = RendererCellContentsEmpty
    }
  }

  /** Get the render contents at a cell. */
  get(cell: CPos): RendererCellContents {
    const idx = cell.Y * this.width + cell.X
    if (idx < 0 || idx >= this._data.length) return RendererCellContentsEmpty
    return this._data[idx]
  }

  /** Set the render contents at a cell. */
  set(cell: CPos, value: RendererCellContents): void {
    const idx = cell.Y * this.width + cell.X
    if (idx < 0 || idx >= this._data.length) return
    this._data[idx] = value
  }
}
