/**
 * UnitOrderTargeter.test.ts — UnitOrderTargeter and TargetTypeOrderTargeter unit tests
 *
 * Tests focus on: abstract class contract, CanTarget relationship filtering,
 * ForceAttack modifier handling, TargetTypeOrderTargeter type filtering,
 * FrozenActor handling, and cursor management.
 */

import { describe, it, expect, vi } from 'vitest'

import type {
  IGameActor,
  TargetModifiers,
  FrozenActorStub,
  PlayerStub,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.js'
import type { IFrozenActorRef } from '../../OpenRA.Game/Traits/IFrozenActorRef.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import {
  UnitOrderTargeter,
  TargetTypeOrderTargeter,
} from './UnitOrderTargeter.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_A: PlayerStub = { playerName: 'PlayerA' }
const OWNER_B: PlayerStub = { playerName: 'PlayerB' }

/** Create a minimal mock actor that implements IGameActor and IActorRef. */
function createMockActor(
  id: number,
  name?: string,
  owner?: PlayerStub,
): IGameActor & IActorRef {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 1,
    owner,
    centerPosition: WPos.Zero,
    isTargetableBy: () => true,
    getTargetablePositions: () => [WPos.Zero],
    info: { name: name ?? `actor${id}` },
  } as IGameActor & IActorRef
}

/** Create a minimal frozen actor ref. */
function createFrozenActorRef(
  isValid: boolean = true,
  visible: boolean = true,
  hidden: boolean = false,
): IFrozenActorRef {
  return {
    isValid,
    visible,
    hidden,
    centerPosition: WPos.Zero,
    targetablePositions: [WPos.Zero],
  }
}

const TARGET_MODIFIERS_NONE: TargetModifiers = 0
const TARGET_MODIFIERS_FORCE_ATTACK: TargetModifiers = 1
const TARGET_MODIFIERS_FORCE_QUEUE: TargetModifiers = 2

// ---------------------------------------------------------------------------
// Concrete subclass for testing UnitOrderTargeter
// ---------------------------------------------------------------------------

class TestUnitOrderTargeter extends UnitOrderTargeter {
  readonly canTargetActorResult: boolean
  readonly canTargetFrozenActorResult: boolean

  constructor(
    order: string,
    priority: number,
    cursor: string,
    targetEnemyUnits: boolean,
    targetAllyUnits: boolean,
    canTargetActorResult: boolean = true,
    canTargetFrozenActorResult: boolean = false,
  ) {
    super(order, priority, cursor, targetEnemyUnits, targetAllyUnits)
    this.canTargetActorResult = canTargetActorResult
    this.canTargetFrozenActorResult = canTargetFrozenActorResult
  }

  canTargetActor(
    _self: IGameActor,
    _target: IGameActor,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    return this.canTargetActorResult
  }

  canTargetFrozenActor(
    _self: IGameActor,
    _target: FrozenActorStub,
    _modifiers: TargetModifiers,
    _cursor: string,
  ): boolean {
    return this.canTargetFrozenActorResult
  }
}

// ---------------------------------------------------------------------------
// UnitOrderTargeter — Construction
// ---------------------------------------------------------------------------

describe('UnitOrderTargeter construction', () => {
  it('constructs with order ID, priority, and targeting flags', () => {
    const targeter = new TestUnitOrderTargeter(
      'Demolish', 5, 'demolish',
      true, false, // target enemies, not allies
    )

    expect(targeter.orderID).toBe('Demolish')
    expect(targeter.orderPriority).toBe(5)
    expect(targeter.isQueued).toBe(false)
    expect(targeter.forceAttack).toBeNull()
  })

  it('getCursor returns the cursor name', () => {
    const targeter = new TestUnitOrderTargeter(
      'Demolish', 5, 'demolish',
      true, false,
    )

    expect(targeter.getCursor()).toBe('demolish')
  })
})

// ---------------------------------------------------------------------------
// UnitOrderTargeter — CanTarget (type filtering)
// ---------------------------------------------------------------------------

describe('UnitOrderTargeter.canTarget — type filtering', () => {
  it('returns false for Invalid target', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)

    const result = targeter.canTarget(self, Target.Invalid, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })

  it('returns false for Terrain target', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)

    const target = Target.fromPos(WPos.Zero)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })

  it('accepts Actor target when conditions met', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(true)
  })

  it('accepts FrozenActor target when canTargetFrozenActor returns true', () => {
    const targeter = new TestUnitOrderTargeter(
      'Demolish', 5, 'demolish',
      true, false,
      true, true, // canTargetActor=true, canTargetFrozenActor=true
    )
    const self = createMockActor(1, 'saboteur', OWNER_A)

    const frozenRef = createFrozenActorRef()
    const target = Target.fromFrozenActor(frozenRef)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// UnitOrderTargeter — CanTarget (relationship filtering)
// ---------------------------------------------------------------------------

describe('UnitOrderTargeter.canTarget — relationship filtering', () => {
  it('allows targeting enemy when targetEnemyUnits is true', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(true)
  })

  it('denies targeting enemy when targetEnemyUnits is false', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', false, true)
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })

  it('allows targeting ally when targetAllyUnits is true', () => {
    const targeter = new TestUnitOrderTargeter('Repair', 5, 'repair', false, true)
    const self = createMockActor(1, 'mechanic', OWNER_A)
    const targetActor = createMockActor(2, 'vehicle', OWNER_A)

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(true)
  })

  it('denies targeting ally when targetAllyUnits is false', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_A) // same owner = ally

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })

  it('bypasses relationship checks when ForceAttack is active', () => {
    // ForceAttack bypasses relationship filtering
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_A) // same owner = ally

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_FORCE_ATTACK, '')
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// UnitOrderTargeter — CanTarget (ForceAttack constraint)
// ---------------------------------------------------------------------------

describe('UnitOrderTargeter.canTarget — ForceAttack constraint', () => {
  it('blocks targeting when forceAttack=true but ForceAttack modifier not set', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    targeter.forceAttack = true
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })

  it('allows targeting when forceAttack=true and ForceAttack modifier IS set', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    targeter.forceAttack = true
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_FORCE_ATTACK, '')
    expect(result).toBe(true)
  })

  it('blocks targeting when forceAttack=false but ForceAttack modifier IS set', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    targeter.forceAttack = false
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    const target = Target.fromActor(targetActor)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_FORCE_ATTACK, '')
    expect(result).toBe(false)
  })

  it('accepts any ForceAttack state when forceAttack is null', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    targeter.forceAttack = null // default
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    // Both with and without ForceAttack should work
    expect(targeter.canTarget(self, Target.fromActor(targetActor), TARGET_MODIFIERS_NONE, '')).toBe(true)
    expect(targeter.canTarget(self, Target.fromActor(targetActor), TARGET_MODIFIERS_FORCE_ATTACK, '')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// UnitOrderTargeter — isQueued
// ---------------------------------------------------------------------------

describe('UnitOrderTargeter.isQueued', () => {
  it('sets isQueued to true when ForceQueue modifier is active', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    targeter.canTarget(self, Target.fromActor(targetActor), TARGET_MODIFIERS_FORCE_QUEUE, '')
    expect(targeter.isQueued).toBe(true)
  })

  it('sets isQueued to false when ForceQueue modifier is not active', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const targetActor = createMockActor(2, 'building', OWNER_B)

    targeter.canTarget(self, Target.fromActor(targetActor), TARGET_MODIFIERS_NONE, '')
    expect(targeter.isQueued).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// UnitOrderTargeter — TargetOverridesSelection
// ---------------------------------------------------------------------------

describe('UnitOrderTargeter.targetOverridesSelection', () => {
  it('always returns true', () => {
    const targeter = new TestUnitOrderTargeter('Demolish', 5, 'demolish', true, false)
    const self = createMockActor(1, 'saboteur', OWNER_A)

    const result = targeter.targetOverridesSelection(
      self,
      Target.Invalid,
      [],
      CPos.Zero,
      TARGET_MODIFIERS_NONE,
    )
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// UnitOrderTargeter — Delegates to CanTargetActor / CanTargetFrozenActor
// ---------------------------------------------------------------------------

describe('UnitOrderTargeter delegation', () => {
  it('delegates to canTargetActor for Actor targets', () => {
    const canTargetActorSpy = vi.fn(() => true)
    const canTargetFrozenSpy = vi.fn(() => false)

    class SpyTargeter extends UnitOrderTargeter {
      canTargetActor = canTargetActorSpy
      canTargetFrozenActor = canTargetFrozenSpy
    }

    const targeter = new SpyTargeter('Test', 5, 'cursor', true, false)
    const self = createMockActor(1, 'test', OWNER_A)
    const targetActor = createMockActor(2, 'target', OWNER_B)

    targeter.canTarget(self, Target.fromActor(targetActor), TARGET_MODIFIERS_NONE, '')

    expect(canTargetActorSpy).toHaveBeenCalled()
    expect(canTargetFrozenSpy).not.toHaveBeenCalled()
  })

  it('delegates to canTargetFrozenActor for FrozenActor targets', () => {
    const canTargetActorSpy = vi.fn(() => false)
    const canTargetFrozenSpy = vi.fn(() => true)

    class SpyTargeter extends UnitOrderTargeter {
      canTargetActor = canTargetActorSpy
      canTargetFrozenActor = canTargetFrozenSpy
    }

    const targeter = new SpyTargeter('Test', 5, 'cursor', true, false)
    const self = createMockActor(1, 'test', OWNER_A)
    const frozenRef = createFrozenActorRef()

    targeter.canTarget(self, Target.fromFrozenActor(frozenRef), TARGET_MODIFIERS_NONE, '')

    expect(canTargetFrozenSpy).toHaveBeenCalled()
    expect(canTargetActorSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// TargetTypeOrderTargeter — Construction
// ---------------------------------------------------------------------------

describe('TargetTypeOrderTargeter construction', () => {
  it('constructs with a target type set', () => {
    const targeter = new TargetTypeOrderTargeter(
      new Set(['Building']),
      'Demolish', 5, 'demolish',
      true, false,
    )

    expect(targeter.orderID).toBe('Demolish')
    expect(targeter.orderPriority).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// TargetTypeOrderTargeter — canTargetActor
// ---------------------------------------------------------------------------

describe('TargetTypeOrderTargeter.canTargetActor', () => {
  it('returns true when target actor name matches a target type', () => {
    const targeter = new TargetTypeOrderTargeter(
      new Set(['Building']),
      'Demolish', 5, 'demolish',
      true, false,
    )

    const self = createMockActor(1, 'saboteur', OWNER_A)
    const target = createMockActor(2, 'Building', OWNER_B)

    const result = targeter.canTargetActor(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(true)
  })

  it('returns false when target actor name does not match any target type', () => {
    const targeter = new TargetTypeOrderTargeter(
      new Set(['Building']),
      'Demolish', 5, 'demolish',
      true, false,
    )

    const self = createMockActor(1, 'saboteur', OWNER_A)
    const target = createMockActor(2, 'Infantry', OWNER_B)

    const result = targeter.canTargetActor(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })

  it('returns false when target actor has no info', () => {
    const targeter = new TargetTypeOrderTargeter(
      new Set(['Building']),
      'Demolish', 5, 'demolish',
      true, false,
    )

    const self = createMockActor(1, 'saboteur', OWNER_A)
    // Actor without info (name will be empty string)
    const target = createMockActor(2, '', OWNER_B)

    const result = targeter.canTargetActor(self, target, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })

  it('supports multiple target types', () => {
    const targeter = new TargetTypeOrderTargeter(
      new Set(['Building', 'Vehicle', 'Defense']),
      'Demolish', 5, 'demolish',
      true, false,
    )

    const self = createMockActor(1, 'saboteur', OWNER_A)

    expect(targeter.canTargetActor(self, createMockActor(2, 'Building', OWNER_B), 0, '')).toBe(true)
    expect(targeter.canTargetActor(self, createMockActor(3, 'Vehicle', OWNER_B), 0, '')).toBe(true)
    expect(targeter.canTargetActor(self, createMockActor(4, 'Defense', OWNER_B), 0, '')).toBe(true)
    expect(targeter.canTargetActor(self, createMockActor(5, 'Infantry', OWNER_B), 0, '')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// TargetTypeOrderTargeter — canTargetFrozenActor
// ---------------------------------------------------------------------------

describe('TargetTypeOrderTargeter.canTargetFrozenActor', () => {
  it('returns false for frozen actors (not supported in Phase B)', () => {
    const targeter = new TargetTypeOrderTargeter(
      new Set(['Building']),
      'Demolish', 5, 'demolish',
      true, false,
    )

    const self = createMockActor(1, 'saboteur', OWNER_A)
    const frozenStub: FrozenActorStub = {
      isValid: true,
      visible: true,
      hidden: false,
      centerPosition: WPos.Zero,
    }

    const result = targeter.canTargetFrozenActor(self, frozenStub, TARGET_MODIFIERS_NONE, '')
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// TargetTypeOrderTargeter — Full CanTarget flow
// ---------------------------------------------------------------------------

describe('TargetTypeOrderTargeter full CanTarget flow', () => {
  it('validates target type through relationship + type filtering', () => {
    const targeter = new TargetTypeOrderTargeter(
      new Set(['Building']),
      'Demolish', 5, 'demolish',
      true, false, // target enemies, not allies
    )

    // Enemy building — should pass
    const self = createMockActor(1, 'saboteur', OWNER_A)
    const enemyBuilding = createMockActor(2, 'Building', OWNER_B)

    const target = Target.fromActor(enemyBuilding)
    expect(targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')).toBe(true)

    // Ally building — should fail (cannot target allies)
    const allyBuilding = createMockActor(3, 'Building', OWNER_A)
    const allyTarget = Target.fromActor(allyBuilding)
    expect(targeter.canTarget(self, allyTarget, TARGET_MODIFIERS_NONE, '')).toBe(false)

    // Enemy infantry — should fail (wrong target type)
    const enemyInfantry = createMockActor(4, 'Infantry', OWNER_B)
    const infantryTarget = Target.fromActor(enemyInfantry)
    expect(targeter.canTarget(self, infantryTarget, TARGET_MODIFIERS_NONE, '')).toBe(false)
  })
})
