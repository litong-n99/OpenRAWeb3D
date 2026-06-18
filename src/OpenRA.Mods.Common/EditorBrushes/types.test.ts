/**
 * types.test.ts — Editor brush shared types migration unit tests
 *
 * Since these are pure data type tests (no Babylon.js dependency), no mocks
 * are needed. Tests focus on: MapBlitFilters bitmask arithmetic,
 * EditorSelection state transitions, cposKey serialization, and type
 * interface validation.
 */

import { describe, it, expect } from 'vitest'

import {
  MapBlitFilters,
  EditorSelection,
  cposKey,
  type BlitTile,
  type EditorBlitSource,
  type UndoTile,
  type CellResource,
  type PaintMarkerTile,
  type ISelectionController,
} from './types.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'
import type { CellCoordsRegion } from '../../OpenRA.Game/Map/CellCoordsRegion.js'
import { ResourceLayerContentsEmpty } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock CPos — minimal for testing
// ---------------------------------------------------------------------------

function mockCPos(x: number, y: number): CPos {
  return { X: x, Y: y } as unknown as CPos
}

// ---------------------------------------------------------------------------
// MapBlitFilters
// ---------------------------------------------------------------------------

describe('MapBlitFilters', () => {
  it('None is 0', () => {
    expect(MapBlitFilters.None).toBe(0)
  })

  it('Terrain is bit 0 (value 1)', () => {
    expect(MapBlitFilters.Terrain).toBe(1)
  })

  it('Resources is bit 1 (value 2)', () => {
    expect(MapBlitFilters.Resources).toBe(2)
  })

  it('Actors is bit 2 (value 4)', () => {
    expect(MapBlitFilters.Actors).toBe(4)
  })

  it('All equals Terrain | Resources | Actors (7)', () => {
    expect(MapBlitFilters.All).toBe(7)
    expect(MapBlitFilters.All).toBe(
      MapBlitFilters.Terrain | MapBlitFilters.Resources | MapBlitFilters.Actors,
    )
  })

  it('bitwise operations work correctly', () => {
    const f = MapBlitFilters.Terrain | MapBlitFilters.Actors
    expect(f & MapBlitFilters.Terrain).toBe(MapBlitFilters.Terrain)
    expect(f & MapBlitFilters.Resources).toBe(0)
    expect(f & MapBlitFilters.Actors).toBe(MapBlitFilters.Actors)
  })

  it('HasFlag semantics via bitwise &', () => {
    const f = MapBlitFilters.All
    expect((f & MapBlitFilters.Terrain) !== 0).toBe(true)
    expect((f & MapBlitFilters.Resources) !== 0).toBe(true)
    expect((f & MapBlitFilters.Actors) !== 0).toBe(true)

    const g = MapBlitFilters.Terrain
    expect((g & MapBlitFilters.Resources) !== 0).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// EditorSelection
// ---------------------------------------------------------------------------

describe('EditorSelection', () => {
  it('default state has no selection', () => {
    const sel = new EditorSelection()
    expect(sel.area).toBeNull()
    expect(sel.actor).toBeNull()
    expect(sel.hasSelection).toBe(false)
  })

  it('hasSelection is true when area is set', () => {
    const sel = new EditorSelection()
    sel.area = {} as CellCoordsRegion
    expect(sel.hasSelection).toBe(true)
  })

  it('hasSelection is true when actor is set', () => {
    const sel = new EditorSelection()
    sel.actor = { id: 'test' } as any
    expect(sel.hasSelection).toBe(true)
  })

  it('hasSelection is false when both area and actor are null', () => {
    const sel = new EditorSelection()
    sel.area = null
    sel.actor = null
    expect(sel.hasSelection).toBe(false)
  })

  it('supports mutation for drag selection', () => {
    const sel = new EditorSelection()
    const region = {} as CellCoordsRegion
    sel.area = region
    expect(sel.area).toBe(region)

    sel.area = null
    sel.actor = { id: 'actor1' } as any
    expect(sel.area).toBeNull()
    expect(sel.actor).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// cposKey
// ---------------------------------------------------------------------------

describe('cposKey', () => {
  it('formats positive coordinates', () => {
    expect(cposKey(mockCPos(10, 20))).toBe('10,20')
  })

  it('formats negative coordinates', () => {
    expect(cposKey(mockCPos(-5, -3))).toBe('-5,-3')
  })

  it('formats zero coordinates', () => {
    expect(cposKey(mockCPos(0, 0))).toBe('0,0')
  })

  it('produces deterministic keys', () => {
    const a = cposKey(mockCPos(42, 73))
    const b = cposKey(mockCPos(42, 73))
    expect(a).toBe(b)
  })

  it('different cells produce different keys', () => {
    const a = cposKey(mockCPos(1, 2))
    const b = cposKey(mockCPos(1, 3))
    const c = cposKey(mockCPos(2, 1))
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(b).not.toBe(c)
  })
})

// ---------------------------------------------------------------------------
// BlitTile interface
// ---------------------------------------------------------------------------

describe('BlitTile', () => {
  it('accepts valid snapshot shape', () => {
    const tile: BlitTile = {
      terrainTile: { type: 5, index: 3 },
      resourceTile: { type: 0, index: 0 },
      resourceLayerContents: null,
      height: 7,
    }
    expect(tile.terrainTile.type).toBe(5)
    expect(tile.terrainTile.index).toBe(3)
    expect(tile.resourceLayerContents).toBeNull()
    expect(tile.height).toBe(7)
  })

  it('accepts non-null resource contents', () => {
    const tile: BlitTile = {
      terrainTile: { type: 1, index: 0 },
      resourceTile: { type: 2, index: 255 },
      resourceLayerContents: { type: 'Ore', density: 12 },
      height: 0,
    }
    expect(tile.resourceLayerContents).not.toBeNull()
    expect(tile.resourceLayerContents!.type).toBe('Ore')
    expect(tile.resourceLayerContents!.density).toBe(12)
  })

  it('accepts empty resource contents via sentinel', () => {
    const tile: BlitTile = {
      terrainTile: { type: 0, index: 0 },
      resourceTile: { type: 0, index: 0 },
      resourceLayerContents: ResourceLayerContentsEmpty,
      height: 0,
    }
    expect(tile.resourceLayerContents).toBe(ResourceLayerContentsEmpty)
    const rlc = tile.resourceLayerContents
    expect(rlc!.type).toBe('')
    expect(rlc!.density).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// EditorBlitSource interface
// ---------------------------------------------------------------------------

describe('EditorBlitSource', () => {
  it('accepts valid snapshot shape', () => {
    const source: EditorBlitSource = {
      cellCoords: {} as CellCoordsRegion,
      actors: new Map(),
      tiles: new Map(),
    }
    expect(source.actors.size).toBe(0)
    expect(source.tiles.size).toBe(0)
  })

  it('accepts populated data', () => {
    const tile: BlitTile = {
      terrainTile: { type: 1, index: 2 },
      resourceTile: { type: 0, index: 0 },
      resourceLayerContents: null,
      height: 5,
    }
    const tiles = new Map<string, BlitTile>()
    tiles.set('3,4', tile)

    const source: EditorBlitSource = {
      cellCoords: {} as CellCoordsRegion,
      actors: new Map([['actor1', { id: 'actor1' } as any]]),
      tiles,
    }
    expect(source.actors.size).toBe(1)
    expect(source.tiles.size).toBe(1)
    expect(source.tiles.get('3,4')!.height).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// UndoTile interface
// ---------------------------------------------------------------------------

describe('UndoTile', () => {
  it('accepts valid undo snapshot', () => {
    const undo: UndoTile = {
      cell: mockCPos(1, 2),
      mapTile: { type: 10, index: 5 },
      height: 3,
    }
    expect(undo.cell.X).toBe(1)
    expect(undo.cell.Y).toBe(2)
    expect(undo.mapTile.type).toBe(10)
    expect(undo.mapTile.index).toBe(5)
    expect(undo.height).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// CellResource interface
// ---------------------------------------------------------------------------

describe('CellResource', () => {
  it('accepts valid resource cell snapshot', () => {
    const cell: CellResource = {
      cell: mockCPos(5, 6),
      oldResourceTile: { type: 'Tiberium', density: 7 },
    }
    expect(cell.cell.X).toBe(5)
    expect(cell.cell.Y).toBe(6)
    expect(cell.oldResourceTile.type).toBe('Tiberium')
    expect(cell.oldResourceTile.density).toBe(7)
  })

  it('oldResourceTile can be empty', () => {
    const cell: CellResource = {
      cell: mockCPos(0, 0),
      oldResourceTile: ResourceLayerContentsEmpty,
    }
    expect(cell.oldResourceTile.type).toBe('')
    expect(cell.oldResourceTile.density).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// PaintMarkerTile interface
// ---------------------------------------------------------------------------

describe('PaintMarkerTile', () => {
  it('accepts non-null previous marker', () => {
    const tile: PaintMarkerTile = {
      cell: mockCPos(3, 3),
      previous: 2,
    }
    expect(tile.cell.X).toBe(3)
    expect(tile.cell.Y).toBe(3)
    expect(tile.previous).toBe(2)
  })

  it('accepts null previous marker (was empty)', () => {
    const tile: PaintMarkerTile = {
      cell: mockCPos(0, 0),
      previous: null,
    }
    expect(tile.previous).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ISelectionController interface
// ---------------------------------------------------------------------------

describe('ISelectionController', () => {
  it('can be implemented by a mock', () => {
    let lastSelection: EditorSelection | null = null
    let currentSelection = new EditorSelection()

    const controller: ISelectionController = {
      setSelection(sel: EditorSelection) {
        lastSelection = sel
        currentSelection = sel
      },
      get selection() {
        return currentSelection
      },
    }

    const newSel = new EditorSelection()
    controller.setSelection(newSel)
    expect(lastSelection).toBe(newSel)
    expect(controller.selection).toBe(newSel)

    newSel.area = {} as CellCoordsRegion
    controller.setSelection(newSel)
    expect(controller.selection.hasSelection).toBe(true)
  })

  it('selection getter reflects current state', () => {
    const sel = new EditorSelection()
    sel.actor = { id: 'test', info: {} } as any
    const controller: ISelectionController = {
      setSelection: () => {},
      selection: sel,
    }
    expect(controller.selection.actor).not.toBeNull()
  })
})
