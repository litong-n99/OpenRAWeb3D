/**
 * fengari.d.ts — Minimal type declarations for fengari and fengari-interop
 *
 * fengari (v0.1.5) is a CJS-only package with no built-in TypeScript definitions.
 * fengari-interop (v0.1.4) is also CJS-only.
 *
 * These declarations cover only the API surface used by LuaScriptAdapter
 * and its test suite. The Lua state handle (L) is typed as `object`.
 */

// ---------------------------------------------------------------------------
// fengari: Lua 5.3 VM in pure JS
// ---------------------------------------------------------------------------

declare module 'fengari' {
  // Thread status
  const LUA_OK: 0
  const LUA_ERRRUN: 1
  const LUA_ERRSYNTAX: 2
  const LUA_ERRMEM: 3
  const LUA_ERRERR: 4
  const LUA_MULTRET: -1
  const LUA_REGISTRYINDEX: number
  const LUA_RIDX_GLOBALS: number
  const LUA_RIDX_MAINTHREAD: number

  // Type constants
  const LUA_TNONE: -1
  const LUA_TNIL: 0
  const LUA_TBOOLEAN: 1
  const LUA_TLIGHTUSERDATA: 2
  const LUA_TNUMBER: 3
  const LUA_TSTRING: 4
  const LUA_TTABLE: 5
  const LUA_TFUNCTION: 6
  const LUA_TUSERDATA: 7
  const LUA_TTHREAD: 8

  // GC constants
  const LUA_GCCOUNT: 0
  const LUA_GCCOUNTB: 1

  // String utilities
  function to_jsstring(s: unknown, ...args: unknown[]): string | null
  function to_luastring(s: string): unknown
  function luastring_of(...args: unknown[]): unknown
  function luastring_eq(a: unknown, b: unknown): boolean

  // lua namespace — core Lua C API
  namespace lua {
    function lua_close(L: object): void
    function lua_newstate(): object | null
    function lua_atpanic(L: object, panicf: (L: object) => number): (L: object) => number
    function lua_gettop(L: object): number
    function lua_settop(L: object, idx: number): void
    function lua_pop(L: object, n: number): void
    function lua_pushvalue(L: object, idx: number): void
    function lua_rotate(L: object, idx: number, n: number): void
    function lua_copy(L: object, fromIdx: number, toIdx: number): void
    function lua_checkstack(L: object, n: number): boolean
    function lua_pushnil(L: object): void
    function lua_pushnumber(L: object, n: number): void
    function lua_pushinteger(L: object, n: number): void
    function lua_pushstring(L: object, s: string): void
    function lua_pushboolean(L: object, b: boolean): void
    function lua_pushcfunction(L: object, fn: (L: object) => number): void
    function lua_pushliteral(L: object, s: string): void
    function lua_pushlightuserdata(L: object, p: unknown): void
    function lua_type(L: object, idx: number): number
    function lua_typename(L: object, tp: number): string
    function lua_toboolean(L: object, idx: number): boolean
    function lua_tonumber(L: object, idx: number): number | undefined
    function lua_tojsstring(L: object, idx: number): string | null
    function lua_isnil(L: object, idx: number): boolean
    function lua_isproxy(L: object, idx: number): boolean
    function lua_toproxy(L: object, idx: number): unknown
    function lua_touserdata(L: object, idx: number): unknown
    function lua_tothread(L: object, idx: number): unknown
    function lua_createtable(L: object, narr: number, nrec: number): void
    function lua_gettable(L: object, idx: number): void
    function lua_settable(L: object, idx: number): void
    function lua_getfield(L: object, idx: number, k: string): void
    function lua_setfield(L: object, index: number, k: string): void
    function lua_rawgeti(L: object, idx: number, n: number): void
    function lua_rawgetp(L: object, idx: number, p: unknown): void
    function lua_rawsetp(L: object, idx: number, p: unknown): void
    function lua_getglobal(L: object, name: string): void
    function lua_setglobal(L: object, name: string): void
    function lua_call(L: object, nargs: number, nresults: number): void
    function lua_pcall(L: object, nargs: number, nresults: number, errfunc: number): number
    function lua_load(
      L: object,
      reader: (L: object, data: unknown) => string | null,
      data: unknown,
      chunkname: string,
      mode?: string,
    ): number
    function lua_setmetatable(L: object, index: number): void
    function lua_getmetatable(L: object, index: number): number
    function lua_error(L: object): number
    function lua_atnativeerror(L: object, fn: (err: unknown) => void): void
    function lua_gc(L: object, what: number, data: number): number
    function lua_sethook(L: object, func: (L: object, ar: unknown) => void, mask: number, count: number): void
    function lua_concat(L: object, n: number): void
    function lua_compare(L: object, index1: number, index2: number, op: number): boolean
    function lua_arith(L: object, op: number): void
    function lua_newuserdata(L: object, size: number): unknown
    class lua_Debug {
      event: number
      name: string | null
      namewhat: string | null
      what: string | null
      source: string | null
      currentline: number
      linedefined: number
      lastlinedefined: number
      nups: number
      nparams: number
      isvararg: boolean
      istailcall: boolean
      short_src: string | null
    }
  }

  // lauxlib namespace — auxiliary library
  namespace lauxlib {
    function luaL_newstate(): object
    function luaL_openlibs(L: object): void
    function luaL_loadbuffer(L: object, buff: string, size: number, name: string): number
    function luaL_loadbufferx(L: object, buff: string, size: number, name: string, mode?: string): number
    function luaL_loadstring(L: object, s: string): number
    function luaL_dostring(L: object, s: string): number
    function luaL_dofile(L: object, filename: string): number
    function luaL_requiref(L: object, modname: string, openf: (L: object) => number, glb: number): void
    function luaL_checkstack(L: object, sz: number, msg?: string): void
    function luaL_checktype(L: object, arg: number, t: number): void
    function luaL_checkany(L: object, arg: number): void
    function luaL_checkinteger(L: object, arg: number): number
    function luaL_checknumber(L: object, arg: number): number
    function luaL_checkstring(L: object, arg: number): string
    function luaL_checklstring(L: object, arg: number): string
    function luaL_checkudata(L: object, arg: number, tname: string): unknown
    function luaL_checkoption(L: object, arg: number, def: string, lst: string[]): number
    function luaL_argerror(L: object, arg: number, extramsg: string): number
    function luaL_argcheck(L: object, cond: boolean, arg: number, extramsg: string): void
    function luaL_typename(L: object, i: number): string
    function luaL_error(L: object, fmt: string, ...args: unknown[]): number
    function luaL_tolstring(L: object, idx: number): string
    function luaL_callmeta(L: object, obj: number, event: string): number
    function luaL_newmetatable(L: object, tname: string): number
    function luaL_setmetatable(L: object, tname: string): void
    function luaL_testudata(L: object, arg: number, tname: string): unknown
    function luaL_getmetafield(L: object, obj: number, event: string): number
    function luaL_newlib(L: object, l: Array<[string, (L: object) => number]>): void
    function luaL_setfuncs(L: object, l: Array<[string, (L: object) => number]>, nup: number): void
  }

  // lualib namespace — standard library opener
  namespace lualib {
    function luaL_openlibs(L: object): void
    function luaopen_base(L: object): number
    function luaopen_package(L: object): number
    function luaopen_coroutine(L: object): number
    function luaopen_table(L: object): number
    function luaopen_io(L: object): number
    function luaopen_os(L: object): number
    function luaopen_string(L: object): number
    function luaopen_utf8(L: object): number
    function luaopen_math(L: object): number
    function luaopen_debug(L: object): number
  }
}

// ---------------------------------------------------------------------------
// fengari-interop: JS<->Lua bridge
// ---------------------------------------------------------------------------

declare module 'fengari-interop' {
  /** Push a JS value onto the Lua stack, auto-converting to appropriate Lua type. */
  function push(L: object, v: unknown): void

  /** Convert a Lua stack value at the given index to a JS value. */
  function tojs(L: object, idx: number): unknown

  /** Open the JS interop library and register it into the Lua state. */
  function luaopen_js(L: object): number
}
