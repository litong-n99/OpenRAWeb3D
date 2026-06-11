/**
 * Locomotor.test.ts — Locomotor stub unit tests
 *
 * Tests focus on:
 * - LocomotorInfo defaults
 * - SimpleLocomotor behavior (all passable)
 * - WallAwareLocomotor blocking
 * - ILocomotor interface compliance
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import { BlockedByActor } from '../BlockedByActor'
import { SubCell, type SubCell as SubCellType } from '../../../OpenRA.Game/Traits/SubCell'
import {
  LocomotorInfo,
  SimpleLocomotor,
  WallAwareLocomotor,
} from './Locomotor'

// ---------------------------------------------------------------------------
// LocomotorInfo tests
// ---------------------------------------------------------------------------

describe('LocomotorInfo', () => {
  it('has default name', () => {
    const info = new LocomotorInfo()
    expect(info.Name).toBe('default')
  })

  it('accepts custom name', () => {
    const info = new LocomotorInfo('custom')
    expect(info.Name).toBe('custom')
  })

  it('has empty terrain speeds by default', () => {
    const info = new LocomotorInfo()
    expect(info.TerrainSpeeds.size).toBe(0)
  })

  it('accepts custom terrain speeds', () => {
    const speeds = new Map([
      ['Clear', { speed: 100, cost: 100 }],
      ['Rough', { speed: 50, cost: 200 }],
    ])
    const info = new LocomotorInfo('test', speeds)
    expect(info.TerrainSpeeds.size).toBe(2)
    expect(info.TerrainSpeeds.get('Clear')?.cost).toBe(100)
    expect(info.TerrainSpeeds.get('Rough')?.cost).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// SimpleLocomotor tests
// ---------------------------------------------------------------------------

describe('SimpleLocomotor', () => {
  it('returns cost 100 for all cells', () => {
    const locomotor = new SimpleLocomotor()
    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(1, 0),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(100)
  })

  it('returns cost 100 with ignoreSelf', () => {
    const locomotor = new SimpleLocomotor()
    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(1, 0),
      BlockedByActor.None,
      null,
      true,
    )
    expect(cost).toBe(100)
  })

  it('allows movement into all cells', () => {
    const locomotor = new SimpleLocomotor()
    const canMove = locomotor.canMoveFreelyInto(
      null,
      new CPos(5, 5),
      SubCell.FullCell as SubCellType,
      BlockedByActor.All,
      null,
    )
    expect(canMove).toBe(true)
  })

  it('returns movementCostForCell 100', () => {
    const locomotor = new SimpleLocomotor()
    expect(locomotor.movementCostForCell(new CPos(0, 0))).toBe(100)
    expect(locomotor.movementCostForCell(new CPos(99, 99))).toBe(100)
  })

  it('has default LocomotorInfo', () => {
    const locomotor = new SimpleLocomotor()
    expect(locomotor.Info.Name).toBe('default')
  })

  it('accepts custom LocomotorInfo', () => {
    const info = new LocomotorInfo('custom')
    const locomotor = new SimpleLocomotor(info)
    expect(locomotor.Info.Name).toBe('custom')
  })
})

// ---------------------------------------------------------------------------
// WallAwareLocomotor tests
// ---------------------------------------------------------------------------

describe('WallAwareLocomotor', () => {
  it('blocks specified cells', () => {
    const blocked = [new CPos(1, 0), new CPos(0, 1)]
    const locomotor = new WallAwareLocomotor(blocked)

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(1, 0),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('allows non-blocked cells', () => {
    const blocked = [new CPos(1, 0)]
    const locomotor = new WallAwareLocomotor(blocked)

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(0, 1),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(100)
  })

  it('blocks with ignoreSelf overload', () => {
    const blocked = [new CPos(2, 2)]
    const locomotor = new WallAwareLocomotor(blocked)

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(2, 2),
      BlockedByActor.None,
      null,
      true,
    )
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('reports blocked cells as not freely movable', () => {
    const blocked = [new CPos(5, 5)]
    const locomotor = new WallAwareLocomotor(blocked)

    const canMove = locomotor.canMoveFreelyInto(
      null,
      new CPos(5, 5),
      SubCell.FullCell as SubCellType,
      BlockedByActor.All,
      null,
    )
    expect(canMove).toBe(false)
  })

  it('reports non-blocked cells as freely movable', () => {
    const blocked = [new CPos(5, 5)]
    const locomotor = new WallAwareLocomotor(blocked)

    const canMove = locomotor.canMoveFreelyInto(
      null,
      new CPos(3, 3),
      SubCell.FullCell as SubCellType,
      BlockedByActor.All,
      null,
    )
    expect(canMove).toBe(true)
  })

  it('returns unreachable for blocked cells in movementCostForCell', () => {
    const blocked = [new CPos(1, 1)]
    const locomotor = new WallAwareLocomotor(blocked)

    expect(locomotor.movementCostForCell(new CPos(1, 1))).toBe(
      PathGraph.MovementCostForUnreachableCell,
    )
    expect(locomotor.movementCostForCell(new CPos(0, 0))).toBe(100)
  })

  it('handles empty blocked list', () => {
    const locomotor = new WallAwareLocomotor([])

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(1, 1),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(100)
  })

  it('has default LocomotorInfo when not provided', () => {
    const locomotor = new WallAwareLocomotor([new CPos(0, 0)])
    expect(locomotor.Info.Name).toBe('default')
  })

  it('accepts custom LocomotorInfo', () => {
    const info = new LocomotorInfo('heavy')
    const locomotor = new WallAwareLocomotor([new CPos(0, 0)], info)
    expect(locomotor.Info.Name).toBe('heavy')
  })
})
