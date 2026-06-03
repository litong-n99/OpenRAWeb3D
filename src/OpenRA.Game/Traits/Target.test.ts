/**
 * Target.test.ts — Target migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'
import { Target, TargetType } from './Target'
import { WPos } from '../WPos'
import { WDist } from '../WDist'
import { CPos } from '../CPos'
import { SubCell } from './SubCell'
import type { IActorRef } from './IActorRef'
import type { IFrozenActorRef } from './IFrozenActorRef'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: Partial<IActorRef> = {}): IActorRef {
  return {
    isInWorld: true,
    isDead: false,
    generation: 1,
    centerPosition: new WPos(100, 200, 0),
    isTargetableBy: vi.fn(() => true),
    getTargetablePositions: vi.fn(() => [new WPos(100, 200, 0)]),
    ...overrides,
  }
}

function createMockFrozenActor(overrides: Partial<IFrozenActorRef> = {}): IFrozenActorRef {
  return {
    isValid: true,
    visible: true,
    hidden: false,
    centerPosition: new WPos(50, 60, 0),
    targetablePositions: [new WPos(50, 60, 0)],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Factory methods
// ---------------------------------------------------------------------------

describe('Target factory methods', () => {
  it('fromPos creates terrain target', () => {
    const pos = new WPos(100, 200, 300)
    const t = Target.fromPos(pos)
    expect(t.type).toBe(TargetType.Terrain)
    expect(WPos.equals(t.centerPosition, pos)).toBe(true)
  })

  it('fromActor creates actor target', () => {
    const actor = createMockActor()
    const t = Target.fromActor(actor)
    expect(t.type).toBe(TargetType.Actor)
    expect(t.actor).toBe(actor)
  })

  it('fromActor with null returns Invalid', () => {
    const t = Target.fromActor(null)
    expect(t.type).toBe(TargetType.Invalid)
  })

  it('fromFrozenActor creates frozen actor target', () => {
    const fa = createMockFrozenActor()
    const t = Target.fromFrozenActor(fa)
    expect(t.type).toBe(TargetType.FrozenActor)
    expect(t.frozenActor).toBe(fa)
  })

  it('fromCell creates terrain target', () => {
    const cell = new CPos(5, 10)
    const t = Target.fromCell(cell, SubCell.First)
    expect(t.type).toBe(TargetType.Terrain)
    expect(t.cell).toBeDefined()
    expect(t.cell!.X).toBe(5)
    expect(t.subCell).toBe(SubCell.First)
  })

  it('fromCell defaults subCell to FullCell', () => {
    const cell = new CPos(5, 10)
    const t = Target.fromCell(cell)
    expect(t.subCell).toBe(SubCell.FullCell)
  })

  it('fromTargetPositions copies positions', () => {
    const a = Target.fromPos(new WPos(10, 20, 30))
    const b = Target.fromTargetPositions(a)
    expect(b.type).toBe(TargetType.Terrain)
    expect(WPos.equals(b.centerPosition, a.centerPosition)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Type validation
// ---------------------------------------------------------------------------

describe('Target type validation', () => {
  it('valid actor target has Actor type', () => {
    const actor = createMockActor({ isInWorld: true, isDead: false, generation: 1 })
    const t = Target.fromActor(actor)
    expect(t.type).toBe(TargetType.Actor)
  })

  it('dead actor returns Invalid type', () => {
    const actor = createMockActor({ isDead: true })
    const t = Target.fromActor(actor)
    expect(t.type).toBe(TargetType.Invalid)
  })

  it('actor not in world returns Invalid type', () => {
    const actor = createMockActor({ isInWorld: false })
    const t = Target.fromActor(actor)
    expect(t.type).toBe(TargetType.Invalid)
  })

  it('actor with changed generation returns Invalid type', () => {
    const actor = createMockActor({ generation: 5 })
    const t = Target.fromActor(actor)
    // Simulate generation change
    ;(actor as { generation: number }).generation = 6
    expect(t.type).toBe(TargetType.Invalid)
  })
})

// ---------------------------------------------------------------------------
// IsValidFor
// ---------------------------------------------------------------------------

describe('Target.isValidFor', () => {
  it('actor target is valid if targetable', () => {
    const targeter = createMockActor({ centerPosition: new WPos(0, 0, 0) })
    const targetActor = createMockActor()
    const t = Target.fromActor(targetActor)
    expect(t.isValidFor(targeter)).toBe(true)
  })

  it('returns false for null targeter', () => {
    const t = Target.fromPos(new WPos(10, 20, 30))
    expect(t.isValidFor(null)).toBe(false)
  })

  it('frozen actor is valid if not hidden', () => {
    const fa = createMockFrozenActor({ isValid: true, visible: true, hidden: false })
    const t = Target.fromFrozenActor(fa)
    expect(t.isValidFor(createMockActor())).toBe(true)
  })

  it('frozen actor is invalid if hidden', () => {
    const fa = createMockFrozenActor({ hidden: true })
    const t = Target.fromFrozenActor(fa)
    expect(t.isValidFor(createMockActor())).toBe(false)
  })

  it('terrain target is always valid', () => {
    const t = Target.fromPos(new WPos(10, 20, 30))
    expect(t.isValidFor(createMockActor())).toBe(true)
  })

  it('invalid target is not valid', () => {
    expect(Target.Invalid.isValidFor(createMockActor())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CenterPosition and Positions
// ---------------------------------------------------------------------------

describe('Target positions', () => {
  it('actor centerPosition delegates to actor', () => {
    const actor = createMockActor({ centerPosition: new WPos(50, 60, 0) })
    const t = Target.fromActor(actor)
    expect(WPos.equals(t.centerPosition, new WPos(50, 60, 0))).toBe(true)
  })

  it('terrain centerPosition', () => {
    const t = Target.fromPos(new WPos(10, 20, 30))
    expect(WPos.equals(t.centerPosition, new WPos(10, 20, 30))).toBe(true)
  })

  it('Invalid target centerPosition throws', () => {
    expect(() => Target.Invalid.centerPosition).toThrow(/invalid Target/)
  })

  it('positions returns actor targetable positions', () => {
    const actor = createMockActor()
    const t = Target.fromActor(actor)
    const positions = t.positions
    expect(positions.length).toBeGreaterThan(0)
  })

  it('Invalid target positions returns empty array', () => {
    expect(Target.Invalid.positions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// IsInRange
// ---------------------------------------------------------------------------

describe('Target.isInRange', () => {
  it('within horizontal range returns true', () => {
    const t = Target.fromPos(new WPos(100, 0, 0))
    const origin = WPos.Zero
    const range = new WDist(200 * 1024) // 200 cells worth
    expect(t.isInRange(origin, range)).toBe(true)
  })

  it('outside range returns false', () => {
    const t = Target.fromPos(new WPos(50000, 0, 0))
    const origin = WPos.Zero
    const range = new WDist(10 * 1024) // 10 cells = 10240 sub-units
    // 50000 > 10240, so this is out of range
    expect(t.isInRange(origin, range)).toBe(false)
  })

  it('Invalid target always out of range', () => {
    expect(Target.Invalid.isInRange(WPos.Zero, new WDist(1000000))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

describe('Target equality', () => {
  it('same terrain position are equal', () => {
    const a = Target.fromPos(new WPos(10, 20, 30))
    const b = Target.fromPos(new WPos(10, 20, 30))
    expect(Target.equals(a, b)).toBe(true)
  })

  it('different terrain positions are not equal', () => {
    const a = Target.fromPos(new WPos(10, 20, 30))
    const b = Target.fromPos(new WPos(40, 50, 60))
    expect(Target.equals(a, b)).toBe(false)
  })

  it('same actor equal', () => {
    const actor = createMockActor()
    const a = Target.fromActor(actor)
    const b = Target.fromActor(actor)
    expect(Target.equals(a, b)).toBe(true)
  })

  it('different actors not equal', () => {
    const a = Target.fromActor(createMockActor())
    const b = Target.fromActor(createMockActor())
    expect(Target.equals(a, b)).toBe(false)
  })

  it('different types not equal', () => {
    const a = Target.fromPos(new WPos(0, 0, 0))
    const b = Target.Invalid
    expect(Target.equals(a, b)).toBe(false)
  })

  it('instance equals matches static', () => {
    const a = Target.fromPos(new WPos(1, 2, 3))
    const b = Target.fromPos(new WPos(1, 2, 3))
    expect(a.equals(b)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ToString
// ---------------------------------------------------------------------------

describe('Target.toString', () => {
  it('Invalid target', () => {
    expect(Target.Invalid.toString()).toBe('Invalid')
  })

  it('terrain target shows position', () => {
    const t = Target.fromPos(new WPos(1, 2, 3))
    expect(t.toString()).toContain('1')
  })
})
