/**
 * LegacyBridgeLayer.ts — 模板驱动桥梁生成器 (template-based bridge actor creation)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/LegacyBridgeLayer.cs
 *
 * 核心范式转换:
 * - C# Dictionary<ushort, (string, int)> → TypeScript Map<number, BridgeTemplateEntry>
 * - C# ImmutableArray<string> → readonly string[]
 * - C# ITemplatedTerrainInfo → forward interface (not yet migrated)
 * - C# World.CreateActor() → forward interface (not yet migrated)
 * - C# BridgeInfo.Templates → forward interface (not yet migrated)
 * - C# Bridge.Create(tile, subTiles) → forward interface (not yet migrated)
 *
 * LegacyBridgeLayer generates bridge actors from tileset templates at map
 * load time. It scans the map for tiles matching bridge template IDs,
 * creates bridge actors, and links adjacent bridges for artwork continuity.
 *
 * NOTE: This depends on Bridge, BridgeInfo, and ITemplatedTerrainInfo
 * which have not been fully migrated yet. Forward interfaces are defined
 * here; full types will replace them when migrated.
 */

import { CPos } from '../../../OpenRA.Game/CPos'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import type { Size } from '../../../OpenRA.Game/Primitives/Size'
import type { IBridgeSegment } from './BridgeLayer'

// ---------------------------------------------------------------------------
// Forward interfaces — contracts from not-yet-migrated modules
// ---------------------------------------------------------------------------

/**
 * Bridge template configuration entry.
 *
 * OpenRA 对照: BridgeInfo.BridgeTemplate (inner class)
 */
export interface IBridgeTemplate {
  /** Template ID from the tileset. */
  readonly Template: number
  /** Health value for this template. */
  readonly Health: number
}

/**
 * Bridge info contract — provides bridge templates.
 *
 * OpenRA 对照: BridgeInfo (TraitInfo)
 *
* Replace with full BridgeInfo when Bridge trait is migrated.
 */
export interface IBridgeInfoStub {
  readonly templates: readonly IBridgeTemplate[]
}

/**
 * Templated terrain info interface — provides template lookup by ID.
 *
 * OpenRA 对照: ITemplatedTerrainInfo (OpenRA.Mods.Common/Terrain/ITemplatedTerrainInfo.cs)
 *
 * NOTE: This depends on TerrainTemplateInfo which hasn't been fully
 * migrated yet. Forward interface used for now.
 */
export interface ITemplatedTerrainInfo {
  templates: ReadonlyMap<number, ITerrainTemplate>
}

/**
 * Terrain template info — describes a tileset template.
 *
 * OpenRA 对照: TerrainTemplateInfo
 */
export interface ITerrainTemplate {
  readonly Size: { X: number; Y: number }
  readonly PickAny: boolean
}

/**
 * Tile info for a single cell on the map.
 *
 * OpenRA 对照: TerrainTile
 */
export interface ITerrainTile {
  /** Template ID (terrain type). */
  readonly Type: number
  /** Subtile index within the template. */
  readonly Index: number
}

/**
 * Bridge trait contract.
 *
 * OpenRA 对照: Bridge class (INotifyDamageStateChanged, etc.)
 *
* Replace with full Bridge trait when migrated.
 */
export interface IBridgeStub {
  linkNeighbouringBridges(layer: LegacyBridgeLayer): void
  create(tile: number, subTiles: ReadonlyMap<CPos, number>): void
}

/**
 * World contract for creating actors and looking up actors by trait.
 *
 * OpenRA 对照: World (subset)
 */
export interface ILegacyBridgeWorld {
  readonly map: ILegacyBridgeMap
  createActor(
    name: string,
    inits: readonly unknown[],
  ): { trait<T>(): T }
  actorsWithTrait<T>(): Iterable<{ trait: T; actor: unknown }>
}

/**
 * Map contract for tile access and iteration.
 *
 * OpenRA 对照: Map (subset)
 */
export interface ILegacyBridgeMap {
  readonly tiles: {
    get(cell: CPos): ITerrainTile
    contains(cell: CPos): boolean
  }
  readonly rules: {
    readonly actors: ReadonlyMap<string, { traitInfo<T>(): T }>
    readonly terrainInfo: ITemplatedTerrainInfo | null
  }
  readonly allCells: readonly CPos[]
  readonly gridType: MapGridType
  readonly mapSize: Size
}

// ---------------------------------------------------------------------------
// Bridge template entry
// ---------------------------------------------------------------------------

/** Internal entry for bridge template data.
 *
 * OpenRA 对照: (string Template, int Health) tuple in Dictionary
 */
interface BridgeTemplateEntry {
  template: string
  health: number
}

// ---------------------------------------------------------------------------
// LegacyBridgeLayerInfo
// 对应 OpenRA LegacyBridgeLayerInfo
// ---------------------------------------------------------------------------

/**
 * Configuration for the LegacyBridgeLayer.
 *
 * OpenRA 对照: LegacyBridgeLayerInfo (TraitInfo)
 */
export class LegacyBridgeLayerInfo {
  /**
   * Actor names for bridge types to overlay on the map.
   *
   * OpenRA 对照: LegacyBridgeLayerInfo.Bridges
   *
   * Default: ["bridge1", "bridge2"]
   */
  readonly Bridges: readonly string[]

  /** Optional instance name for trait disambiguation. */
  readonly instanceName?: string

  /**
   * Create a LegacyBridgeLayerInfo.
   *
   * @param opts — configuration options
   * @param opts.bridges — bridge actor type names
   * @param opts.instanceName — optional instance name
   */
  constructor(opts: {
    bridges?: readonly string[]
    instanceName?: string
  } = {}) {
    this.Bridges = opts.bridges ?? ['bridge1', 'bridge2']
    this.instanceName = opts.instanceName
  }

  /**
   * Create a LegacyBridgeLayer instance.
   *
   * OpenRA 对照: LegacyBridgeLayerInfo.Create(ActorInitializer)
   */
  create(world: ILegacyBridgeWorld): LegacyBridgeLayer {
    return new LegacyBridgeLayer(world, this)
  }
}

// ---------------------------------------------------------------------------
// LegacyBridgeLayer
// 对应 OpenRA LegacyBridgeLayer
// ---------------------------------------------------------------------------

/**
 * Generates bridge actors from tileset templates at map load time.
 *
 * OpenRA 对照: LegacyBridgeLayer (IWorldLoaded)
 *
 * Scans the map for tiles matching bridge template IDs, creates bridge
 * actors for them, and links neighbouring bridges for artwork continuity.
 *
 * NOTE: This depends on Bridge, BridgeInfo, and ITemplatedTerrainInfo
 * which are not fully migrated. The bridge actor creation is done through
 * forward interface contracts.
 */
export class LegacyBridgeLayer {
  /** Bridge template ID → (actor name, health) mapping. */
  private readonly bridgeTypes: Map<number, BridgeTemplateEntry>

  /** CellLayer mapping cells to Bridge actors. */
  private bridges!: CellLayer<IBridgeStub | null>

  /** Reference to the layer configuration. */
  private readonly info: LegacyBridgeLayerInfo

  /** Reference to the templated terrain info. */
  private readonly terrainInfo: ITemplatedTerrainInfo

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /**
   * Create a LegacyBridgeLayer.
   *
   * OpenRA 对照: LegacyBridgeLayer(Actor self, LegacyBridgeLayerInfo info)
   *
   * Validates that the map's terrain info supports templates.
   * Throws if the tileset does not use templates.
   *
   * @param world — the game world
   * @param info — layer configuration
   */
  constructor(world: ILegacyBridgeWorld, info: LegacyBridgeLayerInfo) {
    this.info = info
    this.bridgeTypes = new Map()

    const ti = world.map.rules.terrainInfo
    if (ti === null) {
      // NOTE: In OpenRA, this throws InvalidDataException.
      // In TypeScript, we throw a descriptive Error.
      throw new Error('LegacyBridgeLayer requires a template-based tileset.')
    }
    this.terrainInfo = ti
  }

  // -------------------------------------------------------------------------
  // WorldLoaded
  // -------------------------------------------------------------------------

  /**
   * Called when the world finishes loading.
   *
   * OpenRA 对照: LegacyBridgeLayer.WorldLoaded(World, WorldRenderer)
   *
   * Builds the bridge type lookup from bridge actor definitions,
   * scans the map for matching tiles, creates bridge actors, and
   * links adjacent bridges.
   *
   * @param w — the game world (matches world reference from constructor)
   */
  worldLoaded(w: ILegacyBridgeWorld): void {
    this.bridges = new CellLayer<IBridgeStub | null>(
      w.map.gridType,
      w.map.mapSize,
    )
    // Initialize all entries to null (matching C# default for reference types).
    this.bridges.clear(null)

    // Build a list of templates that should be overlaid with bridges
    for (const bridgeName of this.info.Bridges) {
      // Look up bridge actor info from world rules to auto-populate bridgeTypes
      const actorEntry = w.map.rules.actors.get(bridgeName)
      if (actorEntry) {
        // NOTE: traitInfo<T>() is a forward-interface generic method.
        // At runtime the type parameter is erased; cast to IBridgeInfoStub.
        const bi = actorEntry.traitInfo() as IBridgeInfoStub | undefined
        if (bi && bi.templates) {
          for (const template of bi.templates) {
            this.bridgeTypes.set(template.Template, {
              template: bridgeName,
              health: template.Health,
            })
          }
        }
      } else {
        // Bridge type not found in world rules — manual registerBridgeType()
        // is the fallback for test/configuration scenarios.
      }
    }

    // Take all templates to overlay from the map
    for (const cell of w.map.allCells) {
      const tileType = w.map.tiles.get(cell).Type
      if (this.bridgeTypes.has(tileType)) {
        this._convertBridgeToActor(w, cell)
      }
    }

    // Link adjacent (long)-bridges so that artwork is updated correctly
    for (const { trait } of w.actorsWithTrait<IBridgeStub>()) {
      trait.linkNeighbouringBridges(this)
    }
  }

  // -------------------------------------------------------------------------
  // bridgeType management (public for test/configuration)
  // -------------------------------------------------------------------------

  /**
   * Register a bridge template type.
   *
   * OpenRA 对照: bridgeTypes.Add(template.Template, (bridge, template.Health))
   *
   * @param templateId — tileset template ID
   * @param bridgeName — actor type name for the bridge
   * @param health — health value for the bridge
   */
  registerBridgeType(templateId: number, bridgeName: string, health: number): void {
    this.bridgeTypes.set(templateId, { template: bridgeName, health })
  }

  /**
   * Get the bridge type entry for a template ID.
   *
   * @param templateId — tileset template ID
   * @returns the bridge template entry, or undefined if not registered
   */
  getBridgeType(templateId: number): BridgeTemplateEntry | undefined {
    return this.bridgeTypes.get(templateId)
  }

  // -------------------------------------------------------------------------
  // GetBridge — cell-level bridge lookup
  // 对应 OpenRA LegacyBridgeLayer.GetBridge(CPos)
  // -------------------------------------------------------------------------

  /**
   * Get the Bridge trait at a cell position (for linking neighbours).
   *
   * OpenRA 对照: LegacyBridgeLayer.GetBridge(CPos)
   *
   * @param cell — the cell position
   * @returns the Bridge trait, or null if no bridge at this cell
   */
  getBridge(cell: CPos): IBridgeStub | null {
    if (!this.bridges.contains(cell)) return null
    return this.bridges.get(cell)
  }

  // -------------------------------------------------------------------------
  // Internal: ConvertBridgeToActor
  // 对应 OpenRA LegacyBridgeLayer.ConvertBridgeToActor(World, CPos)
  // -------------------------------------------------------------------------

  /**
   * Convert a bridge tile on the map to a bridge actor.
   *
   * OpenRA 对照: LegacyBridgeLayer.ConvertBridgeToActor(World, CPos)
   *
   * Finds the template origin, creates a bridge actor, identifies all
   * subtiles belonging to this bridge, and registers them in the CellLayer.
   *
   * @param w — the game world
   * @param cell — a cell that should have a bridge overlay
   */
  private _convertBridgeToActor(w: ILegacyBridgeWorld, cell: CPos): void {
    // This cell already has a bridge overlaying it from a previous iteration
    if (this.bridges.get(cell) !== null) return

    // Correlate the tile "image" aka subtile with its position to find the
    // template origin
    const ti = w.map.tiles.get(cell)
    const tile = ti.Type
    const index = ti.Index
    const template = this.terrainInfo.templates.get(tile)
    if (!template) return

    const ni = cell.X - (index % template.Size.X)
    const nj = cell.Y - Math.trunc(index / template.Size.X)

    // Get the bridge template entry
    const bridgeType = this.bridgeTypes.get(tile)
    if (!bridgeType) return

    // Create a new actor for this bridge
    // NOTE: In the full migration, this uses world.createActor() with
    // LocationInit, OwnerInit, and HealthInit. For now, the bridge is
    // created via forward interface contracts.
    const initCell = new CPos(ni, nj)
    const bridgeActor = w.createActor(bridgeType.template, [
      { type: 'LocationInit', value: initCell },
      { type: 'HealthInit', value: bridgeType.health },
    ])

    const bridge = bridgeActor.trait<IBridgeStub>()

    // Track which subtiles this bridge includes
    const subTiles = new Map<CPos, number>()
    const mapTiles = w.map.tiles

    // For each subtile in the template
    const totalSubtiles = template.Size.X * template.Size.Y
    for (let ind = 0; ind < totalSubtiles; ind++) {
      // Where do we expect to find the subtile
      const subtile = new CPos(
        ni + (ind % template.Size.X),
        nj + Math.trunc(ind / template.Size.X),
      )

      if (!mapTiles.contains(subtile)) continue

      // This isn't the bridge you're looking for
      const subti = mapTiles.get(subtile)
      if (subti.Type !== tile || subti.Index !== ind) continue

      subTiles.set(subtile, ind)
      this.bridges.set(subtile, bridge)
    }

    bridge.create(tile, subTiles)
  }
}

// Re-export types for tests
export type {
  IBridgeSegment,
}
