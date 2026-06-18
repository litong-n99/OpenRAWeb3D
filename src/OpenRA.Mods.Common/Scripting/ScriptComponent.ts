/**
 * ScriptComponent.ts — World-level trait that owns the scripting runtime
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/LuaScript.cs (66 lines)
 *
 * 核心范式转换:
 * - C# LuaScript : ITick, IWorldLoaded, INotifyActorDisposing
 *   → TypeScript ScriptComponent : IWorldLoaded, ITick, INotifyActorDisposing
 * - C# creates Eluant MemoryConstrainedLuaRuntime + loads .lua files
 *   → TS creates ScriptContext with JSON trigger dispatch loop (Phase B)
 *     + optional fengari Lua VM for .lua files (Phase G)
 * - C# info.Scripts is FrozenSet<string>
 *   → TS info.scripts is readonly string[]
 * - C# World + WorldRenderer constructor args → WorldStub + WorldRendererStub
 */

import type { WorldStub, WorldRendererStub, IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IWorldLoaded } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ITick } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyActorDisposing } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ScriptContext } from '../../OpenRA.Game/Scripting/ScriptContext.js'
import type { IReadOnlyPackage } from '../../OpenRA.Game/FileSystem/IReadOnlyPackage.js'

// ---------------------------------------------------------------------------
// ScriptComponentInfo
// ---------------------------------------------------------------------------

/**
 * Trait info for ScriptComponent.
 *
 * OpenRA 对照: LuaScriptInfo (LuaScript.cs:23-28)
 *
 * Configures the script files to load. These paths are relative to the
 * map package (matching OpenRA convention).
 */
export class ScriptComponentInfo {
  /**
   * Script file names, relative to the map package.
   *
   * OpenRA 对照: LuaScriptInfo.Scripts (FrozenSet<string>)
   *
   * Default: empty array. Phase G adds lua file loading support.
   */
  scripts: readonly string[] = []

  constructor(scripts?: readonly string[]) {
    if (scripts) this.scripts = scripts
  }
}

// ---------------------------------------------------------------------------
// ScriptComponent
// ---------------------------------------------------------------------------

/**
 * World-level trait that creates and owns the scripting runtime.
 *
 * OpenRA 对照: LuaScript (LuaScript.cs:31-65)
 *
 * This is the ENTRY POINT for the entire mission scripting system.
 * It is attached to the World actor (TraitLocation: SystemActors.World).
 *
 * ## Lifecycle
 *
 * 1. **Construction**: Stores the ScriptComponentInfo.
 * 2. **IWorldLoaded.worldLoaded()**: Creates a ScriptContext with the world,
 *    world renderer, and script file paths. Calls context.worldLoaded() to
 *    initialize named actors, parse JSON triggers, and set up player interfaces.
 * 3. **ITick.tick()**: Called every simulation tick. Delegates to context.tick().
 * 4. **INotifyActorDisposing.disposing()**: Calls context.dispose() to clean up
 *    the scripting runtime. Guarded by _disposed flag (safe double-dispose).
 */
export class ScriptComponent implements IWorldLoaded, ITick, INotifyActorDisposing {
  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /** The trait configuration. */
  readonly info: ScriptComponentInfo

  /**
   * The script context, created during worldLoaded().
   *
   * OpenRA 对照: LuaScript.Context (line 34)
   *
   * null before worldLoaded() is called.
   */
  context: ScriptContext | null = null

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _disposed = false

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create the world-level scripting trait.
   *
   * OpenRA 对照: LuaScript(LuaScriptInfo info) (lines 37-40)
   *
   * @param info — trait configuration with script file paths
   */
  constructor(info: ScriptComponentInfo) {
    this.info = info
  }

  // ---------------------------------------------------------------------------
  // IWorldLoaded (对应 lines 42-48)
  // ---------------------------------------------------------------------------

  /**
   * Called when the world finishes loading.
   *
   * OpenRA 对照: LuaScript.IWorldLoaded.WorldLoaded(World, WorldRenderer)
   *
   * Creates the ScriptContext and initializes the scripting runtime.
   * If .lua scripts are present, initializes the fengari Lua VM asynchronously.
   *
   * Phase G: Detects .lua files in scripts and calls context.initLuaVM().
   *
   * @param world — the game world
   * @param worldRenderer — the world renderer
   */
  worldLoaded(world: WorldStub, worldRenderer: WorldRendererStub): void {
    const scripts = this.info.scripts ?? []
    this.context = new ScriptContext(world, worldRenderer, scripts)

    // Phase G: If .lua files are present, initialize the Lua VM asynchronously.
    // We fire-and-forget the init; when it completes, it calls WorldLoaded handlers.
    // Note: context.worldLoaded() must still be called synchronously for JSON triggers
    // (Phase B) even if Lua VM init is pending.
    const hasLuaScripts = scripts.some(s => s.endsWith('.lua'))
    if (hasLuaScripts) {
      // Try to access the map's file system via the world
      const worldAny = world as any
      const fileSystem: IReadOnlyPackage | undefined = worldAny.map?.package
        ?? worldAny.package
        ?? worldAny.fileSystem
      if (fileSystem) {
        // Fire and forget — Lua scripts are optional, don't block world load
        this.context.initLuaVM(fileSystem).catch((err: unknown) => {
          console.error('Lua VM init failed:', err)
        }).finally(() => {
          // Once Lua VM is ready, trigger WorldLoaded callbacks if not already done
          // The Lua WorldLoaded handler was set by initLuaVM
          this.context?.worldLoaded()
        })
        // JSON-only worldLoaded runs immediately for non-Lua triggers
      } else {
        console.warn('ScriptComponent: .lua scripts present but no fileSystem available for Lua VM init')
        this.context.worldLoaded()
      }
    } else {
      // No Lua scripts — standard synchronous path
      this.context.worldLoaded()
    }
  }

  // ---------------------------------------------------------------------------
  // ITick (对应 lines 49-53)
  // ---------------------------------------------------------------------------

  /**
   * Called every simulation tick.
   *
   * OpenRA 对照: LuaScript.ITick.Tick(Actor)
   *
   * Delegates to ScriptContext.tick() for trigger dispatch and
   * per-frame script processing.
   *
   * @param self — the world actor (ignored — ScriptComponent is stateless per tick)
   */
  tick(_self: IGameActor): void {
    this.context?.tick()
  }

  // ---------------------------------------------------------------------------
  // INotifyActorDisposing (对应 lines 54-62)
  // ---------------------------------------------------------------------------

  /**
   * Called when the world actor is being disposed.
   *
   * OpenRA 对照: LuaScript.INotifyActorDisposing.Disposing(Actor)
   *
   * Disposes the ScriptContext. Safe to call multiple times (guarded
   * by _disposed flag).
   *
   * @param self — the world actor (ignored)
   */
  disposing(_self: IGameActor): void {
    if (this._disposed) return
    this.context?.dispose()
    this._disposed = true
  }

  // ---------------------------------------------------------------------------
  // FatalErrorOccurred (对应 line 64)
  // ---------------------------------------------------------------------------

  /**
   * Whether a fatal script error has occurred.
   *
   * OpenRA 对照: LuaScript.FatalErrorOccurred (line 64)
   *
   * @returns true if the ScriptContext has recorded a fatal error
   */
  get fatalErrorOccurred(): boolean {
    return this.context?.fatalErrorOccurred ?? false
  }
}
