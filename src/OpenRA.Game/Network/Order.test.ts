/**
 * Order.test.ts — Order serialization/deserialization unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  Order,
  OrderType,
  OrderFields,
  OrderPacket,
  serializeSync,
  tryParseSync,
  tryParseDisconnect,
  tryParseAck,
  tryParseOrderPacket,
  NO_ORDERS,
  NULL_ACTOR_ID,
  SYNC_HASH_ORDER_LENGTH,
  DISCONNECT_ORDER_LENGTH,
} from './Order'
import { Target, TargetType } from '../Traits/Target'
import { WPos } from '../WPos'
import { CPos } from '../CPos'
import { SubCell } from '../Traits/SubCell'
import type { IActorRef } from '../Traits/IActorRef'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock actor reference that satisfies IActorRef. */
function mockActorRef(overrides: Partial<{
  actorId: number; isInWorld: boolean; isDead: boolean
  generation: number; centerPosition: WPos
}> = {}): IActorRef & { actorId: number } {
  return {
    actorId: overrides.actorId ?? 42,
    isInWorld: overrides.isInWorld ?? true,
    isDead: overrides.isDead ?? false,
    generation: overrides.generation ?? 1,
    centerPosition: overrides.centerPosition ?? WPos.Zero,
    isTargetableBy: () => true,
    getTargetablePositions: () => [overrides.centerPosition ?? WPos.Zero],
  }
}

/** Create a mock world ref for deserialization. */
function mockWorldRef(actors: Map<number, IActorRef & { actorId: number }> = new Map()): {
  getActorById(id: number): (IActorRef & { actorId: number }) | undefined
} {
  return {
    getActorById: (id: number) => actors.get(id),
  }
}

// ---------------------------------------------------------------------------
// OrderType enum
// ---------------------------------------------------------------------------

describe('OrderType enum', () => {
  it('has correct values matching OpenRA', () => {
    expect(OrderType.Ack).toBe(0x10)
    expect(OrderType.Ping).toBe(0x20)
    expect(OrderType.SyncHash).toBe(0x65)
    expect(OrderType.TickScale).toBe(0x76)
    expect(OrderType.Disconnect).toBe(0xBF)
    expect(OrderType.Handshake).toBe(0xFE)
    expect(OrderType.Fields).toBe(0xFF)
  })
})

// ---------------------------------------------------------------------------
// OrderFields enum
// ---------------------------------------------------------------------------

describe('OrderFields enum', () => {
  it('has correct bit flag values matching OpenRA', () => {
    expect(OrderFields.None).toBe(0x0)
    expect(OrderFields.Target).toBe(0x01)
    expect(OrderFields.ExtraActors).toBe(0x02)
    expect(OrderFields.TargetString).toBe(0x04)
    expect(OrderFields.Queued).toBe(0x08)
    expect(OrderFields.ExtraLocation).toBe(0x10)
    expect(OrderFields.ExtraData).toBe(0x20)
    expect(OrderFields.TargetIsCell).toBe(0x40)
    expect(OrderFields.Subject).toBe(0x80)
    expect(OrderFields.Grouped).toBe(0x100)
  })

  it('flags are non-overlapping', () => {
    const flags = [
      OrderFields.Target,
      OrderFields.ExtraActors,
      OrderFields.TargetString,
      OrderFields.Queued,
      OrderFields.ExtraLocation,
      OrderFields.ExtraData,
      OrderFields.TargetIsCell,
      OrderFields.Subject,
      OrderFields.Grouped,
    ]
    for (let i = 0; i < flags.length; i++) {
      for (let j = i + 1; j < flags.length; j++) {
        expect(flags[i] & flags[j]).toBe(0)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Order construction & factory methods
// ---------------------------------------------------------------------------

describe('Order construction', () => {
  it('creates empty order via Order.empty()', () => {
    const o = Order.empty()
    expect(o.orderString).toBe('')
    expect(o.subjectId).toBe(NULL_ACTOR_ID)
    expect(o.target.type).toBe(TargetType.Invalid)
    expect(o.queued).toBe(false)
  })

  it('creates chat order via Order.chat()', () => {
    const o = Order.chat('Hello World')
    expect(o.orderString).toBe('Chat')
    expect(o.isImmediate).toBe(true)
    expect(o.targetString).toBe('Hello World')
    expect(o.extraData).toBe(0)
  })

  it('creates chat order with team number', () => {
    const o = Order.chat('Team msg', 5)
    expect(o.extraData).toBe(5)
  })

  it('creates fromTargetString order', () => {
    const o = Order.fromTargetString('MyOrder', 'the target', true, 42)
    expect(o.orderString).toBe('MyOrder')
    expect(o.targetString).toBe('the target')
    expect(o.isImmediate).toBe(true)
    expect(o.extraData).toBe(42)
  })

  it('creates fromGroupedOrder', () => {
    const grouped = Order.withTarget('Attack', 10, Target.Invalid, true)
    const derived = Order.fromGroupedOrder(grouped, 20)
    expect(derived.orderString).toBe('Attack')
    expect(derived.subjectId).toBe(20)
    expect(derived.queued).toBe(true)
  })

  it('creates command order', () => {
    const o = Order.command('server command')
    expect(o.orderString).toBe('Command')
    expect(o.isImmediate).toBe(true)
    expect(o.targetString).toBe('server command')
  })

  it('creates startProduction order', () => {
    const o = Order.startProduction(5, 'e1', 3, true)
    expect(o.orderString).toBe('StartProduction')
    expect(o.subjectId).toBe(5)
    expect(o.targetString).toBe('e1')
    expect(o.extraData).toBe(3)
    expect(o.queued).toBe(true)
  })

  it('creates pauseProduction order', () => {
    const pause = Order.pauseProduction(5, 'e1', true)
    expect(pause.extraData).toBe(1)

    const resume = Order.pauseProduction(5, 'e1', false)
    expect(resume.extraData).toBe(0)
  })

  it('creates cancelProduction order', () => {
    const o = Order.cancelProduction(5, 'e1', 2)
    expect(o.orderString).toBe('CancelProduction')
    expect(o.extraData).toBe(2)
  })

  it('creates withSubject order', () => {
    const o = Order.withSubject('Move', 42, true, [1, 2], [3, 4])
    expect(o.subjectId).toBe(42)
    expect(o.queued).toBe(true)
    expect(o.extraActorIds).toEqual([1, 2])
    expect(o.groupedActorIds).toEqual([3, 4])
  })

  it('creates withTarget order', () => {
    const pos = new WPos(1024, 2048, 0)
    const target = Target.fromPos(pos)
    const o = Order.withTarget('Attack', 42, target, false)
    expect(o.orderString).toBe('Attack')
    expect(o.target.type).toBe(TargetType.Terrain)
  })

  it('creates withVisualFeedback order', () => {
    const target = Target.fromPos(new WPos(1024, 0, 0))
    const vfTarget = Target.fromPos(new WPos(2048, 0, 0))
    const o = Order.withVisualFeedback('Attack', 42, target, vfTarget, true)
    expect(o.visualFeedbackTarget.centerPosition.X).toBe(2048)
  })

  it('orderName getter returns orderString', () => {
    const o = Order.empty()
    expect(o.orderName).toBe(o.orderString)
    const o2 = Order.chat('hi')
    expect(o2.orderName).toBe('Chat')
  })
})

// ---------------------------------------------------------------------------
// Order serialization round-trip
// ---------------------------------------------------------------------------

describe('Order serialization round-trip', () => {
  let worldRef: ReturnType<typeof mockWorldRef>
  let actor1: IActorRef & { actorId: number }
  let actor2: IActorRef & { actorId: number }

  beforeEach(() => {
    actor1 = mockActorRef({ actorId: 100, generation: 5 })
    actor2 = mockActorRef({ actorId: 200, generation: 3, isDead: true })
    const actors = new Map<number, IActorRef & { actorId: number }>()
    actors.set(100, actor1)
    actors.set(200, actor2)
    worldRef = mockWorldRef(actors)
  })

  it('round-trips a simple order with subject and targetString', () => {
    const original = Order.fromTargetString('Test', 'payload', false, 99)
    const data = original.serialize()
    const restored = Order.deserialize(worldRef, data)

    expect(restored).not.toBeNull()
    expect(restored!.orderString).toBe('Test')
    expect(restored!.targetString).toBe('payload')
    expect(restored!.extraData).toBe(99)
  })

  it('round-trips a chat order', () => {
    const original = Order.chat('Hello, world!', 0)
    const data = original.serialize()
    const restored = Order.deserialize(null, data)

    expect(restored).not.toBeNull()
    expect(restored!.orderString).toBe('Chat')
    expect(restored!.targetString).toBe('Hello, world!')
    // NOTE: isImmediate is a transport-layer flag, NOT serialized in the
    // OrderFields bitmask. OpenRA handles it at the OrderManager level
    // (Send vs SendImmediate), not in Order.Serialize().
  })

  it('round-trips a Handshake type order', () => {
    const original = Order.fromTargetString('HandshakeRequest', 'payload', false)
    original.type = OrderType.Handshake
    const data = original.serialize()
    const restored = Order.deserialize(null, data)

    expect(restored).not.toBeNull()
    expect(restored!.type).toBe(OrderType.Handshake)
    expect(restored!.orderString).toBe('HandshakeRequest')
    expect(restored!.targetString).toBe('payload')
  })

  it('round-trips an order with actor target', () => {
    const target = Target.fromActor(actor1)
    const original = Order.withTarget('Attack', 42, target, true)
    const data = original.serialize()
    const restored = Order.deserialize(worldRef, data)

    expect(restored).not.toBeNull()
    expect(restored!.orderString).toBe('Attack')
    expect(restored!.subjectId).toBe(42)
    expect(restored!.queued).toBe(true)
  })

  it('round-trips an order with terrain target', () => {
    const pos = new WPos(1024, 2048, 0)
    const target = Target.fromPos(pos)
    const original = Order.withTarget('Move', 10, target, false)
    const data = original.serialize()
    const restored = Order.deserialize(null, data)

    expect(restored).not.toBeNull()
    expect(restored!.orderString).toBe('Move')
    expect(restored!.target.type).toBe(TargetType.Terrain)
  })

  it('round-trips an order with cell target', () => {
    const cell = new CPos(5, 10, 0)
    const target = Target.fromCell(cell, SubCell.FullCell)
    const original = Order.withTarget('Deploy', 22, target, false)
    const data = original.serialize()
    const restored = Order.deserialize(null, data)

    expect(restored).not.toBeNull()
    expect(restored!.target.type).toBe(TargetType.Terrain)
  })

  it('round-trips an order with extraActors and extraLocation and extraData', () => {
    const original = Order.withSubject('Transport', 42, true, [100, 200])
    original.extraLocation = new CPos(3, 4, 0)
    original.extraData = 999
    const data = original.serialize()
    const restored = Order.deserialize(worldRef, data)

    expect(restored).not.toBeNull()
    expect(restored!.extraActorIds).toHaveLength(2)
    expect(restored!.extraData).toBe(999)
    expect(restored!.extraLocation.X).toBe(3)
    expect(restored!.extraLocation.Y).toBe(4)
  })

  it('round-trips an order with grouped actors', () => {
    const original = Order.withSubject('Attack', 10, true, null, [100, 200])
    const data = original.serialize()
    const restored = Order.deserialize(worldRef, data)

    expect(restored).not.toBeNull()
    expect(restored!.groupedActorIds).toHaveLength(2)
  })

  it('returns null for unknown order type', () => {
    // Create a buffer with an invalid type byte
    const badData = new Uint8Array([0x00, 0x00])
    const result = Order.deserialize(null, badData)
    expect(result).toBeNull()
  })

  it('returns null for corrupted data', () => {
    const badData = new Uint8Array([0xFF, 0x01, 0x02])
    const result = Order.deserialize(null, badData)
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Order deterministic serialization
// ---------------------------------------------------------------------------

describe('Order deterministic serialization', () => {
  it('produces identical bytes for identical orders', () => {
    const o1 = Order.chat('Hello')
    const o2 = Order.chat('Hello')
    const data1 = o1.serialize()
    const data2 = o2.serialize()

    expect(data1.length).toBe(data2.length)
    for (let i = 0; i < data1.length; i++) {
      expect(data1[i]).toBe(data2[i])
    }
  })

  it('produces different bytes for different orders', () => {
    const o1 = Order.chat('Hello')
    const o2 = Order.chat('World')
    const data1 = o1.serialize()
    const data2 = o2.serialize()
    expect(data1).not.toEqual(data2)
  })
})

// ---------------------------------------------------------------------------
// OrderPacket
// ---------------------------------------------------------------------------

describe('OrderPacket', () => {
  it('constructs from orders', () => {
    const orders = [Order.chat('hi'), Order.chat('there')]
    const packet = new OrderPacket(orders)
    expect(packet.count).toBe(2)
    expect(packet.isEmpty).toBe(false)
  })

  it('constructs empty packet', () => {
    const packet = new OrderPacket([])
    expect(packet.count).toBe(0)
    expect(packet.isEmpty).toBe(true)
  })

  it('getOrders yields deserialized orders', () => {
    const orders = [Order.chat('msg1'), Order.chat('msg2')]
    const packet = new OrderPacket(orders)

    const result: Order[] = []
    for (const o of packet.getOrders(null)) {
      result.push(o)
    }
    expect(result).toHaveLength(2)
    expect(result[0].targetString).toBe('msg1')
    expect(result[1].targetString).toBe('msg2')
  })

  it('serializes with frame number', () => {
    const orders = [Order.chat('test')]
    const packet = new OrderPacket(orders)
    const data = packet.serialize(42)

    // First 4 bytes should be frame number (big-endian 42)
    const view = new DataView(data.buffer, data.byteOffset, 4)
    expect(view.getInt32(0, false)).toBe(42)
  })

  it('combine merges multiple packets', () => {
    const p1 = new OrderPacket([Order.chat('a')])
    const p2 = new OrderPacket([Order.chat('b')])
    const combined = OrderPacket.combine([p1, p2])
    expect(combined.count).toBe(2)

    const result: string[] = []
    for (const o of combined.getOrders(null)) {
      result.push(o.targetString!)
    }
    expect(result).toEqual(['a', 'b'])
  })

  it('NO_ORDERS is an empty packet', () => {
    expect(NO_ORDERS.isEmpty).toBe(true)
    expect(NO_ORDERS.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// OrderIO helpers
// ---------------------------------------------------------------------------

describe('OrderIO helpers', () => {
  it('serializeSync produces correct byte layout', () => {
    const defeatState = 0x0123456789ABCDEFn // fits in signed int64
    const data = serializeSync(100, 0x12345678, defeatState)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    expect(view.getInt32(0, false)).toBe(100) // frame
    expect(data[4]).toBe(OrderType.SyncHash) // type
    expect(view.getInt32(5, false)).toBe(0x12345678) // syncHash
    expect(view.getBigInt64(9, false)).toBe(defeatState) // defeatState
  })

  it('tryParseSync parses a valid sync packet', () => {
    const data = serializeSync(200, 42, 7n)
    const result = tryParseSync(data)
    expect(result).not.toBeNull()
    expect(result!.frame).toBe(200)
    expect(result!.syncHash).toBe(42)
    expect(result!.defeatState).toBe(7n)
  })

  it('tryParseSync returns null for wrong type byte', () => {
    const data = new Uint8Array(17)
    data[4] = 0x00 // not SyncHash
    const result = tryParseSync(data)
    expect(result).toBeNull()
  })

  it('tryParseSync returns null for wrong length', () => {
    const data = new Uint8Array(10)
    data[4] = OrderType.SyncHash
    const result = tryParseSync(data)
    expect(result).toBeNull()
  })

  it('tryParseDisconnect parses a valid disconnect packet', () => {
    const buf = new Uint8Array(DISCONNECT_ORDER_LENGTH + 4)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 42, false) // frame
    buf[4] = OrderType.Disconnect
    view.setInt32(5, 99, false) // clientId

    const result = tryParseDisconnect(buf)
    expect(result).not.toBeNull()
    expect(result!.frame).toBe(42)
    expect(result!.clientId).toBe(99)
  })

  it('tryParseDisconnect returns null for wrong type', () => {
    const buf = new Uint8Array(DISCONNECT_ORDER_LENGTH + 4)
    buf[4] = 0x00 // not Disconnect
    const result = tryParseDisconnect(buf)
    expect(result).toBeNull()
  })

  it('tryParseAck parses a valid ack packet', () => {
    const buf = new Uint8Array(6)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 100, false) // frame
    buf[4] = OrderType.Ack
    buf[5] = 3 // count

    const result = tryParseAck(buf)
    expect(result).not.toBeNull()
    expect(result!.frame).toBe(100)
    expect(result!.count).toBe(3)
  })

  it('tryParseAck returns null for wrong type', () => {
    const buf = new Uint8Array(6)
    buf[4] = 0x00
    const result = tryParseAck(buf)
    expect(result).toBeNull()
  })

  it('tryParseOrderPacket parses an order packet', () => {
    const order = Order.chat('test')
    const packet = new OrderPacket([order])
    const data = packet.serialize(50)

    const result = tryParseOrderPacket(data)
    expect(result).not.toBeNull()
    expect(result!.frame).toBe(50)

    const orders: Order[] = []
    for (const o of result!.packet.getOrders(null)) {
      orders.push(o)
    }
    expect(orders).toHaveLength(1)
    expect(orders[0].targetString).toBe('test')
  })

  it('tryParseOrderPacket returns null for disconnect type', () => {
    const buf = new Uint8Array(5)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 0, false)
    buf[4] = OrderType.Disconnect
    expect(tryParseOrderPacket(buf)).toBeNull()
  })

  it('tryParseOrderPacket returns null for sync type', () => {
    const buf = new Uint8Array(5)
    const view = new DataView(buf.buffer)
    view.setInt32(0, 0, false)
    buf[4] = OrderType.SyncHash
    expect(tryParseOrderPacket(buf)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Constants', () => {
  it('SYNC_HASH_ORDER_LENGTH is 13', () => {
    expect(SYNC_HASH_ORDER_LENGTH).toBe(13)
  })

  it('DISCONNECT_ORDER_LENGTH is 5', () => {
    expect(DISCONNECT_ORDER_LENGTH).toBe(5)
  })

  it('NULL_ACTOR_ID is 0xFFFFFFFF', () => {
    expect(NULL_ACTOR_ID).toBe(0xffffffff)
  })
})

// ---------------------------------------------------------------------------
// Order.toString
// ---------------------------------------------------------------------------

describe('Order.toString', () => {
  it('includes orderString in output', () => {
    const o = Order.chat('hello')
    const str = o.toString()
    expect(str).toContain('Chat')
    expect(str).toContain('hello')
    expect(str).toContain('IsImmediate')
  })
})
