/**
 * IUtilityCommand.test.ts — IUtilityCommand interface and Utility class unit tests
 *
 * Tests the IUtilityCommand interface contract and Utility context class.
 * Pure logic — no @babylonjs/core dependencies to mock.
 */

import { describe, it, expect, vi } from 'vitest'

import { Utility, type IUtilityCommand } from './IUtilityCommand.js'
import { ModData } from './ModData.js'
import { Manifest } from './Manifest.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFileSystem(): any {
  return {
    mount: vi.fn().mockResolvedValue(undefined),
    mountFromBuffer: vi.fn().mockReturnValue(null),
    mountPackage: vi.fn(),
    unmount: vi.fn().mockReturnValue(true),
    unmountAll: vi.fn(),
    openAsync: vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockReturnValue(false),
    isMounted: vi.fn().mockReturnValue(false),
    tryOpen: vi.fn().mockReturnValue(null),
    tryRead: vi.fn().mockReturnValue(null),
    readAsync: vi.fn().mockResolvedValue(new Uint8Array(0)),
    mountAsync: vi.fn().mockResolvedValue(undefined),
    registerLoader: vi.fn(),
    dispose: vi.fn(),
  }
}

function createTestManifest(id: string): Manifest {
  return new Manifest(id, {
    Metadata: { Title: 'Test Mod', Version: '1.0' },
    FileSystem: {},
  })
}

function createTestModData(): ModData {
  const manifest = createTestManifest('test-mod')
  const fs = createMockFileSystem()
  return new ModData(manifest, fs as any)
}

// ---------------------------------------------------------------------------
// Utility class tests
// ---------------------------------------------------------------------------

describe('Utility', () => {
  it('should store modData and mods from constructor', () => {
    const modData = createTestModData()
    const mods = new Map<string, Manifest>()
    mods.set('test-mod', modData.manifest)

    const utility = new Utility(modData, mods)

    expect(utility.modData).toBe(modData)
    expect(utility.mods).toBe(mods)
    expect(utility.mods.get('test-mod')).toBe(modData.manifest)
  })

  it('should accept empty mods map', () => {
    const modData = createTestModData()
    const mods = new Map<string, Manifest>()

    const utility = new Utility(modData, mods)

    expect(utility.modData).toBe(modData)
    expect(utility.mods.size).toBe(0)
  })

  it('should support multiple mods', () => {
    const modData = createTestModData()
    const manifest1 = modData.manifest
    const manifest2 = new Manifest('test-mod-2', {
      Metadata: { Title: 'Test Mod 2', Version: '2.0' },
      FileSystem: {},
    })

    const mods = new Map<string, Manifest>()
    mods.set('test-mod', manifest1)
    mods.set('test-mod-2', manifest2)

    const utility = new Utility(modData, mods)

    expect(utility.mods.size).toBe(2)
    expect(utility.mods.get('test-mod')).toBe(manifest1)
    expect(utility.mods.get('test-mod-2')).toBe(manifest2)
  })

  it('mods should be accessible from utility', () => {
    const modData = createTestModData()
    const mods = new Map<string, Manifest>()

    const utility = new Utility(modData, mods)

    expect(utility.mods).toBe(mods)
  })
})

// ---------------------------------------------------------------------------
// IUtilityCommand interface contract tests
// ---------------------------------------------------------------------------

describe('IUtilityCommand interface', () => {
  it('should be implementable with all required members', () => {
    class TestCommand implements IUtilityCommand {
      readonly name = 'test-command'

      validateArguments(args: string[]): boolean {
        return args.length === 1
      }

      run(_utility: Utility, _args: string[]): void {
        // no-op
      }
    }

    const cmd = new TestCommand()
    expect(cmd.name).toBe('test-command')
    expect(cmd.validateArguments(['valid'])).toBe(true)
    expect(cmd.validateArguments(['a', 'b'])).toBe(false)
  })

  it('name should be readonly and descriptive', () => {
    class GiveCashCommand implements IUtilityCommand {
      readonly name = 'give-cash'

      validateArguments(_args: string[]): boolean {
        return true
      }

      run(_utility: Utility, _args: string[]): void {
        // no-op
      }
    }

    const cmd = new GiveCashCommand()
    expect(cmd.name).toBe('give-cash')
  })

  it('validateArguments should handle empty args', () => {
    class NoArgCommand implements IUtilityCommand {
      readonly name = 'no-arg'

      validateArguments(args: string[]): boolean {
        return args.length === 0
      }

      run(_utility: Utility, _args: string[]): void {
        // no-op
      }
    }

    const cmd = new NoArgCommand()
    expect(cmd.validateArguments([])).toBe(true)
    expect(cmd.validateArguments(['extra'])).toBe(false)
  })

  it('command registry can use Map<string, IUtilityCommand>', () => {
    class Cmd1 implements IUtilityCommand {
      readonly name = 'cmd-one'
      validateArguments = () => true
      run = () => {}
    }

    class Cmd2 implements IUtilityCommand {
      readonly name = 'cmd-two'
      validateArguments = () => true
      run = () => {}
    }

    const registry = new Map<string, IUtilityCommand>()
    registry.set('cmd-one', new Cmd1())
    registry.set('cmd-two', new Cmd2())

    expect(registry.get('cmd-one')?.name).toBe('cmd-one')
    expect(registry.get('cmd-two')?.name).toBe('cmd-two')
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('run method should receive correct utility context', () => {
    const modData = createTestModData()
    const mods = new Map<string, Manifest>()
    const utility = new Utility(modData, mods)

    let capturedUtility: Utility | null = null

    class ContextCheckCommand implements IUtilityCommand {
      readonly name = 'check-context'

      validateArguments(): boolean {
        return true
      }

      run(u: Utility, _args: string[]): void {
        capturedUtility = u
      }
    }

    const cmd = new ContextCheckCommand()
    cmd.run(utility, [])

    expect(capturedUtility).not.toBeNull()
    expect(capturedUtility!.modData).toBe(modData)
    expect(capturedUtility!.mods).toBe(mods)
  })
})
