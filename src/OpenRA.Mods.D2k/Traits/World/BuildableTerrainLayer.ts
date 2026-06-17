/**
 * BuildableTerrainLayer.ts — D2K 可建造地形层（混凝土板）
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/World/BuildableTerrainLayer.cs (155 lines)
 *
 * 核心范式转换:
 * - C# IRenderOverlay + ITiledTerrainRenderer + IWorldLoaded + ITickRender
 *   + IRadarTerrainLayer + INotifyActorDisposing
 *   → TS unified class implementing equivalent interfaces
 * - C# TerrainSpriteLayer (CPU vertex update + draw)
 *   → TS TerrainSpriteLayer (already migrated, same interface)
 * - C# CellLayer<int> strength + CellLayer<(Color,Color)> radarColor
 *   → TS Map<number, number> + Map<number, {left,right}>
 *   (simplified: using mpos index instead of CellLayer)
 * - C# dirty Dictionary<CPos, TerrainTile?> → TS dirty Map<string, TerrainTile?>
 * - C# world.FogObscures(cell) → TS fog-of-war check stub (TODO-19.B.8)
 * - C# ITiledTerrainRenderer.TileSprite(tile) → TS duck-typed tile renderer
 *
 * BuildableTerrainLayer manages the concrete slab layer — terrain tiles
 * placed under buildings that can be damaged by weapons. Buildings can
 * only be placed on terrain where concrete coverage is sufficient.
 */

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Forward interfaces for unmigrated dependencies
// ---------------------------------------------------------------------------

/** Minimal ITiledTerrainRenderer interface.
 *
 * OpenRA 对照: ITiledTerrainRenderer
 */
export interface ITiledTerrainRendererMinimal {
  readonly missingTile: unknown
  tileSprite(tile: TerrainTile): unknown
}

/** Minimal TerrainSpriteLayer interface.
 *
 * OpenRA 对照: TerrainSpriteLayer (from OpenRA.Game/Graphics)
 */
export interface ITerrainSpriteLayerMinimal {
  update(cell: { X: number; Y: number }, sprite: unknown, paletteRef: unknown): void
  clear(cell: { X: number; Y: number }): void
  draw(viewport: unknown): void
  dispose(): void
}

/** Minimal IPaletteRef interface.
 *
 * OpenRA 对照: PaletteReference
 */
export interface IPaletteRefMinimal {
  readonly name: string
}

/** Minimal WorldRenderer interface.
 *
 * OpenRA 对照: WorldRenderer.Palette(string)
 */
export interface IWorldRendererMinimal {
  palette(name: string): IPaletteRefMinimal
  viewport: unknown
}

/** Minimal map interface.
 *
 * OpenRA 对照: Map (subset)
 */
export interface IMapMinimal {
  contains(cell: { X: number; Y: number }): boolean
  customTerrain: Uint8Array | { [mpos: number]: number }
  getTerrainInfo?(cell: CPos): { type: string; targetTypes?: Set<string> }
  rules: {
    terrainInfo: {
      getTerrainInfo(tile: TerrainTile): { terrainType: number; type: string; getColor?: (random: { next: (min: number, max: number) => number }) => { left: { r: number; g: number; b: number; a: number }; right: { r: number; g: number; b: number; a: number } } }
      templates?: Map<number, TerrainTemplateInfo>
    }
  }
  readonly gridsize: { X: number; Y: number }
}

/** Minimal TerrainTemplateInfo.
 *
 * OpenRA 对照: ITemplatedTerrainInfo.TerrainTemplateInfo
 */
export interface TerrainTemplateInfo {
  readonly id: number
  readonly pickAny: boolean
  readonly tilesCount: number
  readonly size: { X: number; Y: number }
}

/** A terrain tile with template ID and index.
 *
 * OpenRA 对照: TerrainTile
 */
export interface TerrainTile {
  readonly templateId: number
  readonly index: number
}

// ---------------------------------------------------------------------------
// BuildableTerrainLayerInfo
// ---------------------------------------------------------------------------

/** Configuration for the buildable terrain layer.
 *
 * OpenRA 对照: BuildableTerrainLayerInfo : TraitInfo, Requires<ITiledTerrainRendererInfo>
 */
export class BuildableTerrainLayerInfo {
  readonly instanceName?: string

  /** Palette to render the layer sprites in.
   *
   * OpenRA 对照: BuildableTerrainLayerInfo.Palette
   */
  readonly palette: string

  /** The hitpoints of each concrete slab (reduced by DamagesConcreteWarhead).
   *
   * OpenRA 对照: BuildableTerrainLayerInfo.MaxStrength
   */
  readonly maxStrength: number

  constructor(params: {
    instanceName?: string
    palette?: string
    maxStrength?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.palette = params.palette ?? 'terrain'
    this.maxStrength = params.maxStrength ?? 9000
  }

  /** Create the runtime trait instance.
   *
   * OpenRA 对照: BuildableTerrainLayerInfo.Create(ActorInitializer init)
   */
  create(init: { self: IGameActor }): BuildableTerrainLayer {
    return new BuildableTerrainLayer(init.self, this)
  }
}

// ---------------------------------------------------------------------------
// BuildableTerrainLayer
// ---------------------------------------------------------------------------

/** Manages the concrete slab terrain layer for D2K buildings.
 *
 * OpenRA 对照: BuildableTerrainLayer
 *
 * Attach to the WorldActor. D2kBuilding calls AddTile() when placed.
 * DamagesConcreteWarhead calls HitTile() to damage concrete.
 * The layer renders concrete tiles updated each tick-render.
 */
export class BuildableTerrainLayer {
  readonly info: BuildableTerrainLayerInfo

  private readonly _world: {
    map: IMapMinimal
    fogObscures?: (cell: CPos) => boolean
    localRandom?: { next: (min: number, max: number) => number }
    worldActor?: IGameActor
    actorMap?: { getActorsAt: (cell: CPos) => Iterable<IGameActor> }
  }

  /** Concrete strength per cell (indexed by mpos). */
  private readonly _strength: Map<number, number> = new Map()

  /** Radar color per cell (indexed by mpos). */
  private readonly _radarColor: Map<number, { left: number; right: number }> = new Map()

  /** Dirty tile updates pending rendering (keyed by cell string). */
  private readonly _dirty: Map<string, TerrainTile | null> = new Map()

  /** The terrain sprite layer for rendering. */
  private _render: ITerrainSpriteLayerMinimal | null = null

  /** The palette reference for rendering. */
  private _paletteRef: IPaletteRefMinimal | null = null

  /** The tiled terrain renderer. */
  private _terrainRenderer: ITiledTerrainRendererMinimal | null = null

  /** Whether this layer has been disposed. */
  private _disposed: boolean = false

  /** Resolve cell to mpos index. */
  private _mposIndex(cell: CPos, gridSize: { X: number; Y: number }): number {
    const uv = cell.toMPos(MapGridType.Rectangular)
    return uv.U + uv.V * gridSize.X
  }

  constructor(self: IGameActor, info: BuildableTerrainLayerInfo) {
    this.info = info

    const w = self.world as unknown as {
      map: IMapMinimal
      fogObscures?: (cell: CPos) => boolean
      localRandom?: { next: (min: number, max: number) => number }
      worldActor?: IGameActor
      actorMap?: { getActorsAt: (cell: CPos) => Iterable<IGameActor> }
    }
    this._world = w
    this._terrainRenderer = (
      w.worldActor as unknown as Record<string, unknown>
    )?.['TiledTerrainRenderer'] as ITiledTerrainRendererMinimal | undefined ?? null
  }

  // -----------------------------------------------------------------------
  // WorldLoaded (对应 OpenRA IWorldLoaded.WorldLoaded)
  // -----------------------------------------------------------------------

  /** Initialize after the world is fully loaded.
   *
   * OpenRA 对照: IWorldLoaded.WorldLoaded(World w, WorldRenderer wr)
   *
   * Creates the TerrainSpriteLayer and resolves the palette reference.
   *
   * @param _w — the game world
   * @param wr — the world renderer
   */
  worldLoaded(_w: unknown, wr: IWorldRendererMinimal): void {
    if (!this._terrainRenderer) return

    // Create TerrainSpriteLayer
    // TODO-19.B.8: Full TerrainSpriteLayer construction (needs world + worldRenderer + missing tile + blend mode)
    // render = new TerrainSpriteLayer(w, wr, terrainRenderer.MissingTile, BlendMode.Alpha, true)
    this._paletteRef = wr.palette(this.info.palette)
  }

  // -----------------------------------------------------------------------
  // AddTile (对应 OpenRA BuildableTerrainLayer.AddTile)
  // -----------------------------------------------------------------------

  /** Place a concrete slab tile at the given cell.
   *
   * OpenRA 对照: BuildableTerrainLayer.AddTile(CPos cell, TerrainTile tile)
   *
   * @param cell — the cell to add concrete to
   * @param tile — the terrain tile (template ID + index)
   */
  addTile(cell: CPos, tile: TerrainTile): void {
    const map = this._world.map
    const mposIdx = this._mposIndex(cell, map.gridsize)

    // Check bounds
    if (!map.contains(cell)) return

    const tileInfo = map.rules.terrainInfo.getTerrainInfo(tile)
    if (map.customTerrain instanceof Uint8Array) {
      map.customTerrain[mposIdx] = tileInfo.terrainType
    } else if (typeof map.customTerrain === 'object') {
      ;(map.customTerrain as Record<number, number>)[mposIdx] = tileInfo.terrainType
    }

    this._strength.set(mposIdx, this.info.maxStrength)

    // Store radar color
    const random = this._world.localRandom
    if (random && tileInfo.getColor) {
      const color = tileInfo.getColor(random)
      this._radarColor.set(mposIdx, {
        left: (color.left.r << 24) | (color.left.g << 16) | (color.left.b << 8) | color.left.a,
        right: (color.right.r << 24) | (color.right.g << 16) | (color.right.b << 8) | color.right.a,
      })
    }

    this._dirty.set(`${cell.X},${cell.Y}`, tile)
  }

  // -----------------------------------------------------------------------
  // HitTile (对应 OpenRA BuildableTerrainLayer.HitTile)
  // -----------------------------------------------------------------------

  /** Apply damage to a concrete tile.
   *
   * OpenRA 对照: BuildableTerrainLayer.HitTile(CPos cell, int damage)
   *
   * Buildings block damage to cells under their footprint.
   * If strength drops below 1, the tile is removed.
   *
   * @param cell — the cell to damage
   * @param damage — the amount of damage to apply
   */
  hitTile(cell: CPos, damage: number): void {
    const map = this._world.map
    const mposIdx = this._mposIndex(cell, map.gridsize)

    if (!map.contains(cell)) return

    const currentStrength = this._strength.get(mposIdx) ?? 0
    if (currentStrength === 0) return

    // Buildings block damage to cells under their footprint
    const actors = this._world.actorMap?.getActorsAt(cell)
    if (actors) {
      for (const a of actors) {
        if ((a as unknown as Record<string, unknown>)['Building']) {
          return // Blocked by building
        }
      }
    }

    const newStrength = currentStrength - damage
    this._strength.set(mposIdx, newStrength)

    if (newStrength < 1) {
      this.removeTile(cell)
    }
  }

  // -----------------------------------------------------------------------
  // RemoveTile (对应 OpenRA BuildableTerrainLayer.RemoveTile)
  // -----------------------------------------------------------------------

  /** Remove a concrete tile from the given cell.
   *
   * OpenRA 对照: BuildableTerrainLayer.RemoveTile(CPos cell)
   *
   * Restores the cell to its original terrain and clears the concrete state.
   *
   * @param cell — the cell to remove concrete from
   */
  removeTile(cell: CPos): void {
    const map = this._world.map
    const mposIdx = this._mposIndex(cell, map.gridsize)

    if (!map.contains(cell)) return

    // Restore default terrain
    if (map.customTerrain instanceof Uint8Array) {
      map.customTerrain[mposIdx] = 255
    } else if (typeof map.customTerrain === 'object') {
      ;(map.customTerrain as Record<number, number>)[mposIdx] = 255
    }

    this._strength.set(mposIdx, 0)
    this._radarColor.delete(mposIdx)
    this._dirty.set(`${cell.X},${cell.Y}`, null)
  }

  // -----------------------------------------------------------------------
  // TickRender (对应 OpenRA ITickRender.TickRender)
  // -----------------------------------------------------------------------

  /** Process dirty tile updates during the render tick.
   *
   * OpenRA 对照: ITickRender.TickRender(WorldRenderer wr, Actor self)
   *
   * Only updates tiles that are not obscured by fog of war.
   * Clears dirty entries after processing.
   */
  tickRender(_wr: { viewport?: unknown }): void {
    const remove: string[] = []
    for (const [cellKey, tile] of this._dirty) {
      const [sx, sy] = cellKey.split(',')
      const cell = new CPos(Number(sx), Number(sy))

      if (this._world.fogObscures?.(cell)) continue
      if (!this._render || !this._terrainRenderer) continue

      if (tile !== null) {
        const sprite = this._terrainRenderer.tileSprite(tile)
        this._render.update(cell, sprite, this._paletteRef)
      } else {
        this._render.clear(cell)
      }

      remove.push(cellKey)
    }

    for (const key of remove) {
      this._dirty.delete(key)
    }
  }

  // -----------------------------------------------------------------------
  // Render (对应 OpenRA IRenderOverlay.Render)
  // -----------------------------------------------------------------------

  /** Render the concrete layer overlay.
   *
   * OpenRA 对照: IRenderOverlay.Render(WorldRenderer wr)
   *
   * @param wr — the world renderer
   */
  render(wr: { viewport: unknown }): void {
    this._render?.draw(wr.viewport)
  }

  // -----------------------------------------------------------------------
  // Radar / CellEntryChanged
  // -----------------------------------------------------------------------

  /** Try to get radar terrain colors for a map position.
   *
   * OpenRA 对照: IRadarTerrainLayer.TryGetTerrainColorPair(MPos, out value)
   *
   * @param uv — the map position
   * @returns color pair and success flag
   */
  tryGetTerrainColorPair(uv: { u: number; v: number }, gridSize: { X: number; Y: number }): {
    left: number; right: number; hasValue: boolean
  } {
    const idx = uv.v * gridSize.X + uv.u
    const color = this._radarColor.get(idx)
    if (color !== undefined) {
      return { left: color.left, right: color.right, hasValue: true }
    }
    return { left: 0, right: 0, hasValue: false }
  }

  /** Check if a cell has concrete.
   *
   * @param cell — the cell to check
   * @returns true if the cell has concrete (strength > 0)
   */
  hasConcrete(cell: CPos): boolean {
    const mposIdx = this._mposIndex(cell, this._world.map.gridsize)
    return (this._strength.get(mposIdx) ?? 0) > 0
  }

  /** Get the concrete strength at a cell.
   *
   * @param cell — the cell to check
   * @returns the current strength (0 = no concrete)
   */
  getStrength(cell: CPos): number {
    const mposIdx = this._mposIndex(cell, this._world.map.gridsize)
    return this._strength.get(mposIdx) ?? 0
  }

  // -----------------------------------------------------------------------
  // Disposing (对应 OpenRA INotifyActorDisposing.Disposing)
  // -----------------------------------------------------------------------

  /** Dispose of this layer's resources.
   *
   * OpenRA 对照: INotifyActorDisposing.Disposing(Actor self)
   */
  disposing(_self: IGameActor): void {
    if (this._disposed) return
    this._disposed = true
    this._render?.dispose()
    this._render = null
    this._strength.clear()
    this._radarColor.clear()
    this._dirty.clear()
  }

  /** Whether this layer has been disposed. */
  get isDisposed(): boolean {
    return this._disposed
  }
}
