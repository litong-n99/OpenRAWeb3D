/**
 * Harvester.test.ts — Harvester migration unit tests
 *
 * Tests focus on: HarvesterInfo defaults, cargo management (isFull/isEmpty/fullness),
 * canHarvestCell, addResource, getSpeedModifier, resolveOrder, emptyCondition
 * lifecycle, canDock/canDockAt/canQueueDockAt, onDockTick unloading, IIssueOrder,
 * IOrderVoice, created() trait resolution, and attach/detach lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Harvester, HarvesterInfo } from './Harvester.js'
import { DockType } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  IStoresResources,
  IResourceLayer,
  Order,
  ActivityStub,
  IDockHost,
  DockTypeValue,
  PlayerStub,
  TargetStub,
  TargetModifiers,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  } as IGameActor
}

function makePlayerStub(name: string = 'TestPlayer'): PlayerStub {
  return { playerName: name }
}

function makeStoresResources(overrides: Partial<IStoresResources> = {}): IStoresResources {
  const contents = new Map<string, number>(overrides.contents as Iterable<[string, number]> ?? [])
  return {
    hasType: vi.fn().mockImplementation((rt: string) => contents.has(rt)),
    capacity: 100,
    contents,
    get contentsSum(): number {
      let sum = 0
      for (const v of contents.values()) sum += v
      return sum
    },
    addResource: vi.fn().mockImplementation((_rt: string, _val: number) => 0),
    removeResource: vi.fn().mockImplementation((_rt: string, _val: number) => 0),
    ...overrides,
  }
}

function makeResourceLayer(resourceAt: Record<string, string> = {}): IResourceLayer {
  return {
    info: {
      tryGetTerrainType: vi.fn(),
      tryGetResourceIndex: vi.fn(),
    },
    isEmpty: false,
    getResource: vi.fn().mockImplementation((cell: CPos) => {
      const key = `${cell.X},${cell.Y}`
      const type = resourceAt[key as keyof typeof resourceAt] ?? ''
      return { type, density: type ? 10 : 0 }
    }),
    getMaxDensity: vi.fn().mockReturnValue(15),
    canAddResource: vi.fn().mockReturnValue(true),
    addResource: vi.fn().mockReturnValue(1),
    removeResource: vi.fn().mockReturnValue(1),
    clearResources: vi.fn(),
    isVisible: vi.fn().mockReturnValue(true),
    onCellChanged: vi.fn(),
  }
}

function makeDockHost(type: DockTypeValue = DockType.Unload): IDockHost {
  return {
    getDockType: type,
    isEnabledAndInWorld: true,
    reservationCount: 0,
    canBeReserved: true,
    dockPosition: { X: 0, Y: 0, Z: 0 } as never,
    isDockingPossible: vi.fn().mockReturnValue(true),
    reserve: vi.fn().mockReturnValue(true),
    unreserveAll: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// HarvesterInfo tests
// ---------------------------------------------------------------------------

describe('HarvesterInfo', () => {
  it('has default baleLoadDelay of 4', () => {
    const info = new HarvesterInfo()
    expect(info.baleLoadDelay).toBe(4)
  })

  it('has default baleUnloadDelay of 4', () => {
    const info = new HarvesterInfo()
    expect(info.baleUnloadDelay).toBe(4)
  })

  it('has default baleUnloadAmount of 1', () => {
    const info = new HarvesterInfo()
    expect(info.baleUnloadAmount).toBe(1)
  })

  it('has default fullyLoadedSpeed of 85', () => {
    const info = new HarvesterInfo()
    expect(info.fullyLoadedSpeed).toBe(85)
  })

  it('has default searchOnCreation of true', () => {
    const info = new HarvesterInfo()
    expect(info.searchOnCreation).toBe(true)
  })

  it('has default searchFromProcRadius of 24', () => {
    const info = new HarvesterInfo()
    expect(info.searchFromProcRadius).toBe(24)
  })

  it('has default searchFromHarvesterRadius of 12', () => {
    const info = new HarvesterInfo()
    expect(info.searchFromHarvesterRadius).toBe(12)
  })

  it('has default waitDuration of 25', () => {
    const info = new HarvesterInfo()
    expect(info.waitDuration).toBe(25)
  })

  it('has default resourceRefineryDirectionPenalty of 200', () => {
    const info = new HarvesterInfo()
    expect(info.resourceRefineryDirectionPenalty).toBe(200)
  })

  it('has default queueFullLoad of false', () => {
    const info = new HarvesterInfo()
    expect(info.queueFullLoad).toBe(false)
  })

  it('has default emptyCondition of null', () => {
    const info = new HarvesterInfo()
    expect(info.emptyCondition).toBeNull()
  })

  it('has default harvestVoice of "Action"', () => {
    const info = new HarvesterInfo()
    expect(info.harvestVoice).toBe('Action')
  })

  it('has default resources as empty array', () => {
    const info = new HarvesterInfo()
    expect(info.resources).toEqual([])
  })

  it('has default harvestFacings of 0', () => {
    const info = new HarvesterInfo()
    expect(info.harvestFacings).toBe(0)
  })

  it('has default harvestLineColor of Crimson', () => {
    const info = new HarvesterInfo()
    expect(info.harvestLineColor.r).toBeCloseTo(0.86, 1)
    expect(info.harvestLineColor.g).toBeCloseTo(0.08, 1)
    expect(info.harvestLineColor.b).toBeCloseTo(0.24, 1)
  })

  it('has default harvestCursor of "harvest"', () => {
    const info = new HarvesterInfo()
    expect(info.harvestCursor).toBe('harvest')
  })

  it('has default unblockCellX of 0 and unblockCellY of 4', () => {
    const info = new HarvesterInfo()
    expect(info.unblockCellX).toBe(0)
    expect(info.unblockCellY).toBe(4)
  })

  it('accepts custom values', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium', 'Ore'],
      baleLoadDelay: 8,
      baleUnloadDelay: 6,
      baleUnloadAmount: 2,
      fullyLoadedSpeed: 70,
      searchOnCreation: false,
      emptyCondition: 'Empty',
      harvestVoice: 'Harvest',
    })
    expect(info.resources).toEqual(['Tiberium', 'Ore'])
    expect(info.baleLoadDelay).toBe(8)
    expect(info.baleUnloadDelay).toBe(6)
    expect(info.baleUnloadAmount).toBe(2)
    expect(info.fullyLoadedSpeed).toBe(70)
    expect(info.searchOnCreation).toBe(false)
    expect(info.emptyCondition).toBe('Empty')
    expect(info.harvestVoice).toBe('Harvest')
  })

  it('inherits dock type from DockClientBaseInfo', () => {
    const info = new HarvesterInfo({ type: DockType.Unload | DockType.Repair })
    expect(info.type & DockType.Unload).toBeTruthy()
    expect(info.type & DockType.Repair).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Harvester — Cargo management
// ---------------------------------------------------------------------------

describe('Harvester cargo management', () => {
  let harvester: Harvester

  beforeEach(() => {
    harvester = new Harvester(new HarvesterInfo({ resources: ['Tiberium'] }))
  })

  it('isFull returns true when no stores resources', () => {
    expect(harvester.isFull).toBe(true)
  })

  it('isEmpty returns true when no stores resources', () => {
    expect(harvester.isEmpty).toBe(true)
  })

  it('fullness returns 0 when no stores resources', () => {
    expect(harvester.fullness).toBe(0)
  })

  describe('with cargo attached', () => {
    function attachWithCargo(
      resourceType: string,
      amount: number,
      capacity: number = 100,
    ): IStoresResources {
      const contents = new Map<string, number>([[resourceType, amount]])
      const sr: IStoresResources = {
        hasType: (rt: string) => rt === resourceType,
        capacity,
        contents,
        get contentsSum(): number {
          let sum = 0
          for (const v of contents.values()) sum += v
          return sum
        },
        addResource: vi.fn(),
        removeResource: vi.fn(),
      }
      const actor = makeMockActor({
        _storesResources: [sr],
      })
      harvester.attach(actor)
      harvester.created(actor)
      return sr
    }

    it('isFull returns true when all stores at capacity', () => {
      attachWithCargo('Tiberium', 100, 100)
      expect(harvester.isFull).toBe(true)
    })

    it('isFull returns false when stores below capacity', () => {
      attachWithCargo('Tiberium', 50, 100)
      expect(harvester.isFull).toBe(false)
    })

    it('isEmpty returns true when contentsSum is 0', () => {
      attachWithCargo('Tiberium', 0, 100)
      expect(harvester.isEmpty).toBe(true)
    })

    it('isEmpty returns false when has resources', () => {
      attachWithCargo('Tiberium', 50, 100)
      expect(harvester.isEmpty).toBe(false)
    })

    it('fullness returns 50 when half full', () => {
      attachWithCargo('Tiberium', 50, 100)
      expect(harvester.fullness).toBe(50)
    })

    it('fullness returns 100 when completely full', () => {
      attachWithCargo('Tiberium', 100, 100)
      expect(harvester.fullness).toBe(100)
    })

    it('fullness returns 0 when completely empty', () => {
      attachWithCargo('Tiberium', 0, 100)
      expect(harvester.fullness).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Harvester — canHarvestCell
// ---------------------------------------------------------------------------

describe('Harvester canHarvestCell', () => {
  it('returns false when resourceLayer is null', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor()
    h.attach(actor)

    const cell = new CPos(5, 5)
    expect(h.canHarvestCell(cell)).toBe(false)
  })

  it('returns false when cell has no resource', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const layer = makeResourceLayer({})
    const actor = makeMockActor({
      world: { worldActor: { _resourceLayer: layer }, actors: [] },
    })
    h.attach(actor)
    h.created(actor)

    const cell = new CPos(5, 5)
    expect(h.canHarvestCell(cell)).toBe(false)
  })

  it('returns true when cell has a resource the harvester can collect', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const layer = makeResourceLayer({ '5,5': 'Tiberium' })
    const actor = makeMockActor({
      world: { worldActor: { _resourceLayer: layer }, actors: [] },
    })
    h.attach(actor)
    h.created(actor)

    const cell = new CPos(5, 5)
    expect(h.canHarvestCell(cell)).toBe(true)
  })

  it('returns false when cell resource type is not in harvester resources', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const layer = makeResourceLayer({ '5,5': 'Ore' })
    const actor = makeMockActor({
      world: { worldActor: { _resourceLayer: layer }, actors: [] },
    })
    h.attach(actor)
    h.created(actor)

    const cell = new CPos(5, 5)
    expect(h.canHarvestCell(cell)).toBe(false)
  })

  it('returns false for non-ground layer cells', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const layer = makeResourceLayer({ '5,5': 'Tiberium' })
    const actor = makeMockActor({
      world: { worldActor: { _resourceLayer: layer }, actors: [] },
    })
    h.attach(actor)
    h.created(actor)

    // Cell with layer 1 (elevated)
    const cell = new CPos(5, 5, 1)
    expect(h.canHarvestCell(cell)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Harvester — addResource
// ---------------------------------------------------------------------------

describe('Harvester addResource', () => {
  it('adds to the first store that has the type', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const sr = makeStoresResources({
      hasType: vi.fn().mockReturnValue(true),
      addResource: vi.fn(),
      capacity: 100,
    })
    const actor = makeMockActor({
      _storesResources: [sr],
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    h.addResource(actor, 'Tiberium')
    expect(sr.addResource).toHaveBeenCalledWith('Tiberium', 1)
  })

  it('skips stores that do not have the type', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium', 'Ore'] })
    const h = new Harvester(info)
    const sr1 = makeStoresResources({
      hasType: vi.fn().mockReturnValue(false),
      addResource: vi.fn(),
      capacity: 100,
    })
    const sr2 = makeStoresResources({
      hasType: vi.fn().mockReturnValue(true),
      addResource: vi.fn(),
      capacity: 100,
    })
    const actor = makeMockActor({
      _storesResources: [sr1, sr2],
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    h.addResource(actor, 'Tiberium')
    expect(sr1.addResource).not.toHaveBeenCalled()
    expect(sr2.addResource).toHaveBeenCalledWith('Tiberium', 1)
  })
})

// ---------------------------------------------------------------------------
// Harvester — getSpeedModifier
// ---------------------------------------------------------------------------

describe('Harvester getSpeedModifier', () => {
  it('returns 100 when empty', () => {
    const info = new HarvesterInfo({ fullyLoadedSpeed: 85 })
    const h = new Harvester(info)
    const contents = new Map<string, number>([['Tiberium', 0]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 0 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const actor = makeMockActor({ _storesResources: [sr] })
    h.attach(actor)
    h.created(actor)

    expect(h.getSpeedModifier()).toBe(100)
  })

  it('returns fullyLoadedSpeed when completely full', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      fullyLoadedSpeed: 85,
    })
    const h = new Harvester(info)
    const contents = new Map<string, number>([['Tiberium', 100]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 100 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const actor = makeMockActor({ _storesResources: [sr] })
    h.attach(actor)
    h.created(actor)

    expect(h.getSpeedModifier()).toBe(85)
  })

  it('returns intermediate value at 50% fullness', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      fullyLoadedSpeed: 80,
    })
    const h = new Harvester(info)
    const contents = new Map<string, number>([['Tiberium', 50]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 50 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const actor = makeMockActor({ _storesResources: [sr] })
    h.attach(actor)
    h.created(actor)

    // 100 - ((100 - 80) * 50) / 100 = 100 - 10 = 90
    expect(h.getSpeedModifier()).toBe(90)
  })

  it('returns 100 when fullyLoadedSpeed is 100', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      fullyLoadedSpeed: 100,
    })
    const h = new Harvester(info)
    const contents = new Map<string, number>([['Tiberium', 100]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 100 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const actor = makeMockActor({ _storesResources: [sr] })
    h.attach(actor)
    h.created(actor)

    expect(h.getSpeedModifier()).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Harvester — Empty condition lifecycle
// ---------------------------------------------------------------------------

describe('Harvester empty condition', () => {
  it('grants empty condition when harvester is empty', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      emptyCondition: 'Empty',
    })
    const h = new Harvester(info)
    const grantCondition = vi.fn().mockReturnValue(100)
    const contents = new Map<string, number>([['Tiberium', 0]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 0 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const actor = makeMockActor({
      _storesResources: [sr],
      grantCondition,
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    expect(grantCondition).toHaveBeenCalledWith('Empty')
    expect(h.currentUnloadTicks).toBe(0)
  })

  it('does not grant when no emptyCondition is configured', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      emptyCondition: null,
    })
    const h = new Harvester(info)
    const grantCondition = vi.fn().mockReturnValue(100)
    const actor = makeMockActor({
      _storesResources: [],
      grantCondition,
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    expect(grantCondition).not.toHaveBeenCalled()
  })

  it('revokes empty condition when harvester gains resources', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      emptyCondition: 'Empty',
    })
    const h = new Harvester(info)
    const grantCondition = vi.fn().mockReturnValue(1)
    const revokeCondition = vi.fn().mockReturnValue(-1)
    const contents = new Map<string, number>([['Tiberium', 0]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number {
        let sum = 0
        for (const v of contents.values()) sum += v
        return sum
      },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const actor = makeMockActor({
      _storesResources: [sr],
      grantCondition,
      revokeCondition,
    })
    h.attach(actor)
    h.created(actor)

    // Now change contents to non-empty and add resource
    contents.set('Tiberium', 1)
    // Use the internal updateCondition via addResource
    h.addResource(actor, 'Tiberium')
    expect(revokeCondition).toHaveBeenCalledWith(1)
  })

  it('does not grant when grantCondition is unavailable', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      emptyCondition: 'Empty',
    })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [],
      // No grantCondition
    })
    h.attach(actor)
    // Should not throw
    expect(() => h.created(actor)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Harvester — canDock / canDockAt / canQueueDockAt
// ---------------------------------------------------------------------------

describe('Harvester canDock', () => {
  let harvester: Harvester
  let self: IGameActor

  beforeEach(() => {
    harvester = new Harvester(new HarvesterInfo({ resources: ['Tiberium'] }))
    const contents = new Map<string, number>([['Tiberium', 50]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 50 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    self = makeMockActor({
      _storesResources: [sr],
      owner: makePlayerStub('PlayerA'),
    })
    harvester.attach(self)
    harvester.created(self)
  })

  it('canDock returns true when not empty', () => {
    expect(harvester.canDock(DockType.Unload)).toBe(true)
  })

  it('canDock returns false when empty (no resources to unload)', () => {
    const contents = new Map<string, number>([['Tiberium', 0]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 0 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const emptySelf = makeMockActor({
      _storesResources: [sr],
      owner: makePlayerStub('PlayerA'),
    })
    const h = new Harvester(new HarvesterInfo({ resources: ['Tiberium'] }))
    h.attach(emptySelf)
    h.created(emptySelf)

    expect(h.canDock(DockType.Unload)).toBe(false)
  })

  it('canDock returns true when empty but forceEnter is true', () => {
    const contents = new Map<string, number>([['Tiberium', 0]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 0 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const emptySelf = makeMockActor({
      _storesResources: [sr],
      owner: makePlayerStub('PlayerA'),
    })
    const h = new Harvester(new HarvesterInfo({ resources: ['Tiberium'] }))
    h.attach(emptySelf)
    h.created(emptySelf)

    expect(h.canDock(DockType.Unload, true)).toBe(true)
  })

  it('canDock returns false when trait is disabled', () => {
    // Simulate trait disabled
    ;((harvester as unknown) as { _enabled: boolean })._enabled = false
    expect(harvester.canDock(DockType.Unload)).toBe(false)
  })

  it('canDockAt returns true for same owner', () => {
    const playerA = makePlayerStub('PlayerA')
    const host = makeMockActor({ owner: playerA })
    const hostTrait = makeDockHost()

    // Rebuild self with same owner reference
    const storesResources = (self as unknown as Record<string, unknown>)._storesResources
    const selfSame = makeMockActor({
      _storesResources: storesResources,
      owner: playerA,
    } as Record<string, unknown>)
    harvester.detach(self)
    harvester.attach(selfSame)
    harvester.created(selfSame)

    expect(harvester.canDockAt(host, hostTrait)).toBe(true)
  })

  it('canDockAt returns false for different owner without alliance', () => {
    const playerB = makePlayerStub('PlayerB')
    const host = makeMockActor({ owner: playerB })
    const hostTrait = makeDockHost()

    const selfDiff = makeMockActor({
      _storesResources: [] as IStoresResources[],
      owner: makePlayerStub('PlayerA'),
    } as Record<string, unknown>)
    harvester.detach(self)
    harvester.attach(selfDiff)
    harvester.created(selfDiff)

    expect(harvester.canDockAt(host, hostTrait)).toBe(false)
  })

  it('canDockAt returns true for allied owner when ignoreOccupancy is true', () => {
    const alliedPlayer = makePlayerStub('Ally')
    // Make ally have isAlliedWith
    ;(alliedPlayer as unknown as Record<string, unknown>).isAlliedWith = () => true

    const selfAllied = makeMockActor({
      _storesResources: [] as IStoresResources[],
      owner: alliedPlayer,
    })
    harvester.detach(self)
    harvester.attach(selfAllied)
    harvester.created(selfAllied)

    const host = makeMockActor({ owner: alliedPlayer })
    const hostTrait = makeDockHost()
    expect(harvester.canDockAt(host, hostTrait, false, true)).toBe(true)
  })

  it('canDockAt returns false when self is null', () => {
    harvester.detach(self)
    const host = makeMockActor()
    const hostTrait = makeDockHost()
    expect(harvester.canDockAt(host, hostTrait)).toBe(false)
  })

  it('canQueueDockAt returns true for allied owners', () => {
    const alliedPlayer = makePlayerStub('Ally')
    ;(alliedPlayer as unknown as Record<string, unknown>).isAlliedWith = () => true

    const allySelf = makeMockActor({
      _storesResources: [] as IStoresResources[],
      owner: alliedPlayer,
    })
    harvester.detach(self)
    harvester.attach(allySelf)
    harvester.created(allySelf)

    const host = makeMockActor({ owner: alliedPlayer })
    const hostTrait = makeDockHost()
    expect(harvester.canQueueDockAt(host, hostTrait)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Harvester — onDockStarted / onDockTick / onDockCompleted
// ---------------------------------------------------------------------------

describe('Harvester docking lifecycle', () => {
  let harvester: Harvester
  let self: IGameActor

  beforeEach(() => {
    harvester = new Harvester(new HarvesterInfo({
      resources: ['Tiberium'],
      baleUnloadDelay: 4,
      baleUnloadAmount: 1,
    }))
    const contents = new Map<string, number>([['Tiberium', 10]])
    const sr: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents,
      get contentsSum(): number { return 10 },
      addResource: vi.fn(),
      removeResource: vi.fn().mockImplementation((_rt: string, val: number) => {
        const curr = contents.get('Tiberium') ?? 0
        const newVal = Math.max(0, curr - val)
        contents.set('Tiberium', newVal)
        return val // amount removed
      }),
    }
    self = makeMockActor({
      _storesResources: [sr],
      owner: makePlayerStub('PlayerA'),
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn().mockReturnValue(-1),
      queueActivity: vi.fn(),
    })
    harvester.attach(self)
    harvester.created(self)
  })

  it('onDockStarted resolves IAcceptResources when canDock passes', () => {
    const host = makeMockActor({
      acceptResources: vi.fn(),
    })
    const hostTrait = makeDockHost()

    harvester.onDockStarted(self, host, hostTrait)

    // Should have resolved the acceptResources
    // Verify by proceeding to onDockTick
    harvester.currentUnloadTicks = 0
    const done = harvester.onDockTick(self, host, hostTrait)
    expect(done).toBe(false) // Not done yet, should have unloaded one bale
  })

  it('onDockTick waits for unload timer', () => {
    const host = makeMockActor({
      acceptResources: vi.fn().mockReturnValue(1),
    })
    const hostTrait = makeDockHost()

    harvester.onDockStarted(self, host, hostTrait)
    harvester.currentUnloadTicks = 3 // Not ready

    const done = harvester.onDockTick(self, host, hostTrait)
    expect(done).toBe(false)
    expect(harvester.currentUnloadTicks).toBe(2) // Decremented
  })

  it('onDockTick unloads resources and returns false when still has cargo', () => {
    const acceptResources = vi.fn().mockReturnValue(1)
    const host = makeMockActor({ acceptResources })
    const hostTrait = makeDockHost()

    harvester.onDockStarted(self, host, hostTrait)
    harvester.currentUnloadTicks = 0

    // First tick: unload 1 bale
    const done0 = harvester.onDockTick(self, host, hostTrait)
    expect(done0).toBe(false)
    expect(acceptResources).toHaveBeenCalledWith(host, 'Tiberium', 1)
    expect(harvester.currentUnloadTicks).toBe(4) // Reset to baleUnloadDelay

    // Wait for timer
    harvester.currentUnloadTicks = 0
    const done1 = harvester.onDockTick(self, host, hostTrait)
    expect(done1).toBe(false)
  })

  it('onDockTick returns true when all cargo is empty', () => {
    // Make empty harvester with 0 remaining
    const emptyContents = new Map<string, number>([['Tiberium', 0]])
    const emptySR: IStoresResources = {
      hasType: () => true,
      capacity: 100,
      contents: emptyContents,
      get contentsSum(): number { return 0 },
      addResource: vi.fn(),
      removeResource: vi.fn(),
    }
    const emptySelf = makeMockActor({
      _storesResources: [emptySR],
    })
    const h = new Harvester(new HarvesterInfo({ resources: ['Tiberium'] }))
    h.attach(emptySelf)
    h.created(emptySelf)

    const host = makeMockActor({
      acceptResources: vi.fn().mockReturnValue(0),
    })
    const hostTrait = makeDockHost()

    h.onDockStarted(emptySelf, host, hostTrait)
    h.currentUnloadTicks = 0
    const done = h.onDockTick(emptySelf, host, hostTrait)
    expect(done).toBe(true)
  })

  it('onDockTick returns true when acceptResources is null', () => {
    const host = makeMockActor({})
    const hostTrait = makeDockHost()

    // Do NOT call onDockStarted (so acceptResources is null)
    harvester.currentUnloadTicks = 0
    const done = harvester.onDockTick(self, host, hostTrait)
    expect(done).toBe(true)
  })

  it('onDockCompleted queues harvest activity when dock type matches', () => {
    const queueActivity = vi.fn()
    const selfWithQueue = { ...self, queueActivity } as IGameActor
    const host = makeMockActor()
    const dock = makeDockHost(DockType.Unload)

    harvester.onDockCompleted(selfWithQueue, host, dock)
    expect(queueActivity).toHaveBeenCalled()
  })

  it('onDockCompleted does nothing when dock type does not match', () => {
    const queueActivity = vi.fn()
    const selfWithQueue = { ...self, queueActivity } as IGameActor
    const host = makeMockActor()
    const dock = makeDockHost(DockType.Repair) // Mismatch

    harvester.onDockCompleted(selfWithQueue, host, dock)
    expect(queueActivity).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Harvester — resolveOrder (Harvest)
// ---------------------------------------------------------------------------

describe('Harvester resolveOrder', () => {
  it('resolveOrder with "Harvest" queues a harvest activity', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const queueActivity = vi.fn()
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
      queueActivity,
    })
    h.attach(actor)
    h.created(actor)

    const order: Order = {
      orderName: 'Harvest',
      targetString: '',
      extraData: null,
    }
    h.resolveOrder(actor, order)

    expect(queueActivity).toHaveBeenCalled()
    const activity = queueActivity.mock.calls[0][0] as ActivityStub
    expect(activity.toString()).toBe('ActivityStub[FindAndDeliverResources]')
  })

  it('resolveOrder with "Harvest" does nothing when mobile is null', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const queueActivity = vi.fn()
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      // No _mobile
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
      queueActivity,
    })
    h.attach(actor)
    h.created(actor)

    const order: Order = {
      orderName: 'Harvest',
      targetString: '',
      extraData: null,
    }
    h.resolveOrder(actor, order)

    expect(queueActivity).not.toHaveBeenCalled()
  })

  it('resolveOrder falls through to DockClientBase for unknown order types', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor()
    h.attach(actor)

    const order: Order = {
      orderName: 'Stop',
      targetString: '',
      extraData: null,
    }
    // Should not throw — falls through to super.resolveOrder
    expect(() => h.resolveOrder(actor, order)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Harvester — IIssueOrder
// ---------------------------------------------------------------------------

describe('Harvester IIssueOrder', () => {
  it('orders returns HarvestOrderTargeter when trait enabled and mobile available', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    expect(h.orders.length).toBe(1)
    expect(h.orders[0].orderID).toBe('Harvest')
    expect(h.orders[0].orderPriority).toBe(10)
  })

  it('orders returns empty when trait disabled', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    ;((h as unknown) as { _enabled: boolean })._enabled = false

    expect(h.orders.length).toBe(0)
  })

  it('orders returns empty when mobile is null', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    expect(h.orders.length).toBe(0)
  })

  it('HarvestOrderTargeter.canTarget returns true when ForceMove is not set', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    const targeter = h.orders[0]
    const result = targeter.canTarget(
      actor,
      {} as TargetStub,
      0 as TargetModifiers,
      'harvest',
    )
    expect(result).toBe(true)
  })

  it('HarvestOrderTargeter.canTarget returns false when ForceMove modifier is set', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    const targeter = h.orders[0]
    const ForceMove = 4
    const result = targeter.canTarget(
      actor,
      {} as TargetStub,
      ForceMove as TargetModifiers,
      'harvest',
    )
    expect(result).toBe(false)
  })

  it('issueOrder with Harvest orderID returns Harvest order', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    const targeter = h.orders[0]
    const order = h.issueOrder(actor, targeter, {} as TargetStub, false)
    expect(order.orderName).toBe('Harvest')
  })

  it('issueOrder with unknown orderID returns empty order', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor({ _mobile: { speed: 100 } })
    h.attach(actor)

    const unknownTargeter = { orderID: 'Unknown', orderPriority: 0, canTarget: vi.fn(), isQueued: false, targetOverridesSelection: vi.fn() }
    const order = h.issueOrder(actor, unknownTargeter, {} as TargetStub, false)
    expect(order.orderName).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Harvester — IOrderVoice
// ---------------------------------------------------------------------------

describe('Harvester IOrderVoice', () => {
  it('returns harvestVoice for Harvest orders when mobile is available', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      harvestVoice: 'Harvest',
    })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    const order: Order = { orderName: 'Harvest', targetString: '', extraData: null }
    expect(h.voicePhraseForOrder(actor, order)).toBe('Harvest')
  })

  it('returns empty string for Harvest orders when mobile is null', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      harvestVoice: 'Harvest',
    })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    const order: Order = { orderName: 'Harvest', targetString: '', extraData: null }
    expect(h.voicePhraseForOrder(actor, order)).toBe('')
  })

  it('returns empty string for non-Harvest orders', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      harvestVoice: 'Harvest',
    })
    const h = new Harvester(info)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: null,
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
    })
    h.attach(actor)
    h.created(actor)

    const order: Order = { orderName: 'Stop', targetString: '', extraData: null }
    expect(h.voicePhraseForOrder(actor, order)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Harvester — created() lifecycle
// ---------------------------------------------------------------------------

describe('Harvester created', () => {
  it('auto-searches for resources when searchOnCreation is true and mobile available', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      searchOnCreation: true,
    })
    const h = new Harvester(info)
    const queueActivity = vi.fn()
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: { worldActor: null, actors: [] },
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
      queueActivity,
    })
    h.attach(actor)
    h.created(actor)

    expect(queueActivity).toHaveBeenCalled()
  })

  it('does not auto-search when searchOnCreation is false', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      searchOnCreation: false,
    })
    const h = new Harvester(info)
    const queueActivity = vi.fn()
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      _mobile: { speed: 100 },
      owner: makePlayerStub('TestPlayer'),
      world: { worldActor: null, actors: [] },
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
      queueActivity,
    })
    h.attach(actor)
    h.created(actor)

    expect(queueActivity).not.toHaveBeenCalled()
  })

  it('does not auto-search when mobile is null', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      searchOnCreation: true,
    })
    const h = new Harvester(info)
    const queueActivity = vi.fn()
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      // No _mobile
      owner: makePlayerStub('TestPlayer'),
      world: { worldActor: null, actors: [] },
      grantCondition: vi.fn().mockReturnValue(100),
      revokeCondition: vi.fn(),
      queueActivity,
    })
    h.attach(actor)
    h.created(actor)

    expect(queueActivity).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Harvester — attach/detach lifecycle
// ---------------------------------------------------------------------------

describe('Harvester attach/detach', () => {
  it('attach stores actor reference', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor()
    h.attach(actor)
    expect(h.actor).toBe(actor)
  })

  it('detach clears state', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      emptyCondition: 'Empty',
    })
    const h = new Harvester(info)
    const grantCondition = vi.fn().mockReturnValue(100)
    const revokeCondition = vi.fn().mockReturnValue(-1)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      grantCondition,
      revokeCondition,
    })
    h.attach(actor)
    h.created(actor)

    h.detach(actor)
    expect(h.actor).toBeNull()
    // isEmpty should return true (since _storesResources was cleared)
    expect(h.isEmpty).toBe(true)
  })

  it('traitDisabled revokes empty condition', () => {
    const info = new HarvesterInfo({
      resources: ['Tiberium'],
      emptyCondition: 'Empty',
    })
    const h = new Harvester(info)
    const grantCondition = vi.fn().mockReturnValue(100)
    const revokeCondition = vi.fn().mockReturnValue(-1)
    const actor = makeMockActor({
      _storesResources: [] as IStoresResources[],
      grantCondition,
      revokeCondition,
    })
    h.attach(actor)
    h.created(actor)

    // Revoke should have been called (empty condition was granted, then revoked on initial check)
    // Now disable the trait
    ;(h as unknown as { _enabled: boolean })._enabled = false
    // traitDisabled is protected — it should revoke the condition
    // Call through the public dispatch interface
    h.onEnabledChanged(false)

    // We can verify via detach which calls _revokeEmptyCondition
  })
})

// ---------------------------------------------------------------------------
// Harvester — findResourceField
// ---------------------------------------------------------------------------

describe('Harvester findResourceField', () => {
  it('returns null when resourceLayer is null', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const actor = makeMockActor()
    h.attach(actor)

    expect(h.findResourceField(actor)).toBeNull()
  })

  it('returns null when actor has no location', () => {
    const info = new HarvesterInfo({ resources: ['Tiberium'] })
    const h = new Harvester(info)
    const layer = makeResourceLayer()
    const actor = makeMockActor({
      world: { worldActor: { _resourceLayer: layer }, actors: [] },
    })
    h.attach(actor)
    h.created(actor)

    expect(h.findResourceField(actor)).toBeNull()
  })
})
