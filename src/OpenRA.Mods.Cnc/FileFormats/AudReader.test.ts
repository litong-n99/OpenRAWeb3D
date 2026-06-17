/**
 * AudReader.test.ts — Westwood AUD audio container parser unit tests
 */

import { describe, it, expect } from 'vitest'
import { AudReader } from './AudReader.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal AUD header
// ---------------------------------------------------------------------------

function buildAudHeader(params: {
  sampleRate?: number
  dataSize?: number
  outputSize?: number
  stereo?: boolean
  bits16?: boolean
  format?: number
}): Uint8Array {
  const sampleRate = params.sampleRate ?? 22050
  const dataSize = params.dataSize ?? 0
  const outputSize = params.outputSize ?? 0
  const stereo = params.stereo ?? false
  const bits16 = params.bits16 ?? false
  const format = params.format ?? 99 // ImaAdpcm

  let flags = 0
  if (stereo) flags |= 1
  if (bits16) flags |= 2

  const buf = new Uint8Array(12)
  const dv = new DataView(buf.buffer)

  dv.setUint16(0, sampleRate, true) // LE
  dv.setInt32(2, dataSize, true)
  dv.setInt32(6, outputSize, true)
  dv.setUint8(10, flags)
  dv.setUint8(11, format)

  return buf
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AudReader', () => {
  describe('loadSoundInfo', () => {
    it('parses a valid ImaAdpcm AUD header', () => {
      const header = buildAudHeader({
        sampleRate: 22050,
        dataSize: 1000,
        outputSize: 4000,
        stereo: false,
        bits16: false,
        format: 99,
      })

      const info = AudReader.loadSoundInfo(header)
      expect(info).not.toBeNull()
      expect(info!.sampleRate).toBe(22050)
      expect(info!.sampleBits).toBe(8)
      expect(info!.channels).toBe(1)
      expect(info!.format).toBe('ImaAdpcm')
      expect(info!.dataSize).toBe(1000)
      expect(info!.outputSize).toBe(4000)
    })

    it('parses WestwoodCompressed format', () => {
      const header = buildAudHeader({
        sampleRate: 11025,
        dataSize: 500,
        outputSize: 2000,
        format: 1, // WestwoodCompressed
      })

      const info = AudReader.loadSoundInfo(header)
      expect(info).not.toBeNull()
      expect(info!.format).toBe('WestwoodCompressed')
    })

    it('detects stereo flag', () => {
      const header = buildAudHeader({ stereo: true })
      const info = AudReader.loadSoundInfo(header)
      expect(info).not.toBeNull()
      expect(info!.channels).toBe(2)
    })

    it('detects 16-bit flag', () => {
      const header = buildAudHeader({ bits16: true })
      const info = AudReader.loadSoundInfo(header)
      expect(info).not.toBeNull()
      expect(info!.sampleBits).toBe(16)
    })

    it('returns null for unknown format', () => {
      const header = buildAudHeader({ format: 42 })
      const info = AudReader.loadSoundInfo(header)
      expect(info).toBeNull()
    })

    it('returns null for too-short data', () => {
      const data = new Uint8Array(5)
      const info = AudReader.loadSoundInfo(data)
      expect(info).toBeNull()
    })

    it('calculates correct duration', () => {
      // 22050 Hz, 8-bit, mono, 44100 output bytes
      // duration = (44100 * 8) / (1 * 8 * 22050) = 352800 / 176400 = 2.0 seconds
      const header = buildAudHeader({
        sampleRate: 22050,
        outputSize: 44100,
        stereo: false,
        bits16: false,
      })
      const info = AudReader.loadSoundInfo(header)!
      expect(info.lengthInSeconds).toBeCloseTo(2.0, 5)
    })

    it('calculates stereo 16-bit duration correctly', () => {
      // 44100 Hz, 16-bit, stereo, 176400 output bytes
      // duration = (176400 * 8) / (2 * 16 * 44100) = 1411200 / 1411200 = 1.0 second
      const header = buildAudHeader({
        sampleRate: 44100,
        outputSize: 176400,
        stereo: true,
        bits16: true,
      })
      const info = AudReader.loadSoundInfo(header)!
      expect(info.lengthInSeconds).toBeCloseTo(1.0, 5)
    })
  })

  describe('decodeImaAdpcmSample', () => {
    it('decodes a standard IMA ADPCM byte', () => {
      const state = { index: 0, current: 0 }
      const result = AudReader.decodeImaAdpcmSample(0x77, state)
      expect(result).toHaveLength(2)
      // Both samples should be 16-bit signed values
      expect(Math.abs(result[0])).toBeLessThanOrEqual(32767)
      expect(Math.abs(result[1])).toBeLessThanOrEqual(32767)
    })

    it('advances state index', () => {
      const state = { index: 0, current: 0 }
      AudReader.decodeImaAdpcmSample(0x00, state)
      // The sample nibble 0 adjusts index by -1, clamped to 0
      // Nibble 0 also adjusts index by -1, clamped to 0
      expect(state.index).toBeGreaterThanOrEqual(0)
      expect(state.index).toBeLessThanOrEqual(88)
    })

    it('produces identical output for identical input/state', () => {
      const s1 = { index: 10, current: 100 }
      const s2 = { index: 10, current: 100 }

      const r1 = AudReader.decodeImaAdpcmSample(0x35, s1)
      const r2 = AudReader.decodeImaAdpcmSample(0x35, s2)

      expect(r1).toEqual(r2)
      expect(s1.index).toBe(s2.index)
      expect(s1.current).toBe(s2.current)
    })

    it('clamps index to [0, 88]', () => {
      const state = { index: 0, current: 0 }
      // Decode many samples with nibble 0 (which adjusts index down)
      for (let i = 0; i < 100; i++) {
        AudReader.decodeImaAdpcmSample(0x00, state)
        expect(state.index).toBeGreaterThanOrEqual(0)
        expect(state.index).toBeLessThanOrEqual(88)
      }
    })

    it('clamps current to [-32768, 32767]', () => {
      const state = { index: 88, current: 32700 }
      // Decode a large positive step that would overflow
      // Use nibble 7 (largest step going up)
      for (let i = 0; i < 5; i++) {
        AudReader.decodeImaAdpcmSample(0x77, state)
        expect(state.current).toBeGreaterThanOrEqual(-32768)
        expect(state.current).toBeLessThanOrEqual(32767)
      }
    })
  })

  describe('decodeWestwoodCompressed', () => {
    it('passes through uncompressed data (same lengths)', () => {
      const input = new Uint8Array([10, 20, 30, 40])
      const output = new Uint8Array(4)
      const result = AudReader.decodeWestwoodCompressed(input, output, 4)
      expect(result).toBe(4)
      expect(output[0]).toBe(10)
      expect(output[1]).toBe(20)
      expect(output[2]).toBe(30)
      expect(output[3]).toBe(40)
    })

    it('decodes compressed data', () => {
      // Compressed data smaller than output size triggers decompression
      const compressed = new Uint8Array(4) // smaller than output
      const output = new Uint8Array(16)
      const result = AudReader.decodeWestwoodCompressed(compressed, output, 16)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(16)
    })

    it('handles empty input', () => {
      const input = new Uint8Array(0)
      const output = new Uint8Array(0)
      const result = AudReader.decodeWestwoodCompressed(input, output, 0)
      expect(result).toBe(0)
    })

    it('does not crash on invalid compressed data', () => {
      const input = new Uint8Array([0xff, 0xff, 0xff, 0xff])
      const output = new Uint8Array(100).fill(0xcd)
      expect(() => {
        AudReader.decodeWestwoodCompressed(input, output, 100)
      }).not.toThrow()
    })

    // Regression: BLOCKER — sign-extension was 6-bit, must be 5-bit
    it('case 2 sign-extension: count=32 produces delta=0 (not -32)', () => {
      // 0xA0 = case 2 (bits 7-6 = 10), count=32, sign-extension branch (bit 5 set)
      const input = new Uint8Array([0xA0])
      const output = new Uint8Array(4)
      const result = AudReader.decodeWestwoodCompressed(input, output, 4)
      // sample starts at 0x80, delta=0 -> unchanged
      expect(result).toBe(1)
      expect(output[0]).toBe(0x80)
    })

    it('case 2 sign-extension: count=40 produces delta=8 (not -24)', () => {
      // 0xA8 = case 2, count=40, sign-extension branch
      const input = new Uint8Array([0xA8])
      const output = new Uint8Array(4)
      const result = AudReader.decodeWestwoodCompressed(input, output, 4)
      // sample starts at 0x80, delta=8 -> 0x88
      expect(result).toBe(1)
      expect(output[0]).toBe(0x88)
    })

    it('case 2 sign-extension: count=47 produces delta=15 (not -17)', () => {
      // 0xAF = case 2, count=47, sign-extension branch
      const input = new Uint8Array([0xAF])
      const output = new Uint8Array(4)
      const result = AudReader.decodeWestwoodCompressed(input, output, 4)
      // sample starts at 0x80, delta=15 -> 0x8F
      expect(result).toBe(1)
      expect(output[0]).toBe(0x8f)
    })

    it('case 2 sign-extension: count=48 produces delta=-16', () => {
      // 0xB0 = case 2, count=48, sign-extension branch
      const input = new Uint8Array([0xB0])
      const output = new Uint8Array(4)
      const result = AudReader.decodeWestwoodCompressed(input, output, 4)
      // sample starts at 0x80, delta=-16 -> 0x70
      expect(result).toBe(1)
      expect(output[0]).toBe(0x70)
    })

    it('case 2 sign-extension: count=63 produces delta=-1', () => {
      // 0xBF = case 2, count=63, sign-extension branch
      const input = new Uint8Array([0xBF])
      const output = new Uint8Array(4)
      const result = AudReader.decodeWestwoodCompressed(input, output, 4)
      // sample starts at 0x80, delta=-1 -> 0x7F
      expect(result).toBe(1)
      expect(output[0]).toBe(0x7f)
    })
  })

  describe('audioDataOffset', () => {
    it('is 12 (header size)', () => {
      expect(AudReader.audioDataOffset).toBe(12)
    })
  })
})
