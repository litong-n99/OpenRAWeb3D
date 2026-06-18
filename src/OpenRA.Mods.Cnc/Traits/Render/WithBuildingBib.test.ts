/**
 * WithBuildingBib.test.ts — Unit tests
 *
 * Tests focus on: bib cell generation, terrain-specific sequence, lifecycle,
 * and Phase B.9 preview rendering.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  WithBuildingBib,
  WithBuildingBibInfo,
  BibPreviewRenderable,
  type IBibRenderSprites,
  type IBibBuildingInfo,
  type IBibMap,
  type CellCoord,
  type IBibPreviewInit,
  type IBibActorPreview,
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

// ---------------------------------------------------------------------------
// Preview init factory
// ---------------------------------------------------------------------------

function makePreviewInit(overrides?: {
  contains?: Record<string, boolean>
  bi?: IBibBuildingInfo
  map?: IBibMap
}): IBibPreviewInit {
  const map = overrides?.map ?? makeMap()
  const bi = overrides?.bi ?? makeBuildingInfo(3, 3)
  const containsMap = overrides?.contains ?? {}

  return {
    actor: {
      traitInfo(name: string): unknown {
        if (name === 'Building') return bi
        return null
      },
    },
    worldRenderer: {
      palette(name: string): unknown {
        return { name }
      },
    },
    world: { map },
    getValue(key: string): unknown {
      if (key === 'location') return { x: 5, y: 5 }
      return null
    },
    contains(key: string): boolean {
      return containsMap[key] === true
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    const bi = makeBuildingInfo(2, 3)
    const actor = makeActor(rs, bi)
    const info = new WithBuildingBibInfo({ hasMinibib: false })
    const bib = new WithBuildingBib(actor, info)

    bib.addedToWorld(actor)
    expect(bib.animCount).toBe(4)
  })

  it('should generate minibib cells (1 row)', () => {
    const rs = makeRenderSprites()
    const bi = makeBuildingInfo(3, 3)
    const actor = makeActor(rs, bi)
    const info = new WithBuildingBibInfo({ hasMinibib: true })
    const bib = new WithBuildingBib(actor, info)

    bib.addedToWorld(actor)
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

// ---------------------------------------------------------------------------
// Phase B.9: Preview rendering tests
// ---------------------------------------------------------------------------

describe('WithBuildingBibInfo.renderPreviewSprites', () => {
  it('returns empty array when HideBibPreviewInit is present', () => {
    const info = new WithBuildingBibInfo()
    const init = makePreviewInit({
      contains: { HideBibPreviewInit: true },
    })

    const result = [...info.renderPreviewSprites(init, 'building', 1, {})]
    expect(result).toHaveLength(0)
  })

  it('generates preview sprites for all bib cells (2 rows, 3 width = 6)', () => {
    const info = new WithBuildingBibInfo({ hasMinibib: false })
    const init = makePreviewInit({
      bi: makeBuildingInfo(3, 3),
    })

    const result = [...info.renderPreviewSprites(init, 'building', 1, {})]
    // rows=2 * width=3 = 6 bib preview sprites
    expect(result).toHaveLength(6)
  })

  it('generates minibib preview sprites (1 row, 2 width = 2)', () => {
    const info = new WithBuildingBibInfo({ hasMinibib: true })
    const init = makePreviewInit({
      bi: makeBuildingInfo(2, 3),
    })

    const result = [...info.renderPreviewSprites(init, 'building', 1, {})]
    // rows=1 * width=2 = 2 bib preview sprites
    expect(result).toHaveLength(2)
  })

  it('sprites have reduced alpha for ghost appearance', () => {
    const info = new WithBuildingBibInfo()
    const init = makePreviewInit({
      bi: makeBuildingInfo(1, 3),
    })

    const result = [...info.renderPreviewSprites(init, 'building', 1, {})]
    expect(result.length).toBeGreaterThan(0)

    for (const preview of result) {
      expect(preview).toBeInstanceOf(BibPreviewRenderable)
      const br = preview as BibPreviewRenderable
      expect(br.alpha).toBe(0.5)
    }
  })

  it('returns empty array when no BuildingInfo available', () => {
    const info = new WithBuildingBibInfo()
    const init: IBibPreviewInit = {
      actor: { traitInfo: () => null },
      worldRenderer: { palette: () => ({}) },
      world: { map: makeMap() },
      getValue: () => ({ x: 0, y: 0 }),
      contains: () => false,
    }

    const result = [...info.renderPreviewSprites(init, 'building', 1, {})]
    expect(result).toHaveLength(0)
  })

  it('uses terrain-specific bib sequence when available', () => {
    const info = new WithBuildingBibInfo({ sequence: 'bib' })
    const sandMap: IBibMap = {
      tiles: { cellBounds: { width: 100, height: 100 } },
      contains: () => true,
      centerOfCell: () => ({ x: 0, y: 0, z: 0 }),
      getTerrainInfo: () => ({ type: 'sand' }),
    }
    const init = makePreviewInit({
      bi: makeBuildingInfo(1, 3),
      map: sandMap,
    })

    const result = [...info.renderPreviewSprites(init, 'building', 1, {})]
    expect(result.length).toBeGreaterThan(0)
    // Should use terrain-specific sequence "bib-sand"
    const preview = result[0] as BibPreviewRenderable
    expect(preview.sequence).toBe('bib-sand')
  })

  it('preview uses info palette when specified', () => {
    const info = new WithBuildingBibInfo({ palette: 'terrain' })
    const init = makePreviewInit({
      bi: makeBuildingInfo(1, 3),
    })

    const result = [...info.renderPreviewSprites(init, 'building', 1, { pal: 'default' })]
    expect(result.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// BibPreviewRenderable tests
// ---------------------------------------------------------------------------

describe('BibPreviewRenderable', () => {
  it('stores all preview properties', () => {
    const offset = () => ({ x: 10, y: 20, z: 30 })
    const zOffset = () => 5
    const palette = { name: 'terrain' }
    const preview = new BibPreviewRenderable('bib', offset, zOffset, palette, 'building', 0.5)

    expect(preview.sequence).toBe('bib')
    expect(preview.image).toBe('building')
    expect(preview.alpha).toBe(0.5)
    expect(preview.offset()).toEqual({ x: 10, y: 20, z: 30 })
    expect(preview.zOffset()).toBe(5)
    expect(preview.palette).toBe(palette)
  })

  it('render() returns typed preview metadata', () => {
    const offset = () => ({ x: 5, y: 5, z: 0 })
    const preview = new BibPreviewRenderable('bib', offset, () => 0, {}, 'img', 0.5)

    const result = preview.render(null, { x: 100, y: 200, z: 0 })
    expect(result).toHaveLength(1)
    expect((result[0] as any).type).toBe('bibPreview')
    expect((result[0] as any).alpha).toBe(0.5)
    expect((result[0] as any).sequence).toBe('bib')
  })

  it('screenBounds returns unit-sized rectangles', () => {
    const offset = () => ({ x: 40, y: 50, z: 60 })
    const preview = new BibPreviewRenderable('bib', offset, () => 0, {}, 'img', 0.5)

    const bounds = preview.screenBounds(null, { x: 0, y: 0, z: 0 })
    expect(bounds).toHaveLength(1)
    expect(bounds[0].x).toBe(40)
    expect(bounds[0].y).toBe(50)
  })

  it('tick does not throw', () => {
    const preview = new BibPreviewRenderable('bib', () => ({ x: 0, y: 0, z: 0 }), () => 0, {}, 'img')
    expect(() => preview.tick()).not.toThrow()
  })
})
