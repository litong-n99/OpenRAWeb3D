/**
 * ClassicTilesetSpecificSpriteSequence.ts — 地形集特定的经典精灵序列
 * OpenRA 对照: OpenRA.Mods.Cnc/Graphics/ClassicTilesetSpecificSpriteSequence.cs (95 lines)
 *
 * 核心范式转换:
 * - C# ClassicSpriteSequence (base class) → TS ClassicSpriteSequence extends
 * - C# TilesetFilenames / TilesetFilenamesPattern static fields → TS config overrides
 * - C# ParseFilenames / ParseCombineFilenames virtual override → TS override methods
 * - C# Yield return ReservationInfo → TS array accumulation
 * - C# MiniYaml parse → TS JSON config with tileset-specific override objects
 *
 * 地形集特定的序列允许同一序列在不同地形上有不同的文件名。
 * 例如，"idle" 在沙漠地形集上可能使用 "unit-desert.shp" 而非 "unit.shp"。
 * 通过 tilesetFilenames 和 tilesetFilenamesPattern 字典来定义。
 *
 * 依赖: ClassicSpriteSequence.ts (基类)
 */

import {
  ClassicSpriteSequence,
  type ClassicSpriteSequenceConfig,
  ClassicSpriteSequenceLoader,
} from './ClassicSpriteSequence.js'

// ---------------------------------------------------------------------------
// Extended config for tileset-specific sequences
// ---------------------------------------------------------------------------

/** Configuration values for a tileset-specific classic sprite sequence.
 *
 * OpenRA 对照: ClassicTilesetSpecificSpriteSequence static fields
 */
export interface ClassicTilesetSpecificSpriteSequenceConfig
  extends ClassicSpriteSequenceConfig {
  /** Dictionary of <tileset name>: filename to override the base filename.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequence.TilesetFilenames
   */
  tilesetFilenames?: Record<string, string>

  /** Dictionary of <tileset name>: <filename pattern> to override the FilenamePattern.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequence.TilesetFilenamesPattern
   */
  tilesetFilenamesPattern?: Record<string, string>

  /** Pattern-based overrides: per-tileset pattern with start and count.
   *
   * OpenRA 对照: parsed from TilesetFilenamesPattern MiniYaml
   */
  tilesetFilenamePatterns?: Record<
    string,
    { value: string; start?: number; count?: number }
  >
}

/** Minimal ModData interface for filename resolution.
 *
 * OpenRA 对照: ModData
 */
export interface ITilesetModData {
  readonly manifest: { readonly id: string }
}

// ---------------------------------------------------------------------------
// Reservation info (from DefaultSpriteSequence / ClassicSpriteSequence)
// ---------------------------------------------------------------------------

/** Information about a sprite reservation.
 *
 * OpenRA 对照: DefaultSpriteSequence.ReservationInfo
 */
export interface ReservationInfo {
  /** The filename to load. */
  readonly filename: string
  /** Load frames indices. */
  readonly loadFrames: readonly number[]
  /** Explicit frame mapping. */
  readonly frames: readonly number[]
  /** Location reference for the source yaml node. */
  readonly location: { x: number; y: number }
}

// ---------------------------------------------------------------------------
// ClassicTilesetSpecificSpriteSequence
// ---------------------------------------------------------------------------

/** A classic sprite sequence with tileset-specific variant overrides.
 *
 * OpenRA 对照: ClassicTilesetSpecificSpriteSequence : ClassicSpriteSequence
 *
 * Extends ClassicSpriteSequence to support tileset-dependent filename
 * overrides. When a tileset name is provided, overrides the base filename
 * with the tileset-specific one from the tilesetFilenames or
 * tilesetFilenamesPattern dictionaries.
 */
export class ClassicTilesetSpecificSpriteSequence extends ClassicSpriteSequence {
  /** Dictionary of <tileset name>: filename override.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequence.TilesetFilenames
   */
  readonly tilesetFilenames: Readonly<Record<string, string>> | null

  /** Dictionary of <tileset name>: filename pattern override.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequence.TilesetFilenamesPattern
   */
  readonly tilesetFilenamesPattern: Readonly<Record<string, string>> | null

  /** Extended pattern overrides with start/count.
   *
   * OpenRA 对照: parsed from TilesetFilenamesPattern MiniYaml node
   */
  readonly tilesetFilenamePatterns: Record<
    string, { value: string; start?: number; count?: number }
  > | null

  constructor(
    image: string,
    sequence: string,
    data: ClassicTilesetSpecificSpriteSequenceConfig,
    defaults: ClassicSpriteSequenceConfig = {},
  ) {
    super(image, sequence, data, defaults)

    this.tilesetFilenames = data.tilesetFilenames ?? null
    this.tilesetFilenamesPattern = data.tilesetFilenamesPattern ?? null
    this.tilesetFilenamePatterns = data.tilesetFilenamePatterns ?? null
  }

  // -------------------------------------------------------------------------
  // ParseFilenames (对照 C# ParseFilenames override)
  // -------------------------------------------------------------------------

  /** Parse filenames, checking for tileset-specific overrides.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequence.ParseFilenames(ModData, string, ImmutableArray<int>, MiniYaml, MiniYaml)
   *
   * @param _modData — the mod data
   * @param tileset — the active tileset name
   * @param _frames — frame indices (from base)
   * @returns reservation info
   */
  parseFilenames(
    _modData: ITilesetModData | null,
    tileset: string,
    _frames: readonly number[],
  ): ReservationInfo[] {
    // Check TilesetFilenamesPattern first (higher priority in C# order)
    if (this.tilesetFilenamePatterns && tileset) {
      const patternEntry = this.tilesetFilenamePatterns[tileset]
      if (patternEntry) {
        const start = patternEntry.start ?? 0
        const count = patternEntry.count ?? 1
        const frames: number[] = []
        for (let i = 0; i < count; i++) {
          frames.push(start + i)
        }
        return [
          {
            filename: patternEntry.value,
            loadFrames: this.length > 0 ? frames : [this.length],
            frames,
            location: { x: 0, y: 0 },
          },
        ]
      }
    }

    // Check TilesetFilenames override
    if (this.tilesetFilenames && tileset) {
      const tilesetFilename = this.tilesetFilenames[tileset]
      if (tilesetFilename) {
        const frames = this.calculateFrameIndices()
        return [
          {
            filename: tilesetFilename,
            loadFrames: frames,
            frames,
            location: { x: 0, y: 0 },
          },
        ]
      }
    }

    // Fall through to base
    return this.baseParseFilenames()
  }

  // -------------------------------------------------------------------------
  // ParseCombineFilenames (对照 C# ParseCombineFilenames override)
  // -------------------------------------------------------------------------

  /** Parse combine filenames with tileset-specific overrides.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequence.ParseCombineFilenames
   *
   * @param _modData — the mod data
   * @param tileset — the active tileset name
   * @param frames — frame indices (may be null)
   * @returns reservation info
   */
  parseCombineFilenames(
    _modData: ITilesetModData | null,
    tileset: string,
    frames: readonly number[] | null,
  ): ReservationInfo[] {
    // Check TilesetFilenames for combine sections
    if (this.tilesetFilenames && tileset) {
      const tilesetFilename = this.tilesetFilenames[tileset]
      if (tilesetFilename) {
        const resolvedFrames = frames ?? this.calculateFrameIndices()
        return [
          {
            filename: tilesetFilename,
            loadFrames: resolvedFrames,
            frames: resolvedFrames,
            location: { x: 0, y: 0 },
          },
        ]
      }
    }

    // Fall through to base
    return this.baseParseCombineFilenames(frames)
  }

  // -------------------------------------------------------------------------
  // Base delegation (default implementation when no tileset override)
  // -------------------------------------------------------------------------

  /** Base filename parsing (non-tileset-specific).
   *
   * OpenRA 对照: DefaultSpriteSequence.ParseFilenames base call
   *
* This is a minimal fallback. The full C# implementation
   * uses DefaultSpriteSequence's Filename and FilenamePattern fields to
   * resolve sprite sheet filenames with format-string expansion (e.g.,
   * "%d" → frame number). See OpenRA.Mods.Common/Graphics/DefaultSpriteSequence
   * for the complete implementation (~500 lines of filename/pattern parsing).
   */
  private baseParseFilenames(): ReservationInfo[] {
    const frames = this.calculateFrameIndices()
    return [
      {
        filename: this.image,
        loadFrames: frames,
        frames,
        location: { x: 0, y: 0 },
      },
    ]
  }

  /** Base combine filename parsing.
   *
   * OpenRA 对照: DefaultSpriteSequence.ParseCombineFilenames base call
   *
* Minimal fallback — see baseParseFilenames for full scope.
   */
  private baseParseCombineFilenames(
    frames: readonly number[] | null,
  ): ReservationInfo[] {
    const resolvedFrames = frames ?? this.calculateFrameIndices()
    return [
      {
        filename: 'combine',
        loadFrames: resolvedFrames,
        frames: resolvedFrames,
        location: { x: 0, y: 0 },
      },
    ]
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Calculate frame indices based on start, length, stride, facings.
   *
   * OpenRA 对照: DefaultSpriteSequence.CalculateFrameIndices
   *
   * Standard formula:
   *   for each facing: frame = start + (facing * stride) + frameIndex
   * where facing goes 0..facings-1 and frameIndex goes 0..length-1.
   *
   * @returns ordered frame indices
   */
  private calculateFrameIndices(): number[] {
    const start = this.config.start ?? 0
    const length = this.config.length ?? 1
    const stride = this.config.stride ?? length
    const facings = this.config.facings ?? 1
    const transpose = this.config.transpose ?? false
    const reverseFacings = this.config.reverseFacings ?? false
    const shadowStart = this.config.shadowStart ?? -1

    const result: number[] = []
    const faceCount = facings

    if (transpose) {
      for (let i = 0; i < length; i++) {
        for (let j = 0; j < faceCount; j++) {
          const facing = reverseFacings ? faceCount - 1 - j : j
          result.push(start + facing * stride + i)
        }
      }
      // Shadow frames (if any)
      if (shadowStart >= 0) {
        for (let i = 0; i < length; i++) {
          result.push(shadowStart + i)
        }
      }
    } else {
      for (let j = 0; j < faceCount; j++) {
        const facing = reverseFacings ? faceCount - 1 - j : j
        for (let i = 0; i < length; i++) {
          result.push(start + facing * stride + i)
        }
      }
      // Shadow frames (if any)
      if (shadowStart >= 0) {
        for (let i = 0; i < length; i++) {
          result.push(shadowStart + i)
        }
      }
    }

    return result
  }

  // -------------------------------------------------------------------------
  // getFilenameForTileset
  // -------------------------------------------------------------------------

  /** Get the effective filename for a given tileset.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequence.Filename resolution
   *
   * @param tileset — the tileset name
   * @returns the tileset-specific filename, or the base image if no override
   */
  getFilenameForTileset(tileset: string): string {
    return this.tilesetFilenames?.[tileset] ?? this.image
  }
}

// ---------------------------------------------------------------------------
// ClassicTilesetSpecificSpriteSequenceLoader (对照 C# loader)
// ---------------------------------------------------------------------------

/** Loader for tileset-specific classic C&C sprite sequences.
 *
 * OpenRA 对照: ClassicTilesetSpecificSpriteSequenceLoader : ClassicSpriteSequenceLoader
 *
 * Creates ClassicTilesetSpecificSpriteSequence instances.
 */
export class ClassicTilesetSpecificSpriteSequenceLoader extends ClassicSpriteSequenceLoader {
  /** Create a tileset-specific classic sprite sequence from configuration.
   *
   * OpenRA 对照: ClassicTilesetSpecificSpriteSequenceLoader.CreateSequence
   *
   * @param image — the sprite image name
   * @param sequence — the sequence name
   * @param data — sequence-specific configuration
   * @param defaults — default configuration
   * @returns a configured ClassicTilesetSpecificSpriteSequence
   */
  override createSequence(
    image: string,
    sequence: string,
    data: ClassicTilesetSpecificSpriteSequenceConfig,
    defaults: ClassicSpriteSequenceConfig = {},
  ): ClassicTilesetSpecificSpriteSequence {
    return new ClassicTilesetSpecificSpriteSequence(
      image,
      sequence,
      data,
      defaults,
    )
  }
}
