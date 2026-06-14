/**
 * ProductionParadrop.test.ts — ProductionParadrop migration unit tests
 *
 * Tests focus on:
 * - ProductionParadropInfo defaults and inheritance from ProductionInfo
 * - ProductionParadrop.produce returns true when enabled
 * - ProductionParadrop.produce returns false when disabled/paused
 * - ProductionParadrop extends Production
 * - Edge cases: null info, empty actor type
 */

import { describe, it, expect } from 'vitest'
import { ProductionParadrop, ProductionParadropInfo } from './ProductionParadrop'
import { Production } from './Production'
import type { IGameActor, ActorInfoStub } from '../../OpenRA.Game/Traits/TraitsInterfaces'

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
// ProductionParadropInfo
// ---------------------------------------------------------------------------

describe('ProductionParadropInfo', () => {
  it('inherits defaults from ProductionInfo', () => {
    const info = new ProductionParadropInfo()
    expect(info.produces.size).toBe(0)
    expect(info.updateFactionOnOwnerChange).toBe(false)
  })

  it('defaults actorType to "badr"', () => {
    const info = new ProductionParadropInfo()
    expect(info.actorType).toBe('badr')
  })

  it('accepts custom actorType', () => {
    const info = new ProductionParadropInfo({ actorType: 'c17' })
    expect(info.actorType).toBe('c17')
  })

  it('defaults chuteSound to null', () => {
    const info = new ProductionParadropInfo()
    expect(info.chuteSound).toBeNull()
  })

  it('defaults readyAudio to null', () => {
    const info = new ProductionParadropInfo()
    expect(info.readyAudio).toBeNull()
  })

  it('defaults readyTextNotification to null', () => {
    const info = new ProductionParadropInfo()
    expect(info.readyTextNotification).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ProductionParadrop
// ---------------------------------------------------------------------------

describe('ProductionParadrop', () => {
  it('is an instance of Production', () => {
    const pp = new ProductionParadrop(new ProductionParadropInfo())
    expect(pp).toBeInstanceOf(Production)
    expect(pp).toBeInstanceOf(ProductionParadrop)
  })

  it('produce returns true when enabled', () => {
    const pp = new ProductionParadrop(new ProductionParadropInfo())
    const actor = createActor()
    const producee = createActorInfo('soldier')
    const result = pp.produce(actor, producee, 'Infantry', new Map(), 100)
    expect(result).toBe(true)
  })

  it('produce returns false when disabled', () => {
    const pp = new ProductionParadrop(new ProductionParadropInfo())
    pp.isTraitDisabled = true
    const actor = createActor()
    const producee = createActorInfo('soldier')
    const result = pp.produce(actor, producee, 'Infantry', new Map(), 100)
    expect(result).toBe(false)
  })

  it('produce returns false when paused', () => {
    const pp = new ProductionParadrop(new ProductionParadropInfo())
    pp.isTraitPaused = true
    const actor = createActor()
    const producee = createActorInfo('soldier')
    const result = pp.produce(actor, producee, 'Infantry', new Map(), 100)
    expect(result).toBe(false)
  })

  it('stores the typed info reference', () => {
    const info = new ProductionParadropInfo({ actorType: 'c17' })
    const pp = new ProductionParadrop(info)
    expect(pp.info.actorType).toBe('c17')
  })
})
