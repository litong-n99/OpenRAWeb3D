/**
 * TSResourceLayer.test.ts — Unit tests
 */
import { describe, it, expect } from 'vitest'
import { TSResourceLayer, TSResourceLayerInfo } from './TSResourceLayer.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

describe('TSResourceLayer', () => {
  function makeActor(): any {
    return { world: { map: { contains: () => true, ramp: () => 0, getTerrainInfo: () => ({ type: 'Tiberium' }) } } }
  }

  it('should create with default vein type', () => {
    const info = new TSResourceLayerInfo()
    expect(info.veinType).toBe('Veins')
  })

  it('should track veinhole cells', () => {
    const info = new TSResourceLayerInfo({
      veinType: 'Veins',
      veinholeActors: new Set(['veinhole']),
    })
    const layer = new TSResourceLayer(makeActor(), info)
    expect(layer.veinholeCellCount).toBe(0)

    // Add a veinhole actor
    const veinholeActor = {
      info: { name: 'veinhole' },
      occupiesSpace: { occupiedCells: () => [{ cell: { X: 10, Y: 20 } }] },
    } as any
    ;(layer as any)._actorAddedToWorld(veinholeActor)
    expect(layer.veinholeCellCount).toBe(1)
    expect(layer.isVeinholeCell({ X: 10, Y: 20 } as CPos)).toBe(true)
  })

  it('should remove veinhole cells on actor removal', () => {
    const info = new TSResourceLayerInfo({
      veinholeActors: new Set(['veinhole']),
    })
    const layer = new TSResourceLayer(makeActor(), info)
    const veinholeActor = {
      info: { name: 'veinhole' },
      occupiesSpace: { occupiedCells: () => [{ cell: { X: 10, Y: 20 } }] },
    } as any
    ;(layer as any)._actorAddedToWorld(veinholeActor)
    expect(layer.veinholeCellCount).toBe(1)
    ;(layer as any)._actorRemovedFromWorld(veinholeActor)
    expect(layer.veinholeCellCount).toBe(0)
  })

  it('should reject resources on steep slopes', () => {
    const actor: any = {
      world: {
        map: {
          contains: () => true,
          ramp: () => 8, // Steep slope (> 4)
          getTerrainInfo: () => ({ type: 'Tiberium' }),
        },
      },
    }
    const info = new TSResourceLayerInfo({
      resourceTypes: new Map([
        ['Tiberium', { allowedTerrainTypes: new Set(['Tiberium']) }],
      ]),
    })
    const layer = new TSResourceLayer(actor, info)
    expect(layer.allowResourceAt('Tiberium', { X: 5, Y: 5 } as CPos)).toBe(false)
  })

  it('should reject resources without matching terrain type', () => {
    const actor: any = {
      world: {
        map: {
          contains: () => true,
          ramp: () => 0,
          getTerrainInfo: () => ({ type: 'Clear' }),
        },
      },
    }
    const info = new TSResourceLayerInfo({
      resourceTypes: new Map([
        ['Tiberium', { allowedTerrainTypes: new Set(['Tiberium']) }],
      ]),
    })
    const layer = new TSResourceLayer(actor, info)
    expect(layer.allowResourceAt('Tiberium', { X: 5, Y: 5 } as CPos)).toBe(false)
  })

  it('should clean up on dispose', () => {
    const info = new TSResourceLayerInfo({ veinholeActors: new Set(['test']) })
    const layer = new TSResourceLayer(makeActor(), info)
    const actor = { info: { name: 'test' }, occupiesSpace: { occupiedCells: () => [{ cell: { X: 1, Y: 1 } }] } }
    ;(layer as any)._actorAddedToWorld(actor as any)
    expect(layer.veinholeCellCount).toBe(1)
    layer.dispose()
    expect(layer.veinholeCellCount).toBe(0)
  })
})
