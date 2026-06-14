/**
 * ClassicProductionQueue.test.ts — ClassicProductionQueue migration unit tests
 *
 * Tests focus on:
 * - ClassicProductionQueueInfo defaults and inheritance from ProductionQueueInfo
 * - Speed-up build time reduction with multiple factories
 * - allItems/buildableItems return empty when disabled
 * - getBuildTime with BuildTimeSpeedReduction table
 * - Edge cases: 0 producers, 1 producer, max producers, speedUp disabled
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ClassicProductionQueue, ClassicProductionQueueInfo } from './ClassicProductionQueue'
import { ProductionQueue, ProductionItem, ProductionState } from './ProductionQueue'
import { BuildableInfo } from '../Buildable'
import { PlayerResources, PlayerResourcesInfo } from './PlayerResources'
import { PowerManager, PowerManagerInfo } from './PowerManager'
import { DeveloperMode, DeveloperModeInfo } from './DeveloperMode'
import { Production, ProductionInfo } from '../Production'
import type { IGameActor, ActorInfoStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createActorInfo(name: string, buildableInfo?: BuildableInfo, cost?: number): ActorInfoStub {
  const info: ActorInfoStub = { name }
  if (buildableInfo !== undefined || cost !== undefined) {
    const extended = info as unknown as Record<string, unknown>
    if (buildableInfo !== undefined) extended._buildableInfo = buildableInfo
    if (cost !== undefined) extended._cost = cost
  }
  return info
}

function createActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: overrides.actorId ?? 1,
    isInWorld: overrides.isInWorld ?? true,
    isDead: overrides.isDead ?? false,
    disposed: overrides.disposed ?? false,
    ...overrides,
  } as IGameActor
}

function createProductionInfo(produces: readonly string[] = ['Vehicle']): ProductionInfo {
  return new ProductionInfo({ produces })
}

function createProduction(overrides: Partial<{
  isTraitDisabled: boolean
  isTraitPaused: boolean
  info: ProductionInfo
}> = {}): Production {
  const info = overrides.info ?? createProductionInfo()
  const prod = new Production(info)
  if (overrides.isTraitDisabled !== undefined) prod.isTraitDisabled = overrides.isTraitDisabled
  if (overrides.isTraitPaused !== undefined) prod.isTraitPaused = overrides.isTraitPaused
  return prod
}

function createClassicQueue(
  info: ClassicProductionQueueInfo,
  actor: IGameActor,
  options: {
    playerResources?: PlayerResources
    powerManager?: PowerManager
    developerMode?: DeveloperMode
    worldProductions?: Production[]
    productionTraits?: Production[]
    rulesActors?: Map<string, ActorInfoStub>
    faction?: string
  } = {},
): ClassicProductionQueue {
  const queue = new ClassicProductionQueue(
    actor,
    info,
    options.faction ?? 'allies',
    options.rulesActors ?? new Map(),
  )
  queue.setPlayerResources(options.playerResources ?? null)
  queue.setPowerManager(options.powerManager ?? null)
  queue.setDeveloperMode(options.developerMode ?? null)
  queue.setProductionTraits(options.productionTraits ?? [])
  queue.setWorldProductions(options.worldProductions ?? [])
  if (options.rulesActors) queue.setRulesActors(options.rulesActors)
  return queue
}

// ---------------------------------------------------------------------------
// ClassicProductionQueueInfo
// ---------------------------------------------------------------------------

describe('ClassicProductionQueueInfo', () => {
  it('inherits defaults from ProductionQueueInfo', () => {
    const info = new ClassicProductionQueueInfo()
    expect(info.type).toBe('')
    expect(info.buildDurationModifier).toBe(100)
    expect(info.itemLimit).toBe(999)
  })

  it('defaults speedUp to false', () => {
    const info = new ClassicProductionQueueInfo()
    expect(info.speedUp).toBe(false)
  })

  it('defaults buildTimeSpeedReduction to [100, 86, 75, 67, 60, 55, 50]', () => {
    const info = new ClassicProductionQueueInfo()
    expect(info.buildTimeSpeedReduction).toEqual([100, 86, 75, 67, 60, 55, 50])
  })

  it('accepts custom buildTimeSpeedReduction', () => {
    const info = new ClassicProductionQueueInfo({ buildTimeSpeedReduction: [100, 80, 60] })
    expect(info.buildTimeSpeedReduction).toEqual([100, 80, 60])
  })

  it('accepts custom speedUp', () => {
    const info = new ClassicProductionQueueInfo({ speedUp: true })
    expect(info.speedUp).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ClassicProductionQueue — speed-up build time
// ---------------------------------------------------------------------------

describe('ClassicProductionQueue', () => {
  let actor: IGameActor
  let pr: PlayerResources
  let pm: PowerManager
  let dm: DeveloperMode

  beforeEach(() => {
    actor = createActor()
    const prInfo = new PlayerResourcesInfo({ defaultCash: 5000 })
    pr = new PlayerResources(prInfo)
    pr.cash = 5000
    pm = new PowerManager(new PowerManagerInfo())
    dm = new DeveloperMode(new DeveloperModeInfo())
  })

  function createQueue(
    info: ClassicProductionQueueInfo,
    options: Partial<Parameters<typeof createClassicQueue>[2]> = {},
  ): ClassicProductionQueue {
    return createClassicQueue(info, actor, {
      playerResources: pr,
      powerManager: pm,
      developerMode: dm,
      ...options,
    })
  }

  it('getBuildTime returns base time when speedUp is disabled', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: false })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.getBuildTime(ai, bi)).toBe(100)
  })

  it('getBuildTime applies speed reduction with 1 producer', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: true })
    const prod = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { worldProductions: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    // 1 producer → index 0 → 100% → 100 ticks
    expect(queue.getBuildTime(ai, bi)).toBe(100)
  })

  it('getBuildTime applies speed reduction with 2 producers', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: true })
    const prod1 = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const prod2 = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { worldProductions: [prod1, prod2] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    // 2 producers → index 1 → 86% → 86 ticks
    expect(queue.getBuildTime(ai, bi)).toBe(86)
  })

  it('getBuildTime applies speed reduction with 3 producers', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: true })
    const prods = [
      createProduction({ isTraitDisabled: false, isTraitPaused: false }),
      createProduction({ isTraitDisabled: false, isTraitPaused: false }),
      createProduction({ isTraitDisabled: false, isTraitPaused: false }),
    ]
    const queue = createQueue(info, { worldProductions: prods })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    // 3 producers → index 2 → 75% → 75 ticks
    expect(queue.getBuildTime(ai, bi)).toBe(75)
  })

  it('getBuildTime clamps to max table length', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: true })
    // Create 10 producers (more than table length of 7)
    const prods: Production[] = []
    for (let i = 0; i < 10; i++) {
      prods.push(createProduction({ isTraitDisabled: false, isTraitPaused: false }))
    }
    const queue = createQueue(info, { worldProductions: prods })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    // 10 producers clamped to 7 → index 6 → 50% → 50 ticks
    expect(queue.getBuildTime(ai, bi)).toBe(50)
  })

  it('getBuildTime ignores disabled producers', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: true })
    const prod1 = createProduction({ isTraitDisabled: true, isTraitPaused: false })
    const prod2 = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { worldProductions: [prod1, prod2] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    // Only 1 active producer → index 0 → 100% → 100 ticks
    expect(queue.getBuildTime(ai, bi)).toBe(100)
  })

  it('getBuildTime ignores paused producers', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: true })
    const prod1 = createProduction({ isTraitDisabled: false, isTraitPaused: true })
    const prod2 = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { worldProductions: [prod1, prod2] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    // Only 1 active producer → index 0 → 100% → 100 ticks
    expect(queue.getBuildTime(ai, bi)).toBe(100)
  })

  it('getBuildTime returns 0 when fastBuild is enabled', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', speedUp: true })
    const dmFast = new DeveloperMode(new DeveloperModeInfo({ fastBuild: true }))
    const queue = createQueue(info, { developerMode: dmFast })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 100, buildDurationModifier: 100 })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.getBuildTime(ai, bi)).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // allItems / buildableItems when disabled
  // ---------------------------------------------------------------------------

  it('allItems returns empty when queue is disabled', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', factions: ['soviet'] })
    const queue = createQueue(info, { faction: 'allies' })
    expect(queue.allItems()).toEqual([])
  })

  it('buildableItems returns empty when queue is disabled', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle', factions: ['soviet'] })
    const queue = createQueue(info, { faction: 'allies' })
    expect(queue.buildableItems()).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // Inheritance
  // ---------------------------------------------------------------------------

  it('is an instance of ProductionQueue', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    expect(queue).toBeInstanceOf(ProductionQueue)
    expect(queue).toBeInstanceOf(ClassicProductionQueue)
  })

  it('inherits queue methods from ProductionQueue', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info)
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    expect(queue.canQueue(ai).canQueue).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Tick with world productions
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Tick with world productions — enabled logic
  // ---------------------------------------------------------------------------

  it('tick enables queue when matching world production exists and faction is valid', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { worldProductions: [prod], productionTraits: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.tick(actor)
    expect(queue.enabled).toBe(true)
    expect(queue.queue.length).toBe(1)
  })

  it('tick disables queue when no matching world production exists', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ info: createProductionInfo(['Infantry']) }) // Wrong type
    const queue = createQueue(info, { worldProductions: [prod], productionTraits: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.tick(actor)
    expect(queue.enabled).toBe(false)
    expect(queue.queue.length).toBe(0) // Queue cleared when disabled
  })

  it('tick disables queue when all matching world productions are disabled', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ isTraitDisabled: true, isTraitPaused: false })
    const queue = createQueue(info, { worldProductions: [prod], productionTraits: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.tick(actor)
    expect(queue.enabled).toBe(false)
    expect(queue.queue.length).toBe(0) // Queue cleared when disabled
  })

  it('tick clears queue when no matching world productions', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle' })
    const queue = createQueue(info, { worldProductions: [] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']) })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.tick(actor)
    expect(queue.queue.length).toBe(0)
  })

  it('tick keeps queue when matching world production exists', () => {
    const info = new ClassicProductionQueueInfo({ type: 'Vehicle' })
    const prod = createProduction({ isTraitDisabled: false, isTraitPaused: false })
    const queue = createQueue(info, { worldProductions: [prod], productionTraits: [prod] })
    const bi = new BuildableInfo({ queue: new Set(['Vehicle']), buildDuration: 5 })
    const ai = createActorInfo('tank', bi, 500)
    queue.producible.set('tank', new ProductionState())
    queue.producible.get('tank')!.buildable = true
    queue.setRulesActors(new Map([['tank', ai]]))
    queue['_updateProducibleLists']()
    queue.queue.push(new ProductionItem(queue, 'tank', 500, null, null, ai, bi))
    queue.tick(actor)
    expect(queue.queue.length).toBe(1)
  })
})
