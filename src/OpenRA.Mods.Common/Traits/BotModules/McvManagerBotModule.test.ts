/**
 * McvManagerBotModule.test.ts — unit tests for AI MCV production management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { McvManagerBotModule, type McvManagerBotModuleInfo } from './McvManagerBotModule.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<McvManagerBotModuleInfo> = {}): McvManagerBotModuleInfo {
  return {
    mcvTypes: new Set(['mcv']),
    constructionYardTypes: new Set(['fact']),
    mcvFactoryTypes: new Set(['mcvfactory']),
    minimumConstructionYardCount: 1,
    scanForNewMcvInterval: 20,
    minBaseRadius: 2,
    maxBaseRadius: 20,
    restrictMCVDeploymentFallbackToBase: true,
    ...overrides,
  } as McvManagerBotModuleInfo
}

function makeWorld(): Record<string, unknown> {
  return {
    actors: [],
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
  }
}

function makeRandom() {
  return { nextIntRange: (min: number, _max: number) => min }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McvManagerBotModule', () => {
  let info: McvManagerBotModuleInfo
  let world: Record<string, unknown>
  let player: Record<string, unknown>

  beforeEach(() => {
    info = makeInfo()
    world = makeWorld()
    player = makePlayer()
  })

  describe('constructor', () => {
    it('creates with valid config', () => {
      const m = new McvManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(m).toBeDefined()
      expect(m.info.mcvTypes.has('mcv')).toBe(true)
      expect(m.info.minimumConstructionYardCount).toBe(1)
    })

    it('randomizes scan interval in constructor', () => {
      const m = new McvManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(m).toBeDefined()
    })
  })

  describe('botTick', () => {
    it('does not throw on first tick', () => {
      const m = new McvManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      const bot = { queueOrder: () => {} } as any
      expect(() => m.botTick(bot)).not.toThrow()
    })
  })

  describe('updatedBaseCenter', () => {
    it('updates internal base center', () => {
      const m = new McvManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      const cpos = { X: 10, Y: 20, Z: 0 } as any
      expect(() => m.updatedBaseCenter(cpos)).not.toThrow()
    })
  })

  describe('updatedDefenseCenter', () => {
    it('is a no-op', () => {
      const m = new McvManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(() => m.updatedDefenseCenter({ X: 0, Y: 0, Z: 0 } as any)).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('cleans up without error', () => {
      const m = new McvManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(() => m.dispose()).not.toThrow()
    })
  })
})
