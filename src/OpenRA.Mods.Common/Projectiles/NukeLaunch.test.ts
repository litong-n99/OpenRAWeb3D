/**
 * NukeLaunch.test.ts — NukeLaunch unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Vector3: class MockVector3 { x: number; y: number; z: number; constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } },
  Quaternion: class MockQuaternion { x = 0; y = 0; z = 0; w = 1 },
}))

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import type { PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import { type WeaponStub } from './Bullet.js'
import { NukeLaunch, defaultNukeLaunchConfig, type NukeLaunchConfig } from './NukeLaunch.js'

function createMockPlayer(name = 'testPlayer'): PlayerStub { return { playerName: name } }

interface MockWorld extends GameWorldManager { drainFrameEndTasks(): void }
function createMockWorld(): MockWorld {
  const effects: unknown[] = []; const tasks: Array<() => void> = []
  return {
    actors: [], effects,
    addEffect(e: unknown): void { effects.push(e) },
    removeEffect(e: unknown): void { const i = effects.indexOf(e); if (i !== -1) effects.splice(i, 1) },
    addFrameEndTask(a: () => void): void { tasks.push(a) },
    drainFrameEndTasks(): void { while (tasks.length > 0) tasks.shift()!() },
    disposed: false, worldType: 'Regular', tickCount: 0, syncHash: 0,
  } as unknown as MockWorld
}

function createConfig(overrides?: Partial<NukeLaunchConfig>): NukeLaunchConfig {
  return defaultNukeLaunchConfig({
    firedBy: createMockPlayer('Allied'),
    launchPos: new WPos(0, 0, 0),
    targetPos: new WPos(10240, 0, 0),
    velocity: new WDist(100),
    impactDelay: 100,
    skipAscent: false,
    ...overrides,
  })
}

describe('NukeLaunch', () => {
  it('creates with default config', () => {
    const nuke = new NukeLaunch(createConfig())
    expect(nuke.isDestroyed).toBe(false)
    expect(nuke.isLaunched).toBe(false)
    expect(nuke.ticks).toBe(0)
  })

  it('waits for launch delay before launching', () => {
    const nuke = new NukeLaunch(createConfig({ launchDelay: 5 }))
    const world = createMockWorld()
    nuke.tick(world) // delay goes from 5 to 4
    expect(nuke.isLaunched).toBe(false)
    // After 3 more ticks (total 4), delay should still be positive
    for (let i = 0; i < 3; i++) nuke.tick(world)
    expect(nuke.isLaunched).toBe(false)
  })

  it('launches after launch delay expires', () => {
    const nuke = new NukeLaunch(createConfig({ launchDelay: 1 }))
    const world = createMockWorld()
    nuke.tick(world) // countdown to 0
    nuke.tick(world) // should launch
    expect(nuke.isLaunched).toBe(true)
  })

  it('ascends during ascent phase', () => {
    const config = createConfig({ impactDelay: 50, velocity: new WDist(50), skipAscent: false })
    const nuke = new NukeLaunch(config)
    const world = createMockWorld()
    // Initial position should be at launchPos
    expect(nuke.pos.Z).toBe(0)
    // Mid-ascent
    for (let i = 0; i < 25; i++) nuke.tick(world)
    // Z should be higher than launchPos (ascending)
    expect(nuke.pos.Z).toBeGreaterThan(0)
  })

  it('descends during descent phase', () => {
    const config = createConfig({ impactDelay: 50, velocity: new WDist(50), skipAscent: false })
    const nuke = new NukeLaunch(config)
    const world = createMockWorld()
    // Go through entire flight
    for (let i = 0; i < 49; i++) nuke.tick(world)
    // Should be near target Z at end
    expect(Math.abs(nuke.pos.Z - config.targetPos.Z)).toBeLessThan(1000)
  })

  it('skips ascent when skipAscent is true', () => {
    const config = createConfig({ skipAscent: true })
    const nuke = new NukeLaunch(config)
    expect(nuke.turn).toBe(0)
    // Should start at descendSource
    expect(nuke.pos.Z).toBeGreaterThanOrEqual(0)
  })

  it('detonates on impact', () => {
    const mockImpact = vi.fn()
    const weapon = { impact: mockImpact } as unknown as WeaponStub
    const config = createConfig({ impactDelay: 5, velocity: new WDist(10), weapon })
    const nuke = new NukeLaunch(config)
    const world = createMockWorld()
    for (let i = 0; i < 10; i++) nuke.tick(world)
    expect(mockImpact).toHaveBeenCalled()
    expect(nuke.detonated).toBe(true)
  })

  it('does not tick when destroyed', () => {
    const nuke = new NukeLaunch(createConfig())
    nuke.isDestroyed = true
    const world = createMockWorld()
    const posBefore = nuke.pos
    nuke.tick(world)
    expect(nuke.pos).toEqual(posBefore)
  })

  it('dispose marks destroyed', () => {
    const nuke = new NukeLaunch(createConfig())
    nuke.dispose()
    expect(nuke.isDestroyed).toBe(true)
  })

  it('fractionComplete increases over time', () => {
    const nuke = new NukeLaunch(createConfig({ impactDelay: 100, launchDelay: 0 }))
    const world = createMockWorld()
    expect(nuke.fractionComplete).toBe(0)
    for (let i = 0; i < 50; i++) nuke.tick(world)
    expect(nuke.fractionComplete).toBeGreaterThan(0.4)
    expect(nuke.fractionComplete).toBeLessThan(0.6)
  })

  it('render returns empty array', () => {
    const nuke = new NukeLaunch(createConfig())
    expect(nuke.render(null as unknown as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub)).toHaveLength(0)
  })

  it('self-removes on detonation', () => {
    const config = createConfig({ impactDelay: 3, velocity: new WDist(10), removeOnDetonation: true })
    const nuke = new NukeLaunch(config)
    const world = createMockWorld()
    world.addEffect(nuke)
    for (let i = 0; i < 6; i++) nuke.tick(world)
    world.drainFrameEndTasks()
    expect(world.effects).not.toContain(nuke)
  })

  // NEGATIVE TESTS — regression guards for B1 (isDestroyed before frame-end task)

  it('BUGFIX: sets isDestroyed=true on detonation before frame-end task', () => {
    const config = createConfig({ impactDelay: 3, velocity: new WDist(10), removeOnDetonation: true })
    const nuke = new NukeLaunch(config)
    const world = createMockWorld()
    // Tick to detonation
    for (let i = 0; i < 6; i++) nuke.tick(world)
    // BEFORE frame-end task executes, isDestroyed should already be true
    expect(nuke.isDestroyed).toBe(true)
    // Subsequent tick should be no-op
    const posBefore = nuke.pos
    nuke.tick(world)
    expect(nuke.pos).toEqual(posBefore)
  })

  it('BUGFIX: NukeLaunch stops ticking after detonation without frame-end drain (negative)', () => {
    const config = createConfig({ impactDelay: 3, velocity: new WDist(10), removeOnDetonation: true })
    const nuke = new NukeLaunch(config)
    const world = createMockWorld()
    // Tick to detonation
    for (let i = 0; i < 6; i++) nuke.tick(world)
    expect(nuke.isDestroyed).toBe(true)
    // Further ticks should be no-ops
    const ticksBefore = nuke.ticks
    for (let i = 0; i < 10; i++) nuke.tick(world)
    expect(nuke.ticks).toBe(ticksBefore) // no further ticks
  })
})
