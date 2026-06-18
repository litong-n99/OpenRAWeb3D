/**
 * UtilityHelpers.test.ts — UtilityHelpers 辅助函数单元测试
 *
 * 测试焦点:
 * - parseModRegistrationArg 参数解析
 * - getTopLevelNodeByKey 节点查找
 * - loadMap / saveMap / getModData 回调委托
 */

import { describe, it, expect, vi } from 'vitest'
import {
  parseModRegistrationArg,
  getTopLevelNodeByKey,
  loadMap,
  saveMap,
  getModData,
} from './UtilityHelpers'

describe('UtilityHelpers', () => {
  // -----------------------------------------------------------------------
  // parseModRegistrationArg
  // -----------------------------------------------------------------------

  describe('parseModRegistrationArg', () => {
    it('should parse "user" as User flag (1)', () => {
      expect(parseModRegistrationArg('user')).toBe(1)
    })

    it('should parse "system" as System flag (2)', () => {
      expect(parseModRegistrationArg('system')).toBe(2)
    })

    it('should parse "both" as User|System (3)', () => {
      expect(parseModRegistrationArg('both')).toBe(3)
    })

    it('should throw for invalid value', () => {
      expect(() => parseModRegistrationArg('invalid')).toThrow(/Invalid mod registration type/)
    })

    it('should throw for empty string', () => {
      expect(() => parseModRegistrationArg('')).toThrow(/Invalid mod registration type/)
    })

    it('should be case-sensitive (rejects "USER")', () => {
      expect(() => parseModRegistrationArg('USER')).toThrow()
    })

    it('should be case-sensitive (rejects "System")', () => {
      expect(() => parseModRegistrationArg('System')).toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // getTopLevelNodeByKey
  // -----------------------------------------------------------------------

  describe('getTopLevelNodeByKey', () => {
    it('should return mapYaml value if key exists in map data', () => {
      const result = getTopLevelNodeByKey(
        ['rules.yaml'],
        'World',
        () => ({}),
        { World: { MapSize: '128,128' } },
      )
      expect(result).toEqual({ MapSize: '128,128' })
    })

    it('should check files when key not in mapYaml', () => {
      const parseYaml = vi.fn<(fileContent: string) => Record<string, unknown>>((content: string) => {
        if (content.includes('rules.yaml')) return { Actors: { e1: 'e1' } }
        return {}
      })

      const result = getTopLevelNodeByKey(
        ['rules.yaml'],
        'Actors',
        parseYaml,
        null,
      )
      expect(result).toEqual({ e1: 'e1' })
      expect(parseYaml).toHaveBeenCalled()
    })

    it('should prioritize mapYaml over files', () => {
      const parseYaml = vi.fn(() => ({ World: { MapSize: '64,64' } }))
      const result = getTopLevelNodeByKey(
        ['rules.yaml'],
        'World',
        parseYaml,
        { World: { MapSize: '128,128' } },
      )
      expect(result).toEqual({ MapSize: '128,128' })
    })

    it('should return undefined when key not found anywhere', () => {
      const result = getTopLevelNodeByKey(
        ['rules.yaml'],
        'Nonexistent',
        () => ({}),
        null,
      )
      expect(result).toBeUndefined()
    })

    it('should handle empty files array', () => {
      const result = getTopLevelNodeByKey([], 'Key', () => ({}), null)
      expect(result).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // getModData
  // -----------------------------------------------------------------------

  describe('getModData', () => {
    it('should call the factory and return ModData', async () => {
      const mockModData = { manifest: { id: 'test' } } as never
      const factory = vi.fn().mockResolvedValue(mockModData)

      const result = await getModData({ id: 'test' } as never, factory)

      expect(result).toBe(mockModData)
      expect(factory).toHaveBeenCalledWith({ id: 'test' })
    })

    it('should propagate factory errors', async () => {
      const factory = vi.fn().mockRejectedValue(new Error('No filesystem'))

      await expect(getModData({ id: 'fail' } as never, factory)).rejects.toThrow('No filesystem')
    })
  })

  // -----------------------------------------------------------------------
  // loadMap
  // -----------------------------------------------------------------------

  describe('loadMap', () => {
    it('should load map from path via factory', async () => {
      const mockMap = { title: 'Test Map', uid: 'abc' } as never
      const factory = vi.fn().mockResolvedValue(mockMap)

      const result = await loadMap({} as never, '/path/to/map', factory)

      expect(result).toBe(mockMap)
      expect(factory).toHaveBeenCalledWith({}, '/path/to/map')
    })

    it('should return null and log error on factory failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const factory = vi.fn().mockRejectedValue(new Error('Corrupt map'))

      const result = await loadMap({} as never, '/bad/map', factory)

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should handle null from factory', async () => {
      const factory = vi.fn().mockResolvedValue(null)

      const result = await loadMap({} as never, '/empty', factory)

      expect(result).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // saveMap
  // -----------------------------------------------------------------------

  describe('saveMap', () => {
    it('should delegate to saveFactory', async () => {
      const mockMap = { title: 'ToSave' } as never
      const factory = vi.fn().mockResolvedValue(undefined)

      await saveMap(mockMap, '/out/map.oramap', factory)

      expect(factory).toHaveBeenCalledWith(mockMap, '/out/map.oramap')
    })

    it('should propagate save errors', async () => {
      const factory = vi.fn().mockRejectedValue(new Error('Disk full'))

      await expect(saveMap({} as never, '/out', factory)).rejects.toThrow('Disk full')
    })
  })
})
