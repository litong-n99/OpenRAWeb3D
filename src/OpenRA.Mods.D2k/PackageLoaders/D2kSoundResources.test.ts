/**
 * D2kSoundResources.test.ts — D2K sound resource package loader unit tests
 *
 * Tests focus on: .rs extension detection, ASCIIZ name parsing,
 * entry index construction, file opening/disposal.
 */

import { describe, it, expect } from 'vitest'
import { d2kSoundResourcesLoader } from './D2kSoundResources.js'

// ---------------------------------------------------------------------------
// Helper: build a minimal .rs file buffer
// ---------------------------------------------------------------------------

/**
 * Build a minimal D2K .rs sound resource file buffer.
 *
 * Format:
 *   offset 0: headerLength (uint32 LE)
 *   [name(ASCIIZ), offset(4), length(4)] repeated...
 *   [data region at specified offsets]
 */
function buildRsBuffer(
  entries: { name: string; data: Uint8Array }[],
): ArrayBuffer {
  // Calculate header size
  let headerSize = 4 // headerLength field
  for (const entry of entries) {
    headerSize += entry.name.length + 1 // ASCIIZ name
    headerSize += 4 + 4 // offset + length
  }

  // Calculate data offsets
  const offsets: number[] = []
  let dataOffset = headerSize
  for (const entry of entries) {
    offsets.push(dataOffset)
    dataOffset += entry.data.length
  }

  const totalSize = dataOffset
  const buffer = new ArrayBuffer(totalSize)
  const u8 = new Uint8Array(buffer)
  const dv = new DataView(buffer)

  dv.setUint32(0, headerSize - 4, true) // headerLength (body only, not including itself)

  let pos = 4
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!

    // Write ASCIIZ name
    const nameBytes = new TextEncoder().encode(entry.name)
    u8.set(nameBytes, pos)
    pos += nameBytes.length
    u8[pos++] = 0 // null terminator

    // Write offset and length
    dv.setUint32(pos, offsets[i]!, true)
    pos += 4
    dv.setUint32(pos, entry.data.length, true)
    pos += 4
  }

  // Write data
  for (let i = 0; i < entries.length; i++) {
    u8.set(entries[i]!.data, offsets[i]!)
  }

  return buffer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D2kSoundResourcesLoader', () => {
  it('rejects non-.rs extension', () => {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, 0, true)
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'test.wav',
      buffer,
    )
    expect(result).toBeNull()
  })

  it('accepts .RS in upper case (case-insensitive match)', () => {
    const buffer = buildRsBuffer([])
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'test.RS',
      buffer,
    )
    expect(result).not.toBeNull()
  })

  it('accepts .rs extension', () => {
    const buffer = buildRsBuffer([])
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'sounds.rs',
      buffer,
    )
    expect(result).not.toBeNull()
  })

  it('parses package with entries', () => {
    const buffer = buildRsBuffer([
      { name: 'SOUND1.WAV', data: new Uint8Array([0x01, 0x02, 0x03]) },
      { name: 'SOUND2.WAV', data: new Uint8Array([0x04, 0x05]) },
    ])

    const result = d2kSoundResourcesLoader.tryParsePackage(
      'sounds.rs',
      buffer,
    )
    expect(result).not.toBeNull()
    expect(result!.contents).toContain('SOUND1.WAV')
    expect(result!.contents).toContain('SOUND2.WAV')
    expect(result!.contains('SOUND1.WAV')).toBe(true)
    expect(result!.contains('NONEXIST.WAV')).toBe(false)
  })

  it('sets package name correctly', () => {
    const buffer = buildRsBuffer([])
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'D2kSounds.rs',
      buffer,
    )
    expect(result!.name).toBe('D2kSounds.rs')
  })

  it('returns null for non-existent file open', async () => {
    const buffer = buildRsBuffer([])
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'test.rs',
      buffer,
    )
    const data = await result!.open('missing.wav')
    expect(data).toBeNull()
  })

  it('returns file data for existing entry', async () => {
    const fileData = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
    const buffer = buildRsBuffer([
      { name: 'MUSIC.AUD', data: fileData },
    ])

    const result = d2kSoundResourcesLoader.tryParsePackage(
      'music.rs',
      buffer,
    )
    const data = await result!.open('MUSIC.AUD')
    expect(data).not.toBeNull()
    expect(data!.byteLength).toBe(4)
    const u8 = new Uint8Array(data!)
    expect(u8[0]).toBe(0xaa)
    expect(u8[1]).toBe(0xbb)
    expect(u8[2]).toBe(0xcc)
    expect(u8[3]).toBe(0xdd)
  })

  it('returns independent copies on each open call', async () => {
    const fileData = new Uint8Array([0x11, 0x22])
    const buffer = buildRsBuffer([
      { name: 'DATA.BIN', data: fileData },
    ])

    const result = d2kSoundResourcesLoader.tryParsePackage(
      'test.rs',
      buffer,
    )
    const data1 = await result!.open('DATA.BIN')
    const data2 = await result!.open('DATA.BIN')
    // They should be independent ArrayBuffers
    expect(data1).not.toBeNull()
    expect(data2).not.toBeNull()
    // Modify one, verify the other is unchanged
    new Uint8Array(data1!)[0] = 0xff
    expect(new Uint8Array(data2!)[0]).toBe(0x11)
  })

  it('returns null from openPackage (not implemented)', () => {
    const buffer = buildRsBuffer([])
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'test.rs',
      buffer,
    )
    const subPkg = result!.openPackage('anything')
    expect(subPkg).toBeNull()
  })

  it('disposes without error', () => {
    const buffer = buildRsBuffer([{ name: 'A.WAV', data: new Uint8Array(5) }])
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'test.rs',
      buffer,
    )
    expect(() => result!.dispose()).not.toThrow()
  })

  it('sorts contents alphabetically', () => {
    const buffer = buildRsBuffer([
      { name: 'C.WAV', data: new Uint8Array(1) },
      { name: 'A.WAV', data: new Uint8Array(1) },
      { name: 'B.WAV', data: new Uint8Array(1) },
    ])
    const result = d2kSoundResourcesLoader.tryParsePackage(
      'test.rs',
      buffer,
    )
    expect(result!.contents).toEqual(['A.WAV', 'B.WAV', 'C.WAV'])
  })
})
