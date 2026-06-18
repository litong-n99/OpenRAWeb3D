/**
 * RemapShpCommand.ts -- SHP sprite palette remap command
 * OpenRA reference: OpenRA.Mods.Cnc/UtilityCommands/RemapShpCommand.cs (89 lines)
 *
 * Core paradigm shifts:
 * - C# ImmutablePalette -> HardwarePalette / palette arrays (Ch2)
 * - C# ShpTDSprite -> documented binary format (Ch19 ShpTDLoader.ts available)
 * - C# File.OpenRead -> Node.js fs.readFileSync
 * - C# Color.FromArgb -> numeric bit extraction of RGBA
 * - C# LINQ MinBy -> manual best-match search with distance tracking
 *
 * Remaps SHP sprite palette indices from one palette to another.
 * The remap algorithm is fully implemented; binary file I/O for SHP
 * format requires a full SHP codec (LCW compression + header parsing).
 *
 * SHP TD Format (Tiberian Dawn):
 *   Offset  Size  Description
 *   0       2     Image count (uint16 LE)
 *   2       2     Zero (padding)
 *   4       2     Zero (padding)
 *   6       2     Width (uint16 LE)
 *   8       2     Height (uint16 LE)
 *   10      4     Zero (padding)
 *   14      N*8   Frame headers (N = image count)
 *         Each frame header (8 bytes):
 *           4     FileOffset (24 bits) | Format (8 bits, uint32 LE)
 *           2     RefOffset (uint16 LE)
 *           2     RefFormat (uint16 LE)
 *   After   +8    EOF header (fileOffset points to end of data)
 *   headers +8    All-zeroes header (8 bytes of 0x00)
 *   Then         Frame data (LCW-compressed, Format 0x80)
 *                or XOR-delta (Format 0x20/0x40)
 */

import * as fs from 'node:fs'

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// SHP Binary Format Documentation
// ---------------------------------------------------------------------------

/**
 * SHP TD (Tiberian Dawn) sprite format specification.
 *
 * SHP files contain multiple frames of paletted (Indexed8) pixel data,
 * possibly compressed with LCW (Format80) or XOR-delta (Format20/Format40).
 * Each frame, when decompressed, is width*height bytes of palette indices.
 *
 * Frame format codes:
 * - 0x20 XORPrev: XOR delta against the immediately previous frame
 * - 0x40 XORLCW:  XOR delta against a referenced frame (by file offset)
 * - 0x80 LCW:     Standalone LCW-compressed frame data
 *
 * When writing a new SHP, all frames should use Format.LCW (0x80)
 * for simplicity -- no inter-frame dependencies.
 */
export const SHP_FORMAT_SPEC = {
  /** Magic/identification: SHP TD has no magic bytes; identified by structural heuristics. */
  signature: '<none>',
  /** Header size before frame headers (in bytes). */
  headerSize: 14,
  /** Size of each frame header entry (in bytes). */
  frameHeaderSize: 8,
  /** Format code for standalone LCW-compressed frames. */
  formatLCW: 0x80,
  /** Format code for XOR-delta against previous frame. */
  formatXORPrev: 0x20,
  /** Format code for XOR-delta against referenced frame. */
  formatXORLCW: 0x40,
  /** Extra header entries after last frame: one EOF + one all-zeroes. */
  extraHeaders: 2,
} as const

// ---------------------------------------------------------------------------
// Color distance computation
// ---------------------------------------------------------------------------

/**
 * Computes the Manhattan distance between two ARGB color values.
 *
 * OpenRA reference: RemapShpCommand.ColorDistance(uint a, uint b)
 *
 * Color format: 0xAARRGGBB (Alpha in the high byte).
 * Only compares RGB channels (ignores Alpha), with equal channel weights.
 *
 * @param a -- 32-bit ARGB color (bits 24-31=Alpha, 16-23=Red, 8-15=Green, 0-7=Blue)
 * @param b -- 32-bit ARGB color
 * @returns Sum of absolute differences across R, G, B channels
 */
export function colorDistance(a: number, b: number): number {
  // ARGB format: bits 24-31=Alpha, 16-23=Red, 8-15=Green, 0-7=Blue
  const aR = (a >>> 16) & 0xff
  const aG = (a >>> 8) & 0xff
  const aB = a & 0xff
  const bR = (b >>> 16) & 0xff
  const bG = (b >>> 8) & 0xff
  const bB = b & 0xff

  return Math.abs(aR - bR) + Math.abs(aG - bG) + Math.abs(aB - bB)
}

// ---------------------------------------------------------------------------
// Palette remap computation
// ---------------------------------------------------------------------------

/**
 * Computes an optimal palette remap table.
 *
 * Maps fixed entries (first 4 indices) and player color remap range (up to 16 entries),
 * then finds the best match in the destination palette for all remaining colors
 * using Manhattan distance.
 *
 * OpenRA reference: RemapShpCommand.Run -- remap dictionary construction
 *
 * @param srcRemapIndex -- Source palette player color remap indices
 * @param destRemapIndex -- Destination palette player color remap indices
 * @param srcPalette -- Source palette (index -> 32-bit ARGB color)
 * @param destPalette -- Destination palette (index -> 32-bit ARGB color)
 * @param paletteSize -- Palette size (default 256)
 * @returns Remap table: srcIndex -> destIndex
 */
export function computeRemap(
  srcRemapIndex: readonly number[],
  destRemapIndex: readonly number[],
  srcPalette: Uint32Array,
  destPalette: Uint32Array,
  paletteSize: number = 256,
): Map<number, number> {
  const remap = new Map<number, number>()

  // Fixed first 4 entries (OpenRA: "the first 4 entries are fixed")
  for (let i = 0; i < 4; i++) {
    remap.set(i, i)
  }

  // Player color remap range -- up to 16 entries, only for valid indices
  // OpenRA: "the remap range is always 16 entries"
  const remapRange = Math.min(srcRemapIndex.length, destRemapIndex.length, 16)
  for (let i = 0; i < remapRange; i++) {
    const srcIdx = srcRemapIndex[i]
    const destIdx = destRemapIndex[i]
    if (srcIdx === undefined || destIdx === undefined) continue
    remap.set(srcIdx, destIdx)
  }

  // Remaining colors: best match by channel-wise Manhattan distance
  // NOTE: Uses a Set for O(1) "used destination index" lookup;
  // the C# version uses Enumerable.ContainsValue which is O(n).
  const usedDestIndices = new Set(remap.values())

  for (let i = 0; i < paletteSize; i++) {
    if (remap.has(i)) continue

    let bestDist = Number.MAX_SAFE_INTEGER
    let bestIdx = -1

    for (let j = 0; j < paletteSize; j++) {
      if (usedDestIndices.has(j)) continue

      const dist = colorDistance(destPalette[j]!, srcPalette[i]!)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = j
      }
    }

    if (bestIdx >= 0) {
      remap.set(i, bestIdx)
      usedDestIndices.add(bestIdx)
    }
  }

  return remap
}

// ---------------------------------------------------------------------------
// Frame data remapping
// ---------------------------------------------------------------------------

/**
 * Applies a palette index remap table to a frame's pixel data.
 *
 * Each pixel is a palette index (0-255); the remap table maps source
 * palette indices to destination palette indices.
 *
 * @param pixels -- Frame pixel data (palette indices, 0-255)
 * @param remapTable -- Mapping from source index to destination index
 * @returns New Uint8Array with remapped pixel data
 */
export function remapFrameData(
  pixels: Uint8Array,
  remapTable: Map<number, number>,
): Uint8Array {
  const result = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i++) {
    const srcIdx = pixels[i]!
    const destIdx = remapTable.get(srcIdx)
    result[i] = destIdx !== undefined ? destIdx : srcIdx
  }
  return result
}

/**
 * Computes statistics about a remap table.
 *
 * @param remapTable -- The remap table
 * @returns Object with stats about the remapping
 */
export function computeRemapStats(
  remapTable: Map<number, number>,
): {
  totalMappings: number
  identityCount: number
  changedCount: number
  fixedEntries: number
} {
  let identityCount = 0
  let changedCount = 0

  for (const [src, dest] of remapTable) {
    if (src === dest) {
      identityCount++
    } else {
      changedCount++
    }
  }

  return {
    totalMappings: remapTable.size,
    identityCount,
    changedCount,
    fixedEntries: Math.min(4, remapTable.size),
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parses a "mod:palette" argument string.
 *
 * OpenRA reference: args[1].Split(':')
 *
 * @param arg -- Argument in "mod:palette" format
 * @returns Object with mod and palette parts, or null if malformed
 */
export function parseModPaletteArg(arg: string): { mod: string; palette: string } | null {
  const colonIdx = arg.indexOf(':')
  if (colonIdx < 1) return null
  return {
    mod: arg.substring(0, colonIdx),
    palette: arg.substring(colonIdx + 1),
  }
}

// ---------------------------------------------------------------------------
// RemapShpCommand
// ---------------------------------------------------------------------------

/**
 * SHP palette remap command.
 *
 * Usage: --remap SRCMOD:PAL DESTMOD:PAL SRCSHP DESTSHP
 *
 * Remaps the palette indices of an SHP sprite from one palette to another.
 *
 * OpenRA reference: RemapShpCommand
 */
export class RemapShpCommand implements IUtilityCommand {
  readonly name = '--remap'

  validateArguments(args: string[]): boolean {
    return args.length >= 5
  }

  run(_utility: Utility, args: string[]): void {
    const srcModPal = args[1]!
    const destModPal = args[2]!
    const srcShp = args[3]!
    const destShp = args[4]!

    console.log(`RemapShpCommand: Remapping ${srcShp} -> ${destShp}`)
    console.log(`  Source mod:palette = ${srcModPal}`)
    console.log(`  Dest mod:palette   = ${destModPal}`)

    // Step 1: Parse arguments
    const srcParsed = parseModPaletteArg(srcModPal)
    const destParsed = parseModPaletteArg(destModPal)

    if (!srcParsed || !destParsed) {
      console.error('ERROR: Arguments must be in "mod:palette" format')
      console.error(`  Received: "${srcModPal}" "${destModPal}"`)
      return
    }

    console.log(`  Resolved src mod="${srcParsed.mod}" palette="${srcParsed.palette}"`)
    console.log(`  Resolved dest mod="${destParsed.mod}" palette="${destParsed.palette}"`)

    // Step 2: Build remap table
    // In OpenRA, palettes are loaded from ModData:
    //   var srcPaletteInfo = srcModData.DefaultRules.Actors[SystemActors.Player]
    //     .TraitInfo<PlayerColorPaletteInfo>();
    //   var srcRemapIndex = srcPaletteInfo.RemapIndex;
    //   var srcPalette = new ImmutablePalette(args[1].Split(':')[1], [0], shadowIndex);
    //
    // Without full ModData + palette loading, we use identity palettes
    // and an empty remap index. The remap algorithm still computes the full
    // 256-entry mapping; without real palette data, the "best match" phase
    // assigns sequentially. Real palette data from --transparent-palette
    // files (PAL format) is required for accurate color-distance matching.
    //
    // TODO: Load palette data from ModData when the utility has access to
    //       ModData with PlayerColorPaletteInfo + ImmutablePalette.
    //       The computeRemap() function accepts palette data once available.

    const emptyRemapIndex: number[] = []
    const identityPalette = createIdentityPalette(256)

    const remapTable = computeRemap(
      emptyRemapIndex,
      emptyRemapIndex,
      identityPalette,
      identityPalette,
    )

    const stats = computeRemapStats(remapTable)
    console.log(`  Remap table: ${stats.totalMappings} entries (${stats.changedCount} changed, ${stats.identityCount} identity)`)
    console.log(`  NOTE: Identity palette used (no palette files loaded).`)
    console.log(`        To use real palettes, load --transparent-palette files via ModData.`)

    // Step 3: SHP file processing
    // In OpenRA:
    //   using (var s = File.OpenRead(args[3]))
    //   using (var destStream = File.Create(args[4]))
    //   {
    //     var srcImage = new ShpTDSprite(s);
    //     ShpTDSprite.Write(destStream, srcImage.Size,
    //       srcImage.Frames.Select(im => im.Data.Select(px => (byte)remap[px]).ToArray()));
    //   }
    //
    // The ShpTDLoader.ts (src/OpenRA.Mods.Cnc/SpriteLoaders/ShpTDLoader.ts)
    // can read SHP files. The remapFrameData() function (above) applies
    // the index remap to decompressed frame pixel data.
    //
    // For writing: the TS ShpTDLoader does not yet have a static Write()
    // method. The following TODO items remain for full SHP I/O:
    //
    // TODO-P1-E.1-IO-1: Verify srcShp exists and is a valid SHP TD file
    // TODO-P1-E.1-IO-2: Load SHP via ShpTDSprite constructor
    //   (requires the ShpTDSprite class from ShpTDLoader.ts)
    // TODO-P1-E.1-IO-3: Apply remapFrameData() to each decompressed frame
    // TODO-P1-E.1-IO-4: Write output SHP via a ShpTDSprite.Write() method
    //   (requires LCWCompression.Encode which is not yet migrated)

    // Step 4: Verify files exist (best effort)
    try {
      const srcStat = fs.statSync(srcShp)
      console.log(`  Source SHP: ${srcShp} (${srcStat.size} bytes)`)
    } catch {
      console.log(`  Source SHP: ${srcShp} (file not found -- will be resolved at I/O time)`)
    }
    console.log(`  Output SHP: ${destShp}`)

    // Step 5: Document remaining steps
    console.log(`\nRemap plan summary:`)
    console.log(`  1. Load source SHP: ${srcShp}`)
    console.log(`  2. Decompress frames (LCW/XOR delta)`)
    console.log(`  3. Apply remap table (${stats.totalMappings} palette index mappings)`)
    console.log(`  4. Re-compress frames (LCW)`)
    console.log(`  5. Write destination SHP: ${destShp}`)
    console.log(`\nTo complete full SHP I/O, the following infrastructure is needed:`)
    console.log(`  - LCWCompression.Encode() (not yet migrated from OpenRA C#)`)
    console.log(`  - ShpTDSprite.Write() static method (not yet migrated)`)
    console.log(`  - ImmutablePalette loading from PAL files via ModData`)
    console.log(`  - PlayerColorPaletteInfo trait for remap index extraction`)
    console.log(`\nThe remap table (computeRemap) and pixel remapping (remapFrameData)`)
    console.log(`  algorithms are fully implemented and ready for integration.`)
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Creates an identity palette where each index maps to a distinct color.
 * Used as a fallback when real palette data is unavailable.
 *
 * Each index is encoded into the RGB bytes for debugging purposes:
 *   R = index, G = index, B = index
 *
 * @param size -- Palette size (default 256)
 * @returns Uint32Array of ARGB colors
 */
function createIdentityPalette(size: number): Uint32Array {
  const palette = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    // 0xFF_i_i_i: opaque, with index encoded as RGB for distinguishability
    palette[i] = 0xff000000 | (i << 16) | (i << 8) | i
  }
  return palette
}
