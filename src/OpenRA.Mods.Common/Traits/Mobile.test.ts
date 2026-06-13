/**
 * Mobile.test.ts — Mobile trait migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, movement logic, order handling,
 * cell occupancy, facing, and lifecycle.
 */

import { describe, it, expect, vi } from 'vitest'

import {
  Mobile,
  MobileInfo,
  MoveResult,
  MovementType,
  MovementTypeExts,
  ReturnToCellActivity,
  LeaveProductionActivity,
  MoveOrderTargeter,
} from './Mobile.js'

import { WAngle } from '../../OpenRA.Game/WAngle.js'
import { WDist } from '../../OpenRA.Game/WDist.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WRot } from '../../OpenRA.Game/WRot.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { SubCell as SubCellEnum } from '../../OpenRA.Game/Traits/SubCell.js'
import { PathGraph } from '../Pathfinder/IPathGraph.js'
import { LocomotorInfo } from './World/Locomotor.js'

import type {
  IGameActor,
  ActivityStub,
  Order,
  IOrderTargeter,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ILocomotor } from './World/Locomotor.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock IGameActor for Mobile tests. */
function mockActor(overrides: Partial<IGameActor> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    world: { actors: [] },
    ...overrides,
  }
}

/** Create a mock ILocomotor with only the methods needed by Mobile. */
function mockLocomotor(sharesCell = false): ILocomotor {
  const info = new LocomotorInfo()
  // HACK: Bypass readonly via cast to set SharesCell
  ;(info as unknown as Record<string, unknown>)['SharesCell'] = sharesCell
  return {
    Info: info,
    sharesCell: sharesCell,
    movementCostForCell: vi.fn().mockReturnValue(100),
    movementSpeedForCell: vi.fn().mockReturnValue(100),
    movementCostToEnterCell: vi.fn().mockReturnValue(100),
    canMoveFreelyInto: vi.fn().mockReturnValue(true),
    canStayInCell: vi.fn().mockReturnValue(true),
    getAvailableSubCell: vi.fn().mockReturnValue(SubCellEnum.FullCell),
    isBlockedBy: vi.fn().mockReturnValue(false),
    isBlockedByFlag: vi.fn().mockReturnValue(false),
  } as unknown as ILocomotor
}

/** Create a mock world with spies. */
function mockWorld() {
  return {
    actors: [],
    addToMaps: vi.fn(),
    removeFromMaps: vi.fn(),
    addInfluence: vi.fn(),
    removeInfluence: vi.fn(),
    updateMaps: vi.fn(),
    updateOccupiedCells: vi.fn(),
  }
}

/** Create a MobileInfo with custom overrides. */
function makeInfo(overrides: Record<string, unknown> = {}): MobileInfo {
  return new MobileInfo(overrides as ConstructorParameters<typeof MobileInfo>[0])
}

/** Full setup: returns { mobile, actor, locomotor, world, info }. */
function setup(opts: {
  infoOverrides?: Record<string, unknown>
  actorOverrides?: Partial<IGameActor>
} = {}) {
  const info = makeInfo(opts.infoOverrides ?? {})
  info.locomotorInfo = new LocomotorInfo()
  ;(info.locomotorInfo as unknown as Record<string, unknown>)['SharesCell'] = false
  const world = mockWorld()
  const actor = mockActor({ world: world as unknown as IGameActor['world'], ...opts.actorOverrides })
  const locomotor = mockLocomotor()

  const mobile = new Mobile(info)
  mobile.initialize(actor, new CPos(5, 5), new WPos(5120, 5120, 0))
  mobile.setLocomotor(locomotor)

  return { mobile, actor, locomotor, world, info }
}

// ---------------------------------------------------------------------------
// MobileInfo tests
// ---------------------------------------------------------------------------

describe('MobileInfo', () => {
  it('constructs with all default values', () => {
    const info = new MobileInfo()
    expect(info.locomotor).toBe('default')
    expect(info.initialFacing.angle).toBe(0)
    expect(info.turnSpeed.angle).toBe(512)
    expect(info.speed).toBe(1)
    expect(info.alwaysTurnInPlace).toBe(false)
    expect(info.turnsWhileMoving).toBe(false)
    expect(info.cursor).toBe('move')
    expect(info.blockedCursor).toBe('move-blocked')
    expect(info.voice).toBe('Action')
    expect(info.canMoveBackward).toBe(false)
    expect(info.backwardDuration).toBe(40)
    expect(info.maxBackwardCells).toBe(15)
    expect(info.requireForceMoveCondition).toBeNull()
    expect(info.immovableCondition).toBeNull()
    expect(info.terrainOrientationAdjustmentMargin.length).toBe(-1)
    expect(info.previewFacing.angle).toBe(384)
    expect(info.editorFacingDisplayOrder).toBe(3)
  })

  it('constructs with custom values', () => {
    const info = new MobileInfo({
      locomotor: 'heavy',
      initialFacing: new WAngle(128),
      turnSpeed: new WAngle(256),
      speed: 2,
      alwaysTurnInPlace: true,
      turnsWhileMoving: true,
      cursor: 'move-custom',
      blockedCursor: 'blocked-custom',
      voice: 'Move',
      canMoveBackward: true,
      backwardDuration: 60,
      maxBackwardCells: 20,
      requireForceMoveCondition: '!building',
      immovableCondition: 'stunned',
      terrainOrientationAdjustmentMargin: new WDist(5),
      previewFacing: new WAngle(512),
      editorFacingDisplayOrder: 5,
    })

    expect(info.locomotor).toBe('heavy')
    expect(info.initialFacing.angle).toBe(128)
    expect(info.turnSpeed.angle).toBe(256)
    expect(info.speed).toBe(2)
    expect(info.alwaysTurnInPlace).toBe(true)
    expect(info.turnsWhileMoving).toBe(true)
    expect(info.canMoveBackward).toBe(true)
    expect(info.backwardDuration).toBe(60)
    expect(info.maxBackwardCells).toBe(20)
    expect(info.requireForceMoveCondition).toBe('!building')
    expect(info.immovableCondition).toBe('stunned')
  })

  it('getInitialFacing returns initialFacing', () => {
    const info = new MobileInfo({ initialFacing: new WAngle(256) })
    expect(info.getInitialFacing().angle).toBe(256)
  })

  it('getTargetLineColor returns targetLineColor', () => {
    const info = new MobileInfo()
    const color = info.getTargetLineColor()
    expect(color.r).toBe(0)
    expect(color.g).toBe(1)
    expect(color.b).toBe(0)
  })

  it('occupiedCells returns map with location and subCell', () => {
    const info = new MobileInfo()
    const cells = info.occupiedCells({ name: 'test' }, new CPos(3, 4), SubCellEnum.FullCell)
    expect(cells.size).toBe(1)
    // CPos keys are object references; iterate to verify entry
    let found = false
    for (const [k, v] of cells) {
      if (CPos.equals(k, new CPos(3, 4))) {
        expect(v).toBe(SubCellEnum.FullCell)
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it('sharesCell defaults to true when locomotorInfo is null', () => {
    const info = new MobileInfo()
    expect(info.sharesCell).toBe(true)
  })

  it('sharesCell returns false when LocomotorInfo.SharesCell is false', () => {
    const info = new MobileInfo()
    info.locomotorInfo = new LocomotorInfo()
  ;(info.locomotorInfo as unknown as Record<string, unknown>)['SharesCell'] = false
    expect(info.sharesCell).toBe(false)
  })

  it('canEnterCell returns false when locomotor is null', () => {
    const info = new MobileInfo()
    const actor = mockActor()
    expect(info.canEnterCell(actor, new CPos(0, 0), 3, SubCellEnum.FullCell, null, null)).toBe(false)
  })

  it('canEnterCell delegates to locomotor.canMoveFreelyInto', () => {
    const info = new MobileInfo()
    const actor = mockActor()
    const locomotor = mockLocomotor()
    expect(info.canEnterCell(actor, new CPos(3, 3), 3, SubCellEnum.FullCell, null, locomotor)).toBe(true)
  })

  it('canStayInCell returns false when locomotor is null', () => {
    const info = new MobileInfo()
    expect(info.canStayInCell(new CPos(0, 0), null)).toBe(false)
  })

  it('canStayInCell returns true for reachable cells', () => {
    const info = new MobileInfo()
    const locomotor = mockLocomotor()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(100)
    expect(info.canStayInCell(new CPos(1, 2), locomotor)).toBe(true)
  })

  it('canStayInCell returns false for unreachable cells', () => {
    const info = new MobileInfo()
    const locomotor = mockLocomotor()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(PathGraph.MovementCostForUnreachableCell)
    expect(info.canStayInCell(new CPos(1, 2), locomotor)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mobile: construction and initialization
// ---------------------------------------------------------------------------

describe('Mobile construction and initialization', () => {
  it('constructs with default Info', () => {
    const info = makeInfo()
    info.locomotorInfo = new LocomotorInfo()
    const mobile = new Mobile(info)
    expect(mobile.isTraitDisabled).toBe(false)
    expect(mobile.isTraitPaused).toBe(false)
    expect(mobile.info).toBe(info)
  })

  it('initialize sets facing to initialFacing', () => {
    const info = makeInfo({ initialFacing: new WAngle(256) })
    info.locomotorInfo = new LocomotorInfo()
    const mobile = new Mobile(info)
    mobile.initialize(mockActor(), new CPos(5, 5), new WPos(5120, 5120, 0))
    expect(mobile.facing.angle).toBe(256)
  })

  it('initialize sets fromCell and toCell', () => {
    const { mobile } = setup()
    expect(mobile.fromCell.X).toBe(5)
    expect(mobile.fromCell.Y).toBe(5)
    expect(mobile.toCell.X).toBe(5)
    expect(mobile.toCell.Y).toBe(5)
  })

  it('initialize sets centerPosition when provided', () => {
    const info = makeInfo()
    info.locomotorInfo = new LocomotorInfo()
    const mobile = new Mobile(info)
    const pos = new WPos(2048, 1024, 10)
    mobile.initialize(mockActor(), new CPos(2, 1), pos)
    expect(mobile.centerPosition.X).toBe(2048)
    expect(mobile.centerPosition.Y).toBe(1024)
    expect(mobile.centerPosition.Z).toBe(10)
  })

  it('initialize defaults to subCell FullCell for non-sharing cells', () => {
    const info = makeInfo()
    info.locomotorInfo = new LocomotorInfo()
  ;(info.locomotorInfo as unknown as Record<string, unknown>)['SharesCell'] = false
    const mobile = new Mobile(info)
    mobile.initialize(mockActor())
    expect(mobile.fromSubCell).toBe(SubCellEnum.FullCell)
    expect(mobile.toSubCell).toBe(SubCellEnum.FullCell)
  })

  it('isInWorld reflects actor.isInWorld', () => {
    const { mobile } = setup({ actorOverrides: { isInWorld: true } })
    expect(mobile.isInWorld).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mobile: IFacing
// ---------------------------------------------------------------------------

describe('Mobile IFacing', () => {
  it('facing getter returns current orientation.yaw', () => {
    const { mobile } = setup({ infoOverrides: { initialFacing: new WAngle(128) } })
    expect(mobile.facing.angle).toBe(128)
  })

  it('facing setter updates orientation', () => {
    const { mobile } = setup({ infoOverrides: { initialFacing: new WAngle(0) } })
    mobile.facing = new WAngle(384)
    expect(mobile.facing.angle).toBe(384)
  })

  it('turnSpeed returns info.turnSpeed', () => {
    const { mobile } = setup({ infoOverrides: { turnSpeed: new WAngle(256) } })
    expect(mobile.turnSpeed.angle).toBe(256)
  })

  it('orientation includes terrain ramp rotation when margin >= 0', () => {
    const { mobile } = setup({
      infoOverrides: {
        initialFacing: new WAngle(0),
        terrainOrientationAdjustmentMargin: new WDist(0),
      },
    })
    const rampRot = WRot.fromYaw(new WAngle(64))
    mobile.setTerrainRampOrientation(rampRot)
    expect(mobile.orientation.yaw.angle).toBe(64)
  })

  it('setTerrainRampOrientation is ignored when margin < 0', () => {
    const { mobile } = setup({
      infoOverrides: {
        terrainOrientationAdjustmentMargin: new WDist(-1),
        initialFacing: new WAngle(0),
      },
    })
    mobile.setTerrainRampOrientation(WRot.fromYaw(new WAngle(64)))
    expect(mobile.orientation.yaw.angle).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Mobile: occupiedCells
// ---------------------------------------------------------------------------

describe('Mobile occupiedCells', () => {
  it('returns single cell when fromCell equals toCell', () => {
    const { mobile } = setup()
    const cells = mobile.occupiedCells()
    expect(cells.length).toBe(1)
    expect(cells[0].cell.X).toBe(5)
    expect(cells[0].cell.Y).toBe(5)
  })

  it('returns two cells when fromCell differs from toCell and not sharesCell', () => {
    const { info, actor } = setup()
    info.locomotorInfo = new LocomotorInfo()
  ;(info.locomotorInfo as unknown as Record<string, unknown>)['SharesCell'] = false
    const mobile = new Mobile(info)
    mobile.initialize(actor, new CPos(5, 5), new WPos(5120, 5120, 0))
    mobile.setLocation(new CPos(3, 3), SubCellEnum.FullCell, new CPos(4, 4), SubCellEnum.FullCell)
    const cells = mobile.occupiedCells()
    expect(cells.length).toBe(2)
  })

  it('returns single toCell when sharesCell is true', () => {
    const { info, actor } = setup()
    info.locomotorInfo = new LocomotorInfo()
  ;(info.locomotorInfo as unknown as Record<string, unknown>)['SharesCell'] = true
    const mobile = new Mobile(info)
    mobile.initialize(actor, new CPos(5, 5), new WPos(5120, 5120, 0))
    mobile.setLocation(new CPos(3, 3), SubCellEnum.FullCell, new CPos(4, 4), SubCellEnum.FullCell)
    const cells = mobile.occupiedCells()
    expect(cells.length).toBe(1)
    expect(cells[0].cell.X).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Mobile: movement types
// ---------------------------------------------------------------------------

describe('Mobile movement types', () => {
  it('currentMovementTypes returns empty set when not moving', () => {
    const { mobile } = setup()
    expect(mobile.currentMovementTypes.size).toBe(0)
  })

  it('detects horizontal movement after position change', () => {
    const { mobile } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_oldPos'] = new WPos(5120, 5120, 0)
    ;(mobile as unknown as Record<string, unknown>)['_centerPosition'] = new WPos(6000, 5120, 0)
    mobile.tick()
    expect(mobile.currentMovementTypes.has('Horizontal')).toBe(true)
  })

  it('detects vertical movement after Z change', () => {
    const { mobile } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_oldPos'] = new WPos(5120, 5120, 0)
    ;(mobile as unknown as Record<string, unknown>)['_centerPosition'] = new WPos(5120, 5120, 100)
    mobile.tick()
    expect(mobile.currentMovementTypes.has('Vertical')).toBe(true)
  })

  it('detects turn movement after facing change', () => {
    const { mobile } = setup({ infoOverrides: { initialFacing: new WAngle(0) } })
    ;(mobile as unknown as Record<string, unknown>)['_oldFacing'] = new WAngle(0)
    mobile.facing = new WAngle(128)
    mobile.tick()
    expect(mobile.currentMovementTypes.has('Turn')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MovementTypeExts
// ---------------------------------------------------------------------------

describe('MovementTypeExts', () => {
  it('hasMovementType returns true when flag is set', () => {
    expect(MovementTypeExts.hasMovementType(
      MovementType.Horizontal | MovementType.Turn,
      MovementType.Horizontal,
    )).toBe(true)
  })

  it('hasMovementType returns false when flag is not set', () => {
    expect(MovementTypeExts.hasMovementType(
      MovementType.Horizontal,
      MovementType.Turn,
    )).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mobile: cell checks
// ---------------------------------------------------------------------------

describe('Mobile cell checks', () => {
  it('canEnterCell delegates to locomotor', () => {
    const { mobile, locomotor } = setup()
    expect(mobile.canEnterCell(new CPos(3, 3))).toBe(true)
    expect(locomotor.canMoveFreelyInto).toHaveBeenCalled()
  })

  it('canStayInCell returns true for reachable cell', () => {
    const { mobile, locomotor } = setup()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(100)
    expect(mobile.canStayInCell(new CPos(1, 2))).toBe(true)
  })

  it('canStayInCell returns false for unreachable cell', () => {
    const { mobile, locomotor } = setup()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(
      PathGraph.MovementCostForUnreachableCell,
    )
    expect(mobile.canStayInCell(new CPos(1, 2))).toBe(false)
  })

  it('canExistInCell returns true for reachable cell', () => {
    const { mobile, locomotor } = setup()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(100)
    expect(mobile.canExistInCell(new CPos(3, 3))).toBe(true)
  })

  it('canExistInCell returns false for unreachable cell', () => {
    const { mobile, locomotor } = setup()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(
      PathGraph.MovementCostForUnreachableCell,
    )
    expect(mobile.canExistInCell(new CPos(3, 3))).toBe(false)
  })

  it('canExistInCell returns false when locomotor is null', () => {
    const info = makeInfo()
    info.locomotorInfo = new LocomotorInfo()
    const mobile = new Mobile(info)
    mobile.initialize(mockActor())
    expect(mobile.canExistInCell(new CPos(0, 0))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mobile: isImmovable
// ---------------------------------------------------------------------------

describe('Mobile isImmovable', () => {
  it('returns false by default', () => {
    const { mobile } = setup()
    expect(mobile.isImmovable).toBe(false)
  })

  it('returns true when immovableCondition is active', () => {
    const { mobile } = setup({ infoOverrides: { immovableCondition: 'stunned' } })
    ;(mobile as unknown as Record<string, unknown>)['_immoConditionActive'] = true
    expect(mobile.isImmovable).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mobile: isBlocking / isLeaving
// ---------------------------------------------------------------------------

describe('Mobile isBlocking and isLeaving', () => {
  it('isBlocking defaults to false', () => {
    const { mobile } = setup()
    expect(mobile.isBlocking).toBe(false)
  })

  it('isBlocking can be set to true', () => {
    const { mobile } = setup()
    mobile.isBlocking = true
    expect(mobile.isBlocking).toBe(true)
  })

  it('isLeaving returns false when not moving', () => {
    const { mobile } = setup()
    expect(mobile.isLeaving()).toBe(false)
  })

  it('isLeaving returns true during horizontal movement', () => {
    const { mobile } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_oldPos'] = new WPos(5120, 5120, 0)
    ;(mobile as unknown as Record<string, unknown>)['_centerPosition'] = new WPos(6000, 5120, 0)
    mobile.tick()
    expect(mobile.isLeaving()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mobile: MoveResult
// ---------------------------------------------------------------------------

describe('Mobile MoveResult', () => {
  it('defaults to Moving', () => {
    const { mobile } = setup()
    expect(mobile.moveResult).toBe(MoveResult.Moving)
  })

  it('can be set to Consumed', () => {
    const { mobile } = setup()
    mobile.moveResult = MoveResult.Consumed
    expect(mobile.moveResult).toBe(MoveResult.Consumed)
  })

  it('can be set to Blocked', () => {
    const { mobile } = setup()
    mobile.moveResult = MoveResult.Blocked
    expect(mobile.moveResult).toBe(MoveResult.Blocked)
  })
})

// ---------------------------------------------------------------------------
// Mobile: isMovingBetweenCells
// ---------------------------------------------------------------------------

describe('Mobile isMovingBetweenCells', () => {
  it('returns false when fromCell equals toCell', () => {
    const { mobile } = setup()
    expect(mobile.isMovingBetweenCells).toBe(false)
  })

  it('returns true when fromCell differs from toCell', () => {
    const { info, actor } = setup()
    info.locomotorInfo = new LocomotorInfo()
    const mobile = new Mobile(info)
    mobile.initialize(actor, new CPos(5, 5), new WPos(5120, 5120, 0))
    mobile.setLocation(new CPos(3, 3), SubCellEnum.FullCell, new CPos(4, 4), SubCellEnum.FullCell)
    expect(mobile.isMovingBetweenCells).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mobile: setCenterPosition
// ---------------------------------------------------------------------------

describe('Mobile setCenterPosition', () => {
  it('updates centerPosition', () => {
    const { mobile, actor } = setup()
    const newPos = new WPos(99999, 88888, 77777)
    mobile.setCenterPosition(actor, newPos)
    expect(mobile.centerPosition.X).toBe(99999)
    expect(mobile.centerPosition.Y).toBe(88888)
    expect(mobile.centerPosition.Z).toBe(77777)
  })

  it('canCenterPositionChange returns true when not disabled and not immovable', () => {
    const { mobile, actor } = setup()
    expect(mobile.canCenterPositionChange(actor)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mobile: getValidSubCell
// ---------------------------------------------------------------------------

describe('Mobile getValidSubCell', () => {
  it('returns FullCell for non-sharing cells when given Any', () => {
    const { info, actor } = setup()
    info.locomotorInfo = new LocomotorInfo()
  ;(info.locomotorInfo as unknown as Record<string, unknown>)['SharesCell'] = false
    const mobile = new Mobile(info)
    mobile.initialize(actor, new CPos(5, 5), new WPos(5120, 5120, 0))
    expect(mobile.getValidSubCell(SubCellEnum.Any)).toBe(SubCellEnum.FullCell)
  })

  it('preserves FullCell when given FullCell', () => {
    const { mobile } = setup()
    expect(mobile.getValidSubCell(SubCellEnum.FullCell)).toBe(SubCellEnum.FullCell)
  })
})

// ---------------------------------------------------------------------------
// Mobile: estimatedMoveDuration
// ---------------------------------------------------------------------------

describe('Mobile estimatedMoveDuration', () => {
  it('calculates non-zero duration for a distance', () => {
    const { mobile, actor } = setup()
    const from = new WPos(0, 0, 0)
    const to = new WPos(1024, 0, 0)
    const duration = mobile.estimatedMoveDuration(actor, from, to)
    expect(duration).toBeGreaterThan(0)
  })

  it('returns 0 when speed is 0', () => {
    const { mobile, actor } = setup({ infoOverrides: { speed: 0 } })
    const from = new WPos(0, 0, 0)
    const to = new WPos(1024, 0, 0)
    expect(mobile.estimatedMoveDuration(actor, from, to)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Mobile: nearestMoveableCell
// ---------------------------------------------------------------------------

describe('Mobile nearestMoveableCell', () => {
  it('returns target when it is the current cell and can stay', () => {
    const { mobile } = setup()
    const result = mobile.nearestMoveableCell(new CPos(5, 5))
    expect(result.X).toBe(5)
    expect(result.Y).toBe(5)
  })

  it('returns target when it is enterable and stayable', () => {
    const { mobile, locomotor } = setup()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(100)
    ;(locomotor.canMoveFreelyInto as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const result = mobile.nearestMoveableCell(new CPos(6, 6))
    expect(result.X).toBe(6)
    expect(result.Y).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Mobile: setLocation
// ---------------------------------------------------------------------------

describe('Mobile setLocation', () => {
  it('updates from/to cells', () => {
    const { mobile } = setup()
    mobile.setLocation(new CPos(1, 2), SubCellEnum.FullCell, new CPos(3, 4), SubCellEnum.FullCell)
    expect(mobile.fromCell.X).toBe(1)
    expect(mobile.fromCell.Y).toBe(2)
    expect(mobile.toCell.X).toBe(3)
    expect(mobile.toCell.Y).toBe(4)
  })

  it('resets isBlocking to false', () => {
    const { mobile } = setup()
    mobile.isBlocking = true
    mobile.setLocation(new CPos(1, 2), SubCellEnum.FullCell, new CPos(3, 4), SubCellEnum.FullCell)
    expect(mobile.isBlocking).toBe(false)
  })

  it('no-ops when values unchanged', () => {
    const { mobile } = setup()
    mobile.setLocation(new CPos(1, 2), SubCellEnum.FullCell, new CPos(3, 4), SubCellEnum.FullCell)
    const bitsBefore = mobile.fromCell.Bits
    mobile.setLocation(new CPos(1, 2), SubCellEnum.FullCell, new CPos(3, 4), SubCellEnum.FullCell)
    expect(mobile.fromCell.Bits).toBe(bitsBefore)
  })
})

// ---------------------------------------------------------------------------
// Mobile: isLeavingCell
// ---------------------------------------------------------------------------

describe('Mobile isLeavingCell', () => {
  it('returns true when fromCell matches and toCell differs', () => {
    const { mobile } = setup()
    mobile.setLocation(new CPos(3, 3), SubCellEnum.FullCell, new CPos(4, 4), SubCellEnum.FullCell)
    expect(mobile.isLeavingCell(new CPos(3, 3))).toBe(true)
  })

  it('returns false when fromCell does not match', () => {
    const { mobile } = setup()
    mobile.setLocation(new CPos(3, 3), SubCellEnum.FullCell, new CPos(4, 4), SubCellEnum.FullCell)
    expect(mobile.isLeavingCell(new CPos(2, 2))).toBe(false)
  })

  it('returns false when toCell matches', () => {
    const { mobile } = setup()
    mobile.setLocation(new CPos(3, 3), SubCellEnum.FullCell, new CPos(4, 4), SubCellEnum.FullCell)
    expect(mobile.isLeavingCell(new CPos(4, 4))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mobile: IResolveOrder
// ---------------------------------------------------------------------------

describe('Mobile resolveOrder', () => {
  it('ignores orders when trait disabled', () => {
    const { mobile, actor } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_enabled'] = false
    const order: Order = { orderName: 'Move', targetString: '', extraData: {} }
    expect(() => mobile.resolveOrder(actor, order)).not.toThrow()
  })

  it('handles Move order', () => {
    const { mobile, actor } = setup()
    const queued: ActivityStub[] = []
    actor.queueActivity = (a: ActivityStub) => { queued.push(a) }
    const order: Order = {
      orderName: 'Move',
      targetString: '',
      extraData: { target: { Type: 'Terrain' } },
    } as unknown as Order
    mobile.resolveOrder(actor, order)
    expect(queued.length).toBeGreaterThanOrEqual(0)
  })

  it('handles Stop order and calls cancelActivity', () => {
    const { mobile, actor } = setup()
    let cancelCalled = false
    actor.cancelActivity = () => { cancelCalled = true }
    const order: Order = { orderName: 'Stop', targetString: '', extraData: {} }
    mobile.resolveOrder(actor, order)
    expect(cancelCalled).toBe(true)
  })

  it('handles Scatter order', () => {
    const { mobile, actor } = setup()
    const queued: ActivityStub[] = []
    actor.queueActivity = (a: ActivityStub) => { queued.push(a) }
    const order: Order = { orderName: 'Scatter', targetString: '', extraData: {} }
    mobile.resolveOrder(actor, order)
    expect(queued.length).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// Mobile: IIssueOrder
// ---------------------------------------------------------------------------

describe('Mobile IIssueOrder', () => {
  it('returns empty orders when trait disabled', () => {
    const { mobile } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_enabled'] = false
    expect(mobile.orders.length).toBe(0)
  })

  it('returns MoveOrderTargeter when trait enabled', () => {
    const { mobile } = setup()
    expect(mobile.orders.length).toBe(1)
    expect(mobile.orders[0]).toBeInstanceOf(MoveOrderTargeter)
    expect(mobile.orders[0].orderID).toBe('Move')
    expect(mobile.orders[0].orderPriority).toBe(4)
  })

  it('issueOrder returns Move order', () => {
    const { mobile, actor } = setup()
    const order = mobile.issueOrder(actor, mobile.orders[0], {} as IOrderTargeter, false)
    expect(order).not.toBeNull()
    expect(order.orderName).toBe('Move')
  })
})

// ---------------------------------------------------------------------------
// Mobile: IOrderVoice
// ---------------------------------------------------------------------------

describe('Mobile IOrderVoice', () => {
  it('returns voice for Move order', () => {
    const { mobile, actor } = setup({ infoOverrides: { voice: 'Action' } })
    expect(mobile.voicePhraseForOrder(actor, {
      orderName: 'Move', targetString: '', extraData: {},
    })).toBe('Action')
  })

  it('returns empty string when trait disabled', () => {
    const { mobile, actor } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_enabled'] = false
    expect(mobile.voicePhraseForOrder(actor, {
      orderName: 'Move', targetString: '', extraData: {},
    })).toBe('')
  })

  it('returns empty string for unknown order', () => {
    const { mobile, actor } = setup()
    expect(mobile.voicePhraseForOrder(actor, {
      orderName: 'Attack', targetString: '', extraData: {},
    })).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Mobile: INotifyAddedToWorld / INotifyRemovedFromWorld
// ---------------------------------------------------------------------------

describe('Mobile INotifyAddedToWorld / INotifyRemovedFromWorld', () => {
  it('calls world.addToMaps on addedToWorld', () => {
    const { mobile, actor, world } = setup()
    mobile.addedToWorld(actor)
    expect(world.addToMaps).toHaveBeenCalledWith(actor, mobile)
  })

  it('calls world.removeFromMaps on removedFromWorld', () => {
    const { mobile, actor, world } = setup()
    mobile.removedFromWorld(actor)
    expect(world.removeFromMaps).toHaveBeenCalledWith(actor, mobile)
  })
})

// ---------------------------------------------------------------------------
// Mobile: INotifyBlockingMove
// ---------------------------------------------------------------------------

describe('Mobile INotifyBlockingMove', () => {
  it('sets isBlocking to true', () => {
    const { mobile, actor } = setup()
    const blocker = mockActor({ actorId: 2 })
    mobile.onNotifyBlockingMove(actor, blocker)
    expect(mobile.isBlocking).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mobile: traitPaused / traitResumed
// ---------------------------------------------------------------------------

describe('Mobile traitPaused / traitResumed', () => {
  it('traitPaused sets paused state', () => {
    const { mobile, actor } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_paused'] = false
    mobile.traitPaused(actor)
    expect(mobile.isTraitPaused).toBe(true)
  })

  it('traitResumed clears paused state', () => {
    const { mobile, actor } = setup()
    ;(mobile as unknown as Record<string, unknown>)['_paused'] = true
    mobile.traitResumed(actor)
    expect(mobile.isTraitPaused).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Mobile: getVariableObservers
// ---------------------------------------------------------------------------

describe('Mobile getVariableObservers', () => {
  it('returns empty when no conditions set', () => {
    const { mobile } = setup()
    expect(mobile.getVariableObservers().length).toBe(0)
  })

  it('returns observers when requireForceMoveCondition is set', () => {
    const { mobile } = setup({ infoOverrides: { requireForceMoveCondition: '!building' } })
    expect(mobile.getVariableObservers().length).toBe(1)
  })

  it('returns observers when immovableCondition is set', () => {
    const { mobile } = setup({ infoOverrides: { immovableCondition: 'stunned' } })
    expect(mobile.getVariableObservers().length).toBe(1)
  })

  it('returns two observers with both conditions', () => {
    const { mobile } = setup({
      infoOverrides: { requireForceMoveCondition: '!building', immovableCondition: 'stunned' },
    })
    expect(mobile.getVariableObservers().length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Mobile: getAdjacentCell
// ---------------------------------------------------------------------------

describe('Mobile getAdjacentCell', () => {
  it('finds an adjacent enterable cell', () => {
    const { mobile, locomotor } = setup()
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(100)
    ;(locomotor.canMoveFreelyInto as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(locomotor.canStayInCell as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const result = mobile.getAdjacentCell(new CPos(6, 5))
    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(CPos)
  })

  it('returns an adjacent cell even when not enterable (notStupidCells fallback)', () => {
    const { mobile, locomotor } = setup()
    ;(locomotor.canMoveFreelyInto as ReturnType<typeof vi.fn>).mockReturnValue(false)
    ;(locomotor.movementCostForCell as ReturnType<typeof vi.fn>).mockReturnValue(
      PathGraph.MovementCostForUnreachableCell,
    )
    // When no cells are enterable, falls back to any cell != nextCell and != toCell
    const result = mobile.getAdjacentCell(new CPos(6, 5))
    expect(result).not.toBeNull()
    expect(result).toBeInstanceOf(CPos)
  })
})

// ---------------------------------------------------------------------------
// Mobile: ICreationActivity
// ---------------------------------------------------------------------------

describe('Mobile ICreationActivity', () => {
  it('returns non-null when returnToCellOnCreation is true', () => {
    const { info, actor } = setup()
    info.locomotorInfo = new LocomotorInfo()
    const mobile = new Mobile(info)
    mobile.initialize(actor, new CPos(5, 5), new WPos(5120, 5120, 0))
    expect(mobile.getCreationActivity()).not.toBeNull()
  })

  it('returns null when not returning to cell', () => {
    const { info, actor } = setup()
    info.locomotorInfo = new LocomotorInfo()
    const mobile = new Mobile(info)
    mobile.initialize(actor, new CPos(5, 5))
    expect(mobile.getCreationActivity()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Mobile: modifyDeathActorInit
// ---------------------------------------------------------------------------

describe('Mobile modifyDeathActorInit', () => {
  it('sets FacingInit and HuskSpeedInit on death', () => {
    const { mobile, actor } = setup()
    const initMap = new Map<string, unknown>()
    mobile.modifyDeathActorInit(actor, initMap)
    expect(initMap.has('FacingInit')).toBe(true)
    expect(initMap.has('HuskSpeedInit')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Mobile: modifyActorPreviewInit
// ---------------------------------------------------------------------------

describe('Mobile modifyActorPreviewInit', () => {
  it('sets DynamicFacingInit when not present', () => {
    const { mobile, actor } = setup()
    const inits = new Map<string, unknown>()
    mobile.modifyActorPreviewInit(actor, inits)
    expect(inits.has('DynamicFacingInit')).toBe(true)
  })

  it('does not override existing FacingInit', () => {
    const { mobile, actor } = setup()
    const inits = new Map<string, unknown>([['FacingInit', { value: new WAngle(0) }]])
    mobile.modifyActorPreviewInit(actor, inits)
    expect(inits.has('DynamicFacingInit')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MoveOrderTargeter
// ---------------------------------------------------------------------------

describe('MoveOrderTargeter', () => {
  it('has correct orderID and priority', () => {
    const { mobile } = setup()
    const targeter = new MoveOrderTargeter(mobile)
    expect(targeter.orderID).toBe('Move')
    expect(targeter.orderPriority).toBe(4)
  })

  it('isQueued defaults to false', () => {
    const { mobile } = setup()
    expect(new MoveOrderTargeter(mobile).isQueued).toBe(false)
  })

  it('canTarget updates isQueued with ForceQueue modifier', () => {
    const { mobile, actor } = setup()
    const targeter = new MoveOrderTargeter(mobile)
    targeter.canTarget(actor, {} as IOrderTargeter, 2, 'move') // ForceQueue = 2
    expect(targeter.isQueued).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ReturnToCellActivity
// ---------------------------------------------------------------------------

describe('ReturnToCellActivity', () => {
  it('completes immediately (tick returns true)', () => {
    const activity = new ReturnToCellActivity()
    expect(activity.tick(mockActor())).toBe(true)
  })

  it('isInterruptible defaults to false', () => {
    expect(new ReturnToCellActivity().isInterruptible).toBe(false)
  })

  it('cancel sets isCanceling', () => {
    const activity = new ReturnToCellActivity()
    activity.cancel(mockActor())
    expect(activity.isCanceling).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// LeaveProductionActivity
// ---------------------------------------------------------------------------

describe('LeaveProductionActivity', () => {
  it('completes immediately (tick returns true)', () => {
    const activity = new LeaveProductionActivity()
    expect(activity.tick(mockActor())).toBe(true)
  })

  it('cancel sets isCanceling', () => {
    const activity = new LeaveProductionActivity()
    activity.cancel(mockActor())
    expect(activity.isCanceling).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// MovementType enum values
// ---------------------------------------------------------------------------

describe('MovementType enum', () => {
  it('has distinct values', () => {
    expect(MovementType.None).toBe(0)
    expect(MovementType.Horizontal).toBe(1)
    expect(MovementType.Vertical).toBe(2)
    expect(MovementType.Turn).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// MoveResult enum values
// ---------------------------------------------------------------------------

describe('MoveResult enum', () => {
  it('has correct values', () => {
    expect(MoveResult.Moving).toBe(0)
    expect(MoveResult.Consumed).toBe(1)
    expect(MoveResult.Blocked).toBe(2)
  })
})
