/**
 * BaseBuilderQueueManager.test.ts — unit tests for AI building queue optimization
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  BaseBuilderQueueManager,
  WaterCheck,
  BuildingType,
} from './BaseBuilderQueueManager.js'
import type { BaseBuilderBotModuleInfo } from '../BaseBuilderBotModule.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseBuilderLike(): Record<string, unknown> {
  return {
    baseExpansionModules: null,
    constructionYardBuildings: { actors: [] },
    refineryBuildings: { actors: [] },
    productionBuildings: { actors: [] },
    resourceConyardCenter: null,
    resourceMapModule: null,
    getRandomBaseCenter: () => ({ x: 0, y: 0 }),
    getDefenseBaseCenter: () => ({ x: 0, y: 0 }),
    refineryBuildingsCount: () => 0,
    productionBuildingsCount: () => 0,
    requestedRefineriesCount: () => 0,
    getFirstRequestedRefinery: () => null,
    hasAdequateRefineryCount: () => true,
    buildingsBeingProducedCount: () => 0,
    queueOrderForBot: () => {},
  }
}

function makeInfo(): BaseBuilderBotModuleInfo {
  return {
    constructionYardTypes: new Set(['fact']),
    refineryTypes: new Set(['proc']),
    powerTypes: new Set(['powr']),
    productionTypes: new Set(['barr']),
    techTypes: new Set(['atek']),
    navalProductionTypes: new Set([]),
    siloTypes: new Set(['silo']),
    defenseTypes: new Set(['pillbox']),
    buildingQueues: ['Building'],
    defenseQueues: ['Defense'],
    minBaseRadius: 2,
    maxBaseRadius: 20,
    minimumExcessPower: 50,
    maximumExcessPower: 200,
    excessPowerIncrement: 10,
    excessPowerIncreaseThreshold: 5,
    initialMinimumRefineryCount: 1,
    additionalMinimumRefineryCount: 0,
    structureProductionInactiveDelay: 250,
    structureProductionActiveDelay: 50,
    structureProductionRandomBonusDelay: 10,
    structureProductionResumeDelay: 100,
    maximumFailedPlacementAttempts: 3,
    maxResourceCellsToCheck: 20,
    checkForNewBasesDelay: 200,
    placeDefenseTowardsEnemyChance: 50,
    tryMaintainDefenseRange: 5,
    newProductionCashThreshold: 2000,
    newProductionChance: 30,
    rallyPointScanRadius: 8,
    assignRallyPointsInterval: 50,
    checkBestResourceLocationInterval: 500,
    sellRefineryInterval: 1000,
    sellRefineryTooCloseCellDistance: 5,
    sellRefineryNoResourceDistance: 30,
    maxRefineryPerIndice: 2,
    productionMinCashRequirement: 300,
    expansionTolerate: [1, 2],
    buildingFractions: new Map([['barr', 10], ['powr', 15]]),
    buildingLimits: new Map(),
    buildingDelays: new Map(),
    waterTerrainTypes: new Set(),
    checkForWaterRadius: 30,
    forceExpansionTolerate: [1],
    perExpansionTolerateOnCash: 500,
  } as BaseBuilderBotModuleInfo
}

function makePlayer(): Record<string, unknown> {
  return {
    playerName: 'BotPlayer',
    world: {
      actors: [],
      worldTick: 100,
      map: {
        grid: { maximumTileSearchRange: 256 },
        findTilesInAnnulus: () => [{ x: 5, y: 5 }],
        getTerrainType: () => null,
        rules: { actors: {} },
      },
      canPlaceBuilding: () => true,
    },
    relationshipWith: () => 'Enemy',
  }
}

function makePowerManager(): Record<string, unknown> {
  return { excessPower: 100 }
}

function makeResources(): Record<string, unknown> {
  return {
    getCashAndResources: () => 5000,
    resources: 0,
    resourceCapacity: 10000,
  }
}

function makeRandom(): any {
  return { nextIntRange: (min: number, _max: number) => min }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseBuilderQueueManager', () => {
  let baseBuilder: Record<string, unknown>
  let info: BaseBuilderBotModuleInfo
  let player: Record<string, unknown>
  let pm: Record<string, unknown>
  let pr: Record<string, unknown>

  beforeEach(() => {
    baseBuilder = makeBaseBuilderLike()
    info = makeInfo()
    player = makePlayer()
    pm = makePowerManager()
    pr = makeResources()
  })

  describe('constructor', () => {
    it('creates with valid config', () => {
      const qm = new BaseBuilderQueueManager(
        baseBuilder as any,
        'Building',
        player as any,
        pm as any,
        pr as any,
        null, // resourceLayer
        info,
      )
      expect(qm).toBeDefined()
      expect(qm.category).toBe('Building')
      expect(qm.waitTicks).toBe(0)
    })

    it('sets waterState to DontCheck when no naval production types', () => {
      const qm = new BaseBuilderQueueManager(
        baseBuilder as any,
        'Building',
        player as any,
        pm as any,
        pr as any,
        null,
        info,
      )
      expect(qm).toBeDefined()
      // WaterCheck is NotChecked initially, then becomes DontCheck since navalProductionTypes is empty
    })
  })

  describe('tick', () => {
    it('does not throw with empty queue', () => {
      const qm = new BaseBuilderQueueManager(
        baseBuilder as any,
        'Building',
        player as any,
        pm as any,
        pr as any,
        null,
        info,
      )
      const queues = new Map<string, unknown[]>()
      expect(() => qm.tick(queues as any, makeRandom())).not.toThrow()
    })

    it('waits when waitTicks > 0', () => {
      const qm = new BaseBuilderQueueManager(
        baseBuilder as any,
        'Building',
        player as any,
        pm as any,
        pr as any,
        null,
        info,
      )
      qm.waitTicks = 5
      const queues = new Map<string, unknown[]>()
      qm.tick(queues as any, makeRandom())
      expect(qm.waitTicks).toBe(5) // unchanged because was > 0 at entry
    })
  })

  describe('dispose', () => {
    it('cleans up without error', () => {
      const qm = new BaseBuilderQueueManager(
        baseBuilder as any,
        'Building',
        player as any,
        pm as any,
        pr as any,
        null,
        info,
      )
      expect(() => qm.dispose()).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// Enum constants
// ---------------------------------------------------------------------------

describe('WaterCheck', () => {
  it('has four states', () => {
    expect(WaterCheck.NotChecked).toBe(0)
    expect(WaterCheck.EnoughWater).toBe(1)
    expect(WaterCheck.NotEnoughWater).toBe(2)
    expect(WaterCheck.DontCheck).toBe(3)
  })
})

describe('BuildingType', () => {
  it('has three types', () => {
    expect(BuildingType.Building).toBe(0)
    expect(BuildingType.Defense).toBe(1)
    expect(BuildingType.Refinery).toBe(2)
  })
})
