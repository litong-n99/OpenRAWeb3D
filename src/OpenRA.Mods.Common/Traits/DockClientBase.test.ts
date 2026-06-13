/**
 * DockClientBase.test.ts — DockClientBase migration unit tests
 *
 * Since DockClientBase is abstract, tests use a concrete TestDockClient subclass.
 * Tests focus on: info defaults, resolveOrder for Dock orders, getDockHost,
 * findDockHostTrait, and the abstract interface contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DockClientBase,
  DockClientBaseInfo,
} from './DockClientBase.js'
import { DockType } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  IDockHost,
  Order,
  ActivityStub,
  DockTypeValue,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test concrete subclass
// ---------------------------------------------------------------------------

class TestDockClientInfo extends DockClientBaseInfo {
  readonly testField: string

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    type?: DockTypeValue
    testField?: string
  } = {}) {
    super({
      instanceName: params.instanceName,
      requiresCondition: params.requiresCondition,
      type: params.type,
    })
    this.testField = params.testField ?? 'default'
  }
}

class TestDockClient extends DockClientBase<TestDockClientInfo> {
  mockCanDock = vi.fn()
  mockCanDockAt = vi.fn()
  mockCanQueueDockAt = vi.fn()
  mockOnDockStarted = vi.fn()
  mockOnDockTick = vi.fn()
  mockOnDockCompleted = vi.fn()
  mockCreateDockActivity = vi.fn()
  mockCreateMoveToDockActivity = vi.fn()
  dockType: DockTypeValue = DockType.Unload

  override getDockType(): DockTypeValue {
    return this.dockType
  }

  override canDock(type: DockTypeValue, forceEnter: boolean = false): boolean {
    return this.mockCanDock(type, forceEnter)
  }

  override canDockAt(
    host: IGameActor,
    hostTrait: IDockHost,
    forceEnter: boolean = false,
    ignoreOccupancy: boolean = false,
  ): boolean {
    return this.mockCanDockAt(host, hostTrait, forceEnter, ignoreOccupancy)
  }

  override canQueueDockAt(
    host: IGameActor,
    hostTrait: IDockHost,
    forceEnter: boolean = false,
    isQueued: boolean = false,
  ): boolean {
    return this.mockCanQueueDockAt(host, hostTrait, forceEnter, isQueued)
  }

  override onDockStarted(
    self: IGameActor,
    host: IGameActor,
    hostTrait: IDockHost,
  ): void {
    this.mockOnDockStarted(self, host, hostTrait)
  }

  override onDockTick(
    self: IGameActor,
    host: IGameActor,
    hostTrait: IDockHost,
  ): boolean {
    return this.mockOnDockTick(self, host, hostTrait)
  }

  override onDockCompleted(
    self: IGameActor,
    host: IGameActor,
    dock: IDockHost,
  ): void {
    this.mockOnDockCompleted(self, host, dock)
  }

  override createDockActivity(
    self: IGameActor,
    host: IGameActor,
  ): ActivityStub {
    return this.mockCreateDockActivity(self, host)
  }

  override createMoveToDockActivity(
    self: IGameActor,
    host: IGameActor,
  ): ActivityStub {
    return this.mockCreateMoveToDockActivity(self, host)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockHost(overrides: Partial<IDockHost> = {}): IDockHost {
  return {
    getDockType: DockType.Unload,
    isEnabledAndInWorld: true,
    reservationCount: 0,
    canBeReserved: true,
    dockPosition: { X: 0, Y: 0, Z: 0 } as never,
    isDockingPossible: vi.fn().mockReturnValue(true),
    reserve: vi.fn().mockReturnValue(true),
    unreserveAll: vi.fn(),
    ...overrides,
  }
}

function makeMockActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    ...overrides,
  } as IGameActor
}

function makeMockActivityStub(name: string = 'Test'): ActivityStub {
  return {
    queue: vi.fn(),
    cancel: vi.fn(),
    onActorDisposeOuter: vi.fn(),
    toString: () => `ActivityStub[${name}]`,
  } as ActivityStub & { toString(): string }
}

// ---------------------------------------------------------------------------
// DockClientBaseInfo tests
// ---------------------------------------------------------------------------

describe('DockClientBaseInfo', () => {
  it('has default type set to DockType.Unload', () => {
    const info = new TestDockClientInfo()
    expect(info.type).toBe(DockType.Unload)
  })

  it('accepts custom dock type', () => {
    const info = new TestDockClientInfo({ type: DockType.Repair })
    expect(info.type).toBe(DockType.Repair)
  })

  it('accepts multiple dock types via bitmask', () => {
    const info = new TestDockClientInfo({
      type: DockType.Unload | DockType.Repair,
    })
    expect(info.type & DockType.Unload).toBeTruthy()
    expect(info.type & DockType.Repair).toBeTruthy()
  })

  it('has default requiresCondition undefined', () => {
    const info = new TestDockClientInfo()
    expect(info.requiresCondition).toBeUndefined()
  })

  it('accepts custom requiresCondition', () => {
    const info = new TestDockClientInfo({ requiresCondition: '!disabled' })
    expect(info.requiresCondition).toBe('!disabled')
  })

  it('has default color green', () => {
    const info = new TestDockClientInfo()
    expect(info.color).toEqual({ r: 0, g: 1, b: 0, a: 1 })
  })

  it('subclass inherits base defaults', () => {
    const info = new TestDockClientInfo()
    expect(info.testField).toBe('default')
    expect(info.type).toBe(DockType.Unload)
  })
})

// ---------------------------------------------------------------------------
// DockClientBase tests
// ---------------------------------------------------------------------------

describe('DockClientBase', () => {
  let info: TestDockClientInfo
  let client: TestDockClient

  beforeEach(() => {
    info = new TestDockClientInfo()
    client = new TestDockClient(info)
  })

  // -----------------------------------------------------------------------
  // Constructor & info
  // -----------------------------------------------------------------------

  it('stores info from constructor', () => {
    const customInfo = new TestDockClientInfo({
      type: DockType.Repair,
      testField: 'custom',
    })
    const c = new TestDockClient(customInfo)
    expect(c.info).toBe(customInfo)
    expect(c.info.type).toBe(DockType.Repair)
    expect(c.info.testField).toBe('custom')
  })

  it('is not trait disabled by default', () => {
    expect(client.isTraitDisabled).toBe(false)
  })

  // -----------------------------------------------------------------------
  // resolveOrder — Dock order
  // -----------------------------------------------------------------------

  it('resolveOrder with Dock order queues activities when host is valid', () => {
    const dockActivity = makeMockActivityStub('Dock')
    const moveActivity = makeMockActivityStub('MoveToDock')
    client.mockCreateDockActivity.mockReturnValue(dockActivity)
    client.mockCreateMoveToDockActivity.mockReturnValue(moveActivity)
    client.mockCanDockAt.mockReturnValue(true)

    const host = makeMockActor({ actorId: 99 })
    const hostTrait = makeMockHost()
    const queueActivity = vi.fn()

    const self = makeMockActor({ queueActivity })
    const order: Order = {
      orderName: 'Dock',
      targetString: 'host-99',
      extraData: { hostActor: host },
    }

    // Override getDockHost to return our host
    const origGetDockHost = client['getDockHost']
    client['getDockHost'] = vi.fn().mockReturnValue(host)
    // Override findDockHostTrait to return our hostTrait
    client['findDockHostTrait'] = vi.fn().mockReturnValue(hostTrait)

    client.resolveOrder(self, order)

    expect(client.mockCanDockAt).toHaveBeenCalled()
    expect(client.mockCanDockAt).toHaveBeenCalledWith(host, hostTrait, false, false)
    expect(client.mockCreateMoveToDockActivity).toHaveBeenCalledWith(self, host)
    expect(client.mockCreateDockActivity).toHaveBeenCalledWith(self, host)
    // queueActivity should be called
    expect(queueActivity).toHaveBeenCalled()
    // dockActivity should be queued on moveActivity
    expect(moveActivity.queue).toHaveBeenCalled()

    // Restore
    client['getDockHost'] = origGetDockHost
  })

  it('resolveOrder does nothing when order is not Dock', () => {
    const self = makeMockActor()
    const order: Order = {
      orderName: 'Attack',
      targetString: '',
      extraData: null,
    }

    // Should not throw
    expect(() => client.resolveOrder(self, order)).not.toThrow()
    expect(client.mockCanDockAt).not.toHaveBeenCalled()
  })

  it('resolveOrder does nothing when host is null', () => {
    const self = makeMockActor()
    const order: Order = {
      orderName: 'Dock',
      targetString: 'invalid',
      extraData: null,
    }

    expect(() => client.resolveOrder(self, order)).not.toThrow()
    expect(client.mockCanDockAt).not.toHaveBeenCalled()
  })

  it('resolveOrder does nothing when hostTrait is null', () => {
    const host = makeMockActor()
    const self = makeMockActor()
    const order: Order = {
      orderName: 'Dock',
      targetString: 'host-99',
      extraData: { hostActor: host },
    }

    const origGetDockHost = client['getDockHost']
    client['getDockHost'] = vi.fn().mockReturnValue(host)
    client['findDockHostTrait'] = vi.fn().mockReturnValue(null)

    client.resolveOrder(self, order)

    expect(client.mockCanDockAt).not.toHaveBeenCalled()

    client['getDockHost'] = origGetDockHost
  })

  it('resolveOrder does nothing when canDockAt returns false', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    const self = makeMockActor()
    const order: Order = {
      orderName: 'Dock',
      targetString: 'host-99',
      extraData: { hostActor: host },
    }

    client.mockCanDockAt.mockReturnValue(false)
    const origGetDockHost = client['getDockHost']
    client['getDockHost'] = vi.fn().mockReturnValue(host)
    client['findDockHostTrait'] = vi.fn().mockReturnValue(hostTrait)

    client.resolveOrder(self, order)

    expect(client.mockCanDockAt).toHaveBeenCalledWith(host, hostTrait, false, false)
    expect(client.mockCreateMoveToDockActivity).not.toHaveBeenCalled()

    client['getDockHost'] = origGetDockHost
  })

  // -----------------------------------------------------------------------
  // getDockHost — resolve host from order
  // -----------------------------------------------------------------------

  it('getDockHost returns null for empty targetString', () => {
    const self = makeMockActor()
    const order: Order = {
      orderName: 'Dock',
      targetString: '',
      extraData: null,
    }
    // Access via prototype to test default impl
    const result = (DockClientBase.prototype as unknown as Record<string, Function>)['getDockHost'](self, order)
    expect(result).toBeNull()
  })

  it('getDockHost returns null when extraData has no hostActor', () => {
    const self = makeMockActor()
    const order: Order = {
      orderName: 'Dock',
      targetString: 'some-target',
      extraData: { otherField: 'value' },
    }
    const result = (DockClientBase.prototype as unknown as Record<string, Function>)['getDockHost'](self, order)
    expect(result).toBeNull()
  })

  it('getDockHost returns actor from extraData.hostActor', () => {
    const self = makeMockActor()
    const host = makeMockActor({ actorId: 42 })
    const order: Order = {
      orderName: 'Dock',
      targetString: 'some-target',
      extraData: { hostActor: host },
    }
    const result = (DockClientBase.prototype as unknown as Record<string, Function>)['getDockHost'](self, order)
    expect(result).toBe(host)
  })

  it('getDockHost returns null when extraData is not an object', () => {
    const self = makeMockActor()
    const order: Order = {
      orderName: 'Dock',
      targetString: 'some-target',
      extraData: 'string-data',
    }
    const result = (DockClientBase.prototype as unknown as Record<string, Function>)['getDockHost'](self, order)
    expect(result).toBeNull()
  })

  // -----------------------------------------------------------------------
  // findDockHostTrait — duck-type IDockHost detection
  // -----------------------------------------------------------------------

  it('findDockHostTrait returns valid object when all required members exist', () => {
    const host = makeMockHost()
    const actor = makeMockActor({ getDockType: host.getDockType, isEnabledAndInWorld: true, dockPosition: host.dockPosition, isDockingPossible: host.isDockingPossible, reserve: host.reserve })
    const result = (DockClientBase.prototype as unknown as Record<string, Function>)['findDockHostTrait'](actor)
    expect(result).not.toBeNull()
    expect(result).toBe(actor)
  })

  it('findDockHostTrait returns null when getDockType is not a number', () => {
    const actor = makeMockActor({ getDockType: 'string-not-number', isEnabledAndInWorld: true, dockPosition: {}, isDockingPossible: vi.fn(), reserve: vi.fn() })
    const result = (DockClientBase.prototype as unknown as Record<string, Function>)['findDockHostTrait'](actor)
    expect(result).toBeNull()
  })

  it('findDockHostTrait returns null when isDockingPossible is not a function', () => {
    const actor = makeMockActor({ getDockType: 1, isEnabledAndInWorld: true, dockPosition: {}, isDockingPossible: 'not-a-function', reserve: vi.fn() })
    const result = (DockClientBase.prototype as unknown as Record<string, Function>)['findDockHostTrait'](actor)
    expect(result).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Abstract method call forwarding (TestDockClient with overrides)
  // -----------------------------------------------------------------------

  it('forwards getDockType to subclass', () => {
    expect(client.getDockType()).toBe(DockType.Unload)
  })

  it('forwards canDock to mock', () => {
    client.mockCanDock.mockReturnValue(true)
    expect(client.canDock(DockType.Unload)).toBe(true)
    expect(client.mockCanDock).toHaveBeenCalledWith(DockType.Unload, false)
  })

  it('forwards canDock with forceEnter parameter', () => {
    client.mockCanDock.mockReturnValue(false)
    expect(client.canDock(DockType.Unload, true)).toBe(false)
    expect(client.mockCanDock).toHaveBeenCalledWith(DockType.Unload, true)
  })

  it('forwards canDockAt to mock', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    client.mockCanDockAt.mockReturnValue(true)
    expect(client.canDockAt(host, hostTrait)).toBe(true)
    expect(client.mockCanDockAt).toHaveBeenCalledWith(host, hostTrait, false, false)
  })

  it('forwards canDockAt with all parameters', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    client.mockCanDockAt.mockReturnValue(false)
    expect(client.canDockAt(host, hostTrait, true, true)).toBe(false)
    expect(client.mockCanDockAt).toHaveBeenCalledWith(host, hostTrait, true, true)
  })

  it('forwards onDockStarted to mock', () => {
    const self = makeMockActor()
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    client.onDockStarted(self, host, hostTrait)
    expect(client.mockOnDockStarted).toHaveBeenCalledWith(self, host, hostTrait)
  })

  it('forwards onDockTick to mock', () => {
    const self = makeMockActor()
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    client.mockOnDockTick.mockReturnValue(false)
    expect(client.onDockTick(self, host, hostTrait)).toBe(false)
    expect(client.mockOnDockTick).toHaveBeenCalledWith(self, host, hostTrait)
  })

  it('forwards onDockCompleted to mock', () => {
    const self = makeMockActor()
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    client.onDockCompleted(self, host, hostTrait)
    expect(client.mockOnDockCompleted).toHaveBeenCalledWith(self, host, hostTrait)
  })
})

// ---------------------------------------------------------------------------
// MinimalTestDockClient — only overrides abstract methods, uses defaults
// ---------------------------------------------------------------------------

class MinimalDockClient extends DockClientBase<TestDockClientInfo> {
  dockType: DockTypeValue = DockType.Unload

  override getDockType(): DockTypeValue {
    return this.dockType
  }

  override createDockActivity(_self: IGameActor, _host: IGameActor): ActivityStub {
    return makeMockActivityStub('Dock')
  }

  override createMoveToDockActivity(_self: IGameActor, _host: IGameActor): ActivityStub {
    return makeMockActivityStub('MoveToDock')
  }
}

describe('DockClientBase default virtual methods', () => {
  let info: TestDockClientInfo
  let client: MinimalDockClient

  beforeEach(() => {
    info = new TestDockClientInfo()
    client = new MinimalDockClient(info)
  })

  // -----------------------------------------------------------------------
  // Default canDock
  // -----------------------------------------------------------------------

  it('default canDock returns true when dock type overlaps', () => {
    client.dockType = DockType.Unload
    expect(client.canDock(DockType.Unload)).toBe(true)
  })

  it('default canDock returns true for bitmask overlap', () => {
    client.dockType = DockType.Unload | DockType.Repair
    expect(client.canDock(DockType.Unload)).toBe(true)
  })

  it('default canDock returns false when dock type does not overlap', () => {
    client.dockType = DockType.Unload
    expect(client.canDock(DockType.Repair)).toBe(false)
  })

  it('default canDock returns false when trait is disabled', () => {
    client.dockType = DockType.Unload
    ;((client as unknown) as { _enabled: boolean })._enabled = false
    expect(client.canDock(DockType.Unload)).toBe(false)
  })

  it('default canDock forceEnter does not affect basic logic', () => {
    client.dockType = DockType.Unload
    expect(client.canDock(DockType.Unload, true)).toBe(true)
    expect(client.canDock(DockType.Repair, true)).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Default canDockAt
  // -----------------------------------------------------------------------

  it('default canDockAt returns true when canDock + host accepts', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    const self = makeMockActor()
    client.attach(self)

    expect(client.canDockAt(host, hostTrait)).toBe(true)
    expect(hostTrait.isDockingPossible).toHaveBeenCalledWith(
      self, expect.anything(), false,
    )
  })

  it('default canDockAt returns false when _actor is null', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    // client not attached → _actor is null

    expect(client.canDockAt(host, hostTrait)).toBe(false)
  })

  it('default canDockAt passes ignoreOccupancy to host', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    const self = makeMockActor()
    client.attach(self)

    client.canDockAt(host, hostTrait, false, true)
    expect(hostTrait.isDockingPossible).toHaveBeenCalledWith(
      self, expect.anything(), true,
    )
  })

  it('default canDockAt returns false when host rejects', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost({ isDockingPossible: vi.fn().mockReturnValue(false) })
    const self = makeMockActor()
    client.attach(self)

    expect(client.canDockAt(host, hostTrait)).toBe(false)
  })

  it('default canDockAt returns false when canDock fails (type mismatch)', () => {
    const host = makeMockActor()
    // Host has Unload dock type...
    const hostTrait = makeMockHost({ getDockType: DockType.Unload })
    client.dockType = DockType.Repair // ...but client only supports Repair
    const self = makeMockActor()
    client.attach(self)

    expect(client.canDockAt(host, hostTrait)).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Default canQueueDockAt
  // -----------------------------------------------------------------------

  it('default canQueueDockAt passes ignoreReservations=true to host', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    const self = makeMockActor()
    client.attach(self)

    client.canQueueDockAt(host, hostTrait)
    // canQueueDockAt calls canDock(type, true) and host.isDockingPossible(_, _, true)
    expect(hostTrait.isDockingPossible).toHaveBeenCalledWith(
      self, expect.anything(), true,
    )
  })

  it('default canQueueDockAt returns false when _actor is null', () => {
    const host = makeMockActor()
    const hostTrait = makeMockHost()

    expect(client.canQueueDockAt(host, hostTrait)).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Default onDockStarted, onDockTick, onDockCompleted (no-op)
  // -----------------------------------------------------------------------

  it('default onDockStarted is a no-op (does not throw)', () => {
    const self = makeMockActor()
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    expect(() => client.onDockStarted(self, host, hostTrait)).not.toThrow()
  })

  it('default onDockTick returns false (not complete)', () => {
    const self = makeMockActor()
    const host = makeMockActor()
    const hostTrait = makeMockHost()
    expect(client.onDockTick(self, host, hostTrait)).toBe(false)
  })

  it('default onDockCompleted is a no-op (does not throw)', () => {
    const self = makeMockActor()
    const host = makeMockActor()
    const dock = makeMockHost()
    expect(() => client.onDockCompleted(self, host, dock)).not.toThrow()
  })
})
