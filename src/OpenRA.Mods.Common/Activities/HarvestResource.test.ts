/**
 * HarvestResource.test.ts — HarvestResource 迁移单元测试
 *
 * 测试重点: 状态管理、收割逻辑、声明管理、取消处理、目标线渲染。
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

import { HarvestResource } from './HarvestResource'
import { ActivityState } from '../../OpenRA.Game/Activities/Activity'
import { CPos } from '../../OpenRA.Game/CPos'
import { WAngle } from '../../OpenRA.Game/WAngle'
import { WPos } from '../../OpenRA.Game/WPos'
import type { GameActor } from '../../OpenRA.Game/Actor'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockHarvester {
  isTraitDisabled: boolean
  isFull: boolean
  canHarvestCell: (self: unknown, cell: CPos) => boolean
  addResource: (self: unknown, type: string) => void
  info: {
    harvestFacings: number
    baleLoadDelay: number
    harvestLineColor: { r: number; g: number; b: number; a: number }
  }
}

interface MockClaimLayer {
  tryClaimCell: ReturnType<typeof vi.fn>
  removeClaim: ReturnType<typeof vi.fn>
  canClaimCell: ReturnType<typeof vi.fn>
}

interface MockResourceLayer {
  getResource: ReturnType<typeof vi.fn>
  removeResource: ReturnType<typeof vi.fn>
}

interface MockNotifyAction {
  movingToResources: ReturnType<typeof vi.fn>
  harvested: ReturnType<typeof vi.fn>
  movementCancelled: ReturnType<typeof vi.fn>
}

interface MockFacing {
  facing: WAngle
  turnSpeed: WAngle
}

interface MockBodyOrientation {
  quantizeFacing: ReturnType<typeof vi.fn>
}

interface MockMove {
  moveTo: ReturnType<typeof vi.fn>
}

interface MockActorResult {
  actor: unknown
  harvester: MockHarvester
  claimLayer: MockClaimLayer
  resourceLayer: MockResourceLayer
  notifyAction: MockNotifyAction
  facing: MockFacing
  bodyOrientation: MockBodyOrientation
}

/** 创建 mock actor。 */
function createMockActor(overrides: {
  location?: CPos
  centerPosition?: WPos
  isTraitDisabled?: boolean
  isFull?: boolean
  canHarvestCell?: (self: unknown, cell: CPos) => boolean
  addResource?: (self: unknown, type: string) => void
  harvestFacings?: number
  baleLoadDelay?: number
  facing?: WAngle
  turnSpeed?: WAngle
  moveTo?: (self: unknown, cell: CPos, nearEnough: number) => unknown
} = {}): MockActorResult {
  const loc = overrides.location ?? new CPos(5, 5)
  const centerPos = overrides.centerPosition ?? new WPos(5 * 1024, 5 * 1024, 0)

  const mockHarvester: MockHarvester = {
    isTraitDisabled: overrides.isTraitDisabled ?? false,
    isFull: overrides.isFull ?? false,
    canHarvestCell: overrides.canHarvestCell ?? vi.fn(() => true),
    addResource: overrides.addResource ?? vi.fn(),
    info: {
      harvestFacings: overrides.harvestFacings ?? 0,
      baleLoadDelay: overrides.baleLoadDelay ?? 4,
      harvestLineColor: { r: 0.86, g: 0.08, b: 0.24, a: 1 },
    },
  }

  const mockClaimLayer: MockClaimLayer = {
    tryClaimCell: vi.fn(() => true),
    removeClaim: vi.fn(),
    canClaimCell: vi.fn(() => true),
  }

  const mockResourceLayer: MockResourceLayer = {
    getResource: vi.fn((cell: CPos) => {
      if (cell.X === 10 && cell.Y === 10) {
        return { type: '', density: 0 }
      }
      return { type: 'Ore', density: 5 }
    }),
    removeResource: vi.fn(() => 1),
  }

  const mockFacing: MockFacing = {
    facing: overrides.facing ?? new WAngle(0),
    turnSpeed: overrides.turnSpeed ?? new WAngle(16),
  }

  const mockBodyOrientation: MockBodyOrientation = {
    quantizeFacing: vi.fn((facing: WAngle, facings: number) => {
      const step = 1024 / facings
      const quantized = Math.round(facing.angle / step) * step
      return new WAngle(quantized % 1024)
    }),
  }

  const mockMove: MockMove = {
    moveTo: overrides.moveTo
      ? vi.fn(overrides.moveTo)
      : vi.fn(() => ({ _mockActivity: true, cancel: vi.fn(), tickOuter: vi.fn(() => true) })),
  }

  const mockNotifyHarvestAction: MockNotifyAction = {
    movingToResources: vi.fn(),
    harvested: vi.fn(),
    movementCancelled: vi.fn(),
  }

  const actor = {
    traits: new Map<string, unknown>([
      ['Harvester', mockHarvester],
      ['HarvesterInfo', mockHarvester.info],
      ['facing', mockFacing],
      ['IFacing', mockFacing],
      ['BodyOrientation', mockBodyOrientation],
      ['Mobile', mockMove],
      ['IMove', mockMove],
      ['NotifyHarvestAction', mockNotifyHarvestAction],
    ]),
    location: loc,
    centerPosition: centerPos,
    world: {
      worldActor: {
        _claimLayer: mockClaimLayer,
        _resourceLayer: mockResourceLayer,
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
    resourceLayer: mockResourceLayer,
    notifyAction: mockNotifyHarvestAction,
    facing: mockFacing,
    bodyOrientation: mockBodyOrientation,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HarvestResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('stores target cell', () => {
      const { actor } = createMockActor()
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      expect(activity.targetCell).toEqual(targetCell)
    })

    it('initializes in Queued state', () => {
      const { actor } = createMockActor()
      const activity = new HarvestResource(actor as GameActor, new CPos(10, 10))

      expect(activity.state).toBe(ActivityState.Queued)
    })
  })

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  describe('onFirstRun', () => {
    it('claims target cell on first run', () => {
      const { actor, claimLayer } = createMockActor()
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      activity.tickOuter(actor as GameActor)

      expect(claimLayer.tryClaimCell).toHaveBeenCalledTimes(1)
      expect(claimLayer.tryClaimCell).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 1 }),
        targetCell,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — Movement to target
  // ---------------------------------------------------------------------------

  describe('tick — movement to target', () => {
    it('queues move child when not at target cell', () => {
      const { actor } = createMockActor({ location: new CPos(5, 5) })
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
      expect(activity['_childActivity']).not.toBeNull()
    })

    it('notifies INotifyHarvestAction when moving to resources', () => {
      const { actor, notifyAction } = createMockActor({ location: new CPos(5, 5) })
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      activity.tickOuter(actor as GameActor)

      expect(notifyAction.movingToResources).toHaveBeenCalledTimes(1)
      expect(notifyAction.movingToResources).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 1 }),
        targetCell,
      )
    })

    it('returns true when already at target cell with no resources', () => {
      const { actor, resourceLayer } = createMockActor({ location: new CPos(10, 10) })
      const targetCell = new CPos(10, 10)
      resourceLayer.getResource.mockReturnValue({ type: '', density: 0 })

      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — Harvesting
  // ---------------------------------------------------------------------------

  describe('tick — harvesting', () => {
    it('harvests resource when at target cell', () => {
      const { actor, harvester, resourceLayer } = createMockActor({ location: new CPos(10, 10) })
      const targetCell = new CPos(10, 10)
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 5 })
      resourceLayer.removeResource.mockReturnValue(1)

      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
      expect(resourceLayer.getResource).toHaveBeenCalledWith(targetCell)
      expect(resourceLayer.removeResource).toHaveBeenCalledWith('Ore', targetCell)
      expect(harvester.addResource).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 1 }),
        'Ore',
      )
    })

    it('notifies INotifyHarvestAction when harvested', () => {
      const { actor, notifyAction, resourceLayer } = createMockActor({ location: new CPos(10, 10) })
      const targetCell = new CPos(10, 10)
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 5 })
      resourceLayer.removeResource.mockReturnValue(1)

      const activity = new HarvestResource(actor as GameActor, targetCell)
      activity.tickOuter(actor as GameActor)

      expect(notifyAction.harvested).toHaveBeenCalledTimes(1)
      expect(notifyAction.harvested).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 1 }),
        'Ore',
      )
    })

    it('queues Wait child with baleLoadDelay after harvest', () => {
      const { actor, resourceLayer } = createMockActor({ location: new CPos(10, 10) })
      const targetCell = new CPos(10, 10)
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 5 })
      resourceLayer.removeResource.mockReturnValue(1)

      const activity = new HarvestResource(actor as GameActor, targetCell)
      activity.tickOuter(actor as GameActor)

      const child = activity['_childActivity']
      expect(child).not.toBeNull()
      expect(child!.constructor.name).toBe('Wait')
    })

    it('returns true when cell is depleted (removeResource returns 0)', () => {
      const { actor, resourceLayer } = createMockActor({ location: new CPos(10, 10) })
      const targetCell = new CPos(10, 10)
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 1 })
      resourceLayer.removeResource.mockReturnValue(0)

      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBeNull()
    })

    it('returns true when cell has no resource type', () => {
      const { actor, resourceLayer } = createMockActor({ location: new CPos(10, 10) })
      const targetCell = new CPos(10, 10)
      resourceLayer.getResource.mockReturnValue({ type: '', density: 0 })

      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — Facing adjustment
  // ---------------------------------------------------------------------------

  describe('tick — facing adjustment', () => {
    it('queues Turn child when facing mismatch and harvestFacings > 0', () => {
      const { actor, bodyOrientation } = createMockActor({
        location: new CPos(10, 10),
        harvestFacings: 8,
        facing: new WAngle(100),
      })
      const targetCell = new CPos(10, 10)
      bodyOrientation.quantizeFacing.mockReturnValue(new WAngle(128))

      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBe(activity)
      const child = activity['_childActivity']
      expect(child).not.toBeNull()
      expect(child!.constructor.name).toBe('Turn')
    })

    it('does not queue Turn when facing already matches', () => {
      const { actor, bodyOrientation, resourceLayer } = createMockActor({
        location: new CPos(10, 10),
        harvestFacings: 8,
        facing: new WAngle(128),
      })
      const targetCell = new CPos(10, 10)
      bodyOrientation.quantizeFacing.mockReturnValue(new WAngle(128))
      // Make sure the cell has resources
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 5 })
      resourceLayer.removeResource.mockReturnValue(1)

      const activity = new HarvestResource(actor as GameActor, targetCell)
      activity.tickOuter(actor as GameActor)

      const child = activity['_childActivity']
      expect(child).not.toBeNull()
      expect(child!.constructor.name).toBe('Wait')
    })

    it('skips facing check when harvestFacings is 0', () => {
      const { actor, bodyOrientation } = createMockActor({
        location: new CPos(10, 10),
        harvestFacings: 0,
      })
      const targetCell = new CPos(10, 10)

      const activity = new HarvestResource(actor as GameActor, targetCell)
      activity.tickOuter(actor as GameActor)

      expect(bodyOrientation.quantizeFacing).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Tick — Full / Cancel / Disabled
  // ---------------------------------------------------------------------------

  describe('tick — full / cancel / disabled', () => {
    it('returns true when harvester is full', () => {
      const { actor } = createMockActor({
        location: new CPos(10, 10),
        isFull: true,
      })
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBeNull()
    })

    it('completes immediately when trait is disabled', () => {
      const { actor } = createMockActor({
        location: new CPos(10, 10),
        isTraitDisabled: true,
      })
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      // Activity completes (returns null) when trait is disabled
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  describe('cancel', () => {
    it('notifies INotifyHarvestAction of movement cancellation', () => {
      const { actor, notifyAction } = createMockActor()
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      activity.tickOuter(actor as GameActor)
      activity.cancel(actor as GameActor)

      expect(notifyAction.movementCancelled).toHaveBeenCalledTimes(1)
      expect(notifyAction.movementCancelled).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 1 }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // OnLastRun
  // ---------------------------------------------------------------------------

  describe('onLastRun', () => {
    it('removes claim when activity completes', () => {
      const { actor, claimLayer, resourceLayer } = createMockActor({ location: new CPos(10, 10) })
      const targetCell = new CPos(10, 10)
      resourceLayer.getResource.mockReturnValue({ type: '', density: 0 })

      const activity = new HarvestResource(actor as GameActor, targetCell)
      activity.tickOuter(actor as GameActor)

      expect(claimLayer.removeClaim).toHaveBeenCalledTimes(1)
      expect(claimLayer.removeClaim).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 1 }),
      )
    })
  })

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  describe('targetLineNodes', () => {
    it('returns target line to harvest cell', () => {
      const { actor } = createMockActor()
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      const nodes = activity.targetLineNodes(actor as GameActor)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].color).toEqual({ r: 0.86, g: 0.08, b: 0.24, a: 1 })
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles actor without location property', () => {
      const { actor } = createMockActor()
      // Remove location
      const actorObj = actor as Record<string, unknown>
      delete actorObj.location

      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      const result = activity.tickOuter(actor as GameActor)
      expect(result).toBe(activity)
    })

    it('handles cell not harvestable', () => {
      const { actor } = createMockActor({
        location: new CPos(10, 10),
        canHarvestCell: () => false,
      })
      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)
      const result = activity.tickOuter(actor as GameActor)

      expect(result).toBeNull()
    })

    it('handles missing move trait gracefully', () => {
      const { actor } = createMockActor({ location: new CPos(5, 5) })
      const traits = (actor as { traits: Map<string, unknown> }).traits
      traits.delete('Mobile')
      traits.delete('IMove')

      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      const result = activity.tickOuter(actor as GameActor)
      expect(result).toBe(activity)
    })

    it('handles missing facing trait when harvestFacings > 0', () => {
      const { actor, resourceLayer } = createMockActor({
        location: new CPos(10, 10),
        harvestFacings: 8,
      })
      const traits = (actor as { traits: Map<string, unknown> }).traits
      traits.delete('facing')
      traits.delete('IFacing')
      // Make sure the cell has resources
      resourceLayer.getResource.mockReturnValue({ type: 'Ore', density: 5 })
      resourceLayer.removeResource.mockReturnValue(1)

      const targetCell = new CPos(10, 10)
      const activity = new HarvestResource(actor as GameActor, targetCell)

      const result = activity.tickOuter(actor as GameActor)
      // Should proceed to harvest (skips facing check when facing is null)
      // and queue Wait child
      expect(result).toBe(activity)
      expect(activity['_childActivity']).not.toBeNull()
    })
  })
})
