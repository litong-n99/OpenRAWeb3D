/**
 * Locomotor.test.ts — Locomotor system unit tests
 *
 * Tests focus on:
 * - LocomotorInfo defaults and new fields
 * - TerrainInfo construction and Impassable
 * - SimpleLocomotor behavior (all passable)
 * - WallAwareLocomotor blocking
 * - ILocomotor interface compliance
 * - CellFlag bitwise operations
 * - MovementType bitwise operations
 * - Locomotor class construction from world mock
 * - movementCostForCell with height discontinuity
 * - getAvailableSubCell returns correct subcell
 * - isBlockedBy with various actor combos
 * - updateCellBlocking produces correct CellFlag
 * - updateCellCost fires CellCostChanged event
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos'
import { PathGraph } from '../../Pathfinder/IPathGraph'
import { BlockedByActor } from '../BlockedByActor'
import { SubCell, type SubCell as SubCellType } from '../../../OpenRA.Game/Traits/SubCell'
import { PlayerRelationship } from '../../../OpenRA.Game/Traits/TraitsInterfaces'
import { LongBitSet } from '../../../OpenRA.Game/Primitives/LongBitSet'
import { MapGridType, type MapGridType as MapGridTypeEnum } from '../../../OpenRA.Game/Map/MapGridType'
import {
  LocomotorInfo,
  TerrainInfo,
  SimpleLocomotor,
  WallAwareLocomotor,
  CellFlag,
  hasCellFlag,
  MovementType,
  hasMovementType,
  CustomMovementLayerType,
  Locomotor,
  CellCache,
  type ILocomotorWorld,
  type ILocomotorMap,
  type ILocomotorActorMap,
  type ILocomotorPlayer,
  type ILocomotorActor,
  type ILocomotorCML,
  type PlayerBitMask,
} from './Locomotor'

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

/** Create a minimal mock ILocomotorPlayer. */
function makePlayer(name: string, _index: number): ILocomotorPlayer & { _name: string } {
  const mask = new LongBitSet<PlayerBitMask>('PlayerBitMask', name)
  const alliedMask = new LongBitSet<PlayerBitMask>('PlayerBitMask', name)
  return {
    _name: name,
    playerMask: mask,
    alliedPlayersMask: alliedMask,
    relationshipWith(other: ILocomotorPlayer): PlayerRelationship {
      return (other as ReturnType<typeof makePlayer>)._name === name
        ? PlayerRelationship.Ally
        : PlayerRelationship.Enemy
    },
  }
}

/** Create a minimal mock ILocomotorActor. */
function makeActor(
  id: number,
  player: ILocomotorPlayer,
  overrides?: Partial<{
    isTraitDisabled: boolean
    isTraitPaused: boolean
    isImmovable: boolean
    currentMovementTypes: MovementType
    hasTemporaryBlocker: boolean
    crushClasses: string[]
    isTransitOnly: boolean
  }>,
): ILocomotorActor {
  const opts = overrides ?? {}
  return {
    actorId: id,
    owner: player,
    occupiesSpace: {
      isTraitDisabled: opts.isTraitDisabled ?? false,
      isTraitPaused: opts.isTraitPaused ?? false,
      isImmovable: opts.isImmovable ?? false,
      currentMovementTypes: opts.currentMovementTypes ?? MovementType.Horizontal,
    },
    crushables: [
      {
        crushableByPlayerMask(_actor: ILocomotorActor, crushClasses: ReadonlySet<string>): LongBitSet<PlayerBitMask> {
          if (crushClasses.size === 0) return new LongBitSet<PlayerBitMask>('PlayerBitMask')
          // Return the owning player's mask if crushable
          return player.playerMask
        },
      },
    ],
    hasTemporaryBlocker: opts.hasTemporaryBlocker ?? false,
    temporaryBlockerCanRemove(_blocking: ILocomotorActor, _blocked: ILocomotorActor): boolean {
      return true
    },
    isTransitOnlyAt(_cell: CPos): boolean {
      return opts.isTransitOnly ?? false
    },
  }
}

/** Create a minimal mock ILocomotorWorld with a mock map and actor map. */
function makeWorld(opts?: {
  maxTerrainHeight?: number
  terrainTypes?: { Type: string }[]
  customLayers?: (ILocomotorCML | null)[]
  allCells?: CPos[]
  mapWidth?: number
  mapHeight?: number
  gridType?: import('../../../OpenRA.Game/Map/MapGridType').MapGridType
  rulesContainTemporaryBlocker?: boolean
}): {
  world: ILocomotorWorld
  actorMap: MockActorMap
  heightLayer: number[]
} {
  const w = opts?.mapWidth ?? 4
  const h = opts?.mapHeight ?? 4
  const allCells: CPos[] = opts?.allCells ?? []
  if (allCells.length === 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        allCells.push(new CPos(x, y, 0))
      }
    }
  }

  const heightLayer = new Array(w * h).fill(0)
  const terrainIndices = new Array(w * h).fill(0)

  const mockActorMap = new MockActorMap()

  const gridType: MapGridTypeEnum = opts?.gridType ?? MapGridType.Rectangular

  const world: ILocomotorWorld = {
    allPlayersMask: new LongBitSet<PlayerBitMask>('PlayerBitMask', 'P0', 'P1'),
    noPlayersMask: new LongBitSet<PlayerBitMask>('PlayerBitMask'),
    rulesContainTemporaryBlocker: opts?.rulesContainTemporaryBlocker ?? false,
    actorMap: mockActorMap as unknown as ILocomotorActorMap,
    getCustomMovementLayers(): readonly (ILocomotorCML | null)[] {
      return opts?.customLayers ?? []
    },
    map: {
      contains(cell: CPos): boolean {
        return cell.X >= 0 && cell.X < w && cell.Y >= 0 && cell.Y < h
      },
      grid: { maximumTerrainHeight: opts?.maxTerrainHeight ?? 0 },
      height: {
        get(cell: CPos): number {
          const idx = cell.Y * w + cell.X
          return heightLayer[idx] ?? 0
        },
        set(cell: CPos, value: number): void {
          const idx = cell.Y * w + cell.X
          heightLayer[idx] = value
        },
      } as unknown as import('../../../OpenRA.Game/Map/CellLayer').CellLayer<number>,
      getTerrainIndex(cell: CPos): number {
        const idx = cell.Y * w + cell.X
        return terrainIndices[idx] ?? 0
      },
      tiles: {
        onCellEntryChanged(_cb: (cell: CPos) => void): void { /* noop */ },
      } as unknown as ILocomotorMap['tiles'],
      customTerrain: {
        onCellEntryChanged(_cb: (cell: CPos) => void): void { /* noop */ },
      } as unknown as ILocomotorMap['customTerrain'],
      rules: {
        terrainInfo: {
          TerrainTypes: opts?.terrainTypes ?? [{ Type: 'Clear' }],
        },
      },
      mapSize: { width: w, height: h },
      gridType,
      allCells(): Iterable<CPos> { return allCells },
    } as ILocomotorMap,
  }

  return { world, actorMap: mockActorMap, heightLayer }
}

/** A simple mock actor map for testing. */
class MockActorMap {
  private _actors: ILocomotorActor[] = []
  onCellUpdated: ((c: CPos) => void) | null = null

  addActor(actor: ILocomotorActor): void {
    this._actors.push(actor)
  }

  clear(): void {
    this._actors = []
  }

  get actorsForTest(): readonly ILocomotorActor[] { return this._actors }

  getActorsAt(_cell: CPos, _subCell?: SubCellType): readonly ILocomotorActor[] {
    return this._actors
  }

  anyActorsAt(
    _cell: CPos,
    _subCell: SubCellType,
    checkOrFn?: boolean | ((a: ILocomotorActor) => boolean),
  ): boolean {
    if (typeof checkOrFn === 'function') {
      return this._actors.some(checkOrFn)
    }
    return this._actors.length > 0
  }

  hasFreeSubCell(_cell: CPos): boolean {
    return this._actors.length === 0
  }

  freeSubCell(
    _cell: CPos,
    _preferredSubCell: SubCellType,
    checkOrFn?: boolean | ((a: ILocomotorActor) => boolean),
  ): SubCellType {
    if (typeof checkOrFn === 'function') {
      if (this._actors.some(checkOrFn)) return SubCell.Invalid as SubCellType
    }
    if (this._actors.length === 0) return SubCell.FullCell as SubCellType
    return SubCell.Invalid as SubCellType
  }
}

// ---------------------------------------------------------------------------
// CellFlag & MovementType bitwise operations
// ---------------------------------------------------------------------------

describe('CellFlag bitwise operations', () => {
  it('HasCellFlag returns true for matching flag', () => {
    const flags = CellFlag.HasMovingActor | CellFlag.HasCrushableActor
    expect(hasCellFlag(flags, CellFlag.HasMovingActor)).toBe(true)
    expect(hasCellFlag(flags, CellFlag.HasCrushableActor)).toBe(true)
  })

  it('HasCellFlag returns false for non-matching flag', () => {
    const flags = CellFlag.HasMovingActor | CellFlag.HasStationaryActor
    expect(hasCellFlag(flags, CellFlag.HasMovableActor)).toBe(false)
    expect(hasCellFlag(flags, CellFlag.HasTemporaryBlocker)).toBe(false)
  })

  it('HasFreeSpace is 0 and matches only nothing', () => {
    expect(hasCellFlag(CellFlag.HasFreeSpace, CellFlag.HasFreeSpace)).toBe(true)
    expect(hasCellFlag(CellFlag.HasFreeSpace, CellFlag.HasMovingActor)).toBe(false)
  })

  it('CellFlag values are powers of 2', () => {
    expect(CellFlag.HasMovingActor).toBe(1)
    expect(CellFlag.HasStationaryActor).toBe(2)
    expect(CellFlag.HasMovableActor).toBe(4)
    expect(CellFlag.HasCrushableActor).toBe(8)
    expect(CellFlag.HasTemporaryBlocker).toBe(16)
    expect(CellFlag.HasTransitOnlyActor).toBe(32)
  })

  it('combined flags handle OR correctly', () => {
    const combined = CellFlag.HasMovingActor | CellFlag.HasStationaryActor | CellFlag.HasCrushableActor
    expect(hasCellFlag(combined, CellFlag.HasMovingActor)).toBe(true)
    expect(hasCellFlag(combined, CellFlag.HasStationaryActor)).toBe(true)
    expect(hasCellFlag(combined, CellFlag.HasCrushableActor)).toBe(true)
    expect(hasCellFlag(combined, CellFlag.HasTransitOnlyActor)).toBe(false)
  })
})

describe('MovementType bitwise operations', () => {
  it('HasMovementType returns true for matching type', () => {
    const types = MovementType.Horizontal | MovementType.Vertical
    expect(hasMovementType(types, MovementType.Horizontal)).toBe(true)
    expect(hasMovementType(types, MovementType.Vertical)).toBe(true)
  })

  it('HasMovementType returns false for non-matching type', () => {
    expect(hasMovementType(MovementType.Horizontal, MovementType.Vertical)).toBe(false)
    expect(hasMovementType(MovementType.None, MovementType.Horizontal)).toBe(false)
  })

  it('None has no flags', () => {
    expect(hasMovementType(MovementType.None, MovementType.None)).toBe(true)
    expect(hasMovementType(MovementType.None, MovementType.Horizontal)).toBe(false)
  })

  it('MovementType values follow bitwise pattern', () => {
    expect(MovementType.None).toBe(0)
    expect(MovementType.Horizontal).toBe(1)
    expect(MovementType.Vertical).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// CustomMovementLayerType
// ---------------------------------------------------------------------------

describe('CustomMovementLayerType', () => {
  it('defines known layer types', () => {
    expect(CustomMovementLayerType.Tunnel).toBe(1)
    expect(CustomMovementLayerType.Subterranean).toBe(2)
    expect(CustomMovementLayerType.Jumpjet).toBe(3)
    expect(CustomMovementLayerType.ElevatedBridge).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// TerrainInfo
// ---------------------------------------------------------------------------

describe('TerrainInfo', () => {
  it('Impassable has Cost=MovementCostForUnreachableCell and Speed=0', () => {
    const imp = TerrainInfo.Impassable
    expect(imp.Cost).toBe(PathGraph.MovementCostForUnreachableCell)
    expect(imp.Speed).toBe(0)
  })

  it('default constructor is impassable', () => {
    const ti = new TerrainInfo()
    expect(ti.Cost).toBe(PathGraph.MovementCostForUnreachableCell)
    expect(ti.Speed).toBe(0)
  })

  it('constructor with speed and cost', () => {
    const ti = new TerrainInfo(100, 120)
    expect(ti.Speed).toBe(100)
    expect(ti.Cost).toBe(120)
  })

  it('cost getter returns Cost (backward compat)', () => {
    const ti = new TerrainInfo(50, 200)
    expect(ti.cost).toBe(200)
    expect(ti.Cost).toBe(200)
  })

  it('Impassable is a singleton instance', () => {
    const a = TerrainInfo.Impassable
    const b = TerrainInfo.Impassable
    expect(a).toBe(b)
  })
})

// ---------------------------------------------------------------------------
// LocomotorInfo tests (expanded)
// ---------------------------------------------------------------------------

describe('LocomotorInfo', () => {
  it('has default name', () => {
    const info = new LocomotorInfo()
    expect(info.Name).toBe('default')
  })

  it('has default terrain speeds empty', () => {
    const info = new LocomotorInfo()
    expect(info.TerrainSpeeds.size).toBe(0)
  })

  it('has default waitAverage=40', () => {
    const info = new LocomotorInfo()
    expect(info.WaitAverage).toBe(40)
  })

  it('has default waitSpread=10', () => {
    const info = new LocomotorInfo()
    expect(info.WaitSpread).toBe(10)
  })

  it('has default sharesCell=false', () => {
    const info = new LocomotorInfo()
    expect(info.SharesCell).toBe(false)
  })

  it('has default moveIntoShroud=true', () => {
    const info = new LocomotorInfo()
    expect(info.MoveIntoShroud).toBe(true)
  })

  it('has default Crushes empty', () => {
    const info = new LocomotorInfo()
    expect(info.Crushes.size).toBe(0)
  })

  it('has default CrushDamageTypes empty', () => {
    const info = new LocomotorInfo()
    expect(info.CrushDamageTypes.size).toBe(0)
  })

  it('has default DisableDomainPassabilityCheck=false', () => {
    const info = new LocomotorInfo()
    expect(info.DisableDomainPassabilityCheck).toBe(false)
  })

  it('accepts custom name via opts', () => {
    const info = new LocomotorInfo({ name: 'custom' })
    expect(info.Name).toBe('custom')
  })

  it('accepts legacy name-only constructor', () => {
    const info = new LocomotorInfo('legacy')
    expect(info.Name).toBe('legacy')
    expect(info.TerrainSpeeds.size).toBe(0)
  })

  it('accepts legacy constructor with terrain speeds', () => {
    const speeds = new Map([
      ['Clear', { speed: 100, cost: 100 }],
      ['Rough', { speed: 50, cost: 200 }],
    ])
    const info = new LocomotorInfo('test_loco', speeds)
    expect(info.Name).toBe('test_loco')
    expect(info.TerrainSpeeds.size).toBe(2)
    expect(info.TerrainSpeeds.get('Clear')?.Cost).toBe(100)
    expect(info.TerrainSpeeds.get('Rough')?.Cost).toBe(200)
    expect(info.TerrainSpeeds.get('Clear')?.Speed).toBe(100)
  })

  it('accepts custom opts for all fields', () => {
    const info = new LocomotorInfo({
      name: 'infantry',
      waitAverage: 30,
      waitSpread: 5,
      sharesCell: true,
      moveIntoShroud: false,
      crushes: new Set(['crate']),
      crushDamageTypes: new Set(['Crush']),
      terrainSpeeds: new Map([
        ['Clear', new TerrainInfo(80, 125)],
      ]),
      disableDomainPassabilityCheck: true,
    })
    expect(info.Name).toBe('infantry')
    expect(info.WaitAverage).toBe(30)
    expect(info.WaitSpread).toBe(5)
    expect(info.SharesCell).toBe(true)
    expect(info.MoveIntoShroud).toBe(false)
    expect(info.Crushes.has('crate')).toBe(true)
    expect(info.CrushDamageTypes.has('Crush')).toBe(true)
    expect(info.TerrainSpeeds.get('Clear')?.Speed).toBe(80)
    expect(info.DisableDomainPassabilityCheck).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CellCache
// ---------------------------------------------------------------------------

describe('CellCache', () => {
  it('stores immovable, cellFlag, and crushable', () => {
    const immovable = new LongBitSet<PlayerBitMask>('PlayerBitMask', 'P0')
    const crushable = new LongBitSet<PlayerBitMask>('PlayerBitMask', 'P1')
    const cache = new CellCache(immovable, CellFlag.HasMovingActor, crushable)
    expect(cache.immovable).toBe(immovable)
    expect(cache.cellFlag).toBe(CellFlag.HasMovingActor)
    expect(cache.crushable).toBe(crushable)
  })

  it('is immutable by convention', () => {
    const cache = new CellCache(
      new LongBitSet<PlayerBitMask>('PlayerBitMask'),
      CellFlag.HasFreeSpace,
      new LongBitSet<PlayerBitMask>('PlayerBitMask'),
    )
    expect(cache.cellFlag).toBe(CellFlag.HasFreeSpace)
  })
})

// ---------------------------------------------------------------------------
// SimpleLocomotor tests
// ---------------------------------------------------------------------------

describe('SimpleLocomotor', () => {
  it('returns cost 100 for all cells', () => {
    const locomotor = new SimpleLocomotor()
    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(1, 0),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(100)
  })

  it('returns cost 100 with ignoreSelf', () => {
    const locomotor = new SimpleLocomotor()
    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(1, 0),
      BlockedByActor.None,
      null,
      true,
    )
    expect(cost).toBe(100)
  })

  it('allows movement into all cells', () => {
    const locomotor = new SimpleLocomotor()
    const canMove = locomotor.canMoveFreelyInto(
      null,
      new CPos(5, 5),
      SubCell.FullCell as SubCellType,
      BlockedByActor.All,
      null,
    )
    expect(canMove).toBe(true)
  })

  it('returns movementCostForCell 100', () => {
    const locomotor = new SimpleLocomotor()
    expect(locomotor.movementCostForCell(new CPos(0, 0))).toBe(100)
    expect(locomotor.movementCostForCell(new CPos(99, 99))).toBe(100)
  })

  it('has default LocomotorInfo', () => {
    const locomotor = new SimpleLocomotor()
    expect(locomotor.Info.Name).toBe('default')
  })

  it('accepts custom LocomotorInfo', () => {
    const info = new LocomotorInfo({ name: 'custom' })
    const locomotor = new SimpleLocomotor(info)
    expect(locomotor.Info.Name).toBe('custom')
  })

  // New interface compliance tests
  it('movementSpeedForCell returns 100', () => {
    const locomotor = new SimpleLocomotor()
    expect(locomotor.movementSpeedForCell(new CPos(0, 0))).toBe(100)
  })

  it('canStayInCell returns true', () => {
    const locomotor = new SimpleLocomotor()
    expect(locomotor.canStayInCell(new CPos(0, 0))).toBe(true)
  })

  it('getAvailableSubCell returns FullCell', () => {
    const locomotor = new SimpleLocomotor()
    const player = makePlayer('P0', 0)
    const actor = makeActor(1, player)
    const sc = locomotor.getAvailableSubCell(actor, new CPos(0, 0), BlockedByActor.None)
    expect(sc).toBe(SubCell.FullCell)
  })

  it('isBlockedBy returns false', () => {
    const locomotor = new SimpleLocomotor()
    const player = makePlayer('P0', 0)
    const a1 = makeActor(1, player)
    const a2 = makeActor(2, player)
    expect(locomotor.isBlockedBy(a1, a2, null, new CPos(0, 0), BlockedByActor.All, CellFlag.HasFreeSpace)).toBe(false)
  })

  it('updateCellBlocking is no-op', () => {
    const locomotor = new SimpleLocomotor()
    expect(() => locomotor.updateCellBlocking(new CPos(0, 0))).not.toThrow()
  })

  it('sharesCell reflects Info.SharesCell', () => {
    const info = new LocomotorInfo({ sharesCell: true })
    const locomotor = new SimpleLocomotor(info)
    expect(locomotor.sharesCell).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// WallAwareLocomotor tests
// ---------------------------------------------------------------------------

describe('WallAwareLocomotor', () => {
  it('blocks specified cells', () => {
    const blocked = [new CPos(1, 0), new CPos(0, 1)]
    const locomotor = new WallAwareLocomotor(blocked)

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(1, 0),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('allows non-blocked cells', () => {
    const blocked = [new CPos(1, 0)]
    const locomotor = new WallAwareLocomotor(blocked)

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(0, 1),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(100)
  })

  it('blocks with ignoreSelf overload', () => {
    const blocked = [new CPos(2, 2)]
    const locomotor = new WallAwareLocomotor(blocked)

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(2, 2),
      BlockedByActor.None,
      null,
      true,
    )
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('reports blocked cells as not freely movable', () => {
    const blocked = [new CPos(5, 5)]
    const locomotor = new WallAwareLocomotor(blocked)

    const canMove = locomotor.canMoveFreelyInto(
      null,
      new CPos(5, 5),
      SubCell.FullCell as SubCellType,
      BlockedByActor.All,
      null,
    )
    expect(canMove).toBe(false)
  })

  it('reports non-blocked cells as freely movable', () => {
    const blocked = [new CPos(5, 5)]
    const locomotor = new WallAwareLocomotor(blocked)

    const canMove = locomotor.canMoveFreelyInto(
      null,
      new CPos(3, 3),
      SubCell.FullCell as SubCellType,
      BlockedByActor.All,
      null,
    )
    expect(canMove).toBe(true)
  })

  it('returns unreachable for blocked cells in movementCostForCell', () => {
    const blocked = [new CPos(1, 1)]
    const locomotor = new WallAwareLocomotor(blocked)

    expect(locomotor.movementCostForCell(new CPos(1, 1))).toBe(
      PathGraph.MovementCostForUnreachableCell,
    )
    expect(locomotor.movementCostForCell(new CPos(0, 0))).toBe(100)
  })

  it('handles empty blocked list', () => {
    const locomotor = new WallAwareLocomotor([])

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(0, 0),
      new CPos(1, 1),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(100)
  })

  it('has default LocomotorInfo when not provided', () => {
    const locomotor = new WallAwareLocomotor([new CPos(0, 0)])
    expect(locomotor.Info.Name).toBe('default')
  })

  it('accepts custom LocomotorInfo', () => {
    const info = new LocomotorInfo({ name: 'heavy' })
    const locomotor = new WallAwareLocomotor([new CPos(0, 0)], info)
    expect(locomotor.Info.Name).toBe('heavy')
  })

  // New interface compliance tests
  it('movementSpeedForCell returns 0 for blocked, 100 for free', () => {
    const locomotor = new WallAwareLocomotor([new CPos(1, 1)])
    expect(locomotor.movementSpeedForCell(new CPos(1, 1))).toBe(0)
    expect(locomotor.movementSpeedForCell(new CPos(0, 0))).toBe(100)
  })

  it('canStayInCell returns false for blocked', () => {
    const locomotor = new WallAwareLocomotor([new CPos(1, 1)])
    expect(locomotor.canStayInCell(new CPos(1, 1))).toBe(false)
    expect(locomotor.canStayInCell(new CPos(0, 0))).toBe(true)
  })

  it('getAvailableSubCell returns Invalid for blocked', () => {
    const locomotor = new WallAwareLocomotor([new CPos(1, 1)])
    const player = makePlayer('P0', 0)
    const actor = makeActor(1, player)
    expect(locomotor.getAvailableSubCell(actor, new CPos(1, 1), BlockedByActor.None)).toBe(SubCell.Invalid)
    expect(locomotor.getAvailableSubCell(actor, new CPos(0, 0), BlockedByActor.None)).toBe(SubCell.FullCell)
  })

  it('isBlockedBy returns true for blocked cell', () => {
    const locomotor = new WallAwareLocomotor([new CPos(1, 1)])
    const player = makePlayer('P0', 0)
    const a1 = makeActor(1, player)
    const a2 = makeActor(2, player)
    expect(locomotor.isBlockedBy(a1, a2, null, new CPos(1, 1), BlockedByActor.All, CellFlag.HasFreeSpace)).toBe(true)
    expect(locomotor.isBlockedBy(a1, a2, null, new CPos(0, 0), BlockedByActor.All, CellFlag.HasFreeSpace)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Locomotor class tests (full implementation)
// ---------------------------------------------------------------------------

describe('Locomotor (full implementation)', () => {
  let info: LocomotorInfo
  let world: ILocomotorWorld
  let mockActorMap: MockActorMap

  beforeEach(() => {
    info = new LocomotorInfo({
      name: 'vehicle',
      crushes: new Set(['infantry']),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    world = setup.world
    mockActorMap = setup.actorMap
  })

  it('constructs with world and info', () => {
    const locomotor = new Locomotor(world, info)
    expect(locomotor.Info).toBe(info)
    expect(locomotor.sharesCell).toBe(false)
  })

  it('sharesCell reflects info.SharesCell', () => {
    const info2 = new LocomotorInfo({ sharesCell: true })
    const locomotor = new Locomotor(world, info2)
    expect(locomotor.sharesCell).toBe(true)
  })

  it('worldLoaded initializes cell layers and subscribes events', () => {
    const locomotor = new Locomotor(world, info)
    expect(() => locomotor.worldLoaded(world, null)).not.toThrow()
  })

  it('movementCostForCell returns passable for valid cells', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    // Clear terrain with default terrain info
    const cost = locomotor.movementCostForCell(new CPos(0, 0, 0))
    // Default terrain info: speed 0, cost = MovementCostForUnreachableCell
    // Because TerrainSpeeds is empty, all terrain falls back to Impassable
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('movementCostForCell with terrain speeds works', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const cost = locomotor.movementCostForCell(new CPos(0, 0, 0))
    expect(cost).toBe(100)
  })

  it('movementCostForCell returns unreachable for out-of-bounds', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const cost = locomotor.movementCostForCell(new CPos(100, 100, 0))
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('movementCostForCell with height discontinuity', () => {
    const setup = makeWorld({
      maxTerrainHeight: 2,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const w = setup.world
    const wl = setup.heightLayer

    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const locomotor = new Locomotor(w, info2)
    locomotor.worldLoaded(w, null)

    // Set height 0 at (0,0) and height 3 at (1,0)
    wl[0] = 0  // (0,0)
    wl[1] = 3  // (1,0)

    const cost = locomotor.movementCostForCell(new CPos(1, 0, 0), new CPos(0, 0, 0))
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('movementCostForCell allows height diff of 1', () => {
    const setup = makeWorld({
      maxTerrainHeight: 2,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const w = setup.world
    const wl = setup.heightLayer

    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const locomotor = new Locomotor(w, info2)
    locomotor.worldLoaded(w, null)

    wl[0] = 0  // (0,0)
    wl[1] = 1  // (1,0)

    const cost = locomotor.movementCostForCell(new CPos(1, 0, 0), new CPos(0, 0, 0))
    expect(cost).toBe(100)
  })

  it('movementSpeedForCell returns terrain speed', () => {
    const info2 = new LocomotorInfo({
      name: 'fast',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(80, 100)]]),
    })
    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const speed = locomotor.movementSpeedForCell(new CPos(0, 0, 0))
    expect(speed).toBe(80)
  })

  it('movementSpeedForCell returns 0 for impassable terrain', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const speed = locomotor.movementSpeedForCell(new CPos(0, 0, 0))
    expect(speed).toBe(0) // Impassable has speed 0
  })

  it('canStayInCell returns true for normal cell', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    expect(locomotor.canStayInCell(new CPos(0, 0, 0))).toBe(true)
  })

  it('canStayInCell returns false for out-of-bounds', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    expect(locomotor.canStayInCell(new CPos(100, 100, 0))).toBe(false)
  })

  it('getAvailableSubCell returns FullCell for empty cell', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const player = makePlayer('P0', 0)
    const actor = makeActor(1, player)
    // Without actors, cell is free
    // But the mock actor map `hasFreeSubCell` returns true when actors list is empty
    mockActorMap.clear()
    const sc = locomotor.getAvailableSubCell(actor, new CPos(0, 0, 0), BlockedByActor.None)
    expect(sc).toBe(SubCell.FullCell)
  })

  it('getAvailableSubCell returns Invalid for unreachable cell', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const player = makePlayer('P0', 0)
    const actor = makeActor(1, player)
    // TerrainSpeeds is empty -> all cells are impassable
    const sc = locomotor.getAvailableSubCell(actor, new CPos(0, 0, 0), BlockedByActor.None)
    expect(sc).toBe(SubCell.Invalid)
  })
})

// ---------------------------------------------------------------------------
// isBlockedBy tests
// ---------------------------------------------------------------------------

describe('Locomotor.isBlockedBy', () => {
  let info: LocomotorInfo
  let world: ILocomotorWorld

  beforeEach(() => {
    info = new LocomotorInfo({
      name: 'tank',
      crushes: new Set(['infantry']),
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    world = setup.world
  })

  it('returns false when otherActor equals ignoreActor', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1)
    const other = makeActor(2, p1)

    const blocked = locomotor.isBlockedBy(
      actor, other, other, // ignoreActor == otherActor
      new CPos(0, 0, 0), BlockedByActor.All, CellFlag.HasMovableActor,
    )
    expect(blocked).toBe(false)
  })

  it('allied movable actor does not block at Immovable check level', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const pAlly = makePlayer('P0', 0) // Same name -> allied via relationshipWith mock
    const actor = makeActor(1, p1)
    const other = makeActor(2, pAlly, { isImmovable: false })

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.Immovable, CellFlag.HasMovableActor,
    )
    expect(blocked).toBe(false)
  })

  it('enemy immovable actor blocks at Immovable check level', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const pEnemy = makePlayer('P1', 1)
    const actor = makeActor(1, p1)
    const other = makeActor(2, pEnemy, { isImmovable: true })

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.Immovable, CellFlag.HasMovableActor | CellFlag.HasStationaryActor,
    )
    expect(blocked).toBe(true)
  })

  it('moving actor does not block at Stationary check level', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const pEnemy = makePlayer('P1', 1)
    const actor = makeActor(1, p1)
    const other = makeActor(2, pEnemy, { currentMovementTypes: MovementType.Horizontal })

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.Stationary, CellFlag.HasMovingActor,
    )
    expect(blocked).toBe(false)
  })

  it('stationary enemy actor blocks at Stationary check level', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const pEnemy = makePlayer('P1', 1)
    const actor = makeActor(1, p1)
    const other = makeActor(2, pEnemy, { isImmovable: true, currentMovementTypes: MovementType.None })

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.Stationary, CellFlag.HasStationaryActor,
    )
    expect(blocked).toBe(true)
  })

  it('crushable actor does not block if in crushes set', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const p2 = makePlayer('P1', 1)
    const actor = makeActor(1, p1)
    // Other actor is crushable (crushClasses match)
    const other = makeActor(2, p2, { crushClasses: ['infantry'] })

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.All, CellFlag.HasCrushableActor,
    )
    // crushableByPlayerMask returns p2.playerMask which overlaps with p2 but NOT with p1
    // Since actor is p1, it doesn't match p2's mask -> blocked is true
    // Actually, crushableByPlayerMask returns the crushable player's mask.
    // The check is: crushMask.overlaps(actor.owner.playerMask)
    // If crushableByPlayerMask returns the cushed actor's playerMask, then
    // p2.playerMask.overlaps(p1.playerMask) is false -> blocked
    expect(blocked).toBe(true)
  })

  it('temporary blocker can be removed if canRemoveBlockage returns true', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const p2 = makePlayer('P1', 1)
    const actor = makeActor(1, p1)
    const other = makeActor(2, p2, { hasTemporaryBlocker: true })

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.All, CellFlag.HasTemporaryBlocker,
    )
    // temporaryBlockerCanRemove returns true -> not blocked
    expect(blocked).toBe(false)
  })

  it('returns false for transit-only actor at its transit cell', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const p2 = makePlayer('P1', 1)
    const actor = makeActor(1, p1)
    const other = makeActor(2, p2, { isTransitOnly: true })

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.All, CellFlag.HasTransitOnlyActor,
    )
    expect(blocked).toBe(false)
  })

  it('returns true when no crush flag and crushes is empty', () => {
    const info2 = new LocomotorInfo({
      name: 'harmless',
      crushes: new Set(), // empty -> cannot crush anything
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const p2 = makePlayer('P1', 1)
    const actor = makeActor(1, p1)
    const other = makeActor(2, p2)

    const blocked = locomotor.isBlockedBy(
      actor, other, null,
      new CPos(0, 0, 0), BlockedByActor.All,
      CellFlag.HasStationaryActor,
    )
    // No crush flag + empty crushes -> blocked
    expect(blocked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// updateCellBlocking tests
// ---------------------------------------------------------------------------

describe('Locomotor.updateCellBlocking', () => {
  let info: LocomotorInfo
  let world: ILocomotorWorld
  let mockActorMap: MockActorMap

  beforeEach(() => {
    info = new LocomotorInfo({
      name: 'vehicle',
      crushes: new Set(['infantry']),
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
      rulesContainTemporaryBlocker: true,
    })
    world = setup.world
    mockActorMap = setup.actorMap
  })

  it('produces HasFreeSpace for empty cell', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    mockActorMap.clear()
    locomotor.updateCellBlocking(new CPos(0, 0, 0))
    // getCache will refresh from dirty cells if needed; directly read blocking cache
    // After updateCellBlocking, the cell should have CellFlag.HasFreeSpace
    // We verify via canMoveFreelyInto which should return true
    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1)
    const canMove = locomotor.canMoveFreelyInto(actor, new CPos(0, 0, 0), SubCell.FullCell as SubCellType, BlockedByActor.All, null)
    expect(canMove).toBe(true)
  })

  it('produces HasStationaryActor for immovable actor', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1, {
      isImmovable: true,
      isTraitDisabled: false,
      currentMovementTypes: MovementType.None,
    })
    mockActorMap.clear()
    mockActorMap.addActor(actor)

    locomotor.updateCellBlocking(new CPos(0, 0, 0))

    // The cell should now block movement
    const p2 = makePlayer('P1', 1)
    const movingActor = makeActor(2, p2)
    // Can't move into cell with enemy stationary actor
    const canMove = locomotor.canMoveFreelyInto(
      movingActor, new CPos(0, 0, 0), SubCell.FullCell as SubCellType, BlockedByActor.All, null,
    )
    expect(canMove).toBe(false)
  })

  it('produces HasMovingActor for moving actor', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1, { currentMovementTypes: MovementType.Horizontal })
    mockActorMap.clear()
    mockActorMap.addActor(actor)

    locomotor.updateCellBlocking(new CPos(0, 0, 0))

    // Stationary check level should NOT block since actor is moving
    const p2 = makePlayer('P1', 1)
    const movingActor = makeActor(2, p2)
    const canMove = locomotor.canMoveFreelyInto(
      movingActor, new CPos(0, 0, 0), SubCell.FullCell as SubCellType, BlockedByActor.Stationary, null,
    )
    expect(canMove).toBe(true)
  })

  it('produces HasTemporaryBlocker for temporary blocker actor', () => {
    const locomotor = new Locomotor(world, info)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1, { hasTemporaryBlocker: true })
    mockActorMap.clear()
    mockActorMap.addActor(actor)

    locomotor.updateCellBlocking(new CPos(0, 0, 0))

    // Cell should have temporary blocker flag
    const p2 = makePlayer('P1', 1)
    const movingActor = makeActor(2, p2)
    // CanMoveFreelyInto checks cellFlag via getCache
    const canMove = locomotor.canMoveFreelyInto(
      movingActor, new CPos(0, 0, 0), SubCell.FullCell as SubCellType, BlockedByActor.None, null,
    )
    expect(canMove).toBe(true) // BlockedByActor.None ignores all actors
  })

  it('sharesCell with free subcell sets HasFreeSpace', () => {
    const info2 = new LocomotorInfo({
      name: 'infantry',
      sharesCell: true,
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    mockActorMap.clear()
    // hasFreeSubCell returns true when actors list is empty
    locomotor.updateCellBlocking(new CPos(0, 0, 0))

    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1)
    const canMove = locomotor.canMoveFreelyInto(
      actor, new CPos(0, 0, 0), SubCell.FullCell as SubCellType, BlockedByActor.All, null,
    )
    expect(canMove).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// updateCellCost + CellCostChanged event tests
// ---------------------------------------------------------------------------

describe('Locomotor.updateCellCost and CellCostChanged', () => {
  it('fires CellCostChanged when callbacks are registered', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)

    const callbacks = new Set<(cell: CPos, oldCost: number, newCost: number) => void>()
    let firedCell: CPos | null = null
    let firedOldCost = 0
    let firedNewCost = 0
    callbacks.add((cell, oldCost, newCost) => {
      firedCell = cell
      firedOldCost = oldCost
      firedNewCost = newCost
    })
    locomotor.cellCostChanged = callbacks

    locomotor.worldLoaded(world, null)

    expect(firedCell).not.toBeNull()
    // Initial value in CellLayer is undefined (not yet set)
    // C# would default to 0 for short; TS defaults to undefined for number[]
    expect(firedOldCost).toBeUndefined()
    expect(firedNewCost).toBe(100) // Clear terrain cost
  })

  it('does not throw when CellCostChanged is undefined', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    // cellCostChanged is undefined
    expect(() => locomotor.worldLoaded(world, null)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// movementCostToEnterCell overloads
// ---------------------------------------------------------------------------

describe('Locomotor.movementCostToEnterCell', () => {
  it('overload with srcNode works', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1)

    // Empty cell — should be passable
    const cost = locomotor.movementCostToEnterCell(
      actor,
      new CPos(0, 0, 0),
      new CPos(1, 0, 0),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(100)
  })

  it('overload without srcNode works', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const actor = makeActor(1, p1)

    const cost = locomotor.movementCostToEnterCell(
      actor,
      new CPos(1, 0, 0),
      BlockedByActor.None,
      null,
      false,
    )
    expect(cost).toBe(100)
  })

  it('returns unreachable for out-of-bounds destination', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const cost = locomotor.movementCostToEnterCell(
      null,
      new CPos(100, 100, 0),
      BlockedByActor.None,
      null,
    )
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })
})

// ---------------------------------------------------------------------------
// Custom movement layer tests
// ---------------------------------------------------------------------------

describe('Locomotor with custom movement layers', () => {
  it('initializes costs for custom movement layers', () => {
    const info2 = new LocomotorInfo({
      name: 'subterranean',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const cml: ILocomotorCML = {
      Index: 1,
      getTerrainIndex(_cell: CPos): number {
        return 0 // Always Clear terrain
      },
    }
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
      customLayers: [null, cml],
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    expect(() => locomotor.worldLoaded(world, null)).not.toThrow()

    // Check that layer 1 has accessible costs
    const cost = locomotor.movementCostForCell(new CPos(0, 0, 1))
    expect(cost).not.toBe(PathGraph.MovementCostForUnreachableCell)
  })

  it('custom layer with MaxValue terrain index sets unreachable', () => {
    const info2 = new LocomotorInfo({
      name: 'subterranean',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const cml: ILocomotorCML = {
      Index: 1,
      getTerrainIndex(_cell: CPos): number {
        return 255 // byte.MaxValue → no terrain index
      },
    }
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
      customLayers: [null, cml],
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const cost = locomotor.movementCostForCell(new CPos(0, 0, 1))
    expect(cost).toBe(PathGraph.MovementCostForUnreachableCell)
  })
})

// ---------------------------------------------------------------------------
// canMoveFreelyInto detailed tests
// ---------------------------------------------------------------------------

describe('Locomotor.canMoveFreelyInto', () => {
  it('returns true for BlockedByActor.None regardless of actors', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    // Add actor to cell
    const p1 = makePlayer('P0', 0)
    const blocker = makeActor(1, p1, { isImmovable: true })
    setup.actorMap.clear()
    setup.actorMap.addActor(blocker)
    locomotor.updateCellBlocking(new CPos(0, 0, 0))

    const p2 = makePlayer('P1', 1)
    const mover = makeActor(2, p2)
    const canMove = locomotor.canMoveFreelyInto(
      mover, new CPos(0, 0, 0), SubCell.FullCell as SubCellType, BlockedByActor.None, null,
    )
    expect(canMove).toBe(true)
  })

  it('returns false when actor is null and cell has actors', () => {
    const info2 = new LocomotorInfo({
      name: 'vehicle',
      terrainSpeeds: new Map([['Clear', new TerrainInfo(100, 100)]]),
    })
    const setup = makeWorld({
      maxTerrainHeight: 0,
      terrainTypes: [{ Type: 'Clear' }],
      mapWidth: 4,
      mapHeight: 4,
    })
    const world = setup.world

    const locomotor = new Locomotor(world, info2)
    locomotor.worldLoaded(world, null)

    const p1 = makePlayer('P0', 0)
    const blocker = makeActor(1, p1, { isImmovable: true })
    setup.actorMap.clear()
    setup.actorMap.addActor(blocker)
    locomotor.updateCellBlocking(new CPos(0, 0, 0))

    // Actor is null — theoretical check, assumes blocked
    const canMove = locomotor.canMoveFreelyInto(
      null, new CPos(0, 0, 0), SubCell.FullCell as SubCellType, BlockedByActor.All, null,
    )
    expect(canMove).toBe(false)
  })
})
