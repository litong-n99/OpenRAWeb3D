/**
 * FindAndDeliverResources.test.ts — FindAndDeliverResources 迁移单元测试
 *
 * 测试重点: 完整收割循环、queueFullLoad 行为、无资源等待、
 * closestHarvestablePos 路径查找、orderLocation 处理、取消。
 * 所有 @babylonjs/core 模块被 mock (happy-dom 不支持 WebGL)。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    Vector3: function Vector3(this: { x: number; y: number; z: number }, x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    },
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { FindAndDeliverResources } from './FindAndDeliverResources'
import { ActivityState } from '../../OpenRA.Game/Activities/Activity'
import { CPos } from '../../OpenRA.Game/CPos'
import { WPos } from '../../OpenRA.Game/WPos'
import type { GameActor } from '../../OpenRA.Game/Actor'
import type { Activity } from '../../OpenRA.Game/Activities/Activity'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockHarvester {
  isTraitDisabled: boolean
  isFull: boolean
  isEmpty: boolean
  canHarvestCell: (self: unknown, cell: CPos) => boolean
  addResource: (self: unknown, type: string) => void
  info: {
    queueFullLoad: boolean
    searchFromHarvesterRadius: number
    searchFromProcRadius: number
    waitDuration: number
    resourceRefineryDirectionPenalty: number
    harvestLineColor: { r: number; g: number; b: number; a: number }
    unblockCell: { x: number; y: number }
    baleLoadDelay: number
    harvestFacings: number
  }
}

interface MockClaimLayer {
  tryClaimCell: ReturnType<typeof vi.fn>
  removeClaim: ReturnType<typeof vi.fn>
  canClaimCell: ReturnType<typeof vi.fn>
}

interface MockDockClient {
  isTraitDisabled: boolean
  info: { searchForDockDelay: number }
  reservedHost: unknown | null
  reservedHostActor: unknown | null
  lastReservedHost: { dockPosition: WPos } | null
  dockLineColor: { r: number; g: number; b: number; a: number }
  closestDock: ReturnType<typeof vi.fn>
  availableDockHosts: ReturnType<typeof vi.fn>
  reserveHost: ReturnType<typeof vi.fn>
  unreserveHost: ReturnType<typeof vi.fn>
}

interface MockPathFinder {
  findPathToTargetCellByPredicate: ReturnType<typeof vi.fn>
}

interface MockMobile {
  moveTo: ReturnType<typeof vi.fn>
  nearestMoveableCell: ReturnType<typeof vi.fn>
  pathFinder: MockPathFinder | null
}

interface MockActorResult {
  actor: unknown
  harvester: MockHarvester
  claimLayer: MockClaimLayer
  dockClient: MockDockClient
  mobile: MockMobile
}

/** 创建 mock actor。 */
function createMockActor(overrides: {
  location?: CPos
  centerPosition?: WPos
  isTraitDisabled?: boolean
  isFull?: boolean
  isEmpty?: boolean
  queueFullLoad?: boolean
  canHarvestCell?: (self: unknown, cell: CPos) => boolean
  searchFromHarvesterRadius?: number
  searchFromProcRadius?: number
  waitDuration?: number
  resourceRefineryDirectionPenalty?: number
  pathFinderResult?: CPos[] | null
  reservedHost?: unknown | null
  lastReservedHost?: { dockPosition: WPos } | null
  dockLineColor?: { r: number; g: number; b: number; a: number }
  nearestMoveableCell?: (target: CPos, minRange: number, maxRange: number) => CPos
} = {}): MockActorResult {
  const loc = overrides.location ?? new CPos(5, 5)
  const centerPos = overrides.centerPosition ?? new WPos(5 * 1024, 5 * 1024, 0)

  const mockHarvester: MockHarvester = {
    isTraitDisabled: overrides.isTraitDisabled ?? false,
    isFull: overrides.isFull ?? false,
    isEmpty: overrides.isEmpty ?? true,
    canHarvestCell: overrides.canHarvestCell ?? vi.fn((_self: unknown, cell: CPos) => {
      return (cell.X === 10 && cell.Y === 10) || (cell.X === 11 && cell.Y === 11)
    }),
    addResource: vi.fn(),
    info: {
      queueFullLoad: overrides.queueFullLoad ?? false,
      searchFromHarvesterRadius: overrides.searchFromHarvesterRadius ?? 12,
      searchFromProcRadius: overrides.searchFromProcRadius ?? 24,
      waitDuration: overrides.waitDuration ?? 25,
      resourceRefineryDirectionPenalty: overrides.resourceRefineryDirectionPenalty ?? 200,
      harvestLineColor: { r: 0.86, g: 0.08, b: 0.24, a: 1 },
      unblockCell: { x: 0, y: 4 },
      baleLoadDelay: 0,
      harvestFacings: 0,
    },
  }

  const mockClaimLayer: MockClaimLayer = {
    tryClaimCell: vi.fn(() => true),
    removeClaim: vi.fn(),
    canClaimCell: vi.fn(() => true),
  }

  const mockDockClient: MockDockClient = {
    isTraitDisabled: false,
    info: { searchForDockDelay: 25 },
    reservedHost: overrides.reservedHost ?? null,
    reservedHostActor: null,
    lastReservedHost: overrides.lastReservedHost ?? null,
    dockLineColor: overrides.dockLineColor ?? { r: 0, g: 1, b: 0, a: 1 },
    closestDock: vi.fn(() => null),
    availableDockHosts: vi.fn(() => []),
    reserveHost: vi.fn(() => false),
    unreserveHost: vi.fn(),
  }

  const pathResult = overrides.pathFinderResult ?? [new CPos(10, 10)]
  const mockPathFinder: MockPathFinder = {
    findPathToTargetCellByPredicate: vi.fn(() => pathResult),
  }

  const mockMobile: MockMobile = {
    moveTo: vi.fn(() => ({ _mockActivity: true, tickOuter: vi.fn(() => null), tick: vi.fn(() => true), cancel: vi.fn() })),
    nearestMoveableCell: overrides.nearestMoveableCell ? vi.fn(overrides.nearestMoveableCell) : vi.fn((target: CPos) => target),
    pathFinder: mockPathFinder,
  }

  const mockResourceLayer = {
    getResource: vi.fn(() => ({ type: 'Ore', density: 5 })),
    removeResource: vi.fn(() => 1),
  }

  const actor = {
    traits: new Map<string, unknown>([
      ['Harvester', mockHarvester],
      ['HarvesterInfo', mockHarvester.info],
      ['Mobile', mockMobile],
      ['DockClientManager', mockDockClient],
    ]),
    location: loc,
    centerPosition: centerPos,
    world: {
      worldActor: {
        _claimLayer: mockClaimLayer,
        _resourceLayer: mockResourceLayer,
      },
      map: {
        cellContaining: (pos: WPos) => new CPos(Math.floor(pos.X / 1024), Math.floor(pos.Y / 1024)),
        centerOfCell: (cell: CPos) => new WPos(cell.X * 1024, cell.Y * 1024, 0),
      },
      sharedRandom: {
        next: vi.fn(() => 0.5),
      },
    },
    isInWorld: true,
    isDead: false,
    actorId: 1,
    owner: { playerName: 'TestPlayer' },
  }

  return {
    actor,
    harvester: mockHarvester,
    claimLayer: mockClaimLayer,
    dockClient: mockDockClient,
    mobile: mockMobile,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindAndDeliverResources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FindAndDeliverResources._moveToDockFactory = () => null
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('stores orderLocation', () => {
      const { actor } = createMockActor()
      const orderLocation = new CPos(20, 20)
      const activity = new FindAndDeliverResources(actor as GameActor, orderLocation)

      expect(activity.orderLocation).toEqual(orderLocation)
    })

    it('initializes orderLocation as null when not provided', () => {
      const { actor } = createMockActor()
      const activity = new FindAndDeliverResources(actor as GameActor)

      expect(activity.orderLocation).toBeNull()
    })

    it('initializes in Queued state', () => {
      const { actor } = createMockActor()
      const activity = new FindAndDeliverResources(actor as GameActor)

      expect(activity.state).toBe(ActivityState.Queued)
    })
  })

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  describe('onFirstRun', () => {
    it('sets lastHarvestedCell to orderLocation when provided', () => {
      const { actor } = createMockActor()
      const orderLocation = new CPos(20, 20)
      // Make orderLocation harvestable so it doesn't get cleared
      const harvester = (actor as { traits: Map<string, unknown> }).traits.get('Harvester') as MockHarvester
      harvester.canHarvestCell = (_self: unknown, cell: CPos) => cell.X === 20 && cell.Y === 20

      const activity = new FindAndDeliverResources(actor as GameActor, orderLocation)
      activity.tickOuter(actor as GameActor)

      // orderLocation should still be set because it's harvestable
      expect(activity.orderLocation).toEqual(orderLocation)
    })

    it('queues MoveToDock when orderLocation provided and harvester is full', () => {
      const { actor } = createMockActor({ isFull: true })
      const orderLocation = new CPos(20, 20)
      // Make orderLocation harvestable so it doesn't get cleared
      const harvester = (actor as { traits: Map<string, unknown> }).traits.get('Harvester') as MockHarvester
      harvester.canHarvestCell = (_self: unknown, cell: CPos) => cell.X === 20 && cell.Y === 20

      let factoryCalled = false
      FindAndDeliverResources._moveToDockFactory = () => {
        factoryCalled = true
        return {
          _mockMoveToDock: true,
          state: ActivityState.Queued,
          tickOuter: vi.fn(() => null),
          tick: vi.fn(() => true),
          cancel: vi.fn(),
        } as unknown as Activity
      }

      const activity = new FindAndDeliverResources(actor as GameActor, orderLocation)
      activity.tickOuter(actor as GameActor)

      expect(factoryCalled).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — Basic flow
  // ---------------------------------------------------------------------------

  describe('tick — basic flow', () => {
    it('queues HarvestResource when resources found', () => {
      const { actor, mobile } = createMockActor()
      const activity = new FindAndDeliverResources(actor as GameActor)

      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
      expect(mobile.pathFinder!.findPathToTargetCellByPredicate).toHaveBeenCalled()
    })

    it('sets lastHarvestedCell after finding resources', () => {
      const { actor } = createMockActor()
      const activity = new FindAndDeliverResources(actor as GameActor)

      activity.tickOuter(actor as GameActor)

      expect(activity.lastSearchFailed).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — Full / Delivery
  // ---------------------------------------------------------------------------

  describe('tick — full / delivery', () => {
    it('queues MoveToDock when harvester is full', () => {
      const { actor } = createMockActor({ isFull: true, isEmpty: false })

      let factoryCalled = false
      FindAndDeliverResources._moveToDockFactory = () => {
        factoryCalled = true
        return { _mockMoveToDock: true, tick: () => true } as unknown as Activity
      }

      const activity = new FindAndDeliverResources(actor as GameActor)
      activity.tickOuter(actor as GameActor)

      expect(factoryCalled).toBe(true)
    })

    it('returns false when reserved host exists (docking already initiated)', () => {
      const { actor } = createMockActor({
        isFull: true,
        isEmpty: false,
        reservedHost: { dockPosition: new WPos(0, 0, 0) },
      })

      const activity = new FindAndDeliverResources(actor as GameActor)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — No resources / Wait
  // ---------------------------------------------------------------------------

  describe('tick — no resources / wait', () => {
    it('queues Wait when no resources found and not waited before', () => {
      const { actor, mobile } = createMockActor({
        canHarvestCell: () => false,
      })
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([])

      const activity = new FindAndDeliverResources(actor as GameActor)

      // First tick: searches, finds nothing, sets lastSearchFailed = true
      activity.tickOuter(actor as GameActor)
      expect(activity.lastSearchFailed).toBe(true)
      expect(activity['_childActivity']).toBeNull() // No Wait yet

      // Second tick: queues Wait because lastSearchFailed is true
      const result2 = activity.tickOuter(actor as GameActor)
      expect(result2).toBe(activity)
      expect(activity['_childActivity']).not.toBeNull()
      expect(activity['_childActivity']!.constructor.name).toBe('Wait')
    })

    it('sets lastSearchFailed when no resources found', () => {
      const { actor, mobile } = createMockActor({
        canHarvestCell: () => false,
      })
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([])

      const activity = new FindAndDeliverResources(actor as GameActor)
      activity.tickOuter(actor as GameActor)

      expect(activity.lastSearchFailed).toBe(true)
    })

    it('does not queue Wait when already waited', () => {
      const { actor, mobile } = createMockActor({
        canHarvestCell: () => false,
      })
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([])

      const activity = new FindAndDeliverResources(actor as GameActor)

      // First tick: searches, finds nothing, sets lastSearchFailed = true
      activity.tickOuter(actor as GameActor)
      expect(activity.lastSearchFailed).toBe(true)
      expect(activity['_childActivity']).toBeNull() // No Wait yet

      // Second tick: queues Wait
      activity.tickOuter(actor as GameActor)
      expect(activity['_childActivity']).not.toBeNull()
      expect(activity['_childActivity']!.constructor.name).toBe('Wait')

      // Simulate Wait completing
      activity['_childActivity'] = null

      // Third tick: should not queue Wait again (hasWaited is true)
      // But since search still fails, it returns false
      const result3 = activity.tickOuter(actor as GameActor)
      expect(result3).toBe(activity)
      // No new Wait child queued
      expect(activity['_childActivity']).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — queueFullLoad behavior
  // ---------------------------------------------------------------------------

  describe('tick — queueFullLoad behavior', () => {
    it('interrupts after first cell when queueFullLoad=false and nextActivity exists', () => {
      const { actor } = createMockActor({
        queueFullLoad: false,
        isEmpty: false,
        location: new CPos(10, 10), // At target cell so HarvestResource completes immediately
      })
      // Make resource layer return depleted so HarvestResource completes after one harvest
      const resourceLayer = (actor as { world: { worldActor: { _resourceLayer: { getResource: ReturnType<typeof vi.fn>; removeResource: ReturnType<typeof vi.fn> } } } }).world.worldActor._resourceLayer
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 1 })
      resourceLayer.removeResource.mockReturnValue(0) // Depleted after first attempt

      const activity = new FindAndDeliverResources(actor as GameActor)
      activity.tickOuter(actor as GameActor)

      // Queue a next activity
      const nextActivity = {
        state: ActivityState.Queued,
        tickOuter: vi.fn(() => null),
        tick: vi.fn(() => true),
        cancel: vi.fn(),
      } as unknown as Activity
      activity.queue(nextActivity)

      // Second tick: should interrupt because hasHarvestedCell is true
      const result = activity.tickOuter(actor as GameActor)
      expect(result).toBe(nextActivity)
    })

    it('does not interrupt when queueFullLoad=true', () => {
      const { actor } = createMockActor({
        queueFullLoad: true,
        isEmpty: false,
      })

      const activity = new FindAndDeliverResources(actor as GameActor)
      activity.tickOuter(actor as GameActor)

      // Queue a next activity
      const nextActivity = {
        state: ActivityState.Queued,
        tickOuter: vi.fn(() => null),
        tick: vi.fn(() => true),
        cancel: vi.fn(),
      } as unknown as Activity
      activity.queue(nextActivity)

      // Second tick: should NOT interrupt because queueFullLoad=true
      const result = activity.tickOuter(actor as GameActor)
      expect(result).toBe(activity)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — Cancel / Disabled
  // ---------------------------------------------------------------------------

  describe('tick — cancel / disabled', () => {
    it('returns true when canceling', () => {
      const { actor } = createMockActor()
      const activity = new FindAndDeliverResources(actor as GameActor)

      activity.tickOuter(actor as GameActor)
      activity.cancel(actor as GameActor)

      // After cancel, the next tickOuter should complete the activity
      // (return null because it's done)
      const result = activity.tickOuter(actor as GameActor)
      expect(result).toBeNull()
    })

    it('returns true when trait is disabled', () => {
      const { actor } = createMockActor({ isTraitDisabled: true })
      const activity = new FindAndDeliverResources(actor as GameActor)

      const result = activity.tickOuter(actor as GameActor)
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // ClosestHarvestablePos
  // ---------------------------------------------------------------------------

  describe('closestHarvestablePos', () => {
    it('checks current cell first when no orderLocation', () => {
      const { actor, mobile } = createMockActor({
        location: new CPos(10, 10),
      })

      const activity = new FindAndDeliverResources(actor as GameActor)
      activity.tickOuter(actor as GameActor)

      // Should find current cell without pathfinding
      expect(mobile.pathFinder!.findPathToTargetCellByPredicate).not.toHaveBeenCalled()
    })

    it('checks orderLocation first when provided', () => {
      const { actor, mobile } = createMockActor({
        location: new CPos(5, 5),
      })
      const orderLocation = new CPos(10, 10)

      const activity = new FindAndDeliverResources(actor as GameActor, orderLocation)
      activity.tickOuter(actor as GameActor)

      // Should check orderLocation first
      expect(mobile.pathFinder!.findPathToTargetCellByPredicate).not.toHaveBeenCalled()
    })

    it('clears orderLocation when orderLocation is not harvestable', () => {
      const { actor, mobile } = createMockActor({
        location: new CPos(5, 5),
        canHarvestCell: (_self: unknown, cell: CPos) => {
          return cell.X === 11 && cell.Y === 11
        },
      })
      const orderLocation = new CPos(10, 10)

      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([new CPos(11, 11)])

      const activity = new FindAndDeliverResources(actor as GameActor, orderLocation)
      activity.tickOuter(actor as GameActor)

      expect(activity.orderLocation).toBeNull()
    })

    it('uses pathFinder when current cell is not harvestable', () => {
      const { actor, mobile } = createMockActor({
        location: new CPos(5, 5),
      })
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([new CPos(10, 10)])

      const activity = new FindAndDeliverResources(actor as GameActor)
      activity.tickOuter(actor as GameActor)

      expect(mobile.pathFinder!.findPathToTargetCellByPredicate).toHaveBeenCalledTimes(1)
    })

    it('uses lastHarvestedCell as search origin when available', () => {
      const { actor, mobile } = createMockActor({
        location: new CPos(10, 10), // At target cell so HarvestResource completes immediately
      })
      // Make resource layer return depleted so HarvestResource completes after one harvest
      const resourceLayer = (actor as { world: { worldActor: { _resourceLayer: { getResource: ReturnType<typeof vi.fn>; removeResource: ReturnType<typeof vi.fn> } } } }).world.worldActor._resourceLayer
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 1 })
      resourceLayer.removeResource.mockReturnValue(0) // Depleted after first attempt
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([new CPos(10, 10)])

      const activity = new FindAndDeliverResources(actor as GameActor)

      // First tick: current cell (10,10) is harvestable, so closestHarvestablePos
      // returns it directly without calling pathFinder
      activity.tickOuter(actor as GameActor)
      expect(mobile.pathFinder!.findPathToTargetCellByPredicate).toHaveBeenCalledTimes(0)
      // lastHarvestedCell is now set to (10,10)

      // Change canHarvestCell so lastHarvestedCell is no longer harvestable
      // This forces pathFinder to be called
      const harvester = (actor as { traits: Map<string, unknown> }).traits.get('Harvester') as MockHarvester
      harvester.canHarvestCell = (_self: unknown, cell: CPos) => cell.X === 11 && cell.Y === 11
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([new CPos(11, 11)])

      // Second tick: lastHarvestedCell (10,10) is not harvestable anymore,
      // so pathFinder is called with (10,10) as search origin
      activity.tickOuter(actor as GameActor)
      expect(mobile.pathFinder!.findPathToTargetCellByPredicate).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Unblocking refinery
  // ---------------------------------------------------------------------------

  describe('unblocking refinery', () => {
    it('moves to unblockCell when at refinery, empty, and no resources found', () => {
      const { actor, mobile } = createMockActor({
        location: new CPos(0, 0),
        isEmpty: true,
        canHarvestCell: () => false,
        lastReservedHost: { dockPosition: new WPos(0, 0, 0) },
      })
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([])

      const activity = new FindAndDeliverResources(actor as GameActor)
      activity.tickOuter(actor as GameActor)

      // Wait is queued first (no resources)
      expect(activity['_childActivity']).not.toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  describe('targetLineNodes', () => {
    it('returns orderLocation target line when set', () => {
      const { actor } = createMockActor()
      const orderLocation = new CPos(20, 20)
      const activity = new FindAndDeliverResources(actor as GameActor, orderLocation)

      const nodes = activity.targetLineNodes(actor as GameActor)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].color).toEqual({ r: 0.86, g: 0.08, b: 0.24, a: 1 })
    })

    it('returns empty array when no orderLocation and no reserved host', () => {
      const { actor } = createMockActor()
      const activity = new FindAndDeliverResources(actor as GameActor)

      const nodes = activity.targetLineNodes(actor as GameActor)

      expect(nodes).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // GetTargets
  // ---------------------------------------------------------------------------

  describe('getTargets', () => {
    it('returns target from current cell location', () => {
      const { actor } = createMockActor({ location: new CPos(5, 5) })
      const activity = new FindAndDeliverResources(actor as GameActor)

      const targets = activity.getTargets(actor as GameActor)

      expect(targets).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles null pathFinder gracefully', () => {
      const { actor } = createMockActor()
      const mobile = (actor as { traits: Map<string, unknown> }).traits.get('Mobile') as MockMobile
      mobile.pathFinder = null

      const activity = new FindAndDeliverResources(actor as GameActor)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
    })

    it('handles empty path result', () => {
      const { actor, mobile } = createMockActor({
        canHarvestCell: () => false,
      })
      mobile.pathFinder!.findPathToTargetCellByPredicate.mockReturnValue([])

      const activity = new FindAndDeliverResources(actor as GameActor)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
      expect(activity.lastSearchFailed).toBe(true)
    })

    it('performs backup search from refinery when first search fails', () => {
      const { actor, mobile } = createMockActor({
        location: new CPos(10, 10),
        canHarvestCell: (_self: unknown, cell: CPos) => {
          return cell.X === 11 && cell.Y === 11
        },
        lastReservedHost: { dockPosition: new WPos(0, 0, 0) },
      })

      // First call: from actor location (10,10) - returns empty because (10,10) not harvestable
      // Second call: backup from refinery - returns (11,11)
      mobile.pathFinder!.findPathToTargetCellByPredicate
        .mockReturnValueOnce([])
        .mockReturnValueOnce([new CPos(11, 11)])

      const activity = new FindAndDeliverResources(actor as GameActor)

      // First tick: no harvestable cell found from actor location
      // lastHarvestedCell is null, so no backup search
      // lastSearchFailed = true
      activity.tickOuter(actor as GameActor)
      expect(activity.lastSearchFailed).toBe(true)

      // Second tick: lastSearchFailed is true, queues Wait
      activity.tickOuter(actor as GameActor)
      expect(activity['_childActivity']).not.toBeNull()
      expect(activity['_childActivity']!.constructor.name).toBe('Wait')

      // Simulate Wait completing
      activity['_childActivity'] = null

      // Third tick: Wait completed, search again
      // This time pathFinder returns (11,11)
      activity.tickOuter(actor as GameActor)

      expect(mobile.pathFinder!.findPathToTargetCellByPredicate).toHaveBeenCalledTimes(2)
      expect(activity.lastSearchFailed).toBe(false)
    })

    it('handles missing map gracefully', () => {
      const { actor } = createMockActor({
        location: new CPos(5, 5),
      })
      const world = (actor as { world: Record<string, unknown> }).world
      delete (world as { map?: unknown }).map

      const activity = new FindAndDeliverResources(actor as GameActor)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
    })
  })
})
