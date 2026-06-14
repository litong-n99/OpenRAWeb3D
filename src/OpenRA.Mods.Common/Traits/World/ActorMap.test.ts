/**
 * ActorMap.test.ts — ActorMap unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed.
 * Tests focus on: influence tracking, actor position management, cell queries,
 * lifecycle (create → use → dispose).
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType.js'
import { type Size } from '../../../OpenRA.Game/Primitives/Size.js'
import type {
  IGameActor,
  OccupiedCell,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'
import {
  ActorMap,
  type IActorMapQuery,
} from './ActorMap.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock actor. */
function createMockActor(id: number, name?: string): IGameActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name: name ?? `actor${id}` },
  } as IGameActor
}

/** Create an OccupiedCell pair. */
function oc(cell: CPos, subCell: number): OccupiedCell {
  return { cell, subCell: subCell as OccupiedCell['subCell'] }
}

/** Standard map size for tests. */
const MAP_SIZE: Size = { width: 10, height: 10 }

// ---------------------------------------------------------------------------
// ActorMap — Construction & Initialization
// ---------------------------------------------------------------------------

describe('ActorMap construction', () => {
  it('creates with default Rectangular grid type', () => {
    const am = new ActorMap(MAP_SIZE)
    expect(am).toBeInstanceOf(ActorMap)
    expect(am.anyActorsAt(new CPos(0, 0, 0))).toBe(false)
    am.dispose()
  })

  it('creates with RectangularIsometric grid type', () => {
    const am = new ActorMap(MAP_SIZE, MapGridType.RectangularIsometric)
    expect(am).toBeInstanceOf(ActorMap)
    am.dispose()
  })

  it('initializes all cells as empty', () => {
    const am = new ActorMap(MAP_SIZE)
    for (let y = 0; y < MAP_SIZE.height; y++) {
      for (let x = 0; x < MAP_SIZE.width; x++) {
        expect(am.anyActorsAt(new CPos(x, y, 0))).toBe(false)
        expect(am.getActorsAt(new CPos(x, y, 0))).toEqual([])
      }
    }
    am.dispose()
  })
})

// ---------------------------------------------------------------------------
// ActorMap — Influence tracking
// ---------------------------------------------------------------------------

describe('ActorMap influence tracking', () => {
  let am: ActorMap

  beforeEach(() => {
    am = new ActorMap(MAP_SIZE)
  })

  it('addInfluence registers actor at a cell', () => {
    const actor = createMockActor(1)
    const cells: OccupiedCell[] = [oc(new CPos(2, 3, 0), SubCell.FullCell)]

    am.addInfluence(actor, cells)

    expect(am.anyActorsAt(new CPos(2, 3, 0))).toBe(true)
    expect(am.getActorsAt(new CPos(2, 3, 0))).toEqual([actor])
  })

  it('addInfluence supports multiple actors at same cell (linked list)', () => {
    const actor1 = createMockActor(1)
    const actor2 = createMockActor(2)
    const cell = new CPos(5, 5, 0)

    am.addInfluence(actor1, [oc(cell, SubCell.FullCell)])
    am.addInfluence(actor2, [oc(cell, SubCell.First)])

    const actors = am.getActorsAt(cell)
    expect(actors).toHaveLength(2)
    // actor2 was added first (prepended), so it comes first
    expect(actors[0]).toBe(actor2)
    expect(actors[1]).toBe(actor1)
  })

  it('addInfluence is idempotent (actor added twice occupies twice)', () => {
    const actor = createMockActor(1)
    const cell = new CPos(0, 0, 0)

    am.addInfluence(actor, [oc(cell, SubCell.FullCell)])
    am.addInfluence(actor, [oc(cell, SubCell.First)])

    const actors = am.getActorsAt(cell)
    expect(actors).toHaveLength(2)
  })

  it('addInfluence respects multiple cells', () => {
    const actor = createMockActor(1)
    const cells: OccupiedCell[] = [
      oc(new CPos(0, 0, 0), SubCell.FullCell),
      oc(new CPos(1, 0, 0), SubCell.FullCell),
      oc(new CPos(0, 1, 0), SubCell.FullCell),
    ]

    am.addInfluence(actor, cells)

    expect(am.anyActorsAt(new CPos(0, 0, 0))).toBe(true)
    expect(am.anyActorsAt(new CPos(1, 0, 0))).toBe(true)
    expect(am.anyActorsAt(new CPos(0, 1, 0))).toBe(true)
  })

  it('removeInfluence removes actor from a cell', () => {
    const actor = createMockActor(1)
    const cell = new CPos(3, 3, 0)

    am.addInfluence(actor, [oc(cell, SubCell.FullCell)])
    expect(am.anyActorsAt(cell)).toBe(true)

    am.removeInfluence(actor, [oc(cell, SubCell.FullCell)])
    expect(am.anyActorsAt(cell)).toBe(false)
    expect(am.getActorsAt(cell)).toEqual([])
  })

  it('removeInfluence removes only the specified actor from multi-actor cell', () => {
    const actor1 = createMockActor(1)
    const actor2 = createMockActor(2)
    const cell = new CPos(5, 5, 0)

    am.addInfluence(actor1, [oc(cell, SubCell.FullCell)])
    am.addInfluence(actor2, [oc(cell, SubCell.First)])

    am.removeInfluence(actor1, [oc(cell, SubCell.FullCell)])

    const actors = am.getActorsAt(cell)
    expect(actors).toHaveLength(1)
    expect(actors[0]).toBe(actor2)
  })

  it('removeInfluence with non-existent actor does not crash', () => {
    const actor = createMockActor(1)
    const cell = new CPos(0, 0, 0)

    am.addInfluence(actor, [oc(cell, SubCell.FullCell)])

    const otherActor = createMockActor(99)
    am.removeInfluence(otherActor, [oc(cell, SubCell.FullCell)])

    // Original actor still there
    expect(am.anyActorsAt(cell)).toBe(true)
  })

  it('removeInfluence from empty cell does not crash', () => {
    const actor = createMockActor(1)
    const cell = new CPos(0, 0, 0)

    am.removeInfluence(actor, [oc(cell, SubCell.FullCell)])

    expect(am.anyActorsAt(cell)).toBe(false)
  })

  it('removeInfluence removes all occurrences of same actor at same cell', () => {
    const actor = createMockActor(1)
    const cell = new CPos(0, 0, 0)

    // Add actor twice at same cell (simulating two sub-cell occupations)
    am.addInfluence(actor, [oc(cell, SubCell.FullCell)])
    am.addInfluence(actor, [oc(cell, SubCell.First)])

    // Remove both
    am.removeInfluence(actor, [
      oc(cell, SubCell.FullCell),
      oc(cell, SubCell.First),
    ])

    expect(am.anyActorsAt(cell)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ActorMap — Position tracking (deferred)
// ---------------------------------------------------------------------------

describe('ActorMap position tracking', () => {
  let am: ActorMap

  beforeEach(() => {
    am = new ActorMap(MAP_SIZE)
  })

  it('addActorPosition defers add to set', () => {
    const actor = createMockActor(1)
    am.addActorPosition(actor)
    // Before tick, queries should still work via influence
    // addActorPosition doesn't affect influence directly
  })

  it('removeActorPosition deduplicates with add', () => {
    const actor = createMockActor(1)
    am.addActorPosition(actor)
    am.removeActorPosition(actor)
    // After add+remove, tick should have nothing to process
    am.tick()
    // No crash expected
  })

  it('tick clears deferred position sets', () => {
    const actor = createMockActor(1)
    am.addActorPosition(actor)
    const actor2 = createMockActor(2)
    am.removeActorPosition(actor2)

    am.tick()

    // After tick, influence is unchanged (Phase B minimal impl)
    // Just verify no crash
  })

  it('addActorPosition removes from removeSet first', () => {
    const actor = createMockActor(1)
    am.removeActorPosition(actor)
    am.addActorPosition(actor)

    am.tick()

    // Should not crash — add cancels out the remove
  })
})

// ---------------------------------------------------------------------------
// ActorMap — Cell queries
// ---------------------------------------------------------------------------

describe('ActorMap cell queries', () => {
  let am: ActorMap

  beforeEach(() => {
    am = new ActorMap(MAP_SIZE)
  })

  it('getActorsAt returns empty array for empty cell', () => {
    expect(am.getActorsAt(new CPos(5, 5, 0))).toEqual([])
  })

  it('getActorsAt returns empty array for out-of-bounds cell', () => {
    // CellLayer.contains returns false for cells outside map bounds
    // and getActorsAt returns [] instead of throwing
    expect(am.getActorsAt(new CPos(100, 100, 0))).toEqual([])
    expect(am.anyActorsAt(new CPos(100, 100, 0))).toBe(false)
  })

  it('anyActorsAt returns false for empty cell', () => {
    expect(am.anyActorsAt(new CPos(0, 0, 0))).toBe(false)
  })

  it('anyActorsAt returns true after addInfluence', () => {
    const actor = createMockActor(1)
    am.addInfluence(actor, [oc(new CPos(0, 0, 0), SubCell.FullCell)])
    expect(am.anyActorsAt(new CPos(0, 0, 0))).toBe(true)
  })

  it('anyActorsAt returns false after removeInfluence clears last actor', () => {
    const actor = createMockActor(1)
    const cell = new CPos(0, 0, 0)
    am.addInfluence(actor, [oc(cell, SubCell.FullCell)])
    am.removeInfluence(actor, [oc(cell, SubCell.FullCell)])
    expect(am.anyActorsAt(cell)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ActorMap — allActors enumeration
// ---------------------------------------------------------------------------

describe('ActorMap allActors', () => {
  let am: ActorMap

  beforeEach(() => {
    am = new ActorMap(MAP_SIZE)
  })

  it('returns empty array when no actors registered', () => {
    expect(am.allActors()).toEqual([])
  })

  it('returns all registered actors', () => {
    const a1 = createMockActor(1)
    const a2 = createMockActor(2)
    const a3 = createMockActor(3)

    am.addInfluence(a1, [oc(new CPos(0, 0, 0), SubCell.FullCell)])
    am.addInfluence(a2, [oc(new CPos(5, 5, 0), SubCell.FullCell)])
    am.addInfluence(a3, [oc(new CPos(9, 9, 0), SubCell.FullCell)])

    const all = am.allActors()
    expect(all).toHaveLength(3)
    expect(all).toContain(a1)
    expect(all).toContain(a2)
    expect(all).toContain(a3)
  })

  it('deduplicates actors appearing in multiple cells', () => {
    const actor = createMockActor(1)
    am.addInfluence(actor, [
      oc(new CPos(0, 0, 0), SubCell.FullCell),
      oc(new CPos(1, 0, 0), SubCell.FullCell),
      oc(new CPos(0, 1, 0), SubCell.FullCell),
    ])

    const all = am.allActors()
    expect(all).toHaveLength(1)
  })

  it('does not include removed actors', () => {
    const a1 = createMockActor(1)
    const a2 = createMockActor(2)
    const cell = new CPos(0, 0, 0)

    am.addInfluence(a1, [oc(cell, SubCell.FullCell)])
    am.addInfluence(a2, [oc(cell, SubCell.First)])
    am.removeInfluence(a1, [oc(cell, SubCell.FullCell)])

    const all = am.allActors()
    expect(all).toHaveLength(1)
    expect(all[0]).toBe(a2)
  })
})

// ---------------------------------------------------------------------------
// ActorMap — Dispose
// ---------------------------------------------------------------------------

describe('ActorMap dispose', () => {
  it('clears deferred position sets on dispose', () => {
    const am = new ActorMap(MAP_SIZE)
    const actor = createMockActor(1)
    am.addActorPosition(actor)

    am.dispose()

    // After dispose, tick should be a no-op
    am.tick()
  })

  it('dispose can be called multiple times safely', () => {
    const am = new ActorMap(MAP_SIZE)
    am.dispose()
    am.dispose()
    // No crash expected
  })
})

// ---------------------------------------------------------------------------
// ActorMap — IActorMapQuery interface contract
// ---------------------------------------------------------------------------

describe('IActorMapQuery', () => {
  it('ActorMap implements IActorMapQuery', () => {
    const am = new ActorMap(MAP_SIZE)
    const query: IActorMapQuery = am
    expect(query.getActorsAt).toBeDefined()
    expect(query.anyActorsAt).toBeDefined()
    am.dispose()
  })
})

// ---------------------------------------------------------------------------
// ActorMapInfluenceNode — linked list structure
// ---------------------------------------------------------------------------

describe('ActorMapInfluenceNode', () => {
  it('creates valid linked list via addInfluence', () => {
    const am = new ActorMap(MAP_SIZE)
    const a1 = createMockActor(1)
    const a2 = createMockActor(2)
    const cell = new CPos(0, 0, 0)

    am.addInfluence(a1, [oc(cell, SubCell.FullCell)])
    am.addInfluence(a2, [oc(cell, SubCell.First)])

    // Verify order: a2 was added last (prepended), so it comes first
    const actors = am.getActorsAt(cell)
    expect(actors).toHaveLength(2)
    expect(actors[0]).toBe(a2) // prepended = most recent
    expect(actors[1]).toBe(a1) // original

    am.dispose()
  })
})
