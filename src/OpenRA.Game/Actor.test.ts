/**
 * Actor.test.ts — GameActor migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, condition system, lifecycle, trait
 * delegation, component storage, and disposal patterns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

// Store mock instances for test introspection
const mockDisposeCalls: Array<{ doNotRecurse: boolean }> = []

vi.mock('@babylonjs/core', () => {
  class MockTransformNode {
    name: string
    _scene: unknown
    _isDisposed: boolean = false

    constructor(name: string, scene?: unknown) {
      this.name = name
      this._scene = scene ?? null
    }

    dispose(_doNotRecurse?: boolean, _disposeMaterialAndTextures?: boolean): void {
      mockDisposeCalls.push({ doNotRecurse: _doNotRecurse ?? false })
    }

    isDisposed(): boolean {
      return this._isDisposed
    }

    get scene(): unknown {
      return this._scene
    }
  }

  return {
    TransformNode: MockTransformNode,
    // Scene is only used as a type — minimal mock
  }
})

// ---------------------------------------------------------------------------
// Import modules under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { GameActor, INVALID_CONDITION_TOKEN, evaluateConditionExpression, SystemActors } from './Actor'
import { Component } from './Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  INotifyCreated,
  INotifyActorDisposing,
  INotifyOwnerChanged,
  INotifyBecomingIdle,
  INotifyIdle,
  IResolveOrder,
  IObservesVariables,
  IOccupySpace,
  ITargetable,
  IEffectiveOwner,
  IHealth,
  PlayerStub,
  VariableObserver,
  VariableObserverNotifier,
  ActivityStub,
  DamageState,
  Damage,
  BitSetStub,
} from './Traits/TraitsInterfaces.js'
import { WPos } from './WPos.js'
import type { CPos } from './CPos.js'
import { TraitDictionary } from './TraitDictionary.js'
import type { GameWorldManager } from './World.js'

// ---------------------------------------------------------------------------
// Helper: create a minimal mock world for GameActor constructor
// ---------------------------------------------------------------------------

interface MockWorldOptions {
  nextActorId?: number
  addActorFn?: (actor: IGameActor) => void
  removeActorFn?: (actor: IGameActor) => void
  addFrameEndTaskFn?: (action: () => void) => void
}

function createMockWorld(opts: MockWorldOptions = {}): GameWorldManager {
  let nextId = opts.nextActorId ?? 0
  const frameEndTasks: Array<() => void> = []
  const dict = new TraitDictionary()

  // Default addActor that actually sets isInWorld
  const defaultAddActor = (actor: IGameActor) => {
    ;(actor as { isInWorld: boolean }).isInWorld = true
  }

  return {
    traitDict: dict,
    nextAID: () => nextId++,
    addActor: opts.addActorFn ?? defaultAddActor,
    removeActor: opts.removeActorFn ?? vi.fn(),
    addFrameEndTask: opts.addFrameEndTaskFn ?? ((action: () => void) => {
      frameEndTasks.push(action)
    }),
    worldActor: { actorId: 999, isInWorld: true, isDead: false, disposed: false },
    // Drain helper for tests that need frame-end execution
    _drainFrameEndTasks: () => {
      while (frameEndTasks.length > 0) {
        frameEndTasks.shift()!()
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as GameWorldManager
}

// ---------------------------------------------------------------------------
// Helper: create a GameActor for testing
// ---------------------------------------------------------------------------

function createTestActor(
  world?: GameWorldManager,
  name: string = 'testActor',
): GameActor {
  return new GameActor({
    world: world ?? createMockWorld(),
    name,
  })
}

// ---------------------------------------------------------------------------
// Helper: a simple test Component class
// ---------------------------------------------------------------------------

class TestComponent extends Component {
  static readonly interfaces = ['ITestInterface', 'component']

  initCalled = false
  disposeCalled = false

  override attach(actor: IGameActor): void {
    super.attach(actor)
    this.initCalled = true
  }

  override dispose(): void {
    this.disposeCalled = true
    super.dispose()
  }
}

class TestTickComponent extends Component implements INotifyBecomingIdle, INotifyIdle {
  static readonly interfaces = ['INotifyBecomingIdle', 'INotifyIdle', 'component']

  onBecomingIdleCalls = 0
  tickIdleCalls = 0

  onBecomingIdle(_actor: IGameActor): void {
    this.onBecomingIdleCalls++
  }

  tickIdle(_actor: IGameActor): void {
    this.tickIdleCalls++
  }
}

class TestOwnerChangedComponent extends Component implements INotifyOwnerChanged {
  static readonly interfaces = ['INotifyOwnerChanged', 'component']

  lastOldOwner: PlayerStub | undefined
  lastNewOwner: PlayerStub | undefined

  onOwnerChanged(
    _actor: IGameActor,
    oldOwner: PlayerStub,
    newOwner: PlayerStub,
  ): void {
    this.lastOldOwner = oldOwner
    this.lastNewOwner = newOwner
  }
}

class TestDisposingComponent extends Component implements INotifyActorDisposing {
  static readonly interfaces = ['INotifyActorDisposing', 'component']

  disposingCalls = 0

  disposing(_actor: IGameActor): void {
    this.disposingCalls++
  }
}

class TestCreatedComponent extends Component implements INotifyCreated {
  static readonly interfaces = ['INotifyCreated', 'component']

  createdCalls = 0

  created(_actor: IGameActor): void {
    this.createdCalls++
  }
}

class TestObservesVariablesComponent extends Component implements IObservesVariables {
  static readonly interfaces = ['IObservesVariables', 'component']

  private observers: VariableObserver[] = []

  setObservers(obs: VariableObserver[]): void {
    this.observers = obs
  }

  getVariableObservers(): readonly VariableObserver[] {
    return this.observers
  }
}

// NOTE: TestResolveOrderComponent is intentionally inlined in the
// ResolveOrder test (see 'dispatches order to all IResolveOrder traits')
// to avoid duplicate class name conflicts with ResolveOrderCompA/ResolveOrderCompB.

// ---------------------------------------------------------------------------
// Test Activity Stub
// ---------------------------------------------------------------------------

class TestActivity {
  nextActivity: TestActivity | null = null
  tickResult: TestActivity | null = null
  tickCalls = 0
  cancelCalls = 0
  _disposeOuterCalled = false

  tick(_actor: IGameActor): TestActivity | null {
    this.tickCalls++
    return this.tickResult
  }

  cancel(_actor: IGameActor): void {
    this.cancelCalls++
  }

  onActorDisposeOuter(_actor: IGameActor): void {
    this._disposeOuterCalled = true
    if (this.nextActivity) {
      this.nextActivity.onActorDisposeOuter(_actor)
    }
  }

  queue(activity: TestActivity): void {
    if (this.nextActivity === null) {
      this.nextActivity = activity
    } else {
      this.nextActivity.queue(activity)
    }
  }
}

// ---------------------------------------------------------------------------
// GameActor Constructor
// ---------------------------------------------------------------------------

describe('GameActor', () => {
  beforeEach(() => {
    mockDisposeCalls.length = 0
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates an actor with the given name', () => {
      const world = createMockWorld()
      const actor = new GameActor({ world, name: 'e1' })

      expect(actor.name).toBe('e1')
    })

    it('assigns a unique actorId from the world', () => {
      const world = createMockWorld({ nextActorId: 100 })
      const actor = new GameActor({ world, name: 'unit' })

      expect(actor.actorId).toBe(100)
    })

    it('sets info with the name', () => {
      const world = createMockWorld()
      const actor = new GameActor({ world, name: 'tank' })

      expect(actor.info?.name).toBe('tank')
    })

    it('starts with isInWorld = false', () => {
      const actor = createTestActor()
      expect(actor.isInWorld).toBe(false)
    })

    it('starts with willDispose = false', () => {
      const actor = createTestActor()
      expect(actor.willDispose).toBe(false)
    })

    it('starts with disposed = false', () => {
      const actor = createTestActor()
      expect(actor.disposed).toBe(false)
    })

    it('starts with generation = 0', () => {
      const actor = createTestActor()
      expect(actor.generation).toBe(0)
    })

    it('is initially idle (no activities)', () => {
      const actor = createTestActor()
      expect(actor.isIdle).toBe(true)
    })

    it('is not dead when there is no health trait', () => {
      const actor = createTestActor()
      expect(actor.isDead).toBe(false)
    })

    it('extends BABYLON.TransformNode', () => {
      const actor = createTestActor()
      // Verify TransformNode-like behavior
      expect(typeof actor.name).toBe('string')
      expect(typeof actor.isDisposed).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // Component storage (TODO-3.D.2)
  // -----------------------------------------------------------------------

  describe('Component storage', () => {
    it('addComponent stores component by class name', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestComponent()

      actor.addComponent(comp)
      expect(actor.getComponent<TestComponent>('TestComponent')).toBe(comp)
    })

    it('getComponent returns undefined for unknown class name', () => {
      const actor = createTestActor()
      expect(actor.getComponent('NonExistent')).toBeUndefined()
    })

    it('getComponentsImplementing filters by interface name', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestComponent()

      actor.addComponent(comp)
      const results = actor.getComponentsImplementing<TestComponent>('ITestInterface')
      expect(results).toHaveLength(1)
      expect(results[0]).toBe(comp)
    })

    it('getComponentsImplementing returns empty for unknown interface', () => {
      const actor = createTestActor()
      const results = actor.getComponentsImplementing('NonExistentInterface')
      expect(results).toHaveLength(0)
    })

    it('addComponent calls component.attach(this)', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestComponent()

      actor.addComponent(comp)
      expect(comp.actor).toBe(actor as unknown as IGameActor)
    })

    it('addComponent syncs with global TraitDictionary', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestComponent()

      actor.addComponent(comp)

      // Verify it's in the global dictionary
      const traits = world.traitDict.traitsImplementing<TestComponent>(
        actor as unknown as IGameActor,
        'ITestInterface',
      )
      expect(traits).toHaveLength(1)
      expect(traits[0]).toBe(comp)
    })

    it('addComponent throws on duplicate class name', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp1 = new TestComponent()
      const comp2 = new TestComponent()

      actor.addComponent(comp1)
      expect(() => actor.addComponent(comp2)).toThrow(/duplicate/)
    })

    it('removeComponent detaches and removes from both stores', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestComponent()

      actor.addComponent(comp)
      actor.removeComponent(comp)

      expect(actor.getComponent('TestComponent')).toBeUndefined()
      const traits = world.traitDict.traitsImplementing(
        actor as unknown as IGameActor,
        'ITestInterface',
      )
      expect(traits).toHaveLength(0)
    })

    it('removeComponent is safe to call on unknown component', () => {
      const actor = createTestActor()
      const comp = new TestComponent()

      // Should not throw
      expect(() => actor.removeComponent(comp)).not.toThrow()
    })

    it('allComponents iterates all components', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp1 = new TestComponent()

      // We need a second component class for this test
      class TestComponent2 extends Component {
        static readonly interfaces = ['ITestInterface2', 'component']
      }
      const comp2 = new TestComponent2()

      actor.addComponent(comp1)
      actor.addComponent(comp2)

      const all = Array.from(actor.allComponents)
      expect(all).toHaveLength(2)
      expect(all).toContain(comp1)
      expect(all).toContain(comp2)
    })
  })

  // -----------------------------------------------------------------------
  // Condition system (TODO-3.D.3)
  // -----------------------------------------------------------------------

  describe('Condition system', () => {
    it('grantCondition returns a unique positive token', () => {
      const actor = createTestActor()
      const token1 = actor.grantCondition('deployed')
      const token2 = actor.grantCondition('upgraded')

      expect(token1).toBeGreaterThan(0)
      expect(token2).toBeGreaterThan(0)
      expect(token1).not.toBe(token2)
    })

    it('grantCondition empty string returns INVALID_CONDITION_TOKEN', () => {
      const actor = createTestActor()
      const token = actor.grantCondition('')
      expect(token).toBe(INVALID_CONDITION_TOKEN)
    })

    it('hasCondition returns true when condition is active', () => {
      const actor = createTestActor()
      actor.grantCondition('deployed')
      expect(actor.hasCondition('deployed')).toBe(true)
    })

    it('hasCondition returns false for missing condition', () => {
      const actor = createTestActor()
      expect(actor.hasCondition('never_granted')).toBe(false)
    })

    it('tokenValid returns true for valid tokens', () => {
      const actor = createTestActor()
      const token = actor.grantCondition('deployed')
      expect(actor.tokenValid(token)).toBe(true)
    })

    it('tokenValid returns false after revoke', () => {
      const actor = createTestActor()
      const token = actor.grantCondition('deployed')
      actor.revokeCondition(token)
      expect(actor.tokenValid(token)).toBe(false)
    })

    it('tokenValid returns false for never-granted token', () => {
      const actor = createTestActor()
      expect(actor.tokenValid(999)).toBe(false)
    })

    it('revokeCondition throws on invalid token', () => {
      const actor = createTestActor()
      expect(() => actor.revokeCondition(999)).toThrow(/invalid token/)
    })

    it('revokeCondition returns INVALID_CONDITION_TOKEN on success', () => {
      const actor = createTestActor()
      const token = actor.grantCondition('deployed')
      const result = actor.revokeCondition(token)
      expect(result).toBe(INVALID_CONDITION_TOKEN)
    })

    // Reference counting
    it('granting same condition twice creates two distinct tokens', () => {
      const actor = createTestActor()
      const token1 = actor.grantCondition('deployed')
      const token2 = actor.grantCondition('deployed')

      expect(token1).not.toBe(token2)
      expect(actor.hasCondition('deployed')).toBe(true)
    })

    it('revoking one token leaves condition active', () => {
      const actor = createTestActor()
      const token1 = actor.grantCondition('deployed')
      const token2 = actor.grantCondition('deployed')

      actor.revokeCondition(token1)
      expect(actor.hasCondition('deployed')).toBe(true)
      expect(actor.tokenValid(token1)).toBe(false)
      expect(actor.tokenValid(token2)).toBe(true)
    })

    it('revoking all tokens removes condition', () => {
      const actor = createTestActor()
      const token1 = actor.grantCondition('deployed')
      const token2 = actor.grantCondition('deployed')

      actor.revokeCondition(token1)
      actor.revokeCondition(token2)

      expect(actor.hasCondition('deployed')).toBe(false)
    })

    it('conditionCache reflects active token counts', () => {
      const actor = createTestActor()
      actor.grantCondition('deployed')
      actor.grantCondition('deployed')

      expect(actor.conditionCache.get('deployed')).toBe(2)
    })

    // Observer notification
    it('notifies registered observers when condition changes after initialize', () => {
      const world = createMockWorld({
        addActorFn: vi.fn(), // Don't actually add to world for this test
      })
      const actor = createTestActor(world)
      const notifier = vi.fn<VariableObserverNotifier>()

      const observerComp = new TestObservesVariablesComponent()
      observerComp.setObservers([
        { notifier, variables: ['deployed'] },
      ])
      actor.addComponent(observerComp)

      // Initialize to register observers
      actor.initialize(false)

      // Grant condition — should notify
      actor.grantCondition('deployed')
      expect(notifier).toHaveBeenCalled()
    })

    it('does not notify observers before initialize()', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const notifier = vi.fn<VariableObserverNotifier>()

      const observerComp = new TestObservesVariablesComponent()
      observerComp.setObservers([
        { notifier, variables: ['deployed'] },
      ])
      actor.addComponent(observerComp)

      // Grant BEFORE initialize — should NOT notify yet
      actor.grantCondition('deployed')
      expect(notifier).not.toHaveBeenCalled()
    })

    it('conditionCache is a read-only view', () => {
      const actor = createTestActor()
      actor.grantCondition('deployed')

      const cache = actor.conditionCache
      expect(cache.get('deployed')).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Condition Expression Evaluator
  // -----------------------------------------------------------------------

  describe('evaluateConditionExpression', () => {
    const conditions = new Set(['deployed', 'upgraded', 'empowered'])

    function checker(condition: string): boolean {
      return conditions.has(condition)
    }

    it('returns true for simple condition name that is active', () => {
      expect(evaluateConditionExpression('deployed', checker)).toBe(true)
    })

    it('returns false for simple condition name that is NOT active', () => {
      expect(evaluateConditionExpression('disabled', checker)).toBe(false)
    })

    it('evaluates negation (!)', () => {
      expect(evaluateConditionExpression('!disabled', checker)).toBe(true)
      expect(evaluateConditionExpression('!deployed', checker)).toBe(false)
    })

    it('evaluates AND (&&)', () => {
      expect(evaluateConditionExpression('deployed && upgraded', checker)).toBe(true)
      expect(evaluateConditionExpression('deployed && disabled', checker)).toBe(false)
    })

    it('evaluates OR (||)', () => {
      expect(evaluateConditionExpression('deployed || disabled', checker)).toBe(true)
      expect(evaluateConditionExpression('disabled || missing', checker)).toBe(false)
    })

    it('evaluates parentheses', () => {
      // (deployed || disabled) && empowered => (true || false) && true => true
      expect(
        evaluateConditionExpression('(deployed || disabled) && empowered', checker),
      ).toBe(true)

      // !(deployed && disabled) => !(true && false) => !false => true
      expect(
        evaluateConditionExpression('!(deployed && disabled)', checker),
      ).toBe(true)
    })

    it('evaluates complex expressions', () => {
      expect(
        evaluateConditionExpression('deployed && !disabled', checker),
      ).toBe(true)

      expect(
        evaluateConditionExpression('(deployed || upgraded) && !disabled', checker),
      ).toBe(true)

      expect(
        evaluateConditionExpression('(deployed && upgraded) || (disabled && empowered)', checker),
      ).toBe(true)
    })

    it('empty expression returns true (always satisfied)', () => {
      expect(evaluateConditionExpression('', checker)).toBe(true)
      expect(evaluateConditionExpression('   ', checker)).toBe(true)
    })

    it('double negation', () => {
      expect(evaluateConditionExpression('!!deployed', checker)).toBe(true)
    })

    it('handles nested parentheses correctly (Reviewer fix)', () => {
      // The naive startsWith('(') && endsWith(')') approach would incorrectly
      // strip the top-level parens from `(deployed) || (upgraded)`, treating
      // it as a single parenthesized expression. Proper depth tracking fixes this.
      const conds = new Set(['deployed', 'upgraded'])
      const chk = (c: string) => conds.has(c)

      // Nested expression: ((deployed) || (upgraded))
      expect(evaluateConditionExpression('((deployed) || (upgraded))', chk)).toBe(true)

      // Complex nested: ((deployed && !disabled) || (upgraded))
      expect(
        evaluateConditionExpression('((deployed && !disabled) || (upgraded))', chk),
      ).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // SystemActors enum (Reviewer fix)
  // -----------------------------------------------------------------------

  describe('SystemActors', () => {
    it('has correct flag values', () => {
      expect(SystemActors.Player).toBe(0)
      expect(SystemActors.EditorPlayer).toBe(1)
      expect(SystemActors.World).toBe(2)
      expect(SystemActors.EditorWorld).toBe(4)
    })
  })

  // -----------------------------------------------------------------------
  // Lifecycle state machine (TODO-3.D.6)
  // -----------------------------------------------------------------------

  describe('Lifecycle', () => {
    it('starts in Created state (isInWorld=false)', () => {
      const actor = createTestActor()
      expect(actor.isInWorld).toBe(false)
    })

    it('initialize with addToWorld=true transitions to InWorld', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      actor.initialize(true)
      expect(actor.isInWorld).toBe(true)
    })

    it('initialize with addToWorld=false stays NotInWorld', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      actor.initialize(false)
      expect(actor.isInWorld).toBe(false)
    })

    it('fires INotifyCreated during initialize', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestCreatedComponent()

      actor.addComponent(comp)
      expect(comp.createdCalls).toBe(0)

      actor.initialize(false)
      expect(comp.createdCalls).toBe(1)
    })

    it('throws if activity is queued before initialize', () => {
      const actor = createTestActor()
      const activity = new TestActivity()

      // queueActivity should throw before initialize
      expect(() => actor.queueActivity(activity as unknown as ActivityStub)).toThrow(
        /before the actor was created/,
      )
    })
  })

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  describe('Tick', () => {
    it('runs current activity tick', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const activity = new TestActivity()
      activity.tickResult = null // Activity completes

      actor.initialize(false)
      actor.queueActivity(activity as unknown as ActivityStub)
      actor.tick()

      expect(activity.tickCalls).toBe(1)
    })

    it('fires INotifyBecomingIdle when becoming idle', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestTickComponent()

      actor.addComponent(comp)
      actor.buildCachedTraitRefs()
      actor.initialize(false)

      // No activity → already idle, tick should fire tickIdle not onBecomingIdle
      actor.tick()
      expect(comp.onBecomingIdleCalls).toBe(0)
      expect(comp.tickIdleCalls).toBe(1)
    })

    it('fires INotifyIdle when staying idle', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestTickComponent()

      actor.addComponent(comp)
      actor.buildCachedTraitRefs()
      actor.initialize(false)

      // First tick: idle → tickIdle
      actor.tick()
      expect(comp.tickIdleCalls).toBe(1)

      // Second tick: still idle → tickIdle again
      actor.tick()
      expect(comp.tickIdleCalls).toBe(2)
    })

    it('fires INotifyBecomingIdle when activity completes', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestTickComponent()
      const activity = new TestActivity()
      activity.tickResult = null // Activity completes immediately

      actor.addComponent(comp)
      actor.buildCachedTraitRefs()
      actor.initialize(false)
      actor.queueActivity(activity as unknown as ActivityStub)

      // Tick: activity runs and completes → becoming idle
      actor.tick()
      expect(comp.onBecomingIdleCalls).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Activity queueing
  // -----------------------------------------------------------------------

  describe('Activity queueing', () => {
    it('queueActivity starts immediately if no current activity', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const activity = new TestActivity()

      actor.initialize(false)
      actor.queueActivity(activity as unknown as ActivityStub)

      // Should NOT be idle
      expect(actor.isIdle).toBe(false)
    })

    it('cancelActivity cancels current activity', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const activity = new TestActivity()

      actor.initialize(false)
      actor.queueActivity(activity as unknown as ActivityStub)
      actor.cancelActivity()

      expect(activity.cancelCalls).toBe(1)
      expect(actor.isIdle).toBe(true)
    })

    it('queueActivity with queued=false cancels existing activities first', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const oldActivity = new TestActivity()
      const newActivity = new TestActivity()

      actor.initialize(false)
      actor.queueActivity(oldActivity as unknown as ActivityStub)

      // Queue new activity with queued=false — should cancel old first
      actor.queueActivity(newActivity as unknown as ActivityStub, false)

      expect(oldActivity.cancelCalls).toBe(1)
      expect(actor.isIdle).toBe(false) // new activity is active
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('Dispose', () => {
    it('sets WillDispose flag', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      actor.initialize(false)

      actor.dispose()
      expect(actor.willDispose).toBe(true)
    })

    it('is idempotent', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      actor.initialize(false)

      actor.dispose()
      actor.dispose() // Second call should be a no-op
      expect(actor.willDispose).toBe(true)
    })

    it('fires INotifyActorDisposing via frame end task', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestDisposingComponent()

      actor.addComponent(comp)
      actor.initialize(false)
      actor.dispose()

      // Should not be called yet (deferred to frame end)
      expect(comp.disposingCalls).toBe(0)

      // Drain frame end tasks
      const w = world as unknown as { _drainFrameEndTasks?: () => void }
      w._drainFrameEndTasks?.()

      expect(comp.disposingCalls).toBe(1)
    })

    it('calls onActorDisposeOuter on current activity', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const activity = new TestActivity()
      activity.tickResult = null

      actor.initialize(false)
      actor.queueActivity(activity as unknown as ActivityStub)
      actor.dispose()

      expect(activity._disposeOuterCalled).toBe(true)
    })

    it('calls super.dispose with doNotRecurse=true', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      actor.initialize(false)
      actor.dispose()

      // Drain frame end tasks to trigger super.dispose
      const w = world as unknown as { _drainFrameEndTasks?: () => void }
      w._drainFrameEndTasks?.()

      // At least one dispose call should have doNotRecurse=true
      const cascadePreventionCall = mockDisposeCalls.find(c => c.doNotRecurse)
      expect(cascadePreventionCall).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // Owner changes (TODO-3.D.5)
  // -----------------------------------------------------------------------

  describe('Owner changes', () => {
    it('changeOwnerSync updates owner and increments generation', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      actor.owner = { playerName: 'OldOwner' }

      const newOwner: PlayerStub = { playerName: 'NewOwner' }
      actor.changeOwnerSync(newOwner)

      expect(actor.owner).toBe(newOwner)
      expect(actor.generation).toBe(1)
    })

    it('changeOwnerSync is no-op on disposed actor', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      actor.owner = { playerName: 'OldOwner' }
      ;(actor as { disposed: boolean }).disposed = true

      const newOwner: PlayerStub = { playerName: 'NewOwner' }
      actor.changeOwnerSync(newOwner)

      expect(actor.owner?.playerName).toBe('OldOwner')
    })

    it('fires INotifyOwnerChanged on actor traits', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      actor.owner = { playerName: 'OldOwner' }

      const comp = new TestOwnerChangedComponent()
      actor.addComponent(comp)

      const newOwner: PlayerStub = { playerName: 'NewOwner' }
      actor.changeOwnerSync(newOwner)

      expect(comp.lastOldOwner?.playerName).toBe('OldOwner')
      expect(comp.lastNewOwner?.playerName).toBe('NewOwner')
    })
  })

  // -----------------------------------------------------------------------
  // Trait query delegation (delegates to TraitDictionary)
  // -----------------------------------------------------------------------

  describe('Trait queries', () => {
    it('trait returns single matching trait', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestComponent()
      actor.addComponent(comp)

      const result = actor.trait<TestComponent>('ITestInterface')
      expect(result).toBe(comp)
    })

    it('trait throws if not found', () => {
      const actor = createTestActor()
      expect(() => actor.trait('NonExistent')).toThrow(/does not have trait/)
    })

    it('traitOrDefault returns undefined if not found', () => {
      const actor = createTestActor()
      expect(actor.traitOrDefault('NonExistent')).toBeUndefined()
    })

    it('traitsImplementing returns all matching', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      class MultiInterfaceComp extends Component {
        static readonly interfaces = ['IFoo', 'IBar', 'component']
      }
      const comp = new MultiInterfaceComp()
      actor.addComponent(comp)

      const results = actor.traitsImplementing<MultiInterfaceComp>('IFoo')
      expect(results).toHaveLength(1)
      expect(results[0]).toBe(comp)
    })

    it('hasTrait returns true when trait exists', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      const comp = new TestComponent()
      actor.addComponent(comp)

      expect(actor.hasTrait('ITestInterface')).toBe(true)
      expect(actor.hasTrait('NonExistent')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // buildCachedTraitRefs (TODO-3.D.5)
  // -----------------------------------------------------------------------

  describe('buildCachedTraitRefs', () => {
    it('caches IOccupySpace trait', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      class OccupySpaceComp extends Component implements IOccupySpace {
        static readonly interfaces = ['IOccupySpace', 'component']
        centerPosition = WPos.Zero
        topLeft = { Bits: 0, X: 0, Y: 0, Layer: 0 } as unknown as CPos
        occupiedCells() { return [] }
      }
      const comp = new OccupySpaceComp()
      actor.addComponent(comp)
      actor.buildCachedTraitRefs()

      expect(actor.occupiesSpace).toBe(comp)
    })

    it('caches ITargetable traits', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      const emptyBitSet = { contains: () => false, isEmpty: () => true }
      class TargetableComp extends Component implements ITargetable {
        static readonly interfaces = ['ITargetable', 'component']
        targetTypes = emptyBitSet
        requiresForceFire = false
        targetableBy() { return true }
      }
      const comp = new TargetableComp()
      actor.addComponent(comp)
      actor.buildCachedTraitRefs()

      expect(actor.targetables).toHaveLength(1)
      expect(actor.targetables[0]).toBe(comp)
    })

    it('caches IEffectiveOwner trait', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      class EffectiveOwnerComp extends Component implements IEffectiveOwner {
        static readonly interfaces = ['IEffectiveOwner', 'component']
        disguished = false
        owner = { playerName: 'Disguised' }
      }
      const comp = new EffectiveOwnerComp()
      actor.addComponent(comp)
      actor.buildCachedTraitRefs()

      expect(actor.effectiveOwner).toBe(comp)
    })

    it('Location returns IOccupySpace.topLeft', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      const mockCPos = { Bits: 0, X: 5, Y: 10, Layer: 0 }
      class OccupySpaceComp extends Component implements IOccupySpace {
        static readonly interfaces = ['IOccupySpace', 'component']
        centerPosition = WPos.Zero
        topLeft = mockCPos as unknown as CPos
        occupiedCells() { return [] }
      }
      const comp = new OccupySpaceComp()
      actor.addComponent(comp)
      actor.buildCachedTraitRefs()

      expect(actor.location).toBe(mockCPos as unknown as CPos)
    })

    it('CenterPosition returns IOccupySpace.centerPosition', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      const mockPos = new WPos(100, 200, 0)
      class OccupySpaceComp extends Component implements IOccupySpace {
        static readonly interfaces = ['IOccupySpace', 'component']
        centerPosition = mockPos
        topLeft = { Bits: 0, X: 0, Y: 0, Layer: 0 } as unknown as CPos
        occupiedCells() { return [] }
      }
      const comp = new OccupySpaceComp()
      actor.addComponent(comp)
      actor.buildCachedTraitRefs()

      expect(actor.centerPosition).toBe(mockPos)
    })

    it('Location returns undefined when no IOccupySpace', () => {
      const actor = createTestActor()
      expect(actor.location).toBeUndefined()
    })

    it('CenterPosition returns undefined when no IOccupySpace', () => {
      const actor = createTestActor()
      expect(actor.centerPosition).toBeUndefined()
    })

    it('caches ISync traits for SyncHash', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      class SyncComp extends Component {
        static readonly interfaces = ['ISync', 'component']
      }
      const comp = new SyncComp()
      actor.addComponent(comp)
      actor.buildCachedTraitRefs()

      // Sync hashes should be populated with zero-hash placeholders
      const hash = actor.computeSyncHash()
      expect(hash).toBe(0) // Placeholder — will use real hash in TODO-3.D.8
    })
  })

  // -----------------------------------------------------------------------
  // ResolveOrder (TODO-3.D.7)
  // -----------------------------------------------------------------------

  describe('ResolveOrder', () => {
    it('dispatches order to all IResolveOrder traits', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      // Two DIFFERENT component classes both implementing IResolveOrder.
      // (OpenRA allows multiple types implementing the same interface,
      // but not two instances of the same type.)
      class ResolveOrderCompA extends Component implements IResolveOrder {
        static readonly interfaces = ['IResolveOrder', 'component']
        lastOrder: unknown = null
        resolveOrder(_actor: IGameActor, order: unknown): void { this.lastOrder = order }
      }
      class ResolveOrderCompB extends Component implements IResolveOrder {
        static readonly interfaces = ['IResolveOrder', 'component']
        lastOrder: unknown = null
        resolveOrder(_actor: IGameActor, order: unknown): void { this.lastOrder = order }
      }

      const comp1 = new ResolveOrderCompA()
      const comp2 = new ResolveOrderCompB()
      actor.addComponent(comp1)
      actor.addComponent(comp2)
      actor.buildCachedTraitRefs()

      const order = { orderName: 'Attack', targetString: 'target1', extraData: null }
      actor.resolveOrder(order)

      expect(comp1.lastOrder).toBe(order)
      expect(comp2.lastOrder).toBe(order)
    })
  })

  // -----------------------------------------------------------------------
  // Damage helpers
  // -----------------------------------------------------------------------

  describe('Damage helpers', () => {
    it('getDamageState returns Dead when disposed', () => {
      const actor = createTestActor()
      ;(actor as { disposed: boolean }).disposed = true
      // Dead damage state is 32
      expect(actor.getDamageState()).toBe(32)
    })

    it('getDamageState returns Undamaged when no health trait', () => {
      const actor = createTestActor()
      // Undamaged is 1
      expect(actor.getDamageState()).toBe(1)
    })

    it('inflictDamage delegates to health trait', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      let damageInflicted = false
      class HealthComp extends Component implements IHealth {
        static readonly interfaces = ['IHealth', 'component']
        damageState = 1 as DamageState
        hp = 100
        maxHP = 100
        displayHP = 100
        isDead = false
        inflictDamage(
          _a: IGameActor,
          _attacker: IGameActor,
          _d: Damage,
          _ignore: boolean,
        ): void {
          damageInflicted = true
        }
        kill(
          _a: IGameActor,
          _attacker: IGameActor,
          _damageTypes: BitSetStub<unknown>,
        ): void {
          // no-op
        }
      }
      const healthComp = new HealthComp()
      actor.addComponent(healthComp)
      actor.buildCachedTraitRefs()

      actor.inflictDamage(
        { actorId: 42, isInWorld: true, isDead: false, disposed: false },
        { value: 10, damageTypes: { contains: () => false, isEmpty: () => true } },
      )
      expect(damageInflicted).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Visibility
  // -----------------------------------------------------------------------

  describe('Visibility', () => {
    it('canBeViewedByPlayer returns true by default', () => {
      const actor = createTestActor()
      const player: PlayerStub = { playerName: 'TestPlayer' }

      expect(actor.canBeViewedByPlayer(player)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // ToString
  // -----------------------------------------------------------------------

  describe('toString', () => {
    it('returns name and actorId', () => {
      const world = createMockWorld({ nextActorId: 42 })
      const actor = new GameActor({ world, name: 'tank' })

      const str = actor.toString()
      expect(str).toContain('tank')
      expect(str).toContain('42')
    })

    it('appends (not in world) when not in world', () => {
      const actor = createTestActor()

      const str = actor.toString()
      expect(str).toContain('(not in world)')
    })

    it('does not append (not in world) when in world', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)
      actor.initialize(true)

      const str = actor.toString()
      expect(str).not.toContain('(not in world)')
    })
  })

  // -----------------------------------------------------------------------
  // isDead
  // -----------------------------------------------------------------------

  describe('isDead', () => {
    it('is true when disposed', () => {
      const actor = createTestActor()
      ;(actor as { disposed: boolean }).disposed = true
      expect(actor.isDead).toBe(true)
    })

    it('is true when health trait reports dead', () => {
      const world = createMockWorld()
      const actor = createTestActor(world)

      class DeadHealthComp extends Component implements IHealth {
        static readonly interfaces = ['IHealth', 'component']
        damageState = 32 as DamageState
        hp = 0
        maxHP = 100
        displayHP = 0
        isDead = true
        inflictDamage(): void {}
        kill(): void {}
      }
      const comp = new DeadHealthComp()
      actor.addComponent(comp)
      actor.buildCachedTraitRefs()

      expect(actor.isDead).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // SyncHash placeholder
  // -----------------------------------------------------------------------

  describe('computeSyncHash', () => {
    it('returns 0 when no sync hash entries', () => {
      const actor = createTestActor()
      expect(actor.computeSyncHash()).toBe(0)
    })
  })
})
