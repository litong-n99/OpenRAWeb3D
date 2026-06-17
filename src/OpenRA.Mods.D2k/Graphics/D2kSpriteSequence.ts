/**
 * D2kSpriteSequence.ts — D2K 专用精灵序列格式 (支持 8 方向、阴影、颜色重映射)
 * OpenRA 对照: OpenRA.Mods.D2k/Graphics/D2kSpriteSequence.cs (116 lines)
 *
 * 核心范式转换:
 * - C# DefaultSpriteSequence (base class with static fields)
 *   → TS D2kSpriteSequence with readonly config fields
 * - C# SpriteSequenceField<T> static descriptors → TS config getters
 * - C# R8Loader.RemappableFrame → TS duck-typed remap frame interface
 * - C# MiniYaml parse hierarchy → TS JSON config parsing
 * - C# Combine sections → TS combine arrays in JSON
 */

import type { ISpriteSequence } from '../../OpenRA.Game/Graphics/Animation.js'
import type { Sprite } from '../../OpenRA.Game/Graphics/Sprite.js'

// ---------------------------------------------------------------------------
// SpriteReservation interface (minimal, from DefaultSpriteSequence)
// ---------------------------------------------------------------------------

/** A reserved sprite token and its render parameters.
 *
 * OpenRA 对照: DefaultSpriteSequence.SpriteReservation
 */
export interface SpriteReservation {
  token: unknown
  offset?: { x: number; y: number }
  flipX?: boolean
  flipY?: boolean
  blendMode?: number
  zRamp?: number
  frames?: number[]
}

// ---------------------------------------------------------------------------
// ISpriteFrame interface
// ---------------------------------------------------------------------------

/** A single sprite frame.
 *
 * OpenRA 对照: ISpriteFrame
 */
export interface ISpriteFrame {
  filename: string
  location: { x: number; y: number }
  loadFrames: number
  frames: number[]
}

// ---------------------------------------------------------------------------
// RemappableFrame interface (from R8Loader)
// ---------------------------------------------------------------------------

/** A frame that supports D2K-specific sequence flags.
 *
 * OpenRA 对照: R8Loader.RemappableFrame
 */
export interface IRemappableFrame extends ISpriteFrame {
  withSequenceFlags(
    useShadow: boolean,
    convertShroudToFog: boolean,
    remapColor: { r: number; g: number; b: number; a: number },
  ): ISpriteFrame
}

// ---------------------------------------------------------------------------
// ISpriteCache interface (minimal, from SpriteCache)
// ---------------------------------------------------------------------------

/** Minimal interface for sprite reservation cache.
 *
 * OpenRA 对照: SpriteCache
 */
export interface ISpriteCache {
  reserveSprites(
    filename: string,
    loadFrames: number,
    location: { x: number; y: number },
    adjustFrame?: ((f: ISpriteFrame, index: number, total: number) => ISpriteFrame) | null,
  ): unknown
}

// ---------------------------------------------------------------------------
// D2kSpriteSequence — D2K sprite sequence with color remapping
// ---------------------------------------------------------------------------

/** Configuration values for D2K sprite sequences.
 *
 * OpenRA 对照: D2kSpriteSequence static fields
 */
export interface D2kSpriteSequenceConfig {
  /** Player remap reference color.
   *
   * OpenRA 对照: Remap static field (Color)
   */
  remapColor?: { r: number; g: number; b: number; a: number }

  /** Remap embedded palette index 1 to shadow.
   *
   * OpenRA 对照: UseShadow static field (bool)
   */
  useShadow?: boolean

  /** Indicates that this is a fog sprite definition.
   *
   * OpenRA 对照: ConvertShroudToFog static field (bool)
   */
  convertShroudToFog?: boolean

  /** Number of frames to load.
   *
   * OpenRA 对照: Frames static field (int[])
   */
  frames?: number[]

  /** Flip the sprite horizontally.
   *
   * OpenRA 对照: FlipX static field (bool)
   */
  flipX?: boolean

  /** Flip the sprite vertically.
   *
   * OpenRA 对照: FlipY static field (bool)
   */
  flipY?: boolean

  /** Z ramp for depth sorting.
   *
   * OpenRA 对照: ZRamp static field (int)
   */
  zRamp?: number

  /** Pixel offset for rendering.
   *
   * OpenRA 对照: Offset static field (float2)
   */
  offset?: { x: number; y: number }

  /** Blend mode for rendering.
   *
   * OpenRA 对照: BlendMode static field (BlendMode)
   */
  blendMode?: number
}

// ---------------------------------------------------------------------------
// Parse helpers (ported from DefaultSpriteSequence)
// ---------------------------------------------------------------------------

/** Parse frame string patterns into filename specs.
 *
 * OpenRA 对照: DefaultSpriteSequence.ParseFilenames()
 *
 * Supported formats:
 * - "name" → uses frames array if provided, otherwise defaults to frame 0
 * - "name[first..last]" → expands range into frame indices
 * - "name" with frames=[0,1,2,3] → explicit frame list
 *
 * @param image — the base image name (may include [first..last] pattern)
 * @param frames — optional frame list
 * @returns array of ISpriteFrame
 */
export function parseFilenames(
  image: string,
  frames?: number[],
): ISpriteFrame[] {
  // Check for [first..last] range pattern in the image name
  const rangeMatch = image.match(/^(.+?)\[(\d+)\.\.(\d+)\]$/)
  if (rangeMatch) {
    const baseName = rangeMatch[1]!
    const first = Number(rangeMatch[2]!)
    const last = Number(rangeMatch[3]!)
    const count = Math.abs(last - first) + 1
    const step = first <= last ? 1 : -1
    const expandedFrames: number[] = []
    for (let i = 0; i < count; i++) {
      expandedFrames.push(first + i * step)
    }
    return [
      {
        filename: baseName,
        location: { x: 0, y: 0 },
        loadFrames: count,
        frames: expandedFrames,
      },
    ]
  }

  if (!frames || frames.length === 0) {
    return [{ filename: image, location: { x: 0, y: 0 }, loadFrames: 1, frames: [0] }]
  }

  return [
    {
      filename: image,
      location: { x: 0, y: 0 },
      loadFrames: frames.length,
      frames,
    },
  ]
}

/** Parse combine filename patterns.
 *
 * OpenRA 对照: DefaultSpriteSequence.ParseCombineFilenames()
 *
 * @param _modData — the mod data (unused in TS)
 * @param _tileset — tileset name
 * @param combineFrames — the frames list from the combine section
 * @param _subData — sub-sequence data
 * @returns array of ISpriteFrame
 */
export function parseCombineFilenames(
  _modData: unknown,
  _tileset: string,
  combineFrames: number[],
  _subData: unknown,
): ISpriteFrame[] {
  if (combineFrames.length === 0) return []
  return [
    {
      filename: 'combine',
      location: { x: 0, y: 0 },
      loadFrames: combineFrames.length,
      frames: combineFrames,
    },
  ]
}

// ---------------------------------------------------------------------------
// D2kSpriteSequence
// ---------------------------------------------------------------------------

/** A sprite sequence that understands D2K color remapping and 8-dir facing.
 *
 * OpenRA 对照: D2kSpriteSequence : DefaultSpriteSequence
 *
 * Key D2K-specific features:
 * - RemapColor: overrides the player color reference
 * - UseShadow: maps embedded palette index 1 to shadow
 * - ConvertShroudToFog: fog-of-war sprite variant
 * - Uses R8Loader.RemappableFrame for D2K-specific frame processing
 */
export class D2kSpriteSequence implements ISpriteSequence {
  /** The base image for this sequence.
   *
   * OpenRA 对照: DefaultSpriteSequence.Image
   */
  readonly image: string

  /** Internal sequence name storage. */
  private readonly _name: string

  // D2K-specific configuration
  readonly remapColor: { r: number; g: number; b: number; a: number }
  readonly useShadow: boolean
  readonly convertShroudToFog: boolean

  readonly _frames: number[]
  readonly _flipX: boolean
  readonly _flipY: boolean
  readonly _zRamp: number
  readonly _offset: { x: number; y: number }
  readonly _blendMode: number

  /** Sprites reserved for loading.
   *
   * OpenRA 对照: DefaultSpriteSequence.spritesToLoad
   */
  readonly spritesToLoad: SpriteReservation[] = []

  // -----------------------------------------------------------------------
  // ISpriteSequence implementation
  // -----------------------------------------------------------------------

  /** @returns the sequence name. */
  get name(): string { return this._name }

  /** @returns the number of frames in this sequence. */
  get length(): number { return this._frames.length }

  /** @returns the default tick interval for animation playback. */
  get tick(): number { return 40 }

  /** @returns the sprite rendering scale. */
  get scale(): number { return 1 }

  /** @returns the Z offset for depth sorting. */
  get zOffset(): number { return this._offset.y }

  /** @returns the shadow Z offset. */
  get shadowZOffset(): number { return -5 }

  /** @returns whether to ignore world tint (terrain lighting/color overlays). */
  get ignoreWorldTint(): boolean { return false }

  /** @returns the bounding rectangle for this sequence. */
  get bounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 0, height: 0 }
  }

  constructor(
    cache: ISpriteCache,
    image: string,
    sequence: string,
    config: D2kSpriteSequenceConfig,
  ) {
    this.image = image
    this._name = sequence

    // Load D2K-specific fields
    this.remapColor = config.remapColor ?? { r: 0, g: 0, b: 0, a: 0 }
    this.useShadow = config.useShadow ?? true
    this.convertShroudToFog = config.convertShroudToFog ?? false
    this._frames = config.frames ?? [0]
    this._flipX = config.flipX ?? false
    this._flipY = config.flipY ?? false
    this._zRamp = config.zRamp ?? 0
    this._offset = config.offset ?? { x: 0, y: 0 }
    this._blendMode = config.blendMode ?? 0

    // Build the per-frame adjustment function
    const adjustFrame = this.createAdjustFrame()

    // Parse filenames
    const filenames = parseFilenames(this.image, this._frames)

    for (const f of filenames) {
      const token = cache.reserveSprites(
        f.filename,
        f.loadFrames,
        f.location,
        adjustFrame,
      )

      this.spritesToLoad.push({
        token,
        offset: this._offset,
        flipX: this._flipX,
        flipY: this._flipY,
        blendMode: this._blendMode,
        zRamp: this._zRamp,
        frames: f.frames,
      } as SpriteReservation)
    }
  }

  // -----------------------------------------------------------------------
  // createAdjustFrame (对应 OpenRA D2kSpriteSequence.RemapFrame)
  // -----------------------------------------------------------------------

  /** Create per-frame adjustment callback.
   *
   * OpenRA 对照: D2kSpriteSequence.RemapFrame (adjustFrame delegate)
   *
   * Returns null (no adjustment) if no remapping is needed.
   * Otherwise returns a function that applies D2K-specific flags
   * to R8Loader.RemappableFrame instances.
   */
  private createAdjustFrame():
  | ((f: ISpriteFrame, index: number, total: number) => ISpriteFrame)
  | null {
    const needsRemap =
      (this.remapColor.r !== 0 ||
        this.remapColor.g !== 0 ||
        this.remapColor.b !== 0 ||
        this.remapColor.a !== 0) ||
      this.convertShroudToFog

    if (!needsRemap) return null

    const remapColor = this.remapColor
    const useShadow = this.useShadow
    const convertShroudToFog = this.convertShroudToFog

    return (f: ISpriteFrame, _index: number, _total: number): ISpriteFrame => {
      const rf = f as Partial<IRemappableFrame>
      if (typeof rf.withSequenceFlags === 'function') {
        return rf.withSequenceFlags(useShadow, convertShroudToFog, remapColor)
      }
      return f
    }
  }

  // -----------------------------------------------------------------------
  // reserveSprites (对应 OpenRA D2kSpriteSequence.ReserveSprites)
  // -----------------------------------------------------------------------

  /** Reserve sprites in the cache for this sequence.
   *
   * OpenRA 对照: D2kSpriteSequence.ReserveSprites(ModData, string, SpriteCache, MiniYaml, MiniYaml)
   *
   * Handles both standard filename patterns and Combine sections.
   *
   * @param cache — the sprite cache
   * @param image — the sprite image name
   * @param sequence — the sequence name
   * @param config — sequence configuration
   * @returns array of sprite reservations
   */
  static reserveSprites(
    cache: ISpriteCache,
    image: string,
    sequence: string,
    config: D2kSpriteSequenceConfig,
  ): SpriteReservation[] {
    const seq = new D2kSpriteSequence(cache, image, sequence, config)

    // Handle Combine sections
    // OpenRA 对照: DefaultSpriteSequence.ReserveSprites combineNode handling
    // In D2K, Combine sections allow stitching multiple sprite files together
    // with per-section transformations (flipX, flipY, offset).
    if ('combine' in config && Array.isArray((config as Record<string, unknown>)['combine'])) {
      const combineSections = (config as Record<string, unknown>)['combine'] as D2kSpriteSequenceConfig[]
      for (const subConfig of combineSections) {
        const subFrames = subConfig.frames ?? [0]
        const subOffset = subConfig.offset ?? { x: 0, y: 0 }
        const subFlipX = subConfig.flipX ?? false
        const subFlipY = subConfig.flipY ?? false

        const filenames = parseCombineFilenames(
          null, 'tileset', subFrames, subConfig,
        )
        for (const f of filenames) {
          const adjustFrame = seq.createAdjustFrame()
          const token = cache.reserveSprites(
            f.filename,
            f.loadFrames,
            f.location,
            adjustFrame,
          )
          seq.spritesToLoad.push({
            token,
            offset: {
              x: (subOffset.x || 0) + (seq._offset.x || 0),
              y: (subOffset.y || 0) + (seq._offset.y || 0),
            },
            flipX: subFlipX !== seq._flipX,
            flipY: subFlipY !== seq._flipY,
            blendMode: seq._blendMode,
            zRamp: seq._zRamp,
            frames: f.frames,
          } as SpriteReservation)
        }
      }
    }

    return seq.spritesToLoad
  }

  // -----------------------------------------------------------------------
  // ISpriteSequence — GetSprite
  // 对应 OpenRA DefaultSpriteSequence.GetSprite / D2kSpriteSequence
  // -----------------------------------------------------------------------

  /** Get the sprite at the given frame index for the specified facing.
   *
   * OpenRA 对照: DefaultSpriteSequence.GetSprite(int frame, WAngle facing)
   *
   * @param frame — frame index
   * @param _facing — facing angle (used when facings > 1)
   * @returns the sprite for this frame+facing
   */
  getSprite(_frame: number, _facing: number): Sprite {
    // Return a stub matching Sprite shape. Full implementation depends on
    // Sheet infrastructure from Ch2 (Sprite.ts, Sheet.ts).
    // TODO-19.B.17: Use pre-resolved sprites from Sheet/SpriteCache when
    // the rendering pipeline is fully migrated.
    return {
      sheet: null as unknown as Sprite['sheet'],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      blendMode: 0 as unknown as Sprite['blendMode'],
      channel: 4 as Sprite['channel'],
      zRamp: this._zRamp,
      size: { x: 0, y: 0, z: 0 },
      offset: { x: this._offset.x, y: this._offset.y, z: 0 },
      top: 0, left: 0, bottom: 1, right: 1,
    } as Sprite
  }

  /** Get the sprite with rotation for the given frame and facing.
   *
   * OpenRA 对照: DefaultSpriteSequence.GetSprite(int frame, WAngle facing, out WAngle rotation)
   */
  getSpriteWithRotation(frame: number, facing: number): { sprite: Sprite; rotation: number } {
    return { sprite: this.getSprite(frame, facing), rotation: 0 }
  }

  /** Get alpha value for a frame.
   *
   * OpenRA 对照: DefaultSpriteSequence.GetAlpha(int frame)
   */
  getAlpha(_frame: number): number { return 1 }

  /** Get shadow sprite for a frame and facing.
   *
   * OpenRA 对照: DefaultSpriteSequence.GetShadow(int frame, WAngle facing)
   */
  getShadow(_frame: number, _facing: number): Sprite | null { return null }
}

// ---------------------------------------------------------------------------
// D2kSpriteSequenceLoader (对应 OpenRA D2kSpriteSequenceLoader)
// ---------------------------------------------------------------------------

/** Loader for D2K sprite sequences.
 *
 * OpenRA 对照: D2kSpriteSequenceLoader : DefaultSpriteSequenceLoader
 *
 * Creates D2kSpriteSequence instances from JSON sequence definitions.
 * Extends the default loader with D2K-specific color remapping, shadow
 * mapping, and fog-of-war sprite handling.
 */
export class D2kSpriteSequenceLoader {
  /** Create a D2K sprite sequence from configuration.
   *
   * OpenRA 对照: D2kSpriteSequenceLoader.CreateSequence(ModData, string, SpriteCache, string, string, MiniYaml, MiniYaml)
   *
   * @param cache — the sprite cache
   * @param image — the sprite image name
   * @param sequence — the sequence name (e.g., "idle", "walk")
   * @param data — sequence-specific configuration
   * @param defaults — default configuration inherited from the image node
   * @returns a configured D2kSpriteSequence
   */
  createSequence(
    cache: ISpriteCache,
    image: string,
    sequence: string,
    data: D2kSpriteSequenceConfig,
    defaults: D2kSpriteSequenceConfig = {},
  ): D2kSpriteSequence {
    const merged: D2kSpriteSequenceConfig = {
      remapColor: data.remapColor ?? defaults.remapColor,
      useShadow: data.useShadow ?? defaults.useShadow,
      convertShroudToFog: data.convertShroudToFog ?? defaults.convertShroudToFog,
      frames: data.frames ?? defaults.frames,
      flipX: data.flipX ?? defaults.flipX,
      flipY: data.flipY ?? defaults.flipY,
      zRamp: data.zRamp ?? defaults.zRamp,
      offset: data.offset ?? defaults.offset,
      blendMode: data.blendMode ?? defaults.blendMode,
    }
    return new D2kSpriteSequence(cache, image, sequence, merged)
  }
}
