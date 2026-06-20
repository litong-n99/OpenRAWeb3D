/**
 * TraitFactory.test.ts — TraitFactory unit tests
 *
 * Tests focus on: registration, query, trait creation, createAllTraits,
 * error handling (unknown traits), bulk registration, clear.
 */

import { describe, it, expect, vi } from 'vitest'
import { TraitFactory, type TraitConstructor } from './TraitFactory.js'
import { Component } from './TraitsInterfaces.js'
import type { IGameActor } from './TraitsInterfaces.js'
import type { TraitConfig } from '../GameRules/ActorInfo.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal test actor. */
function createTestActor(id: number = 1): IGameActor {
  return {
    actorId: id,
    isInWorld: false,
    isDead: false,
    disposed: false,
  }
}

/** Create a minimal TraitConfig for testing. */
function createTestConfig(
  name: string,
  overrides: Partial<TraitConfig> = {},
): TraitConfig {
  return {
    name,
    implements: [],
    dependsOn: [],
    notBefore: [],
    properties: {},
    ...overrides,
  }
}

/** A test Component subclass with static interfaces. */
class TestComponent extends Component {
  static readonly interfaces = ['ITest', 'component']

  created = false
  readonly config: TraitConfig

  constructor(_actor: IGameActor, config: TraitConfig) {
    super()
    this.config = config
  }
}

/** A trait constructor for TestComponent. */
const testTraitCtor: TraitConstructor = (actor, config) =>
  new TestComponent(actor, config)

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('TraitFactory registration', () => {
  it('starts empty', () => {
    const factory = new TraitFactory()
    expect(factory.count).toBe(0)
    expect(factory.registeredTraitNames()).toEqual([])
  })

  it('registers a single trait constructor', () => {
    const factory = new TraitFactory()
    factory.register('TestTrait', testTraitCtor)
    expect(factory.count).toBe(1)
    expect(factory.has('TestTrait')).toBe(true)
    expect(factory.registeredTraitNames()).toContain('TestTrait')
  })

  it('registers multiple traits', () => {
    const factory = new TraitFactory()
    factory.register('TraitA', testTraitCtor)
    factory.register('TraitB', testTraitCtor)
    expect(factory.count).toBe(2)
    expect(factory.has('TraitA')).toBe(true)
    expect(factory.has('TraitB')).toBe(true)
  })

  it('replacing an existing trait logs warning', () => {
    const factory = new TraitFactory()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    factory.register('TestTrait', testTraitCtor)
    factory.register('TestTrait', testTraitCtor) // Duplicate

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("trait 'TestTrait' is already registered"),
    )

    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

describe('TraitFactory query', () => {
  it('has returns false for unknown trait', () => {
    const factory = new TraitFactory()
    expect(factory.has('NonExistent')).toBe(false)
  })

  it('has returns true for registered trait', () => {
    const factory = new TraitFactory()
    factory.register('Health', testTraitCtor)
    expect(factory.has('Health')).toBe(true)
  })

  it('getConstructor returns undefined for unknown trait', () => {
    const factory = new TraitFactory()
    expect(factory.getConstructor('Unknown')).toBeUndefined()
  })

  it('getConstructor returns the constructor for registered trait', () => {
    const factory = new TraitFactory()
    factory.register('Mobile', testTraitCtor)
    expect(factory.getConstructor('Mobile')).toBe(testTraitCtor)
  })

  it('registeredTraitNames returns all names', () => {
    const factory = new TraitFactory()
    factory.register('A', testTraitCtor)
    factory.register('B', testTraitCtor)
    factory.register('C', testTraitCtor)
    const names = factory.registeredTraitNames()
    expect(names).toHaveLength(3)
    expect(names).toContain('A')
    expect(names).toContain('B')
    expect(names).toContain('C')
  })
})

// ---------------------------------------------------------------------------
// Trait creation
// ---------------------------------------------------------------------------

describe('TraitFactory.create', () => {
  it('creates a trait for a registered name', () => {
    const factory = new TraitFactory()
    factory.register('TestTrait', testTraitCtor)
    const actor = createTestActor()
    const config = createTestConfig('TestTrait')

    const component = factory.create(actor, config)

    expect(component).not.toBeNull()
    expect(component).toBeInstanceOf(TestComponent)
    expect((component as TestComponent).config).toBe(config)
  })

  it('returns null for unknown trait name', () => {
    const factory = new TraitFactory()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const component = factory.create(createTestActor(), createTestConfig('Unknown'))

    expect(component).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown trait 'Unknown'"),
    )

    warnSpy.mockRestore()
  })

  it('returns null and logs error when constructor throws', () => {
    const factory = new TraitFactory()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwingCtor: TraitConstructor = () => {
      throw new Error('Constructor failed')
    }
    factory.register('Fragile', throwingCtor)

    const component = factory.create(createTestActor(), createTestConfig('Fragile'))

    expect(component).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create trait'),
    )

    errorSpy.mockRestore()
  })

  it('passes actor and config to constructor', () => {
    const factory = new TraitFactory()
    let capturedActor: IGameActor | null = null
    let capturedConfig: TraitConfig | null = null

    const capturingCtor: TraitConstructor = (actor, config) => {
      capturedActor = actor
      capturedConfig = config
      return new TestComponent(actor, config)
    }
    factory.register('Capture', capturingCtor)

    const actor = createTestActor(42)
    const config = createTestConfig('Capture', { properties: { speed: 10 } })

    factory.create(actor, config)

    expect(capturedActor).toBe(actor)
    expect(capturedConfig).toBe(config)
  })
})

// ---------------------------------------------------------------------------
// createAllTraits
// ---------------------------------------------------------------------------

describe('TraitFactory.createAllTraits', () => {
  it('creates all traits from config array', () => {
    const factory = new TraitFactory()
    factory.register('TraitA', testTraitCtor)
    factory.register('TraitB', testTraitCtor)
    factory.register('TraitC', testTraitCtor)

    const actor = createTestActor()
    const configs = [
      createTestConfig('TraitA'),
      createTestConfig('TraitB'),
      createTestConfig('TraitC'),
    ]

    const components = factory.createAllTraits(actor, configs)

    expect(components).toHaveLength(3)
    for (const comp of components) {
      expect(comp).toBeInstanceOf(TestComponent)
    }
  })

  it('skips unknown traits (null from create)', () => {
    const factory = new TraitFactory()
    factory.register('Known', testTraitCtor)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const actor = createTestActor()
    const configs = [
      createTestConfig('Known'),
      createTestConfig('Unknown'),
      createTestConfig('Known'), // second known
    ]

    const components = factory.createAllTraits(actor, configs)

    expect(components).toHaveLength(2) // Only known traits returned
    expect(warnSpy).toHaveBeenCalledTimes(1) // One unknown warning

    warnSpy.mockRestore()
  })

  it('returns empty array for empty config', () => {
    const factory = new TraitFactory()
    const components = factory.createAllTraits(createTestActor(), [])
    expect(components).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// registerAll
// ---------------------------------------------------------------------------

describe('TraitFactory.registerAll', () => {
  it('registers multiple constructors at once', () => {
    const factory = new TraitFactory()
    factory.registerAll([
      ['A', testTraitCtor] as const,
      ['B', testTraitCtor] as const,
      ['C', testTraitCtor] as const,
    ])

    expect(factory.count).toBe(3)
    expect(factory.has('A')).toBe(true)
    expect(factory.has('B')).toBe(true)
    expect(factory.has('C')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('TraitFactory.clear', () => {
  it('removes all registered traits', () => {
    const factory = new TraitFactory()
    factory.register('A', testTraitCtor)
    factory.register('B', testTraitCtor)
    expect(factory.count).toBe(2)

    factory.clear()
    expect(factory.count).toBe(0)
    expect(factory.has('A')).toBe(false)
    expect(factory.has('B')).toBe(false)
  })

  it('clear on empty factory does not throw', () => {
    const factory = new TraitFactory()
    expect(() => factory.clear()).not.toThrow()
  })
})
