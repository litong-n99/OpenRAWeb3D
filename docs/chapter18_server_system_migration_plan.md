# OpenRA to Babylon.js Migration Plan: Chapter 18 -- Server System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.6 (Network/Server) + Section 4.3 (Traits)
> **Chapter Status**: PLANNING (0/9 migrated, 0%)
> **Planning Date**: 2026-06-16
> **Prerequisite**: Chapters 2-7 COMPLETE (162/162, 100%), Chapter 6 Phase A (Order + Connection + OrderManager) COMPLETE, Chapter 6 Phase B (Sync hash) COMPLETE, Chapter 17 COMPLETE (GameSave, ReplayRecorder, ReplayConnection)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Protocol and Interfaces Foundation](#31-phase-a-protocol-and-interfaces-foundation)
   - 3.2 [Phase B: Server Core](#32-phase-b-server-core)
   - 3.3 [Phase C: Connection Layer](#33-phase-c-connection-layer)
   - 3.4 [Phase D: Server Support Systems](#34-phase-d-server-support-systems)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

Chapter 18 implements the dedicated game server infrastructure for multiplayer hosting. This is the most architecturally distinct chapter in the entire migration because **the web server operates in a different runtime than the browser client** -- a split that does not exist in OpenRA's single-process C# architecture. In OpenRA, the server runs as a thread within the same process that renders the client. In OpenRAWeb3D, the server runs as a Node.js process (or optionally a Web Worker in a host browser tab), while the client runs in the browser.

The core paradigm shifts:

- **Thread-per-connection to event-driven async** -- C# `Thread` for each connection's `SendReceiveLoop` and `new Thread(_ => { ... })` for the main server loop -> Node.js `ws` WebSocket server with event-driven `on('connection')` + `async`/`await` for the server loop, and browser `WebSocket` API for client connections
- **TcpListener/TcpClient/Socket to WebSocket** -- C# raw TCP socket with `Socket.Poll()`, `Socket.Send()`, `Socket.Receive()` -> `ws` library WebSocket connection with `ws.on('message', ...)` for receive and `ws.send(data)` for send
- **BlockingCollection event queue to event-driven dispatch** -- C# `BlockingCollection<IServerEvent>` with polling `events.TryTake(out e, 1000)` -> JavaScript event-driven architecture: `ws.on('connection', ...)`, `ws.on('message', ...)`, `ws.on('close', ...)` -- no polling needed
- **MemoryStream/BinaryWriter/BinaryReader to Uint8Array/DataView** -- C# `MemoryStream` + `BinaryWriter` pattern for binary frame construction -> `Uint8Array` + `DataView` with existing `Order.serialize()` / `Order.deserialize()` patterns
- **Stopwatch to performance.now()/Date.now()** -- C# `Stopwatch.StartNew()` + `ElapsedMilliseconds` -> `performance.now()` (high precision, monotonic) for real-time measurements
- **Console.WriteLine to Node.js console.log** -- C# server logging -> Node.js `console.log` with ISO timestamp prefix (matching `WriteLineWithTimeStamp` pattern)
- **MiniYaml serialization for lobby data to JSON** -- C# `MiniYaml.WriteToString()` for `SyncLobbyClients`, `SyncLobbySlots`, `SyncLobbyGlobalSettings` -> JSON serialization (compatible evolution, consistent with Ch17 ADR-17.5)
- **NetworkStream with non-blocking send fallback** -- C# complex socket send with `SocketFlags.None` error handling and blocking fallback -> `ws.send(data)` -- WebSocket handles buffering and backpressure internally

### 1.2 Architecture Principles

1. **WebSocket as transport layer**: All client-server communication uses WebSocket (`ws` library server-side, browser `WebSocket` API client-side). The binary protocol format (int32 length prefix + int32 clientId + int32 frame + variable-length order data) is preserved byte-for-byte, with the same little-endian encoding.

2. **Event-driven server loop**: The C# server's `BlockingCollection<IServerEvent>` polling loop is replaced with direct JavaScript event handlers. `ws.on('connection')` replaces `ConnectionConnectEvent`, `ws.on('message')` replaces `ConnectionPacketEvent`, `ws.on('close')` replaces `ConnectionDisconnectEvent`. Server traits are ticked via `setInterval()` at the game timestep frequency.

3. **Dual runtime architecture**: The server can run in two modes -- (A) as a standalone Node.js process using the `ws` library (dedicated server, `ServerType.Dedicated`), or (B) as a Web Worker in a host browser tab using the browser's `WebSocket` API for the server side (peer-hosted multiplayer, `ServerType.Multiplayer`). The `Server` class itself is runtime-agnostic beyond the WebSocket transport layer, which is injected via an `IServerTransport` interface (ADR-18.6).

4. **Binary protocol parity**: All multi-byte network protocol operations use little-endian encoding via `DataView`. The packet structure (`[length: int32][clientId: int32][frame: int32][data: byte[]]`), order type bytes (0x65 SyncHash, 0xBF Disconnect, 0xFE Handshake, 0xFF WorldOrder, 0x10 Ack, 0x20 Ping, 0x76 TickScale), and handshake flow (Request/Response with `ProtocolVersion.Handshake=7` and `ProtocolVersion.Orders=21`) are preserved exactly.

5. **Session type co-evolution**: The existing `SessionStub` in `World.ts` and `SessionClientStub` in `Player.ts` are transition stubs from early chapter migrations. Chapter 18 creates the full `Session`, `SessionClient`, `SessionSlot`, and `SessionGlobalSettings` types in `src/OpenRA.Game/Server/SessionTypes.ts`. These replace the stubs throughout the codebase. The LobbyTypes already in `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/` serve as a partial implementation that is consolidated (ADR-18.4).

6. **Order broadcasting remains deterministic**: The server's order dispatch logic -- unicast (`dispatchOrdersToClient`), broadcast (`dispatchOrdersToClients`), and server-order broadcast (`dispatchServerOrdersToClients`) -- preserves identical frame-numbered packet forwarding. Order latency projection (adding `OrderLatency` to frame numbers) and ack-frame generation (`createAckFrame`) remain identical to C# logic.

7. **Authentication decoupling**: The C# server's `PlayerDatabase` / `HttpClientFactory` / `CryptoUtil` authentication flow is decoupled into an `IAuthenticator` interface. The default implementation uses the same HTTP-based player profile verification. For Web Worker mode, authentication is deferred to the hosting browser tab.

8. **No GeoIP / NAT in browser context**: `GeoIP.Initialize()`, `GeoIP.LookupCountry()`, `Nat.TryForwardPort()`, `Nat.TryRemovePortForward()` are all NOPs in browser context. They are only active in Node.js dedicated server mode (where `geoip-lite` npm package can be used optionally).

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-7 and Chapter 17 is available for Chapter 18:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `IConnection` (client-side), `OrderManager`, `UnitOrders` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, `ISync` interface, sync hash serialization |
| Ruleset + Session types | Ch6 Phase C | `Ruleset`, `ActorInfo`, `SessionClient`/`SessionSlot`/`SessionGlobal` (LobbyTypes) |
| World + Actor + TraitDictionary | Ch3 | `GameWorldManager`, `GameActor`, `TraitDictionary`, `ITick` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `vector3ToWPos()` |
| FileSystem + MOD System | Ch5 | `FileSystem`, `ModData`, `Manifest`, `ZipFile` |
| Map + MapCache | Ch4 Phases D-E | `Map`, `MapCache`, `MapPreview`, `MapPlayers` |
| GameInformation + ReplayMetadata | Ch17 Phase A | `GameInformation`, `GameInformationPlayer`, `ReplayMetadata` |
| ReplayRecorder + ReplayConnection | Ch17 Phase B | `ReplayRecorder`, `ReplayConnection` |
| GameSave + SlotClient | Ch17 Phase C | `GameSave`, `SlotClient` |
| SyncReport | Ch17 Phase D | `SyncReport` |
| FluentMessage system | Ch6 | FluentMessage serialization/deserialization |
| Player + SessionClientStub | Ch3 | `Player`, `SessionClientStub` (to be replaced by full types) |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (9 files across 4 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Protocol and Interfaces Foundation** | | | | | |
| 1 | `OpenRA.Game/Server/ProtocolVersion.cs` | `src/OpenRA.Game/Server/ProtocolVersion.ts` | `ProtocolVersion` | 82 | LOW | A |
| 2 | `OpenRA.Game/Server/TraitInterfaces.cs` | `src/OpenRA.Game/Server/TraitInterfaces.ts` | `ServerTrait`, 9 interfaces | 63 | LOW | A |
| 3 | `OpenRA.Game/Server/Exts.cs` | `src/OpenRA.Game/Server/Exts.ts` | `except()` utility | 24 | LOW | A |
| **Phase B: Server Core** | | | | | |
| 4 | `OpenRA.Game/Server/Server.cs` | `src/OpenRA.Game/Server/Server.ts` | `Server` + SessionTypes | 1594 | **HIGHEST** | B |
| **Phase C: Connection Layer** | | | | | |
| 5 | `OpenRA.Game/Server/Connection.cs` | `src/OpenRA.Game/Server/Connection.ts` | `Connection` (server-side) | 220 | MEDIUM | C |
| 6 | `OpenRA.Game/Server/OrderBuffer.cs` | `src/OpenRA.Game/Server/OrderBuffer.ts` | `OrderBuffer` | 139 | MEDIUM | C |
| **Phase D: Server Support Systems** | | | | | |
| 7 | `OpenRA.Game/Server/VoteKickTracker.cs` | `src/OpenRA.Game/Server/VoteKickTracker.ts` | `VoteKickTracker` | 223 | LOW | D |
| 8 | `OpenRA.Game/Server/MapStatusCache.cs` | `src/OpenRA.Game/Server/MapStatusCache.ts` | `MapStatusCache` + `ILintServerMapPass` | 106 | LOW | D |
| 9 | `OpenRA.Game/Server/PlayerMessageTracker.cs` | `src/OpenRA.Game/Server/PlayerMessageTracker.ts` | `PlayerMessageTracker` | 86 | LOW | D |

> **Complexity Legend**:
> - **LOW**: Data structures, interfaces, or simple logic with minimal internal dependencies. 24-223 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with binary protocol handling, queue management, or WebSocket integration. 139-220 lines of C# with careful byte-level correctness requirements.
> - **HIGHEST**: The most complex file in any chapter -- 1594 lines orchestrating all server subsystems: WebSocket accept/reject/drop lifecycle, order broadcasting/buffering, sync hash verification, lobby state synchronization, game start/end, replay recording, game save integration, server trait lifecycle, ping quality tracking, player defeat tracking, map validation, command interpretation, and FluentMessage-based user notifications.

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 9 |
| **Phase A (Protocol and Interfaces)** | 3 files |
| **Phase B (Server Core)** | 1 file (+ SessionTypes.ts support module) |
| **Phase C (Connection Layer)** | 2 files |
| **Phase D (Support Systems)** | 3 files |
| **HIGHEST complexity** | 1 file (Server.ts) |
| **MEDIUM complexity** | 2 files |
| **LOW complexity** | 6 files |
| **Total OpenRA C# source lines** | ~2,537 |

| Phase | Files | C# Lines | TS Lines (est.) | Tests (est.) | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Protocol and Interfaces | 3 | 169 | ~500 | ~30 | NOT STARTED |
| B: Server Core | 1 | 1,594 | ~2,200 | ~80 | NOT STARTED |
| C: Connection Layer | 2 | 359 | ~800 | ~45 | NOT STARTED |
| D: Support Systems | 3 | 415 | ~900 | ~50 | NOT STARTED |
| **Total** | **9** | **~2,537** | **~4,400** | **~205** | **NOT STARTED** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Protocol and Interfaces Foundation

**Status**: NOT STARTED (0/3)
**Complexity**: Low
**Blocked by**: Nothing (pure constants and interface definitions)
**Blocks**: Phase B (Server.ts uses ProtocolVersion constants + TraitInterfaces), Phase C (Connection.ts uses ProtocolVersion binary protocol definitions)

**Description**: Phase A establishes the protocol constants and trait interface contracts that the server core depends on. These three files have zero internal dependencies on each other and zero dependencies on the rest of the codebase -- they are pure type definitions and utility functions. `ProtocolVersion.ts` documents the complete binary protocol and exports the handshake/orders version constants plus the `OrderType` byte enum. `TraitInterfaces.ts` defines the 9 server trait interfaces (`IInterpretCommand`, `INotifySyncLobbyInfo`, `INotifyServerStart`, `INotifyServerEmpty`, `INotifyServerShutdown`, `IStartGame`, `IClientJoined`, `IEndGame`, `ITick`) plus the `ServerTrait` abstract base and `DebugServerTrait` debug implementation. `Exts.ts` is a single `except()` utility function.

**Paradigm Shifts**:
- C# `public static class ProtocolVersion` with `const int` fields -> TypeScript `export const` namespace with number constants
- C# interface methods with `Server` parameter -> TypeScript interfaces with `Server` type parameter (forward reference to Phase B via `import type`)
- C# `IEnumerable<T>.Except(T t)` LINQ extension -> TypeScript `Array.filter(x => x !== t)`
- C# XML-doc comments on protocol order types -> TypeScript JSDoc with `@see` references to original C# file
- C# `enum ReceiveState { Header, Data }` -> TypeScript `type ReceiveState = 'Header' | 'Data'`

#### 3.1.1 ProtocolVersion

- [ ] **TODO-18.A.1** `src/OpenRA.Game/Server/ProtocolVersion.ts` (82 lines C#) -- Binary protocol constants and documentation:
  - Export `Handshake = 7` and `Orders = 21` constants
  - Full JSDoc documenting the packet structure:
    - `[length: int32][clientId: int32][frame: int32][orders: byte[]]` framing
    - Maximum packet length: 131072 bytes (128 kB)
  - Order type byte constants as a const enum or namespace:
    - `SyncHash = 0x65`: `[hash: int32][defeatState: uint64]`
    - `Disconnect = 0xBF`: `[clientId: int32]`
    - `Handshake = 0xFE`: `[key: length-prefixed UTF-8 string][value: length-prefixed UTF-8 string]`
    - `WorldOrder = 0xFF`: `[orderName: length-prefixed string][orderFields: byte][orderData: variable]`
    - `Ack = 0x10`: `[frame: int32][count: byte]`
    - `Ping = 0x20`: `[timestamp: int64][queueLength: byte]`
    - `TickScale = 0x76`: `[scale: float32]`
  - Handshake flow documentation in JSDoc (Request -> Response -> Validate)
  - `export type ReceiveState = 'Header' | 'Data'` for Connection state machine
  - All multi-byte values documented as little-endian
  - Reference: `OpenRA/OpenRA.Game/Server/ProtocolVersion.cs`

#### 3.1.2 TraitInterfaces

- [ ] **TODO-18.A.2** `src/OpenRA.Game/Server/TraitInterfaces.ts` (63 lines C#) -- Server trait interfaces and base class:
  - `export interface IInterpretCommand { interpretCommand(server: Server, conn: Connection, client: SessionClient, cmd: string): boolean }`
  - `export interface INotifySyncLobbyInfo { lobbyInfoSynced(server: Server): void }`
  - `export interface INotifyServerStart { serverStarted(server: Server): void }`
  - `export interface INotifyServerEmpty { serverEmpty(server: Server): void }`
  - `export interface INotifyServerShutdown { serverShutdown(server: Server): void }`
  - `export interface IStartGame { gameStarted(server: Server): void }`
  - `export interface IClientJoined { clientJoined(server: Server, conn: Connection): void }`
  - `export interface IEndGame { gameEnded(server: Server): void }`
  - `export interface ITick { tick(server: Server): void }`
  - `export abstract class ServerTrait { }` -- empty base class for trait type grouping
  - `export class DebugServerTrait extends ServerTrait implements IInterpretCommand, IStartGame, INotifySyncLobbyInfo, INotifyServerStart, INotifyServerShutdown, IEndGame`:
    - `interpretCommand()` logs to console and returns `false` (not handled)
    - All other methods log method name via `console.log()`
  - Type imports: `Server` and `Connection` and `SessionClient` as forward type-only references (using `import type` to avoid circular dependencies)
  - Reference: `OpenRA/OpenRA.Game/Server/TraitInterfaces.cs`

#### 3.1.3 Exts

- [ ] **TODO-18.A.3** `src/OpenRA.Game/Server/Exts.ts` (24 lines C#) -- Server utility extensions:
  - `export function except<T>(array: readonly T[], item: T): T[]` -- returns new array excluding all occurrences of `item`
  - Implementation: `array.filter(x => x !== item)`
  - Used by `Server.ts` in lobby sync logic to exclude specific clients from broadcast lists
  - JSDoc: `/** Excludes a single element from an iterable. OpenRA match: Server/Exts.cs */`
  - Reference: `OpenRA/OpenRA.Game/Server/Exts.cs`

**Phase A Summary**: 3 files, ~169 C# lines. Target: `ProtocolVersion.ts` + `TraitInterfaces.ts` + `Exts.ts`. Estimated ~30 tests (~600 test lines). All three files are independent and can be parallel-assigned.

---

### 3.2 Phase B: Server Core

**Status**: NOT STARTED (0/1 + 1 support module)
**Complexity**: HIGHEST (1594 lines C#)
**Blocked by**: Phase A (ProtocolVersion constants, TraitInterfaces), Chapter 6 Phase A (Order, OrderManager types), Chapter 6 Phase C (Session types), Chapter 17 Phase A (GameInformation), Chapter 17 Phase B (ReplayRecorder), Chapter 17 Phase C (GameSave)
**Blocks**: Phase C (Connection.ts is constructed by Server, calls back to Server methods), Phase D (all support systems receive Server reference)

**Description**: The main `Server` class is the central orchestrator of the entire multiplayer subsystem. At 1594 lines, it is the single most complex file in Chapters 16-21. It manages the complete server lifecycle:

1. **Construction and Startup**: Creates WebSocket listener(s), initializes server traits from mod manifest, sets up `LobbyInfo` (Session), creates `MapStatusCache`, `PlayerMessageTracker`, `VoteKickTracker`, optionally creates `ReplayRecorder` for dedicated servers, starts the main server tick loop
2. **Client Lifecycle**: Accept incoming WebSocket connections, send handshake (protocol version + client ID + HandshakeRequest), validate client (mod/version match, password check, IP ban check, authentication), complete connection (assign slot, sync lobby, update client color/faction), drop client on disconnect/error
3. **Order Dispatch**: Receive orders from client, project frame number forward by `OrderLatency`, forward to all other clients (broadcast), send ack to originating client, record for replay, dispatch to `GameSave` if active
4. **Sync Hash Verification**: Collect per-frame sync hashes from all clients, compare byte-for-byte, detect desyncs (mismatch triggers `OutOfSync` which invalidates the replay), track player defeat states from sync hash payload
5. **Lobby Synchronization**: Sync lobby info (`SyncLobbyInfo`), clients (`SyncLobbyClients`), slots (`SyncLobbySlots`), global settings (`SyncLobbyGlobalSettings`) -- all dispatched as server orders to all clients
6. **Game Start**: Validate players (drop non-ready), initialize `GameInformation` and `worldPlayers`, create `OrderBuffer`, set `OrderLatency` from game speed, create `GameSave` if single-player, dispatch `StartGame` order, fast-forward saved frames if loading, inject empty latency-fill frames
7. **In-Game Loop**: Tick server traits, generate `TickScale` frames from `OrderBuffer` for connection quality management
8. **Chat and Commands**: Interpret server commands (via `IInterpretCommand` traits), enforce chat flood control (via `PlayerMessageTracker`), handle game save creation/loading, handle map generation
9. **End Game and Shutdown**: Call `EndGame()` on traits, dispose replay recorder, close all connections, call `ServerShutdown()` on traits

The biggest paradigm shift is replacing the thread-based event loop (`BlockingCollection<IServerEvent>` + `events.TryTake(out e, 1000)`) with async/await WebSocket event handlers. The `IServerEvent` inner classes (`ConnectionConnectEvent`, `ConnectionDisconnectEvent`, `ConnectionPacketEvent`, `ConnectionPingEvent`, `CallbackEvent`) become direct async function calls or event handler registrations. The multi-threaded synchronization primitives (`lock`, `volatile`, `ConcurrentDictionary`, `Interlocked.Exchange`) disappear entirely since JavaScript is single-threaded.

**Paradigm Shifts**:
- C# `TcpListener(listener) { listener.Start(); new Thread(acceptLoop).Start(); }` -> Node.js `new ws.WebSocketServer({ port })` with `wss.on('connection', handleConnection)`
- C# `new Thread(SendReceiveLoop)` per connection -> `ws` library handles this internally; WebSocket messages arrive as events
- C# `BlockingCollection<IServerEvent>` polling loop -> `ws` event handlers: `on('connection')`, `on('message')`, `on('close')`, `on('error')`
- C# `events.Add(new CallbackEvent(() => { ... }))` for async auth callback -> `async/await` with `Promise` chains, calling back to server methods directly
- C# `lock (LobbyInfo) { ... }` -> JavaScript single-threaded -- no locking needed in Node.js event loop; synchronized access is natural
- C# `volatile ServerState internalState` -> TypeScript `let state: ServerState` (single-threaded, no volatile needed)
- C# `Platform.SupportDir` for MOTD, save paths -> Node.js `process.cwd()` / configurable base path; browser Web Worker: IndexedDB for persistence
- C# `GeoIP.Initialize()`, `GeoIP.LookupCountry()`, `Nat.TryForwardPort()` -> NOP stubs in browser mode; optional `geoip-lite` npm package in Node.js mode
- C# `IPEndPoint`, `IPAddress` -> `string` host:port representation; `ws` provides `req.socket.remoteAddress`
- C# `Game.PerformDelayedActions()` -> `setTimeout(fn, 0)` per-frame deferred action drain
- C# `Stopwatch` -> `performance.now()` for monotonic sub-millisecond timing
- C# `ServerSettings` class with YAML-annotated properties -> TypeScript `ServerSettings` interface with matching fields

#### 3.2.0 SessionTypes Support Module

- [ ] **TODO-18.B.0** `src/OpenRA.Game/Server/SessionTypes.ts` -- Full Session type definitions (support module for Server.ts):
  - `export enum ConnectionQuality { Good = 0, Moderate = 1, Poor = 2 }`
  - `export enum ClientState { NotReady = 0, Ready = 1, Invalid = 2 }`
  - `export enum WinState { Undefined = 0, Won = 1, Lost = 2 }`
  - `export enum MapStatus { Playable = 1, Validating = 2, Incompatible = 4, UnsafeCustomRules = 8 }`
  - `export interface SessionClient` (20+ fields):
    - `index: number`, `name: string`, `ipAddress: string`, `anonymizedIPAddress?: string`, `location?: string`
    - `fingerprint?: string`, `preferredColor: number`, `color: number`, `faction: string`, `spawnPoint: number`, `team: number`
    - `handicap: number`, `slot?: string`, `bot?: string`, `botControllerClientIndex?: number`, `isAdmin: boolean`
    - `isObserver: boolean`, `state: ClientState`, `connectionQuality: ConnectionQuality`
    - Serialization: `serialize(): object`, `static deserialize(data: any): SessionClient`
  - `export interface SessionSlot`:
    - `playerReference: string`, `required: boolean`, `locked: boolean`, `closed: boolean`
    - Serialization: `serialize(): object`, `static deserialize(data: any): SessionSlot`
  - `export interface SessionGlobalSettings`:
    - `randomSeed: number`, `serverName: string`, `map: string`, `mapStatus: MapStatus`
    - `enableSingleplayer: boolean`, `enableMapGeneration: boolean`, `enableSyncReports: boolean`
    - `enableGameSaves: boolean`, `gameTimestep: number`, `allowSpectators: boolean`
    - `dedicated: boolean`, `gameUid: string`
    - `optionOrDefault(key: string, defaultValue: string): string`
    - Serialization: `serialize(): object`, `static deserialize(data: any): SessionGlobalSettings`
  - `export class Session`:
    - Properties: `globalSettings: SessionGlobalSettings`, `slots: Map<string, SessionSlot>`, `clients: SessionClient[]`
    - `disabledSpawnPoints: Set<number>`
    - `firstEmptySlot(): string | null` -- find first unoccupied slot
    - `clientWithIndex(index: number): SessionClient | null`
    - `nonBotClients: SessionClient[]` getter
    - Serialization: `serialize(): string` (JSON), `static deserialize(json: string): Session`
  - Reference: `OpenRA/OpenRA.Network/Session.cs`

#### 3.2.1 Server

- [ ] **TODO-18.B.1** `src/OpenRA.Game/Server/Server.ts` (1594 lines C#) -- Complete game server orchestrator. Since this is the most complex file, the implementation is divided into 8 sub-tasks:

**Sub-task 18.B.1a -- Transport Abstraction and Server Setup** (estimated ~200 lines):
  - Define `IServerTransport` interface:
    - `listen(port: number): Promise<void>` -- start listening
    - `onConnection: (handler: (transport: IClientTransport) => void) => void` -- register connection handler
    - `close(): Promise<void>` -- stop listening
    - `getLocalEndpoints(): string[]` -- get bound addresses for local connection
  - Define `IClientTransport` interface:
    - `send(data: Uint8Array): boolean` -- send binary frame to client
    - `onMessage: (handler: (data: Uint8Array) => void) => void`
    - `onClose: (handler: () => void) => void`
    - `onError: (handler: (err: Error) => void) => void`
    - `close(): void` -- disconnect client
    - `remoteAddress: string` -- client IP address
  - Implement `NodeWebSocketTransport` using `ws` library (for Node.js dedicated server):
    - `ws.WebSocketServer` for listening
    - Wrap each `ws.WebSocket` connection as `IClientTransport`
  - Implement `BrowserTransportStub` stub for Web Worker browser-hosted mode (accepts pre-connected connections via `MessageChannel`)
  - Server constructor: `constructor(transport: IServerTransport, settings: ServerSettings, modData: ModData, type: ServerType)`
    - Initialize `LobbyInfo = new Session()` with `RandomSeed`, `ServerName`, etc.
    - Initialize server traits from `modData.manifest.serverTraits` (array of `ServerTrait` class names, instantiated via object creator)
    - Create `MapStatusCache`, `PlayerMessageTracker`, `VoteKickTracker`
    - Optionally create `ReplayRecorder` for dedicated servers (`settings.recordReplays && type === ServerType.Dedicated`)
    - Register `transport.onConnection(handleConnection)`
    - Start main server tick loop via `setInterval(tick, 1000)` (1-second interval, matching C#)
  - Enums: `ServerState` (WaitingPlayers=1, GameStarted=2, ShuttingDown=3), `ServerType` (Local=0, Skirmish=1, Multiplayer=2, Dedicated=3)
  - Properties: `isMultiplayer` getter (`type === Dedicated || type === Multiplayer`), `map`, `mapPool`, `gameSave`, `orderLatency`, `generatedMapData`

**Sub-task 18.B.1b -- Client Connection and Validation** (estimated ~350 lines):
  - `handleConnection(transport: IClientTransport): void`:
    - Check `State === ServerState.WaitingPlayers`, return early otherwise
    - Generate auth token: 256 random bytes via `crypto.getRandomValues()` -> base64
    - Choose free player index via `chooseFreePlayerIndex()`
    - Create `Connection` object (Phase C): `new Connection(this, transport, playerIndex, authToken)`
    - Send handshake: binary frame `[ProtocolVersion.Handshake: int32][playerIndex: int32]`
    - Send `HandshakeRequest` order: Mod + Version + AuthToken via `dispatchOrdersToClient()`
    - Add connection to `Conns` list
  - `chooseFreePlayerIndex(): number` -- incrementing counter
  - `recordFakeHandshake(): void` -- creates fake handshake request/response for replay recording
  - `validateClient(newConn: Connection, data: string, name: string): void`:
    - Reject if `State === GameStarted` -> send `ServerError` + `ErrorGameStarted`
    - Parse `HandshakeResponse` from data string
    - Password check: `settings.password` vs `handshake.password` (send `RequiresPassword`/`IncorrectPassword`)
    - Mod check: compare `modData.manifest.id !== handshake.mod` -> send `IncompatibleMod`
    - Version check: compare `modData.manifest.metadata.version !== handshake.version` -> send `IncompatibleVersion`
    - Orders protocol check: `ProtocolVersion.Orders !== handshake.ordersProtocol` -> send `IncompatibleProtocol`
    - IP ban check: `settings.ban` and `tempBans` containing client IP -> send `Banned`/`TempBanned`
    - Authentication: for dedicated servers, delegate to `IAuthenticator` interface; for local/multiplayer, skip
    - `completeConnection()` inner function:
      - Assign slot via `LobbyInfo.firstEmptySlot()`
      - Set admin status (first client to join is admin)
      - If slot assigned: apply `SyncClientToPlayerReference()` for faction/color/spawn/team/handicap
      - If observer: set color to white
      - Set `newConn.validated = true`
      - Add client to `LobbyInfo.clients`
      - Apply join cooldown chat disable via `playerMessageTracker.disableChatUI()`
      - Fire `IClientJoined` trait hooks
      - Send generated map data to client if applicable
      - Call `syncLobbyInfo()`
      - Send join notification (`Joined` fluent message) to other clients
      - For dedicated servers: send MOTD file contents, singleplayer warning
      - Send custom rules warning if map has unsafe custom rules
  - `dropClient(toDrop: Connection): void`:
    - Remove from `orderBuffer?.removePlayer(toDrop.playerIndex)`
    - Remove from `Conns` list
    - Find `SessionClient` for the dropped player
    - Choose disconnect fluent message based on game state and client role:
      - In-game observer -> `ObserverDisconnected`
      - In-game team player -> `PlayerTeamDisconnected`
      - In-game non-team player -> `PlayerDisconnected`
      - Lobby -> `LobbyDisconnected`
    - Remove client and all bots it controlled from `LobbyInfo.clients`
    - Reassign admin if dedicated server: find next non-bot client, set `isAdmin = true`, send `NewAdmin` message
    - Send `Disconnect` order (0xBF byte + client index) to remaining clients
    - Update `GameInformation.disconnectFrame` for replay if game started
    - Fire `INotifyServerEmpty` if no valid clients remain
    - Sync lobby clients if players remain
    - Shutdown non-dedicated server if admin left
    - Dispose connection

**Sub-task 18.B.1c -- Order Dispatch and Sync Verification** (estimated ~400 lines):
  - Binary frame construction helpers (static utility functions):
    - `createFrame(client: number, frame: number, data: Uint8Array): Uint8Array` -- constructs `[dataLen+4: int32 LE][client: int32 LE][frame: int32 LE][data: bytes]`
    - `createAckFrame(frame: number, count: number): Uint8Array` -- constructs ack packet: `[6: int32][0: int32][frame: int32][0x10: byte][count: byte]`
    - `createTickScaleFrame(scale: number): Uint8Array` -- constructs tick scale packet: `[9: int32][0: int32][0: int32][0x76: byte][scale: float32 LE]`
    - All use `DataView` with `true` for littleEndian on multi-byte writes
  - `dispatchOrdersToClient(conn: Connection, client: number, frame: number, data: Uint8Array): void`:
    - Call `createFrame()` then `conn.trySendData()`
    - On failure: drop client and log
  - `dispatchOrdersToClients(conn: Connection, frame: number, data: Uint8Array): void`:
    - Create frame with originator's player index
    - Broadcast to all validated clients except originator: `Conns.filter(c => c !== conn && c.validated).forEach(...)`
    - Call `recordOrder(frame, data, conn.playerIndex)`
  - `dispatchServerOrdersToClients(data: Uint8Array, frame = 0): void`:
    - Server-originated orders use client ID 0
    - Broadcast to all validated clients
    - Call `recordOrder(frame, data, 0)`
  - `dispatchServerOrdersToClients(conns: readonly Connection[], data: Uint8Array, frame = 0): void`:
    - Overload: broadcast to specific connection subset (used for targeted fluent messages)
  - `receiveOrders(conn: Connection, frame: number, data: Uint8Array): void`:
    - Guard: connection must still be in `Conns` list
    - Frame 0: call `interpretServerOrders()` for handshake/command/chat/save lobby orders
    - Frame N+: if not a sync hash packet (data[0] !== 0x65), project frame += `orderLatency`, send ack to originator, add order timestamp to `orderBuffer`, update `conn.lastOrdersFrame`
    - Broadcast via `dispatchOrdersToClients()`
    - Dispatch to `gameSave?.dispatchOrders()` for recording if active
  - `interpretServerOrders(conn: Connection, data: Uint8Array): void`:
    - Deserialize orders from binary data via `Order.deserialize()`
    - For each order: call `interpretServerOrder(conn, order)`
  - `handleSyncOrder(frame: number, packet: Uint8Array): void`:
    - Check `syncForFrame` map for existing hash at this frame
    - If exists: byte-for-byte comparison. Mismatch triggers `outOfSync()`
    - If new: extract defeat state (uint64 at bytes 1-8, after 0x65 byte), compare with `lastDefeatState`
    - New defeat bits trigger `setPlayerDefeat()` for each newly defeated player
    - Store packet in `syncForFrame` map
  - `recordOrder(frame: number, data: Uint8Array, from: number): void`:
    - Forward to `recorder?.receiveFrame(from, frame, data)` if recorder active
    - If sync hash packet (data.length > 0 && data[0] === 0x65): call `handleSyncOrder()`
  - `outOfSync(frame: number): void`:
    - Log out-of-sync at frame
    - Invalidate replay: set `recorder.metadata = null` and dispose recorder

**Sub-task 18.B.1d -- Lobby Synchronization** (estimated ~200 lines):
  - `syncLobbyInfo(): void`:
    - Dispatches `SyncInfo` order with serialized `LobbyInfo.globalSettings.serialize()` via `dispatchServerOrdersToClients()`
    - Fires `INotifySyncLobbyInfo` trait hooks
    - Only when `State === ServerState.WaitingPlayers`
  - `syncLobbyClients(): void`:
    - Serialize all `LobbyInfo.clients` to JSON array via `client.serialize()`
    - Dispatch `SyncLobbyClients` order
    - Fire `INotifySyncLobbyInfo` trait hooks
    - Restart `pingUpdated` timer
    - Only when `State === ServerState.WaitingPlayers`
  - `syncLobbySlots(): void`:
    - Serialize all `LobbyInfo.slots` entries to JSON array via `slot.serialize()`
    - Dispatch `SyncLobbySlots` order
    - Fire `INotifySyncLobbyInfo` trait hooks
    - Only when `State === ServerState.WaitingPlayers`
  - `syncLobbyGlobalSettings(): void`:
    - Serialize `LobbyInfo.globalSettings.serialize()`
    - Dispatch `SyncLobbyGlobalSettings` order
    - Fire `INotifySyncLobbyInfo` trait hooks
    - Only when `State === ServerState.WaitingPlayers`
  - `receivePing(conn: Connection, pingHistory: number[]): void`:
    - Compute average latency: `pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length`
    - Classify connection quality: <240ms Good, <360ms Moderate, else Poor
    - Update `LobbyInfo.clients` for matching client and any bots they control
    - Every 5 seconds: dispatch `SyncConnectionQuality` order with per-client quality values
  - `mapStatusChanged(uid: string, status: MapStatus): void`:
    - If current map matches uid: update `LobbyInfo.globalSettings.mapStatus`
    - Call `syncLobbyInfo()`

**Sub-task 18.B.1e -- Game Start and End** (estimated ~350 lines):
  - `startGame(): void`:
    - Drop non-ready clients: filter `Conns` for unvalidated or invalid-state clients, send `YouWereKicked`, call `dropClient()`
    - Enable game saves for singleplayer only: `LobbyInfo.nonBotClients.length === 1` and not dedicated
    - Initialize `worldPlayers` array via server create-players logic
    - Create `GameInformation` object with: mod id, version, map uid, map title, start time
    - For generated maps: store `mapGenerationArgs` in game info
    - Add all non-null world players to `gameInfo.players`
    - If recorder active: `recorder.metadata = new ReplayMetadata(gameInfo)`
    - Sync lobby info one final time
    - Get game speed from lobby settings or default
    - Create `OrderBuffer`, start with game speed timestep and validated player indices
    - Set `State = ServerState.GameStarted`
    - For multiplayer: set `orderLatency = gameSpeed.orderLatency`
    - Set `LobbyInfo.globalSettings.gameTimestep = gameSpeed.timestep`
    - Create `GameSave` if single-player and no existing save
    - If `GameSave` exists: call `gameSave.startGame(LobbyInfo, Map)`
    - If loading a save: serialize `SaveLastOrdersFrame` and `SaveSyncFrame` for StartGame order data
    - Dispatch `StartGame` order to all clients
    - Fire `IStartGame` trait hooks
    - If loading a save: fast-forward saved frames via `gameSave.parseOrders()`, dispatching each order to clients
    - Inject empty latency-fill frames: for each client x `OrderLatency` ticks, send empty-frame orders to all clients, record to recorder and game save
  - `endGame(): void`:
    - Fire `IEndGame` trait hooks on all server traits
    - Dispose `recorder` (calls ReplayRecorder.dispose which writes metadata footer)
    - Set `recorder = null`
  - `shutdown(): void`:
    - Set `State = ServerState.ShuttingDown`
    - Main loop detects and triggers endGame() + trait shutdown + connection disposal

**Sub-task 18.B.1f -- Chat, Commands, and Save/Load** (estimated ~200 lines):
  - `sendOrderTo(conn: Connection, order: string, data: string): void` -- convenience: `Order.fromTargetString(order, data, true).serialize()` -> dispatch
  - `sendFluentMessage(key: string, ...args: unknown[]): void` -- broadcast to all clients
  - `sendFluentMessageTo(conn: Connection, key: string, args?: unknown[]): void` -- unicast to one client
  - `sendFluentMessage(conns: readonly Connection[], key: string, ...args: unknown[]): void` -- broadcast to connection subset
  - `interpretCommand(command: string, conn: Connection): boolean`:
    - Delegate to all `IInterpretCommand` traits
    - Return true if any trait handled it, else false
    - Unhandled: log and send `UnknownServerCommand` fluent message
  - `interpretServerOrder(conn: Connection, o: Order): void` -- handle frame-0 orders:
    - If `!conn.validated`: only accept `HandshakeResponse`, reject everything else
    - `HandshakeResponse` -> call `validateClient()`
    - `Command` -> call `interpretCommand()`
    - `Chat` -> if not flood-limited: broadcast to all clients
    - `GameSaveTraitData` -> parse data, call `gameSave.addTraitData(traitIndex, data)`
    - `CreateGameSave` -> sanitize filename, save via `gameSave.save()`, dispatch `GameSaved` order
    - `LoadGameSave` -> load from file, restore GlobalSettings and Slots, remap clients to slots, sync lobby clients
    - `GenerateMap` -> admin-only, parse MapGenerationArgs, update map preview, dispatch to clients
  - `getClient(conn: Connection): SessionClient | null` -- lookup via `LobbyInfo.clientWithIndex(conn.playerIndex)`
  - `hasClientWonOrLost(client: SessionClient): boolean` -- check `worldPlayers` for non-Undefined outcome
  - `writeLineWithTimeStamp(line: string): void` -- `console.log([${timestamp}] ${line})` with settings timestamp format

**Sub-task 18.B.1g -- Player Defeat and Win State Tracking** (estimated ~100 lines):
  - `setPlayerDefeat(playerIndex: number): void`:
    - Look up `worldPlayers[playerIndex]`
    - Set outcome to `WinState.Lost` with `OutcomeTimestampUtc = new Date()`
    - Call `anyUndefinedWinStates()`: if only one team remains undefeated, set all remaining players to `WinState.Won`
  - `anyUndefinedWinStates(): boolean`:
    - Filter `gameInfo.players` for `WinState.Undefined`
    - Track `lastTeam`: if consecutive player team changes and is non-zero, multi-team undefeated
    - Return true if multiple teams still undefined, false if all same team or all team-0 (FFA)
  - `mapIsKnown(uid: string): boolean` -- validates map uid against MapCache, optionally filtered by MapPool
  - `mapIsUnknown(uid: string): boolean` -- inverse of mapIsKnown
  - `getEndpointForLocalConnection(): ConnectionTarget` -- returns loopback addresses for local game connection
  - `syncClientToPlayerReference(c: SessionClient, pr: PlayerReference): void` -- static utility:
    - Apply locked faction, spawn, team, handicap, color from player reference to client

**Sub-task 18.B.1h -- Type Definitions and Configuration** (estimated ~100 lines):
  - Define `ServerSettings` interface:
    - `name: string`, `listenPort: number`, `password?: string`
    - `recordReplays: boolean`, `enableSingleplayer: boolean`
    - `enableMapGeneration: boolean`, `enableSyncReports: boolean`
    - `enableGeoIP: boolean`, `enableLintChecks: boolean`
    - `shareAnonymizedIPs: boolean`, `requireAuthentication: boolean`
    - `ban: string[]`, `profileIDWhitelist: number[]`, `profileIDBlacklist: number[]`
    - `floodLimitMessageCount: number` (default 5), `floodLimitCooldown: number` (default 5000ms)
    - `floodLimitInterval: number` (default 10000ms), `floodLimitJoinCooldown: number` (default 1000ms)
    - `voteKickTimer: number` (default 30000ms), `voteKickerCooldown: number` (default 60000ms)
    - `timestampFormat: string` (default 'yyyy-MM-dd HH:mm:ss')
  - Define `IAuthenticator` interface (for dedicated server auth):
    - `verifyAuthToken?(ipAddress: string, fingerprint: string, token: string, signature: string): Promise<AuthResult>`
  - Define `ConnectionTarget` type for local connection endpoints
  - Define `GameSpeed` type with `timestep: number`, `orderLatency: number`

**Performance and Correctness Notes**:
- `syncForFrame: Map<number, Uint8Array>` -- per-frame sync hash storage, byte-for-byte comparison
- No per-frame heap allocation in hot paths: reuse `Uint8Array` buffers and `DataView` wrappers where possible
- Connection list copy via `[...Conns]` before iteration (the array can mutate during iteration from dropClient)
- `DataView` little-endian on all multi-byte writes; validate with known reference frames from C# output
- `RecordOrder` checks for sync hash packet by examining `data[0]` byte before forwarding

**Phase B Summary**: 1 core file + 1 support module. Target: `SessionTypes.ts` + `Server.ts`. Estimated ~80 tests (~3,000 test lines). This is the most complex single-file migration in Chapters 16-21 and requires deep familiarity with both the C# server architecture and Node.js WebSocket APIs. Developer should implement sub-tasks in order (a -> b -> c -> d -> e -> f -> g -> h).

---

### 3.3 Phase C: Connection Layer

**Status**: NOT STARTED (0/2)
**Complexity**: Low-Medium
**Blocked by**: Phase A (ProtocolVersion constants for binary protocol), Phase B (Server type reference for callback signatures)
**Blocks**: Nothing (leaf node from a dependency perspective)

**Description**: Phase C implements the per-connection socket management and dynamic order timing systems. `Connection.ts` manages the WebSocket message loop for a single client -- receiving messages, parsing the packet header/data state machine, handling ping measurements internally, and managing the send queue. `OrderBuffer.ts` implements dynamic order timing: tracking per-player order timestamps, computing median deltas against the fastest connection (baseline player), and producing per-player `TickScale` values (1.0-1.1 range) to slow down fast connections so slow connections can keep up.

In the WebSocket world, `Connection.ts` is dramatically simplified compared to the C# version: the `SendReceiveLoop` thread with its `socket.Poll()` / `socket.Receive()` / `socket.Send()` pattern becomes simple event handlers (`ws.on('message', handleMessage)`). The `sendQueue: BlockingCollection<byte[]>` becomes a simple array with immediate send attempts. The non-blocking send with fallback to blocking send disappears entirely since WebSocket handles buffering internally.

**Paradigm Shifts**:
- C# `new Thread(SendReceiveLoop)` with `receiveBuffer`, `readBuffer`, `state` machine -> `ws.on('message', (data: Buffer) => { ... })` event handler with same state machine logic but different delivery guarantees
- C# `socket.Poll(100000, SelectMode.SelectRead)` -> implicit in WebSocket event loop (no polling needed)
- C# `socket.Receive(receiveBuffer)` partial read handling (`readBuffer.AddRange`) -> WebSocket delivers complete messages, but the state machine must still handle multi-packet buffering (a single `message` event may contain multiple protocol-level packets)
- C# `socket.Send(data, start, length, SocketFlags.None, out error)` + fallback to blocking send -> `transport.send(data)` -- WebSocket handles buffering and backpressure internally
- C# `BlockingCollection<byte[]>` send queue with `CompleteAdding()` for shutdown -> `ws.close()` called from `dispose()`; any in-flight sends complete before close
- C# `MemoryStream` for frame construction -> `DataView` + `Uint8Array`
- C# `Stopwatch` for ping timing and connection timer -> `performance.now()` and `Date.now()`
- C# `ConcurrentDictionary<int, long>` / `ConcurrentDictionary<int, Queue<long>>` -> `Map<number, number>` / `Map<number, number[]>` (single-threaded, no concurrent access)
- C# `Interlocked.Exchange(ref baselinePlayer, newBaseline)` -> direct assignment `this.baselinePlayer = newBaseline` (single-threaded)

#### 3.3.1 Connection (Server-Side)

- [ ] **TODO-18.C.1** `src/OpenRA.Game/Server/Connection.ts` (220 lines C#) -- Per-client WebSocket connection handler:
  - Constants: `MaxOrderLength = 131072` (128 kB), `MaxPingSamples = 15` (seconds of ping history)
  - Properties: `playerIndex: number`, `authToken: string`, `endPoint: string`, `connectionTimer: number` (set to `Date.now()` at construction), `validated: boolean`, `lastOrdersFrame: number`, `timeoutMessageShown: boolean`
  - `timeSinceLastResponse: number` getter -- computes `Date.now() - lastReceivedTime`
  - Private state: `lastReceivedTime = Date.now()`, `pingHistory: number[]` (queue, max `MaxPingSamples` elements)
  - Internal state machine: `readBuffer: Uint8Array`, `state: ReceiveState = 'Header'`, `expectLength = 8`
  - `constructor(server: Server, transport: IClientTransport, playerIndex: number, authToken: string)`:
    - Store references: `server`, `transport`, `playerIndex`, `authToken`
    - Set `endPoint = transport.remoteAddress`
    - Register `transport.onMessage(handleMessage)`
    - Register `transport.onClose(handleClose)`
    - Register `transport.onError(handleError)`
    - Start ping timer: `setInterval(() => sendPing(), 1000)`
  - `createPingFrame(): Uint8Array` -- static method, creates 13-byte ping packet: `[13: int32 LE][0: int32 LE][0: int32 LE][0x20: byte][Date.now() as int64 LE]`
  - `handleMessage(data: Uint8Array): void` -- the main receive state machine:
    - Concatenate received data to `readBuffer`
    - `lastReceivedTime = Date.now()`
    - `timeoutMessageShown = false`
    - While `readBuffer.length >= expectLength`:
      - Extract `bytes = readBuffer.slice(0, expectLength)`
      - Remove consumed bytes: `readBuffer = readBuffer.slice(expectLength)`
      - **Header state** (`expectLength === 8`):
        - Parse header: `expectLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, true) - 4`
        - `frame = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getInt32(0, true)`
        - Transition `state = 'Data'`
        - Validate `expectLength >= 0 && (server.isMultiplayer ? expectLength <= MaxOrderLength : true)`
        - Invalid: log and close connection
      - **Data state** (`state === 'Data'`):
        - If ping packet (`expectLength === 10 && bytes[0] === 0x20`):
          - Parse: `pingTimestamp` from bytes 1-8 via DataView getBigInt64 LE, `queueLength = bytes[9]`
          - `pingHistory.push(Date.now() - pingTimestamp)`
          - If `pingHistory.length > MaxPingSamples`: shift oldest
          - Call `server.onConnectionPing(this, [...pingHistory], queueLength)`
        - Else: call `server.onConnectionPacket(this, frame, bytes)`
        - Reset: `expectLength = 8`, `state = 'Header'`
  - `trySendData(data: Uint8Array): boolean`:
    - Delegate to `transport.send(data)`
    - Return `true` on success, `false` on failure
  - `dispose(): void`:
    - Clear ping timer via `clearInterval`
    - Call `transport.close()` to close WebSocket
  - Event handler cleanup:
    - `handleClose()`: calls `server.onConnectionDisconnect(this)`
    - `handleError(err: Error)`: logs error, calls `handleClose()`
  - Reference: `OpenRA/OpenRA.Game/Server/Connection.cs`

#### 3.3.2 OrderBuffer

- [ ] **TODO-18.C.2** `src/OpenRA.Game/Server/OrderBuffer.ts` (139 lines C#) -- Dynamic order timing system:
  - Constants: `NumberOfFrames = 20`, `Interval = 1000` (1 second), `MaxTickScale = 1.1` (10% max slowdown)
  - `EmptyValue = -1` sentinel for "no timestamp recorded yet"
  - Internal state: `gameTimer: number` (set via `performance.now()`), `nextUpdate: number`, `timestep: number`, `ticksPerInterval: number`, `baselinePlayer: number`, `players: number[]`
  - `timestamps: Map<number, number>` -- playerIndex -> last tick timestamp (-1 = empty)
  - `deltas: Map<number, number[]>` -- playerIndex -> queue of delta values
  - `addOrderTimestamp(playerIndex: number): void`:
    - Set `timestamps.set(playerIndex, performance.now())`
    - Check: if all timestamps values are !== EmptyValue:
      - Get `baseline = timestamps.get(baselinePlayer)!`
      - For each `[player, timestamp]` in timestamps:
        - `dt = baseline - timestamp`
        - `deltas.get(player)!.push(dt)`
        - If queue length > `NumberOfFrames`: shift oldest
        - `timestamps.set(player, EmptyValue)`
  - `start(gameSpeed: GameSpeed, players: number[]): void`:
    - Store `timestep`, `ticksPerInterval = Interval / timestep`, `players`
    - Set `baselinePlayer = players[0]`
    - Initialize timestamps (all `EmptyValue`) and deltas (all empty `[]`)
    - `gameTimer = performance.now()`; `nextUpdate = gameTimer + Interval`
  - `getTickScales(): Array<{ playerIndex: number; tickScale: number }>`:
    - `const now = performance.now()`
    - If `now < nextUpdate`: return `[]`
    - `nextUpdate = now + Interval`
    - If any delta queue is empty or length < `NumberOfFrames`: return `[]`
    - Compute median for each player's delta queue via `median()`
    - Find minimum median value (slowest connection relative to baseline)
    - Compute `offset = minValue < 0 ? Math.abs(minValue) : 0`
    - For each player:
      - `deltaPerTick = (median + offset) / ticksPerInterval`
      - `tickScale = (timestep + deltaPerTick) / timestep`
      - `adjustedTickScale = Math.max(1.0, Math.min(MaxTickScale, tickScale))`
      - Collect `{ playerIndex, tickScale: adjustedTickScale }`
    - Return collected results
  - `removePlayer(playerIndex: number): void`:
    - `players = players.filter(p => p !== playerIndex)`
    - If removed player was `baselinePlayer` and players remain: `baselinePlayer = players[0]`
    - `timestamps.delete(playerIndex)`
    - `deltas.delete(playerIndex)`
  - `static median(a: number[]): number`:
    - Create sorted copy: `[...a].sort((x, y) => x - y)`
    - `const n = a.length`
    - If odd: `sorted[Math.floor(n / 2)]`
    - If even: `(sorted[(n - 1) / 2] + sorted[n / 2]) / 2`
  - Reference: `OpenRA/OpenRA.Game/Server/OrderBuffer.cs`

**Phase C Summary**: 2 files, ~359 C# lines. Target: `Connection.ts` + `OrderBuffer.ts`. Estimated ~45 tests (~1,200 test lines). Both files can be parallel-assigned after Phase A+B are complete.

---

### 3.4 Phase D: Server Support Systems

**Status**: NOT STARTED (0/3)
**Complexity**: Low
**Blocked by**: Phase B (Server type reference for callback signatures + ServerSettings)
**Blocks**: Nothing (leaf nodes)

**Description**: Phase D contains three independent support systems that enhance server functionality. `VoteKickTracker` manages the vote-to-kick lifecycle: starting votes, counting eligible player votes, enforcing vote-kick cooldowns, handling edge cases (admin dead but online, single-player eligibility), and ending votes on success/timeout. `MapStatusCache` caches map validation status with async linting for remote maps. `PlayerMessageTracker` enforces chat flood control with join cooldowns and message count limits.

All three files are pure logic with no rendering or binary protocol dependencies -- they only call back to `Server` methods (`sendFluentMessage`, `dispatchServerOrdersToClients`, `getClient`). They are the simplest files in Chapter 18 and can all be parallel-assigned.

**Paradigm Shifts**:
- C# `Dictionary<int, bool>` vote tracker -> `Map<number, boolean>` (single-threaded)
- C# `(Session.Client, Connection)` value tuples -> object `{ client: SessionClient; conn: Connection }`
- C# `ThreadPool.QueueUserWorkItem(_ => RunLintTests(map, rules))` -> `setTimeout(() => runLintTests(map, rules), 0)` or `queueMicrotask()` for non-blocking async dispatch
- C# `List<long>.RemoveAll(t => t + interval < time)` -> `array.filter(t => t + interval >= time)` with reassignment
- C# `Stopwatch` for vote timer -> `performance.now()` / `Date.now()`
- C# `Dictionary<MapPreview, Session.MapStatus>` -> `Map<MapPreview, MapStatus>`
- C# `Action<string, Session.MapStatus> onStatusChanged` callback -> TypeScript `(uid: string, status: MapStatus) => void`

#### 3.4.1 VoteKickTracker

- [ ] **TODO-18.D.1** `src/OpenRA.Game/Server/VoteKickTracker.ts` (223 lines C#) -- Vote-to-kick system:
  - Fluent message key constants: `InsufficientVotes`, `AlreadyVoted`, `VoteKickStarted`, `UnableToStartAVote`, `VoteKickProgress`, `VoteKickEnded`
  - Properties: `server: Server` (back-reference), `voteTracker: Map<number, boolean>`, `failedVoteKickers: Map<SessionClient, number>`
  - `voteKickTimer: number | null` (millisecond timestamp when vote started, null = no active vote)
  - `kickee: { client: SessionClient; conn: Connection } | null`
  - `voteKickerStarter: { client: SessionClient; conn: Connection } | null`
  - `constructor(server: Server)` -- store server reference
  - `clientHasPower(client: SessionClient): boolean` -- admin OR (not observer AND not hasClientWonOrLost)
  - `tick(): void`:
    - If `voteKickTimer === null`: return
    - If kickee's connection no longer in `server.Conns`: call `endKickVote()`
    - If `Date.now() - voteKickTimer > server.settings.voteKickTimer`: call `endKickVoteAndBlockKicker()`
  - `voteKick(conn: Connection, kicker: SessionClient, kickeeConn: Connection, kickee: SessionClient, kickeeID: number, vote: boolean): boolean`:
    - **Precondition validation**:
      - Server must be in `GameStarted` state
      - Kickee cannot be admin (unless dedicated server)
      - Cannot start vote with a downvote (`!voteInProgress && !vote`)
      - Cannot start vote for different kickee when vote in progress
      - Kicker must have `clientHasPower(kicker)`
      - Any violation: send `UnableToStartAVote`, return false
    - **Eligibility counting**:
      - Iterate all `server.Conns`: count eligible players, track kickee online, track dead admin online
      - If kickee not online: `endKickVote()`, return false
    - **Edge cases**: Handle single-player admin kicking observers, insufficient eligible players
    - **Vote start** (if not in progress): check cooldown, start timer, send `VoteKickStarted`, dispatch `StartKickVote` order
    - **Vote recording**: prevent double vote, store in `voteTracker`
    - **Vote counting**: include kickee in eligible count, compute `votesNeeded = floor(eligiblePlayers / 2) + 1`
    - **Resolution**: threshold reached -> `endKickVote(false)` return true; impossible -> `endKickVoteAndBlockKicker()` return false
  - `endKickVoteAndBlockKicker(): void` -- record failed vote for starter's cooldown
  - `endKickVote(sendMessage = true): void` -- send `VoteKickEnded`, dispatch `EndKickVote`, clear state
  - Reference: `OpenRA/OpenRA.Game/Server/VoteKickTracker.cs`

#### 3.4.2 MapStatusCache

- [ ] **TODO-18.D.2** `src/OpenRA.Game/Server/MapStatusCache.ts` (106 lines C#) -- Map validation status cache:
  - `export interface ILintServerMapPass { run(emitError: (msg: string) => void, emitWarning: (msg: string) => void, modData: ModData, map: MapPreview, mapRules: Ruleset): void }`
  - Properties: `cache: Map<MapPreview, MapStatus>`, `onStatusChanged: (uid: string, status: MapStatus) => void`
  - `enableRemoteLinting: boolean` -- only enabled for dedicated servers with lint checks on
  - `modData: ModData` reference
  - `constructor(modData: ModData, onStatusChanged: (uid: string, status: MapStatus) => void, enableRemoteLinting: boolean)`
  - `runLintTests(map: MapPreview, rules: Ruleset): void`:
    - Enumerate all `ILintServerMapPass` implementations from `modData.objectCreator`
    - For each: instantiate and call `run()` with error/warning callbacks
    - On error callback: log and set `failed = true`
    - Catch exceptions from individual passes -> log as lint error
    - Update status: clear `Validating` flag; set `Incompatible` if failed, else `Playable`
    - Call `onStatusChanged(map.uid, status)`
  - `getStatus(map: MapPreview): MapStatus` (public method, serves as indexer):
    - Check cache, load ruleset if needed
    - Determine initial status: `Validating` if remote + linting enabled, else `Playable`
    - Handle load exceptions, unsafe custom rules check, player count check
    - Store in cache
    - If status includes `Validating`: dispatch lint as microtask: `queueMicrotask(() => runLintTests(map, rules))`
    - Return status
  - Reference: `OpenRA/OpenRA.Game/Server/MapStatusCache.cs`

#### 3.4.3 PlayerMessageTracker

- [ ] **TODO-18.D.3** `src/OpenRA.Game/Server/PlayerMessageTracker.ts` (86 lines C#) -- Chat flood control:
  - Properties: `server: Server`, `messageTracker: Map<number, number[]>` (playerIndex -> array of message timestamps)
  - `dispatchOrdersToClient` and `sendFluentMessageTo` functions (bound from Server instance)
  - `constructor(server: Server, dispatchOrdersToClient: ..., sendFluentMessageTo: ...)`
  - `disableChatUI(conn: Connection, time: number): void` -- dispatch `DisableChatEntry` order
  - `isPlayerAtFloodLimit(conn: Connection): boolean`:
    - Get or create tracker array for player
    - Admin bypass: `server.getClient(conn)?.isAdmin` -> return `false` immediately
    - Expire old entries via filter
    - Join cooldown check: block if within `floodLimitJoinCooldown`
    - Message count check: block if at or above `floodLimitMessageCount`
    - Add current timestamp, apply cooldown if at limit after adding
    - Return `false` (message allowed)
  - Reference: `OpenRA/OpenRA.Game/Server/PlayerMessageTracker.cs`

**Phase D Summary**: 3 files, ~415 C# lines. Target: `VoteKickTracker.ts` + `MapStatusCache.ts` + `PlayerMessageTracker.ts`. Estimated ~50 tests (~1,200 test lines). All three files are independent and can be parallel-assigned after Phase B is complete.

---

## 4. Dependency Graph

```
Chapters 2-7 + Chapter 17 (COMPLETE -- Foundation)
  │
  ├── Phase A (ProtocolVersion + TraitInterfaces + Exts: 3 files)
  │     │
  │     └── Phase B (Server.ts + SessionTypes.ts: 1 + 1 files)
  │           │    also depends on: Ch6 Phase A (Order, Connection client-side),
  │           │    Ch6 Phase C (Session/Ruleset), Ch17 Phase A (GameInformation),
  │           │    Ch17 Phase B (ReplayRecorder), Ch17 Phase C (GameSave)
  │           │
  │           ├── Phase C (Connection.ts + OrderBuffer.ts: 2 files)
  │           │     └── (leaf -- nothing depends on connection layer)
  │           │
  │           └── Phase D (VoteKickTracker + MapStatusCache + PlayerMessageTracker: 3 files)
  │                 └── (leaf -- nothing depends on support systems)
  │
  └── Phase C (Connection.ts references ProtocolVersion.OrderType constants from Phase A)
  └── Phase C (OrderBuffer.ts depends only on GameSpeed type definition, no Server dependency)

Internal Dependencies:

  ProtocolVersion.cs ──── (pure constants, no code deps -- Phase A)
  TraitInterfaces.cs ──── (pure interfaces + DebugServerTrait, forward-refs to Server/Connection -- Phase A)
  Exts.cs ─────────────── (pure utility function, no deps -- Phase A)
  SessionTypes.ts ─────── (pure type definitions, no internal deps -- Phase B support)
  Server.cs ───────────── ProtocolVersion.cs + TraitInterfaces.cs + Exts.cs + SessionTypes.ts +
                           Order types (Ch6A) + Session types (Ch6C) +
                           GameInformation (Ch17A) + ReplayRecorder (Ch17B) +
                           GameSave (Ch17C) + MapCache/MapPreview (Ch4)
  Connection.cs ───────── ProtocolVersion.cs (Phase A), Server type (Phase B), IClientTransport
  OrderBuffer.cs ──────── GameSpeed type definition
  VoteKickTracker.cs ──── Server type (Phase B), SessionClient, Connection, FluentMessage
  MapStatusCache.cs ───── ModData (Ch5), MapPreview (Ch4), Ruleset (Ch6), ILintServerMapPass
  PlayerMessageTracker.cs ─ Server type (Phase B), Connection, FluentMessage, DisableChatEntry order
```

### 4.1 Critical Path

```
Phase A ──→ Phase B ──→ Phase C (parallel with Phase D)
```

Total serial depth: **3 phases** (A -> B -> C/D, where C and D can run in parallel after B).

### 4.2 Parallelization Opportunities

| Parallel Group | Files | Blocking Dependency |
|:---|:---|:---|
| Group 1 (Phase A) | ProtocolVersion.ts, TraitInterfaces.ts, Exts.ts | All independent -- can be done simultaneously |
| Group 2 (Phase B support) | SessionTypes.ts | Can start before Phase A completes (no dependencies) |
| Group 3 (Phase B core) | Server.ts | Phase A complete + SessionTypes.ts available |
| Group 4 (Phase C) | Connection.ts, OrderBuffer.ts | Phase B complete |
| Group 5 (Phase D) | VoteKickTracker.ts, MapStatusCache.ts, PlayerMessageTracker.ts | Phase B complete |

Maximum parallel agents: **5** -- three Phase A files simultaneously + SessionTypes.ts in parallel, then Phase C (2 files) in parallel with Phase D (3 files).

### 4.3 Key Inter-Phase Dependency Constraints

| Dependency | Constraint |
|:---|:---|
| ProtocolVersion constants | Must migrate before Server and Connection (both reference `Handshake`, `Orders`, order type bytes) |
| TraitInterfaces | Must migrate before Server (constructor iterates `serverTraits`, fires interface methods) |
| SessionTypes | Should exist before or early in Server.ts development (Server constructor creates Session instances) |
| Server.ts | Must migrate before Phase C and D (Connection + support systems receive `Server` as parameter) |
| OrderBuffer | Needs `GameSpeed` type with `timestep` property -- currently a stub in `World.ts`; refine during Phase B |
| GameSave + ReplayRecorder | Already migrated in Ch17 -- Server.ts integrates directly with these classes |
| IClientTransport | Defined in Server.ts (Phase B); used by Connection.ts (Phase C) |

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All 9 files are pure logic (no GPU rendering), making them ideal for unit testing. Babylon.js mocking is not required. WebSocket mocking is needed for Server.ts and Connection.ts tests -- use a mock implementation of `IServerTransport` and `IClientTransport`.

#### Phase A Tests

- [ ] **TEST-18.A.1** ProtocolVersion -- all constants have correct values matching OpenRA C# source (verify `Handshake=7`, `Orders=21`)
- [ ] **TEST-18.A.2** ProtocolVersion -- OrderType bytes have correct hex values (0x65, 0xBF, 0xFE, 0xFF, 0x10, 0x20, 0x76)
- [ ] **TEST-18.A.3** ProtocolVersion -- MaxOrderLength derived as 131072
- [ ] **TEST-18.A.4** TraitInterfaces -- DebugServerTrait logs method names to console on each lifecycle call
- [ ] **TEST-18.A.5** TraitInterfaces -- DebugServerTrait.interpretCommand() returns false (unhandled)
- [ ] **TEST-18.A.6** Exts -- `except([1, 2, 3], 2)` returns `[1, 3]`
- [ ] **TEST-18.A.7** Exts -- `except([1], 1)` returns `[]`
- [ ] **TEST-18.A.8** Exts -- `except([1, 1, 2], 1)` returns `[2]` (removes all occurrences)

#### Phase B Tests

- [ ] **TEST-18.B.1** Server construction -- initializes with correct ServerState (WaitingPlayers)
- [ ] **TEST-18.B.2** Server construction -- creates LobbyInfo with RandomSeed, ServerName, GameUid
- [ ] **TEST-18.B.3** Server construction -- creates MapStatusCache, PlayerMessageTracker, VoteKickTracker
- [ ] **TEST-18.B.4** Server construction -- for dedicated servers with recordReplays, creates ReplayRecorder and records fake handshake
- [ ] **TEST-18.B.5** Server construction -- fires INotifyServerStart on all traits during startup
- [ ] **TEST-18.B.6** Client handshake -- sends correct binary frame `[ProtocolVersion.Handshake: int32][playerIndex: int32]`
- [ ] **TEST-18.B.7** Client handshake -- sends HandshakeRequest with Mod, Version, AuthToken
- [ ] **TEST-18.B.8** Client validation -- rejects when State = GameStarted (sends ServerError + kicks)
- [ ] **TEST-18.B.9** Client validation -- rejects wrong password (sends AuthenticationError + kicks)
- [ ] **TEST-18.B.10** Client validation -- rejects mismatched Mod (sends ServerError IncompatibleMod + kicks)
- [ ] **TEST-18.B.11** Client validation -- rejects mismatched Version (sends ServerError IncompatibleVersion + kicks)
- [ ] **TEST-18.B.12** Client validation -- rejects incompatible Orders protocol (sends ServerError IncompatibleProtocol + kicks)
- [ ] **TEST-18.B.13** Client validation -- rejects banned IP (sends ServerError + kicks)
- [ ] **TEST-18.B.14** Client validation -- completes connection for valid client: assigns slot, sets admin, syncs lobby
- [ ] **TEST-18.B.15** Client validation -- applies SyncClientToPlayerReference for locked faction/color/team/handicap
- [ ] **TEST-18.B.16** Client drop -- removes from Conns, LobbyInfo.clients, orderBuffer
- [ ] **TEST-18.B.17** Client drop -- sends Disconnect order (0xBF byte + client index) to remaining clients
- [ ] **TEST-18.B.18** Client drop -- reassigns admin if dedicated server and admin disconnected
- [ ] **TEST-18.B.19** Client drop -- fires INotifyServerEmpty when no valid clients remain
- [ ] **TEST-18.B.20** Client drop -- updates GameInformation disconnect frame for replay
- [ ] **TEST-18.B.21** Order dispatch -- `dispatchOrdersToClients` forwards to all other clients, excludes originator
- [ ] **TEST-18.B.22** Order dispatch -- `dispatchServerOrdersToClients` broadcasts to all clients (from=0)
- [ ] **TEST-18.B.23** Order dispatch -- `receiveOrders` projects frame += OrderLatency for non-sync orders
- [ ] **TEST-18.B.24** Order dispatch -- `receiveOrders` sends Ack frame back to originator with projected frame
- [ ] **TEST-18.B.25** Order recording -- forwards to ReplayRecorder via `recordOrder`
- [ ] **TEST-18.B.26** Sync hash -- `handleSyncOrder` matches identical sync packets, stores in syncForFrame
- [ ] **TEST-18.B.27** Sync hash -- `handleSyncOrder` detects byte mismatch -> calls OutOfSync (invalidates replay)
- [ ] **TEST-18.B.28** Sync hash -- `handleSyncOrder` extracts defeat state uint64, detects new defeats, calls setPlayerDefeat
- [ ] **TEST-18.B.29** Player defeat -- `setPlayerDefeat` sets player outcome to Lost with timestamp
- [ ] **TEST-18.B.30** Player defeat -- when only one team has Undefined players, all remaining players win
- [ ] **TEST-18.B.31** Lobby sync -- `syncLobbyInfo` dispatches SyncInfo only when State = WaitingPlayers
- [ ] **TEST-18.B.32** Lobby sync -- `syncLobbyClients` serializes all clients, dispatches SyncLobbyClients
- [ ] **TEST-18.B.33** Lobby sync -- `syncLobbySlots` dispatches SyncLobbySlots only when WaitingPlayers
- [ ] **TEST-18.B.34** Ping quality -- average < 240ms -> Good, < 360ms -> Moderate, else Poor
- [ ] **TEST-18.B.35** Ping quality -- updates connection quality for both player and their controlled bots
- [ ] **TEST-18.B.36** Game start -- drops non-ready clients before starting
- [ ] **TEST-18.B.37** Game start -- creates OrderBuffer with correct game speed timestep
- [ ] **TEST-18.B.38** Game start -- enables game saves only for single non-bot client
- [ ] **TEST-18.B.39** Game start -- creates GameInformation with correct mod, version, map uid/title
- [ ] **TEST-18.B.40** Game start -- dispatches StartGame order to all clients
- [ ] **TEST-18.B.41** Game start -- fires IStartGame trait hooks
- [ ] **TEST-18.B.42** Game start -- injects empty latency-fill frames for OrderLatency ticks
- [ ] **TEST-18.B.43** Game start -- replays GameSave.parseOrders to clients if loading a save
- [ ] **TEST-18.B.44** Shutdown -- sets State to ShuttingDown, fires INotifyServerShutdown, disposes all connections
- [ ] **TEST-18.B.45** Chat command -- calls interpretCommand on all IInterpretCommand traits
- [ ] **TEST-18.B.46** Save command -- CreateGameSave sanitizes filename, saves, dispatches GameSaved
- [ ] **TEST-18.B.47** Load command -- LoadGameSave restores GlobalSettings/Slots, remaps clients to slots
- [ ] **TEST-18.B.48** GenerateMap -- admin-only, parses MapGenerationArgs, updates preview, dispatches to clients
- [ ] **TEST-18.B.49** Binary frame -- `createFrame` produces correct `[length][client][frame][data]` little-endian format
- [ ] **TEST-18.B.50** Binary frame -- `createAckFrame` produces correct 0x10 order type frame
- [ ] **TEST-18.B.51** Binary frame -- `createTickScaleFrame` produces correct 0x76 order type frame with float32 scale
- [ ] **TEST-18.B.52** ServerSettings -- all fields present with correct defaults matching OpenRA ServerSettings
- [ ] **TEST-18.B.53** SessionTypes -- SessionClient serialization round-trip preserves all 20+ fields
- [ ] **TEST-18.B.54** SessionTypes -- SessionSlot serialization round-trip preserves all fields
- [ ] **TEST-18.B.55** SessionTypes -- SessionGlobalSettings serialization round-trip preserves all fields

#### Phase C Tests

- [ ] **TEST-18.C.1** Connection -- `handleMessage` parses header correctly (expectLength = length - 4, frame from bytes 4-7)
- [ ] **TEST-18.C.2** Connection -- `handleMessage` transitions Header -> Data -> Header state machine correctly
- [ ] **TEST-18.C.3** Connection -- `handleMessage` handles multi-packet buffering (partial data across message events)
- [ ] **TEST-18.C.4** Connection -- `handleMessage` rejects excessive order length (>128kB for multiplayer)
- [ ] **TEST-18.C.5** Connection -- `handleMessage` routes Ping packets internally (0x20 byte, 10 bytes total)
- [ ] **TEST-18.C.6** Connection -- `handleMessage` routes non-Ping packets to server.onConnectionPacket
- [ ] **TEST-18.C.7** Connection -- `createPingFrame` produces correct binary format `[13][0][0][0x20][timestamp: int64]`
- [ ] **TEST-18.C.8** Connection -- ping history capped at MaxPingSamples (15), oldest dequeued first
- [ ] **TEST-18.C.9** Connection -- `trySendData` delegates to transport.send and returns boolean
- [ ] **TEST-18.C.10** Connection -- close/error events call server.onConnectionDisconnect
- [ ] **TEST-18.C.11** OrderBuffer -- `start()` initializes timestamps (all EmptyValue) and empty delta queues
- [ ] **TEST-18.C.12** OrderBuffer -- `addOrderTimestamp()` records player timestamp, triggers delta computation when all filled
- [ ] **TEST-18.C.13** OrderBuffer -- delta queue capped at NumberOfFrames (20), oldest dequeued first
- [ ] **TEST-18.C.14** OrderBuffer -- `getTickScales()` returns empty when not enough data or interval not elapsed
- [ ] **TEST-18.C.15** OrderBuffer -- `getTickScales()` computes correct median-based tick scales with offset adjustment
- [ ] **TEST-18.C.16** OrderBuffer -- TickScale clamped to [1.0, MaxTickScale] range
- [ ] **TEST-18.C.17** OrderBuffer -- `removePlayer()` removes from players, timestamps, deltas; reassigns baseline if needed
- [ ] **TEST-18.C.18** OrderBuffer -- `median()` returns correct median for odd and even-length arrays

#### Phase D Tests

- [ ] **TEST-18.D.1** VoteKickTracker -- `clientHasPower()` true for admins and alive non-observer players
- [ ] **TEST-18.D.2** VoteKickTracker -- `clientHasPower()` false for observers and players who have won/lost
- [ ] **TEST-18.D.3** VoteKickTracker -- `voteKick()` rejects votes when server state is not GameStarted
- [ ] **TEST-18.D.4** VoteKickTracker -- `voteKick()` rejects votes against admin (non-dedicated)
- [ ] **TEST-18.D.5** VoteKickTracker -- `voteKick()` rejects starting vote with a downvote
- [ ] **TEST-18.D.6** VoteKickTracker -- `voteKick()` rejects votes on different kickee when vote in progress
- [ ] **TEST-18.D.7** VoteKickTracker -- `voteKick()` counts eligible players correctly
- [ ] **TEST-18.D.8** VoteKickTracker -- `voteKick()` ends vote when kickee disconnects
- [ ] **TEST-18.D.9** VoteKickTracker -- `voteKick()` computes votes needed as floor(eligiblePlayers / 2) + 1
- [ ] **TEST-18.D.10** VoteKickTracker -- `voteKick()` returns true when votes reach threshold
- [ ] **TEST-18.D.11** VoteKickTracker -- `voteKick()` blocks and returns false when vote cannot succeed
- [ ] **TEST-18.D.12** VoteKickTracker -- `voteKick()` enforces cooldown between failed votes
- [ ] **TEST-18.D.13** VoteKickTracker -- `voteKick()` prevents double voting from same player
- [ ] **TEST-18.D.14** MapStatusCache -- `getStatus()` caches and returns MapStatus for known maps
- [ ] **TEST-18.D.15** MapStatusCache -- `getStatus()` validates remote maps with async linting
- [ ] **TEST-18.D.16** MapStatusCache -- `getStatus()` returns Incompatible for maps with too many players
- [ ] **TEST-18.D.17** MapStatusCache -- `getStatus()` returns Incompatible for maps with load errors
- [ ] **TEST-18.D.18** MapStatusCache -- `getStatus()` sets UnsafeCustomRules flag where appropriate
- [ ] **TEST-18.D.19** MapStatusCache -- `runLintTests()` runs all ILintServerMapPass implementations
- [ ] **TEST-18.D.20** PlayerMessageTracker -- `isPlayerAtFloodLimit()` allows admin messages unconditionally
- [ ] **TEST-18.D.21** PlayerMessageTracker -- `isPlayerAtFloodLimit()` blocks messages during join cooldown
- [ ] **TEST-18.D.22** PlayerMessageTracker -- `isPlayerAtFloodLimit()` blocks messages when count exceeds limit
- [ ] **TEST-18.D.23** PlayerMessageTracker -- `isPlayerAtFloodLimit()` expires old timestamps beyond interval window
- [ ] **TEST-18.D.24** PlayerMessageTracker -- `isPlayerAtFloodLimit()` disables chat UI when flood limit reached
- [ ] **TEST-18.D.25** PlayerMessageTracker -- cooldown calculation returns correct remaining seconds

### 5.2 Integration Testing

- [ ] **TEST-18.I1** Server-client lifecycle: Create mock IServerTransport -> Simulate client connect -> Validate via handshake -> Sync lobby -> Start game -> End game -> Shutdown. Verify all lifecycle hooks fire.
- [ ] **TEST-18.I2** Multi-client sync: Connect 3 mock clients -> Validate all -> Start game -> Each sends sync hash -> Verify server detects match (no out-of-sync).
- [ ] **TEST-18.I3** Desync detection: Connect 2 mock clients -> Start game -> Send mismatched sync hashes -> Verify OutOfSync fires, replay invalidated.
- [ ] **TEST-18.I4** Order forwarding: Client A sends order -> Server receives -> Verifies forwarded to Client B, Ack sent to Client A, not forwarded to Client A itself.
- [ ] **TEST-18.I5** Game save round-trip: Start game with GameSave -> Receive orders -> CreateGameSave -> LoadGameSave -> Verify lobby state fully restored.
- [ ] **TEST-18.I6** Vote kick flow: 4-player game -> Start vote -> 3 votes yes -> Verify kickee dropped.
- [ ] **TEST-18.I7** Chat flood prevention: Send 6 messages rapidly -> Verify 6th blocked with ChatTemporaryDisabled message.
- [ ] **TEST-18.I8** Disconnect handling: 3-player game -> Client disconnects -> Verify remaining clients receive Disconnect order.

### 5.3 Visual Acceptance Testing

No visual acceptance tests are needed for this chapter -- all logic is non-rendering server infrastructure. The server's behavior is verified entirely through unit and integration tests.

### 5.4 Performance Acceptance Criteria

| Metric | Threshold | Rationale |
|--------|:---:|-----------|
| Order dispatch latency (server-side, 4 players) | < 1ms per client broadcast | Orders must be forwarded with minimal server-introduced latency |
| Sync hash comparison (4 players, single frame) | < 0.1ms per frame | Byte-for-byte `Uint8Array` comparison must be fast |
| Server startup time (no linting) | < 100ms | Fast startup for peer-hosted games |
| MapStatusCache linting (remote map) | async, non-blocking | Linting runs in microtask; must not block server tick loop |
| Connection accept -> handshake sent | < 5ms | First-impression latency for joining players |
| Memory usage (4-player server, idle) | < 20MB | Minimal footprint for peer-hosted games in browser Web Worker |
| VoteKickTracker tick (no vote active) | < 0.1ms | Must not add measurable overhead to server tick loop |
| PlayerMessageTracker message check | < 0.1ms | Per-chat-message check must be instantaneous |

---

## 6. Risk and Considerations

### 6.1 High-Risk Items

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Binary protocol byte-order mismatch** | **HIGH** | Clients and servers cannot communicate; game desyncs on first frame | All `DataView` operations use `true` for littleEndian. Validate against known-good binary frames from OpenRA desktop. Create reference test vectors by instrumenting C# `MemoryStream.Write()` output and comparing byte-for-byte with TS `createFrame()` output. |
| **WebSocket vs raw TCP delivery semantics** | **HIGH** | WebSocket delivers complete messages; C# TCP may fragment arbitrarily. The Connection state machine must handle both cases. | The state machine buffers across WebSocket messages the same way it buffers across `Socket.Receive()` partial reads. Test with fragmented, batched, and complete-message payloads. |
| **Single-threaded assumption violation** | MEDIUM | C# server uses multiple threads. If any JS handler performs blocking I/O or long-running computation, all connections stall. | All handlers must be non-blocking. Async operations (auth HTTP, file I/O) use `async/await`. Linting dispatched via `queueMicrotask()`. |
| **Session type migration scope** | MEDIUM | Server.ts requires full Session types (20+ fields), but current codebase only has 6-field stubs. | Create `SessionTypes.ts` as Phase B support module. Consolidate with existing LobbyTypes. Update stub imports in World.ts, Player.ts, and GameSave.ts. |
| **ReplayRecorder integration in Node.js** | MEDIUM | ReplayRecorder (Ch17) designed for browser IndexedDB. Server in Node.js needs filesystem storage. | Verify `IStorageProvider` abstraction (ADR-17.2) is used. Add Node.js `fs` implementation if not present. |
| **Authentication in Node.js vs browser** | LOW | C# auth uses HTTP + crypto. Web Worker cannot make outbound HTTP. | `IAuthenticator` interface. Node.js impl uses `node:https` + `node:crypto`. Browser mode disables auth. |
| **WebSocket backpressure** | LOW | `ws.send()` may buffer internally; C# has explicit backpressure handling. | Monitor `ws.bufferedAmount`. Chunk large payloads (>1MB) for saves/replays. |
| **TickScale ordering determinism** | LOW | OrderBuffer uses `performance.now()` which may differ between runtimes. | Clock is relative; offset computation self-corrects. MaxTickScale = 1.1 prevents runaway speedup. |

### 6.2 Browser-Specific Limitations (Web Worker Mode)

| Limitation | Impact | Workaround |
|:---|:---|:---|
| No TCP server API in browser | Web Worker cannot listen on ports | Host browser tab relays connections via `MessageChannel`; or use WebRTC DataChannel for P2P |
| No filesystem in browser | Cannot save replays directly to disk | Use IndexedDB; offer download via `Blob` + `URL.createObjectURL()` |
| No server-side HTTP in Web Worker | Cannot authenticate via PlayerDatabase | Disable auth for browser-hosted games; all players are local/trusted |
| Browser tab must stay open | Host closing tab kills server | `beforeunload` warning dialog; future `SharedWorker` persistence |

### 6.3 Cross-Chapter Integration Points

| File | Change Needed | Priority |
|:---|:---|:---|
| `src/OpenRA.Game/World.ts` | Replace `SessionStub` with real `Session` from `SessionTypes.ts` | After Phase B |
| `src/OpenRA.Game/Player.ts` | Replace `SessionClientStub` with real `SessionClient` | After Phase B |
| `src/OpenRA.Game/Network/Order.ts` | Verify all server order types are handled (FluentMessage, ServerError, AuthenticationError, DisableChatEntry, StartKickVote, EndKickVote) | Before Phase B |
| `src/OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.ts` | Consolidate with canonical types from `SessionTypes.ts` | After Phase B |
| `src/OpenRA.Game/Network/GameSave.ts` | Update `MutableSessionClient` to extend canonical `SessionClient` | After Phase B |
| `src/OpenRA.Game/Network/ReplayRecorder.ts` | Verify `IStorageProvider` is used (not hardcoded IndexedDB) | Before Phase B |
| `src/OpenRA.Game/ModData.ts` | Ensure `manifest.serverTraits` and object creator are accessible | Before Phase B |

### 6.4 Dependency on External Package

```bash
npm install --save-dev ws
npm install --save-dev @types/ws
```

The `ws` library is a devDependency since it is only needed for server builds.

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-18.1: Node.js Game Server with ws WebSocket Library

**Decision**: The game server runs in Node.js (not browser). Uses `ws` WebSocket library for client connections. Order broadcasting and sync hash verification operate identically to C# server logic.

**Rationale**: Browsers cannot create TCP listening sockets. The `ws` library provides a production-grade WebSocket server that maps to OpenRA's binary protocol needs. Node.js provides filesystem access for MOTD, ban lists, replays, and saves.

**Alternatives Considered**:
- **WebRTC DataChannel**: True P2P, but complex signaling and not suitable for dedicated server model. Rejected.
- **Server-Sent Events + HTTP POST**: Half-duplex; cannot match lockstep tick rate. Rejected.
- **uWebSockets.js**: Higher performance, but less mature TS typings and heavier native compilation. Rejected.

**Consequences**:
- Requires separate Node.js process for dedicated servers
- Server code must be runtime-agnostic beyond transport layer (ADR-18.6)
- `ws` is a devDependency

### ADR-18.2: Optional Web Worker for Peer-Hosted Games

**Decision**: Server can optionally run as a Web Worker in a "host" browser tab for peer-hosted games (no dedicated server needed).

**Rationale**: Many OpenRA games are peer-to-peer. Requiring a Node.js server for every game would be a significant usability regression. The Web Worker pattern allows "host and play" without infrastructure.

**Alternatives Considered**:
- **Main-thread server**: Would block UI; rejected.
- **No peer hosting**: Usability regression; rejected.

**Consequences**:
- Web Worker mode lacks filesystem access (IndexedDB instead)
- Authentication disabled in Web Worker mode
- Host tab must remain open

### ADR-18.3: Event-Driven Architecture Replaces Thread-Based Polling

**Decision**: The C# server's `BlockingCollection<IServerEvent>` polling loop is replaced with direct JavaScript event handlers. `ws.on('connection')` replaces `ConnectionConnectEvent`, `ws.on('message')` replaces `ConnectionPacketEvent`, `ws.on('close')` replaces `ConnectionDisconnectEvent`. Server traits are ticked via `setInterval()`.

**Rationale**: JavaScript's event loop is inherently single-threaded and event-driven. Polling blocks the event loop. Direct event handlers are idiomatic and performant.

**Alternatives Considered**:
- **Simulated event queue with `setTimeout` polling**: Wastes CPU, introduces latency. Rejected.
- **Worker threads for each connection**: Excessive overhead for game traffic. Rejected.

**Consequences**:
- `IServerEvent` interface and 5 inner classes eliminated
- Async auth callbacks become `await`-based
- `volatile`, `lock`, `ConcurrentDictionary`, `Interlocked.Exchange` all disappear

### ADR-18.4: Session Type Consolidation

**Decision**: Full `Session`, `SessionClient`, `SessionSlot`, `SessionGlobalSettings` types defined in `src/OpenRA.Game/Server/SessionTypes.ts` during Phase B. These replace stubs in `World.ts`, `Player.ts`, and LobbyTypes.

**Rationale**: Eliminates 3+ divergent type definitions. Ensures consistency and matches OpenRA's single `Session.cs`.

**Consequences**:
- Import path updates in World.ts, Player.ts
- LobbyTypes re-exports from canonical source or absorbed
- GameSave types extend canonical SessionClient
- Existing tests may need field additions

### ADR-18.5: Binary Protocol Preserved Byte-for-Byte over WebSocket

**Decision**: Binary protocol format preserved exactly over WebSocket: `[length: int32 LE][clientId: int32 LE][frame: int32 LE][orders: byte[]]`. All order type bytes match OpenRA desktop.

**Rationale**: WebSocket supports binary frames natively. Preserves sync hash semantics and enables theoretical cross-compatibility.

**Alternatives Considered**:
- **JSON-based protocol**: Breaks sync hash semantics. Rejected.
- **MessagePack**: Breaks compatibility, adds dependency. Rejected.
- **Protocol Buffers**: Overkill for fixed binary protocol. Rejected.

**Consequences**:
- Both server and client handle binary WebSocket frames
- `DataView` with `true` for littleEndian on all multi-byte operations
- Byte-level test vectors from C# `MemoryStream.Write()` output for validation

### ADR-18.6: IServerTransport Interface for Runtime-Agnostic Server

**Decision**: All network I/O through `IServerTransport` and `IClientTransport` interface pair. `Server` never touches WebSocket APIs directly. `NodeWebSocketTransport` for dedicated servers, `BrowserTransportStub` for Web Worker mode.

**Rationale**: Without abstraction, `Server` would be coupled to Node.js or browser APIs. Prevents code duplication for dual runtime support.

**Consequences**:
- Mock transports enable fast unit tests without network I/O
- New transport backends (WebRTC) can be added without modifying Server.ts
- Connection.ts receives `IClientTransport` instead of raw Socket

---

## Migration Order and Phasing Strategy

| Batch | Phase | Files | Est. Time | Parallelizable |
|:---:|:---|:---:|:---:|:---:|
| 1 | A | 3 (ProtocolVersion + TraitInterfaces + Exts) | 1 session | YES -- all three independent |
| 1 | Support | 1 (SessionTypes.ts) | 0.5 session | YES -- runs in parallel with Phase A |
| 2 | B | 1 (Server.ts, 1594 lines) | 2-3 sessions | NO -- deepest focus file |
| 3 | C | 2 (Connection.ts + OrderBuffer.ts) | 1 session | YES -- two files parallel |
| 3 | D | 3 (VoteKickTracker + MapStatusCache + PlayerMessageTracker) | 1 session | YES -- three files parallel with Phase C |

**Total estimated**: ~5-6 development sessions for implementation + ~2-3 sessions for review rounds. Server.ts at 1594 lines is the pacing item.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 4.6 -- Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.11 -- Original Ch18 file listing and ADRs
> - `docs/chapter8_weapons_combat_migration_plan.md` -- Plan format reference
> - `docs/chapter17_replay_save_system_migration_plan.md` -- Similar-scope reference plan
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
> - `OpenRA/OpenRA.Game/Server/Server.cs` -- Primary source (1594 lines)
> - `OpenRA/OpenRA.Game/Server/Connection.cs` -- Per-client connection (220 lines)
> - `OpenRA/OpenRA.Game/Server/OrderBuffer.cs` -- Dynamic order timing (139 lines)
> - `OpenRA/OpenRA.Game/Server/VoteKickTracker.cs` -- Vote kick system (223 lines)
> - `OpenRA/OpenRA.Game/Server/ProtocolVersion.cs` -- Protocol constants (82 lines)
> - `OpenRA/OpenRA.Game/Server/TraitInterfaces.cs` -- Server trait interfaces (63 lines)
> - `OpenRA/OpenRA.Game/Server/Exts.cs` -- Utility extension (24 lines)
> - `OpenRA/OpenRA.Game/Server/MapStatusCache.cs` -- Map status cache (106 lines)
> - `OpenRA/OpenRA.Game/Server/PlayerMessageTracker.cs` -- Chat flood control (86 lines)
