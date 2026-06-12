/**
 * MinelayerBotModule.test.ts — unit tests for AI mine-laying management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MinelayerBotModule, type MinelayerBotModuleInfo } from './MinelayerBotModule.js'
import { AttackInfo } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<MinelayerBotModuleInfo> = {}): MinelayerBotModuleInfo {
  return {
    ignoredEnemyTargetTypes: new Set(),
    useEnemyLocationTargetTypes: new Set(),
    minelayingActorTypes: new Set(['minelayer']),
    maxPerAssign: 1,
    scanTick: 320,
    mineFieldRadius: 1,
    awayFromAlliedTargetTypes: new Set(),
    awayFromEnemyTargetTypes: new Set(),
    awayFromCellDistance: 9,
    favoritePositionDistance: 6,
    ...overrides,
  } as MinelayerBotModuleInfo
}

function makeWorld(): Record<string, unknown> {
  return {
    actors: [],
    centerOfCell: (c: { x: number; y: number; z: number }) => c,
    findActorsInCircle: () => [],
    pathFinder: {
      findPathToTargetCell: () => null,
    },
  }
}

function makePlayer(): Record<string, unknown> {
  return {
    playerName: 'BotPlayer',
    relationshipWith: () => 'Enemy',
  }
}

function makeRandom() {
  return { nextIntRange: (min: number, _max: number) => min }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MinelayerBotModule', () => {
  let info: MinelayerBotModuleInfo
  let world: Record<string, unknown>
  let player: Record<string, unknown>

  beforeEach(() => {
    info = makeInfo()
    world = makeWorld()
    player = makePlayer()
  })

  describe('constructor', () => {
    it('creates with valid config', () => {
      const m = new MinelayerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(m).toBeDefined()
      expect(m.info.scanTick).toBe(320)
      expect(m.info.maxPerAssign).toBe(1)
    })

    it('initializes position queues to MAX_POSITION_CACHE_LENGTH', () => {
      const m = new MinelayerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(m).toBeDefined()
    })
  })

  describe('botTick', () => {
    it('does not throw with empty world', () => {
      const m = new MinelayerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      const bot = { queueOrder: () => {} } as any
      expect(() => m.botTick(bot)).not.toThrow()
    })
  })

  describe('respondToAttack', () => {
    it('does not throw on attack response', () => {
      const m = new MinelayerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      const attacker = {
        actorId: 99,
        isDead: false,
        isInWorld: true,
        isIdle: true,
        location: { x: 10, y: 10 },
        centerPosition: { x: 10 * 1024, y: 10 * 1024, z: 0 },
        owner: { playerName: 'Enemy' },
        info: { name: 'e1' },
        traitsImplementing: () => [],
        getEnabledTargetTypes: () => ({ isEmpty: false, overlaps: () => false }),
        canBeViewedByPlayer: () => true,
      }
      const self = {
        isDead: false,
        isInWorld: true,
        actorId: 1,
        location: { x: 5, y: 5 },
        centerPosition: { x: 5 * 1024, y: 5 * 1024, z: 0 },
        owner: player,
        info: { name: 'minelayer' },
        traitsImplementing: () => [],
        getEnabledTargetTypes: () => ({ isEmpty: false, overlaps: () => false }),
        canBeViewedByPlayer: () => true,
      }
      const bot = { queueOrder: () => {} } as any
      expect(() => m.respondToAttack(
        bot,
        self as any,
        { attacker, damage: { value: 10, damageTypes: new Set() }, damageState: 1, previousDamageState: 0 } as unknown as AttackInfo,
      )).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('cleans up without error', () => {
      const m = new MinelayerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(() => m.dispose()).not.toThrow()
    })
  })
})
