/**
 * Disguise.test.ts — Disguise migration unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Disguise,
  DisguiseTooltip,
  DisguiseOrderTargeter,
  RevealDisguiseType,
  createDisguiseInfo,
  type DisguiseInfo,
  type INotifyDemolition,
} from './Disguise.js'
import {
  PlayerRelationship,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkActor(id: number, name = 'spy', ownerName = 'player1'): any {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name, traitInfos() { return [] } },
    owner: {
      playerName: ownerName,
      isAlliedWith() { return false },
      relationshipWith(other: any): number {
        return other?.playerName === ownerName ? PlayerRelationship.Ally : PlayerRelationship.Enemy
      },
    },
    traitsImplementing(_traitName: string): any[] { return [] },
    getTrait(name: string): any {
      if (name === 'Disguise') return undefined
      return undefined
    },
    grantCondition(_c: string): number { return 100 },
    revokeCondition(_t: number): number { return -1 },
    location: { X: 5, Y: 5 },
  }
}

function mkTooltipActor(id: number, name = 'rifle', ownerName = 'player2'): any {
  return {
    ...mkActor(id, name, ownerName),
    traitsImplementing(traitName: string): any[] {
      if (traitName === 'ITooltip') {
        return [{
          owner: { playerName: ownerName },
          tooltipInfo: {
            isOwnerRowVisible: true,
            tooltipForPlayerStance() { return name },
          },
          tooltipForPlayerStance() { return name },
          isOwnerRowVisible: true,
        }]
      }
      return []
    },
  }
}

function mkInfo(overrides?: Partial<DisguiseInfo>): DisguiseInfo {
  return createDisguiseInfo(overrides)
}

// ---------------------------------------------------------------------------
// RevealDisguiseType tests
// ---------------------------------------------------------------------------

describe('RevealDisguiseType', () => {
  it('has distinct flag values', () => {
    expect(RevealDisguiseType.None).toBe(0)
    expect(RevealDisguiseType.Attack).toBe(1)
    expect(RevealDisguiseType.Damaged).toBe(2)
    expect(RevealDisguiseType.Load).toBe(4)
    expect(RevealDisguiseType.Unload).toBe(8)
    expect(RevealDisguiseType.Infiltrate).toBe(16)
    expect(RevealDisguiseType.Demolish).toBe(32)
    expect(RevealDisguiseType.Move).toBe(64)
  })

  it('supports bitwise OR combining', () => {
    const combined = RevealDisguiseType.Attack | RevealDisguiseType.Damaged
    expect(combined & RevealDisguiseType.Attack).toBeTruthy()
    expect(combined & RevealDisguiseType.Damaged).toBeTruthy()
    expect(combined & RevealDisguiseType.Move).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// DisguiseInfo tests
// ---------------------------------------------------------------------------

describe('DisguiseInfo', () => {
  it('has correct defaults', () => {
    const info = mkInfo()
    expect(info.voice).toBe('Action')
    expect(info.cursor).toBe('ability')
    expect(info.revealDisguiseOn).toBe(RevealDisguiseType.Attack)
    expect(info.targetTypes.has('Disguise')).toBe(true)
    expect(info.disguisedCondition).toBeNull()
  })

  it('allows override of defaults', () => {
    const info = mkInfo({ voice: 'Custom', cursor: 'custom-cursor' })
    expect(info.voice).toBe('Custom')
    expect(info.cursor).toBe('custom-cursor')
  })
})

// ---------------------------------------------------------------------------
// Disguise tests
// ---------------------------------------------------------------------------

describe('Disguise', () => {
  let disguise: Disguise
  let self: any
  let info: DisguiseInfo

  beforeEach(() => {
    info = mkInfo({ disguisedCondition: 'Disguised' })
    self = mkActor(1, 'spy', 'player1')
    self.getTrait = (name: string) => name === 'Disguise' ? disguise : undefined
    disguise = new Disguise(self, info)
  })

  it('initial state: not disguised, asActor is self', () => {
    expect(disguise.disguised).toBe(false)
    expect(disguise.asPlayer).toBeNull()
    expect(disguise.asActor).toBeDefined()
  })

  it('_disguiseAs(target) sets disguise identity', () => {
    const target = mkTooltipActor(2, 'rifle', 'player2')
    disguise._disguiseAs(target)

    expect(disguise.disguised).toBe(true)
    expect(disguise.asPlayer?.playerName).toBe('player2')
    expect(disguise.asActor?.name).toBe('rifle')
  })

  it('_disguiseAs(null) removes disguise', () => {
    const target = mkTooltipActor(2, 'rifle', 'player2')
    disguise._disguiseAs(target)
    expect(disguise.disguised).toBe(true)

    disguise._disguiseAs(null)
    expect(disguise.disguised).toBe(false)
    expect(disguise.asPlayer).toBeNull()
  })

  it('_disguiseAs does not disguise as self (same type + same owner)', () => {
    const selfCopy = mkTooltipActor(1, 'spy', 'player1')
    selfCopy.owner = self.owner // Share owner reference so === works
    disguise._disguiseAs(selfCopy)

    expect(disguise.disguised).toBe(false)
  })

  it('chain-of-disguise: spyB disguises as spyA who is disguised', () => {
    // Setup: spyA (actor 2) is disguised as rifle
    const spyA = mkTooltipActor(2, 'spy', 'player2')
    spyA.getTrait = (name: string) => {
      if (name === 'Disguise') return disguiseA
      return undefined
    }

    const disguiseA = new Disguise(spyA, mkInfo())
    disguiseA.asPlayer = { playerName: 'player3' }
    disguiseA.asActor = { name: 'rifle', traitInfos: () => [] }
    disguiseA.asTooltipInfo = {
      isOwnerRowVisible: true,
      tooltipForPlayerStance() { return 'rifle' },
    }

    // spyB (our disguise) targets spyA
    disguise._disguiseAs(spyA)

    // Should get rifle identity (chain), not spy identity
    expect(disguise.asActor?.name).toBe('rifle')
    expect(disguise.asPlayer?.playerName).toBe('player3')
  })

  it('_disguiseFromFrozen sets identity from ActorInfo', () => {
    const actorInfo = {
      name: 'e1',
      traitInfos<T>(_type: string): T[] {
        return [{
          isOwnerRowVisible: true,
          tooltipForPlayerStance() { return 'e1' },
          enabledByDefault: true,
        }] as any
      },
    }
    disguise._disguiseFromFrozen(actorInfo, { playerName: 'player3' })

    expect(disguise.disguised).toBe(true)
    expect(disguise.asPlayer?.playerName).toBe('player3')
    expect(disguise.asActor?.name).toBe('e1')
  })

  it('attacking reveals disguise when Attack flag is set', () => {
    const target = mkTooltipActor(2, 'rifle', 'player2')
    disguise._disguiseAs(target)
    expect(disguise.disguised).toBe(true)

    disguise.attacking()
    expect(disguise.disguised).toBe(false)
  })

  it('attacking does NOT reveal when Attack flag is not set', () => {
    const noRevealInfo = mkInfo({ revealDisguiseOn: RevealDisguiseType.None as any })
    const noReveal = new Disguise(self, noRevealInfo)
    const target = mkTooltipActor(2, 'rifle', 'player2')
    noReveal._disguiseAs(target)
    expect(noReveal.disguised).toBe(true)

    noReveal.attacking()
    expect(noReveal.disguised).toBe(true)
  })

  it('damaged reveals when value > 0', () => {
    const damagedInfo = mkInfo({ revealDisguiseOn: RevealDisguiseType.Damaged as any })
    const dDamage = new Disguise(self, damagedInfo)
    const target = mkTooltipActor(2, 'rifle', 'player2')
    dDamage._disguiseAs(target)
    expect(dDamage.disguised).toBe(true)

    dDamage.damaged(self, { damage: { value: 10 } })
    expect(dDamage.disguised).toBe(false)
  })

  it('damaged does NOT reveal when value is 0', () => {
    const target = mkTooltipActor(2, 'rifle', 'player2')
    disguise._disguiseAs(target)

    disguise.damaged(self, { damage: { value: 0 } })
    expect(disguise.disguised).toBe(true)
  })

  it('loading/unloading/demolishing/infiltrating reveal with respective flags', () => {
    const infoAll = mkInfo({
      revealDisguiseOn: (RevealDisguiseType.Load | RevealDisguiseType.Unload |
        RevealDisguiseType.Demolish | RevealDisguiseType.Infiltrate) as any,
    })
    const dAll = new Disguise(self, infoAll)
    const target = mkTooltipActor(2, 'rifle', 'player2')
    dAll._disguiseAs(target)
    expect(dAll.disguised).toBe(true)

    dAll.loading()
    expect(dAll.disguised).toBe(false)

    dAll._disguiseAs(target)
    dAll.unloading()
    expect(dAll.disguised).toBe(false)

    dAll._disguiseAs(target)
    dAll.demolishing()
    expect(dAll.disguised).toBe(false)
  })

  it('tick reveals on Move when position changed', () => {
    const moveInfo = mkInfo({ revealDisguiseOn: RevealDisguiseType.Move as any })
    const dMove = new Disguise(self, moveInfo)
    const target = mkTooltipActor(2, 'rifle', 'player2')
    dMove._disguiseAs(target)
    expect(dMove.disguised).toBe(true)

    // First tick sets lastPos but does not reveal
    dMove.tick()
    expect(dMove.disguised).toBe(true)

    // Change position
    self.location = { X: 6, Y: 6 }

    // Second tick detects move and reveals
    dMove.tick()
    expect(dMove.disguised).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DisguiseTooltip tests
// ---------------------------------------------------------------------------

describe('DisguiseTooltip', () => {
  it('returns self owner when not disguised', () => {
    const actor = mkActor(1, 'spy', 'player1')
    const info: any = { name: 'spy', isOwnerRowVisible: true }
    const disguise = new Disguise(actor, mkInfo())
    actor.getTrait = () => disguise

    const tooltip = new DisguiseTooltip(actor, info)
    expect(tooltip.owner?.playerName).toBe('player1')
  })

  it('returns disguise owner when disguised and enemy', () => {
    const actor = mkActor(1, 'spy', 'player1')
    const info: any = { name: 'spy', isOwnerRowVisible: true }
    const disguise = new Disguise(actor, mkInfo())
    disguise.asPlayer = { playerName: 'player2' }
    actor.getTrait = () => disguise

    const tooltip = new DisguiseTooltip(actor, info)
    // Enemy: isAlliedWith returns false
    expect(tooltip.owner?.playerName).toBe('player2')
  })

  it('returns self owner when allied with render player', () => {
    const actor = mkActor(1, 'spy', 'player1')
    actor.owner.isAlliedWith = () => true // Allied
    const info: any = { name: 'spy', isOwnerRowVisible: true }
    const disguise = new Disguise(actor, mkInfo())
    disguise.asPlayer = { playerName: 'player2' }
    actor.getTrait = () => disguise

    const tooltip = new DisguiseTooltip(actor, info)
    expect(tooltip.owner?.playerName).toBe('player1')
  })
})

// ---------------------------------------------------------------------------
// DisguiseOrderTargeter tests
// ---------------------------------------------------------------------------

describe('DisguiseOrderTargeter', () => {
  let targeter: DisguiseOrderTargeter
  let info: DisguiseInfo

  beforeEach(() => {
    info = mkInfo()
    targeter = new DisguiseOrderTargeter(info)
  })

  it('has correct orderID', () => {
    expect(targeter.orderID).toBe('Disguise')
  })

  it('canTargetActor returns true for valid target', () => {
    const self = mkActor(1, 'spy', 'player1')
    const target = mkActor(2, 'rifle', 'player2')
    target.info = { name: 'Disguise' }

    const result = targeter.canTargetActor(self, target, 0, '')
    expect(result).toBe(true)
  })

  it('canTargetActor returns false for self', () => {
    const self = mkActor(1, 'spy', 'player1')
    const result = targeter.canTargetActor(self, self, 0, '')
    expect(result).toBe(false)
  })

  it('canTargetActor returns false when target type not in targetTypes', () => {
    const self = mkActor(1, 'spy', 'player1')
    const target = mkActor(2, 'building', 'player2')
    target.info = { name: 'building' }

    const result = targeter.canTargetActor(self, target, 0, '')
    expect(result).toBe(false)
  })
})
