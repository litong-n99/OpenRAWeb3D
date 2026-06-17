/**
 * XORDeltaCompression.ts — XOR delta decompression for WSA video frames
 * OpenRA 对照: OpenRA.Mods.Cnc/FileFormats/XORDeltaCompression.cs
 *
 * 核心范式转换:
 * - C# FastByteReader on byte[] → TypeScript FastByteReader on Uint8Array
 * - C# XOR on byte → same XOR semantics on Uint8Array
 *
 * Format 40: XOR each byte against previous frame data.
 * Used for WSA video frame decoding (delta frames are XORed onto base frame).
 *
 * 二进制格式说明:
 * - 0x00..0x7F: case 5/6 — XOR count bytes from stream, or XOR count copies of one value
 * - 0x80..0xFF: case 1/2/3/4 — skip count bytes, or XOR count bytes from stream/single value
 */

import { FastByteReader } from './FastByteReader.js'

// ---------------------------------------------------------------------------
// XORDeltaCompression
// ---------------------------------------------------------------------------

/** XOR delta decompression (Format40).
 *
 * OpenRA 对照: XORDeltaCompression class
 *
 * DecodeInto XORs delta data onto an existing destination buffer
 * (typically a base frame buffer from WSA animation).
 */
export const XORDeltaCompression = {
  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Decode XOR delta data onto destination buffer.
   *
   * OpenRA 对照: XORDeltaCompression.DecodeInto(byte[], byte[], int)
   *
   * The dest array is modified in-place by XORing delta bytes onto it.
   * The srcOffset specifies where in src the delta stream begins.
   *
   * @param src — compressed XOR delta source data
   * @param dest — destination buffer (modified in place)
   * @param srcOffset — offset into src where delta data begins
   * @returns number of bytes written into dest
   */
  decodeInto(src: Uint8Array, dest: Uint8Array, srcOffset: number = 0): number {
    const ctx = new FastByteReader(src, srcOffset)
    let destIndex = 0

    while (true) {
      const i = ctx.readByte()
      if ((i & 0x80) === 0) {
        // ---- low bit clear: case 5 or 6 ----
        let count = i & 0x7f
        if (count === 0) {
          // case 6: count from next byte, then XOR same value count times
          count = ctx.readByte()
          const value = ctx.readByte()
          for (let end = destIndex + count; destIndex < end; destIndex++) {
            dest[destIndex] ^= value
          }
        } else {
          // case 5: XOR count bytes from stream
          for (let end = destIndex + count; destIndex < end; destIndex++) {
            dest[destIndex] ^= ctx.readByte()
          }
        }
      } else {
        // ---- high bit set: case 1/2/3/4 ----
        let count = i & 0x7f
        if (count === 0) {
          count = ctx.readWord()
          if (count === 0) {
            // terminator
            return destIndex
          }

          if ((count & 0x8000) === 0) {
            // case 2: skip count bytes (advance destIndex)
            destIndex += count & 0x7fff
          } else if ((count & 0x4000) === 0) {
            // case 3: XOR count bytes from stream
            for (let end = destIndex + (count & 0x3fff); destIndex < end; destIndex++) {
              dest[destIndex] ^= ctx.readByte()
            }
          } else {
            // case 4: XOR same value count times
            const value = ctx.readByte()
            for (let end = destIndex + (count & 0x3fff); destIndex < end; destIndex++) {
              dest[destIndex] ^= value
            }
          }
        } else {
          // case 1: skip count bytes
          destIndex += count
        }
      }
    }
  },
}
