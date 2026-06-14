/**
 * CarryableHarvester.test.ts — Unit tests for CarryableHarvester
 *
 * Tests focus on: transport resolution on created(), method delegation
 * to transports, edge cases when no transports are found.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CarryableHarvester,
  CarryableHarvesterInfo,
  type ICallForTransport,
  type IDockHostStub,
} from './CarryableHarvester.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock transport with call tracking. */
function createMockTransport(): ICallForTransport & {
  _requestCalls: { self: IGameActor; destination: CPos }[]
  _cancelCalls: IGameActor[]
} {
  const transport = {
    _requestCalls: [] as { self: IGameActor; destination: CPos }[],
    _cancelCalls: [] as IGameActor[],
    requestTransport(self: IGameActor, destination: CPos): void {
      transport._requestCalls.push({ self, destination })
    },
    movementCancelled(self: IGameActor): void {
      transport._cancelCalls.push(self)
    },
  }
  return transport
}

/** Create a mock IGameActor with optional transports.
 *
 *  If transports array is provided, they will be discoverable by
 *  CarryableHarvester._resolveTransports() via the _transports duck-typing pattern.
 */
function createMockActor(transports?: ICallForTransport[]): IGameActor {
  const actor: Record<string, unknown> = {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
  }

  if (transports) {
    actor._transports = transports
  }

  return actor as unknown as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CarryableHarvester', () => {
  // ---------------------------------------------------------------------------
  // CarryableHarvesterInfo tests
  // ---------------------------------------------------------------------------

  describe('CarryableHarvesterInfo', () => {
    it('is a marker trait with no required config', () => {
      const info = new CarryableHarvesterInfo()
      expect(info).toBeDefined()
    })

    it('has undefined instanceName by default', () => {
      const info = new CarryableHarvesterInfo()
      expect(info.instanceName).toBeUndefined()
    })

    it('accepts instanceName', () => {
      const info = new CarryableHarvesterInfo({ instanceName: 'carryable' })
      expect(info.instanceName).toBe('carryable')
    })
  })

  // ---------------------------------------------------------------------------
  // CarryableHarvester trait tests
  // ---------------------------------------------------------------------------

  describe('CarryableHarvester', () => {
    let transport: ReturnType<typeof createMockTransport>
    let actor: IGameActor

    beforeEach(() => {
      transport = createMockTransport()
      actor = createMockActor([transport])
    })

    it('discovers transports on created()', () => {
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(actor)
      expect(trait.transportCount).toBe(1)
    })

    it('transportCount is 0 when no transports exist', () => {
      const emptyActor = createMockActor()
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(emptyActor)
      expect(trait.transportCount).toBe(0)
    })

    it('movingToResources relays to all transports', () => {
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(actor)

      const targetCell = new CPos(10, 20)
      trait.movingToResources(actor, targetCell)

      expect(transport._requestCalls.length).toBe(1)
      expect(transport._requestCalls[0].destination.X).toBe(10)
      expect(transport._requestCalls[0].destination.Y).toBe(20)
    })

    it('movementCancelled relays to all transports', () => {
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(actor)

      trait.movementCancelled(actor)

      expect(transport._cancelCalls.length).toBe(1)
      expect(transport._cancelCalls[0]).toBe(actor)
    })

    it('harvested relays movementCancelled to all transports', () => {
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(actor)

      trait.harvested(actor, 'Ore')

      expect(transport._cancelCalls.length).toBe(1)
    })

    it('movingToDock relays requestTransport to all transports', () => {
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(actor)

      const hostActor = createMockActor()
      const host: IDockHostStub = {
        dockPosition: { X: 15.3, Y: 25.7, Z: 0 },
      }
      trait.movingToDock(actor, hostActor, host)

      expect(transport._requestCalls.length).toBe(1)
      expect(transport._requestCalls[0].destination.X).toBe(15) // Math.round(15.3)
      expect(transport._requestCalls[0].destination.Y).toBe(26) // Math.round(25.7)
    })

    it('relays to multiple transports', () => {
      const transport2 = createMockTransport()
      const multiActor = createMockActor([transport, transport2])

      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(multiActor)

      expect(trait.transportCount).toBe(2)

      const targetCell = new CPos(5, 5)
      trait.movingToResources(multiActor, targetCell)

      expect(transport._requestCalls.length).toBe(1)
      expect(transport2._requestCalls.length).toBe(1)
    })

    it('does nothing when no transports found', () => {
      const emptyActor = createMockActor()
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(emptyActor)

      // These should not throw
      trait.movingToResources(emptyActor, new CPos(0, 0))
      trait.movementCancelled(emptyActor)
      trait.harvested(emptyActor, 'Ore')

      const hostActor = createMockActor()
      const host: IDockHostStub = {
        dockPosition: { X: 0, Y: 0, Z: 0 },
      }
      trait.movingToDock(emptyActor, hostActor, host)
    })

    it('transports getter returns discovered transports', () => {
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      trait.created(actor)

      expect(trait.transports).toHaveLength(1)
      expect(trait.transports[0]).toBe(transport)
    })

    it('implements INotifyCreated', () => {
      const info = new CarryableHarvesterInfo()
      const trait = new CarryableHarvester(info)
      expect(typeof trait.created).toBe('function')
    })
  })
})
