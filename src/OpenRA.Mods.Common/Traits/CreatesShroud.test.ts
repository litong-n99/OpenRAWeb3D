/**
 * CreatesShroud.test.ts — CreatesShroud trait unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed here.
 * The CreatesShroud trait does not depend on Babylon.js directly.
 *
 * Tests focus on:
 * - CreatesShroudInfo defaults (validRelationships = Neutral | Enemy)
 * - addCellsToPlayerShroud relationship filtering
 * - removeCellsFromPlayerShroud unconditional removal
 * - range getter (cachedTraitDisabled semantics)
 * - created() collects ICreatesShroudModifier modifiers
 * - range applies percentage modifiers via applyPercentageModifiers
 * - Edge cases (null owner, zero cells)
 * - Dispose cleanup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreatesShroud, CreatesShroudInfo } from './CreatesShroud.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { PPos } from '../../OpenRA.Game/MPos.js'
import {
  PlayerRelationship,
  type IGameActor,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { SourceType } from '../../OpenRA.Game/Traits/Player/Shroud.js'
import type { Player } from '../../OpenRA.Game/Player.js'

// ---------------------------------------------------------------------------
// Test subclass — exposes protected methods for direct testing
// ---------------------------------------------------------------------------

/** Test helper: imports protected addCellsToPlayerShroud and removeCellsFromPlayerShroud to public. */
class TestCreatesShroud extends CreatesShroud {
  public override addCellsToPlayerShroud(
    self: IGameActor,
    player: Player,
    cells: readonly PPos[],
  ): void {
    super.addCellsToPlayerShroud(self, player, cells)
  }

  public override removeCellsFromPlayerShroud(
    self: IGameActor,
    player: Player,
  ): void {
    super.removeCellsFromPlayerShroud(self, player)
  }
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

interface MockShroud {
  addSource: ReturnType<typeof vi.fn>
  removeSource: ReturnType<typeof vi.fn>
}

interface MockPlayer {
  playerName: string
  shroud: MockShroud
  relationshipWith: ReturnType<typeof vi.fn>
}

function createMockPlayer(
  relationship: PlayerRelationship = PlayerRelationship.Enemy,
): MockPlayer & { shroud: MockShroud; relationshipWith: ReturnType<typeof vi.fn> } {
  return {
    playerName: 'testPlayer',
    shroud: {
      addSource: vi.fn(),
      removeSource: vi.fn(),
    },
    relationshipWith: vi.fn().mockReturnValue(relationship),
  }
}

function createMockActor(
  owner?: MockPlayer | undefined | null,
): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: owner as unknown as IGameActor['owner'],
  } as unknown as IGameActor
}

const mockCells = Object.freeze([new PPos(5, 10), new PPos(6, 10)]) as readonly PPos[]

// ---------------------------------------------------------------------------
// Tests — CreatesShroudInfo
// ---------------------------------------------------------------------------

describe('CreatesShroudInfo', () => {
  it('defaults validRelationships to Neutral | Enemy', () => {
    const info = new CreatesShroudInfo()
    expect(info.validRelationships).toBe(
      PlayerRelationship.Neutral | PlayerRelationship.Enemy,
    )
  })

  it('inherits AffectsShroudInfo defaults (range, minRange, maxHeightDelta)', () => {
    const info = new CreatesShroudInfo()
    expect(info.range.length).toBe(0)
    expect(info.minRange.length).toBe(0)
    expect(info.maxHeightDelta).toBe(-1)
  })

  it('inherits AffectsShroudInfo defaults (moveRecalculationThreshold, type)', () => {
    const info = new CreatesShroudInfo()
    expect(info.moveRecalculationThreshold.length).toBe(256)
    expect(info.type).toBe(2) // VisibilityType.Footprint
  })

  it('accepts custom validRelationships', () => {
    const info = new CreatesShroudInfo({
      validRelationships: PlayerRelationship.Enemy,
    })
    expect(info.validRelationships).toBe(PlayerRelationship.Enemy)
  })

  it('accepts custom range via base class params', () => {
    const info = new CreatesShroudInfo({ range: new WDist(4096) })
    expect(info.range.length).toBe(4096)
    expect(info.validRelationships).toBe(
      PlayerRelationship.Neutral | PlayerRelationship.Enemy,
    )
  })

  it('accepts custom requiresCondition', () => {
    const info = new CreatesShroudInfo({ requiresCondition: '!disabled' })
    expect(info.requiresCondition).toBe('!disabled')
  })

  it('passes through instanceName', () => {
    const info = new CreatesShroudInfo({ instanceName: 'gap' })
    expect(info.instanceName).toBe('gap')
  })
})

// ---------------------------------------------------------------------------
// Tests — CreatesShroud (abstract method implementations)
// ---------------------------------------------------------------------------

describe('CreatesShroud', () => {
  let trait: TestCreatesShroud
  let ownerPlayer: MockPlayer
  let targetPlayer: MockPlayer

  beforeEach(() => {
    trait = new TestCreatesShroud(
      new CreatesShroudInfo({ range: new WDist(2048) }),
    )
    ownerPlayer = createMockPlayer(PlayerRelationship.Enemy)
    targetPlayer = createMockPlayer(PlayerRelationship.Enemy)
  })

  // -----------------------------------------------------------------------
  // addCellsToPlayerShroud
  // -----------------------------------------------------------------------

  describe('addCellsToPlayerShroud', () => {
    it('calls player.shroud.addSource with SourceType.Shroud when relationship is Enemy', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Enemy)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        trait,
        SourceType.Shroud,
        mockCells,
      )
    })

    it('calls player.shroud.addSource when relationship is Neutral (also in default mask)', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Neutral)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        trait,
        SourceType.Shroud,
        mockCells,
      )
    })

    it('skips when relationship is Ally (not in default mask)', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Ally)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).not.toHaveBeenCalled()
      expect(targetPlayer.shroud.removeSource).not.toHaveBeenCalled()
    })

    it('skips when owner is undefined', () => {
      const actor = createMockActor(undefined)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).not.toHaveBeenCalled()
    })

    it('skips when owner is null', () => {
      const actor = createMockActor(null)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).not.toHaveBeenCalled()
    })

    it('respects custom validRelationships (Enemy only)', () => {
      const customTrait = new TestCreatesShroud(
        new CreatesShroudInfo({
          range: new WDist(1024),
          validRelationships: PlayerRelationship.Enemy,
        }),
      )
      const owner = createMockPlayer(PlayerRelationship.Neutral)
      const actor = createMockActor(owner)

      customTrait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      // Neutral is not in Enemy-only mask → should skip
      expect(targetPlayer.shroud.addSource).not.toHaveBeenCalled()
    })

    it('passes the trait instance as the source key', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Neutral)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      const addCall = (targetPlayer.shroud.addSource as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(addCall[0]).toBe(trait) // key is the trait instance
    })

    it('handles empty cells array', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Enemy)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        [] as readonly PPos[],
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        trait,
        SourceType.Shroud,
        [],
      )
    })

    it('queries relationshipWith once per call', () => {
      const owner = createMockPlayer(PlayerRelationship.Enemy)
      const actor = createMockActor(owner)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(owner.relationshipWith).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // removeCellsFromPlayerShroud
  // -----------------------------------------------------------------------

  describe('removeCellsFromPlayerShroud', () => {
    it('calls player.shroud.removeSource with this trait', () => {
      const actor = createMockActor(ownerPlayer)

      trait.removeCellsFromPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
      )

      expect(targetPlayer.shroud.removeSource).toHaveBeenCalledWith(trait)
    })

    it('removes unconditionally regardless of relationship', () => {
      const actor = createMockActor(ownerPlayer)
      // relationshipWith is not called in removeCellsFromPlayerShroud

      trait.removeCellsFromPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
      )

      expect(targetPlayer.shroud.removeSource).toHaveBeenCalledTimes(1)
      expect(ownerPlayer.relationshipWith).not.toHaveBeenCalled()
    })

    it('works with null owner (owner not accessed in remove)', () => {
      const actor = createMockActor(null)

      expect(() =>
        trait.removeCellsFromPlayerShroud(
          actor,
          targetPlayer as unknown as Player,
        ),
      ).not.toThrow()

      expect(targetPlayer.shroud.removeSource).toHaveBeenCalledWith(trait)
    })
  })

  // -----------------------------------------------------------------------
  // range getter
  // -----------------------------------------------------------------------

  describe('range', () => {
    it('returns info.range when not disabled', () => {
      expect(trait.range.length).toBe(2048)
    })

    it('returns WDist.Zero when cachedTraitDisabled is true', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(trait as any).cachedTraitDisabled = true
      expect(trait.range.length).toBe(0)
    })

    it('returns info.range when cachedTraitDisabled is false (explicit)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(trait as any).cachedTraitDisabled = false
      expect(trait.range.length).toBe(2048)
    })

    it('returns WDist.Zero when info.range is zero even if enabled', () => {
      const zeroTrait = new TestCreatesShroud(
        new CreatesShroudInfo({ range: WDist.Zero }),
      )
      expect(zeroTrait.range.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // created() — modifier collection
  // -----------------------------------------------------------------------

  describe('created (INotifyCreated)', () => {
    it('collects ICreatesShroudModifier values via traitsImplementing', () => {
      const mockModifierFn = vi.fn().mockReturnValue(150)
      const modifierTrait = { getCreatesShroudModifier: mockModifierFn }
      const actor = createMockActor(ownerPlayer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(actor as any).traitsImplementing = vi.fn().mockReturnValue([modifierTrait])

      trait.created(actor)

      expect((actor as any).traitsImplementing).toHaveBeenCalledWith('ICreatesShroudModifier')
      expect(mockModifierFn).toHaveBeenCalledTimes(1)
    })

    it('handles empty modifiers gracefully (no ICreatesShroudModifier traits)', () => {
      const actor = createMockActor(ownerPlayer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(actor as any).traitsImplementing = vi.fn().mockReturnValue([])

      expect(() => trait.created(actor)).not.toThrow()
    })

    it('handles missing traitsImplementing (optional method guard)', () => {
      const actor = createMockActor(ownerPlayer)
      // No traitsImplementing method at all

      expect(() => trait.created(actor)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // range getter with modifiers
  // -----------------------------------------------------------------------

  describe('range with percentage modifiers', () => {
    it('applies single modifier via applyPercentageModifiers', () => {
      const info = new CreatesShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestCreatesShroud(info)

      // Simulate a 200% modifier: 4096 * 200 / 100 = 8192
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [200]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(8192)
    })

    it('applies multiple modifiers stacking multiplicatively', () => {
      const info = new CreatesShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestCreatesShroud(info)

      // 4096 * 200 / 100 = 8192, then 8192 * 50 / 100 = 4096
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [200, 50]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(4096)
    })

    it('100 modifier leaves range unchanged', () => {
      const info = new CreatesShroudInfo({ range: new WDist(2048) })
      const modTrait = new TestCreatesShroud(info)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [100, 100, 100]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(2048)
    })

    it('returns WDist.Zero when disabled regardless of modifiers', () => {
      const info = new CreatesShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestCreatesShroud(info)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [200]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = true

      expect(modTrait.range.length).toBe(0)
    })

    it('returns info.range directly when no modifiers registered (skip computation)', () => {
      const info = new CreatesShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestCreatesShroud(info)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(4096)
    })

    it('0 modifier reduces range to 0', () => {
      const info = new CreatesShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestCreatesShroud(info)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [0]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('marks trait as disposed', () => {
      trait.dispose()
      expect(trait.disposed).toBe(true)
    })

    it('clears range modifiers', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(trait as any)._rangeModifiers = [200, 150]
      trait.dispose()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((trait as any)._rangeModifiers).toEqual([])
    })

    it('can be called multiple times safely', () => {
      trait.dispose()
      expect(() => trait.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Integration: tests that exercise the inherited AffectsShroud lifecycle
  // -----------------------------------------------------------------------

  describe('inherited lifecycle integration', () => {
    it('extends AffectsShroud', () => {
      // CreatesShroud IS-A AffectsShroud
      expect(trait).toBeInstanceOf(CreatesShroud)
      expect(typeof trait.range).toBe('object')
      // Verify it has the abstract methods implemented
      expect(typeof trait.addCellsToPlayerShroud).toBe('function')
    })
  })
})
