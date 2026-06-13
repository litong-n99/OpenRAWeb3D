/**
 * FallsToEarth.test.ts — FallsToEarth migration unit tests
 *
 * Tests focus on: state management, IEffectiveOwner contract,
 * INotifyCreated lifecycle, effective owner resolution patterns.
 */

import { describe, it, expect, vi } from 'vitest'
import { FallsToEarth, FallsToEarthInfo } from './FallsToEarth.js'
import { WAngle } from '../../../OpenRA.Game/WAngle.js'
import { WDist } from '../../../OpenRA.Game/WDist.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makePlayer(playerName: string): PlayerStub {
  return { playerName }
}

function makeMockActor(overrides: {
  actorId?: number
  isInWorld?: boolean
  owner?: PlayerStub | null
} = {}) {
  return {
    actorId: overrides.actorId ?? 1,
    isInWorld: overrides.isInWorld ?? true,
    isDead: false,
    disposed: false,
    owner: overrides.owner ?? makePlayer('Neutral'),
    queueActivity: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// FallsToEarthInfo
// ---------------------------------------------------------------------------

describe('FallsToEarthInfo', () => {
  it('constructs with default values', () => {
    const info = new FallsToEarthInfo()
    expect(info.explosion).toBe('UnitExplode')
    expect(info.maximumSpinSpeed).toBeNull()
    expect(info.moves).toBe(false)
    expect(info.velocity.length).toBe(43)
    expect(info.explosionWeapon).toBeNull()
  })

  it('constructs with custom explosion name', () => {
    const info = new FallsToEarthInfo({ explosion: 'BigExplode' })
    expect(info.explosion).toBe('BigExplode')
  })

  it('constructs with custom velocity', () => {
    const info = new FallsToEarthInfo({ velocity: new WDist(100) })
    expect(info.velocity.length).toBe(100)
  })

  it('constructs with moves=true', () => {
    const info = new FallsToEarthInfo({ moves: true })
    expect(info.moves).toBe(true)
  })

  it('constructs with maximumSpinSpeed specified', () => {
    const spinSpeed = WAngle.fromDegrees(90)
    const info = new FallsToEarthInfo({ maximumSpinSpeed: spinSpeed })
    expect(info.maximumSpinSpeed).toBe(spinSpeed)
  })

  it('explosionWeapon is initially null', () => {
    const info = new FallsToEarthInfo()
    expect(info.explosionWeapon).toBeNull()
  })

  it('resolveExplosionWeapon sets the weapon', () => {
    const info = new FallsToEarthInfo()
    const mockWeapon = { impact: vi.fn(), report: 'boom' }
    info.resolveExplosionWeapon(mockWeapon)
    expect(info.explosionWeapon).toBe(mockWeapon)
  })

  it('resolveExplosionWeapon can clear the weapon with null', () => {
    const info = new FallsToEarthInfo()
    info.resolveExplosionWeapon({ impact: vi.fn() })
    info.resolveExplosionWeapon(null)
    expect(info.explosionWeapon).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// FallsToEarth
// ---------------------------------------------------------------------------

describe('FallsToEarth', () => {
  it('stores info from constructor', () => {
    const info = new FallsToEarthInfo({ explosion: 'CustomExplode' })
    const trait = new FallsToEarth(info)
    expect(trait.info).toBe(info)
    expect(trait.info.explosion).toBe('CustomExplode')
  })

  it('constructs with explicit effectiveOwner', () => {
    const info = new FallsToEarthInfo()
    const owner = makePlayer('Killer')
    const trait = new FallsToEarth(info, owner)
    expect(trait.owner).toBe(owner)
    expect(trait.owner!.playerName).toBe('Killer')
  })

  it('disguised is always true', () => {
    const info = new FallsToEarthInfo()
    const trait = new FallsToEarth(info)
    expect(trait.disguised).toBe(true)
  })

  it('effectiveOwner from constructor overrides actor owner', () => {
    const initOwner = makePlayer('Killer')
    const info = new FallsToEarthInfo()
    const trait = new FallsToEarth(info, initOwner)
    const actor = makeMockActor({ owner: makePlayer('Default') })

    // After created(), the init owner is preserved
    trait.created(actor)
    expect(trait.owner).toBe(initOwner)
    // actor's owner is NOT used because init provided the effective owner
    expect(trait.owner!.playerName).toBe('Killer')
  })

  it('effectiveOwner defaults to actor owner when no init provided', () => {
    const info = new FallsToEarthInfo()
    const trait = new FallsToEarth(info) // no effectiveOwner param
    const actor = makeMockActor({ owner: makePlayer('DefaultPlayer') })

    trait.created(actor)
    expect(trait.owner).toBe(actor.owner)
    expect(trait.owner!.playerName).toBe('DefaultPlayer')
  })

  it('owner getter returns null when no effectiveOwner and no actor owner', () => {
    const info = new FallsToEarthInfo()
    const trait = new FallsToEarth(info) // no effectiveOwner param

    // Before created() is called, _effectiveOwner is null — returns null gracefully
    expect(trait.owner).toBeNull()
  })

  it('owner getter works after created() resolves fallback', () => {
    const info = new FallsToEarthInfo()
    const trait = new FallsToEarth(info) // no effectiveOwner
    const actor = makeMockActor({ owner: makePlayer('AfterCreated') })

    // Before created: returns null
    expect(trait.owner).toBeNull()

    // After created: resolves from actor.owner
    trait.created(actor)
    expect(trait.owner).toBe(actor.owner)
    expect(trait.owner!.playerName).toBe('AfterCreated')
  })

  it('created queues a stub FallToEarth activity', () => {
    const info = new FallsToEarthInfo()
    const trait = new FallsToEarth(info)
    const actor = makeMockActor()

    trait.created(actor)
    expect(actor.queueActivity).toHaveBeenCalledTimes(1)

    // Verify the queued activity has the expected shape
    const queuedActivity = (actor.queueActivity as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(queuedActivity).toBeDefined()
    expect(typeof queuedActivity.queue).toBe('function')
    expect(typeof queuedActivity.cancel).toBe('function')
    expect(typeof queuedActivity.onActorDisposeOuter).toBe('function')
  })

  it('created preserves init-provided effectiveOwner', () => {
    const initOwner = makePlayer('ScriptKiller')
    const info = new FallsToEarthInfo()
    const trait = new FallsToEarth(info, initOwner)
    const actor = makeMockActor({ owner: makePlayer('DifferentPlayer') })

    trait.created(actor)
    // init owner takes priority, actor.owner is NOT used
    expect(trait.owner).toBe(initOwner)
    expect(trait.owner!.playerName).toBe('ScriptKiller')
  })

  it('max spin speed null vs set in info', () => {
    const defaultInfo = new FallsToEarthInfo()
    expect(defaultInfo.maximumSpinSpeed).toBeNull()

    const spinSpeed = WAngle.fromDegrees(180)
    const customInfo = new FallsToEarthInfo({ maximumSpinSpeed: spinSpeed })
    expect(customInfo.maximumSpinSpeed).toBe(spinSpeed)
    expect(customInfo.maximumSpinSpeed!.angle).toBe(spinSpeed.angle)
  })
})
