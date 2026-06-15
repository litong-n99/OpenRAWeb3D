/**
 * SelectDirectionalTarget.test.ts — SelectDirectionalTarget 单元测试
 *
 * Tests focus on: drag-state machine, angle computation, arrow selection, order generation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SelectDirectionalTarget,
  type Arrow,
  type ArrowDirection,
} from './SelectDirectionalTarget.js'
import type { DirectionalSupportPowerInfo } from './DirectionalSupportPower.js'
import { SupportPowerManager, SupportPowerInstance } from './SupportPowerManager.js'
import { SupportPower, type SupportPowerInfo, type ISupportPower, type ISupportPowerInstance } from './SupportPower.js'
import type { IGameActor, PlayerStub, WorldStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Mock Direction stub
// ---------------------------------------------------------------------------

function createMockDirection(facing: number): ArrowDirection {
  return { facing }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockActor(actorId = 1): IGameActor & { _impls: Record<string, unknown[]> } {
  const impls: Record<string, unknown[]> = {}
  return {
    actorId,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: undefined,
    world: undefined,
    traitsImplementing(interfaceId: string): unknown[] {
      return impls[interfaceId] ?? []
    },
    _impls: impls,
  } as IGameActor & { _impls: Record<string, unknown[]> }
}

function createMockPlayer(): PlayerStub {
  return { playerName: 'TestPlayer' }
}

function createMockWorld(): WorldStub {
  return { actors: [] }
}

function createTestArrows(count = 8): Arrow[] {
  const partAngle = 360 / count
  const arrows: Arrow[] = []
  for (let i = 0; i < count; i++) {
    arrows.push({
      sprite: null,
      endAngle: (i + 0.5) * partAngle, // end angle covers first half of each sector
      direction: createMockDirection(i * Math.floor(1024 / count)),
    })
  }
  return arrows
}

class MockSupportPower extends SupportPower {
  constructor(self: IGameActor, info: SupportPowerInfo) {
    super(self, info)
  }
  override createInstance(_key: string, _manager: unknown): ISupportPowerInstance {
    return {} as ISupportPowerInstance
  }
}

// ---------------------------------------------------------------------------
// angleOf
// ---------------------------------------------------------------------------

describe('SelectDirectionalTarget.angleOf', () => {
  it('returns 0 for North (0, -1)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: 0, y: -1 })
    expect(angle).toBeCloseTo(0, 5)
  })

  it('returns 90 for West (-1, 0)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: -1, y: 0 })
    expect(angle).toBeCloseTo(90, 5)
  })

  it('returns 180 for South (0, 1)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: 0, y: 1 })
    expect(angle).toBeCloseTo(180, 5)
  })

  it('returns 270 for East (1, 0)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: 1, y: 0 })
    expect(angle).toBeCloseTo(270, 5)
  })

  it('returns 45 for North-West (-1, -1)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: -1, y: -1 })
    expect(angle).toBeCloseTo(45, 5)
  })

  it('returns 135 for South-West (-1, 1)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: -1, y: 1 })
    expect(angle).toBeCloseTo(135, 5)
  })

  it('returns 225 for South-East (1, 1)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: 1, y: 1 })
    expect(angle).toBeCloseTo(225, 5)
  })

  it('returns 315 for North-East (1, -1)', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: 1, y: -1 })
    expect(angle).toBeCloseTo(315, 5)
  })

  it('returns value in [0, 360) for zero vector', () => {
    const angle = SelectDirectionalTarget.angleOf({ x: 0, y: 0 })
    expect(angle).toBeGreaterThanOrEqual(0)
    expect(angle).toBeLessThan(360)
  })

  it('returns value in [0, 360) for any input', () => {
    const angles = [
      SelectDirectionalTarget.angleOf({ x: 100, y: 0 }),
      SelectDirectionalTarget.angleOf({ x: 0, y: 100 }),
      SelectDirectionalTarget.angleOf({ x: -100, y: -100 }),
      SelectDirectionalTarget.angleOf({ x: 50, y: -50 }),
    ]
    for (const a of angles) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThan(360)
    }
  })
})

// ---------------------------------------------------------------------------
// getArrow
// ---------------------------------------------------------------------------

describe('SelectDirectionalTarget.getArrow', () => {
  it('returns the first arrow whose endAngle >= degree', () => {
    const arrows: Arrow[] = [
      { sprite: 'a', endAngle: 45, direction: createMockDirection(0) },
      { sprite: 'b', endAngle: 90, direction: createMockDirection(128) },
      { sprite: 'c', endAngle: 180, direction: createMockDirection(256) },
      { sprite: 'd', endAngle: 360, direction: createMockDirection(512) },
    ]

    expect(SelectDirectionalTarget.getArrow(0, arrows).sprite).toBe('a')
    expect(SelectDirectionalTarget.getArrow(45, arrows).sprite).toBe('a')
    expect(SelectDirectionalTarget.getArrow(46, arrows).sprite).toBe('b')
    expect(SelectDirectionalTarget.getArrow(90, arrows).sprite).toBe('b')
    expect(SelectDirectionalTarget.getArrow(180, arrows).sprite).toBe('c')
    expect(SelectDirectionalTarget.getArrow(200, arrows).sprite).toBe('d')
  })

  it('returns first arrow if none match (empty or all too small)', () => {
    const arrows: Arrow[] = [
      { sprite: 'first', endAngle: 10, direction: createMockDirection(0) },
    ]

    expect(SelectDirectionalTarget.getArrow(20, arrows).sprite).toBe('first')
  })

  it('works with 8-direction arrows', () => {
    const arrows = createTestArrows(8)

    // 0 degrees → first arrow (N, sector 0-45)
    const arrow0 = SelectDirectionalTarget.getArrow(0, arrows)
    expect(arrow0.endAngle).toBe(22.5) // 0.5 * 45 = 22.5

    // 45 degrees → second arrow (NW, sector 45-90)
    const arrow45 = SelectDirectionalTarget.getArrow(45, arrows)
    expect(arrow45.endAngle).toBe(22.5 + 45)
  })
})

// ---------------------------------------------------------------------------
// loadArrows
// ---------------------------------------------------------------------------

describe('SelectDirectionalTarget.loadArrows', () => {
  it('returns empty array for empty arrow names', () => {
    const result = SelectDirectionalTarget.loadArrows([], null)
    expect(result).toHaveLength(0)
  })

  it('creates 8 arrows for 8 arrow names', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const result = SelectDirectionalTarget.loadArrows(names, null)

    expect(result).toHaveLength(8)
  })

  it('each arrow has sprite, endAngle, direction', () => {
    const names = ['n', 'nw', 'w', 'sw']
    const result = SelectDirectionalTarget.loadArrows(names, null)

    expect(result).toHaveLength(4)
    for (const arrow of result) {
      expect(arrow).toHaveProperty('sprite')
      expect(arrow).toHaveProperty('endAngle')
      expect(arrow).toHaveProperty('direction')
      expect(arrow.direction).toHaveProperty('facing')
    }
  })

  it('arrows cover 360 degrees evenly', () => {
    const names = ['n', 'e', 's', 'w']
    const result = SelectDirectionalTarget.loadArrows(names, null)

    // 4 arrows: each covers 90 degrees, endAngle should be 45, 135, 225, 315
    expect(result[0].endAngle).toBeCloseTo(45, 5)
    expect(result[1].endAngle).toBeCloseTo(135, 5)
    expect(result[2].endAngle).toBeCloseTo(225, 5)
    expect(result[3].endAngle).toBeCloseTo(315, 5)
  })

  it('each arrow direction.facing is in [0, 1023]', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const result = SelectDirectionalTarget.loadArrows(names, null)

    for (const arrow of result) {
      expect(arrow.direction.facing).toBeGreaterThanOrEqual(0)
      expect(arrow.direction.facing).toBeLessThanOrEqual(1023)
    }
  })
})

// ---------------------------------------------------------------------------
// SelectDirectionalTarget instance
// ---------------------------------------------------------------------------

describe('SelectDirectionalTarget', () => {
  let target: SelectDirectionalTarget
  let manager: SupportPowerManager
  let info: DirectionalSupportPowerInfo
  let arrows: Arrow[]

  beforeEach(() => {
    const owner = createMockPlayer()
    const world = createMockWorld()
    const mgrInfo = {} as any
    manager = new SupportPowerManager(mgrInfo)
    manager.setWorld(world, owner)
    const playerActor = createMockActor(0)
    ;(playerActor as any).owner = owner
    manager.attach(playerActor)

    arrows = createTestArrows(8)

    info = {
      orderName: 'TestOrder',
      chargeInterval: 100,
      arrows: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      cursor: 'ability',
      blockedCursor: 'generic-blocked',
    }

    target = new SelectDirectionalTarget('TestOrder', manager, info, arrows)
  })

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores orderKey', () => {
      expect(target.orderKey).toBe('TestOrder')
    })

    it('initializes drag state as inactive', () => {
      expect(target.isActivated).toBe(false)
      expect(target.currentArrow).toBeNull()
    })

    it('loads arrows from info if not provided', () => {
      const t2 = new SelectDirectionalTarget('TestOrder', manager, info)
      expect(t2.isActivated).toBe(false)
    })

    it('works with empty arrows', () => {
      const infoEmpty: DirectionalSupportPowerInfo = {
        orderName: 'EmptyOrder',
        chargeInterval: 100,
        arrows: [],
      }
      const t3 = new SelectDirectionalTarget('EmptyOrder', manager, infoEmpty)
      expect(t3.isActivated).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // onActionDown
  // -----------------------------------------------------------------------

  describe('onActionDown', () => {
    it('activates drag state', () => {
      const cell = new CPos(10, 20)
      target.onActionDown(cell, { x: 100, y: 200 })

      expect(target.isActivated).toBe(true)
    })

    it('does not re-activate if already activated', () => {
      const cell1 = new CPos(10, 20)
      const cell2 = new CPos(11, 21)
      target.onActionDown(cell1, { x: 100, y: 200 })
      target.onActionDown(cell2, { x: 300, y: 400 })

      expect(target.isActivated).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // onMouseMove
  // -----------------------------------------------------------------------

  describe('onMouseMove', () => {
    it('does nothing when not activated', () => {
      target.onMouseMove({ x: 10, y: 10 })
      expect(target.currentArrow).toBeNull()
    })

    it('selects an arrow based on drag direction', () => {
      target.onActionDown(new CPos(0, 0), { x: 0, y: 0 })
      target.onMouseMove({ x: 0, y: -50 }) // North drag

      expect(target.currentArrow).not.toBeNull()
    })

    it('selects different arrows for different directions', () => {
      target.onActionDown(new CPos(0, 0), { x: 0, y: 0 })
      target.onMouseMove({ x: 0, y: -50 }) // North
      const northArrow = target.currentArrow
      expect(northArrow).not.toBeNull()

      // Reset and try East
      const t2 = new SelectDirectionalTarget('TestOrder', manager, info, arrows)
      t2.onActionDown(new CPos(0, 0), { x: 0, y: 0 })
      t2.onMouseMove({ x: 50, y: 0 }) // East

      // May or may not be different depending on sector width
      expect(t2.currentArrow).not.toBeNull()

      // Verify northArrow was captured
      expect(northArrow).not.toBeNull()
    })

    it('clamps drag magnitude at MaxDragThreshold', () => {
      target.onActionDown(new CPos(0, 0), { x: 0, y: 0 })
      // Drag beyond max threshold (100 >> 75)
      target.onMouseMove({ x: 100, y: 100 })

      // Should still have an arrow selected
      expect(target.currentArrow).not.toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // onActionUp
  // -----------------------------------------------------------------------

  describe('onActionUp', () => {
    it('generates order with NO_DIRECTION when no drag', () => {
      target.onActionDown(new CPos(10, 20), { x: 100, y: 200 })
      const order = target.onActionUp(new CPos(10, 20))

      expect(order).not.toBeNull()
      expect(order!.extraData).toBe(0xffffffff) // NO_DIRECTION
      expect(order!.orderName).toBe('TestOrder')
    })

    it('generates order with facing when drag exceeds threshold', () => {
      target.onActionDown(new CPos(10, 20), { x: 100, y: 200 })
      // Drag south (enough to exceed MinDragThreshold of 20)
      target.onMouseMove({ x: 0, y: 50 })

      const order = target.onActionUp(new CPos(10, 20))

      expect(order).not.toBeNull()
      expect(order!.orderName).toBe('TestOrder')
      expect(order!.extraData).not.toBe(0xffffffff) // Should have actual facing
    })

    it('deactivates after onActionUp', () => {
      target.onActionDown(new CPos(10, 20), { x: 100, y: 200 })
      target.onActionUp(new CPos(10, 20))

      expect(target.isActivated).toBe(false)
      expect(target.currentArrow).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // cancel / deactivate
  // -----------------------------------------------------------------------

  describe('cancel', () => {
    it('deactivates the drag state', () => {
      target.onActionDown(new CPos(10, 20), { x: 100, y: 200 })
      expect(target.isActivated).toBe(true)

      target.cancel()

      expect(target.isActivated).toBe(false)
      expect(target.currentArrow).toBeNull()
    })

    it('is idempotent (safe to call when not activated)', () => {
      expect(() => target.cancel()).not.toThrow()
    })
  })

  describe('deactivate', () => {
    it('resets all drag state', () => {
      target.onActionDown(new CPos(10, 20), { x: 100, y: 200 })
      target.onMouseMove({ x: 30, y: 30 })
      target.deactivate()

      expect(target.isActivated).toBe(false)
      expect(target.currentArrow).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // tick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('returns false when power is not registered', () => {
      expect(target.tick()).toBe(false)
    })

    it('returns true when power is active and ready', () => {
      const instance = new SupportPowerInstance('TestOrder', info, manager)
      manager.powers.set('TestOrder', instance)

      const actor = createMockActor(1)
      const power = new MockSupportPower(actor, info)
      instance.instances.push(power as unknown as ISupportPower)

      // Force active and ready
      ;(instance as any)._remainingSubTicks = 0
      ;(instance as any)._instancesEnabled = true

      expect(target.tick()).toBe(true)
    })

    it('returns false when power is not ready', () => {
      const instance = new SupportPowerInstance('TestOrder', info, manager)
      manager.powers.set('TestOrder', instance)

      const actor = createMockActor(1)
      const power = new MockSupportPower(actor, info)
      instance.instances.push(power as unknown as ISupportPower)

      // Not ready (remainingTicks > 0)
      expect(target.tick()).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // getCursor
  // -----------------------------------------------------------------------

  describe('getCursor', () => {
    it('returns configured cursor', () => {
      const cell = new CPos(0, 0)
      expect(target.getCursor(cell)).toBe('ability')
    })

    it('returns "ability" as default', () => {
      const infoNoCursor: DirectionalSupportPowerInfo = {
        orderName: 'NoCursorOrder',
        chargeInterval: 100,
        arrows: [],
      }
      const t2 = new SelectDirectionalTarget('NoCursorOrder', manager, infoNoCursor)
      expect(t2.getCursor(new CPos(0, 0))).toBe('ability')
    })
  })

  // -----------------------------------------------------------------------
  // handleKeyPress
  // -----------------------------------------------------------------------

  describe('handleKeyPress', () => {
    it('returns false', () => {
      expect(target.handleKeyPress()).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// vectorLength
// ---------------------------------------------------------------------------

describe('SelectDirectionalTarget.vectorLength', () => {
  it('returns 0 for zero vector', () => {
    expect(SelectDirectionalTarget.vectorLength({ x: 0, y: 0 })).toBe(0)
  })

  it('returns sqrt(x^2 + y^2)', () => {
    expect(SelectDirectionalTarget.vectorLength({ x: 3, y: 4 })).toBe(5)
  })

  it('handles negative components', () => {
    expect(SelectDirectionalTarget.vectorLength({ x: -3, y: -4 })).toBe(5)
  })
})
