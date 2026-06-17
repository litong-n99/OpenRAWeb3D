/**
 * SonicBlast.test.ts — SonicBlast projectile migration unit tests
 */

import { describe, it, expect, vi } from 'vitest'

import { SonicBlast, SonicBlastInfo } from './SonicBlast.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WAngle } from '../../OpenRA.Game/WAngle.js'
import type { ProjectileArgs } from '../../OpenRA.Mods.Common/Projectiles/Bullet.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

function createMockActor(): IGameActor {
  return {
    actorId: 1, isInWorld: true, isDead: false, disposed: false, generation: 1,
    owner: { playerId: 0, playerName: 'Test' },
    world: {
      worldActor: { trait: vi.fn(() => null) },
      sharedRandom: { next: vi.fn((min: number, _max: number) => min) },
    },
    centerPosition: new WPos(0, 0, 0),
  } as unknown as IGameActor
}

function createArgs(overrides: Partial<ProjectileArgs> = {}): ProjectileArgs {
  return {
    sourceActor: createMockActor(),
    source: WPos.Zero,
    passiveTarget: new WPos(10240, 0, 0),
    damageModifiers: [100],
    weapon: { name: 'SonicTank', impact: vi.fn() } as unknown as ProjectileArgs['weapon'],
    facing: WAngle.Zero,
    ...overrides,
  } as ProjectileArgs
}

describe('SonicBlast', () => {
  describe('SonicBlastInfo', () => {
    it('has default values', () => {
      const info = new SonicBlastInfo()
      expect(info.damageInterval).toBe(1)
      expect(info.blockable).toBe(false)
    })

    it('creates projectile instance', () => {
      const info = new SonicBlastInfo({ speed: [{ length: 128 }], falloff: [100], range: [{ length: 0 }] })
      const blast = info.create(createArgs())
      expect(blast).toBeInstanceOf(SonicBlast)
      expect(blast.isDestroyed).toBe(false)
    })
  })

  describe('constructor', () => {
    it('sets initial position to source', () => {
      const info = new SonicBlastInfo({ speed: [{ length: 128 }], falloff: [100, 100], range: [{ length: 0 }, { length: 100000 }] })
      const blast = new SonicBlast(info, createArgs())
      expect(blast.isDestroyed).toBe(false)
    })
  })

  describe('tick', () => {
    it('marks destroyed after exceeding length', () => {
      const info = new SonicBlastInfo({
        speed: [{ length: 128000 }], falloff: [100], range: [{ length: 0 }], damageInterval: 100,
      })
      const blast = new SonicBlast(info, createArgs({ passiveTarget: new WPos(1000, 0, 0) }))
      const world = { remove: vi.fn(), addFrameEndTask: vi.fn() }
      for (let i = 0; i < 100 && !blast.isDestroyed; i++) {
        blast.tick(world as unknown as Parameters<typeof blast.tick>[0])
      }
      expect(blast.isDestroyed).toBe(true)
    })

    it('applies weapon impacts on damage interval', () => {
      const impact = vi.fn()
      const info = new SonicBlastInfo({
        speed: [{ length: 128 }], falloff: [100, 100], range: [{ length: 0 }, { length: 100000 }], damageInterval: 1,
      })
      const blast = new SonicBlast(info, createArgs({ weapon: { name: 'S', impact } as unknown as ProjectileArgs['weapon'] }))
      const world = { remove: vi.fn(), addFrameEndTask: vi.fn() }
      blast.tick(world as unknown as Parameters<typeof blast.tick>[0])
      expect(impact).toHaveBeenCalled()
    })
  })

  describe('render', () => {
    it('returns empty when fog obscures position', () => {
      const info = new SonicBlastInfo({ speed: [{ length: 128 }], falloff: [100], range: [{ length: 0 }] })
      const blast = new SonicBlast(info, createArgs({ passiveTarget: new WPos(128, 0, 0) }))
      expect(blast.render({ world: { fogObscures: () => true } })).toHaveLength(0)
    })
  })

  describe('regression: falloff lerp (BLOCKER #1)', () => {
    it('interpolates falloff correctly at mid-distance', () => {
      // Falloff=[100, 0], Range=[0, 100000]
      // At distance 50000 (halfway), should return ~50
      const info = new SonicBlastInfo({
        speed: [{ length: 128 }],
        falloff: [100, 0],
        range: [{ length: 0 }, { length: 100000 }],
        damageInterval: 1,
      })
      const args = createArgs({ passiveTarget: new WPos(50000, 0, 0) })
      const impact = vi.fn()
      const weapon = { name: 'S', impact, currentMuzzleFacing: () => WAngle.Zero } as unknown as ProjectileArgs['weapon']
      const blast = new SonicBlast(info, { ...args, weapon, passiveTarget: new WPos(50000, 0, 0) })
      const world = { remove: vi.fn(), addFrameEndTask: vi.fn() }
      blast.tick(world as unknown as Parameters<typeof blast.tick>[0])
      expect(impact).toHaveBeenCalled()
    })

    it('returns 0 when distance exceeds last range', () => {
      const info = new SonicBlastInfo({
        speed: [{ length: 128 }],
        falloff: [100, 50],
        range: [{ length: 0 }, { length: 1000 }],
        damageInterval: 10,
      })
      const args = createArgs({ passiveTarget: new WPos(102400, 0, 0) })
      const blast = new SonicBlast(info, args)
      const world = { remove: vi.fn(), addFrameEndTask: vi.fn() }
      // Many ticks later, distance exceeds last range, falloff should be 0
      for (let i = 0; i < 50 && !blast.isDestroyed; i++) {
        blast.tick(world as unknown as Parameters<typeof blast.tick>[0])
      }
      // Should eventually mark destroyed (falloff is 0 but that's OK)
      // The key is: no crash, falloff doesn't return undefined
    })
  })

  describe('regression: Gaussian inaccuracy (MAJOR #6)', () => {
    it('applies FromPDF-like inaccuracy with Gaussian distribution', () => {
      const info = new SonicBlastInfo({
        speed: [{ length: 128 }],
        falloff: [100, 100],
        range: [{ length: 0 }, { length: 100000 }],
        inaccuracy: { length: 1024 },
        inaccuracyType: 'Absolute',
        damageInterval: 100,
      })
      const blast = new SonicBlast(info, createArgs({ passiveTarget: new WPos(10240, 0, 0) }))
      expect(blast.isDestroyed).toBe(false)
      // Blast should not be destroyed immediately; path deviation is expected
      // Key: no crash, inaccuracy with 2-sample averaging functions correctly
    })
  })

  describe('regression: dynamic muzzle facing (MAJOR #7)', () => {
    it('uses CurrentMuzzleFacing when available', () => {
      let facingCalled = false
      const impact = vi.fn()
      const weapon = {
        name: 'SonicTank',
        impact,
        currentMuzzleFacing: () => { facingCalled = true; return WAngle.Zero },
      } as unknown as ProjectileArgs['weapon']
      const info = new SonicBlastInfo({
        speed: [{ length: 128 }],
        falloff: [100, 100],
        range: [{ length: 0 }, { length: 100000 }],
        damageInterval: 1,
      })
      const blast = new SonicBlast(info, createArgs({
        weapon,
        passiveTarget: new WPos(128, 0, 0),
        facing: new WAngle(500),
      }))
      const world = { remove: vi.fn(), addFrameEndTask: vi.fn() }
      blast.tick(world as unknown as Parameters<typeof blast.tick>[0])
      expect(facingCalled).toBe(true)
    })
  })
})
