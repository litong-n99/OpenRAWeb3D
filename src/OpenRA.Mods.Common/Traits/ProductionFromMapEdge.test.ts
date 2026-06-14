/**
 * ProductionFromMapEdge.test.ts — ProductionFromMapEdge migration unit tests
 *
 * Tests focus on:
 * - ProductionFromMapEdgeInfo defaults and inheritance
 * - ProductionFromMapEdge.produce returns true when enabled
 * - ProductionFromMapEdge.produce returns false when disabled/paused
 * - ProductionFromMapEdge.setSpawnLocation
 * - ProductionSpawnLocationInit stores value
 * - Edge cases: null spawn location
 */

import { describe, it, expect } from 'vitest'
import { ProductionFromMapEdge, ProductionFromMapEdgeInfo, ProductionSpawnLocationInit } from './ProductionFromMapEdge'
import { Production } from './Production'
import { CPos } from '../../OpenRA.Game/CPos'
import type { IGameActor, ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createActorInfo(name: string): ActorInfoStub {
  return { name }
}

function createActor(): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
  } as IGameActor
}

// ---------------------------------------------------------------------------
// ProductionFromMapEdgeInfo
// ---------------------------------------------------------------------------

describe('ProductionFromMapEdgeInfo', () => {
  it('inherits defaults from ProductionInfo', () => {
    const info = new ProductionFromMapEdgeInfo()
    expect(info.produces.size).toBe(0)
    expect(info.updateFactionOnOwnerChange).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ProductionFromMapEdge
// ---------------------------------------------------------------------------

describe('ProductionFromMapEdge', () => {
  it('is an instance of Production', () => {
    const p = new ProductionFromMapEdge(new ProductionFromMapEdgeInfo())
    expect(p).toBeInstanceOf(Production)
    expect(p).toBeInstanceOf(ProductionFromMapEdge)
  })

  it('produce returns true when enabled', () => {
    const p = new ProductionFromMapEdge(new ProductionFromMapEdgeInfo())
    const actor = createActor()
    const producee = createActorInfo('tank')
    const result = p.produce(actor, producee, 'Vehicle', new Map(), 100)
    expect(result).toBe(true)
  })

  it('produce returns false when disabled', () => {
    const p = new ProductionFromMapEdge(new ProductionFromMapEdgeInfo())
    p.isTraitDisabled = true
    const actor = createActor()
    const producee = createActorInfo('tank')
    const result = p.produce(actor, producee, 'Vehicle', new Map(), 100)
    expect(result).toBe(false)
  })

  it('produce returns false when paused', () => {
    const p = new ProductionFromMapEdge(new ProductionFromMapEdgeInfo())
    p.isTraitPaused = true
    const actor = createActor()
    const producee = createActorInfo('tank')
    const result = p.produce(actor, producee, 'Vehicle', new Map(), 100)
    expect(result).toBe(false)
  })

  it('setSpawnLocation stores the location', () => {
    const p = new ProductionFromMapEdge(new ProductionFromMapEdgeInfo())
    const loc = new CPos(10, 20, 0)
    p.setSpawnLocation(loc)
    // The value is stored; we can't directly read it back (private)
    // but we can verify the method doesn't throw
    expect(() => p.setSpawnLocation(null)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// ProductionSpawnLocationInit
// ---------------------------------------------------------------------------

describe('ProductionSpawnLocationInit', () => {
  it('stores the CPos value', () => {
    const loc = new CPos(10, 20, 0)
    const init = new ProductionSpawnLocationInit(loc)
    expect(init.value).toBe(loc)
  })
})
