/**
 * AudReader.ts — Westwood AUD audio container parser
 * OpenRA 对照: OpenRA.Mods.Cnc/FileFormats/AudReader.cs
 *
 * 核心范式转换:
 * - C# Stream + BinaryReader → TypeScript DataView on Uint8Array
 * - C# ImaAdpcmReader/WestwoodCompressedReader → inline IMA ADPCM decoder + WS decoder
 * - C# Queue<byte> output stream → Uint8Array accumulation
 * - C# SegmentStream + ReadOnlyAdapterStream → direct array offset tracking
 *
 * ADR-19.4 Impact:
 * - Used at build time for AUD→WAV conversion.
 * - Runtime TypeScript provides header parsing and raw data extraction.
 * - Audio decoding can be delegated to Web Audio API at runtime for PCM playback.
 *
 * AUD binary format:
 *   - 2 bytes: sampleRate (uint16 LE)
 *   - 4 bytes: dataSize (int32 LE)
 *   - 4 bytes: outputSize (int32 LE)
 *   - 1 byte: flags (bit 0 = stereo, bit 1 = 16-bit)
 *   - 1 byte: format (1=WestwoodCompressed, 99=ImaAdpcm)
 *   - Variable: chunked audio data (each chunk: 2B compSize, 2B outSize, 4B magic 0xDEAF)
 */

// ---------------------------------------------------------------------------
// AudReader result type
// ---------------------------------------------------------------------------

/** Parsed AUD file metadata.
 *
 * OpenRA 对照: AudReader.LoadSound output parameters
 */
export interface AudInfo {
  /** Sample rate in Hz (e.g. 22050) */
  sampleRate: number
  /** Bits per sample (8 or 16) */
  sampleBits: number
  /** Number of audio channels (1 = mono, 2 = stereo) */
  channels: number
  /** Duration in seconds */
  lengthInSeconds: number
  /** Audio format: 'WestwoodCompressed' | 'ImaAdpcm' */
  format: string
  /** Total output size in bytes */
  outputSize: number
  /** Total compressed data size in bytes */
  dataSize: number
}

// ---------------------------------------------------------------------------
// SoundFlags constants (对应 OpenRA SoundFlags enum)
// ---------------------------------------------------------------------------

const SoundFlags = {
  Stereo: 0x1,
  _16Bit: 0x2,
} as const

// ---------------------------------------------------------------------------
// AudReader
// ---------------------------------------------------------------------------

/** Westwood AUD audio container parser.
 *
 * OpenRA 对照: AudReader static class
 *
 * Parses the AUD header to extract metadata and provides
 * decompression of the chunked audio data.
 */
export const AudReader = {
  // -----------------------------------------------------------------------
  // Public API — Header Parsing
  // -----------------------------------------------------------------------

  /**
   * Parse an AUD file header and return audio metadata.
   *
   * OpenRA 对照: AudReader.LoadSound(Stream, out Func<Stream>, out int, out int, out int, out float)
   *
   * Returns null if the format is not recognized.
   *
   * @param data — raw AUD file bytes
   * @returns AudInfo on success, null on unknown format
   */
  loadSoundInfo(data: Uint8Array): AudInfo | null {
    if (data.length < 12) return null

    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 0

    const sampleRate = dv.getUint16(offset, true); offset += 2
    const dataSize = dv.getInt32(offset, true); offset += 4
    const outputSize = dv.getInt32(offset, true); offset += 4
    const flags = dv.getUint8(offset); offset += 1
    const sampleBits = (flags & SoundFlags._16Bit) === 0 ? 8 : 16
    const channels = (flags & SoundFlags.Stereo) === 0 ? 1 : 2
    const lengthInSeconds = (outputSize * 8) / (channels * sampleBits * sampleRate)

    const format = dv.getUint8(offset); offset += 1
    let formatName: string
    if (format === 1) {
      formatName = 'WestwoodCompressed'
    } else if (format === 99) {
      formatName = 'ImaAdpcm'
    } else {
      return null
    }

    return {
      sampleRate,
      sampleBits,
      channels,
      lengthInSeconds,
      format: formatName,
      outputSize,
      dataSize,
    }
  },

  // -----------------------------------------------------------------------
  // Public API — Raw audio data extraction
  // -----------------------------------------------------------------------

  /**
   * Extract the raw chunk data offset from an AUD buffer (skipping the header).
   *
   * After the 12-byte header, the remaining data is chunked audio.
   * Returns the byte offset where audio chunks begin.
   */
  audioDataOffset: 12,

  // -----------------------------------------------------------------------
  // Decompression — IMA ADPCM
  // -----------------------------------------------------------------------

  /**
   * Decode a single IMA ADPCM encoded byte into a 16-bit PCM sample.
   *
   * OpenRA 对照: ImaAdpcmReader.DecodeImaAdpcmSample(byte, ref int, ref int)
   *
   * Each input byte contains two 4-bit IMA ADPCM nibbles (low nibble first).
   * The step index table and algorithms follow the standard IMA ADPCM spec
   * as used in Westwood games.
   *
   * @param b — encoded byte (contains 2 nibbles)
   * @param state — mutable state { index, current } for the decoder
   * @returns array of two 16-bit PCM samples [lowNibble, highNibble]
   */
  decodeImaAdpcmSample(
    b: number,
    state: { index: number; current: number },
  ): [number, number] {
    const lo = _decodeImaAdpcmNibble(b & 0x0f, state)
    const hi = _decodeImaAdpcmNibble((b >> 4) & 0x0f, state)
    return [lo, hi]
  },

  // -----------------------------------------------------------------------
  // Decompression — Westwood Compressed
  // -----------------------------------------------------------------------

  /**
   * Decode Westwood-compressed audio samples.
   *
   * OpenRA 对照: WestwoodCompressedReader.DecodeWestwoodCompressedSample(Span<byte>, Span<byte>)
   *
   * If input and output lengths are equal, data is uncompressed (pass-through).
   *
   * @param input — compressed audio data
   * @param output — output buffer (must be pre-sized)
   * @param outputSize — expected output byte count
   * @returns number of output bytes written, or -1 on error
   */
  decodeWestwoodCompressed(
    input: Uint8Array,
    output: Uint8Array,
    outputSize: number,
  ): number {
    return _decodeWestwood(input, output, outputSize)
  },
}

// ===========================================================================
// Internal IMA ADPCM
// ===========================================================================

const IMA_INDEX_ADJUST = [-1, -1, -1, -1, 2, 4, 6, 8]
const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16,
  17, 19, 21, 23, 25, 28, 31, 34, 37,
  41, 45, 50, 55, 60, 66, 73, 80, 88,
  97, 107, 118, 130, 143, 157, 173, 190, 209,
  230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166,
  1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749,
  3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289,
  16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]

function _decodeImaAdpcmNibble(b: number, state: { index: number; current: number }): number {
  const sb = (b & 8) !== 0
  const nibble = b & 7

  let delta = Math.floor(IMA_STEP_TABLE[state.index] * nibble / 4 + IMA_STEP_TABLE[state.index] / 8)
  if (sb) delta = -delta

  state.current += delta
  if (state.current > 32767) state.current = 32767
  if (state.current < -32768) state.current = -32768

  state.index += IMA_INDEX_ADJUST[nibble]
  if (state.index < 0) state.index = 0
  if (state.index > 88) state.index = 88

  return state.current
}

// ===========================================================================
// Internal Westwood Compressed Decoder
// ===========================================================================

const AUD_WS_STEP_TABLE2 = [-2, -1, 0, 1]
const AUD_WS_STEP_TABLE4 = [-9, -8, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 8]

function _clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function _decodeWestwood(input: Uint8Array, output: Uint8Array, outputSize: number): number {
  if (input.length === outputSize) {
    // Uncompressed — direct copy
    output.set(input.subarray(0, outputSize))
    return outputSize
  }

  let sample = 0x80
  let r = 0
  let w = 0
  const inputLen = input.length

  while (r < inputLen && w < outputSize) {
    const cmd = input[r++]
    let count = cmd & 0x3f
    const cmdType = cmd >> 6

    switch (cmdType) {
      case 0:
        for (count++; count > 0 && w < outputSize; count--) {
          const code = input[r++]
          sample = _clamp(sample + AUD_WS_STEP_TABLE2[(code >> 0) & 0x03], 0, 255)
          output[w++] = sample
          sample = _clamp(sample + AUD_WS_STEP_TABLE2[(code >> 2) & 0x03], 0, 255)
          output[w++] = sample
          sample = _clamp(sample + AUD_WS_STEP_TABLE2[(code >> 4) & 0x03], 0, 255)
          output[w++] = sample
          sample = _clamp(sample + AUD_WS_STEP_TABLE2[(code >> 6) & 0x03], 0, 255)
          output[w++] = sample
        }
        break

      case 1:
        for (count++; count > 0 && w < outputSize; count--) {
          const code = input[r++]
          sample = _clamp(sample + AUD_WS_STEP_TABLE4[(code >> 0) & 0x0f], 0, 255)
          output[w++] = sample
          sample = _clamp(sample + AUD_WS_STEP_TABLE4[(code >> 4) & 0x0f], 0, 255)
          output[w++] = sample
        }
        break

      case 2:
        if ((count & 0x20) !== 0) {
          // Sign-extend 5-bit value (bit 4 is sign) to 32-bit.
          // C#: (sbyte)((sbyte)count << 3) >> 3
          //   count is in [0,63]. (sbyte)count is [-128,127].
          //   For count [32,47]: (sbyte)(count<<3) wraps to [0,120], >>3 -> [0,15]
          //   For count [48,63]: (sbyte)(count<<3) wraps to [-128,-8], >>3 -> [-16,-1]
          // TS equivalent: mask to 5 bits, sign-extend from bit 4
          const signedVal = ((count & 0x1f) << 27) >> 27
          sample = _clamp(sample + signedVal, 0, 255)
          output[w++] = sample
        } else {
          for (count++; count > 0 && w < outputSize; count--) {
            output[w++] = input[r++]
          }
          sample = input[r - 1]
        }
        break

      default:
        // case 3: repeat last sample
        for (count++; count > 0 && w < outputSize; count--) {
          output[w++] = sample
        }
        break
    }
  }

  return w
}
