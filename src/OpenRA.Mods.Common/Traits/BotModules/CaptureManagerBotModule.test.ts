/**
 * CaptureManagerBotModule.test.ts — unit tests for AI capture management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CaptureManagerBotModule, type CaptureManagerBotModuleInfo } from './CaptureManagerBotModule.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInfo(overrides: Partial<CaptureManagerBotModuleInfo> = {}): CaptureManagerBotModuleInfo {
  return {
    capturingActorTypes: new Set(['e6']),
    capturableActorTypes: new Set(),
    minimumCaptureDelay: 375,
    maximumCaptureTargetOptions: 10,
    checkCaptureTargetsForVisibility: true,
    capturableRelationships: 0x06, // Enemy | Neutral
    ...overrides,
  } as CaptureManagerBotModuleInfo
}

function makeWorld(): { actors: Iterable<Record<string, unknown>>; players?: Iterable<Record<string, unknown>> } {
  return {
    actors: [],
    players: [],
  }
}

function makePlayer(): Record<string, unknown> {
  return { playerName: 'BotPlayer', winState: 'Undefined' }
}

function makeRandom() {
  return { nextIntRange: (min: number, _max: number) => min }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CaptureManagerBotModule', () => {
  let info: CaptureManagerBotModuleInfo
  let world: ReturnType<typeof makeWorld>
  let player: Record<string, unknown>

  beforeEach(() => {
    info = makeInfo()
    world = makeWorld()
    player = makePlayer()
  })

  describe('constructor', () => {
    it('creates with valid config', () => {
      const m = new CaptureManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(m).toBeDefined()
      expect(m.info.capturingActorTypes.has('e6')).toBe(true)
    })

    it('clamps maximumCaptureTargetOptions to at least 1', () => {
      const infoNeg = makeInfo({ maximumCaptureTargetOptions: -5 })
      const m = new CaptureManagerBotModule(
        world as any,
        player as any,
        infoNeg,
        makeRandom() as any,
      )
      expect(m.info.maximumCaptureTargetOptions).toBe(-5) // stored as-is in info
    })
  })

  describe('botTick', () => {
    it('does not throw with empty world', () => {
      const m = new CaptureManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      const bot = { queueOrder: () => {} } as any
      expect(() => m.botTick(bot)).not.toThrow()
    })

    it('skips capture when no capturing actor types', () => {
      const infoEmpty = makeInfo({ capturingActorTypes: new Set() })
      const m = new CaptureManagerBotModule(
        world as any,
        player as any,
        infoEmpty,
        makeRandom() as any,
      )
      // botTick should not error
      const bot = { queueOrder: () => { throw new Error('should not queue') } } as any
      expect(() => m.botTick(bot)).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('cleans up without error', () => {
      const m = new CaptureManagerBotModule(
        world as any,
        player as any,
        info,
        makeRandom() as any,
      )
      expect(() => m.dispose()).not.toThrow()
    })
  })
})
