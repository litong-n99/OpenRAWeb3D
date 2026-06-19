/**
 * TemTileset.ts — Tiberian Sun .tem terrain tileset binary parser
 *
 * OpenRA 对照: TS mod temperat.yaml tileset (references .tem template data).
 * No direct C# TemTileset.cs exists in OpenRA; this implementation is based
 * on the Westwood .tem file format specification.
 *
 * 核心范式转换:
 * - C# Stream + BinaryReader → DataView + ArrayBuffer offset-based access
 * - C# LZO/LCW decompression → unsupported in Phase C (deferred to CI-C.5)
 * - CPU-side tile data storage → ArrayBuffer[] for GPU texture upload
 *
 * ## .tem Binary Format (Tiberian Sun terrain templates)
 *
 * ```
 * Offset  Size    Field
 * 0       4       Width (uint32 LE) — tileset width in tiles
 * 4       4       Height (uint32 LE) — tileset height in tiles
 * 8       4       TileWidth (uint32 LE) — pixel width of each tile
 * 12      4       TileHeight (uint32 LE) — pixel height of each tile
 * 16      4       NumTiles (uint32 LE) — total tile count
 * 20      4       CompressionType (uint32 LE):
 *                  0 = Uncompressed
 *                  1 = LCW (Lempel-Castle-Welch)
 *                  2 = LZO
 * 24      16      Reserved / padding
 * 40      var     Tile pixel data (compressed or raw, depending on CompressionType)
 * ```
 *
 * For Phase C, only uncompressed .tem files are supported. LCW and LZO
 * decompression are deferred to CI-C.5.
 */

// ---------------------------------------------------------------------------
// TemTilesetInfo interface
// ---------------------------------------------------------------------------

/** Parsed .tem file header metadata.
 *
 * OpenRA 对照: Template information parsed from .tem binary header
 */
export interface TemTilesetInfo {
  /** Width of the tileset in tiles. */
  readonly width: number
  /** Height of the tileset in tiles. */
  readonly height: number
  /** Width of each individual tile in pixels. */
  readonly tileWidth: number
  /** Height of each individual tile in pixels. */
  readonly tileHeight: number
  /** Total number of tiles in the tileset. */
  readonly numTiles: number
  /** Compression type: 0=none, 1=LCW, 2=LZO */
  readonly compressionType: number
}

// ---------------------------------------------------------------------------
// TemTileset
// ---------------------------------------------------------------------------

/**
 * Tiberian Sun .tem terrain tileset parser.
 *
 * Parses binary .tem files used by the Tiberian Sun game for terrain
 * template tilesets. Each .tem file contains a grid of tiles with
 * consistent dimensions, stored as raw pixel data (possibly compressed).
 *
 * OpenRA 对照: TS temperat.yaml tileset template definitions that
 * reference .tem sprite files.
 */
export class TemTileset {
  // -----------------------------------------------------------------------
  // Public properties
  // -----------------------------------------------------------------------

  /** Parsed header information. */
  readonly info: TemTilesetInfo

  /** Per-tile pixel data. Each entry is an ArrayBuffer of size
   * `tileWidth * tileHeight` bytes (indexed 8-bit palette format).
   * The array length equals `info.numTiles`. */
  readonly tiles: ArrayBuffer[]

  // -----------------------------------------------------------------------
  // Constructor (private — use TemTileset.parse)
  // -----------------------------------------------------------------------

  private constructor(info: TemTilesetInfo, tiles: ArrayBuffer[]) {
    this.info = info
    this.tiles = tiles
  }

  // -----------------------------------------------------------------------
  // Static factory — parse
  // -----------------------------------------------------------------------

  /**
   * Parse .tem file data into a TemTileset instance.
   *
   * Detects the compression type from the header:
   * - 0: Uncompressed — raw pixel data, split into tiles
   * - 1: LCW — not supported (TODO-CI-C.5)
   * - 2: LZO — not supported (TODO-CI-C.5)
   *
   * @param data — raw .tem file data as ArrayBuffer
   * @returns parsed TemTileset
   * @throws Error if the data is too small, corrupted, or uses unsupported compression
   */
  static parse(data: ArrayBuffer): TemTileset {
    if (data.byteLength < 40) {
      throw new Error(
        `TemTileset.parse: data too small (${data.byteLength} bytes, minimum 40 bytes required)`,
      )
    }

    const dv = new DataView(data)
    const width = dv.getUint32(0, true)
    const height = dv.getUint32(4, true)
    const tileWidth = dv.getUint32(8, true)
    const tileHeight = dv.getUint32(12, true)
    const numTiles = dv.getUint32(16, true)
    const compressionType = dv.getUint32(20, true)

    // Validate header values
    if (width === 0 || height === 0) {
      throw new Error(
        `TemTileset.parse: invalid tileset dimensions ${width}x${height}`,
      )
    }
    if (tileWidth === 0 || tileHeight === 0) {
      throw new Error(
        `TemTileset.parse: invalid tile dimensions ${tileWidth}x${tileHeight}`,
      )
    }
    if (numTiles === 0) {
      throw new Error('TemTileset.parse: tileset contains 0 tiles')
    }

    // Boundary check: width * height should not exceed numTiles * tileWidth * tileHeight
    // (but exact validation depends on compression)

    const info: TemTilesetInfo = {
      width, height, tileWidth, tileHeight, numTiles, compressionType,
    }

    // Extract tile pixel data based on compression type
    let tiles: ArrayBuffer[]

    switch (compressionType) {
      case 0:
        tiles = TemTileset._extractUncompressedTiles(data, info)
        break
      case 1:
        // LCW compression — not supported in Phase C
        throw new Error(
          'TemTileset.parse: LCW compression (type 1) is not supported. ' +
          'TODO-CI-C.5: Implement LCW decompression for .tem files.',
        )
      case 2:
        // LZO compression — not supported in Phase C
        throw new Error(
          'TemTileset.parse: LZO compression (type 2) is not supported. ' +
          'TODO-CI-C.5: Implement LZO decompression for .tem files.',
        )
      default:
        throw new Error(
          `TemTileset.parse: unknown compression type ${compressionType}`,
        )
    }

    return new TemTileset(info, tiles)
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Get pixel data for a specific tile.
   *
   * The returned ArrayBuffer contains `tileWidth * tileHeight` bytes
   * of indexed (palette) pixel data.
   *
   * @param tileIndex — 0-based tile index
   * @returns pixel data ArrayBuffer for the requested tile
   * @throws Error if tileIndex is out of range
   */
  getTileData(tileIndex: number): ArrayBuffer {
    if (tileIndex < 0 || tileIndex >= this.tiles.length) {
      throw new Error(
        `TemTileset.getTileData: tile index ${tileIndex} ` +
        `out of range [0, ${this.tiles.length - 1}]`,
      )
    }
    return this.tiles[tileIndex]
  }

  /**
   * Get the total number of tiles in this tileset.
   */
  get tileCount(): number {
    return this.tiles.length
  }

  // -----------------------------------------------------------------------
  // Private — uncompressed tile extraction
  // -----------------------------------------------------------------------

  /**
   * Extract individual tile pixel data from uncompressed .tem data.
   *
   * The pixel data starts at offset 40 in the file. Each tile is
   * `tileWidth * tileHeight` bytes of indexed pixel data, stored
   * sequentially in row-major order across the tileset grid.
   *
   * @param data — raw .tem file data
   * @param info — parsed header information
   * @returns array of per-tile ArrayBuffers
   */
  private static _extractUncompressedTiles(
    data: ArrayBuffer,
    info: TemTilesetInfo,
  ): ArrayBuffer[] {
    const bytesPerTile = info.tileWidth * info.tileHeight
    const totalPixelBytes = info.numTiles * bytesPerTile
    const pixelDataOffset = 40

    // Validate that we have enough data
    if (data.byteLength < pixelDataOffset + totalPixelBytes) {
      throw new Error(
        `TemTileset.parse: uncompressed data too small. ` +
        `Expected at least ${pixelDataOffset + totalPixelBytes} bytes ` +
        `(${info.numTiles} tiles × ${bytesPerTile} bytes/tile + 40 header), ` +
        `got ${data.byteLength} bytes.`,
      )
    }

    const tiles: ArrayBuffer[] = []
    const tileDataStart = pixelDataOffset

    for (let i = 0; i < info.numTiles; i++) {
      const tileStart = tileDataStart + i * bytesPerTile
      const tileData = data.slice(tileStart, tileStart + bytesPerTile)
      tiles.push(tileData)
    }

    return tiles
  }
}
