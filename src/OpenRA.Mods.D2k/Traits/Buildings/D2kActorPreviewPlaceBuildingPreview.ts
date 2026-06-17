/**
 * D2kActorPreviewPlaceBuildingPreview.ts — D2K 建筑放置预览（混凝土覆盖检测）
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/Buildings/D2kActorPreviewPlaceBuildingPreview.cs (124 lines)
 *
 * 核心范式转换:
 * - C# ActorPreviewPlaceBuildingPreviewInfo (base class) → TS minimal base
 *   (ActorPreviewPlaceBuildingPreview not yet migrated, stubbed here)
 * - C# D2kActorPreviewPlaceBuildingPreviewPreview.RenderFootprint() override
 *   → TS RenderFootprint with UnsafeTerrainTypes check
 * - C# SpriteRenderable yield return → TS array return
 * - C# yield return 受 FootprintAlpha/LineBuildFootprintAlpha 影响
 *   → TS alpha multiplication applied to sequence alpha
 * - C# CachedTransform<CPos, List<CPos>> → TS lazy computation
 *
 * During building placement, this preview shows:
 * - Green tiles: valid placement (on concrete)
 * - Red tiles: invalid placement (blocked)
 * - Unsafe tiles: terrain damage warning (e.g., Rock)
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// PlaceBuildingCellType (minimal, from PlaceBuildingOrderGenerator)
// ---------------------------------------------------------------------------

/** Cell type for building placement preview.
 *
 * OpenRA 对照: PlaceBuildingCellType enum flags
 */
export const PlaceBuildingCellType = {
  Valid: 1,
  Invalid: 2,
  LineBuild: 4,
} as const
export type PlaceBuildingCellType = number

// ---------------------------------------------------------------------------
// Minimal sequence + sprite types
// ---------------------------------------------------------------------------

/** Minimal sequence definition.
 *
 * OpenRA 对照: Sequence (from OpenRA.Graphics)
 */
export interface ISequenceMinimal {
  getSprite(frame: number): unknown
  getAlpha(frame: number): number
}

/** Minimal sequences provider.
 *
 * OpenRA 对照: Sequences
 */
export interface ISequencesMinimal {
  getSequence(image: string, name: string): ISequenceMinimal
}

/** Minimal map with sequences.
 *
 * OpenRA 对照: Map.Sequences
 */
export interface IMapWithSequences {
  readonly sequences: ISequencesMinimal
  centerOfCell(cell: CPos): WPos
  contains(cell: CPos): boolean
  getTerrainInfo(cell: CPos): { type: string }
}

/** Minimal world for preview.
 *
 * OpenRA 对照: World (subset for preview)
 */
export interface IWorldMinimal {
  readonly map: IMapWithSequences
  readonly worldActor?: IGameActor
}

/** Minimal WorldRenderer for preview.
 *
 * OpenRA 对照: WorldRenderer (subset)
 */
export interface IWorldRendererPreviewMinimal {
  readonly world: IWorldMinimal
  palette(name: string): { readonly name: string }
}

/** Minimal ActorInfo for preview.
 *
 * OpenRA 对照: ActorInfo
 */
export interface IActorInfoMinimal {
  traitInfo<T>(name: string): T | undefined
}

/** Minimal BuildingInfo for footprint computation.
 *
 * OpenRA 对照: BuildingInfo (subset)
 */
export interface IBuildingFootprintInfo {
  terrainTypes: ReadonlySet<string>
  occupiedTiles(topLeft: CPos): CPos[]
  footprint?: ReadonlyMap<string, string>
}

// ---------------------------------------------------------------------------
// D2kActorPreviewPlaceBuildingPreviewInfo
// ---------------------------------------------------------------------------

/** Configuration for the D2K building placement preview.
 *
 * OpenRA 对照: D2kActorPreviewPlaceBuildingPreviewInfo : ActorPreviewPlaceBuildingPreviewInfo
 */
export class D2kActorPreviewPlaceBuildingPreviewInfo {
  readonly instanceName?: string

  /** Terrain types that show the 'unsafe' footprint tile.
   *
   * OpenRA 对照: UnsafeTerrainTypes (FrozenSet<string>)
   */
  readonly unsafeTerrainTypes: ReadonlySet<string>

  /** Only check for unsafe tiles when these prerequisites are met.
   *
   * OpenRA 对照: RequiresPrerequisites (ImmutableArray<string>)
   */
  readonly requiresPrerequisites: readonly string[]

  /** Sprite image for the overlay.
   *
   * OpenRA 对照: Image
   */
  readonly image: string

  /** Sequence name for valid tiles.
   *
   * OpenRA 对照: TileValidName
   */
  readonly tileValidName: string

  /** Sequence name for invalid tiles.
   *
   * OpenRA 对照: TileInvalidName
   */
  readonly tileInvalidName: string

  /** Sequence name for unsafe tiles.
   *
   * OpenRA 对照: TileUnsafeName
   */
  readonly tileUnsafeName: string

  /** Palette for rendering.
   *
   * OpenRA 对照: Palette (from base class)
   */
  readonly palette: string

  /** Alpha multiplier for footprint tiles.
   *
   * OpenRA 对照: FootprintAlpha
   */
  readonly footprintAlpha: number

  /** Alpha multiplier for line-build footprint tiles.
   *
   * OpenRA 对照: LineBuildFootprintAlpha
   */
  readonly lineBuildFootprintAlpha: number

  constructor(params: {
    instanceName?: string
    unsafeTerrainTypes?: readonly string[]
    requiresPrerequisites?: readonly string[]
    image?: string
    tileValidName?: string
    tileInvalidName?: string
    tileUnsafeName?: string
    palette?: string
    footprintAlpha?: number
    lineBuildFootprintAlpha?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.unsafeTerrainTypes = new Set(params.unsafeTerrainTypes ?? ['Rock'])
    this.requiresPrerequisites = params.requiresPrerequisites ?? []
    this.image = params.image ?? 'overlay'
    this.tileValidName = params.tileValidName ?? 'build-valid'
    this.tileInvalidName = params.tileInvalidName ?? 'build-invalid'
    this.tileUnsafeName = params.tileUnsafeName ?? 'build-unsafe'
    this.palette = params.palette ?? 'terrain'
    this.footprintAlpha = params.footprintAlpha ?? 1.0
    this.lineBuildFootprintAlpha = params.lineBuildFootprintAlpha ?? 1.0
  }
}

// ---------------------------------------------------------------------------
// Render entry type
// ---------------------------------------------------------------------------

/** A preview renderable entry.
 *
 * OpenRA 对照: SpriteRenderable (from RenderFootprint)
 */
export interface PreviewRenderEntry {
  readonly tile: unknown // Sprite
  readonly pos: WPos
  readonly offset: WVec
  readonly palette: { readonly name: string }
  readonly alpha: number
}

// ---------------------------------------------------------------------------
// D2kActorPreviewPlaceBuildingPreview
// ---------------------------------------------------------------------------

/** D2K building placement preview that shows concrete coverage.
 *
 * OpenRA 对照: D2kActorPreviewPlaceBuildingPreview (hollow class)
 *
 * The hollow class is just a trait marker. The real logic is in
 * D2kActorPreviewPlaceBuildingPreviewPreview which handles rendering.
 */
export class D2kActorPreviewPlaceBuildingPreview {
  /** Create the preview instance.
   *
   * OpenRA 对照: D2kActorPreviewPlaceBuildingPreviewPreview constructor
   *
   * @param wr — the world renderer
   * @param ai — actor info for the building being placed
   * @param info — the preview configuration
   * @param init — actor initializer (contains owner, location, etc.)
   */
  static createPreview(
    wr: IWorldRendererPreviewMinimal,
    ai: IActorInfoMinimal,
    info: D2kActorPreviewPlaceBuildingPreviewInfo,
    init: {
      get: <T>(name: string) => T | undefined
      value?: (world: IWorldMinimal) => IGameActor
    },
  ): D2kActorPreviewPlaceBuildingPreviewPreview {
    return new D2kActorPreviewPlaceBuildingPreviewPreview(wr, ai, info, init)
  }
}

// ---------------------------------------------------------------------------
// D2kActorPreviewPlaceBuildingPreviewPreview
// ---------------------------------------------------------------------------

/** The actual preview renderer for D2K building placement.
 *
 * OpenRA 对照: D2kActorPreviewPlaceBuildingPreviewPreview
 *   : ActorPreviewPlaceBuildingPreviewPreview (nested sealed class)
 */
export class D2kActorPreviewPlaceBuildingPreviewPreview {
  private readonly _info: D2kActorPreviewPlaceBuildingPreviewInfo
  private readonly _checkUnsafeTiles: boolean
  private readonly _validTile: unknown
  private readonly _unsafeTile: unknown
  private readonly _blockedTile: unknown
  private readonly _validAlpha: number
  private readonly _unsafeAlpha: number
  private readonly _blockedAlpha: number
  private readonly _buildingInfo: IBuildingFootprintInfo
  private readonly _wr: IWorldRendererPreviewMinimal

  /** Cached occupied tiles computation. */
  private _cachedTopLeft: CPos | null = null
  private _cachedOccupiedTiles: CPos[] | null = null

  constructor(
    wr: IWorldRendererPreviewMinimal,
    ai: IActorInfoMinimal,
    info: D2kActorPreviewPlaceBuildingPreviewInfo,
    init: {
      get: <T>(name: string) => T | undefined
      value?: (world: IWorldMinimal) => IGameActor
    },
  ) {
    this._info = info
    this._wr = wr

    const world = wr.world
    const sequences = world.map.sequences

    // Check prerequisites for unsafe tile detection
    let checkUnsafe = false
    if (info.requiresPrerequisites.length > 0) {
      const ownerInit = init.get<{ value: (w: IWorldMinimal) => IGameActor }>('Owner')
      if (ownerInit) {
        const playerActor = ownerInit.value(world)
        const techTree = (playerActor as unknown as Record<string, unknown>)?.['TechTree'] as { hasPrerequisites?: (prereqs: readonly string[]) => boolean } | undefined
        if (techTree?.hasPrerequisites?.(info.requiresPrerequisites)) {
          checkUnsafe = true
        }
      }
    }
    this._checkUnsafeTiles = checkUnsafe

    // Load sequences
    const validSeq = sequences.getSequence(info.image, info.tileValidName)
    this._validTile = validSeq.getSprite(0)
    this._validAlpha = validSeq.getAlpha(0)

    const unsafeSeq = sequences.getSequence(info.image, info.tileUnsafeName)
    this._unsafeTile = unsafeSeq.getSprite(0)
    this._unsafeAlpha = unsafeSeq.getAlpha(0)

    const blockedSeq = sequences.getSequence(info.image, info.tileInvalidName)
    this._blockedTile = blockedSeq.getSprite(0)
    this._blockedAlpha = blockedSeq.getAlpha(0)

    // Get building footprint info
    this._buildingInfo = ai.traitInfo<IBuildingFootprintInfo>('BuildingInfo') ?? {
      terrainTypes: new Set(),
      occupiedTiles: () => [],
    }
  }

  // -----------------------------------------------------------------------
  // RenderFootprint (对应 OpenRA D2kActorPreviewPlaceBuildingPreviewPreview.RenderFootprint)
  // -----------------------------------------------------------------------

  /** Render the building footprint preview with concrete-aware coloring.
   *
   * OpenRA 对照: RenderFootprint(WorldRenderer wr, CPos topLeft,
   *   Dictionary<CPos, PlaceBuildingCellType> footprint,
   *   PlaceBuildingCellType filter)
   *
   * Renders each footprint cell as:
   * - Blocked (red): Invalid placement
   * - Unsafe (yellow/orange): Valid placement but on damage terrain
   * - Valid (green): Valid placement on safe terrain
   *
   * @param topLeft — the top-left cell of the building footprint
   * @param footprint — map of cell → cell type for each footprint cell
   * @param filter — which cell types to render (bitmask)
   * @returns array of preview render entries
   */
  renderFootprint(
    topLeft: CPos,
    footprint: ReadonlyMap<string, PlaceBuildingCellType>,
    filter: PlaceBuildingCellType = PlaceBuildingCellType.Invalid | PlaceBuildingCellType.Valid | PlaceBuildingCellType.LineBuild,
  ): readonly PreviewRenderEntry[] {
    const palette = this._wr.palette(this._info.palette)
    const world = this._wr.world
    const topLeftPos = world.map.centerOfCell(topLeft)

    // Lazily compute occupied tiles for this topLeft
    if (this._cachedTopLeft === null || !this._cachedTopLeft.equals(topLeft)) {
      this._cachedTopLeft = topLeft
      this._cachedOccupiedTiles = this._buildingInfo.occupiedTiles(topLeft)
    }
    const candidateSafeTiles = this._cachedOccupiedTiles ?? []

    const results: PreviewRenderEntry[] = []

    for (const [cellKey, cellValue] of footprint) {
      if ((cellValue & filter) === 0) continue

      const [sx, sy] = cellKey.split(',')
      const cell = new CPos(Number(sx), Number(sy))

      // Check if cell is on unsafe terrain
      const isUnsafe =
        this._checkUnsafeTiles &&
        world.map.contains(cell) &&
        candidateSafeTiles.some(c => c.equals(cell)) &&
        this._info.unsafeTerrainTypes.has(world.map.getTerrainInfo(cell).type)

      const isInvalid = (cellValue & PlaceBuildingCellType.Invalid) !== 0
      const tile = isInvalid
        ? this._blockedTile
        : isUnsafe
          ? this._unsafeTile
          : this._validTile

      const seqAlpha = isInvalid
        ? this._blockedAlpha
        : isUnsafe
          ? this._unsafeAlpha
          : this._validAlpha

      const cellCenter = world.map.centerOfCell(cell)
      const offset = new WVec(0, 0, topLeftPos.Z - cellCenter.Z)
      const traitAlpha =
        (cellValue & PlaceBuildingCellType.LineBuild) !== 0
          ? this._info.lineBuildFootprintAlpha
          : this._info.footprintAlpha

      results.push({
        tile,
        pos: cellCenter,
        offset,
        palette,
        alpha: seqAlpha * traitAlpha,
      })
    }

    return results
  }
}
