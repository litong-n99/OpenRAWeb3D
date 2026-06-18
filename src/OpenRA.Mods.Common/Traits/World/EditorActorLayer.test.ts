/**
 * EditorActorLayer.test.ts — EditorActorLayer migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/Traits/World/EditorActorLayer.cs
 *
 * No @babylonjs/core dependency — EditorActorLayer is a pure data model
 * that manages EditorActorPreview instances.
 *
 * Tests focus on: actor addition/removal, ID generation, spatial indexing,
 * multiplayer sync, move actor, footprint validation, dispose cleanup,
 * and edge cases (empty footprint, duplicate IDs, etc.).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { EditorActorLayer, EditorActorLayerInfo } from './EditorActorLayer.js'
import { EditorActorPreview, type ActorReferenceMap } from './EditorActorPreview.js'
import type { OwnerInit, LocationInit } from './EditorActorPreview.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'
import { PlayerReference } from '../../../OpenRA.Game/Map/PlayerReference.js'
import { CellCoordsRegion } from '../../../OpenRA.Game/Map/CellCoordsRegion.js'
import type {
  WorldRendererStub,
  WorldStub,
  IGameActor,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorldRenderer(): WorldRendererStub {
  return {
    updatePalettesForPlayer: vi.fn(),
  } as unknown as WorldRendererStub
}

function makeWorldStub(mapData?: {
  allCells?: CPos[]
  tileSize?: { width: number; height: number }
  mapSize?: { width: number; height: number }
  playerDefinitions?: { name: string; properties?: Partial<PlayerReference> }[]
  actorDefinitions?: Map<string, { type: string; value: Record<string, unknown> }>
}): WorldStub {
  return {
    map: mapData ?? {
      allCells: [
        new CPos(0, 0), new CPos(9, 0),
        new CPos(0, 9), new CPos(9, 9),
      ],
      tileSize: { width: 1024, height: 1024 },
      mapSize: { width: 10, height: 10 },
      playerDefinitions: [
        {
          name: 'Neutral',
          properties: { ownsWorld: true, playable: false, nonCombatant: true, faction: 'Random' },
        },
      ],
    },
    actors: [],
  } as unknown as WorldStub
}

function makeGameActor(): IGameActor {
  return { disposed: false, actorId: 1 } as unknown as IGameActor
}

function makeReference(location?: CPos, ownerName?: string, typeName?: string): ActorReferenceMap {
  const ref = new Map<string, unknown>()
  if (location) {
    ref.set('LocationInit', { type: 'LocationInit', value: location } satisfies LocationInit)
  }
  if (ownerName) {
    ref.set('OwnerInit', { type: 'OwnerInit', value: ownerName } satisfies OwnerInit)
  }
  if (typeName) {
    ref.set('type', typeName)
  }
  return ref
}

function makePlayer(name: string = 'Neutral', faction: string = 'Random'): PlayerReference {
  return new PlayerReference({ name, faction, color: 0xffff0000 })
}

// ---------------------------------------------------------------------------
// EditorActorLayerInfo tests
// ---------------------------------------------------------------------------

describe('EditorActorLayerInfo', () => {
  it('has default BinSize of 250', () => {
    const info = new EditorActorLayerInfo()
    expect(info.BinSize).toBe(250)
  })

  it('has default DefaultActorFacing of 384', () => {
    const info = new EditorActorLayerInfo()
    expect(info.DefaultActorFacing).toBe(384)
  })

  it('accepts custom BinSize and DefaultActorFacing', () => {
    const info = new EditorActorLayerInfo({
      binSize: 500,
      defaultActorFacing: 128,
    })
    expect(info.BinSize).toBe(500)
    expect(info.DefaultActorFacing).toBe(128)
  })

  it('create() returns an EditorActorLayer instance', () => {
    const info = new EditorActorLayerInfo()
    const layer = info.create({ self: makeGameActor() })
    expect(layer).toBeInstanceOf(EditorActorLayer)
    expect(layer.Info).toBe(info)
  })

  it('createServerPlayers throws as expected', () => {
    const info = new EditorActorLayerInfo()
    expect(() => info.createServerPlayers(null, null, [], null)).toThrow(
      'EditorActorLayer must not be defined on the world actor.',
    )
  })
})

// ---------------------------------------------------------------------------
// EditorActorLayer tests
// ---------------------------------------------------------------------------

describe('EditorActorLayer', () => {
  let layer: EditorActorLayer
  let wr: WorldRendererStub
  let world: WorldStub

  beforeEach(() => {
    layer = new EditorActorLayer(new EditorActorLayerInfo())
    wr = makeWorldRenderer()
    world = makeWorldStub()
  })

  // ---------------------------------------------------------------------------
  // Static constants
  // ---------------------------------------------------------------------------

  it('ActorPrefix is "Actor"', () => {
    expect(EditorActorLayer.ActorPrefix).toBe('Actor')
  })

  it('PlayerSpawnName is "mpspawn"', () => {
    expect(EditorActorLayer.PlayerSpawnName).toBe('mpspawn')
  })

  // ---------------------------------------------------------------------------
  // Initialization & Interface implementation
  // ---------------------------------------------------------------------------

  describe('createPlayers', () => {
    it('creates Players from provided definitions', () => {
      layer.createPlayers(world, { next: () => 0 })
      expect(layer.Players).not.toBeNull()
      expect(layer.Players!.players.has('Neutral')).toBe(true)
    })

    it('creates default Neutral player if no definitions provided', () => {
      const emptyWorld = makeWorldStub({ allCells: [] })
      layer.createPlayers(emptyWorld, { next: () => 0 })
      expect(layer.Players!.players.has('Neutral')).toBe(true)
      const neutral = layer.Players!.players.get('Neutral')!
      expect(neutral.ownsWorld).toBe(true)
      expect(neutral.playable).toBe(false)
    })

    it('identifies worldOwner correctly', () => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
      // World owner is stored internally; verify via add() behaviour
      const ref = makeReference(new CPos(1, 1))
      const preview = layer.add(ref)
      // Owner should be Neutral (world owner)
      expect(preview.owner.name).toBe('Neutral')
    })
  })

  describe('worldLoaded', () => {
    it('initializes spatial indices and loads existing actors', () => {
      layer.createPlayers(world, { next: () => 0 })

      const existingActors = new Map<string, { type: string; value: Record<string, unknown> }>()
      existingActors.set('Actor0', {
        type: 'e1',
        value: { LocationInit: { type: 'LocationInit', value: new CPos(3, 3) } },
      })

      const ws = makeWorldStub({ actorDefinitions: existingActors })
      const existingMap = (ws as unknown as Record<string, unknown>).map as Record<string, unknown> ?? {}
      ;(ws as unknown as Record<string, unknown>).map = {
        ...existingMap,
        actorDefinitions: existingActors,
        allCells: [new CPos(0, 0), new CPos(9, 0), new CPos(0, 9), new CPos(9, 9)],
        tileSize: { width: 1024, height: 1024 },
        mapSize: { width: 10, height: 10 },
      }

      layer.worldLoaded(ws, wr)
      expect(layer.all.length).toBe(1)
      expect(layer.all[0].id).toBe('Actor0')
    })

    it('handles worldLoaded with no actor definitions gracefully', () => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
      expect(layer.all.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // add — single actor creation
  // ---------------------------------------------------------------------------

  describe('add', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('creates a preview with a unique actor name "Actor0"', () => {
      const ref = makeReference(new CPos(2, 3), 'Neutral', 'e1')
      const preview = layer.add(ref)
      expect(preview.id).toBe('Actor0')
      expect(preview.type).toBe('e1')
    })

    it('generates sequential IDs: Actor0, Actor1, Actor2', () => {
      const ids: string[] = []
      for (let i = 0; i < 3; i++) {
        const ref = makeReference(new CPos(i, i), 'Neutral', 'e1')
        ids.push(layer.add(ref).id)
      }
      expect(ids).toEqual(['Actor0', 'Actor1', 'Actor2'])
    })

    it('skips IDs already in use', () => {
      const ref = makeReference(new CPos(2, 2), 'Neutral', 'e1')

      // Manually add Actor0 and Actor2, then add through layer — should get Actor1
      const preview0 = new EditorActorPreview(
        wr, 'Actor0', ref, makePlayer(), { name: 'e1' },
      )
      const preview2 = new EditorActorPreview(
        wr, 'Actor2', ref, makePlayer(), { name: 'e1' },
      )
      layer.addPreview(preview0)
      layer.addPreview(preview2)

      const preview = layer.add(ref)
      expect(preview.id).toBe('Actor1')
    })

    it('adds actor to collection', () => {
      const ref = makeReference(new CPos(5, 5), 'Neutral', 'e1')
      layer.add(ref)
      expect(layer.all.length).toBe(1)
    })

    it('assigns owner from reference', () => {
      const ref = makeReference(new CPos(1, 1), 'Neutral', 'e1')
      const preview = layer.add(ref)
      expect(preview.owner.name).toBe('Neutral')
    })

    it('falls back to worldOwner if OwnerInit is missing', () => {
      layer.createPlayers(world, { next: () => 0 })
      const ref = makeReference(new CPos(1, 1), undefined, 'e1')
      const preview = layer.add(ref)
      expect(preview.owner.name).toBe('Neutral')
    })

    it('throws when add called before worldLoaded (no worldRenderer)', () => {
      const freshLayer = new EditorActorLayer(new EditorActorLayerInfo())
      const ref = makeReference(new CPos(1, 1), 'Neutral', 'e1')
      expect(() => freshLayer.add(ref)).toThrow(
        'Cannot add preview before worldLoaded()',
      )
    })

    it('throws when add called before createPlayers (no worldOwner)', () => {
      const freshLayer = new EditorActorLayer(new EditorActorLayerInfo())
      // worldLoaded sets worldRenderer but no createPlayers yet
      freshLayer.worldLoaded(world, wr)
      const ref = makeReference(new CPos(1, 1), 'Neutral', 'e1')
      expect(() => freshLayer.add(ref)).toThrow(
        'Cannot add preview before createPlayers() or worldLoaded()',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // addRange — batch add with auto-generated names (BLOCKER-1 fix)
  // ---------------------------------------------------------------------------

  describe('addRange', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('auto-generates names for all references', () => {
      const refs = [
        makeReference(new CPos(1, 1), 'Neutral', 'e1'),
        makeReference(new CPos(2, 2), 'Neutral', 'e2'),
        makeReference(new CPos(3, 3), 'Neutral', 'e3'),
      ]
      layer.addRange(refs)
      expect(layer.all.length).toBe(3)
      expect(layer.all[0].id).toBe('Actor0')
      expect(layer.all[1].id).toBe('Actor1')
      expect(layer.all[2].id).toBe('Actor2')
    })

    it('correctly combines with existing actors', () => {
      layer.add(makeReference(new CPos(5, 5), 'Neutral', 'e0')) // Actor0
      const refs = [
        makeReference(new CPos(1, 1), 'Neutral', 'e1'),
        makeReference(new CPos(2, 2), 'Neutral', 'e2'),
      ]
      layer.addRange(refs)
      // Should get Actor1, Actor2 (Actor0 is taken)
      expect(layer.all[1].id).toBe('Actor1')
      expect(layer.all[2].id).toBe('Actor2')
    })
  })

  // ---------------------------------------------------------------------------
  // addRangePreviews — batch add pre-built previews (MAJOR-3 fix)
  // ---------------------------------------------------------------------------

  describe('addRangePreviews', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('adds multiple pre-built previews at once', () => {
      const p1 = new EditorActorPreview(
        wr, 'Custom_1', makeReference(new CPos(1, 1), 'Neutral', 'e1'),
        makePlayer(), { name: 'e1' },
      )
      const p2 = new EditorActorPreview(
        wr, 'Custom_2', makeReference(new CPos(2, 2), 'Neutral', 'e2'),
        makePlayer(), { name: 'e2' },
      )
      layer.addRangePreviews([p1, p2])
      expect(layer.all.length).toBe(2)
      expect(layer.getById('Custom_1')).toBe(p1)
      expect(layer.getById('Custom_2')).toBe(p2)
    })

    it('updates neighbour info for all added previews', () => {
      const p1 = new EditorActorPreview(
        wr, 'P1', makeReference(new CPos(1, 1), 'Neutral', 'e1'),
        makePlayer(), { name: 'e1' },
      )
      const p2 = new EditorActorPreview(
        wr, 'P2', makeReference(new CPos(1, 2), 'Neutral', 'e2'),
        makePlayer(), { name: 'e2' },
      )
      layer.addRangePreviews([p1, p2])
      // Both should be in the spatial index
      expect(layer.previewsAtCell(new CPos(1, 1)).length).toBe(1)
      expect(layer.previewsAtCell(new CPos(1, 2)).length).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // remove — single actor removal
  // ---------------------------------------------------------------------------

  describe('remove', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('removes actor from collection', () => {
      const ref = makeReference(new CPos(3, 3), 'Neutral', 'e1')
      const preview = layer.add(ref)
      expect(layer.all.length).toBe(1)

      layer.remove(preview)
      expect(layer.all.length).toBe(0)
    })

    it('cleans up preview ID for reuse', () => {
      const ref = makeReference(new CPos(3, 3), 'Neutral', 'e1')
      const preview = layer.add(ref)
      expect(preview.id).toBe('Actor0')

      layer.remove(preview)

      const ref2 = makeReference(new CPos(4, 4), 'Neutral', 'e1')
      const preview2 = layer.add(ref2)
      expect(preview2.id).toBe('Actor0') // ID reclaimed
    })

    it('removes from spatial index', () => {
      const ref = makeReference(new CPos(3, 3), 'Neutral', 'e1')
      const preview = layer.add(ref)
      expect(layer.previewsAtCell(new CPos(3, 3)).length).toBe(1)

      layer.remove(preview)
      expect(layer.previewsAtCell(new CPos(3, 3)).length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // removeRange — batch removal
  // ---------------------------------------------------------------------------

  describe('removeRange', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('removes multiple actors', () => {
      const previews = [
        layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1')),
        layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2')),
        layer.add(makeReference(new CPos(3, 3), 'Neutral', 'e3')),
      ]
      expect(layer.all.length).toBe(3)

      layer.removeRange([previews[0], previews[2]])
      expect(layer.all.length).toBe(1)
      expect(layer.all[0].id).toBe('Actor1')
    })
  })

  // ---------------------------------------------------------------------------
  // removeRegion — region-based removal
  // ---------------------------------------------------------------------------

  describe('removeRegion', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('removes all actors in a cell region', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))
      layer.add(makeReference(new CPos(5, 5), 'Neutral', 'e3'))

      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(3, 3))
      layer.removeRegion(region)

      expect(layer.all.length).toBe(1)
      expect(layer.all[0].id).toBe('Actor2') // Only Actor2 at (5,5) remains
    })
  })

  // ---------------------------------------------------------------------------
  // Spatial queries
  // ---------------------------------------------------------------------------

  describe('previewsAtCell', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('returns actors at a specific cell', () => {
      layer.add(makeReference(new CPos(4, 4), 'Neutral', 'e1'))
      const results = layer.previewsAtCell(new CPos(4, 4))
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('Actor0')
    })

    it('returns empty array for cells with no actors', () => {
      const results = layer.previewsAtCell(new CPos(9, 9))
      expect(results.length).toBe(0)
    })

    it('returns multiple actors stacked at the same cell', () => {
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e3'))
      const results = layer.previewsAtCell(new CPos(2, 2))
      expect(results.length).toBe(3)
    })
  })

  describe('previewsInCellRegion', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('returns actors within a rectangular cell region', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))
      layer.add(makeReference(new CPos(6, 6), 'Neutral', 'e3'))

      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(3, 3))
      const results = layer.previewsInCellRegion(region)
      expect(results.length).toBe(2)
    })

    it('returns empty for region with no actors', () => {
      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(9, 9))
      const results = layer.previewsInCellRegion(region)
      expect(results.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // ID generation
  // ---------------------------------------------------------------------------

  describe('nextActorName', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('generates "Actor0" for first actor', () => {
      expect(layer.nextActorName()).toBe('Actor0')
    })

    it('generates sequential names', () => {
      layer.add(makeReference(new CPos(0, 0), 'Neutral', 'e1')) // Actor0
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e2')) // Actor1
      expect(layer.nextActorName()).toBe('Actor2')
    })

    it('reuses freed IDs', () => {
      const p = layer.add(makeReference(new CPos(0, 0), 'Neutral', 'e1')) // Actor0
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e2')) // Actor1
      layer.remove(p)
      expect(layer.nextActorName()).toBe('Actor0')
    })
  })

  describe('nextActorNames', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('generates the requested number of names', () => {
      const names = layer.nextActorNames(5)
      expect(names).toEqual(['Actor0', 'Actor1', 'Actor2', 'Actor3', 'Actor4'])
    })

    it('skips already-used IDs', () => {
      layer.add(makeReference(new CPos(0, 0), 'Neutral', 'e1')) // Actor0
      const names = layer.nextActorNames(3)
      expect(names).toEqual(['Actor1', 'Actor2', 'Actor3'])
    })
  })

  // ---------------------------------------------------------------------------
  // moveActor
  // ---------------------------------------------------------------------------

  describe('moveActor', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('moves actor to new location', () => {
      const preview = layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e1'))
      expect(layer.previewsAtCell(new CPos(2, 2)).length).toBe(1)
      expect(layer.previewsAtCell(new CPos(5, 5)).length).toBe(0)

      layer.moveActor(preview, new CPos(5, 5))

      expect(layer.previewsAtCell(new CPos(2, 2)).length).toBe(0)
      expect(layer.previewsAtCell(new CPos(5, 5)).length).toBe(1)
    })

    it('updates LocationInit on the preview', () => {
      const preview = layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e1'))
      layer.moveActor(preview, new CPos(7, 7))

      const locInit = preview.getInitOrDefault<LocationInit>('LocationInit')
      expect(locInit!.value.X).toBe(7)
      expect(locInit!.value.Y).toBe(7)
    })

    it('keeps actor count unchanged', () => {
      const preview = layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e1'))
      expect(layer.all.length).toBe(1)
      layer.moveActor(preview, new CPos(5, 5))
      expect(layer.all.length).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // freeSubCellAt
  // ---------------------------------------------------------------------------

  describe('freeSubCellAt', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('returns FullCell when cell is empty', () => {
      const result = layer.freeSubCellAt(new CPos(3, 3))
      expect(result).toBe(SubCell.FullCell)
    })

    it('freeSubCellAt returns valid sub-cell when cell has actors', () => {
      // Simulate full occupation by adding 6 actors at the same cell.
      // Each added actor has FullCell as its footprint sub-cell, so sub-cells
      // 1-5 are technically free, and freeSubCellAt via SubCell.First returns
      // the first available sub-cell (1).
      const cell = new CPos(3, 3)
      for (let s = SubCell.FullCell; s <= 5; s++) {
        void layer.add(makeReference(cell, 'Neutral', 'e1'))
      }
      // With default FullCell footprints, sub-cell check for s=1
      // won't be blocked by any FullCell occupant
      const result = layer.freeSubCellAt(cell)
      expect(result).not.toBe(SubCell.Invalid) // First sub-cell should be free
    })
  })

  // ---------------------------------------------------------------------------
  // getById — indexer
  // ---------------------------------------------------------------------------

  describe('getById', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('finds actor by ID (case insensitive)', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1')) // Actor0
      const found = layer.getById('actor0')
      expect(found).not.toBeUndefined()
      expect(found!.id).toBe('Actor0')
    })

    it('returns undefined for missing ID', () => {
      const found = layer.getById('Actor999')
      expect(found).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // addRangeFromNames
  // ---------------------------------------------------------------------------

  describe('addRangeFromNames', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('adds multiple actors with specified names', () => {
      const refs = [
        makeReference(new CPos(1, 1), 'Neutral', 'e1'),
        makeReference(new CPos(2, 2), 'Neutral', 'e2'),
      ]
      layer.addRangeFromNames(refs, ['MyActor_1', 'MyActor_2'])
      expect(layer.all.length).toBe(2)
      expect(layer.all[0].id).toBe('MyActor_1')
      expect(layer.all[1].id).toBe('MyActor_2')
    })

    it('throws if name and reference counts mismatch', () => {
      const refs = [
        makeReference(new CPos(1, 1), 'Neutral', 'e1'),
      ]
      expect(() => layer.addRangeFromNames(refs, ['A', 'B'])).toThrow(
        'Member name count must match reference count.',
      )
    })

    it('throws when addRangeFromNames called before worldLoaded', () => {
      const freshLayer = new EditorActorLayer(new EditorActorLayerInfo())
      const refs = [makeReference(new CPos(1, 1), 'Neutral', 'e1')]
      expect(() => freshLayer.addRangeFromNames(refs, ['Test'])).toThrow(
        'Cannot add previews before worldLoaded()',
      )
    })
  })

  // ---------------------------------------------------------------------------
  // addPreview — direct preview addition
  // ---------------------------------------------------------------------------

  describe('addPreview', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
    })

    it('adds a manually created preview to the layer', () => {
      const ref = makeReference(new CPos(1, 1), 'Neutral', 'e1')
      const preview = new EditorActorPreview(
        wr, 'CustomActor', ref, makePlayer(), { name: 'e1' },
      )
      layer.addPreview(preview)
      expect(layer.all.length).toBe(1)
      expect(layer.getById('CustomActor')).toBe(preview)
    })
  })

  // ---------------------------------------------------------------------------
  // save
  // ---------------------------------------------------------------------------

  describe('save', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('serializes all actors', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))
      const saved = layer.save()
      expect(saved.length).toBe(2)
      expect(saved[0].key).toBe('Actor0')
      expect(saved[1].key).toBe('Actor1')
    })

    it('returns empty array when no actors', () => {
      const saved = layer.save()
      expect(saved).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // populateRadarSignatureCells
  // ---------------------------------------------------------------------------

  describe('populateRadarSignatureCells', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('adds radar cells for all actors in the layer', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(3, 3), 'Neutral', 'e2'))

      const buffer: { cell: CPos; color: number }[] = []
      layer.populateRadarSignatureCells(makeGameActor(), buffer)

      // Each actor has a footprint of at least 1 cell
      expect(buffer.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ---------------------------------------------------------------------------
  // Multiplayer sync
  // ---------------------------------------------------------------------------

  describe('multiplayer sync', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('syncs Multi players when mpspawn actors are added', () => {
      // Add two mpspawn-like actors
      const ref1 = makeReference(new CPos(1, 1), 'Neutral', 'mpspawn')
      const ref2 = makeReference(new CPos(2, 2), 'Neutral', 'mpspawn')
      layer.add(ref1)
      layer.add(ref2)

      // Multi0 and Multi1 should exist
      expect(layer.Players!.players.has('Multi0')).toBe(true)
      expect(layer.Players!.players.has('Multi1')).toBe(true)
      expect(layer.Players!.players.has('Multi2')).toBe(false)
    })

    it('removes Multi players when mpspawn actor is removed', () => {
      const ref1 = makeReference(new CPos(1, 1), 'Neutral', 'mpspawn')
      const ref2 = makeReference(new CPos(2, 2), 'Neutral', 'mpspawn')
      const p1 = layer.add(ref1)
      layer.add(ref2)

      expect(layer.Players!.players.has('Multi0')).toBe(true)
      expect(layer.Players!.players.has('Multi1')).toBe(true)

      layer.remove(p1)

      // Multi1 should be removed (only 1 mpspawn left)
      expect(layer.Players!.players.has('Multi0')).toBe(true)
      expect(layer.Players!.players.has('Multi1')).toBe(false)
    })

    it('fires onPlayerRemoved callback when player is removed', () => {
      const callback = vi.fn()
      layer.onPlayerRemoved = callback

      const ref1 = makeReference(new CPos(1, 1), 'Neutral', 'mpspawn')
      const ref2 = makeReference(new CPos(2, 2), 'Neutral', 'mpspawn')
      const p1 = layer.add(ref1)
      layer.add(ref2)

      layer.remove(p1)

      expect(callback).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Remove region with mask
  // ---------------------------------------------------------------------------

  describe('removeRegionWithMask', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('removes only actors whose footprints overlap the mask', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))
      layer.add(makeReference(new CPos(5, 5), 'Neutral', 'e3'))

      const region = new CellCoordsRegion(new CPos(0, 0), new CPos(9, 9))
      const mask = new Set<number>([new CPos(2, 2).Bits])

      layer.removeRegionWithMask(region, mask)

      // Only Actor1 at (2,2) should be removed
      expect(layer.all.length).toBe(2)
      const remainingIds = layer.all.map((p) => p.id)
      expect(remainingIds).not.toContain('Actor1')
    })
  })

  // ---------------------------------------------------------------------------
  // dispose / cleanup
  // ---------------------------------------------------------------------------

  describe('dispose', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('clears all previews', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))
      expect(layer.all.length).toBe(2)

      layer.dispose()
      expect(layer.all.length).toBe(0)
    })

    it('clears Players reference', () => {
      layer.dispose()
      expect(layer.Players).toBeNull()
    })

    it('reclaims IDs for reuse (clears previewIds)', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.dispose()
      expect(layer.nextActorName()).toBe('Actor0')
    })

    it('resets onPlayerRemoved to empty callback', () => {
      const cb = vi.fn()
      layer.onPlayerRemoved = cb
      layer.dispose()
      layer.onPlayerRemoved()
      expect(cb).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // ITickRender.tickRender — ticks all previews
  // ---------------------------------------------------------------------------

  describe('tickRender', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('calls tick() on all previews', () => {
      const p1 = layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      const tickSpy1 = vi.spyOn(p1, 'tick')
      const p2 = layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))
      const tickSpy2 = vi.spyOn(p2, 'tick')

      layer.tickRender(wr, makeGameActor())

      expect(tickSpy1).toHaveBeenCalledOnce()
      expect(tickSpy2).toHaveBeenCalledOnce()
    })
  })

  // ---------------------------------------------------------------------------
  // IRender.render — collects renderables
  // ---------------------------------------------------------------------------

  describe('render', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('collects renderables from all previews', () => {
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.add(makeReference(new CPos(2, 2), 'Neutral', 'e2'))

      const renderables = layer.render(makeGameActor(), wr)
      // Each preview returns an empty array currently (render pipeline deferred)
      expect(Array.isArray(renderables)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // IRenderAnnotations
  // ---------------------------------------------------------------------------

  describe('IRenderAnnotations', () => {
    it('spatiallyPartitionable is false', () => {
      expect(layer.spatiallyPartitionable).toBe(false)
    })

    it('renderAnnotations returns array', () => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
      layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))

      const annotations = layer.renderAnnotations()
      expect(Array.isArray(annotations)).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // INotifyActorDisposing — unsubscribes map events
  // ---------------------------------------------------------------------------

  describe('disposing', () => {
    it('does not throw when disposing with no subscriptions', () => {
      expect(() => layer.disposing(makeGameActor())).not.toThrow()
    })

    it('can be called multiple times safely', () => {
      layer.disposing(makeGameActor())
      layer.disposing(makeGameActor())
      // No throw = pass
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    beforeEach(() => {
      layer.createPlayers(world, { next: () => 0 })
      layer.worldLoaded(world, wr)
    })

    it('removing an already-removed actor is handled gracefully', () => {
      const p = layer.add(makeReference(new CPos(1, 1), 'Neutral', 'e1'))
      layer.remove(p)
      // Removing again should not throw (no-op if not found)
      expect(() => layer.remove(p)).not.toThrow()
    })

    it('all getter returns empty array when no actors', () => {
      expect(layer.all).toEqual([])
    })

    it('screenBounds returns empty array (world actor trait)', () => {
      const bounds = layer.screenBounds(makeGameActor(), wr)
      expect(bounds).toEqual([])
    })
  })
})
