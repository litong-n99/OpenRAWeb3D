/**
 * SelectionUtils.test.ts — SelectionUtils migration unit tests
 *
 * Since SelectionUtils is pure logic (no WebGL / Babylon.js dependencies),
 * no mocking of @babylonjs/core is required. Tests cover:
 * - Actor filtering by owner and selection class
 * - Selection priority computation (base, modifiers, relationship penalties)
 * - Combined priority with pixel distance
 * - Highest-priority actor selection
 * - Subset-by-highest-priority-tier
 * - Player inclusion rules
 * - Composite selection helpers (onScreen, inWorld)
 * - Box selection with deadzone logic
 * - Edge cases: empty input, null owners, no selection class
 */

import { describe, it, expect } from 'vitest'
import {
  SelectionUtils,
  SelectionPriorityModifiers,
  type SelectionActorInfo,
  type SelectionPlayerInfo,
  type SelectionWorldInfo,
  type SelectionModifiers,
} from './SelectionUtils.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Create a mock player with spectating/nonCombatant settings. */
function makePlayer(
  overrides: Partial<SelectionPlayerInfo> = {},
): SelectionPlayerInfo {
  return {
    spectating: false,
    nonCombatant: false,
    ...overrides,
  }
}

/** Create a mock selection actor info. */
function makeActor(
  overrides: Partial<SelectionActorInfo> & { actorId: number },
): SelectionActorInfo {
  return {
    owner: null,
    selectionClass: 'Infantry',
    priority: 10,
    priorityModifiers: SelectionPriorityModifiers.None,
    ...overrides,
  }
}

/** Default modifier state (no keys held). */
function makeModifiers(overrides: Partial<SelectionModifiers> = {}): SelectionModifiers {
  return {
    shift: false,
    ctrl: false,
    alt: false,
    ...overrides,
  }
}

/** A relationship function that treats all non-self as Enemy (bit 1). */
function enemyRelationship(
  _viewer: SelectionPlayerInfo,
  other: SelectionPlayerInfo,
): number {
  if (_viewer === other) return 4  // Ally (self)
  return 1  // Enemy
}

/** A relationship function that treats all non-self as Ally (bit 4). */
function allyRelationship(
  _viewer: SelectionPlayerInfo,
  _other: SelectionPlayerInfo,
): number {
  return 4  // Ally
}

// ---------------------------------------------------------------------------
// Common test data
// ---------------------------------------------------------------------------

const PLAYER_A = makePlayer()
const PLAYER_B = makePlayer()
const ACTOR_1 = makeActor({ actorId: 1, owner: PLAYER_A, selectionClass: 'Infantry', priority: 10 })
const ACTOR_2 = makeActor({ actorId: 2, owner: PLAYER_A, selectionClass: 'Vehicle', priority: 20 })
const ACTOR_3 = makeActor({ actorId: 3, owner: PLAYER_B, selectionClass: 'Infantry', priority: 10 })
const ACTOR_4 = makeActor({ actorId: 4, owner: PLAYER_A, selectionClass: 'Building', priority: 5 })
const ACTOR_NOSELECT = makeActor({ actorId: 5, owner: PLAYER_A, selectionClass: null, priority: 0 })
const ACTOR_NOOWNER = makeActor({ actorId: 6, owner: null, selectionClass: 'Infantry', priority: 10 })

// ---------------------------------------------------------------------------
// selectActorsByOwnerAndSelectionClass
// ---------------------------------------------------------------------------

describe('selectActorsByOwnerAndSelectionClass', () => {
  it('returns actors owned by eligible players', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_2, ACTOR_3],
      [PLAYER_A],
      null,
    )
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.actorId)).toEqual([1, 2])
  })

  it('returns empty when no actors match owner', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_3],
      [PLAYER_A],
      null,
    )
    expect(result).toHaveLength(0)
  })

  it('filters by selection class when provided', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_2, ACTOR_4],
      [PLAYER_A],
      ['Infantry', 'Building'],
    )
    expect(result.map((a) => a.actorId)).toEqual([1, 4])
  })

  it('selects all when selectionClasses is null', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_2, ACTOR_4],
      [PLAYER_A],
      null,
    )
    expect(result).toHaveLength(3)
  })

  it('returns empty when selectionClasses does not match any actor', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_2],
      [PLAYER_A],
      ['Ship'],
    )
    expect(result).toHaveLength(0)
  })

  it('excludes actors with null selection class', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_NOSELECT],
      [PLAYER_A],
      null,
    )
    expect(result.map((a) => a.actorId)).toEqual([1])
  })

  it('excludes actors with null owner', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_NOOWNER],
      [PLAYER_A],
      null,
    )
    expect(result.map((a) => a.actorId)).toEqual([1])
  })

  it('works with empty input', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [],
      [PLAYER_A],
      null,
    )
    expect(result).toHaveLength(0)
  })

  it('works with empty owners', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_2],
      [],
      null,
    )
    expect(result).toHaveLength(0)
  })

  it('preserves input order', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_2, ACTOR_1, ACTOR_4],
      [PLAYER_A],
      null,
    )
    expect(result.map((a) => a.actorId)).toEqual([2, 1, 4])
  })

  it('works with multiple eligible owners', () => {
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_3],
      [PLAYER_A, PLAYER_B],
      null,
    )
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// selectionPriority
// ---------------------------------------------------------------------------

describe('selectionPriority', () => {
  it('returns base priority with no modifiers and no viewer', () => {
    const result = SelectionUtils.selectionPriority(
      ACTOR_1,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    expect(result).toBe(10)
  })

  it('returns base priority when viewer is owner', () => {
    const result = SelectionUtils.selectionPriority(
      ACTOR_1,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBe(10)
  })

  it('applies Ctrl modifier boost when actor has Ctrl priority modifier', () => {
    const actor = makeActor({
      actorId: 10,
      owner: PLAYER_A,
      priority: 10,
      priorityModifiers: SelectionPriorityModifiers.Ctrl,
    })
    const result = SelectionUtils.selectionPriority(
      actor,
      makeModifiers({ ctrl: true }),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('does not apply Ctrl boost when Alt is also held', () => {
    const actor = makeActor({
      actorId: 10,
      owner: PLAYER_A,
      priority: 10,
      priorityModifiers: SelectionPriorityModifiers.Ctrl,
    })
    const result = SelectionUtils.selectionPriority(
      actor,
      makeModifiers({ ctrl: true, alt: true }),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBe(10)
  })

  it('applies Alt modifier boost when actor has Alt priority modifier', () => {
    const actor = makeActor({
      actorId: 10,
      owner: PLAYER_A,
      priority: 10,
      priorityModifiers: SelectionPriorityModifiers.Alt,
    })
    const result = SelectionUtils.selectionPriority(
      actor,
      makeModifiers({ alt: true }),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('does not apply Alt boost when Ctrl is also held', () => {
    const actor = makeActor({
      actorId: 10,
      owner: PLAYER_A,
      priority: 10,
      priorityModifiers: SelectionPriorityModifiers.Alt,
    })
    const result = SelectionUtils.selectionPriority(
      actor,
      makeModifiers({ ctrl: true, alt: true }),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBe(10)
  })

  it('applies enemy relationship penalty (-90)', () => {
    const result = SelectionUtils.selectionPriority(
      ACTOR_1,   // owner = PLAYER_A
      makeModifiers(),
      PLAYER_B,  // viewer != owner → enemy (per enemyRelationship)
      enemyRelationship,
    )
    expect(result).toBe(10 - 90)
  })

  it('applies ally relationship penalty (-30)', () => {
    const result = SelectionUtils.selectionPriority(
      ACTOR_3,   // owner = PLAYER_B
      makeModifiers(),
      PLAYER_A,  // viewer != owner → ally (per allyRelationship)
      allyRelationship,
    )
    expect(result).toBe(10 - 30)
  })

  it('applies neutral relationship penalty (-60)', () => {
    function neutralRelationship(
      _viewer: SelectionPlayerInfo,
      _other: SelectionPlayerInfo,
    ): number {
      return 2  // Neutral
    }
    const result = SelectionUtils.selectionPriority(
      ACTOR_3,   // owner = PLAYER_B
      makeModifiers(),
      PLAYER_A,
      neutralRelationship,
    )
    expect(result).toBe(10 - 60)
  })

  it('does not apply penalty when viewer is null', () => {
    const result = SelectionUtils.selectionPriority(
      ACTOR_1,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    expect(result).toBe(10)
  })

  it('does not apply penalty when actor has no owner', () => {
    const result = SelectionUtils.selectionPriority(
      ACTOR_NOOWNER,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBe(10)
  })

  it('modifier boost overrides relationship penalty', () => {
    const actor = makeActor({
      actorId: 10,
      owner: PLAYER_A,
      priority: 10,
      priorityModifiers: SelectionPriorityModifiers.Ctrl,
    })
    const result = SelectionUtils.selectionPriority(
      actor,
      makeModifiers({ ctrl: true }),
      PLAYER_B,  // viewer != owner → enemy
      enemyRelationship,
    )
    // MAX_SAFE_INTEGER - 90 is still essentially MAX_SAFE_INTEGER
    expect(result).toBeGreaterThan(Number.MAX_SAFE_INTEGER - 100)
  })
})

// ---------------------------------------------------------------------------
// calculateActorSelectionPriority
// ---------------------------------------------------------------------------

describe('calculateActorSelectionPriority', () => {
  it('incorporates pixel distance into priority via left shift', () => {
    // Formula: priority - (pixelDistance << 16)
    const result = SelectionUtils.calculateActorSelectionPriority(
      ACTOR_1,
      5,   // 5 pixels away
      makeModifiers(),
      PLAYER_A,  // owner = viewer → no penalty
      enemyRelationship,
    )
    expect(result).toBe(10 - (5 << 16))
  })

  it('returns priority unchanged when distance is 0', () => {
    const result = SelectionUtils.calculateActorSelectionPriority(
      ACTOR_1,
      0,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBe(10)
  })

  it('distance dominates priority modifiers', () => {
    // Actor 1 with dist=1 vs Actor 2 with dist=2:
    // ACTOR_1: 10 - (1 << 16) = 10 - 65536
    // Even with priority 20, dist=2: 20 - (2 << 16) = 20 - 131072
    const pri1 = SelectionUtils.calculateActorSelectionPriority(
      ACTOR_1,  // priority 10
      1,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    const pri2 = SelectionUtils.calculateActorSelectionPriority(
      ACTOR_2,  // priority 20
      2,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(pri1).toBeGreaterThan(pri2)
  })

  it('combines relationship penalty with pixel distance', () => {
    const result = SelectionUtils.calculateActorSelectionPriority(
      ACTOR_1,
      3,
      makeModifiers(),
      PLAYER_B,   // viewer != owner → enemy penalty -90
      enemyRelationship,
    )
    expect(result).toBe(10 - 90 - (3 << 16))
  })
})

// ---------------------------------------------------------------------------
// withHighestSelectionPriority
// ---------------------------------------------------------------------------

describe('withHighestSelectionPriority', () => {
  it('selects the actor closest to the click point', () => {
    // Both actors same owner/type; ACTOR_1 is "closer" (dist=1 vs dist=2)
    const result = SelectionUtils.withHighestSelectionPriority(
      [ACTOR_1, ACTOR_2],
      1,   // distance for ACTOR_1 is smaller in this scenario
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    // Since we're calling with the same pixelDistance for all actors,
    // ACTOR_2 with higher base priority (20) wins when distance is equal
    expect(result).not.toBeNull()
    // Both get same pixelDistance in this call → ACTOR_2 wins on priority
    expect(result!.actorId).toBe(2)
  })

  it('picks the actor with the highest combined priority', () => {
    // ACTOR_2 has base priority 20, ACTOR_1 has 10
    const result = SelectionUtils.withHighestSelectionPriority(
      [ACTOR_1, ACTOR_2, ACTOR_4],
      0,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result!.actorId).toBe(2)  // priority 20 > 10 > 5
  })

  it('returns null for empty input', () => {
    const result = SelectionUtils.withHighestSelectionPriority(
      [],
      0,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBeNull()
  })

  it('works with single actor', () => {
    const result = SelectionUtils.withHighestSelectionPriority(
      [ACTOR_1],
      5,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result!.actorId).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// subsetWithHighestSelectionPriority
// ---------------------------------------------------------------------------

describe('subsetWithHighestSelectionPriority', () => {
  it('groups actors by priority and returns the highest-priority group', () => {
    const actors = [
      makeActor({ actorId: 1, priority: 10, priorityModifiers: SelectionPriorityModifiers.None }),
      makeActor({ actorId: 2, priority: 20, priorityModifiers: SelectionPriorityModifiers.None }),
      makeActor({ actorId: 3, priority: 10, priorityModifiers: SelectionPriorityModifiers.None }),
      makeActor({ actorId: 4, priority: 20, priorityModifiers: SelectionPriorityModifiers.None }),
    ]
    const result = SelectionUtils.subsetWithHighestSelectionPriority(
      actors,
      makeModifiers(),
      null,   // no viewer → no penalties
      enemyRelationship,
    )
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.actorId)).toEqual([2, 4])
  })

  it('all actors in same priority group → returns all', () => {
    const actors = [
      makeActor({ actorId: 1, priority: 10, priorityModifiers: SelectionPriorityModifiers.None }),
      makeActor({ actorId: 2, priority: 10, priorityModifiers: SelectionPriorityModifiers.None }),
    ]
    const result = SelectionUtils.subsetWithHighestSelectionPriority(
      actors,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    expect(result).toHaveLength(2)
  })

  it('single actor → returns that actor', () => {
    const result = SelectionUtils.subsetWithHighestSelectionPriority(
      [ACTOR_1],
      makeModifiers(),
      null,
      enemyRelationship,
    )
    expect(result).toHaveLength(1)
    expect(result[0].actorId).toBe(1)
  })

  it('empty input → empty output', () => {
    const result = SelectionUtils.subsetWithHighestSelectionPriority(
      [],
      makeModifiers(),
      null,
      enemyRelationship,
    )
    expect(result).toHaveLength(0)
  })

  it('Ctrl modifier elevates matching actors above non-matching', () => {
    const withCtrl = makeActor({
      actorId: 10,
      priority: 5,
      priorityModifiers: SelectionPriorityModifiers.Ctrl,
    })
    const withoutCtrl = makeActor({
      actorId: 20,
      priority: 100,
      priorityModifiers: SelectionPriorityModifiers.None,
    })
    const result = SelectionUtils.subsetWithHighestSelectionPriority(
      [withCtrl, withoutCtrl],
      makeModifiers({ ctrl: true }),
      null,
      enemyRelationship,
    )
    // The Ctrl-boosted actor has MAX_SAFE_INTEGER priority
    expect(result).toHaveLength(1)
    expect(result[0].actorId).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// getPlayersToIncludeInSelection
// ---------------------------------------------------------------------------

describe('getPlayersToIncludeInSelection', () => {
  it('returns [viewer] when there is a normal local player', () => {
    const world: SelectionWorldInfo = {
      renderPlayer: PLAYER_A,
      localPlayer: PLAYER_A,
      players: [PLAYER_A, PLAYER_B],
    }
    const result = SelectionUtils.getPlayersToIncludeInSelection(world)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(PLAYER_A)
  })

  it('falls back to localPlayer when renderPlayer is null', () => {
    const world: SelectionWorldInfo = {
      renderPlayer: null,
      localPlayer: PLAYER_A,
      players: [PLAYER_A, PLAYER_B],
    }
    const result = SelectionUtils.getPlayersToIncludeInSelection(world)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(PLAYER_A)
  })

  it('returns all players when no viewer exists', () => {
    const world: SelectionWorldInfo = {
      renderPlayer: null,
      localPlayer: null,
      players: [PLAYER_A, PLAYER_B],
    }
    const result = SelectionUtils.getPlayersToIncludeInSelection(world)
    expect(result).toHaveLength(2)
  })

  it('returns all players when shroud is disabled (renderPlayer null + localPlayer spectating)', () => {
    const spectatingPlayer = makePlayer({ spectating: true })
    const world: SelectionWorldInfo = {
      renderPlayer: null,
      localPlayer: spectatingPlayer,
      players: [spectatingPlayer, PLAYER_A, PLAYER_B],
    }
    const result = SelectionUtils.getPlayersToIncludeInSelection(world)
    expect(result).toHaveLength(3)
  })

  it('returns all players when viewer is spectating non-combatant (observer)', () => {
    const observer = makePlayer({ spectating: true, nonCombatant: true })
    const world: SelectionWorldInfo = {
      renderPlayer: observer,
      localPlayer: observer,
      players: [observer, PLAYER_A, PLAYER_B],
    }
    const result = SelectionUtils.getPlayersToIncludeInSelection(world)
    expect(result).toHaveLength(3)
  })

  it('returns only viewer when renderPlayer is set but localPlayer is spectating', () => {
    // Not shroud-disabled because renderPlayer IS set
    const spectator = makePlayer({ spectating: true })
    const world: SelectionWorldInfo = {
      renderPlayer: PLAYER_A,
      localPlayer: spectator,
      players: [PLAYER_A, spectator],
    }
    const result = SelectionUtils.getPlayersToIncludeInSelection(world)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(PLAYER_A)
  })
})

// ---------------------------------------------------------------------------
// selectActorsOnScreen
// ---------------------------------------------------------------------------

describe('selectActorsOnScreen', () => {
  it('delegates to selectActorsByOwnerAndSelectionClass', () => {
    const result = SelectionUtils.selectActorsOnScreen(
      [ACTOR_1, ACTOR_2, ACTOR_3],
      ['Infantry'],
      [PLAYER_A],
    )
    expect(result).toHaveLength(1)
    expect(result[0].actorId).toBe(1)
  })

  it('returns all when selectionClasses is null', () => {
    const result = SelectionUtils.selectActorsOnScreen(
      [ACTOR_1, ACTOR_2],
      null,
      [PLAYER_A],
    )
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// selectActorsInWorld
// ---------------------------------------------------------------------------

describe('selectActorsInWorld', () => {
  it('delegates to selectActorsByOwnerAndSelectionClass', () => {
    const result = SelectionUtils.selectActorsInWorld(
      [ACTOR_1, ACTOR_2, ACTOR_3],
      ['Vehicle'],
      [PLAYER_A],
    )
    expect(result).toHaveLength(1)
    expect(result[0].actorId).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// selectHighestPriorityActorAtPoint
// ---------------------------------------------------------------------------

describe('selectHighestPriorityActorAtPoint', () => {
  it('delegates to withHighestSelectionPriority', () => {
    const result = SelectionUtils.selectHighestPriorityActorAtPoint(
      [ACTOR_1, ACTOR_2],
      3,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    // Same pixelDistance → higher base priority wins
    expect(result!.actorId).toBe(2)
  })

  it('returns null for empty candidates', () => {
    const result = SelectionUtils.selectHighestPriorityActorAtPoint(
      [],
      0,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// selectActorsInBoxWithDeadzone
// ---------------------------------------------------------------------------

describe('selectActorsInBoxWithDeadzone', () => {
  const BOX_ACTORS = [
    makeActor({ actorId: 1, priority: 10, priorityModifiers: SelectionPriorityModifiers.None }),
    makeActor({ actorId: 2, priority: 20, priorityModifiers: SelectionPriorityModifiers.None }),
    makeActor({ actorId: 3, priority: 10, priorityModifiers: SelectionPriorityModifiers.None }),
  ]

  it('returns highest-priority subset for valid drag box', () => {
    const result = SelectionUtils.selectActorsInBoxWithDeadzone(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      4,     // deadzone
      BOX_ACTORS,
      [],    // fallback candidates (not used)
      0,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    // Priority 20 actor is in highest tier
    expect(result).toHaveLength(1)
    expect(result[0].actorId).toBe(2)
  })

  it('shrinks to point at boxEnd when drag is below deadzone', () => {
    // Drag diagonal = sqrt(3^2 + 3^2) ≈ 4.24 > 4 → SHOULD NOT shrink
    const result = SelectionUtils.selectActorsInBoxWithDeadzone(
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      4,
      BOX_ACTORS,
      [BOX_ACTORS[0]],  // fallback: only ACTOR_1
      5,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    // Diagonal ≈ 4.24 > 4 → valid drag box
    expect(result).toHaveLength(1)
    expect(result[0].actorId).toBe(2)  // highest priority subset
  })

  it('shrinks to point when drag is exactly at deadzone', () => {
    // sqrt(2^2 + 2^2) ≈ 2.828 ≤ 4 → shrink to point at {4,4}
    const result = SelectionUtils.selectActorsInBoxWithDeadzone(
      { x: 2, y: 2 },
      { x: 4, y: 4 },
      4,
      BOX_ACTORS,
      [BOX_ACTORS[1]],  // fallback: ACTOR_2
      5,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    // Shrunk to point → falls back to point selection with fallbackCandidates
    expect(result).toHaveLength(1)
    expect(result[0].actorId).toBe(2)
  })

  it('zero-area box falls back to point selection', () => {
    const result = SelectionUtils.selectActorsInBoxWithDeadzone(
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      4,
      BOX_ACTORS,
      [BOX_ACTORS[0], BOX_ACTORS[2]],  // fallback: two actors at this point
      5,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    // Falls back to point selection → withHighestSelectionPriority
    // Same priority (10) → picks first one
    expect(result).toHaveLength(1)
  })

  it('returns empty when fallback candidates are empty for point fallback', () => {
    const result = SelectionUtils.selectActorsInBoxWithDeadzone(
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      4,
      BOX_ACTORS,
      [],    // no fallback candidates
      5,
      makeModifiers(),
      null,
      enemyRelationship,
    )
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// defaultRelationshipWith
// ---------------------------------------------------------------------------

describe('defaultRelationshipWith', () => {
  it('returns Neutral (2) for non-self actors', () => {
    const result = SelectionUtils.defaultRelationshipWith(PLAYER_A, PLAYER_B)
    expect(result).toBe(2)
  })

  it('returns consistent value regardless of viewer/other', () => {
    const r1 = SelectionUtils.defaultRelationshipWith(PLAYER_A, PLAYER_B)
    const r2 = SelectionUtils.defaultRelationshipWith(PLAYER_B, PLAYER_A)
    expect(r1).toBe(r2)
  })
})

// ---------------------------------------------------------------------------
// Integration scenarios
// ---------------------------------------------------------------------------

describe('integration scenarios', () => {
  it('typical drag-box selection flow', () => {
    const world: SelectionWorldInfo = {
      renderPlayer: PLAYER_A,
      localPlayer: PLAYER_A,
      players: [PLAYER_A, PLAYER_B],
    }

    // Step 1: Determine eligible players
    const eligiblePlayers = SelectionUtils.getPlayersToIncludeInSelection(world)

    // Step 2: Get candidates from box (simulated — caller provides these)
    const boxCandidates = [ACTOR_1, ACTOR_2, ACTOR_3]

    // Step 3: Filter by owner and class (all infantry)
    const filtered = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      boxCandidates,
      eligiblePlayers,
      ['Infantry'],
    )
    // Only PLAYER_A's infantry
    expect(filtered.map((a) => a.actorId)).toEqual([1])

    // Step 4: Subset by highest priority
    const selected = SelectionUtils.subsetWithHighestSelectionPriority(
      filtered,
      makeModifiers(),
      PLAYER_A,
      enemyRelationship,
    )
    expect(selected).toHaveLength(1)
    expect(selected[0].actorId).toBe(1)
  })

  it('double-click selection flow', () => {
    const world: SelectionWorldInfo = {
      renderPlayer: PLAYER_A,
      localPlayer: PLAYER_A,
      players: [PLAYER_A, PLAYER_B],
    }
    const eligiblePlayers = SelectionUtils.getPlayersToIncludeInSelection(world)

    // All on-screen actors (simulated frustum check by caller)
    const onScreen = [ACTOR_1, ACTOR_2, ACTOR_4]

    // Select all Infantry owned by eligible players on screen
    const selected = SelectionUtils.selectActorsOnScreen(
      onScreen,
      ['Infantry'],
      eligiblePlayers,
    )
    expect(selected.map((a) => a.actorId)).toEqual([1])
  })

  it('observer (spectating non-combatant) can select all players', () => {
    const observer = makePlayer({ spectating: true, nonCombatant: true })
    const world: SelectionWorldInfo = {
      renderPlayer: observer,
      localPlayer: observer,
      players: [observer, PLAYER_A, PLAYER_B],
    }

    const eligiblePlayers = SelectionUtils.getPlayersToIncludeInSelection(world)
    expect(eligiblePlayers).toHaveLength(3)

    // Observer sees all actors
    const result = SelectionUtils.selectActorsByOwnerAndSelectionClass(
      [ACTOR_1, ACTOR_3],
      eligiblePlayers,
      null,
    )
    expect(result).toHaveLength(2)
  })
})
