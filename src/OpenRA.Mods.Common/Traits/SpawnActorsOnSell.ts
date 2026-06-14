/**
 * SpawnActorsOnSell.ts — 出售建筑时生成单位（兵营出售产生步兵 / 矿场出售产生矿车等）
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SpawnActorsOnSell.cs (143 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<SpawnActorsOnSellInfo>, INotifySold
 *   → TS ConditionalTrait<SpawnActorsOnSellInfo> implements INotifySold
 * - C# self.World.AddFrameEndTask(w => w.CreateActor(...))
 *   → TS duck-typed world.addFrameEndTask / createActor
 * - C# FrozenSet<string> Factions → TS Set<string>
 * - C# ImmutableArray<string> ActorTypes / GuaranteedActorTypes → TS readonly string[]
 * - C# buildingInfo.Tiles(self.Location).ToList() → TS duck-typed BuildingInfo.tiles()
 * - C# Random selection via SharedRandom → TS duck-typed sharedRandom with Math.random() fallback
 * - C# Rules.Actors[a].TraitInfoOrDefault<ValuedInfo>() → TS duck-typed ruleset lookup
 * - C# IHealth.HP / MaxHP → TS duck-typed IHealth.hp / maxHP
 */

import { CPos } from '../../OpenRA.Game/CPos.js'
import {
  ConditionalTrait,
  type IGameActor,
  type INotifySold,
  type ConditionalTraitInfo,
  type PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Forward interfaces for duck-typed access
// ---------------------------------------------------------------------------

/** SharedRandom stub — duck-typed MersenneTwister accessor.
 *
 * OpenRA 对照: OpenRA.Support/MersenneTwister.cs
 */
interface SharedRandomStub {
  /** Return a random integer in range [min, max).
   *
   * OpenRA 对照: MersenneTwister.Next(int minValue, int maxValue)
   */
  next(min: number, max: number): number
}

/** IHealth duck-typed accessor.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Health.cs (IHealth)
 */
interface IHealthAccess {
  readonly hp: number
  readonly maxHP: number
}

/** BuildingInfo duck-typed accessor — for getting the tiles covered by a building.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BuildingInfo.cs
 *
 * TODO-11: Replace with full BuildingInfo class when Chapter 11 Building System is migrated.
 */
interface BuildingInfoStub {
  /** Get all cell positions covered by the building when its top-left is at the given position.
   *
   * OpenRA 对照: BuildingInfo.Tiles(CPos topLeft)
   */
  tiles(topLeft: CPos): CPos[]
}

/** ValuedInfo duck-typed accessor — for getting an actor type's cost from the ruleset.
 *
 * OpenRA 对照: ValuedInfo.Cost
 */
interface ValuedInfoStub {
  readonly cost: number
}

/** Ruleset actors type — duck-typed lookup table for actor definitions.
 *
 * OpenRA 对照: OpenRA.Game/Map/Ruleset.Actors
 */
interface RulesetActorsStub {
  [actorName: string]: {
    traitInfoOrDefault?: (name: string) => ValuedInfoStub | undefined
  } | undefined
}

/** World duck-typed for actor creation.
 *
 * OpenRA 对照: World.AddFrameEndTask + World.CreateActor
 */
interface WorldDuck {
  /** Get the shared random number generator.
   *
   * OpenRA 对照: World.SharedRandom
   */
  sharedRandom?: SharedRandomStub

  /** Queue an action to execute at the end of the current frame.
   *
   * OpenRA 对照: World.AddFrameEndTask(Action<World>)
   */
  addFrameEndTask?(action: (w: WorldDuck) => void): void

  /** Create a new actor in the world.
   *
   * OpenRA 对照: World.CreateActor(string name, TypeDictionary init)
   */
  createActor?(name: string, inits: unknown[]): void

  /** The map data.
   *
   * OpenRA 对照: World.Map
   */
  map?: {
    rules: {
      actors: RulesetActorsStub
    }
  }
}

// ---------------------------------------------------------------------------
// Owner duck-typed accessor for faction check
// ---------------------------------------------------------------------------

/** Duck-typed owner with faction info.
 *
 * OpenRA 对照: Player.Faction.InternalName
 */
interface OwnerWithFaction extends PlayerStub {
  faction?: {
    internalName?: string
  }
}

// ---------------------------------------------------------------------------
// LocationInit / OwnerInit forward stubs
// (mirrors OpenRA's initializer dictionary pattern)
// ---------------------------------------------------------------------------

/** Location initializer for actor creation.
 *
 * OpenRA 对照: LocationInit : ActorInit
 */
interface LocationInit {
  readonly type: 'LocationInit'
  readonly value: CPos
}

/** Owner initializer for actor creation.
 *
 * OpenRA 对照: OwnerInit : ActorInit
 */
interface OwnerInit {
  readonly type: 'OwnerInit'
  readonly value: PlayerStub
}

// ---------------------------------------------------------------------------
// SpawnActorsOnSellInfo — trait configuration
// OpenRA 对照: SpawnActorsOnSellInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for SpawnActorsOnSell trait.
 *
 * OpenRA 对照: SpawnActorsOnSellInfo
 *
 * Controls what actors are spawned when the owning building is sold and
 * under what conditions spawning occurs.
 */
export class SpawnActorsOnSellInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Percentage of the building's sell value used as the "budget" for spawning actors.
   *
   * OpenRA 对照: SpawnActorsOnSellInfo.ValuePercent (default 40)
   */
  readonly valuePercent: number = 40

  /** Minimum health percentage (as integer 0-100) for the building to spawn actors.
   *
   * OpenRA 对照: SpawnActorsOnSellInfo.MinHpPercent (default 30)
   *
   * If the building's health is below this percentage of max HP, no actors
   * will be spawned (dudesValue = 0).
   */
  readonly minHpPercent: number = 30

  /** Actor types to randomly spawn on sell.
   *
   * OpenRA 对照: SpawnActorsOnSellInfo.ActorTypes (ImmutableArray<string>, Required)
   *
   * Each spawned actor's cost is deducted from the value budget. Spawning
   * continues as long as budget remains and eligible locations exist.
   * Types are selected randomly from those whose cost fits within the remaining budget.
   */
  readonly actorTypes: readonly string[]

  /** Actor types that are always spawned on sell (if space available).
   *
   * OpenRA 对照: SpawnActorsOnSellInfo.GuaranteedActorTypes
   *   (ImmutableArray<string>, default empty)
   *
   * These are spawned first, before any random actor types. Each guaranteed
   * actor still consumes from the value budget.
   */
  readonly guaranteedActorTypes: readonly string[]

  /** Faction filter — spawn actors only if the owner's faction is in this set.
   *
   * OpenRA 对照: SpawnActorsOnSellInfo.Factions (FrozenSet<string>, default empty)
   *
   * Empty set means spawn for all factions.
   */
  readonly factions: ReadonlySet<string>

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    valuePercent?: number
    minHpPercent?: number
    actorTypes?: readonly string[]
    guaranteedActorTypes?: readonly string[]
    factions?: ReadonlySet<string>
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.valuePercent = params.valuePercent ?? 40
    this.minHpPercent = params.minHpPercent ?? 30
    this.actorTypes = params.actorTypes ?? []
    this.guaranteedActorTypes = params.guaranteedActorTypes ?? []
    this.factions = params.factions ?? new Set<string>()
  }
}

// ---------------------------------------------------------------------------
// SpawnActorsOnSell — trait implementation
// OpenRA 对照: SpawnActorsOnSell : ConditionalTrait<SpawnActorsOnSellInfo>,
//   INotifySold
// ---------------------------------------------------------------------------

/** Spawns new actors when the owning building is sold.
 *
 * OpenRA 对照: SpawnActorsOnSell
 *
 * On sell, this trait calculates a "value budget" based on the building's
 * sell value and current health percentage. It then spawns guaranteed
 * actor types first, followed by random types from the pool. Each spawned
 * actor's cost is deducted from the budget. Actors are placed at random
 * tile positions covered by the building footprint.
 *
 * Implementation notes:
 * - `selling()` is a no-op (same as C#)
 * - `sold()` delegates to the internal `emit()` method
 * - Actor creation is handled via duck-typed world APIs
 * - Random selection uses `SharedRandom` when available, `Math.random()` as fallback
 * - Faction filtering uses the owner's `Faction.InternalName` property
 */
export class SpawnActorsOnSell
  extends ConditionalTrait<SpawnActorsOnSellInfo>
  implements INotifySold
{
  /** Whether the owner's faction matches the filter (or filter is empty).
   *
   * OpenRA 对照: SpawnActorsOnSell.correctFaction (bool)
   */
  private _correctFaction: boolean = true

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SpawnActorsOnSell(Actor self, SpawnActorsOnSellInfo info)
  // ---------------------------------------------------------------------------

  /** Create a SpawnActorsOnSell trait.
   *
   * OpenRA 对照: SpawnActorsOnSell constructor
   *
   * Checks the faction filter against the creating actor's owner.
   *
   * @param info — trait configuration
   * @param self — the actor this trait is attached to (for faction check)
   */
  constructor(info: SpawnActorsOnSellInfo, self?: IGameActor | undefined) {
    super(info)
    // Only check faction if self is provided at construction time
    if (self) {
      this._correctFaction = this._checkFaction(self)
    }
  }

  // ---------------------------------------------------------------------------
  // Component lifecycle
  // ---------------------------------------------------------------------------

  /** Attach to actor — re-evaluate faction check with the attached actor.
   *
   * This handles the case where the trait was constructed without an actor
   * reference (e.g., through a trait factory).
   */
  override attach(actor: IGameActor): void {
    super.attach(actor)
    this._correctFaction = this._checkFaction(actor)
  }

  // ---------------------------------------------------------------------------
  // INotifySold
  // OpenRA 对照: INotifySold.Selling(Actor) / .Sold(Actor)
  // ---------------------------------------------------------------------------

  /** Called when the sell process begins.
   *
   * OpenRA 对照: SpawnActorsOnSell.INotifySold.Selling(Actor self)
   *
   * Intentionally a no-op in OpenRA — all spawning happens in sold().
   */
  selling(_self: IGameActor): void {
    // No-op, same as C#: void INotifySold.Selling(Actor self) { }
  }

  /** Called when the actor has been sold.
   *
   * OpenRA 对照: SpawnActorsOnSell.INotifySold.Sold(Actor self)
   *
   * Delegates to emit() which handles the full spawning logic.
   *
   * @param self — the actor being sold
   */
  sold(self: IGameActor): void {
    this._emit(self)
  }

  // ---------------------------------------------------------------------------
  // emit — core spawn logic
  // OpenRA 对照: SpawnActorsOnSell.Emit(Actor self)
  // ---------------------------------------------------------------------------

  /** Execute the spawn logic when this actor is sold.
   *
   * OpenRA 对照: SpawnActorsOnSell.Emit(Actor self)
   *
   * The full algorithm:
   * 1. Check trait enabled and correct faction
   * 2. Get BuildingInfo from the actor's info — skip if not a building
   * 3. Resolve value budget: ValuePercent * cost / 100
   * 4. Scale budget by health percentage (hp / maxHP), zeroing if below MinHpPercent
   * 5. Get eligible tile locations from the building's footprint
   * 6. Spawn guaranteed actor types first (each deducts from budget)
   * 7. Spawn random actor types from the pool while budget and tiles remain
   *
   * @param self — the actor being sold
   */
  private _emit(self: IGameActor): void {
    // 1. Gate checks
    if (this.isTraitDisabled || !this._correctFaction) {
      return
    }

    // 2. BuildingInfo — required to know where to place spawned actors
    const info = self.info as {
      traitInfoOrDefault?: (name: string) => BuildingInfoStub | undefined
    } | undefined
    const buildingInfo = info?.traitInfoOrDefault?.('BuildingInfo')
    if (!buildingInfo) return

    // 3. Resolve the cost (sell value base) for the building
    const cost = this._resolveBuildingCost(self)

    // NOTE: In C#, the original code always uses `cost` directly
    // (not the sell value after Sellable's refund percentage).
    // getSellValue() would apply CustomSellValue override, but the C#
    // source uses csv?.Value ?? valued?.Cost ?? 0 directly.
    // We match the C# behavior: cost is the raw Valued.Cost or
    // CustomSellValue.Value, not the Sellable-refunded amount.

    // 4. Calculate dudesValue
    let dudesValue = Math.floor((this.info.valuePercent * cost) / 100)

    // 5. Health scaling
    const health = this._resolveHealth(self)
    if (health && health.maxHP > 0) {
      // Prevent overflow by using multiplication comparison (same as C# long cast)
      if (100 * health.hp >= this.info.minHpPercent * health.maxHP) {
        dudesValue = Math.floor((health.hp * dudesValue) / health.maxHP)
      } else {
        dudesValue = 0
      }
    }

    if (dudesValue <= 0) return

    // 6. Get eligible tile locations from the building footprint
    const location = this._getActorLocation(self)
    const eligibleLocations = buildingInfo.tiles(location)
    if (eligibleLocations.length === 0) return

    // 7. Resolve the world for actor creation
    const world = self.world as WorldDuck | undefined
    if (!world) return

    const sharedRandom = this._getSharedRandom(world)

    // 8. Spawn guaranteed actor types first
    if (this.info.guaranteedActorTypes.length > 0) {
      const guaranteedTypes = this._resolveActorTypesWithCost(
        world,
        this.info.guaranteedActorTypes,
      )

      const remainingLocations = [...eligibleLocations]
      const remainingGuaranteed = [...guaranteedTypes]

      while (remainingLocations.length > 0 && remainingGuaranteed.length > 0) {
        const idx = this._randomIndex(remainingGuaranteed.length, sharedRandom)
        const at = remainingGuaranteed[idx]
        const locIdx = this._randomIndex(remainingLocations.length, sharedRandom)
        const loc = remainingLocations[locIdx]

        // In-place removal avoids O(n^2) intermediate array allocations
        remainingLocations.splice(locIdx, 1)
        remainingGuaranteed.splice(idx, 1)
        dudesValue -= at.cost

        this._createActor(world, at.name, loc, self.owner)
      }

      // If all locations consumed by guaranteed actors, we are done
      if (remainingLocations.length === 0) return
    }

    // 9. Spawn random actor types
    const actorTypes = this._resolveActorTypesWithCost(
      world,
      this.info.actorTypes,
    )

    if (actorTypes.length === 0) return

    const remainingLocations = [...eligibleLocations]

    while (remainingLocations.length > 0) {
      // Cache affordable types once per iteration instead of some() + filter()
      const affordableTypes = actorTypes.filter((a) => a.cost <= dudesValue)
      if (affordableTypes.length === 0) break

      const idx = this._randomIndex(affordableTypes.length, sharedRandom)
      const at = affordableTypes[idx]
      const locIdx = this._randomIndex(remainingLocations.length, sharedRandom)
      const loc = remainingLocations[locIdx]

      // In-place removal avoids O(n^2) intermediate array allocations
      remainingLocations.splice(locIdx, 1)
      dudesValue -= at.cost

      this._createActor(world, at.name, loc, self.owner)
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Check if the owner's faction passes the faction filter.
   *
   * OpenRA 对照: SpawnActorsOnSell constructor faction check
   *
   * If factions is empty, all factions are allowed.
   * Otherwise, the owner's Faction.InternalName must be in the set.
   */
  private _checkFaction(self: IGameActor): boolean {
    if (this.info.factions.size === 0) return true

    const owner = self.owner as OwnerWithFaction | undefined
    if (!owner?.faction?.internalName) return false

    return this.info.factions.has(owner.faction.internalName)
  }

  /** Resolve the building's base cost from ValuedInfo or CustomSellValueInfo.
   *
   * OpenRA 对照:
   *   var csv = self.Info.TraitInfoOrDefault<CustomSellValueInfo>();
   *   var valued = self.Info.TraitInfoOrDefault<ValuedInfo>();
   *   var cost = csv?.Value ?? valued?.Cost ?? 0;
   */
  private _resolveBuildingCost(self: IGameActor): number {
    const info = self.info as {
      traitInfoOrDefault?: (name: string) => { value?: number; cost?: number } | undefined
    } | undefined

    if (!info?.traitInfoOrDefault) return 0

    const csv = info.traitInfoOrDefault('CustomSellValueInfo')
    if (csv?.value !== undefined && csv.value > 0) {
      return csv.value
    }

    const valued = info.traitInfoOrDefault('ValuedInfo')
    if (valued?.cost !== undefined) {
      return valued.cost
    }

    return 0
  }

  /** Resolve the IHealth trait from the actor.
   *
   * OpenRA 对照: self.TraitOrDefault<IHealth>()
   */
  private _resolveHealth(self: IGameActor): IHealthAccess | null {
    const healthTrait = (self as {
      traitOrDefault?: (name: string) => IHealthAccess | null
    }).traitOrDefault?.('Health')

    return healthTrait ?? null
  }

  /** Get the actor's current cell position.
   *
   * OpenRA 对照: self.Location
   */
  private _getActorLocation(self: IGameActor): CPos {
    const loc = (self as unknown as { location?: CPos }).location
    if (loc instanceof CPos) return loc

    // Fallback: IOccupySpace.topLeft
    const ios = (self as unknown as { occupiesSpace?: { topLeft?: CPos } }).occupiesSpace
    if (ios?.topLeft instanceof CPos) return ios.topLeft

    return CPos.Zero
  }

  /** Get the shared random number generator from the world.
   *
   * OpenRA 对照: self.World.SharedRandom
   */
  private _getSharedRandom(world: WorldDuck): SharedRandomStub | null {
    if (world.sharedRandom && typeof world.sharedRandom.next === 'function') {
      return world.sharedRandom
    }
    return null
  }

  /** Generate a random index in range [0, max) using shared random or Math.random().
   */
  private _randomIndex(max: number, rng: SharedRandomStub | null): number {
    if (rng) {
      return rng.next(0, max)
    }
    return Math.floor(Math.random() * max)
  }

  /** Resolve actor types from the ruleset, pairing each with its ValuedInfo.Cost.
   *
   * OpenRA 对照:
   *   Info.ActorTypes.Select(a => {
   *     var av = self.World.Map.Rules.Actors[a].TraitInfoOrDefault<ValuedInfo>();
   *     return new { Name = a, Cost = av?.Cost ?? 0 };
   *   }).ToList();
   */
  private _resolveActorTypesWithCost(
    world: WorldDuck,
    typeNames: readonly string[],
  ): { name: string; cost: number }[] {
    const actors = world.map?.rules?.actors
    if (!actors) {
      // Ruleset not available — map type names with zero cost
      return typeNames.map((name) => ({ name, cost: 0 }))
    }

    return typeNames.map((name) => {
      const actorDef = actors[name]
      if (!actorDef?.traitInfoOrDefault) {
        return { name, cost: 0 }
      }
      const valued = actorDef.traitInfoOrDefault('ValuedInfo')
      return { name, cost: valued?.cost ?? 0 }
    })
  }

  /** Create an actor in the world via duck-typed createActor.
   *
   * OpenRA 对照:
   *   self.World.AddFrameEndTask(w => w.CreateActor(at.Name,
   *     [ new LocationInit(loc), new OwnerInit(self.Owner) ]));
   */
  private _createActor(
    world: WorldDuck,
    name: string,
    loc: CPos,
    owner: PlayerStub | undefined,
  ): void {
    const locationInit: LocationInit = { type: 'LocationInit', value: loc }
    const ownerInit: OwnerInit = {
      type: 'OwnerInit',
      value: owner ?? { playerName: 'Neutral' },
    }

    if (typeof world.createActor === 'function') {
      world.createActor(name, [locationInit, ownerInit])
    } else if (typeof world.addFrameEndTask === 'function') {
      world.addFrameEndTask((w) => {
        if (typeof w.createActor === 'function') {
          w.createActor(name, [locationInit, ownerInit])
        }
      })
    }
  }
}
