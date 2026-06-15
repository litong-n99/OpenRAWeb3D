/**
 * HiddenUnderFog.test.ts — HiddenUnderFog migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Modifiers/HiddenUnderFog.cs
 *
 * Tests focus on: fog-aware visibility logic, delegation to parent when
 * fog is disabled, isVisible/isVisibleInner override behavior.
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
}

function createMockActor(overrides: Partial<MockActor> = {}): MockActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: null,
    world: null,
    ...overrides,
  }
}

function actorToIGameActor(mock: MockActor, traitMap: Record<string, unknown> = {}): IGameActor {
  const td = vi.fn((name: string) => traitMap[name] ?? null)
  const raw = mock as unknown as Record<string, unknown>
  raw['traitOrDefault'] = td as unknown
  return raw as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Import (MUST be AFTER vi.mock)
// ---------------------------------------------------------------------------

import { HiddenUnderFog, HiddenUnderFogInfo } from './HiddenUnderFog.js'
import { HiddenUnderShroudInfo } from './HiddenUnderShroud.js'

// ---------------------------------------------------------------------------
// Tests: HiddenUnderFogInfo
// ---------------------------------------------------------------------------

describe('HiddenUnderFogInfo', () => {
  it('extends HiddenUnderShroudInfo', () => {
    const info = new HiddenUnderFogInfo()
    expect(info).toBeInstanceOf(HiddenUnderShroudInfo)
  })

  it('has same defaults as HiddenUnderShroudInfo', () => {
    const info = new HiddenUnderFogInfo()
    expect(info.alwaysVisibleRelationships).toBe(PlayerRelationship.Ally)
    expect(info.type).toBe(VisibilityType.Footprint)
  })

  it('accepts custom parameters', () => {
    const info = new HiddenUnderFogInfo({
      alwaysVisibleRelationships: PlayerRelationship.Neutral,
      type: VisibilityType.CenterPosition,
    })
    expect(info.alwaysVisibleRelationships).toBe(PlayerRelationship.Neutral)
    expect(info.type).toBe(VisibilityType.CenterPosition)
  })
})

// ---------------------------------------------------------------------------
// Tests: HiddenUnderFog
// ---------------------------------------------------------------------------

describe('HiddenUnderFog', () => {
  let info: HiddenUnderFogInfo

  beforeEach(() => {
    info = new HiddenUnderFogInfo()
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('accepts HiddenUnderFogInfo', () => {
      const trait = new HiddenUnderFog(info)
      expect(trait).toBeInstanceOf(HiddenUnderFog)
      expect((trait as any).info).toBe(info)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — fog disabled (delegates to super)
  // -----------------------------------------------------------------------

  describe('isVisibleInner — fog disabled', () => {
    it('delegates to super.isVisibleInner when fog is disabled (Footprint, explored)', () => {
      const shroud = createMockShroud({ fogEnabled: false, isExplored: vi.fn().mockReturnValue(true) })
      const viewer = createMockPlayer(2, shroud)
      const cells = [makeOc(5, 5)]
      const occSpace = createMockOccupiesSpace(cells)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const trait = new HiddenUnderFog(info) // type: Footprint (default)

      // Fog disabled => should use super's isVisibleInner (anyExplored/isExplored)
      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
      // anyExplored internally calls shroud.isExplored
      expect(shroud.isExplored).toHaveBeenCalled()
      // isVisible should NOT be called (fog disabled, using super)
      expect(shroud.isVisible).not.toHaveBeenCalled()
    })

    it('delegates to super when fog is disabled (CenterPosition, not explored)', () => {
      const shroud = createMockShroud({ fogEnabled: false, isExplored: vi.fn().mockReturnValue(false) })
      const viewer = createMockPlayer(2, shroud)
      const center = makeWPos(500, 600, 0)
      const occSpace = createMockOccupiesSpace([], center)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const centerInfo = new HiddenUnderFogInfo({ type: VisibilityType.CenterPosition })
      const trait = new HiddenUnderFog(centerInfo)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
      expect(shroud.isExplored).toHaveBeenCalledWith(center)
      expect(shroud.isVisible).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — fog enabled, Footprint
  // -----------------------------------------------------------------------

  describe('isVisibleInner — fog enabled, Footprint', () => {
    it('uses anyVisible when fog is enabled and any cell is visible', () => {
      const shroud = createMockShroud({ fogEnabled: true, isVisible: vi.fn().mockReturnValue(true) })
      const viewer = createMockPlayer(2, shroud)
      const cells = [makeOc(3, 3)] // one cell, visible
      const occSpace = createMockOccupiesSpace(cells)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const trait = new HiddenUnderFog(info) // Footprint (default)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
      // anyVisible calls shroud.isVisible per cell
      expect(shroud.isVisible).toHaveBeenCalled()
      // isExplored should NOT be called (fog enabled)
      expect(shroud.isExplored).not.toHaveBeenCalled()
    })

    it('returns false when fog is enabled and no cells are visible', () => {
      const shroud = createMockShroud({ fogEnabled: true, isVisible: vi.fn().mockReturnValue(false) })
      const viewer = createMockPlayer(2, shroud)
      const cells = [makeOc(7, 7), makeOc(8, 8)]
      const occSpace = createMockOccupiesSpace(cells)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const trait = new HiddenUnderFog(info)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
      expect(shroud.isVisible).toHaveBeenCalledTimes(2)
    })

    it('returns false when fog enabled and no IOccupySpace', () => {
      const shroud = createMockShroud({ fogEnabled: true })
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, {})

      const trait = new HiddenUnderFog(info)
      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — fog enabled, CenterPosition
  // -----------------------------------------------------------------------

  describe('isVisibleInner — fog enabled, CenterPosition', () => {
    it('uses shroud.isVisible when fog is enabled and center is visible', () => {
      const shroud = createMockShroud({
        fogEnabled: true,
        isVisible: vi.fn().mockReturnValue(true),
      })
      const viewer = createMockPlayer(2, shroud)
      const center = makeWPos(1000, 2000, 0)
      const occSpace = createMockOccupiesSpace([], center)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const centerInfo = new HiddenUnderFogInfo({ type: VisibilityType.CenterPosition })
      const trait = new HiddenUnderFog(centerInfo)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
      expect(shroud.isVisible).toHaveBeenCalledWith(center)
      expect(shroud.isExplored).not.toHaveBeenCalled()
    })

    it('returns false when fog enabled and center is not visible', () => {
      const shroud = createMockShroud({
        fogEnabled: true,
        isVisible: vi.fn().mockReturnValue(false),
      })
      const viewer = createMockPlayer(2, shroud)
      const center = makeWPos(1000, 2000, 0)
      const occSpace = createMockOccupiesSpace([], center)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const centerInfo = new HiddenUnderFogInfo({ type: VisibilityType.CenterPosition })
      const trait = new HiddenUnderFog(centerInfo)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })

    it('returns false when fog enabled and no center position', () => {
      const shroud = createMockShroud({ fogEnabled: true })
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor, {})

      const centerInfo = new HiddenUnderFogInfo({ type: VisibilityType.CenterPosition })
      const trait = new HiddenUnderFog(centerInfo)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — fog enabled, GroundPosition
  // -----------------------------------------------------------------------

  describe('isVisibleInner — fog enabled, GroundPosition', () => {
    it('adjusts center by distanceAboveTerrain and uses isVisible', () => {
      const shroud = createMockShroud({
        fogEnabled: true,
        isVisible: vi.fn().mockReturnValue(true),
      })

      const center = makeWPos(1024, 2048, 256)
      const occSpace = createMockOccupiesSpace([], center)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor()

      const mockMap = {
        grid: { type: MapGridType.Rectangular },
        distanceAboveTerrain: vi.fn().mockReturnValue(new WDist(256)),
      }
      actor.world = { map: mockMap }

      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const groundInfo = new HiddenUnderFogInfo({ type: VisibilityType.GroundPosition })
      const trait = new HiddenUnderFog(groundInfo)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(true)

      // Verify isVisible was called with ground-level position (z=0)
      const calledPos = (shroud.isVisible as ReturnType<typeof vi.fn>).mock.calls[0][0] as WPos
      expect(calledPos.Z).toBe(0)
    })

    it('returns false when map is not available for GroundPosition', () => {
      const shroud = createMockShroud({ fogEnabled: true })
      const center = makeWPos(1024, 2048, 256)
      const occSpace = createMockOccupiesSpace([], center)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor({ world: {} })

      const igActor = actorToIGameActor(actor, { IOccupySpace: occSpace })

      const groundInfo = new HiddenUnderFogInfo({ type: VisibilityType.GroundPosition })
      const trait = new HiddenUnderFog(groundInfo)

      const result = (trait as any).isVisibleInner(igActor, playerAsStub(viewer))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // isVisibleInner — no shroud
  // -----------------------------------------------------------------------

  describe('isVisibleInner — no shroud', () => {
    it('returns true when player has no shroud (fog path)', () => {
      const viewerWithoutShroud = { id: 5 } as unknown as PlayerStub
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor)

      const trait = new HiddenUnderFog(info)
      const result = (trait as any).isVisibleInner(igActor, viewerWithoutShroud)
      expect(result).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // isVisible — inherited behavior still works
  // -----------------------------------------------------------------------

  describe('isVisible — inherited', () => {
    it('returns true when byPlayer is null', () => {
      const trait = new HiddenUnderFog(info)
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor)
      expect(trait.isVisible(igActor, null)).toBe(true)
    })

    it('returns true for Ally relationship (default alwaysVisibleRelationships)', () => {
      const shroud = createMockShroud()
      const owner = createMockPlayer(1, shroud, PlayerRelationship.Ally)
      const viewer = createMockPlayer(2, shroud)
      const actor = createMockActor({ owner })
      const igActor = actorToIGameActor(actor)

      const trait = new HiddenUnderFog(info)
      const result = trait.isVisible(igActor, playerAsStub(viewer))
      expect(result).toBe(true)
    })

    it('delegates to isVisibleInner when relationship does not match', () => {
      const shroud = createMockShroud({
        fogEnabled: true,
        isVisible: vi.fn().mockReturnValue(false),
      })
      const owner = createMockPlayer(1, shroud, PlayerRelationship.Enemy)
      const viewer = createMockPlayer(2, shroud, PlayerRelationship.Enemy)
      const actor = createMockActor({ owner })
      const igActor = actorToIGameActor(actor, {})

      const centerInfo = new HiddenUnderFogInfo({ type: VisibilityType.CenterPosition })
      const trait = new HiddenUnderFog(centerInfo)

      const result = trait.isVisible(igActor, playerAsStub(viewer))
      // No IOccupySpace => isVisibleInner => _getCenterPosition returns null => false
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // modifyRender — inherited
  // -----------------------------------------------------------------------

  describe('modifyRender — inherited', () => {
    it('returns original renderables when visible to render player', () => {
      const shroud = createMockShroud()
      const owner = createMockPlayer(1, shroud, PlayerRelationship.Ally)
      const viewer = createMockPlayer(3, shroud, PlayerRelationship.Ally)
      const actor = createMockActor({
        owner,
        world: { renderPlayer: playerAsStub(viewer) },
      })
      const igActor = actorToIGameActor(actor)

      const trait = new HiddenUnderFog(info)
      const renderables = [{ _id: 1 } as any, { _id: 2 } as any]
      const result = trait.modifyRender(igActor, {} as any, renderables)
      expect(result).toBe(renderables)
    })
  })

  // -----------------------------------------------------------------------
  // modifyScreenBounds — inherited (pass-through)
  // -----------------------------------------------------------------------

  describe('modifyScreenBounds — inherited', () => {
    it('passes through bounds unchanged', () => {
      const trait = new HiddenUnderFog(info)
      const bounds = [{ x: 10, y: 20, width: 30, height: 40 }]
      const actor = createMockActor()
      const igActor = actorToIGameActor(actor)

      const result = trait.modifyScreenBounds(igActor, {} as any, bounds)
      expect(result).toBe(bounds)
    })
  })
})
