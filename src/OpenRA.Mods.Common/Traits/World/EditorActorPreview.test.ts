/**
 * EditorActorPreview.test.ts — EditorActorPreview migration unit tests
 *
 * No @babylonjs/core dependency — EditorActorPreview is a pure data model.
 * Tests focus on: construction, properties, init management, footprint,
 * position calculation, equality, save/export, lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  EditorActorPreview,
  type ActorReferenceMap,
  type LocationInit,
  type OwnerInit,
  type FactionInit,
  type HealthInit,
  type SubCellInit,
  type CenterPositionInit,
} from './EditorActorPreview.js'

import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WVec } from '../../../OpenRA.Game/WVec.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'
import { PlayerReference } from '../../../OpenRA.Game/Map/PlayerReference.js'
import type { IOccupySpaceInfo } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { WorldRendererStub, ActorInfoStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorldRenderer(): WorldRendererStub {
  return {}
}

function makeActorInfo(name: string = 'e1'): ActorInfoStub {
  return { name }
}

function makePlayer(name: string = 'Neutral', faction: string = 'Random'): PlayerReference {
  return new PlayerReference({ name, faction, color: 0xffff0000 })
}

function makeReference(location?: CPos): ActorReferenceMap {
  const ref = new Map<string, unknown>()
  if (location) {
    ref.set('LocationInit', {
      type: 'LocationInit',
      value: location,
    } satisfies LocationInit)
  }
  return ref
}

function makeOccupySpaceInfo(
  cells: ReadonlyMap<CPos, import('../../../OpenRA.Game/Traits/SubCell.js').SubCell>,
): IOccupySpaceInfo {
  return {
    occupiedCells: () => cells,
    sharesCell: false,
  } as unknown as IOccupySpaceInfo
}

// ---------------------------------------------------------------------------
// EditorActorPreview tests
// ---------------------------------------------------------------------------

describe('EditorActorPreview', () => {
  let wr: WorldRendererStub
  let info: ActorInfoStub

  beforeEach(() => {
    wr = makeWorldRenderer()
    info = makeActorInfo('e1')
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('assigns id, type, info, and descriptiveName', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(5, 10))
      const preview = new EditorActorPreview(wr, 'actor-1', ref, player, info)

      expect(preview.id).toBe('actor-1')
      expect(preview.type).toBe('e1')
      expect(preview.info).toBe(info)
      expect(preview.descriptiveName).toBe('e1')
    })

    it('uses provided descriptiveName when given', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(0, 0))
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info, 'Rifle Infantry')

      expect(preview.descriptiveName).toBe('Rifle Infantry')
    })

    it('auto-inserts OwnerInit and FactionInit when not present', () => {
      const player = makePlayer('GDI', 'gdi')
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: new CPos(3, 7),
      } satisfies LocationInit)

      const preview = new EditorActorPreview(wr, 'actor-1', ref, player, info)

      const ownerInit = preview.getInitOrDefault<OwnerInit>('OwnerInit')
      expect(ownerInit).toBeDefined()
      expect(ownerInit!.value).toBe('GDI')

      const factionInit = preview.getInitOrDefault<FactionInit>('FactionInit')
      expect(factionInit).toBeDefined()
      expect(factionInit!.value).toBe('gdi')
    })

    it('does not overwrite existing OwnerInit and FactionInit', () => {
      const player = makePlayer('GDI', 'gdi')
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: new CPos(0, 0),
      } satisfies LocationInit)
      ref.set('OwnerInit', {
        type: 'OwnerInit',
        value: 'Nod',
      } satisfies OwnerInit)
      ref.set('FactionInit', {
        type: 'FactionInit',
        value: 'nod',
      } satisfies FactionInit)

      const preview = new EditorActorPreview(wr, 'actor-1', ref, player, info)

      const ownerInit = preview.getInitOrDefault<OwnerInit>('OwnerInit')
      expect(ownerInit!.value).toBe('Nod') // preserved

      const factionInit = preview.getInitOrDefault<FactionInit>('FactionInit')
      expect(factionInit!.value).toBe('nod') // preserved
    })

    it('computes center position from LocationInit', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(4, 8))
      const preview = new EditorActorPreview(wr, 'actor-1', ref, player, info)

      // For rectangular grid at tileScale=1024, cell (4,8) center = (4*1024+512, 8*1024+512)
      expect(preview.centerPosition.X).toBe(4 * 1024 + 512)
      expect(preview.centerPosition.Y).toBe(8 * 1024 + 512)
    })

    it('uses CenterPositionInit when present (takes priority over LocationInit)', () => {
      const player = makePlayer()
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: new CPos(5, 5),
      } satisfies LocationInit)
      ref.set('CenterPositionInit', {
        type: 'CenterPositionInit',
        value: new WPos(9999, 8888, 100),
      } satisfies CenterPositionInit)

      const preview = new EditorActorPreview(wr, 'actor-1', ref, player, info)

      expect(preview.centerPosition.X).toBe(9999)
      expect(preview.centerPosition.Y).toBe(8888)
      expect(preview.centerPosition.Z).toBe(100)
    })

    it('throws when neither LocationInit nor CenterPositionInit is present', () => {
      const player = makePlayer()
      const ref = new Map<string, unknown>() // empty

      expect(() => new EditorActorPreview(wr, 'actor-1', ref, player, info))
        .toThrow(/must define LocationInit or CenterPositionInit/)
    })

    it('defaults location to CPos.Zero when no LocationInit', () => {
      const player = makePlayer()
      const ref = new Map<string, unknown>()
      ref.set('CenterPositionInit', {
        type: 'CenterPositionInit',
        value: WPos.Zero,
      } satisfies CenterPositionInit)

      const preview = new EditorActorPreview(wr, 'actor-1', ref, player, info)
      expect(preview.location.X).toBe(0)
      expect(preview.location.Y).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  describe('properties', () => {
    it('Selected defaults to false', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)
      expect(preview.selected).toBe(false)
    })

    it('Selected can be set to true', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)
      preview.selected = true
      expect(preview.selected).toBe(true)
    })

    it('Owner can be changed', () => {
      const player1 = makePlayer('GDI', 'gdi')
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player1, info)

      const player2 = makePlayer('Nod', 'nod')
      preview.owner = player2
      expect(preview.owner.name).toBe('Nod')
    })

    it('tooltip includes name, owner, faction, id, and type', () => {
      const player = makePlayer('GDI', 'gdi')
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'my-id', ref, player, info)

      const tip = preview.tooltip
      expect(tip).toContain('e1')
      expect(tip).toContain('GDI')
      expect(tip).toContain('gdi')
      expect(tip).toContain('my-id')
    })

    it('radarColor defaults to owner color', () => {
      const player = makePlayer('GDI', 'gdi')
      player.color = 0xff00ff00
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.radarColor).toBe(0xff00ff00)
    })
  })

  // -----------------------------------------------------------------------
  // WithId (clone with new ID)
  // -----------------------------------------------------------------------

  describe('withId', () => {
    it('creates a new preview with the same config and new ID', () => {
      const player = makePlayer('GDI', 'gdi')
      const ref = makeReference(new CPos(5, 5))
      const preview = new EditorActorPreview(wr, 'original', ref, player, info)

      const cloned = preview.withId('copy-1')
      expect(cloned.id).toBe('copy-1')
      expect(cloned.type).toBe(preview.type)
      expect(cloned.owner.name).toBe(preview.owner.name)

      // Original should be unchanged
      expect(preview.id).toBe('original')
    })

    it('cloned preview has updated FactionInit matching owner', () => {
      const player = makePlayer('GDI', 'gdi')
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: new CPos(0, 0),
      } satisfies LocationInit)
      // Deliberately set a different faction
      ref.set('FactionInit', {
        type: 'FactionInit',
        value: 'nod',
      } satisfies FactionInit)

      const preview = new EditorActorPreview(wr, 'original', ref, player, info)
      const cloned = preview.withId('copy-1')

      const factionInit = cloned.getInitOrDefault<FactionInit>('FactionInit')
      expect(factionInit!.value).toBe('gdi') // updated to match owner
    })
  })

  // -----------------------------------------------------------------------
  // UpdateFromMove / UpdateFromCellChange
  // -----------------------------------------------------------------------

  describe('updateFromMove', () => {
    it('recalculates position and footprint after location change', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(2, 3))
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      const initPosBefore = preview.centerPosition
      expect(initPosBefore.X).toBe(2 * 1024 + 512)

      // Change location
      preview.addInit('LocationInit', {
        type: 'LocationInit',
        value: new CPos(10, 20),
      } satisfies LocationInit)

      preview.updateFromMove()

      expect(preview.location.X).toBe(10)
      expect(preview.location.Y).toBe(20)
      expect(preview.centerPosition.X).toBe(10 * 1024 + 512)
      expect(preview.centerPosition.Y).toBe(20 * 1024 + 512)
    })
  })

  describe('updateFromCellChange', () => {
    it('recalculates center position on terrain change', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(1, 1))
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      // Simulate terrain change with a new CenterPositionInit
      preview.replaceInit('CenterPositionInit', {
        type: 'CenterPositionInit',
        value: new WPos(5000, 6000, 200),
      } satisfies CenterPositionInit)

      preview.updateFromCellChange()

      expect(preview.centerPosition.X).toBe(5000)
      expect(preview.centerPosition.Y).toBe(6000)
      expect(preview.centerPosition.Z).toBe(200)
    })
  })

  // -----------------------------------------------------------------------
  // Init management
  // -----------------------------------------------------------------------

  describe('init management', () => {
    let preview: EditorActorPreview

    beforeEach(() => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      preview = new EditorActorPreview(wr, 'a1', ref, player, info)
    })

    it('addInit — adds a new init', () => {
      preview.addInit('HealthInit', {
        type: 'HealthInit',
        value: 75,
      } satisfies HealthInit)

      const health = preview.getInitOrDefault<HealthInit>('HealthInit')
      expect(health).toBeDefined()
      expect(health!.value).toBe(75)
    })

    it('replaceInit — overwrites existing init', () => {
      preview.addInit('HealthInit', {
        type: 'HealthInit',
        value: 50,
      } satisfies HealthInit)

      preview.replaceInit('HealthInit', {
        type: 'HealthInit',
        value: 90,
      } satisfies HealthInit)

      const health = preview.getInitOrDefault<HealthInit>('HealthInit')
      expect(health!.value).toBe(90)
    })

    it('removeInit — removes an init', () => {
      preview.addInit('HealthInit', {
        type: 'HealthInit',
        value: 100,
      } satisfies HealthInit)

      expect(preview.getInitOrDefault('HealthInit')).toBeDefined()

      preview.removeInit('HealthInit')
      expect(preview.getInitOrDefault('HealthInit')).toBeUndefined()
    })

    it('removeInits — returns count of removed inits', () => {
      preview.addInit('HealthInit', {
        type: 'HealthInit',
        value: 100,
      } satisfies HealthInit)

      const count = preview.removeInits('HealthInit')
      expect(count).toBe(1)
      expect(preview.getInitOrDefault('HealthInit')).toBeUndefined()
    })

    it('removeInits — returns 0 when no matching inits', () => {
      const count = preview.removeInits('HealthInit')
      expect(count).toBe(0)
    })

    it('getInitOrDefault — returns undefined for unknown init type', () => {
      const result = preview.getInitOrDefault('NonExistentInit')
      expect(result).toBeUndefined()
    })

    it('getInits — returns array of matching inits', () => {
      preview.addInit('SubCellInit', {
        type: 'SubCellInit',
        value: SubCell.First,
      } satisfies SubCellInit)

      const inits = preview.getInits<SubCellInit>('SubCellInit')
      expect(inits).toHaveLength(1)
      expect(inits[0]!.value).toBe(SubCell.First)
    })

    it('getInits — returns empty array for unknown type', () => {
      const inits = preview.getInits('NonExistent')
      expect(inits).toEqual([])
    })

    it('getReference — returns a copy of the internal map', () => {
      const ref = preview.getReference()
      expect(ref).toBeInstanceOf(Map)
      expect(ref.has('OwnerInit')).toBe(true)
      expect(ref.has('FactionInit')).toBe(true)

      // Modifying the copy does not affect the original
      ref.delete('OwnerInit')
      expect(preview.getInitOrDefault('OwnerInit')).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // Footprint
  // -----------------------------------------------------------------------

  describe('footprint', () => {
    it('default footprint is a single full cell at Location', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(3, 3))
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.footprint.size).toBe(1)
      const [cell, subCell] = preview.footprint.entries().next().value!
      expect(cell.X).toBe(3)
      expect(cell.Y).toBe(3)
      expect(subCell).toBe(SubCell.FullCell)
    })

    it('uses IOccupySpaceInfo for multi-cell footprint when set', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(2, 2))
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      const cells = new Map<CPos, import('../../../OpenRA.Game/Traits/SubCell.js').SubCell>([
        [new CPos(2, 2), SubCell.FullCell],
        [new CPos(3, 2), SubCell.FullCell],
        [new CPos(2, 3), SubCell.FullCell],
        [new CPos(3, 3), SubCell.FullCell],
      ])
      preview.setOccupySpaceInfo(makeOccupySpaceInfo(cells))
      preview.updateFromMove()

      expect(preview.footprint.size).toBe(4)
    })
  })

  // -----------------------------------------------------------------------
  // Render methods
  // -----------------------------------------------------------------------

  describe('render methods', () => {
    it('render returns empty array (deferred preview pipeline)', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.render()).toEqual([])
    })

    it('renderWithOffset returns empty array', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.renderWithOffset(new WVec(100, 200, 0))).toEqual([])
    })

    it('renderAnnotations returns empty array (deferred SelectionBox)', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.renderAnnotations()).toEqual([])
    })

    it('tick does not throw (deferred animation pipeline)', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(() => preview.tick()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Bounds
  // -----------------------------------------------------------------------

  describe('bounds', () => {
    it('returns a default rectangle', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      const b = preview.bounds
      expect(b.x).toBe(0)
      expect(b.y).toBe(0)
      expect(b.width).toBe(64)
      expect(b.height).toBe(64)
    })
  })

  // -----------------------------------------------------------------------
  // Save / Export
  // -----------------------------------------------------------------------

  describe('save', () => {
    it('returns a JSON-compatible object with inits', () => {
      const player = makePlayer('GDI', 'gdi')
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: new CPos(5, 5),
      } satisfies LocationInit)

      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)
      preview.addInit('HealthInit', {
        type: 'HealthInit',
        value: 50,
      } satisfies HealthInit)

      const saved = preview.save()
      expect(saved).toBeTypeOf('object')
      expect(saved['LocationInit' as keyof typeof saved]).toBeDefined()
      expect(saved['HealthInit' as keyof typeof saved]).toBeDefined()
    })

    it('filters out FactionInit matching owner faction', () => {
      const player = makePlayer('Nod', 'nod')
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: CPos.Zero,
      } satisfies LocationInit)
      // FactionInit matching owner faction — should be filtered
      ref.set('FactionInit', {
        type: 'FactionInit',
        value: 'nod',
      } satisfies FactionInit)

      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      const saved = preview.save()
      expect(saved['FactionInit' as keyof typeof saved]).toBeUndefined()
    })

    it('filters out HealthInit with value 100', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)
      preview.addInit('HealthInit', {
        type: 'HealthInit',
        value: 100,
      } satisfies HealthInit)

      const saved = preview.save()
      expect(saved['HealthInit' as keyof typeof saved]).toBeUndefined()
    })

    it('keeps HealthInit with non-100 value', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)
      preview.addInit('HealthInit', {
        type: 'HealthInit',
        value: 75,
      } satisfies HealthInit)

      const saved = preview.save()
      expect(saved['HealthInit' as keyof typeof saved]).toBeDefined()
    })
  })

  describe('export', () => {
    it('returns a deep copy of the init map', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      const exported = preview.export()
      expect(exported).toBeInstanceOf(Map)
      expect(exported.size).toBeGreaterThanOrEqual(3) // LocationInit + OwnerInit + FactionInit

      // Modifying the exported map does not affect the original
      exported.set('ExtraInit', { type: 'ExtraInit', value: 'test' })
      expect(preview.getInitOrDefault('ExtraInit')).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // Equality
  // -----------------------------------------------------------------------

  describe('equals', () => {
    it('two previews with same ID are equal', () => {
      const player = makePlayer()
      const ref1 = makeReference(new CPos(1, 1))
      const ref2 = makeReference(new CPos(5, 5))

      const p1 = new EditorActorPreview(wr, 'SAME_ID', ref1, player, info)
      const p2 = new EditorActorPreview(wr, 'SAME_ID', ref2, player, info)

      expect(p1.equals(p2)).toBe(true)
    })

    it('two previews with different IDs are not equal', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)

      const p1 = new EditorActorPreview(wr, 'id-1', ref, player, info)
      const p2 = new EditorActorPreview(wr, 'id-2', ref, player, info)

      expect(p1.equals(p2)).toBe(false)
    })

    it('equals is case-insensitive', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)

      const p1 = new EditorActorPreview(wr, 'Actor-A', ref, player, info)
      const p2 = new EditorActorPreview(wr, 'actor-a', ref, player, info)

      expect(p1.equals(p2)).toBe(true)
    })

    it('equals with null returns false', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.equals(null)).toBe(false)
      expect(preview.equals(undefined)).toBe(false)
    })

    it('equals with itself returns true (reference equality)', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.equals(preview)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // getHashCode
  // -----------------------------------------------------------------------

  describe('getHashCode', () => {
    it('same ID produces same hash', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)

      const p1 = new EditorActorPreview(wr, 'test-id', ref, player, info)
      const p2 = new EditorActorPreview(wr, 'test-id', ref, player, info)

      expect(p1.getHashCode()).toBe(p2.getHashCode())
    })

    it('different IDs produce different hashes (with high probability)', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)

      const p1 = new EditorActorPreview(wr, 'alpha', ref, player, info)
      const p2 = new EditorActorPreview(wr, 'beta', ref, player, info)

      expect(p1.getHashCode()).not.toBe(p2.getHashCode())
    })

    it('hash is case-insensitive', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)

      const p1 = new EditorActorPreview(wr, 'MyId', ref, player, info)
      const p2 = new EditorActorPreview(wr, 'myid', ref, player, info)

      expect(p1.getHashCode()).toBe(p2.getHashCode())
    })

    it('hash for empty id returns 0', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, '', ref, player, info)

      expect(preview.getHashCode()).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // toString
  // -----------------------------------------------------------------------

  describe('toString', () => {
    it('returns "Info.Name ID" format', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'actor-42', ref, player, info)

      expect(preview.toString()).toBe('e1 actor-42')
    })
  })

  // -----------------------------------------------------------------------
  // Lifecycle notifications (deferred stubs)
  // -----------------------------------------------------------------------

  describe('addedToEditor / removedFromEditor', () => {
    it('addedToEditor does not throw (deferred)', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(() => preview.addedToEditor()).not.toThrow()
    })

    it('removedFromEditor does not throw (deferred)', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(() => preview.removedFromEditor()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // centerPosition setter
  // -----------------------------------------------------------------------

  describe('centerPosition setter', () => {
    it('can directly set centerPosition', () => {
      const player = makePlayer()
      const ref = makeReference(CPos.Zero)
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      const newPos = new WPos(12345, 67890, 500)
      preview.centerPosition = newPos

      expect(preview.centerPosition.X).toBe(12345)
      expect(preview.centerPosition.Y).toBe(67890)
      expect(preview.centerPosition.Z).toBe(500)
    })
  })

  // -----------------------------------------------------------------------
  // SubCellInit center position offset
  // -----------------------------------------------------------------------

  describe('sub-cell center position', () => {
    it('sub-cell First (index 1) offsets position toward top-left', () => {
      const player = makePlayer()
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: new CPos(4, 4),
      } satisfies LocationInit)
      ref.set('SubCellInit', {
        type: 'SubCellInit',
        value: SubCell.First,
      } satisfies SubCellInit)

      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      // First sub-cell offset: (-tileScale/4, -tileScale/4) = (-256, -256)
      // Center = cell*1024 + 512 + offset
      const expectedX = 4 * 1024 + 512 - 256 // 4352
      const expectedY = 4 * 1024 + 512 - 256 // 4352
      expect(preview.centerPosition.X).toBe(expectedX)
      expect(preview.centerPosition.Y).toBe(expectedY)
    })

    it('sub-cell FullCell uses cell center with no offset', () => {
      const player = makePlayer()
      const ref = new Map<string, unknown>()
      ref.set('LocationInit', {
        type: 'LocationInit',
        value: new CPos(0, 0),
      } satisfies LocationInit)
      ref.set('SubCellInit', {
        type: 'SubCellInit',
        value: SubCell.FullCell,
      } satisfies SubCellInit)

      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      // FullCell uses center — same as Any/default
      expect(preview.centerPosition.X).toBe(512)
      expect(preview.centerPosition.Y).toBe(512)
    })

    it('sub-cell Any/FullCell uses cell center', () => {
      const player = makePlayer()
      const ref = makeReference(new CPos(1, 1))
      const preview = new EditorActorPreview(wr, 'a1', ref, player, info)

      expect(preview.centerPosition.X).toBe(1024 + 512)
      expect(preview.centerPosition.Y).toBe(1024 + 512)
    })
  })
})
