/**
 * Nudge.test.ts — Nudge 迁移单元测试
 *
 * Tests focus on: construction, tickOuter behavior, target line delegation.
 */

import { describe, it, expect } from 'vitest'
import { Nudge } from './Nudge.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import type { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Mock actor with Mobile trait
// ---------------------------------------------------------------------------

function mockActorWithMobile(
  disabled: boolean = false,
  paused: boolean = false,
  immovable: boolean = false,
  adjacentCell: CPos | null = null,
): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    location: { X: 5, Y: 5 } as CPos,
    traits: new Map([
      ['Mobile', {
        isTraitDisabled: disabled,
        isTraitPaused: paused,
        isImmovable: immovable,
        getAdjacentCell: () => adjacentCell,
        info: { targetLineColor: { r: 0, g: 1, b: 0, a: 1 } },
      }],
    ]),
    toString() { return 'Actor 1' },
  } as unknown as GameActor
}

function mockActorWithoutMobile(): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    location: { X: 5, Y: 5 } as CPos,
    traits: new Map(),
    toString() { return 'Actor 1' },
  } as unknown as GameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Nudge', () => {
  it('stores nudger reference', () => {
    const nudger = mockActorWithMobile()
    const nudge = new Nudge(nudger)
    expect(nudge.nudger).toBe(nudger)
  })

  it('does nothing when mobile is disabled', () => {
    const self = mockActorWithMobile(true, false, false, { X: 6, Y: 5 } as CPos)
    const nudge = new Nudge(self)
    nudge.tickOuter(self as unknown as GameActor)
    // No child queued because mobile is disabled
    expect(nudge.childActivity).toBeNull()
  })

  it('does nothing when mobile is paused', () => {
    const self = mockActorWithMobile(false, true, false, { X: 6, Y: 5 } as CPos)
    const nudge = new Nudge(self)
    nudge.tickOuter(self as unknown as GameActor)
    expect(nudge.childActivity).toBeNull()
  })

  it('does nothing when mobile is immovable', () => {
    const self = mockActorWithMobile(false, false, true, { X: 6, Y: 5 } as CPos)
    const nudge = new Nudge(self)
    nudge.tickOuter(self as unknown as GameActor)
    expect(nudge.childActivity).toBeNull()
  })

  it('queues child when adjacent cell is found', () => {
    const self = mockActorWithMobile(false, false, false, { X: 6, Y: 5 } as CPos)
    const nudge = new Nudge(self)
    // tickOuter returns the activity itself if still running, or next if done
    // Since Nudge queues a stub child that completes immediately, Nudge should
    // complete in the same tick (child done + parent has no more work)
    const result = nudge.tickOuter(self as unknown as GameActor)
    // Nudge completes because child stub returns true immediately
    expect(result).not.toBe(nudge)
  })

  it('does nothing when no adjacent cell available', () => {
    const self = mockActorWithMobile(false, false, false, null)
    const nudge = new Nudge(self)
    nudge.tickOuter(self as unknown as GameActor)
    expect(nudge.childActivity).toBeNull()
  })

  it('handles actor without mobile trait', () => {
    const self = mockActorWithoutMobile()
    const nudge = new Nudge(self)
    // Should not throw
    nudge.tickOuter(self as unknown as GameActor)
    expect(nudge.childActivity).toBeNull()
  })

  it('returns empty target lines when no child', () => {
    const self = mockActorWithMobile()
    const nudge = new Nudge(self)
    const nodes = nudge.targetLineNodes(self as unknown as GameActor)
    expect(nodes.length).toBe(0)
  })
})
