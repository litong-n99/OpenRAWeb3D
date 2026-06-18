/**
 * SpiceBloom.ts — 香料爆发 (Spice Bloom) 资源生成器
 * OpenRA 对照: OpenRA.Mods.D2k/Traits/SpiceBloom.cs (213 lines)
 *
 * 核心范式转换:
 * - C# SpiceBloomInfo : TraitInfo, IRenderActorPreviewSpritesInfo → TS
 *   SpiceBloomInfo with simplified config (no render preview support yet)
 * - C# Animation (2D sprite animation) → duck-typed sprite animation stubs
 * - C# int2.Lerp → local lerpInt helper
 * - C# Stack<ProjectileArgs> + FireProjectilesEffect → inline projectile spawning
 * - C# self.World.Map.FindTilesInAnnulus → duck-typed map access
 * - C# RenderSprites.GetImage → duck-typed image resolution
 * - C# MapNotificationEffect / TextNotificationsManager → deferred stubs
 */

import { CPos } from '../../OpenRA.Game/CPos'
import { WAngle } from '../../OpenRA.Game/WAngle'
import { WVec } from '../../OpenRA.Game/WVec'
import {
  type IGameActor,
  type ITick,
  type INotifyKilled,
  type ITraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'
import { Animation } from '../../OpenRA.Game/Graphics/Animation.js'

// ---------------------------------------------------------------------------
// Helper: integer linear interpolation
// ---------------------------------------------------------------------------

/** Integer linear interpolation: a + (b - a) * mul / div.
 *
 * OpenRA 对照: int2.Lerp(int a, int b, int mul, int div)
 */
function lerpInt(a: number, b: number, mul: number, div: number): number {
  if (div <= 0) return a
  return Math.round(a + (b - a) * mul / div)
}

// ---------------------------------------------------------------------------
// Interfaces for duck-typed dependencies
// ---------------------------------------------------------------------------

/** RenderSprites trait interface for animation setup.
 *
 * OpenRA 对照: RenderSprites trait
 */
interface RenderSpritesStub {
  getImage(actor: IGameActor): string
  add(anim: unknown, palette?: unknown): void
}

/** SequenceSet interface for Animation construction.
 *
 * OpenRA 对照: ISequenceSet (from Map.Sequences)
 */
interface SequenceSetStub {
  hasSequence(actorName: string, sequenceName: string): boolean
  getSequence(actorName: string, sequenceName: string): {
    readonly name: string
    readonly length: number
    readonly tick: number
    readonly scale: number
    readonly zOffset: number
    readonly shadowZOffset: number
    readonly ignoreWorldTint: boolean
    readonly bounds: { x: number; y: number; width: number; height: number }
    getSprite(frame: number, facing: number): unknown
    getSpriteWithRotation(frame: number, facing: number): { sprite: unknown; rotation: number }
    getAlpha(frame: number): number
    getShadow(frame: number, facing: number): unknown
  }
}

// ---------------------------------------------------------------------------
// SpiceBloomInfo
// OpenRA 对照: SpiceBloomInfo : TraitInfo, IRenderActorPreviewSpritesInfo,
//              Requires<RenderSpritesInfo>
// ---------------------------------------------------------------------------

/** Configuration for the SpiceBloom trait.
 *
 * OpenRA 对照: SpiceBloomInfo (public class)
 *
 * A spice bloom periodically erupts, spreading spice resources over
 * a growing radius. It plays growth animation sequences and, when
 * killed, fires spice-seeding projectiles.
 */
export class SpiceBloomInfo implements ITraitInfo {
  readonly instanceName?: string

  /** Growth animation sequences (progressively larger blooms).
   *
   * OpenRA 对照: SpiceBloomInfo.GrowthSequences (default ["grow1", "grow2", "grow3"])
   */
  readonly growthSequences: readonly string[]

  /** Spurt animation sequence.
   *
   * OpenRA 对照: SpiceBloomInfo.SpurtSequence (default "spurt")
   */
  readonly spurtSequence: string

  /** Lifetime range (min, max) in ticks.
   *
   * OpenRA 对照: SpiceBloomInfo.Lifetime (default [2000, 3000])
   */
  readonly lifetime: readonly [number, number]

  /** Resource type to spawn.
   *
   * OpenRA 对照: SpiceBloomInfo.ResourceType (default "Spice")
   */
  readonly resourceType: string

  /** Terrain types the bloom can grow on.
   *
   * OpenRA 对照: SpiceBloomInfo.GrowthTerrainTypes
   */
  readonly growthTerrainTypes: readonly string[]

  /** Weapon used for spice creation.
   *
   * OpenRA 对照: SpiceBloomInfo.Weapon (default null)
   */
  readonly weapon: string | null

  /** Burst count range (min, max) for projectile seeding.
   *
   * OpenRA 对照: SpiceBloomInfo.Bursts (default [4, 12])
   */
  readonly bursts: readonly [number, number]

  /** Range (min, max) in cells for spice expulsion.
   *
   * OpenRA 对照: SpiceBloomInfo.Range (default [3, 5])
   */
  readonly range: readonly [number, number]

  /** Delay between each burst (in ticks).
   *
   * OpenRA 对照: SpiceBloomInfo.BurstInterval (default 1)
   */
  readonly burstInterval: number

  constructor(params: {
    instanceName?: string
    growthSequences?: string[]
    spurtSequence?: string
    lifetime?: [number, number]
    resourceType?: string
    growthTerrainTypes?: string[]
    weapon?: string | null
    bursts?: [number, number]
    range?: [number, number]
    burstInterval?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.growthSequences = params.growthSequences ?? ['grow1', 'grow2', 'grow3']
    this.spurtSequence = params.spurtSequence ?? 'spurt'
    this.lifetime = params.lifetime ?? [2000, 3000]
    this.resourceType = params.resourceType ?? 'Spice'
    this.growthTerrainTypes = params.growthTerrainTypes ?? []
    this.weapon = params.weapon ?? null
    this.bursts = params.bursts ?? [4, 12]
    this.range = params.range ?? [3, 5]
    this.burstInterval = params.burstInterval ?? 1
  }
}

// ---------------------------------------------------------------------------
// SpiceBloom
// OpenRA 对照: SpiceBloom : ITick, INotifyKilled
// ---------------------------------------------------------------------------

/** Spice bloom trait: grows over time, periodically spurting spice,
 * and on death spreads spice via projectile eruption.
 *
 * OpenRA 对照: SpiceBloom (public class, ITick, INotifyKilled)
 */
export class SpiceBloom implements ITick, INotifyKilled {
  /** Trait configuration.
   *
   * OpenRA 对照: SpiceBloom.info (readonly SpiceBloomInfo)
   */
  readonly info: SpiceBloomInfo

  /** Total ticks until the bloom erupts (random in [lifetime[0], lifetime[1]]).
   *
   * OpenRA 对照: SpiceBloom.growTicks (readonly int)
   */
  readonly growTicks: number

  /** Elapsed ticks since creation.
   *
   * OpenRA 对照: SpiceBloom.ticks (int)
   */
  private _ticks: number = 0

  /** Current body animation frame index.
   *
   * OpenRA 对照: SpiceBloom.bodyFrame (int, default 0)
   */
  private _bodyFrame: number = 0

  /** The owning actor (for duck-typed access to world/services). */
  private readonly _self: IGameActor

  /** Body animation (tick-synced Animation with sequence set).
   *
   * OpenRA 对照: SpiceBloom.body (Animation)
   */
  private _body: Animation | null = null

  /** Spurt animation (tick-synced, plays once then hides).
   *
   * OpenRA 对照: SpiceBloom.spurt (Animation)
   */
  private _spurt: Animation | null = null

  /** Whether the spurt animation is currently visible.
   *
   * OpenRA 对照: SpiceBloom.showSpurt (bool)
   */
  private _showSpurt: boolean = true

  /** Cached resource layer. */
  private _resourceLayer: IResourceLayerStub | null = null

  // ---------------------------------------------------------------------------
  // Construction
  // OpenRA 对照: SpiceBloom(Actor self, SpiceBloomInfo info)
  // ---------------------------------------------------------------------------

  /** Create a SpiceBloom trait.
   *
   * OpenRA 对照: SpiceBloom(Actor self, SpiceBloomInfo info)
   *
   * Initializes body and spurt animations via RenderSprites.
   * Randomly selects a lifetime in [lifetime[0], lifetime[1]).
   *
   * @param self — the actor that owns this trait
   * @param info — trait configuration
   */
  constructor(self: IGameActor, info: SpiceBloomInfo) {
    this.info = info
    this._self = self

    // Random lifetime in [lifetime[0], lifetime[1])
    this.growTicks = this.getSharedRandomNext(
      info.lifetime[0],
      info.lifetime[1],
    )

    // Set up animations via RenderSprites
    this.setupAnimations(self, info)
  }

  // ---------------------------------------------------------------------------
  // ITick.Tick
  // OpenRA 对照: SpiceBloom.ITick.Tick(Actor self)
  // ---------------------------------------------------------------------------

  /** Called each tick: increment growth timer, update animations,
   * and check for death at full growth.
   *
   * OpenRA 对照: SpiceBloom.ITick.Tick(Actor self)
   *
   * @param self — the actor
   */
  tick(self: IGameActor): void {
    // Check if the bloom is within the map
    const map = this.getMap()
    if (!map?.contains(this.getActorLocation(self)))
      return

    // Check terrain type restrictions
    if (this.info.growthTerrainTypes.length > 0) {
      const terrainType = map.getTerrainInfo(this.getActorLocation(self))?.type
      if (!terrainType || !this.info.growthTerrainTypes.includes(terrainType))
        return
    }

    this._ticks++

    if (this._ticks >= this.growTicks) {
      this.killActor(self)
    } else {
      const newBodyFrame = Math.floor(
        this.info.growthSequences.length * this._ticks / this.growTicks,
      )
      if (newBodyFrame !== this._bodyFrame) {
        this._bodyFrame = newBodyFrame
        this._body?.play(this.info.growthSequences[this._bodyFrame]!)

        // Reset spurt visibility and play spurt animation once
        // OpenRA 对照: showSpurt = true; spurt.PlayThen(SpurtSequence, () => showSpurt = false)
        this._showSpurt = true
        this._spurt?.playThen(this.info.spurtSequence, () => {
          this._showSpurt = false
        })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyKilled.Killed
  // OpenRA 对照: SpiceBloom.INotifyKilled.Killed(Actor self, AttackInfo e)
  // ---------------------------------------------------------------------------

  /** On death, fire projectiles to seed spice resources.
   *
   * OpenRA 对照: SpiceBloom.INotifyKilled.Killed(Actor self, AttackInfo e)
   *
   * @param self — the actor
   * @param _attackInfo — attack info from the killing blow (not used)
   */
  killed(self: IGameActor, _attackInfo: unknown): void {
    if (this.info.weapon) {
      this.seedResources(self)
    }
  }

  // ---------------------------------------------------------------------------
  // SeedResources
  // OpenRA 对照: SpiceBloom.SeedResources(Actor self)
  // ---------------------------------------------------------------------------

  /** Fire spice-seeding projectiles in an expanding annulus.
   *
   * OpenRA 对照: SpiceBloom.SeedResources(Actor self)
   *
   * Calculates number of projectiles and range based on current growth
   * progress, then spawns projectiles via frame-end tasks.
   *
   * @param self — the actor
   */
  private seedResources(self: IGameActor): void {
    const pieces = lerpInt(
      this.info.bursts[0],
      this.info.bursts[1],
      this._ticks,
      this.growTicks,
    )
    const range = lerpInt(
      this.info.range[0],
      this.info.range[1],
      this._ticks,
      this.growTicks,
    )

    const location = this.getActorLocation(self)
    const map = this.getMap()
    if (!map) return

    // Find cells in annulus
    const cells = this.findTilesInAnnulus(map, location, 1, range)

    const resourceLayer = this.getResourceLayer(self)
    if (!resourceLayer) return

    const emptyCells = cells.filter(
      p =>
        resourceLayer.getResourceType(p) !== this.info.resourceType &&
        resourceLayer.canAddResource(this.info.resourceType, p),
    )

    const projectiles: ProjectileArgsStub[] = []
    for (let i = 0; i < pieces; i++) {
      const cell = emptyCells.length === 0
        ? this.randomCell(cells)
        : this.randomCell(emptyCells)

      if (!cell) continue

      // Create projectile args
      const weapon = this.getWeapon(self, this.info.weapon!)
      if (!weapon) continue

      const centerPos = this.getCenterPosition(self)

      projectiles.push({
        weapon,
        facing: WAngle.Zero,
        currentMuzzleFacing: () => WAngle.Zero,
        damageModifiers: [],
        inaccuracyModifiers: [],
        rangeModifiers: [],
        source: centerPos,
        currentSource: () => this.getCenterPosition(self),
        sourceActor: self,
        passiveTarget: this.cellCenter(map, cell),
      })
    }

    // Launch projectiles via frame-end task
    const burstInterval = this.info.burstInterval
    this.addFrameEndTask(self, () => {
      this.launchProjectiles(self, projectiles, burstInterval)
    })
  }

  // ---------------------------------------------------------------------------
  // Projectile launching
  // ---------------------------------------------------------------------------

  /** Launch projectiles with staggered delays using FireProjectilesEffect.
   *
   * OpenRA 对照: new FireProjectilesEffect(projectiles, burstInterval)
   */
  private launchProjectiles(
    self: IGameActor,
    projectiles: ProjectileArgsStub[],
    burstInterval: number,
  ): void {
    const world = self.world as {
      add?: (effect: unknown) => void
      remove?: (effect: unknown) => void
      screenMap?: { remove?: (effect: unknown) => void }
    } | undefined

    if (world?.add) {
      world.add(new FireProjectilesEffect(projectiles, burstInterval))
    }
  }

  // ---------------------------------------------------------------------------
  // Animation setup
  // ---------------------------------------------------------------------------

  /** Set up body and spurt animations via RenderSprites.
   *
   * OpenRA 对照: SpiceBloom constructor — body + spurt Animation creation
   *
   * Creates Animation instances backed by the world's sequence set
   * and the actor's image name (from RenderSprites.getImage).
   * Registers them with RenderSprites via AnimationWithOffset pattern.
   */
  private setupAnimations(self: IGameActor, _info: SpiceBloomInfo): void {
    const rs = this.getRenderSprites(self)
    if (!rs) return

    // Get sequence set from world (Animation factory requires it)
    const imageName = rs.getImage(self)
    const sequences = this.getSequenceSet(self)

    // Create body animation with tick-synced frame advancement
    // OpenRA 对照: body = new Animation(self.World, rs.GetImage(self))
    // NOTE: TypeScript duck-typing — Animation constructor expects ISequenceSet
    // interface; our SequenceSetStub has the same shape so the cast is safe.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._body = new Animation(
      sequences as any,
      imageName,
      () => 0, // facingFunc: spice bloom doesn't rotate
      () => self.isDead ?? false, // paused when dead
    )
    this._body.play(this.info.growthSequences[0]!)

    // Add to RenderSprites with visibility control
    // OpenRA 对照: rs.Add(new AnimationWithOffset(body, null, () => self.IsDead))
    rs.add(this._body)

    // Create spurt animation — plays once per growth stage
    // OpenRA 对照: spurt = new Animation(self.World, rs.GetImage(self))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this._spurt = new Animation(
      sequences as any,
      imageName,
      () => 0,
      () => !this._showSpurt, // paused when not spurting
    )
    rs.add(this._spurt)

    // Initialize spurt animation
    // OpenRA 对照: spurt.PlayThen(info.SpurtSequence, () => showSpurt = false)
    this._spurt.playThen(this.info.spurtSequence, () => {
      this._showSpurt = false
    })
  }

  // ---------------------------------------------------------------------------
  // Duck-typing helpers
  // ---------------------------------------------------------------------------

  /** Get the actor's cell location. */
  private getActorLocation(self: IGameActor): CPos {
    return (self as unknown as { location?: CPos }).location ?? CPos.Zero
  }

  /** Get the actor's center position. */
  private getCenterPosition(self: IGameActor): unknown /* WPos */ {
    return (self as unknown as { centerPosition?: unknown }).centerPosition
  }

  /** Get the map from the world. */
  private getMap(): MapStub | null {
    const world = this._self.world as { map?: MapStub } | undefined
    return world?.map ?? null
  }

  /** Get the shared random number generator next int. */
  private getSharedRandomNext(min: number, max: number): number {
    const world = this._self.world as Record<string, unknown> | undefined
    const sr = world?.sharedRandom as
      | { next?: (min: number, max: number) => number }
      | undefined
    if (sr?.next) return sr.next(min, max)
    return min + Math.floor(Math.random() * (max - min))
  }

  /** Get RenderSprites trait. */
  private getRenderSprites(self: IGameActor): RenderSpritesStub | null {
    const fn = (self as unknown as {
      trait?: <T>(name: string) => T | undefined
    }).trait
    return fn?.<RenderSpritesStub>('RenderSprites') ?? null
  }

  /** Get the ResourceLayer from the world actor. */
  private getResourceLayer(self: IGameActor): IResourceLayerStub | null {
    if (this._resourceLayer) return this._resourceLayer

    const world = self.world as { worldActor?: { trait?: <T>(n: string) => T | undefined } } | undefined
    this._resourceLayer = world?.worldActor?.trait?.<IResourceLayerStub>('IResourceLayer') ?? null
    return this._resourceLayer
  }

  /** Kill the actor (trigger INotifyKilled + Killed callback chain). */
  private killActor(self: IGameActor): void {
    const fn = (self as unknown as { kill?: (killer: IGameActor) => void }).kill
    fn?.(self)
  }

  /** Find tiles in an annulus (ring) around a cell. */
  private findTilesInAnnulus(
    map: MapStub,
    center: CPos,
    minRange: number,
    maxRange: number,
  ): CPos[] {
    const result: CPos[] = []
    for (let dx = -maxRange; dx <= maxRange; dx++) {
      for (let dy = -maxRange; dy <= maxRange; dy++) {
        const dist = Math.abs(dx) + Math.abs(dy) // Manhattan distance
        if (dist >= minRange && dist <= maxRange) {
          const cell = new CPos(center.X + dx, center.Y + dy)
          if (map.contains(cell)) {
            result.push(cell)
          }
        }
      }
    }
    return result
  }

  /** Pick a random cell from a list. */
  private randomCell(cells: CPos[]): CPos | null {
    if (cells.length === 0) return null
    const idx = this.getSharedRandomNext(0, cells.length)
    return cells[idx]!
  }

  /** Get weapon info from the world rules. */
  private getWeapon(self: IGameActor, weaponName: string): WeaponStub | null {
    const world = self.world as {
      map?: { rules?: { weapons?: Map<string, WeaponStub> } }
    } | undefined
    const weapons = world?.map?.rules?.weapons
    if (weapons) {
      const key = weaponName.toLowerCase()
      return weapons.get(key) ?? null
    }
    return null
  }

  /** Get the world-space center of a cell. */
  private cellCenter(map: MapStub, cell: CPos): unknown /* WPos */ {
    if (typeof map.centerOfCell === 'function') {
      return map.centerOfCell(cell)
    }
    // Fallback: calculate from cell coordinates
    return new WVec(cell.X * 1024 + 512, cell.Y * 1024 + 512, 0)
  }

  /** Get the sequence set from the world (for Animation construction).
   *
   * OpenRA 对照: self.World.Map.Sequences
   */
  private getSequenceSet(self: IGameActor): SequenceSetStub {
    const world = self.world as {
      map?: { sequences?: SequenceSetStub }
    } | undefined
    const defaultSeq: SequenceSetStub = {
      hasSequence: () => false,
      getSequence: () => ({
        name: 'empty',
        length: 0,
        tick: 40,
        scale: 1,
        zOffset: 0,
        shadowZOffset: 0,
        ignoreWorldTint: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        getSprite: () => null,
        getSpriteWithRotation: () => ({ sprite: null, rotation: 0 }),
        getAlpha: () => 1,
        getShadow: () => null,
      }),
    }
    return world?.map?.sequences ?? defaultSeq
  }

  /** Add a frame-end task. */
  private addFrameEndTask(self: IGameActor, task: () => void): void {
    const world = self.world as {
      addFrameEndTask?: (task: () => void) => void
    } | undefined
    world?.addFrameEndTask?.(task)
  }

}

// ---------------------------------------------------------------------------
// FireProjectilesEffect
// OpenRA 对照: SpiceBloom.FireProjectilesEffect : IEffect
// ---------------------------------------------------------------------------

/** Fires projectiles one by one with a delay between each burst.
 *
 * OpenRA 对照: SpiceBloom.FireProjectilesEffect (inner class, IEffect)
 *
 * Uses a stack-based approach: pops one projectile per burst, with
 * `burstInterval` ticks between each pop. When the stack is empty,
 * self-removes from the world.
 */
class FireProjectilesEffect {
  private readonly _projectiles: ProjectileArgsStub[]
  private _delay: number
  private readonly _delayInfo: number

  /**
   * OpenRA 对照: FireProjectilesEffect(Stack<ProjectileArgs>, int delayInfo)
   */
  constructor(projectiles: ProjectileArgsStub[], delayInfo: number) {
    this._projectiles = [...projectiles] // copy to reverse for stack-like pop
    this._delay = delayInfo
    this._delayInfo = delayInfo
  }

  /** Execute one tick: decrement delay, fire next projectile when ready.
   *
   * OpenRA 对照: FireProjectilesEffect.Tick(World)
   *
   * When projectiles are exhausted, self-removes from world.
   */
  tick(world: {
    addFrameEndTask?: (task: (w: unknown) => void) => void
    remove?: (effect: unknown) => void
    screenMap?: { remove?: (effect: unknown) => void }
    add?: (effect: unknown) => void
    game?: { sound?: { play?: (type: string, sound: string, pos: unknown) => void } }
  }): void {
    if (this._projectiles.length === 0) {
      world.addFrameEndTask?.(w => {
        ;(w as { remove?: (e: unknown) => void }).remove?.(this)
        ;(w as { screenMap?: { remove?: (e: unknown) => void } }).screenMap?.remove?.(this)
      })
      return
    }

    if (--this._delay > 0) return

    this._delay = this._delayInfo
    const args = this._projectiles.pop()!
    const weapon = args.weapon

    if (weapon.projectile) {
      const projectile = weapon.projectile.create?.(args)
      if (projectile) {
        world.addFrameEndTask?.(w => {
          ;(w as { add?: (e: unknown) => void }).add?.(projectile)
        })
      }

      if (weapon.report && weapon.report.length > 0) {
        world.game?.sound?.play?.('World', weapon.report, args.source)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Stub interfaces
// ---------------------------------------------------------------------------

/** Stub for map. */
interface MapStub {
  contains(cell: CPos): boolean
  getTerrainInfo(cell: CPos): { type: string } | null
  centerOfCell?(cell: CPos): unknown
}

/** Stub for resource layer. */
interface IResourceLayerStub {
  getResourceType(cell: CPos): string | null
  canAddResource(type: string, cell: CPos): boolean
}

/** Stub for weapon info. */
interface WeaponStub {
  projectile?: { create?: (args: unknown) => unknown } | null
  report?: string
}

/** Stub for projectile args. */
interface ProjectileArgsStub {
  weapon: WeaponStub
  facing: WAngle
  currentMuzzleFacing: () => WAngle
  damageModifiers: number[]
  inaccuracyModifiers: number[]
  rangeModifiers: number[]
  source: unknown
  currentSource: () => unknown
  sourceActor: IGameActor
  passiveTarget: unknown
}
