/**
 * MusicInfo.ts — Background music track configuration
 * OpenRA 对照: OpenRA.Game/GameRules/MusicInfo.cs (65 lines)
 *
 * 核心范式转换:
 * - C# MusicInfo(string key, MiniYaml value) constructor
 *   → static fromJSON(key, json) factory
 * - C# FieldLoader.GetValue<T>() for scalar extraction
 *   → explicit JSON field extraction with type coercion
 * - C# ISoundLoader.TryParseSound() for audio duration detection
 *   → TODO-8.C.DEFER-3: browser Audio element provides duration natively
 * - C# IReadOnlyFileSystem.TryOpen(filename) synchronous stream
 *   → IReadOnlyFileSystem.exists() + existsAsync() for browser VFS
 *
 * ## Deferred Features
 * - TODO-8.C.DEFER-3: Audio duration detection from file contents.
 *   In C# this uses ISoundLoader.TryParseSound(). In TS,
 *   the browser Audio element provides duration natively.
 *   The `load()` method currently only checks file existence.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { IReadOnlyFileSystem } from '../FileSystem/IPackage.js'

// ---------------------------------------------------------------------------
// MusicInfo
// OpenRA 对照: OpenRA.GameRules.MusicInfo (65 lines)
// ---------------------------------------------------------------------------

/**
 * Background music track configuration.
 *
 * OpenRA 对照: OpenRA.GameRules.MusicInfo
 *
 * Describes a single music track with file reference, volume,
 * and visibility settings. Length and Existence are determined
 * by loading the audio file at runtime.
 */
export class MusicInfo {
  /** Audio file path (with extension).
   *  OpenRA: MusicInfo.Filename */
  readonly filename: string

  /** Human-readable track title.
   *  OpenRA: MusicInfo.Title */
  readonly title: string

  /** Whether the track is hidden in the music player UI.
   *  OpenRA: MusicInfo.Hidden */
  readonly hidden: boolean

  /** Volume modifier for this track (1.0 = full).
   *  OpenRA: MusicInfo.VolumeModifier */
  readonly volumeModifier: number

  /** Track length in seconds (set after load()).
   *  OpenRA: MusicInfo.Length */
  length: number = 0

  /** Whether the audio file exists in the file system.
   *  OpenRA: MusicInfo.Exists */
  exists: boolean = false

  // ---------------------------------------------------------------------------
  // Private constructor
  // ---------------------------------------------------------------------------

  /**
   * Private constructor — use fromJSON() factory.
   *
   * OpenRA 对照: MusicInfo(string key, MiniYaml value)
   */
  private constructor(fields: {
    filename: string
    title: string
    hidden: boolean
    volumeModifier: number
  }) {
    this.filename = fields.filename
    this.title = fields.title
    this.hidden = fields.hidden
    this.volumeModifier = fields.volumeModifier
  }

  // ---------------------------------------------------------------------------
  // fromJSON() factory
  // ---------------------------------------------------------------------------

  /**
   * Create MusicInfo from JSON.
   *
   * OpenRA 对照: new MusicInfo(string key, MiniYaml value)
   *
   * The C# constructor performs field extraction:
   * - Title = value.Value (the YAML value after the key)
   * - Hidden = parsed from 'Hidden' node
   * - VolumeModifier = parsed from 'VolumeModifier' node
   * - Extension = parsed from 'Extension' node (default 'aud')
   * - Filename = (Filename node || key) + '.' + Extension
   *
   * JSON Format:
   * ```json
   * {
   *   "name": "bigf226m",
   *   "Title": "Hell March",
   *   "Value": "Hell March",
   *   "Hidden": true,
   *   "VolumeModifier": 0.8,
   *   "Extension": "aud",
   *   "Filename": "hellmarch"
   * }
   * ```
   *
   * @param key — the music track key (from the music dictionary)
   * @param json — the parsed JSON value for this track
   * @returns fully constructed MusicInfo (length=0, exists=false until load())
   */
  static fromJSON(key: string, json: Record<string, unknown>): MusicInfo {
    // Title: json.Value (C# value.Value) || json.Title || key
    const title = typeof json.Value === 'string'
      ? json.Value
      : (typeof json.Title === 'string' ? json.Title : key)

    // Hidden: parse boolean
    let hidden = false
    if (json.Hidden !== undefined) {
      if (typeof json.Hidden === 'boolean') {
        hidden = json.Hidden
      } else {
        hidden = String(json.Hidden).toLowerCase() === 'true'
      }
    }

    // VolumeModifier: parse float
    let volumeModifier = 1.0
    if (typeof json.VolumeModifier === 'number') {
      volumeModifier = json.VolumeModifier
    }

    // Extension: default 'aud'
    const extension = typeof json.Extension === 'string'
      ? json.Extension : 'aud'

    // Base filename: Filename || key
    const baseName = typeof json.Filename === 'string'
      ? json.Filename : key

    // Compose full filename
    const filename = baseName.includes('.')
      ? baseName
      : `${baseName}.${extension}`

    return new MusicInfo({
      filename,
      title,
      hidden,
      volumeModifier,
    })
  }

  // ---------------------------------------------------------------------------
  // load() method
  // ---------------------------------------------------------------------------

  /**
   * Load the audio file to determine length and existence.
   *
   * OpenRA 对照: MusicInfo.Load(IReadOnlyFileSystem)
   *
   * In C#:
   * 1. Try to open the file via fileSystem.TryOpen()
   * 2. If not found, return (exists stays false)
   * 3. Try each SoundLoader to parse audio duration
   * 4. Set Exists = true and Length = parsed duration
   *
   * In TypeScript (browser):
   * 1. Check existence via fileSystem.exists() (synchronous)
   * 2. Set Exists = true/false
   * 3. Duration will be set via TODO-8.C.DEFER-3
   *
   * TODO-8.C.DEFER-3: Audio duration detection from file contents.
   * In C# this uses ISoundLoader.TryParseSound(). In TS,
   * the browser Audio element provides duration natively.
   *
   * @param fileSystem — the virtual file system
   */
  load(fileSystem: IReadOnlyFileSystem): void {
    if (!fileSystem.exists(this.filename)) {
      this.exists = false
      return
    }

    this.exists = true
    // TODO-8.C.DEFER-3: Parse audio duration from file contents
    // or use browser Audio element to detect length.
    this.length = 0
  }

  /**
   * Async version of load() for environments where exists() is async.
   *
   * OpenRA 对照: MusicInfo.Load(IReadOnlyFileSystem) — C# is synchronous
   * but TS has async file system operations.
   *
   * @param fileSystem — the virtual file system
   */
  async loadAsync(fileSystem: IReadOnlyFileSystem): Promise<void> {
    // Try to open the file to check existence
    try {
      const data = await fileSystem.openAsync(this.filename)
      if (!data) {
        this.exists = false
        return
      }
      this.exists = true
      // TODO-8.C.DEFER-3: Parse audio duration
      this.length = 0
    } catch {
      this.exists = false
    }
  }
}
