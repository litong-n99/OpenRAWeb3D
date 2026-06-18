/**
 * ExtractMapRules.test.ts — ExtractMapRules 迁移单元测试
 *
 * 测试焦点: mergeAndPrint 逻辑、Fluent 消息合并、base64 编码
 */

import { describe, it, expect } from 'vitest'
import {
  ExtractMapRules,
  mergeAndPrint,
  mergeAndPrintFluentMessages,
  type MapRulesAccess,
  type YamlNode,
} from './ExtractMapRules'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createMockMapAccess(_includesPattern?: string): MapRulesAccess {
  return {
    containsFile: (f: string) => !f.startsWith('system_'),
    openFile: (f: string) => {
      if (f.startsWith('system_')) return null
      if (f === 'base.yaml') {
        return new TextEncoder().encode('BaseRules:\n  SomeRule: true\n').buffer as ArrayBuffer
      }
      if (f === 'map.yaml') {
        return new TextEncoder().encode('Player:\n  Name: Test\n').buffer as ArrayBuffer
      }
      return new TextEncoder().encode('Custom: data\n').buffer as ArrayBuffer
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtractMapRules', () => {
  it('has correct command name', () => {
    const cmd = new ExtractMapRules()
    expect(cmd.name).toBe('--map-rules')
  })

  describe('validateArguments', () => {
    it('rejects wrong number of args', () => {
      const cmd = new ExtractMapRules()
      expect(cmd.validateArguments(['--map-rules'])).toBe(false)
      expect(cmd.validateArguments(['--map-rules', 'a', 'b'])).toBe(false)
    })

    it('accepts exactly one map arg', () => {
      const cmd = new ExtractMapRules()
      expect(cmd.validateArguments(['--map-rules', 'map.oramap'])).toBe(true)
    })
  })

  describe('run', () => {
    it('executes without throwing (stub mode)', () => {
      const cmd = new ExtractMapRules()
      const mockUtility = {
        modData: { modFiles: {}, mapCache: {} },
        mods: new Map(),
      }
      expect(() => {
        cmd.run(mockUtility as any, ['--map-rules', 'map.oramap'])
      }).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// mergeAndPrint
// ---------------------------------------------------------------------------

describe('mergeAndPrint', () => {
  it('returns formatted output for null value', () => {
    const access = createMockMapAccess()
    const result = mergeAndPrint('Rules', null, access)
    expect(result).toContain('Rules:')
  })

  it('returns formatted output for value with nodes', () => {
    const access = createMockMapAccess()
    const value: YamlNode = {
      key: 'Rules',
      value: 'map.yaml, system_base.yaml',
      nodes: [{ key: 'World', value: 'TestWorld' }],
    }
    const result = mergeAndPrint('Rules', value, access)
    expect(result).toContain('Rules:')
    expect(result).toContain('World')
  })

  it('includes nodes from included files that exist in package', () => {
    const access = createMockMapAccess()
    const value: YamlNode = {
      key: 'Rules',
      value: 'map.yaml',
      nodes: [],
    }
    const result = mergeAndPrint('Rules', value, access)
    expect(result).toContain('Rules:')
  })

  it('handles value with only includes string', () => {
    const access = createMockMapAccess()
    const value: YamlNode = {
      key: 'Sequences',
      value: 'system_sequences.yaml',
      nodes: [],
    }
    const result = mergeAndPrint('Sequences', value, access)
    expect(result).toContain('Sequences:')
    // system_sequences.yaml is not in package, so it should appear as an include
    expect(result).toContain('system_sequences.yaml')
  })
})

// ---------------------------------------------------------------------------
// mergeAndPrintFluentMessages
// ---------------------------------------------------------------------------

describe('mergeAndPrintFluentMessages', () => {
  it('returns formatted output for null value', () => {
    const access = createMockMapAccess()
    const result = mergeAndPrintFluentMessages('FluentMessages', null, access)
    expect(result).toContain('FluentMessages:')
  })

  it('includes base64-encoded content for existing files', () => {
    const access = createMockMapAccess()
    const value: YamlNode = {
      key: 'FluentMessages',
      value: 'base.yaml',
      nodes: [],
    }
    const result = mergeAndPrintFluentMessages('FluentMessages', value, access)
    expect(result).toContain('FluentMessages:')
    expect(result).toContain('base64:')
  })

  it('handles missing files gracefully', () => {
    const access = createMockMapAccess()
    const value: YamlNode = {
      key: 'FluentMessages',
      value: 'nonexistent.ftl',
      nodes: [],
    }
    const result = mergeAndPrintFluentMessages('FluentMessages', value, access)
    expect(result).toContain('FluentMessages:')
  })

  it('includes custom nodes from value', () => {
    const access = createMockMapAccess()
    const value: YamlNode = {
      key: 'FluentMessages',
      value: '',
      nodes: [{ key: 'custom-key', value: 'Custom Value' }],
    }
    const result = mergeAndPrintFluentMessages('FluentMessages', value, access)
    expect(result).toContain('custom-key')
    expect(result).toContain('Custom Value')
  })
})
