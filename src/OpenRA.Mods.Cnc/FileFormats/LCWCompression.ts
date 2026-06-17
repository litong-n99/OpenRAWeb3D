/**
 * LCWCompression.ts — Lempel-Castle-Welch (Format80) compression
 * OpenRA 对照: OpenRA.Mods.Cnc/FileFormats/LCWCompression.cs
 *
 * 核心范式转换:
 * - C# FastByteReader + MemoryStream → TypeScript FastByteReader + Uint8Array
 * - C# byte[] output → TypeScript Uint8Array
 *
 * LCW (Format80) is used by SHP and TMP sprite formats in Tiberian Dawn.
 * The algorithm supports 5 command types for back-references, raw copies,
 * and RLE (run-length encoding).
 *
 * 二进制格式说明:
 * - Command byte determines the operation type:
 *   - Bit 7 clear (0x00-0x7F): case 2 — back-reference copy (count 3-18, offset 0-4095)
 *   - Bit 7 set, bit 6 clear (0x80-0xBF): case 1 — raw copy (count 1-63, 0=terminator)
 *   - Bit 7 set, bit 6 set, low 6 bits != 0x3E/0x3F (0xC3-0xFD): case 3 — back-reference with word offset
 *   - 0xFE: case 4 — RLE fill (word count + byte value)
 *   - 0xFF: case 5 — extended back-reference (word count + word offset)
 */

import { FastByteReader } from './FastByteReader.js'

// ---------------------------------------------------------------------------
// LCWCompression
// ---------------------------------------------------------------------------

/** LCW (Format80) compression/decompression.
 *
 * OpenRA 对照: LCWCompression class
 */
export const LCWCompression = {

  // -----------------------------------------------------------------------
  // Decompression (Public)
  // -----------------------------------------------------------------------

  /**
   * Decode LCW-compressed data into a destination buffer.
   *
   * OpenRA 对照: LCWCompression.DecodeInto(byte[], byte[], int, bool)
   *
   * @param src — LCW-compressed source data
   * @param dest — destination buffer (must be pre-allocated to expected size)
   * @param srcOffset — offset into src where compressed data begins (default 0)
   * @param reverse — if true, source offsets in case 3/5 are relative to
   *                  destIndex (forward reference mode for reverse decompression)
   * @returns number of bytes decompressed into dest
   */
  decodeInto(
    src: Uint8Array,
    dest: Uint8Array,
    srcOffset: number = 0,
    reverse: boolean = false,
  ): number {
    const ctx = new FastByteReader(src, srcOffset)
    let destIndex = 0

    while (true) {
      const i = ctx.readByte()
      if ((i & 0x80) === 0) {
        // ---- case 2: bit 7 clear — back-reference copy ----
        const secondByte = ctx.readByte()
        const count = ((i & 0x70) >> 4) + 3
        const rpos = ((i & 0x0f) << 8) + secondByte

        if (destIndex + count > dest.length) {
          return destIndex
        }

        replicatePrevious(dest, destIndex, destIndex - rpos, count)
        destIndex += count
      } else if ((i & 0x40) === 0) {
        // ---- case 1: bit 7 set, bit 6 clear — raw copy ----
        const count = i & 0x3f
        if (count === 0) {
          // terminator
          return destIndex
        }

        ctx.copyTo(dest, destIndex, count)
        destIndex += count
      } else {
        const count3 = i & 0x3f
        if (count3 === 0x3e) {
          // ---- case 4: 0xFE — RLE fill ----
          const count = ctx.readWord()
          const color = ctx.readByte()

          for (let end = destIndex + count; destIndex < end; destIndex++) {
            dest[destIndex] = color
          }
        } else {
          // ---- case 3 (0xC3-0xFD) or case 5 (0xFF) ----
          const count = count3 === 0x3f ? ctx.readWord() : count3 + 3
          const srcIndex = reverse
            ? destIndex - ctx.readWord()
            : ctx.readWord()

          if (srcIndex >= destIndex) {
            throw new Error(
              `srcIndex >= destIndex in LCW decompression: srcIndex=${srcIndex}, destIndex=${destIndex}`,
            )
          }

          for (let end = destIndex + count; destIndex < end; destIndex++) {
            dest[destIndex] = dest[srcIndex + (destIndex - (end - count))]
          }
        }
      }
    }
  },

  // -----------------------------------------------------------------------
  // Compression (Public)
  // -----------------------------------------------------------------------

  /**
   * Encode data using LCW compression (simple RLE-based variant).
   *
   * OpenRA 对照: LCWCompression.Encode(byte[])
   *
   * NOTE: This is a "quick and dirty" encoder that only uses raw copy
   * (case 1) and RLE repeat (case 4). It does not implement the full
   * back-reference search that would produce optimal compression.
   * It produces valid LCW streams that can be decoded by decodeInto.
   *
   * @param src — uncompressed source data
   * @returns LCW-compressed data
   */
  encode(src: Uint8Array): Uint8Array {
    // Build result in an array, then convert to Uint8Array
    const output: number[] = []
    let offset = 0
    const left = src.length
    let blockStart = 0

    while (offset < left) {
      const repeatCount = countSame(src, offset, 0xffff)
      if (repeatCount >= 4) {
        // Write pending raw block
        writeCopyBlocks(src, blockStart, offset - blockStart, output)

        // Command 4: RLE repeat (0xFE)
        output.push(0xfe)
        output.push(repeatCount & 0xff) // low byte
        output.push(repeatCount >> 8)   // high byte
        output.push(src[offset])         // value to repeat

        offset += repeatCount
        blockStart = offset
      } else {
        offset++
      }
    }

    // Write remaining raw block
    writeCopyBlocks(src, blockStart, offset - blockStart, output)

    // Write terminator
    output.push(0x80)

    return new Uint8Array(output)
  },
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Replicate bytes from earlier in the destination buffer.
 *
 * OpenRA 对照: LCWCompression.ReplicatePrevious(byte[], int, int, int)
 *
 * When srcIndex === destIndex - 1 (adjacent), replicates the last byte.
 * Otherwise copies from srcIndex onward.
 */
function replicatePrevious(
  dest: Uint8Array,
  destIndex: number,
  srcIndex: number,
  count: number,
): void {
  if (srcIndex > destIndex) {
    throw new Error(`srcIndex > destIndex in LCW: srcIndex=${srcIndex}, destIndex=${destIndex}`)
  }

  if (destIndex - srcIndex === 1) {
    // Adjacent copy: repeat last byte
    const val = dest[destIndex - 1]
    for (let i = 0; i < count; i++) {
      dest[destIndex + i] = val
    }
  } else {
    // Non-adjacent: copy from earlier position
    for (let i = 0; i < count; i++) {
      dest[destIndex + i] = dest[srcIndex + i]
    }
  }
}

/**
 * Count consecutive identical bytes.
 *
 * OpenRA 对照: LCWCompression.CountSame(byte[], int, int)
 */
function countSame(src: Uint8Array, offset: number, maxCount: number): number {
  maxCount = Math.min(src.length - offset, maxCount)
  if (maxCount <= 0) return 0

  const first = src[offset++]
  let count = 1

  while (count < maxCount && src[offset++] === first) {
    count++
  }

  return count
}

/**
 * Write raw copy blocks (command 0x80 | count) to the output stream.
 *
 * OpenRA 对照: LCWCompression.WriteCopyBlocks(byte[], int, int, MemoryStream)
 */
function writeCopyBlocks(
  src: Uint8Array,
  offset: number,
  count: number,
  output: number[],
): void {
  while (count > 0) {
    const writeNow = Math.min(count, 0x3f)
    output.push(0x80 | writeNow)
    for (let i = 0; i < writeNow; i++) {
      output.push(src[offset + i])
    }
    count -= writeNow
    offset += writeNow
  }
}
