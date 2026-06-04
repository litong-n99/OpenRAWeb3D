/**
 * MapBinParser.ts — Binary map data format parser (map.bin)
 * OpenRA 对照: OpenRA.Game/Map/Map.cs — BinaryDataHeader struct + SaveBinaryData()
 *
 * 核心范式转换:
 * - C# Stream.ReadUInt8/16/32 → DataView.getUint8/getUint16/getUint32 (little-endian)
 * - C# BinaryWriter.Write → DataView.setUint8/setUint16/setUint32 (little-endian)
 * - C# MemoryStream + byte[] → ArrayBuffer + DataView
 * - C# BinaryDataHeader readonly struct → parseBinaryDataHeader() function
 *
 * Format 2 layout (17-byte header):
 *   Offset  Size  Field
 *   [0]     1     Format         uint8  (always 2 for current maps)
 *   [1-2]   2     Width          uint16 LE
 *   [3-4]   2     Height         uint16 LE
 *   [5-8]   4     TilesOffset    uint32 LE  (always 17)
 *   [9-12]  4     HeightsOffset  uint32 LE  (0 if flat map)
 *   [13-16] 4     ResourcesOffset uint32 LE
 *
 * Tile data (per cell, 3 bytes): uint16 Type LE + uint8 Index
 * Height data (per cell, 1 byte): uint8 (0 if flat map)
 * Resource data (per cell, 2 bytes): uint8 Type + uint8 Index
 *
 * All data stored in column-major order: outer loop i (column), inner loop j (row).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Size of the binary data header in bytes. */
export const BINARY_DATA_HEADER_SIZE = 17

/** Sentinel indicating no height data. */
export const NO_HEIGHT_OFFSET = 0

/** Bytes per tile entry (uint16 Type + uint8 Index). */
export const BYTES_PER_TILE = 3

/** Bytes per resource entry (uint8 Type + uint8 Index). */
export const BYTES_PER_RESOURCE = 2

// ---------------------------------------------------------------------------
// BinaryDataHeader
// OpenRA 对照: BinaryDataHeader readonly struct
// ---------------------------------------------------------------------------

/** Parsed binary data header.
 *
 * OpenRA 对照: BinaryDataHeader(Stream, Size)
 */
export interface BinaryDataHeader {
  /** Format version (1 or 2). */
  format: number
  /** Map width in cells. */
  width: number
  /** Map height in cells. */
  height: number
  /** Byte offset to tile data (always 17 for Format 2). */
  tilesOffset: number
  /** Byte offset to height data (0 if no height data). */
  heightsOffset: number
  /** Byte offset to resource data. */
  resourcesOffset: number
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse the binary data header from a DataView.
 *
 * OpenRA 对照: BinaryDataHeader(Stream s, Size expectedSize)
 *
 * @param data — DataView of map.bin (at least 5 bytes for Format 1, 17 for Format 2)
 * @param expectedWidth — width from map.yaml metadata (0 to skip validation)
 * @param expectedHeight — height from map.yaml metadata (0 to skip validation)
 * @throws Error if the format is unknown or dimensions do not match
 */
export function parseBinaryDataHeader(
  data: DataView,
  expectedWidth: number,
  expectedHeight: number,
): BinaryDataHeader {
  let offset = 0
  const format = data.getUint8(offset++)
  const width = data.getUint16(offset, true)
  offset += 2
  const height = data.getUint16(offset, true)
  offset += 2

  // Check format BEFORE dimension validation — unknown format throws first
  if (format !== 1 && format !== 2) {
    throw new Error(`Unknown binary map format '${format}'`)
  }

  if (
    expectedWidth > 0 &&
    expectedHeight > 0 &&
    (width !== expectedWidth || height !== expectedHeight)
  ) {
    throw new Error('Invalid tile data: dimensions do not match map.yaml')
  }

  if (format === 1) {
    const w = width
    const h = height
    return {
      format: 1,
      width,
      height,
      tilesOffset: 5,
      heightsOffset: 0,
      resourcesOffset: 3 * w * h + 5,
    }
  }

  // Format 2
  const tilesOffset = data.getUint32(offset, true)
  offset += 4
  const heightsOffset = data.getUint32(offset, true)
  offset += 4
  const resourcesOffset = data.getUint32(offset, true)

  return { format: 2, width, height, tilesOffset, heightsOffset, resourcesOffset }
}

// ---------------------------------------------------------------------------
// BinaryDataLayout
// OpenRA 对照: SaveBinaryData() offset computation
// ---------------------------------------------------------------------------

/** Pre-computed offsets and sizes for binary data layout.
 *
 * OpenRA 对照: SaveBinaryData() local offset variables
 */
export interface BinaryDataLayout {
  /** Byte offset to tile data (always 17 for Format 2). */
  tilesOffset: number
  /** Byte offset to height data (0 if no height). */
  heightsOffset: number
  /** Byte offset to resource data. */
  resourcesOffset: number
  /** Total size of tile data in bytes. */
  tilesSize: number
  /** Total size of height data in bytes (0 if no height). */
  heightsSize: number
  /** Total size of resource data in bytes. */
  resourcesSize: number
  /** Total buffer size including header. */
  totalSize: number
}

/**
 * Compute the binary data layout for given map dimensions.
 *
 * OpenRA 对照: SaveBinaryData() local offset computation
 *
 * @param w — map width in cells
 * @param h — map height in cells
 * @param hasHeight — whether the map has terrain height data
 */
export function computeBinaryDataLayout(
  w: number,
  h: number,
  hasHeight: boolean,
): BinaryDataLayout {
  const tilesSize = BYTES_PER_TILE * w * h
  const heightsSize = hasHeight ? w * h : 0
  const resourcesSize = BYTES_PER_RESOURCE * w * h

  const tilesOffset = BINARY_DATA_HEADER_SIZE
  const heightsOffset = hasHeight ? tilesOffset + tilesSize : 0
  const resourcesOffset = tilesOffset + tilesSize + heightsSize

  const totalSize = tilesOffset + tilesSize + heightsSize + resourcesSize

  return {
    tilesOffset,
    heightsOffset,
    resourcesOffset,
    tilesSize,
    heightsSize,
    resourcesSize,
    totalSize,
  }
}

// ---------------------------------------------------------------------------
// Build (serialize) — utility for writing binary data
// ---------------------------------------------------------------------------

/** Parameters for building a Format 2 binary data buffer. */
export interface BuildBinaryDataInput {
  /** Map width in cells. */
  width: number
  /** Map height in cells. */
  height: number
  /** Whether height data is included. */
  hasHeight: boolean
  /** Tile format version (always 2). */
  tileFormat?: number
  /** Tile data in column-major order [j * width + i]. */
  tiles: readonly { type: number; index: number }[]
  /** Resource data in column-major order [j * width + i]. */
  resources?: readonly { type: number; index: number }[]
  /** Height data in column-major order [j * width + i]. */
  heights?: readonly number[]
}

/**
 * Build a complete Format 2 binary data buffer.
 *
 * OpenRA 对照: Map.SaveBinaryData()
 *
 * Writes the 17-byte header followed by tile, height, and resource data
 * in column-major order. Useful for testing and serialization.
 *
 * @param input — buffer construction parameters
 * @returns ArrayBuffer containing the complete binary map data
 */
export function buildBinaryData(input: BuildBinaryDataInput): ArrayBuffer {
  const {
    width: w,
    height: h,
    hasHeight,
    tileFormat = 2,
    tiles,
    resources = [],
    heights = [],
  } = input

  const layout = computeBinaryDataLayout(w, h, hasHeight)
  const buffer = new ArrayBuffer(layout.totalSize)
  const data = new DataView(buffer)
  let pos = 0

  // Header
  data.setUint8(pos++, tileFormat)
  data.setUint16(pos, w, true)
  pos += 2
  data.setUint16(pos, h, true)
  pos += 2
  data.setUint32(pos, layout.tilesOffset, true)
  pos += 4
  data.setUint32(pos, layout.heightsOffset, true)
  pos += 4
  data.setUint32(pos, layout.resourcesOffset, true)
  pos += 4
  // pos === BINARY_DATA_HEADER_SIZE (17)

  // Helper: column-major index for position (i, j)
  const idx = (i: number, j: number) => j * w + i

  // Tile data (column-major)
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const t = tiles[idx(i, j)] ?? { type: 0, index: 0 }
      data.setUint16(pos, t.type, true)
      pos += 2
      data.setUint8(pos++, t.index)
    }
  }

  // Height data (column-major, only if hasHeight)
  if (hasHeight) {
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        data.setUint8(pos++, heights[idx(i, j)] ?? 0)
      }
    }
  }

  // Resource data (column-major)
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      const r = resources[idx(i, j)] ?? { type: 0, index: 0 }
      data.setUint8(pos++, r.type)
      data.setUint8(pos++, r.index)
    }
  }

  return buffer
}

// ---------------------------------------------------------------------------
// Header serialization (used by Map.saveBinaryData)
// ---------------------------------------------------------------------------

/**
 * Write the binary data header bytes into a DataView at the given offset.
 *
 * OpenRA 对照: SaveBinaryData() header writes
 *
 * @param data — target DataView
 * @param offset — starting byte offset (typically 0)
 * @param tileFormat — tile format version (2)
 * @param w — map width
 * @param h — map height
 * @param layout — pre-computed layout
 * @returns new offset after writing (offset + 17)
 */
export function writeBinaryDataHeader(
  data: DataView,
  offset: number,
  tileFormat: number,
  w: number,
  h: number,
  layout: BinaryDataLayout,
): number {
  let pos = offset
  data.setUint8(pos++, tileFormat)
  data.setUint16(pos, w, true)
  pos += 2
  data.setUint16(pos, h, true)
  pos += 2
  data.setUint32(pos, layout.tilesOffset, true)
  pos += 4
  data.setUint32(pos, layout.heightsOffset, true)
  pos += 4
  data.setUint32(pos, layout.resourcesOffset, true)
  pos += 4
  return pos
}
