/**
 * RevealsMap.test.ts — RevealsMap migration unit tests
 * OpenRA 对照: OpenRA.Mods.Common/Traits/RevealsMap.cs
 *
 * Tests focus on: trait lifecycle (enable/disable), relationship filtering,
 * owner change handling, dispose/kill cleanup, source type selection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Shroud — we only need addSource/removeSource tracking
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Traits/Player/Shroud.js', () => ({
  SourceType: {
    PassiveVisibility: 0,
    Shroud: 1,
    Visibility: 2,
  },
  Shroud: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  RevealsMap,
  RevealsMapInfo,
} from './RevealsMap'
import {
  PlayerRelationship,
  type PlayerStub,
  type IGameActor,
  type AttackInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces'
import { SourceType } from '../../OpenRA.Game/Traits/Player/Shroud'
import type { PPos } from '../../OpenRA.Game/MPos'
import type { Player } from '../../OpenRA.Game/Player'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a simple PPos. */
function ppos(u: number, v: number): PPos {
  return { U: u, V: v } as PPos
}

/** Create a mock Shroud stub. */
function createMockShroud(): {
  addSource: ReturnType<typeof vi.fn>
  removeSource: ReturnType<typeof vi.fn>
} {
  return {
    addSource: vi.fn(),
    removeSource: vi.fn(),
  }
}

/** Create a mock Player. */
function createMockPlayer(
  name: string,
  shroud: ReturnType<typeof createMockShroud>,
  relationshipWithImpl?: (other: Player) => number,
): Player {
  const player = {
    playerName: name,
    shroud,
    relationshipWith: relationshipWithImpl ?? vi.fn().mockReturnValue(PlayerRelationship.Ally),
    isAlliedWith: vi.fn(),
    isEnemyWith: vi.fn(),
  } as unknown as Player
  return player
}

/** Create a mock Map with projectedCells. */
function createMockMap(projectedCells: readonly PPos[]): {
  projectedCells: readonly PPos[]
} {
  return { projectedCells }
}

/** Create a mock World with players and map. */
function createMockWorld(
  players: readonly Player[],
  map: { projectedCells: readonly PPos[] },
): Record<string, unknown> {
  return { players, map }
}

/** Create a minimal IGameActor stub. */
function createMockActor(
  owner: PlayerStub | null,
  world: Record<string, unknown> | null,
  overrides: Partial<IGameActor> = {},
): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: owner ?? undefined,
    world: world ?? undefined,
    ...overrides,
  } as unknown as IGameActor
}

/** Create a minimal AttackInfo stub. */
function createMockAttackInfo(): AttackInfo {
  return { damage: {} as any, attacker: {} as IGameActor, damageState: 0, previousDamageState: 0 } as unknown as AttackInfo
}

/** Create a default set of projected cells for testing. */
function allProjectedCells(): PPos[] {
  return [ppos(0, 0), ppos(1, 0), ppos(0, 1), ppos(1, 1)]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RevealsMapInfo', () => {
  it('has default validRelationships of Ally', () => {
    const info = new RevealsMapInfo()
    expect(info.validRelationships).toBe(PlayerRelationship.Ally)
  })

  it('has default revealGeneratedShroud of true', () => {
    const info = new RevealsMapInfo()
    expect(info.revealGeneratedShroud).toBe(true)
  })

  it('accepts custom validRelationships', () => {
    const info = new RevealsMapInfo({ validRelationships: PlayerRelationship.Enemy })
    expect(info.validRelationships).toBe(PlayerRelationship.Enemy)
  })

  it('accepts custom revealGeneratedShroud', () => {
    const info = new RevealsMapInfo({ revealGeneratedShroud: false })
    expect(info.revealGeneratedShroud).toBe(false)
  })

  it('accepts requiresCondition', () => {
    const info = new RevealsMapInfo({ requiresCondition: 'powered' })
    expect(info.requiresCondition).toBe('powered')
  })

  it('accepts instanceName', () => {
    const info = new RevealsMapInfo({ instanceName: 'myReveal' })
    expect(info.instanceName).toBe('myReveal')
  })
})

describe('RevealsMap', () => {
  let cells: PPos[]
  let mockMap: ReturnType<typeof createMockMap>

  beforeEach(() => {
    cells = allProjectedCells()
    mockMap = createMockMap(cells)
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // SourceType selection
  // -------------------------------------------------------------------------

  describe('_sourceType', () => {
    it('uses SourceType.Visibility when revealGeneratedShroud is true (default)', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      // Access private _sourceType via any
      expect((rm as any)._sourceType).toBe(SourceType.Visibility)
    })

    it('uses SourceType.PassiveVisibility when revealGeneratedShroud is false', () => {
      const rm = new RevealsMap(new RevealsMapInfo({ revealGeneratedShroud: false }))
      expect((rm as any)._sourceType).toBe(SourceType.PassiveVisibility)
    })
  })

  // -------------------------------------------------------------------------
  // _projectedCells
  // -------------------------------------------------------------------------

  describe('_projectedCells', () => {
    it('returns map.projectedCells when world and map are available', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const world = createMockWorld([], mockMap)
      const actor = createMockActor(null, world)
      const result = rm['_projectedCells'](actor)
      expect(result).toBe(cells)
    })

    it('returns empty array when world is null', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const actor = createMockActor(null, null)
      const result = rm['_projectedCells'](actor)
      expect(result).toEqual([])
    })

    it('returns empty array when world has no map', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const world = { players: [] }
      const actor = createMockActor(null, world)
      const result = rm['_projectedCells'](actor)
      expect(result).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // _addCellsToPlayerShroud
  // -------------------------------------------------------------------------

  describe('_addCellsToPlayerShroud', () => {
    it('calls player.shroud.addSource when relationship matches (Ally → Ally)', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud = createMockShroud()
      const player = createMockPlayer('ally', shroud)
      const world = createMockWorld([player], mockMap)

      // Owner.relationshipWith(player) returns Ally (default)
      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)

      rm['_addCellsToPlayerShroud'](actor, player, cells)

      expect(shroud.addSource).toHaveBeenCalledTimes(1)
      expect(shroud.addSource).toHaveBeenCalledWith(rm, SourceType.Visibility, cells)
    })

    it('does NOT call addSource when relationship does not match (Ally filter vs Enemy relationship)', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud = createMockShroud()
      const player = createMockPlayer('enemy', shroud)
      const world = createMockWorld([player], mockMap)

      // Owner.relationshipWith(player) returns Enemy (overrides default)
      const owner = createMockPlayer('owner', createMockShroud(), () => PlayerRelationship.Enemy)
      const actor = createMockActor(owner, world)

      rm['_addCellsToPlayerShroud'](actor, player, cells)

      expect(shroud.addSource).not.toHaveBeenCalled()
    })

    it('uses custom validRelationships for filtering', () => {
      const rm = new RevealsMap(new RevealsMapInfo({ validRelationships: PlayerRelationship.Enemy }))
      const shroud = createMockShroud()
      const player = createMockPlayer('enemy', shroud)
      const world = createMockWorld([player], mockMap)

      // Owner.relationshipWith(player) returns Enemy → matches validRelationships=Enemy
      const owner = createMockPlayer('owner', createMockShroud(), () => PlayerRelationship.Enemy)
      const actor = createMockActor(owner, world)

      rm['_addCellsToPlayerShroud'](actor, player, cells)

      expect(shroud.addSource).toHaveBeenCalledTimes(1)
    })

    it('does NOT call addSource when owner is null', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud = createMockShroud()
      const player = createMockPlayer('any', shroud)
      const world = createMockWorld([player], mockMap)
      const actor = createMockActor(null, world)

      rm['_addCellsToPlayerShroud'](actor, player, cells)

      expect(shroud.addSource).not.toHaveBeenCalled()
    })

    it('does NOT call addSource when owner is undefined', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud = createMockShroud()
      const player = createMockPlayer('any', shroud)
      const world = createMockWorld([player], mockMap)
      const actor = createMockActor(undefined as any, world)

      rm['_addCellsToPlayerShroud'](actor, player, cells)

      expect(shroud.addSource).not.toHaveBeenCalled()
    })

    it('uses PassiveVisibility source type when revealGeneratedShroud is false', () => {
      const rm = new RevealsMap(new RevealsMapInfo({ revealGeneratedShroud: false }))
      const shroud = createMockShroud()
      const player = createMockPlayer('ally', shroud, () => PlayerRelationship.Ally)
      const world = createMockWorld([player], mockMap)

      const owner = createMockPlayer('owner', shroud)
      const actor = createMockActor(owner, world)

      rm['_addCellsToPlayerShroud'](actor, player, cells)

      expect(shroud.addSource).toHaveBeenCalledWith(rm, SourceType.PassiveVisibility, cells)
    })
  })

  // -------------------------------------------------------------------------
  // _removeCellsFromPlayerShroud
  // -------------------------------------------------------------------------

  describe('_removeCellsFromPlayerShroud', () => {
    it('calls player.shroud.removeSource with this trait instance', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud = createMockShroud()
      const player = createMockPlayer('somePlayer', shroud)

      rm['_removeCellsFromPlayerShroud'](player)

      expect(shroud.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud.removeSource).toHaveBeenCalledWith(rm)
    })
  })

  // -------------------------------------------------------------------------
  // traitEnabled
  // -------------------------------------------------------------------------

  describe('traitEnabled', () => {
    it('adds source to all players whose relationship matches', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroudAlly = createMockShroud()
      const shroudEnemy = createMockShroud()
      const ally = createMockPlayer('ally', shroudAlly)
      const enemy = createMockPlayer('enemy', shroudEnemy)
      const world = createMockWorld([ally, enemy], mockMap)

      // Owner returns Ally for ally player, Enemy for enemy player
      const owner = createMockPlayer('owner', createMockShroud(), (p: Player) => {
        return p === ally ? PlayerRelationship.Ally : PlayerRelationship.Enemy
      })
      const actor = createMockActor(owner, world)

      ;(rm as any).traitEnabled(actor)

      // Ally should get visibility
      expect(shroudAlly.addSource).toHaveBeenCalledTimes(1)
      expect(shroudAlly.addSource).toHaveBeenCalledWith(rm, SourceType.Visibility, cells)

      // Enemy should NOT get visibility (default Ally filter)
      expect(shroudEnemy.addSource).not.toHaveBeenCalled()
    })

    it('no-ops when world has no players', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const world = createMockWorld([], mockMap)
      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)

      // Should not throw
      expect(() => (rm as any).traitEnabled(actor)).not.toThrow()
    })

    it('no-ops when world is null', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, null)

      // Should not throw
      expect(() => (rm as any).traitEnabled(actor)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // traitDisabled
  // -------------------------------------------------------------------------

  describe('traitDisabled', () => {
    it('removes source from all players', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud1 = createMockShroud()
      const shroud2 = createMockShroud()
      const player1 = createMockPlayer('p1', shroud1)
      const player2 = createMockPlayer('p2', shroud2)
      const world = createMockWorld([player1, player2], mockMap)

      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)

      ;(rm as any).traitDisabled(actor)

      expect(shroud1.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud1.removeSource).toHaveBeenCalledWith(rm)
      expect(shroud2.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud2.removeSource).toHaveBeenCalledWith(rm)
    })
  })

  // -------------------------------------------------------------------------
  // onOwnerChanged
  // -------------------------------------------------------------------------

  describe('onOwnerChanged', () => {
    it('removes and re-adds sources from all players when trait is enabled', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      // Start enabled
      ;(rm as any).traitEnabled(createMockActor(null, createMockWorld([], mockMap)))

      const shroud = createMockShroud()
      const player = createMockPlayer('p', shroud, () => PlayerRelationship.Ally)
      const world = createMockWorld([player], mockMap)

      const oldOwner = createMockPlayer('oldOwner', createMockShroud())
      const newOwner = createMockPlayer('newOwner', createMockShroud())
      const actor = createMockActor(newOwner, world)

      shroud.addSource.mockClear()

      rm.onOwnerChanged(actor, oldOwner, newOwner)

      // Should call removeSource AND addSource
      expect(shroud.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud.addSource).toHaveBeenCalledTimes(1)
      expect(shroud.removeSource).toHaveBeenCalledWith(rm)
      expect(shroud.addSource).toHaveBeenCalledWith(rm, SourceType.Visibility, cells)
    })

    it('does nothing when trait is disabled', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      // Trait enabled by default (no condition). Explicitly disable.
      ;(rm as any).traitDisabled(createMockActor(null, createMockWorld([], mockMap)))

      const shroud = createMockShroud()
      const player = createMockPlayer('p', shroud)
      const world = createMockWorld([player], mockMap)

      const oldOwner = createMockPlayer('oldOwner', createMockShroud())
      const newOwner = createMockPlayer('newOwner', createMockShroud())
      const actor = createMockActor(newOwner, world)

      rm.onOwnerChanged(actor, oldOwner, newOwner)

      expect(shroud.addSource).not.toHaveBeenCalled()
      expect(shroud.removeSource).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // disposing
  // -------------------------------------------------------------------------

  describe('disposing', () => {
    it('removes source from all players', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud1 = createMockShroud()
      const shroud2 = createMockShroud()
      const player1 = createMockPlayer('p1', shroud1)
      const player2 = createMockPlayer('p2', shroud2)
      const world = createMockWorld([player1, player2], mockMap)

      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)

      rm.disposing(actor)

      expect(shroud1.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud1.removeSource).toHaveBeenCalledWith(rm)
      expect(shroud2.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud2.removeSource).toHaveBeenCalledWith(rm)
    })

    it('no-ops when world is null', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const actor = createMockActor(null, null)

      expect(() => rm.disposing(actor)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // killed
  // -------------------------------------------------------------------------

  describe('killed', () => {
    it('removes source from all players', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud = createMockShroud()
      const player = createMockPlayer('p', shroud)
      const world = createMockWorld([player], mockMap)

      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)
      const attackInfo = createMockAttackInfo()

      rm.killed(actor, attackInfo)

      expect(shroud.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud.removeSource).toHaveBeenCalledWith(rm)
    })

    it('no-ops when world is null', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const actor = createMockActor(null, null)
      const attackInfo = createMockAttackInfo()

      expect(() => rm.killed(actor, attackInfo)).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Full lifecycle test
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('enable → disable → dispose cycle works correctly', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const shroud = createMockShroud()
      const player = createMockPlayer('p', shroud, () => PlayerRelationship.Ally)
      const world = createMockWorld([player], mockMap)

      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)

      // Enable: add source
      ;(rm as any).traitEnabled(actor)
      expect(shroud.addSource).toHaveBeenCalledTimes(1)
      expect(shroud.removeSource).not.toHaveBeenCalled()

      // Disable: remove source
      shroud.addSource.mockClear()
      ;(rm as any).traitDisabled(actor)
      expect(shroud.removeSource).toHaveBeenCalledTimes(1)
      expect(shroud.addSource).not.toHaveBeenCalled()

      // Dispose: no more side effects (already disabled)
      shroud.removeSource.mockClear()
      rm.dispose()
      expect(shroud.removeSource).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // isTraitDisabled tracking
  // -------------------------------------------------------------------------

  describe('isTraitDisabled', () => {
    it('returns false when trait is initialized with no condition (enabled by default)', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      expect(rm.isTraitDisabled).toBe(false)
    })

    it('returns false after traitEnabled is called', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      // Disable first to test the transition
      const world = createMockWorld([], mockMap)
      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)

      ;(rm as any).traitDisabled(actor)
      expect(rm.isTraitDisabled).toBe(true)

      ;(rm as any).traitEnabled(actor)
      expect(rm.isTraitDisabled).toBe(false)
    })

    it('returns true after traitDisabled is called', () => {
      const rm = new RevealsMap(new RevealsMapInfo())
      const world = createMockWorld([], mockMap)
      const owner = createMockPlayer('owner', createMockShroud())
      const actor = createMockActor(owner, world)

      ;(rm as any).traitDisabled(actor)
      expect(rm.isTraitDisabled).toBe(true)
    })
  })
})
