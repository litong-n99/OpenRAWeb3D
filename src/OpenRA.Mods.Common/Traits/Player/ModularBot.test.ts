/**
 * ModularBot.test.ts — ModularBot unit tests
 *
 * Tests focus on: bot activation, tick dispatch, order batching, shellmap rate
 * limiting, attack response, dispose lifecycle. BotModules and the world are
 * stubbed — actual AI logic is tested in the individual BotModule test suites.
 *
 * Since happy-dom does not support WebGL, no @babylonjs/core imports needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Imports (real modules, not mocked)
// ---------------------------------------------------------------------------

import { ModularBot, type ModularBotInfo } from './ModularBot.js'
import {
  Component,
  type IGameActor,
  type IBotTick,
  type IBotEnabled,
  type IBotRespondToAttack,
  type PlayerStub,
  type AttackInfo,
  type WorldStub,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { TraitDictionary } from '../../../OpenRA.Game/TraitDictionary.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let stubTickCalledCount = 0
let stubAttackResponseCount = 0

function resetStubCounters() {
  stubTickCalledCount = 0
  stubAttackResponseCount = 0
}

/** Create a minimal IGameActor stub for testing. */
function createStubActor(actorId: number = 1): IGameActor {
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    disposed: false,
    willDispose: false,
    generation: 0,
    isIdle: true,
    owner: undefined,
    world: undefined,
    info: undefined,
    grantCondition: vi.fn(() => -1),
    revokeCondition: vi.fn(() => -1),
    hasCondition: vi.fn(() => false),
    tokenValid: vi.fn(() => false),
    queueActivity: vi.fn(),
    cancelActivity: vi.fn(),
    traitOrDefault: vi.fn(() => null),
    traitsImplementing: vi.fn(() => []),
    render: vi.fn(() => []),
  }
}

/** Create a minimal PlayerStub for testing. */
function createStubPlayer(name: string = 'TestBot', playerActor?: IGameActor): PlayerStub & { playerActor?: IGameActor } {
  // NOTE: playerIndex and unlockedRenderPlayer are not on PlayerStub
  // but are needed by some traits. Use unknown intermediate cast.
  return {
    playerName: name,
    internalName: name.toLowerCase().replace(/\s+/g, '_'),
    playerIndex: 1,
    unlockedRenderPlayer: false,
    playerActor,
  } as unknown as PlayerStub & { playerActor?: IGameActor; playerIndex: number; unlockedRenderPlayer: boolean }
}

/** Create a stub ModularBotInfo for testing. */
function createModularBotInfo(overrides?: Partial<ModularBotInfo>): ModularBotInfo {
  return {
    type: overrides?.type ?? 'testbot',
    name: overrides?.name ?? 'Test Bot',
    minOrderQuotientPerTick: overrides?.minOrderQuotientPerTick ?? 5,
  }
}

/**
 * Create a minimal stub world for ModularBot (put on PlayerActor).
 * The world reference uses a TraitDictionary for trait discovery
 * and an issueOrder mock for order dispatching.
 */
function createStubWorld(type: string = 'Regular') {
  const td = new TraitDictionary()
  return {
    type,
    traitDict: td,
    issueOrder: vi.fn(),
    actors: new Map(),
    players: [],
    tick: vi.fn(),
    dispose: vi.fn(),
  } as unknown as WorldStub & { traitDict: TraitDictionary; issueOrder: ReturnType<typeof vi.fn> }
}

/** Create a PlayerActor with a world reference. */
function createPlayerActor(
  actorId: number,
  world: ReturnType<typeof createStubWorld>,
  extra?: Record<string, unknown>,
): IGameActor & { world: unknown } {
  const actor = createStubActor(actorId) as IGameActor & { world: unknown }
  actor.world = world
  if (extra) Object.assign(actor, extra)
  return actor
}

// ---------------------------------------------------------------------------
// Test IBotTick trait (stub bot module for tick dispatch testing)
// ---------------------------------------------------------------------------

class TestBotTickModule extends Component implements IBotTick {
  static readonly interfaces = ['IBotTick', 'component']
  tickCalls: unknown[] = []
  botTick(bot: unknown): void {
    this.tickCalls.push(bot)
    stubTickCalledCount++
  }
}

// ---------------------------------------------------------------------------
// Test IBotEnabled trait (stub bot module for activation testing)
// ---------------------------------------------------------------------------

class TestBotEnabledModule extends Component implements IBotEnabled {
  static readonly interfaces = ['IBotEnabled', 'component']
  enabledCalls: unknown[] = []
  botEnabled(bot: unknown): void {
    this.enabledCalls.push(bot)
  }
}

// ---------------------------------------------------------------------------
// Test IBotRespondToAttack trait
// ---------------------------------------------------------------------------

class TestAttackResponseModule extends Component implements IBotRespondToAttack {
  static readonly interfaces = ['IBotRespondToAttack', 'component']
  attackCalls: Array<{ bot: unknown; actor: IGameActor; e: AttackInfo }> = []
  respondToAttack(bot: unknown, actor: IGameActor, e: AttackInfo): void {
    this.attackCalls.push({ bot, actor, e })
    stubAttackResponseCount++
  }
}

// ---------------------------------------------------------------------------
// Helper: build a dummy AttackInfo for damaged() tests
// ---------------------------------------------------------------------------

function createDummyAttackInfo(): AttackInfo {
  return {
    damage: { value: 10, damageTypes: { contains: () => false, isEmpty: () => true } },
    attacker: createStubActor(999),
    damageState: { PreviousDamageState: 'Undamaged', DamageState: 'Light' },
    previousDamageState: { PreviousDamageState: 'Undamaged', DamageState: 'Undamaged' },
  } as unknown as AttackInfo
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModularBot', () => {
  beforeEach(() => {
    resetStubCounters()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores config info', () => {
      const info = createModularBotInfo()
      const bot = new ModularBot(info)

      expect(bot.info).toBe(info)
      // Access ModularBotInfo-specific fields via cast
      const mbInfo = bot.info as ModularBotInfo
      expect(mbInfo.type).toBe('testbot')
      expect(mbInfo.name).toBe('Test Bot')
      expect(mbInfo.minOrderQuotientPerTick).toBe(5)
      expect(bot.isEnabled).toBe(false)
      bot.dispose()
    })

    it('registers correct interfaces for TraitDictionary lookup', () => {
      const ifaces = (ModularBot as unknown as { interfaces?: string[] }).interfaces
      expect(ifaces).toBeDefined()
      expect(ifaces!).toContain('ITick')
      expect(ifaces!).toContain('IBot')
      expect(ifaces!).toContain('INotifyDamage')
    })
  })

  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------

  describe('activate()', () => {
    it('sets isEnabled and discovers IBotTick modules', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(100, world)

      // Register a tick module on the PlayerActor
      const tickModule = new TestBotTickModule()
      tickModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, tickModule)

      const player = createStubPlayer('AI_1', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      expect(bot.isEnabled).toBe(true)
      expect(bot.player).toBe(player)
      bot.dispose()
    })

    it('activates IBotEnabled modules', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(101, world)

      const enabledModule = new TestBotEnabledModule()
      enabledModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, enabledModule)

      const player = createStubPlayer('AI_2', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      expect(enabledModule.enabledCalls).toHaveLength(1)
      expect(enabledModule.enabledCalls[0]).toBe(bot)
      bot.dispose()
    })

    it('warns when PlayerActor has no world reference', () => {
      const info = createModularBotInfo()
      const actorWithoutWorld = createStubActor(102)
      const player = createStubPlayer('AI_4', actorWithoutWorld)

      const bot = new ModularBot(info)
      bot.activate(player)

      // Should not be enabled (no world -> cannot discover modules)
      expect(bot.isEnabled).toBe(false)
      bot.dispose()
    })

    it('warns when Player has no playerActor', () => {
      const info = createModularBotInfo()
      const player = createStubPlayer('AI_NoActor') // no playerActor

      const bot = new ModularBot(info)
      bot.activate(player)

      expect(bot.isEnabled).toBe(false)
      bot.dispose()
    })

    it('discovers IBotRespondToAttack modules during activation', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(103, world)

      const attackModule = new TestAttackResponseModule()
      attackModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, attackModule)

      const player = createStubPlayer('AI_5', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      expect(bot.isEnabled).toBe(true)
      bot.dispose()
    })
  })

  // -----------------------------------------------------------------------
  // tick — ITick.tick dispatch
  // -----------------------------------------------------------------------

  describe('tick()', () => {
    it('calls botTick on all IBotTick modules each tick', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(200, world)

      const tickModule = new TestBotTickModule()
      tickModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, tickModule)

      const player = createStubPlayer('AI_Tick', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      bot.tick(playerActor as unknown as IGameActor)
      expect(tickModule.tickCalls).toHaveLength(1)
      expect(tickModule.tickCalls[0]).toBe(bot)

      bot.tick(playerActor as unknown as IGameActor)
      expect(tickModule.tickCalls).toHaveLength(2)

      bot.dispose()
    })

    it('does NOT call botTick when isEnabled is false', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(201, world)

      const tickModule = new TestBotTickModule()
      tickModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, tickModule)

      const bot = new ModularBot(info)
      // NOT activated — isEnabled is false

      bot.tick(playerActor as unknown as IGameActor)
      expect(tickModule.tickCalls).toHaveLength(0)
      bot.dispose()
    })

    it('rate-limits tick in shellmap mode (ADR-26.3)', () => {
      const info = createModularBotInfo()
      const world = createStubWorld('Shellmap')
      const playerActor = createPlayerActor(202, world)

      const tickModule = new TestBotTickModule()
      tickModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, tickModule)

      const player = createStubPlayer('AI_Shell', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      // Ticks 1-9: should skip bot tick
      for (let i = 0; i < 9; i++) {
        bot.tick(playerActor as unknown as IGameActor)
      }
      expect(tickModule.tickCalls).toHaveLength(0)

      // Tick 10: should fire bot tick
      bot.tick(playerActor as unknown as IGameActor)
      expect(tickModule.tickCalls).toHaveLength(1)

      // Tick 11-19: skip again
      for (let i = 0; i < 9; i++) {
        bot.tick(playerActor as unknown as IGameActor)
      }
      expect(tickModule.tickCalls).toHaveLength(1)

      // Tick 20: fire again
      bot.tick(playerActor as unknown as IGameActor)
      expect(tickModule.tickCalls).toHaveLength(2)

      bot.dispose()
    })

    it('does NOT rate-limit tick in regular mode', () => {
      const info = createModularBotInfo()
      const world = createStubWorld('Regular')
      const playerActor = createPlayerActor(203, world)

      const tickModule = new TestBotTickModule()
      tickModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, tickModule)

      const player = createStubPlayer('AI_Reg', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      for (let i = 0; i < 5; i++) {
        bot.tick(playerActor as unknown as IGameActor)
      }
      expect(tickModule.tickCalls).toHaveLength(5)

      bot.dispose()
    })

    it('skips disabled bot modules during tick', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(204, world)

      const tickModule = new TestBotTickModule()
      tickModule.attach(playerActor as unknown as IGameActor)
      tickModule.onEnabledChanged(false) // disable
      world.traitDict.addTrait(playerActor as unknown as IGameActor, tickModule)

      const player = createStubPlayer('AI_Disabled', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      bot.tick(playerActor as unknown as IGameActor)
      // Disabled module should NOT have been called
      expect(tickModule.tickCalls).toHaveLength(0)

      bot.dispose()
    })
  })

  // -----------------------------------------------------------------------
  // queueOrder — IBot.queueOrder
  // -----------------------------------------------------------------------

  describe('queueOrder()', () => {
    it('enqueues orders for later issuing', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(300, world)
      const player = createStubPlayer('AI_Orders', playerActor as unknown as IGameActor)

      const bot = new ModularBot(info)
      bot.activate(player)

      bot.queueOrder({ orderName: 'Attack', targetString: '', extraData: 0 })
      bot.queueOrder({ orderName: 'Move', targetString: '128,256', extraData: 0 })

      // Orders should not be issued yet (queued for next tick)
      expect(world.issueOrder).not.toHaveBeenCalled()
      bot.dispose()
    })

    it('issues batched orders on tick with minOrderQuotient', () => {
      const info = createModularBotInfo({ minOrderQuotientPerTick: 2 })
      const world = createStubWorld()
      const playerActor = createPlayerActor(301, world)
      const player = createStubPlayer('AI_Batch', playerActor as unknown as IGameActor)

      const bot = new ModularBot(info)
      bot.activate(player)

      // Queue 4 orders
      for (let i = 0; i < 4; i++) {
        bot.queueOrder({ orderName: `Order_${i}`, targetString: '', extraData: i })
      }

      // Tick 1: ceil(4/2) = 2 orders issued
      bot.tick(playerActor as unknown as IGameActor)
      expect(world.issueOrder).toHaveBeenCalledTimes(2)

      // Tick 2: ceil(2/2) = 1 order issued
      bot.tick(playerActor as unknown as IGameActor)
      expect(world.issueOrder).toHaveBeenCalledTimes(3)

      // Tick 3: ceil(1/2) = 1 order issued (last one)
      bot.tick(playerActor as unknown as IGameActor)
      expect(world.issueOrder).toHaveBeenCalledTimes(4)

      // Tick 4: queue empty — no new orders
      bot.tick(playerActor as unknown as IGameActor)
      expect(world.issueOrder).toHaveBeenCalledTimes(4)

      bot.dispose()
    })

    it('handles empty queue without error', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(302, world)
      const player = createStubPlayer('AI_Empty', playerActor as unknown as IGameActor)

      const bot = new ModularBot(info)
      bot.activate(player)

      bot.tick(playerActor as unknown as IGameActor)
      expect(world.issueOrder).not.toHaveBeenCalled()
      bot.dispose()
    })
  })

  // -----------------------------------------------------------------------
  // damaged — INotifyDamage.damaged
  // -----------------------------------------------------------------------

  describe('damaged()', () => {
    it('calls respondToAttack on IBotRespondToAttack modules', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(400, world)

      const attackModule = new TestAttackResponseModule()
      attackModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, attackModule)

      const player = createStubPlayer('AI_Attack', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      const attackInfo = createDummyAttackInfo()
      const damagedActor = createStubActor(500)
      bot.damaged(damagedActor, attackInfo)

      expect(attackModule.attackCalls).toHaveLength(1)
      expect(attackModule.attackCalls[0].bot).toBe(bot)
      expect(attackModule.attackCalls[0].actor).toBe(damagedActor)
      expect(attackModule.attackCalls[0].e).toBe(attackInfo)

      bot.dispose()
    })

    it('does NOT call respondToAttack when isEnabled is false', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(401, world)

      const attackModule = new TestAttackResponseModule()
      attackModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, attackModule)

      const bot = new ModularBot(info)
      // NOT activated

      bot.damaged(createStubActor(501), createDummyAttackInfo())
      expect(attackModule.attackCalls).toHaveLength(0)
      bot.dispose()
    })

    it('skips disabled attack response modules', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(402, world)

      const attackModule = new TestAttackResponseModule()
      attackModule.attach(playerActor as unknown as IGameActor)
      attackModule.onEnabledChanged(false) // disable
      world.traitDict.addTrait(playerActor as unknown as IGameActor, attackModule)

      const player = createStubPlayer('AI_DisAtk', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      bot.damaged(createStubActor(502), createDummyAttackInfo())
      expect(attackModule.attackCalls).toHaveLength(0)
      bot.dispose()
    })
  })

  // -----------------------------------------------------------------------
  // dispose lifecycle
  // -----------------------------------------------------------------------

  describe('dispose()', () => {
    it('clears order queue, modules, and world reference', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(600, world)

      const tickModule = new TestBotTickModule()
      tickModule.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, tickModule)

      const player = createStubPlayer('AI_Dispose', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      bot.queueOrder({ orderName: 'Test', targetString: '', extraData: 0 })
      expect(bot.isEnabled).toBe(true)

      bot.dispose()

      expect(bot.isEnabled).toBe(false)
      expect(bot.disposed).toBe(true)

      // Tick after dispose should NOT call anything
      resetStubCounters()
      bot.tick(playerActor as unknown as IGameActor)
      expect(stubTickCalledCount).toBe(0)

      // Queue after dispose should work but won't be issued (bot disabled)
      bot.queueOrder({ orderName: 'AfterDispose', targetString: '', extraData: 0 })
      bot.tick(playerActor as unknown as IGameActor)
      expect(world.issueOrder).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Integration: multi-module setup
  // -----------------------------------------------------------------------

  describe('multi-module integration', () => {
    it('dispatches to multiple IBotTick modules', () => {
      const info = createModularBotInfo()
      const world = createStubWorld()
      const playerActor = createPlayerActor(700, world)

      const module1 = new TestBotTickModule()
      module1.attach(playerActor as unknown as IGameActor)
      const module2 = new TestBotTickModule()
      module2.attach(playerActor as unknown as IGameActor)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, module1)
      world.traitDict.addTrait(playerActor as unknown as IGameActor, module2)

      const player = createStubPlayer('AI_Multi', playerActor as unknown as IGameActor)
      const bot = new ModularBot(info)
      bot.activate(player)

      bot.tick(playerActor as unknown as IGameActor)
      expect(module1.tickCalls).toHaveLength(1)
      expect(module2.tickCalls).toHaveLength(1)
      expect(module1.tickCalls[0]).toBe(bot)
      expect(module2.tickCalls[0]).toBe(bot)

      bot.dispose()
    })
  })
})
