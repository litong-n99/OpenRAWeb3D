/**
 * SoundInfo.ts — Sound configuration data for voice and notification pools
 * OpenRA 对照: OpenRA.Game/GameRules/SoundInfo.cs (97 lines)
 *
 * 核心范式转换:
 * - C# FrozenDictionary for Variants/Prefixes/Voices/Notifications
 *   → ReadonlyMap<string, readonly string[]> (immutable after construction)
 * - C# Lazy<FrozenDictionary<string, SoundPool>> for lazy pool construction
 *   → getter-based lazy initialization with private _voicePools / _notificationsPools
 * - C# SoundPool inner class defined in SoundInfo.cs
 *   → TypeScript: SoundPool class from Sound.ts imported (ADR-8.C.4)
 * - C# FieldLoader.Load() from MiniYaml
 *   → static fromJSON() factory with explicit field extraction
 *
 * ADR-8.C.4: SoundPool and InterruptType are imported from Sound.ts.
 * No duplication. The SoundInfo class constructs SoundPool instances
 * using the existing SoundPool class.
 *
 * ## Deferred Features
 * - TODO-8.C.DEFER-5: Notification pools per-definition VolumeModifier/InterruptType
 *   overrides from raw YAML structure. Currently builds simple pools with defaults.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { SoundPool, InterruptType } from '../Sound/Sound.js'

// ---------------------------------------------------------------------------
// SoundInfo
// OpenRA 对照: OpenRA.GameRules.SoundInfo (97 lines)
// ---------------------------------------------------------------------------

/**
 * Sound configuration data for voice and notification pools.
 *
 * OpenRA 对照: OpenRA.GameRules.SoundInfo
 *
 * SoundInfo defines:
 * - Variant/Prefix mappings for unit voice variations
 * - Voice pools (unit responses like "Move", "Attack")
 * - Notification pools (UI notifications like "UnitReady", "BuildingCaptured")
 *
 * The voice/notification pools use lazy construction of SoundPool instances
 * to avoid creating pools that may never be used (matching C# Lazy<> pattern).
 *
 * ## Relationship with Sound.ts
 *
 * The existing `SoundInfo` interface in `Sound.ts` is compatible with this class.
 * This class supersedes that interface. Sound.ts may re-export or import from here.
 */
export class SoundInfo {
  // ---------------------------------------------------------------------------
  // Config fields (matching C# SoundInfo fields exactly)
  // ---------------------------------------------------------------------------

  /** Variant suffix mappings (variantId → suffix array).
   *  OpenRA: SoundInfo.Variants */
  readonly variants: ReadonlyMap<string, readonly string[]>

  /** Prefix mappings (variantId → prefix array).
   *  OpenRA: SoundInfo.Prefixes */
  readonly prefixes: ReadonlyMap<string, readonly string[]>

  /** Voice definitions (voiceName → clipName array).
   *  OpenRA: SoundInfo.Voices */
  readonly voices: ReadonlyMap<string, readonly string[]>

  /** Notification definitions (notifName → clipName array).
   *  OpenRA: SoundInfo.Notifications */
  readonly notifications: ReadonlyMap<string, readonly string[]>

  /** Default audio file extension.
   *  OpenRA: SoundInfo.DefaultVariant (default ".aud") */
  readonly defaultVariant: string

  /** Default audio file prefix.
   *  OpenRA: SoundInfo.DefaultPrefix (default "") */
  readonly defaultPrefix: string

  /** Variant definitions that are disabled.
   *  OpenRA: SoundInfo.DisableVariants */
  readonly disableVariants: ReadonlySet<string>

  /** Prefix definitions that are disabled.
   *  OpenRA: SoundInfo.DisablePrefixes */
  readonly disablePrefixes: ReadonlySet<string>

  // ---------------------------------------------------------------------------
  // Lazy-constructed pools
  // ---------------------------------------------------------------------------

  /** Lazily-constructed voice pools (definitionKey → SoundPool).
   *  OpenRA: SoundInfo.VoicePools (Lazy<FrozenDictionary<string, SoundPool>>) */
  private _voicePools: ReadonlyMap<string, SoundPool> | null = null

  /** Lazily-constructed notification pools (definitionKey → SoundPool).
   *  OpenRA: SoundInfo.NotificationsPools */
  private _notificationsPools: ReadonlyMap<string, SoundPool> | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Construct SoundInfo with the given configuration.
   *
   * OpenRA 对照: SoundInfo(MiniYaml y)
   *
   * @param fields — configuration data
   */
  constructor(fields: {
    variants: ReadonlyMap<string, readonly string[]>
    prefixes: ReadonlyMap<string, readonly string[]>
    voices: ReadonlyMap<string, readonly string[]>
    notifications: ReadonlyMap<string, readonly string[]>
    defaultVariant?: string
    defaultPrefix?: string
    disableVariants?: ReadonlySet<string>
    disablePrefixes?: ReadonlySet<string>
  }) {
    this.variants = fields.variants
    this.prefixes = fields.prefixes
    this.voices = fields.voices
    this.notifications = fields.notifications
    this.defaultVariant = fields.defaultVariant ?? '.aud'
    this.defaultPrefix = fields.defaultPrefix ?? ''
    this.disableVariants = fields.disableVariants ?? new Set()
    this.disablePrefixes = fields.disablePrefixes ?? new Set()
  }

  // ---------------------------------------------------------------------------
  // Lazy pool accessors (matching C# Lazy<> pattern)
  // ---------------------------------------------------------------------------

  /** Voice pool accessor (lazy-constructed on first access).
   *
   * OpenRA 对照: SoundInfo.VoicePools.Value */
  get voicePools(): ReadonlyMap<string, SoundPool> {
    if (this._voicePools === null) {
      this._voicePools = this._buildSimplePools(this.voices)
    }
    return this._voicePools
  }

  /** Notification pool accessor (lazy-constructed on first access).
   *
   * OpenRA 对照: SoundInfo.NotificationsPools.Value
   *
   * TODO-8.C.DEFER-5: Notification pools in C# support per-definition
   * VolumeModifier and InterruptType overrides parsed from raw YAML.
   * Current implementation builds simple pools with default volume (1.0)
   * and default interrupt type (DoNotPlay). */
  get notificationsPools(): ReadonlyMap<string, SoundPool> {
    if (this._notificationsPools === null) {
      this._notificationsPools = this._buildSimplePools(this.notifications)
    }
    return this._notificationsPools
  }

  // ---------------------------------------------------------------------------
  // fromJSON() factory
  // ---------------------------------------------------------------------------

  /**
   * Parse SoundInfo from a JSON object.
   *
   * OpenRA 对照: new SoundInfo(MiniYaml y) + FieldLoader.Load()
   *
   * JSON format:
   * ```json
   * {
   *   "Variants": { "default": [".aud"] },
   *   "Prefixes": { "default": [""] },
   *   "Voices": {
   *     "Move": ["move1.aud", "move2.aud"],
   *     "Attack": ["attack1.aud"]
   *   },
   *   "Notifications": {
   *     "UnitReady": ["ready.aud"]
   *   },
   *   "DefaultVariant": ".aud",
   *   "DefaultPrefix": "",
   *   "DisableVariants": ["alt"],
   *   "DisablePrefixes": []
   * }
   * ```
   *
   * @param json — parsed JSON from sounds.yaml
   * @returns fully constructed SoundInfo
   */
  static fromJSON(json: Record<string, unknown>): SoundInfo {
    const parseStringArrayMap = (
      key: string,
    ): ReadonlyMap<string, readonly string[]> => {
      const map = new Map<string, readonly string[]>()
      const obj = json[key] as Record<string, unknown> | undefined
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          if (Array.isArray(v)) {
            map.set(k, v.map(item => String(item)))
          }
        }
      }
      return map
    }

    return new SoundInfo({
      variants: parseStringArrayMap('Variants'),
      prefixes: parseStringArrayMap('Prefixes'),
      voices: parseStringArrayMap('Voices'),
      notifications: parseStringArrayMap('Notifications'),
      defaultVariant: typeof json.DefaultVariant === 'string'
        ? json.DefaultVariant : undefined,
      defaultPrefix: typeof json.DefaultPrefix === 'string'
        ? json.DefaultPrefix : undefined,
      disableVariants: Array.isArray(json.DisableVariants)
        ? new Set(json.DisableVariants.map(s => String(s)))
        : undefined,
      disablePrefixes: Array.isArray(json.DisablePrefixes)
        ? new Set(json.DisablePrefixes.map(s => String(s)))
        : undefined,
    })
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build simple SoundPool instances from a definition map.
   *
   * All pools use default volume (1.0) and default interrupt type (DoNotPlay).
   *
   * TODO-8.C.DEFER-5: Support per-definition VolumeModifier and InterruptType
   * overrides from raw notification YAML structure.
   */
  private _buildSimplePools(
    source: ReadonlyMap<string, readonly string[]>,
  ): ReadonlyMap<string, SoundPool> {
    const pools = new Map<string, SoundPool>()
    for (const [key, clips] of source) {
      pools.set(
        key,
        new SoundPool(1.0, SoundPool.DefaultInterruptType, clips),
      )
    }
    return pools
  }
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

/**
 * Re-export SoundPool and InterruptType from Sound.ts for convenience.
 * ADR-8.C.4: These types are the single source of truth in Sound.ts.
 */
export { SoundPool, InterruptType }
