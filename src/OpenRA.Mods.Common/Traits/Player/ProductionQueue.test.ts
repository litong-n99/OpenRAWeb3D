/**
 * ProductionQueue.test.ts — ProductionQueue, ProductionItem, ProductionState unit tests
 *
 * Tests focus on:
 * - ProductionQueueInfo defaults and custom constructor params
 * - ProductionState visibility/buildable toggles
 * - ProductionItem tick progression, cost deduction, pause, done state
 * - ProductionQueue queue management: canQueue, add, cancel, pause
 * - Build time calculation with modifiers
 * - Cost calculation
 * - Low power slowdown
 * - TechTree integration (prerequisites available/unavailable)
 * - Owner change handling
 * - Killed/sold/transform handling
 * - Infinite build loop
 * - AllTech / FastBuild cheat modes
 * - Edge cases: empty queue, zero cost, zero time
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ProductionQueue,
  ProductionQueueInfo,
  ProductionItem,
  ProductionState,
} from './ProductionQueue'
import { BuildableInfo } from '../Buildable'
import { TechTree } from './TechTree'
import { PlayerResources, PlayerResourcesInfo } from './PlayerResources'
import { PowerManager, PowerManagerInfo, PowerState } from './PowerManager'
import { DeveloperMode, DeveloperModeInfo } from './DeveloperMode'
import { Production, ProductionInfo } from '../Production'
import type { IGameActor, PlayerStub, ActorInfoStub, AttackInfo, Order } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a ProductionQueueInfo with explicit defaults. */
function createQueueInfo(overrides: Partial<{
  type: string
  displayOrder: number
  group: string | null
  factions: ReadonlySet<string> | readonly string[]
  sticky: boolean
  payUpFront: boolean
  disallowPaused: boolean
  buildDurationModifier: number
  itemLimit: number
  queueLimit: number
  lowPowerModifier: number
  infiniteBuildLimit: number
  readyAudio: string | null
  blockedAudio: string | null
  limitedAudio: string | null
  queuedAudio: string | null
  onHoldAudio: string | null
  cancelledAudio: string | null
}> = {}): ProductionQueueInfo {
  return new ProductionQueueInfo(overrides)
}

/** Create a minimal IGameActor for testing. */
function createActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: overrides.actorId ?? 1,
    isInWorld: overrides.isInWorld ?? true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
    owner: overrides.owner,
    world: overrides.world,
    info: overrides.info,
    ...overrides,
  } as IGameActor
}

/** Create a minimal PlayerStub. */
function createPlayer(name: string = 'player1'): PlayerStub {
  return { playerName: name }
}

/** Create an ActorInfoStub with optional BuildableInfo and cost. */
function createActorInfo(name: string, buildableInfo?: BuildableInfo, cost?: number): ActorInfoStub {
  const info: ActorInfoStub = { name }
  if (buildableInfo !== undefined || cost !== undefined) {
    const extended = info as unknown as Record<string, unknown>
    if (buildableInfo !== undefined) extended._buildableInfo = buildableInfo
    if (cost !== undefined) extended._cost = cost
  }
  return info
}

/** Create a ProductionInfo. */
function createProductionInfo(produces: readonly string[] = ['Vehicle']): ProductionInfo {
  return new ProductionInfo({ produces })
}

/** Create a Production trait stub. */
function createProduction(overrides: Partial<{
  isTraitDisabled: boolean
  isTraitPaused: boolean
  info: ProductionInfo
}> = {}): Production {
  const info = overrides.info ?? createProductionInfo()
  const prod = new Production(info)
  if (overrides.isTraitDisabled !== undefined) {
    prod.isTraitDisabled = overrides.isTraitDisabled
  }
  if (overrides.isTraitPaused !== undefined) {
    prod.isTraitPaused = overrides.isTraitPaused
  }
  return prod
}

/** Create a fully wired ProductionQueue for testing. */
function createTestQueue(
  info: ProductionQueueInfo,
  actor: IGameActor,
  options: {
    playerResources?: PlayerResources
    powerManager?: PowerManager
    developerMode?: DeveloperMode
    techTree?: TechTree
    productionTraits?: Production[]
    rulesActors?: Map<string, ActorInfoStub>
    faction?: string
  } = {},
): ProductionQueue {
  const queue = new ProductionQueue(
    actor,
    info,
    options.faction ?? 'allies',
    options.rulesActors ?? new Map(),
  )
  queue.setPlayerResources(options.playerResources ?? null)
  queue.setPowerManager(options.powerManager ?? null)
  queue.setDeveloperMode(options.developerMode ?? null)
  queue.setTechTree(options.techTree ?? null)
  queue.setProductionTraits(options.productionTraits ?? [])
  if (options.rulesActors) {
    queue.setRulesActors(options.rulesActors)
  }
  return queue
}

// ---------------------------------------------------------------------------
// ProductionQueueInfo
// ---------------------------------------------------------------------------

describe('ProductionQueueInfo', () => {
  it('has default type as empty string', () => {
    const info = createQueueInfo()
    expect(info.type).toBe('')
  })

  it('accepts custom type', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    expect(info.type).toBe('Vehicle')
  })

  it('defaults displayOrder to 0', () => {
    const info = createQueueInfo()
    expect(info.displayOrder).toBe(0)
  })

  it('defaults group to null', () => {
    const info = createQueueInfo()
    expect(info.group).toBeNull()
  })

  it('defaults factions to empty set', () => {
    const info = createQueueInfo()
    expect(info.factions.size).toBe(0)
  })

  it('accepts factions as string array', () => {
    const info = createQueueInfo({ factions: ['allies', 'soviet'] })
    expect(info.factions.has('allies')).toBe(true)
    expect(info.factions.has('soviet')).toBe(true)
  })

  it('defaults sticky to true', () => {
    const info = createQueueInfo()
    expect(info.sticky).toBe(true)
  })

  it('defaults payUpFront to false', () => {
    const info = createQueueInfo()
    expect(info.payUpFront).toBe(false)
  })

  it('defaults disallowPaused to false', () => {
    const info = createQueueInfo()
    expect(info.disallowPaused).toBe(false)
  })

  it('defaults buildDurationModifier to 100', () => {
    const info = createQueueInfo()
    expect(info.buildDurationModifier).toBe(100)
  })

  it('defaults itemLimit to 999', () => {
    const info = createQueueInfo()
    expect(info.itemLimit).toBe(999)
  })

  it('defaults queueLimit to 0', () => {
    const info = createQueueInfo()
    expect(info.queueLimit).toBe(0)
  })

  it('defaults lowPowerModifier to 100', () => {
    const info = createQueueInfo()
    expect(info.lowPowerModifier).toBe(100)
  })

  it('defaults infiniteBuildLimit to -1', () => {
    const info = createQueueInfo()
    expect(info.infiniteBuildLimit).toBe(-1)
  })

  it('defaults all audio notifications to null', () => {
    const info = createQueueInfo()
    expect(info.readyAudio).toBeNull()
    expect(info.blockedAudio).toBeNull()
    expect(info.limitedAudio).toBeNull()
    expect(info.queuedAudio).toBeNull()
    expect(info.onHoldAudio).toBeNull()
    expect(info.cancelledAudio).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ProductionState
// ---------------------------------------------------------------------------

describe('ProductionState', () => {
  it('defaults visible to true', () => {
    const state = new ProductionState()
    expect(state.visible).toBe(true)
  })

  it('defaults buildable to false', () => {
    const state = new ProductionState()
    expect(state.buildable).toBe(false)
  })

  it('can toggle visible', () => {
    const state = new ProductionState()
    state.visible = false
    expect(state.visible).toBe(false)
  })

  it('can toggle buildable', () => {
    const state = new ProductionState()
    state.buildable = true
    expect(state.buildable).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ProductionItem
// ---------------------------------------------------------------------------

describe('ProductionItem', () => {
  let queue: ProductionQueue
  let queueInfo: ProductionQueueInfo
  let actor: IGameActor
  let prInfo: PlayerResourcesInfo
  let pr: PlayerResources
  let bi: BuildableInfo
  let actorInfo: ActorInfoStub

  beforeEach(() => {
    queueInfo = createQueueInfo({ type: 'Vehicle' })
    actor = createActor()
    prInfo = new PlayerResourcesInfo({ defaultCash: 5000 })
    pr = new PlayerResources(prInfo)
    pr.cash = 5000
    bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 10, buildDurationModifier: 100 })
    actorInfo = createActorInfo('tank', bi, 500)
    queue = createTestQueue(queueInfo, actor, { playerResources: pr })
  })

  function createItem(cost: number = 500, pm: PowerManager | null = null): ProductionItem {
    return new ProductionItem(queue, 'tank', cost, pm, null, actorInfo, bi)
  }

  it('initializes with correct values', () => {
    const item = createItem(500)
    expect(item.item).toBe('tank')
    expect(item.totalCost).toBe(500)
    expect(item.remainingCost).toBe(500)
    expect(item.totalTime).toBe(1)
    expect(item.remainingTime).toBe(1)
    expect(item.resourcesPaid).toBe(0)
    expect(item.paused).toBe(false)
    expect(item.done).toBe(false)
    expect(item.started).toBe(false)
    expect(item.infinite).toBe(false)
  })

  it('computes buildPaletteOrder from BuildableInfo', () => {
    const bi2 = new BuildableInfo({ queue: new Set(['Vehicle']), buildPaletteOrder: 42 })
    const ai2 = createActorInfo('tank2', bi2, 100)
    const item = new ProductionItem(queue, 'tank2', 100, null, null, ai2, bi2)
    expect(item.buildPaletteOrder).toBe(42)
  })

  it('sets totalTime on first tick', () => {
    const item = createItem(500)
    expect(item.started).toBe(false)
    item.tick(pr)
    expect(item.started).toBe(true)
    expect(item.totalTime).toBe(10)
    // First tick initializes AND decrements, so remainingTime = 9
    expect(item.remainingTime).toBe(9)
  })

  it('advances remainingTime each tick', () => {
    const item = createItem(500)
    item.tick(pr) // initializes (totalTime=10, remainingTime=9)
    expect(item.remainingTime).toBe(9)
    item.tick(pr)
    expect(item.remainingTime).toBe(8)
  })

  it('sets done when remainingTime reaches 0', () => {
    const item = createItem(500)
    item.tick(pr) // initializes
    for (let i = 0; i < 10; i++) {
      item.tick(pr)
    }
    expect(item.done).toBe(true)
    expect(item.remainingTime).toBe(0)
  })

  it('does not advance when paused', () => {
    const item = createItem(500)
    item.tick(pr) // initializes
    item.pause(true)
    expect(item.paused).toBe(true)
    const before = item.remainingTime
    item.tick(pr)
    expect(item.remainingTime).toBe(before)
  })

  it('calls onComplete when done', () => {
    let called = false
    const item = new ProductionItem(queue, 'tank', 500, null, () => { called = true }, actorInfo, bi)
    item.tick(pr) // initializes
    for (let i = 0; i < 10; i++) {
      item.tick(pr)
    }
    expect(item.done).toBe(true)
    item.tick(pr) // triggers onComplete
    expect(called).toBe(true)
  })

  it('deducts per-tick cost when not PayUpFront', () => {
    queueInfo = createQueueInfo({ type: 'Vehicle', payUpFront: false })
    queue = createTestQueue(queueInfo, actor, { playerResources: pr })
    const item = new ProductionItem(queue, 'tank', 100, null, null, actorInfo, bi)
    item.tick(pr) // initializes (10 ticks)
    const initialCash = pr.cash
    item.tick(pr) // first real tick
    // Cost per tick = 100 / 10 = 10 (approx)
    expect(pr.cash).toBeLessThan(initialCash)
  })

  it('does not deduct cost when PayUpFront', () => {
    queueInfo = createQueueInfo({ type: 'Vehicle', payUpFront: true })
    queue = createTestQueue(queueInfo, actor, { playerResources: pr })
    const item = new ProductionItem(queue, 'tank', 100, null, null, actorInfo, bi)
    pr.cash = 5000
    item.tick(pr) // initializes
    const initialCash = pr.cash
    item.tick(pr)
    // With payUpFront, remainingCost is already 0, so no deduction
    expect(pr.cash).toBe(initialCash)
  })

  it('computes remainingTimeActual correctly with normal power', () => {
    const pm = new PowerManager(new PowerManagerInfo())
    const item = createItem(500, pm)
    item.tick(pr) // initializes
    expect(item.remainingTimeActual).toBe(item.remainingTime)
  })

  it('computes remainingTimeActual with low power', () => {
    const pmInfo = new PowerManagerInfo()
    const pm = new PowerManager(pmInfo)
    // Stub: override powerState to Low
    Object.defineProperty(pm, 'powerState', { get: () => PowerState.Low })
    queueInfo = createQueueInfo({ type: 'Vehicle', lowPowerModifier: 200 })
    queue = createTestQueue(queueInfo, actor, { playerResources: pr, powerManager: pm })
    const item = new ProductionItem(queue, 'tank', 500, pm, null, actorInfo, bi)
    item.tick(pr) // initializes
    expect(item.remainingTimeActual).toBe(Math.floor(item.remainingTime * 200 / 100))
  })

  it('applies low power slowdown during tick', () => {
    const pmInfo = new PowerManagerInfo()
    const pm = new PowerManager(pmInfo)
    Object.defineProperty(pm, 'powerState', { get: () => PowerState.Low })
    queueInfo = createQueueInfo({ type: 'Vehicle', lowPowerModifier: 200 })
    queue = createTestQueue(queueInfo, actor, { playerResources: pr, powerManager: pm })
    const item = new ProductionItem(queue, 'tank', 500, pm, null, actorInfo, bi)
    item.tick(pr) // initializes
    const before = item.remainingTime
    item.tick(pr)
    // With LowPowerModifier=200, every other tick is skipped
    // First tick: slowdown = 200 - 100 = 100 > 0, so return (no progress)
    expect(item.remainingTime).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// ProductionQueue — initialization and queries
// ---------------------------------------------------------------------------

describe('ProductionQueue', () => {
  let actor: IGameActor
  let prInfo: PlayerResourcesInfo
  let pr: PlayerResources
  let pm: PowerManager
  let dm: DeveloperMode
  let tt: TechTree
  let player: PlayerStub

  beforeEach(() => {
    actor = createActor()
    prInfo = new PlayerResourcesInfo({ defaultCash: 5000 })
    pr = new PlayerResources(prInfo)
    pr.cash = 5000
    pm = new PowerManager(new PowerManagerInfo())
    dm = new DeveloperMode(new DeveloperModeInfo())
    player = createPlayer('player1')
    tt = new TechTree(player)
  })

  function createQueue(
    info: ProductionQueueInfo,
    options: Partial<Parameters<typeof createTestQueue>[2]> = {},
  ): ProductionQueue {
    return createTestQueue(info, actor, {
      playerResources: pr,
      powerManager: pm,
      developerMode: dm,
      techTree: tt,
      ...options,
    })
  }

  it('initializes with correct defaults', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    expect(queue.info).toBe(info)
    expect(queue.actor).toBe(actor)
    expect(queue.enabled).toBe(true)
    expect(queue.faction).toBe('allies')
    expect(queue.isValidFaction).toBe(true)
    expect(queue.queue.length).toBe(0)
    expect(queue.producible.size).toBe(0)
  })

  it('is disabled when faction does not match', () => {
    const info = createQueueInfo({ type: 'Vehicle', factions: ['soviet'] })
    const queue = createQueue(info, { faction: 'allies' })
    expect(queue.isValidFaction).toBe(false)
    expect(queue.enabled).toBe(false)
  })

  it('is enabled when faction matches', () => {
    const info = createQueueInfo({ type: 'Vehicle', factions: ['allies'] })
    const queue = createQueue(info, { faction: 'allies' })
    expect(queue.isValidFaction).toBe(true)
    expect(queue.enabled).toBe(true)
  })

  it('is enabled when factions is empty (any faction)', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info, { faction: 'any' })
    expect(queue.isValidFaction).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------

  it('currentItem returns null when queue is empty', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    expect(queue.currentItem()).toBeNull()
  })

  it('allQueued returns empty array when queue is empty', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    expect(queue.allQueued()).toEqual([])
  })

  it('isInQueue returns false for empty queue', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const ai = createActorInfo('tank')
    expect(queue.isInQueue(ai)).toBe(false)
  })

  it('canBuild returns false for unknown actor', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const ai = createActorInfo('tank')
    expect(queue.canBuild(ai)).toBe(false)
  })

  it('anyItemsToBuild returns false for empty queue with no buildables', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    expect(queue.anyItemsToBuild()).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // canQueue validation
  // ---------------------------------------------------------------------------

  it('canQueue returns true for valid actor', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    const result = queue.canQueue(ai)
    expect(result.canQueue).toBe(true)
    expect(result.notificationAudio).toBe(info.queuedAudio)
  })

  it('canQueue returns false for actor without BuildableInfo', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const ai = createActorInfo('tank')
    const result = queue.canQueue(ai)
    expect(result.canQueue).toBe(false)
  })

  it('canQueue returns false when queue limit reached', () => {
    const info = createQueueInfo({ type: 'Vehicle', queueLimit: 2 })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    // Add items to fill queue
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    const result = queue.canQueue(ai)
    expect(result.canQueue).toBe(false)
    expect(result.notificationAudio).toBe(info.limitedAudio)
  })

  it('canQueue returns false when item limit reached', () => {
    const info = createQueueInfo({ type: 'Vehicle', itemLimit: 2 })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    const result = queue.canQueue(ai)
    expect(result.canQueue).toBe(false)
    expect(result.notificationAudio).toBe(info.limitedAudio)
  })

  it('canQueue returns false when payUpFront and not affordable', () => {
    const info = createQueueInfo({ type: 'Vehicle', payUpFront: true })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 10000)
    pr.cash = 1000
    const result = queue.canQueue(ai)
    expect(result.canQueue).toBe(false)
  })

  it('canQueue returns true with allTech enabled regardless of cost', () => {
    const info = createQueueInfo({ type: 'Vehicle', payUpFront: true })
    const dmAllTech = new DeveloperMode(new DeveloperModeInfo())
    dmAllTech.enabled = true
    ;(dmAllTech as any)._allTech = true
    const queue = createQueue(info, { developerMode: dmAllTech })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 10000)
    pr.cash = 1000
    const result = queue.canQueue(ai)
    expect(result.canQueue).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Build time calculation
  // ---------------------------------------------------------------------------

  it('getBuildTime returns 0 when fastBuild is enabled', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const dmFast = new DeveloperMode(new DeveloperModeInfo({ fastBuild: true }))
    dmFast.enabled = true
    const queue = createQueue(info, { developerMode: dmFast })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100 })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.getBuildTime(ai, bi)).toBe(0)
  })

  it('getBuildTime uses buildDuration when set', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.getBuildTime(ai, bi)).toBe(100)
  })

  it('getBuildTime uses cost when buildDuration is -1', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: -1, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.getBuildTime(ai, bi)).toBe(500)
  })

  it('getBuildTime applies buildDurationModifier from BuildableInfo', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 50 })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.getBuildTime(ai, bi)).toBe(50)
  })

  it('getBuildTime applies buildDurationModifier from QueueInfo', () => {
    const info = createQueueInfo({ type: 'Vehicle', buildDurationModifier: 50 })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.getBuildTime(ai, bi)).toBe(50)
  })

  it('getBuildTime applies both modifiers', () => {
    const info = createQueueInfo({ type: 'Vehicle', buildDurationModifier: 50 })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 50 })
    const ai = createActorInfo('tank', bi, 500)
    // 100 * 50/100 * 50/100 = 25
    expect(queue.getBuildTime(ai, bi)).toBe(25)
  })

  // ---------------------------------------------------------------------------
  // Tick logic
  // ---------------------------------------------------------------------------

  it('tick clears queue when all production traits disabled', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ isTraitDisabled: true })
    const queue = createQueue(info, { productionTraits: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.tick(actor)
    expect(queue.queue.length).toBe(0)
    expect(queue.enabled).toBe(false)
  })

  it('tick advances queue when production traits enabled', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { productionTraits: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.tick(actor)
    expect(queue.queue.length).toBe(1)
    expect(queue.queue[0].started).toBe(true)
  })

  it('tick does not advance when all production traits paused', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ isTraitDisabled: false, isTraitPaused: true })
    const queue = createQueue(info, { productionTraits: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.queue[0].tick(pr) // initialize
    const before = queue.queue[0].remainingTime
    queue.tick(actor)
    expect(queue.queue[0].remainingTime).toBe(before)
  })

  // ---------------------------------------------------------------------------
  // Lifecycle notifications
  // ---------------------------------------------------------------------------

  it('killed clears queue and disables', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.killed(actor, {} as AttackInfo)
    expect(queue.queue.length).toBe(0)
    expect(queue.enabled).toBe(false)
  })

  it('selling clears queue and disables', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.selling(actor)
    expect(queue.queue.length).toBe(0)
    expect(queue.enabled).toBe(false)
  })

  it('beforeTransform clears queue and disables', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.beforeTransform(actor)
    expect(queue.queue.length).toBe(0)
    expect(queue.enabled).toBe(false)
  })

  it('onOwnerChanged clears queue', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    const newOwner = createPlayer('player2')
    queue.onOwnerChanged(actor, player, newOwner)
    expect(queue.queue.length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // TechTree integration
  // ---------------------------------------------------------------------------

  it('prerequisitesAvailable sets buildable to true', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    queue.producible.set('tank', new ProductionState())
    queue.prerequisitesAvailable('tank')
    expect(queue.producible.get('tank')?.buildable).toBe(true)
  })

  it('prerequisitesUnavailable sets buildable to false', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const state = new ProductionState()
    state.buildable = true
    queue.producible.set('tank', state)
    queue.prerequisitesUnavailable('tank')
    expect(queue.producible.get('tank')?.buildable).toBe(false)
  })

  it('prerequisitesItemHidden sets visible to false', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    queue.producible.set('tank', new ProductionState())
    queue.prerequisitesItemHidden('tank')
    expect(queue.producible.get('tank')?.visible).toBe(false)
  })

  it('prerequisitesItemVisible sets visible to true', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const state = new ProductionState()
    state.visible = false
    queue.producible.set('tank', state)
    queue.prerequisitesItemVisible('tank')
    expect(queue.producible.get('tank')?.visible).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // BuildableItems / AllItems with AllTech
  // ---------------------------------------------------------------------------

  it('allItems returns empty when all production traits disabled', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ isTraitDisabled: true })
    const queue = createQueue(info, { productionTraits: [prod] })
    expect(queue.allItems()).toEqual([])
  })

  it('allItems returns all producible keys when allTech enabled', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const dmAllTech = new DeveloperMode(new DeveloperModeInfo())
    dmAllTech.enabled = true
    ;(dmAllTech as any)._allTech = true
    const queue = createQueue(info, { developerMode: dmAllTech })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.setRulesActors(new Map([['tank', ai]]))
    const items = queue.allItems()
    expect(items.length).toBe(1)
    expect(items[0].name).toBe('tank')
  })

  it('buildableItems returns empty when disabled', () => {
    // Disable by setting faction invalid
    const info2 = createQueueInfo({ type: 'Vehicle', factions: ['soviet'] })
    const queue2 = createQueue(info2, { faction: 'allies' })
    expect(queue2.buildableItems()).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Cancel unbuildable items
  // ---------------------------------------------------------------------------

  it('cancelUnbuildableItems removes items no longer buildable', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    // Make it not buildable
    queue.producible.get('tank')!.buildable = false
    queue['_cancelUnbuildableItems']()
    expect(queue.queue.length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // mostLikelyProducer
  // ---------------------------------------------------------------------------

  it('mostLikelyProducer returns null when no traits', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    expect(queue.mostLikelyProducer()).toBeNull()
  })

  it('mostLikelyProducer returns first non-disabled trait', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const prod1 = createProduction({ isTraitDisabled: true })
    const prod2 = createProduction({ isTraitDisabled: false })
    const queue = createQueue(info, { productionTraits: [prod1, prod2] })
    expect(queue.mostLikelyProducer()).toBe(prod2)
  })

  it('mostLikelyProducer prefers non-paused over paused', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const prod1 = createProduction({ isTraitDisabled: false, isTraitPaused: true })
    const prod2 = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { productionTraits: [prod1, prod2] })
    expect(queue.mostLikelyProducer()).toBe(prod2)
  })

  it('mostLikelyProducer filters by queue type', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const prod1 = createProduction({ info: createProductionInfo(['Infantry']) })
    const prod2 = createProduction({ info: createProductionInfo(['Vehicle']) })
    const queue = createQueue(info, { productionTraits: [prod1, prod2] })
    expect(queue.mostLikelyProducer()).toBe(prod2)
  })

  // ---------------------------------------------------------------------------
  // Queue manipulation: resolveOrder
  // ---------------------------------------------------------------------------

  it('resolveOrder StartProduction adds item to queue', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.resolveOrder(actor, {
      orderName: 'StartProduction',
      targetString: 'tank',
      extraData: 1,
    } as Order)
    expect(queue.queue.length).toBe(1)
    expect(queue.queue[0].item).toBe('tank')
  })

  it('resolveOrder PauseProduction pauses item', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.resolveOrder(actor, {
      orderName: 'PauseProduction',
      targetString: 'tank',
      extraData: true,
    } as Order)
    expect(queue.queue[0].paused).toBe(true)
  })

  it('resolveOrder CancelProduction removes item', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.resolveOrder(actor, {
      orderName: 'CancelProduction',
      targetString: 'tank',
      extraData: 1,
    } as Order)
    expect(queue.queue.length).toBe(0)
  })

  it('resolveOrder ignores when queue is disabled', () => {
    // Disable by setting faction invalid
    const info2 = createQueueInfo({ type: 'Vehicle', factions: ['soviet'] })
    const queue2 = createQueue(info2, { faction: 'allies' })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue2.producible.set('tank', new ProductionState())
    queue2.producible.get('tank')!.buildable = true
    queue2.setRulesActors(new Map([['tank', ai]]))
    queue2.resolveOrder(actor, {
      orderName: 'StartProduction',
      targetString: 'tank',
      extraData: 1,
    } as Order)
    expect(queue2.queue.length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Infinite build loop
  // ---------------------------------------------------------------------------

  it('beginProduction marks first item infinite when over limit', () => {
    const info = createQueueInfo({ type: 'Vehicle', infiniteBuildLimit: 2, payUpFront: false })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    // Adding a 4th should trigger infinite on first and remove extras
    queue['_beginProduction'](new ProductionItem(queue, 'tank', 500, null, null, ai, bi), false)
    expect(queue.queue[0].infinite).toBe(true)
    // The extras should be removed (only the first + the new one, but new one is removed)
    expect(queue.queue.length).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // Refund on cancel
  // ---------------------------------------------------------------------------

  it('cancelProduction refunds cash', () => {
    const info = createQueueInfo({ type: 'Vehicle', payUpFront: true })
    const queue = createQueue(info)
    pr.cash = 5000
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    const item = new ProductionItem(queue, 'tank', 500, null, null, ai, bi)
    queue.queue.push(item)
    // Simulate pay-up-front deduction
    pr.takeCash(500)
    item.remainingCost = 0
    queue['_cancelProduction']('tank', 1)
    expect(pr.cash).toBe(5000) // refunded
    expect(queue.queue.length).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Pay up front
  // ---------------------------------------------------------------------------

  it('beginProduction deducts cash when payUpFront', () => {
    const info = createQueueInfo({ type: 'Vehicle', payUpFront: true })
    const queue = createQueue(info)
    pr.cash = 5000
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    const item = new ProductionItem(queue, 'tank', 500, null, null, ai, bi)
    queue['_beginProduction'](item, false)
    expect(pr.cash).toBe(4500)
    expect(item.remainingCost).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('handles empty queue gracefully', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    queue.tick(actor)
    expect(queue.queue.length).toBe(0)
  })

  it('isProducing returns false for item not in queue', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    const item = new ProductionItem(queue, 'tank', 500, null, null, ai, bi)
    expect(queue.isProducing(item)).toBe(false)
  })

  it('isProducing returns true for first item', () => {
    const info = createQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    const item = new ProductionItem(queue, 'tank', 500, null, null, ai, bi)
    queue.queue.push(item)
    expect(queue.isProducing(item)).toBe(true)
  })
})
