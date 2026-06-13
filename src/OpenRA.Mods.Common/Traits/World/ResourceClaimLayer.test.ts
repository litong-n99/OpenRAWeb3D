/**
 * ResourceClaimLayer.test.ts — ResourceClaimLayer migration unit tests
 *
 * Tests focus on:
 * - tryClaimCell: success on unclaimed cells, blocking by allied actors,
 *   success when claimed by non-allied (enemy) actors
 * - canClaimCell: read-only check without state modification
 * - removeClaim: releases claim, enabling subsequent re-claim
 * - Stale cleanup: dead actors removed from claimByCell during tryClaimCell
 * - areAllied: same-owner and isAlliedWith duck-typing logic
 * - ResourceClaimLayerInfo default construction
 */

import { describe, it, expect } from 'vitest'
import { ResourceClaimLayer, ResourceClaimLayerInfo } from './ResourceClaimLayer'
import { CPos } from '../../../OpenRA.Game/CPos'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

interface MockOwner {
  name: string
  playerName?: string
  isAlliedWith(other: Record<string, unknown>): boolean
}

let actorIdCounter = 1

/** Create a mock owner object compatible with the IGameActor.owner duck-type.
 *
 * The IGameActor.owner is typed as PlayerStub | undefined, but ResourceClaimLayer
 * accesses it via duck-typing. We cast through unknown to avoid type conflicts.
 */
function createOwner(
  name: string,
  allies: string[] = [],
): MockOwner {
  return {
    name,
    playerName: name,
    isAlliedWith(other: Record<string, unknown>): boolean {
      return allies.includes((other as unknown as MockOwner).name)
    },
  }
}

/** Helper to wrap a MockOwner for IGameActor.owner assignment. */
function asOwner(o: MockOwner | undefined): IGameActor['owner'] {
  return o as unknown as IGameActor['owner']
}

/** Create a minimal mock IGameActor for ResourceClaimLayer tests. */
function createActor(
  overrides: {
    actorId?: number
    owner?: MockOwner
    isDead?: boolean
  } = {},
): IGameActor {
  const id = overrides.actorId ?? actorIdCounter++
  return {
    actorId: id,
    isInWorld: true,
    isDead: overrides.isDead ?? false,
    disposed: false,
    owner: asOwner(overrides.owner),
  }
}

/** Create a shared owner reference (same player). */
const playerA = createOwner('PlayerA', ['PlayerA', 'PlayerAB'])
const playerAB = createOwner('PlayerAB', ['PlayerA', 'PlayerAB'])
const playerC = createOwner('PlayerC', ['PlayerC'])

// ---------------------------------------------------------------------------
// Helper — create a CPos cell
// ---------------------------------------------------------------------------

function cell(x: number, y: number, layer = 0): CPos {
  return new CPos(x, y, layer)
}

// ---------------------------------------------------------------------------
// ResourceClaimLayerInfo tests
// ---------------------------------------------------------------------------

describe('ResourceClaimLayerInfo', () => {
  it('creates with default empty instanceName', () => {
    const info = new ResourceClaimLayerInfo()
    expect(info.instanceName).toBeUndefined()
  })

  it('accepts custom instanceName', () => {
    const info = new ResourceClaimLayerInfo({ instanceName: 'myLayer' })
    expect(info.instanceName).toBe('myLayer')
  })

  it('create() returns a ResourceClaimLayer instance', () => {
    const info = new ResourceClaimLayerInfo()
    const layer = info.create()
    expect(layer).toBeInstanceOf(ResourceClaimLayer)
  })
})

// ---------------------------------------------------------------------------
// ResourceClaimLayer — tryClaimCell tests
// ---------------------------------------------------------------------------

describe('ResourceClaimLayer', () => {
  let layer: ResourceClaimLayer

  beforeEach(() => {
    layer = new ResourceClaimLayer()
    actorIdCounter = 1
  })

  // ---------------------------------------------------------------------------
  // TEST-10.16: tryClaimCell succeeds on unclaimed cell
  // ---------------------------------------------------------------------------

  describe('tryClaimCell', () => {
    it('succeeds on unclaimed cell and returns true (TEST-10.16)', () => {
      const actor = createActor({ owner: playerA })
      const c = cell(10, 20)

      const result = layer.tryClaimCell(actor, c)
      expect(result).toBe(true)
    })

    it('fails when cell is already claimed by same player (TEST-10.16)', () => {
      const actor1 = createActor({ owner: playerA })
      const actor2 = createActor({ owner: playerA })
      const c = cell(10, 20)

      // First claim succeeds
      expect(layer.tryClaimCell(actor1, c)).toBe(true)

      // Second claim by same player fails
      const result = layer.tryClaimCell(actor2, c)
      expect(result).toBe(false)
    })

    it('fails when cell is claimed by an allied player (isAlliedWith returns true)', () => {
      const actorA = createActor({ owner: playerA })
      const actorAB = createActor({ owner: playerAB })
      const c = cell(5, 5)

      // playerAB is allied with playerA
      expect(layer.tryClaimCell(actorA, c)).toBe(true)
      expect(layer.tryClaimCell(actorAB, c)).toBe(false)
    })

    it('succeeds when cell is claimed by a non-allied (enemy) player', () => {
      const actorA = createActor({ owner: playerA })
      const actorC = createActor({ owner: playerC })
      const c = cell(5, 5)

      // playerC is NOT allied with playerA
      expect(layer.tryClaimCell(actorA, c)).toBe(true)
      expect(layer.tryClaimCell(actorC, c)).toBe(true)
    })

    it('succeeds when claiming a cell already held by an ownerless actor', () => {
      const ownedActor = createActor({ owner: playerA })
      const noOwnerActor = createActor({ owner: undefined })
      const c = cell(5, 5)

      // Owned actor claims first
      expect(layer.tryClaimCell(ownedActor, c)).toBe(true)

      // Ownerless actor is not allied to anyone, so claim succeeds
      expect(layer.tryClaimCell(noOwnerActor, c)).toBe(true)
    })

    it('releases old claim when claiming a new cell', () => {
      const actor = createActor({ owner: playerA })
      const c1 = cell(1, 1)
      const c2 = cell(2, 2)

      // Claim first cell
      expect(layer.tryClaimCell(actor, c1)).toBe(true)

      // Claim second cell — old claim should be auto-released
      expect(layer.tryClaimCell(actor, c2)).toBe(true)

      // Now another actor of same player can claim c1 (old claim was released)
      const actor2 = createActor({ owner: playerA })
      expect(layer.tryClaimCell(actor2, c1)).toBe(true)
    })

    // -------------------------------------------------------------------------
    // TEST-10.17: Stale cleanup — dead actor removal
    // -------------------------------------------------------------------------

    it('cleans up dead actors from claimByCell during tryClaimCell (TEST-10.17)', () => {
      const alive = createActor({ owner: playerA, isDead: false })
      const c = cell(10, 20)

      // First, claim the cell with the alive actor
      expect(layer.tryClaimCell(alive, c)).toBe(true)

      // Now mark the claiming actor as dead (simulating harvester death)
      // Use duck-typing through unknown to avoid type mismatch
      ;(alive as unknown as Record<string, unknown>).isDead = true

      // A new alive actor of the same player tries to claim.
      // During tryClaimCell, the stale (dead) actor is removed from claimByCell,
      // so the new actor can claim successfully.
      const alive2 = createActor({ owner: playerA })
      const result = layer.tryClaimCell(alive2, c)
      // Dead claimer was cleaned → no allied blocker → claim succeeds
      expect(result).toBe(true)
    })

    it('dead actors are cleaned from claimByCell on subsequent tryClaimCell', () => {
      const tempActor = createActor({ owner: playerA, isDead: false })
      const c = cell(5, 5)

      // Claim the cell
      expect(layer.tryClaimCell(tempActor, c)).toBe(true)

      // Now tempActor becomes dead
      ;(tempActor as unknown as Record<string, unknown>).isDead = true

      // Another actor of the same player tries to claim
      // tempActor is dead, should be cleaned up, and claim should succeed
      const newActor = createActor({ owner: playerA })
      const result = layer.tryClaimCell(newActor, c)
      expect(result).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // canClaimCell tests — read-only check
  // ---------------------------------------------------------------------------

  describe('canClaimCell', () => {
    it('returns true for unclaimed cell', () => {
      const actor = createActor({ owner: playerA })
      expect(layer.canClaimCell(actor, cell(1, 1))).toBe(true)
    })

    it('returns false when cell claimed by allied actor', () => {
      const actorA = createActor({ owner: playerA })
      const actorAB = createActor({ owner: playerAB })
      const c = cell(5, 5)

      layer.tryClaimCell(actorA, c)
      expect(layer.canClaimCell(actorAB, c)).toBe(false)
    })

    it('returns true when cell claimed by non-allied actor', () => {
      const actorA = createActor({ owner: playerA })
      const actorC = createActor({ owner: playerC })
      const c = cell(5, 5)

      layer.tryClaimCell(actorA, c)
      expect(layer.canClaimCell(actorC, c)).toBe(true)
    })

    it('filteres out dead allied actors in canClaimCell check', () => {
      const alive = createActor({ owner: playerA, isDead: false })
      const c = cell(10, 20)

      // Claim with alive, then kill it
      layer.tryClaimCell(alive, c)
      ;(alive as unknown as Record<string, unknown>).isDead = true

      // canClaimCell checks: c !== claimer && !c.isDead && areAllied
      // So dead actors ARE filtered in canClaimCell (via !c.isDead)
      const newActor = createActor({ owner: playerA })
      expect(layer.canClaimCell(newActor, c)).toBe(true)
    })

    it('does not modify internal state', () => {
      const actor = createActor({ owner: playerA })
      const c = cell(7, 7)

      layer.tryClaimCell(actor, c)

      const otherActor = createActor({ owner: playerAB })
      // canClaimCell is read-only
      layer.canClaimCell(otherActor, c)
      layer.canClaimCell(otherActor, c)
      layer.canClaimCell(otherActor, c)

      // State should be unchanged — the original claimer still has the claim
      expect(layer.tryClaimCell(otherActor, c)).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // removeClaim tests
  // ---------------------------------------------------------------------------

  describe('removeClaim', () => {
    it('releases a claim so another actor can claim the cell (TEST-10.17)', () => {
      const actor = createActor({ owner: playerA })
      const c = cell(10, 20)

      layer.tryClaimCell(actor, c)

      // Another same-player actor cannot claim
      const actor2 = createActor({ owner: playerA })
      expect(layer.tryClaimCell(actor2, c)).toBe(false)

      // Release the claim
      layer.removeClaim(actor)

      // Now the other actor can claim
      expect(layer.tryClaimCell(actor2, c)).toBe(true)
    })

    it('is safe to call when actor has no claim', () => {
      const actor = createActor({ owner: playerA })
      // Should not throw
      expect(() => layer.removeClaim(actor)).not.toThrow()
    })

    it('removes the actor from both claimByCell and claimByActor', () => {
      const actor = createActor({ owner: playerA })
      const c = cell(10, 20)

      layer.tryClaimCell(actor, c)
      layer.removeClaim(actor)

      // Actor should be able to re-claim the same cell
      expect(layer.tryClaimCell(actor, c)).toBe(true)
    })

    it('only removes one actor, not all actors on a cell', () => {
      const actorA = createActor({ owner: playerA })
      const actorC = createActor({ owner: playerC }) // enemy, can co-claim
      const c = cell(5, 5)

      layer.tryClaimCell(actorA, c)
      layer.tryClaimCell(actorC, c) // Different player, both can claim
      layer.removeClaim(actorA)

      // actorC still has the claim, but since playerC is NOT allied with playerA,
      // newActorA can claim
      const newActorA = createActor({ owner: playerA })
      expect(layer.tryClaimCell(newActorA, c)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases and combined scenarios
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('multiple enemy actors can claim the same cell', () => {
      const a = createActor({ owner: playerA })
      const c = createActor({ owner: playerC })
      const cell1 = cell(10, 10)

      expect(layer.tryClaimCell(a, cell1)).toBe(true)
      expect(layer.tryClaimCell(c, cell1)).toBe(true)
    })

    it('same actor claiming the same cell twice succeeds (friendly re-claim)', () => {
      const actor = createActor({ owner: playerA })
      const c = cell(10, 10)

      expect(layer.tryClaimCell(actor, c)).toBe(true)
      // Re-claiming the same cell by the same actor: the loop finds itself
      // and skips (c !== claimer && areAllied). Old claim is released,
      // then reclaimed fresh.
      expect(layer.tryClaimCell(actor, c)).toBe(true)
    })

    it('cells with non-zero layers are handled correctly', () => {
      const actor = createActor({ owner: playerA })
      const c0 = cell(5, 5, 0)
      const c1 = cell(5, 5, 1)

      expect(layer.tryClaimCell(actor, c0)).toBe(true)
      // Different layer → different cell key → should succeed
      const actor2 = createActor({ owner: playerA })
      expect(layer.tryClaimCell(actor2, c1)).toBe(true)
    })

    it('canClaimCell returns true for cell with only dead allied claimers', () => {
      const tempActor = createActor({ owner: playerA, isDead: false })
      const c = cell(5, 5)

      layer.tryClaimCell(tempActor, c)
      ;(tempActor as unknown as Record<string, unknown>).isDead = true

      // Now check canClaimCell for another actor of same player
      const newActor = createActor({ owner: playerA })
      // The dead tempActor is allied, but canClaimCell checks !c.isDead
      // So the dead actor is skipped, and result should be true
      expect(layer.canClaimCell(newActor, c)).toBe(true)
    })
  })
})
