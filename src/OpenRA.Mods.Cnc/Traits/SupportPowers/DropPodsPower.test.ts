/**
 * DropPodsPower.test.ts — Unit tests
 */
import { describe, it, expect, vi } from 'vitest'
import { DropPodsPower, DropPodsPowerInfo } from './DropPodsPower.js'

describe('DropPodsPowerInfo', () => {
  it('should have default values', () => {
    const info = new DropPodsPowerInfo()
    expect(info.drops).toEqual([5, 8])
    expect(info.podScatter).toBe(3)
    expect(info.weaponDelay).toBe(0)
    expect(info.entryEffect).toBe('podring')
  })
})

describe('DropPodsPower', () => {
  function makeWorld(): any {
    return {
      map: {
        contains: () => true,
        centerOfCell: (c: any) => ({ X: c.X * 1024, Y: c.Y * 1024, Z: 0 }),
        cellContaining: () => ({ X: 5, Y: 5 }),
        getTerrainInfo: () => ({ type: 'Water' }),
      },
      actorMap: { getActorsAt: () => [] },
      sharedRandom: { nextInt: (max: number) => 0 },
      addEffect: vi.fn(),
    }
  }

  it('should construct with unit types', () => {
    const info = new DropPodsPowerInfo({ unitTypes: ['pod1', 'pod2'] })
    const actor: any = { world: makeWorld() }
    const power = new DropPodsPower(actor, info)
    expect(power.info.unitTypes).toEqual(['pod1', 'pod2'])
  })

  it('should find tiles in circle', () => {
    const info = new DropPodsPowerInfo()
    const actor: any = { world: makeWorld() }
    const power = new DropPodsPower(actor, info)
    const tiles = (power as any)._findTilesInCircle(actor.world, { X: 5, Y: 5 }, 1)
    // Circle with radius 1 around (5,5): points within radius 1: (4,5),(5,4),(5,5),(5,6),(6,5)
    expect(tiles.length).toBeGreaterThanOrEqual(5)
  })

  it('should validate activation target cell', () => {
    const info = new DropPodsPowerInfo({ unitTypes: ['pod'] })
    const actor: any = { world: makeWorld() }
    const power = new DropPodsPower(actor, info)
    expect(power.canActivate(actor.world, { X: 5, Y: 5 })).toBe(true)
  })

  it('should send drop pods on activate', () => {
    const info = new DropPodsPowerInfo({
      unitTypes: ['pod1'],
      drops: [2, 2],
      podScatter: 1,
    })
    const world = makeWorld()
    const actor: any = {
      world,
      owner: { id: 1 },
    }
    const power = new DropPodsPower(actor, info)
    const order = {
      orderName: 'test',
      target: { centerPosition: { X: 5000, Y: 5000, Z: 0 } },
    }
    const manager: any = { self: actor, powers: new Map() }
    power.activate(actor, order, manager)
    // Effects should be added (at least 2 pods)
    expect(world.addEffect).toHaveBeenCalled()
    // Verify at least 2 drop pod effects were created
    const callCount = world.addEffect.mock.calls.length
    expect(callCount).toBeGreaterThanOrEqual(2)
  })
})
