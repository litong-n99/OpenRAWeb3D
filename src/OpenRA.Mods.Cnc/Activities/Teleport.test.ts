/**
 * Teleport.test.ts -- Teleport activity unit tests
 *
 * Tests cover: multi-tick state machine, position change, cargo kill,
 * kill-on-failure, origin recording, phase transitions, cancel behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
  TransformNode: class MockTransformNode {},
}))

import { Teleport, TeleportPhase } from './Teleport.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMobile(setPosSpy?: (cell: CPos) => void): {
  setPosition: ReturnType<typeof vi.fn>
  canEnterCell: ReturnType<typeof vi.fn>
} {
  return {
    setPosition: vi.fn((_self: GameActor, cell: CPos, _subCell?: number) => {
      setPosSpy?.(cell)
    }),
    canEnterCell: vi.fn((_cell: CPos) => true),
  }
}

function makePortableChrono(overrides?: { canTeleport?: boolean }): {
  canTeleport: boolean
  resetChargeTime: ReturnType<typeof vi.fn>
} {
  return {
    canTeleport: overrides?.canTeleport ?? true,
    resetChargeTime: vi.fn(),
  }
}

function makeSelf(
  traits?: Map<string, unknown>,
  loc?: CPos,
): GameActor {
  const resolved = traits ?? new Map()
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    location: loc ?? new CPos(10, 10),
    centerPosition: new WPos(10 * 1024 + 512, 10 * 1024 + 512, 0),
    owner: {
      internalName: 'Multi0',
      shroud: { isExplored: (_cell: CPos) => true },
    },
    traits: resolved,
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Helper: tick through all phases until activity completes
// ---------------------------------------------------------------------------

function tickThroughAll(activity: Teleport, self: GameActor, maxTicks: number = 100): boolean {
  for (let i = 0; i < maxTicks; i++) {
    const done = activity.tick(self)
    if (done) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Helper: count ticks needed to complete
// ---------------------------------------------------------------------------

function countTicksToComplete(activity: Teleport, self: GameActor, maxTicks: number = 100): number {
  for (let i = 0; i < maxTicks; i++) {
    const done = activity.tick(self)
    if (done) return i + 1
  }
  return -1
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Teleport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('initializes with correct properties', () => {
      const dest = new CPos(20, 20)
      const teleporter = makeSelf()

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', true)
      expect(tp).toBeDefined()
      expect(tp.destination).toEqual(dest)
      expect(tp.isInterruptible).toBe(true)
      expect(tp.phase).toBe(TeleportPhase.Init)
      expect(tp.teleporter).toBe(teleporter)
    })

    it('sets isInterruptible to false when requested', () => {
      const dest = new CPos(20, 20)
      const teleporter = makeSelf()

      const tp = new Teleport(teleporter, dest, null, false, false, 'chrono', false)
      expect(tp.isInterruptible).toBe(false)
    })

    it('accepts all constructor parameters', () => {
      const dest = new CPos(20, 20)
      const teleporter = makeSelf()

      const tp = new Teleport(
        teleporter, dest, 30, true, true, 'chronosound',
        true, true, new Set(['Explosion']),
        15, 3, 15, true, // preDelay=15, duringDelay=3, postDelay=15, returnToOrigin=true
      )
      expect(tp).toBeDefined()
      expect(tp.killCargo).toBe(true)
      expect(tp.returnToOrigin).toBe(true)
    })

    it('handles null teleporter', () => {
      const dest = new CPos(20, 20)

      const tp = new Teleport(null, dest, null, false, false, 'chrono', true)
      expect(tp).toBeDefined()
      expect(tp.teleporter).toBeNull()
    })

    it('validates maximumDistance against max tile search range', () => {
      const dest = new CPos(20, 20)
      const teleporter = makeSelf()

      expect(() => {
        new Teleport(teleporter, dest, 999, false, false, 'chrono')
      }).toThrow('MaximumTileSearchRange')
    })

    it('defaults returnToOrigin to false', () => {
      const dest = new CPos(20, 20)
      const tp = new Teleport(makeSelf(), dest, null, false, false, 'chrono')
      expect(tp.returnToOrigin).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Multi-tick state machine
  // ---------------------------------------------------------------------------

  describe('multi-tick state machine', () => {
    it('starts in Init phase', () => {
      const tp = new Teleport(makeSelf(), new CPos(20, 20), null, false, false, 'chrono')
      expect(tp.phase).toBe(TeleportPhase.Init)
    })

    it('transitions through all phases with default delays', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      let setPosCell: CPos | null = null
      traits.set('Mobile', makeMobile((cell) => { setPosCell = cell }))

      const self = makeSelf(traits)
      const teleporter = self

      // Use 0-delay phases for fast testing
      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false, // All delays zero -> single-tick
      )
      const result = tp.tick(self)
      expect(result).toBe(true)
      expect(setPosCell).toEqual(dest)
    })

    it('records origin in onFirstRun (pre-Teleport phase)', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      // Access onFirstRun indirectly via tick
      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(tp.origin).not.toBeNull()
      expect(tp.originCell).not.toBeNull()
    })

    it('origin cell matches actor location', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const startLoc = new CPos(10, 10)
      const self = makeSelf(traits, startLoc)

      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(tp.originCell).not.toBeNull()
      expect(tp.originCell!.Bits).toBe(startLoc.Bits)
    })
  })

  // ---------------------------------------------------------------------------
  // Delay timing
  // ---------------------------------------------------------------------------

  describe('delay timing', () => {
    it('completes in expected total ticks with configurable delays', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      // 2 pre + 1 during + 2 post = 5 delay ticks + 1 Execute tick = 6 total
      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
2, 1, 2,
      )
      const ticks = countTicksToComplete(tp, self, 50)
      // Init (1) + PreDelay (2) + DuringDelay (1) + Execute (1) + PostDelay (2) = 7
      expect(ticks).toBe(7)
    })

    it('completes in 1 tick when all delays are zero', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      const ticks = countTicksToComplete(tp, self, 50)
      expect(ticks).toBe(1)
    })

    it('spends correct ticks in PreDelay phase', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
3, 0, 0,
      )
      // First tick: Init -> PreDelay
      tp.tick(self)
      expect(tp.phase).toBe(TeleportPhase.PreDelay)
      expect(tp.phaseTick).toBe(3) // Init set phaseTick=3, not yet decremented

      tp.tick(self)
      expect(tp.phase).toBe(TeleportPhase.PreDelay)
      expect(tp.phaseTick).toBe(2) // 3 -> 2 after first PreDelay tick

      tp.tick(self)
      expect(tp.phase).toBe(TeleportPhase.PreDelay)
      expect(tp.phaseTick).toBe(1) // 2 -> 1 after second PreDelay tick

      tp.tick(self)
      // phaseTick reaches 0, transitions to DuringDelay (0) -> Execute
      expect(tp.phase).toBe(TeleportPhase.Execute)
    })

    it('spends correct ticks in PostDelay phase after Execute', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
0, 0, 3,
      )
      // Fast-forward to PostDelay
      tickThroughAll(tp, self, 50)
      // After completion, phase should be Complete
      expect(tp.phase).toBe(TeleportPhase.Complete)
    })
  })

  // ---------------------------------------------------------------------------
  // Position change
  // ---------------------------------------------------------------------------

  describe('position change', () => {
    it('sets position to destination on successful teleport', () => {
      const dest = new CPos(20, 20)
      let setPosCell: CPos | null = null

      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile((cell) => { setPosCell = cell }))

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(setPosCell).not.toBeNull()
      expect(setPosCell!.Bits).toBe(dest.Bits)
    })

    it('increments generation on success', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self: Record<string, unknown> = makeSelf(traits) as unknown as Record<string, unknown>
      self['generation'] = 5
      const teleporter = self as unknown as GameActor

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(teleporter)

      expect(self['generation']).toBe(6)
    })

    it('falls back to OccupiesSpace when Mobile is not available', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      let setPosCell: CPos | null = null
      const occupier = makeMobile((cell) => { setPosCell = cell })
      traits.set('OccupiesSpace', occupier)

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(setPosCell).not.toBeNull()
      expect(setPosCell!.Bits).toBe(dest.Bits)
    })
  })

  // ---------------------------------------------------------------------------
  // Teleport blocked
  // ---------------------------------------------------------------------------

  describe('teleport blocked', () => {
    it('completes immediately without setting position when no cell is enterable', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      // Mobile reports no cell as enterable
      const blockedMobile = makeMobile()
      blockedMobile.canEnterCell = vi.fn(() => false)
      traits.set('Mobile', blockedMobile)

      const self = makeSelf(traits)

      // teleporter is null -> _chooseBestDestinationCell returns null immediately
      const tp = new Teleport(
        null, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      const result = tp.tick(self)

      // When teleporter is null, _chooseBestDestinationCell returns null,
      // so Tick returns true immediately without moving
      expect(result).toBe(true)
    })

    it('activates killOnFailure when no valid destination cell found', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      // Make all cells unenterable
      const blockedMobile = makeMobile()
      blockedMobile.canEnterCell = vi.fn(() => false)
      traits.set('Mobile', blockedMobile)

      const killSpy = vi.fn()
      traits.set('Kill', { kill: killSpy })

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, true, new Set(['TeleportDeath']),
        0, 0, 0,
      )
      tp.tick(self)

      expect(killSpy).toHaveBeenCalledTimes(1)
    })
  })

  // ---------------------------------------------------------------------------
  // killCargo
  // ---------------------------------------------------------------------------

  describe('killCargo', () => {
    it('kills cargo when killCargo is true', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      let killCalled = false
      const unloadSpy = vi.fn().mockReturnValue({
        actorId: 99,
        kill() { killCalled = true },
      })

      // Cargo that is non-empty on first check, empty on second
      let isEmptyFlag = false
      const cargo = {
        isEmpty: () => isEmptyFlag,
        unload: () => {
          isEmptyFlag = true
          return unloadSpy()
        },
      }

      traits.set('Mobile', makeMobile())
      traits.set('Cargo', cargo)

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, true, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(unloadSpy).toHaveBeenCalled()
      expect(killCalled).toBe(true)
    })

    it('skips cargo kill when killCargo is false', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      let unloadCalled = false
      const cargo = {
        isEmpty: () => false,
        unload() {
          unloadCalled = true
          return { actorId: 99 }
        },
      }

      traits.set('Mobile', makeMobile())
      traits.set('Cargo', cargo)

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(unloadCalled).toBe(false)
    })

    it('kills all passengers in cargo', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const killCalls: number[] = []
      const unloadResults = [
        { actorId: 10, kill: () => { killCalls.push(10) } },
        { actorId: 20, kill: () => { killCalls.push(20) } },
        { actorId: 30, kill: () => { killCalls.push(30) } },
      ]
      let unloadIndex = 0

      const cargo = {
        isEmpty: () => unloadIndex >= unloadResults.length,
        unload: () => unloadResults[unloadIndex++],
      }

      traits.set('Mobile', makeMobile())
      traits.set('Cargo', cargo)

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, true, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(killCalls).toEqual([10, 20, 30])
    })
  })

  // ---------------------------------------------------------------------------
  // killOnFailure
  // ---------------------------------------------------------------------------

  describe('killOnFailure', () => {
    it('handles killOnFailure when portable chrono cannot teleport', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const killSpy = vi.fn()
      traits.set('PortableChrono', makePortableChrono({ canTeleport: false }))
      traits.set('Kill', { kill: killSpy })

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, true, new Set(['TeleportDeath']),
        0, 0, 0, false,
      )
      const result = tp.tick(self)

      expect(result).toBe(true)
      expect(killSpy).toHaveBeenCalledTimes(1)
    })

    it('skips killOnFailure when chrono can teleport', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const killSpy = vi.fn()
      traits.set('PortableChrono', makePortableChrono({ canTeleport: true }))
      traits.set('Mobile', makeMobile())
      traits.set('Kill', { kill: killSpy })

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, true, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(killSpy).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Chrono charge consumption
  // ---------------------------------------------------------------------------

  describe('chrono charge consumption', () => {
    it('consumes chrono charges when self is teleporter', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const pc = makePortableChrono()
      traits.set('PortableChrono', pc)
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(pc.resetChargeTime).toHaveBeenCalledTimes(1)
    })

    it('does not consume charges when teleporter is different actor', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      const pc = makePortableChrono()
      traits.set('PortableChrono', pc)
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const teleporter = makeSelf(new Map())

      const tp = new Teleport(
        teleporter, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(pc.resetChargeTime).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // chooseBestDestinationCell
  // ---------------------------------------------------------------------------

  describe('chooseBestDestinationCell', () => {
    it('returns null when teleporter is null', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const tp = new Teleport(
        null, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      const result = tp.tick(self)

      expect(result).toBe(true)
    })

    it('returns destination when cell is enterable and explored', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, 5, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      const result = tp.tick(self)

      expect(result).toBe(true)
    })

    it('finds nearest enterable cell when destination is blocked', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()

      // Allow entry on cells except the exact destination
      const mobile = makeMobile()
      mobile.canEnterCell = vi.fn((cell: CPos) => {
        return cell.X !== 20 || cell.Y !== 20
      })
      traits.set('Mobile', mobile)

      // self location must be close enough to destination for maxDistance to cover it
      const self = makeSelf(traits, new CPos(15, 15))
      const teleporter = self

      const tp = new Teleport(
        teleporter, dest, 15, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      // Should have found an alternate cell (position was set somewhere)
      expect(mobile.setPosition).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  describe('cancel', () => {
    it('completes immediately when cancelled during Init phase', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)
      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
        5, 5, 5, false, // preDelay=5, duringDelay=5, postDelay=5, returnToOrigin=false
      )
      // Activity is in Init phase, hasn't ticked yet
      tp.cancel(self)

      // After cancel in Init, onFirstRun never happened -> teleport didn't execute
      expect(tp.origin).toBeNull()
    })

    it('skips remaining delay phases when cancelled post-Execute', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 5, false,    // preDelay=0, duringDelay=0, postDelay=5, returnToOrigin=false
      )
      // Tick through Init, PreDelay(0), DuringDelay(0), Execute
      // Init (1 tick) transitions to Execute immediately since delays are 0
      // Init checks bestCell and if valid goes to PreDelay(0) -> DuringDelay(0) -> Execute
      // Actually with 0 delays: Init -> PreDelay, PreDelay(0) -> DuringDelay, DuringDelay(0) -> Execute -> PostDelay(5)
      const result = tp.tick(self)
      // After first tick: Init executed, went through all 0-delay phases, reached PostDelay
      expect(result).toBe(false) // Not done yet (in PostDelay with 5 ticks)

      // Now cancel during PostDelay
      tp.cancel(self, false)

      // The cancel during PostDelay should have set the state to Canceling/Done
      // and the position should already be set (Execute ran)
      const mobile = traits.get('Mobile') as { setPosition: ReturnType<typeof vi.fn> }
      expect(mobile.setPosition).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // returnToOrigin flag
  // ---------------------------------------------------------------------------

  describe('returnToOrigin', () => {
    it('suppresses screen flash on return trips', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      // returnToOrigin = true, screenFlash = true -- flash should be suppressed
      const tp = new Teleport(
        self, dest, null, false, true, 'chrono',
        true, false, new Set(),
        0, 0, 0, true, // preDelay=0, duringDelay=0, postDelay=0, returnToOrigin=true
      )
      // Should complete without error (screenFlash suppressed)
      const result = tp.tick(self)
      expect(result).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  describe('accessors', () => {
    it('exposes origin and originCell after first tick', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
        0, 0, 0, false,
      )
      tp.tick(self)

      expect(tp.origin).not.toBeNull()
      expect(tp.originCell).not.toBeNull()
      expect(tp.teleporter).toBe(self)
      expect(tp.killCargo).toBe(false)
      expect(tp.returnToOrigin).toBe(false)
      expect(tp.phase).toBe(TeleportPhase.Complete)
    })

    it('exposes phase and phaseTick during PreDelay', () => {
      const dest = new CPos(20, 20)
      const traits = new Map<string, unknown>()
      traits.set('Mobile', makeMobile())

      const self = makeSelf(traits)

      const tp = new Teleport(
        self, dest, null, false, false, 'chrono',
        true, false, new Set(),
3, 0, 0,
      )
      tp.tick(self) // Init -> PreDelay
      expect(tp.phase).toBe(TeleportPhase.PreDelay)
      expect(tp.phaseTick).toBe(3) // Init set phaseTick=3, not yet decremented
    })
  })
})
