/**
 * MapCommand.test.ts — MapCommand 迁移单元测试
 *
 * 测试焦点: 参数验证、子命令分派、正则表达式过滤
 */

import { describe, it, expect, vi } from 'vitest'
import { MapCommand } from './MapCommand'
import { Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapCommand', () => {
  let command: MapCommand

  it('has correct command name', () => {
    command = new MapCommand()
    expect(command.name).toBe('--map')
  })

  // -----------------------------------------------------------------------
  // validateArguments
  // -----------------------------------------------------------------------

  describe('validateArguments', () => {
    it('rejects empty args (too few)', () => {
      command = new MapCommand()
      expect(command.validateArguments([])).toBe(false)
    })

    it('rejects single arg (no subcommand)', () => {
      command = new MapCommand()
      expect(command.validateArguments(['--map'])).toBe(false)
    })

    it('accepts "refresh" subcommand', () => {
      command = new MapCommand()
      expect(command.validateArguments(['--map', 'refresh'])).toBe(true)
    })

    it('accepts "unpack" subcommand', () => {
      command = new MapCommand()
      expect(command.validateArguments(['--map', 'unpack'])).toBe(true)
    })

    it('accepts "repack" subcommand', () => {
      command = new MapCommand()
      expect(command.validateArguments(['--map', 'repack'])).toBe(true)
    })

    it('rejects invalid subcommand', () => {
      command = new MapCommand()
      expect(command.validateArguments(['--map', 'invalid'])).toBe(false)
    })

    it('rejects valid subcommand with invalid regex', () => {
      command = new MapCommand()
      // An invalid regex like an unclosed group should fail
      const badRegex = String.raw`(unclosed`
      expect(command.validateArguments(['--map', 'refresh', badRegex])).toBe(false)
    })

    it('accepts valid subcommand with valid regex', () => {
      command = new MapCommand()
      expect(command.validateArguments(['--map', 'refresh', '.*'])).toBe(true)
    })

    it('accepts valid subcommand with map-specific regex', () => {
      command = new MapCommand()
      expect(command.validateArguments(['--map', 'unpack', 'map_.*\\.oramap'])).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe('run', () => {
    it('executes without throwing (empty map locations)', () => {
      command = new MapCommand()
      const mockModData = {
        mapCache: {
          mapLocations: new Map(),
          loadMaps: vi.fn(),
        },
        modFiles: {} as any,
        manifest: {} as any,
        objectCreator: {} as any,
        defaultFileSystem: {} as any,
        loadScreen: null,
      }
      const util = new Utility(mockModData as any, new Map())

      expect(() => command!.run(util, ['--map', 'refresh'])).not.toThrow()
    })

    it('processes map packages when available (stub)', () => {
      command = new MapCommand()
      const mockPkg = {
        contents: ['test.oramap'],
        openPackage: vi.fn().mockReturnValue({
          dispose: vi.fn(),
        }),
      }
      const mockModData = {
        mapCache: {
          mapLocations: new Map([[mockPkg, 0]]),
          loadMaps: vi.fn(),
        },
        modFiles: {} as any,
        manifest: {} as any,
        objectCreator: {} as any,
        defaultFileSystem: {} as any,
        loadScreen: null,
      }
      const util = new Utility(mockModData as any, new Map())

      expect(() => command!.run(util, ['--map', 'refresh'])).not.toThrow()
      expect(mockPkg.openPackage).toHaveBeenCalledTimes(1)
    })

    it('filters maps by regex when provided', () => {
      command = new MapCommand()
      const mockPkg = {
        contents: ['skirmish.oramap', 'campaign.oramap'],
        openPackage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      }
      const mockModData = {
        mapCache: {
          mapLocations: new Map([[mockPkg, 0]]),
          loadMaps: vi.fn(),
        },
        modFiles: {} as any,
        manifest: {} as any,
        objectCreator: {} as any,
        defaultFileSystem: {} as any,
        loadScreen: null,
      }
      const util = new Utility(mockModData as any, new Map())

      command!.run(util, ['--map', 'refresh', 'skirmish.*'])
      // Should only open the skirmish map, not campaign
      expect(mockPkg.openPackage).toHaveBeenCalledTimes(1)
      const calledFilename = (mockPkg.openPackage as any).mock.calls[0]?.[0]
      expect(calledFilename).toBe('skirmish.oramap')
    })

    it('logs warning when package cannot be opened', () => {
      command = new MapCommand()
      const mockPkg = {
        contents: ['missing.oramap'],
        openPackage: vi.fn().mockReturnValue(null),
      }
      const mockModData = {
        mapCache: {
          mapLocations: new Map([[mockPkg, 0]]),
          loadMaps: vi.fn(),
        },
        modFiles: {} as any,
        manifest: {} as any,
        objectCreator: {} as any,
        defaultFileSystem: {} as any,
        loadScreen: null,
      }
      const util = new Utility(mockModData as any, new Map())

      expect(() => command!.run(util, ['--map', 'refresh'])).not.toThrow()
    })
  })
})
