/**
 * RepairableBuilding.test.ts — RepairableBuilding migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: RepairableBuildingInfo configuration, default values,
 * repairBuilding toggle mechanics, condition token management, tick repair
 * logic, ally filtering, isNotActiveAlly predicate, and dispose lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  RepairableBuildingInfo,
  RepairableBuilding,
} from './RepairableBuilding.js'
import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WinState } from '../../../OpenRA.Game/Player.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 8000

function makeActor(overrides: Partial<IGameActor> = {}): IGameActor {
  const actor: IGameActor = {
    actorId: nextId++,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  }
  return actor
}

function makePlayer(overrides: Partial<PlayerStub> & {
  actorId?: number
  winState?: number
  allyWith?: PlayerStub | null
} = {}): PlayerStub {
  const id = overrides.actorId ?? nextId++
  const player: PlayerStub & {
    actorId?: number
    winState?: number
    relationshipWith?(other: unknown): PlayerRelationship
    playerActor?: IGameActor
  } = {
    playerName: `Player-${id}`,
    actorId: id,
  }

  if (overrides.winState !== undefined) {
    player.winState = overrides.winState
  }

  if (overrides.allyWith !== undefined) {
    player.relationshipWith = (other: unknown) => {
      if (other === overrides.allyWith || (overrides.allyWith === null && other === player)) {
        return PlayerRelationship.Ally
      }
      return PlayerRelationship.Neutral
    }
  }

  return player
}

function makeActorWithHealth(hp: number, maxHP: number): IGameActor {
  const healthTrait = {
    hp,
    maxHP,
    damageState: hp >= maxHP ? 1 : (hp <= 0 ? 32 : 2),
    inflictDamage(_actor: IGameActor, _attacker: IGameActor, damage: { value: number }, _ignoreModifiers: boolean): void {
      const newHp = hp + damage.value
      healthTrait.hp = Math.max(0, Math.min(maxHP, newHp))
      if (healthTrait.hp >= maxHP) {
        healthTrait.damageState = 1 // Undamaged
      } else if (healthTrait.hp <= 0) {
        healthTrait.damageState = 32 // Dead
      } else {
        healthTrait.damageState = 2 // Light
      }
    },
  }

  const actor = makeActor()
  ;(actor as unknown as Record<string, unknown>).trait = (name: string) => {
    if (name === 'IHealth') return healthTrait
    return undefined
  }
  ;(actor as unknown as Record<string, unknown>).info = {
    traitInfoOrDefault: (name: string) => {
      if (name === 'CustomSellValueInfo') return undefined
      if (name === 'ValuedInfo') return { cost: 1000 }
      return undefined
    },
  }
  return actor
}

// ---------------------------------------------------------------------------
// RepairableBuildingInfo
// ---------------------------------------------------------------------------

describe('RepairableBuildingInfo', () => {
  it('has correct default values', () => {
    const info = new RepairableBuildingInfo()
    expect(info.instanceName).toBeUndefined()
    expect(info.requiresCondition).toBeUndefined()
    expect(info.repairPercent).toBe(20)
    expect(info.repairInterval).toBe(24)
    expect(info.repairStep).toBe(7)
    expect(info.repairDamageTypes).toBeInstanceOf(Set)
    expect(info.repairDamageTypes.size).toBe(0)
    expect(info.repairBonuses).toEqual([
      100, 150, 175, 200, 220, 240, 260, 280, 300,
    ])
    expect(info.cancelWhenDisabled).toBe(false)
    expect(info.playerExperience).toBe(0)
    expect(info.repairCondition).toBeNull()
    expect(info.repairingNotification).toBeNull()
    expect(info.repairingTextNotification).toBeNull()
    expect(info.repairingStoppedNotification).toBeNull()
    expect(info.repairingStoppedTextNotification).toBeNull()
  })

  it('accepts custom repairPercent', () => {
    const info = new RepairableBuildingInfo({ repairPercent: 50 })
    expect(info.repairPercent).toBe(50)
  })

  it('accepts custom repairInterval', () => {
    const info = new RepairableBuildingInfo({ repairInterval: 48 })
    expect(info.repairInterval).toBe(48)
  })

  it('accepts custom repairStep', () => {
    const info = new RepairableBuildingInfo({ repairStep: 10 })
    expect(info.repairStep).toBe(10)
  })

  it('accepts custom repairDamageTypes', () => {
    const types = new Set(['Fire', 'Explosion'])
    const info = new RepairableBuildingInfo({ repairDamageTypes: types })
    expect(info.repairDamageTypes).toBe(types)
    expect(info.repairDamageTypes.has('Fire')).toBe(true)
  })

  it('accepts custom repairBonuses', () => {
    const bonuses = [100, 200, 300]
    const info = new RepairableBuildingInfo({ repairBonuses: bonuses })
    expect(info.repairBonuses).toBe(bonuses)
  })

  it('accepts custom cancelWhenDisabled', () => {
    const info = new RepairableBuildingInfo({ cancelWhenDisabled: true })
    expect(info.cancelWhenDisabled).toBe(true)
  })

  it('accepts custom playerExperience', () => {
    const info = new RepairableBuildingInfo({ playerExperience: 50 })
    expect(info.playerExperience).toBe(50)
  })

  it('accepts custom repairCondition', () => {
    const info = new RepairableBuildingInfo({ repairCondition: 'being-repaired' })
    expect(info.repairCondition).toBe('being-repaired')
  })

  it('accepts notification strings', () => {
    const info = new RepairableBuildingInfo({
      repairingNotification: 'Repairing',
      repairingStoppedNotification: 'RepairStopped',
      repairingTextNotification: 'Repairing...',
      repairingStoppedTextNotification: 'Stopped.',
    })
    expect(info.repairingNotification).toBe('Repairing')
    expect(info.repairingStoppedNotification).toBe('RepairStopped')
    expect(info.repairingTextNotification).toBe('Repairing...')
    expect(info.repairingStoppedTextNotification).toBe('Stopped.')
  })
})

// ---------------------------------------------------------------------------
// RepairableBuilding
// ---------------------------------------------------------------------------

describe('RepairableBuilding', () => {
  let info: RepairableBuildingInfo
  let trait: RepairableBuilding
  let actor: IGameActor

  beforeEach(() => {
    info = new RepairableBuildingInfo()
    trait = new RepairableBuilding(info)
    actor = makeActorWithHealth(50, 100)
    // Set up actor's owner
    const owner = makePlayer({ actorId: 9000 })
    ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Ally
    actor = { ...actor, owner }
    trait.attach(actor)
  })

  describe('initial state', () => {
    it('starts with empty repairers', () => {
      expect(trait.repairers).toEqual([])
    })

    it('starts with repairActive false', () => {
      expect(trait.repairActive).toBe(false)
    })

    it('has a sync hash', () => {
      expect(trait.repairersHash).toBe(0)
    })

    it('implements ISync marker', () => {
      // ISync is a marker interface — just verifying the trait can be used as ISync
      const sync: { repairersHash?: number } = trait as unknown as { repairersHash?: number }
      expect(sync.repairersHash).toBeDefined()
    })
  })

  describe('repairBuilding — toggle logic', () => {
    it('adds a player to repairers', () => {
      const player = makePlayer({ actorId: 9001,
        allyWith: actor.owner!,
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        owner: player,
      })

      trait.repairBuilding(actor, player)
      expect(trait.repairers).toContain(player)
    })

    it('removes a player when already repairing', () => {
      const player = makePlayer({ actorId: 9002,
        allyWith: actor.owner!,
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        owner: player,
      })

      trait.repairBuilding(actor, player)
      expect(trait.repairers).toContain(player)

      trait.repairBuilding(actor, player)
      expect(trait.repairers).not.toContain(player)
    })

    it('does not add player when trait is disabled', () => {
      // Disable by setting _enabled to false
      ;(trait as unknown as Record<string, boolean>)._enabled = false

      const player = makePlayer({ actorId: 9003,
        allyWith: actor.owner!,
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        owner: player,
      })

      trait.repairBuilding(actor, player)
      expect(trait.repairers).toEqual([])
    })

    it('does not add player beyond repairBonuses limit', () => {
      const maxRepairers = info.repairBonuses.length - 1 // = 8

      // First, fill up to max
      for (let i = 0; i < maxRepairers + 2; i++) {
        const player = makePlayer({ actorId: 9100 + i,
          allyWith: actor.owner!,
          winState: WinState.Undefined,
        })
        ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
          owner: player,
        })
        trait.repairBuilding(actor, player)
      }

      // Should be capped at maxRepairers
      expect(trait.repairers.length).toBeLessThanOrEqual(maxRepairers)
    })

    it('does not add player without playerActor', () => {
      const player = makePlayer({ actorId: 9010,
        allyWith: actor.owner!,
        winState: WinState.Undefined,
      })
      // No playerActor set

      trait.repairBuilding(actor, player)
      expect(trait.repairers).toEqual([])
    })

    it('does not add non-allied player', () => {
      const owner = makePlayer({ actorId: 9020 })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (_other: unknown) => PlayerRelationship.Enemy

      const player = makePlayer({ actorId: 9021,
        allyWith: null, // Not allied with anyone
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        owner: player,
      })

      const enemyActor = makeActorWithHealth(100, 100)
      enemyActor.owner = owner
      const enemyTrait = new RepairableBuilding(info)
      enemyTrait.attach(enemyActor)

      enemyTrait.repairBuilding(enemyActor, player)
      expect(enemyTrait.repairers).toEqual([])
    })
  })

  describe('condition management', () => {
    it('grants conditions when repairers are added', () => {
      const conditions: string[] = []
      const tokens: number[] = []
      let nextToken = 1

      const condActor = makeActorWithHealth(100, 200)
      condActor.owner = makePlayer({ actorId: 9050,
        allyWith: condActor.owner,
        winState: WinState.Undefined,
      })
      condActor.grantCondition = (cond: string) => {
        conditions.push(cond)
        return nextToken++
      }
      condActor.revokeCondition = (token: number) => {
        tokens.push(token)
        return -1
      }

      const condInfo = new RepairableBuildingInfo({ repairCondition: 'being-repaired' })
      const condTrait = new RepairableBuilding(condInfo)
      condTrait.attach(condActor)

      const player = makePlayer({ actorId: 9051,
        allyWith: condActor.owner,
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        owner: player,
      })

      condTrait.repairBuilding(condActor, player)
      expect(conditions).toContain('being-repaired')
      expect(conditions.length).toBe(1)

      // Remove
      condTrait.repairBuilding(condActor, player)
      expect(tokens.length).toBe(1)
    })

    it('does not grant conditions when repairCondition is null', () => {
      const condActor = makeActorWithHealth(100, 200)
      condActor.owner = makePlayer({ actorId: 9060,
        allyWith: condActor.owner,
        winState: WinState.Undefined,
      })
      let granted = false
      condActor.grantCondition = () => { granted = true; return 1 }

      const nullInfo = new RepairableBuildingInfo({ repairCondition: null })
      const nullTrait = new RepairableBuilding(nullInfo)
      nullTrait.attach(condActor)

      const player = makePlayer({ actorId: 9061,
        allyWith: condActor.owner,
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        owner: player,
      })

      nullTrait.repairBuilding(condActor, player)
      expect(granted).toBe(false)
    })
  })

  describe('tick — repair logic', () => {
    it('ticks without error with no repairers', () => {
      trait.tick(actor)
      expect(trait.repairActive).toBe(false)
    })

    it('does nothing when trait is disabled', () => {
      ;(trait as unknown as Record<string, boolean>)._enabled = false
      trait.tick(actor)
      expect(trait.repairActive).toBe(false)
    })

    it('clears repairers when disabled and cancelWhenDisabled is true', () => {
      const cancelInfo = new RepairableBuildingInfo({ cancelWhenDisabled: true })
      const cancelTrait = new RepairableBuilding(cancelInfo)
      const cancelActor = makeActorWithHealth(50, 100)
      cancelActor.owner = makePlayer({ actorId: 9070,
        allyWith: cancelActor.owner,
        winState: WinState.Undefined,
      })
      cancelTrait.attach(cancelActor)

      // Add a repairer
      const player = makePlayer({ actorId: 9071,
        allyWith: cancelActor.owner,
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        owner: player,
      })
      cancelTrait.repairBuilding(cancelActor, player)
      expect(cancelTrait.repairers.length).toBe(1)

      // Disable and tick
      ;(cancelTrait as unknown as Record<string, boolean>)._enabled = false
      ;(cancelTrait as unknown as Record<string, boolean>)._repairActive = true
      cancelTrait.tick(cancelActor)
      expect(cancelTrait.repairers.length).toBe(0)
    })

    it('filters out inactive allies on tick', () => {
      // Create owner
      const owner = makePlayer({ actorId: 9080, winState: WinState.Undefined })
      ;(owner as unknown as Record<string, unknown>).relationshipWith = (other: unknown) => {
        // Ally with everyone except player 9082
        const p = other as Record<string, unknown>
        if (p.actorId === 9082) return PlayerRelationship.Enemy
        return PlayerRelationship.Ally
      }

      const tickActor = makeActorWithHealth(50, 100)
      tickActor.owner = owner
      const tickTrait = new RepairableBuilding(info)
      tickTrait.attach(tickActor)

      // Add an ally (should stay)
      const ally = makePlayer({ actorId: 9081, winState: WinState.Undefined })
      ;(ally as unknown as Record<string, unknown>).playerActor = makeActor({ owner: ally })

      // Add a defeated player (should be removed — WinState != Undefined)
      const defeated = makePlayer({ actorId: 9083, winState: WinState.Lost })
      ;(defeated as unknown as Record<string, unknown>).playerActor = makeActor({ owner: defeated })

      // Add a non-ally (should be removed — not Ally)
      const enemy = makePlayer({ actorId: 9082, winState: WinState.Undefined })
      ;(enemy as unknown as Record<string, unknown>).playerActor = makeActor({ owner: enemy })

      tickTrait.repairers.push(ally, defeated, enemy)

      // Simulate remainingTicks = 0 to trigger filtering
      ;(tickTrait as unknown as Record<string, number>)._remainingTicks = 0

      // This should filter out defeated and enemy
      // The tick will fail because no health trait or no resources,
      // but the filtering should happen first
      tickTrait.tick(tickActor)

      // After filtering, only the active ally should remain (or none if
      // the repair check failed)
      // The defeated (WinState.Lost) should have been removed
      expect(tickTrait.repairers).not.toContain(defeated)
      // The enemy (not Ally) should have been removed
      expect(tickTrait.repairers).not.toContain(enemy)
    })
  })

  describe('sync hash', () => {
    it('changes when repairers change', () => {
      const hash1 = trait.repairersHash

      const player = makePlayer({ actorId: 9090,
        allyWith: actor.owner!,
        winState: WinState.Undefined,
      })
      ;(player as unknown as Record<string, unknown>).playerActor = makeActor({
        actorId: 9999,
        owner: player,
      })

      trait.repairers.push(player)
      const hash2 = trait.repairersHash

      // Hash should be different (or could be same by coincidence — unlikely)
      expect(hash2).not.toBe(hash1)
    })
  })

  describe('lifecycle', () => {
    it('attaches and detaches cleanly', () => {
      const a = makeActorWithHealth(100, 200)
      const t = new RepairableBuilding(info)

      t.attach(a)
      expect(() => t.detach(a)).not.toThrow()
    })

    it('works with actor that has no health trait', () => {
      const a = makeActor() // No IHealth
      const t = new RepairableBuilding(info)

      t.attach(a)
      // Should not throw — gracefully handles missing health
      t.tick(a)
      expect(t.repairActive).toBe(false)
    })
  })
})
