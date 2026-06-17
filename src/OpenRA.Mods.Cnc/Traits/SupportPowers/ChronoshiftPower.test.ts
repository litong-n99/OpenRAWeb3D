/**
 * ChronoshiftPower.test.ts — ChronoshiftPower migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, target validation logic, footprint parsing,
 * unit collection, terrain matching, and OrderGenerator selection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import { CVec } from '../../../OpenRA.Game/CVec.js'
import {
  ChronoshiftPower,
  SelectChronoshiftTarget,
  SelectDestination,
  createChronoshiftPowerInfo,
  type ChronoshiftPowerInfo,
  type IChronoshiftableStub,
} from './ChronoshiftPower.js'

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

function mkCPos(x: number, y: number): CPos {
  return new CPos(x, y)
}

function mkCVec(x: number, y: number): CVec {
  return new CVec(x, y)
}

function mkInfo(overrides: Partial<ChronoshiftPowerInfo> = {}): ChronoshiftPowerInfo {
  return createChronoshiftPowerInfo({
    dimensions: mkCVec(3, 3),
    footprint: ' x ' +
              'xxx' +
              ' x ',
    ...overrides,
  })
}

function mkManager(): any {
  return {
    self: mkGameActor(1, 'chronosphere', mkCPos(5, 5)),
    powers: new Map(),
  }
}

function mkGameActor(id: number, name = 'test', location: CPos = mkCPos(10, 10)): any {
  const traits: any[] = []
  return {
    actorId: id,
    info: { name },
    location,
    owner: {
      playerName: 'testPlayer',
      shroud: {
        isExplored(_c: CPos): boolean { return true },
      },
      isAlliedWith(_other: any): boolean { return false },
    },
    world: null as any,
    traitsImplementing(name: string): any[] {
      if (name === 'Chronoshiftable') return traits
      if (name === 'ISelectionDecorations') return []
      return []
    },
    getTrait(_name: string): any { return undefined },
    canBeViewedByPlayer(_p: any): boolean { return true },
    render(_wr: any): any[] { return [] },
    grantCondition(_c: string): number { return 1 },
    revokeCondition(_token: number): number { return -1 },
  }
}

function mkChronoshiftableStub(disabled = false): IChronoshiftableStub {
  return {
    isTraitDisabled: disabled,
    canChronoshiftTo(_target: any, _targetCell: CPos): boolean { return true },
    teleport(_target: any, _targetCell: CPos, _duration: number, _killCargo: boolean, _chronosphere: any): void {},
  }
}

function mkExtendedWorld(): any {
  return {
    map: {
      cellContaining(_pos: any): CPos { return mkCPos(8, 8) },
      centerOfCell(c: CPos) { return { X: c.X * 1024, Y: c.Y * 1024, Z: 0 } },
      getTerrainIndex(_c: CPos): number { return 5 },
      sequences: {
        getSequence(_img: string, _seq: string): any {
          return {
            getSprite(_f: number): any {
              return { sheet: {}, bounds: {}, channel: 3, blendMode: 'Alpha' }
            },
            getAlpha(_f: number): number { return 1 },
            scale: 1,
            ignoreWorldTint: false,
          }
        },
        hasSequence(_img: string, _seq: string): boolean { return false },
      },
    },
    actorMap: {
      getActorsAt(_c: CPos): any[] { return [] },
    },
    setOrderGenerator(_og: unknown): void {},
    cancelInputMode(): void {},
  }
}

// ---------------------------------------------------------------------------
// ChronoshiftPowerInfo tests
// ---------------------------------------------------------------------------

describe('ChronoshiftPowerInfo', () => {
  it('constructs with required fields: Dimensions and Footprint', () => {
    const info = createChronoshiftPowerInfo({
      dimensions: mkCVec(3, 3),
      footprint: 'xxx',
    })
    expect(info.dimensions).toEqual(mkCVec(3, 3))
    expect(info.footprint).toBe('xxx')
  })

  it('applies default values for optional fields', () => {
    const info = createChronoshiftPowerInfo({
      dimensions: mkCVec(2, 2),
      footprint: 'xx',
    })
    expect(info.duration).toBe(750)
    expect(info.targetOverlayPalette).toBe('terrain')
    expect(info.footprintImage).toBe('overlay')
    expect(info.validFootprintSequence).toBe('target-valid')
    expect(info.invalidFootprintSequence).toBe('target-invalid')
    expect(info.sourceFootprintSequence).toBe('target-select')
    expect(info.killCargo).toBe(true)
    expect(info.selectionCursor).toBe('chrono-select')
    expect(info.targetCursor).toBe('chrono-target')
    expect(info.targetBlockedCursor).toBe('move-blocked')
  })

  it('allows overriding defaults', () => {
    const info = createChronoshiftPowerInfo({
      dimensions: mkCVec(1, 1),
      footprint: 'x',
      duration: 500,
      selectionCursor: 'custom-cursor',
      killCargo: false,
    })
    expect(info.duration).toBe(500)
    expect(info.selectionCursor).toBe('custom-cursor')
    expect(info.killCargo).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ChronoshiftPower tests
// ---------------------------------------------------------------------------

describe('ChronoshiftPower', () => {
  let power: ChronoshiftPower
  let self: any
  let info: ChronoshiftPowerInfo

  beforeEach(() => {
    info = mkInfo()
    self = mkGameActor(1, 'chronosphere', mkCPos(10, 10))
    // Wire up the world
    self.world = mkExtendedWorld()
    power = new ChronoshiftPower(self, info)
  })

  it('parses footprint removing whitespace', () => {
    const pattern = power.footprintPattern
    // ' x ' + 'xxx' + ' x ' = ['x', 'x', 'x', 'x', 'x']
    expect(pattern).toEqual(['x', 'x', 'x', 'x', 'x'])
  })

  it('exposes dimensions', () => {
    expect(power.dimensions).toEqual(mkCVec(3, 3))
  })

  describe('unitsInRange', () => {
    it('returns empty array when no actors have Chronoshiftable', () => {
      const result = power.unitsInRange(mkCPos(5, 5))
      expect(result).toEqual([])
    })

    it('returns actors with enabled Chronoshiftable', () => {
      const worldWithActors = mkExtendedWorld()
      const sharedActor = mkGameActor(99, 'rifle', mkCPos(5, 5))
      sharedActor.traitsImplementing = () => [mkChronoshiftableStub(false)]
      worldWithActors.actorMap.getActorsAt = () => [sharedActor]
      self.world = worldWithActors

      const result = power.unitsInRange(mkCPos(5, 5))
      // Footprint has 5 'x' cells, but Set deduplicates the same actor
      expect(result.length).toBe(1)
    })

    it('filters out disabled Chronoshiftable traits', () => {
      const worldWithActors = mkExtendedWorld()
      worldWithActors.actorMap.getActorsAt = () => {
        const actor = mkGameActor(99, 'rifle', mkCPos(5, 5))
        actor.traitsImplementing = () => [mkChronoshiftableStub(true)]
        return [actor]
      }
      self.world = worldWithActors

      const result = power.unitsInRange(mkCPos(5, 5))
      expect(result.length).toBe(0)
    })
  })

  describe('similarTerrain', () => {
    it('returns false when destination is unexplored', () => {
      const owner = self.owner
      owner.shroud.isExplored = (c: CPos) => c.X !== 8
      const result = power.similarTerrain(mkCPos(8, 8), mkCPos(5, 5))
      expect(result).toBe(false)
    })

    it('returns true when all paired cells match terrain and are explored', () => {
      self.owner.shroud.isExplored = () => true
      self.world.map.getTerrainIndex = () => 5
      const result = power.similarTerrain(mkCPos(5, 5), mkCPos(8, 8))
      expect(result).toBe(true)
    })

    it('returns false when terrain differs', () => {
      self.owner.shroud.isExplored = () => true
      let callCount = 0
      self.world.map.getTerrainIndex = () => {
        callCount++
        return callCount <= 3 ? 5 : 10
      }
      const result = power.similarTerrain(mkCPos(5, 5), mkCPos(8, 8))
      expect(result).toBe(false)
    })

    it('returns false when source tiles are empty', () => {
      const short = new ChronoshiftPower(self, createChronoshiftPowerInfo({
        dimensions: mkCVec(0, 0),
        footprint: '',
      }))
      const result = short.similarTerrain(mkCPos(5, 5), mkCPos(8, 8))
      expect(result).toBe(false)
    })
  })

  describe('activate', () => {
    it('teleports units in range with chronoshiftable', () => {
      const teleportSpy = vi.fn()
      const cs = mkChronoshiftableStub(false)
      cs.teleport = teleportSpy

      self.owner.shroud = { isExplored: () => true }

      const world = mkExtendedWorld()
      world.map.cellContaining = () => mkCPos(8, 8)
      const sharedActor = mkGameActor(99, 'rifle', mkCPos(5, 5))
      sharedActor.traitsImplementing = () => [cs]
      world.actorMap.getActorsAt = () => [sharedActor]
      self.world = world

      const order: any = {
        orderName: 'ChronoshiftPowerOrder',
        target: {
          centerPosition: { X: 8192, Y: 8192, Z: 0 },
          cell: mkCPos(8, 8),
        },
        extraLocation: mkCPos(5, 5),
      }

      power.activate(self, order, mkManager())

      // Footprint has 5 tiles, Set deduplicates to 1 actor, teleport called once
      expect(teleportSpy).toHaveBeenCalledTimes(1)
      const call = teleportSpy.mock.calls[0]
      // targetCell = unit.location(5,5) + delta(3,3) = (8,8) = sourceLocation(5,5)→targetCell(8,8)
      // delta = targetCell - sourceLocation = (8-5, 8-5) = (3,3)
      // unit.location = (5,5), so new dest = (5+3, 5+3) = (8,8)
      expect(call[1].X).toBe(8)
      expect(call[1].Y).toBe(8)
      expect(call[2]).toBe(750) // duration
      expect(call[3]).toBe(true) // killCargo
    })

    it('skips units without chronoshiftable', () => {
      const world = mkExtendedWorld()
      world.actorMap.getActorsAt = () => {
        const actor = mkGameActor(99, 'rifle', mkCPos(5, 5))
        actor.traitsImplementing = () => []
        return [actor]
      }
      self.world = world

      const order: any = {
        orderName: 'ChronoshiftPowerOrder',
        target: {
          centerPosition: { X: 8192, Y: 8192, Z: 0 },
          cell: mkCPos(8, 8),
        },
        extraLocation: mkCPos(5, 5),
      }

      // Should not throw
      expect(() => power.activate(self, order, mkManager())).not.toThrow()
    })

    it('skips units when canChronoshiftTo returns false', () => {
      const teleportSpy = vi.fn()
      const cs = mkChronoshiftableStub(false)
      cs.canChronoshiftTo = () => false
      cs.teleport = teleportSpy

      self.owner.shroud.isExplored = () => true

      const world = mkExtendedWorld()
      world.actorMap.getActorsAt = () => {
        const actor = mkGameActor(99, 'rifle', mkCPos(5, 5))
        actor.traitsImplementing = () => [cs]
        return [actor]
      }
      self.world = world

      const order: any = {
        orderName: 'ChronoshiftPowerOrder',
        target: {
          centerPosition: { X: 8192, Y: 8192, Z: 0 },
          cell: mkCPos(8, 8),
        },
        extraLocation: mkCPos(5, 5),
      }

      power.activate(self, order, mkManager())
      expect(teleportSpy).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// SelectChronoshiftTarget tests
// ---------------------------------------------------------------------------

describe('SelectChronoshiftTarget', () => {
  let target: SelectChronoshiftTarget
  let world: any
  let manager: any
  let power: ChronoshiftPower
  let info: ChronoshiftPowerInfo

  beforeEach(() => {
    info = mkInfo()
    const self = mkGameActor(1, 'chronosphere', mkCPos(10, 10))
    power = new ChronoshiftPower(self, info)
    world = mkExtendedWorld()
    manager = mkManager()
    target = new SelectChronoshiftTarget(world, 'ChronoshiftPowerOrder', manager, power)
  })

  it('has correct key', () => {
    expect(target.orderGeneratorKey).toBe('SelectChronoshiftTarget')
  })

  it('getCursor returns SelectionCursor from info', () => {
    const cursor = target.getCursor()
    expect(cursor).toBe('chrono-select')
  })

  it('orderInner transitions to SelectDestination', () => {
    let nextOg: unknown = null
    world.setOrderGenerator = (og: unknown) => { nextOg = og }
    world.cancelInputMode = vi.fn()

    const gen = target.orderInner(mkCPos(5, 5))
    const result = gen.next()
    expect(result.done).toBe(true)
    expect(nextOg).toBeInstanceOf(SelectDestination)
  })

  it('tick cancels input mode when power not active', () => {
    const cancelSpy = vi.fn()
    world.cancelInputMode = cancelSpy

    target.tick()
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('tick does not cancel when power is active and ready', () => {
    const cancelSpy = vi.fn()
    world.cancelInputMode = cancelSpy
    manager.powers.set('ChronoshiftPowerOrder', {
      active: true,
      ready: true,
    })

    target.tick()
    expect(cancelSpy).not.toHaveBeenCalled()
  })

  it('renderAboveShroud yields nothing', () => {
    const gen = target.renderAboveShroud()
    const result = gen.next()
    expect(result.done).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SelectDestination tests
// ---------------------------------------------------------------------------

describe('SelectDestination', () => {
  let dest: SelectDestination
  let world: any
  let manager: any
  let power: ChronoshiftPower
  let info: ChronoshiftPowerInfo

  beforeEach(() => {
    info = mkInfo()
    const self = mkGameActor(1, 'chronosphere', mkCPos(10, 10))
    self.world = mkExtendedWorld()
    power = new ChronoshiftPower(self, info)
    world = mkExtendedWorld()
    manager = mkManager()
    dest = new SelectDestination(world, 'ChronoshiftPowerOrder', manager, power, mkCPos(5, 5))
  })

  it('has correct key', () => {
    expect(dest.orderGeneratorKey).toBe('SelectDestination')
  })

  it('getCursor returns TargetBlockedCursor for invalid target (no units)', () => {
    const cursor = dest.getCursor(mkCPos(5, 5))
    expect(cursor).toBe('move-blocked')
  })

  it('getCursor returns TargetCursor when units with Chronoshiftable are in range', () => {
    const self2 = mkGameActor(1, 'chronosphere', mkCPos(10, 10))
    self2.traitsImplementing = (name: string) => {
      if (name === 'Chronoshiftable') return [mkChronoshiftableStub(false)]
      return []
    }

    const world2 = mkExtendedWorld()
    world2.actorMap.getActorsAt = () => [self2]
    self2.world = world2

    const power2 = new ChronoshiftPower(self2, info)
    const mgr2 = mkManager()
    mgr2.self = self2

    const dest2 = new SelectDestination(world2, 'order', mgr2, power2, mkCPos(5, 5))
    const cursor = dest2.getCursor(mkCPos(5, 5))
    expect(cursor).toBe('chrono-target')
  })

  it('orderInner produces order when valid', () => {
    const self2 = mkGameActor(1, 'chronosphere', mkCPos(10, 10))
    self2.traitsImplementing = (name: string) => {
      if (name === 'Chronoshiftable') return [mkChronoshiftableStub(false)]
      return []
    }

    const world2 = mkExtendedWorld()
    world2.actorMap.getActorsAt = () => [self2]
    self2.world = world2

    const power2 = new ChronoshiftPower(self2, info)
    const mgr2 = mkManager()
    mgr2.self = self2

    const dest2 = new SelectDestination(world2, 'order', mgr2, power2, mkCPos(5, 5))
    const gen = dest2.orderInner(mkCPos(5, 5))
    const result = gen.next()

    expect(result.done).toBe(false)
    expect(result.value).toBeDefined()
    expect(result.value.extraLocation).toEqual(mkCPos(5, 5))
    expect(result.value.suppressVisualFeedback).toBe(true)
  })

  it('orderInner yields null when invalid (no units in range)', () => {
    const gen = dest.orderInner(mkCPos(99, 99))
    const result = gen.next()
    expect(result.done).toBe(true)
    expect(result.value).toBeUndefined()
  })

  it('tick cancels when power not active', () => {
    const cancelSpy = vi.fn()
    world.cancelInputMode = cancelSpy
    dest.tick()
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('tick does not cancel when power is active and ready', () => {
    const cancelSpy = vi.fn()
    world.cancelInputMode = cancelSpy
    manager.powers.set('ChronoshiftPowerOrder', {
      active: true,
      ready: true,
    })
    dest.tick()
    expect(cancelSpy).not.toHaveBeenCalled()
  })
})
