/**
 * ModRegistration.test.ts — ModRegistration 类型和 IModRegistry 接口的单元测试
 *
 * 测试焦点:
 * - ModRegistration 标志常量
 * - makeModKey 键生成函数
 * - hasModRegistrationFlag 辅助函数
 * - IModRegistry 接口约定
 */

import { describe, it, expect } from 'vitest'
import {
  ModRegistration,
  makeModKey,
  hasModRegistrationFlag,
  type IModRegistry,
  type ExternalModData,
} from './ModRegistration.js'

describe('ModRegistration', () => {
  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  describe('constants', () => {
    it('should define User = 1', () => {
      expect(ModRegistration.User).toBe(1)
    })

    it('should define System = 2', () => {
      expect(ModRegistration.System).toBe(2)
    })

    it('should allow bitwise combination of User and System', () => {
      const both = ModRegistration.User | ModRegistration.System
      expect(both).toBe(3)
    })
  })

  // -----------------------------------------------------------------------
  // hasModRegistrationFlag
  // -----------------------------------------------------------------------

  describe('hasModRegistrationFlag', () => {
    it('should return true when flag is set', () => {
      expect(hasModRegistrationFlag(ModRegistration.User, ModRegistration.User)).toBe(true)
      expect(hasModRegistrationFlag(ModRegistration.System, ModRegistration.System)).toBe(true)
    })

    it('should return true for combined flags', () => {
      const both = ModRegistration.User | ModRegistration.System
      expect(hasModRegistrationFlag(both, ModRegistration.User)).toBe(true)
      expect(hasModRegistrationFlag(both, ModRegistration.System)).toBe(true)
    })

    it('should return false when flag is not set', () => {
      expect(hasModRegistrationFlag(ModRegistration.User, ModRegistration.System)).toBe(false)
      expect(hasModRegistrationFlag(ModRegistration.System, ModRegistration.User)).toBe(false)
    })

    it('should return false for zero value', () => {
      expect(hasModRegistrationFlag(0, ModRegistration.User)).toBe(false)
      expect(hasModRegistrationFlag(0, ModRegistration.System)).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // makeModKey
  // -----------------------------------------------------------------------

  describe('makeModKey', () => {
    it('should produce key from two strings', () => {
      expect(makeModKey('ra', 'release-20230225')).toBe('ra-release-20230225')
    })

    it('should produce key from an object with id and version', () => {
      const mod = { id: 'ra', version: 'release-20231010' }
      expect(makeModKey(mod)).toBe('ra-release-20231010')
    })

    it('should produce key from an ExternalModData-like object', () => {
      const mod: ExternalModData = {
        id: 'cnc',
        version: 'release-20250330',
        launchPath: '/mods/cnc',
        launchArgs: [],
      }
      expect(makeModKey(mod)).toBe('cnc-release-20250330')
    })

    it('should handle empty version', () => {
      expect(makeModKey('mod', '')).toBe('mod-')
    })

    it('should handle version with hyphens', () => {
      expect(makeModKey('td', 'release-2025-v2')).toBe('td-release-2025-v2')
    })
  })

  // -----------------------------------------------------------------------
  // IModRegistry interface contract
  // -----------------------------------------------------------------------

  describe('IModRegistry', () => {
    it('should accept a valid implementation', () => {
      const calls: string[] = []
      const registry: IModRegistry = {
        register(manifest, launchPath, _launchArgs, registration) {
          calls.push(`register:${manifest.id}:${launchPath}:${registration}`)
        },
        unregister(manifest, registration) {
          calls.push(`unregister:${manifest.id}:${registration}`)
        },
        clearInvalidRegistrations(registration) {
          calls.push(`clear:${registration}`)
          return 3
        },
      }

      const mockManifest = { id: 'test-mod', metadata: { version: '1.0' } } as never

      registry.register(mockManifest, '/path/to/mod', ['--flag'], ModRegistration.User)
      expect(calls).toContain('register:test-mod:/path/to/mod:1')

      registry.unregister(mockManifest, ModRegistration.System)
      expect(calls).toContain('unregister:test-mod:2')

      const count = registry.clearInvalidRegistrations(ModRegistration.User | ModRegistration.System)
      expect(calls).toContain('clear:3')
      expect(count).toBe(3)
    })
  })
})
