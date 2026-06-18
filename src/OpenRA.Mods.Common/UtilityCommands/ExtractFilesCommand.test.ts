/**
 * ExtractFilesCommand.test.ts — ExtractFilesCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、extractFiles/extractFilesSync 逻辑、错误处理
 */

import { describe, it, expect } from 'vitest'
import {
  ExtractFilesCommand,
  extractFilesSync,
} from './ExtractFilesCommand'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtractFilesCommand', () => {
  it('has correct command name', () => {
    const cmd = new ExtractFilesCommand()
    expect(cmd.name).toBe('--extract')
  })

  describe('validateArguments', () => {
    it('rejects no args', () => {
      const cmd = new ExtractFilesCommand()
      expect(cmd.validateArguments(['--extract'])).toBe(false)
    })

    it('accepts at least one filename', () => {
      const cmd = new ExtractFilesCommand()
      expect(cmd.validateArguments(['--extract', 'file1.mix'])).toBe(true)
    })

    it('accepts multiple filenames', () => {
      const cmd = new ExtractFilesCommand()
      expect(cmd.validateArguments(['--extract', 'a.mix', 'b.mix', 'c.mix'])).toBe(true)
    })
  })

  describe('run', () => {
    it('executes without throwing when file exists', () => {
      const cmd = new ExtractFilesCommand()
      const mockUtility = {
        modData: {
          defaultFileSystem: {
            exists: (_name: string) => true,
          },
          modFiles: {},
        },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--extract', 'somefile.mix'])
      }).not.toThrow()
    })

    it('throws for non-existent file', () => {
      const cmd = new ExtractFilesCommand()
      const mockUtility = {
        modData: {
          defaultFileSystem: {
            exists: (_name: string) => false,
          },
          modFiles: {},
        },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--extract', 'nonexistent'])
      }).toThrow('File not found')
    })
  })
})

// ---------------------------------------------------------------------------
// extractFilesSync
// ---------------------------------------------------------------------------

describe('extractFilesSync', () => {
  it('extracts all files successfully', () => {
    const files = new Map<string, Uint8Array>()
    files.set('a.txt', new TextEncoder().encode('content a'))
    files.set('b.txt', new TextEncoder().encode('content b'))

    const readFileSync = (name: string): Uint8Array | null => files.get(name) ?? null
    const written = new Map<string, Uint8Array>()
    const writeFileSync = (name: string, data: Uint8Array) => {
      written.set(name, data)
    }

    const results = extractFilesSync(['a.txt', 'b.txt'], readFileSync, writeFileSync)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.success)).toBe(true)
    expect(written.has('a.txt')).toBe(true)
    expect(written.has('b.txt')).toBe(true)
  })

  it('reports error for missing files', () => {
    const readFileSync = (_name: string): Uint8Array | null => null
    const writeFileSync = (_name: string, _data: Uint8Array) => {}

    expect(() => {
      extractFilesSync(['missing.txt'], readFileSync, writeFileSync)
    }).toThrow('File not found: missing.txt')
  })

  it('stops on first error (throw semantics)', () => {
    const files = new Map<string, Uint8Array>()
    files.set('good.txt', new TextEncoder().encode('ok'))
    const readFileSync = (name: string): Uint8Array | null => files.get(name) ?? null
    const writeFileSync = (_name: string, _data: Uint8Array) => {}

    // First file ('bad.txt') is missing, so execution stops with an error
    expect(() => {
      extractFilesSync(['bad.txt', 'good.txt'], readFileSync, writeFileSync)
    }).toThrow('File not found: bad.txt')
  })

  it('writes correct file content', () => {
    const files = new Map<string, Uint8Array>()
    files.set('data.bin', new Uint8Array([0x00, 0x01, 0x02, 0xff]))
    const readFileSync = (name: string): Uint8Array | null => files.get(name) ?? null
    const written = new Map<string, Uint8Array>()
    const writeFileSync = (name: string, data: Uint8Array) => {
      written.set(name, data)
    }

    extractFilesSync(['data.bin'], readFileSync, writeFileSync)
    const writtenData = written.get('data.bin')
    expect(writtenData).toBeDefined()
    expect(writtenData!.length).toBe(4)
    expect(writtenData![0]).toBe(0x00)
    expect(writtenData![3]).toBe(0xff)
  })

  it('handles empty file list', () => {
    const readFileSync = (_name: string): Uint8Array | null => null
    const writeFileSync = (_name: string, _data: Uint8Array) => {}
    const results = extractFilesSync([], readFileSync, writeFileSync)
    expect(results).toHaveLength(0)
  })
})
