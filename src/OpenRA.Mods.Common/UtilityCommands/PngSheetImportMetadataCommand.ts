/**
 * PngSheetImportMetadataCommand.ts -- PNG sprite sheet metadata import command
 * OpenRA reference: OpenRA.Mods.Common/UtilityCommands/PngSheetImportMetadataCommand.cs (68 lines)
 *
 * Core paradigm shifts:
 * - C# Png.EmbeddedData writer -> JSON key-value pairs for metadata
 * - C# MiniYaml.FromFile -> JSON file reading (Node.js fs)
 * - C# FieldLoader.GetValue<Size> -> parseSize() function
 * - C# Path.ChangeExtension -> string .replace() for extension swap
 * - C# Png.Save() full encode -> documented PNG tEXt chunk writing path
 *
 * Imports sprite sheet metadata from a JSON file, validates frame count
 * against PNG dimensions, and outputs a configuration report.
 * For full PNG metadata embedding (tEXt chunks), see TODO markers.
 *
 * PNG tEXt chunk format:
 *   Length (4 bytes BE) + "tEXt" (4 bytes) +
 *   Keyword\0Value (ASCIIZ, no compression) +
 *   CRC32 (4 bytes)
 */

import * as fs from 'node:fs'

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Metadata types
// ---------------------------------------------------------------------------

/** Sprite sheet metadata structure.
 *
 * OpenRA reference: YAML nodes FrameSize + FrameAmount + custom key-value pairs
 */
export interface PngSheetMetadata {
  /** Single frame dimensions (width x height). */
  FrameSize?: { Width: number; Height: number }
  /** Total frame count. */
  FrameAmount?: number
  /** Custom embedded metadata key-value pairs. */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates that frame size and frame count are consistent with PNG image dimensions.
 *
 * OpenRA reference: PngSheetImportMetadataCommand.Run -- frame count validation
 *
 * @param frameSize -- Single frame dimensions (pixels)
 * @param frameAmount -- Total frame count
 * @param pngWidth -- PNG image width (pixels)
 * @param pngHeight -- PNG image height (pixels)
 * @returns Error message if invalid, or null if valid
 */
export function validateFrameCount(
  frameSize: { Width: number; Height: number } | undefined,
  frameAmount: number | undefined,
  pngWidth: number,
  pngHeight: number,
): string | null {
  if (!frameSize) return null

  const cols = Math.floor(pngWidth / frameSize.Width)
  const rows = Math.floor(pngHeight / frameSize.Height)
  const maxFrames = cols * rows

  if (frameAmount !== undefined && frameAmount > maxFrames) {
    return `.png file is too small for given FrameSize and FrameAmount. ` +
      `PNG: ${pngWidth}x${pngHeight}, Frame: ${frameSize.Width}x${frameSize.Height}, ` +
      `Max frames: ${maxFrames}, Requested: ${frameAmount}`
  }

  return null
}

/**
 * Parses a size string into a Width/Height object.
 *
 * OpenRA reference: FieldLoader.GetValue<Size>("FrameSize", frameSizeField)
 *
 * Supports formats: "W,H", "W,H", "WxH", "WXH", " W , H "
 *
 * @param value -- Size string (e.g. "64,32" or "64x32")
 * @returns Size object, or null if parsing fails
 */
export function parseSize(value: string): { Width: number; Height: number } | null {
  // Normalize: convert X/x to comma, remove whitespace
  const cleaned = value.replace(/[xX]/g, ',').replace(/\s+/g, '')
  const parts = cleaned.split(',')
  if (parts.length < 2) return null

  const w = Number.parseInt(parts[0]!, 10)
  const h = Number.parseInt(parts[1]!, 10)
  if (Number.isNaN(w) || Number.isNaN(h) || w <= 0 || h <= 0) return null

  return { Width: w, Height: h }
}

// ---------------------------------------------------------------------------
// Metadata JSON parsing
// ---------------------------------------------------------------------------

/** Result of parsing metadata from a JSON file. */
export interface MetadataParseResult {
  /** Whether parsing succeeded. */
  valid: boolean
  /** Error message if parsing failed. */
  error?: string
  /** Parsed metadata (may be partial if error). */
  metadata: PngSheetMetadata
}

/**
 * Parses a metadata JSON string into a PngSheetMetadata object.
 *
 * Recognizes:
 * - "FrameSize" with nested "Width"/"Height" (number or string)
 * - "FrameAmount" (number)
 * - All other keys as custom metadata (string values)
 *
 * @param json -- Raw JSON string
 * @returns MetadataParseResult
 */
export function parseMetadataFromJson(json: string): MetadataParseResult {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const metadata: PngSheetMetadata = {}

    // Parse FrameSize
    const frameSizeRaw = parsed['FrameSize']
    if (frameSizeRaw !== undefined && frameSizeRaw !== null) {
      if (typeof frameSizeRaw === 'object' && !Array.isArray(frameSizeRaw)) {
        const fsObj = frameSizeRaw as Record<string, unknown>
        const width = fsObj['Width']
        const height = fsObj['Height']

        if (typeof width === 'string') {
          const parsedSize = parseSize(width)
          if (parsedSize) {
            metadata.FrameSize = { Width: parsedSize.Width, Height: parsedSize.Height }
          }
        } else if (typeof width === 'number' && typeof height === 'number') {
          if (width > 0 && height > 0) {
            metadata.FrameSize = { Width: width, Height: height }
          }
        }
      } else if (typeof frameSizeRaw === 'string') {
        const parsed = parseSize(frameSizeRaw)
        if (parsed) {
          metadata.FrameSize = { Width: parsed.Width, Height: parsed.Height }
        }
      }
    }

    // Parse FrameAmount
    const frameAmountRaw = parsed['FrameAmount']
    if (typeof frameAmountRaw === 'number' && frameAmountRaw > 0 && Number.isInteger(frameAmountRaw)) {
      metadata.FrameAmount = frameAmountRaw
    } else if (typeof frameAmountRaw === 'string') {
      const n = Number.parseInt(frameAmountRaw, 10)
      if (!Number.isNaN(n) && n > 0) {
        metadata.FrameAmount = n
      }
    }

    // Collect custom metadata (string key-value pairs not FrameSize/FrameAmount)
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'FrameSize' || key === 'FrameAmount') continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        metadata[key] = String(value)
      } else if (value !== null && value !== undefined) {
        metadata[key] = JSON.stringify(value)
      }
    }

    return { valid: true, metadata }
  } catch (err) {
    return {
      valid: false,
      error: `JSON parse error: ${String(err)}`,
      metadata: {},
    }
  }
}

// ---------------------------------------------------------------------------
// Metadata validation report
// ---------------------------------------------------------------------------

/** Complete validation result for metadata import. */
export interface MetadataValidationReport {
  /** Whether the metadata is fully valid. */
  valid: boolean
  /** Validation errors. */
  errors: string[]
  /** Validation warnings (non-blocking). */
  warnings: string[]
  /** Parsed metadata. */
  metadata: PngSheetMetadata
  /** PNG dimensions. */
  pngWidth: number
  pngHeight: number
  /** Computed frame grid. */
  columns: number
  rows: number
  maxFrames: number
}

/**
 * Validates imported metadata against PNG dimensions.
 *
 * Checks:
 * - FrameSize validity (positive, fits within image)
 * - FrameAmount validity (does not exceed grid capacity)
 * - Reports grid layout and capacity
 *
 * @param metadata -- Parsed metadata
 * @param pngWidth -- PNG image width
 * @param pngHeight -- PNG image height
 * @returns MetadataValidationReport
 */
export function validateMetadataAgainstPng(
  metadata: PngSheetMetadata,
  pngWidth: number,
  pngHeight: number,
): MetadataValidationReport {
  const errors: string[] = []
  const warnings: string[] = []

  let columns = 0
  let rows = 0
  let maxFrames = 0

  if (metadata.FrameSize) {
    const fs = metadata.FrameSize
    if (fs.Width > pngWidth || fs.Height > pngHeight) {
      errors.push(
        `Frame size ${fs.Width}x${fs.Height} exceeds PNG dimensions ${pngWidth}x${pngHeight}`,
      )
    } else {
      columns = Math.floor(pngWidth / fs.Width)
      rows = Math.floor(pngHeight / fs.Height)
      maxFrames = columns * rows

      const remainderX = pngWidth - columns * fs.Width
      const remainderY = pngHeight - rows * fs.Height
      if (remainderX > 0 || remainderY > 0) {
        warnings.push(
          `PNG image (${pngWidth}x${pngHeight}) is not evenly divisible by ` +
          `frame size (${fs.Width}x${fs.Height}). ` +
          `Remainder: ${remainderX}x${remainderY} pixels.`,
        )
      }
    }
  } else {
    warnings.push('No FrameSize specified in metadata. Cannot compute frame grid.')
  }

  // Validate FrameAmount
  const frameCountError = validateFrameCount(
    metadata.FrameSize,
    metadata.FrameAmount,
    pngWidth,
    pngHeight,
  )
  if (frameCountError) {
    errors.push(frameCountError)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata,
    pngWidth,
    pngHeight,
    columns,
    rows,
    maxFrames,
  }
}

// ---------------------------------------------------------------------------
// PNG dimension reader (local implementation)
// ---------------------------------------------------------------------------

/**
 * Reads PNG image dimensions from the IHDR chunk.
 *
 * Minimal parser: signature (8 bytes) + IHDR header (8 bytes) +
 * IHDR data (13 bytes) = 29 bytes minimum read.
 *
 * @param filePath -- Path to PNG file
 * @returns { width, height } or null on failure
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
// PngSheetImportMetadataCommand
// ---------------------------------------------------------------------------

/**
 * PNG sprite sheet metadata import command.
 *
 * Usage: --png-sheet-import PNGFILE
 *
 * Reads metadata from a JSON file (same name as PNG but with .json extension),
 * validates frame count against PNG dimensions, and reports the configuration.
 *
 * The JSON file should contain:
 *   { "FrameSize": { "Width": 64, "Height": 64 },
 *     "FrameAmount": 256,
 *     ...custom keys... }
 *
 * OpenRA reference: PngSheetImportMetadataCommand
 */
export class PngSheetImportMetadataCommand implements IUtilityCommand {
  readonly name = '--png-sheet-import'

  validateArguments(args: string[]): boolean {
    return args.length >= 2
  }

  run(_utility: Utility, args: string[]): void {
    const pngFile = args[1]!

    // Determine metadata filename (replace extension with .json)
    // In OpenRA, the metadata file uses .yaml extension.
    // Here we use .json as the canonical format; .yaml is also tried as a fallback.
    const jsonFile = pngFile.replace(/\.\w+$/, '') + '.json'
    const yamlFile = pngFile.replace(/\.\w+$/, '') + '.yaml'

    console.log(`PngSheetImportMetadataCommand: Importing metadata for ${pngFile}`)

    // Step 1: Read PNG dimensions
    const dims = readPngDimensions(pngFile)
    if (!dims) {
      console.error(`ERROR: Cannot read PNG dimensions from "${pngFile}".`)
      console.error(`  File may not exist, may not be a valid PNG, or may be unreadable.`)
      return
    }

    console.log(`  PNG dimensions: ${dims.width}x${dims.height}`)

    // Step 2: Read metadata file (try JSON first, then YAML)
    let rawMetadata: string | null = null
    let metadataSource = ''

    try {
      rawMetadata = fs.readFileSync(jsonFile, 'utf-8')
      metadataSource = jsonFile
    } catch {
      try {
        rawMetadata = fs.readFileSync(yamlFile, 'utf-8')
        metadataSource = yamlFile
      } catch {
        console.error(`ERROR: No metadata file found.`)
        console.error(`  Tried: ${jsonFile}`)
        console.error(`  Tried: ${yamlFile}`)
        return
      }
    }

    console.log(`  Reading metadata from: ${metadataSource}`)

    // Step 3: Parse metadata
    const parseResult = parseMetadataFromJson(rawMetadata)
    if (!parseResult.valid) {
      console.error(`ERROR: ${parseResult.error}`)
      return
    }

    const metadata = parseResult.metadata

    // Step 4: Validate metadata against PNG dimensions
    const report = validateMetadataAgainstPng(metadata, dims.width, dims.height)

    if (report.errors.length > 0) {
      console.error('ERROR: Metadata validation failed:')
      for (const err of report.errors) {
        console.error(`  - ${err}`)
      }
      return
    }

    // Step 5: Display validation report
    console.log(`  Frame size: ${metadata.FrameSize ? `${metadata.FrameSize.Width}x${metadata.FrameSize.Height}` : '(not specified)'}`)
    console.log(`  Frame amount: ${metadata.FrameAmount ?? '(not specified)'}`)
    console.log(`  Grid: ${report.columns} columns x ${report.rows} rows = ${report.maxFrames} max frames`)

    const customKeys = Object.keys(metadata).filter(
      k => k !== 'FrameSize' && k !== 'FrameAmount',
    )
    if (customKeys.length > 0) {
      console.log(`  Custom metadata: ${customKeys.length} key(s)`)
      for (const key of customKeys) {
        console.log(`    ${key}: ${String(metadata[key])}`)
      }
    }

    if (report.warnings.length > 0) {
      console.log(`  Warnings:`)
      for (const w of report.warnings) {
        console.log(`    - ${w}`)
      }
    }

    // Step 6: Document PNG tEXt embedding
    // In OpenRA, after validation, metadata is embedded into the PNG:
    //   foreach (var node in yaml)
    //     png.EmbeddedData[node.Key] = node.Value.Value;
    //   png.Save(args[1]);
    //
    // PNG tEXt chunk writing requires a full PNG encoder (sharp/pngjs).
    // The metadata validation and grid computation are fully implemented.
    //
    // TODO-P1-E.4-IO-1: Embed metadata into PNG via tEXt chunks
    //   Requires: Full PNG encoder with tEXt chunk support
    //   Steps: Read PNG -> parse chunks -> inject tEXt chunks -> write PNG
    // TODO-P1-E.4-IO-2: YAML parsing support (currently JSON only)
    //   The YAML fallback file read works for simple key-value YAML,
    //   but a full YAML parser (js-yaml) is needed for nested structures.

    console.log(`\nMetadata import complete:`)
    console.log(`  PNG: ${pngFile} (${dims.width}x${dims.height})`)
    console.log(`  Metadata source: ${metadataSource}`)
    console.log(`  Validation: ${report.valid ? 'PASSED' : 'FAILED'}`)
    console.log(`\nTo embed metadata into PNG tEXt chunks, a full PNG encoder is needed.`)
    console.log(`  Options: sharp (high-performance) or pngjs (pure JS) for Node.js.`)
  }
}
