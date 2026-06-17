/**
 * LZOCompression.ts — LZO1X decompression (miniLZO subset)
 * OpenRA 对照: OpenRA.Mods.Cnc/FileFormats/LZOCompression.cs
 *
 * 核心范式转换:
 * - C# unsafe byte* pointers → TypeScript DataView + integer indices
 * - C# ref parameters + goto → local mutable variables + labeled loops
 * - C# ushort* casts with 16-bit sub → DataView.getUint16(LE)
 *
 * This is a port of the miniLZO 2.06 decompressor (LZO1X-1 algorithm).
 * The algorithm uses a single monolithic function with internal goto labels.
 * In TypeScript we convert these to structured control flow using state
 * variables and labeled loops (match_done, match_next are the main sub-loops).
 *
 * All memory reads/writes are little-endian.
 *
 * Original miniLZO copyright: Markus Franz Xaver Johannes Oberhumer
 * C# port by Frank Razenberg (OpenRA).
 */

// ---------------------------------------------------------------------------
// LZOCompression
// ---------------------------------------------------------------------------

/** LZO1X-1 decompression.
 *
 * OpenRA 对照: LZOCompression static class
 */
export const LZOCompression = {
  /**
   * Decompress LZO1X-compressed data.
   *
   * OpenRA 对照: LZOCompression.DecodeInto(byte[], uint, uint, byte[], uint, ref uint)
   *
   * Returns the number of bytes decompressed on success.
   * Returns -8 if source appears truncated, -4 if input overrun.
   *
   * @param src — compressed source data
   * @param srcOffset — offset into src where data begins
   * @param srcLength — length of compressed data
   * @param dest — destination buffer (must be pre-allocated large enough)
   * @param destOffset — offset into destination buffer
   * @returns number of decompressed bytes (positive), or negative error code
   */
  decodeInto(
    src: Uint8Array,
    srcOffset: number,
    srcLength: number,
    dest: Uint8Array,
    destOffset: number,
  ): number {
    const sv = new DataView(src.buffer, src.byteOffset, src.byteLength)
    const dv = new DataView(dest.buffer, dest.byteOffset + destOffset, dest.byteLength - destOffset)
    const ipEnd = srcOffset + srcLength

    let ip = srcOffset
    let op = 0 // DataView starts at dest[destOffset], so op=0 writes to dest[destOffset]
    let t = 0 // current tag/count — the key state variable

    // State control
    let gtFirstLiteralRun = false
    let gtMatchDone = false

    // ---- Guard: return 0 for empty input ----
    if (srcLength === 0 || srcOffset >= src.length) {
      return 0
    }

    // ---- Initial byte: fast path for short first runs ----
    if (sv.getUint8(ip) > 17) {
      t = sv.getUint8(ip++) - 17
      if (t < 4) {
        // MatchNext inline: copy t bytes, then read next tag
        do { dv.setUint8(op++, sv.getUint8(ip++)) } while (--t > 0)
        t = sv.getUint8(ip++)
        // Fall through to match processing via gotoMatch start
      } else {
        // Long literal: copy t bytes, set flag
        do { dv.setUint8(op++, sv.getUint8(ip++)) } while (--t > 0)
        gtFirstLiteralRun = true
      }
    }

    // ---- Main loop: alternate between literal runs and match blocks ----
    outer: while (true) {
      // ---- Bounds check: return error code if truncated ----
      if (ip >= ipEnd) {
        // op is 0-based relative to DataView (already offset by destOffset)
        return op > 0 ? -8 : 0
      }

      // ---- Non-first literal run entry ----
      if (!gtFirstLiteralRun) {
        if (ip >= ipEnd) { return op > 0 ? -8 : 0 }
        t = sv.getUint8(ip++)
        if (t >= 16) {
          // goto match — handle below
          gtMatchDone = false
        } else {
          // ---- Copy literal bytes ----
          if (t === 0) {
            while (sv.getUint8(ip) === 0) { t += 255; ip++ }
            t += 15 + sv.getUint8(ip++)
          }
          // Fast copy 4-byte chunks
          dv.setUint32(op, sv.getUint32(ip, true), true); op += 4; ip += 4
          if (--t > 0) {
            if (t >= 4) {
              do {
                dv.setUint32(op, sv.getUint32(ip, true), true); op += 4; ip += 4; t -= 4
              } while (t >= 4)
              if (t > 0) do { dv.setUint8(op++, sv.getUint8(ip++)) } while (--t > 0)
            } else {
              do { dv.setUint8(op++, sv.getUint8(ip++)) } while (--t > 0)
            }
          }
          // goto first_literal_run
          gtFirstLiteralRun = true
          continue outer
        }
      }

      // ---- first_literal_run ----
      if (gtFirstLiteralRun) {
        gtFirstLiteralRun = false
        t = sv.getUint8(ip++)
        if (t >= 16) {
          // goto match
          gtMatchDone = false
        } else {
          // Short match after literal
          let mPos = op - (1 + 0x0800)
          mPos -= t >> 2
          mPos -= sv.getUint8(ip++) << 2
          dv.setUint8(op++, dv.getUint8(mPos++))
          dv.setUint8(op++, dv.getUint8(mPos++))
          dv.setUint8(op++, dv.getUint8(mPos))
          gtMatchDone = true
          t = 0 // dummy — match_done will read ip[-2] for actual t
        }
      }

      // ---- match: the core codec loop ----
      // At this point either:
      //   gtMatchDone is true and we jump to match_done
      //   gtMatchDone is false and we decode t
      matchLoop: do {
        if (gtMatchDone) {
          gtMatchDone = false
          // goto match_done
        } else {
          // Decode match instruction from t
          if (t >= 64) {
            // Large offset, small count
            let mPos = op - 1
            mPos -= (t >> 2) & 7
            mPos -= sv.getUint8(ip++) << 3
            t = (t >> 5) - 1
            dv.setUint8(op++, dv.getUint8(mPos++))
            dv.setUint8(op++, dv.getUint8(mPos++))
            do { dv.setUint8(op++, dv.getUint8(mPos++)) } while (--t > 0)
            // goto match_done (t consumed)
            t = sv.getUint8(ip - 2) & 3
            if (t === 0) break matchLoop
            // match_next
            dv.setUint8(op++, sv.getUint8(ip++))
            if (t > 1) { dv.setUint8(op++, sv.getUint8(ip++)); if (t > 2) dv.setUint8(op++, sv.getUint8(ip++)) }
            t = sv.getUint8(ip++)
            gtMatchDone = false
            continue matchLoop
          } else if (t >= 32) {
            // Medium offset
            t &= 31
            if (t === 0) {
              while (sv.getUint8(ip) === 0) { t += 255; ip++ }
              t += 31 + sv.getUint8(ip++)
            }
            let mPos = op - 1
            mPos -= sv.getUint16(ip, true) >> 2
            ip += 2
            // Copy block
            { const r = _doCopyBlock(dv, op, mPos, t); op = r.op; }
          } else if (t >= 16) {
            // Near offset
            let mPos = op
            mPos -= (t & 8) << 11
            t &= 7
            if (t === 0) {
              while (sv.getUint8(ip) === 0) { t += 255; ip++ }
              t += 7 + sv.getUint8(ip++)
            }
            mPos -= sv.getUint16(ip, true) >> 2
            ip += 2
            if (mPos === op) {
              // eof_found
              // op is 0-based relative to DataView (already offset by destOffset)
              return ip === ipEnd ? op : (ip < ipEnd ? -8 : -4)
            }
            mPos -= 0x4000
            { const r = _doCopyBlock(dv, op, mPos, t); op = r.op; }
          } else {
            // t < 16: very short match, copy 2 bytes then done
            let mPos = op - 1
            mPos -= t >> 2
            mPos -= sv.getUint8(ip++) << 2
            dv.setUint8(op++, dv.getUint8(mPos++))
            dv.setUint8(op++, dv.getUint8(mPos))
            // goto match_done directly
            gtMatchDone = false
            t = sv.getUint8(ip - 2) & 3
            if (t === 0) break matchLoop
            dv.setUint8(op++, sv.getUint8(ip++))
            if (t > 1) { dv.setUint8(op++, sv.getUint8(ip++)); if (t > 2) dv.setUint8(op++, sv.getUint8(ip++)) }
            t = sv.getUint8(ip++)
            continue matchLoop
          }
        }

        // ---- match_done ----
        t = sv.getUint8(ip - 2) & 3
        if (t === 0) break matchLoop

        // ---- match_next: copy 1-3 literal bytes ----
        dv.setUint8(op++, sv.getUint8(ip++))
        if (t > 1) {
          dv.setUint8(op++, sv.getUint8(ip++))
          if (t > 2) {
            dv.setUint8(op++, sv.getUint8(ip++))
          }
        }
        t = sv.getUint8(ip++)
      } while (true)
      // match loop ended — continue outer for next literal block
      gtFirstLiteralRun = false
    }
  },
}

// ---------------------------------------------------------------------------
// Copy helper
// ---------------------------------------------------------------------------

/**
 * Copy t bytes from match position to output.
 *
 * OpenRA 对照: LZO copy_match block
 *
 * Two paths: fast uint32 copy (when safe) or slow byte copy.
 */
function _doCopyBlock(dv: DataView, op: number, mPos: number, t: number): { op: number } {
  let _op = op
  let _mPos = mPos
  let _t = t
  if (_t >= 6 && _op - _mPos >= 4) {
    dv.setUint32(_op, dv.getUint32(_mPos, true), true); _op += 4; _mPos += 4; _t -= 2
    do {
      dv.setUint32(_op, dv.getUint32(_mPos, true), true); _op += 4; _mPos += 4; _t -= 4
    } while (_t >= 4)
    if (_t > 0) {
      do { dv.setUint8(_op++, dv.getUint8(_mPos++)) } while (--_t > 0)
    }
  } else {
    dv.setUint8(_op++, dv.getUint8(_mPos++))
    dv.setUint8(_op++, dv.getUint8(_mPos++))
    do { dv.setUint8(_op++, dv.getUint8(_mPos++)) } while (--_t > 0)
  }
  return { op: _op }
}
