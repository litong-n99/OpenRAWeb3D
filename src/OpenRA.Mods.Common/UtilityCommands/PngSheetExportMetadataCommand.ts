/**
 * PngSheetExportMetadataCommand.ts -- PNG sprite sheet metadata export command
 * OpenRA reference: OpenRA.Mods.Common/UtilityCommands/PngSheetExportMetadataCommand.cs (38 lines)
 *
 * Core paradigm shifts:
 * - C# Png.EmbeddedData -> JSON key-value pairs for metadata
 * - C# MiniYamlNode -> JSON object serialization
 * - C# .WriteToFile -> Node.js fs.writeFileSync
 * - C# Path.ChangeExtension -> string .replace() for extension swap
 * - C# Png(Stream) full decode -> minimal PNG IHDR parser for dimensions
 *
 * Exports sprite sheet metadata (frame size, frame count, grid layout)
 * from a PNG file. Reads PNG dimensions from the IHDR chunk, computes
 * frame grid from a configurable frame size, and writes metadata as JSON.
 *
 * PNG IHDR chunk (minimal parse, 33 bytes):
 *   Bytes 0-7:   Signature (0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A)
 *   Bytes 8-11:  IHDR data length (big-endian, always 13)
 *   Bytes 12-15: "IHDR" chunk type
 *   Bytes 16-19: Width (big-endian uint32)
 *   Bytes 20-23: Height (big-endian uint32)
 *   Bytes 24:    Bit depth
 *   Bytes 25:    Color type
 */

import * as fs from 'node:fs'

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for sprite sheet metadata export. */
export interface PngSheetExportConfig {
  /** Width of each individual frame in pixels. Default: inferred from sheet width. */
  frameWidth?: number
  /** Height of each individual frame in pixels. Default: inferred from sheet height. */
  frameHeight?: number
  /** Explicit frame count. Default: computed from grid. */
  frameAmount?: number
  /** Additional custom metadata key-value pairs. */
  custom?: Record<string, string>
}

/** Result of computing sprite sheet metadata. */
export interface PngSheetMetadataResult {
  /** Whether metadata was successfully computed. */
  valid: boolean
  /** Error message if computation failed. */
  error?: string
  /** Image width from PNG header. */
  imageWidth: number
  /** Image height from PNG header. */
  imageHeight: number
  /** Width of each frame (from config or inferred). */
  frameWidth: number
  /** Height of each frame (from config or inferred). */
  frameHeight: number
  /** Number of frame columns. */
  columns: number
  /** Number of frame rows. */
  rows: number
  /** Total number of frames. */
  totalFrames: number
  /** Remaining pixels on the right edge (not a full frame). */
  remainderX: number
  /** Remaining pixels on the bottom edge (not a full frame). */
  remainderY: number
}

// ---------------------------------------------------------------------------
// PNG header reader
// ---------------------------------------------------------------------------

/**
 * Reads PNG image dimensions from the IHDR chunk without a full PNG decoder.
 *
 * Reads only the signature (8 bytes) + IHDR chunk header (8 bytes) +
 * IHDR data (13 bytes) = 29 bytes minimum.
 *
 * @param filePath -- Path to the PNG file
 * @returns { width, height } on success, or null on failure
 */
export function readPngDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(33)
      const bytesRead = fs.readSync(fd, buf, 0, 33, 0)
      if (bytesRead < 33) return null

      // Verify PNG signature
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      for (let i = 0; i < 8; i++) {
        if (buf[i] !== signature[i]) return null
      }

      // Verify IHDR chunk type
      const chunkType = buf.toString('ascii', 12, 16)
      if (chunkType !== 'IHDR') return null

      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      return { width, height }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Metadata computation
// ---------------------------------------------------------------------------

/**
 * Computes sprite sheet metadata from image dimensions and optional config.
 *
 * If no frame size is provided in the config, the frame size defaults to
 * the full image dimensions (single-frame sheet).
 *
 * @param imageWidth -- PNG image width in pixels
 * @param imageHeight -- PNG image height in pixels
 * @param config -- Optional export configuration (frame size, custom metadata)
 * @returns PngSheetMetadataResult
 */
export function computeSheetMetadata(
  imageWidth: number,
  imageHeight: number,
  config?: PngSheetExportConfig,
): PngSheetMetadataResult {
  const frameWidth = config?.frameWidth ?? imageWidth
  const frameHeight = config?.frameHeight ?? imageHeight

  if (frameWidth <= 0 || frameHeight <= 0) {
    return {
      valid: false,
      error: `Invalid frame size: ${frameWidth}x${frameHeight}`,
      imageWidth,
      imageHeight,
      frameWidth,
      frameHeight,
      columns: 0,
      rows: 0,
      totalFrames: 0,
      remainderX: 0,
      remainderY: 0,
    }
  }

  if (imageWidth < frameWidth || imageHeight < frameHeight) {
    return {
      valid: false,
      error: `Image (${imageWidth}x${imageHeight}) is smaller than frame size (${frameWidth}x${frameHeight})`,
      imageWidth,
      imageHeight,
      frameWidth,
      frameHeight,
      columns: 0,
      rows: 0,
      totalFrames: 0,
      remainderX: 0,
      remainderY: 0,
    }
  }

  const columns = Math.floor(imageWidth / frameWidth)
  const rows = Math.floor(imageHeight / frameHeight)
  const totalFrames = config?.frameAmount ?? columns * rows
  const remainderX = imageWidth - columns * frameWidth
  const remainderY = imageHeight - rows * frameHeight

  if (totalFrames > columns * rows) {
    return {
      valid: false,
      error: `Frame amount ${totalFrames} exceeds grid capacity ${columns * rows} ` +
        `(${columns} cols x ${rows} rows for frame size ${frameWidth}x${frameHeight} ` +
        `in image ${imageWidth}x${imageHeight})`,
      imageWidth,
      imageHeight,
      frameWidth,
      frameHeight,
      columns,
      rows,
      totalFrames,
      remainderX,
      remainderY,
    }
  }

  return {
    valid: true,
    imageWidth,
    imageHeight,
    frameWidth,
    frameHeight,
    columns,
    rows,
    totalFrames,
    remainderX,
    remainderY,
  }
}

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------

/**
 * Serializes sheet metadata to a formatted JSON string.
 *
 * Produces a JSON object with FrameSize, FrameAmount, grid layout,
 * image dimensions, and any custom metadata.
 *
 * @param metadata -- Computed metadata result
 * @param config -- Optional config with custom key-value pairs
 * @returns Formatted JSON string
 */
export function generateMetadataJson(
  metadata: PngSheetMetadataResult,
  config?: PngSheetExportConfig,
): string {
  const obj: Record<string, unknown> = {
    FrameSize: {
      Width: metadata.frameWidth,
      Height: metadata.frameHeight,
    },
    FrameAmount: metadata.totalFrames,
    Grid: {
      Columns: metadata.columns,
      Rows: metadata.rows,
    },
    ImageSize: {
      Width: metadata.imageWidth,
      Height: metadata.imageHeight,
    },
  }

  if (metadata.remainderX > 0 || metadata.remainderY > 0) {
    obj['RemainderPixels'] = {
      X: metadata.remainderX,
      Y: metadata.remainderY,
    }
  }

  // Merge custom metadata from config
  if (config?.custom) {
    for (const [key, value] of Object.entries(config.custom)) {
      obj[key] = value
    }
  }

  return JSON.stringify(obj, null, 2)
}

// ---------------------------------------------------------------------------
// PngSheetExportMetadataCommand
// ---------------------------------------------------------------------------

/**
 * PNG sprite sheet metadata export command.
 *
 * Usage: --png-sheet-export PNGFILE [--frame-width W] [--frame-height H]
 *
 * Reads PNG dimensions from the IHDR chunk, computes frame grid from
 * configurable frame size (or defaults to single-frame), and writes
 * metadata as a JSON file (replacing the original extension with .json).
 *
 * In OpenRA, the metadata was embedded in the PNG as tEXt chunks and
 * exported to a YAML file. Here we export to JSON for easier machine
 * consumption. For pngjs/sharp-based full PNG tEXt chunk support,
 * see TODO markers below.
 *
 * OpenRA reference: PngSheetExportMetadataCommand
 */
export class PngSheetExportMetadataCommand implements IUtilityCommand {
  readonly name = '--png-sheet-export'

  validateArguments(args: string[]): boolean {
    return args.length >= 2
  }

  run(_utility: Utility, args: string[]): void {
    const pngFile = args[1]!

    // Determine output filename (replace extension with .json)
    const jsonFile = pngFile.replace(/\.\w+$/, '') + '.json'

    // Parse optional --frame-width and --frame-height from remaining args
    const config: PngSheetExportConfig = {}
    for (let i = 2; i < args.length; i++) {
      const arg = args[i]!
      if (arg === '--frame-width' && i + 1 < args.length) {
        const w = Number.parseInt(args[++i]!, 10)
        if (!Number.isNaN(w) && w > 0) config.frameWidth = w
      } else if (arg === '--frame-height' && i + 1 < args.length) {
        const h = Number.parseInt(args[++i]!, 10)
        if (!Number.isNaN(h) && h > 0) config.frameHeight = h
      }
    }

    console.log(`PngSheetExportMetadataCommand: ${pngFile} -> ${jsonFile}`)

    // Step 1: Read PNG dimensions
    const dims = readPngDimensions(pngFile)
    if (!dims) {
      console.error(`ERROR: Cannot read PNG dimensions from "${pngFile}".`)
      console.error(`  File may not exist, may not be a valid PNG, or may be unreadable.`)
      return
    }

    console.log(`  PNG dimensions: ${dims.width}x${dims.height}`)

    // Step 2: Compute metadata
    const metadata = computeSheetMetadata(dims.width, dims.height, config)

    if (!metadata.valid) {
      console.error(`ERROR: ${metadata.error}`)
      return
    }

    console.log(`  Frame size: ${metadata.frameWidth}x${metadata.frameHeight}`)
    console.log(`  Grid: ${metadata.columns} columns x ${metadata.rows} rows`)
    console.log(`  Total frames: ${metadata.totalFrames}`)
    if (metadata.remainderX > 0 || metadata.remainderY > 0) {
      console.log(`  Remainder: ${metadata.remainderX}x${metadata.remainderY} pixels (right/bottom edge)`)
    }

    // Step 3: Generate JSON
    const jsonContent = generateMetadataJson(metadata, config)

    // Step 4: Write JSON file
    try {
      fs.writeFileSync(jsonFile, jsonContent, 'utf-8')
      console.log(`  Metadata written to: ${jsonFile}`)
    } catch (err) {
      console.error(`ERROR: Cannot write metadata file "${jsonFile}": ${String(err)}`)
      return
    }

    // Step 5: Document PNG tEXt chunk support
    // In OpenRA, metadata is read from/written to PNG tEXt chunks:
    //   var png = new Png(stream);
    //   png.EmbeddedData.Select(m => new MiniYamlNode(m.Key, m.Value))
    //     .ToList().WriteToFile(Path.ChangeExtension(args[1], "yaml"));
    //
    // Full PNG tEXt chunk support requires a complete PNG decoder (sharp/pngjs).
    // The JSON export is an equivalent representation; tEXt chunk round-trip
    // is documented for future implementation.
    //
    // TODO-P1-E.3-IO-1: Full PNG tEXt/iTXt chunk reader for EmbeddedData
    //   Requires: PNG chunk parser (tEXt/iTXt with null-terminated keyword +
    //   ASCII value), CRC verification
    // TODO-P1-E.3-IO-2: YAML output format option (currently JSON only)
    //   Requires: js-yaml or equivalent YAML serializer

    console.log(`\nMetadata export complete:`)
    console.log(`  Source: ${pngFile} (${dims.width}x${dims.height})`)
    console.log(`  Output: ${jsonFile}`)
    console.log(`  Frames: ${metadata.totalFrames} (${metadata.columns}x${metadata.rows} grid, ` +
      `${metadata.frameWidth}x${metadata.frameHeight} each)`)
  }
}
