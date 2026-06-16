/**
 * LayMines.test.ts — LayMines 活动单元测试
 *
 * 测试重点:
 * - 默认雷区设置 (onFirstRun)
 * - 布雷放置 (扣除弹药, 创建地雷 actor)
 * - 布雷前延迟 (preLayDelay)
 * - 布雷后延迟 (afterLayingDelay)
 * - 移动到下一个布雷单元格
 * - 弹药耗尽时的重新装弹循环
 * - 取消布雷通知
 * - CleanMineField 清理
 * - CanLayMine 静态检查
 * - 目标线渲染
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock EconomicActivityInterfaces
// ---------------------------------------------------------------------------

vi.mock('./EconomicActivityInterfaces.js', () => {
  class LocationInit {
    location: unknown
    constructor(location: unknown) { this.location = location }
  }
  class OwnerInit {
    owner: unknown
    constructor(owner: unknown) { this.owner = owner }
  }
  class ParentActorInit {
    parent: unknown
    constructor(parent: unknown) { this.parent = parent }
  }
  return {
    FloatingText: class {
      static formatCashTick(amount: number): string {
        return `+$${amount}`
      }
      constructor() {
        // stub
      }
    },
    TextNotificationsManager: {
      addTransientLine: vi.fn(),
    },
    LocationInit,
    OwnerInit,
    ParentActorInit,
  }
})

// ---------------------------------------------------------------------------
// Mock Resupply (to avoid full Resupply dependency chain)
// ---------------------------------------------------------------------------

vi.mock('./Resupply.js', async () => {
  const { Activity } = await import('../../OpenRA.Game/Activities/Activity.js')
  return {
    Resupply: class extends Activity {
      constructor() {
        super()
      }
      override tick(): boolean {
        return true
      }
    },
  }
})

// ---------------------------------------------------------------------------
// Mock MoveAdjacentTo
// ---------------------------------------------------------------------------

vi.mock('./Move/MoveAdjacentTo.js', async () => {
  const { Activity } = await import('../../OpenRA.Game/Activities/Activity.js')
  return {
    MoveAdjacentTo: class extends Activity {
      constructor() {
        super()
      }
      override tick(): boolean {
        return true
      }
      override queue(): void {
        // stub: avoid walking uninitialized base-class chain in mocks
      }
    },
  }
})

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import { LayMines } from './LayMines.js'
import { CPos } from '../../OpenRA.Game/CPos.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { ActivityState } from '../../OpenRA.Game/Activities/Activity.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createMockActor(options: {
  location?: CPos
  hp?: number
  maxHP?: number
  ammoCount?: number
  ammoPoolName?: string
  ammoUsage?: number
  preLayDelay?: number
  afterLayingDelay?: number
  mineType?: string
  hasRearmable?: boolean
  rearmActors?: string[]
  traits?: Map<string, unknown>
  actorsAtCell?: Map<string, MockActor[]>
} = {}): MockActor {
  const {
    location = new CPos(5, 5),
    hp = 100,
    maxHP = 100,
    ammoCount = 5,
    ammoPoolName = 'mines',
    ammoUsage = 1,
    preLayDelay = 0,
    afterLayingDelay = 0,
    mineType = 'mine',
    hasRearmable = true,
    rearmActors = ['ServiceDepot'],
    traits = new Map(),
    actorsAtCell = new Map(),
  } = options

  const frameEndActions: (() => void)[] = []
  const createdActors: unknown[] = []

  const mockPlayer = {
    playerName: 'TestPlayer',
    relationshipWith: vi.fn(() => 4), // Ally = 4
    color: { r: 1, g: 0, b: 0, a: 1 },
    shroud: { isVisible: vi.fn(() => true) },
  }

  const mockWorld = {
    renderPlayer: mockPlayer,
    queueFrameEndAction: vi.fn((action: () => void) => {
      frameEndActions.push(action)
    }),
    createActor: vi.fn((name: string, _inits: unknown[]) => {
      const actor = { actorId: createdActors.length + 100, name }
      createdActors.push(actor)
      return actor
    }),
    actors: [] as MockActor[],
    actorMap: {
      getActorsAt: vi.fn((cell: CPos) => {
        const key = `${cell.X},${cell.Y}`
        return actorsAtCell.get(key) ?? []
      }),
    },
    map: {
      cellContaining: vi.fn((pos: WPos) => new CPos(Math.floor(pos.X / 1024), Math.floor(pos.Y / 1024))),
    },
    sharedRandom: { next: vi.fn(() => 0.5) },
  }

  // Add default traits
  traits.set('IHealth', {
    hp,
    maxHP,
    damageState: 1,
    isDead: false,
    inflictDamage: vi.fn(),
    kill: vi.fn(),
    displayHP: hp,
  })

  traits.set('Mobile', {
    moveTo: vi.fn(() => {
      return { tick: () => true, queue: () => {}, queueChild: () => {}, state: 0 } as unknown as import('../../OpenRA.Game/Activities/Activity.js').Activity
    }),
    moveToTarget: vi.fn(() => {
      return { tick: () => true, queue: () => {}, queueChild: () => {}, state: 0 } as unknown as import('../../OpenRA.Game/Activities/Activity.js').Activity
    }),
    moveWithinRange: vi.fn(() => {
      return { tick: () => true, queue: () => {}, queueChild: () => {}, state: 0 } as unknown as import('../../OpenRA.Game/Activities/Activity.js').Activity
    }),
    nearestMoveableCell: vi.fn(() => location),
    canStayInCell: vi.fn(() => true),
    canEnterCell: vi.fn(() => true),
    pathFinder: {
      findPathToTargetCells: vi.fn(() => []),
    },
    moveResult: 0,
    info: {
      getTargetLineColor: vi.fn(() => ({ r: 0, g: 1, b: 0, a: 1 })),
    },
  })

  traits.set('AmmoPool', {
    name: ammoPoolName,
    currentAmmoCount: ammoCount,
    takeAmmo: vi.fn(() => true),
  })

  traits.set('Minelayer', {
    info: {
      mine: mineType,
      ammoPoolName,
      ammoUsage,
      preLayDelay,
      afterLayingDelay,
      targetLineColor: { r: 1, g: 0, b: 0, a: 1 },
      tile: null,
    },
  })

  if (hasRearmable) {
    traits.set('Rearmable', {
      info: {
        rearmActors,
      },
      rearmTick: vi.fn(() => false),
      rearmableAmmoPools: [{ hasFullAmmo: false }],
    })
  }

  const actor: MockActor = {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    owner: mockPlayer,
    world: mockWorld,
    location,
    centerPosition: new WPos(location.X * 1024, location.Y * 1024, 0),
    info: {
      name: 'Minelayer',
      rearmable: hasRearmable ? { rearmActors } : undefined,
    },
    traits,
    getComponent: vi.fn((name: string) => traits.get(name)),
    getComponents: vi.fn((name: string) => {
      const t = traits.get(name)
      return t ? [t] : []
    }),
    // Test helpers
    _frameEndActions: frameEndActions,
    _createdActors: createdActors,
    _mockWorld: mockWorld,
    _mockPlayer: mockPlayer,
  }

  return actor
}

interface MockActor {
  actorId: number
  isInWorld: boolean
  isDead: boolean
  disposed: boolean
  owner: unknown
  world: unknown
  location: CPos
  centerPosition: WPos
  info: { name: string; rearmable?: { rearmActors: string[] } }
  traits: Map<string, unknown>
  getComponent: ReturnType<typeof vi.fn>
  getComponents: ReturnType<typeof vi.fn>
  // Test helpers
  _frameEndActions: (() => void)[]
  _createdActors: unknown[]
  _mockWorld: unknown
  _mockPlayer: unknown
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LayMines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('stores minefield parameter', () => {
      const actor = createMockActor()
      const minefield = [new CPos(5, 5), new CPos(6, 5)]
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, minefield);
      expect(layMines.minefield).toEqual(minefield);
    })

    it('accepts null minefield', () => {
      const actor = createMockActor()
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, null);
      expect(layMines.minefield).toBeNull();
    })
  })

  // ---------------------------------------------------------------------------
  // OnFirstRun
  // ---------------------------------------------------------------------------

  describe('onFirstRun', () => {
    it('defaults minefield to actor location when null', () => {
      const actor = createMockActor({ location: new CPos(3, 4) })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, null);
      // Simulate tickOuter calling onFirstRun
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);

      expect(layMines.minefield).toEqual([new CPos(3, 4)])
    })

    it('preserves provided minefield', () => {
      const actor = createMockActor({ location: new CPos(3, 4) })
      const minefield = [new CPos(10, 10)]
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, minefield);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);

      expect(layMines.minefield).toEqual(minefield)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick - basic laying
  // ---------------------------------------------------------------------------

  describe('tick - basic laying', () => {
    it('lays mine immediately when preLayDelay is 0', () => {
      const actor = createMockActor({ location: new CPos(5, 5), preLayDelay: 0 })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      // First run to set minefield
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      // Should return false (not done yet, may queue Wait)
      expect(result).toBe(false)
      // Frame end action should be queued for mine creation
      expect(actor._frameEndActions.length).toBeGreaterThan(0)
    })

    it('queues Wait when preLayDelay > 0', () => {
      const actor = createMockActor({ location: new CPos(5, 5), preLayDelay: 5 })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(false)
      expect(layMines.layingMine).toBe(true)
      // Should have queued a child Wait activity
      expect(layMines.childActivity).not.toBeNull()
    })

    it('queues Wait for afterLayingDelay when > 0', () => {
      const actor = createMockActor({ location: new CPos(5, 5), preLayDelay: 0, afterLayingDelay: 3 })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      // After laying with afterLayingDelay > 0, a Wait should be queued
      expect(layMines.childActivity).not.toBeNull()
    })

    it('deducts ammo when laying mine', () => {
      const actor = createMockActor({ location: new CPos(5, 5), ammoCount: 5, ammoUsage: 1 })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      const ammoPool = actor.traits.get('AmmoPool') as { takeAmmo: ReturnType<typeof vi.fn> }
      expect(ammoPool.takeAmmo).toHaveBeenCalledWith(
        actor,
        1, // ammoUsage
      )
    })

    it('creates mine actor via frame end action', () => {
      const actor = createMockActor({ location: new CPos(5, 5), preLayDelay: 0 })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      // Execute frame end actions
      for (const action of actor._frameEndActions) {
        action()
      }

      const mockWorld = actor._mockWorld as { createActor: ReturnType<typeof vi.fn> }
      expect(mockWorld.createActor).toHaveBeenCalledTimes(1)
      expect(mockWorld.createActor).toHaveBeenCalledWith(
        'mine',
        expect.arrayContaining([
          expect.objectContaining({ location: new CPos(5, 5) }),
        ]),
      )
    })

    it('removes current cell from minefield after laying', () => {
      const actor = createMockActor({ location: new CPos(5, 5), preLayDelay: 0 })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5), new CPos(6, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      // Execute frame end actions to complete the lay
      for (const action of actor._frameEndActions) {
        action()
      }

      // Current cell should be removed from minefield
      expect(layMines.minefield).not.toContainEqual(new CPos(5, 5))
    })
  })

  // ---------------------------------------------------------------------------
  // Tick - movement to next cell
  // ---------------------------------------------------------------------------

  describe('tick - movement to next cell', () => {
    it('queues Move to next valid cell when not at minefield cell', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(10, 10)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(false)
      const mobile = actor.traits.get('Mobile') as { moveTo: ReturnType<typeof vi.fn> }
      expect(mobile.moveTo).toHaveBeenCalled()
    })

    it('returns true when no valid cells remain', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      // Cell is occupied by another actor, so can't lay
      const otherActor = createMockActor({ location: new CPos(10, 10) })
      const actorsAtCell = new Map<string, MockActor[]>()
      actorsAtCell.set('10,10', [otherActor])

      ;(actor._mockWorld as { actorMap: { getActorsAt: ReturnType<typeof vi.fn> } }).actorMap.getActorsAt = vi.fn((cell: CPos) => {
        const key = `${cell.X},${cell.Y}`
        return actorsAtCell.get(key) ?? []
      })

      const layMines = new LayMines(
        actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor,
        [new CPos(10, 10)],
      );

      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick - rearm cycle
  // ---------------------------------------------------------------------------

  describe('tick - rearm cycle', () => {
    it('returns true when out of ammo and no rearm building found', () => {
      const actor = createMockActor({ location: new CPos(5, 5), ammoCount: 0, hasRearmable: true })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(true)
    })

    it('queues rearm activities when out of ammo and rearm building exists', () => {
      const actor = createMockActor({ location: new CPos(5, 5), ammoCount: 0, hasRearmable: true, rearmActors: ['ServiceDepot'] })
      // Add a service depot to the world
      const depot = createMockActor({ location: new CPos(1, 1) })
      depot.info = { name: 'ServiceDepot' }
      depot.centerPosition = new WPos(1 * 1024, 1 * 1024, 0)
      depot.owner = actor.owner
      ;(actor._mockWorld as { actors: MockActor[] }).actors = [depot]

      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(false)
      expect(layMines.returnToBase).toBe(true)
      expect(layMines.rearmTarget).not.toBeNull()
    })

    it('returns true when out of ammo and no rearmable info', () => {
      const actor = createMockActor({ location: new CPos(5, 5), ammoCount: 0, hasRearmable: false })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  describe('cancel', () => {
    it('notifies INotifyMineLaying when canceling during lay', () => {
      const mineLayingCanceledSpy = vi.fn()
      const actor = createMockActor({ location: new CPos(5, 5), preLayDelay: 5 })
      actor.traits.set('NotifyMineLaying', {
        mineLaying: vi.fn(),
        mineLayingCanceled: mineLayingCanceledSpy,
        mineLaid: vi.fn(),
      })

      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor) // Sets layingMine = true
      expect(layMines.layingMine).toBe(true)
      layMines.state = ActivityState.Active

      layMines.cancel(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(true)
      expect(mineLayingCanceledSpy).toHaveBeenCalledTimes(1)
    })

    it('returns true immediately when canceling without layingMine', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      layMines.state = ActivityState.Active
      layMines.cancel(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(result).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // CanLayMine static
  // ---------------------------------------------------------------------------

  describe('canLayMine static', () => {
    it('returns false when actor is dead', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      actor.isDead = true
      expect(LayMines.canLayMine(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, new CPos(5, 5))).toBe(false)
    })

    it('returns false when actor is not in world', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      actor.isInWorld = false
      expect(LayMines.canLayMine(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, new CPos(5, 5))).toBe(false)
    })

    it('returns true when cell is empty', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      expect(LayMines.canLayMine(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, new CPos(5, 5))).toBe(true)
    })

    it('returns true when only self is at cell', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const actorsAtCell = new Map<string, MockActor[]>()
      actorsAtCell.set('5,5', [actor])
      ;(actor._mockWorld as { actorMap: { getActorsAt: ReturnType<typeof vi.fn> } }).actorMap.getActorsAt = vi.fn((cell: CPos) => {
        const key = `${cell.X},${cell.Y}`
        return actorsAtCell.get(key) ?? []
      })
      expect(LayMines.canLayMine(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, new CPos(5, 5))).toBe(true)
    })

    it('returns false when other actors are at cell', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const otherActor = createMockActor({ location: new CPos(5, 5) })
      const actorsAtCell = new Map<string, MockActor[]>()
      actorsAtCell.set('5,5', [otherActor])
      ;(actor._mockWorld as { actorMap: { getActorsAt: ReturnType<typeof vi.fn> } }).actorMap.getActorsAt = vi.fn((cell: CPos) => {
        const key = `${cell.X},${cell.Y}`
        return actorsAtCell.get(key) ?? []
      })
      expect(LayMines.canLayMine(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, new CPos(5, 5))).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // CleanMineField
  // ---------------------------------------------------------------------------

  describe('cleanMineField', () => {
    it('removes cells with existing mines', () => {
      const actor = createMockActor({ location: new CPos(5, 5), mineType: 'mine' })
      const mineActor = createMockActor({ location: new CPos(6, 5) })
      ;(mineActor as unknown as { info: { name: string } }).info = { name: 'mine' }

      const actorsAtCell = new Map<string, MockActor[]>()
      actorsAtCell.set('6,5', [mineActor])
      ;(actor._mockWorld as { actorMap: { getActorsAt: ReturnType<typeof vi.fn> } }).actorMap.getActorsAt = vi.fn((cell: CPos) => {
        const key = `${cell.X},${cell.Y}`
        return actorsAtCell.get(key) ?? []
      })

      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [
        new CPos(5, 5),
        new CPos(6, 5),
        new CPos(7, 5),
      ]);

      layMines.cleanMineField(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(layMines.minefield).toContainEqual(new CPos(5, 5))
      expect(layMines.minefield).not.toContainEqual(new CPos(6, 5))
      expect(layMines.minefield).toContainEqual(new CPos(7, 5))
    })

    it('does nothing when minefield is null', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, null);
      layMines.cleanMineField(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(layMines.minefield).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Target lines
  // ---------------------------------------------------------------------------

  describe('targetLineNodes', () => {
    it('returns rearm target line when returnToBase is true', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(10, 10)]);
      layMines.returnToBase = true
      layMines.rearmTarget = createMockActor({ location: new CPos(1, 1) }) as unknown as import('../../OpenRA.Game/Actor.js').GameActor

      const nodes = layMines.targetLineNodes(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(nodes.length).toBeGreaterThan(0)
    })

    it('returns minefield target lines', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [
        new CPos(5, 5),
        new CPos(6, 5),
      ]);

      const nodes = layMines.targetLineNodes(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      // Should have at least one node for the next valid cell
      expect(nodes.length).toBeGreaterThan(0)
    })

    it('returns empty array when minefield is empty', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, []);
      const nodes = layMines.targetLineNodes(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      expect(nodes).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles missing ammo pool gracefully', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      actor.traits.delete('AmmoPool')
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      // Should still try to lay mine (no ammo check needed)
      expect(result).toBe(false)
    })

    it('handles missing Minelayer trait with defaults', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      actor.traits.delete('Minelayer')
      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      // Should not throw during construction
      expect(layMines).toBeDefined()
    })

    it('handles missing Mobile trait', () => {
      const actor = createMockActor({ location: new CPos(5, 5) })
      actor.traits.delete('Mobile')

      expect(() => {
        new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)])
      }).toThrow('LayMines requires an IMove trait on the actor')
    })

    it('does not lay mine when takeAmmo returns false', () => {
      const actor = createMockActor({ location: new CPos(5, 5), preLayDelay: 0 })
      const ammoPool = actor.traits.get('AmmoPool') as { takeAmmo: ReturnType<typeof vi.fn> }
      ammoPool.takeAmmo = vi.fn(() => false)

      const layMines = new LayMines(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor, [new CPos(5, 5)]);
      ((layMines as unknown as Record<string, unknown>).onFirstRun as (a: unknown) => void)(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor);
      const result = layMines.tick(actor as unknown as import('../../OpenRA.Game/Actor.js').GameActor)

      // Should not queue frame end action for mine creation
      expect(actor._frameEndActions.length).toBe(0)
      // Should continue (return false to try again or move on)
      expect(result).toBe(false)
    })
  })
})
