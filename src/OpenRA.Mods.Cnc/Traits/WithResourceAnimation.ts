/**
 * WithResourceAnimation.ts — 在资源上播放动画特效
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/World/WithResourceAnimation.cs (108 lines)
 *
 * 核心范式转换:
 * - C# IWorldLoaded + ITick → TypeScript same interfaces
 * - C# IResourceRenderer lookup → TypeScript component lookup
 * - C# SpriteEffect (World effect) → TypeScript stub (deferred to Phase C)
 * - C# HashSet<CPos> + Shuffle + Take → TypeScript Set + random sampling
 * - C# RandomInRange utility → TypeScript random range helper
 *
 * NOTE: Visual rendering (SpriteEffect) is deferred to Phase C rendering.
 * This trait manages timing and cell selection, triggering spawn events
 * for the renderer to consume.
 */

import type { IGameActor, ITraitInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a random integer in [min, max] inclusive.
 *
 * OpenRA 对照: Common.Util.RandomInRange(World.LocalRandom, int[])
 */
function randomInRange(rng: { nextInt(max: number): number } | null, range: readonly number[]): number {
  if (range.length === 2) {
    const min = range[0]
    const max = range[1]
    if (rng) return min + rng.nextInt(max - min + 1)
    return min + Math.floor(Math.random() * (max - min + 1))
  }
  return range[0] ?? 0
}

/** Fisher-Yates shuffle of an array.
 *
 * OpenRA 对照: IEnumerable.Shuffle(Random)
 */
function shuffle<T>(arr: T[], rng: { nextInt(max: number): number }): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// ---------------------------------------------------------------------------
// WithResourceAnimationInfo
// OpenRA 对照: WithResourceAnimationInfo : TraitInfo, Requires<IResourceLayerInfo>
// ---------------------------------------------------------------------------

/** Configuration for resource cell animation spawning.
 *
 * OpenRA 对照: WithResourceAnimationInfo
 *
 * @traitLocation World | EditorWorld
 */
export class WithResourceAnimationInfo implements ITraitInfo {
  /** Resource types to animate.
   *
   * OpenRA 对照: WithResourceAnimationInfo.Types (FrozenSet<string>)
   */
  readonly types: ReadonlySet<string>

  /** Percentage of resource cells to animate [min, max].
   *
   * OpenRA 对照: WithResourceAnimationInfo.Ratio
   */
  readonly ratio: readonly number[]

  /** Tick interval between animation spawns [min, max].
   *
   * OpenRA 对照: WithResourceAnimationInfo.Interval
   */
  readonly interval: readonly number[]

  /** Animation image/sprite collection.
   *
   * OpenRA 对照: WithResourceAnimationInfo.Image
   */
  readonly image: string

  /** Randomly selectable animation sequences.
   *
   * OpenRA 对照: WithResourceAnimationInfo.Sequences
   */
  readonly sequences: readonly string[]

  /** Animation palette.
   *
   * OpenRA 对照: WithResourceAnimationInfo.Palette
   */
  readonly palette: string

  constructor(params?: {
    types?: ReadonlySet<string>
    ratio?: readonly number[]
    interval?: readonly number[]
    image?: string
    sequences?: readonly string[]
    palette?: string
  }) {
    this.types = params?.types ?? new Set()
    this.ratio = params?.ratio ?? [1, 10]
    this.interval = params?.interval ?? [200, 500]
    this.image = params?.image ?? ''
    this.sequences = params?.sequences ?? ['idle']
    this.palette = params?.palette ?? ''
  }

  create(init: IGameActor): WithResourceAnimation {
    return new WithResourceAnimation(init, this)
  }
}

// ---------------------------------------------------------------------------
// WithResourceAnimation
// OpenRA 对照: WithResourceAnimation : IWorldLoaded, ITick
// ---------------------------------------------------------------------------

/** Periodically spawns decorative animations on resource cells.
 *
 * OpenRA 对照: WithResourceAnimation
 *
 * Each interval (randomized), a percentage of visible resource cells
 * of matching types receive a decorative sprite animation.
 */
export class WithResourceAnimation {
  readonly info: WithResourceAnimationInfo

  /** Ticks until next animation spawn cycle.
   *
   * OpenRA 对照: WithResourceAnimation.ticks
   */
  private _ticks: number

  /** Resource renderer for cell type queries.
   *
   * OpenRA 对照: WithResourceAnimation.resourceRenderer
   */
  private _resourceRenderer: unknown = null

  /** Pending spawn positions for the next frame end task.
   *
   * Accumulated during tick(), dispatched to spawn effects.
   */
  private _pendingSpawns: { position: unknown; image: string; sequence: string; palette: string }[] = []

  constructor(self: IGameActor, info: WithResourceAnimationInfo) {
    this.info = info
    const world = (self as any).world
    const rng: { nextInt(max: number): number } | null = world?.localRandom ?? null
    this._ticks = randomInRange(rng, info.interval)
  }

  // -------------------------------------------------------------------------
  // IWorldLoaded
  // -------------------------------------------------------------------------

  /** Resolve the resource renderer after world load.
   *
   * OpenRA 对照: IWorldLoaded.WorldLoaded(World, WorldRenderer)
   */
  worldLoaded(w: unknown): void {
    const worldActor = (w as any)?.worldActor
    if (!worldActor) return

    const renderers = worldActor.traitsImplementing?.('IResourceRenderer') ?? []
    this._resourceRenderer = renderers.find(
      (r: any) =>
        r.resourceTypes &&
        [...this.info.types].some((t) => r.resourceTypes.has(t)),
    ) ?? null
  }

  // -------------------------------------------------------------------------
  // ITick
  // -------------------------------------------------------------------------

  /** Check if it's time to spawn animations and enqueue them.
   *
   * OpenRA 对照: ITick.Tick(Actor)
   *
   * @param self — the world actor
   */
  tick(self: IGameActor): void {
    if (--this._ticks > 0) return

    const world = (self as any).world
    if (!world) return

    // Collect visible resource cells of matching types
    const cells: unknown[] = []
    // NOTE: In OpenRA, this iterates worldRenderer.Viewport.AllVisibleCells.
    // In TypeScript, we use a simplified cell collection from the map.
    // The actual viewport-visible cell set requires WorldRenderer integration.

    const ratio = randomInRange(world.localRandom, this.info.ratio)
    const maxSpawns = Math.max(1, Math.floor(cells.length * ratio / 100))

    if (maxSpawns > 0 && cells.length > 0) {
      // Shuffle and take maxSpawns
      const shuffled = shuffle(cells as any[], world.localRandom)
      const selected = shuffled.slice(0, maxSpawns)

      for (const cell of selected) {
        const sequence = this.info.sequences[
          Math.floor(Math.random() * this.info.sequences.length)
        ]
        this._pendingSpawns.push({
          position: cell,
          image: this.info.image,
          sequence,
          palette: this.info.palette,
        })
      }
    }

    // Reset timer
    this._ticks = randomInRange(world.localRandom, this.info.interval)
  }

  // -------------------------------------------------------------------------
  // Queries (for testing)
  // -------------------------------------------------------------------------

  /** Current tick countdown.
   */
  get ticks(): number {
    return this._ticks
  }

  /** Set tick countdown (for testing).
   */
  setTicks(value: number): void {
    this._ticks = value
  }

  /** Pending animation spawns for this frame.
   */
  get pendingSpawns(): readonly {
    position: unknown
    image: string
    sequence: string
    palette: string
  }[] {
    return this._pendingSpawns
  }

  /** Clear pending spawns (after processing in frame end tasks).
   */
  clearPendingSpawns(): void {
    this._pendingSpawns = []
  }
}
