/**
 * ProtocolVersion.ts — Binary protocol constants and documentation for the
 * OpenRA multiplayer network protocol.
 *
 * OpenRA 对照: OpenRA.Game/Server/ProtocolVersion.cs (82 lines C#)
 *                 + OpenRA.Game/Network/Order.cs (enum OrderType:byte)
 *                 + OpenRA.Game/Server/Connection.cs (MaxOrderLength, ReceiveState)
 *
 * 核心范式转换:
 * - C# `public static class ProtocolVersion` with `const int` → TypeScript
 *   `export const` module-scoped constants
 * - C# `enum OrderType : byte` → TypeScript `const` object + union type
 * - C# `enum ReceiveState { Header, Data }` → TypeScript `type ReceiveState`
 *   string union
 * - C# XML inline comments on order struct layouts → JSDoc with @remarks
 */

// ---------------------------------------------------------------------------
// OpenRA's network protocol defines a packet structure:
//
//   [length: int32]    — packet length, EXCLUDING this 4-byte field itself.
//                         The connection will be terminated if a packet with
//                         length > 128 kB (MaxOrderLength) is received by the
//                         server.
//   [clientId: int32]  — client ID sending the orders (or 0 if server-authored)
//   [frame: int32]     — game network tick / "frame" the order belongs to
//   [orders: byte[]]   — zero or more orders, each encoded as:
//       [orderType: byte]        — one of the OrderType byte constants below
//       [orderData: variable]    — type-specific payload (see individual types)
//
// ALL multi-byte integer values are little-endian encoded.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Protocol Version Constants
// ---------------------------------------------------------------------------

/**
 * The protocol version for the initial handshake request and response.
 *
 * Backwards-incompatible changes will break runtime mod switching, so only
 * change as a last resort.
 *
 * OpenRA 对照: ProtocolVersion.Handshake = 7
 */
export const Handshake = 7;

/**
 * The protocol version for server and world orders.
 *
 * This applies after the handshake has completed, and is provided to support
 * alternative server implementations that wish to support multiple versions
 * in parallel.
 *
 * OpenRA 对照: ProtocolVersion.Orders = 21
 */
export const Orders = 21;

/**
 * Maximum allowed order packet length in bytes (128 kB).
 *
 * If a packet exceeding this length is received by the server, the connection
 * will be terminated.
 *
 * OpenRA 对照: Connection.MaxOrderLength = 131072
 */
export const MaxOrderLength = 131072; // 128 kB

// ---------------------------------------------------------------------------
// ReceiveState — Connection read-loop state machine
// ---------------------------------------------------------------------------

/**
 * State machine type for the Connection binary protocol read loop.
 *
 * - `'Header'`: expecting an 8-byte header
 *   `[length: int32][clientId: int32][frame: int32]`
 *   After reading the header, transitions to `'Data'` with `expectLength`
 *   set to `length - 4`.
 * - `'Data'`: expecting the data payload of `expectLength` bytes.
 *   After processing, transitions back to `'Header'` with `expectLength = 8`.
 *
 * OpenRA 对照: `enum ReceiveState { Header, Data }` (Connection.cs:219)
 */
export type ReceiveState = 'Header' | 'Data';

// ---------------------------------------------------------------------------
// OrderType — byte constants for order framing
// ---------------------------------------------------------------------------

/**
 * Byte constants identifying the type of data in a protocol frame.
 *
 * Each order in the packet's `orders` segment starts with one of these bytes,
 * followed by type-specific data.
 *
 * OpenRA 对照: `enum OrderType : byte` (Order.cs:18-27)
 *
 * @remarks
 *
 * **0x65 SyncHash** — World sync hash verification:
 *   - `[hash: int32]` — sync hash value for the frame
 *   - `[defeatState: uint64]` — bitmask of defeated players
 *     (bit N set to 1 means player N is defeated)
 *
 * **0xBF Disconnect** — Player disconnected:
 *   - `[clientId: int32]` — ID of the client that disconnected
 *
 * **0xFE Handshake** — Handshake key-value pair (also used for ServerOrders
 * when `ProtocolVersion.Orders < 8`):
 *   - `[key: length-prefixed UTF-8 string]`
 *   - `[value: length-prefixed UTF-8 string]`
 *
 * **0xFF WorldOrder** — World order (game action):
 *   - `[orderName: length-prefixed string]` — the order type name
 *   - `[orderFields: byte]` — `OrderFields` enum bitflags specifying which
 *     fields are included in the remainder
 *   - `[orderData: variable]` — see `Order.cs` for field-by-field encoding
 *
 * **0x10 Ack** — Order acknowledgement (server → client, response to a
 * packet containing world orders):
 *   - `[frame: int32]` — frame number the client should apply its orders at
 *   - `[count: byte]` — number of sent order packets to apply
 *
 * **0x20 Ping** — Latency measurement:
 *   - `[timestamp: int64]` — server time when the ping was generated
 *   - `[queueLength: byte]` — (client → server only) number of frames ready
 *     to simulate
 *
 * **0x76 TickScale** — Timescale adjustment:
 *   - `[scale: float32]` — scale factor
 */
export const OrderType = {
  /** World sync hash: [hash: int32][defeatState: uint64] */
  SyncHash: 0x65,
  /** Player disconnected: [clientId: int32] */
  Disconnect: 0xbf,
  /** Handshake / ServerOrders: [key: string][value: string] */
  Handshake: 0xfe,
  /** World order: [orderName: string][orderFields: byte][orderData: ...] */
  WorldOrder: 0xff,
  /** Order acknowledgement: [frame: int32][count: byte] */
  Ack: 0x10,
  /** Ping: [timestamp: int64][queueLength: byte] */
  Ping: 0x20,
  /** TickScale: [scale: float32] */
  TickScale: 0x76,
} as const;

/** Union type of all valid OrderType byte values. */
export type OrderTypeValue = (typeof OrderType)[keyof typeof OrderType];

// ---------------------------------------------------------------------------
// Handshake Flow Documentation
// ---------------------------------------------------------------------------

/**
 * ## Connection Handshake Flow
 *
 * A connection handshake begins when a client opens a connection to the
 * server. The sequence proceeds as follows:
 *
 * ### 1. Server → Client: Initial Connection
 * - Server sends:
 *   - `[int32]` — handshake protocol version (`ProtocolVersion.Handshake = 7`)
 *   - `[int32]` — the new connection's client ID
 *
 * ### 2. Server → Client: HandshakeRequest
 * - Server sends a packet containing a single `Handshake (0xFE)` order that
 *   encodes a **HandshakeRequest** YAML/JSON blob containing at least:
 *   - `Mod`: Internal ID for the active mod
 *   - `Version`: Internal version string for the active mod
 *   - `[optional] AuthToken`: Random data blob the client can sign to verify
 *     their AuthID
 *
 * ### 3. Client Validation
 * - Client disconnects and optionally shows a switch-mod dialog if the `Mod`
 *   or `Version` do not match.
 *
 * ### 4. Client → Server: HandshakeResponse
 * - Client responds with a packet containing a single `Handshake (0xFE)` order
 *   that encodes a **HandshakeResponse** YAML/JSON blob containing at least:
 *   - `Mod`: Internal ID for the active mod
 *   - `Version`: Internal version string for the active mod
 *   - `Client`: Blob encoding client metadata:
 *     - `Name`: Client display name
 *     - `[optional] Color`: Client's current color choice
 *     - `[optional] PreferredColor`: Client's preferred color choice
 *     - `[optional] Password`: Password to enter the server
 *   - `[optional] Fingerprint`: String for querying the player's
 *     authentication public key
 *   - `[optional] AuthSignature`: AuthToken signature generated using the
 *     client's authentication private key
 *   - `[optional] OrdersProtocol`: `ProtocolVersion.Orders` that the client
 *     will use (assumed 7 if omitted)
 *
 * ### 5. Server Validation
 * - Server disconnects client if `Mod` or `Version` do not match, or it does
 *   not accept the requested `OrdersProtocol`.
 * - Server checks password; sends an `AuthenticationError` order then
 *   disconnects the client if it fails.
 *
 * @remarks
 * This documentation is preserved from the original OpenRA C# source comments
 * in `ProtocolVersion.cs`.
 */
