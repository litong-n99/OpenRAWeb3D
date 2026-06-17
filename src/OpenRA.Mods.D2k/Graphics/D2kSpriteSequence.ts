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
 * A frame specifier format: "name" or "name[first..last]"
 *
 * @param image — the base image name
 * @param frames — optional frame range (e.g., [0, 1, 2] or range)
 * @returns array of ISpriteFrame
 */
export function parseFilenames(
  image: string,
  frames?: number[],
): ISpriteFrame[] {
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
export class D2kSpriteSequence {
  /** The base image for this sequence.
   *
   * OpenRA 对照: DefaultSpriteSequence.Image
   */
  readonly image: string

  /** The sequence name.
   *
   * OpenRA 对照: DefaultSpriteSequence.Sequence
   */
  readonly sequence: string

  /** Sprites reserved for loading.
   *
   * OpenRA 对照: DefaultSpriteSequence.spritesToLoad
   */
  readonly spritesToLoad: SpriteReservation[] = []

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

  constructor(
    cache: ISpriteCache,
    image: string,
    sequence: string,
    config: D2kSpriteSequenceConfig,
  ) {
    this.image = image
    this.sequence = sequence

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
   * @param cache — the sprite cache
   * @param config — sequence configuration
   * @param defaults — default values (unused in TS, merged in caller)
   */
  static reserveSprites(
    cache: ISpriteCache,
    image: string,
    sequence: string,
    config: D2kSpriteSequenceConfig,
  ): SpriteReservation[] {
    const seq = new D2kSpriteSequence(cache, image, sequence, config)

    // Handle combine nodes
    // In full migration, 'Combine' sections would be processed here
    // For now, standard filename parsing is sufficient

    return seq.spritesToLoad
  }

  // -----------------------------------------------------------------------
  // GetSprite (corresponding to DefaultSpriteSequence.GetSprite)
  // -----------------------------------------------------------------------

  /** Get the sprite at the given frame index.
   *
   * OpenRA 对照: DefaultSpriteSequence.GetSprite(int)
   *
   * @param _frame — frame index
   * @returns a minimal sprite object (stub — full implementation in Ch2)
   */
  getSprite(_frame: number): unknown {
    // TODO-19.B.17: Full sprite retrieval depends on Sheet/Sprite
    // infrastructure from Ch2. Returns stub for now.
    return { bounds: { x: 0, y: 0, width: 0, height: 0 } }
  }
}
