/**
 * BridgeLayer.test.ts — unit tests for BridgeLayer
 *
 * Tests focus on: bridge registration, unregistration, cell-level lookup,
 * blocked state checking, and add/remove lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import {
  BridgeLayer,
  BridgeLayerInfo,
  type IBridgeActorStub,
  type IBuildingInfoStub,
} from './BridgeLayer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cpos(x: number, y: number): CPos {
  return new CPos(x, y)
}

interface TestBridgeActor extends IBridgeActorStub {
  name: string
}

function makeBridgeActor(
  name: string,
  location: CPos,
  pathableTiles: readonly CPos[],
): TestBridgeActor {
  return {
    name,
    location,
    info: {
      traitInfo(): IBuildingInfoStub {
        return {
          pathableTiles(_c: CPos): readonly CPos[] {
            return pathableTiles
          },
        }
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BridgeLayerInfo', () => {
  it('constructs with default values', () => {
    const info = new BridgeLayerInfo()
    expect(info).toBeDefined()
    expect(info.instanceName).toBeUndefined()
  })

  it('accepts optional instanceName', () => {
    const info = new BridgeLayerInfo({ instanceName: 'test-layer' })
    expect(info.instanceName).toBe('test-layer')
  })

  it('create returns a BridgeLayer', () => {
    const info = new BridgeLayerInfo()
    const layer = info.create(MapGridType.Rectangular, {
      width: 16,
      height: 16,
    })
    expect(layer).toBeInstanceOf(BridgeLayer)
  })
})

describe('BridgeLayer', () => {
  let layer: BridgeLayer

  beforeEach(() => {
    layer = new BridgeLayer(MapGridType.Rectangular, { width: 32, height: 32 })
  })

  // -------------------------------------------------------------------------
  // getBridge — initial state
  // -------------------------------------------------------------------------

  it('getBridge returns null for cells with no bridge', () => {
    expect(layer.getBridge(cpos(5, 5))).toBeNull()
    expect(layer.getBridge(cpos(0, 0))).toBeNull()
    expect(layer.getBridge(cpos(31, 31))).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Add — register bridge actor
  // -------------------------------------------------------------------------

  it('add registers bridge on all pathable tiles', () => {
    const pathable = [cpos(10, 10), cpos(11, 10), cpos(10, 11), cpos(11, 11)]
    const bridge = makeBridgeActor('bridge1', cpos(10, 10), pathable)

    layer.add(bridge)

    for (const cell of pathable) {
      expect(layer.getBridge(cell)).toBe(bridge)
    }
  })

  it('add registers single-cell bridge', () => {
    const pathable = [cpos(5, 5)]
    const bridge = makeBridgeActor('small-bridge', cpos(5, 5), pathable)

    layer.add(bridge)

    expect(layer.getBridge(cpos(5, 5))).toBe(bridge)
    // Adjacent cells should not be affected
    expect(layer.getBridge(cpos(6, 5))).toBeNull()
  })

  // -------------------------------------------------------------------------
  // Remove — unregister bridge actor
  // -------------------------------------------------------------------------

  it('remove clears bridge from all pathable tiles', () => {
    const pathable = [cpos(10, 10), cpos(11, 10), cpos(10, 11), cpos(11, 11)]
    const bridge = makeBridgeActor('bridge1', cpos(10, 10), pathable)

    layer.add(bridge)
    layer.remove(bridge)

    for (const cell of pathable) {
      expect(layer.getBridge(cell)).toBeNull()
    }
  })

  it('remove only clears cells belonging to that specific bridge', () => {
    const pathable1 = [cpos(10, 10), cpos(11, 10)]
    const pathable2 = [cpos(20, 20), cpos(21, 20)]
    const bridge1 = makeBridgeActor('bridge1', cpos(10, 10), pathable1)
    const bridge2 = makeBridgeActor('bridge2', cpos(20, 20), pathable2)

    layer.add(bridge1)
    layer.add(bridge2)

    // Remove only bridge1
    layer.remove(bridge1)

    // bridge1 cells cleared
    expect(layer.getBridge(cpos(10, 10))).toBeNull()
    expect(layer.getBridge(cpos(11, 10))).toBeNull()

    // bridge2 cells still present
    expect(layer.getBridge(cpos(20, 20))).toBe(bridge2)
    expect(layer.getBridge(cpos(21, 20))).toBe(bridge2)
  })

  // -------------------------------------------------------------------------
  // isBridgeBlocked / hasBridge
  // -------------------------------------------------------------------------

  it('isBridgeBlocked returns true for cells with no bridge', () => {
    // Initially all cells have null bridge → all blocked
    expect(layer.isBridgeBlocked(cpos(0, 0))).toBe(true)
  })

  it('hasBridge returns false for cells with no bridge', () => {
    expect(layer.hasBridge(cpos(0, 0))).toBe(false)
  })

  it('hasBridge returns true after adding a bridge', () => {
    const bridge = makeBridgeActor('bridge', cpos(5, 5), [cpos(5, 5)])
    layer.add(bridge)

    expect(layer.hasBridge(cpos(5, 5))).toBe(true)
  })

  it('hasBridge returns false after removing a bridge', () => {
    const bridge = makeBridgeActor('bridge', cpos(5, 5), [cpos(5, 5)])
    layer.add(bridge)
    layer.remove(bridge)

    expect(layer.hasBridge(cpos(5, 5))).toBe(false)
  })
})
