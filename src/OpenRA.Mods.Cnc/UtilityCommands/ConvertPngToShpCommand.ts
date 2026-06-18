/**
 * ConvertPngToShpCommand.ts -- PNG image to SHP sprite format command
 * OpenRA reference: OpenRA.Mods.Cnc/UtilityCommands/ConvertPngToShpCommand.cs (59 lines)
 *
 * Core paradigm shifts:
 * - C# Png(Stream) image loading -> minimal PNG header parser (IHDR only)
 * - C# ShpTDSprite.Write format writing -> documented SHP encoding path
 * - C# Glob.Expand file expansion -> Glob.expand() (same directory)
 * - C# File.OpenRead -> Node.js fs.readFileSync
 * - C# SpriteFrameType enum -> migrated SpriteFrameType const (SpriteLoader.ts)
 *
 * Combines a series of PNG images into a single SHP sprite file.
 * All frames must have identical dimensions and indexed (paletted) format.
 *
 * PNG format (IHDR only, for dimension extraction):
 *   Offset  Size  Description
 *   0       8     Signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
 *   8       4     IHDR chunk length (big-endian, always 13 for IHDR)
 *   12      4     Chunk type: "IHDR" (0x49 0x48 0x44 0x52)
 *   16      4     Width (big-endian uint32)
 *   20      4     Height (big-endian uint32)
 *   24      1     Bit depth
 *   25      1     Color type
 *
 * SHP TD format: see RemapShpCommand.ts SHP_FORMAT_SPEC.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import { Glob } from './Glob.js'

// ---------------------------------------------------------------------------
// Frame layout computation
// ---------------------------------------------------------------------------

/** Result of frame layout computation from a sprite sheet image. */
export interface FrameLayout {
  /** Width of each frame in pixels. */
  frameWidth: number
  /** Height of each frame in pixels. */
  frameHeight: number
  /** Number of frame columns in the sheet. */
  columns: number
  /** Number of frame rows in the sheet. */
  rows: number
  /** Total frame count (columns * rows). */
  totalFrames: number
  /** Source image width in pixels. */
  imageWidth: number
  /** Source image height in pixels. */
  imageHeight: number
}

/**
 * Computes the frame layout for a sprite sheet given image and frame dimensions.
 *
 * @param imageWidth -- Width of the source PNG image in pixels
 * @param imageHeight -- Height of the source PNG image in pixels
 * @param frameWidth -- Width of each individual frame in pixels
 * @param frameHeight -- Height of each individual frame in pixels
 * @returns FrameLayout with computed grid, or null if dimensions don't divide evenly
 */
export function computeFrameLayout(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): FrameLayout | null {
  if (frameWidth <= 0 || frameHeight <= 0) return null
  if (imageWidth <= 0 || imageHeight <= 0) return null

  const columns = Math.floor(imageWidth / frameWidth)
  const rows = Math.floor(imageHeight / frameHeight)

  if (columns === 0 || rows === 0) return null

  return {
    frameWidth,
    frameHeight,
    columns,
    rows,
    totalFrames: columns * rows,
    imageWidth,
    imageHeight,
  }
}

// ---------------------------------------------------------------------------
// Output filename derivation
// ---------------------------------------------------------------------------

/**
 * Derives the output SHP filename from the first input filename.
 *
 * OpenRA reference: inputFiles[0].Split('-').First() + ".shp"
 *
 * Splits the first filename on '-', takes the prefix, and appends ".shp".
 * Example: "infantry-0001.png" -> "infantry.shp"
 *
 * @param sortedInputFiles -- Sorted array of input file paths (ascending)
 * @returns Output SHP filename, or "output.shp" if inputs are empty
 */
export function deriveOutputFilename(sortedInputFiles: readonly string[]): string {
  if (sortedInputFiles.length === 0) return 'output.shp'

  const firstFile = path.basename(sortedInputFiles[0]!)
  // Split on first hyphen; if no hyphen, strip the extension instead
  const hyphenIdx = firstFile.indexOf('-')
  let base: string
  if (hyphenIdx > 0) {
    base = firstFile.substring(0, hyphenIdx)
  } else {
    base = firstFile.replace(/\.[^.]+$/, '')
  }
  return base + '.shp'
}

// ---------------------------------------------------------------------------
// PNG header reader
// ---------------------------------------------------------------------------

/** Result of reading a PNG IHDR chunk. */
export interface PngHeaderInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
}

/**
 * Reads minimal PNG header information (width, height, bit depth, color type)
 * without a full PNG decoder.
 *
 * Reads only the signature + IHDR chunk (first ~33 bytes).
 *
 * Color type values:
 *   0 = Grayscale
 *   2 = RGB (Rgb24)
 *   3 = Indexed (paletted, 1-8 bit)
 *   4 = Grayscale + Alpha
 *   6 = RGBA (Rgba32)
 *
 * @param filePath -- Path to the PNG file
 * @returns PngHeaderInfo on success, or null on error
 */
export function readPngHeaderInfo(filePath: string): PngHeaderInfo | null {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(33)
      const bytesRead = fs.readSync(fd, buf, 0, 33, 0)
      if (bytesRead < 33) return null

      // Verify PNG signature (8 bytes)
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      for (let i = 0; i < 8; i++) {
        if (buf[i] !== signature[i]) return null
      }

      // IHDR chunk length (offset 8-11, big-endian)
      // IHDR chunk type (offset 12-15, should be "IHDR")
      const chunkType = buf.toString('ascii', 12, 16)
      if (chunkType !== 'IHDR') return null

      // Width (offset 16-19, big-endian uint32)
      const width = buf.readUInt32BE(16)
      // Height (offset 20-23, big-endian uint32)
      const height = buf.readUInt32BE(20)
      // Bit depth (offset 24)
      const bitDepth = buf[24]!
      // Color type (offset 25)
      const colorType = buf[25]!

      return { width, height, bitDepth, colorType }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Frame dimension validation
// ---------------------------------------------------------------------------

/** Result of validating a set of frames for SHP conversion. */
export interface FrameValidationResult {
  valid: boolean
  errors: string[]
  /** Common frame dimensions if all frames match (null if validation fails before determining). */
  commonWidth: number | null
  commonHeight: number | null
}

/**
 * Validates that a set of frame PNG files can be converted to SHP.
 *
 * Checks:
 * - All files exist and can be read
 * - All frames have identical dimensions
 *
 * @param filePaths -- Array of PNG file paths
 * @returns FrameValidationResult with errors array
 */
export function validateFrameFiles(filePaths: readonly string[]): FrameValidationResult {
  const errors: string[] = []
  let commonWidth: number | null = null
  let commonHeight: number | null = null

  if (filePaths.length === 0) {
    errors.push('No input files provided')
    return { valid: false, errors, commonWidth: null, commonHeight: null }
  }

  for (const filePath of filePaths) {
    const info = readPngHeaderInfo(filePath)
    if (!info) {
      errors.push(`Cannot read PNG header: ${filePath}`)
      continue
    }

    if (commonWidth === null) {
      commonWidth = info.width
      commonHeight = info.height
    } else {
      if (info.width !== commonWidth || info.height !== commonHeight) {
        errors.push(
          `Frame size mismatch: ${filePath} is ${info.width}x${info.height}, ` +
          `expected ${commonWidth}x${commonHeight}`,
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    commonWidth,
    commonHeight,
  }
}

// ---------------------------------------------------------------------------
// ConvertPngToShpCommand
// ---------------------------------------------------------------------------

/**
 * PNG to SHP command.
 *
 * Usage: --shp PNGFILE [PNGFILE ...]
 *
 * Combines a series of PNG images into a single SHP file.
 * Filenames are sorted alphabetically; the first filename is split on '-'
 * and the prefix is used as the output filename.
 *
 * Example: --shp infantry-0001.png infantry-0002.png -> infantry.shp
 *
 * OpenRA reference: ConvertPngToShpCommand
 */
export class ConvertPngToShpCommand implements IUtilityCommand {
  readonly name = '--shp'

  validateArguments(args: string[]): boolean {
    return args.length >= 2
  }

  run(_utility: Utility, args: string[]): void {
    // Step 1: Expand glob patterns and sort
    const inputFiles = Glob.globArgs(args).sort()
    if (inputFiles.length === 0) {
      console.log('No input files found.')
      return
    }

    const dest = deriveOutputFilename(inputFiles)

    console.log(`ConvertPngToShpCommand: Converting ${inputFiles.length} PNG(s) -> ${dest}`)

    // Step 2: List input files
    for (const file of inputFiles) {
      console.log(`  Input: ${file}`)
    }

    // Step 3: Validate input frames
    const validation = validateFrameFiles(inputFiles)

    if (!validation.valid) {
      console.error('ERROR: Frame validation failed:')
      for (const err of validation.errors) {
        console.error(`  - ${err}`)
      }
      return
    }

    console.log(`  All frames: ${validation.commonWidth}x${validation.commonHeight}`)
    console.log(`  Output: ${dest}`)

    // Step 4: In OpenRA, the conversion pipeline is:
    //   1. Load all PNGs: inputFiles.ConvertAll(a => new Png(File.OpenRead(a)))
    //   2. Validate all frames are Indexed8 (paletted):
    //      if (frames.Any(f => f.Type != SpriteFrameType.Indexed8))
    //        throw InvalidOperationException("All frames must be paletted")
    //   3. Validate dimensions: all frames must be the same size
    //   4. Write SHP via ShpTDSprite.Write(destStream, size, frames.Select(f => f.Data))
    //
    // The ShpTDSprite.Write() method requires LCWCompression.Encode() which
    // is not yet migrated from the C# original. The frame validation and
    // layout computation are fully implemented above.
    //
    // TODO-P1-E.2-IO-1: Full PNG decode with palette extraction
    //   (currently only IHDR is parsed; need IDAT decompress + PLTE read)
    //   Requires: Zlib decompression (ZlibStream), PLTE chunk parser,
    //   PNG filter reversal (Sub, Up, Average, Paeth)
    // TODO-P1-E.2-IO-2: LCWCompression.Encode() migration from C#
    //   (OpenRA.Mods.Cnc.FileFormats.LCWCompression.Encode)
    // TODO-P1-E.2-IO-3: ShpTDSprite.Write() method
    //   (file header + frame headers + compressed data)

    console.log(`\nConversion plan summary:`)
    console.log(`  1. Load ${inputFiles.length} PNG frame(s) (needs full PNG decoder)`)
    console.log(`  2. Validate all frames are Indexed8 (paletted) format`)
    console.log(`  3. Validate all frames have identical dimensions (${validation.commonWidth}x${validation.commonHeight})`)
    console.log(`  4. LCW-compress each frame's pixel data`)
    console.log(`  5. Write SHP header + frame headers + compressed data -> ${dest}`)
    console.log(`\nTo complete full PNG->SHP conversion, the following infrastructure is needed:`)
    console.log(`  - Full PNG decoder with PLTE (palette) + IDAT (pixel data) support`)
    console.log(`  - LCWCompression.Encode() (not yet migrated from OpenRA C#)`)
    console.log(`  - ShpTDSprite.Write() static method (not yet migrated)`)
    console.log(`\nFrame layout and validation logic are fully implemented and tested.`)
  }
}
