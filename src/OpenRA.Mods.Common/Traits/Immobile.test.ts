/**
 * Immobile.test.ts — Unit tests for Immobile trait migration
 *
 * Tests focus on: state management, occupied cells computation,
 * lifecycle notifications, and IOccupySpace interface compliance.
 */

import { describe, it, expect, vi } from 'vitest'
import { Immobile, ImmobileInfo } from './Immobile.js'
import { SubCell } from '../../OpenRA.Game/Traits/SubCell.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  IOccupySpace,
  WorldStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock IGameActor with an optional world. */
function createMockActor(overrides?: { world?: Partial<WorldStub> & Record<string, unknown> }): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    world: overrides?.world as WorldStub | undefined,
    owner: undefined,
    info: undefined,
  }
}

/**
 * Compute the center-of-cell WPos for a CPos using the rectangular grid formula.
 * Matches Map.centerOfCell() for Rectangular grids:
 *   new WPos(1024 * X + 512, 1024 * Y + 512, 0)
 */
function centerOfCell(cpos: CPos): WPos {
  return new WPos(1024 * cpos.X + 512, 1024 * cpos.Y + 512, 0)
}

// ---------------------------------------------------------------------------
// ImmobileInfo tests
// ---------------------------------------------------------------------------

describe('ImmobileInfo', () => {
  it('has default occupiesSpace = true', () => {
    const info = new ImmobileInfo()
    expect(info.occupiesSpace).toBe(true)
  })

  it('accepts custom occupiesSpace = false', () => {
    const info = new ImmobileInfo({ occupiesSpace: false })
    expect(info.occupiesSpace).toBe(false)
  })

  it('accepts instanceName', () => {
    const info = new ImmobileInfo({ instanceName: 'myImmobile' })
    expect(info.instanceName).toBe('myImmobile')
  })

  describe('occupiedCells', () => {
    it('returns single FullCell when occupiesSpace = true', () => {
      const info = new ImmobileInfo({ occupiesSpace: true })
      const location = new CPos(5, 3)
      const result = info.occupiedCells(
        { name: 'testActor' },
        location,
        SubCell.Any,
      )
      expect(result.size).toBe(1)
      const entry = [...result.entries()][0]!
      expect(CPos.equals(entry[0], location)).toBe(true)
      expect(entry[1]).toBe(SubCell.FullCell)
    })

    it('returns empty when occupiesSpace = false', () => {
      const info = new ImmobileInfo({ occupiesSpace: false })
      const location = new CPos(5, 3)
      const result = info.occupiedCells(
        { name: 'testActor' },
        location,
      )
      expect(result.size).toBe(0)
    })

    it('ignores subCell parameter (always returns FullCell)', () => {
      const info = new ImmobileInfo({ occupiesSpace: true })
      const location = new CPos(10, 20)
      // Pass SubCell.First — should still get FullCell
      const result = info.occupiedCells(
        { name: 'testActor' },
        location,
        SubCell.First,
      )
      expect(result.get(location)).toBe(SubCell.FullCell)
    })
  })

  it('sharesCell is always false', () => {
    const info1 = new ImmobileInfo()
    expect(info1.sharesCell).toBe(false)

    const info2 = new ImmobileInfo({ occupiesSpace: false })
    expect(info2.sharesCell).toBe(false)
  })

  describe('create() factory', () => {
    it('creates an Immobile instance with correct cpos and centerPosition', () => {
      const info = new ImmobileInfo({ occupiesSpace: true })
      const cpos = new CPos(3, 4)
      const center = centerOfCell(cpos)
      const immob = info.create(cpos, center)
      expect(immob).toBeInstanceOf(Immobile)
      expect(CPos.equals(immob.topLeft, cpos)).toBe(true)
      expect(WPos.equals(immob.centerPosition, center)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Immobile tests
// ---------------------------------------------------------------------------

describe('Immobile', () => {
  describe('construction', () => {
    it('constructs with default occupiesSpace = true', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      expect(CPos.equals(immob.topLeft, cpos)).toBe(true)
      expect(WPos.equals(immob.centerPosition, center)).toBe(true)
      expect(immob.occupiedCells()).toHaveLength(1)
    })

    it('constructs with OccupiesSpace = false (empty occupied cells)', () => {
      const info = new ImmobileInfo({ occupiesSpace: false })
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      expect(immob.occupiedCells()).toHaveLength(0)
    })
  })

  describe('topLeft', () => {
    it('matches constructor CPos', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(7, 3)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      expect(CPos.equals(immob.topLeft, cpos)).toBe(true)
      expect(immob.topLeft.X).toBe(7)
      expect(immob.topLeft.Y).toBe(3)
    })

    it('preserves different CPos values', () => {
      const info = new ImmobileInfo()
      const cpos1 = new CPos(0, 0)
      const cpos2 = new CPos(10, 20)
      const immob1 = new Immobile(cpos1, centerOfCell(cpos1), info)
      const immob2 = new Immobile(cpos2, centerOfCell(cpos2), info)
      expect(CPos.equals(immob1.topLeft, cpos1)).toBe(true)
      expect(CPos.equals(immob2.topLeft, cpos2)).toBe(true)
    })
  })

  describe('centerPosition', () => {
    it('is computed from CPos (rectangular grid formula)', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(5, 3)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      expect(WPos.equals(immob.centerPosition, center)).toBe(true)
      expect(immob.centerPosition.X).toBe(1024 * 5 + 512)
      expect(immob.centerPosition.Y).toBe(1024 * 3 + 512)
    })

    it('changes with different CPos input', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(1, 1)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      expect(WPos.equals(immob.centerPosition, center)).toBe(true)
      expect(immob.centerPosition.X).toBe(1024 * 1 + 512)
      expect(immob.centerPosition.Y).toBe(1024 * 1 + 512)
    })

    it('handles zero CPos (origin)', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(0, 0)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      expect(immob.centerPosition.X).toBe(512)
      expect(immob.centerPosition.Y).toBe(512)
      expect(immob.centerPosition.Z).toBe(0)
    })
  })

  describe('occupiedCells', () => {
    it('returns single FullCell when OccupiesSpace = true', () => {
      const info = new ImmobileInfo({ occupiesSpace: true })
      const cpos = new CPos(4, 5)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      const cells = immob.occupiedCells()
      expect(cells).toHaveLength(1)
      expect(CPos.equals(cells[0]!.cell, cpos)).toBe(true)
      expect(cells[0]!.subCell).toBe(SubCell.FullCell)
    })

    it('returns empty when OccupiesSpace = false', () => {
      const info = new ImmobileInfo({ occupiesSpace: false })
      const cpos = new CPos(4, 5)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      const cells = immob.occupiedCells()
      expect(cells).toHaveLength(0)
    })

    it('returns the same array instance on repeated calls (no re-allocation)', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(3, 3)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      const cells1 = immob.occupiedCells()
      const cells2 = immob.occupiedCells()
      expect(cells1).toBe(cells2) // same reference
    })

    it('OccupiedCell has correct cell and subCell properties', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(6, 7)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)
      const cells = immob.occupiedCells()
      expect(cells[0]!.cell.X).toBe(6)
      expect(cells[0]!.cell.Y).toBe(7)
      expect(cells[0]!.subCell).toBe(SubCell.FullCell)
    })
  })

  describe('addedToWorld', () => {
    it('calls world.addToMaps when world has the method', () => {
      const addToMapsSpy = vi.fn<
        (actor: IGameActor, ios: IOccupySpace) => void
      >()
      const mockActor = createMockActor({
        world: {
          addToMaps: addToMapsSpy,
        } as unknown as Partial<WorldStub> & Record<string, unknown>,
      })

      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      immob.addedToWorld(mockActor)
      expect(addToMapsSpy).toHaveBeenCalledTimes(1)
      expect(addToMapsSpy).toHaveBeenCalledWith(mockActor, immob)
    })

    it('does not throw when world has no addToMaps method', () => {
      const mockActor = createMockActor({
        world: {} as unknown as Partial<WorldStub> & Record<string, unknown>,
      })

      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      expect(() => immob.addedToWorld(mockActor)).not.toThrow()
    })

    it('does not throw when world is undefined', () => {
      const mockActor = createMockActor({ world: undefined })

      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      expect(() => immob.addedToWorld(mockActor)).not.toThrow()
    })
  })

  describe('removedFromWorld', () => {
    it('calls world.removeFromMaps when world has the method', () => {
      const removeFromMapsSpy = vi.fn<
        (actor: IGameActor, ios: IOccupySpace) => void
      >()
      const mockActor = createMockActor({
        world: {
          removeFromMaps: removeFromMapsSpy,
        } as unknown as Partial<WorldStub> & Record<string, unknown>,
      })

      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      immob.removedFromWorld(mockActor)
      expect(removeFromMapsSpy).toHaveBeenCalledTimes(1)
      expect(removeFromMapsSpy).toHaveBeenCalledWith(mockActor, immob)
    })

    it('does not throw when world has no removeFromMaps method', () => {
      const mockActor = createMockActor({
        world: {} as unknown as Partial<WorldStub> & Record<string, unknown>,
      })

      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      expect(() => immob.removedFromWorld(mockActor)).not.toThrow()
    })

    it('does not throw when world is undefined', () => {
      const mockActor = createMockActor({ world: undefined })

      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      expect(() => immob.removedFromWorld(mockActor)).not.toThrow()
    })
  })

  describe('multiple instances', () => {
    it('multiple Immobile actors can coexist at different positions', () => {
      const info = new ImmobileInfo()
      const cpos1 = new CPos(0, 0)
      const cpos2 = new CPos(5, 5)
      const cpos3 = new CPos(10, 3)

      const immob1 = new Immobile(cpos1, centerOfCell(cpos1), info)
      const immob2 = new Immobile(cpos2, centerOfCell(cpos2), info)
      const immob3 = new Immobile(cpos3, centerOfCell(cpos3), info)

      expect(CPos.equals(immob1.topLeft, cpos1)).toBe(true)
      expect(CPos.equals(immob2.topLeft, cpos2)).toBe(true)
      expect(CPos.equals(immob3.topLeft, cpos3)).toBe(true)

      // Each has distinct center positions
      expect(WPos.equals(immob1.centerPosition, immob2.centerPosition)).toBe(false)
      expect(WPos.equals(immob2.centerPosition, immob3.centerPosition)).toBe(false)
    })

    it('multiple actors can occupy the same cell (wall-like behavior)', () => {
      // This simulates actors like walls that may stack on one cell
      const info = new ImmobileInfo()
      const cpos = new CPos(3, 3)
      const center = centerOfCell(cpos)

      const immob1 = new Immobile(cpos, center, info)
      const immob2 = new Immobile(cpos, center, info)

      // Both report the same cell
      expect(CPos.equals(immob1.occupiedCells()[0]!.cell, cpos)).toBe(true)
      expect(CPos.equals(immob2.occupiedCells()[0]!.cell, cpos)).toBe(true)
    })
  })

  describe('IOccupySpace interface compliance', () => {
    it('has all IOccupySpace required properties', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      // centerPosition getter
      expect(WPos.equals(immob.centerPosition, center)).toBe(true)
      // topLeft getter
      expect(CPos.equals(immob.topLeft, cpos)).toBe(true)
      // occupiedCells method
      expect(Array.isArray(immob.occupiedCells())).toBe(true)
    })

    it('implements ISync (marker interface)', () => {
      const info = new ImmobileInfo()
      const cpos = new CPos(2, 2)
      const center = centerOfCell(cpos)
      const immob = new Immobile(cpos, center, info)

      // ISync is a marker interface — just verify the instance is created
      expect(immob).toBeInstanceOf(Immobile)
    })
  })
})
