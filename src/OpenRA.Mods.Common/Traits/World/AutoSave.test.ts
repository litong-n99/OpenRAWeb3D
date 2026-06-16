/**
 * AutoSave.test.ts — AutoSave migration unit tests
 *
 * Tests focus on: filename pattern, disable conditions, tick countdown,
 * interval change detection, file rotation, edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  AutoSave,
  AutoSaveSettings,
  AutoSaveInfo,
  type AutoSaveWorld,
  type AutoSaveFileEntry,
  type AutoSaveLobbyInfo,
} from './AutoSave.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeLobbyInfo(overrides: {
  dedicated?: boolean
  nonBotClientCount?: number
} = {}): AutoSaveLobbyInfo {
  const count = overrides.nonBotClientCount ?? 1
  const clients: unknown[] = []
  for (let i = 0; i < count; i++) {
    clients.push({})
  }
  return {
    globalSettings: {
      dedicated: overrides.dedicated ?? false,
    },
    nonBotClients: clients,
  }
}

interface WorldCallbacks {
  goSave?: (filename: string, isAutosave: boolean) => void
  getAutoSaveFiles?: () => AutoSaveFileEntry[]
  deleteAutoSaveFile?: (filename: string) => void
}

function makeWorld(overrides: Partial<AutoSaveWorld> = {}, callbacks: WorldCallbacks = {}): AutoSaveWorld {
  const settings = overrides.getSettings
    ? undefined
    : new AutoSaveSettings()

  return {
    timestep: overrides.timestep ?? 40,
    isReplay: overrides.isReplay ?? false,
    isLoadingGameSave: overrides.isLoadingGameSave ?? false,
    lobbyInfo: overrides.lobbyInfo ?? makeLobbyInfo(),
    getSettings: overrides.getSettings ?? (<T>(_type: new () => T): T => settings as unknown as T),
    requestGameSave:
      overrides.requestGameSave ??
      ((filename: string, isAutosave: boolean) => {
        callbacks.goSave?.(filename, isAutosave)
      }),
    getAutoSaveFiles:
      overrides.getAutoSaveFiles ??
      (() => callbacks.getAutoSaveFiles?.() ?? []),
    deleteAutoSaveFile:
      overrides.deleteAutoSaveFile ??
      ((filename: string) => {
        callbacks.deleteAutoSaveFile?.(filename)
      }),
  }
}

/** Create a mock actor with AutoSaveWorld.
 *
 * NOTE: Cast to IGameActor via `unknown` because IGameActor.world expects
 * WorldStub (requiring `actors`), but our test stubs only provide the
 * AutoSaveWorld subset. This is safe because the AutoSave trait only
 * accesses world through the AutoSaveWorld interface.
 */
function makeActor(world: AutoSaveWorld): IGameActor {
  return {
    actorId: 0,
    isInWorld: true,
    isDead: false,
    disposed: false,
    world,
  } as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset Date to prevent test flakiness from real timestamps
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-01-15T10:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// describe('AutoSaveSettings')
// ---------------------------------------------------------------------------

describe('AutoSaveSettings', () => {
  it('has default AutoSaveInterval = 0', () => {
    const s = new AutoSaveSettings()
    expect(s.AutoSaveInterval).toBe(0)
  })

  it('has default AutoSaveMaxFileCount = 10', () => {
    const s = new AutoSaveSettings()
    expect(s.AutoSaveMaxFileCount).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// describe('AutoSave')
// ---------------------------------------------------------------------------

describe('AutoSave', () => {
  // ---------------------------------------------------------------------------
  // Static constants
  // ---------------------------------------------------------------------------

  describe('static constants', () => {
    it('AutoSavePattern is "autosave-"', () => {
      expect(AutoSave.AutoSavePattern).toBe('autosave-')
    })

    it('SaveFileExtension is ".orasav"', () => {
      expect(AutoSave.SaveFileExtension).toBe('.orasav')
    })
  })

  // ---------------------------------------------------------------------------
  // Constructor & disabled state
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('isDisabled is false for single-player non-dedicated', () => {
      const world = makeWorld()
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      expect(autoSave.isDisabled).toBe(false)
    })

    it('isDisabled is true for dedicated server', () => {
      const world = makeWorld({
        lobbyInfo: makeLobbyInfo({ dedicated: true }),
      })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      expect(autoSave.isDisabled).toBe(true)
    })

    it('isDisabled is true for >1 non-bot client (multiplayer)', () => {
      const world = makeWorld({
        lobbyInfo: makeLobbyInfo({ nonBotClientCount: 3 }),
      })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      expect(autoSave.isDisabled).toBe(true)
    })

    it('initializes ticksUntilAutoSave from settings interval', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 60
      const world = makeWorld({
        getSettings: <T>(_type: new () => T): T => settings as unknown as T,
      })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      // At 25 TPS: 25 * 60 = 1500 ticks
      expect(autoSave.ticksUntilAutoSave).toBe(1500)
    })
  })

  // ---------------------------------------------------------------------------
  // tick — disabled conditions
  // ---------------------------------------------------------------------------

  describe('tick (disabled conditions)', () => {
    it('does nothing when disabled (dedicated)', () => {
      const goSave = vi.fn()
      const world = makeWorld(
        { lobbyInfo: makeLobbyInfo({ dedicated: true }) },
        { goSave },
      )
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      // Should not throw and should not call goSave
      autoSave.tick(actor)
      expect(goSave).not.toHaveBeenCalled()
    })

    it('does nothing when interval is 0', () => {
      const goSave = vi.fn()
      const world = makeWorld({}, { goSave })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      expect(autoSave.autoSaveSettings.AutoSaveInterval).toBe(0)
      autoSave.tick(actor)
      expect(goSave).not.toHaveBeenCalled()
    })

    it('does nothing during replay mode', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 10
      const goSave = vi.fn()
      const world = makeWorld(
        {
          isReplay: true,
          getSettings: <T>(_type: new () => T): T => settings as unknown as T,
        },
        { goSave },
      )
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      autoSave.tick(actor)
      expect(goSave).not.toHaveBeenCalled()
    })

    it('does nothing when loading game save', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 10
      const goSave = vi.fn()
      const world = makeWorld(
        {
          isLoadingGameSave: true,
          getSettings: <T>(_type: new () => T): T => settings as unknown as T,
        },
        { goSave },
      )
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      autoSave.tick(actor)
      expect(goSave).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // tick — countdown and save trigger
  // ---------------------------------------------------------------------------

  describe('tick (countdown and save trigger)', () => {
    it('decrements ticksUntilAutoSave each tick', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 4 // 4 seconds = 100 ticks at 25 TPS
      const world = makeWorld({
        getSettings: <T>(_type: new () => T): T => settings as unknown as T,
      })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      const initial = autoSave.ticksUntilAutoSave // 25 * 4 = 100
      autoSave.tick(actor)
      expect(autoSave.ticksUntilAutoSave).toBe(initial - 1)
    })

    it('triggers save when countdown reaches 0', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 4
      const goSave = vi.fn()
      const world = makeWorld(
        {
          getSettings: <T>(_type: new () => T): T => settings as unknown as T,
        },
        { goSave },
      )
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      // Manually set countdown to 1 to trigger save on next tick
      autoSave.ticksUntilAutoSave = 1
      autoSave.tick(actor)

      expect(goSave).toHaveBeenCalledTimes(1)
      const callArgs = goSave.mock.calls[0] as [string, boolean]
      expect(callArgs[0]).toMatch(/^autosave-.*\.orasav$/)
      expect(callArgs[1]).toBe(true) // isAutosave = true
    })

    it('generates correct filename pattern with ISO datetime', () => {
      // System time was set to 2024-01-15T10:30:00Z in beforeEach
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 4
      const goSave = vi.fn()
      const world = makeWorld(
        {
          getSettings: <T>(_type: new () => T): T => settings as unknown as T,
        },
        { goSave },
      )
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      autoSave.ticksUntilAutoSave = 1
      autoSave.tick(actor)

      const filename = (goSave.mock.calls[0] as [string, boolean])[0]
      expect(filename).toContain('autosave-')
      expect(filename).toContain('.orasav')
      // ISO datetime with hyphens (matching C# yyyy-MM-ddTHHmmssZ format)
      expect(filename).toMatch(/autosave-\d{4}-\d{2}-\d{2}T\d{6}Z\.orasav/)
    })

    it('resets timer after triggering save', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 60
      const world = makeWorld({
        getSettings: <T>(_type: new () => T): T => settings as unknown as T,
      })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      autoSave.ticksUntilAutoSave = 1
      autoSave.tick(actor)

      // Should reset to 25 * 60 = 1500
      expect(autoSave.ticksUntilAutoSave).toBe(1500)
    })
  })

  // ---------------------------------------------------------------------------
  // tick — interval change detection
  // ---------------------------------------------------------------------------

  describe('tick (interval change detection)', () => {
    it('recalculates timer when interval changes', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 60
      const world = makeWorld({
        getSettings: <T>(_type: new () => T): T => settings as unknown as T,
      })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      // initial value should be 25 * 60 = 1500
      expect(autoSave.ticksUntilAutoSave).toBe(1500)

      // Change the interval
      settings.AutoSaveInterval = 30
      autoSave.tick(actor)

      // Should recalculate to 25 * 30 = 750
      // But also -1 from tick decrement, so 749
      expect(autoSave.ticksUntilAutoSave).toBe(749)
    })
  })

  // ---------------------------------------------------------------------------
  // tick — file rotation
  // ---------------------------------------------------------------------------

  describe('tick (file rotation)', () => {
    it('deletes oldest files beyond max count', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 4
      settings.AutoSaveMaxFileCount = 3

      const now = Date.now()
      const files: AutoSaveFileEntry[] = [
        { name: 'autosave-oldest.orasav', createdTime: new Date(now - 4000) },
        { name: 'autosave-old.orasav', createdTime: new Date(now - 3000) },
        { name: 'autosave-mid.orasav', createdTime: new Date(now - 2000) },
        { name: 'autosave-new.orasav', createdTime: new Date(now - 1000) },
        { name: 'autosave-newest.orasav', createdTime: new Date(now) },
      ]

      const deleted: string[] = []
      const goSave = vi.fn()

      const world = makeWorld(
        {
          getSettings: <T>(_type: new () => T): T => settings as unknown as T,
          getAutoSaveFiles: () => files,
          deleteAutoSaveFile: (fn: string) => {
            deleted.push(fn)
          },
        },
        { goSave },
      )
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      autoSave.ticksUntilAutoSave = 1
      autoSave.tick(actor)

      // MaxFileCount=3, so keep 2 (limit-1) before creating new one.
      // After sorting by creation time descending: newest(0), new(-1), mid(-2), old(-3), oldest(-4)
      // Skip first (limit-1) = 2 entries: newest, new
      // Delete: mid, old, oldest
      expect(deleted).toHaveLength(3)
      expect(deleted).toContain('autosave-oldest.orasav')
      expect(deleted).toContain('autosave-old.orasav')
      expect(deleted).toContain('autosave-mid.orasav')
    })

    it('uses minimum of 3 for max file count', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 4
      settings.AutoSaveMaxFileCount = 1 // Too low, should be clamped to 3

      const files: AutoSaveFileEntry[] = [
        { name: 'a.orasav', createdTime: new Date(0) },
        { name: 'b.orasav', createdTime: new Date(1000) },
        { name: 'c.orasav', createdTime: new Date(2000) },
        { name: 'd.orasav', createdTime: new Date(3000) },
      ]

      const deleted: string[] = []

      const world = makeWorld({
        getSettings: <T>(_type: new () => T): T => settings as unknown as T,
        getAutoSaveFiles: () => files,
        deleteAutoSaveFile: (fn: string) => {
          deleted.push(fn)
        },
      })
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      autoSave.ticksUntilAutoSave = 1
      autoSave.tick(actor)

      // With min=3, keep 2 (limit-1=2), delete oldest 2 of 4
      expect(deleted).toHaveLength(2)
      expect(deleted).toContain('a.orasav')
      expect(deleted).toContain('b.orasav')
    })
  })

  // ---------------------------------------------------------------------------
  // edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('does not save when countdown > 0 after decrement', () => {
      const settings = new AutoSaveSettings()
      settings.AutoSaveInterval = 60
      const goSave = vi.fn()
      const world = makeWorld(
        {
          getSettings: <T>(_type: new () => T): T => settings as unknown as T,
        },
        { goSave },
      )
      const actor = makeActor(world)
      const info = new AutoSaveInfo()
      const autoSave = info.create({ self: actor })

      // 1500 ticks until save, one tick shouldn't trigger
      autoSave.tick(actor)
      expect(goSave).not.toHaveBeenCalled()
      expect(autoSave.ticksUntilAutoSave).toBe(1499)
    })
  })
})
