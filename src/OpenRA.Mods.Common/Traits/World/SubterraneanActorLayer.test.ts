/**
 * SubterraneanActorLayer.test.ts — SubterraneanActorLayer migration unit tests
 *
 * Tests focus on:
 * - SubterraneanActorLayerInfo default values
 * - SubterraneanActorLayerInfo custom values
 * - SubterraneanActorLayer implements ICustomMovementLayer
 * - Index returns CustomMovementLayerType.Subterranean (2)
 * - enabledForLocomotor for SubterraneanLocomotorInfo vs regular LocomotorInfo
 * - entryMovementCost / exitMovementCost validation
 * - centerOfCell Z adjustment
 * - getTerrainIndex returns uniform terrain index
 * - Smoothing height calculation
 * - InteractsWithDefaultLayer and ReturnToGroundLayerOnIdle
 */

import { describe, it, expect } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import { WPos } from '../../../OpenRA.Game/WPos'
import { WDist } from '../../../OpenRA.Game/WDist'
import { CellLayer } from '../../../OpenRA.Game/Map/CellLayer'
import { MapGridType } from '../../../OpenRA.Game/Map/MapGridType'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import { LocomotorInfo } from './Locomotor'
import { SubterraneanLocomotorInfo } from './SubterraneanLocomotor'
import {
  SubterraneanActorLayerInfo,
  SubterraneanActorLayer,
  type ISubterraneanMap,
} from './SubterraneanActorLayer'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal map mock for testing SubterraneanActorLayer. */
function createMockMap(
  overrides?: Partial<{
    width: number
    height: number
    heightValues: number[]
    rampValues: number[]
    centerX: number
    centerY: number
    centerZ: number
    terrainType: string
    terrainIndex: number
  }>,
): ISubterraneanMap {
  const w = overrides?.width ?? 4
  const h = overrides?.height ?? 4
  const heightVals = overrides?.heightValues ?? new Array(w * h).fill(5)
  const rampVals = overrides?.rampValues ?? new Array(w * h).fill(0)
  const terrainType = overrides?.terrainType ?? 'Clear'
  const terrainIndex = overrides?.terrainIndex ?? 0
  const centerX = overrides?.centerX ?? 512
  const centerY = overrides?.centerY ?? 512
  const centerZ = overrides?.centerZ ?? 0

  const mapSize = { width: w, height: h }
  const gridType = MapGridType.Rectangular
  const height = new CellLayer<number>(gridType, mapSize)
  const ramp = new CellLayer<number>(gridType, mapSize)

  // Fill height and ramp layers
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = new CPos(x, y)
      const idx = y * w + x
      height.set(cell, heightVals[idx] ?? 0)
      ramp.set(cell, rampVals[idx] ?? 0)
    }
  }

  return {
    contains(cell: CPos): boolean {
      return cell.X >= 0 && cell.X < w && cell.Y >= 0 && cell.Y < h
    },
    height,
    ramp,
    getTerrainInfo(_cell: CPos): { readonly Type: string } {
      return { Type: terrainType }
    },
    allCells: function* (): Iterable<CPos> {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          yield new CPos(x, y)
        }
      }
    },
    centerOfCell(_cell: CPos): WPos {
      return new WPos(centerX, centerY, centerZ)
    },
    mapSize,
    gridType,
    rules: {
      terrainInfo: {
        getTerrainIndex(_terrainType: string): number {
          return terrainIndex
        },
      },
    },
  }
}

/** Create a minimal SubterraneanLocomotorInfo for testing. */
function createSubLI(opts?: {
  transitionCost?: number
  transitionTerrainTypes?: ReadonlySet<string>
  transitionOnRamps?: boolean
}): SubterraneanLocomotorInfo {
  return new SubterraneanLocomotorInfo({
    name: 'drill',
    subterraneanTransitionCost: opts?.transitionCost ?? 10,
    subterraneanTransitionTerrainTypes: opts?.transitionTerrainTypes ?? new Set(),
    subterraneanTransitionOnRamps: opts?.transitionOnRamps ?? false,
  })
}

// ---------------------------------------------------------------------------
// SubterraneanActorLayerInfo
// ---------------------------------------------------------------------------

describe('SubterraneanActorLayerInfo', () => {
  describe('default values', () => {
    it('TerrainType defaults to "Subterranean"', () => {
      const info = new SubterraneanActorLayerInfo()
      expect(info.TerrainType).toBe('Subterranean')
    })

    it('HeightOffset defaults to WDist(-2048)', () => {
      const info = new SubterraneanActorLayerInfo()
      expect(info.HeightOffset).toBeInstanceOf(WDist)
      expect(info.HeightOffset.length).toBe(-2048)
    })

    it('SmoothingRadius defaults to 2', () => {
      const info = new SubterraneanActorLayerInfo()
      expect(info.SmoothingRadius).toBe(2)
    })
  })

  describe('custom values', () => {
    it('accepts custom TerrainType', () => {
      const info = new SubterraneanActorLayerInfo({ terrainType: 'DeepTunnel' })
      expect(info.TerrainType).toBe('DeepTunnel')
    })

    it('accepts custom HeightOffset', () => {
      const info = new SubterraneanActorLayerInfo({ heightOffset: new WDist(-1024) })
      expect(info.HeightOffset.length).toBe(-1024)
    })

    it('accepts custom SmoothingRadius', () => {
      const info = new SubterraneanActorLayerInfo({ smoothingRadius: 3 })
      expect(info.SmoothingRadius).toBe(3)
    })
  })
})

// ---------------------------------------------------------------------------
// SubterraneanActorLayer
// ---------------------------------------------------------------------------

describe('SubterraneanActorLayer', () => {
  describe('Index', () => {
    it('returns CustomMovementLayerType.Subterranean (2)', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      // CustomMovementLayerType.Subterranean === 2
      expect(layer.Index).toBe(2)
    })
  })

  describe('InteractsWithDefaultLayer', () => {
    it('is false', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      expect(layer.InteractsWithDefaultLayer).toBe(false)
    })
  })

  describe('ReturnToGroundLayerOnIdle', () => {
    it('is true', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      expect(layer.ReturnToGroundLayerOnIdle).toBe(true)
    })
  })

  describe('enabledForLocomotor', () => {
    it('returns true for SubterraneanLocomotorInfo', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI()
      expect(layer.enabledForLocomotor(sli)).toBe(true)
    })

    it('returns false for regular LocomotorInfo', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const regularLI = new LocomotorInfo({ name: 'infantry' })
      expect(layer.enabledForLocomotor(regularLI)).toBe(false)
    })

    it('returns false for a plain LocomotorInfo instance (not SubterraneanLocomotorInfo)', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const defaultLI = new LocomotorInfo()
      expect(layer.enabledForLocomotor(defaultLI)).toBe(false)
    })
  })

  describe('getTerrainIndex', () => {
    it('returns the terrain index configured at construction', () => {
      const map = createMockMap({ terrainIndex: 3 })
      const info = new SubterraneanActorLayerInfo({ terrainType: 'Subterranean' })
      const layer = new SubterraneanActorLayer(map, info)
      expect(layer.getTerrainIndex(new CPos(0, 0))).toBe(3)
    })

    it('returns the same index for any cell', () => {
      const map = createMockMap({ terrainIndex: 5 })
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      expect(layer.getTerrainIndex(new CPos(0, 0))).toBe(5)
      expect(layer.getTerrainIndex(new CPos(2, 2))).toBe(5)
      expect(layer.getTerrainIndex(new CPos(3, 3))).toBe(5)
    })
  })

  describe('entryMovementCost', () => {
    it('returns transition cost for valid transition cell', () => {
      const map = createMockMap({ heightValues: new Array(16).fill(5) })
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI({ transitionCost: 15 })
      expect(layer.entryMovementCost(sli, new CPos(2, 2))).toBe(15)
    })

    it('returns unreachable when cell has a ramp and transitionOnRamps is false', () => {
      const rampVals = new Array(16).fill(0)
      rampVals[2 * 4 + 2] = 1 // ramp at cell (2,2)
      const map = createMockMap({ rampValues: rampVals })
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI({ transitionOnRamps: false })
      expect(layer.entryMovementCost(sli, new CPos(2, 2))).toBe(PathGraph.MovementCostForUnreachableCell)
    })

    it('returns transition cost when cell has ramp but transitionOnRamps is true', () => {
      const rampVals = new Array(16).fill(0)
      rampVals[2 * 4 + 2] = 1 // ramp at cell (2,2)
      const map = createMockMap({ rampValues: rampVals })
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI({ transitionOnRamps: true })
      expect(layer.entryMovementCost(sli, new CPos(2, 2))).toBe(10)
    })

    it('returns unreachable when terrain type is not in allowed set', () => {
      const map = createMockMap({ terrainType: 'Water' })
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI({
        transitionTerrainTypes: new Set(['Ore', 'Beach']),
      })
      expect(layer.entryMovementCost(sli, new CPos(0, 0))).toBe(PathGraph.MovementCostForUnreachableCell)
    })

    it('returns transition cost when terrain type is in allowed set', () => {
      const map = createMockMap({ terrainType: 'Ore' })
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI({
        transitionCost: 20,
        transitionTerrainTypes: new Set(['Ore', 'Beach']),
      })
      expect(layer.entryMovementCost(sli, new CPos(0, 0))).toBe(20)
    })

    it('returns unreachable for regular LocomotorInfo (not subterranean)', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const regularLI = new LocomotorInfo({ name: 'vehicle' })
      expect(layer.entryMovementCost(regularLI, new CPos(0, 0))).toBe(PathGraph.MovementCostForUnreachableCell)
    })
  })

  describe('exitMovementCost', () => {
    it('returns transition cost for valid transition cell', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI({ transitionCost: 25 })
      expect(layer.exitMovementCost(sli, new CPos(1, 1))).toBe(25)
    })

    it('returns unreachable in same conditions as entry movement cost', () => {
      const rampVals = new Array(16).fill(0)
      rampVals[1 * 4 + 1] = 2 // ramp at cell (1,1)
      const map = createMockMap({ rampValues: rampVals })
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const sli = createSubLI({ transitionOnRamps: false })
      expect(layer.exitMovementCost(sli, new CPos(1, 1))).toBe(PathGraph.MovementCostForUnreachableCell)
    })

    it('returns unreachable for regular LocomotorInfo', () => {
      const map = createMockMap()
      const info = new SubterraneanActorLayerInfo()
      const layer = new SubterraneanActorLayer(map, info)
      const regularLI = new LocomotorInfo({ name: 'vehicle' })
      expect(layer.exitMovementCost(regularLI, new CPos(0, 0))).toBe(PathGraph.MovementCostForUnreachableCell)
    })
  })

  describe('centerOfCell', () => {
    it('adjusts Z by subterranean height offset', () => {
      const map = createMockMap({
        width: 4,
        height: 4,
        heightValues: new Array(16).fill(5),
        centerZ: 0,
        centerX: 1024,
        centerY: 1024,
      })
      const info = new SubterraneanActorLayerInfo({
        heightOffset: new WDist(-2048),
      })
      const layer = new SubterraneanActorLayer(map, info)

      const center = layer.centerOfCell(new CPos(1, 1))
      // Expected: centerZ (0) + (smoothedZ - centerZ)
      // smoothedZ = heightOffsetLen + avgHeight * 512
      // All cells have height 5, smoothing radius 2 → avg = 5 * 512
      // smoothedZ = -2048 + 2560 = 512
      // delta Z = 512 - 0 = 512
      expect(center.X).toBe(1024)
      expect(center.Y).toBe(1024)
      expect(center.Z).toBe(512)
    })

    it('returns the same X and Y as map.centerOfCell', () => {
      const map = createMockMap({
        width: 2,
        height: 2,
        heightValues: [0, 0, 0, 0],
        centerX: 768,
        centerY: 256,
        centerZ: 100,
      })
      const info = new SubterraneanActorLayerInfo({
        heightOffset: new WDist(-1024),
      })
      const layer = new SubterraneanActorLayer(map, info)

      const center = layer.centerOfCell(new CPos(0, 0))
      // All heights 0 → smoothedHeight = -1024 + 0 = -1024
      // centerOfCell → pos(768, 256, 100)
      // zDelta = smoothedHeight - pos.Z = -1024 - 100 = -1124
      // result Z = pos.Z + zDelta = 100 + (-1124) = -1024
      expect(center.X).toBe(768)
      expect(center.Y).toBe(256)
      expect(center.Z).toBe(-1024)
    })
  })

  describe('smoothing height calculation', () => {
    it('computes average of neighbor heights within smoothing radius', () => {
      // 4x4 map with varying heights
      const heightVals = [
        2, 3, 4, 2,
        3, 5, 6, 3,
        4, 6, 8, 4,
        2, 3, 4, 2,
      ]
      const map = createMockMap({
        width: 4,
        height: 4,
        heightValues: heightVals,
      })
      const info = new SubterraneanActorLayerInfo({
        heightOffset: new WDist(0),
        smoothingRadius: 1,
      })
      const layer = new SubterraneanActorLayer(map, info)

      // Cell (1,1) — center of 3x3, neighbors (0,0) to (2,2)
      // Heights: 2,3,4, 3,5,6, 4,6,8 = sum=41, count=9, avg*512 = 41*512/9 = 2332
      const center = layer.centerOfCell(new CPos(1, 1))
      const expectedZ = Math.trunc((41 * 512) / 9) // 2332
      expect(center.Z).toBe(expectedZ)
    })

    it('handles edge cells with fewer neighbors', () => {
      // 2x2 map, no neighbors outside map bounds
      const heightVals = [3, 5, 7, 1]
      const map = createMockMap({
        width: 2,
        height: 2,
        heightValues: heightVals,
      })
      const info = new SubterraneanActorLayerInfo({
        heightOffset: new WDist(0),
        smoothingRadius: 1,
      })
      const layer = new SubterraneanActorLayer(map, info)

      // Cell (0,0): neighbors (0,0),(1,0),(0,1),(1,1) = 3+5+7+1=16, count=4
      const center = layer.centerOfCell(new CPos(0, 0))
      const expectedZ = Math.trunc((16 * 512) / 4) // 2048
      expect(center.Z).toBe(expectedZ)
    })
  })
})
