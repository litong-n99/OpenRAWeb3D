/**
 * WithBuildingBib.test.ts — Unit tests
 *
 * Tests focus on: bib cell generation, terrain-specific sequence, lifecycle.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithBuildingBib,
  WithBuildingBibInfo,
  type IBibRenderSprites,
  type IBibBuildingInfo,
  type IBibMap,
  type CellCoord,
} from './WithBuildingBib.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

function makeRenderSprites(): IBibRenderSprites & { addCalls: unknown[][]; removeCalls: unknown[] } {
  const addCalls: unknown[][] = []
  const removeCalls: unknown[] = []
  return {
    getImage: vi.fn().mockReturnValue('building'),
    add(awo: unknown, palette?: string | null) {
      addCalls.push([awo, palette])
    },
    remove(awo: unknown) {
      removeCalls.push(awo)
    },
    addCalls,
    removeCalls,
  }
}

function makeBuildingInfo(dimX: number, dimY: number): IBibBuildingInfo {
  return {
    dimensions: { x: dimX, y: dimY },
    centerOffset: () => ({ x: 0, y: 0, z: 0 }),
  }
}

function makeMap(): IBibMap {
  return {
    tiles: { cellBounds: { width: 100, height: 100 } },
    contains: () => true,
    centerOfCell: () => ({ x: 0, y: 0, z: 0 }),
    getTerrainInfo: () => ({ type: 'Clear' }),
  }
}

function makeActor(rs: IBibRenderSprites, bi: IBibBuildingInfo): IGameActor {
  return {
    trait(name: string): unknown {
      if (name === 'RenderSprites') return rs
      return null
    },
    info: {
      traitInfo(name: string): unknown {
        if (name === 'Building') return bi
        return null
      },
    },
    location: { x: 10, y: 10 } as CellCoord,
    world: { map: makeMap() },
  } as unknown as IGameActor
}

describe('WithBuildingBibInfo', () => {
  it('should have default values', () => {
    const info = new WithBuildingBibInfo()
    expect(info.sequence).toBe('bib')
    expect(info.palette).toBe('terrain')
    expect(info.hasMinibib).toBe(false)
  })

  it('should accept custom values', () => {
    const info = new WithBuildingBibInfo({
      sequence: 'custom-bib',
      palette: 'player',
      hasMinibib: true,
    })
    expect(info.sequence).toBe('custom-bib')
    expect(info.palette).toBe('player')
    expect(info.hasMinibib).toBe(true)
  })
})

describe('WithBuildingBib', () => {
  it('should not crash if map is unavailable', () => {
    const rs = makeRenderSprites()
    const bi = makeBuildingInfo(2, 3)
    const actor = makeActor(rs, bi)
    ;(actor as any).world = {}
    const info = new WithBuildingBibInfo()
    const bib = new WithBuildingBib(actor, info)

    expect(() => bib.addedToWorld(actor)).not.toThrow()
  })

  it('should generate bib cells on addedToWorld (2 rows, 2 width = 4 bibs)', () => {
    const rs = makeRenderSprites()
    const bi = makeBuildingInfo(2, 3) // 2 wide, 3 tall => 2 rows * 2 cols = 4 bibs
    const actor = makeActor(rs, bi)
    const info = new WithBuildingBibInfo({ hasMinibib: false })
    const bib = new WithBuildingBib(actor, info)

    bib.addedToWorld(actor)
    // rows = 2, width = 2 => 4 bib animations
    expect(bib.animCount).toBe(4)
  })

  it('should generate minibib cells (1 row)', () => {
    const rs = makeRenderSprites()
    const bi = makeBuildingInfo(3, 3)
    const actor = makeActor(rs, bi)
    const info = new WithBuildingBibInfo({ hasMinibib: true })
    const bib = new WithBuildingBib(actor, info)

    bib.addedToWorld(actor)
    // rows = 1, width = 3 => 3 bib animations
    expect(bib.animCount).toBe(3)
  })

  it('should clear animations on removedFromWorld', () => {
    const rs = makeRenderSprites()
    const bi = makeBuildingInfo(2, 2)
    const actor = makeActor(rs, bi)
    const info = new WithBuildingBibInfo()
    const bib = new WithBuildingBib(actor, info)

    bib.addedToWorld(actor)
    expect(bib.animCount).toBeGreaterThan(0)

    bib.removedFromWorld(actor)
    expect(bib.animCount).toBe(0)
  })

  it('should register animations with correct palette', () => {
    const rs = makeRenderSprites()
    const bi = makeBuildingInfo(1, 3)
    const actor = makeActor(rs, bi)
    const info = new WithBuildingBibInfo({ palette: 'terrain' })
    const bib = new WithBuildingBib(actor, info)

    bib.addedToWorld(actor)
    expect(rs.addCalls.length).toBeGreaterThan(0)
    // Each call should have 'terrain' as palette
    for (const call of rs.addCalls) {
      expect(call[1]).toBe('terrain')
    }
  })

  it('should dispose cleanly and remove all animations', () => {
    const rs = makeRenderSprites()
    const bi = makeBuildingInfo(2, 2)
    const actor = makeActor(rs, bi)
    const info = new WithBuildingBibInfo()
    const bib = new WithBuildingBib(actor, info)

    bib.addedToWorld(actor)
    bib.dispose()
    expect(bib.animCount).toBe(0)
  })
})
