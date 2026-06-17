/**
 * ScriptContext.test.ts — ScriptContext unit tests
 *
 * Tests focus on: constructor validation, globals instantiation, fatal error
 * handling, map actor registration, lifecycle (worldLoaded, tick), dispose.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptContext } from './ScriptContext'
import { ScriptRegistry } from './ScriptRegistry'
import type { IScriptContext, MemberDescriptor } from './ScriptMemberDescriptor'
import type { WorldStub, WorldRendererStub, IGameActor, ActorInfoStub } from '../Traits/TraitsInterfaces'
import { ScriptGlobal } from './ScriptObjectWrapper'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWorld(): WorldStub {
  return { actors: [] }
}

function createWorldRenderer(): WorldRendererStub {
  return {}
}

function createActor(infoName: string = 'test-actor'): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name: infoName },
    traitsImplementing: () => [],
  }
}

// ---------------------------------------------------------------------------
// Test helper class — replaces inline esbuild-unsafe expression
// ---------------------------------------------------------------------------

class _TestActorPropClass {
  constructor(_ctx: any, _a: any) { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptContext', () => {
  beforeEach(() => {
    ScriptRegistry._resetForTest()
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates with empty scripts', () => {
      const world = createWorld()
      const wr = createWorldRenderer()
      const ctx = new ScriptContext(world, wr, [])
      expect(ctx.world).toBe(world)
      expect(ctx.worldRenderer).toBe(wr)
      expect(ctx.fatalErrorOccurred).toBe(false)
      expect(ctx.errorMessage).toBeNull()
      expect(ctx.disposed).toBe(false)
    })

    it('instantiates registered globals', () => {
      class TestGlobal extends ScriptGlobal {
        constructor(ctx: IScriptContext) {
          super(ctx, 'Test', [])
        }
        protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
          return []
        }
      }

      ScriptRegistry.registerGlobal('Test', TestGlobal, 'Test global')

      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const globals = ctx.globals
      expect(globals.has('Test')).toBe(true)
      expect(globals.get('Test')!.name).toBe('Test')
    })

    it('queues JSON trigger scripts', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), ['mission.json'])
      expect(ctx.pendingTriggers).toHaveLength(1)
      expect(ctx.pendingTriggers[0].source).toBe('mission.json')
    })

    it('reserves global names for map actor registration', () => {
      ScriptRegistry.registerGlobal('Actor', class extends ScriptGlobal {
        name = 'Actor'
        constructor(ctx: IScriptContext) { super(ctx, 'Actor', []) }
        protected override getMemberDescriptors(_obj: object): MemberDescriptor[] { return [] }
      }, 'Actor API')

      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      // Trying to register a map actor named 'Actor' should fail (reserved global name)
      const actor = createActor()
      expect(() => ctx.registerMapActor('Actor', actor)).toThrow(/reserved/)
    })

    it('reserves internal names (Tick, WorldLoaded, etc.)', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const actor = createActor()
      expect(() => ctx.registerMapActor('Tick', actor)).toThrow(/reserved/)
      expect(() => ctx.registerMapActor('WorldLoaded', actor)).toThrow(/reserved/)
      expect(() => ctx.registerMapActor('FatalError', actor)).toThrow(/reserved/)
      expect(() => ctx.registerMapActor('print', actor)).toThrow(/reserved/)
    })
  })

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('worldLoaded does not throw when no handler set', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      expect(() => ctx.worldLoaded()).not.toThrow()
    })

    it('worldLoaded calls registered handler', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setWorldLoadedHandler(handler)
      ctx.worldLoaded()
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('worldLoaded early-exits on fatal error', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setWorldLoadedHandler(handler)
      ctx.fatalErrorOccurred = true
      ctx.worldLoaded()
      expect(handler).not.toHaveBeenCalled()
    })

    it('worldLoaded early-exits when disposed', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setWorldLoadedHandler(handler)
      ctx.dispose()
      ctx.worldLoaded()
      expect(handler).not.toHaveBeenCalled()
    })

    it('tick does not throw when no handler set', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      expect(() => ctx.tick()).not.toThrow()
    })

    it('tick calls registered handler', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setTickHandler(handler)
      ctx.tick()
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('tick early-exits on fatal error', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setTickHandler(handler)
      ctx.fatalErrorOccurred = true
      ctx.tick()
      expect(handler).not.toHaveBeenCalled()
    })

    it('tick early-exits when disposed', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setTickHandler(handler)
      ctx.dispose()
      ctx.tick()
      expect(handler).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // Fatal Error
  // -----------------------------------------------------------------------

  describe('fatalError', () => {
    it('sets fatalErrorOccurred and errorMessage from Error', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setFatalErrorHandler(handler)

      ctx.fatalError(new Error('test error'))

      expect(ctx.fatalErrorOccurred).toBe(true)
      expect(ctx.errorMessage).toBe('test error')
      expect(handler).toHaveBeenCalled()
    })

    it('sets fatalErrorOccurred and errorMessage from string', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const handler = vi.fn()
      ctx.setFatalErrorHandler(handler)

      ctx.fatalError('test message')

      expect(ctx.fatalErrorOccurred).toBe(true)
      expect(ctx.errorMessage).toBe('test message')
      expect(handler).toHaveBeenCalled()
    })

    it('does not throw when no handler is set', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      expect(() => ctx.fatalError('error')).not.toThrow()
      expect(ctx.fatalErrorOccurred).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Map Actor Registration
  // -----------------------------------------------------------------------

  describe('registerMapActor', () => {
    it('registers a named actor', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const actor = createActor('myunit')
      ctx.registerMapActor('myunit', actor)
      expect(ctx.namedActors.has('myunit')).toBe(true)
      expect(ctx.namedActors.get('myunit')).toBe(actor)
    })

    it('rejects reserved names', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const actor = createActor()
      expect(() => ctx.registerMapActor('EngineDir', actor)).toThrow(/reserved/)
    })
  })

  // -----------------------------------------------------------------------
  // Command Queries
  // -----------------------------------------------------------------------

  describe('getActorCommands', () => {
    it('returns registered properties', () => {
      ScriptRegistry.registerActorProperty({
        category: 'Test',
        ctor: _TestActorPropClass,
        requiredTraits: [],
        exposedForDestroyedActors: false,
      })

      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const info: ActorInfoStub = { name: 'e1' }
      const commands = ctx.getActorCommands(info)
      expect(commands).toHaveLength(1)
      expect(commands[0].category).toBe('Test')
    })
  })

  // -----------------------------------------------------------------------
  // Global Table Access
  // -----------------------------------------------------------------------

  describe('globals', () => {
    it('getGlobal returns undefined for missing global', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      expect(ctx.getGlobal('Nonexistent')).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('clears all state', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const actor = createActor()
      ctx.registerMapActor('myactor', actor)

      ctx.dispose()

      expect(ctx.disposed).toBe(true)
      expect(ctx.namedActors.size).toBe(0)
      expect(ctx.globals.size).toBe(0)
    })

    it('dispose is idempotent', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      ctx.dispose()
      expect(() => ctx.dispose()).not.toThrow()
      expect(ctx.disposed).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Debug Logging
  // -----------------------------------------------------------------------

  describe('logDebug', () => {
    it('logs to console', () => {
      const ctx = new ScriptContext(createWorld(), createWorldRenderer(), [])
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      ctx.logDebug('test message')
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('test message'))
      spy.mockRestore()
    })
  })
})
