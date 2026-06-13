/**
 * SeedsResource.ts — 随时间在 actor 周围散播资源 (如矿石生成器)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/SeedsResource.cs
 *
 * 核心范式转换:
 * - C# ConditionalTrait<SeedsResourceInfo> → ConditionalTrait<SeedsResourceInfo> (已迁移)
 * - C# Util.RandomWalk(self.Location, self.World.SharedRandom) → 本地 randomWalk() 生成器
 * - C# LINQ Take/SkipWhile/Cast/FirstOrDefault → TypeScript for-of 循环 + 条件检查
 * - C# self.World.WorldActor.Trait<IResourceLayer>() → 鸭子类型 resourceLayer 访问
 * - C# SharedRandom (MersenneTwister) → 鸭子类型访问, Math.random() 回退
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { CVec } from '../../OpenRA.Game/CVec'
import {
  ConditionalTrait,
  type IGameActor,
  type ITick,
  type ISeedableResource,
  type ConditionalTraitInfo,
  type IResourceLayer,
  type ResourceLayerContents,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// SharedRandom helper type — duck-typed to match MersenneTwister stub
// OpenRA 对照: OpenRA.Support/MersenneTwister.cs
// ---------------------------------------------------------------------------

/** Minimal interface for a shared RNG.
 *
 * OpenRA 对照: MersenneTwister.Next(int, int) overload
 *
 * Used via duck-typing from the world's SharedRandom property.
 * Falls back to Math.random() when unavailable.
 */
interface SharedRandomStub {
  /** Generate a random integer in [min, max) range.
   *
   * OpenRA 对照: MersenneTwister.Next(int minValue, int maxValue)
   */
  next(min: number, max: number): number
}

// ---------------------------------------------------------------------------
// randomWalk — infinite generator of random-walk cell positions
// OpenRA 对照: Util.RandomWalk(CPos, MersenneTwister)
// ---------------------------------------------------------------------------

/** Generate an infinite sequence of cell positions via random walk.
 *
 * OpenRA 对照: OpenRA.Mods.Common.Util.RandomWalk(CPos, MersenneTwister)
 *
 * Starting from `start`, each step adds a random 8-directional offset
 * (dx, dy in [-1, 0, +1], excluding (0,0)). Uses SharedRandom when
 * available, falls back to Math.random().
 *
 * No per-frame allocation: CPos.add and CVec constructor are invoked
 * within the generator loop — acceptable since SeedsResource ticks
 * infrequently (Interval=75 ticks, ~3 seconds at 25 TPS).
 *
 * @param start — the starting cell position
 * @param rng — optional shared random number generator
 * @yields an infinite sequence of CPos positions
 */
function* randomWalk(
  start: CPos,
  rng: SharedRandomStub | null,
): Generator<CPos> {
  let p = start
  while (true) {
    let dx: number
    let dy: number
    if (rng) {
      dx = rng.next(-1, 2) // [min, max) → -1, 0, or 1
      dy = rng.next(-1, 2)
    } else {
      dx = nextRandomOffset()
      dy = nextRandomOffset()
    }

    // Skip (0, 0) — re-roll to ensure movement
    if (dx === 0 && dy === 0) continue

    p = CPos.add(p, new CVec(dx, dy))
    yield p
  }
}

/** Generate a random offset in {-1, 0, 1} using Math.random().
 *
 * Fallback when SharedRandom (MersenneTwister) is not available.
 */
function nextRandomOffset(): number {
  return Math.floor(Math.random() * 3) - 1
}

// ---------------------------------------------------------------------------
// SeedsResourceInfo — trait configuration
// OpenRA 对照: SeedsResourceInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for the SeedsResource trait.
 *
 * OpenRA 对照: SeedsResourceInfo (sealed class, ConditionalTraitInfo)
 *
 * Controls how frequently and what type of resources are spawned.
 */
export interface SeedsResourceInfo extends ConditionalTraitInfo {
  /** Number of ticks between resource seeding attempts.
   *
   * OpenRA 对照: SeedsResourceInfo.Interval (default 75)
   *
   * At 25 TPS, 75 ticks = 3 seconds between attempts.
   */
  readonly interval: number

  /** The resource type identifier to seed (e.g., "Ore", "Tiberium").
   *
   * OpenRA 对照: SeedsResourceInfo.ResourceType (default "Ore")
   */
  readonly resourceType: string

  /** Maximum range (in cell-distance units) for random walk search.
   *
   * OpenRA 对照: SeedsResourceInfo.MaxRange (default 100)
   *
   * The random walk will explore up to this many steps before giving up.
   */
  readonly maxRange: number
}

// ---------------------------------------------------------------------------
// SeedsResource — actor trait implementation
// OpenRA 对照: SeedsResource : ConditionalTrait<SeedsResourceInfo>, ITick, ISeedableResource
// ---------------------------------------------------------------------------

/** Lets the actor spread resources around it in a circle.
 *
 * OpenRA 对照: SeedsResource (sealed class)
 *
 * Each tick, a countdown decrements. When it reaches zero, the actor
 * attempts to seed resources at a nearby cell via random walk.
 *
 * Implements ISeedableResource so other systems (e.g., world-level
 * resource initialization) can trigger seeding on demand.
 */
export class SeedsResource
  extends ConditionalTrait<SeedsResourceInfo>
  implements ITick, ISeedableResource
{
  /** Reference to the world's resource layer, resolved on first use.
   *
   * OpenRA 对照: SeedsResource.resourceLayer (IResourceLayer)
   */
  private _resourceLayer: IResourceLayer | null = null

  /** Countdown timer — seeds resources when this reaches zero.
   *
   * OpenRA 对照: SeedsResource.ticks (int)
   */
  private _ticks: number = 0

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /** Create a SeedsResource trait.
   *
   * OpenRA 对照: SeedsResource(Actor self, SeedsResourceInfo info)
   *
   * @param info — trait configuration
   */
  constructor(info: SeedsResourceInfo) {
    super(info)
  }

  // ---------------------------------------------------------------------------
  // ITick
  // OpenRA 对照: ITick.Tick(Actor self)
  // ---------------------------------------------------------------------------

  /** Called every game tick. Decrements countdown and seeds when ready.
   *
   * OpenRA 对照: SeedsResource.ITick.Tick(Actor self)
   *
   * Respects trait disabled state (ConditionalTrait). When disabled
   * by conditions, seeding is paused.
   *
   * @param self — the actor this trait belongs to
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled) return

    if (--this._ticks <= 0) {
      this.seed(self)
      this._ticks = this.info.interval
    }
  }

  // ---------------------------------------------------------------------------
  // ISeedableResource
  // OpenRA 对照: ISeedableResource.Seed(Actor self)
  // ---------------------------------------------------------------------------

  /** Seed resources at a nearby cell found via random walk.
   *
   * OpenRA 对照: SeedsResource.Seed(Actor self)
   *
   * Algorithm:
   * 1. Start a random walk from the actor's current location
   * 2. Walk up to MaxRange steps
   * 3. Skip cells that already have this resource type and cannot accept more
   * 4. At the first cell that can accept the resource type, add it
   *
   * @param self — the actor seeding resources
   */
  seed(self: IGameActor): void {
    // Resolve resource layer lazily (once)
    if (!this._resourceLayer) {
      this._resourceLayer = this.resolveResourceLayer(self)
      if (!this._resourceLayer) return
    }

    const layer = this._resourceLayer
    const resourceType = this.info.resourceType

    // Retrieve the actor's current cell location via duck-typing
    const location = this.getActorLocation(self)

    // Retrieve the shared RNG via duck-typing
    const rng = this.getSharedRandom(self)

    const walker = randomWalk(location, rng)

    // Walk up to MaxRange steps, looking for a seedable cell
    for (let step = 0; step < this.info.maxRange; step++) {
      const iter = walker.next()
      if (iter.done) break

      const cell = iter.value
      const contents: ResourceLayerContents = layer.getResource(cell)

      // Skip cells that already have this resource type and are at max density
      if (contents.type === resourceType && !layer.canAddResource(resourceType, cell)) {
        continue
      }

      // Found a cell that can accept this resource — add it
      if (layer.canAddResource(resourceType, cell)) {
        layer.addResource(resourceType, cell)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // protected: traitEnabled / traitDisabled lifecycle
  // ---------------------------------------------------------------------------

  protected override traitEnabled(self: IGameActor): void {
    super.traitEnabled(self)
    // Reset countdown to start seeding immediately on enable
    this._ticks = 0
  }

  protected override traitDisabled(self: IGameActor): void {
    super.traitDisabled(self)
    // Seeding picks up where it left off when re-enabled
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Resolve the IResourceLayer from the world actor.
   *
   * OpenRA 对照: self.World.WorldActor.Trait<IResourceLayer>()
   *
   * Uses duck-typing to navigate the world actor's trait system.
   * Returns null if the resource layer is not yet available.
   *
   * @param self — the actor
   * @returns the IResourceLayer, or null if not found
   */
  private resolveResourceLayer(self: IGameActor): IResourceLayer | null {
    const world = self.world as Record<string, unknown> | undefined
    if (!world) return null

    // Access world.worldActor (which may be a property or a method)
    const worldActor = (world as { worldActor?: unknown }).worldActor
    if (!worldActor) return null

    // Try to get IResourceLayer via trait query
    const traitFn = (worldActor as Record<string, unknown>).trait as
      | (<T>(type: string) => T | undefined)
      | undefined
    if (typeof traitFn === 'function') {
      return traitFn<IResourceLayer>('IResourceLayer') ?? null
    }

    return null
  }

  /** Get the actor's current map cell location.
   *
   * OpenRA 对照: self.Location (Actor.Location property)
   *
   * Uses duck-typing to access the location, which may come from
   * IOccupySpace.topLeft or a direct Location property.
   *
   * @param self — the actor
   * @returns the actor's cell position, or CPos.Zero if not found
   */
  private getActorLocation(self: IGameActor): CPos {
    // Try direct location property first (Actor.Location pattern)
    const loc = (self as unknown as { location?: CPos }).location
    if (loc instanceof CPos) return loc

    // Fall back to IOccupySpace.topLeft
    const ios = (self as unknown as { occupiesSpace?: { topLeft?: CPos } }).occupiesSpace
    if (ios?.topLeft instanceof CPos) return ios.topLeft

    return CPos.Zero
  }

  /** Get the shared random number generator from the world.
   *
   * OpenRA 对照: self.World.SharedRandom
   *
   * Uses duck-typing to access the shared RNG. Returns null if not
   * available, in which case randomWalk falls back to Math.random().
   *
   * @param self — the actor
   * @returns the shared RNG, or null if not available
   */
  private getSharedRandom(self: IGameActor): SharedRandomStub | null {
    const world = self.world as Record<string, unknown> | undefined
    if (!world) return null

    const sharedRandom = (world as { sharedRandom?: unknown }).sharedRandom
    if (sharedRandom && typeof (sharedRandom as SharedRandomStub).next === 'function') {
      return sharedRandom as SharedRandomStub
    }

    return null
  }
}
