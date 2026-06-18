# Chapter 20 Phase G Design Specification: fengari Lua VM Integration

> **Status**: DESIGN COMPLETE
> **Date**: 2026-06-18
> **Source Plan**: `docs/chapter20_scripting_system_migration_plan.md` Section 3.7
> **Predecessor Phases**: A-F COMPLETE (63/63, 100%)
> **OpenRA Source Reference**: `OpenRA/OpenRA.Game/Scripting/ScriptContext.cs`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Design: LuaScriptAdapter.ts](#2-module-design-luascriptadapterts)
3. [Sandbox Configuration](#3-sandbox-configuration)
4. [TypeScript-to-Lua Bridge](#4-typescript-to-lua-bridge)
5. [ScriptContext.ts Modifications](#5-scriptcontextts-modifications)
6. [Type Conversion (LuaValue <-> TS)](#6-type-conversion-luavalue---ts)
7. [Error Handling Strategy](#7-error-handling-strategy)
8. [Memory and Instruction Limits](#8-memory-and-instruction-limits)
9. [Unit Test Strategy](#9-unit-test-strategy)
10. [Acceptance Test Strategy](#10-acceptance-test-strategy)
11. [Migration Work Requirement Documents](#11-migration-work-requirement-documents)

---

## 1. Architecture Overview

### 1.1 The Two-Tier Architecture (Recap)

```
ScriptContext constructor
  │
  ├── Tier 1 (Phases A-F, always active): JSON trigger dispatch
  │     └── ScriptRegistry, 63 registered classes
  │
  └── Tier 2 (Phase G, optional): fengari Lua 5.3 VM
        │
        ├── detect .lua files in map scripts
        ├── dynamic import('fengari') — only if .lua files present
        ├── create Lua state (luaL_newstate())
        ├── open base libs (luaL_openlibs())
        ├── REMOVE dangerous globals (os, io, require, etc.)
        ├── REMOVE math.random, math.randomseed
        ├── register TypeScript globals as Lua tables
        ├── register named map actors as Lua globals
        ├── load and execute .lua files
        └── wire WorldLoaded() and Tick() callbacks
```

### 1.2 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Dynamic import** | `fengari` adds ~200KB to bundle. Only loaded when map has `.lua` files. Uses `import('fengari')`. |
| **fengari-interop** | Provides JS↔Lua value conversion (`push`/`tojs`). Avoids manual stack manipulation. |
| **Exactly match OpenRA sandbox** | Same allowed globals, same removed globals, same `math.random`/`math.randomseed` removal. Ensures existing `.lua` mission scripts run unchanged. |
| **Lua tables for Globals** | Each ScriptGlobal instance is exposed as a Lua table with `__index`/`__newindex` metatable for property get/set and direct function entries for methods. |
| **Reuse ScriptRegistry** | The same 63 registered classes serve both Tier 1 (JSON) and Tier 2 (Lua). No code duplication. |
| **Separate adapter module** | `LuaScriptAdapter.ts` is a standalone module with zero non-fengari dependencies. `ScriptContext.ts` gains a small hook (`_initLuaVM()`) that delegates to the adapter. |
| **Lua errors become FatalErrors** | Same as OpenRA: any Lua runtime error triggers `context.FatalError()`, ending the game. |

### 1.3 Module Structure

```
src/OpenRA.Game/Scripting/
  LuaScriptAdapter.ts          ← NEW: fengari wrapper (~400 lines)
  ScriptContext.ts             ← MODIFIED: add _initLuaVM() hook (~50 new lines)
  ScriptTypes.ts               ← MODIFIED: add TypeScript<->Lua value conversion (~30 new lines)
  LuaScriptAdapter.test.ts     ← NEW: unit tests (~40 test cases)
```

### 1.4 fengari API Reference (key functions used)

| Function | Source | Purpose |
|----------|--------|---------|
| `lauxlib.luaL_newstate()` | fengari | Create a new Lua state |
| `lualib.luaL_openlibs(L)` | fengari | Open all standard Lua libraries |
| `lua.luaL_requiref(L, name, openf, glb)` | fengari | Load a library into the state |
| `lua.lua_pushcfunction(L, fn)` | fengari | Push a JS function onto the Lua stack |
| `lua.lua_pushjsfunction(L, fn)` | fengari | Alias for `lua_pushcfunction` |
| `lua.lua_setglobal(L, name)` | fengari | Pop a value from the stack and set it as a global |
| `lua.lua_getglobal(L, name)` | fengari | Push the value of a global onto the stack |
| `lua.lua_pushnil(L)` | fengari | Push nil onto the stack (used to remove globals) |
| `lua.lua_load(L, reader, chunkname, mode)` | fengari | Load a Lua chunk without executing it |
| `lua.lua_pcall(L, nargs, nresults, errfunc)` | fengari | Call a function in protected mode |
| `lua.lua_createtable(L, narr, nrec)` | fengari | Create a new empty table and push it |
| `lua.lua_setfield(L, idx, k)` | fengari | Set table field (equivalent to `t[k]=v`) |
| `lua.lua_getfield(L, idx, k)` | fengari | Get table field |
| `lua.lua_pushstring(L, s)` | fengari | Push a string |
| `lua.lua_pushnumber(L, n)` | fengari | Push a number |
| `lua.lua_pushboolean(L, b)` | fengari | Push a boolean |
| `lua.lua_gettop(L)` | fengari | Get the number of elements on the stack |
| `lua.lua_settop(L, idx)` | fengari | Set the stack top |
| `lua.lua_pop(L, n)` | fengari | Pop n elements from the stack |
| `lua.lua_type(L, idx)` | fengari | Get the type of a stack value |
| `lua.lua_tonumber(L, idx)` | fengari | Convert a stack value to number |
| `lua.lua_toboolean(L, idx)` | fengari | Convert a stack value to boolean |
| `lua.lua_tojsstring(L, idx)` | fengari | Convert a Lua string to JS string |
| `lua.lua_isnil(L, idx)` | fengari | Check if value at index is nil |
| `lua.LUA_TNIL` / `LUA_TNUMBER` / `LUA_TBOOLEAN` / etc. | fengari | Type constants |
| `lua.LUA_MULTRET` | fengari | Flag for pcall to return all results |
| `lua.LUA_OK` | fengari | Return status for successful pcall |
| `interop.push(L, jsVal)` | fengari-interop | Push a JS value onto the Lua stack (auto-converts) |
| `interop.tojs(L, idx)` | fengari-interop | Convert a Lua stack value to a JS value |
| `interop.luaopen_js(L)` | fengari-interop | Open the JS interop library (required for push/tojs) |

### 1.5 Dependencies

**Runtime (dynamic import only)**:
- `fengari` v0.1.5 — Pure JS Lua 5.3 VM, MIT license
- `fengari-interop` v0.1.4 — JS↔Lua interop bridge, MIT license

**Already available from Phases A-F**:
- `ScriptContext` — orchestrator (modified with Lua VM hook)
- `ScriptRegistry` — central API registration
- `ScriptTypes` — type conversion utilities (extended for Lua)
- `ScriptObjectWrapper` / `ScriptGlobal` — abstract base classes
- `ScriptActorInterface` / `ScriptPlayerInterface` — script-wrapped actor/player
- All 63 registered Global/Properties classes

---

## 2. Module Design: LuaScriptAdapter.ts

### 2.1 File Location

```
src/OpenRA.Game/Scripting/LuaScriptAdapter.ts
```

### 2.2 Module Exports

```typescript
export interface ILuaRuntime {
  /** The fengari Lua state handle. */
  readonly L: LuaState

  /** Load and execute a Lua script string. */
  doBuffer(content: string, chunkName: string): void

  /** Call a named Lua global function with JS arguments. */
  callFunction(name: string, ...args: unknown[]): unknown

  /** Check if a named Lua global function exists. */
  hasFunction(name: string): boolean

  /** Register a TypeScript ScriptGlobal as a Lua table. */
  registerGlobal(global: ScriptGlobal): void

  /** Register a named map actor as a Lua global (via ScriptActorInterface). */
  registerMapActor(name: string, actorInterface: unknown): void

  /** Dispose the Lua state and release all resources. */
  dispose(): void
}

export interface LuaScriptAdapterOptions {
  /** Engine directory path (maps to OpenRA's EngineDir global). */
  engineDir?: string

  /** Maximum memory use for user scripts in bytes (default 50MB). */
  maxMemory?: number

  /** Maximum instructions per script call (default 1,000,000). */
  maxInstructions?: number

  /** Custom FatalError handler (called when Lua code triggers FatalError()). */
  fatalErrorHandler?: (message: string) => void
}

export function createLuaRuntime(options?: LuaScriptAdapterOptions): ILuaRuntime
```

### 2.3 Internal Implementation Outline

```
createLuaRuntime(options):
  1. L = luaL_newstate()                    // Create Lua state
  2. luaL_openlibs(L)                        // Open standard libraries
  3. _applySandbox(L, options)               // Remove dangerous globals
  4. _registerBuiltinGlobals(L, options)     // Add FatalError, print, EngineDir, etc.
  5. Return ILuaRuntime instance

_applySandbox(L, options):
  // Step 1: Remove ALL globals except the allowed list
  allowed = ["ipairs","next","pairs","pcall","select","tonumber","tostring","type","unpack","xpcall","math","string","table"]
  for each global in _getAllGlobals(L):
    if not in allowed:
      lua_pushnil(L)
      lua_setglobal(L, globalName)

  // Step 2: Remove math.random and math.randomseed
  lua_getglobal(L, "math")
  lua_pushnil(L); lua_setfield(L, -2, "random")
  lua_pushnil(L); lua_setfield(L, -2, "randomseed")
  lua_pop(L, 1)

  // Step 3: Remove debug library entirely
  lua_pushnil(L); lua_setglobal(L, "debug")

  // Step 4: Remove io, os, package, require, dofile, dostring, load, loadfile
  for each dangerous in ["io","os","package","require","dofile","dostring","loadfile","module"]:
    lua_pushnil(L); lua_setglobal(L, dangerous)

  // Step 5: Remove coroutine (OpenRA doesn't allow it)
  lua_pushnil(L); lua_setglobal(L, "coroutine")

  // Step 6: Remove loadstring (Lua 5.3 equivalent of dostring)
  lua_pushnil(L); lua_setglobal(L, "load")

  // Step 7: Remove raw memory functions (collectgarbage)
  lua_pushnil(L); lua_setglobal(L, "collectgarbage")

_registerBuiltinGlobals(L, options):
  // FatalError function
  lua_pushcfunction(L, (L) => {
    let msg = lua_tojsstring(L, 1) ?? "unknown error"
    options.fatalErrorHandler?.(msg)
    return 0
  })
  lua_setglobal(L, "FatalError")

  // print function
  lua_pushcfunction(L, (L) => {
    let msg = lua_tojsstring(L, 1) ?? ""
    console.log(`Lua debug: ${msg}`)
    return 0
  })
  lua_setglobal(L, "print")

  // EngineDir
  lua_pushstring(L, options.engineDir ?? "")
  lua_setglobal(L, "EngineDir")

  // MaxUserScriptInstructions
  lua_pushnumber(L, options.maxInstructions ?? 1000000)
  lua_setglobal(L, "MaxUserScriptInstructions")

registerGlobal(L, global):
  // Create a Lua table with __index and __newindex metatables
  lua_createtable(L, 0, 0)               // The table itself

  // Create metatable
  lua_createtable(L, 0, 2)               // metatable

  // __index: resolve property/method access
  lua_pushcfunction(L, _makeIndexHandler(global))
  lua_setfield(L, -2, "__index")

  // __newindex: resolve property writes
  lua_pushcfunction(L, _makeNewindexHandler(global))
  lua_setfield(L, -2, "__newindex")

  lua_setmetatable(L, -2)

  // Set as global
  lua_setglobal(L, global.name)

doBuffer(L, content, chunkName):
  // Use lua_load with a string reader + lua_pcall
  // Error → throw Error with Lua error message

callFunction(L, name, ...args):
  // lua_getglobal(L, name)
  // push args via interop.push()
  // lua_pcall(L, args.length, 1, 0)
  // return interop.tojs(L, -1)
  // lua_pop(L, 1)

dispose(L):
  // lua_close(L) — fengari releases all memory
```

### 2.4 Dynamic Import Strategy

`ScriptContext` uses dynamic `import()` to avoid bundling fengari unless needed:

```typescript
// In ScriptContext constructor:
private async _initLuaVM(scripts: string[]): Promise<void> {
  const luaScripts = scripts.filter(s => s.endsWith('.lua'))
  if (luaScripts.length === 0) return

  try {
    const { createLuaRuntime } = await import('./LuaScriptAdapter.js')
    this._luaRuntime = createLuaRuntime({
      engineDir: '/assets',
      maxMemory: 50 * 1024 * 1024,
      maxInstructions: 1000000,
      fatalErrorHandler: (msg) => this.fatalError(msg),
    })

    // Register all ScriptGlobals as Lua tables
    for (const [name, global] of this._globals) {
      this._luaRuntime.registerGlobal(global)
    }

    // Load and execute .lua scripts
    for (const script of luaScripts) {
      const content = this._loadScriptContent(script) // from FileSystem
      this._luaRuntime.doBuffer(content, script)
    }

    // Wire WorldLoaded and Tick
    const hasWorldLoaded = this._luaRuntime.hasFunction('WorldLoaded')
    const hasTick = this._luaRuntime.hasFunction('Tick')

    if (hasWorldLoaded) {
      this.setWorldLoadedHandler(() => this._luaRuntime!.callFunction('WorldLoaded'))
    }
    if (hasTick) {
      this.setTickHandler(() => this._luaRuntime!.callFunction('Tick'))
    }
  } catch (e) {
    this.fatalError(e instanceof Error ? e : new Error(String(e)))
  }
}
```

**Important caveat**: `ScriptContext` constructor is currently synchronous. The fengari dynamic import is async. Options:

1. **A. Make `_initLuaVM` async, call from `ScriptComponent`** after construction (Phase B already has `IWorldLoaded`).
2. **B. Accept blocker**: Constructor stays sync (no Lua init), ScriptComponent calls `context.initLuaVMAsync()` from its `worldLoaded` handler.
3. **C. Top-level await**: Use `await import()` in a top-level async function that wraps construction.

**Recommended: Option B**. ScriptComponent (which implements `IWorldLoaded`) calls `context.initLuaVM()` as an async step during world loading. This mirrors OpenRA's pattern where Lua scripts are loaded during world setup, not in the constructor.

To support this, ScriptContext gains a public method:

```typescript
/** Initialize the optional Lua VM. Must be called during world loading if .lua scripts exist. */
async initLuaVM(fileSystem: IReadOnlyPackage): Promise<void>
```

---

## 3. Sandbox Configuration

### 3.1 Exact Match to OpenRA

OpenRA's sandbox is implemented in `ScriptContext.cs` lines 162-183. We replicate it exactly.

**Allowed globals** (everything else set to nil):
```
ipairs, next, pairs, pcall, select, tonumber, tostring, type, unpack, xpcall, math, string, table
```

**Explicitly removed from math**:
```
random, randomseed
```

**Explicitly removed globals** (that would otherwise be present from `luaL_openlibs`):
```
os, io, package, require, dofile, dostring, loadfile, load, module, debug, coroutine, collectgarbage, rawget, rawset, rawequal, rawlen, setmetatable, getmetatable
```

**Custom globals added**:
| Global | Type | Value |
|--------|------|-------|
| `EngineDir` | string | `"/assets"` (platform engine directory) |
| `FatalError` | function | Calls `context.fatalError(msg)` |
| `print` | function | Logs to console + script channel |
| `MaxUserScriptInstructions` | number | `1000000` |

### 3.2 Why These Specific Removals

| Global | Reason |
|--------|--------|
| `os` | File system access, process execution (`.execute`, `.tmpname`) |
| `io` | File I/O — can read/write arbitrary files |
| `package` | Module loading — can load arbitrary Lua modules |
| `require` | Same as package |
| `dofile` | Execute arbitrary Lua files |
| `dostring` / `load` | Execute arbitrary Lua strings |
| `loadfile` | Load arbitrary Lua files |
| `debug` | Debug library — can break sandbox |
| `coroutine` | Coroutines not allowed in mission scripts |
| `collectgarbage` | Could affect GC timing (not network-safe) |
| `rawget/rawset/rawequal/rawlen` | Bypass metatable security |
| `setmetatable/getmetatable` | Can modify table behavior to escape sandbox |
| `module` | Deprecated module system |
| `math.random/randomseed` | NOT network-safe — must use `World.SharedRandom` instead |

### 3.3 Implementation Notes

In fengari, `luaL_openlibs(L)` opens all standard libraries and registers their globals. To remove a global:

```typescript
lua_pushnil(L)
lua_setglobal(L, "os")  // removes 'os' table
```

For math.random/randomseed, we get the math table first, then nil out the fields:

```typescript
lua_getglobal(L, "math")      // push math table
lua_pushnil(L)
lua_setfield(L, -2, "random") // math.random = nil
lua_pushnil(L)
lua_setfield(L, -2, "randomseed") // math.randomseed = nil
lua_pop(L, 1)                 // pop math table
```

---

## 4. TypeScript-to-Lua Bridge

### 4.1 Global Registration

Each `ScriptGlobal` subclass (e.g., `ActorGlobal`, `TriggerGlobal`) is exposed as a Lua table using fengari's metatable mechanism:

```
Lua Script:                    TypeScript:
──────────────────────        ──────────────────────
Actor.Create("e1", ...)  →   global.get("Create") returns callable JS wrapper
                            → wrapper(...args) calls methodDesc.invoke(target, convertedArgs)
                            → result converted to Lua value via toScriptValue → interop.push

Actor.Create              →   global.get("Create") returns the wrapper function
                            (Lua sees a function value)

Map.LobbyOption("name")  →   same pattern
```

**Implementation approach** — Each ScriptGlobal's members are exposed via a Lua table with `__index` metatable:

```typescript
function _registerGlobalAsLuaTable(L: LuaState, global: ScriptGlobal): void {
  lua_createtable(L, 0, 0)  // main table

  // Create metatable
  lua_createtable(L, 0, 2)

  // __index handler
  lua_pushcfunction(L, (L) => {
    const key = lua_tojsstring(L, 2) ?? ''
    if (!global.containsKey(key)) {
      lua_pushnil(L)
      return 1
    }
    const value = global.get(key)
    if (typeof value === 'function') {
      // Wrap TS function as Lua-callable
      lua_pushcfunction(L, (L) => {
        const nargs = lua_gettop(L)
        const args: unknown[] = []
        for (let i = 1; i <= nargs; i++) {
          args.push(interop.tojs(L, i))
        }
        const result = (value as Function)(...args)
        interop.push(L, result)
        return 1
      })
    } else {
      interop.push(L, value)
    }
    return 1
  })
  lua_setfield(L, -2, "__index")

  // __newindex handler
  lua_pushcfunction(L, (L) => {
    const key = lua_tojsstring(L, 2) ?? ''
    const val = interop.tojs(L, 3)
    try {
      global.set(key, val)
    } catch (e) {
      // Error becomes Lua error
      lua_pushstring(L, (e as Error).message)
      lua_error(L)
    }
    return 0
  })
  lua_setfield(L, -2, "__newindex")

  lua_setmetatable(L, -2)
  lua_setglobal(L, global.name)
}
```

### 4.2 Map Actor Registration

```typescript
function _registerMapActor(L: LuaState, name: string, iface: ScriptActorInterface): void {
  // Same metatable pattern as ScriptGlobal
  // Exposes all available property groups for this actor
  _registerGlobalLikeTable(L, iface, name)
}
```

### 4.3 Member Descriptor to Lua Bridge

Each `MemberDescriptor` from Phases A-F becomes a Lua-accessible entry:

| Member Type | Lua Access | Implementation |
|-------------|-----------|----------------|
| Property (getter only) | `table.prop` — returns converted value | `__index` handler calls `desc.get(target)`, converts via `toScriptValue` |
| Property (getter + setter) | `table.prop` / `table.prop = val` | `__index` + `__newindex` handlers |
| Method | `table.method(args)` — calls TS function | Wrapped in `lua_pushcfunction` + argument conversion |

---

## 5. ScriptContext.ts Modifications

### 5.1 New Fields

```typescript
private _luaRuntime: ILuaRuntime | null = null
private _luaInitPromise: Promise<void> | null = null
```

### 5.2 New Public Method

```typescript
/**
 * Initialize the optional Lua VM for backward compatibility with
 * OpenRA .lua mission scripts. Must be called during world setup,
 * after the FileSystem is available but before WorldLoaded.
 *
 * OpenRA 对照: ScriptContext constructor (Lua runtime init portion)
 *
 * This method:
 * 1. Checks if any .lua scripts were queued in constructor
 * 2. Dynamically imports fengari/fengari-interop
 * 3. Creates a sandboxed Lua state
 * 4. Registers all ScriptGlobals as Lua tables
 * 5. Loads and executes each .lua file
 * 6. Wires WorldLoaded() and Tick() Lua callbacks
 *
 * @param fileSystem — the map's file system for reading .lua content
 */
async initLuaVM(fileSystem: IReadOnlyPackage): Promise<void>
```

### 5.3 Modified `dispose()`

```typescript
dispose(): void {
  if (this._disposed) return
  this._disposed = true

  // Dispose Lua runtime first
  this._luaRuntime?.dispose()
  this._luaRuntime = null

  // ... existing cleanup ...
}
```

### 5.4 Modified `worldLoaded()` and `tick()`

These already delegate to `_worldLoadedHandler` and `_tickHandler` callbacks. No change needed — the fengari adapter sets these handlers in `initLuaVM()`.

### 5.5 ScriptComponent.ts Modification (Phase B file)

`ScriptComponent` (which owns `ScriptContext`) needs a minor change to call `initLuaVM()`:

```typescript
// In ScriptComponent.worldLoaded():
async worldLoaded(): Promise<void> {
  // ... existing JSON trigger dispatch setup ...

  // Phase G: Initialize Lua VM if .lua files are present
  const luaScripts = this.context.pendingTriggers
    .filter(t => t.source.endsWith('.lua'))
  if (luaScripts.length > 0) {
    await this.context.initLuaVM(this.world.map.fileSystem)
  }

  // Call WorldLoaded callbacks (JSON + Lua)
  this.context.worldLoaded()
}
```

---

## 6. Type Conversion (LuaValue <-> TS)

### 6.1 ScriptTypes.ts Extensions

Add a new static method (and modify existing ones) to handle Lua value types:

```typescript
/**
 * Convert a fengari Lua value to a TypeScript game object.
 *
 * This extends fromScriptValue() with Lua-specific conversions:
 * - Lua table → plain object or array (depending on keys)
 * - Lua function → wrapped callable
 * - Lua nil → null
 * - Lua userdata → unwrapped JS object (via interop)
 *
 * Called by LuaScriptAdapter when converting Lua call args to TS.
 *
 * @param luaValue — a value obtained via interop.tojs(L, idx)
 * @param targetType — the expected TypeScript type name
 * @returns the converted game object
 */
static fromLuaValue(luaValue: unknown, targetType: ScriptTypeName): unknown
```

### 6.2 Conversion Table

| Lua Type | TS target 'number' | 'string' | 'boolean' | 'CPos' | 'table' | 'function' |
|----------|-------------------|----------|-----------|--------|---------|-------------|
| nil | throws* | throws* | throws* | throws* | null | throws* |
| number | passthrough | throws | throws | throws | number | throws |
| string | throws | passthrough | throws | throws | string | throws |
| boolean | throws | throws | passthrough | throws | boolean | throws |
| table | throws | throws | throws | from keys | passthrough | throws |
| function | throws | throws | throws | throws | throws | passthrough |

*Unless targetType is 'nil' or the parameter is optional.

### 6.3 toScriptValue Modifications

The existing `toScriptValue()` generates JSON-compatible objects. For the Lua VM, we need values that `interop.push()` can handle. `interop.push()` already handles:
- `undefined` → `nil`
- `number` → Lua number
- `string` → Lua string
- `boolean` → Lua boolean
- `null` → `nil`
- `symbol` → lightuserdata
- `function` → Lua-callable (if from `lua_toproxy`) or wrapped userdata
- `object` → userdata with metatable

So `toScriptValue()` output is already compatible with `interop.push()`. No modification needed — the JSON-compatible values {x, y}, {x, y, z}, etc. are plain objects that interop.push converts to Lua tables with appropriate structure.

**However**: We should consider whether Lua scripts expect OpenRA-specific value formats. For example:
- `CPos` in OpenRA Lua: exposed as a table `{ X = 123, Y = 456, Layer = 0 }` (uppercase keys)
- Our `toScriptValue()` outputs `{ x: 123, y: 456 }` (lowercase keys)

**Decision**: We use OpenRA's exact Lua-exposed format. Add a dedicated `toLuaValue()` method to ScriptTypes that produces the OpenRA-compatible format (uppercase keys). This is used only by the Lua path; the JSON path (Tier 1) can continue using the existing lowercase-key format since JSON schemas define their own shape.

So `ScriptTypes` gains:

```typescript
/**
 * Convert to OpenRA-compatible Lua value format.
 * OpenRA 对照: object.ToLuaValue(ScriptContext)
 *
 * Differs from toScriptValue in key casing:
 * - CPos → { X: number, Y: number, Layer: number }
 * - WPos → { X: number, Y: number, Z: number }
 */
static toLuaValue(obj: unknown, context: IScriptContext): unknown
```

---

## 7. Error Handling Strategy

### 7.1 Lua Error -> FatalError

```
User Lua: error("something broke")
  → fengari raises Lua error (lua_pcall returns LUA_ERRRUN)
  → LuaScriptAdapter catches, wraps as Error
  → ScriptContext.fatalError(error)
  → Game ends
```

### 7.2 Lua Stack Trace

fengari provides stack traces via the `ldebug` module. When a Lua error occurs, we extract:

```typescript
try {
  // execute Lua code
} catch (e) {
  const luaError = e as Error
  const trace = luaError.stack ?? ''
  throw new Error(`Lua script error: ${luaError.message}\n${trace}`)
}
```

### 7.3 pcall Wrapping

All Lua function calls use `lua_pcall` in protected mode, never `lua_call`:

```typescript
// CORRECT (protected):
const status = lua_pcall(L, nargs, nresults, 0)
if (status !== LUA_OK) {
  const err = interop.tojs(L, -1)
  lua_pop(L, 1)
  throw new Error(String(err))
}

// NEVER use:
// lua_call(L, nargs, nresults)  // Unprotected — can crash
```

### 7.4 Error Propagation Chain

```
Lua runtime error
  → LuaScriptAdapter.callFunction() throws Error
  → ScriptContext.tick() / worldLoaded() catch block
  → ScriptContext.fatalError()
  → _onFatalError handler
  → World.EndGame()
```

---

## 8. Memory and Instruction Limits

### 8.1 Memory Limit

OpenRA uses `MemoryConstrainedLuaRuntime` (Eluant) which tracks Lua memory usage and throws when it exceeds the limit. Fengari does not have built-in memory tracking.

**Approach**: Use fengari's `lua_gc` function to query memory usage periodically (before each Tick/WorldLoaded call) and throw if exceeded:

```typescript
private _checkMemoryLimit(L: LuaState): void {
  const used = lua_gc(L, LUA_GCCOUNT, 0) * 1024 + lua_gc(L, LUA_GCCOUNTB, 0)
  if (used > this._maxMemory) {
    throw new Error(`Lua script memory limit exceeded (${used} > ${this._maxMemory} bytes)`)
  }
}
```

**Limitation**: This only checks at call boundaries, not during long-running Lua execution. Full mid-execution monitoring would require a hook set via `lua_sethook` with `LUA_MASKCOUNT`.

### 8.2 Instruction Limit

OpenRA uses Eluant's `MaxUserScriptInstructions` and counts instructions via `LuaRuntime.InstructionCount`. Fengari supports instruction counting via the debug hook interface:

```typescript
let instructionCount = 0
lua_sethook(L, (L, ar) => {
  instructionCount++
  if (instructionCount > this._maxInstructions) {
    luaL_error(L, 'Maximum instruction count exceeded')
  }
}, LUA_MASKCOUNT, 1000)  // check every 1000 instructions
```

**Decision**: Defer instruction limiting to a post-MVP refinement. The sandbox + JSON-first approach already mitigates most risks. Add a `TODO-20.G.INSTR` marker for future instruction counting.

### 8.3 OpenRA's MemoryConstrainedLuaRuntime Details

From `OpenRA.Game/Scripting/MemoryConstrainedLuaRuntime.cs` (if it exists):
- `MaxMemoryUse` property — sets the limit
- `MemoryUse` property — current usage
- On allocation, checks if `MemoryUse + size > MaxMemoryUse`
- Throws `LuaException("memory limit exceeded")` if exceeded

For Phase G, we implement a simpler boundary check before each function call. This is adequate because:
1. Lua scripts are loaded once at world init (not a hot path)
2. Tick/WorldLoaded callbacks are bounded by map design, not arbitrary
3. The JSON trigger system handles the majority of use cases

---

## 9. Unit Test Strategy

### 9.1 Test File

```
src/OpenRA.Game/Scripting/LuaScriptAdapter.test.ts  (~40 test cases)
```

### 9.2 Test Categories

| Category | Count | Description |
|----------|-------|-------------|
| **Sandbox** | 10 | Verify dangerous globals are nil (os, io, require, dofile, dostring, loadfile, load, debug, coroutine, collectgarbage), math.random/randomseed are nil |
| **Allowed globals** | 5 | Verify allowed globals exist (pairs, ipairs, type, tostring, tonumber) and work |
| **Builtin globals** | 4 | FatalError triggers handler, print logs, EngineDir equals option value, MaxUserScriptInstructions equals option value |
| **Global registration** | 8 | Register ScriptGlobal with methods and properties, verify getter/setter, method invocation, read-only property, write-only property |
| **Script execution** | 6 | Execute simple Lua script, execute with error, execute with return value, execute that calls TS global, nested function call |
| **Map actor registration** | 3 | Register named actor, access via Lua, actor method call |
| **Value conversion** | 6 | number<->Lua number, string<->Lua string, boolean<->Lua boolean, nil<->null, table<->object, function round-trip |
| **Dispose** | 2 | Dispose releases state, double-dispose is safe |
| **Dynamic import** | 2 | import() returns module, createLuaRuntime creates valid state |

**Total**: ~46 test cases (minimum 40)

### 9.3 Test Infrastructure

- **Vitest** with happy-dom
- Tests import fengari directly (not dynamically) — the test environment has fengari installed
- Each test creates a fresh Lua state, runs, and disposes it
- ScriptGlobal mocking — use a minimal test global with known methods/properties
- ScriptActorInterface mocking — use a test actor with known property groups

### 9.4 Key Test Scenarios (pseudocode)

```typescript
describe('LuaScriptAdapter', () => {
  describe('Sandbox', () => {
    it('removes the os global', () => {
      const rt = createLuaRuntime()
      expect(rt.hasFunction('os.execute')).toBe(false)
      // Executing 'os.exit(0)' should error
      expect(() => rt.doBuffer('os.exit(0)', 'test.lua')).toThrow()
    })

    it('removes math.random', () => {
      const rt = createLuaRuntime()
      // math.random should be nil
      expect(() => rt.doBuffer('local r = math.random(1,10)', 'test.lua')).toThrow()
    })

    it('removes math.randomseed', () => {
      const rt = createLuaRuntime()
      expect(() => rt.doBuffer('math.randomseed(42)', 'test.lua')).toThrow()
    })

    it('removes require', () => {
      const rt = createLuaRuntime()
      expect(() => rt.doBuffer('require("something")', 'test.lua')).toThrow()
    })

    it('allows pairs iteration', () => {
      const rt = createLuaRuntime()
      // Should not throw
      rt.doBuffer('local t = {a=1,b=2}; for k,v in pairs(t) do end', 'test.lua')
    })
  })

  describe('Global Registration', () => {
    it('exposes methods as callable', () => {
      const rt = createLuaRuntime()
      const mockGlobal = createMockScriptGlobal('Test', {
        greet: (name: string) => `Hello, ${name}!`,
      })
      rt.registerGlobal(mockGlobal)
      const result = rt.callFunction('Test.greet', 'World')
      expect(result).toBe('Hello, World!')
    })

    it('exposes properties as gettable/settable', () => {
      const rt = createLuaRuntime()
      let value = 0
      const mockGlobal = createMockScriptGlobal('Counter', {}, { count: { get: () => value, set: (v) => { value = v } } })
      rt.registerGlobal(mockGlobal)
      rt.doBuffer('Counter.count = 42', 'test.lua')
      expect(value).toBe(42)
    })
  })
})
```

---

## 10. Acceptance Test Strategy

### 10.1 Test Page

```
src/__e2e__/manual/ch20-scripting/lua-vm-integration/
  index.html
  main.ts
  README.md
```

### 10.2 Test Cases

1. **Sandbox verification**: Execute a Lua script that tries to call `os.exit()` — verify it fails gracefully (FatalError triggered)
2. **Global API call**: Execute a Lua script that calls a TypeScript global method (e.g., `Utils.RandomInteger(1, 100)`) — verify the result
3. **WorldLoaded/Tick**: Execute a Lua script with `WorldLoaded` and `Tick` functions — verify callbacks fire
4. **Print output**: Execute a Lua script with `print("hello")` — verify output appears in console
5. **Error handling**: Execute a Lua script with a deliberate error — verify FatalError is triggered

### 10.3 Expected Results (README.md)

Each test case should have at least 3 quantifiable expected results:
- Correct global function return value
- Correct sandbox enforcement (nil access → error)
- Correct callback timing (WorldLoaded fires before first Tick)
- Correct error propagation (Lua error → FatalError → game end)
- Correct memory behavior (no leaks across multiple Tick cycles)

---

## 11. Migration Work Requirement Documents

### 11.1 TODO-20.G.1: LuaScriptAdapter.ts

**File**: `src/OpenRA.Game/Scripting/LuaScriptAdapter.ts`
**Estimated size**: ~400 lines
**Dependencies**: fengari, fengari-interop (dynamic import), ScriptTypes, ScriptObjectWrapper, ScriptGlobal, ScriptActorInterface

**Requirements**:
1. Create `ILuaRuntime` interface with full fengari state management
2. Implement `createLuaRuntime()` factory function
3. Apply sandbox matching OpenRA's exactly
4. Implement ScriptGlobal → Lua table registration via metatables
5. Implement Lua script loading and execution (doBuffer)
6. Implement Lua function calling from TypeScript (callFunction)
7. Implement map actor registration as Lua globals
8. Implement dispose pattern (lua_close)
9. Dynamic import friendly (no top-level fengari imports)
10. JSDoc on all public APIs

### 11.2 TODO-20.G.2: ScriptContext.ts Modifications

**File**: `src/OpenRA.Game/Scripting/ScriptContext.ts`
**Estimated new lines**: ~50
**Dependencies**: LuaScriptAdapter (dynamic import)

**Requirements**:
1. Add `initLuaVM(fileSystem)` public async method
2. Add `_luaRuntime` and `_luaInitPromise` private fields
3. Modify `dispose()` to clean up Lua runtime
4. Wire Lua WorldLoaded/Tick callbacks via existing handler setters
5. Handle dynamic import errors gracefully (non-fatal if fengari unavailable)

### 11.3 TODO-20.G.3: ScriptTypes.ts Extensions

**File**: `src/OpenRA.Game/Scripting/ScriptTypes.ts`
**Estimated new lines**: ~30
**Dependencies**: None (pure TypeScript)

**Requirements**:
1. Add `toLuaValue()` static method for OpenRA-compatible Lua format (uppercase keys for CPos/WPos)
2. Ensure existing `toScriptValue()` remains JSON-compatible (lowercase keys)
3. Document which path uses which conversion

### 11.4 TODO-20.G.4: ScriptComponent.ts Modification

**File**: `src/OpenRA.Mods.Common/Scripting/ScriptComponent.ts`
**Estimated new lines**: ~10
**Dependencies**: ScriptContext.initLuaVM()

**Requirements**:
1. In `worldLoaded()`, check for .lua scripts and call `context.initLuaVM()`
2. Handle async init before calling `context.worldLoaded()`

### 11.5 TODO-20.G.5: Unit Tests

**File**: `src/OpenRA.Game/Scripting/LuaScriptAdapter.test.ts`
**Estimated size**: ~350 lines (~46 test cases)
**Dependencies**: fengari, fengari-interop, vitest, happy-dom

**Requirements**:
1. 10 sandbox tests
2. 5 allowed-globals tests
3. 4 builtin-globals tests
4. 8 global registration tests
5. 6 script execution tests
6. 3 map actor registration tests
7. 6 value conversion tests
8. 2 dispose tests
9. 2 dynamic import tests

### 11.6 TODO-20.G.6: Acceptance Test Page

**Directory**: `src/__e2e__/manual/ch20-scripting/lua-vm-integration/`
**Files**: `index.html`, `main.ts`, `README.md`

**Requirements**:
1. Visual test page executing Lua scripts in browser
2. Sandbox enforcement verification
3. Global API call verification
4. WorldLoaded/Tick callback verification
5. Error handling verification
6. At least 3 quantifiable expected results per test case

---

## Appendix A: Fengari Interop API Quick Reference

### Push JS values to Lua stack
```typescript
import { push, tojs, luaopen_js } from 'fengari-interop'

// Push values:
push(L, 42)              // number → Lua number
push(L, "hello")         // string → Lua string
push(L, true)            // boolean → Lua boolean
push(L, null)            // null → nil
push(L, undefined)       // undefined → nil
push(L, {a: 1})          // object → userdata with metatable
push(L, () => {})        // function → userdata with call metatable

// Convert Lua stack values to JS:
tojs(L, 1)               // Lua value at stack index 1 → JS value
```

### JS library setup (required for interop)
```typescript
import { luaopen_js } from 'fengari-interop'
const { luaL_requiref } = require('fengari').lauxlib
const { luaL_openlibs } = require('fengari').lualib

// After luaL_newstate() and luaL_openlibs(L):
luaL_requiref(L, "_G", luaL_openlibs, 0)  // ensure base lib is loaded
luaopen_js(L)                               // open js interop library
lua_pop(L, 1)                               // clean up stack
```

### Wrapping JS functions as Lua-callable
```typescript
import { lua_pushcfunction } from 'fengari'

lua_pushcfunction(L, (L) => {
  // L = Lua state
  // Stack: [arg1, arg2, ...]
  const arg1 = tojs(L, 1)
  const arg2 = tojs(L, 2)
  const result = myFunction(arg1, arg2)
  push(L, result)
  return 1  // number of return values
})
lua_setglobal(L, "myFunction")
```

---

## Appendix B: OpenRA Sandbox Reference (from ScriptContext.cs:162-183)

```csharp
// From OpenRA ScriptContext.cs constructor
var allowedGlobals = new string[]
{
    "ipairs", "next", "pairs",
    "pcall", "select", "tonumber", "tostring", "type", "unpack", "xpcall",
    "math", "string", "table"
};

foreach (var fieldName in runtime.Globals.Keys)
    if (!allowedGlobals.Contains(fieldName.ToString()))
        runtime.Globals[fieldName] = null;

var forbiddenMath = new string[]
{
    "random", // not desync safe, unsuitable
    "randomseed" // maybe unsafe as it affects the host RNG
};

var mathGlobal = (LuaTable)runtime.Globals["math"];
foreach (var mathFunction in mathGlobal.Keys)
    if (forbiddenMath.Contains(mathFunction.ToString()))
        mathGlobal[mathFunction] = null;
```

---

## Appendix C: File Count Summary for Phase G

| # | File | Type | Lines (est.) | Test Cases |
|---|------|------|-------------|------------|
| 1 | `LuaScriptAdapter.ts` | New | ~400 | ~46 |
| 2 | `ScriptContext.ts` | Modified | +50 | (existing) |
| 3 | `ScriptTypes.ts` | Modified | +30 | +8 |
| 4 | `ScriptComponent.ts` | Modified | +10 | +5 |
| 5 | `index.html` (test page) | New | ~60 | — |
| 6 | `main.ts` (test page) | New | ~200 | — |
| 7 | `README.md` (test page) | New | ~50 | — |
| **Total** | | | **~800** | **~59** |
