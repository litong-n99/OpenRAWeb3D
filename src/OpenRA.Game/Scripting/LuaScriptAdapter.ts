/**
 * LuaScriptAdapter.ts — fengari Lua 5.3 VM adapter for OpenRA-style sandboxed scripting
 * OpenRA 对照: ScriptContext.cs (Lua runtime creation portion, lines 119-210)
 *
 * 核心范式转换:
 * - C# Eluant / MemoryConstrainedLuaRuntime (Lua 5.2 / C#-to-Lua binding)
 *   → fengari Lua 5.3 (pure JS) + fengari-interop (JS↔Lua bridge)
 * - C# runtime.Globals Lua table + reflection-based member binding
 *   → lua_createtable + __index/__newindex metatables bridging ScriptGlobal instances
 * - C# sandbox via setfenv/runtime.Globals manipulation
 *   → lua_setglobal(L, name, nil) to remove dangerous globals after luaL_openlibs
 *
 * Dynamic import strategy:
 * - This module is loaded dynamically by ScriptContext via await import().
 * - fengari (~200KB) is NOT bundled unless .lua scripts are detected.
 * - Internal fengari imports use dynamic import() within createLuaRuntime().
 */

import type { ScriptGlobal } from './ScriptObjectWrapper.js'
import type { ScriptActorInterface } from './ScriptActorInterface.js'

// ---------------------------------------------------------------------------
// ILuaRuntime — public API for a sandboxed Lua runtime
// ---------------------------------------------------------------------------

/** Opaque handle to a fengari Lua state. */
export type LuaStateHandle = object

/** Interface for a sandboxed fengari Lua 5.3 runtime. */
export interface ILuaRuntime {
  readonly L: LuaStateHandle
  doBuffer(content: string, chunkName: string): void
  callFunction(name: string, ...args: unknown[]): unknown
  hasFunction(name: string): boolean
  registerGlobal(global: ScriptGlobal): void
  registerMapActor(name: string, actorInterface: ScriptActorInterface): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// LuaScriptAdapterOptions
// ---------------------------------------------------------------------------

export interface LuaScriptAdapterOptions {
  engineDir?: string
  maxMemory?: number
  maxInstructions?: number
  fatalErrorHandler?: (message: string) => void
}

// ---------------------------------------------------------------------------
// createLuaRuntimeSync — synchronous factory using pre-loaded modules
// ---------------------------------------------------------------------------

/**
 * Create a sandboxed Lua runtime using pre-loaded fengari and fengari-interop
 * modules. This is the synchronous variant used in tests and environments where
 * fengari is already statically imported.
 *
 * @param options — sandbox configuration
 * @param fengari — pre-loaded fengari module
 * @param interop — pre-loaded fengari-interop module (with luaopen_js)
 */
export function createLuaRuntimeSync(
  options: LuaScriptAdapterOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fengari: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interop: any,
): ILuaRuntime {
  const engineDir = options.engineDir ?? '/assets'
  const maxMemory = options.maxMemory ?? 50 * 1024 * 1024
  const maxInstructions = options.maxInstructions ?? 1_000_000

  // Create Lua state
  const L: object = fengari.lauxlib.luaL_newstate()

  // Open standard libraries
  fengari.lualib.luaL_openlibs(L)

  // Open JS interop library (required for push/tojs)
  interop.luaopen_js(L)
  fengari.lua.lua_pop(L, 1)

  // Apply sandbox
  _applySandbox(L, fengari)

  // Register builtin globals
  _registerBuiltinGlobals(L, fengari, interop, engineDir, maxInstructions, options.fatalErrorHandler)

  return _buildRuntime(L, fengari, interop, maxMemory, { value: false })
}

// ---------------------------------------------------------------------------
// createLuaRuntime — async factory (dynamic import for production)
// ---------------------------------------------------------------------------

export async function createLuaRuntime(
  options: LuaScriptAdapterOptions = {},
): Promise<ILuaRuntime> {
  // Dynamic import of fengari and fengari-interop (avoid static bundling)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fengari: any = await import('fengari')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const interop: any = await import('fengari-interop')

  return createLuaRuntimeSync(options, fengari, interop)
}

// ---------------------------------------------------------------------------
// _buildRuntime — shared runtime object factory
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _buildRuntime(L: object, fengari: any, interop: any, maxMemory: number, _disposed: { value: boolean }): ILuaRuntime {
  return {
    L,

    doBuffer(content: string, chunkName: string): void {
      if (_disposed.value) throw new Error('Lua runtime is disposed')

      const bytes = new TextEncoder().encode(content)
      const loadStatus = fengari.lauxlib.luaL_loadbuffer(L, bytes, bytes.length, chunkName || '=(lua)')
      if (loadStatus !== 0 /* LUA_OK */) {
        const err = interop.tojs(L, -1)
        fengari.lua.lua_pop(L, 1)
        throw new Error(`Lua compile error in '${chunkName}': ${String(err)}`)
      }

      const pcStatus = fengari.lua.lua_pcall(L, 0, 0, 0)
      if (pcStatus !== 0 /* LUA_OK */) {
        const err = interop.tojs(L, -1)
        fengari.lua.lua_pop(L, 1)
        throw new Error(`Lua runtime error in '${chunkName}': ${String(err)}`)
      }
    },

    callFunction(name: string, ...args: unknown[]): unknown {
      if (_disposed.value) throw new Error('Lua runtime is disposed')

      // Handle dotted names like "Alpha.a" — navigate into nested tables
      const parts = name.split('.')
      if (parts.length > 1) {
        fengari.lua.lua_getglobal(L, parts[0])
        if (fengari.lua.lua_type(L, -1) === 0 /* LUA_TNIL */) {
          fengari.lua.lua_pop(L, 1)
          throw new Error(`Lua global '${parts[0]}' not found`)
        }
        for (let i = 1; i < parts.length - 1; i++) {
          fengari.lua.lua_getfield(L, -1, parts[i])
          fengari.lua.lua_remove(L, -2)
        }
        fengari.lua.lua_getfield(L, -1, parts[parts.length - 1])
        fengari.lua.lua_remove(L, -2) // remove the parent table
      } else {
        fengari.lua.lua_getglobal(L, name)
      }
      const tp = fengari.lua.lua_type(L, -1)
      if (tp === 0 /* LUA_TNIL */) {
        fengari.lua.lua_pop(L, 1)
        throw new Error(`Lua function '${name}' not found`)
      }
      if (tp !== 6 /* LUA_TFUNCTION */) {
        fengari.lua.lua_pop(L, 1)
        throw new Error(`Global '${name}' is not a function (type: ${tp})`)
      }

      for (const arg of args) {
        interop.push(L, arg)
      }

      const pcStatus = fengari.lua.lua_pcall(L, args.length, 1, 0)
      if (pcStatus !== 0 /* LUA_OK */) {
        const err = interop.tojs(L, -1)
        fengari.lua.lua_pop(L, 1)
        throw new Error(`Lua error calling '${name}': ${String(err)}`)
      }

      const result = fengari.lua.lua_gettop(L) > 0 ? interop.tojs(L, -1) : undefined
      if (fengari.lua.lua_gettop(L) > 0) {
        fengari.lua.lua_pop(L, 1)
      }

      _checkMemory(L, fengari, maxMemory)
      return result
    },

    hasFunction(name: string): boolean {
      if (_disposed.value) return false

      fengari.lua.lua_getglobal(L, name)
      const isFn = fengari.lua.lua_type(L, -1) === 6 /* LUA_TFUNCTION */
      fengari.lua.lua_pop(L, 1)
      return isFn
    },

    registerGlobal(global: ScriptGlobal): void {
      if (_disposed.value) throw new Error('Lua runtime is disposed')
      _registerGlobalAsLuaTable(L, fengari, interop, global)
    },

    registerMapActor(name: string, actorInterface: ScriptActorInterface): void {
      if (_disposed.value) throw new Error('Lua runtime is disposed')
      _registerGlobalAsLuaTable(L, fengari, interop, actorInterface, name)
    },

    dispose(): void {
      if (_disposed.value) return
      _disposed.value = true
      fengari.lua.lua_close(L)
    },
  }
}

// ---------------------------------------------------------------------------
// Internal — Sandbox
// ---------------------------------------------------------------------------

const ALLOWED_GLOBALS = new Set([
  'ipairs', 'next', 'pairs',
  'pcall', 'select', 'tonumber', 'tostring', 'type', 'unpack', 'xpcall',
  'math', 'string', 'table',
  '_G', '_VERSION',
  'FatalError', 'print', 'EngineDir', 'MaxUserScriptInstructions',
])

const FORBIDDEN_GLOBALS = [
  'os', 'io', 'package', 'require',
  'dofile', 'dostring', 'loadfile', 'load',
  'module', 'debug', 'coroutine', 'collectgarbage',
  'rawget', 'rawset', 'rawequal', 'rawlen',
  'setmetatable', 'getmetatable',
]

function _applySandbox(L: object, fengari: any): void {
  const nilGlobal = (name: string) => {
    fengari.lua.lua_pushnil(L)
    fengari.lua.lua_setglobal(L, name)
  }

  for (const forbidden of FORBIDDEN_GLOBALS) {
    nilGlobal(forbidden)
  }

  const openlibsGlobals = [
    'assert', 'error', 'getmetatable', 'ipairs', 'load', 'next', 'pairs',
    'pcall', 'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select',
    'setmetatable', 'tonumber', 'tostring', 'type', 'xpcall',
    'coroutine', 'require', 'module', 'string', 'utf8', 'table',
    'math', 'io', 'os', 'debug', '_PROMPT', '_PROMPT2', '_VERSION', 'warn',
  ]

  for (const name of openlibsGlobals) {
    if (!ALLOWED_GLOBALS.has(name)) {
      nilGlobal(name)
    }
  }

  fengari.lua.lua_getglobal(L, 'math')
  if (fengari.lua.lua_type(L, -1) === 5 /* LUA_TTABLE */) {
    for (const m of ['random', 'randomseed']) {
      fengari.lua.lua_pushnil(L)
      fengari.lua.lua_setfield(L, -2, m)
    }
  }
  fengari.lua.lua_pop(L, 1)
}

// ---------------------------------------------------------------------------
// Internal — Builtin Globals
// ---------------------------------------------------------------------------

function _registerBuiltinGlobals(
  L: object,
  fengari: any,
  interop: any,
  engineDir: string,
  maxInstructions: number,
  fatalErrorHandler: ((message: string) => void) | undefined,
): void {
  fengari.lua.lua_pushcfunction(L, (fnL: object) => {
    const msg = fengari.lua.lua_tojsstring(fnL, 1) ?? 'unknown error'
    if (fatalErrorHandler) {
      fatalErrorHandler(msg)
    } else {
      throw new Error(`Lua FatalError: ${msg}`)
    }
    return 0
  })
  fengari.lua.lua_setglobal(L, 'FatalError')

  fengari.lua.lua_pushcfunction(L, (fnL: object) => {
    const msg = fengari.lua.lua_tojsstring(fnL, 1) ?? ''
    console.log(`Lua debug: ${msg}`)
    return 0
  })
  fengari.lua.lua_setglobal(L, 'print')

  interop.push(L, engineDir)
  fengari.lua.lua_setglobal(L, 'EngineDir')

  interop.push(L, maxInstructions)
  fengari.lua.lua_setglobal(L, 'MaxUserScriptInstructions')
}

// ---------------------------------------------------------------------------
// Internal — Global Registration as Lua Table
// ---------------------------------------------------------------------------

function _registerGlobalAsLuaTable(
  L: object,
  fengari: any,
  interop: any,
  wrapper: { get(key: string): unknown; set(key: string, value: unknown): void; containsKey(key: string): boolean },
  nameOverride?: string,
): void {
  const globalName = nameOverride ?? (wrapper as any).name as string
  if (!globalName) throw new Error('Cannot register wrapper without a name')

  fengari.lua.lua_createtable(L, 0, 0)
  fengari.lua.lua_createtable(L, 0, 2)

  fengari.lua.lua_pushcfunction(L, (fnL: object) => {
    const key = fengari.lua.lua_tojsstring(fnL, 2) ?? ''
    if (!wrapper.containsKey(key)) {
      fengari.lua.lua_pushnil(fnL)
      return 1
    }
    try {
      const value = wrapper.get(key)
      if (typeof value === 'function') {
        // Use lua_pushcfunction to create a proper Lua-callable function (type LUA_TFUNCTION)
        fengari.lua.lua_pushcfunction(fnL, (callL: object) => {
          const nargs = fengari.lua.lua_gettop(callL)
          const args: unknown[] = []
          for (let i = 1; i <= nargs; i++) {
            args.push(interop.tojs(callL, i))
          }
          try {
            const result = (value as (...a: unknown[]) => unknown)(...args) ?? null
            interop.push(callL, result)
            return 1
          } catch (e) {
            const errMsg = (e instanceof Error) ? e.message : String(e)
            fengari.lua.lua_pushstring(callL, errMsg)
            fengari.lua.lua_error(callL)
            return 0
          }
        })
      } else {
        // Use lua_pushnil for null/undefined; interop.push for everything else
        if (value === null || value === undefined) {
          fengari.lua.lua_pushnil(fnL)
        } else {
          interop.push(fnL, value)
        }
      }
    } catch (e) {
      const errMsg = (e instanceof Error) ? e.message : String(e)
      fengari.lua.lua_pushstring(fnL, errMsg)
      fengari.lua.lua_error(fnL)
      return 0
    }
    return 1
  })
  fengari.lua.lua_setfield(L, -2, '__index')

  fengari.lua.lua_pushcfunction(L, (fnL: object) => {
    const key = fengari.lua.lua_tojsstring(fnL, 2) ?? ''
    const val = interop.tojs(fnL, 3)
    try {
      wrapper.set(key, val)
    } catch (e) {
      const errMsg = (e instanceof Error) ? e.message : String(e)
      fengari.lua.lua_pushstring(fnL, errMsg)
      fengari.lua.lua_error(fnL)
      return 0
    }
    return 0
  })
  fengari.lua.lua_setfield(L, -2, '__newindex')

  fengari.lua.lua_setmetatable(L, -2)
  fengari.lua.lua_setglobal(L, globalName)
}

// ---------------------------------------------------------------------------
// Internal — Memory Check
// ---------------------------------------------------------------------------

function _checkMemory(L: object, fengari: any, maxMemory: number): void {
  // TODO-20.G.INSTR: Add instruction counting via lua_sethook
  const used = fengari.lua.lua_gc(L, 0, 0) * 1024 + fengari.lua.lua_gc(L, 1, 0)
  if (used > maxMemory) {
    throw new Error(`Lua script memory limit exceeded (${used} > ${maxMemory} bytes)`)
  }
}
