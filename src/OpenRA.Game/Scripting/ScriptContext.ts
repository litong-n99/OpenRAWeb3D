/**
 * ScriptContext.ts — Core mission script orchestrator
 * OpenRA 对照: ScriptContext.cs
 *
 * 核心范式转换:
 * - C# MemoryConstrainedLuaRuntime (Eluant/Lua 5.2 sandbox)
 *   → JSON trigger dispatch loop + optional fengari Lua 5.3 VM (Phase G)
 * - C# runtime.Globals Lua table (register globals, map actors)
 *   → ScriptRegistry + named actor map + global table instances
 * - C# World.AddFrameEndTask(w => w.EndGame()) for fatal errors
 *   → _onFatalError callback injected by ScriptComponent (Phase B)
 */

import type { WorldStub, WorldRendererStub, ActorInfoStub, IGameActor, PlayerStub } from '../Traits/TraitsInterfaces.js'
import type { IScriptContext } from './ScriptMemberDescriptor.js'
import type { ActorPropertyRegistration, PlayerPropertyRegistration } from './ScriptMemberDescriptor.js'
import { ScriptRegistry } from './ScriptRegistry.js'
import { ScriptActorInterface } from './ScriptActorInterface.js'
import { ScriptPlayerInterface } from './ScriptPlayerInterface.js'
import type { ScriptGlobal } from './ScriptObjectWrapper.js'

// ---------------------------------------------------------------------------
// ScriptContext
// ---------------------------------------------------------------------------

/**
 * Core mission script host.
 *
 * OpenRA 对照: ScriptContext (ScriptContext.cs:119-345)
 *
 * Manages the scripting runtime lifecycle: construction, WorldLoaded, Tick,
 * FatalError, Dispose. Delegates to ScriptRegistry for API lookups.
 *
 * Paradigm shift:
 * - C# creates Eluant Lua runtime, loads .lua files, manages Lua globals
 * - TS creates a JSON trigger dispatch loop (Phase B) with optional fengari VM (Phase G)
 * - C# uses MemoryConstrainedLuaRuntime for sandboxing
 * - TS sandboxing is inherent in the JSON schema validation (no Turing-complete
 *   runtime needed for Tier 1) + optional fengari sandbox (Phase G)
 */
export class ScriptContext implements IScriptContext {
  // ---------------------------------------------------------------------------
  // Public Properties
  // ---------------------------------------------------------------------------

  /** The game world. */
  readonly world: WorldStub

  /** The world renderer. */
  readonly worldRenderer: WorldRendererStub

  /** Whether a fatal script error has occurred. */
  fatalErrorOccurred: boolean = false

  /** The fatal error message, if any. */
  errorMessage: string | null = null

  // ---------------------------------------------------------------------------
  // Private State
  // ---------------------------------------------------------------------------

  private _disposed = false
  private _globals = new Map<string, ScriptGlobal>()
  private _namedActors = new Map<string, IGameActor>()
  private _actorInterfaces = new Map<IGameActor, ScriptActorInterface>()
  private _playerInterfaces = new Map<PlayerStub, ScriptPlayerInterface>()
  private _reservedNames = new Set<string>()
  private _onFatalError: (() => void) | null = null

  /** Known player commands from registry (cached). */
  private _knownPlayerCommands: readonly PlayerPropertyRegistration[]

  /** Filtered player commands for the Player actor type. */
  private _playerCommands: readonly PlayerPropertyRegistration[]

  /** Stored JSON trigger scripts (parsed but not yet dispatched — Phase B). */
  private _pendingTriggers: { source: string; script: unknown }[] = []

  /** Lua script paths collected for Phase G fengari init. */
  private _luaScriptPaths: string[] = []

  /** WorldLoaded callback (set after construction for lazy init). */
  private _worldLoadedHandler: (() => void) | null = null

  /** Tick callback (set after construction for lazy init). */
  private _tickHandler: (() => void) | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a new ScriptContext.
   *
   * OpenRA 对照: ScriptContext(World, WorldRenderer, IEnumerable<string> scripts)
   *
   * Construction sequence (mirrors OpenRA):
   * 1. Log channel setup ("lua" → "script" for clarity)
   * 2. Discover known actor/player commands via ScriptRegistry
   * 3. Cache filtered actor commands for the Player actor type
   * 4. Sandbox configuration (JSON-trigger validation, optional Lua sandbox)
   * 5. Register global tables from ScriptRegistry
   * 6. Load scripts — parse JSON trigger definitions from map
   *    (in Phase A: load placeholder; Phase B: full JSON trigger parsing)
   * 7. Optionally: dynamically import fengari adapter if .lua files present (Phase G)
   *
   * @param world — the game world
   * @param worldRenderer — the world renderer
   * @param scripts — list of script resource paths from the map package
   *                  (e.g., ["mission.json", "lua/init.lua"])
   */
  constructor(
    world: WorldStub,
    worldRenderer: WorldRendererStub,
    scripts: Iterable<string>,
  ) {
    this.world = world
    this.worldRenderer = worldRenderer

    // Discover known commands from registry
    this._knownPlayerCommands = ScriptRegistry.getPlayerProperties()

    // Cache filtered player commands
    // NOTE: In Phase A, there may be no Player actor info available.
    // We pass all known player commands initially; Phase B's ScriptComponent
    // will re-resolve them when the Player actor info is available.
    this._playerCommands = this._knownPlayerCommands

    // Instantiate global tables from registry
    for (const reg of ScriptRegistry.getGlobals()) {
      const instance = new reg.ctor(this)
      this._globals.set(reg.name, instance)

      // Reserve global names for map actor registration
      this._reservedNames.add(reg.name)
    }

    // Reserve internal names (OpenRA reserves "EngineDir", "FatalError", "print",
    // "MaxUserScriptInstructions", "Tick", "WorldLoaded")
    this._reservedNames.add('EngineDir')
    this._reservedNames.add('FatalError')
    this._reservedNames.add('print')
    this._reservedNames.add('MaxUserScriptInstructions')
    this._reservedNames.add('Tick')
    this._reservedNames.add('WorldLoaded')

    // Validate registry
    ScriptRegistry.validate()

    // Load scripts (Phase A: placeholder; Phase B: full JSON parsing)
    for (const script of scripts) {
      this._loadScript(script)
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Methods
  // ---------------------------------------------------------------------------

  /**
   * Called when the world finishes loading. Dispatches to:
   * - WorldLoaded trigger in JSON (Phase B)
   * - WorldLoaded Lua function if fengari VM is active (Phase G)
   *
   * OpenRA 对照: ScriptContext.WorldLoaded() — calls runtime.Globals["WorldLoaded"]
   */
  worldLoaded(): void {
    if (this.fatalErrorOccurred || this._disposed) return

    try {
      this._worldLoadedHandler?.()
    } catch (e) {
      this.fatalError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  /**
   * Called every game tick (25 TPS). Dispatches to:
   * - Tick trigger polling in JSON (Phase B)
   * - Tick Lua function if fengari VM is active (Phase G)
   *
   * OpenRA 对照: ScriptContext.Tick() — calls runtime.Globals["Tick"] as LuaFunction
   *
   * Early-exits if fatalErrorOccurred or disposed.
   */
  tick(): void {
    if (this.fatalErrorOccurred || this._disposed) return

    try {
      this._tickHandler?.()
    } catch (e) {
      this.fatalError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  /**
   * Trigger a fatal script error, immediately ending the game.
   *
   * OpenRA 对照: ScriptContext.FatalError(Exception) / FatalError(string)
   */
  fatalError(error: Error): void
  fatalError(message: string): void
  fatalError(errorOrMessage: Error | string): void {
    const message = errorOrMessage instanceof Error
      ? errorOrMessage.message
      : errorOrMessage
    const stackTrace = errorOrMessage instanceof Error
      ? errorOrMessage.stack ?? ''
      : new Error().stack ?? ''

    this.errorMessage = message
    this.fatalErrorOccurred = true

    console.error(`Fatal Script Error: ${message}`)
    console.error(stackTrace)

    // Log to script channel (mirrors OpenRA's Log.Write("lua", ...))
    this.logDebug(`Fatal Script Error: ${message}`)
    this.logDebug(stackTrace)

    // End the game via callback
    this._onFatalError?.()
  }

  /**
   * Set the callback invoked when a fatal error ends the game.
   * Called by ScriptComponent (Phase B) during world setup.
   */
  setFatalErrorHandler(handler: () => void): void {
    this._onFatalError = handler
  }

  /**
   * Set the WorldLoaded handler.
   * Called by ScriptComponent (Phase B) to register the WorldLoaded callback.
   */
  setWorldLoadedHandler(handler: () => void): void {
    this._worldLoadedHandler = handler
  }

  /**
   * Set the Tick handler.
   * Called by ScriptComponent (Phase B) to register the Tick callback.
   */
  setTickHandler(handler: () => void): void {
    this._tickHandler = handler
  }

  // ---------------------------------------------------------------------------
  // Map Actor Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a named map actor as a script global.
   *
   * OpenRA 对照: ScriptContext.RegisterMapActor(string, Actor)
   *
   * Creates a ScriptActorInterface for the actor and makes it accessible
   * by name in the script environment. Throws if the name conflicts with
   * a reserved global name.
   *
   * @param name — the script name for this actor
   * @param actor — the actor to register
   * @throws Error if the name is already reserved by a global table
   */
  registerMapActor(name: string, actor: IGameActor): void {
    if (this._reservedNames.has(name)) {
      throw new Error(`The global name '${name}' is reserved, and may not be used by a map actor`)
    }

    this._namedActors.set(name, actor)

    // Create the script interface for the actor
    this.createActorInterface(actor)
  }

  // ---------------------------------------------------------------------------
  // Command Queries
  // ---------------------------------------------------------------------------

  /**
   * Get the available actor property classes for a given actor type.
   *
   * OpenRA 对照: ScriptContext.ActorCommands[actor.Info]
   *
   * Delegates to ScriptRegistry.getActorCommands().
   */
  getActorCommands(info: ActorInfoStub): readonly ActorPropertyRegistration[] {
    // Attempt trait checking from the ActorInfo
    // Falls back to all-pass if the actor info doesn't provide a check function
    const hasTrait = (traitName: string): boolean => {
      return (info as any).hasTraitInfo?.(traitName) ?? true
    }
    return ScriptRegistry.getActorCommands(info, hasTrait)
  }

  /**
   * Get the available player property classes.
   *
   * OpenRA 对照: ScriptContext.PlayerCommands
   */
  get playerCommands(): readonly PlayerPropertyRegistration[] {
    return this._playerCommands
  }

  // ---------------------------------------------------------------------------
  // Script Interface Factory
  // ---------------------------------------------------------------------------

  /**
   * Create a ScriptActorInterface for a given actor.
   *
   * OpenRA 对照: actor.ToLuaValue(context) → ScriptActorInterface(context, actor)
   *
   * The returned interface is cached per actor to avoid redundant construction.
   */
  createActorInterface(actor: IGameActor): ScriptActorInterface {
    const cached = this._actorInterfaces.get(actor)
    if (cached) return cached

    const iface = new ScriptActorInterface(this, actor)
    this._actorInterfaces.set(actor, iface)
    return iface
  }

  /**
   * Create a ScriptPlayerInterface for a given player.
   *
   * OpenRA 对照: player.ToLuaValue(context) → ScriptPlayerInterface(context, player)
   */
  createPlayerInterface(player: PlayerStub): ScriptPlayerInterface {
    const cached = this._playerInterfaces.get(player)
    if (cached) return cached

    const iface = new ScriptPlayerInterface(this, player)
    this._playerInterfaces.set(player, iface)
    return iface
  }

  // ---------------------------------------------------------------------------
  // Global Table Access
  // ---------------------------------------------------------------------------

  /**
   * Get all instantiated global tables.
   * Each is created in the constructor from ScriptRegistry.getGlobals().
   */
  get globals(): ReadonlyMap<string, ScriptGlobal> {
    return this._globals
  }

  /**
   * Get a specific global table by name.
   */
  getGlobal(name: string): ScriptGlobal | undefined {
    return this._globals.get(name)
  }

  // ---------------------------------------------------------------------------
  // Debug Logging
  // ---------------------------------------------------------------------------

  /**
   * Log a debug message from user scripts.
   *
   * OpenRA 对照: LogDebugMessage(string) — prints to console + "lua" log
   */
  logDebug(message: string): void {
    console.log(`Script debug: ${message}`)
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /**
   * Clean up all resources.
   *
   * OpenRA 对照: ScriptContext.Dispose() — disposes Lua runtime
   *
   * In Phase A: clears globals, named actors, and caches.
   * In Phase G: also disposes fengari Lua runtime.
   */
  dispose(): void {
    if (this._disposed) return

    this._disposed = true

    // Clear all caches
    this._globals.clear()
    this._namedActors.clear()
    this._actorInterfaces.clear()
    this._playerInterfaces.clear()
    this._reservedNames.clear()
    this._pendingTriggers.length = 0
    this._luaScriptPaths.length = 0
    this._onFatalError = null
    this._worldLoadedHandler = null
    this._tickHandler = null
  }

  /** Whether this instance has been disposed. */
  get disposed(): boolean {
    return this._disposed
  }

  // ---------------------------------------------------------------------------
  // Internal — Script Loading
  // ---------------------------------------------------------------------------

  /**
   * Load a single script file.
   * Phase A: identifies script type, stores for later processing.
   * Phase B: full JSON trigger parsing and dispatch setup.
   */
  private _loadScript(script: string): void {
    // Phase A: Record script path, defer actual loading to Phase B
    if (script.endsWith('.json')) {
      // JSON trigger scripts will be parsed in Phase B
      this._pendingTriggers.push({ source: script, script: null })
      console.log(`ScriptContext: queued JSON trigger script '${script}' for Phase B dispatch`)
    } else if (script.endsWith('.lua')) {
      // Lua scripts will be handled by fengari adapter in Phase G
      this._luaScriptPaths.push(script)
      console.log(`ScriptContext: queued Lua script '${script}' for Phase G fengari`)
    } else {
      console.warn(`ScriptContext: unknown script format '${script}'`)
    }
  }

  /**
   * Get registered named actors (for debugging/testing).
   */
  get namedActors(): ReadonlyMap<string, IGameActor> {
    return this._namedActors
  }

  /**
   * Get pending trigger scripts (for testing).
   */
  get pendingTriggers(): readonly { source: string; script: unknown }[] {
    return this._pendingTriggers
  }
}
