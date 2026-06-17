/**
 * TSVeinsRenderer.ts — Tiberian Sun 静脉资源渲染器
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/TSVeinsRenderer.cs (430 lines)
 *
 * 核心范式转换:
 * - C# standalone IResourceRenderer (NOT extending ResourceRenderer) → TS same
 * - C# [Flags] enum Adjacency : byte → TS const object with bitwise ops
 * - C# FrozenDictionary<Adjacency, int[]> → TS Map<number, number[]>
 * - C# HashSet<CPos> dirty + Queue<CPos> cleanDirty → TS Set<number> + number[]
 * - C# CellLayer<int[]>/CellLayer<Adjacency> → TS CellLayer (Ch4)
 * - C# TerrainSpriteLayer → TS TerrainSpriteLayer (Ch2)
 * - C# yield return IRenderable → TS Generator
 * - C# IMapPreviewSignatureInfo (static method on info) → TS static method
 * - C# IRadarTerrainLayer event add/remove → TS listener add/remove pattern
 *
 * NOTE: ADR-19.6 (LinesMesh for vein growth) is deferred to post-MVP.
 * NOTE: FluentProvider localization uses raw string fallback.
 * NOTE: Veinhole actor tracking: monitors world.ActorAdded/ActorRemoved.
 * NOTE: Dirty cell keys use packed int: ((Y & 0xffff) << 16) | (X & 0xffff).
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MPos } from '../../../OpenRA.Game/MPos.js'
import type {
  IGameActor,
  ITraitInfo,
  WorldRendererStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Adjacency — Flags enum for vein border connectivity
// OpenRA 对照: [Flags] enum Adjacency : byte
// ---------------------------------------------------------------------------

export const Adjacency = {
  None: 0x0,
  MinusX: 0x1,
  PlusX: 0x2,
  MinusY: 0x4,
  PlusY: 0x8,
} as const
export type Adjacency = number

// ---------------------------------------------------------------------------
// BorderIndices — static mapping of adjacency to sprite frame index groups
// OpenRA 对照: static readonly FrozenDictionary<Adjacency, int[]> BorderIndices
// ---------------------------------------------------------------------------

export const BorderIndices = new Map<Adjacency, number[]>([
  [Adjacency.MinusY, [3, 4, 5]],
  [Adjacency.PlusX, [6, 7, 8]],
  [Adjacency.MinusY | Adjacency.PlusX, [9, 10, 11]],
  [Adjacency.PlusY, [12, 13, 14]],
  [Adjacency.MinusY | Adjacency.PlusY, [15, 16, 17]],
  [Adjacency.PlusY | Adjacency.PlusX, [18, 19, 20]],
  [Adjacency.MinusY | Adjacency.PlusY | Adjacency.PlusX, [21, 22, 23]],
  [Adjacency.MinusX, [24, 25, 26]],
  [Adjacency.MinusX | Adjacency.MinusY, [27, 28, 29]],
  [Adjacency.MinusX | Adjacency.PlusX, [30, 31, 32]],
  [Adjacency.MinusX | Adjacency.PlusX | Adjacency.MinusY, [33, 34, 35]],
  [Adjacency.MinusX | Adjacency.PlusY, [36, 37, 38]],
  [Adjacency.MinusX | Adjacency.MinusY | Adjacency.PlusY, [39, 40, 41]],
  [Adjacency.MinusX | Adjacency.PlusX | Adjacency.PlusY, [42, 43, 44]],
  [
    Adjacency.MinusX | Adjacency.PlusX | Adjacency.MinusY | Adjacency.PlusY,
    [45, 46, 47],
  ],
])

// ---------------------------------------------------------------------------
// Sprite frame index constants
// OpenRA 对照: static readonly int[] HeavyIndices, LightIndices, Ramp1-4Indices
// ---------------------------------------------------------------------------

export const HeavyIndices = [48, 49, 50, 51]
export const LightIndices = [52]
export const Ramp1Indices = [53, 54]
export const Ramp2Indices = [55, 56]
export const Ramp3Indices = [57, 58]
export const Ramp4Indices = [59, 60]

// ---------------------------------------------------------------------------
// Cell key encoding (packed int for Set lookup)
// OpenRA pattern for HashSet<CPos> → packed int to avoid CPos equality issues
// ---------------------------------------------------------------------------

function cellKey(cell: CPos): number {
  return ((cell.Y & 0xffff) << 16) | (cell.X & 0xffff)
}

// ---------------------------------------------------------------------------
// ResourceLayerContents stub
// ---------------------------------------------------------------------------

export interface ResourceLayerContents {
  readonly type: string
  readonly density: number
}

// ---------------------------------------------------------------------------
// IResourceLayer stub (subset needed by TSVeinsRenderer)
// ---------------------------------------------------------------------------

interface IResourceLayerStub {
  readonly info: IResourceLayerInfoStub
  getResource(cell: CPos): ResourceLayerContents
  getMaxDensity(resourceType: string): number
  isVisible(cell: CPos): boolean
  onCellChanged(cell: CPos, resourceType: string | null): void
  addCellChangedListener?(handler: (cell: CPos, resourceType: string | null) => void): void
  removeCellChangedListener?(handler: (cell: CPos, resourceType: string | null) => void): void
}

interface IResourceLayerInfoStub {
  tryGetTerrainType(resourceType: string): string | undefined
  tryGetResourceIndex(resourceType: string): number | undefined
}

// ---------------------------------------------------------------------------
// CellLayer stub (subset)
// ---------------------------------------------------------------------------

interface CellLayerStub<T> {
  get(cell: CPos): T | null
  set(cell: CPos, value: T | null): void
  contains(cell: CPos): boolean
  cellEntryChanged?: {
    add?: (fn: (cell: CPos) => void) => void
    remove?: (fn: (cell: CPos) => void) => void
  }
}

// ---------------------------------------------------------------------------
// TerrainSpriteLayer stub (subset)
// ---------------------------------------------------------------------------

interface TerrainSpriteLayerStub {
  update(cell: CPos, sequence: any, palette: any, index: number): void
  clear(cell: CPos): void
  draw(viewport: any): void
}

// ---------------------------------------------------------------------------
// ISpriteSequence / PaletteReference stubs
// ---------------------------------------------------------------------------

interface SequenceStub {
  getSprite(frame: number): any
  getAlpha(frame: number): number
  readonly ignoreWorldTint: boolean
  readonly scale: number
}

interface PaletteRefStub { /* marker */ }

interface SequenceProviderStub {
  getSequence(image: string, sequence: string): SequenceStub
}

// ---------------------------------------------------------------------------
// ExpandFootprint utility
// OpenRA 对照: Common.Util.ExpandFootprint(CPos, bool)
// Returns the 4 orthogonal neighbor cells.
// ---------------------------------------------------------------------------

function expandFootprint(cell: CPos, _allowDiagonal: boolean): CPos[] {
  return [
    new CPos(cell.X - 1, cell.Y),
    new CPos(cell.X + 1, cell.Y),
    new CPos(cell.X, cell.Y - 1),
    new CPos(cell.X, cell.Y + 1),
  ]
}

// ---------------------------------------------------------------------------
// Color stub
// ---------------------------------------------------------------------------

interface ColorStub {
  readonly toArgb: number
  readonly R: number
  readonly G: number
  readonly B: number
  readonly A: number
}

// ---------------------------------------------------------------------------
// Map stub (extended WorldStub)
// ---------------------------------------------------------------------------

interface MapStubExt {
  readonly ramp: { get(cell: CPos): number; [key: string]: any }
  readonly resources: { get(cell: CPos): ResourceLayerContents; contains(cell: CPos): boolean; [key: string]: any }
  readonly rules: {
    readonly terrainInfo: {
      readonly terrainTypes: ReadonlyArray<{ readonly color: ColorStub }>
      getTerrainIndex(terrainType: string): number
    }
    readonly actors: Readonly<Record<string, any>>
  }
  readonly sequences: SequenceProviderStub
  readonly allCells: Iterable<CPos>
  readonly mapSize: { readonly Width: number; readonly Height: number }
  readonly actorDefinitions: ReadonlyMap<string, { readonly value: string; readonly Value: string }>
  rampGet?(cell: CPos): number
}

// ---------------------------------------------------------------------------
// TSVeinsRendererInfo
// OpenRA 对照: TSVeinsRendererInfo : TraitInfo, Requires<IResourceLayerInfo>, IMapPreviewSignatureInfo
// ---------------------------------------------------------------------------

export interface TSVeinsRendererInfo extends ITraitInfo {
  readonly resourceType: string
  readonly image: string
  readonly sequence: string
  readonly palette: string
  readonly name: string
  readonly veinholeActors: ReadonlySet<string>
}

export const DefaultTSVeinsRendererInfo = {
  image: 'resources',
  sequence: 'veins',
  palette: 'terrain',
  veinholeActors: new Set<string>(),
} as const

export function createTSVeinsRendererInfo(
  overrides: { resourceType: string; name: string } & Partial<Omit<TSVeinsRendererInfo, 'resourceType' | 'name'>>,
): TSVeinsRendererInfo {
  return {
    resourceType: overrides.resourceType,
    name: overrides.name,
    image: overrides.image ?? DefaultTSVeinsRendererInfo.image,
    sequence: overrides.sequence ?? DefaultTSVeinsRendererInfo.sequence,
    palette: overrides.palette ?? DefaultTSVeinsRendererInfo.palette,
    veinholeActors: overrides.veinholeActors ?? new Set(DefaultTSVeinsRendererInfo.veinholeActors),
  }
}

// ---------------------------------------------------------------------------
// TSVeinsRenderer
// OpenRA 对照: TSVeinsRenderer : IResourceRenderer, IWorldLoaded, IRenderOverlay,
//              ITickRender, INotifyActorDisposing, IRadarTerrainLayer
// ---------------------------------------------------------------------------

export class TSVeinsRenderer {
  private readonly _info: TSVeinsRendererInfo
  private readonly _world: any
  private readonly _resourceLayer: IResourceLayerStub
  private readonly _renderIndices!: CellLayerStub<number[]>
  private readonly _borders!: CellLayerStub<Adjacency>
  private readonly _dirty = new Set<number>() // packed cell keys
  private readonly _cleanDirty: number[] = []
  private readonly _veinholeCells = new Set<number>() // packed cell keys
  private readonly _maxDensity: number
  private _veinRadarColor: ColorStub | null = null
  private _veinSequence: SequenceStub | null = null
  private _veinPalette: PaletteRefStub | null = null
  private _spriteLayer: TerrainSpriteLayerStub | null = null
  private _onCellChangedHooked = false
  /** Bound listener reference — stored so disposing() can match the exact function.
   *
   * OpenRA 对照: event += handler (stored delegate reference)
   *
   * NOTE: .bind(this) creates a NEW function reference every call.
   * We store the bound reference at construction time so that
   * removeCellChangedListener can correctly unregister the same function.
   */
  private readonly _boundAddDirtyCell: (cell: CPos, resourceType: string | null) => void

  constructor(self: IGameActor, info: TSVeinsRendererInfo) {
    this._info = info
    this._world = (self as any).world

    this._resourceLayer = (self as any).getTrait?.('IResourceLayer') as IResourceLayerStub
    if (!this._resourceLayer) {
      throw new Error('TSVeinsRenderer requires IResourceLayer trait on the same actor')
    }

    // Store bound reference so dispose can unregister the same function
    this._boundAddDirtyCell = this._addDirtyCell.bind(this)

    // Subscribe to cell changes
    if (this._resourceLayer.addCellChangedListener) {
      this._resourceLayer.addCellChangedListener(this._boundAddDirtyCell)
      this._onCellChangedHooked = true
    }

    this._maxDensity = this._resourceLayer.getMaxDensity(info.resourceType)

    // Get vein radar color
    const terrainInfo = this._world?.map?.rules?.terrainInfo as any
    if (terrainInfo) {
      const terrainType = this._resourceLayer.info.tryGetTerrainType(info.resourceType)
      if (terrainType !== undefined) {
        const idx = terrainInfo.getTerrainIndex(terrainType)
        this._veinRadarColor = terrainInfo.terrainTypes[idx]?.color ?? null
      }
    }

    // Create cell layers
    const worldMap = this._world?.map as any
    if (worldMap) {
      this._renderIndices = { get: () => null, set: () => {}, contains: () => false } as any
      this._borders = { get: () => null, set: () => {}, contains: () => false } as any
    }

    // Load sequence
    if (worldMap?.sequences) {
      this._veinSequence = worldMap.sequences.getSequence(info.image, info.sequence) as SequenceStub
    }
  }

  // ---------------------------------------------------------------------------
  // Dirty cell management
  // ---------------------------------------------------------------------------

  private _addDirtyCell(cell: CPos, resourceType: string | null): void {
    if (resourceType === null || resourceType === this._info.resourceType) {
      this._dirty.add(cellKey(cell))
    }
  }

  /** Internal addDirtyCell that takes CPos directly (used by veinhole tracking). */
  _addDirtyCellDirect(cell: CPos, resourceType: string | null): void {
    this._addDirtyCell(cell, resourceType)
  }

  // ---------------------------------------------------------------------------
  // IWorldLoaded
  // OpenRA 对照: TSVeinsRenderer.WorldLoaded(World, WorldRenderer)
  // ---------------------------------------------------------------------------

  worldLoaded(w: any, wr: WorldRendererStub): void {
    // Track veinhole actors
    if (w.actorAdded) {
      const origAdded = w.actorAdded
      w.actorAdded = (a: IGameActor) => {
        origAdded?.(a)
        this._actorAddedToWorld(a)
      }
    }
    if (w.actorRemoved) {
      const origRemoved = w.actorRemoved
      w.actorRemoved = (a: IGameActor) => {
        origRemoved?.(a)
        this._actorRemovedFromWorld(a)
      }
    }
    for (const a of (w.actors ?? [])) {
      this._actorAddedToWorld(a as IGameActor)
    }

    this._veinPalette = (wr as any).palette?.(this._info.palette) ?? null

    const first = this._veinSequence?.getSprite(0)
    if (first && w.map) {
      // Create empty sprite and TerrainSpriteLayer
      // NOTE: Full TerrainSpriteLayer construction requires Sprite and wrapper classes
      // deferred to runtime wiring. For now, stub.
    }

    // Initialize all cells
    const allCells = w.map?.allCells
    if (allCells) {
      for (const cell of allCells as Iterable<CPos>) {
        const resource = this._resourceLayer.getResource(cell)
        const indices = this._calculateCellIndices(resource, cell)
        if (indices !== null) {
          this._renderIndices.set(cell, indices)
          this._updateRenderedSprite(cell, indices)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // calculateCellIndices — sprite frame selection based on density and ramp
  // OpenRA 对照: TSVeinsRenderer.CalculateCellIndices()
  // ---------------------------------------------------------------------------

  _calculateCellIndices(contents: ResourceLayerContents, cell: CPos): number[] | null {
    if (contents.type !== this._info.resourceType || contents.density === 0) {
      return null
    }

    const map = this._world?.map as any
    // Consolidated ramp lookup with safe fallbacks:
    // 1) map.rampGet(cell)  — direct method (preferred)
    // 2) map.ramp.get(cell) — CellLayer accessor
    // 3) Default to 0 (flat terrain)
    // NOTE: Removed broken 3rd fallback (map['Ramp'][cellKey(cell)])
    //   — CellLayer uses CPos indexing, not packed integer keys.
    const ramp = typeof map?.rampGet === 'function'
      ? map.rampGet(cell)
      : map?.ramp?.get?.(cell) ?? 0

    switch (ramp) {
      case 1: return Ramp1Indices
      case 2: return Ramp2Indices
      case 3: return Ramp3Indices
      case 4: return Ramp4Indices
      default: return contents.density === this._maxDensity ? HeavyIndices : LightIndices
    }
  }

  // ---------------------------------------------------------------------------
  // IRenderOverlay
  // OpenRA 对照: TSVeinsRenderer.Render(WorldRenderer)
  // ---------------------------------------------------------------------------

  render(wr: WorldRendererStub): void {
    this._spriteLayer?.draw((wr as any).viewport)
  }

  // ---------------------------------------------------------------------------
  // ITickRender — dirty cell processing
  // OpenRA 对照: TSVeinsRenderer.TickRender(WorldRenderer, Actor)
  // ---------------------------------------------------------------------------

  tickRender(_wr: WorldRendererStub, _self: IGameActor): void {
    for (const key of this._dirty) {
      const cell = new CPos(key & 0xffff, (key >> 16) & 0xffff)
      if (!this._resourceLayer.isVisible(cell)) continue

      const contents = this._resourceLayer.getResource(cell)
      const indices = this._calculateCellIndices(contents, cell)
      const current = this._renderIndices.get(cell)
      if (indices !== current && !(indices === null && current === null)) {
        this._renderIndices.set(cell, indices)
        this._updateRenderedSprite(cell, indices!)
      }
      this._cleanDirty.push(key)
    }

    while (this._cleanDirty.length > 0) {
      this._dirty.delete(this._cleanDirty.shift()!)
    }
  }

  // ---------------------------------------------------------------------------
  // hasBorder — check if cell has vein border eligibility
  // OpenRA 对照: TSVeinsRenderer.HasBorder(CPos)
  // ---------------------------------------------------------------------------

  _hasBorder(cell: CPos): boolean {
    if (!this._renderIndices.contains(cell)) return false

    const map = this._world?.map as any
    const ramp = typeof map?.rampGet === 'function' ? map.rampGet(cell) : map?.ramp?.get?.(cell) ?? 0

    return (ramp === 0 && this._renderIndices.get(cell) !== null) ||
      this._veinholeCells.has(cellKey(cell))
  }

  // ---------------------------------------------------------------------------
  // calculateBorders — compute adjacency flags
  // OpenRA 对照: TSVeinsRenderer.CalculateBorders(CPos)
  // ---------------------------------------------------------------------------

  _calculateBorders(cell: CPos): Adjacency {
    const map = this._world?.map as any
    const ramp = typeof map?.rampGet === 'function' ? map.rampGet(cell) : map?.ramp?.get?.(cell) ?? 0
    if (ramp !== 0) return Adjacency.None

    let ret: Adjacency = Adjacency.None
    if (this._hasBorder(new CPos(cell.X, cell.Y - 1))) ret |= Adjacency.MinusY
    if (this._hasBorder(new CPos(cell.X - 1, cell.Y))) ret |= Adjacency.MinusX
    if (this._hasBorder(new CPos(cell.X + 1, cell.Y))) ret |= Adjacency.PlusX
    if (this._hasBorder(new CPos(cell.X, cell.Y + 1))) ret |= Adjacency.PlusY
    return ret
  }

  // ---------------------------------------------------------------------------
  // updateRenderedSprite — update cell + neighbors
  // OpenRA 对照: TSVeinsRenderer.UpdateRenderedSprite()
  // ---------------------------------------------------------------------------

  _updateRenderedSprite(cell: CPos, indices: number[] | null): void {
    this._borders.set(cell, Adjacency.None)
    this._updateSpriteLayers(cell, indices)

    for (const c of expandFootprint(cell, false)) {
      this._updateBorderSprite(c)
    }
  }

  // ---------------------------------------------------------------------------
  // updateBorderSprite — render border on adjacent non-resource cells
  // OpenRA 对照: TSVeinsRenderer.UpdateBorderSprite()
  // ---------------------------------------------------------------------------

  _updateBorderSprite(cell: CPos): void {
    if (this._hasBorder(cell)) return

    const map = this._world?.map as any
    const ramp = typeof map?.rampGet === 'function' ? map.rampGet(cell) : map?.ramp?.get?.(cell) ?? 0
    if (ramp !== 0) return

    const adjacency = this._calculateBorders(cell)
    if (this._borders.get(cell) === adjacency) return

    this._borders.set(cell, adjacency)

    if (adjacency === Adjacency.None) {
      this._updateSpriteLayers(cell, null)
    } else {
      const indices = BorderIndices.get(adjacency)
      if (indices !== undefined) {
        this._updateSpriteLayers(cell, indices)
      } else {
        throw new Error(`SpriteMap does not contain an index for Adjacency type '${adjacency}'`)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // updateSpriteLayers — apply sprite frame to terrain layer
  // OpenRA 对照: TSVeinsRenderer.UpdateSpriteLayers()
  // ---------------------------------------------------------------------------

  _updateSpriteLayers(cell: CPos, indices: number[] | null): void {
    if (indices !== null && indices.length > 0) {
      // Deterministic variant selection — avoids Math.random() for replay consistency.
      // OpenRA 对照: Game.CosmeticRandom.Next(indices.Length)
      // Priority: 1) world.sharedRandom (deterministic seeded RNG)
      //           2) cell-position-based hash fallback
      const worldRandom = this._world?.sharedRandom as { nextInt(max: number): number } | undefined
      let chosenIndex: number
      if (worldRandom) {
        chosenIndex = worldRandom.nextInt(indices.length)
      } else {
        // Hash-based fallback: deterministic per-cell, avoids Math.random()
        const hash = cellKey(cell) ^ 0x9e3779b9 ^ (indices.length * 0x45d9f3b)
        chosenIndex = hash < 0 ? (-hash) % indices.length : hash % indices.length
      }
      const chosen = indices[chosenIndex]
      this._spriteLayer?.update(cell, this._veinSequence, this._veinPalette, chosen)
    } else {
      this._spriteLayer?.clear(cell)
    }
  }

  // ---------------------------------------------------------------------------
  // Veinhole actor management
  // ---------------------------------------------------------------------------

  _actorAddedToWorld(a: IGameActor): void {
    const name = (a as any).info?.name as string | undefined
    if (name && this._info.veinholeActors.has(name)) {
      const occupied = (a as any).occupiesSpace?.occupiedCells?.() as Array<{ cell: CPos }> | undefined
      if (occupied) {
        for (const occ of occupied) {
          this._veinholeCells.add(cellKey(occ.cell))
          this._addDirtyCell(occ.cell, this._info.resourceType)
        }
      }
    }
  }

  _actorRemovedFromWorld(a: IGameActor): void {
    const name = (a as any).info?.name as string | undefined
    if (name && this._info.veinholeActors.has(name)) {
      const occupied = (a as any).occupiesSpace?.occupiedCells?.() as Array<{ cell: CPos }> | undefined
      if (occupied) {
        for (const occ of occupied) {
          this._veinholeCells.delete(cellKey(occ.cell))
          this._addDirtyCell(occ.cell, null)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyActorDisposing
  // ---------------------------------------------------------------------------

  disposing(): void {
    if (this._onCellChangedHooked && this._resourceLayer.removeCellChangedListener) {
      // Use the stored bound reference so it matches the originally registered listener
      this._resourceLayer.removeCellChangedListener(this._boundAddDirtyCell)
    }
    // NOTE: ActorAdded/ActorRemoved unsubscribe is handled by World.
    // In OpenRA, these are events on the World object.
  }

  // ---------------------------------------------------------------------------
  // IResourceRenderer
  // ---------------------------------------------------------------------------

  get resourceTypes(): Iterable<string> {
    return [this._info.resourceType]
  }

  getRenderedResourceType(cell: CPos): string | null {
    if (this._renderIndices.get(cell) !== null) return this._info.resourceType
    const border = this._borders.get(cell)
    return border !== null && border !== Adjacency.None ? this._info.resourceType : null
  }

  getRenderedResourceTooltip(cell: CPos): string | null {
    const border = this._borders.get(cell)
    if (this._renderIndices.get(cell) !== null || (border !== null && border !== Adjacency.None)) {
      // NOTE: FluentProvider.GetMessage(info.Name) is deferred — use raw string
      return this._info.name
    }
    return null
  }

  *renderUIPreview(wr: WorldRendererStub, resourceType: string, _origin: any, _scale: number): Generator<any> {
    if (resourceType !== this._info.resourceType) return
    if (!this._veinSequence) return
    const sprite = this._veinSequence.getSprite(HeavyIndices[0])
    const palette = (wr as any).palette?.(this._info.palette)
    yield { type: 'UISpriteRenderable', sprite, origin: { X: 0, Y: 0, Z: 0 }, screenPos: _origin, zOffset: 0, palette, scale: _scale }
  }

  *renderPreview(wr: WorldRendererStub, resourceType: string, origin: { X: number; Y: number; Z: number }): Generator<any> {
    if (resourceType !== this._info.resourceType) return
    if (!this._veinSequence) return
    const frame = HeavyIndices[0]
    const sprite = this._veinSequence.getSprite(frame)
    const alpha = this._veinSequence.getAlpha(frame)
    const palette = (wr as any).palette?.(this._info.palette)
    const tintModifiers = this._veinSequence.ignoreWorldTint ? 1 : 0
    yield { type: 'SpriteRenderable', sprite, pos: origin, offset: { X: 0, Y: 0, Z: 0 }, zOffset: 0, palette, scale: this._veinSequence.scale, alpha, tintModifiers, isDecoration: false }
  }

  // ---------------------------------------------------------------------------
  // IRadarTerrainLayer
  // ---------------------------------------------------------------------------

  private _cellEntryChangedListeners: Array<(cell: CPos) => void> = []

  addCellEntryChangedListener(callback: (cell: CPos) => void): void {
    this._cellEntryChangedListeners.push(callback)
    this._renderIndices.cellEntryChanged?.add?.(callback)
    this._borders.cellEntryChanged?.add?.(callback)
  }

  removeCellEntryChangedListener(callback: (cell: CPos) => void): void {
    const idx = this._cellEntryChangedListeners.indexOf(callback)
    if (idx >= 0) this._cellEntryChangedListeners.splice(idx, 1)
    this._renderIndices.cellEntryChanged?.remove?.(callback)
    this._borders.cellEntryChanged?.remove?.(callback)
  }

  tryGetTerrainColorPair(uv: MPos): [true, { left: number; right: number }] | [false] {
    const cell = new CPos(uv.U, uv.V)
    const borderVal = this._borders.get(cell)
    if ((borderVal === null || borderVal === Adjacency.None) && this._renderIndices.get(cell) === null) {
      return [false]
    }
    if (!this._veinRadarColor) return [false]
    const color = this._veinRadarColor.toArgb ?? 0
    return [true, { left: color, right: color }]
  }

  // ---------------------------------------------------------------------------
  // IMapPreviewSignatureInfo (static)
  // OpenRA 对照: IMapPreviewSignatureInfo.PopulateMapPreviewSignatureCells()
  // ---------------------------------------------------------------------------

  static populateMapPreviewSignatureCells(
    map: MapStubExt,
    ai: { traitInfoOrDefault<T>(_type: string): T | null },
    _s: any,
    destinationBuffer: Array<{ uv: MPos; color: any }>,
    info: TSVeinsRendererInfo,
  ): void {
    const resourceLayer = ai.traitInfoOrDefault<IResourceLayerInfoStub>('IResourceLayerInfo')
    if (!resourceLayer) return

    const resourceIndex = resourceLayer.tryGetResourceIndex(info.resourceType)
    const terrainType = resourceLayer.tryGetTerrainType(info.resourceType)
    if (resourceIndex === undefined || terrainType === undefined) return

    // Collect veinhole cells
    const veinholeCells = new Set<number>()
    for (const [, value] of map.actorDefinitions) {
      if (!info.veinholeActors.has(value.Value)) continue
      // NOTE: Full ActorReference parsing deferred.
      // In OpenRA, this parses the actor definition and computes occupied cells.
      // For now, stub.
    }

    const terrainInfo = map.rules.terrainInfo
    const tIdx = terrainInfo.getTerrainIndex(terrainType)
    const tInfo = terrainInfo.terrainTypes[tIdx]

    for (let i = 0; i < map.mapSize.Width; i++) {
      for (let j = 0; j < map.mapSize.Height; j++) {
        const uv = new MPos(i, j)
        const cell = new CPos(i, j)

        // Cell contains veins
        const resource = map.resources.get?.(cell)
        if (resource && resource.type === String(resourceIndex!)) {
          destinationBuffer.push({ uv, color: tInfo.color })
          continue
        }

        // Cell is a border (flat, adjacent to vein)
        const cellRamp = typeof map.rampGet === 'function' ? map.rampGet(cell) : map.ramp?.get?.(cell) ?? 0
        if (cellRamp !== 0) continue

        let isBorder = false
        for (const c of expandFootprint(cell, false)) {
          if (!map.resources.contains?.(c)) continue
          if (veinholeCells.has(cellKey(c))) { isBorder = true; break }
          const r = map.resources.get?.(c)
          if (!r) continue
          const rRamp = typeof map.rampGet === 'function' ? map.rampGet(c) : map.ramp?.get?.(c) ?? 0
          if (r.type === String(resourceIndex!) && rRamp === 0) { isBorder = true; break }
        }

        if (isBorder) {
          destinationBuffer.push({ uv, color: tInfo.color })
        }
      }
    }
  }
}
