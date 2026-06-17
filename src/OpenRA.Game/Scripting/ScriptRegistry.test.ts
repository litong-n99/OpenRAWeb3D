/**
 * ScriptRegistry.test.ts — ScriptRegistry unit tests
 *
 * Tests focus on: registration, querying, trait filtering, cache invalidation,
 * duplicate detection, and test reset isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ScriptRegistry } from './ScriptRegistry'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGlobalCtor() {
  return class { name = 'Test'; constructor(_ctx: any) {} } as any
}

function makeActorPropCtor() {
  return class extends (class {}) { constructor(_ctx: any, _actor: any) { super() } } as any
}

function makePlayerPropCtor() {
  return class extends (class {}) { constructor(_ctx: any, _player: any) { super() } } as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptRegistry', () => {
  beforeEach(() => {
    ScriptRegistry._resetForTest()
  })

  // -----------------------------------------------------------------------
  // Global Registration
  // -----------------------------------------------------------------------

  describe('registerGlobal', () => {
    it('registers a new global', () => {
      const ctor = makeGlobalCtor()
      ScriptRegistry.registerGlobal('Actor', ctor, 'Actor API')
      const reg = ScriptRegistry.getGlobal('Actor')
      expect(reg).toBeDefined()
      expect(reg!.name).toBe('Actor')
      expect(reg!.description).toBe('Actor API')
    })

    it('throws on duplicate global name', () => {
      const ctor = makeGlobalCtor()
      ScriptRegistry.registerGlobal('Actor', ctor)
      expect(() => ScriptRegistry.registerGlobal('Actor', ctor))
        .toThrow(/Duplicate global registration/)
    })

    it('lists all globals sorted by name', () => {
      ScriptRegistry.registerGlobal('Actor', makeGlobalCtor())
      ScriptRegistry.registerGlobal('Trigger', makeGlobalCtor())
      ScriptRegistry.registerGlobal('Media', makeGlobalCtor())
      const globals = ScriptRegistry.getGlobals()
      expect(globals).toHaveLength(3)
      expect(globals[0].name).toBe('Actor')
      expect(globals[1].name).toBe('Media')
      expect(globals[2].name).toBe('Trigger')
    })

    it('returns undefined for missing global', () => {
      expect(ScriptRegistry.getGlobal('Nonexistent')).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // Actor Property Registration
  // -----------------------------------------------------------------------

  describe('registerActorProperty', () => {
    it('registers an actor property', () => {
      const registration = {
        category: 'Health',
        ctor: makeActorPropCtor(),
        requiredTraits: ['IHealthInfo'],
        exposedForDestroyedActors: false,
        description: 'Health API',
      }
      ScriptRegistry.registerActorProperty(registration)
      const props = ScriptRegistry.getActorProperties()
      expect(props).toHaveLength(1)
      expect(props[0].category).toBe('Health')
    })

    it('lists actor properties sorted by category', () => {
      ScriptRegistry.registerActorProperty({
        category: 'Combat',
        ctor: makeActorPropCtor(),
        requiredTraits: [],
        exposedForDestroyedActors: false,
      })
      ScriptRegistry.registerActorProperty({
        category: 'Build',
        ctor: makeActorPropCtor(),
        requiredTraits: [],
        exposedForDestroyedActors: false,
      })
      const props = ScriptRegistry.getActorProperties()
      expect(props).toHaveLength(2)
      expect(props[0].category).toBe('Build')
      expect(props[1].category).toBe('Combat')
    })

    it('filters actor commands by trait availability', () => {
      ScriptRegistry.registerActorProperty({
        category: 'Health',
        ctor: makeActorPropCtor(),
        requiredTraits: ['IHealthInfo'],
        exposedForDestroyedActors: false,
      })
      ScriptRegistry.registerActorProperty({
        category: 'General',
        ctor: makeActorPropCtor(),
        requiredTraits: [],
        exposedForDestroyedActors: true,
      })

      const info = { name: 'e1' }
      const hasTrait = (trait: string) => trait === 'IHealthInfo'

      const commands = ScriptRegistry.getActorCommands(info, hasTrait)
      expect(commands).toHaveLength(2) // General (no req) + Health (has IHealthInfo)
    })

    it('excludes actor commands when required traits are missing', () => {
      ScriptRegistry.registerActorProperty({
        category: 'Production',
        ctor: makeActorPropCtor(),
        requiredTraits: ['IProductionInfo'],
        exposedForDestroyedActors: false,
      })

      const info = { name: 'e1' }
      const hasTrait = () => false

      const commands = ScriptRegistry.getActorCommands(info, hasTrait)
      expect(commands).toHaveLength(0)
    })

    it('caches actor command results per ActorInfo', () => {
      ScriptRegistry.registerActorProperty({
        category: 'General',
        ctor: makeActorPropCtor(),
        requiredTraits: [],
        exposedForDestroyedActors: true,
      })

      const info = { name: 'e1' }
      const hasTrait = () => true

      const result1 = ScriptRegistry.getActorCommands(info, hasTrait)
      const result2 = ScriptRegistry.getActorCommands(info, hasTrait)
      // Same reference means cache hit
      expect(result1).toBe(result2)
    })
  })

  // -----------------------------------------------------------------------
  // Player Property Registration
  // -----------------------------------------------------------------------

  describe('registerPlayerProperty', () => {
    it('registers a player property', () => {
      ScriptRegistry.registerPlayerProperty({
        category: 'Player',
        ctor: makePlayerPropCtor(),
        requiredTraits: [],
        description: 'Player API',
      })
      const props = ScriptRegistry.getPlayerProperties()
      expect(props).toHaveLength(1)
      expect(props[0].category).toBe('Player')
    })

    it('filters player commands by trait availability', () => {
      ScriptRegistry.registerPlayerProperty({
        category: 'Player',
        ctor: makePlayerPropCtor(),
        requiredTraits: ['IPlayerResourcesInfo'],
      })
      ScriptRegistry.registerPlayerProperty({
        category: 'Mission',
        ctor: makePlayerPropCtor(),
        requiredTraits: [],
      })

      const info = { name: 'Player' }
      const hasTrait = (trait: string) => trait === 'IPlayerResourcesInfo'

      const commands = ScriptRegistry.getPlayerCommands(info, hasTrait)
      expect(commands).toHaveLength(2) // Player (has trait) + Mission (no req)
    })
  })

  // -----------------------------------------------------------------------
  // ActorInit Registration
  // -----------------------------------------------------------------------

  describe('registerActorInit', () => {
    it('registers an actor init factory', () => {
      ScriptRegistry.registerActorInit({
        name: 'Location',
        parameters: new Map([['value', 'CPos']]),
        factory: (values) => ({ initName: 'Location', value: values.get('value') }),
      })
      const init = ScriptRegistry.getActorInit('Location')
      expect(init).toBeDefined()
      expect(init!.name).toBe('Location')
    })

    it('throws on duplicate init name', () => {
      const reg = {
        name: 'Location',
        parameters: new Map(),
        factory: () => ({ initName: 'Location', value: null }),
      }
      ScriptRegistry.registerActorInit(reg)
      expect(() => ScriptRegistry.registerActorInit(reg))
        .toThrow(/Duplicate ActorInit/)
    })

    it('returns undefined for missing init', () => {
      expect(ScriptRegistry.getActorInit('Nonexistent')).toBeUndefined()
    })

    it('returns all registered inits', () => {
      ScriptRegistry.registerActorInit({
        name: 'Location',
        parameters: new Map(),
        factory: () => ({ initName: 'Location', value: null }),
      })
      ScriptRegistry.registerActorInit({
        name: 'Facing',
        parameters: new Map(),
        factory: () => ({ initName: 'Facing', value: null }),
      })
      expect(ScriptRegistry.getActorInits()).toHaveLength(2)
    })
  })

  // -----------------------------------------------------------------------
  // Validate
  // -----------------------------------------------------------------------

  describe('validate', () => {
    it('does not throw on empty registry (allows minimal environments)', () => {
      expect(() => ScriptRegistry.validate()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Test Reset
  // -----------------------------------------------------------------------

  describe('_resetForTest', () => {
    it('clears all registrations', () => {
      ScriptRegistry.registerGlobal('Actor', makeGlobalCtor())
      ScriptRegistry.registerActorProperty({
        category: 'General',
        ctor: makeActorPropCtor(),
        requiredTraits: [],
        exposedForDestroyedActors: true,
      })
      ScriptRegistry.registerPlayerProperty({
        category: 'Player',
        ctor: makePlayerPropCtor(),
        requiredTraits: [],
      })
      ScriptRegistry.registerActorInit({
        name: 'Test',
        parameters: new Map(),
        factory: () => ({ initName: 'Test', value: null }),
      })

      ScriptRegistry._resetForTest()

      expect(ScriptRegistry.getGlobals()).toHaveLength(0)
      expect(ScriptRegistry.getActorProperties()).toHaveLength(0)
      expect(ScriptRegistry.getPlayerProperties()).toHaveLength(0)
      expect(ScriptRegistry.getActorInits()).toHaveLength(0)
    })

    it('clears actor commands cache', () => {
      ScriptRegistry.registerActorProperty({
        category: 'General',
        ctor: makeActorPropCtor(),
        requiredTraits: [],
        exposedForDestroyedActors: true,
      })
      const info = { name: 'e1' }
      const result1 = ScriptRegistry.getActorCommands(info, () => true)

      ScriptRegistry._resetForTest()

      // Re-register so we can test
      ScriptRegistry.registerActorProperty({
        category: 'General',
        ctor: makeActorPropCtor(),
        requiredTraits: [],
        exposedForDestroyedActors: true,
      })
      const result2 = ScriptRegistry.getActorCommands(info, () => true)
      // Should be different reference (cache cleared)
      expect(result1).not.toBe(result2)
    })
  })
})
