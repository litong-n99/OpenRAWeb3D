/**
 * D2kBuilding.ts — D2K 建筑特质的混凝土基础与地形损伤系统
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/Buildings/D2kBuilding.cs (162 lines)
 *
 * 核心范式转换:
 * - C# Building base class → TS Building (migrated, src/OpenRA.Mods.Common/Traits/Buildings/Building.ts)
 * - C# ITick + INotifyCreated → TS implements pattern
 * - C# BuildableTerrainLayer trait resolution → TS duck-typed trait lookup
 * - C# BitSet<DamageType> → TS Set<string>
 * - C# ImmutableArray<string> → TS readonly string[]
 * - C# Game.CosmeticRandom → TS random number generator
 * - C# ITemplatedTerrainInfo check → TS duck-typed check
 * - C# BuildingInfluence.GetBuildingsAt(cell) → TS duck-typed query
 * - C# Damage struct → TS { value, damageTypes }
 */

import { CVec } from '../../../OpenRA.Game/CVec.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Building, BuildingInfo, type IBuildingMap } from '../../../OpenRA.Mods.Common/Traits/Buildings/Building.js'
import type { BuildableTerrainLayer as BuildableTerrainLayerType } from '../World/BuildableTerrainLayer.js'
import type { TerrainTemplateInfo } from '../World/BuildableTerrainLayer.js'


// ---------------------------------------------------------------------------
// Minimal interfaces for unmigrated dependencies
// ---------------------------------------------------------------------------

/** Minimal IHealth interface. */
export interface IHealthMinimal {
  readonly maxHP: number
  readonly hp: number
  inflictDamage(self: IGameActor, attacker: IGameActor, damage: { value: number; damageTypes: ReadonlySet<string> }, ignoreModifiers?: boolean): void
}

/** Minimal TechTree interface. */
export interface ITechTreeMinimal {
  hasPrerequisites(prereqs: readonly string[]): boolean
}

/** Minimal BuildingInfluence interface. */
export interface IBuildingInfluenceMinimal {
  getBuildingsAt(cell: CPos): Iterable<IGameActor>
}

/** Minimal ITemplatedTerrainInfo interface. */
export interface ITemplatedTerrainInfoMinimal {
  readonly templates: ReadonlyMap<number, TerrainTemplateInfo>
}

// ---------------------------------------------------------------------------
// D2kBuildingInfo
// ---------------------------------------------------------------------------

/** Configuration for the D2K building trait.
 *
 * OpenRA 对照: D2kBuildingInfo : BuildingInfo
 */
export class D2kBuildingInfo extends BuildingInfo {
  readonly damage: number
  readonly damageInterval: number
  readonly damageTypes: ReadonlySet<string>
  readonly damageTerrainTypes: readonly string[]
  readonly damageThreshold: number
  readonly startOnThreshold: boolean
  readonly concreteTemplate: number
  readonly concretePrerequisites: readonly string[]

  constructor(params: {
    instanceName?: string
    terrainTypes?: ReadonlySet<string> | readonly string[]
    footprint?: ReadonlyMap<string, string>
    dimensions?: CVec
    localCenterOffset?: { x: number; y: number; z: number }
    requiresBaseProvider?: boolean
    allowInvalidPlacement?: boolean
    removeSmudgesOnBuild?: boolean
    removeSmudgesOnSell?: boolean
    removeSmudgesOnTransform?: boolean
    buildSounds?: readonly string[]
    undeploySounds?: readonly string[]
    damage?: number
    damageInterval?: number
    damageTypes?: readonly string[]
    damageTerrainTypes?: readonly string[]
    damageThreshold?: number
    startOnThreshold?: boolean
    concreteTemplate?: number
    concretePrerequisites?: readonly string[]
  } = {}) {
    // Convert footprint string values to FootprintCellType for base class
    const buildingParams: {
      instanceName?: string
      terrainTypes?: ReadonlySet<string> | readonly string[]
      footprint?: ReadonlyMap<string, string>
      dimensions?: CVec
      localCenterOffset?: { x: number; y: number; z: number }
      requiresBaseProvider?: boolean
      allowInvalidPlacement?: boolean
      removeSmudgesOnBuild?: boolean
      removeSmudgesOnSell?: boolean
      removeSmudgesOnTransform?: boolean
      buildSounds?: readonly string[]
      undeploySounds?: readonly string[]
    } = {}

    for (const key of Object.keys(params) as (keyof typeof params)[]) {
      if (key !== 'damage' && key !== 'damageInterval' && key !== 'damageTypes' &&
          key !== 'damageTerrainTypes' && key !== 'damageThreshold' && key !== 'startOnThreshold' &&
          key !== 'concreteTemplate' && key !== 'concretePrerequisites') {
        ;(buildingParams as Record<string, unknown>)[key] = params[key]
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(buildingParams as any)

    this.damage = params.damage ?? 500
    this.damageInterval = params.damageInterval ?? 100
    this.damageTypes = new Set(params.damageTypes ?? [])
    this.damageTerrainTypes = params.damageTerrainTypes ?? ['Rock']
    this.damageThreshold = params.damageThreshold ?? 50
    this.startOnThreshold = params.startOnThreshold ?? true
    this.concreteTemplate = params.concreteTemplate ?? 88
    this.concretePrerequisites = params.concretePrerequisites ?? []
  }
}

// ---------------------------------------------------------------------------
// D2kBuilding
// ---------------------------------------------------------------------------

/** D2K building trait — adds concrete slab placement and terrain damage
 * to the base Building trait.
 */
export class D2kBuilding extends Building {
  readonly d2kInfo: D2kBuildingInfo

  private _layer: BuildableTerrainLayerType | null = null
  private _health: IHealthMinimal | null = null
  private _safeTiles: number = 0
  private _totalTiles: number = 0
  private _dmgThreshold: number = 0
  private _damageTicks: number = 0
  private _techTree: ITechTreeMinimal | null = null
  private _d2kBuildingInf: IBuildingInfluenceMinimal | null = null

  constructor(
    info: D2kBuildingInfo,
    topLeft: CPos,
    map: IBuildingMap,
  ) {
    super(info, topLeft, map)
    this.d2kInfo = info
  }

  // -----------------------------------------------------------------------
  // Created (对应 OpenRA INotifyCreated.Created)
  // -----------------------------------------------------------------------

  created(self: IGameActor): void {
    const w = self.world as unknown as {
      worldActor?: IGameActor
    }

    this._health = (self as unknown as Record<string, unknown>)['Health'] as IHealthMinimal | undefined ?? null

    this._layer = w.worldActor
      ? ((w.worldActor as unknown as Record<string, unknown>)['BuildableTerrainLayer'] as BuildableTerrainLayerType | undefined) ?? null
      : null

    this._d2kBuildingInf = w.worldActor
      ? ((w.worldActor as unknown as Record<string, unknown>)['BuildingInfluence'] as IBuildingInfluenceMinimal | undefined) ?? null
      : null

    const owner = self.owner as unknown as { playerActor?: IGameActor }
    this._techTree = owner.playerActor
      ? ((owner.playerActor as unknown as Record<string, unknown>)['TechTree'] as ITechTreeMinimal | undefined) ?? null
      : null
  }

  // -----------------------------------------------------------------------
  // AddedToWorld (对应 OpenRA D2kBuilding.AddedToWorld)
  // -----------------------------------------------------------------------

  /** Called when the building is added to the world.
   *
   * 1. Calls base class AddedToWorld
   * 2. Places concrete foundation tiles
   * 3. Computes safe/unsafe tile counts
   * 4. Optionally applies initial threshold damage
   */
  // NOTE: shadows base class _addedToWorld; cannot use 'override' due to
  // bundler module resolution limitations with protected cross-module overrides.
  protected _addedToWorld(self: IGameActor): void {
    // Call base class implementation
    super._addedToWorld(self)

    const info = this.d2kInfo
    const layer = this._layer
    const tl = this.topLeft

    // Place concrete foundation tiles
    if (layer) {
      const shouldPlaceConcrete =
        info.concretePrerequisites.length === 0 ||
        this._techTree === null ||
        this._techTree.hasPrerequisites(info.concretePrerequisites)

      if (shouldPlaceConcrete) {
        const worldMap = (self.world as unknown as {
          map: {
            contains: (cell: CPos) => boolean
            customTerrain: Record<number, number>
            rules: {
              terrainInfo: {
                getTerrainInfo: (cell: CPos) => { type: string }
                templates?: Map<number, TerrainTemplateInfo>
              }
            }
            gridsize: { X: number; Y: number }
          }
        }).map

        const terrainInfo = worldMap.rules.terrainInfo as unknown as ITemplatedTerrainInfoMinimal
        const gridSize = worldMap.gridsize

        if (!terrainInfo.templates) {
          console.warn('D2kBuilding: No template-based terrain info available for concrete placement.')
          return
        }

        const template = terrainInfo.templates.get(info.concreteTemplate)
        if (!template) return

        // Helper to compute mpos index
        const mposIdx = (c: CPos): number => {
          const uv = c.toMPos(MapGridType.Rectangular)
          return uv.U + uv.V * gridSize.X
        }

        if (template.pickAny) {
          for (const cell of info.tiles(tl)) {
            if (!worldMap.contains(cell)) continue
            if ((worldMap.customTerrain[mposIdx(cell)] ?? 255) !== 255) continue
            if (!info.terrainTypes.has(worldMap.rules.terrainInfo.getTerrainInfo(cell).type)) continue

            const existingBuildings = this._d2kBuildingInf?.getBuildingsAt(cell)
            if (existingBuildings) {
              let blocked = false
              for (const a of existingBuildings) {
                if (a !== self) { blocked = true; break }
              }
              if (blocked) continue
            }

            const cosmeticRandom = (self.world as unknown as { cosmeticRandom?: { next: (min: number, max: number) => number } }).cosmeticRandom
            const tileIndex = cosmeticRandom
              ? cosmeticRandom.next(0, template.tilesCount - 1)
              : Math.trunc(Math.random() * template.tilesCount)

            layer.addTile(cell, { templateId: template.id, index: tileIndex })
          }
        } else {
          for (let i = 0; i < template.tilesCount; i++) {
            const offset = new CVec(i % template.size.X, Math.trunc(i / template.size.X))
            const cell = CPos.add(tl, offset)

            if (!worldMap.contains(cell)) continue
            if ((worldMap.customTerrain[mposIdx(cell)] ?? 255) !== 255) continue
            if (!info.terrainTypes.has(worldMap.rules.terrainInfo.getTerrainInfo(cell).type)) continue

            const existingBuildings = this._d2kBuildingInf?.getBuildingsAt(cell)
            if (existingBuildings) {
              let blocked = false
              for (const a of existingBuildings) {
                if (a !== self) { blocked = true; break }
              }
              if (blocked) continue
            }

            layer.addTile(cell, { templateId: template.id, index: i })
          }
        }
      }
    }

    // Compute terrain damage threshold
    if (this._health === null) return

    const selfTyped = self as unknown as { occupiesSpace?: { occupiedCells: () => readonly { cell: CPos }[] } }
    const occupied = selfTyped.occupiesSpace?.occupiedCells?.() ?? info.occupiedTiles(tl).map(c => ({ cell: c }))

    for (const entry of occupied) {
      this._totalTiles++
      const cellType = ((self.world as unknown as {
        map: { getTerrainInfo: (cell: CPos) => { type: string } }
      }).map.getTerrainInfo(entry.cell).type)

      if (!info.damageTerrainTypes.includes(cellType)) {
        this._safeTiles++
      }
    }

    if (this._totalTiles === 0 || this._totalTiles === this._safeTiles) return

    const h = this._health
    this._dmgThreshold = Math.trunc(
      (info.damageThreshold * h.maxHP +
        (100 - info.damageThreshold) * this._safeTiles * h.maxHP / this._totalTiles) /
      100,
    )

    if (!info.startOnThreshold) return

    // Start with maximum damage applied
    const delta = h.hp - this._dmgThreshold
    if (delta > 0) {
      const dmgTypes: ReadonlySet<string> = info.damageTypes
      h.inflictDamage(
        self,
        (self.world as unknown as { worldActor: IGameActor }).worldActor,
        { value: delta, damageTypes: dmgTypes },
        true,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Tick (对应 OpenRA ITick.Tick)
  // -----------------------------------------------------------------------

  tick(self: IGameActor): void {
    if (
      this._totalTiles === this._safeTiles ||
      (this._health?.hp ?? 0) <= this._dmgThreshold ||
      --this._damageTicks > 0
    ) {
      return
    }

    const dmgTypes: ReadonlySet<string> = this.d2kInfo.damageTypes
    this._health?.inflictDamage(
      self,
      (self.world as unknown as { worldActor: IGameActor }).worldActor,
      { value: this.d2kInfo.damage, damageTypes: dmgTypes },
      true,
    )
    this._damageTicks = this.d2kInfo.damageInterval
  }

  // -----------------------------------------------------------------------
  // Accessors (for testing)
  // -----------------------------------------------------------------------

  get damageThreshold(): number { return this._dmgThreshold }
  get safeTiles(): number { return this._safeTiles }
  get totalTiles(): number { return this._totalTiles }
  get layer(): BuildableTerrainLayerType | null { return this._layer }
}
