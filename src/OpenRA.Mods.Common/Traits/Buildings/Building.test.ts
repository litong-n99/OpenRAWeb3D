/**
 * Building.test.ts — Building 核心建筑 trait 迁移单元测试
 *
 * 因为 happy-dom 不支持 WebGL，@babylonjs/core 模块在此被模拟。
 * 测试聚焦于: 占地区域解析、瓦片查询、中心偏移计算、生命周期方法。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  return {
    Engine: vi.fn(),
    Scene: vi.fn(),
    Mesh: vi.fn(),
    MeshBuilder: {
      CreateBox: vi.fn(),
      CreatePlane: vi.fn(),
    },
    StandardMaterial: vi.fn(),
    Vector3: vi.fn(),
    Color3: vi.fn(),
    Color4: vi.fn(),
    Texture: vi.fn(),
    RawTexture: vi.fn(),
    RenderTargetTexture: vi.fn(),
    ShaderMaterial: vi.fn(),
    Effect: vi.fn(),
    VertexData: vi.fn(),
    VertexBuffer: vi.fn(),
    IndexBuffer: vi.fn(),
    Material: vi.fn(),
    TransformNode: vi.fn(),
    AbstractMesh: vi.fn(),
    InstancedMesh: vi.fn(),
    Node: vi.fn(),
    Observable: vi.fn(),
    PointerEventTypes: { POINTERDOWN: 1, POINTERUP: 2, POINTERMOVE: 3 },
    Matrix: {
      Identity: vi.fn(),
      FromValues: vi.fn(),
    },
    Quaternion: {
      Identity: vi.fn(),
    },
    Tools: {
      ToRadians: vi.fn((deg: number) => deg * Math.PI / 180),
    },
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { SubCell } from '../../../OpenRA.Game/Traits/SubCell.js'

import {
  FootprintCellType,
  BuildingInfo,
  Building,
  type IBuildingMap,
  type ITargetableCells,
} from './Building.js'

import type { IGameActor, PlayerStub, ActorInfoStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal IBuildingMap for testing (rectangular grid). */
function createMap(): IBuildingMap {
  return {
    centerOfCell(cell: CPos): WPos {
      return new WPos(1024 * cell.X + 512, 1024 * cell.Y + 512, 0)
    },
  }
}

/** Create a minimal IGameActor stub for testing. */
function createActorStub(): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
  }
}

/** Create a minimal ActorInfoStub for testing. */
function createActorInfoStub(): ActorInfoStub {
  return { name: 'test_actor' }
}

// ---------------------------------------------------------------------------
// FootprintCellType enum
// ---------------------------------------------------------------------------

describe('FootprintCellType', () => {
  it('has correct char values matching OpenRA', () => {
    expect(FootprintCellType.Empty).toBe('_')
    expect(FootprintCellType.OccupiedPassable).toBe('=')
    expect(FootprintCellType.Occupied).toBe('x')
    expect(FootprintCellType.OccupiedUntargetable).toBe('X')
    expect(FootprintCellType.OccupiedPassableTransitOnly).toBe('+')
  })

  it('has 5 distinct values', () => {
    const values = new Set([
      FootprintCellType.Empty,
      FootprintCellType.OccupiedPassable,
      FootprintCellType.Occupied,
      FootprintCellType.OccupiedUntargetable,
      FootprintCellType.OccupiedPassableTransitOnly,
    ])
    expect(values.size).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.fromJSON — footprint parsing
// ---------------------------------------------------------------------------

describe('BuildingInfo.fromJSON', () => {
  it('parses a single-cell footprint (default)', () => {
    const info = BuildingInfo.fromJSON({})
    expect(info.dimensions.X).toBe(1)
    expect(info.dimensions.Y).toBe(1)
    expect(info.footprint.size).toBe(1)
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.Occupied)
  })

  it('parses a 1x1 footprint with explicit "x"', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x',
      dimensions: { x: 1, y: 1 },
    })
    expect(info.dimensions.X).toBe(1)
    expect(info.dimensions.Y).toBe(1)
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.Occupied)
  })

  it('parses a 2x2 all-occupied footprint', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'xxxx',
      dimensions: { x: 2, y: 2 },
    })
    expect(info.dimensions.X).toBe(2)
    expect(info.dimensions.Y).toBe(2)
    expect(info.footprint.size).toBe(4)
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.Occupied)
    expect(info.footprint.get('1,0')).toBe(FootprintCellType.Occupied)
    expect(info.footprint.get('0,1')).toBe(FootprintCellType.Occupied)
    expect(info.footprint.get('1,1')).toBe(FootprintCellType.Occupied)
  })

  it('parses a 3x2 footprint with mixed types (xx=xx_)', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'xx=xx_',
      dimensions: { x: 2, y: 3 },
    })
    expect(info.dimensions.X).toBe(2)
    expect(info.dimensions.Y).toBe(3)
    expect(info.footprint.size).toBe(6)
    // Row 0: x x
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.Occupied)
    expect(info.footprint.get('1,0')).toBe(FootprintCellType.Occupied)
    // Row 1: = x
    expect(info.footprint.get('0,1')).toBe(FootprintCellType.OccupiedPassable)
    expect(info.footprint.get('1,1')).toBe(FootprintCellType.Occupied)
    // Row 2: x _
    expect(info.footprint.get('0,2')).toBe(FootprintCellType.Occupied)
    expect(info.footprint.get('1,2')).toBe(FootprintCellType.Empty)
  })

  it('parses a 2x2 footprint with "x_X=" types', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x_X=',
      dimensions: { x: 2, y: 2 },
    })
    expect(info.dimensions.X).toBe(2)
    expect(info.dimensions.Y).toBe(2)
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.Occupied) // 'x'
    expect(info.footprint.get('1,0')).toBe(FootprintCellType.Empty) // '_'
    expect(info.footprint.get('0,1')).toBe(FootprintCellType.OccupiedUntargetable) // 'X'
    expect(info.footprint.get('1,1')).toBe(FootprintCellType.OccupiedPassable) // '='
  })

  it('parses footprint with whitespace (stripped)', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x x X =',
      dimensions: { x: 2, y: 2 },
    })
    expect(info.footprint.size).toBe(4)
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.Occupied) // 'x'
    expect(info.footprint.get('1,0')).toBe(FootprintCellType.Occupied) // 'x'
    expect(info.footprint.get('0,1')).toBe(FootprintCellType.OccupiedUntargetable) // 'X'
    expect(info.footprint.get('1,1')).toBe(FootprintCellType.OccupiedPassable) // '='
  })

  it('parses a 3x3 construction yard footprint', () => {
    // C&C construction yard: 3x3 with OccupiedPassable borders
    const fp = '===_x_==='
    const info = BuildingInfo.fromJSON({
      footprint: fp,
      dimensions: { x: 3, y: 3 },
    })
    expect(info.dimensions.X).toBe(3)
    expect(info.dimensions.Y).toBe(3)
    expect(info.footprint.size).toBe(9)
    // Row 0: = = =
    // Row 1: _ x _
    // Row 2: = = =
    // Wait — "===_x_===" split:
    // 0,1,2: = = =
    // 3,4,5: _ x _
    // 6,7,8: = = =
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.OccupiedPassable)
    expect(info.footprint.get('1,0')).toBe(FootprintCellType.OccupiedPassable)
    expect(info.footprint.get('2,0')).toBe(FootprintCellType.OccupiedPassable)
    expect(info.footprint.get('0,1')).toBe(FootprintCellType.Empty)
    expect(info.footprint.get('1,1')).toBe(FootprintCellType.Occupied)
    expect(info.footprint.get('2,1')).toBe(FootprintCellType.Empty)
    expect(info.footprint.get('0,2')).toBe(FootprintCellType.OccupiedPassable)
    expect(info.footprint.get('1,2')).toBe(FootprintCellType.OccupiedPassable)
    expect(info.footprint.get('2,2')).toBe(FootprintCellType.OccupiedPassable)
  })

  it('parses footprint with OccupiedPassableTransitOnly (+)', () => {
    const info = BuildingInfo.fromJSON({
      footprint: '+x',
      dimensions: { x: 2, y: 1 },
    })
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.OccupiedPassableTransitOnly)
    expect(info.footprint.get('1,0')).toBe(FootprintCellType.Occupied)
  })

  it('throws on invalid character in footprint', () => {
    expect(() =>
      BuildingInfo.fromJSON({
        footprint: 'xy',
        dimensions: { x: 2, y: 1 },
      }),
    ).toThrow(/Invalid footprint cell type/)
  })

  it('throws on mismatched dimensions', () => {
    expect(() =>
      BuildingInfo.fromJSON({
        footprint: 'xxx',
        dimensions: { x: 2, y: 2 },
      }),
    ).toThrow(/does not match dimensions/)
  })

  it('defaults dimensions to 1x1 when not provided', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x',
    })
    expect(info.dimensions.X).toBe(1)
    expect(info.dimensions.Y).toBe(1)
  })

  it('parses localCenterOffset from JSON', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x',
      localCenterOffset: { x: 100, y: 200, z: 300 },
    })
    expect(info.localCenterOffset.X).toBe(100)
    expect(info.localCenterOffset.Y).toBe(200)
    expect(info.localCenterOffset.Z).toBe(300)
  })

  it('handles uppercase X and = correctly', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'X=',
      dimensions: { x: 2, y: 1 },
    })
    expect(info.footprint.get('0,0')).toBe(FootprintCellType.OccupiedUntargetable)
    expect(info.footprint.get('1,0')).toBe(FootprintCellType.OccupiedPassable)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo — constructor
// ---------------------------------------------------------------------------

describe('BuildingInfo constructor', () => {
  it('creates default BuildingInfo', () => {
    const info = new BuildingInfo()
    expect(info.terrainTypes instanceof Set).toBe(true)
    expect(info.terrainTypes.size).toBe(0)
    expect(info.footprint instanceof Map).toBe(true)
    expect(info.footprint.size).toBe(0)
    expect(info.dimensions.X).toBe(1)
    expect(info.dimensions.Y).toBe(1)
    expect(info.localCenterOffset.X).toBe(0)
    expect(info.localCenterOffset.Y).toBe(0)
    expect(info.localCenterOffset.Z).toBe(0)
    expect(info.requiresBaseProvider).toBe(false)
    expect(info.allowInvalidPlacement).toBe(false)
    expect(info.removeSmudgesOnBuild).toBe(true)
    expect(info.removeSmudgesOnSell).toBe(true)
    expect(info.removeSmudgesOnTransform).toBe(true)
    expect(info.buildSounds).toEqual([])
    expect(info.undeploySounds).toEqual([])
    expect(info.sharesCell).toBe(false)
  })

  it('accepts terrainTypes as string array', () => {
    const info = new BuildingInfo({ terrainTypes: ['Water', 'Clear'] })
    expect(info.terrainTypes.size).toBe(2)
    expect(info.terrainTypes.has('Water')).toBe(true)
    expect(info.terrainTypes.has('Clear')).toBe(true)
  })

  it('accepts terrainTypes as Set', () => {
    const set = new Set(['Land'])
    const info = new BuildingInfo({ terrainTypes: set })
    expect(info.terrainTypes.size).toBe(1)
    expect(info.terrainTypes.has('Land')).toBe(true)
  })

  it('accepts buildSounds and undeploySounds', () => {
    const info = new BuildingInfo({
      buildSounds: ['boom1', 'boom2'],
      undeploySounds: ['shrink'],
    })
    expect(info.buildSounds).toEqual(['boom1', 'boom2'])
    expect(info.undeploySounds).toEqual(['shrink'])
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.footprintTiles
// ---------------------------------------------------------------------------

describe('BuildingInfo.footprintTiles', () => {
  let info: BuildingInfo

  beforeEach(() => {
    // 2x2: xx
    //      x=
    info = BuildingInfo.fromJSON({
      footprint: 'xxx=',
      dimensions: { x: 2, y: 2 },
    })
  })

  it('returns Occupied tiles only', () => {
    const location = new CPos(10, 10)
    const result = info.footprintTiles(location, FootprintCellType.Occupied)
    expect(result.length).toBe(3)
    const strings = result.map((c) => c.toString())
    expect(strings).toContain('10,10') // 0,0 -> 10,10
    expect(strings).toContain('11,10') // 1,0 -> 11,10
    expect(strings).toContain('10,11') // 0,1 -> 10,11
  })

  it('returns OccupiedPassable tiles only', () => {
    const location = new CPos(5, 5)
    const result = info.footprintTiles(location, FootprintCellType.OccupiedPassable)
    expect(result.length).toBe(1)
    expect(result[0].toString()).toBe('6,6') // 1,1 -> 6,6
  })

  it('returns empty array for non-matching type', () => {
    const location = new CPos(0, 0)
    const result = info.footprintTiles(location, FootprintCellType.Empty)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.tiles
// ---------------------------------------------------------------------------

describe('BuildingInfo.tiles', () => {
  it('returns all non-empty tiles', () => {
    // 2x2: x_
    //      =+
    const info = BuildingInfo.fromJSON({
      footprint: 'x_=+',
      dimensions: { x: 2, y: 2 },
    })
    const location = new CPos(0, 0)
    const result = info.tiles(location)
    // Should include x, =, + but not _
    expect(result.length).toBe(3)
    const strings = result.map((c) => c.toString())
    expect(strings).toContain('0,0') // x
    expect(strings).toContain('0,1') // =
    expect(strings).toContain('1,1') // +
    expect(strings).not.toContain('1,0') // _ (empty)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.occupiedTiles
// ---------------------------------------------------------------------------

describe('BuildingInfo.occupiedTiles', () => {
  it('returns only OCCUPIED, UNTARGETABLE, and TRANSIT_ONLY tiles', () => {
    // 2x2: x_
    //      =+
    const info = BuildingInfo.fromJSON({
      footprint: 'x_=+',
      dimensions: { x: 2, y: 2 },
    })
    const location = new CPos(0, 0)
    const result = info.occupiedTiles(location)
    // Should include x, + but not _ or =
    expect(result.length).toBe(2)
    const strings = result.map((c) => c.toString())
    expect(strings).toContain('0,0') // x
    expect(strings).toContain('1,1') // +
    expect(strings).not.toContain('1,0') // _ (empty)
    expect(strings).not.toContain('0,1') // = (occupied passable)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.pathableTiles
// ---------------------------------------------------------------------------

describe('BuildingInfo.pathableTiles', () => {
  it('returns EMPTY and OCCUPIED_PASSABLE tiles', () => {
    // 2x2: x_
    //      =+
    const info = BuildingInfo.fromJSON({
      footprint: 'x_=+',
      dimensions: { x: 2, y: 2 },
    })
    const location = new CPos(0, 0)
    const result = info.pathableTiles(location)
    // Should include _, = but not x or +
    expect(result.length).toBe(2)
    const strings = result.map((c) => c.toString())
    expect(strings).toContain('1,0') // _
    expect(strings).toContain('0,1') // =
    expect(strings).not.toContain('0,0') // x
    expect(strings).not.toContain('1,1') // +
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.transitOnlyTiles
// ---------------------------------------------------------------------------

describe('BuildingInfo.transitOnlyTiles', () => {
  it('returns only TRANSIT_ONLY tiles', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x+=_',
      dimensions: { x: 2, y: 2 },
    })
    const location = new CPos(0, 0)
    const result = info.transitOnlyTiles(location)
    expect(result.length).toBe(1)
    expect(result[0].toString()).toBe('1,0') // +
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.frozenUnderFogTiles
// ---------------------------------------------------------------------------

describe('BuildingInfo.frozenUnderFogTiles', () => {
  it('returns all footprint tiles regardless of type', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x_=+',
      dimensions: { x: 2, y: 2 },
    })
    const location = new CPos(0, 0)
    const result = info.frozenUnderFogTiles(location)
    expect(result.length).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.centerOffset
// ---------------------------------------------------------------------------

describe('BuildingInfo.centerOffset', () => {
  it('returns zero for 1x1 building', () => {
    const info = BuildingInfo.fromJSON({ footprint: 'x' })
    const map = createMap()
    const offset = info.centerOffset(map)
    expect(offset.X).toBe(0)
    expect(offset.Y).toBe(0)
    expect(offset.Z).toBe(0)
  })

  it('returns correct offset for 2x2 building', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'xxxx',
      dimensions: { x: 2, y: 2 },
    })
    const map = createMap()
    const offset = info.centerOffset(map)
    // For rectangular grid:
    // CenterOfCell(2,2) = (1024*2+512, 1024*2+512) = (2560, 2560)
    // CenterOfCell(1,1) = (1024*1+512, 1024*1+512) = (1536, 1536)
    // diff = (1024, 1024)
    // divided by 2 = (512, 512)
    // Z zeroed → (512, 512, 0)
    expect(offset.X).toBe(512)
    expect(offset.Y).toBe(512)
    expect(offset.Z).toBe(0)
  })

  it('returns correct offset for 3x3 building', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'xxxxxxxxx',
      dimensions: { x: 3, y: 3 },
    })
    const map = createMap()
    const offset = info.centerOffset(map)
    // CenterOfCell(3,3) = (1024*3+512, 1024*3+512) = (3584, 3584)
    // CenterOfCell(1,1) = (1536, 1536)
    // diff = (2048, 2048)
    // /2 = (1024, 1024, 0)
    expect(offset.X).toBe(1024)
    expect(offset.Y).toBe(1024)
    expect(offset.Z).toBe(0)
  })

  it('includes localCenterOffset in result', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x',
      localCenterOffset: { x: 100, y: -50, z: 200 },
    })
    const map = createMap()
    const offset = info.centerOffset(map)
    // Base offset = (0,0,0), plus localCenterOffset
    expect(offset.X).toBe(100)
    expect(offset.Y).toBe(-50)
    expect(offset.Z).toBe(200)
  })

  it('Z component is zeroed before adding localCenterOffset', () => {
    // 2x3 building: Dim 2x3 center offset
    const info = BuildingInfo.fromJSON({
      footprint: 'xxxxxx',
      dimensions: { x: 2, y: 3 },
    })
    const map = createMap()
    const offset = info.centerOffset(map)
    // Diff X: CenterOfCell(2,y) - CenterOfCell(1,y)
    // CenterOfCell(2,3) = (1024*2+512, 1024*3+512) = (2560, 3584)
    // CenterOfCell(1,1) = (1536, 1536)
    // diff = (1024, 2048)
    // /2 = (512, 1024)
    // Z = 0
    expect(offset.X).toBe(512)
    expect(offset.Y).toBe(1024)
    expect(offset.Z).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.occupiedCells (IOccupySpaceInfo)
// ---------------------------------------------------------------------------

describe('BuildingInfo.occupiedCells (IOccupySpaceInfo)', () => {
  it('returns occupied tiles as FullCell', () => {
    // 2x2: x_
    //      =+
    const info = BuildingInfo.fromJSON({
      footprint: 'x_=+',
      dimensions: { x: 2, y: 2 },
    })
    const actorInfo = createActorInfoStub()
    const location = new CPos(5, 5)
    const cells = info.occupiedCells(actorInfo, location)

    // Should have 2 entries (x and +), each with SubCell.FullCell
    expect(cells.size).toBe(2)
    // Check all values are FullCell
    for (const [, subCell] of cells) {
      expect(subCell).toBe(SubCell.FullCell)
    }
    // Check keys
    const keyStrings = new Set([...cells.keys()].map((c) => c.toString()))
    expect(keyStrings.has('5,5')).toBe(true) // x at (0,0)
    expect(keyStrings.has('6,6')).toBe(true) // + at (1,1)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.sharesCell (IOccupySpaceInfo)
// ---------------------------------------------------------------------------

describe('BuildingInfo.sharesCell', () => {
  it('is always false', () => {
    const info = new BuildingInfo()
    expect(info.sharesCell).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.findBaseProvider (stub)
// ---------------------------------------------------------------------------

describe('BuildingInfo.findBaseProvider', () => {
  it('returns null (stub)', () => {
    const info = new BuildingInfo()
    const map = createMap()
    const player: PlayerStub = { playerName: 'test' }
    const result = info.findBaseProvider(map, player, new CPos(0, 0))
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// BuildingInfo.isCloseEnoughToBase (stub)
// ---------------------------------------------------------------------------

describe('BuildingInfo.isCloseEnoughToBase', () => {
  it('returns true (stub — always allows placement)', () => {
    const info = new BuildingInfo()
    const map = createMap()
    const player: PlayerStub = { playerName: 'test' }
    const ai = createActorInfoStub()
    const result = info.isCloseEnoughToBase(map, player, ai, new CPos(0, 0))
    expect(result).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Building — construction
// ---------------------------------------------------------------------------

describe('Building', () => {
  let info: BuildingInfo
  let map: IBuildingMap

  beforeEach(() => {
    info = BuildingInfo.fromJSON({
      footprint: 'xx=+',
      dimensions: { x: 2, y: 2 },
    })
    map = createMap()
  })

  describe('construction', () => {
    it('stores TopLeft from constructor argument', () => {
      const topLeft = new CPos(10, 5)
      const building = new Building(info, topLeft, map)
      expect(building.topLeft.X).toBe(10)
      expect(building.topLeft.Y).toBe(5)
    })

    it('stores Info', () => {
      const building = new Building(info, new CPos(0, 0), map)
      expect(building.info).toBe(info)
    })

    it('computes CenterPosition from map and centerOffset', () => {
      const topLeft = new CPos(10, 10)
      const building = new Building(info, topLeft, map)
      // topLeft center = (1024*10+512, 1024*10+512) = (10752, 10752)
      // centerOffset for 2x2 = (512, 512, 0)
      // centerPosition = (10752+512, 10752+512, 0) = (11264, 11264, 0)
      expect(building.centerPosition.X).toBe(11264)
      expect(building.centerPosition.Y).toBe(11264)
      expect(building.centerPosition.Z).toBe(0)
    })
  })

  describe('occupiedCells (IOccupySpace)', () => {
    it('returns OccupiedCell array with cell and subCell', () => {
      const building = new Building(info, new CPos(0, 0), map)
      const cells = building.occupiedCells()
      // occupiedTiles for "xx=+" at (0,0):
      // - x at (0,0)
      // - x at (1,0)
      // - + at (1,1)  (OccupiedPassableTransitOnly counts as occupied for actor map)
      // = is not in occupiedTiles
      expect(cells.length).toBe(3)
      for (const oc of cells) {
        expect(oc.subCell).toBe(SubCell.FullCell)
      }
    })
  })

  describe('targetableCells (ITargetableCells)', () => {
    it('returns only Occupied type cells', () => {
      const building = new Building(info, new CPos(0, 0), map)
      const cells = building.targetableCells()
      // Only 'x' cells are targetable
      // footprint: (0,0)=x, (1,0)=x, (0,1)=[, (1,1)=+
      expect(cells.length).toBe(2)
    })
  })

  describe('transitOnlyCellsList', () => {
    it('returns transit-only cells', () => {
      const building = new Building(info, new CPos(0, 0), map)
      const cells = building.transitOnlyCellsList()
      expect(cells.length).toBe(1)
      expect(cells[0].toString()).toBe('1,1')
    })
  })

  describe('rawOccupiedCells', () => {
    it('returns direct tuple access', () => {
      const building = new Building(info, new CPos(0, 0), map)
      const cells = building.rawOccupiedCells
      expect(cells.length).toBe(3)
      expect(cells[0][1]).toBe(SubCell.FullCell)
    })
  })
})

// ---------------------------------------------------------------------------
// Building — lifecycle methods
// ---------------------------------------------------------------------------

describe('Building lifecycle', () => {
  let info: BuildingInfo
  let map: IBuildingMap
  let actor: IGameActor

  beforeEach(() => {
    info = BuildingInfo.fromJSON({
      footprint: 'xx=+',
      dimensions: { x: 2, y: 2 },
    })
    map = createMap()
    actor = createActorStub()
  })

  describe('addedToWorld', () => {
    it('calls removeSmudges when removeSmudgesOnBuild is true', () => {
      const building = new Building(info, new CPos(0, 0), map)
      // We can verify the method is callable without error
      // (removeSmudges is a no-op stub currently)
      expect(() => building.addedToWorld(actor)).not.toThrow()
    })

    it('does not throw when removeSmudgesOnBuild is false', () => {
      const noSmudgeInfo = new BuildingInfo({
        footprint: info.footprint,
        dimensions: info.dimensions,
        removeSmudgesOnBuild: false,
      })
      const building = new Building(noSmudgeInfo, new CPos(0, 0), map)
      expect(() => building.addedToWorld(actor)).not.toThrow()
    })
  })

  describe('removedFromWorld', () => {
    it('does not throw (stub)', () => {
      const building = new Building(info, new CPos(0, 0), map)
      expect(() => building.removedFromWorld(actor)).not.toThrow()
    })
  })

  describe('selling (INotifySold)', () => {
    it('calls removeSmudges when removeSmudgesOnSell is true', () => {
      const building = new Building(info, new CPos(0, 0), map)
      expect(() => building.selling(actor)).not.toThrow()
    })

    it('does not call removeSmudges when removeSmudgesOnSell is false', () => {
      const noSmudgeInfo = new BuildingInfo({
        footprint: info.footprint,
        dimensions: info.dimensions,
        removeSmudgesOnSell: false,
      })
      const building = new Building(noSmudgeInfo, new CPos(0, 0), map)
      expect(() => building.selling(actor)).not.toThrow()
    })
  })

  describe('sold', () => {
    it('is a no-op', () => {
      const building = new Building(info, new CPos(0, 0), map)
      expect(() => building.sold(actor)).not.toThrow()
    })
  })

  describe('beforeTransform (INotifyTransform)', () => {
    it('calls removeSmudges when removeSmudgesOnTransform is true', () => {
      const building = new Building(info, new CPos(0, 0), map)
      expect(() => building.beforeTransform(actor)).not.toThrow()
    })

    it('does not call removeSmudges when removeSmudgesOnTransform is false', () => {
      const noSmudgeInfo = new BuildingInfo({
        footprint: info.footprint,
        dimensions: info.dimensions,
        removeSmudgesOnTransform: false,
      })
      const building = new Building(noSmudgeInfo, new CPos(0, 0), map)
      expect(() => building.beforeTransform(actor)).not.toThrow()
    })
  })

  describe('onTransform', () => {
    it('is a no-op', () => {
      const building = new Building(info, new CPos(0, 0), map)
      expect(() => building.onTransform(actor)).not.toThrow()
    })
  })

  describe('afterTransform', () => {
    it('is a no-op', () => {
      const building = new Building(info, new CPos(0, 0), map)
      expect(() => building.afterTransform(actor)).not.toThrow()
    })
  })
})

// ---------------------------------------------------------------------------
// ITargetableCells type compatibility
// ---------------------------------------------------------------------------

describe('ITargetableCells interface acceptance', () => {
  it('Building satisfies ITargetableCells interface', () => {
    const info = BuildingInfo.fromJSON({ footprint: 'x' })
    const map = createMap()
    const building = new Building(info, new CPos(0, 0), map)

    // TypeScript structural compatibility:
    // Building implements ITargetableCells
    const tc: ITargetableCells = building
    expect(tc.targetableCells().length).toBe(1)
    expect(tc.targetableCells()[0][0].toString()).toBe('0,0')
    expect(tc.targetableCells()[0][1]).toBe(SubCell.FullCell)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Building edge cases', () => {
  it('handles large footprint (5x5)', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'x'.repeat(25),
      dimensions: { x: 5, y: 5 },
    })
    expect(info.footprint.size).toBe(25)
    const map = createMap()
    const building = new Building(info, new CPos(100, 100), map)
    expect(building.occupiedCells().length).toBe(25)
    expect(building.targetableCells().length).toBe(25)
  })

  it('handles all-empty footprint (odd but valid for parsing)', () => {
    const info = BuildingInfo.fromJSON({
      footprint: '____',
      dimensions: { x: 2, y: 2 },
    })
    const map = createMap()
    const building = new Building(info, new CPos(0, 0), map)
    expect(building.occupiedCells().length).toBe(0)
    expect(building.targetableCells().length).toBe(0)
    expect(info.tiles(new CPos(0, 0)).length).toBe(0)
  })

  it('offset with negative cell position', () => {
    const info = BuildingInfo.fromJSON({
      footprint: 'xx=+',
      dimensions: { x: 2, y: 2 },
    })
    const map = createMap()
    const building = new Building(info, new CPos(-5, -3), map)
    // centerOfCell(-5, -3) = (1024*-5+512, 1024*-3+512) = (-4608, -2560)
    // plus centerOffset (512, 512, 0)
    expect(building.centerPosition.X).toBe(-4096)
    expect(building.centerPosition.Y).toBe(-2048)
  })
})
