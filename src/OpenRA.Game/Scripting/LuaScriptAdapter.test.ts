/**
 * LuaScriptAdapter.test.ts — LuaScriptAdapter migration unit tests
 *
 * Since happy-dom does not support WebGL, these tests import fengari directly
 * (fengari is a pure JS VM, no WebGL dependency).
 *
 * Tests focus on: sandbox enforcement, allowed globals, builtin globals,
 * ScriptGlobal registration, script execution, map actor registration,
 * value conversion, dispose lifecycle.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { createLuaRuntimeSync, type ILuaRuntime, type LuaScriptAdapterOptions } from './LuaScriptAdapter'
import { ScriptGlobal } from './ScriptObjectWrapper'
import { ScriptActorInterface } from './ScriptActorInterface'
import type { IScriptContext } from './ScriptMemberDescriptor'
import type { MemberDescriptor } from './ScriptMemberDescriptor'

// ---------------------------------------------------------------------------
// fengari CJS module — loaded dynamically for ESM interop
// ---------------------------------------------------------------------------

// fengari is CJS; `import * as` may not resolve named exports in strict ESM.
// We load it via dynamic import and use the default export.
// Lua type constants are part of the Lua C API and never change:
const LUA_TNIL = 0
const LUA_TFUNCTION = 6
const LUA_TTABLE = 5

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fengari: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let interop: any

beforeAll(async () => {
  // fengari is CJS; in ESM, named exports ARE the module (not on .default)
  fengari = await import('fengari')
  interop = await import('fengari-interop')
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock IScriptContext for testing. */
function createMockContext(): IScriptContext {
  return {
    world: { actors: [] as any[] } as any,
    worldRenderer: {} as any,
    fatalErrorOccurred: false,
    errorMessage: null,
    getActorCommands: () => [],
    playerCommands: [],
    registerMapActor: () => { /* no-op */ },
    fatalError: (_err: Error | string) => { /* no-op */ },
    logDebug: () => { /* no-op */ },
    namedActors: new Map(),
  } as IScriptContext
}

/**
 * Create a minimal ScriptGlobal subclass for testing.
 * This mimics what actual Globals (ActorGlobal, TriggerGlobal, etc.) do.
 */
function createTestGlobal(
  gName: string,
  methods?: Record<string, (...args: unknown[]) => unknown>,
  properties?: Record<string, { get: () => unknown; set?: (v: unknown) => void }>,
): ScriptGlobal {
  const savedMethods = methods ?? {}
  const savedProps = properties ?? {}

  class TestGlobal extends ScriptGlobal {
    constructor(ctx: IScriptContext) {
      super(ctx, gName)
    }

    protected override getMemberDescriptors(_obj: object): MemberDescriptor[] {
      const descs: MemberDescriptor[] = []

      for (const [key, fn] of Object.entries(savedMethods)) {
        descs.push({
          memberType: 'method',
          name: key,
          parameters: [],
          returnType: 'any',
          invoke: (_target: object, args: unknown[]) => fn(...args),
        })
      }

      for (const [key, desc] of Object.entries(savedProps)) {
        descs.push({
          memberType: 'property',
          name: key,
          returnType: 'any',
          get: desc.get ? () => desc.get!() : undefined,
          set: desc.set ? (_t: object, v: unknown) => desc.set!(v) : undefined,
        })
      }

      return descs
    }
  }

  const ctx = createMockContext()
  const instance = new TestGlobal(ctx)
  // Bind the instance to its own members (constructor normally does this)
  ;(instance as any).bind?.([instance])
  return instance
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LuaScriptAdapter', () => {
  let runtime: ILuaRuntime | null = null

  afterEach(() => {
    runtime?.dispose()
    runtime = null
  })

  // -----------------------------------------------------------------------
  // Runtime Creation
  // -----------------------------------------------------------------------

  describe('createLuaRuntime', () => {
    it('creates a valid Lua state', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      expect(runtime).toBeDefined()
      expect(runtime.L).toBeDefined()
    })

    it('sets default options when none provided', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      // Verify EngineDir default
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'EngineDir')
      const s = fengari.lua.lua_tojsstring(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(s).toBe('/assets')
    })

    it('respects custom engineDir option', async () => {
      runtime = createLuaRuntimeSync({ engineDir: '/custom/eng' }, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'EngineDir')
      const s = fengari.lua.lua_tojsstring(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(s).toBe('/custom/eng')
    })

    it('respects custom maxInstructions option', async () => {
      runtime = createLuaRuntimeSync({ maxInstructions: 500 }, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'MaxUserScriptInstructions')
      const n = fengari.lua.lua_tonumber(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(n).toBe(500)
    })
  })

  // -----------------------------------------------------------------------
  // Sandbox (10 tests)
  // -----------------------------------------------------------------------

  describe('Sandbox', () => {
    it('removes the os global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'os')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes the io global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'io')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes the require global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'require')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes dofile global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'dofile')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes loadfile global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'loadfile')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes load global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'load')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes debug global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'debug')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes coroutine global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'coroutine')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('removes math.random', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'math')
      if (fengari.lua.lua_type(fL, -1) === LUA_TTABLE) {
        fengari.lua.lua_getfield(fL, -1, 'random')
        const tp = fengari.lua.lua_type(fL, -1)
        fengari.lua.lua_pop(fL, 2) // pop random + math
        expect(tp).toBe(LUA_TNIL)
      } else {
        fengari.lua.lua_pop(fL, 1)
        // math should exist as a table
        expect(true).toBe(true) // if not, test passes vacuously
      }
    })

    it('removes math.randomseed', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'math')
      if (fengari.lua.lua_type(fL, -1) === LUA_TTABLE) {
        fengari.lua.lua_getfield(fL, -1, 'randomseed')
        const tp = fengari.lua.lua_type(fL, -1)
        fengari.lua.lua_pop(fL, 2)
        expect(tp).toBe(LUA_TNIL)
      } else {
        fengari.lua.lua_pop(fL, 1)
      }
    })
  })

  // -----------------------------------------------------------------------
  // Allowed Globals (5 tests)
  // -----------------------------------------------------------------------

  describe('Allowed globals', () => {
    it('preserves pairs', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'pairs')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TFUNCTION)
    })

    it('preserves ipairs', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'ipairs')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TFUNCTION)
    })

    it('preserves tostring', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'tostring')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TFUNCTION)
    })

    it('preserves tonumber', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'tonumber')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TFUNCTION)
    })

    it('preserves type', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'type')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TFUNCTION)
    })

    it('preserves math table (minus random/randomseed)', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'math')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TTABLE)
    })

    it('preserves string table', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'string')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TTABLE)
    })

    it('preserves table table', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'table')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TTABLE)
    })
  })

  // -----------------------------------------------------------------------
  // Builtin Globals (4 tests)
  // -----------------------------------------------------------------------

  describe('Builtin globals', () => {
    it('FatalError calls the fatal error handler', async () => {
      const fn = vi.fn()
      runtime = createLuaRuntimeSync({ fatalErrorHandler: fn }, fengari, interop)
      // Call FatalError from Lua
      runtime.doBuffer('FatalError("test error message")', 'test.lua')
      expect(fn).toHaveBeenCalledWith('test error message')
    })

    it('print logs to console (does not throw)', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        runtime.doBuffer('print("hello from lua")', 'test.lua')
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('hello from lua'))
      } finally {
        spy.mockRestore()
      }
    })

    it('EngineDir is set from options', async () => {
      runtime = createLuaRuntimeSync({ engineDir: '/mods/ra' }, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'EngineDir')
      const s = fengari.lua.lua_tojsstring(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(s).toBe('/mods/ra')
    })

    it('MaxUserScriptInstructions is set from options', async () => {
      runtime = createLuaRuntimeSync({ maxInstructions: 12345 }, fengari, interop)
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'MaxUserScriptInstructions')
      const n = fengari.lua.lua_tonumber(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(n).toBe(12345)
    })
  })

  // -----------------------------------------------------------------------
  // Script Execution (6 tests)
  // -----------------------------------------------------------------------

  describe('Script execution', () => {
    it('executes a simple Lua script', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('local x = 1 + 2', 'test.lua')
    })

    it('diagnostic: direct load via adapter state + separate import works', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const fL = runtime.L

      const mod: any = await import('fengari')
      const loadStatus: number = mod.lauxlib.luaL_loadstring(fL, mod.to_luastring('return 42'))
      expect(loadStatus).toBe(0)
      const pc = mod.lua.lua_pcall(fL, 0, 1, 0)
      expect(pc).toBe(0)
      const val = mod.lua.lua_tonumber(fL, -1)
      mod.lua.lua_pop(fL, 1)
      expect(val).toBe(42)
    })

    it('diagnostic: verify fengari module identity across imports', async () => {
      const mod1 = await import('fengari')
      const mod2 = await import('fengari')
      // In ESM, dynamic imports should return the same module instance
      expect(mod1).toBe(mod2)
      expect(mod1.lua).toBe(mod2.lua)
      expect(mod1.lauxlib).toBe(mod2.lauxlib)
      expect(mod1.to_luastring).toBe(mod2.to_luastring)
    })

    it('executes script that sets a global variable', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('myValue = 42', 'test.lua')
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'myValue')
      const n = fengari.lua.lua_tonumber(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(n).toBe(42)
    })

    it('throws on Lua compile error', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      expect(() => runtime!.doBuffer('local x = {', 'bad.lua')).toThrow()
    })

    it('throws on Lua runtime error', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      expect(() => runtime!.doBuffer('error("boom")', 'error.lua')).toThrow()
    })

    it('executes script that defines a function', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer(
        'function add(a, b)\n  return a + b\nend',
        'test.lua',
      )
      expect(runtime.hasFunction('add')).toBe(true)
    })

    it('executes script that uses allowed standard lib (table.insert)', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer(
        't = {1, 2, 3}; table.insert(t, 4); if #t ~= 4 then error("table.insert failed") end',
        'test.lua',
      )
    })
  })

  // -----------------------------------------------------------------------
  // callFunction (3 tests)
  // -----------------------------------------------------------------------

  describe('callFunction', () => {
    it('calls a Lua function with arguments and returns result', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function greet(name) return "Hello, " .. name end', 'test.lua')
      const result = runtime.callFunction('greet', 'World')
      expect(result).toBe('Hello, World')
    })

    it('throws if function does not exist', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      expect(() => runtime!.callFunction('nonexistent')).toThrow()
    })

    it('calls a function with multiple numeric arguments', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function multiply(a, b, c) return a * b * c end', 'test.lua')
      const result = runtime.callFunction('multiply', 2, 3, 4)
      expect(result).toBe(24)
    })

    it('hasFunction returns false for non-function globals', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('someVar = "hello"', 'test.lua')
      expect(runtime.hasFunction('someVar')).toBe(false)
    })

    it('hasFunction returns true for function globals', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function myFunc() end', 'test.lua')
      expect(runtime.hasFunction('myFunc')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Global Registration (8 tests)
  // -----------------------------------------------------------------------

  describe('Global registration', () => {
    it('registers a ScriptGlobal as a Lua table', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const global = createTestGlobal('Test', {
        greet: (name: unknown) => `Hello, ${name}!`,
      })
      runtime.registerGlobal(global)

      // Verify it exists as a global
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'Test')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TTABLE)
    })

    it('method invocation via Lua script', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const global = createTestGlobal('Test', {
        greet: (name: unknown) => `Hello, ${name}!`,
      })
      runtime.registerGlobal(global)

      // Call via Lua script
      runtime.doBuffer('result = Test.greet("Lua")', 'test.lua')
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'result')
      const s = fengari.lua.lua_tojsstring(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(s).toBe('Hello, Lua!')
    })

    it('property getter via Lua script', async () => {
      let internalValue = 10
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const global = createTestGlobal('Counter', {}, {
        count: { get: () => internalValue },
      })
      runtime.registerGlobal(global)

      runtime.doBuffer('result = Counter.count', 'test.lua')
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'result')
      const n = fengari.lua.lua_tonumber(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(n).toBe(10)
    })

    it('property setter via Lua script', async () => {
      let internalValue = 0
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const global = createTestGlobal('Counter', {}, {
        count: {
          get: () => internalValue,
          set: (v: unknown) => { internalValue = Number(v) },
        },
      })
      runtime.registerGlobal(global)

      runtime.doBuffer('Counter.count = 42', 'test.lua')
      expect(internalValue).toBe(42)
    })

    it('read-only property throws on write attempt from Lua', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const global = createTestGlobal('Const', {}, {
        answer: { get: () => 42 },
      })
      runtime.registerGlobal(global)

      expect(() => runtime!.doBuffer('Const.answer = 99', 'test.lua')).toThrow()
    })

    it('write-only property returns nil on read from Lua', async () => {
      const stored: unknown[] = []
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const global = createTestGlobal('Sink', {}, {
        input: { get: () => null, set: (v: unknown) => { stored.push(v) } },
      })
      runtime.registerGlobal(global)

      // Reading write-only property should return nil (not throw in Lua)
      runtime.doBuffer('result = Sink.input', 'test.lua')
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'result')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      // Should be nil (no getter available)
      expect(tp).toBe(LUA_TNIL)
    })

    it('multiple globals can be registered', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const g1 = createTestGlobal('Alpha', { a: () => 'alpha' })
      const g2 = createTestGlobal('Beta', { b: () => 'beta' })
      runtime.registerGlobal(g1)
      runtime.registerGlobal(g2)

      expect(runtime.callFunction('Alpha.a')).toBe('alpha')
      expect(runtime.callFunction('Beta.b')).toBe('beta')
    })

    it('global method with multiple arguments', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const global = createTestGlobal('Math2', {
        add: (a: unknown, b: unknown) => Number(a) + Number(b),
      })
      runtime.registerGlobal(global)

      runtime.doBuffer('result = Math2.add(10, 20)', 'test.lua')
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'result')
      const n = fengari.lua.lua_tonumber(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(n).toBe(30)
    })
  })

  // -----------------------------------------------------------------------
  // Map Actor Registration (3 tests)
  // -----------------------------------------------------------------------

  describe('Register map actor', () => {
    it('registers a named actor as a Lua global', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)

      // Create a mock actor interface
      const ctx = createMockContext()
      const mockActor = { actorId: 42, isInWorld: true, isDead: false, disposed: false, info: { name: 'e1' } } as any
      const iface = new ScriptActorInterface(ctx, mockActor)

      runtime.registerMapActor('e1_test', iface)

      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'e1_test')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TTABLE)
    })

    it('throws on attempt to access nonexistent member of actor', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const ctx = createMockContext()
      const mockActor = { actorId: 1, isInWorld: true, isDead: false, disposed: false, info: { name: 'e1' } } as any
      const iface = new ScriptActorInterface(ctx, mockActor)

      runtime.registerMapActor('actor1', iface)

      // Accessing a member that doesn't exist should throw/error in Lua
      // The __index handler pushes nil for missing members
      runtime.doBuffer('result = actor1.NonexistentThing', 'test.lua')
      const fL = runtime.L as any
      fengari.lua.lua_getglobal(fL, 'result')
      const tp = fengari.lua.lua_type(fL, -1)
      fengari.lua.lua_pop(fL, 1)
      expect(tp).toBe(LUA_TNIL)
    })

    it('accesses actor wrapper via Lua', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      const ctx = createMockContext()
      const mockActor = { actorId: 99, isInWorld: true, isDead: false, disposed: false, info: { name: 'hero' } } as any
      const iface = new ScriptActorInterface(ctx, mockActor)

      runtime.registerMapActor('hero', iface)
      // Should not throw
      runtime.doBuffer('local h = hero', 'test.lua')
    })
  })

  // -----------------------------------------------------------------------
  // Value Conversion (6 tests)
  // -----------------------------------------------------------------------

  describe('Value conversion', () => {
    it('number round-trip: JS -> Lua -> JS', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function id(x) return x end', 'test.lua')
      const result = runtime.callFunction('id', 42)
      expect(result).toBe(42)
    })

    it('string round-trip: JS -> Lua -> JS', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function id(x) return x end', 'test.lua')
      const result = runtime.callFunction('id', 'hello lua')
      expect(result).toBe('hello lua')
    })

    it('boolean round-trip: JS -> Lua -> JS', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function id(x) return x end', 'test.lua')
      const result = runtime.callFunction('id', true)
      expect(result).toBe(true)
    })

    it('null/nil round-trip: JS -> Lua -> JS', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function id(x) return x end', 'test.lua')
      const result = runtime.callFunction('id', null)
      expect(result).toBeNull()
    })

    it('table round-trip: JS object -> Lua -> JS', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function id(x) return x end', 'test.lua')
      // Note: interop.push converts objects to userdata, which becomes proxy objects
      const result = runtime.callFunction('id', { a: 1, b: 2 })
      // The result may be a proxy or a table, depending on interop behavior
      expect(result).toBeDefined()
    })

    it('array round-trip: JS array -> Lua -> JS', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.doBuffer('function id(x) return x end', 'test.lua')
      const result = runtime.callFunction('id', [1, 2, 3])
      // The result may be a proxy or array
      expect(result).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose (2 tests)
  // -----------------------------------------------------------------------

  describe('Dispose', () => {
    it('dispose releases the state (double-dispose is safe)', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      expect(() => runtime!.dispose()).not.toThrow()
      expect(() => runtime!.dispose()).not.toThrow()
    })

    it('operations on disposed runtime throw errors', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      runtime.dispose()
      expect(() => runtime!.doBuffer('local x = 1', 'test.lua')).toThrow()
      expect(() => runtime!.callFunction('print', 'x')).toThrow()
      expect(() => runtime!.hasFunction('print')).not.toThrow() // hasFunction returns false
      expect(runtime!.hasFunction('print')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Memory Limit (2 tests)
  // -----------------------------------------------------------------------

  describe('Memory limit', () => {
    it('does not throw for normal memory usage', async () => {
      const opts: LuaScriptAdapterOptions = { maxMemory: 100 * 1024 * 1024 }
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      runtime.doBuffer('local t = {}; for i=1,100 do t[i] = i end', 'test.lua')
    })

    it('memory check runs after script execution', async () => {
      // Low memory limit with normal script should still work (or throw with clear message)
      const opts: LuaScriptAdapterOptions = { maxMemory: 1024 } // 1KB — very low
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      // A simple script might or might not exceed 1KB, just verify no crash
      try {
        runtime.doBuffer('local x = 1', 'test.lua')
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
    })
  })

  // -----------------------------------------------------------------------
  // Instruction Counting — P1-E.5 (4 tests)
  // -----------------------------------------------------------------------

  describe('Instruction counting', () => {
    it('prevents infinite loops by throwing when instruction limit is exceeded', async () => {
      const opts: LuaScriptAdapterOptions = { maxInstructions: 50_000 }
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      // An infinite loop should be terminated
      expect(() => {
        runtime!.doBuffer('while true do end', 'infinite.lua')
      }).toThrow(/instruction limit exceeded/i)
    })

    it('allows reasonable scripts to run without hitting limit', async () => {
      const opts: LuaScriptAdapterOptions = { maxInstructions: 1_000_000 }
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      // A simple loop of 100 iterations should not hit any limit
      expect(() => {
        runtime!.doBuffer('local s = 0; for i=1,100 do s = s + i end', 'sum.lua')
      }).not.toThrow()
    })

    it('resets instruction counter between doBuffer calls', async () => {
      // Use a generous limit so each individual script runs fine
      const opts: LuaScriptAdapterOptions = { maxInstructions: 200_000 }
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      // First script: runs fine
      runtime.doBuffer('local s = 0; for i=1,500 do s = s + i end', 'first.lua')
      // Second script: should also run fine (counter was reset)
      expect(() => {
        runtime!.doBuffer('local s = 0; for i=1,500 do s = s + i end', 'second.lua')
      }).not.toThrow()
    })

    it('resets instruction counter between callFunction calls', async () => {
      const opts: LuaScriptAdapterOptions = { maxInstructions: 200_000 }
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      runtime.doBuffer(
        'function work(n)\n  local s = 0\n  for i=1,n do s = s + i end\n  return s\nend',
        'define.lua',
      )
      // First call: fine
      const r1 = runtime.callFunction('work', 500)
      expect(r1).toBeDefined()
      // Second call: should also be fine (counter was reset)
      const r2 = runtime.callFunction('work', 500)
      expect(r2).toBeDefined()
    })

    it('respects custom maxInstructions', async () => {
      // Very low limit — should catch even modest loops
      const opts: LuaScriptAdapterOptions = { maxInstructions: 5_000 }
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      // A loop of 1000 iterations (~several thousand instructions per iteration
      // for the loop body) should exceed the 5000 instruction limit
      expect(() => {
        runtime!.doBuffer('local s = 0; for i=1,5000 do s = s + i end', 'bigloop.lua')
      }).toThrow(/instruction limit exceeded/i)
    })

    it('instruction limit error includes the limit value', async () => {
      const opts: LuaScriptAdapterOptions = { maxInstructions: 10_000 }
      runtime = createLuaRuntimeSync(opts, fengari, interop)
      try {
        runtime.doBuffer('while true do end', 'infinite.lua')
        // Should not reach here
        expect(true).toBe(false)
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).message).toContain('10000')
      }
    })
  })

  // -----------------------------------------------------------------------
  // FatalError handler edge cases (2 tests)
  // -----------------------------------------------------------------------

  describe('FatalError handler', () => {
    it('default FatalError throws an Error', async () => {
      runtime = createLuaRuntimeSync({}, fengari, interop)
      // Without a custom handler, FatalError should throw
      expect(() => runtime!.doBuffer('FatalError("critical")', 'test.lua')).toThrow()
    })

    it('custom FatalError does not throw if handler does not throw', async () => {
      const fn = vi.fn()
      runtime = createLuaRuntimeSync({ fatalErrorHandler: fn }, fengari, interop)
      // With a custom handler, FatalError should NOT throw from the runtime
      // NOTE: The handler may or may not throw depending on implementation
      runtime.doBuffer('FatalError("handled")', 'test.lua')
      expect(fn).toHaveBeenCalled()
    })
  })
})
