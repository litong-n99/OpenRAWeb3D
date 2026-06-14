/**
 * ProductionAirdrop.test.ts — ProductionAirdrop migration unit tests
 *
 * Tests focus on:
 * - ProductionAirdropInfo defaults and inheritance from ProductionInfo
 * - ProductionAirdrop.produce returns true when enabled
 * - ProductionAirdrop.produce returns false when disabled/paused
 * - ProductionAirdrop extends Production
 * - Edge cases: empty actor type, custom facing
 */

import { describe, it, expect } from 'vitest'
import { ProductionAirdrop, ProductionAirdropInfo } from './ProductionAirdrop'
import { Production } from '../Production'
import type { IGameActor, ActorInfoStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createActorInfo(name: string): ActorInfoStub {
  return { name }
}

function createActor(): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
  } as IGameActor
}

// ---------------------------------------------------------------------------
// ProductionAirdropInfo
// ---------------------------------------------------------------------------

describe('ProductionAirdropInfo', () => {
  it('inherits defaults from ProductionInfo', () => {
    const info = new ProductionAirdropInfo()
    expect(info.produces.size).toBe(0)
    expect(info.updateFactionOnOwnerChange).toBe(false)
  })

  it('defaults readyAudio to "Reinforce"', () => {
    const info = new ProductionAirdropInfo()
    expect(info.readyAudio).toBe('Reinforce')
  })

  it('accepts custom readyAudio', () => {
    const info = new ProductionAirdropInfo({ readyAudio: 'UnitReady' })
    expect(info.readyAudio).toBe('UnitReady')
  })

  it('defaults actorType to empty string', () => {
    const info = new ProductionAirdropInfo()
    expect(info.actorType).toBe('')
  })

  it('accepts custom actorType', () => {
    const info = new ProductionAirdropInfo({ actorType: 'c17' })
    expect(info.actorType).toBe('c17')
  })

  it('defaults baselineSpawn to false', () => {
    const info = new ProductionAirdropInfo()
    expect(info.baselineSpawn).toBe(false)
  })

  it('defaults waitTickBeforeProduce to 0', () => {
    const info = new ProductionAirdropInfo()
    expect(info.waitTickBeforeProduce).toBe(0)
  })

  it('defaults waitTickAfterProduce to 0', () => {
    const info = new ProductionAirdropInfo()
    expect(info.waitTickAfterProduce).toBe(0)
  })

  it('defaults readyTextNotification to null', () => {
    const info = new ProductionAirdropInfo()
    expect(info.readyTextNotification).toBeNull()
  })

  it('defaults facing to null', () => {
    const info = new ProductionAirdropInfo()
    expect(info.facing).toBeNull()
  })

  it('defaults landOffset to null', () => {
    const info = new ProductionAirdropInfo()
    expect(info.landOffset).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ProductionAirdrop
// ---------------------------------------------------------------------------

describe('ProductionAirdrop', () => {
  it('is an instance of Production', () => {
    const pa = new ProductionAirdrop(new ProductionAirdropInfo())
    expect(pa).toBeInstanceOf(Production)
    expect(pa).toBeInstanceOf(ProductionAirdrop)
  })

  it('produce returns true when enabled', () => {
    const pa = new ProductionAirdrop(new ProductionAirdropInfo())
    const actor = createActor()
    const producee = createActorInfo('soldier')
    const result = pa.produce(actor, producee, 'Infantry', new Map(), 100)
    expect(result).toBe(true)
  })

  it('produce returns false when disabled', () => {
    const pa = new ProductionAirdrop(new ProductionAirdropInfo())
    pa.isTraitDisabled = true
    const actor = createActor()
    const producee = createActorInfo('soldier')
    const result = pa.produce(actor, producee, 'Infantry', new Map(), 100)
    expect(result).toBe(false)
  })

  it('produce returns false when paused', () => {
    const pa = new ProductionAirdrop(new ProductionAirdropInfo())
    pa.isTraitPaused = true
    const actor = createActor()
    const producee = createActorInfo('soldier')
    const result = pa.produce(actor, producee, 'Infantry', new Map(), 100)
    expect(result).toBe(false)
  })

  it('stores the typed info reference', () => {
    const info = new ProductionAirdropInfo({ actorType: 'c17', readyAudio: 'Custom' })
    const pa = new ProductionAirdrop(info)
    expect(pa.info.actorType).toBe('c17')
    expect(pa.info.readyAudio).toBe('Custom')
  })
})
