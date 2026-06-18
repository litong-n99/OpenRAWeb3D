/**
 * GetMapHashCommand.test.ts — GetMapHashCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、computeMapUIDSync 逻辑、哈希一致性
 */

import { describe, it, expect } from 'vitest'
import {
  GetMapHashCommand,
  computeMapUIDSync,
} from './GetMapHashCommand'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GetMapHashCommand', () => {
  // -----------------------------------------------------------------------
  // IUtilityCommand contract
  // -----------------------------------------------------------------------

  it('has correct command name', () => {
    const cmd = new GetMapHashCommand()
    expect(cmd.name).toBe('--map-hash')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects no args', () => {
      const cmd = new GetMapHashCommand()
      expect(cmd.validateArguments(['--map-hash'])).toBe(false)
    })

    it('accepts single map path arg', () => {
      const cmd = new GetMapHashCommand()
      expect(cmd.validateArguments(['--map-hash', 'map.oramap'])).toBe(true)
    })

    it('accepts multiple args (extra args ignored for validation)', () => {
      const cmd = new GetMapHashCommand()
      expect(cmd.validateArguments(['--map-hash', 'map.oramap', 'extra'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run (stub)
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = new GetMapHashCommand()
      const mockUtility = {
        modData: { modFiles: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--map-hash', 'map.oramap'])
      }).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// computeMapUIDSync
// ---------------------------------------------------------------------------

describe('computeMapUIDSync', () => {
  it('returns a hash string for non-empty files', () => {
    const filenames = ['map.yaml', 'map.bin']
    const files = new Map<string, Uint8Array>()
    files.set('map.yaml', new TextEncoder().encode('MapFormat: 12\n'))
    files.set('map.bin', new Uint8Array([0x00, 0x01, 0x02, 0x03]))

    const readFileSync = (name: string): Uint8Array | null => files.get(name) ?? null

    const hash = computeMapUIDSync(filenames, readFileSync)
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('handles empty file list', () => {
    const readFileSync = (_name: string): Uint8Array | null => null
    const hash = computeMapUIDSync([], readFileSync)
    expect(hash).toBeTruthy()
    expect(typeof hash).toBe('string')
  })

  it('produces consistent output for same input', () => {
    const filenames = ['a.txt', 'b.txt']
    const files = new Map<string, Uint8Array>()
    files.set('a.txt', new TextEncoder().encode('hello'))
    files.set('b.txt', new TextEncoder().encode('world'))
    const readFileSync = (name: string): Uint8Array | null => files.get(name) ?? null

    const hash1 = computeMapUIDSync(filenames, readFileSync)
    const hash2 = computeMapUIDSync(filenames, readFileSync)
    expect(hash1).toBe(hash2)
  })

  it('sorts filenames consistently', () => {
    const files = new Map<string, Uint8Array>()
    files.set('b.txt', new TextEncoder().encode('b'))
    files.set('a.txt', new TextEncoder().encode('a'))
    const readFileSync = (name: string): Uint8Array | null => files.get(name) ?? null

    // Same files, different order — should produce same hash
    const hash1 = computeMapUIDSync(['a.txt', 'b.txt'], readFileSync)
    const hash2 = computeMapUIDSync(['b.txt', 'a.txt'], readFileSync)
    expect(hash1).toBe(hash2)
  })

  it('skips files that return null', () => {
    const files = new Map<string, Uint8Array>()
    files.set('a.txt', new TextEncoder().encode('a'))
    const readFileSync = (name: string): Uint8Array | null => files.get(name) ?? null

    const hash1 = computeMapUIDSync(['a.txt'], readFileSync)
    const hash2 = computeMapUIDSync(['a.txt', 'missing.txt'], readFileSync)
    // Should produce same result (missing file skipped)
    expect(hash1).toBe(hash2)
  })
})
