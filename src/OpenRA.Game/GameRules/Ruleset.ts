/**
 * Ruleset.ts — Game rules container: actors, weapons, voices, notifications, music, terrain, model sequences
 * OpenRA 对照: OpenRA.Game/GameRules/Ruleset.cs (281 lines)
 *
 * 核心范式转换:
 * - C# MiniYaml.Load() from fileSystem with FieldLoader reflection
 *   → Build-time JSON compilation (MiniYAML pipeline) + inline parsing
 * - C# MergeOrDefault<T>() with MiniYaml fusion
 *   → TypeScript Map<string, T> merge with conflict warning via console.warn
 * - C# ActorInfoDictionary (frozen, auto-adds SystemActors)
 *   → ReadonlyMap<string, ActorConfig> with SystemActors auto-insertion
 * - C# SoundInfo, MusicInfo, WeaponInfo (full classes with FieldLoader)
 *   → TypeScript stub interfaces (full migration deferred to Chapters 7-9)
 * - C# synchronous load (background Task for loadscreen animation)
 *   → TypeScript async/await (JS single-threaded, no loadscreen needed)
 * - C# IRulesetLoaded callback on ActorInfo + WeaponInfo
 *   → TypeScript TraitConfig.rulesetLoaded + Ruleset constructor invocation
 */

import type { IReadOnlyFileSystem } from '../FileSystem/IPackage.js'
import type { Manifest } from '../Manifest.js'
import type { ITerrainInfo } from '../Map/Map.js'
import {
  ActorConfig,
  type ActorJSON,
} from './ActorInfo.js'

// ---------------------------------------------------------------------------
// Stub Interfaces (full migration deferred to subsequent chapters)
// ---------------------------------------------------------------------------

/**
 * Weapon information stub.
 *
 * OpenRA 对照: OpenRA.Game/WeaponInfo.cs
 *
 * @todo Chapter 8: Full WeaponInfo migration with Projectile, Warhead,
 *   FireDelay, Report, etc. The current stub provides minimal fields needed
 *   for Ruleset container and AI targeting decisions.
 */
export interface WeaponInfo {
  /** Weapon name (key in the weapons dictionary). */
  readonly name: string

  /** Ticks between shots (reload delay). */
  readonly reloadDelay: number

  /** Maximum weapon range in WDist units. */
  readonly range: number

  /** Number of shots per burst. */
  readonly burst: number

  /** Projectile configurations.
   *
   * @todo Chapter 8: Replace ProjectileStub with full ProjectileInfo.
   */
  readonly projectiles?: readonly ProjectileStub[]

  /** Warhead configurations.
   *
   * @todo Chapter 8: Replace WarheadStub with full WarheadInfo.
   */
  readonly warheads?: readonly WarheadStub[]
}

/**
 * Projectile stub — minimal projectile config with optional IRulesetLoaded.
 *
 * OpenRA 对照: IProjectile interface
 *
 * @todo Chapter 8: Full ProjectileInfo migration.
 */
export interface ProjectileStub {
  /** Projectile type identifier. */
  readonly type: string

  /** Optional ruleset-loaded callback (IRulesetLoaded<WeaponInfo>).
   *
   * OpenRA 对照: IRulesetLoaded<WeaponInfo>.RulesetLoaded()
   */
  readonly rulesetLoaded?: (ruleset: Ruleset, info: WeaponInfo) => void
}

/**
 * Warhead stub — minimal warhead config with optional IRulesetLoaded.
 *
 * OpenRA 对照: IWarhead interface
 *
 * @todo Chapter 8: Full WarheadInfo migration.
 */
export interface WarheadStub {
  /** Warhead type identifier. */
  readonly type: string

  /** Optional ruleset-loaded callback (IRulesetLoaded<WeaponInfo>).
   *
   * OpenRA 对照: IRulesetLoaded<WeaponInfo>.RulesetLoaded()
   */
  readonly rulesetLoaded?: (ruleset: Ruleset, info: WeaponInfo) => void
}

/**
 * Sound information stub.
 *
 * OpenRA 对照: OpenRA.Game/SoundInfo.cs
 *
 * @todo Chapter 8: Full SoundInfo migration with audio buffer loading,
 *   distance attenuation curves, and Web Audio API integration.
 */
export interface SoundInfo {
  /** Sound identifier (key in the voices/notifications dictionary). */
  readonly name: string

  /** Volume multiplier (0 = silent, 1 = full). */
  readonly volume: number

  /** Distance attenuation factor.
   *
   * OpenRA 对照: SoundInfo.Attenuation
   */
  readonly attenuation: number
}

/**
 * Music track information stub.
 *
 * OpenRA 对照: OpenRA.Game/MusicInfo.cs
 *
 * @todo Chapter 8: Full MusicInfo migration with audio file loading,
 *   playlist management, and Web Audio API streaming.
 */
export interface MusicInfo {
  /** Music track filename. */
  readonly filename: string

  /** Volume multiplier (0 = silent, 1 = full). */
  readonly volume: number

  /** Whether the track should loop. */
  readonly loop: boolean

  /** Whether the music file exists in the file system.
   *
   * OpenRA 对照: MusicInfo.Exists
   */
  readonly exists: boolean
}

/**
 * Model sequence configuration stub.
 *
 * OpenRA 对照: MiniYamlNode (raw YAML, parsed by model renderer)
 *
 * @todo Chapter 9+: 3D model sequence definitions for Babylon.js
 *   AnimationGroup management. Currently stores raw JSON data.
 */
export interface ModelSequenceConfig {
  /** Model sequence identifier (key in the dictionary). */
  readonly name: string

  /** Raw configuration data.
   *
   * OpenRA 对照: MiniYamlNode.Value + MiniYamlNode.Nodes
   */
  readonly data: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// SystemActors — guaranteed actor types always present in every ruleset
// OpenRA 对照: OpenRA.SystemActors enum
// ---------------------------------------------------------------------------

/**
 * System actor identifiers that are always present in every ruleset.
 *
 * OpenRA 对照: SystemActors enum (Player = 0, EditorPlayer = 1, World = 2, EditorWorld = 4)
 *
 * These actors are auto-added by ActorInfoDictionary even if not defined
 * in the mod YAML. They serve as "well-known" actor types for engine
 * infrastructure (player representation, world root, editor variants).
 */
export const SystemActors = {
  Player: 'player',
  EditorPlayer: 'editorplayer',
  World: 'world',
  EditorWorld: 'editorworld',
} as const

export type SystemActor = (typeof SystemActors)[keyof typeof SystemActors]

/** All system actor names as a readonly array. */
export const SYSTEM_ACTOR_NAMES: readonly string[] = Object.values(SystemActors)

// ---------------------------------------------------------------------------
// Ruleset
// OpenRA 对照: OpenRA.Ruleset class
// ---------------------------------------------------------------------------

/**
 * Immutable container for all game rules: actors, weapons, sounds, music,
 * terrain, and model sequences.
 *
 * OpenRA 对照: OpenRA.Ruleset
 *
 * A Ruleset is constructed once during mod loading and never modified.
 * All dictionaries are exposed as ReadonlyMap for safe read-only access.
 *
 * Lifecycle:
 * ```
 * manifest + fileSystem → Ruleset.loadAsync() → Ruleset instance (frozen)
 * ```
 *
 * IRulesetLoaded: During construction, every actor trait that has a
 * `rulesetLoaded` callback is invoked, receiving a reference to the
 * fully-populated Ruleset. Weapon projectiles and warheads also receive
 * callbacks if they implement IRulesetLoaded<WeaponInfo>.
 */
export class Ruleset {
  // ---------------------------------------------------------------------------
  // Public readonly dictionaries (对应 OpenRA Ruleset readonly fields)
  // ---------------------------------------------------------------------------

  /** All actor type definitions, keyed by lowercase name.
   *
   * OpenRA 对照: Ruleset.Actors (ActorInfoDictionary)
   *
   * Includes system actors (player, editorplayer, world, editorworld)
   * auto-added if not present in the loaded rules. Abstract actors
   * (prefixed with '^') are INCLUDED for inheritance lookups
   * but are excluded from the spawnable list.
   */
  readonly actors: ReadonlyMap<string, ActorConfig>

  /** Weapon definitions, keyed by lowercase name.
   *
   * OpenRA 对照: Ruleset.Weapons
   */
  readonly weapons: ReadonlyMap<string, WeaponInfo>

  /** Voice sound definitions, keyed by lowercase name.
   *
   * OpenRA 对照: Ruleset.Voices
   */
  readonly voices: ReadonlyMap<string, SoundInfo>

  /** Notification sound definitions, keyed by lowercase name.
   *
   * OpenRA 对照: Ruleset.Notifications
   */
  readonly notifications: ReadonlyMap<string, SoundInfo>

  /** Music track definitions, keyed by track key.
   *
   * OpenRA 对照: Ruleset.Music
   */
  readonly music: ReadonlyMap<string, MusicInfo>

  /** Terrain type information (null for default ruleset without tileset).
   *
   * OpenRA 对照: Ruleset.TerrainInfo (ITerrainInfo)
   */
  readonly terrainInfo: ITerrainInfo | null

  /** Model sequence configurations, keyed by sequence key.
   *
   * OpenRA 对照: Ruleset.ModelSequences
   */
  readonly modelSequences: ReadonlyMap<string, ModelSequenceConfig>

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA Ruleset constructor)
  // ---------------------------------------------------------------------------

  /**
   * Create a Ruleset with the given dictionaries.
   *
   * OpenRA 对照: Ruleset(IReadOnlyDictionary<string, ActorInfo> actors, ...)
   *
   * During construction:
   * 1. System actors are auto-added if missing
   * 2. IRulesetLoaded callbacks are invoked on all actor traits
   * 3. IRulesetLoaded callbacks are invoked on weapon projectiles/warheads
   *
   * @param actors — actor type definitions
   * @param weapons — weapon definitions
   * @param voices — voice sound definitions
   * @param notifications — notification sound definitions
   * @param music — music track definitions
   * @param terrainInfo — terrain type information (null if no tileset)
   * @param modelSequences — model sequence configurations
   * @throws Error if any IRulesetLoaded handler throws
   */
  constructor(
    actors: ReadonlyMap<string, ActorConfig>,
    weapons: ReadonlyMap<string, WeaponInfo>,
    voices: ReadonlyMap<string, SoundInfo>,
    notifications: ReadonlyMap<string, SoundInfo>,
    music: ReadonlyMap<string, MusicInfo>,
    terrainInfo: ITerrainInfo | null,
    modelSequences: ReadonlyMap<string, ModelSequenceConfig>,
  ) {
    // ---- Step 1: Build actors dict with SystemActors auto-insertion ----
    //
    // OpenRA 对照: ActorInfoDictionary constructor — auto-adds empty
    //   ActorInfo entries for Player, EditorPlayer, World, EditorWorld
    //   if they are not already present in the loaded rules.
    const allActors = new Map(actors)
    for (const sysName of SYSTEM_ACTOR_NAMES) {
      if (!allActors.has(sysName)) {
        // Create an empty ActorConfig — system actors have no traits
        // unless specifically defined in mod YAML
        allActors.set(sysName, new ActorConfig(sysName, []))
      }
    }
    this.actors = allActors

    // ---- Step 2: Store remaining dictionaries ----
    this.weapons = weapons
    this.voices = voices
    this.notifications = notifications
    this.music = music
    this.terrainInfo = terrainInfo
    this.modelSequences = modelSequences

    // ---- Step 3: Invoke IRulesetLoaded on actor traits ----
    //
    // OpenRA 对照: foreach (var a in Actors.Values) { foreach (var t in
    //   a.TraitInfos<IRulesetLoaded>()) { t.RulesetLoaded(this, a); } }
    //
    // Iterates all actors, finds traits with rulesetLoaded callbacks,
    // and invokes them. Wraps errors with actor name for diagnostics.
    for (const actor of this.actors.values()) {
      actor.notifyRulesetLoaded(this)
    }

    // ---- Step 4: Invoke IRulesetLoaded on weapon projectiles/warheads ----
    //
    // OpenRA 对照: foreach (var weapon in Weapons) {
    //   if (weapon.Value.Projectile is IRulesetLoaded<WeaponInfo> pl) { ... }
    //   foreach (var warhead in weapon.Value.Warheads) {
    //     if (warhead is IRulesetLoaded<WeaponInfo> cacher) { ... }
    //   }
    // }
    for (const [weaponKey, weapon] of this.weapons) {
      // Invoke on projectiles
      if (weapon.projectiles) {
        for (const proj of weapon.projectiles) {
          if (proj.rulesetLoaded) {
            try {
              proj.rulesetLoaded(this, weapon)
            } catch (e) {
              throw new Error(
                `Projectile type ${weaponKey}: ${e instanceof Error ? e.message : String(e)}`,
              )
            }
          }
        }
      }

      // Invoke on warheads
      if (weapon.warheads) {
        for (const warhead of weapon.warheads) {
          if (warhead.rulesetLoaded) {
            try {
              warhead.rulesetLoaded(this, weapon)
            } catch (e) {
              throw new Error(
                `Weapon type ${weaponKey}: ${e instanceof Error ? e.message : String(e)}`,
              )
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // InstalledMusic — computed property (对应 OpenRA Ruleset.InstalledMusic)
  // ---------------------------------------------------------------------------

  /**
   * Music tracks whose audio files exist in the file system.
   *
   * OpenRA 对照: Ruleset.InstalledMusic
   *   `Music.Where(m => m.Value.Exists)`
   *
   * NOTE: Returns a new Map per access. Acceptable — this is a
   * startup/UI API, not called in render or tick loops.
   */
  get installedMusic(): ReadonlyMap<string, MusicInfo> {
    const result = new Map<string, MusicInfo>()
    for (const [key, m] of this.music) {
      if (m.exists) {
        result.set(key, m)
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // Spawnable actors — convenience (非 OpenRA，新增)
  // ---------------------------------------------------------------------------

  /**
   * Actors that can be spawned in the game (i.e., not abstract).
   *
   * OpenRA 对照: (implicit — abstract actors with '^' prefix are excluded
   *   from spawn lists by convention)
   *
   * NOTE: Returns a new Map per access. Acceptable — this is a
   * startup API, not called in render or tick loops.
   */
  get spawnableActors(): ReadonlyMap<string, ActorConfig> {
    const result = new Map<string, ActorConfig>()
    for (const [key, actor] of this.actors) {
      if (!actor.isAbstract) {
        result.set(key, actor)
      }
    }
    return result
  }

  // ---------------------------------------------------------------------------
  // mergeOrDefault — static merge helper (对应 OpenRA MergeOrDefault<T>)
  // ---------------------------------------------------------------------------

  /**
   * Merge a base dictionary with overriding entries from a child dictionary.
   *
   * OpenRA 对照: Ruleset.MergeOrDefault<T>(string name, IReadOnlyFileSystem,
   *   IEnumerable<string> files, MiniYaml additional,
   *   IReadOnlyDictionary<string, T> defaults,
   *   Func<MiniYamlNode, T> makeObject,
   *   Func<MiniYamlNode, bool> filterNode)
   *
   * In the C# version, this loads YAML files, parses them, and merges.
   * In our TypeScript version, JSON parsing is done externally — this
   * method handles the merge step only. Child entries override parent
   * entries with a console.warn on conflicts.
   *
   * @param base — base dictionary (defaults), or null
   * @param child — child dictionary (overrides)
   * @param category — human-readable category name for conflict logging
   * @returns merged map (new instance)
   */
  static mergeOrDefault<T>(
    base: ReadonlyMap<string, T> | null,
    child: ReadonlyMap<string, T>,
    category: string,
  ): ReadonlyMap<string, T> {
    if (!base) return child

    const merged = new Map(base)
    for (const [key, value] of child) {
      if (merged.has(key)) {
        // OpenRA 对照: ToDictionaryWithConflictLog — logs conflicts
        console.warn(
          `[Ruleset] ${category}: key '${key}' overridden by child.`,
        )
      }
      merged.set(key, value)
    }
    return merged
  }

  // ---------------------------------------------------------------------------
  // loadAsync — load ruleset from manifest + file system
  // OpenRA 对照: Ruleset.LoadDefaults(ModData) + Ruleset.Load(ModData, ...)
  // ---------------------------------------------------------------------------

  /**
   * Load a complete Ruleset from a mod manifest and file system.
   *
   * OpenRA 对照: Ruleset.LoadDefaults(ModData) — loads all 7 dictionaries
   *   from manifest via MergeOrDefault
   *
   * Loading sequence:
   * 1. Load actors from rules JSON files
   * 2. Load weapons from weapon JSON files
   * 3. Load voices, notifications, music from respective JSON files
   * 4. Load model sequences
   * 5. Create Ruleset instance (which invokes IRulesetLoaded)
   *
   * Abstract actors (prefixed with '^') are included in the actors
   * dictionary for inheritance resolution but excluded from spawnableActors.
   *
   * @param manifest — mod manifest with rule file lists
   * @param fileSystem — virtual file system to read JSON files from
   * @param terrainInfo — terrain information (null for default ruleset)
   * @returns fully constructed Ruleset
   * @throws Error if any required JSON file cannot be parsed
   */
  static async loadAsync(
    manifest: Manifest,
    fileSystem: IReadOnlyFileSystem,
    terrainInfo: ITerrainInfo | null = null,
  ): Promise<Ruleset> {
    // ---- Load actors from rules JSON files ----
    //
    // OpenRA 对照: MergeOrDefault("Manifest,Rules", fs, m.Rules, null, null,
    //   k => new ActorInfo(...), filterNode: ...StartsWith(AbstractActorPrefix))
    //
    // In C#, the filterNode excludes abstract actors from the result.
    // In our TS version, we load ALL actors (including abstracts) for
    // inheritance resolution, but ActorConfig.isAbstract marks them.
    const actors = await Ruleset._loadActorDict(manifest, fileSystem)

    // ---- Load weapons ----
    //
    // OpenRA 对照: MergeOrDefault("Manifest,Weapons", fs, m.Weapons, ...)
    const weapons = await Ruleset._loadSimpleDict<WeaponInfo>(
      manifest.weapons,
      fileSystem,
      'Weapons',
      (json) => Ruleset._parseWeaponInfo(json),
    )

    // ---- Load voices ----
    //
    // OpenRA 对照: MergeOrDefault("Manifest,Voices", fs, m.Voices, ...)
    const voices = await Ruleset._loadSimpleDict<SoundInfo>(
      manifest.voices,
      fileSystem,
      'Voices',
      (json) => Ruleset._parseSoundInfo(json),
    )

    // ---- Load notifications ----
    //
    // OpenRA 对照: MergeOrDefault("Manifest,Notifications", ...)
    const notifications = await Ruleset._loadSimpleDict<SoundInfo>(
      manifest.notifications,
      fileSystem,
      'Notifications',
      (json) => Ruleset._parseSoundInfo(json),
    )

    // ---- Load music ----
    //
    // OpenRA 对照: MergeOrDefault("Manifest,Music", fs, m.Music, ...)
    const music = await Ruleset._loadSimpleDict<MusicInfo>(
      manifest.music,
      fileSystem,
      'Music',
      (json) => Ruleset._parseMusicInfo(json),
    )

    // ---- Load model sequences ----
    //
    // OpenRA 对照: MergeOrDefault("Manifest,ModelSequences", ...)
    // In C#, model sequences are stored as raw MiniYamlNode (k => k).
    // In TS, we store them as ModelSequenceConfig with raw data.
    const modelSequences = await Ruleset._loadSimpleDict<ModelSequenceConfig>(
      manifest.modelSequences,
      fileSystem,
      'ModelSequences',
      (json) => Ruleset._parseModelSequenceConfig(json),
    )

    return new Ruleset(
      actors,
      weapons,
      voices,
      notifications,
      music,
      terrainInfo,
      modelSequences,
    )
  }

  // ---------------------------------------------------------------------------
  // dispose — cleanup (对应 OpenRA IDisposable pattern)
  // ---------------------------------------------------------------------------

  /**
   * Release resources held by this ruleset.
   *
   * OpenRA 对照: (implicit — Ruleset does not implement IDisposable in C#;
   *   disposal is handled by ModData. We add dispose() for consistency
   *   with the project's resource management pattern.)
   *
   * NOTE: ActorConfigs are immutable data and do not hold GPU resources,
   * so dispose() only clears internal references to allow GC.
   */
  dispose(): void {
    // ActorConfigs are frozen data structures — no explicit cleanup needed.
    // This method exists for API consistency and future-proofing.
    // When WeaponInfo/SoundInfo/MusicInfo gain full implementations with
    // GPU/audio resources, their disposal will be handled here.
  }

  // =========================================================================
  // Private: JSON file loading helpers
  // =========================================================================

  // TODO-6.C.3: Implement DefinesUnsafeCustomRules() — checks if a map
  //   defines unsafe custom rules (weapon/voice/notification overrides,
  //   or non-ILobbyCustomRulesIgnore trait overrides). Used by server
  //   lobby validation to flag potentially unsafe custom maps.
  //   OpenRA 对照: Ruleset.DefinesUnsafeCustomRules(ModData, IReadOnlyFileSystem, ...)
  //
  // TODO-6.C.4: Implement AnyFlaggedTraits() — iterates actor trait
  //   overrides and checks whether any trait type does NOT implement
  //   ILobbyCustomRulesIgnore. Returns true if unsafe traits found.
  //   OpenRA 对照: Ruleset.AnyFlaggedTraits(ModData, IEnumerable<MiniYamlNode>)
  //
  // Both are deferred because they depend on:
  // - ObjectCreator.FindType() for trait type lookup
  // - ILobbyCustomRulesIgnore interface (defined in TraitsInterfaces.ts)
  // - Server lobby infrastructure (not yet migrated)

  /**
   * Load actor configurations from all rules JSON files.
   *
   * Two-pass approach:
   * 1. First pass: load all ActorJSON entries into a temp map (for inheritance)
   * 2. Second pass: construct ActorConfig from each entry with allConfigs
   *
   * Abstract actors (prefixed with '^') are included in the result
   * but marked with isAbstract=true for filtering by spawnableActors.
   */
  private static async _loadActorDict(
    manifest: Manifest,
    fileSystem: IReadOnlyFileSystem,
  ): Promise<ReadonlyMap<string, ActorConfig>> {
    // First pass: collect all ActorJSON entries
    const allJSONs = new Map<string, ActorJSON>()

    for (const rulesFile of manifest.rules) {
      const data = await fileSystem.openAsync(rulesFile)
      if (!data) {
        console.warn(`[Ruleset] Rules file not found: ${rulesFile}`)
        continue
      }

      const text = new TextDecoder().decode(data)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (e) {
        throw new Error(
          `Failed to parse rules file '${rulesFile}': ${e instanceof Error ? e.message : String(e)}`,
        )
      }

      // The JSON file should contain an array of ActorJSON entries
      const entries = Array.isArray(parsed) ? parsed : [parsed]
      for (const entry of entries) {
        if (entry && typeof entry === 'object' && typeof (entry as ActorJSON).name === 'string') {
          const aJson = entry as ActorJSON
          const name = aJson.name.toLowerCase()

          // Normalize inherits references to lowercase for case-insensitive
          // lookup in allConfigs. OpenRA treats actor names as
          // case-insensitive (YAML keys are lowercased).
          if (aJson.inherits && Array.isArray(aJson.inherits)) {
            aJson.inherits = aJson.inherits.map((p: string) => p.toLowerCase())
          }

          if (allJSONs.has(name)) {
            console.warn(
              `[Ruleset] Rules: duplicate actor '${name}' in ${rulesFile} — later definition overrides earlier.`,
            )
          }
          allJSONs.set(name, aJson)
        }
      }
    }

    // Second pass: construct ActorConfig for each entry
    const actorMap = new Map<string, ActorConfig>()
    for (const [name, json] of allJSONs) {
      try {
        const config = ActorConfig.fromJSON(json, allJSONs)
        actorMap.set(name, config)
      } catch (e) {
        throw new Error(
          `Failed to construct ActorConfig for '${name}': ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }

    return actorMap
  }

  /**
   * Load a simple dictionary from JSON files.
   *
   * Each file should contain either:
   * - An array of entries, each with a 'name' field
   * - A single object with keys as entry names
   *
   * @param files — list of file paths from manifest
   * @param fileSystem — virtual file system
   * @param category — human-readable category for error messages
   * @param parse — function to parse each raw JSON node into T
   * @returns loaded and merged dictionary
   */
  private static async _loadSimpleDict<T>(
    files: readonly string[],
    fileSystem: IReadOnlyFileSystem,
    category: string,
    parse: (json: Record<string, unknown>) => T,
  ): Promise<ReadonlyMap<string, T>> {
    const result = new Map<string, T>()

    for (const file of files) {
      const data = await fileSystem.openAsync(file)
      if (!data) {
        console.warn(`[Ruleset] ${category} file not found: ${file}`)
        continue
      }

      const text = new TextDecoder().decode(data)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (e) {
        throw new Error(
          `Failed to parse ${category} file '${file}': ${e instanceof Error ? e.message : String(e)}`,
        )
      }

      if (Array.isArray(parsed)) {
        // Array of entries, each with a name
        for (const entry of parsed) {
          if (entry && typeof entry === 'object') {
            const obj = entry as Record<string, unknown>
            const name = String(obj.name ?? '').toLowerCase()
            if (!name) continue

            if (result.has(name)) {
              console.warn(
                `[Ruleset] ${category}: duplicate entry '${name}' in ${file} — later overrides earlier.`,
              )
            }

            try {
              result.set(name, parse(obj))
            } catch (e) {
              throw new Error(
                `Failed to parse ${category} entry '${name}' in '${file}': ${e instanceof Error ? e.message : String(e)}`,
              )
            }
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        // Object with keys as entry names
        const obj = parsed as Record<string, unknown>
        for (const [key, value] of Object.entries(obj)) {
          const name = key.toLowerCase()
          if (result.has(name)) {
            console.warn(
              `[Ruleset] ${category}: duplicate entry '${name}' in ${file} — later overrides earlier.`,
            )
          }
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const entryObj = {
              name: key,
              ...(value as Record<string, unknown>),
            }
            try {
              result.set(name, parse(entryObj))
            } catch (e) {
              throw new Error(
                `Failed to parse ${category} entry '${name}' in '${file}': ${e instanceof Error ? e.message : String(e)}`,
              )
            }
          }
        }
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Private: JSON parsing helpers for stub interfaces
  // ---------------------------------------------------------------------------

  /**
   * Parse a WeaponInfo from a JSON object.
   *
   * OpenRA 对照: new WeaponInfo(key, MiniYaml value)
   */
  private static _parseWeaponInfo(json: Record<string, unknown>): WeaponInfo {
    const name = String(json.name ?? '')
    const reloadDelay = typeof json.reloadDelay === 'number' ? json.reloadDelay : 0
    const range = typeof json.range === 'number' ? json.range : 0
    const burst = typeof json.burst === 'number' ? json.burst : 1

    // Parse projectiles if present
    let projectiles: ProjectileStub[] | undefined
    if (Array.isArray(json.projectiles)) {
      projectiles = json.projectiles.map((p: unknown) => {
        const proj = p as Record<string, unknown>
        return {
          type: String(proj.type ?? proj.name ?? ''),
          // NOTE: rulesetLoaded is not serialized — it is attached at
          // runtime by the trait system when the projectile implements
          // IRulesetLoaded. For JSON-loaded data, this is null.
        } satisfies ProjectileStub
      })
    }

    // Parse warheads if present
    let warheads: WarheadStub[] | undefined
    if (Array.isArray(json.warheads)) {
      warheads = json.warheads.map((w: unknown) => {
        const wh = w as Record<string, unknown>
        return {
          type: String(wh.type ?? wh.name ?? ''),
          // NOTE: rulesetLoaded is not serialized — see note above.
        } satisfies WarheadStub
      })
    }

    return { name, reloadDelay, range, burst, projectiles, warheads }
  }

  /**
   * Parse a SoundInfo from a JSON object.
   *
   * OpenRA 对照: new SoundInfo(MiniYaml value)
   */
  private static _parseSoundInfo(json: Record<string, unknown>): SoundInfo {
    return {
      name: String(json.name ?? ''),
      volume: typeof json.volume === 'number' ? json.volume : 1,
      attenuation: typeof json.attenuation === 'number' ? json.attenuation : 1,
    }
  }

  /**
   * Parse a MusicInfo from a JSON object.
   *
   * OpenRA 对照: new MusicInfo(key, MiniYaml value)
   */
  private static _parseMusicInfo(json: Record<string, unknown>): MusicInfo {
    return {
      filename: String(json.filename ?? ''),
      volume: typeof json.volume === 'number' ? json.volume : 1,
      loop: typeof json.loop === 'boolean' ? json.loop : false,
      exists: typeof json.exists === 'boolean' ? json.exists : true,
    }
  }

  /**
   * Parse a ModelSequenceConfig from a JSON object.
   *
   * OpenRA 对照: identity function (k => k) — raw MiniYamlNode stored as-is
   */
  private static _parseModelSequenceConfig(
    json: Record<string, unknown>,
  ): ModelSequenceConfig {
    const { name: _name, ...rest } = json
    return {
      name: String(json.name ?? ''),
      data: rest,
    }
  }
}
