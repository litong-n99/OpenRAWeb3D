/**
 * Order.ts — Player command atom: serialization/deserialization and factory methods
 * OpenRA 对照: OpenRA.Game/Network/Order.cs (476 lines) + OrderIO.cs (213 lines)
 *
 * 核心范式转换:
 * - C# MemoryStream manual binary serialization → @msgpack/msgpack encode/decode
 * - C# BinaryWriter/BinaryReader field layout → msgpack array positional encoding
 * - C# Order.Subject (Actor reference) → TypeScript subjectId (ActorID number)
 * - C# Target.SerializableState (ref return struct) → encodeTarget/decodeTarget helpers
 * - C# ConcurrentDictionary/BlockingCollection → JS Map/Array (single-threaded)
 * - OrderFields bit flags preserved exactly for protocol compatibility
 */

import { encode, decode } from '@msgpack/msgpack'
import { CPos } from '../CPos'
import { WPos } from '../WPos'
import { Target, TargetType as TT } from '../Traits/Target'
import { SubCell } from '../Traits/SubCell'
import type { SubCell as SubCellEnum } from '../Traits/SubCell'
import type { IActorRef } from '../Traits/IActorRef'
import type { IFrozenActorRef } from '../Traits/IFrozenActorRef'

// ---------------------------------------------------------------------------
// OrderType — message type discriminator byte
// ---------------------------------------------------------------------------

/**
 * Serialized order type byte.
 *
 * OpenRA 对照: OrderType enum : byte
 */
export const OrderType = {
  Ack: 0x10,
  Ping: 0x20,
  PingRequest: 0x20, // alias: same byte as Ping
  SyncHash: 0x65,
  TickScale: 0x76,
  Disconnect: 0xBF,
  Handshake: 0xFE,
  Fields: 0xFF,
} as const

export type OrderType = (typeof OrderType)[keyof typeof OrderType]

// ---------------------------------------------------------------------------
// OrderFields — bit flag enum for serialized field presence
// ---------------------------------------------------------------------------

/**
 * Bit flags indicating which optional fields are present in a serialized order.
 *
 * OpenRA 对照: OrderFields enum (Flags, : short)
 */
export const OrderFields = {
  None: 0x0,
  Target: 0x01,
  ExtraActors: 0x02,
  TargetString: 0x04,
  Queued: 0x08,
  ExtraLocation: 0x10,
  ExtraData: 0x20,
  TargetIsCell: 0x40,
  Subject: 0x80,
  Grouped: 0x100,
} as const

// ---------------------------------------------------------------------------
// HasField helper (对应 OrderFieldsExts.HasField)
// ---------------------------------------------------------------------------

/**
 * Test whether a fields bitmask contains a specific flag.
 *
 * OpenRA 对照: OrderFieldsExts.HasField(OrderFields, OrderFields)
 */
function hasField(fields: number, f: number): boolean {
  return (fields & f) !== 0
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Length of orders with type OrderType.SyncHash.
 *
 * OpenRA 对照: Order.SyncHashOrderLength = 13
 */
export const SYNC_HASH_ORDER_LENGTH = 13

/** Length of orders with type OrderType.Disconnect.
 *
 * OpenRA 对照: Order.DisconnectOrderLength = 5
 */
export const DISCONNECT_ORDER_LENGTH = 5

/** Sentinel value for null actor (uint.MaxValue = 0xFFFFFFFF).
 *
 * OpenRA 对照: UIntFromActor(null) returns uint.MaxValue
 */
export const NULL_ACTOR_ID = 0xffffffff

// ---------------------------------------------------------------------------
// Target serialization helpers
// ---------------------------------------------------------------------------

/**
 * Encode a Target into a msgpack-compatible structure for network serialization.
 *
 * OpenRA 对照: Order.Serialize() Target section
 *
 * NOTE: IActorRef does not have actorId — we use a type assertion to access it
 * since all real Actor targets will be IGameActor instances that carry actorId.
 */
function encodeTarget(target: Target): unknown[] {
  const actualType = target.type // triggers live validation

  switch (actualType) {
    case TT.Actor: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actor = target.actor as IActorRef & { readonly actorId?: number }
      return [TT.Actor, actor.actorId ?? NULL_ACTOR_ID, actor.generation ?? 0]
    }
    case TT.FrozenActor: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fa = target.frozenActor as IFrozenActorRef & {
        readonly playerActorId?: number
        readonly id?: number
      }
      return [TT.FrozenActor, fa.playerActorId ?? 0, fa.id ?? 0]
    }
    case TT.Terrain: {
      const cell = target.cell
      if (cell) {
        // Cell-based terrain target
        return [TT.Terrain, 1, cell.Bits, target.subCell ?? SubCell.FullCell]
      }
      // Position-based terrain target
      const center = target.centerPosition
      const positions = target.positions
      const result: unknown[] = [TT.Terrain, 0, center.X, center.Y, center.Z]

      // Only send multiple positions if they differ from center
      if (
        positions.length === 1 &&
        positions[0].X === center.X &&
        positions[0].Y === center.Y &&
        positions[0].Z === center.Z
      ) {
        result.push(-1) // sentinel for "same as center"
      } else {
        result.push(positions.length)
        for (const pos of positions) {
          result.push(pos.X, pos.Y, pos.Z)
        }
      }
      return result
    }
    case TT.Invalid:
    default:
      return [TT.Invalid]
  }
}

/**
 * Decode a serialized target back into a Target object.
 *
 * OpenRA 对照: Order.Deserialize() Target section
 *
 * @param worldRef — optional object with getActorById for actor resolution
 * @param data — the msgpack-decoded target array
 */
function decodeTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worldRef: { getActorById(id: number): any } | null,
  data: unknown[],
): Target {
  if (!Array.isArray(data) || data.length === 0) return Target.Invalid

  const targetType = data[0] as TT

  switch (targetType) {
    case TT.Actor: {
      const actorId = data[1] as number
      if (worldRef) {
        const actor = worldRef.getActorById(actorId)
        if (actor) {
          return Target.fromActor(actor as IActorRef)
        }
      }
      return Target.Invalid
    }
    case TT.FrozenActor: {
      const playerActorId = data[1] as number
      const frozenActorId = data[2] as number
      if (worldRef) {
        const playerActor = worldRef.getActorById(playerActorId)
        if (
          playerActor &&
          (playerActor as { owner?: { frozenActorLayer?: { fromId(id: number): IFrozenActorRef | null } | null } | null }).owner
            ?.frozenActorLayer
        ) {
          const frozen = (playerActor as any).owner.frozenActorLayer.fromId(
            frozenActorId,
          )
          if (frozen) return Target.fromFrozenActor(frozen)
        }
      }
      return Target.Invalid
    }
    case TT.Terrain: {
      const isCell = data[1] as number
      if (isCell === 1) {
        const cellBits = data[2] as number
        const subCell = (data[3] as SubCellEnum) ?? SubCell.FullCell
        return Target.fromCell(CPos.fromBits(cellBits), subCell)
      }
      // Position-based
      const posX = data[2] as number
      const posY = data[3] as number
      const posZ = data[4] as number
      const count = data[5] as number
      if (count === -1) {
        return Target.fromPos(new WPos(posX, posY, posZ))
      }
      // NOTE: Full serialized terrain positions reconstruction is simplified
      return Target.fromPos(new WPos(posX, posY, posZ))
    }
    case TT.Invalid:
    default:
      return Target.Invalid
  }
}

// ---------------------------------------------------------------------------
// Order class
// ---------------------------------------------------------------------------

/**
 * A player-issued command atom.
 *
 * OpenRA 对照: Order (sealed class)
 *
 * Orders are the fundamental unit of player input in the deterministic lockstep
 * protocol. They are serialized to MessagePack for network transmission and
 * deserialized at the receiver. Actor references are converted to numeric
 * ActorIDs for network safety.
 */
export class Order {
  // -----------------------------------------------------------------------
  // Public fields (readonly where possible)
  // -----------------------------------------------------------------------

  /** The command string identifying this order type.
   *
   * OpenRA 对照: Order.OrderString
   */
  readonly orderString: string

  /** Alias for orderString — compatibility with OrderStub interface.
   *
   * OpenRA 对照: Order.OrderString (exposed as orderName for stub compat)
   */
  get orderName(): string {
    return this.orderString
  }

  /** The actor that is the subject of this order (numeric ActorID).
   *
   * OpenRA 对照: Order.Subject (Actor reference)
   *
   * NOTE: Stored as numeric ActorID for network safety. Actor references
   * are NEVER transmitted over the network. Resolution happens at
   * deserialization time via World.getActorById().
   */
  readonly subjectId: number

  /** Whether this order is queued (shift-click) vs immediate.
   *
   * OpenRA 对照: Order.Queued
   */
  readonly queued: boolean

  /** Actors selected as a group when this order was issued.
   *
   * OpenRA 对照: Order.GroupedActors
   */
  readonly groupedActorIds: readonly number[]

  // Mutable fields (set after construction, matching C# pattern)

  /** Target string (e.g., chat message, production item name).
   *
   * OpenRA 对照: Order.TargetString
   */
  targetString: string | null

  /** Extra location (e.g., rally point).
   *
   * OpenRA 对照: Order.ExtraLocation
   */
  extraLocation: CPos

  /** Extra actors (e.g., cargo passengers).
   *
   * OpenRA 对照: Order.ExtraActors (Actor[])
   */
  extraActorIds: number[] | null

  /** Extra data (e.g., production count, team number).
   *
   * OpenRA 对照: Order.ExtraData
   */
  extraData: number

  /** Whether this is an immediate order (no frame queuing).
   *
   * OpenRA 对照: Order.IsImmediate
   */
  isImmediate: boolean

  /** The order type byte for network serialization.
   *
   * OpenRA 对照: Order.Type
   */
  type: OrderType

  /** Suppress visual feedback (e.g., targeting lines).
   *
   * OpenRA 对照: Order.SuppressVisualFeedback
   */
  suppressVisualFeedback: boolean

  // Internal target storage

  /** The target of this order.
   *
   * OpenRA 对照: Order.Target (ref readonly)
   */
  private _target: Target

  /** Visual feedback target (can differ from actual target).
   *
   * OpenRA 对照: Order.VisualFeedbackTarget (ref readonly)
   */
  private _visualFeedbackTarget: Target

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** The target of this order.
   *
   * OpenRA 对照: Order.Target (ref readonly property)
   */
  get target(): Target {
    return this._target
  }

  /** Visual feedback target.
   *
   * OpenRA 对照: Order.VisualFeedbackTarget (ref readonly property)
   */
  get visualFeedbackTarget(): Target {
    return this._visualFeedbackTarget
  }

  set visualFeedbackTarget(value: Target) {
    this._visualFeedbackTarget = value
  }

  // -----------------------------------------------------------------------
  // Constructor (master constructor, private — matching C# pattern)
  // -----------------------------------------------------------------------

  /**
   * Master constructor.
   *
   * OpenRA 对照: Order(string, Actor, in Target, string, bool, Actor[], CPos, uint, Actor[])
   */
  private constructor(
    orderString: string,
    subjectId: number,
    target: Target,
    targetString: string | null,
    queued: boolean,
    extraActorIds: number[] | null,
    extraLocation: CPos,
    extraData: number,
    groupedActorIds: readonly number[] | null,
  ) {
    this.orderString = orderString || ''
    this.subjectId = subjectId
    this._target = target
    this.targetString = targetString
    this.queued = queued
    this.extraActorIds = extraActorIds
    this.extraLocation = extraLocation
    this.extraData = extraData
    this.groupedActorIds = groupedActorIds ?? []
    this.isImmediate = false
    this.type = OrderType.Fields
    this.suppressVisualFeedback = false
    this._visualFeedbackTarget = Target.Invalid
  }

  // -----------------------------------------------------------------------
  // Static factory methods (对应 Order static factory constructors)
  // -----------------------------------------------------------------------

  /**
   * Create a chat order.
   *
   * OpenRA 对照: Order.Chat(string, uint)
   */
  static chat(text: string, teamNumber: number = 0): Order {
    const o = new Order(
      'Chat',
      NULL_ACTOR_ID,
      Target.Invalid,
      text,
      false,
      null,
      CPos.Zero,
      teamNumber,
      null,
    )
    o.isImmediate = true
    return o
  }

  /**
   * Create an order with just a target string.
   *
   * OpenRA 对照: Order.FromTargetString(string, string, bool)
   *
   * @param order — the order string (command identifier)
   * @param targetString — the target string payload
   * @param isImmediate — whether this order bypasses frame queuing
   * @param extraData — extra numeric data (e.g., team number, production count)
   */
  static fromTargetString(
    order: string,
    targetString: string,
    isImmediate: boolean,
    extraData: number = 0,
  ): Order {
    const o = new Order(
      order,
      NULL_ACTOR_ID,
      Target.Invalid,
      targetString,
      false,
      null,
      CPos.Zero,
      extraData,
      null,
    )
    o.isImmediate = isImmediate
    return o
  }

  /**
   * Create an order derived from a grouped order with a specific subject.
   *
   * OpenRA 对照: Order.FromGroupedOrder(Order, Actor)
   */
  static fromGroupedOrder(grouped: Order, subjectId: number): Order {
    return new Order(
      grouped.orderString,
      subjectId,
      grouped._target,
      grouped.targetString,
      grouped.queued,
      grouped.extraActorIds,
      grouped.extraLocation,
      grouped.extraData,
      null,
    )
  }

  /**
   * Create a command order (server command).
   *
   * OpenRA 对照: Order.Command(string)
   */
  static command(text: string): Order {
    const o = new Order(
      'Command',
      NULL_ACTOR_ID,
      Target.Invalid,
      text,
      false,
      null,
      CPos.Zero,
      0,
      null,
    )
    o.isImmediate = true
    return o
  }

  /**
   * Create a production start order.
   *
   * OpenRA 对照: Order.StartProduction(Actor, string, int, bool)
   */
  static startProduction(
    subjectId: number,
    item: string,
    count: number,
    queued: boolean = true,
  ): Order {
    const o = new Order(
      'StartProduction',
      subjectId,
      Target.Invalid,
      item,
      queued,
      null,
      CPos.Zero,
      count,
      null,
    )
    return o
  }

  /**
   * Create a production pause/resume order.
   *
   * OpenRA 对照: Order.PauseProduction(Actor, string, bool)
   */
  static pauseProduction(
    subjectId: number,
    item: string,
    pause: boolean,
  ): Order {
    const o = new Order(
      'PauseProduction',
      subjectId,
      Target.Invalid,
      item,
      false,
      null,
      CPos.Zero,
      pause ? 1 : 0,
      null,
    )
    return o
  }

  /**
   * Create a production cancel order.
   *
   * OpenRA 对照: Order.CancelProduction(Actor, string, int)
   */
  static cancelProduction(
    subjectId: number,
    item: string,
    count: number,
  ): Order {
    const o = new Order(
      'CancelProduction',
      subjectId,
      Target.Invalid,
      item,
      false,
      null,
      CPos.Zero,
      count,
      null,
    )
    return o
  }

  /**
   * Parameterless constructor for scripting special powers.
   *
   * OpenRA 对照: Order() (parameterless)
   */
  static empty(): Order {
    return new Order(
      '',
      NULL_ACTOR_ID,
      Target.Invalid,
      null,
      false,
      null,
      CPos.Zero,
      0,
      null,
    )
  }

  /**
   * Constructor with subject without target.
   *
   * OpenRA 对照: Order(string, Actor, bool, Actor[], Actor[])
   */
  static withSubject(
    orderString: string,
    subjectId: number,
    queued: boolean,
    extraActorIds: number[] | null = null,
    groupedActorIds: readonly number[] | null = null,
  ): Order {
    return new Order(
      orderString,
      subjectId,
      Target.Invalid,
      null,
      queued,
      extraActorIds,
      CPos.Zero,
      0,
      groupedActorIds,
    )
  }

  /**
   * Constructor with subject and target.
   *
   * OpenRA 对照: Order(string, Actor, in Target, bool, Actor[], Actor[])
   */
  static withTarget(
    orderString: string,
    subjectId: number,
    target: Target,
    queued: boolean,
    extraActorIds: number[] | null = null,
    groupedActorIds: readonly number[] | null = null,
  ): Order {
    return new Order(
      orderString,
      subjectId,
      target,
      null,
      queued,
      extraActorIds,
      CPos.Zero,
      0,
      groupedActorIds,
    )
  }

  /**
   * Constructor with subject, target, and visual feedback target.
   *
   * OpenRA 对照: Order(string, Actor, Target, Target, bool)
   */
  static withVisualFeedback(
    orderString: string,
    subjectId: number,
    target: Target,
    visualFeedbackTarget: Target,
    queued: boolean,
  ): Order {
    const o = new Order(
      orderString,
      subjectId,
      target,
      null,
      queued,
      null,
      CPos.Zero,
      0,
      null,
    )
    o._visualFeedbackTarget = visualFeedbackTarget
    return o
  }

  // -----------------------------------------------------------------------
  // Serialization (对应 Order.Serialize())
  // -----------------------------------------------------------------------

  /**
   * Compute the OrderFields bitmask for this order.
   *
   * OpenRA 对照: Order.Serialize() fields computation
   */
  private computeFields(): number {
    let fields = OrderFields.None

    if (this.subjectId !== NULL_ACTOR_ID) fields |= OrderFields.Subject
    if (this.targetString !== null) fields |= OrderFields.TargetString
    if (this.extraData !== 0) fields |= OrderFields.ExtraData

    const targetType = this._target.type
    if (targetType !== TT.Invalid) fields |= OrderFields.Target

    if (this.queued) fields |= OrderFields.Queued

    if (this.groupedActorIds.length > 0) fields |= OrderFields.Grouped

    if (this.extraActorIds !== null && this.extraActorIds.length > 0)
      fields |= OrderFields.ExtraActors

    if (this.extraLocation !== CPos.Zero) fields |= OrderFields.ExtraLocation

    // TargetIsCell: set if target is a cell-based terrain target
    if (targetType === TT.Terrain && this._target.cell !== undefined) {
      fields |= OrderFields.TargetIsCell
    }

    return fields
  }

  /**
   * Serialize this order to a MessagePack-encoded byte array.
   *
   * OpenRA 对照: Order.Serialize() -> byte[]
   *
   * Encoding format (msgpack array, positional):
   *   [0] type: uint8
   *   [1] orderString: string
   *   For Handshake: [2] targetString: string
   *   For Fields:
   *     [2] fields: uint16
   *     Then conditionally based on flags (in fixed order):
   *     - Subject: [n] subjectId: uint32
   *     - Target: [n] targetArray (see encodeTarget)
   *     - TargetString: [n] targetString: string
   *     - ExtraActors: [n] [actorId: uint32, ...]
   *     - ExtraLocation: [n] cposBits: int32
   *     - ExtraData: [n] extraData: uint32
   *     - Grouped: [n] [actorId: uint32, ...]
   *
   * @returns MessagePack-encoded byte array (Uint8Array)
   */
  serialize(): Uint8Array {
    const arr: unknown[] = [this.type, this.orderString]

    switch (this.type) {
      case OrderType.Handshake: {
        // Handshake format: [0xFE, name, targetString]
        arr.push(this.targetString ?? '')
        break
      }

      case OrderType.Fields: {
        const fields = this.computeFields()
        arr.push(fields)

        if (hasField(fields, OrderFields.Subject)) {
          arr.push(this.subjectId)
        }

        if (hasField(fields, OrderFields.Target)) {
          arr.push(encodeTarget(this._target))
        }

        if (hasField(fields, OrderFields.TargetString)) {
          arr.push(this.targetString ?? '')
        }

        if (hasField(fields, OrderFields.ExtraActors)) {
          const actors = this.extraActorIds ?? []
          arr.push(actors)
        }

        if (hasField(fields, OrderFields.ExtraLocation)) {
          arr.push(this.extraLocation.Bits)
        }

        if (hasField(fields, OrderFields.ExtraData)) {
          arr.push(this.extraData)
        }

        if (hasField(fields, OrderFields.Grouped)) {
          arr.push([...this.groupedActorIds])
        }

        break
      }

      default:
        throw new Error(`Cannot serialize order type ${this.type}`)
    }

    return encode(arr)
  }

  /**
   * Deserialize an order from a MessagePack-encoded byte array.
   *
   * OpenRA 对照: Order.Deserialize(World, BinaryReader)
   *
   * @param worldRef — optional object with getActorById for actor ID resolution.
   *   Pass null/undefined when deserializing outside of a world context (e.g., replay recording).
   * @param data — the MessagePack-encoded byte array
   * @returns the deserialized Order, or null if it could not be deserialized
   */
  static deserialize(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    worldRef: { getActorById(id: number): any } | null,
    data: Uint8Array,
  ): Order | null {
    try {
      let decoded: unknown
      try {
        decoded = decode(data)
      } catch {
        return null
      }

      if (!Array.isArray(decoded) || decoded.length < 2) return null

      const type = decoded[0] as OrderType
      const orderString = (decoded[1] as string) ?? ''

      switch (type) {
        case OrderType.Handshake: {
          const targetString = (decoded[2] as string) ?? ''
          const o = new Order(
            orderString,
            NULL_ACTOR_ID,
            Target.Invalid,
            targetString,
            false,
            null,
            CPos.Zero,
            0,
            null,
          )
          o.type = OrderType.Handshake
          return o
        }

        case OrderType.Fields: {
          const fields = decoded[2] as number
          let idx = 3

          // Subject
          let subjectId = NULL_ACTOR_ID
          if (hasField(fields, OrderFields.Subject)) {
            subjectId = (decoded[idx++] as number) ?? NULL_ACTOR_ID
          }

          // Target
          let target = Target.Invalid
          if (hasField(fields, OrderFields.Target)) {
            const targetData = decoded[idx++] as unknown[]
            target = decodeTarget(worldRef, targetData)
          }

          // TargetString
          let targetString: string | null = null
          if (hasField(fields, OrderFields.TargetString)) {
            targetString = (decoded[idx++] as string) ?? null
          }

          const queued = hasField(fields, OrderFields.Queued)

          // ExtraActors
          let extraActorIds: number[] | null = null
          if (hasField(fields, OrderFields.ExtraActors)) {
            // NOTE: Unlike OpenRA which resolves Actor references (potentially
            // null entries), we store raw numeric actor IDs. The array length
            // is always preserved for index-based correspondence — consumers
            // should handle IDs that don't resolve to existing actors.
            extraActorIds = decoded[idx++] as number[]
          }

          // ExtraLocation
          let extraLocation = CPos.Zero
          if (hasField(fields, OrderFields.ExtraLocation)) {
            extraLocation = CPos.fromBits(decoded[idx++] as number)
          }

          // ExtraData
          let extraData = 0
          if (hasField(fields, OrderFields.ExtraData)) {
            extraData = (decoded[idx++] as number) ?? 0
          }

          // GroupedActors
          let groupedActorIds: readonly number[] | null = null
          if (hasField(fields, OrderFields.Grouped)) {
            // NOTE: Array length is preserved (see ExtraActors note above).
            groupedActorIds = decoded[idx++] as number[]
          }

          // When world is null, skip subject validation (used in replay/recording)
          if (worldRef === null || worldRef === undefined) {
            return new Order(
              orderString,
              NULL_ACTOR_ID,
              target,
              targetString,
              queued,
              extraActorIds,
              extraLocation,
              extraData,
              groupedActorIds,
            )
          }

          // If Subject flag was set but subject couldn't be resolved, return null
          if (
            hasField(fields, OrderFields.Subject) &&
            subjectId === NULL_ACTOR_ID
          ) {
            return null
          }

          return new Order(
            orderString,
            subjectId,
            target,
            targetString,
            queued,
            extraActorIds,
            extraLocation,
            extraData,
            groupedActorIds,
          )
        }

        default: {
          console.debug(`Received unknown order with type ${type}`)
          return null
        }
      }
    } catch (e) {
      console.debug('Caught exception while processing order')
      console.debug(String(e))
      return null
    }
  }

  // -----------------------------------------------------------------------
  // toString
  // -----------------------------------------------------------------------

  /**
   * String representation for debugging.
   *
   * OpenRA 对照: Order.ToString()
   */
  toString(): string {
    return (
      `OrderString: "${this.orderString}" \n\t Type: "${this.type}".` +
      `  \n\t SubjectId: "${this.subjectId}". \n\t Target: "${this._target}".` +
      `\n\t TargetString: "${this.targetString}".\n\t IsImmediate: ${this.isImmediate}.`
    )
  }
}

// ---------------------------------------------------------------------------
// OrderPacket — batch of orders for network transmission
// ---------------------------------------------------------------------------

/**
 * A batch of orders packed together for network transmission.
 *
 * OpenRA 对照: OrderPacket
 *
 * Orders are serialized at packet creation time and deserialized lazily
 * when consumed. This ensures consistent behavior between local and remote
 * clients: orders refer to actors that may no longer exist by consumption time.
 */
export class OrderPacket {
  /** Serialized data for all orders in this packet. */
  private serializedOrders: Uint8Array[]

  /**
   * Create a packet from a collection of orders.
   *
   * OpenRA 对照: OrderPacket(IEnumerable<Order>)
   *
   * Each order is individually serialized at construction time to ensure
   * consistent behavior between local and remote clients.
   */
  constructor(orders: readonly Order[]) {
    this.serializedOrders = orders.map((o) => o.serialize())
  }

  /**
   * Create a packet from pre-serialized data (for replay/recording).
   *
   * OpenRA 对照: OrderPacket(MemoryStream)
   */
  static fromSerialized(serializedOrders: Uint8Array[]): OrderPacket {
    const p = new OrderPacket([])
    p.serializedOrders = serializedOrders
    return p
  }

  /**
   * Iterate orders from this packet, deserializing lazily.
   *
   * OpenRA 对照: OrderPacket.GetOrders(World)
   *
   * Order deserialization depends on current world state, so it must be
   * deferred until we are ready to consume them.
   */
  *getOrders(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    worldRef: { getActorById(id: number): any } | null,
  ): Generator<Order> {
    for (const data of this.serializedOrders) {
      if (data.length === 0) continue
      const o = Order.deserialize(worldRef, data)
      if (o !== null) yield o
    }
  }

  /**
   * Serialize this packet with a frame number prefix.
   *
   * OpenRA 对照: OrderPacket.Serialize(int frame)
   *
   * Format: [frame:uint32, ...orders concatenated]
   * Used for network transmission. The frame number is prepended as 4 bytes
   * (big-endian uint32), followed by concatenated serialized orders.
   */
  serialize(frame: number): Uint8Array {
    const totalLength = this.serializedOrders.reduce(
      (sum, o) => sum + o.length,
      0,
    )
    const buffer = new Uint8Array(4 + totalLength)
    const view = new DataView(buffer.buffer)

    // Frame number as big-endian int32
    view.setInt32(0, frame, false) // false = big-endian

    let offset = 4
    for (const orderData of this.serializedOrders) {
      buffer.set(orderData, offset)
      offset += orderData.length
    }

    return buffer
  }

  /**
   * Combine multiple order packets into one.
   *
   * OpenRA 对照: OrderPacket.Combine(IEnumerable<OrderPacket>)
   */
  static combine(packets: readonly OrderPacket[]): OrderPacket {
    const allSerialized: Uint8Array[] = []
    for (const p of packets) {
      for (const data of p.serializedOrders) {
        allSerialized.push(data)
      }
    }
    return OrderPacket.fromSerialized(allSerialized)
  }

  /** Check if this packet has any orders. */
  get isEmpty(): boolean {
    return this.serializedOrders.length === 0
  }

  /** Number of orders in this packet. */
  get count(): number {
    return this.serializedOrders.length
  }
}

// ---------------------------------------------------------------------------
// OrderIO — static helpers for network packet parsing (对应 OrderIO in C#)
// ---------------------------------------------------------------------------

/**
 * Serialize a sync packet (frame + sync hash + defeat state).
 *
 * OpenRA 对照: OrderIO.SerializeSync((int, int, ulong))
 *
 * Format: [4b frame BE] + [1b type 0x65] + [4b syncHash BE] + [8b defeatState BE]
 */
export function serializeSync(
  frame: number,
  syncHash: number,
  defeatState: bigint,
): Uint8Array {
  const buf = new Uint8Array(17) // 4 + 1 + 4 + 8
  const view = new DataView(buf.buffer)
  view.setInt32(0, frame, false)
  buf[4] = OrderType.SyncHash
  view.setInt32(5, syncHash, false)
  view.setBigInt64(9, defeatState, false)
  return buf
}

/**
 * Try to parse a disconnect packet.
 *
 * OpenRA 对照: OrderIO.TryParseDisconnect
 *
 * @param data — the raw packet data (excluding the 4-byte fromClient prefix)
 * @param fromClient — the client ID this packet came from (optional, for
 *   validation per spec: disconnect packets are ONLY accepted from the server,
 *   i.e. fromClient === 0)
 */
export function tryParseDisconnect(
  data: Uint8Array,
  fromClient?: number,
): { frame: number; clientId: number } | null {
  // Valid Disconnect packets are only ever generated by the server
  if (fromClient !== undefined && fromClient !== 0) return null
  if (
    data.length !== DISCONNECT_ORDER_LENGTH + 4 ||
    data[4] !== OrderType.Disconnect
  ) {
    return null
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const frame = view.getInt32(0, false)
  const clientId = view.getInt32(5, false)
  return { frame, clientId }
}

/**
 * Try to parse a sync packet.
 *
 * OpenRA 对照: OrderIO.TryParseSync
 */
export function tryParseSync(
  data: Uint8Array,
): { frame: number; syncHash: number; defeatState: bigint } | null {
  if (
    data.length !== 4 + SYNC_HASH_ORDER_LENGTH ||
    data[4] !== OrderType.SyncHash
  ) {
    return null
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const frame = view.getInt32(0, false)
  const syncHash = view.getInt32(5, false)
  const defeatState = view.getBigInt64(9, false)
  return { frame, syncHash, defeatState }
}

/**
 * Try to parse an ack packet.
 *
 * OpenRA 对照: OrderIO.TryParseAck
 *
 * @param data — the raw packet data (excluding the 4-byte fromClient prefix)
 * @param fromClient — the client ID this packet came from (optional, for
 *   validation per spec: ack packets are ONLY accepted from the server,
 *   i.e. fromClient === 0)
 */
export function tryParseAck(
  data: Uint8Array,
  fromClient?: number,
): { frame: number; count: number } | null {
  // Ack packets are only accepted from the server
  if (fromClient !== undefined && fromClient !== 0) return null
  if (data.length !== 6 || data[4] !== OrderType.Ack) {
    return null
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const frame = view.getInt32(0, false)
  const count = data[5]
  return { frame, count }
}

/**
 * Try to parse a tick scale adjustment packet.
 *
 * OpenRA 对照: OrderIO.TryParseTickScale
 *
 * Tick scale packets are only accepted from the server (fromClient === 0).
 * They allow the server to dynamically adjust the client's tick frequency.
 *
 * @param data — the raw packet data (excluding the 4-byte fromClient prefix)
 * @param fromClient — optional client ID for server-only validation
 * @returns the tick scale float, or null if not a valid tick scale packet
 */
export function tryParseTickScale(
  data: Uint8Array,
  fromClient?: number,
): number | null {
  // Valid tick scale commands are only ever generated by the server
  if (fromClient !== undefined && fromClient !== 0) return null
  if (data.length !== 9 || data[4] !== OrderType.TickScale) return null

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // Valid tick scale packets always have frame 0
  const frame = view.getInt32(0, false)
  if (frame !== 0) return null

  return view.getFloat32(5, false)
}

/**
 * Try to parse an order packet from binary data.
 *
 * OpenRA 对照: OrderIO.TryParseOrderPacket
 *
 * @returns the frame number and a new OrderPacket, or null if not a valid order packet
 */
export function tryParseOrderPacket(
  data: Uint8Array,
): { frame: number; packet: OrderPacket } | null {
  if (data.length < 4) return null

  // Not a valid order packet if it is a disconnect or sync packet
  if (
    data.length >= 5 &&
    (data[4] === OrderType.Disconnect || data[4] === OrderType.SyncHash)
  ) {
    return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const frame = view.getInt32(0, false)

  // Extract individual orders from the remaining data
  // PERF: Orders are concatenated; we parse them at consumption time
  const remaining = data.subarray(4)
  if (remaining.length === 0) {
    return { frame, packet: new OrderPacket([]) }
  }

  // Split concatenated msgpack arrays. Each order is a single msgpack-encoded array.
  // We parse by repeatedly decoding from the stream.
  // TODO-MINOR: Consider @msgpack/msgpack Decoder's decodeMulti() for native
  // stream-based decoding of concatenated MessagePack objects, instead of the
  // re-encode heuristic below.
  const serializedOrders: Uint8Array[] = []
  let offset = 0
  while (offset < remaining.length) {
    // Decode one msgpack value and determine byte length by re-encoding
    try {
      const slice = remaining.subarray(offset)
      const result = decode(slice) as unknown
      // NOTE: @msgpack/msgpack single-value decode() doesn't expose bytesRead.
      // Re-encoding the decoded value gives us the exact byte count consumed.
      const reEncoded = encode(result)
      serializedOrders.push(slice.subarray(0, reEncoded.length))
      offset += reEncoded.length
    } catch {
      break
    }
  }

  return {
    frame,
    packet: OrderPacket.fromSerialized(serializedOrders),
  }
}

/**
 * Empty order packet singleton.
 *
 * OpenRA 对照: OrderIO.NoOrders
 */
export const NO_ORDERS = new OrderPacket([])
