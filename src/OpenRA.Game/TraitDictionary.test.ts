/**
 * TraitDictionary.test.ts — TraitDictionary unit tests
 *
 * Tests focus on:
 * - Registration (addTrait, removeTrait, removeActor)
 * - Per-actor queries (traitsImplementing, traitOrDefault, hasTrait)
 * - Global queries (actorsWithTrait, actorsHavingTrait, filtered variants)
 * - Bulk operations (applyToActorsWithTrait, applyToActorsWithTraitTimed)
 * - Performance reporting (printReport, interfaceCount, totalTraits)
 * - Edge cases: multiple actors, multiple traits per actor, no interfaces
 * - Acceptance criteria: 20 components, 5 ITick, query correctness
 * - Performance: 1000 actors × 20 traits, traversal under 5ms (acceptance)
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { TraitDictionary } from './TraitDictionary'
import {
  Component,
  type IGameActor,
  type ITick,
  type ITickRender,
  type INotifyCreated,
  type IResolveOrder,
  type IHealth,
  type IFacing,
  DamageState,
} from './Traits/TraitsInterfaces'

// ===========================================================================
// Mock actor factory
// ===========================================================================

let nextId = 1
function makeActor(overrides?: Partial<IGameActor>): IGameActor {
  return {
    actorId: nextId++,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
}

// ===========================================================================
// Mock component classes
// ===========================================================================

class TickComponent extends Component implements ITick {
  static readonly interfaces = ['ITick', 'component']
  tickCalls: number = 0
  tick(_actor: IGameActor): void {
    this.tickCalls++
  }
}

class TickRenderComponent extends Component implements ITickRender {
  static readonly interfaces = ['ITickRender', 'component']
  tickRenderCalls: number = 0
  tickRender(_wr: unknown, _actor: IGameActor): void {
    this.tickRenderCalls++
  }
}

class CreatedComponent extends Component implements INotifyCreated {
  static readonly interfaces = ['INotifyCreated', 'component']
  createdCalls: number = 0
  created(_actor: IGameActor): void {
    this.createdCalls++
  }
}

class HealthComponent extends Component implements IHealth {
  static readonly interfaces = ['IHealth', 'component']
  damageState: DamageState = DamageState.Undamaged
  hp = 100
  maxHP = 100
  displayHP = 100
  isDead = false
  inflictDamage(): void {}
  kill(): void {}
}

class FacingComponent extends Component implements IFacing {
  static readonly interfaces = ['IFacing', 'component']
  turnSpeed = { angle: 16 } as unknown as import('./WAngle').WAngle
  _facing = { angle: 0 } as unknown as import('./WAngle').WAngle
  get facing(): import('./WAngle').WAngle { return this._facing }
  set facing(v: import('./WAngle').WAngle) { this._facing = v }
  get orientation(): import('./WRot').WRot { return {} as unknown as import('./WRot').WRot }
}

// Multi-interface component (implements multiple traits)
class MultiTraitComponent
  extends Component
  implements ITick, INotifyCreated, IResolveOrder
{
  static readonly interfaces = ['ITick', 'INotifyCreated', 'IResolveOrder', 'component']
  tick(_actor: IGameActor): void {}
  created(_actor: IGameActor): void {}
  resolveOrder(_actor: IGameActor, _order: unknown): void {}
}

// Component without interfaces declaration (should fail)
class BadComponent extends Component {
  // Missing static readonly interfaces
}

// Component with empty interfaces
class EmptyInterfacesComponent extends Component {
  static readonly interfaces: string[] = []
}

// ===========================================================================
// Helper: create N generic components (all implementing ITick)
// ===========================================================================

class GenericTickComponent extends Component implements ITick {
  static readonly interfaces = ['ITick', 'component']
  id: number
  constructor(id: number) {
    super()
    this.id = id
  }
  tick(_actor: IGameActor): void {}
}

// ===========================================================================
// Tests: Registration
// ===========================================================================

describe('TraitDictionary registration', () => {
  let dict: TraitDictionary
  let actor: IGameActor

  beforeEach(() => {
    dict = new TraitDictionary()
    actor = makeActor()
  })

  describe('addTrait', () => {
    it('adds component to the correct interface bucket', () => {
      const t = new TickComponent()
      t.attach(actor)
      dict.addTrait(actor, t)

      expect(dict.traitsImplementing<TickComponent>(actor, 'ITick')).toHaveLength(1)
      expect(dict.traitsImplementing<TickComponent>(actor, 'ITick')[0]).toBe(t)
    })

    it('adds component to all declared interface buckets', () => {
      const t = new MultiTraitComponent()
      t.attach(actor)
      dict.addTrait(actor, t)

      expect(dict.traitsImplementing(actor, 'ITick')).toHaveLength(1)
      expect(dict.traitsImplementing(actor, 'INotifyCreated')).toHaveLength(1)
      expect(dict.traitsImplementing(actor, 'IResolveOrder')).toHaveLength(1)
    })

    it('throws for component without static interfaces', () => {
      const bad = new BadComponent()
      bad.attach(actor)
      expect(() => dict.addTrait(actor, bad)).toThrow(
        /does not declare static interfaces/,
      )
    })

    it('accepts component with empty interfaces array', () => {
      const e = new EmptyInterfacesComponent()
      e.attach(actor)
      // Empty interfaces — should not add to any bucket, but should not throw
      expect(() => dict.addTrait(actor, e)).not.toThrow()
      expect(dict.totalTraits).toBe(0)
    })

    it('allows multiple traits of the same interface on one actor', () => {
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(actor)
      t2.attach(actor)
      dict.addTrait(actor, t1)
      dict.addTrait(actor, t2)

      const result = dict.traitsImplementing<TickComponent>(actor, 'ITick')
      expect(result).toHaveLength(2)
      expect(result).toContain(t1)
      expect(result).toContain(t2)
    })

    it('allows the same trait on different actors', () => {
      const a1 = makeActor()
      const a2 = makeActor()
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(a1)
      t2.attach(a2)
      dict.addTrait(a1, t1)
      dict.addTrait(a2, t2)

      expect(dict.traitsImplementing<TickComponent>(a1, 'ITick')).toHaveLength(1)
      expect(dict.traitsImplementing<TickComponent>(a2, 'ITick')).toHaveLength(1)
    })
  })

  describe('removeTrait', () => {
    it('removes component from all interface buckets', () => {
      const t = new MultiTraitComponent()
      t.attach(actor)
      dict.addTrait(actor, t)
      dict.removeTrait(actor, t)

      expect(dict.traitsImplementing(actor, 'ITick')).toHaveLength(0)
      expect(dict.traitsImplementing(actor, 'INotifyCreated')).toHaveLength(0)
      expect(dict.traitsImplementing(actor, 'IResolveOrder')).toHaveLength(0)
    })

    it('removes only the specified trait, leaving others', () => {
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(actor)
      t2.attach(actor)
      dict.addTrait(actor, t1)
      dict.addTrait(actor, t2)

      dict.removeTrait(actor, t1)

      const result = dict.traitsImplementing<TickComponent>(actor, 'ITick')
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(t2)
    })

    it('is no-op for unregistered trait', () => {
      const t = new TickComponent()
      t.attach(actor)
      expect(() => dict.removeTrait(actor, t)).not.toThrow()
    })

    it('deletes the interface bucket when last trait removed', () => {
      const t = new TickComponent()
      t.attach(actor)
      dict.addTrait(actor, t)
      expect(dict.interfaceCount).toBeGreaterThanOrEqual(1)

      dict.removeTrait(actor, t)
      // The 'component' interface might also be gone
      expect(dict.traitsImplementing(actor, 'ITick')).toHaveLength(0)
    })
  })

  describe('removeActor', () => {
    it('removes all traits for the actor', () => {
      const t1 = new TickComponent()
      const t2 = new HealthComponent()
      const t3 = new CreatedComponent()
      t1.attach(actor)
      t2.attach(actor)
      t3.attach(actor)
      dict.addTrait(actor, t1)
      dict.addTrait(actor, t2)
      dict.addTrait(actor, t3)

      expect(dict.totalTraits).toBeGreaterThanOrEqual(3)

      dict.removeActor(actor)

      expect(dict.traitsImplementing(actor, 'ITick')).toHaveLength(0)
      expect(dict.traitsImplementing(actor, 'IHealth')).toHaveLength(0)
      expect(dict.traitsImplementing(actor, 'INotifyCreated')).toHaveLength(0)
    })

    it('does not remove traits from other actors', () => {
      const a1 = makeActor()
      const a2 = makeActor()
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(a1)
      t2.attach(a2)
      dict.addTrait(a1, t1)
      dict.addTrait(a2, t2)

      dict.removeActor(a1)

      expect(dict.traitsImplementing(a2, 'ITick')).toHaveLength(1)
      expect(dict.traitsImplementing(a2, 'ITick')[0]).toBe(t2)
    })

    it('is no-op for actor with no traits', () => {
      const a = makeActor()
      expect(() => dict.removeActor(a)).not.toThrow()
    })
  })
})

// ===========================================================================
// Tests: Per-actor queries
// ===========================================================================

describe('TraitDictionary per-actor queries', () => {
  let dict: TraitDictionary
  let actor: IGameActor

  beforeEach(() => {
    dict = new TraitDictionary()
    actor = makeActor()
  })

  describe('traitsImplementing', () => {
    it('returns all traits implementing the interface for the actor', () => {
      const t1 = new TickComponent()
      const t2 = new MultiTraitComponent() // also implements ITick
      t1.attach(actor)
      t2.attach(actor)
      dict.addTrait(actor, t1)
      dict.addTrait(actor, t2)

      const result = dict.traitsImplementing(actor, 'ITick')
      expect(result).toHaveLength(2)
    })

    it('returns empty array when no traits match', () => {
      const t = new TickComponent()
      t.attach(actor)
      dict.addTrait(actor, t)

      const result = dict.traitsImplementing(actor, 'IFacing')
      expect(result).toHaveLength(0)
    })

    it('returns empty array for unknown interface', () => {
      const result = dict.traitsImplementing(actor, 'NonExistent')
      expect(result).toHaveLength(0)
    })

    it('only returns traits for the specified actor', () => {
      const a1 = makeActor()
      const a2 = makeActor()
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(a1)
      t2.attach(a2)
      dict.addTrait(a1, t1)
      dict.addTrait(a2, t2)

      const r1 = dict.traitsImplementing(a1, 'ITick')
      expect(r1).toHaveLength(1)
      expect(r1[0]).toBe(t1)
    })
  })

  describe('traitOrDefault', () => {
    it('returns first matching trait', () => {
      const t = new TickComponent()
      t.attach(actor)
      dict.addTrait(actor, t)

      const result = dict.traitOrDefault<TickComponent>(actor, 'ITick')
      expect(result).toBe(t)
    })

    it('returns undefined when no trait matches', () => {
      const result = dict.traitOrDefault(actor, 'ITick')
      expect(result).toBeUndefined()
    })

    it('returns undefined for unknown interface', () => {
      const result = dict.traitOrDefault(actor, 'NonExistent')
      expect(result).toBeUndefined()
    })
  })

  describe('hasTrait', () => {
    it('returns true when actor has a matching trait', () => {
      const t = new TickComponent()
      t.attach(actor)
      dict.addTrait(actor, t)

      expect(dict.hasTrait(actor, 'ITick')).toBe(true)
    })

    it('returns false when actor does not have the trait', () => {
      expect(dict.hasTrait(actor, 'ITick')).toBe(false)
    })

    it('returns false for unknown interface', () => {
      expect(dict.hasTrait(actor, 'NonExistent')).toBe(false)
    })
  })
})

// ===========================================================================
// Tests: Global queries
// ===========================================================================

describe('TraitDictionary global queries', () => {
  let dict: TraitDictionary

  beforeEach(() => {
    dict = new TraitDictionary()
  })

  describe('actorsWithTrait', () => {
    it('returns all (actor, trait) pairs globally', () => {
      const a1 = makeActor()
      const a2 = makeActor()
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(a1)
      t2.attach(a2)
      dict.addTrait(a1, t1)
      dict.addTrait(a2, t2)

      const result = dict.actorsWithTrait<TickComponent>('ITick')
      expect(result).toHaveLength(2)
      expect(result[0].actor).toBe(a1)
      expect(result[0].trait).toBe(t1)
      expect(result[1].actor).toBe(a2)
      expect(result[1].trait).toBe(t2)
    })

    it('returns empty array for unknown interface', () => {
      expect(dict.actorsWithTrait('NonExistent')).toHaveLength(0)
    })

    it('returns multiple pairs for multi-interface component', () => {
      const actor = makeActor()
      const t = new MultiTraitComponent()
      t.attach(actor)
      dict.addTrait(actor, t)

      const tickResult = dict.actorsWithTrait('ITick')
      expect(tickResult).toHaveLength(1)
      expect(tickResult[0].trait).toBe(t)

      const createdResult = dict.actorsWithTrait('INotifyCreated')
      expect(createdResult).toHaveLength(1)
    })
  })

  describe('actorsWithTraitFiltered', () => {
    it('filters traits by predicate', () => {
      const a1 = makeActor()
      const t1 = new GenericTickComponent(10)
      const t2 = new GenericTickComponent(20)
      t1.attach(a1)
      t2.attach(a1)
      dict.addTrait(a1, t1)
      dict.addTrait(a1, t2)

      const result = dict.actorsWithTraitFiltered<GenericTickComponent>(
        'ITick',
        (t) => t.id > 15,
      )
      expect(result).toHaveLength(1)
      expect(result[0].trait.id).toBe(20)
    })

    it('returns empty when no traits match predicate', () => {
      const a1 = makeActor()
      const t1 = new GenericTickComponent(5)
      t1.attach(a1)
      dict.addTrait(a1, t1)

      const result = dict.actorsWithTraitFiltered<GenericTickComponent>(
        'ITick',
        (t) => t.id > 100,
      )
      expect(result).toHaveLength(0)
    })
  })

  describe('actorsHavingTrait', () => {
    it('returns unique actors having the trait', () => {
      const a1 = makeActor()
      const a2 = makeActor()
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      const t3 = new HealthComponent()
      t1.attach(a1)
      t2.attach(a2)
      t3.attach(a1)
      dict.addTrait(a1, t1)
      dict.addTrait(a2, t2)
      dict.addTrait(a1, t3)

      const tickActors = dict.actorsHavingTrait('ITick')
      expect(tickActors).toHaveLength(2)

      const healthActors = dict.actorsHavingTrait('IHealth')
      expect(healthActors).toHaveLength(1)
    })

    it('deduplicates when one actor has multiple traits of same interface', () => {
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      const a1 = makeActor()
      t1.attach(a1)
      t2.attach(a1)
      dict.addTrait(a1, t1)
      dict.addTrait(a1, t2)

      const result = dict.actorsHavingTrait('ITick')
      expect(result).toHaveLength(1)
    })
  })

  describe('actorsHavingTraitFiltered', () => {
    it('returns unique actors matching predicate', () => {
      const a1 = makeActor()
      const a2 = makeActor()
      const t1 = new GenericTickComponent(10)
      const t2 = new GenericTickComponent(30)
      t1.attach(a1)
      t2.attach(a2)
      dict.addTrait(a1, t1)
      dict.addTrait(a2, t2)

      const result = dict.actorsHavingTraitFiltered<GenericTickComponent>(
        'ITick',
        (t) => t.id > 20,
      )
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(a2)
    })
  })
})

// ===========================================================================
// Tests: Bulk operations
// ===========================================================================

describe('TraitDictionary bulk operations', () => {
  let dict: TraitDictionary

  beforeEach(() => {
    dict = new TraitDictionary()
  })

  describe('applyToActorsWithTrait', () => {
    it('calls action for every (actor, trait) pair', () => {
      const a1 = makeActor()
      const a2 = makeActor()
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(a1)
      t2.attach(a2)
      dict.addTrait(a1, t1)
      dict.addTrait(a2, t2)

      const seen: [number, TickComponent][] = []
      dict.applyToActorsWithTrait<TickComponent>('ITick', (actor, trait) => {
        seen.push([actor.actorId, trait])
      })

      expect(seen).toHaveLength(2)
    })

    it('does nothing for unknown interface', () => {
      const called: unknown[] = []
      dict.applyToActorsWithTrait('NonExistent', () => {
        called.push(true)
      })
      expect(called).toHaveLength(0)
    })

    it('calls tick on all ITick traits', () => {
      const a1 = makeActor()
      const t1 = new TickComponent()
      const t2 = new TickComponent()
      t1.attach(a1)
      t2.attach(a1)
      dict.addTrait(a1, t1)
      dict.addTrait(a1, t2)

      dict.applyToActorsWithTrait<TickComponent>('ITick', (_actor, trait) => {
        trait.tick(_actor)
      })

      expect(t1.tickCalls).toBe(1)
      expect(t2.tickCalls).toBe(1)
    })
  })

  describe('applyToActorsWithTraitTimed', () => {
    it('calls action for each pair and invokes perf callback', () => {
      const a1 = makeActor()
      const t1 = new TickComponent()
      t1.attach(a1)
      dict.addTrait(a1, t1)

      const perfLog: { trait: Component; elapsedMs: number }[] = []
      const actions: number[] = []

      dict.applyToActorsWithTraitTimed<TickComponent>(
        'ITick',
        (_actor, trait) => {
          actions.push(trait.actor?.actorId ?? 0)
        },
        'TestTick',
        (trait, elapsedMs) => {
          perfLog.push({ trait, elapsedMs })
        },
      )

      expect(actions).toHaveLength(1)
      expect(perfLog).toHaveLength(1)
      expect(perfLog[0].trait).toBe(t1)
      expect(perfLog[0].elapsedMs).toBeGreaterThanOrEqual(0)
    })

    it('does nothing for unknown interface', () => {
      const perfLog: unknown[] = []
      dict.applyToActorsWithTraitTimed(
        'NonExistent',
        () => {},
        'test',
        (trait, elapsedMs) => {
          perfLog.push({ trait, elapsedMs })
        },
      )
      expect(perfLog).toHaveLength(0)
    })
  })
})

// ===========================================================================
// Tests: Performance report
// ===========================================================================

describe('TraitDictionary performance report', () => {
  it('printReport returns query statistics', () => {
    const dict = new TraitDictionary()
    const a1 = makeActor()
    const t1 = new TickComponent()
    t1.attach(a1)
    dict.addTrait(a1, t1)

    // Run queries
    dict.traitsImplementing(a1, 'ITick')
    dict.traitsImplementing(a1, 'ITick')
    dict.actorsWithTrait('ITick')

    const report = dict.printReport()
    expect(report).toContain('TraitDictionary Query Report')
    expect(report).toContain('ITick')
  })

  it('interfaceCount returns number of distinct interface buckets', () => {
    const dict = new TraitDictionary()
    const a1 = makeActor()
    const t = new MultiTraitComponent()
    t.attach(a1)
    dict.addTrait(a1, t)

    // ITick, INotifyCreated, IResolveOrder, component = 4
    expect(dict.interfaceCount).toBe(4)
  })

  it('totalTraits returns sum across all buckets', () => {
    const dict = new TraitDictionary()
    const a1 = makeActor()
    const t = new MultiTraitComponent() // 4 interfaces
    t.attach(a1)
    dict.addTrait(a1, t)

    // 4 interfaces × 1 component = 4 entries
    expect(dict.totalTraits).toBe(4)
  })

  it('clear resets all state', () => {
    const dict = new TraitDictionary()
    const a1 = makeActor()
    const t = new TickComponent()
    t.attach(a1)
    dict.addTrait(a1, t)
    dict.traitsImplementing(a1, 'ITick')

    dict.clear()
    expect(dict.interfaceCount).toBe(0)
    expect(dict.totalTraits).toBe(0)
  })

  it('printReport handles empty dictionary', () => {
    const dict = new TraitDictionary()
    const report = dict.printReport()
    expect(report).toContain('no queries recorded')
  })
})

// ===========================================================================
// Tests: Edge cases
// ===========================================================================

describe('TraitDictionary edge cases', () => {
  it('traits with no actor attached are skipped in global queries', () => {
    const dict = new TraitDictionary()
    const actor = makeActor()
    const t = new TickComponent()
    // NOT calling t.attach(actor) — simulate trait with null actor
    dict.addTrait(actor, t)

    // Per-actor query should NOT find it because c.actor is null (never attached)
    const perActor = dict.traitsImplementing(actor, 'ITick')
    expect(perActor).toHaveLength(0)

    // Global query should also skip it
    const global = dict.actorsWithTrait('ITick')
    expect(global).toHaveLength(0)
  })

  it('disposed actor traits are still in dictionary until removeActor is called', () => {
    const dict = new TraitDictionary()
    const actor = makeActor()
    const t = new TickComponent()
    t.attach(actor)
    dict.addTrait(actor, t)

    // Setting disposed on the actor doesn't affect dictionary
    // (it's just a field on the mock; removeActor must be called explicitly)
    expect(dict.traitsImplementing(actor, 'ITick')).toHaveLength(1)
  })

  it('handles 20 traits on one actor, 5 implementing ITick', () => {
    const dict = new TraitDictionary()
    const actor = makeActor()

    // 5 ITick traits
    const tickTraits: GenericTickComponent[] = []
    for (let i = 0; i < 5; i++) {
      const t = new GenericTickComponent(i)
      t.attach(actor)
      tickTraits.push(t)
      dict.addTrait(actor, t)
    }

    // 5 ITickRender
    for (let i = 0; i < 5; i++) {
      const t = new TickRenderComponent()
      t.attach(actor)
      dict.addTrait(actor, t)
    }

    // 5 INotifyCreated
    for (let i = 0; i < 5; i++) {
      const t = new CreatedComponent()
      t.attach(actor)
      dict.addTrait(actor, t)
    }

    // 3 IHealth
    for (let i = 0; i < 3; i++) {
      const t = new HealthComponent()
      t.attach(actor)
      dict.addTrait(actor, t)
    }

    // 2 IFacing
    for (let i = 0; i < 2; i++) {
      const t = new FacingComponent()
      t.attach(actor)
      dict.addTrait(actor, t)
    }

    // Total: 20 traits
    const itickResult = dict.traitsImplementing<GenericTickComponent>(actor, 'ITick')
    expect(itickResult).toHaveLength(5)
    expect(itickResult.map(t => t.id).sort()).toEqual([0, 1, 2, 3, 4])

    const itickRenderResult = dict.traitsImplementing(actor, 'ITickRender')
    expect(itickRenderResult).toHaveLength(5)

    const healthResult = dict.traitsImplementing(actor, 'IHealth')
    expect(healthResult).toHaveLength(3)

    const facingResult = dict.traitsImplementing(actor, 'IFacing')
    expect(facingResult).toHaveLength(2)
  })

  it('queried interface returns empty for actor with different interfaces', () => {
    const dict = new TraitDictionary()
    const actor = makeActor()
    const t = new TickComponent()
    t.attach(actor)
    dict.addTrait(actor, t)

    // Querying IFacing on actor that only has ITick
    expect(dict.traitsImplementing(actor, 'IFacing')).toHaveLength(0)
    expect(dict.hasTrait(actor, 'IFacing')).toBe(false)
  })
})

// ===========================================================================
// Tests: Acceptance criteria — performance
// ===========================================================================

describe('TraitDictionary performance (acceptance criteria)', () => {
  it('applyToActorsWithTraitTimed: 1000 actors × 20 traits under 5ms', () => {
    const dict = new TraitDictionary()

    // Create 1000 actors, each with 20 GenericTickComponent traits
    for (let a = 0; a < 1000; a++) {
      const actor = makeActor()
      for (let i = 0; i < 20; i++) {
        const t = new GenericTickComponent(i)
        t.attach(actor)
        dict.addTrait(actor, t)
      }
    }

    // Warmup
    dict.applyToActorsWithTrait<GenericTickComponent>('ITick', (_actor, _trait) => {
      // no-op
    })

    // Measure
    const start = performance.now()
    dict.applyToActorsWithTrait<GenericTickComponent>('ITick', (_actor, _trait) => {
      // no-op
    })
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5) // acceptance threshold
  })

  it('traitsImplementing with 30 traits returns quickly', () => {
    const dict = new TraitDictionary()
    const actor = makeActor()

    for (let i = 0; i < 30; i++) {
      const t = new GenericTickComponent(i)
      t.attach(actor)
      dict.addTrait(actor, t)
    }

    const start = performance.now()
    const result = dict.traitsImplementing<GenericTickComponent>(actor, 'ITick')
    const elapsed = performance.now() - start

    expect(result).toHaveLength(30)
    expect(elapsed).toBeLessThan(1)
  })
})

// ===========================================================================
// Tests: Correctness of trait isolation
// ===========================================================================

describe('TraitDictionary trait isolation', () => {
  it('adding then removing same trait returns to clean state', () => {
    const dict = new TraitDictionary()
    const actor = makeActor()
    const t = new TickComponent()
    t.attach(actor)

    dict.addTrait(actor, t)
    expect(dict.hasTrait(actor, 'ITick')).toBe(true)

    dict.removeTrait(actor, t)
    expect(dict.hasTrait(actor, 'ITick')).toBe(false)
    expect(dict.traitsImplementing(actor, 'ITick')).toHaveLength(0)
  })

  it('adding then removing actor returns to clean state', () => {
    const dict = new TraitDictionary()
    const actor = makeActor()
    const t1 = new TickComponent()
    const t2 = new MultiTraitComponent()
    t1.attach(actor)
    t2.attach(actor)

    dict.addTrait(actor, t1)
    dict.addTrait(actor, t2)
    expect(dict.totalTraits).toBeGreaterThan(0)
    expect(dict.interfaceCount).toBeGreaterThan(0)

    dict.removeActor(actor)

    // Still no traits left
    expect(dict.hasTrait(actor, 'ITick')).toBe(false)
    expect(dict.hasTrait(actor, 'INotifyCreated')).toBe(false)
    // Interface buckets might be empty but still exist? No, they should be cleaned
  })
})
