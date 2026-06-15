/**
 * HiddenUnderShroud.test.ts — HiddenUnderShroud migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderShroud.cs
 *
 * Tests focus on: state management, visibility logic (Footprint/CenterPosition/
 * GroundPosition), relationship checks, render modifier behavior.
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType.js'
import {
  PlayerRelationship,
  type IGameActor,
  type PlayerStub,
  type OccupiedCell,
  type IRenderable,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { VisibilityType } from '../AffectsShroud.js'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  __esModule: true,
}))

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

/** Minimal IRenderable stub for test assertions. */
interface MockRenderable extends IRenderable {
  _id: number
}

function makeRenderable(id: number): MockRenderable {
  return { _id: id } as unknown as MockRenderable
}

function makeWPos(x: number, y: number, z: number): WPos {
  return new WPos(x, y, z)
}

function makeCPos(x: number, y: number): CPos {
  return new CPos(x, y)
}

function makeOc(cx: number, cy: number, subCell: number = 0): OccupiedCell {
  return {
    cell: makeCPos(cx, cy),
    subCell,
  } as OccupiedCell
}

// ---------------------------------------------------------------------------
// Mock Shroud
// ---------------------------------------------------------------------------

interface MockShroud {
  isExplored: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  fogEnabled: boolean
  _disabled: boolean
}

function createMockShroud(overrides: Partial<MockShroud> = {}): MockShroud {
  return {
    isExplored: vi.fn().mockReturnValue(false),
    isVisible: vi.fn().mockReturnValue(false),
    fogEnabled: true,
    _disabled: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Mock PlayerStub
// ---------------------------------------------------------------------------

interface MockPlayer {
  id: number
  shroud: MockShroud
  relationshipWith: ReturnType<typeof vi.fn>
}

function createMockPlayer(
  id: number,
  shroud: MockShroud,
  relationship: PlayerRelationship = PlayerRelationship.None,
): MockPlayer {
  return {
    id,
    shroud,
    relationshipWith: vi.fn().mockReturnValue(relationship),
  }
}

function playerAsStub(p: MockPlayer): PlayerStub {
  return p as unknown as PlayerStub
}

// ---------------------------------------------------------------------------
// Mock IOccupySpace
// ---------------------------------------------------------------------------

interface MockOccupiesSpace {
  centerPosition: WPos
  occupiedCells: ReturnType<typeof vi.fn>
}

function createMockOccupiesSpace(
  cells: OccupiedCell[] = [],
  center: WPos = makeWPos(1024, 1024, 0),
): MockOccupiesSpace {
  return {
    centerPosition: center,
    occupiedCells: vi.fn().mockReturnValue(cells),
  }
}

// ---------------------------------------------------------------------------
// Mock IGameActor
// ---------------------------------------------------------------------------

interface MockActor {
  actorId: number
  isInWorld: boolean
  isDead: boolean
  disposed: boolean
  owner: MockPlayer | null
  world: Record<string, unknown> | null
  _traitOrDefault: ReturnType<typeof vi.fn>
}

function createMockActor(overrides: Partial<MockActor> = {}): MockActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: null,
    world: null,
    _traitOrDefault: vi.fn().mockReturnValue(null),
    ...overrides,
  }
}

function actorWithTraitOrDefault(
  mock: MockActor,
  traitMap: Record<string, unknown> = {},
): IGameActor {
  const td = vi.fn((name: string) => traitMap[name] ?? null)
  mock._traitOrDefault = td
  const raw = mock as unknown as Record<string, unknown>
  raw['traitOrDefault'] = td as unknown
  return raw as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Import (MUST be AFTER vi.mock)
// ---------------------------------------------------------------------------

import { HiddenUnderShroud, HiddenUnderShroudInfo } from './HiddenUnderShroud.js'

// ---------------------------------------------------------------------------
// Tests: HiddenUnderShroudInfo
// ---------------------------------------------------------------------------

describe('HiddenUnderShroudInfo', () => {
  it('defaults alwaysVisibleRelationships to Ally', () => {
    const info = new HiddenUnderShroudInfo()
    expect(info.alwaysVisibleRelationships).toBe(PlayerRelationship.Ally)
  })

  it('defaults type to Footprint', () => {
    const info = new HiddenUnderShroudInfo()
    expect(info.type).toBe(VisibilityType.Footprint)
  })

  it('accepts custom alwaysVisibleRelationships', () => {
    const info = new HiddenUnderShroudInfo({
      alwaysVisibleRelationships: PlayerRelationship.None,
    })
    expect(info.alwaysVisibleRelationships).toBe(PlayerRelationship.None)
  })

  it('accepts custom type', () => {
    const info = new HiddenUnderShroudInfo({ type: VisibilityType.CenterPosition })
    expect(info.type).toBe(VisibilityType.CenterPosition)
  })
})

// ---------------------------------------------------------------------------
// Tests: HiddenUnderShroud
// ---------------------------------------------------------------------------

describe('HiddenUnderShroud', () => {
  let trait: HiddenUnderShroud
  let info: HiddenUnderShroudInfo

  beforeEach(() => {
    info = new HiddenUnderShroudInfo()
    trait = new HiddenUnderShroud(info)
  })

  // -----------------------------------------------------------------------
  // isVisible — null player
  // -----------------------------------------------------------------------

  describe('isVisible', () => {
    it('returns true when byPlayer is null (observer)', () => {
      const actor = createMockActor()
      const igActor = actorWithTraitOrDefault(actor)
      expect(trait.isVisible(igActor, null)).toBe(true)
    })

    it('returns true when byPlayer is undefined', () => {
      const actor = createMockActor()
      const igActor = actorWithTraitOrDefault(actor)
      expect(trait.isVisible(igActor, undefined as unknown as PlayerStub | null)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // isVisible — relationship checks
  // -----------------------------------------------------------------------

  describe('isVisible — relationship', () => {
    it('returns true when owner is Ally with byPlayer (default)', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(false) })
      const owner = createMockPlayer(1, shroud, PlayerRelationship.Ally)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor({ owner })

      const igActor = actorWithTraitOrDefault(actor)

      const result = trait.isVisible(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
      // Should NOT call isExplored because relationship already satisfied
      expect(shroud.isExplored).not.toHaveBeenCalled()
    })

    it('returns true when relationship matches custom alwaysVisibleRelationships', () => {
      const info2 = new HiddenUnderShroudInfo({
        alwaysVisibleRelationships: PlayerRelationship.Enemy,
      })
      const trait2 = new HiddenUnderShroud(info2)
      const shroud = createMockShroud()
      const owner = createMockPlayer(1, shroud, PlayerRelationship.Enemy)
      const viewer = createMockPlayer(2, shroud, PlayerRelationship.Enemy)
      const actor = createMockActor({ owner })

      const igActor = actorWithTraitOrDefault(actor)

      // owner.relationshipWith(viewer) returns Enemy, which matches alwaysVisibleRelationships
      owner.relationshipWith.mockReturnValue(PlayerRelationship.Enemy)

      const result = trait2.isVisible(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
    })

    it('delegates to isVisibleInner when relationship does not match', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(true) })
      const owner = createMockPlayer(1, shroud, PlayerRelationship.Neutral)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor({ owner })

      const center = makeWPos(100, 200, 0)
      const occSpace = createMockOccupiesSpace([], center)

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.CenterPosition })
      const igTrait = new HiddenUnderShroud(igInfo)
      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = igTrait.isVisible(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
      expect(shroud.isExplored).toHaveBeenCalledWith(center)
    })

    it('returns false when no owner and isVisibleInner returns false', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(false) })
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor({ owner: null })

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.CenterPosition })
      const igTrait = new HiddenUnderShroud(igInfo)

      const igActor = actorWithTraitOrDefault(actor, {})

      const result = igTrait.isVisible(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — Footprint
  // -----------------------------------------------------------------------

  describe('isVisibleInner — Footprint', () => {
    it('returns true when any occupied cell is explored', () => {
      const shroud = createMockShroud()
      // Cell at CPos(5,5) → isExplored returns true
      const cellCPos = makeCPos(5, 5)
      shroud.isExplored.mockImplementation((arg: unknown) => {
        if (arg === cellCPos || (arg as CPos)?.X === 5) return true
        return false
      })

      const cells: OccupiedCell[] = [
        makeOc(0, 0),
        makeOc(5, 5),
        makeOc(10, 10),
      ]
      const occSpace = createMockOccupiesSpace(cells)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
      expect(occSpace.occupiedCells).toHaveBeenCalled()
    })

    it('returns false when no occupied cells are explored', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(false) })
      const cells: OccupiedCell[] = [makeOc(0, 0), makeOc(1, 1)]
      const occSpace = createMockOccupiesSpace(cells)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
      expect(occSpace.occupiedCells).toHaveBeenCalled()
    })

    it('returns false when no IOccupySpace trait exists', () => {
      const shroud = createMockShroud()
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const igActor = actorWithTraitOrDefault(actor, {})

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — CenterPosition
  // -----------------------------------------------------------------------

  describe('isVisibleInner — CenterPosition', () => {
    it('returns true when center position is explored', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(true) })
      const center = makeWPos(2048, 3072, 128)
      const occSpace = createMockOccupiesSpace([], center)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.CenterPosition })
      const igTrait = new HiddenUnderShroud(igInfo)
      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = (igTrait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
      expect(shroud.isExplored).toHaveBeenCalledWith(center)
    })

    it('returns false when center position is not explored', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(false) })
      const center = makeWPos(2048, 3072, 128)
      const occSpace = createMockOccupiesSpace([], center)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.CenterPosition })
      const igTrait = new HiddenUnderShroud(igInfo)
      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = (igTrait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })

    it('returns false when no center position available', () => {
      const shroud = createMockShroud()
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.CenterPosition })
      const igTrait = new HiddenUnderShroud(igInfo)
      const igActor = actorWithTraitOrDefault(actor, {})

      const result = (igTrait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — GroundPosition
  // -----------------------------------------------------------------------

  describe('isVisibleInner — GroundPosition', () => {
    it('adjusts center by distanceAboveTerrain and checks exploration', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(true) })

      const center = makeWPos(1024, 2048, 512)
      const occSpace = createMockOccupiesSpace([], center)

      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const mockMap = {
        grid: { type: MapGridType.Rectangular },
        distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(512)),
      }
      actor.world = { map: mockMap }

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.GroundPosition })
      const igTrait = new HiddenUnderShroud(igInfo)
      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = (igTrait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(true)

      expect(shroud.isExplored).toHaveBeenCalledTimes(1)
      const calledPos = (shroud.isExplored as ReturnType<typeof vi.fn>).mock.calls[0][0] as WPos
      expect(calledPos.Z).toBe(0) // 512 - 512 = 0
    })

    it('returns false when map is not available', () => {
      const shroud = createMockShroud()
      const center = makeWPos(1024, 2048, 512)
      const occSpace = createMockOccupiesSpace([], center)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor({ world: {} })

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.GroundPosition })
      const igTrait = new HiddenUnderShroud(igInfo)
      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = (igTrait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — no shroud
  // -----------------------------------------------------------------------

  describe('isVisibleInner — no shroud', () => {
    it('returns true when player has no shroud', () => {
      const viewerWithoutShroud = { id: 5 } as unknown as PlayerStub
      const actor = createMockActor()

      const igActor = actorWithTraitOrDefault(actor)
      const result = (trait as any).isVisibleInner(igActor, viewerWithoutShroud)
      expect(result).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // modifyRender
  // -----------------------------------------------------------------------

  describe('modifyRender', () => {
    it('returns original renderables when render player is null', () => {
      const renderables = [makeRenderable(1), makeRenderable(2)]
      const actor = createMockActor({ world: {} })

      const igActor = actorWithTraitOrDefault(actor)

      const result = trait.modifyRender(igActor, {} as any, renderables)
      expect(result).toBe(renderables)
    })

    it('returns empty array when not visible to render player', () => {
      const shroud = createMockShroud({ isExplored: vi.fn().mockReturnValue(false) })
      const viewer = createMockPlayer(3, shroud, PlayerRelationship.Enemy)
      const actor = createMockActor({
        world: { renderPlayer: playerAsStub(viewer) },
        owner: null,
      })

      const igInfo = new HiddenUnderShroudInfo({ type: VisibilityType.CenterPosition })
      const igTrait = new HiddenUnderShroud(igInfo)

      const igActor = actorWithTraitOrDefault(actor, {})

      const renderables = [makeRenderable(99)]
      const result = igTrait.modifyRender(igActor, {} as any, renderables)
      expect(result).not.toBe(renderables)
      expect(result.length).toBe(0)
    })

    it('returns original renderables when visible to render player', () => {
      const shroud = createMockShroud()
      const owner = createMockPlayer(1, shroud, PlayerRelationship.Ally)
      const viewer = createMockPlayer(3, shroud, PlayerRelationship.Ally)
      const actor = createMockActor({
        owner,
        world: { renderPlayer: playerAsStub(viewer) },
      })

      const igActor = actorWithTraitOrDefault(actor)

      const renderables = [makeRenderable(42)]
      const result = trait.modifyRender(igActor, {} as any, renderables)
      expect(result).toBe(renderables)
    })
  })

  // -----------------------------------------------------------------------
  // modifyScreenBounds
  // -----------------------------------------------------------------------

  describe('modifyScreenBounds', () => {
    it('returns bounds unchanged (pass-through)', () => {
      const bounds = [{ x: 0, y: 0, width: 100, height: 100 }]
      const actor = createMockActor()
      const igActor = actorWithTraitOrDefault(actor)

      const result = trait.modifyScreenBounds(igActor, {} as any, bounds)
      expect(result).toBe(bounds)
    })
  })

  // -----------------------------------------------------------------------
  // info property
  // -----------------------------------------------------------------------

  describe('info', () => {
    it('exposes the info passed to constructor', () => {
      const customInfo = new HiddenUnderShroudInfo({
        alwaysVisibleRelationships: PlayerRelationship.Neutral,
        type: VisibilityType.GroundPosition,
      })
      const t = new HiddenUnderShroud(customInfo)
      expect((t as any).info).toBe(customInfo)
      expect((t as any).info.alwaysVisibleRelationships).toBe(PlayerRelationship.Neutral)
      expect((t as any).info.type).toBe(VisibilityType.GroundPosition)
    })
  })

  // -----------------------------------------------------------------------
  // Protected helpers
  // -----------------------------------------------------------------------

  describe('_getShroud', () => {
    it('returns shroud from player', () => {
      const shroud = createMockShroud()
      const player = createMockPlayer(1, shroud)
      const result = (trait as any)._getShroud(playerAsStub(player))
      expect(result).toBe(shroud)
    })

    it('returns undefined when player has no shroud', () => {
      const playerWithoutShroud = { id: 1 } as unknown as PlayerStub
      const result = (trait as any)._getShroud(playerWithoutShroud)
      expect(result).toBeUndefined()
    })
  })

  describe('_getOccupiesSpace', () => {
    it('returns IOccupySpace via traitOrDefault', () => {
      const occSpace = createMockOccupiesSpace()
      const actor = createMockActor()
      const igActor = actorWithTraitOrDefault(actor, { IOccupySpace: occSpace })

      const result = (trait as any)._getOccupiesSpace(igActor)
      expect(result).toBe(occSpace)
    })

    it('returns null when no IOccupySpace trait', () => {
      const actor = createMockActor()
      const igActor = actorWithTraitOrDefault(actor, {})

      const result = (trait as any)._getOccupiesSpace(igActor)
      expect(result).toBeNull()
    })
  })

  describe('_getRenderPlayer', () => {
    it('returns render player from world', () => {
      const viewer = createMockPlayer(3, createMockShroud())
      const actor = createMockActor({
        world: { renderPlayer: playerAsStub(viewer) },
      })
      const igActor = actorWithTraitOrDefault(actor)

      const result = (trait as any)._getRenderPlayer(igActor)
      expect(result).toBe(playerAsStub(viewer))
    })

    it('returns null when world has no renderPlayer', () => {
      const actor = createMockActor({ world: {} })
      const igActor = actorWithTraitOrDefault(actor)

      const result = (trait as any)._getRenderPlayer(igActor)
      expect(result).toBeNull()
    })
  })
})
