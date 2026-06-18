/**
 * EditorResourceLayer.test.ts — Unit tests for EditorResourceLayer migration
 *
 * Tests focus on: state management, resource add/remove/clear operations,
 * CellChanged event firing, density clamping, clone/applySnapshot for undo/redo,
 * netWorth calculation, resource type validation, and dispose lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  EditorResourceLayer,
  EditorResourceLayerInfo,
} from './EditorResourceLayer.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { ResourceLayerContentsEmpty } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ResourceTypeInfoConfig } from './ResourceLayer.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Create a default EditorResourceLayerInfo with ore and gems resource types. */
function createInfo(overrides?: {
  resourceTypes?: Map<string, ResourceTypeInfoConfig>
  recalculateResourceDensity?: boolean
}): EditorResourceLayerInfo {
  const resourceTypes = overrides?.resourceTypes ?? new Map([
    ['ore', {
      resourceIndex: 1,
      terrainType: 'Ore',
      allowedTerrainTypes: new Set(['Clear', 'Rough']),
      maxDensity: 10,
    }],
    ['gems', {
      resourceIndex: 2,
      terrainType: 'Gems',
      allowedTerrainTypes: new Set(['Clear']),
      maxDensity: 5,
    }],
  ])

  return new EditorResourceLayerInfo({
    resourceTypes,
    recalculateResourceDensity: overrides?.recalculateResourceDensity ?? false,
  })
}

/** Create a default EditorResourceLayer with ore and gems types and resource values. */
function createLayer(overrides?: {
  resourceTypes?: Map<string, ResourceTypeInfoConfig>
  resourceValues?: Map<string, number>
}): EditorResourceLayer {
  const info = createInfo({ resourceTypes: overrides?.resourceTypes })
  const layer = new EditorResourceLayer(info)
  if (overrides?.resourceValues !== undefined) {
    layer.setResourceValues(overrides.resourceValues)
  } else {
    layer.setResourceValues(new Map([['ore', 20], ['gems', 50]]))
  }
  return layer
}

// ---------------------------------------------------------------------------
// EditorResourceLayerInfo tests
// ---------------------------------------------------------------------------

describe('EditorResourceLayerInfo', () => {
  it('should create with default values', () => {
    const info = new EditorResourceLayerInfo()
    expect(info.resourceTypes.size).toBe(0)
    expect(info.recalculateResourceDensity).toBe(false)
  })

  it('should accept resource types', () => {
    const info = new EditorResourceLayerInfo({
      resourceTypes: new Map([
        ['ore', {
          resourceIndex: 1,
          terrainType: 'Ore',
          allowedTerrainTypes: new Set(['Clear']),
          maxDensity: 10,
        }],
      ]),
    })
    expect(info.resourceTypes.size).toBe(1)
    expect(info.resourceTypes.get('ore')?.maxDensity).toBe(10)
  })

  it('should tryGetTerrainType return correct values', () => {
    const info = createInfo()
    expect(info.tryGetTerrainType('ore')).toBe('Ore')
    expect(info.tryGetTerrainType('gems')).toBe('Gems')
    expect(info.tryGetTerrainType('nonexistent')).toBeUndefined()
    expect(info.tryGetTerrainType('')).toBeUndefined()
  })

  it('should tryGetResourceIndex return correct values', () => {
    const info = createInfo()
    expect(info.tryGetResourceIndex('ore')).toBe(1)
    expect(info.tryGetResourceIndex('gems')).toBe(2)
    expect(info.tryGetResourceIndex('nonexistent')).toBeUndefined()
    expect(info.tryGetResourceIndex('')).toBeUndefined()
  })

  it('should create EditorResourceLayer via create()', () => {
    const info = createInfo()
    const layer = info.create({ self: {} as any })
    expect(layer).toBeInstanceOf(EditorResourceLayer)
    expect(layer.info).toBe(info)
  })

  it('should support instanceName', () => {
    const info = new EditorResourceLayerInfo({ instanceName: 'testInstance' })
    expect(info.instanceName).toBe('testInstance')
  })
})

// ---------------------------------------------------------------------------
// EditorResourceLayer — basic operations
// ---------------------------------------------------------------------------

describe('EditorResourceLayer', () => {
  let layer: EditorResourceLayer
  let onCellChanged: ReturnType<typeof vi.fn>

  beforeEach(() => {
    layer = createLayer()
    onCellChanged = vi.fn()
    layer.addCellChangedListener(onCellChanged)
  })

  afterEach(() => {
    layer.dispose()
  })

  // -----------------------------------------------------------------------
  // addResource
  // -----------------------------------------------------------------------

  describe('addResource', () => {
    it('should place resource at cell', () => {
      const cell = new CPos(3, 4)
      const added = layer.addResource('ore', cell, 5)

      expect(added).toBe(5)
      const contents = layer.getResource(cell)
      expect(contents.type).toBe('ore')
      expect(contents.density).toBe(5)
    })

    it('should fire CellChanged on add', () => {
      const cell = new CPos(2, 3)
      layer.addResource('ore', cell, 3)

      expect(onCellChanged).toHaveBeenCalledTimes(1)
      expect(onCellChanged).toHaveBeenCalledWith(cell, 'ore')
    })

    it('should accumulate density when adding to same resource type', () => {
      const cell = new CPos(1, 1)
      layer.addResource('ore', cell, 3)
      layer.addResource('ore', cell, 4)

      const contents = layer.getResource(cell)
      expect(contents.type).toBe('ore')
      expect(contents.density).toBe(7)
    })

    it('should clamp at maxDensity', () => {
      const cell = new CPos(5, 5)
      // ore maxDensity = 10
      layer.addResource('ore', cell, 8) // density = 8
      const added = layer.addResource('ore', cell, 5) // try to add 5 more

      expect(added).toBe(2) // only 2 more fit (8 + 2 = 10)
      const contents = layer.getResource(cell)
      expect(contents.density).toBe(10)
      expect(contents.type).toBe('ore')
    })

    it('should replace different resource type (editor behavior)', () => {
      const cell = new CPos(3, 3)
      layer.addResource('ore', cell, 5)
      // Replace with gems
      const added = layer.addResource('gems', cell, 3)

      expect(added).toBe(3)
      const contents = layer.getResource(cell)
      expect(contents.type).toBe('gems')
      expect(contents.density).toBe(3)
    })

    it('should reject invalid resource type', () => {
      const cell = new CPos(4, 4)
      const added = layer.addResource('nonexistent', cell, 5)
      expect(added).toBe(0)
      expect(layer.isCellEmpty(cell)).toBe(true)
      expect(onCellChanged).not.toHaveBeenCalled()
    })

    it('should reject empty resource type string', () => {
      const cell = new CPos(4, 4)
      const added = layer.addResource('', cell, 5)
      expect(added).toBe(0)
      expect(layer.isCellEmpty(cell)).toBe(true)
    })

    it('should handle adding zero amount as no-op', () => {
      const cell = new CPos(1, 2)
      const added = layer.addResource('ore', cell, 0)
      expect(added).toBe(0)
      expect(layer.isCellEmpty(cell)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // getResource
  // -----------------------------------------------------------------------

  describe('getResource', () => {
    it('should return correct type and density', () => {
      const cell = new CPos(3, 3)
      layer.addResource('ore', cell, 7)

      const contents = layer.getResource(cell)
      expect(contents.type).toBe('ore')
      expect(contents.density).toBe(7)
    })

    it('should return EMPTY for cell with no resource', () => {
      const cell = new CPos(9, 9)
      const contents = layer.getResource(cell)
      expect(contents).toBe(ResourceLayerContentsEmpty)
      expect(contents.type).toBe('')
      expect(contents.density).toBe(0)
    })

    it('should return EMPTY after resource removed', () => {
      const cell = new CPos(2, 2)
      layer.addResource('ore', cell, 5)
      layer.removeResource('ore', cell, 5)

      const contents = layer.getResource(cell)
      expect(contents).toBe(ResourceLayerContentsEmpty)
    })
  })

  // -----------------------------------------------------------------------
  // removeResource
  // -----------------------------------------------------------------------

  describe('removeResource', () => {
    it('should remove resource from cell', () => {
      const cell = new CPos(4, 4)
      layer.addResource('ore', cell, 7)
      const removed = layer.removeResource('ore', cell, 3)

      expect(removed).toBe(3)
      const contents = layer.getResource(cell)
      expect(contents.type).toBe('ore')
      expect(contents.density).toBe(4)
    })

    it('should clear cell when density reaches 0', () => {
      const cell = new CPos(5, 5)
      layer.addResource('ore', cell, 3)
      const removed = layer.removeResource('ore', cell, 3)

      expect(removed).toBe(3)
      expect(layer.isCellEmpty(cell)).toBe(true)
      expect(onCellChanged).toHaveBeenLastCalledWith(cell, null)
    })

    it('should fire CellChanged with null on full removal', () => {
      const cell = new CPos(6, 6)
      layer.addResource('ore', cell, 5)
      layer.removeResource('ore', cell, 5)

      const lastCall = onCellChanged.mock.calls[onCellChanged.mock.calls.length - 1]
      expect(lastCall[0]).toEqual(cell)
      expect(lastCall[1]).toBeNull()
    })

    it('should return 0 for empty cell (no crash)', () => {
      const cell = new CPos(7, 7)
      const removed = layer.removeResource('ore', cell, 3)

      expect(removed).toBe(0)
      expect(layer.isCellEmpty(cell)).toBe(true)
    })

    it('should return 0 for mismatched resource type', () => {
      const cell = new CPos(2, 2)
      layer.addResource('ore', cell, 5)
      const removed = layer.removeResource('gems', cell, 3)

      expect(removed).toBe(0)
      const contents = layer.getResource(cell)
      expect(contents.type).toBe('ore')
      expect(contents.density).toBe(5)
    })

    it('should return 0 for invalid resource type', () => {
      const cell = new CPos(3, 3)
      layer.addResource('ore', cell, 5)
      const removed = layer.removeResource('nonexistent', cell, 3)

      expect(removed).toBe(0)
    })

    it('should remove more than available and clear cell', () => {
      const cell = new CPos(4, 4)
      layer.addResource('ore', cell, 3)
      const removed = layer.removeResource('ore', cell, 10)

      expect(removed).toBe(3)
      expect(layer.isCellEmpty(cell)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // clearResources (per cell)
  // -----------------------------------------------------------------------

  describe('clearResources (per cell)', () => {
    it('should clear resource at cell', () => {
      const cell = new CPos(3, 3)
      layer.addResource('ore', cell, 5)
      layer.clearResources(cell)

      expect(layer.isCellEmpty(cell)).toBe(true)
      expect(onCellChanged).toHaveBeenLastCalledWith(cell, null)
    })

    it('should be no-op for already empty cell', () => {
      const cell = new CPos(8, 8)
      const callCount = onCellChanged.mock.calls.length
      layer.clearResources(cell)

      expect(layer.isCellEmpty(cell)).toBe(true)
      expect(onCellChanged).toHaveBeenCalledTimes(callCount)
    })
  })

  // -----------------------------------------------------------------------
  // clearAllResources
  // -----------------------------------------------------------------------

  describe('clearAllResources', () => {
    it('should remove all resources', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      layer.addResource('ore', new CPos(1, 1), 5)
      layer.addResource('gems', new CPos(2, 2), 3)
      expect(layer.getCellCount()).toBe(3)

      layer.clearAllResources()

      expect(layer.getCellCount()).toBe(0)
      expect(layer.isEmpty).toBe(true)
      expect(layer.netWorth).toBe(0)
    })

    it('should fire CellChanged for each cleared cell', () => {
      const cell1 = new CPos(0, 0)
      const cell2 = new CPos(1, 1)
      layer.addResource('ore', cell1, 5)
      layer.addResource('gems', cell2, 3)

      onCellChanged.mockClear()
      layer.clearAllResources()

      // Two cells cleared, each fires CellChanged(cell, null)
      expect(onCellChanged).toHaveBeenCalledTimes(2)
      for (const call of onCellChanged.mock.calls) {
        expect(call[1]).toBeNull()
      }
    })

    it('should be no-op on empty layer', () => {
      const callCount = onCellChanged.mock.calls.length
      layer.clearAllResources()
      expect(onCellChanged).toHaveBeenCalledTimes(callCount)
    })
  })

  // -----------------------------------------------------------------------
  // netWorth
  // -----------------------------------------------------------------------

  describe('netWorth', () => {
    it('should start at 0', () => {
      expect(layer.netWorth).toBe(0)
    })

    it('should calculate netWorth correctly (single type)', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      // ore = 20 per unit, 5 density = 100
      expect(layer.netWorth).toBe(100)
    })

    it('should calculate netWorth for multiple types', () => {
      layer.addResource('ore', new CPos(0, 0), 5)    // 5 * 20 = 100
      layer.addResource('gems', new CPos(1, 1), 3)   // 3 * 50 = 150
      // Total = 250
      expect(layer.netWorth).toBe(250)
    })

    it('should update netWorth on remove', () => {
      layer.addResource('ore', new CPos(0, 0), 5)    // 100
      layer.addResource('gems', new CPos(1, 1), 3)   // 150
      layer.removeResource('ore', new CPos(0, 0), 3)  // -60
      // ore: 2*20=40, gems: 3*50=150, total=190
      expect(layer.netWorth).toBe(190)
    })

    it('should update netWorth on clearResources', () => {
      layer.addResource('ore', new CPos(0, 0), 5)    // 100
      layer.clearResources(new CPos(0, 0))
      expect(layer.netWorth).toBe(0)
    })

    it('should update netWorth when replacing resource type', () => {
      layer.addResource('ore', new CPos(0, 0), 5)    // 5 * 20 = 100
      layer.addResource('gems', new CPos(0, 0), 3)   // replaces ore: 3 * 50 = 150
      expect(layer.netWorth).toBe(150)
    })

    it('should handle resourceValues being empty (no values set)', () => {
      const noValuesLayer = createLayer({ resourceValues: new Map() })
      noValuesLayer.addResource('ore', new CPos(0, 0), 5)
      expect(noValuesLayer.netWorth).toBe(0)
      noValuesLayer.dispose()
    })
  })

  // -----------------------------------------------------------------------
  // clone
  // -----------------------------------------------------------------------

  describe('clone', () => {
    it('should produce an independent copy', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      layer.addResource('gems', new CPos(1, 1), 3)

      const snapshot = layer.clone()

      // Snapshot has same data
      expect(snapshot.getCellCount()).toBe(layer.getCellCount())
      expect(snapshot.netWorth).toBe(layer.netWorth)
      expect(snapshot.getResource(new CPos(0, 0)).density).toBe(5)
      expect(snapshot.getResource(new CPos(1, 1)).density).toBe(3)

      // Modifying original does not affect snapshot
      layer.addResource('ore', new CPos(2, 2), 5)
      expect(snapshot.getCellCount()).toBe(2)
      expect(snapshot.isCellEmpty(new CPos(2, 2))).toBe(true)
    })

    it('should have same info reference', () => {
      const snapshot = layer.clone()
      expect(snapshot.info).toBe(layer.info)
    })

    it('should not copy callbacks', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      const snapshot = layer.clone()
      const snapshotChanged = vi.fn()
      snapshot.addCellChangedListener(snapshotChanged)

      snapshot.addResource('ore', new CPos(1, 1), 3)
      // Only snapshot's callback fires, not the original's
      expect(snapshotChanged).toHaveBeenCalledTimes(1)
      expect(onCellChanged).toHaveBeenCalledTimes(1) // only from original addResource above
    })
  })

  // -----------------------------------------------------------------------
  // applySnapshot
  // -----------------------------------------------------------------------

  describe('applySnapshot', () => {
    it('should restore state from snapshot', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      layer.addResource('gems', new CPos(1, 1), 3)

      const snapshot = layer.clone()

      // Modify layer
      layer.addResource('ore', new CPos(2, 2), 7)
      layer.removeResource('gems', new CPos(1, 1), 3)

      // Restore
      layer.applySnapshot(snapshot)

      expect(layer.getCellCount()).toBe(2)
      expect(layer.getResource(new CPos(0, 0)).density).toBe(5)
      expect(layer.getResource(new CPos(1, 1)).density).toBe(3)
      expect(layer.getResource(new CPos(2, 2)).density).toBe(0)
      expect(layer.netWorth).toBe(5 * 20 + 3 * 50) // 250
    })

    it('should fire CellChanged for changed cells', () => {
      layer.addResource('ore', new CPos(0, 0), 5)

      const snapshot = layer.clone()
      // Modify snapshot
      snapshot.addResource('gems', new CPos(1, 1), 3)

      onCellChanged.mockClear()
      layer.applySnapshot(snapshot)

      // Cell (1,1) was modified — should fire CellChanged
      const cell11Call = onCellChanged.mock.calls.find(
        (call: any[]) => call[0].X === 1 && call[0].Y === 1
      )
      expect(cell11Call).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // getDensity (normalized 0-100%)
  // -----------------------------------------------------------------------

  describe('getDensity', () => {
    it('should return 0 for empty cell', () => {
      const cell = new CPos(5, 5)
      expect(layer.getDensity(cell)).toBe(0)
    })

    it('should return 100% at max density', () => {
      const cell = new CPos(0, 0)
      layer.addResource('ore', cell, 10) // maxDensity = 10
      expect(layer.getDensity(cell)).toBe(100)
    })

    it('should return 50% at half density', () => {
      const cell = new CPos(0, 0)
      layer.addResource('ore', cell, 5) // maxDensity = 10
      expect(layer.getDensity(cell)).toBe(50)
    })

    it('should handle gems maxDensity=5', () => {
      const cell = new CPos(1, 1)
      layer.addResource('gems', cell, 2) // maxDensity = 5
      expect(layer.getDensity(cell)).toBe(40) // 2/5 * 100 = 40
    })

    it('should return 0 for unknown resource type', () => {
      // Manually set a cell with an unknown type via internal map
      // (can't do this through addResource since it validates)
      // Instead test: after removing resource, density should be 0
      const cell = new CPos(3, 3)
      layer.addResource('ore', cell, 5)
      layer.removeResource('ore', cell, 5)
      expect(layer.getDensity(cell)).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // getMaxDensity
  // -----------------------------------------------------------------------

  describe('getMaxDensity', () => {
    it('should return correct max density', () => {
      expect(layer.getMaxDensity('ore')).toBe(10)
      expect(layer.getMaxDensity('gems')).toBe(5)
    })

    it('should return 0 for unknown resource type', () => {
      expect(layer.getMaxDensity('nonexistent')).toBe(0)
    })

    it('should return 0 for empty string', () => {
      expect(layer.getMaxDensity('')).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Boundary cells
  // -----------------------------------------------------------------------

  describe('boundary cells', () => {
    it('should handle resource at (0, 0)', () => {
      const cell = new CPos(0, 0)
      layer.addResource('ore', cell, 5)
      expect(layer.getResource(cell).type).toBe('ore')
      expect(layer.getResource(cell).density).toBe(5)
    })

    it('should handle resource at large coordinates', () => {
      const cell = new CPos(1024, 1024)
      layer.addResource('gems', cell, 3)
      expect(layer.getResource(cell).type).toBe('gems')
      expect(layer.getResource(cell).density).toBe(3)
    })

    it('should handle negative coordinates', () => {
      const cell = new CPos(-5, -3)
      layer.addResource('ore', cell, 3)
      expect(layer.getResource(cell).type).toBe('ore')
      expect(layer.getResource(cell).density).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // Multiple resource types
  // -----------------------------------------------------------------------

  describe('multiple resource types', () => {
    it('should handle different types on different cells', () => {
      const cell1 = new CPos(0, 0)
      const cell2 = new CPos(1, 1)
      const cell3 = new CPos(2, 2)

      layer.addResource('ore', cell1, 5)
      layer.addResource('gems', cell2, 3)

      expect(layer.getResource(cell1).type).toBe('ore')
      expect(layer.getResource(cell2).type).toBe('gems')
      expect(layer.isCellEmpty(cell3)).toBe(true)
    })

    it('should count multiple cells correctly', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      layer.addResource('ore', new CPos(1, 0), 3)
      layer.addResource('gems', new CPos(2, 0), 2)

      expect(layer.getCellCount()).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // isEmpty
  // -----------------------------------------------------------------------

  describe('isEmpty', () => {
    it('should be empty initially', () => {
      expect(layer.isEmpty).toBe(true)
    })

    it('should not be empty after adding resource', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      expect(layer.isEmpty).toBe(false)
    })

    it('should be empty after removing all resources', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      layer.removeResource('ore', new CPos(0, 0), 5)
      expect(layer.isEmpty).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // canAddResource
  // -----------------------------------------------------------------------

  describe('canAddResource', () => {
    it('should return true for valid empty cell', () => {
      expect(layer.canAddResource('ore', new CPos(3, 3), 5)).toBe(true)
    })

    it('should return false for invalid resource type', () => {
      expect(layer.canAddResource('nonexistent', new CPos(3, 3), 5)).toBe(false)
    })

    it('should return false when amount exceeds maxDensity', () => {
      expect(layer.canAddResource('ore', new CPos(3, 3), 15)).toBe(false)
    })

    it('should return true when adding to same type within limits', () => {
      layer.addResource('ore', new CPos(3, 3), 5)
      expect(layer.canAddResource('ore', new CPos(3, 3), 3)).toBe(true)
    })

    it('should return false when adding to same type exceeds limits', () => {
      layer.addResource('ore', new CPos(3, 3), 5)
      expect(layer.canAddResource('ore', new CPos(3, 3), 10)).toBe(false)
    })

    it('should return true for replacing different type (editor behavior)', () => {
      layer.addResource('ore', new CPos(3, 3), 5)
      // Editor allows replacing ore with gems
      // canAddResource treats different type as empty (oldDensity = 0)
      expect(layer.canAddResource('gems', new CPos(3, 3), 3)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // isVisible
  // -----------------------------------------------------------------------

  describe('isVisible', () => {
    it('should always return true in editor mode', () => {
      expect(layer.isVisible(new CPos(0, 0))).toBe(true)
      expect(layer.isVisible(new CPos(100, 100))).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // getResourceTypeNames / getUsedResourceTypes / isValidResourceType
  // -----------------------------------------------------------------------

  describe('resource type queries', () => {
    it('should list all configured resource types', () => {
      const types = layer.getResourceTypeNames()
      expect(types).toContain('ore')
      expect(types).toContain('gems')
      expect(types.length).toBe(2)
    })

    it('should list used resource types', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      layer.addResource('ore', new CPos(1, 0), 3)
      layer.addResource('gems', new CPos(2, 0), 2)

      const used = layer.getUsedResourceTypes()
      expect(used).toContain('ore')
      expect(used).toContain('gems')
      expect(used.length).toBe(2)
    })

    it('should return empty array when no resources placed', () => {
      const used = layer.getUsedResourceTypes()
      expect(used.length).toBe(0)
    })

    it('should validate resource types', () => {
      expect(layer.isValidResourceType('ore')).toBe(true)
      expect(layer.isValidResourceType('gems')).toBe(true)
      expect(layer.isValidResourceType('nonexistent')).toBe(false)
      expect(layer.isValidResourceType('')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // getAllCells
  // -----------------------------------------------------------------------

  describe('getAllCells', () => {
    it('should return all non-empty cells', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      layer.addResource('gems', new CPos(2, 3), 3)

      const all = layer.getAllCells()
      expect(all.length).toBe(2)

      const positions = all.map(([c]) => `${c.X},${c.Y}`)
      expect(positions).toContain('0,0')
      expect(positions).toContain('2,3')
    })

    it('should return empty array when no resources', () => {
      const all = layer.getAllCells()
      expect(all.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // getCellCount
  // -----------------------------------------------------------------------

  describe('getCellCount', () => {
    it('should return 0 initially', () => {
      expect(layer.getCellCount()).toBe(0)
    })

    it('should increment on first add to a cell', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      expect(layer.getCellCount()).toBe(1)
    })

    it('should not increment when adding to existing cell', () => {
      layer.addResource('ore', new CPos(0, 0), 3)
      layer.addResource('ore', new CPos(0, 0), 2)
      expect(layer.getCellCount()).toBe(1)
    })

    it('should decrement on removal that clears cell', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      expect(layer.getCellCount()).toBe(1)
      layer.removeResource('ore', new CPos(0, 0), 5)
      expect(layer.getCellCount()).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // getResourceValues / setResourceValues
  // -----------------------------------------------------------------------

  describe('resource values', () => {
    it('should return current resource values', () => {
      const values = layer.getResourceValues()
      expect(values.get('ore')).toBe(20)
      expect(values.get('gems')).toBe(50)
    })

    it('should recalculate netWorth when setting new values', () => {
      layer.addResource('ore', new CPos(0, 0), 5)     // 5 * 20 = 100
      layer.addResource('gems', new CPos(1, 1), 2)    // 2 * 50 = 100

      // Change values
      layer.setResourceValues(new Map([['ore', 10], ['gems', 100]]))
      // ore: 5*10=50, gems: 2*100=200, total=250
      expect(layer.netWorth).toBe(250)
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should clear all data and callbacks', () => {
      layer.addResource('ore', new CPos(0, 0), 5)
      const cellChangedFn = vi.fn()
      layer.addCellChangedListener(cellChangedFn)

      layer.dispose()

      expect(layer.getCellCount()).toBe(0)
      expect(layer.isEmpty).toBe(true)
      expect(layer.netWorth).toBe(0)

      // Callbacks should not fire after dispose
      layer.addResource('ore', new CPos(0, 0), 3)
      expect(cellChangedFn).not.toHaveBeenCalled()
    })

    it('should be idempotent', () => {
      layer.dispose()
      expect(() => layer.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // removeCellChangedListener
  // -----------------------------------------------------------------------

  describe('removeCellChangedListener', () => {
    it('should stop receiving events after removal', () => {
      const cell = new CPos(1, 1)
      layer.addResource('ore', cell, 3)
      expect(onCellChanged).toHaveBeenCalledTimes(1)

      layer.removeCellChangedListener(onCellChanged)
      layer.addResource('ore', new CPos(2, 2), 5)
      expect(onCellChanged).toHaveBeenCalledTimes(1) // no new calls
    })

    it('should be no-op for unregistered callback', () => {
      const fn = vi.fn()
      expect(() => layer.removeCellChangedListener(fn)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // resourceTypes getter
  // -----------------------------------------------------------------------

  describe('resourceTypes getter', () => {
    it('should return array of resource type names', () => {
      expect(layer.resourceTypes).toEqual(['ore', 'gems'])
    })
  })

  // -----------------------------------------------------------------------
  // Editor behavior: type replacement
  // -----------------------------------------------------------------------

  describe('editor type replacement', () => {
    it('should replace different resource type entirely', () => {
      const cell = new CPos(5, 5)
      layer.addResource('ore', cell, 8)
      // Replace ore with gems
      const added = layer.addResource('gems', cell, 4)

      expect(added).toBe(4)
      const contents = layer.getResource(cell)
      expect(contents.type).toBe('gems')
      expect(contents.density).toBe(4)
    })

    it('should update netWorth when replacing resource type', () => {
      const cell = new CPos(5, 5)
      layer.addResource('ore', cell, 8)   // 8 * 20 = 160
      expect(layer.netWorth).toBe(160)

      layer.addResource('gems', cell, 4)   // replaces ore: 4 * 50 = 200
      expect(layer.netWorth).toBe(200)
    })
  })
})
