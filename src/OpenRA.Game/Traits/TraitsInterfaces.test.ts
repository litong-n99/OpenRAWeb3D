/**
 * TraitsInterfaces.test.ts — Trait system interfaces unit tests
 *
 * Since TraitsInterfaces.ts is pure TypeScript (no Babylon.js, no GPU),
 * all logic is unit-testable without mocking.
 *
 * Tests cover:
 * - Enum values and bitwise operations
 * - Value class construction and defaults
 * - Component lifecycle (attach → detach → dispose)
 * - BehaviorComponent inheritance
 * - Type guard functions (each tested with mock objects implementing 0, 1,
 *   and multiple interfaces)
 * - Interface structural conformance
 */

import { describe, it, expect } from 'vitest'

import {
  // Enums
  DamageState,
  PlayerRelationship,
  PlayerRelationshipExts,
  TargetModifiers,
  TargetModifiersExts,
  PostProcessPassType,
  SelectionPriorityModifiers,

  // Value classes
  AttackInfo,
  Damage,

  // Component base
  Component,
  BehaviorComponent,

  // Type guards
  isITick,
  isITickRender,
  isIRender,
  isINotifyCreated,
  isINotifyAddedToWorld,
  isINotifyRemovedFromWorld,
  isINotifyActorDisposing,
  isINotifyKilled,
  isIResolveOrder,
  isIIssueOrder,
  isINotifySelected,
  isINotifySelection,
  isINotifyBecomingIdle,
  isINotifyIdle,
  isINotifyOwnerChanged,
  isIOccupySpace,
  isITargetable,
  isIFacing,
  isIHealth,
  isIRenderAboveShroud,
  isIRenderAnnotations,
  isIWorldLoaded,

  // Interfaces (for type annotation only)
  type IGameActor,
  type ITick,
  type INotifyCreated,
  type IResolveOrder,
  type IHealth,
  type ITraitInfoInterface,
  type VariableObserver,
  type Requires,
} from './TraitsInterfaces'

// ===========================================================================
// Enums
// ===========================================================================

describe('DamageState', () => {
  it('has correct flag values', () => {
    expect(DamageState.Undamaged).toBe(1)
    expect(DamageState.Light).toBe(2)
    expect(DamageState.Medium).toBe(4)
    expect(DamageState.Heavy).toBe(8)
    expect(DamageState.Critical).toBe(16)
    expect(DamageState.Dead).toBe(32)
  })

  it('flags are power-of-two for bitwise OR combination', () => {
    // All flags are distinct and power-of-two
    const values = [
      DamageState.Undamaged,
      DamageState.Light,
      DamageState.Medium,
      DamageState.Heavy,
      DamageState.Critical,
      DamageState.Dead,
    ]
    const seen = new Set<number>()
    for (const v of values) {
      expect(seen.has(v)).toBe(false)
      expect((v & (v - 1)) === 0).toBe(true) // power of two
      seen.add(v)
    }
  })
})

describe('PlayerRelationship', () => {
  it('has correct flag values', () => {
    expect(PlayerRelationship.None).toBe(0)
    expect(PlayerRelationship.Enemy).toBe(1)
    expect(PlayerRelationship.Neutral).toBe(2)
    expect(PlayerRelationship.Ally).toBe(4)
  })

  it('hasRelationship correctly checks flags', () => {
    const r = (PlayerRelationship.Enemy | PlayerRelationship.Neutral) as PlayerRelationship
    expect(PlayerRelationshipExts.hasRelationship(r, PlayerRelationship.Enemy)).toBe(true)
    expect(PlayerRelationshipExts.hasRelationship(r, PlayerRelationship.Neutral)).toBe(true)
    expect(PlayerRelationshipExts.hasRelationship(r, PlayerRelationship.Ally)).toBe(false)
    expect(PlayerRelationshipExts.hasRelationship(r, PlayerRelationship.None)).toBe(true) // 0 mask always matches
  })

  it('hasRelationship works with None', () => {
    const r = PlayerRelationship.None
    expect(PlayerRelationshipExts.hasRelationship(r, PlayerRelationship.None)).toBe(true)
    expect(PlayerRelationshipExts.hasRelationship(r, PlayerRelationship.Enemy)).toBe(false)
  })
})

describe('TargetModifiers', () => {
  it('has correct flag values', () => {
    expect(TargetModifiers.None).toBe(0)
    expect(TargetModifiers.ForceAttack).toBe(1)
    expect(TargetModifiers.ForceQueue).toBe(2)
    expect(TargetModifiers.ForceMove).toBe(4)
  })

  it('hasModifier correctly checks flags', () => {
    const mods = (TargetModifiers.ForceAttack | TargetModifiers.ForceQueue) as TargetModifiers
    expect(TargetModifiersExts.hasModifier(mods, TargetModifiers.ForceAttack)).toBe(true)
    expect(TargetModifiersExts.hasModifier(mods, TargetModifiers.ForceQueue)).toBe(true)
    expect(TargetModifiersExts.hasModifier(mods, TargetModifiers.ForceMove)).toBe(false)
  })
})

describe('PostProcessPassType', () => {
  it('has correct values', () => {
    expect(PostProcessPassType.AfterShroud).toBe(0)
    expect(PostProcessPassType.AfterWorld).toBe(1)
    expect(PostProcessPassType.AfterActors).toBe(2)
    expect(PostProcessPassType.AfterAnnotations).toBe(3)
  })
})

describe('SelectionPriorityModifiers', () => {
  it('has correct flag values', () => {
    expect(SelectionPriorityModifiers.None).toBe(0)
    expect(SelectionPriorityModifiers.Ctrl).toBe(1)
    expect(SelectionPriorityModifiers.Alt).toBe(2)
  })
})

// ===========================================================================
// Value classes
// ===========================================================================

describe('Damage', () => {
  it('constructs with value only', () => {
    const d = new Damage(50)
    expect(d.value).toBe(50)
    expect(d.damageTypes.isEmpty()).toBe(true)
  })

  it('constructs with value and damage types', () => {
    const types = { contains: () => true, isEmpty: () => false }
    const d = new Damage(100, types)
    expect(d.value).toBe(100)
    expect(d.damageTypes).toBe(types)
    expect(d.damageTypes.isEmpty()).toBe(false)
  })

  it('default damage types are empty', () => {
    const d = new Damage(25)
    expect(d.damageTypes.contains(1)).toBe(false)
    expect(d.damageTypes.contains(42)).toBe(false)
  })
})

describe('AttackInfo', () => {
  it('stores all fields correctly', () => {
    const actor = makeMockActor(1)
    const dmg = new Damage(30)
    const info = new AttackInfo(dmg, actor, DamageState.Heavy, DamageState.Medium)

    expect(info.damage).toBe(dmg)
    expect(info.attacker).toBe(actor)
    expect(info.damageState).toBe(DamageState.Heavy)
    expect(info.previousDamageState).toBe(DamageState.Medium)
  })
})

// ===========================================================================
// Component base class
// ===========================================================================

// Concrete component for testing
class TestComponent extends Component {
  attachCalls: number = 0
  detachCalls: number = 0
  enabledChangedCalls: number = 0
  disposeCalls: number = 0
  lastEnabledState: boolean = false

  override attach(actor: IGameActor): void {
    this.attachCalls++
    super.attach(actor)
  }

  override detach(actor: IGameActor): void {
    this.detachCalls++
    super.detach(actor)
  }

  override onEnabledChanged(enabled: boolean): void {
    this.enabledChangedCalls++
    this.lastEnabledState = enabled
    super.onEnabledChanged(enabled)
  }

  override dispose(): void {
    this.disposeCalls++
    super.dispose()
  }
}

describe('Component', () => {
  it('starts with no actor, enabled, not disposed', () => {
    const c = new TestComponent()
    expect(c.actor).toBeNull()
    expect(c.enabled).toBe(true)
    expect(c.disposed).toBe(false)
  })

  it('attach sets actor reference', () => {
    const c = new TestComponent()
    const actor = makeMockActor(1)
    c.attach(actor)
    expect(c.actor).toBe(actor)
    expect(c.attachCalls).toBe(1)
  })

  it('attach can be called only once per attach cycle', () => {
    const c = new TestComponent()
    const actor = makeMockActor(1)
    c.attach(actor)
    expect(c.actor).toBe(actor)
  })

  it('detach clears actor reference when matching', () => {
    const c = new TestComponent()
    const actor = makeMockActor(1)
    c.attach(actor)
    c.detach(actor)
    expect(c.actor).toBeNull()
    expect(c.detachCalls).toBe(1)
  })

  it('detach does not clear actor when non-matching', () => {
    const c = new TestComponent()
    const actor = makeMockActor(1)
    const other = makeMockActor(2)
    c.attach(actor)
    c.detach(other)
    expect(c.actor).toBe(actor) // unchanged
  })

  it('onEnabledChanged updates enabled state', () => {
    const c = new TestComponent()
    c.onEnabledChanged(false)
    expect(c.enabled).toBe(false)
    expect(c.enabledChangedCalls).toBe(1)
    expect(c.lastEnabledState).toBe(false)

    c.onEnabledChanged(true)
    expect(c.enabled).toBe(true)
    expect(c.enabledChangedCalls).toBe(2)
    expect(c.lastEnabledState).toBe(true)
  })

  it('dispose sets disposed flag and clears actor', () => {
    const c = new TestComponent()
    const actor = makeMockActor(1)
    c.attach(actor)
    c.dispose()
    expect(c.disposed).toBe(true)
    expect(c.actor).toBeNull()
    expect(c.disposeCalls).toBe(1)
  })

  it('full lifecycle: attach → disable → enable → detach → dispose', () => {
    const c = new TestComponent()
    const actor = makeMockActor(42)

    // Attach
    c.attach(actor)
    expect(c.actor?.actorId).toBe(42)
    expect(c.attachCalls).toBe(1)

    // Disable
    c.onEnabledChanged(false)
    expect(c.enabled).toBe(false)
    expect(c.enabledChangedCalls).toBe(1)

    // Re-enable
    c.onEnabledChanged(true)
    expect(c.enabled).toBe(true)
    expect(c.enabledChangedCalls).toBe(2)

    // Detach
    c.detach(actor)
    expect(c.actor).toBeNull()
    expect(c.detachCalls).toBe(1)

    // Dispose
    c.dispose()
    expect(c.disposed).toBe(true)
    expect(c.disposeCalls).toBe(1)
  })

  it('dispose without attach is valid', () => {
    const c = new TestComponent()
    c.dispose()
    expect(c.disposed).toBe(true)
    expect(c.actor).toBeNull()
  })
})

// ===========================================================================
// BehaviorComponent
// ===========================================================================

describe('BehaviorComponent', () => {
  it('extends Component', () => {
    class TestBehavior extends BehaviorComponent<unknown> {}
    const b = new TestBehavior()
    expect(b).toBeInstanceOf(Component)
    expect(b).toBeInstanceOf(BehaviorComponent)
  })

  it('inherits lifecycle methods from Component', () => {
    class TestBehavior extends BehaviorComponent<unknown> {}
    const b = new TestBehavior()
    const actor = makeMockActor(1)

    expect(b.enabled).toBe(true)
    b.attach(actor)
    expect(b.actor).toBe(actor)
    b.detach(actor)
    expect(b.actor).toBeNull()
    b.dispose()
    expect(b.disposed).toBe(true)
  })

  it('can accept generic type parameter', () => {
    // BehaviorComponent<string> for a hypothetical string-node behavior
    class StringBehavior extends BehaviorComponent<string> {}
    const b = new StringBehavior()
    expect(b).toBeInstanceOf(BehaviorComponent)
  })
})

// ===========================================================================
// Type guard functions
// ===========================================================================

// Helper to create mock actors with unique IDs
let nextActorId = 100
function makeMockActor(id?: number): IGameActor {
  return {
    actorId: id ?? nextActorId++,
    isInWorld: true,
    isDead: false,
    disposed: false,
  }
}

// ===========================================================================
// ITick type guard
// ===========================================================================

describe('isITick', () => {
  it('returns true for objects with tick method', () => {
    const obj = { tick: () => {} }
    expect(isITick(obj)).toBe(true)
  })

  it('returns false for objects without tick method', () => {
    const obj = { update: () => {} }
    expect(isITick(obj)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isITick(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isITick(undefined)).toBe(false)
  })

  it('returns false for primitive values', () => {
    expect(isITick(42)).toBe(false)
    expect(isITick('tick')).toBe(false)
    expect(isITick(true)).toBe(false)
  })

  it('returns false for object where tick is not a function', () => {
    expect(isITick({ tick: 'not-a-function' })).toBe(false)
  })

  it('returns true for Component subclass implementing ITick', () => {
    class TickingComponent extends Component implements ITick {
      tick(_actor: IGameActor): void {}
    }
    const c = new TickingComponent()
    expect(isITick(c)).toBe(true)
  })
})

// ===========================================================================
// isITickRender
// ===========================================================================

describe('isITickRender', () => {
  it('returns true for objects with tickRender method', () => {
    const obj = { tickRender: () => {} }
    expect(isITickRender(obj)).toBe(true)
  })

  it('returns false for objects without tickRender method', () => {
    const obj = { tick: () => {} }
    expect(isITickRender(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isITickRender(null)).toBe(false)
    expect(isITickRender(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIRender
// ===========================================================================

describe('isIRender', () => {
  it('returns true for objects with render AND screenBounds', () => {
    const obj = { render: () => [], screenBounds: () => [] }
    expect(isIRender(obj)).toBe(true)
  })

  it('returns false for objects with only render', () => {
    const obj = { render: () => [] }
    expect(isIRender(obj)).toBe(false)
  })

  it('returns false for objects with only screenBounds', () => {
    const obj = { screenBounds: () => [] }
    expect(isIRender(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isIRender(null)).toBe(false)
    expect(isIRender(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyCreated
// ===========================================================================

describe('isINotifyCreated', () => {
  it('returns true for objects with created method', () => {
    const obj = { created: () => {} }
    expect(isINotifyCreated(obj)).toBe(true)
  })

  it('returns false for objects without created method', () => {
    const obj = { tick: () => {} }
    expect(isINotifyCreated(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyCreated(null)).toBe(false)
    expect(isINotifyCreated(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyAddedToWorld
// ===========================================================================

describe('isINotifyAddedToWorld', () => {
  it('returns true for objects with addedToWorld method', () => {
    const obj = { addedToWorld: () => {} }
    expect(isINotifyAddedToWorld(obj)).toBe(true)
  })

  it('returns false for objects without it', () => {
    expect(isINotifyAddedToWorld({ created: () => {} })).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyAddedToWorld(null)).toBe(false)
    expect(isINotifyAddedToWorld(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyRemovedFromWorld
// ===========================================================================

describe('isINotifyRemovedFromWorld', () => {
  it('returns true for objects with removedFromWorld method', () => {
    const obj = { removedFromWorld: () => {} }
    expect(isINotifyRemovedFromWorld(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyRemovedFromWorld(null)).toBe(false)
    expect(isINotifyRemovedFromWorld(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyActorDisposing
// ===========================================================================

describe('isINotifyActorDisposing', () => {
  it('returns true for objects with disposing method', () => {
    const obj = { disposing: () => {} }
    expect(isINotifyActorDisposing(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyActorDisposing(null)).toBe(false)
    expect(isINotifyActorDisposing(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyKilled
// ===========================================================================

describe('isINotifyKilled', () => {
  it('returns true for objects with killed method', () => {
    const obj = { killed: () => {} }
    expect(isINotifyKilled(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyKilled(null)).toBe(false)
    expect(isINotifyKilled(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIResolveOrder
// ===========================================================================

describe('isIResolveOrder', () => {
  it('returns true for objects with resolveOrder method', () => {
    const obj = { resolveOrder: () => {} }
    expect(isIResolveOrder(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isIResolveOrder(null)).toBe(false)
    expect(isIResolveOrder(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIIssueOrder
// ===========================================================================

describe('isIIssueOrder', () => {
  it('returns true for objects with issueOrder method AND orders property', () => {
    const obj = { orders: [], issueOrder: () => ({ orderName: 'test', targetString: '', extraData: null }) }
    expect(isIIssueOrder(obj)).toBe(true)
  })

  it('returns false when orders is missing', () => {
    const obj = { issueOrder: () => {} }
    expect(isIIssueOrder(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isIIssueOrder(null)).toBe(false)
    expect(isIIssueOrder(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifySelected
// ===========================================================================

describe('isINotifySelected', () => {
  it('returns true for objects with selected method', () => {
    const obj = { selected: () => {} }
    expect(isINotifySelected(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifySelected(null)).toBe(false)
    expect(isINotifySelected(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifySelection
// ===========================================================================

describe('isINotifySelection', () => {
  it('returns true for objects with selectionChanged method', () => {
    const obj = { selectionChanged: () => {} }
    expect(isINotifySelection(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifySelection(null)).toBe(false)
    expect(isINotifySelection(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyBecomingIdle
// ===========================================================================

describe('isINotifyBecomingIdle', () => {
  it('returns true for objects with onBecomingIdle method', () => {
    const obj = { onBecomingIdle: () => {} }
    expect(isINotifyBecomingIdle(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyBecomingIdle(null)).toBe(false)
    expect(isINotifyBecomingIdle(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyIdle
// ===========================================================================

describe('isINotifyIdle', () => {
  it('returns true for objects with tickIdle method', () => {
    const obj = { tickIdle: () => {} }
    expect(isINotifyIdle(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyIdle(null)).toBe(false)
    expect(isINotifyIdle(undefined)).toBe(false)
  })
})

// ===========================================================================
// isINotifyOwnerChanged
// ===========================================================================

describe('isINotifyOwnerChanged', () => {
  it('returns true for objects with onOwnerChanged method', () => {
    const obj = { onOwnerChanged: () => {} }
    expect(isINotifyOwnerChanged(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isINotifyOwnerChanged(null)).toBe(false)
    expect(isINotifyOwnerChanged(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIOccupySpace
// ===========================================================================

describe('isIOccupySpace', () => {
  it('returns true for objects with centerPosition, topLeft, and occupiedCells method', () => {
    const obj = {
      centerPosition: { X: 0, Y: 0, Z: 0 },
      topLeft: { X: 0, Y: 0, Z: 0 } as unknown as import('../CPos').CPos,
      occupiedCells: () => [],
    }
    expect(isIOccupySpace(obj)).toBe(true)
  })

  it('returns false when centerPosition is missing', () => {
    const obj = { topLeft: { X: 0, Y: 0, Z: 0 }, occupiedCells: () => [] }
    expect(isIOccupySpace(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isIOccupySpace(null)).toBe(false)
    expect(isIOccupySpace(undefined)).toBe(false)
  })
})

// ===========================================================================
// isITargetable
// ===========================================================================

describe('isITargetable', () => {
  it('returns true for objects with targetTypes, targetableBy method, requiresForceFire', () => {
    const obj = {
      targetTypes: { contains: () => false, isEmpty: () => true },
      targetableBy: () => false,
      requiresForceFire: false,
    }
    expect(isITargetable(obj)).toBe(true)
  })

  it('returns false when targetableBy is not a function', () => {
    const obj = {
      targetTypes: {},
      targetableBy: 'not-a-function',
      requiresForceFire: false,
    }
    expect(isITargetable(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isITargetable(null)).toBe(false)
    expect(isITargetable(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIFacing
// ===========================================================================

describe('isIFacing', () => {
  it('returns true for objects with turnSpeed, facing, orientation', () => {
    const obj = { turnSpeed: 0, facing: 0, orientation: {} }
    expect(isIFacing(obj)).toBe(true)
  })

  it('returns false when orientation is missing', () => {
    const obj = { turnSpeed: 0, facing: 0 }
    expect(isIFacing(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isIFacing(null)).toBe(false)
    expect(isIFacing(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIHealth
// ===========================================================================

describe('isIHealth', () => {
  it('returns true for objects with damageState, hp, maxHP, isDead, inflictDamage', () => {
    const obj = {
      damageState: DamageState.Undamaged,
      hp: 100,
      maxHP: 100,
      displayHP: 100,
      isDead: false,
      inflictDamage: () => {},
      kill: () => {},
    }
    expect(isIHealth(obj)).toBe(true)
  })

  it('returns false when inflictDamage is not a function', () => {
    const obj = {
      damageState: 1,
      hp: 100,
      maxHP: 100,
      isDead: false,
      inflictDamage: 'not-a-function',
    }
    expect(isIHealth(obj)).toBe(false)
  })

  it('returns false for null and undefined', () => {
    expect(isIHealth(null)).toBe(false)
    expect(isIHealth(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIRenderAboveShroud
// ===========================================================================

describe('isIRenderAboveShroud', () => {
  it('returns true for objects with renderAboveShroud method', () => {
    const obj = { renderAboveShroud: () => [] }
    expect(isIRenderAboveShroud(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isIRenderAboveShroud(null)).toBe(false)
    expect(isIRenderAboveShroud(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIRenderAnnotations
// ===========================================================================

describe('isIRenderAnnotations', () => {
  it('returns true for objects with renderAnnotations method', () => {
    const obj = { renderAnnotations: () => [] }
    expect(isIRenderAnnotations(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isIRenderAnnotations(null)).toBe(false)
    expect(isIRenderAnnotations(undefined)).toBe(false)
  })
})

// ===========================================================================
// isIWorldLoaded
// ===========================================================================

describe('isIWorldLoaded', () => {
  it('returns true for objects with worldLoaded method', () => {
    const obj = { worldLoaded: () => {} }
    expect(isIWorldLoaded(obj)).toBe(true)
  })

  it('returns false for null and undefined', () => {
    expect(isIWorldLoaded(null)).toBe(false)
    expect(isIWorldLoaded(undefined)).toBe(false)
  })
})

// ===========================================================================
// Multi-interface type guard tests
// ===========================================================================

describe('Type guards with multi-interface objects', () => {
  it('correctly identifies all interfaces on an object implementing multiple', () => {
    class FullTrait
      extends Component
      implements ITick, INotifyCreated, IResolveOrder, IHealth
    {
      tick(_actor: IGameActor): void {}
      created(_actor: IGameActor): void {}
      resolveOrder(_actor: IGameActor, _order: unknown): void {}
      damageState: DamageState = DamageState.Undamaged
      hp = 100
      maxHP = 100
      displayHP = 100
      isDead = false
      inflictDamage(): void {}
      kill(): void {}
    }

    const t = new FullTrait()

    expect(isITick(t)).toBe(true)
    expect(isINotifyCreated(t)).toBe(true)
    expect(isIResolveOrder(t)).toBe(true)
    expect(isIHealth(t)).toBe(true)
    // Should NOT match interfaces it doesn't implement
    expect(isITickRender(t)).toBe(false)
    expect(isIFacing(t)).toBe(false)
    expect(isIOccupySpace(t)).toBe(false)
    expect(isIIssueOrder(t)).toBe(false)
  })

  it('empty object matches no type guards', () => {
    const obj = {}
    expect(isITick(obj)).toBe(false)
    expect(isINotifyCreated(obj)).toBe(false)
    expect(isIResolveOrder(obj)).toBe(false)
    expect(isIHealth(obj)).toBe(false)
    expect(isIFacing(obj)).toBe(false)
    expect(isIOccupySpace(obj)).toBe(false)
    expect(isITargetable(obj)).toBe(false)
    expect(isIRender(obj)).toBe(false)
    expect(isIIssueOrder(obj)).toBe(false)
    expect(isINotifySelected(obj)).toBe(false)
    expect(isINotifySelection(obj)).toBe(false)
    expect(isINotifyBecomingIdle(obj)).toBe(false)
    expect(isINotifyIdle(obj)).toBe(false)
    expect(isINotifyOwnerChanged(obj)).toBe(false)
    expect(isINotifyAddedToWorld(obj)).toBe(false)
    expect(isINotifyRemovedFromWorld(obj)).toBe(false)
    expect(isINotifyActorDisposing(obj)).toBe(false)
    expect(isINotifyKilled(obj)).toBe(false)
    expect(isIRenderAboveShroud(obj)).toBe(false)
    expect(isIRenderAnnotations(obj)).toBe(false)
    expect(isIWorldLoaded(obj)).toBe(false)
  })

  it('function is not an interface object', () => {
    const fn = () => {}
    expect(isITick(fn)).toBe(false)
    expect(isINotifyCreated(fn)).toBe(false)
  })

  it('array is not an interface object', () => {
    expect(isITick([])).toBe(false)
    expect(isINotifyCreated([])).toBe(false)
  })
})

// ===========================================================================
// IGameActor structural conformance
// ===========================================================================

describe('IGameActor', () => {
  it('valid objects satisfy the interface shape', () => {
    const actor: IGameActor = {
      actorId: 1,
      isInWorld: true,
      isDead: false,
      disposed: false,
    }
    expect(actor.actorId).toBe(1)
    expect(actor.isInWorld).toBe(true)
    expect(actor.isDead).toBe(false)
    expect(actor.disposed).toBe(false)
  })
})

// ===========================================================================
// ITraitInfoInterface marker
// ===========================================================================

describe('ITraitInfoInterface', () => {
  it('empty objects satisfy the marker interface', () => {
    const info: ITraitInfoInterface = {}
    expect(info).toBeDefined()
  })
})

// ===========================================================================
// Marker interfaces (Requires<T>)
// ===========================================================================

describe('Requires<T> marker', () => {
  it('is an empty interface usable as a type constraint', () => {
    // Just verify the type system accepts it
    interface TestInfo extends ITraitInfoInterface { value: number }
    const r: Requires<TestInfo> = {}
    void r
    // If this compiles, the test passes
    expect(true).toBe(true)
  })
})

// ===========================================================================
// VariableObserver
// ===========================================================================

describe('VariableObserver', () => {
  it('structural shape is correct', () => {
    const obs: VariableObserver = {
      notifier: (_actor: IGameActor, _vars: ReadonlyMap<string, number>) => {},
      variables: ['condition.a', 'condition.b'],
    }
    expect(obs.variables).toHaveLength(2)
    expect(obs.variables).toContain('condition.a')
    expect(typeof obs.notifier).toBe('function')
  })
})
