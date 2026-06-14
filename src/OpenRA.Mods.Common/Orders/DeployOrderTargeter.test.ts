/**
 * DeployOrderTargeter.test.ts — DeployOrderTargeter unit tests
 *
 * Tests focus on: constructor, CanTarget validation (self-only),
 * cursor callback, TargetModifiers handling (ForceQueue), and
 * TargetOverridesSelection behavior.
 */

import { describe, it, expect, vi } from 'vitest'

import type {
  IGameActor,
  IOrderTargeter,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { DeployOrderTargeter } from './DeployOrderTargeter.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock actor that implements both IGameActor and IActorRef. */
function createMockActor(id: number, name?: string): IGameActor & IActorRef {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    generation: 1,
    centerPosition: WPos.Zero,
    isTargetableBy: () => true,
    getTargetablePositions: () => [WPos.Zero],
    info: { name: name ?? `actor${id}` },
  } as IGameActor & IActorRef
}

const TARGET_MODIFIERS_NONE: TargetModifiers = 0
const TARGET_MODIFIERS_FORCE_QUEUE: TargetModifiers = 2

// ---------------------------------------------------------------------------
// DeployOrderTargeter — Construction
// ---------------------------------------------------------------------------

describe('DeployOrderTargeter construction', () => {
  it('constructs with order ID, priority, and cursor function', () => {
    const cursorFn = vi.fn(() => 'deploy')
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)

    expect(targeter.orderID).toBe('DeployTransform')
    expect(targeter.orderPriority).toBe(10)
    expect(targeter.isQueued).toBe(false)
  })

  it('implements IOrderTargeter', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, () => 'deploy')
    const iface: IOrderTargeter = targeter
    expect(iface.orderID).toBe('DeployTransform')
    expect(iface.orderPriority).toBe(10)
  })

  it('getCursor returns the cursor function result', () => {
    const cursorFn = vi.fn(() => 'deploy-cursor')
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)

    expect(targeter.getCursor()).toBe('deploy-cursor')
    expect(cursorFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// DeployOrderTargeter — CanTarget
// ---------------------------------------------------------------------------

describe('DeployOrderTargeter.canTarget', () => {
  const cursorFn = () => 'deploy'

  it('returns true when targeting self', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    const target = Target.fromActor(actor)
    const result = targeter.canTarget(actor, target, TARGET_MODIFIERS_NONE, '')

    expect(result).toBe(true)
  })

  it('returns false when targeting another actor', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const self = createMockActor(1)
    const other = createMockActor(2)

    const target = Target.fromActor(other)
    const result = targeter.canTarget(self, target, TARGET_MODIFIERS_NONE, '')

    expect(result).toBe(false)
  })

  it('returns false when targeting Invalid', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    const result = targeter.canTarget(actor, Target.Invalid, TARGET_MODIFIERS_NONE, '')

    expect(result).toBe(false)
  })

  it('returns false when targeting Terrain', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    const target = Target.fromPos(WPos.Zero)
    const result = targeter.canTarget(actor, target, TARGET_MODIFIERS_NONE, '')

    expect(result).toBe(false)
  })

  it('returns false when targeting FrozenActor', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    const frozenActor = {
      isValid: true,
      visible: true,
      hidden: false,
      centerPosition: WPos.Zero,
      targetablePositions: [WPos.Zero],
    }
    const target = Target.fromFrozenActor(frozenActor)
    const result = targeter.canTarget(actor, target, TARGET_MODIFIERS_NONE, '')

    expect(result).toBe(false)
  })

  it('sets isQueued to true when ForceQueue modifier is active', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    const target = Target.fromActor(actor)
    targeter.canTarget(actor, target, TARGET_MODIFIERS_FORCE_QUEUE, '')

    expect(targeter.isQueued).toBe(true)
  })

  it('sets isQueued to false when ForceQueue modifier is not active', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    const target = Target.fromActor(actor)
    targeter.canTarget(actor, target, TARGET_MODIFIERS_NONE, '')

    expect(targeter.isQueued).toBe(false)
  })

  it('validates self-target returns true for valid actor', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    // Create a fresh target from the actor (with matching generation)
    const target = Target.fromActor(actor)

    // Target.type returns Actor because generation matches and actor is alive
    const result = targeter.canTarget(actor, target, TARGET_MODIFIERS_NONE, '')

    expect(result).toBe(true)
  })

  it('returns false for null actor in target', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    // Target.fromActor with null returns Target.Invalid
    const target = Target.fromActor(null)
    const result = targeter.canTarget(actor, target, TARGET_MODIFIERS_NONE, '')

    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DeployOrderTargeter — TargetOverridesSelection
// ---------------------------------------------------------------------------

describe('DeployOrderTargeter.targetOverridesSelection', () => {
  const cursorFn = () => 'deploy'

  it('always returns true', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)

    const result = targeter.targetOverridesSelection(
      actor,
      Target.Invalid,
      [],
      CPos.Zero,
      TARGET_MODIFIERS_NONE,
    )

    expect(result).toBe(true)
  })

  it('returns true even with empty actors array', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, cursorFn)
    const actor = createMockActor(1)
    const target = Target.fromActor(actor)

    const result = targeter.targetOverridesSelection(
      actor,
      target,
      [],
      new CPos(5, 5, 0),
      TARGET_MODIFIERS_FORCE_QUEUE,
    )

    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DeployOrderTargeter — IOrderTargeter contract
// ---------------------------------------------------------------------------

describe('DeployOrderTargeter as IOrderTargeter', () => {
  it('satisfies the IOrderTargeter interface', () => {
    const targeter = new DeployOrderTargeter('DeployTransform', 10, () => 'deploy')
    const actor = createMockActor(1)

    // All IOrderTargeter methods should be callable
    expect(targeter.orderID).toBe('DeployTransform')
    expect(targeter.orderPriority).toBe(10)
    expect(typeof targeter.canTarget).toBe('function')
    expect(typeof targeter.targetOverridesSelection).toBe('function')
    expect('isQueued' in targeter).toBe(true)

    // Verify canTarget and targetOverridesSelection work as expected
    const target = Target.fromActor(actor)
    expect(targeter.canTarget(actor, target, 0, '')).toBe(true)
    expect(targeter.targetOverridesSelection(actor, target, [], CPos.Zero, 0)).toBe(true)
  })
})
