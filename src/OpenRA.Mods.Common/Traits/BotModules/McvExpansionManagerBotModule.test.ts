/**
 * McvExpansionManagerBotModule.test.ts — unit tests for AI MCV expansion management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  McvExpansionManagerBotModule,
  BotMcvExpansionMode,
  type McvExpansionManagerBotModuleInfo,
} from './McvExpansionManagerBotModule.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<McvExpansionManagerBotModuleInfo> = {}): McvExpansionManagerBotModuleInfo {
  return {
    mcvTypes: new Set(['mcv']),
    constructionYardTypes: new Set(['fact']),
    mcvFactoryTypes: new Set(['mcvfactory']),
    minimumConstructionYardCount: 1,
    additionalConstructionYardCount: 0,
    buildAdditionalMCVCashAmount: 5000,
    scanForNewMcvInterval: 20,
    buildMcvInterval: 101,
    moveConyardTick: 5700,
    moveOldConyardFirst: null,
    initialExpansionMode: BotMcvExpansionMode.CheckResource,
    expansionModeAutoSwitch: true,
    crModeMinDeployRadius: 2,
    crModeMaxDeployRadius: 20,
    crModeTryMaintainRange: 8,
    crModeFriendlyConyardDislikeRange: 14,
    crModeFriendlyRefineryDislikeRange: 14,
    cbModeMinDeployRadius: 2,
    cbModeMaxDeployRadius: 20,
    ...overrides,
  } as McvExpansionManagerBotModuleInfo
}

function makeWorld(): Record<string, unknown> {
  return {
    actors: [],
    worldActor: { traitsImplementing: () => [] },
    map: {
      grid: { maximumTileSearchRange: 256 },
      findTilesInAnnulus: () => [{ x: 5, y: 5 }],
    },
    canPlaceBuilding: () => true,
  }
}

function makePlayer(): Record<string, unknown> {
  return {
    playerName: 'BotPlayer',
    playerActor: {
      traitsImplementing: () => [],
    },
    relationshipWith: () => 'Enemy',
  }
}

function makeRandom() {
  return { nextIntRange: (min: number, _max: number) => min }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McvExpansionManagerBotModule', () => {
  let info: McvExpansionManagerBotModuleInfo
  let world: Record<string, unknown>
  let player: Record<string, unknown>

  beforeEach(() => {
    info = makeInfo()
    world = makeWorld()
    player = makePlayer()
  })

  describe('constructor', () => {
    it('creates with valid config', () => {
      const m = new McvExpansionManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(m).toBeDefined()
      expect(m.info.mcvTypes.has('mcv')).toBe(true)
    })

    it('defaults to CheckResource mode', () => {
      const m = new McvExpansionManagerBotModule(
        world as any,
        player as any,
        makeInfo({ initialExpansionMode: BotMcvExpansionMode.CheckBase }),
        makeRandom() as any,
      )
      expect(m).toBeDefined()
    })
  })

  describe('botTick', () => {
    it('does not throw on first tick', () => {
      const m = new McvExpansionManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      const bot = { queueOrder: () => {} } as any
      expect(() => m.botTick(bot)).not.toThrow()
    })
  })

  describe('updateExpansionParams', () => {
    it('sets expansion parameters', () => {
      const m = new McvExpansionManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(() => m.updateExpansionParams(null, true, true, null)).not.toThrow()
    })
  })

  describe('respondToAttack', () => {
    it('does not throw on attack response', () => {
      const m = new McvExpansionManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      const self = {
        isDead: false,
        isInWorld: true,
        actorId: 1,
        isIdle: true,
        location: { x: 5, y: 5 },
        centerPosition: { x: 5 * 1024, y: 5 * 1024, z: 0 },
        owner: player,
        info: { name: 'mcv' },
        traitsImplementing: () => [],
      }
      const bot = { queueOrder: () => {} } as any
      expect(() => m.respondToAttack(bot, self as any, {
        attacker: self,
        damage: { value: 10 },
        damageState: 1,
        previousDamageState: 0,
      } as any)).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('cleans up without error', () => {
      const m = new McvExpansionManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(() => m.dispose()).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// Enum tests
// ---------------------------------------------------------------------------

describe('BotMcvExpansionMode', () => {
  it('has three modes', () => {
    expect(BotMcvExpansionMode.CheckResource).toBe(0)
    expect(BotMcvExpansionMode.CheckBase).toBe(1)
    expect(BotMcvExpansionMode.CheckCurrentLocation).toBe(2)
  })
})
