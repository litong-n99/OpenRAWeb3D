/**
 * RevealsShroud.test.ts — RevealsShroud trait unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are not needed here.
 * The RevealsShroud trait does not depend on Babylon.js directly.
 *
 * Tests focus on:
 * - RevealsShroudInfo defaults (validRelationships = Ally, revealGeneratedShroud = true)
 * - SourceType selection (Visibility vs PassiveVisibility based on revealGeneratedShroud)
 * - addCellsToPlayerShroud relationship filtering
 * - removeCellsFromPlayerShroud unconditional removal
 * - range getter (cachedTraitDisabled semantics)
 * - created() collects IRevealsShroudModifier modifiers
 * - range applies percentage modifiers via applyPercentageModifiers
 * - Edge cases (null owner, zero cells)
 * - Dispose cleanup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RevealsShroud, RevealsShroudInfo } from './RevealsShroud.js'
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
class TestRevealsShroud extends RevealsShroud {
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
  relationship: PlayerRelationship = PlayerRelationship.Ally,
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
    actorId: 2,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: owner as unknown as IGameActor['owner'],
  } as unknown as IGameActor
}

const mockCells = Object.freeze([new PPos(15, 25)]) as readonly PPos[]

// ---------------------------------------------------------------------------
// Tests — RevealsShroudInfo
// ---------------------------------------------------------------------------

describe('RevealsShroudInfo', () => {
  it('defaults validRelationships to Ally', () => {
    const info = new RevealsShroudInfo()
    expect(info.validRelationships).toBe(PlayerRelationship.Ally)
  })

  it('defaults revealGeneratedShroud to true', () => {
    const info = new RevealsShroudInfo()
    expect(info.revealGeneratedShroud).toBe(true)
  })

  it('inherits AffectsShroudInfo defaults (range, minRange, maxHeightDelta)', () => {
    const info = new RevealsShroudInfo()
    expect(info.range.length).toBe(0)
    expect(info.minRange.length).toBe(0)
    expect(info.maxHeightDelta).toBe(-1)
  })

  it('inherits AffectsShroudInfo defaults (moveRecalculationThreshold, type)', () => {
    const info = new RevealsShroudInfo()
    expect(info.moveRecalculationThreshold.length).toBe(256)
    expect(info.type).toBe(2) // VisibilityType.Footprint
  })

  it('accepts custom validRelationships', () => {
    const info = new RevealsShroudInfo({
      validRelationships: (PlayerRelationship.Ally | PlayerRelationship.Neutral) as PlayerRelationship,
    })
    expect(info.validRelationships).toBe(
      (PlayerRelationship.Ally | PlayerRelationship.Neutral) as PlayerRelationship,
    )
  })

  it('accepts revealGeneratedShroud = false', () => {
    const info = new RevealsShroudInfo({ revealGeneratedShroud: false })
    expect(info.revealGeneratedShroud).toBe(false)
  })

  it('accepts revealGeneratedShroud = true (explicit)', () => {
    const info = new RevealsShroudInfo({ revealGeneratedShroud: true })
    expect(info.revealGeneratedShroud).toBe(true)
  })

  it('accepts custom range via base class params', () => {
    const info = new RevealsShroudInfo({ range: new WDist(8192) })
    expect(info.range.length).toBe(8192)
  })

  it('accepts custom requiresCondition', () => {
    const info = new RevealsShroudInfo({ requiresCondition: 'mobile' })
    expect(info.requiresCondition).toBe('mobile')
  })
})

// ---------------------------------------------------------------------------
// Tests — RevealsShroud (abstract method implementations)
// ---------------------------------------------------------------------------

describe('RevealsShroud', () => {
  let trait: TestRevealsShroud
  let ownerPlayer: MockPlayer
  let targetPlayer: MockPlayer

  beforeEach(() => {
    trait = new TestRevealsShroud(
      new RevealsShroudInfo({ range: new WDist(4096) }),
    )
    ownerPlayer = createMockPlayer(PlayerRelationship.Ally)
    targetPlayer = createMockPlayer(PlayerRelationship.Ally)
  })

  // -----------------------------------------------------------------------
  // Source type selection
  // -----------------------------------------------------------------------

  describe('source type selection (revealGeneratedShroud)', () => {
    it('uses SourceType.Visibility when revealGeneratedShroud is true (default)', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Ally)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        trait,
        SourceType.Visibility,
        mockCells,
      )
    })

    it('uses SourceType.PassiveVisibility when revealGeneratedShroud is false', () => {
      const passiveTrait = new TestRevealsShroud(
        new RevealsShroudInfo({
          range: new WDist(4096),
          revealGeneratedShroud: false,
        }),
      )
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Ally)
      const actor = createMockActor(ownerPlayer)

      passiveTrait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        passiveTrait,
        SourceType.PassiveVisibility,
        mockCells,
      )
    })

    it('explicit revealGeneratedShroud = true also uses Visibility', () => {
      const visTrait = new TestRevealsShroud(
        new RevealsShroudInfo({
          range: new WDist(4096),
          revealGeneratedShroud: true,
        }),
      )
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Ally)
      const actor = createMockActor(ownerPlayer)

      visTrait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        visTrait,
        SourceType.Visibility,
        mockCells,
      )
    })
  })

  // -----------------------------------------------------------------------
  // addCellsToPlayerShroud — relationship filtering
  // -----------------------------------------------------------------------

  describe('addCellsToPlayerShroud', () => {
    it('calls player.shroud.addSource when relationship is Ally (default validRelationships)', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Ally)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        trait,
        SourceType.Visibility,
        mockCells,
      )
    })

    it('skips when relationship is Enemy (not in default Ally mask)', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Enemy)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).not.toHaveBeenCalled()
    })

    it('skips when relationship is Neutral (not in default Ally mask)', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Neutral)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      expect(targetPlayer.shroud.addSource).not.toHaveBeenCalled()
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

    it('allows both Ally and Neutral when mask includes both', () => {
      const customTrait = new TestRevealsShroud(
        new RevealsShroudInfo({
          range: new WDist(1024),
          validRelationships: (PlayerRelationship.Ally | PlayerRelationship.Neutral) as PlayerRelationship,
        }),
      )

      // Neutral owner
      const neutralOwner = createMockPlayer(PlayerRelationship.Neutral)
      const actorN = createMockActor(neutralOwner)
      customTrait.addCellsToPlayerShroud(
        actorN,
        targetPlayer as unknown as Player,
        mockCells,
      )
      expect(targetPlayer.shroud.addSource).toHaveBeenCalledTimes(1)

      // Reset for Ally test
      const allyTp = createMockPlayer(PlayerRelationship.Ally)
      allyTp.shroud = targetPlayer.shroud
      const allyOwner = createMockPlayer(PlayerRelationship.Ally)
      const actorA = createMockActor(allyOwner)
      customTrait.addCellsToPlayerShroud(
        actorA,
        allyTp as unknown as Player,
        mockCells,
      )
      expect(targetPlayer.shroud.addSource).toHaveBeenCalledTimes(2)

      // Enemy should still be excluded
      const enemyTp = createMockPlayer(PlayerRelationship.Enemy)
      enemyTp.shroud = targetPlayer.shroud
      const enemyOwner = createMockPlayer(PlayerRelationship.Enemy)
      const actorE = createMockActor(enemyOwner)
      customTrait.addCellsToPlayerShroud(
        actorE,
        enemyTp as unknown as Player,
        mockCells,
      )
      // Third call NOT made (Enemy excluded)
      expect(targetPlayer.shroud.addSource).toHaveBeenCalledTimes(2)
    })

    it('passes the trait instance as the source key', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Ally)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        mockCells,
      )

      const addCall = (targetPlayer.shroud.addSource as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(addCall[0]).toBe(trait)
    })

    it('handles empty cells array', () => {
      ownerPlayer.relationshipWith.mockReturnValue(PlayerRelationship.Ally)
      const actor = createMockActor(ownerPlayer)

      trait.addCellsToPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
        [] as readonly PPos[],
      )

      expect(targetPlayer.shroud.addSource).toHaveBeenCalledWith(
        trait,
        SourceType.Visibility,
        [],
      )
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
      // Even with Enemy relationship, remove should still be called
      const enemyOwner = createMockPlayer(PlayerRelationship.Enemy)
      const actor = createMockActor(enemyOwner)

      trait.removeCellsFromPlayerShroud(
        actor,
        targetPlayer as unknown as Player,
      )

      expect(targetPlayer.shroud.removeSource).toHaveBeenCalledTimes(1)
      expect(enemyOwner.relationshipWith).not.toHaveBeenCalled()
    })

    it('works with null owner (owner not accessed)', () => {
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
      expect(trait.range.length).toBe(4096)
    })

    it('returns WDist.Zero when cachedTraitDisabled is true', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(trait as any).cachedTraitDisabled = true
      expect(trait.range.length).toBe(0)
    })

    it('returns info.range when cachedTraitDisabled is false (explicit)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(trait as any).cachedTraitDisabled = false
      expect(trait.range.length).toBe(4096)
    })

    it('returns WDist.Zero when info.range is zero even if enabled', () => {
      const zeroTrait = new TestRevealsShroud(
        new RevealsShroudInfo({ range: WDist.Zero }),
      )
      expect(zeroTrait.range.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // created() — modifier collection
  // -----------------------------------------------------------------------

  describe('created (INotifyCreated)', () => {
    it('collects IRevealsShroudModifier values via traitsImplementing', () => {
      const mockModifierFn = vi.fn().mockReturnValue(150)
      const modifierTrait = { getRevealsShroudModifier: mockModifierFn }
      const actor = createMockActor(ownerPlayer)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(actor as any).traitsImplementing = vi.fn().mockReturnValue([modifierTrait])

      trait.created(actor)

      expect((actor as any).traitsImplementing).toHaveBeenCalledWith('IRevealsShroudModifier')
      expect(mockModifierFn).toHaveBeenCalledTimes(1)
    })

    it('handles empty modifiers gracefully (no IRevealsShroudModifier traits)', () => {
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
      const info = new RevealsShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestRevealsShroud(info)

      // Simulate a 200% modifier: 4096 * 200 / 100 = 8192
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [200]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(8192)
    })

    it('applies multiple modifiers stacking multiplicatively', () => {
      const info = new RevealsShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestRevealsShroud(info)

      // 4096 * 200 / 100 = 8192, then 8192 * 50 / 100 = 4096
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [200, 50]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(4096)
    })

    it('100 modifier leaves range unchanged', () => {
      const info = new RevealsShroudInfo({ range: new WDist(2048) })
      const modTrait = new TestRevealsShroud(info)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [100, 100, 100]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(2048)
    })

    it('returns WDist.Zero when disabled regardless of modifiers', () => {
      const info = new RevealsShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestRevealsShroud(info)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = [200]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = true

      expect(modTrait.range.length).toBe(0)
    })

    it('returns info.range directly when no modifiers registered (skip computation)', () => {
      const info = new RevealsShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestRevealsShroud(info)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any)._rangeModifiers = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(modTrait as any).cachedTraitDisabled = false

      expect(modTrait.range.length).toBe(4096)
    })

    it('0 modifier reduces range to 0', () => {
      const info = new RevealsShroudInfo({ range: new WDist(4096) })
      const modTrait = new TestRevealsShroud(info)

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
      expect(trait).toBeInstanceOf(RevealsShroud)
      expect(typeof trait.range).toBe('object')
      expect(typeof trait.addCellsToPlayerShroud).toBe('function')
    })
  })
})
