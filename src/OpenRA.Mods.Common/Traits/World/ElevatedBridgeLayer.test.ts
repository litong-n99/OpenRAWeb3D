/**
 * ElevatedBridgeLayer.test.ts — unit tests for ElevatedBridgeLayer
 *
 * Tests focus on: ICustomMovementLayer compliance, terrain index setup,
 * cell center computation, entry/exit movement costs, and end cell
 * registration.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import { WPos } from '../../../OpenRA.Game/WPos'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import {
  ElevatedBridgeLayer,
  ElevatedBridgeLayerInfo,
  type IElevatedBridgeMap,
  type IElevatedBridgeWorld,
  type IElevatedBridgeWorldActorInfo,
  CELL_HEIGHT_STEP,
} from './ElevatedBridgeLayer'
import { ElevatedBridgePlaceholderInfo, ElevatedBridgePlaceholderOrientation } from './ElevatedBridgePlaceholder'
import { CustomMovementLayerType } from './Locomotor'
import type { LocomotorInfo } from './Locomotor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cpos(x: number, y: number, layer?: number): CPos {
  return new CPos(x, y, layer ?? 0)
}

function makeMap(overrides: Partial<IElevatedBridgeMap> = {}): IElevatedBridgeMap {
  return {
    gridType: MapGridType.Rectangular,
    mapSize: { width: 32, height: 32 },
    centerOfCell(_cell: CPos): WPos {
      // Simple rectangular center: 1024 * (X, Y, 0)
      return new WPos(_cell.X * 1024, _cell.Y * 1024, 0)
    },
    rules: {
      terrainInfo: {
        getTerrainIndex(type: string): number {
          // Simple terrain index lookup
          if (type === 'Impassable') return 255
          if (type === 'Road') return 1
          if (type === 'Clear') return 0
          return 255
        },
      },
    },
    ...overrides,
  }
}

function makePlaceholder(opts: {
  x?: number
  y?: number
  orientation?: typeof ElevatedBridgePlaceholderOrientation.X | typeof ElevatedBridgePlaceholderOrientation.Y
  length?: number
  height?: number
  terrainType?: string
} = {}): ElevatedBridgePlaceholderInfo {
  return new ElevatedBridgePlaceholderInfo({
    location: cpos(opts.x ?? 5, opts.y ?? 5),
    orientation: opts.orientation ?? ElevatedBridgePlaceholderOrientation.X,
    length: opts.length ?? 3,
    height: opts.height ?? 2,
    terrainType: opts.terrainType,
  })
}

function makeWorldActorInfo(
  placeholders: ElevatedBridgePlaceholderInfo[],
): IElevatedBridgeWorldActorInfo {
  return {
    traitInfos(): ElevatedBridgePlaceholderInfo[] {
      return placeholders
    },
  }
}

function makeWorld(opts: {
  map?: IElevatedBridgeMap
  placeholders?: ElevatedBridgePlaceholderInfo[]
} = {}): IElevatedBridgeWorld {
  return {
    map: opts.map ?? makeMap(),
    worldActor: {
      info: makeWorldActorInfo(opts.placeholders ?? []),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ElevatedBridgeLayerInfo', () => {
  it('defaults ImpassableTerrainType to "Impassable"', () => {
    const info = new ElevatedBridgeLayerInfo()
    expect(info.ImpassableTerrainType).toBe('Impassable')
  })

  it('allows custom ImpassableTerrainType', () => {
    const info = new ElevatedBridgeLayerInfo({ impassableTerrainType: 'Water' })
    expect(info.ImpassableTerrainType).toBe('Water')
  })

  it('create returns an ElevatedBridgeLayer', () => {
    const info = new ElevatedBridgeLayerInfo()
    const world = makeWorld()
    const layer = info.create(world)
    expect(layer).toBeInstanceOf(ElevatedBridgeLayer)
  })
})

describe('ElevatedBridgeLayer', () => {
  let world: IElevatedBridgeWorld
  let info: ElevatedBridgeLayerInfo
  let layer: ElevatedBridgeLayer

  beforeEach(() => {
    info = new ElevatedBridgeLayerInfo()
    world = makeWorld()
    layer = new ElevatedBridgeLayer(world, info)
  })

  // -------------------------------------------------------------------------
  // ICustomMovementLayer properties
  // -------------------------------------------------------------------------

  it('Index is CustomMovementLayerType.ElevatedBridge (4)', () => {
    expect(layer.Index).toBe(CustomMovementLayerType.ElevatedBridge)
    expect(layer.Index).toBe(4)
  })

  it('InteractsWithDefaultLayer is true', () => {
    expect(layer.InteractsWithDefaultLayer).toBe(true)
  })

  it('ReturnToGroundLayerOnIdle is false', () => {
    expect(layer.ReturnToGroundLayerOnIdle).toBe(false)
  })

  // -------------------------------------------------------------------------
  // enabledForLocomotor
  // -------------------------------------------------------------------------

  it('enabledForLocomotor returns false when no bridges exist', () => {
    // Before worldLoaded, no bridges registered
    const locomotorInfo = {} as LocomotorInfo
    expect(layer.enabledForLocomotor(locomotorInfo)).toBe(false)
  })

  it('enabledForLocomotor returns true after worldLoaded with bridge placeholders', () => {
    const worldWithBridge = makeWorld({
      placeholders: [makePlaceholder()],
    })
    layer.worldLoaded(worldWithBridge)
    const locomotorInfo = {} as LocomotorInfo
    expect(layer.enabledForLocomotor(locomotorInfo)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // centerOfCell
  // -------------------------------------------------------------------------

  it('centerOfCell returns bridge deck height (not ground height)', () => {
    const worldWithBridge = makeWorld({
      placeholders: [makePlaceholder({ x: 5, y: 5, height: 3 })],
    })
    layer.worldLoaded(worldWithBridge)

    const cell = cpos(5, 5)
    const center = layer.centerOfCell(cell)

    // Bridge deck height: CELL_HEIGHT_STEP * Height = 512 * 3 = 1536
    expect(center.Z).toBe(CELL_HEIGHT_STEP * 3) // 1536
    expect(center.X).toBe(5 * 1024)
    expect(center.Y).toBe(5 * 1024)
  })

  // -------------------------------------------------------------------------
  // entryMovementCost / exitMovementCost
  // -------------------------------------------------------------------------

  it('entryMovementCost returns 0 at end cells', () => {
    const placeholder = makePlaceholder({ x: 10, y: 10, length: 4 })
    const worldWithBridge = makeWorld({ placeholders: [placeholder] })
    layer.worldLoaded(worldWithBridge)

    const locomotorInfo = {} as LocomotorInfo

    // End cells (left side): (10, 10), (10, 11), (10, 12)
    expect(layer.entryMovementCost(locomotorInfo, cpos(10, 10))).toBe(0)
    expect(layer.entryMovementCost(locomotorInfo, cpos(10, 11))).toBe(0)
    expect(layer.entryMovementCost(locomotorInfo, cpos(10, 12))).toBe(0)
  })

  it('entryMovementCost returns unreachable at non-end cells', () => {
    const placeholder = makePlaceholder({ x: 10, y: 10, length: 4 })
    const worldWithBridge = makeWorld({ placeholders: [placeholder] })
    layer.worldLoaded(worldWithBridge)

    const locomotorInfo = {} as LocomotorInfo

    // Middle cell of bridge: (12, 11) — should NOT be an end cell
    expect(layer.entryMovementCost(locomotorInfo, cpos(12, 11))).toBe(
      PathGraph.MovementCostForUnreachableCell,
    )
  })

  it('exitMovementCost mirrors entryMovementCost', () => {
    const placeholder = makePlaceholder({ x: 10, y: 10, length: 4 })
    const worldWithBridge = makeWorld({ placeholders: [placeholder] })
    layer.worldLoaded(worldWithBridge)

    const locomotorInfo = {} as LocomotorInfo

    // End cells allow exit
    expect(layer.exitMovementCost(locomotorInfo, cpos(10, 11))).toBe(0)
    expect(layer.exitMovementCost(locomotorInfo, cpos(14, 11))).toBe(0)
    // Non-end cells block exit
    expect(layer.exitMovementCost(locomotorInfo, cpos(12, 11))).toBe(
      PathGraph.MovementCostForUnreachableCell,
    )
  })

  // -------------------------------------------------------------------------
  // getTerrainIndex
  // -------------------------------------------------------------------------

  it('getTerrainIndex returns bridge terrain type for bridge cells', () => {
    const worldWithBridge = makeWorld({
      placeholders: [makePlaceholder({ x: 5, y: 5, terrainType: 'Road' })],
    })
    layer.worldLoaded(worldWithBridge)

    // Bridge cell should have Road terrain index (1)
    expect(layer.getTerrainIndex(cpos(5, 5))).toBe(1)
  })

  it('getTerrainIndex returns impassable for non-bridge cells outside any footprint', () => {
    const worldWithBridge = makeWorld({
      placeholders: [makePlaceholder({ x: 5, y: 5 })],
    })
    layer.worldLoaded(worldWithBridge)

    // Cell far from the bridge should be impassable (255)
    expect(layer.getTerrainIndex(cpos(20, 20))).toBe(255)
  })

  // -------------------------------------------------------------------------
  // Multiple bridges
  // -------------------------------------------------------------------------

  it('worldLoaded handles multiple bridge footpaths', () => {
    const placeholder1 = makePlaceholder({ x: 5, y: 5, length: 2 })
    const placeholder2 = makePlaceholder({ x: 15, y: 15, length: 2 })
    const worldMulti = makeWorld({ placeholders: [placeholder1, placeholder2] })
    layer.worldLoaded(worldMulti)

    // Both bridges should have Road terrain
    expect(layer.getTerrainIndex(cpos(5, 6))).toBe(1)
    expect(layer.getTerrainIndex(cpos(16, 16))).toBe(1)

    // Space between bridges should be impassable
    expect(layer.getTerrainIndex(cpos(10, 10))).toBe(255)
  })
})

describe('CELL_HEIGHT_STEP', () => {
  it('equals 512 (WDist.CellHeightStep.Length)', () => {
    expect(CELL_HEIGHT_STEP).toBe(512)
  })
})
