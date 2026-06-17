/**
 * TransformsNearResources.ts — 当资源相邻时变形
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/TransformsNearResources.cs (102 lines)
 *
 * 核心范式转换:
 * - C# ITick → TypeScript ITick interface
 * - C# IResourceLayer.GetResource(CPos) → TypeScript resource layer query
 * - C# CVec.Directions enumeration → TypeScript constant direction array
 * - C# Transform activity → TypeScript transform action stub
 * - C# RandomInRange utility → TypeScript random range helper
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { CVec } from '../../OpenRA.Game/CVec.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random integer in [min, max] inclusive (matching C# RandomInRange).
 *
 * OpenRA 对照: Common.Util.RandomInRange(SharedRandom, int[] or int[])
 */
function randomInRange(rng: { nextInt(max: number): number } | null, range: readonly number[]): number {
  if (range.length === 2) {
    const min = range[0]
    const max = range[1]
    if (rng) {
      // C# SharedRandom returns [0, maxValue) for Next, so range is [min, max]
      return min + rng.nextInt(max - min + 1)
    }
    return min + Math.floor(Math.random() * (max - min + 1))
  }
  return range[0] ?? 0
}

// ---------------------------------------------------------------------------
// TransformsNearResourcesInfo
// OpenRA 对照: TransformsNearResourcesInfo : TraitInfo
// ---------------------------------------------------------------------------

/** Configuration for resource-proximity transformation.
 *
 * OpenRA 对照: TransformsNearResourcesInfo
 */
export class TransformsNearResourcesInfo implements ITraitInfo {
  /** Actor type to transform into.
   *
   * OpenRA 对照: TransformsNearResourcesInfo.IntoActor
   */
  readonly intoActor: string

  /** Offset for the transform placement.
   *
   * OpenRA 对照: TransformsNearResourcesInfo.Offset (CVec)
   */
  readonly offset: CVec

  /** Skip the make animation during transform.
   *
   * OpenRA 对照: TransformsNearResourcesInfo.SkipMakeAnims
   */
  readonly skipMakeAnims: boolean

  /** Resource type that triggers the transformation.
   *
   * OpenRA 对照: TransformsNearResourcesInfo.Type
   */
  readonly type: string

  /** Resource density threshold required.
   *
   * OpenRA 对照: TransformsNearResourcesInfo.Density
   */
  readonly density: number

  /** Number of adjacent resource tiles required.
   *
   * OpenRA 对照: TransformsNearResourcesInfo.Adjacency
   */
  readonly adjacency: number

  /** Range of time in ticks until transformation starts.
   *
   * OpenRA 对照: TransformsNearResourcesInfo.Delay (ImmutableArray<int>)
   */
  readonly delay: readonly number[]

  constructor(params?: {
    intoActor?: string
    offset?: CVec
    skipMakeAnims?: boolean
    type?: string
    density?: number
    adjacency?: number
    delay?: readonly number[]
  }) {
    this.intoActor = params?.intoActor ?? ''
    this.offset = params?.offset ?? CVec.Zero
    this.skipMakeAnims = params?.skipMakeAnims ?? false
    this.type = params?.type ?? ''
    this.density = params?.density ?? 1
    this.adjacency = params?.adjacency ?? 1
    this.delay = params?.delay ?? [1000, 3000]
  }

  create(init: IGameActor): TransformsNearResources {
    return new TransformsNearResources(init, this)
  }
}

// ---------------------------------------------------------------------------
// ResourceLayer stub for type querying
// ---------------------------------------------------------------------------

interface ResourceLayerStub {
  getResource(pos: CPos): { type: string | null; density: number }
}

// ---------------------------------------------------------------------------
// TransformsNearResources
// OpenRA 对照: TransformsNearResources : ITick
// ---------------------------------------------------------------------------

/** Replaces the actor with another when resources spawn adjacent.
 *
 * OpenRA 对照: TransformsNearResources
 *
 * Each tick, checks the adjacent cells for resources of the specified type.
 * When enough adjacent cells (adjacency) have sufficient resource density,
 * the delay countdown begins. Once delay reaches zero, the actor transforms.
 */
export class TransformsNearResources {
  readonly info: TransformsNearResourcesInfo

  private readonly _resourceLayer: ResourceLayerStub | null
  private _delay: number

  constructor(self: IGameActor, info: TransformsNearResourcesInfo) {
    this.info = info

    // C#: self.World.WorldActor.Trait<IResourceLayer>()
    const worldActor = (self as any).world?.worldActor
    this._resourceLayer = worldActor?.traitsImplementing?.('IResourceLayer')?.[0] ?? null

    // C#: delay = Common.Util.RandomInRange(self.World.SharedRandom, info.Delay)
    const rng = (self as any).world?.sharedRandom ?? null
    this._delay = randomInRange(rng, info.delay)
  }

  // -------------------------------------------------------------------------
  // ITick
  // -------------------------------------------------------------------------

  /** Check for adjacent resources and count down delay.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   *
   * @param self — the actor checking for resources
   */
  tick(self: IGameActor): void {
    if (this._delay < 0) {
      return
    }

    let adjacent = 0
    for (const direction of CVec.Directions) {
      const location = (self as any).location as CPos | undefined
      if (!location) continue

      const neighbor = CPos.add(location, direction)

      if (!this._resourceLayer) continue
      const resource = this._resourceLayer.getResource(neighbor)

      if (!resource.type || resource.type !== this.info.type) continue
      if (resource.density < this.info.density) continue

      adjacent++
      if (adjacent >= this.info.adjacency) {
        this._delay--
        break
      }
    }

    if (this._delay < 0) {
      this._transform(self)
    }
  }

  // -------------------------------------------------------------------------
  // Internal: transform
  // -------------------------------------------------------------------------

  /** Queue the transform activity.
   *
   * OpenRA 对照: TransformsNearResources.Transform(Actor)
   *
   * @param self — the actor to transform
   */
  private _transform(self: IGameActor): void {
    // C#: var transform = new Transform(info.IntoActor);
    //      transform.SkipMakeAnims = info.SkipMakeAnims;
    //      transform.Offset = info.Offset;
    //      self.QueueActivity(false, transform);
    const queueActivity = (self as any).queueActivity as
      | ((queued: boolean, activity: unknown) => void)
      | undefined
    if (queueActivity) {
      queueActivity(false, {
        intoActor: this.info.intoActor,
        skipMakeAnims: this.info.skipMakeAnims,
        offset: this.info.offset,
        facing: undefined as number | undefined,
      })
    }
  }

  // -------------------------------------------------------------------------
  // Queries (for testing)
  // -------------------------------------------------------------------------

  /** Current delay value.
   *
   * OpenRA 对照: TransformsNearResources.delay
   */
  get delay(): number {
    return this._delay
  }

  /** Set delay for testing.
   */
  setDelay(value: number): void {
    this._delay = value
  }
}
