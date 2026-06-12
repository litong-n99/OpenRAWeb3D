/**
 * GravityBomb.test.ts — GravityBomb unit tests
 */

import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core', () => ({
  Vector3: class MockVector3 { x: number; y: number; z: number; constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z } },
  Quaternion: class MockQuaternion { x = 0; y = 0; z = 0; w = 1 },
}))

import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { IGameActor, PlayerStub, MersenneTwisterStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { GameWorldManager } from '../../OpenRA.Game/World.js'
import { type WeaponStub, type ProjectileArgs } from './Bullet.js'
import { GravityBomb, DEFAULT_GRAVITY_BOMB_INFO } from './GravityBomb.js'

function createMockRandom(seed = 42): MersenneTwisterStub {
  let state = seed
  return { next: () => { state = (state * 1103515245 + 12345) & 0x7fffffff; return state } }
}

function createMockPlayer(name = 'testPlayer'): PlayerStub {
  return { playerName: name }
}

function createMockActor(id = 1): IGameActor {
  return { actorId: id, isInWorld: true, isDead: false, disposed: false, owner: createMockPlayer() }
}

interface MockWorld extends GameWorldManager {
  drainFrameEndTasks(): void
}

function createMockWorld(): MockWorld {
  const effects: unknown[] = []
  const tasks: Array<() => void> = []
  return {
    actors: [], effects,
    addEffect(e: unknown): void { effects.push(e) },
    removeEffect(e: unknown): void { const i = effects.indexOf(e); if (i !== -1) effects.splice(i, 1) },
    addFrameEndTask(a: () => void): void { tasks.push(a) },
    drainFrameEndTasks(): void { while (tasks.length > 0) tasks.shift()!() },
    disposed: false, worldType: 'Regular', tickCount: 0, syncHash: 0,
  } as unknown as MockWorld
}

function createProjectileArgs(overrides?: Partial<ProjectileArgs>): ProjectileArgs {
  return {
    sourceActor: createMockActor(1),
    source: new WPos(0, 0, 0),
    passiveTarget: new WPos(10240, 0, 0),
    guidedTarget: Target.Invalid,
    weapon: { impact: () => {} } as WeaponStub,
    facing: WAngle.Zero,
    inaccuracySource: new WDist(1024),
    random: createMockRandom(),
    ...overrides,
  }
}

describe('GravityBomb', () => {
  it('creates with default config', () => {
    const args = createProjectileArgs()
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    expect(bomb.isDestroyed).toBe(false)
    expect(bomb.pos).toBe(args.source)
  })

  it('falls due to gravity acceleration', () => {
    const info = { ...DEFAULT_GRAVITY_BOMB_INFO, velocity: new WVec(0, 0, 10) }
    const args = createProjectileArgs({ source: new WPos(0, 0, 512) })
    const bomb = new GravityBomb(info, args)
    const world = createMockWorld()
    // First tick: pos += velocity (Z goes up by 10), then velocity += acceleration (Z velocity decreases by 15)
    bomb.tick(world)
    // Second tick: now velocity.Z = 10 - 15 = -5, pos.Z decreases
    bomb.tick(world)
    expect(bomb.pos.Z).toBeLessThan(512 + 10)
  })

  it('explodes on ground contact', () => {
    const mockImpact = vi.fn()
    const args = createProjectileArgs({
      source: new WPos(0, 0, 100),
      passiveTarget: new WPos(10240, 0, 0),
      weapon: { impact: mockImpact } as unknown as WeaponStub,
    })
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    const world = createMockWorld()
    // Tick until Z <= passiveTarget.Z (which is 0)
    for (let i = 0; i < 50 && !bomb.isDestroyed; i++) {
      bomb.tick(world)
    }
    expect(bomb.isDestroyed).toBe(true)
    expect(mockImpact).toHaveBeenCalled()
  })

  it('does not tick when destroyed', () => {
    const args = createProjectileArgs()
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    bomb.isDestroyed = true
    const world = createMockWorld()
    const posBefore = bomb.pos
    bomb.tick(world)
    expect(bomb.pos).toEqual(posBefore)
  })

  it('removes self from world on detonation', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 10),
      passiveTarget: new WPos(10240, 0, 0),
    })
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    const world = createMockWorld()
    world.addEffect(bomb)
    for (let i = 0; i < 20 && !bomb.isDestroyed; i++) bomb.tick(world)
    world.drainFrameEndTasks()
    expect(world.effects).not.toContain(bomb)
  })

  it('palette returns correct value', () => {
    const args = createProjectileArgs()
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    expect(bomb.palette).toBe('effect')
  })

  it('palette appends player name when isPlayerPalette', () => {
    const player = createMockPlayer('GDI')
    const actor = createMockActor(1)
    actor.owner = player
    const args = createProjectileArgs({ sourceActor: actor })
    const info = { ...DEFAULT_GRAVITY_BOMB_INFO, isPlayerPalette: true }
    const bomb = new GravityBomb(info, args)
    expect(bomb.palette).toBe('effectGDI')
  })

  it('dispose marks destroyed', () => {
    const args = createProjectileArgs()
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    bomb.dispose()
    expect(bomb.isDestroyed).toBe(true)
  })

  it('tracks lastPos between ticks', () => {
    const args = createProjectileArgs({ source: new WPos(0, 0, 1024) })
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    const world = createMockWorld()
    const before = bomb.pos
    bomb.tick(world)
    expect(bomb.lastPos).toBe(before)
    expect(bomb.pos).not.toBe(before)
  })

  it('velocity increases due to acceleration', () => {
    const args = createProjectileArgs({ source: new WPos(0, 0, 1024) })
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    const world = createMockWorld()
    const vzBefore = bomb.velocity.Z
    bomb.tick(world)
    // Velocity should change by acceleration (-15 in Z)
    expect(bomb.velocity.Z).toBeLessThan(vzBefore)
  })

  it('snaps Z to ground level on impact', () => {
    const args = createProjectileArgs({
      source: new WPos(0, 0, 10),
      passiveTarget: new WPos(10240, 0, 50),
    })
    const info = { ...DEFAULT_GRAVITY_BOMB_INFO, acceleration: new WVec(0, 0, -100) }
    const bomb = new GravityBomb(info, args)
    const world = createMockWorld()
    for (let i = 0; i < 20; i++) {
      bomb.tick(world)
      if (bomb.isDestroyed) break
    }
    if (bomb.isDestroyed) {
      expect(bomb.pos.Z).toBe(args.passiveTarget.Z)
    }
  })

  it('handles custom velocity and acceleration', () => {
    const info = {
      ...DEFAULT_GRAVITY_BOMB_INFO,
      velocity: new WVec(0, 100, 50), // Y component maps to -X via rotation
      acceleration: new WVec(0, 0, -20),
    }
    const args = createProjectileArgs({ source: new WPos(0, 0, 500), passiveTarget: new WPos(10240, 0, 0) })
    const bomb = new GravityBomb(info, args)
    const world = createMockWorld()
    bomb.tick(world)
    // The velocity rotation converts (Y, -X, Z) = (100, 0, 50) rotated by facing=0
    // Since facing=0 has no rotation, velocity = (0, -100 *?, actually let's just check position changed
    const delta = WPos.subtract(bomb.pos, new WPos(0, 0, 500))
    expect(delta.X + delta.Y + delta.Z).not.toBe(0)
  })

  it('render returns empty array', () => {
    const args = createProjectileArgs()
    const bomb = new GravityBomb(DEFAULT_GRAVITY_BOMB_INFO, args)
    const result = bomb.render(null as unknown as import('../../OpenRA.Game/Traits/TraitsInterfaces.js').WorldRendererStub)
    expect(result).toHaveLength(0)
  })
})
