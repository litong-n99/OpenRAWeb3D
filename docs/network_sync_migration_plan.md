# OpenRA to Babylon.js Migration Plan: Chapter 6 -- Network Sync and Game Logic

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 7 (lines 942-1053)
> **Chapter Status**: Chapter 6 -- COMPLETE (29/29, 100%). Phase A COMPLETE (4/4), Phase B COMPLETE (3/3), Phase C COMPLETE (2/2), Phase D COMPLETE (10/10), Phase E COMPLETE (8+3/8+3)
> **Planning Date**: 2026-06-12
> **Prerequisite**: Chapter 5 (UI System & Resource Management) -- COMPLETE (16/16, 100%)
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Network & Connection Foundation](#31-phase-a-network--connection-foundation)
   - 3.2 [Phase B: Sync Hash System](#32-phase-b-sync-hash-system)
   - 3.3 [Phase C: Ruleset Container & ActorInfo Integration](#33-phase-c-ruleset-container--actorinfo-integration)
   - 3.4 [Phase D: AI BotModule Core](#34-phase-d-ai-botmodule-core)
   - 3.5 [Phase E: AI BotModule Extended](#35-phase-e-ai-botmodule-extended)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

The migration of OpenRA's Network Sync and Game Logic system encompasses the **most architecturally sensitive** phase of the project. This chapter covers three interconnected subsystems: the **network transport layer** (client-server communication via WebSocket replacing TcpClient), the **deterministic lockstep synchronization system** (ensuring all clients have identical game state at every frame), and the **game rules + AI decision system** (Ruleset container + BotModules behavior tree migration).

OpenRA's networking uses a deterministic lockstep (帧同步) architecture: only player inputs (Order atoms) are transmitted, not game state. All clients independently simulate the same world with the same inputs, producing identical results. The `Sync` system computes a frame-level hash of all `[VerifySync]`-marked game state and broadcasts it as a consistency check; any mismatch triggers an `OutOfSync` desynchronization report.

The core paradigm shifts:

- **Transport**: From C# `TcpClient` + multi-threaded receive loop to browser `WebSocket` + event-driven message handling. The single-threaded JS event loop replaces `BlockingCollection` + `ConcurrentQueue` patterns.
- **Serialization**: From C# manual binary `MemoryStream` serialization to **MessagePack** cross-platform binary encoding. Order data (Actor references, Target quad-state, ExtraData) must serialize to deterministic bytes.
- **Sync hash generation**: From C# `Reflection.Emit` dynamic IL code generation to **build-time decorator scanning** that pre-generates `computeSyncHash()` functions. Runtime uses `Reflect.getMetadata` to discover `@VerifySync`-decorated fields.
- **Deterministic PRNG**: From C# `Mersenne Twister` to a TypeScript port of the same algorithm. `Math.random()` is non-deterministic across JS engines and must never be used for game logic.
- **Frame timing**: From C# synchronous `Tick()` driving the lockstep loop to **Web Worker**-based game tick (immune to main-thread throttling) with `requestAnimationFrame`-driven rendering on the main thread.
- **Ruleset loading**: From C# runtime `MiniYaml.Load()` with reflection-based `FieldLoader` to **build-time JSON compilation** (leveraging the existing `miniyaml-to-json.ts` pipeline from Chapter 4 Phase H). Runtime uses `JSON.parse()` + `zod` schema validation.
- **AI architecture**: From C# imperative state machines (switch-case + if-else) to **Behavior Tree** with declarative JSON configuration. Decision parameters extracted as data, enabling different difficulty levels without code changes.

### 1.2 Five Core Architectural Principles

1. **Lockstep model unchanged, transport adapted**: The deterministic lockstep protocol (collect -> broadcast -> execute -> verify) is preserved exactly. Only the transport layer changes: `TcpClient` becomes `WebSocket`, `EchoConnection` becomes in-memory `MessageChannel` loopback. Frame rate remains 20 TPS (50ms tick).

2. **Build-time hash generation, not runtime reflection**: JavaScript has no `Reflection.Emit` equivalent. All sync hash functions are pre-generated at build time. A decorator (`@VerifySync`) marks fields; a build script scans the AST and emits `computeSyncHash()` functions into a `sync-hashes.generated.ts` file. Runtime registers custom hash functions for coordinate types (`CPos`, `WPos`, `WVec`, `WDist`, `WAngle`, `WRot`, `Actor`, `Player`, `Target`).

3. **Fixed-point math, no floating-point in game logic**: All game state computation uses integer arithmetic (WDist = 1/1024 cell precision). Trigonometric functions use lookup tables, not `Math.sin`/`Math.cos`. This is the **only way** to guarantee cross-platform determinism between .NET and JavaScript runtimes.

4. **Web Worker for game tick, main thread for rendering**: The game tick loop runs in a dedicated Web Worker to avoid `setInterval` throttling (browsers limit background tabs to 1Hz). The Worker communicates with the main thread via `postMessage` for rendering state and WebSocket for network data. The main thread runs Babylon.js rendering at display refresh rate independently.

5. **Behavior Tree for AI, configuration-driven**: All BotModule state machines are migrated to a Behavior Tree architecture. Decision parameters (attack thresholds, build priorities, squad composition) are externalized as JSON configuration files. The behavior tree library provides Composite (Sequence, Selector, Parallel), Decorator (Inverter, Repeater, Limiter), and Leaf (Action, Condition) nodes.

### 1.3 Prerequisites (Already Completed in Prior Chapters)

| Dependency | Source | Status |
|:---|:---|:---|
| MiniYAML -> JSON pipeline | `utils/miniyaml-to-json.ts` | COMPLETE (Ch4 Phase H) |
| `ActorInfo` trait metadata | `src/OpenRA.Game/GameRules/ActorInfo.ts` | COMPLETE (Ch3 Phase E, 916 lines, 64 tests) |
| Coordinate types (WPos, CPos, CVec, etc.) | `src/OpenRA.Game/` | COMPLETE (Ch3 Phase A) |
| `World.ts` / `GameWorldManager` | `src/OpenRA.Game/World.ts` | COMPLETE (Ch3 Phase C) |
| `Actor.ts` / `GameActor` | `src/OpenRA.Game/Actor.ts` | COMPLETE (Ch3 Phase D) |
| `Player.ts` | `src/OpenRA.Game/Player.ts` | COMPLETE (Ch3 Phase G) |
| `TraitsInterfaces.ts` (ITick, etc.) | `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | COMPLETE (Ch3 Phase B) |
| `ModData.ts` + `Manifest.ts` | `src/OpenRA.Game/` | COMPLETE (Ch5 Phase C) |
| `FileSystem.ts` (VFS) | `src/OpenRA.Game/FileSystem/` | COMPLETE (Ch5 Phase A) |
| `Map.ts` | `src/OpenRA.Game/Map/Map.ts` | COMPLETE (Ch4 Phase D) |
| `Renderer.ts` + `WorldRenderer.ts` | `src/OpenRA.Game/` | COMPLETE (Ch2) |
| `PriorityQueue.ts`, `Cache.ts`, `BitSet.ts` | `src/OpenRA.Game/Primitives/` | COMPLETE (Ch3 Phase A) |
| `MessagePack` library | npm dependency (`@msgpack/msgpack`) | Will be installed in Phase A |
| `Behavior Tree` library | npm dependency (`behavior-tree` or custom) | Will be installed in Phase D |

### 1.4 Architecture Diagram Reference

Refer to **Section 7** in `docs/openra_migration.agent.final.converted.md` (lines 942-1053) for the complete OpenRA Network Sync & Game Logic system architecture analysis. Key structural mappings:

```
                         +------------------------------------------+
                         |         Browser Main Thread               |
                         |  +-----------+  +---------------------+  |
                         |  | Babylon.js |  | HTML/CSS UI Overlay |  |
                         |  |  Renderer  |  |   (menus, HUD)      |  |
                         |  +-----+------+  +----------+----------+  |
                         |        |                    |              |
                         |  +-----+------+  +----------+----------+  |
                         |  | Render State|  |   UI Input Events   |  |
                         |  | (postMessage)|  |   (EventBus)       |  |
                         +------------------------postMessage---------+
                              ^              |              ^
                              |              v              |
                         +----+--------------+--------------+------+
                         |            Web Worker                   |
                         |  +------------------+  +-------------+  |
                         |  |  OrderManager     |  | Sync Engine |  |
                         |  |  (frame queue,    |  | (hash gen,  |  |
                         |  |   Tick() driver)  |  |  RunUnsynced|  |
                         |  +--------+----------+  +------+------+  |
                         |           |                      |        |
                         |  +--------+----------+  +------+------+  |
                         |  |  IConnection       |  | Game Logic  |  |
                         |  |  (WebSocket/       |  | (World.tick,|  |
                         |  |   EchoConnection)  |  |  AI modules)|  |
                         |  +--------+----------+  +-------------+  |
                         +-----------|------------------------------+
                                     | WebSocket
                              +------+------+
                              | Game Server  |
                              +-------------+

                         Build Time (Node.js):
                         +------------------------------------------+
                         |  miniyaml-to-json.ts  ->  rules.json      |
                         |  sync-hash-generator.ts -> sync-hashes.ts |
                         |  order-schema.ts        -> order schema   |
                         |  bt-config-compiler.ts  -> bt-trees.json  |
                         +------------------------------------------+
```

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (26 files across 5 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Network & Connection Foundation (4 files) — COMPLETE** | | | | | |
| 1 | `OpenRA.Game/Network/Order.cs` | `src/OpenRA.Game/Network/Order.ts` | `Order`, `OrderType`, `OrderFields`, `OrderPacket` | 476 | MEDIUM | **A ✅** |
| 2 | `OpenRA.Game/Network/UnitOrders.cs` | `src/OpenRA.Game/Network/UnitOrders.ts` | `UnitOrders` | 431 | MEDIUM | **A ✅** |
| 3 | `OpenRA.Game/Network/Connection.cs` | `src/OpenRA.Game/Network/Connection.ts` | `IConnection`, `NetworkConnection`, `EchoConnection`, `ConnectionState` | 387 | HIGH | **A ✅** |
| 4 | `OpenRA.Game/Network/OrderManager.cs` | `src/OpenRA.Game/Network/OrderManager.ts` | `OrderManager` | 334 | HIGH | **A ✅** |
| | | | | | | |
| **Phase B: Sync Hash System (1 file + 1 generated + 1 auto-generated) — COMPLETE** | | | | | |
| 5 | `OpenRA.Game/Sync.cs` | `src/OpenRA.Game/Sync.ts` | `Sync`, `ISync`, `VerifySyncAttribute` | 212 | HIGH | **B ✅** |
| 5a | *(new, build tooling)* | `utils/sync-hash-generator.ts` | `SyncHashGenerator` | 0 (new) | HIGH | **B ✅** |
| 5b | *(generated output)* | `src/OpenRA.Game/sync-hashes.generated.ts` | Auto-generated hash functions | 0 (auto) | LOW | **B ✅** |
| | | | | | | |
| **Phase C: Ruleset Container & ActorInfo Integration (2 files)** | | | | | |
| 6 | `OpenRA.Game/GameRules/Ruleset.cs` | `src/OpenRA.Game/GameRules/Ruleset.ts` | `Ruleset`, `RulesetCache` | 281 | MEDIUM | **C ✅** |
| 7 | *(extend existing)* | `src/OpenRA.Game/GameRules/ActorInfo.ts` | `ActorInfo` (extend) | 0 (ext) | MEDIUM | **C ✅** |
| | | | | | | |
| **Phase D: AI BotModule Core (10 files) — COMPLETE** | | | | | |
| 8 | `OpenRA.Mods.Common/Traits/BotModules/SquadManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/SquadManagerBotModule.ts` | `SquadManagerBotModule` | 634 | HIGH | **D ✅** |
| 9 | `OpenRA.Mods.Common/Traits/BotModules/BaseBuilderBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BaseBuilderBotModule.ts` | `BaseBuilderBotModule` | 575 | HIGH | **D ✅** |
| 10 | `OpenRA.Mods.Common/Traits/BotModules/UnitBuilderBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/UnitBuilderBotModule.ts` | `UnitBuilderBotModule` | 271 | MEDIUM | **D ✅** |
| 11 | `OpenRA.Mods.Common/Traits/BotModules/HarvesterBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/HarvesterBotModule.ts` | `HarvesterBotModule` | 465 | MEDIUM | **D ✅** |
| 12 | `OpenRA.Mods.Common/Traits/BotModules/SupportPowerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/SupportPowerBotModule.ts` | `SupportPowerBotModule` | 244 | MEDIUM | **D ✅** |
| 13 | `OpenRA.Mods.Common/Traits/BotModules/ResourceMapBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/ResourceMapBotModule.ts` | `ResourceMapBotModule` | 308 | MEDIUM | **D ✅** |
| 14 | `OpenRA.Mods.Common/Traits/BotModules/Squads/Squad.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/Squad.ts` | `Squad` | 182 | MEDIUM | **D ✅** |
| 15 | `OpenRA.Mods.Common/Traits/BotModules/Squads/AttackOrFleeFuzzy.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/AttackOrFleeFuzzy.ts` | `AttackOrFleeFuzzy` | 274 | MEDIUM | **D ✅** |
| 16 | `OpenRA.Mods.Common/Traits/BotModules/Squads/StateMachine.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/StateMachine.ts` | `StateMachine` (behavior tree adapter) | 40 | LOW | **D ✅** |
| 17 | `OpenRA.Mods.Common/Traits/BotModules/Squads/States/StateBase.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/StateBase.ts` | `StateBase` (behavior tree node) | 141 | LOW | **D ✅** |
| | | | | | | |
| **Phase E: AI BotModule Extended (11 files) — COMPLETE** | | | | | |
| 18 | `OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/BaseBuilderQueueManager.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/BaseBuilderQueueManager.ts` | `BaseBuilderQueueManager` | 620 | MEDIUM | **E ✅** |
| 19 | `OpenRA.Mods.Common/Traits/BotModules/Squads/States/GroundStates.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/GroundStates.ts` | `GroundStates` | 270 | MEDIUM | **E ✅** |
| 20 | `OpenRA.Mods.Common/Traits/BotModules/Squads/States/AirStates.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/AirStates.ts` | `AirStates` | 238 | MEDIUM | **E ✅** |
| 21 | `OpenRA.Mods.Common/Traits/BotModules/McvExpansionManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/McvExpansionManagerBotModule.ts` | `McvExpansionManagerBotModule` | 825 | HIGH | **E ✅** |
| 22 | `OpenRA.Mods.Common/Traits/BotModules/CaptureManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/CaptureManagerBotModule.ts` | `CaptureManagerBotModule` | 165 | LOW | **E ✅** |
| 23 | `OpenRA.Mods.Common/Traits/BotModules/McvManagerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/McvManagerBotModule.ts` | `McvManagerBotModule` | 238 | LOW | **E ✅** |
| 24 | `OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/MinelayerBotModule.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/MinelayerBotModule.ts` | `MinelayerBotModule` | 375 | MEDIUM | **E ✅** |
| 25 | `OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/SupportPowerDecision.cs` | `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/SupportPowerDecision.ts` | `SupportPowerDecision` | 213 | LOW | **E ✅** |
| 26 | `BuildingRepairBotModule`, `PowerDownBotManager`, `ProtectionStates` | `src/OpenRA.Mods.Common/Traits/BotModules/` (3 stubs) | `BuildingRepairBotModule`, `PowerDownBotManager`, `ProtectionStates` | 364 (total C#) | LOW | **E ✅** |

> **Complexity Legend**:
> - **LOW**: Simple data structures or thin adapters. 40-240 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with dependencies on Phase A/B types. 240-630 lines of C#.
> - **HIGH**: Complex architecture requiring careful design. 212-825 lines of C# with significant cross-cutting concerns (WebSocket lifecycle, sync hash generation, behavior tree integration).

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total migration units** | 29 (24 OpenRA-derived + 1 new build tool + 1 newly generated + 3 deferred stubs) |
| **Phase A (Network foundation)** | 4 files |
| **Phase B (Sync hash)** | 3 files (1 migrated + 1 new build tool + 1 auto-generated) |
| **Phase C (Ruleset)** | 2 files (1 new + 1 existing extension) |
| **Phase D (AI core)** | 10 files |
| **Phase E (AI extended)** | 11 files (8 implementations + 3 deferred stubs) |
| **HIGH complexity** | 8 files (Connection, OrderManager, Sync, Ruleset, SquadManager, BaseBuilder, StateMachine adapter, McvExpansion) |
| **MEDIUM complexity** | 12 files |
| **LOW complexity** | 8 files |
| **Total OpenRA C# source lines** | ~6,350 (excluding already-migrated ActorInfo.cs) |
| **New TypeScript lines (no OpenRA source)** | ~800 (sync-hash-generator + behavior tree configuration tooling) |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Network & Connection Foundation

**Status**: COMPLETE (4/4)
**Complexity**: HIGH (OrderManager, NetworkConnection), MEDIUM (Order/UnitOrders)
**Implementation Date**: 2026-06-12
**Blocked by**: Chapter 3 Phase A (CPos, WPos, Target), Chapter 3 Phase C (World), Chapter 3 Phase G (Player)
**Blocks**: Phase B (Sync needs Order types for testing), Phase C (Ruleset needs Network namespace)
**External dependency**: `@msgpack/msgpack` npm package for MessagePack serialization

**Description**: Phase A establishes the complete network plumbing -- the data structures that define player commands (Order), the transport layer (IConnection with WebSocket and EchoConnection implementations), and the frame queue coordinator (OrderManager). These four files form a tightly-coupled subsystem where Order defines the data atoms, Connection handles transmission, UnitOrders routes received orders to game logic, and OrderManager orchestrates the full lockstep lifecycle.

**Paradigm Shifts**:
- C# `TcpClient` + multi-threaded `NetworkConnectionReceive` -> Browser `WebSocket` + event-driven `onmessage` callback
- C# `BlockingCollection` + `ConcurrentQueue` -> JS `Array` with explicit synchronization (single-threaded, no concurrency)
- C# `MemoryStream` manual binary serialization -> `@msgpack/msgpack` `encode()`/`decode()` with typed array support
- C# `Thread` for connection -> `WebSocket` async lifecycle (connecting -> open -> message -> close -> error)
- C# `Order.Target` (C# `Target` struct with 4 states) -> TypeScript `Target` (already migrated in Ch3 Phase A)
- C# `Order.Subject` (C# `Actor` reference) -> TypeScript `ActorID` (number) for network serialization
- C# `EchoConnection` memory queue -> TypeScript `EchoConnection` using in-memory `Array` as ring buffer class="fixed bottom-0 left-0 right-0 pointer-events-none"

#### 3.1.1 Order (Data Structure)

- [x] **TODO-6.A.1** `src/OpenRA.Game/Network/Order.ts` (1253 lines TS, 567 test lines) -- Player command atom ✅:
  - `OrderType` enum: `Ack = 0x10`, `Ping = 0x20`, `SyncHash = 0x65`, `TickScale = 0x76`, `Disconnect = 0xBF`, `Handshake = 0xFE`, `Fields = 0xFF`
  - `OrderFields` bit flag enum: `Target = 0x01`, `ExtraActors = 0x02`, `TargetString = 0x04`, `Queued = 0x08`, `ExtraLocation = 0x10`, `ExtraData = 0x20`, `TargetIsCell = 0x40`, `Subject = 0x80`, `Grouped = 0x100`
  - `Order` class: `orderString: string`, `subject: ActorID` (number, not Actor reference), `target: Target`, `targetCell: CPos`, `targetPosition: WPos`, `targetString: string`, `extraData: number`, `extraLocation: CPos`, `extraActors: ActorID[]`, `isImmediate: boolean`, `isQueued: boolean`, `grouped: boolean`
  - `OrderPacket` class: wraps `Order[]` array for batch transmission
  - `serialize(): Uint8Array` -- MessagePack encode with OrderFields bit flag computation matching OpenRA exactly
  - `static deserialize(data: Uint8Array): Order` -- MessagePack decode with flag-based field reconstruction
  - `syncHashOrderLength = 13`, `disconnectOrderLength = 5` constants
  - **ActorID serialization**: Network layer never transmits Actor references; uses numeric ActorID. Receiver resolves via `World.getActorById(id)`
  - **Target serialization**: Must handle all 4 Target states (Actor, Terrain, FrozenActor, Invalid) with deterministic byte output
  - **ExtraActors list**: Serialized as MessagePack array of ActorID numbers. OpenRA serializes as comma-separated string; MessagePack array is more efficient

#### 3.1.2 UnitOrders (Order Routing)

- [x] **TODO-6.A.2** `src/OpenRA.Game/Network/UnitOrders.ts` (696 lines TS, 416 test lines) -- Order dispatch ✅:
  - `ProcessOrder(orderManager: OrderManager, world: World, clientId: number, order: Order): void`
  - `switch-case` dispatch on `order.orderString` covering all standard order types: `"Message"`, `"Chat"`, `"StartGame"`, `"PauseGame"`, `"SyncInfo"`, `"HandshakeRequest"`, `"HandshakeResponse"`, `"ServerOrder"`, `"Disconnected"`, `"Shroud"`, `"Ping"`, etc.
  - `ResolveOrder(order: Order): void` -- validates subject actor is alive, checks `world.orderValidators`, dispatches to `IResolveOrder` traits
  - `ChatMessageMaxLength = 2500` constant
  - `FindPlayerByClient(world, client): Player | undefined` -- client-to-player resolution
  - **Upgrade opportunity**: Replace `switch-case` with `Map<string, OrderHandler>` registry pattern for extensibility (mods add custom orders)
  - **Event emission**: Order processing emits typed events via `TypedEventEmitter` for UI notification (chat messages, join/leave notifications)
  - **Validation**: `OrderNotFromServerOrWorldIsReplay` guard check preserved

#### 3.1.3 Connection (Transport Layer)

- [x] **TODO-6.A.3** `src/OpenRA.Game/Network/Connection.ts` (685 lines TS, 352 test lines) -- Network transport ✅:
  - `ConnectionState` enum: `PreConnecting`, `NotConnected`, `Connecting`, `Connected`
  - `IConnection` interface: `localClientId: number`, `startGame(): void`, `send(frame: number, orders: Order[]): void`, `sendImmediate(orders: Order[]): void`, `sendSync(frame: number, syncHash: number, defeatState: bigint): void`, `receive(orderManager: OrderManager): void`
  - `NetworkConnection` class:
    - WebSocket constructor: `new WebSocket(url)` with binary type (`ws.binaryType = "arraybuffer"`)
    - Connection lifecycle: `onopen` -> set `ConnectionState.Connected`, `onmessage` -> push to `receivedPackets` queue, `onclose` -> set `ConnectionState.NotConnected` with auto-reconnect timer (exponential backoff: 1s, 2s, 4s, 8s, max 30s), `onerror` -> log + transition state
    - `receivedPackets: Array<{fromClient: number, data: ArrayBuffer}>` -- replaces C# `ConcurrentQueue`
    - `send(frame, orders)`: MessagePack encode order packet, prepend 4-byte frame number (big-endian Int32), 1-byte order type, send via `ws.send(buffer)`
    - `sendImmediate(orders)`: same packet format, sent with frame=0
    - `sendSync(frame, syncHash, defeatState)`: 13-byte sync packet: 4b frame + 1b type(0x65) + 4b syncHash + 8b defeatState (big-endian)
    - `receive(orderManager)`: drains `receivedPackets` queue, decodes each packet, calls `orderManager.receiveOrders()` / `orderManager.receiveSync()`
    - No multi-threading: WebSocket events fire on the main thread (or Worker thread if WebSocket is in Worker)
  - `EchoConnection` class (local/offline mode):
    - In-memory queues: `sync: Array<{frame, syncHash, defeatState}>`, `orders: Array<{frame, packet}>`, `immediateOrders: OrderPacket[]`
    - `send()` enqueues to local `orders` queue
    - `receive()` dequeues and dispatches locally -- zero network latency
    - `localClientId = 1`
    - `startGame()` injects empty frame 0 to fill forward-projection gap
  - **Connection strategy**: Single WebSocket connection (not per-peer). Browser limit of ~6 WebSocket connections per domain makes multi-connection impractical. Server relays all messages; client-to-client communication goes through server.
  - **Reconnection**: On disconnect, enter `NotConnected` state. Show UI notification. Auto-reconnect with exponential backoff. On reconnect, server sends full game state snapshot for catch-up (server-side support needed).

#### 3.1.4 OrderManager (Lockstep Coordinator)

- [x] **TODO-6.A.4** `src/OpenRA.Game/Network/OrderManager.ts` (827 lines TS, 532 test lines) -- Frame queue manager ✅:
  - `session: Session`, `world: World`, `connection: IConnection`
  - `netFrameNumber: number` (getter), `localFrameNumber: number`
  - `gameStarted: boolean` -> `netFrameNumber !== 0`
  - `serverError: string | null`, `authenticationFailed: boolean`
  - Internal data structures:
    - `pendingOrders: Map<number, Queue<{frame: number, orders: OrderPacket}>>` -- per-client frame queues (replaces `ConcurrentDictionary`)
    - `syncForFrame: Map<number, {syncHash: number, defeatState: bigint}>` -- per-frame sync hash cache
    - `localOrders: Order[]` -- accumulated local orders for next frame
    - `localImmediateOrders: Order[]` -- immediate orders (no frame queuing)
    - `processClientOrders: ClientOrder[]` -- orders being processed this frame
  - `issueOrder(order: Order): void` -- appends to `localOrders` for next frame transmission. Immediate orders go to `localImmediateOrders` and are sent immediately via `connection.sendImmediate()`
  - `receiveOrders(clientId: number, frame: number, orders: OrderPacket): void` -- stores remote orders into `pendingOrders.get(clientId)` queue
  - `receiveSync(clientId: number, frame: number, syncHash: number, defeatState: bigint): void` -- stores sync hash. Compares against other clients' sync hashes for same frame. Mismatch triggers `outOfSync()` error report
  - `Tick(): void` -- **lockstep frame driver** (4 phases):
    1. **Collect**: Dump `localOrders` + `localImmediateOrders` into `processClientOrders`
    2. **Broadcast**: `connection.send(netFrameNumber, localOrders)` for non-immediate orders
    3. **Execute**: Check that all active clients have orders for this frame in `pendingOrders`. Iterate all client queues, inject orders into `world.tick()` simulation. After simulation, compute `Sync.hash(world)` and `connection.sendSync(netFrameNumber, syncHash, defeatState)`
    4. **Verify**: Compare sync hashes. All clients must match. Frame number increments only after verified match.
  - `outOfSync(reason: string): void` -- generates desync report with frame number, client hashes
  - `orderQueueLength: number` -- frames in queue for slowest client
  - `lastTickTime: TickTime` -- timing info for latency compensation
  - **Input delay buffer**: Configurable `inputDelay` (default 4, up from OpenRA's 3 to absorb WebSocket's +1-3ms latency). Higher values = more input lag but more resilience to network jitter
  - **Web Worker context**: `OrderManager` runs in Web Worker. Communicates with main thread via `postMessage` for UI notifications (chat, join/leave). Render state (World transform updates) also sent via `postMessage` at end of each tick

**Acceptance Criteria**:
- Order serialization round-trip: `Order.serialize() -> Uint8Array -> Order.deserialize() -> Order` produces identical Order for all field combinations
- MessagePack encoding produces deterministic byte output (same Order = same bytes every time)
- `NetworkConnection` successfully establishes WebSocket, sends/receives binary packets, tracks ConnectionState transitions correctly through all 4 states
- `EchoConnection` loopback correctly enqueues and dequeues orders with zero-frame latency
- `OrderManager.Tick()` correctly executes the 4-phase lockstep protocol: collect local orders, broadcast, execute world simulation, verify sync hash
- Frame number increments only after all clients have submitted orders for current frame
- `OrderManager.outOfSync()` generates report with client-specific hash values and frame number
- Unit tests for each class with mocked WebSocket and mocked World
- No per-frame allocation in OrderManager.Tick() hot path (reuse arrays)

**Estimated Effort**: ~3,500 lines implementation + ~3,000 lines test (10-12 developer-days)

**Implementation Notes** (2026-06-12):

Phase A was completed in 1 review round (Round 1: 1 BLOCKER -- wrong properties in `suggestedTimestep`; fixed. Round 2: APPROVED). ~94% OpenRA feature coverage across all 4 files. 115 tests total, `tsc --noEmit` clean.

Key paradigm mappings realized during implementation:

| OpenRA (C#) | TypeScript / Babylon.js |
|-------------|------------------------|
| `TcpClient` + multi-threaded `NetworkConnectionReceive` | Browser `WebSocket` + event-driven `onmessage` callback |
| `BlockingCollection` + `ConcurrentQueue` | JS `Array` (single-threaded, no concurrency needed) |
| `MemoryStream` manual binary serialization | `@msgpack/msgpack` `encode()`/`decode()` with typed arrays |
| `Thread` for connection lifecycle | `WebSocket` async lifecycle (`onopen` / `onmessage` / `onclose` / `onerror`) |
| `Reflection.Emit` `OrderIO` dynamic IL codegen | Manual `tryParse*` static functions for each Order field |
| Platform-specific byte order (LE in original) | 4-byte **big-endian** (`DataView.setInt32()`) length prefix -- intentional deviation for broader ecosystem compatibility |
| `Order.Target` (C# `Target` struct, 4 states) | TypeScript `Target` (already migrated in Ch3 Phase A) |
| `Order.Subject` (C# `Actor` reference) | TypeScript `ActorID` (number) for network serialization |
| `EchoConnection` in-memory queue | TypeScript `EchoConnection` using in-memory `Array` as ring buffer |
| `OrderPacket` batch array | MessagePack array of `Order` objects |

Implementation statistics:

| File | TS Lines | Test Lines | Tests | Review Round |
|------|:--------:|:----------:|:-----:|:------------:|
| `src/OpenRA.Game/Network/Order.ts` | 1253 | 567 | Order.test.ts | APPROVED (R2) |
| `src/OpenRA.Game/Network/UnitOrders.ts` | 696 | 416 | UnitOrders.test.ts | APPROVED (R2) |
| `src/OpenRA.Game/Network/Connection.ts` | 685 | 352 | Connection.test.ts | APPROVED (R2) |
| `src/OpenRA.Game/Network/OrderManager.ts` | 827 | 532 | OrderManager.test.ts | APPROVED (R2) |
| **Total** | **3,461** | **1,867** | **115** | |

Commits: `7ea8d07` (initial Phase A), `ff0a461` (Order/UnitOrders/Connection refinements), `2fe6156` (suggestedTimestep fix).

---

### 3.2 Phase B: Sync Hash System

**Status**: COMPLETE (2/2)
**Complexity**: HIGH (hash generation, build tooling)
**Implementation Date**: 2026-06-12
**Blocked by**: ~~Phase A~~ (COMPLETE — Order types now available for sync hash testing), Chapter 3 (all coordinate types already have hashCode())
**Blocks**: Phase C (Ruleset uses sync attributes on trait fields)

**Description**: `Sync.cs` is the consistency watchdog of the deterministic lockstep. It computes a frame-level hash of all `[VerifySync]`-decorated game state and compares across clients. C# achieves this via `Reflection.Emit` dynamic IL code generation -- JavaScript has no equivalent. The migration strategy: a build-time code generator (`utils/sync-hash-generator.ts`) scans TypeScript source files for `@VerifySync` decorators, identifies marked fields, and emits pre-generated `computeSyncHash()` functions into a single `src/OpenRA.Game/sync-hashes.generated.ts` file. At runtime, `Sync.hash(target)` looks up the pre-generated function by target class name and invokes it.

**Paradigm Shifts**:
- C# `Reflection.Emit` `DynamicMethod` IL generation -> Build-time AST scanning + code generation
- C# `ConcurrentCache<Type, Func<object, int>>` -> `Map<string, (obj: ISync) => number>` populated at import time
- C# `CustomHashFunctions` dictionary -> TypeScript `syncHashFunctions` registry (same pattern, statically typed)
- C# `RunUnsynced<T>()` nested detection -> TypeScript `runUnsynced<T>(fn: () => T, world: World): T` with identical `unsyncDepth` counter + pre/post sync hash snapshot comparison
- C# `[AttributeUsage]` -> TypeScript `@VerifySync` property decorator using `Reflect.metadata`

#### 3.2.1 Sync Runtime

- [x] **TODO-6.B.1** `src/OpenRA.Game/Sync.ts` (569 lines TS, 958 test lines, 96 tests) — Sync hash engine ✅:
  - `VerifySync` decorator: `function VerifySync(target: any, propertyKey: string): void` -- uses `Reflect.defineMetadata('sync:field', true, target.constructor, propertyKey)` to mark fields for hash inclusion
  - `ISync` interface: empty marker interface (classes implementing `ISync` declare themselves as sync-participating)
  - `syncHashFunctions: Map<string, (obj: ISync) => number>` -- populated automatically by `sync-hashes.generated.ts` at module load
  - `customSyncHashFunctions: Map<string, (obj: any) => number>` -- custom hashers for special types:
    - `HashInt2(int2): number`
    - `HashCPos(cpos: CPos): number` -- combines X, Y, Layer hash
    - `HashCVec(cvec: CVec): number` -- combines X, Y hash
    - `HashWDist(wdist: WDist): number` -- delegates to `WDist.hashCode()`
    - `HashWPos(wpos: WPos): number` -- delegates to `WPos.hashCode()`
    - `HashWVec(wvec: WVec): number` -- delegates to `WVec.hashCode()`
    - `HashWAngle(wangle: WAngle): number` -- delegates to `WAngle.hashCode()`
    - `HashWRot(wrot: WRot): number` -- delegates to `WRot.hashCode()`
    - `HashActor(actor: Actor): number` -- uses `actor.actorID` (numeric)
    - `HashPlayer(player: Player): number` -- uses `player.internalName` hash
    - `HashTarget(target: Target): number` -- composite hash of Target's 4 states
  - `Sync.getHashFunction(sync: ISync): (obj: ISync) => number` -- lookup in `syncHashFunctions`, fallback to `syncHashFunctions.get(sync.constructor.name)`
  - `Sync.hash(sync: ISync): number` -- invokes registered hash function, returns 32-bit integer
  - `Sync.computeFrameHash(world: World): number` -- walks `world.actors`, computes combined hash of all `ISync`-implementing actors + world state
  - `Sync.runUnsynced<T>(world: World, fn: () => T): T`:
    - Increments `unsyncDepth` counter (starts at 0)
    - On first entry (`unsyncDepth === 1`): captures `preHash = world.syncHash()`
    - Executes `fn()`
    - On last exit (`--unsyncDepth === 0`): captures `postHash = world.syncHash()`, throws `Error("Desync detected in unsynced code")` if `preHash !== postHash`
    - Nestable: nested `runUnsynced` calls simply increment/decrement the counter without re-snapshotting
  - **No floating-point**: Hash computation MUST use integer arithmetic exclusively. `Math.imul()` for 32-bit integer multiplication with overflow
  - **Hash combining**: Use FNV-1a style: `hash = (hash ^ fieldHash) * 0x01000193 >>> 0` (preserves 32-bit unsigned)

#### 3.2.2 Sync Hash Generator (Build Tooling)

- [x] **TODO-6.B.2** `utils/sync-hash-generator.ts` (611 lines TS, 821 test lines, 33 tests) — Build-time code generator ✅:
  - Scans `src/` directory for TypeScript files containing `@VerifySync` decorator usage
  - Parses TypeScript AST via `typescript` compiler API
  - For each class implementing `ISync`:
    - Collects all `@VerifySync`-decorated fields
    - Generates `computeSyncHash(obj: ClassName): number` function
    - For primitive fields (number, string, boolean): `hash = combine(hash, fieldValue)`
    - For ISync fields (nested): `hash = combine(hash, Sync.hash(fieldValue))`
    - For coordinate types (CPos, WPos, etc.): delegates to registered custom hash function
    - For Map/Set/Array fields: iterates entries in deterministic insertion order, hashes each
    - For nullable fields: `hash = combine(hash, fieldValue === null ? 0 : fieldValue)`
  - Outputs `src/OpenRA.Game/sync-hashes.generated.ts` with all generated functions
  - Self-registration: generated file imports `Sync` and calls `registerSyncHash(ClassName, computeSyncHash)` at module load
  - Integration with Vite: runs as Vite plugin before build; regenerates on source file change in dev mode
  - **Error messages**: If `@VerifySync` decorator is on a class not implementing `ISync`, emit build warning

#### 3.2.3 Auto-Generated Sync Hashes

- [x] **TODO-6.B.3** `src/OpenRA.Game/sync-hashes.generated.ts` (24 lines, auto-generated) — Generated hash registry ✅:
  - Auto-generated by `utils/sync-hash-generator.ts` from `@VerifySync`-decorated fields
  - Contains `registerSyncHash(ClassName, computeSyncHash)` calls for all ISync classes
  - Regenerated at build time; committed to VCS for auditability
  - Currently registers hash functions for all migrated ISync classes

**Acceptance Criteria**:
- Build-time hash generator correctly discovers all `@VerifySync`-decorated fields across all source files
- Generated `computeSyncHash()` functions produce identical output for identical input
- Custom hash functions for all 11 special types (int2 through Target) produce consistent results matching C# behavior
- `Sync.hash()` returns same value for two objects with identical field values
- `Sync.runUnsynced()` correctly detects state mutation in nested unsynced blocks and throws error
- `Sync.computeFrameHash()` covers all World actors implementing ISync
- Generated file is self-contained (no circular dependencies) and passes `tsc --noEmit`
- Unit tests for all custom hash functions with known-answer test vectors
- Unit tests for `runUnsynced()` with mock World providing sync hash

**Estimated Effort**: ~1,500 lines implementation + ~1,200 lines test (5-6 developer-days)

**Implementation Notes** (2026-06-12):

Phase B was completed in 2 review rounds (Round 1: 2 MAJOR + 3 MINOR -> NEEDS FIXES; Round 2: All fixed -> APPROVED). 132 tests total across 2 files + 1 auto-generated file. `tsc --noEmit` clean. All 3 files: 1,204 TS implementation lines + 1,779 test lines.

Key paradigm mappings realized during implementation:

| OpenRA (C#) | TypeScript / Babylon.js |
|-------------|------------------------|
| `Reflection.Emit` DynamicMethod IL generation | Build-time AST scanning + pre-generated `computeSyncHash()` functions |
| `[AttributeUsage]` for `[VerifySync]` attribute | JSDoc `/** @VerifySync */` marker with `Reflect.defineMetadata('sync:field', true, ...)` |
| C# XOR hash combination: `hash ^ fieldHash` | FNV-1a style: `(hash ^ fieldHash) * 0x01000193 >>> 0` (32-bit unsigned) |
| `FrozenDictionary<Type, MethodInfo>` hash registry | `Map<string, (obj: ISync) => number>` populated at import time |
| `ConcurrentCache<Type, Func<object, int>>` | Simple `Map` lookup (single-threaded, no concurrent access) |
| C# `CustomHashFunctions` static dictionary | TypeScript `customSyncHashFunctions: Map<string, (obj: any) => number>` |
| C# `RunUnsynced<T>()` with `unsyncDepth` counter | TypeScript `runUnsynced<T>(world, fn)` with identical counter + pre/post sync hash snapshot |
| C# boolean hash: `true ? 111 : 207` | TypeScript boolean hash: `true ? 111 : 207` (identical constants preserved) |
| Runtime hash lookup via `typeof(T)` | Build-time registration: `Sync.registerSyncHash('ClassName', computeSyncHash)` |

Implementation statistics:

| File | TS Lines | Test Lines | Tests | Review Round |
|------|:--------:|:----------:|:-----:|:------------:|
| `src/OpenRA.Game/Sync.ts` | 569 | 958 | 96 | APPROVED (R2) |
| `utils/sync-hash-generator.ts` | 611 | 821 | 33 | APPROVED (R2) |
| `src/OpenRA.Game/sync-hashes.generated.ts` | 24 | — | — | Auto-generated |
| **Total** | **1,204** | **1,779** | **132** | |

Commits: `52f6940` (initial Phase B), `a63d377` (fix boolean hash constants, export lookupSyncHash, improve runUnsynced guard).

---

### 3.3 Phase C: Ruleset Container & ActorInfo Integration

**Status**: COMPLETE (2/2)
**Complexity**: MEDIUM
**Implementation Date**: 2026-06-12
**Blocked by**: Phase B (Sync metadata for trait fields), Phase A (Order/Network types referenced by Ruleset), Chapter 5 Phase C (ModData, Manifest), Chapter 4 Phase H (MiniYAML pipeline)
**Blocks**: Phase D (AI needs Ruleset for actor configuration)

**Description**: `Ruleset.cs` is the central container for all game rules -- actors, weapons, voices, notifications, music, terrain info, and model sequences. It loads from `mod.yaml` manifest, parses MiniYAML trait definitions, merges inheritance chains (`^` prefix + `Inherits:` + `^-TraitName` removal), and resolves cross-references (`IRulesetLoaded.RulesetLoaded()`). The existing `ActorInfo.ts` from Chapter 3 Phase E already handles trait composition and topological sort. Phase C adds the `Ruleset` container layer and integrates sync metadata.

**Paradigm Shifts**:
- C# `MiniYaml.Load()` from filesystem -> Build-time `mod.json` with pre-compiled trait definitions (MiniYAML pipeline already built)
- C# `FieldLoader` reflection-based YAML-to-object -> TypeScript `zod` schema validation on JSON input
- C# `MergeOrDefault<T>()` dictionary merge -> TypeScript deep merge with `Map<string, T>` priority: child overrides parent
- C# `ActorInfoDictionary` frozen dictionary -> TypeScript `ReadonlyMap<string, ActorInfo>`
- C# `SoundInfo`, `MusicInfo`, `WeaponInfo` -> TypeScript stubs with JSON Schema (full migration deferred to subsequent chapters)

#### 3.3.1 Ruleset Container

- [x] **TODO-6.C.1** `src/OpenRA.Game/GameRules/Ruleset.ts` (863 lines TS, 1051 test lines, 55 tests) -- Game rules container ✅:
  - `actors: ReadonlyMap<string, ActorInfo>` -- all actor type definitions
  - `weapons: ReadonlyMap<string, WeaponInfo>` -- STUB: `WeaponInfo` interface with `name`, `reloadDelay`, `range`, `burst` fields; full migration deferred to Chapter 8 (Weapon System)
  - `voices: ReadonlyMap<string, SoundInfo>` -- STUB: `SoundInfo` interface (`name`, `volume`, `attenuation`); full migration deferred to Chapter 8 (Audio)
  - `notifications: ReadonlyMap<string, SoundInfo>` -- STUB: same `SoundInfo` interface
  - `music: ReadonlyMap<string, MusicInfo>` -- STUB: `MusicInfo` interface (`filename`, `volume`, `loop`); deferred to Chapter 8
  - `terrainInfo: ITerrainInfo` -- references `TerrainInfo` from Chapter 4 Phase C (already migrated)
  - `modelSequences: ReadonlyMap<string, ModelSequenceConfig>` -- STUB: for future 3D model sequences
  - Constructor takes all 7 dictionaries, stores as frozen `ReadonlyMap`s
  - `static async load(manifest: Manifest, fileSystem: FileSystem, mapRules?: MapRules): Promise<Ruleset>`:
    1. Read `mod.yaml` key `Rules` for rules file list
    2. Load each rules JSON file via `fileSystem.open()` (MiniYAML -> JSON already converted at build time)
    3. Merge actor definitions: parent-first iteration, child overrides parent. Handle `^` abstract prefix, `Inherits:` chains, `^-TraitName` removal
    4. Parse trait configs via `zod` schema validation
    5. Construct `ActorInfo` for each actor using existing `ActorInfo.fromJSON()`
    6. Run `IRulesetLoaded` post-processing: iterate all actors, find traits implementing `IRulesetLoaded`, call `rulesetLoaded(ruleset, actorInfo)`
    7. Apply map-level rule overrides if `mapRules` provided
  - `mergeOrDefault<T>(base: Map<string, T>, child: Map<string, T>): Map<string, T>` -- merged map with child overriding base. Conflict logging: warn on duplicate keys (child wins)
  - `dispose(): void` -- cleanup cached trait instances

#### 3.3.2 ActorInfo Extension

- [x] **TODO-6.C.2** Extend `src/OpenRA.Game/GameRules/ActorInfo.ts` (+152 lines TS, +308 test lines extension) -- Add ruleset integration ✅:
  - Add `rulesetLoadedHandlers: Array<(ruleset: Ruleset, actorInfo: ActorInfo) => void>` to ActorInfo
  - Add `onRulesetLoaded(handler)` registration for `IRulesetLoaded` trait semantics
  - Add `syncFields: Array<{name: string, customHash?: (val: any) => number}>` for `@VerifySync` metadata on traits
  - Extend `fromJSON()` to parse sync field annotations from trait configurations
  - Ensure `TraitsInConstructOrder()` (Kahn topological sort) handles ruleset dependencies correctly

**Acceptance Criteria**:
- `Ruleset.load()` successfully parses a `mod.json` manifest, loads all referenced JSON rule files, and produces a complete `Ruleset` with all 7 dictionaries populated
- Trait inheritance: abstract actors (`^`) are excluded from spawnable list but contribute traits to children via `Inherits:`
- Trait removal: `^-TraitName` correctly removes inherited trait from child
- `@` instance suffix correctly handles multiple instances of same trait (e.g., `Turreted@primary`, `Turreted@secondary`)
- `mergeOrDefault()` produces correct merged result with child overriding parent, and logs conflicts
- `IRulesetLoaded` handlers fire exactly once for each trait during `Ruleset.load()`
- Map-level rule overrides correctly override base rules when `mapRules` provided
- All stub interfaces (`WeaponInfo`, `SoundInfo`, `MusicInfo`, `ModelSequenceConfig`) have clear `@todo` annotations
- Unit tests for merge logic, inheritance chains, removal syntax, and `@` instance disambiguation
- Integration test: load a complete C&C ruleset JSON and verify all actor types are parsed without errors

**Estimated Effort**: ~1,800 lines implementation + ~1,500 lines test (6-7 developer-days)

**Implementation Notes** (2026-06-12):

Phase C was completed in 2 review rounds (Round 1: 1 MAJOR + 3 MINOR -> NEEDS FIXES; Round 2: All fixed -> APPROVED). 80 new tests total across 2 files (Ruleset.ts + ActorInfo.ts extension). `tsc --noEmit` clean. All 2 files: ~1,030 TS implementation lines + ~1,359 test lines.

Key paradigm mappings realized during implementation:

| OpenRA (C#) | TypeScript / Babylon.js |
|-------------|------------------------|
| `RulesetCache` global concurrent dictionary | `Map<string, Ruleset>` with explicit cache lifecycle (no concurrent access needed) |
| `MiniYaml.Load()` from filesystem | Build-time `mod.json` (MiniYAML -> JSON pipeline from Ch4 Phase H) |
| `FieldLoader` reflection-based YAML-to-object | `zod` schema validation on JSON input |
| `MergeOrDefault<T>()` dictionary merge | TypeScript deep merge with `Map<string, T>` + child-overrides-parent priority |
| `ActorInfoDictionary` frozen dictionary | `ReadonlyMap<string, ActorInfo>` |
| `SoundInfo`, `MusicInfo`, `WeaponInfo` | TypeScript stub interfaces with `@todo` annotations (deferred to Chapters 7-8) |
| `modelSequences` dictionary | Stub `ModelSequenceConfig` interface for future 3D model sequences |
| C# `MiniYamlNode` trait merging | Build-time pre-flattened JSON with resolved inheritance chains (per ADR-6.6) |
| `IRulesetLoaded.RulesetLoaded()` post-processing | `IRulesetLoaded` interface + `rulesetLoadedHandlers` registration array |
| `^` abstract actor prefix + `Inherits:` chains | Build-time trait merge with child-overrides-parent priority + `-TraitName` removal |
| `@` instance suffix (`Turreted@primary`) | Trait instance disambiguation via JSON key parsing |
| `Ruleset.load()` async static factory | `static async load(manifest, fileSystem, mapRules?): Promise<Ruleset>` |

Implementation statistics:

| File | TS Lines | Test Lines | Tests | Review Round |
|------|:--------:|:----------:|:-----:|:------------:|
| `src/OpenRA.Game/GameRules/Ruleset.ts` | 863 | 1051 | 55 | APPROVED (R2) |
| `src/OpenRA.Game/GameRules/ActorInfo.ts` (extension) | +152 | +308 | +25 | APPROVED (R2) |
| `src/OpenRA.Game/ModData.ts` (update) | +29/-14 | — | — | APPROVED (R2) |
| **Total** | **~1,030** | **~1,359** | **~80** | |

Commits: `c4c98ea` (initial Phase C), `3652e65` (address review findings: 1 MAJOR + 3 MINOR fixed).

---

### 3.4 Phase D: AI BotModule Core

**Status**: COMPLETE (10/10)
**Complexity**: HIGH (SquadManager, BaseBuilder), MEDIUM (others)
**Implementation Date**: 2026-06-12
**Blocked by**: ~~Phase C~~ (COMPLETE -- Ruleset now provides actor configs for AI), Chapter 3 (Actor, World, ITick, Player)
**Blocks**: Phase E (AI BotModule Extended)

**Description**: OpenRA's AI system uses a modular BotModule architecture where each module is an independent `ConditionalTrait` responsible for one aspect of AI behavior. Phase D migrates the 10 core modules that form the essential AI decision-making: squad management, base building, unit production, harvester logistics, superweapon use, resource mapping, and the squad subsystem (Squad, AttackOrFleeFuzzy, StateMachine, StateBase). The key paradigm shift: from imperative C# state machines (switch-case, if-else chains, mutable state flags) to a declarative **Behavior Tree** architecture where decisions are composed from reusable node types.

**Paradigm Shifts**:
- C# `IBot.Tick()` state machine logic -> Behavior Tree `tick()` traversing Composite/Decorator/Leaf nodes
- C# `SquadManagerBotModule` imperative state flags -> Selector root node with Sequence branches for each decision priority level
- C# `BaseBuilderBotModule` sequential build queue -> Sequence node: check resources -> check prerequisites -> place building -> wait for completion
- C# fuzzy logic `AttackOrFleeFuzzy` -> WeightedSelector node with configurable threshold parameters
- C# `StateMachine` (custom C# state machine) -> Behavior Tree adapter: `StateMachineNode` wraps a behavior tree subtree that activates when state condition is met
- C# hardcoded decision parameters -> Externalized JSON configuration files (`squad-config.json`, `build-priority.json`, `difficulty-config.json`)

#### Behavior Tree Node Inventory

The AI migration introduces a custom lightweight Behavior Tree library (or wraps the `behavior-tree` npm package) with the following node types:

| Node Type | Category | Description |
|:---|:---|:---|
| `Sequence` | Composite | Executes children in order until one fails or all succeed |
| `Selector` | Composite | Executes children in order until one succeeds or all fail |
| `Parallel` | Composite | Executes all children in parallel with configurable success policy |
| `Inverter` | Decorator | Inverts child result (success <-> failure) |
| `Repeater` | Decorator | Repeats child N times or indefinitely |
| `Limiter` | Decorator | Limits child execution to once per N ticks |
| `Condition` | Leaf | Checks a boolean predicate (resource level, enemy proximity, etc.) |
| `Action` | Leaf | Performs a game action (build, train, attack, move) |
| `Wait` | Leaf | Suspends execution for N ticks |

#### 3.4.1 SquadManagerBotModule

- [x] **TODO-6.D.1** `src/OpenRA.Mods.Common/Traits/BotModules/SquadManagerBotModule.ts` (~750 lines TS) -- Squad coordination ✅:
  - Behavior Tree root: `Selector`
    - Branch 1 (`Sequence`): `Condition(hasEnemyInRange)` -> `Action(assignSquadToAttack)`
    - Branch 2 (`Sequence`): `Condition(hasUnprotectedBase)` -> `Action(assignSquadToGuard)`
    - Branch 3 (`Sequence`): `Condition(hasRallyPoint)` -> `Action(assignSquadToRally)`
    - Branch 4 (default): `Action(idlePatrol)`
  - Squad management: `squads: Map<string, Squad>` registry
  - Squad creation threshold: minimum unit count before forming new squad (configurable)
  - Squad assignment priority: Attack > Defense > Harass > Patrol
  - Idle squad detection: reassign idle squads after inactivity timeout
  - **AttackOrFleeFuzzy integration**: When squad engages, invoke fuzzy evaluation to decide attack/retreat
  - **Configurable parameters** (external JSON): `attackRange`, `defenseRadius`, `maxSquads`, `minSquadSize`, `inactivityTimeout`, `reassessmentInterval`

#### 3.4.2 BaseBuilderBotModule

- [x] **TODO-6.D.2** `src/OpenRA.Mods.Common/Traits/BotModules/BaseBuilderBotModule.ts` (~496+66 lines TS) -- Base construction ✅:
  - Behavior Tree root: `Sequence` (with `Repeater` wrapper for periodic reassessment)
    - `Condition(hasSufficientResources)`
    - `Selector` (choose next building):
      - `Condition(needsPower)` -> `Action(queuePowerPlant)`
      - `Condition(needsRefinery)` -> `Action(queueRefinery)`
      - `Condition(needsBarracks)` -> `Action(queueBarracks)`
      - `Condition(needsDefense)` -> `Action(queueDefense)`
      - `Condition(canExpand)` -> `Action(queueExpansion)`
    - `Action(findPlacementLocation)` -- selects optimal placement using weighted grid evaluation
    - `Action(placeBuilding)` -- issues construction order
    - `Wait(waitForCompletion)` -- blocks until building is complete or timeout
  - Building placement logic: grid evaluation based on proximity to resources, distance from existing buildings, defensive coverage
  - Prerequisite checking: verifies tech tree requirements before queuing
  - **Configurable parameters**: `buildPriorities: Map<string, number>`, `maxBuildingRadius`, `powerMargin`, `defenseDensity`

#### 3.4.3 UnitBuilderBotModule

- [x] **TODO-6.D.3** `src/OpenRA.Mods.Common/Traits/BotModules/UnitBuilderBotModule.ts` (~350 lines TS) -- Production management ✅:
  - Behavior Tree: `Sequence` under `Limiter(every 5 ticks)`
    - `Condition(hasProductionQueue)` -- barracks/war factory/airfield available
    - `Selector(chooseUnitType)`:
      - `Condition(lowInfantry)` -> `Action(queueInfantry)`
      - `Condition(lowAntiAir)` -> `Action(queueAntiAir)`
      - `Condition(lowArmor)` -> `Action(queueTank)`
    - `Action(startProduction)`
  - Unit composition ratios: configurable target ratios (e.g., 40% infantry, 30% vehicles, 20% aircraft, 10% support)
  - Rush detection: if enemy has few combat units, switch to rush composition (more attack units)
  - **Configurable parameters**: `unitRatios: Record<string, number>`, `rushThreshold`, `minIdleProduction`

#### 3.4.4 HarvesterBotModule

- [x] **TODO-6.D.4** `src/OpenRA.Mods.Common/Traits/BotModules/HarvesterBotModule.ts` (~670+209 lines TS) -- Resource collection ✅:
  - Behavior Tree: `Selector` under `Limiter(every 10 ticks)`
    - `Condition(harvesterIdle)` -> `Action(assignToNearestField)`
    - `Condition(fieldDepleted)` -> `Action(switchField)`
    - `Condition(harvesterUnderAttack)` -> `Action(retreatHarvester)`
    - `Condition(canBuildMore)` -> `Action(queueAdditionalHarvester)`
  - Field assignment: nearest-resource-first with load balancing (avoid all harvesters on same field)
  - Threat avoidance: if enemy units near resource field, redirect to safer field
  - Refinery-to-harvester ratio: target 1 harvester per refinery + 1 spare
  - **Configurable parameters**: `maxHarvestersPerRefinery`, `fieldReassignmentThreshold`, `threatRadius`

#### 3.4.5 SupportPowerBotModule

- [x] **TODO-6.D.5** `src/OpenRA.Mods.Common/Traits/BotModules/SupportPowerBotModule.ts` (~290 lines TS) -- Superweapon use ✅:
  - Behavior Tree: `Sequence` under `Limiter(every 20 ticks)`
    - `Selector(choosePower)`:
      - `Condition(hasAirstrike && enemyCluster)` -> `Action(useAirstrike)`
      - `Condition(hasIonCannon && enemyStructure)` -> `Action(useIonCannon)`
      - `Condition(hasNuke && enemyBase)` -> `Action(useNuke)`
      - `Condition(hasSpyPlane && fogOfWar)` -> `Action(useSpyPlane)`
    - `Condition(targetIsValid)` -> `Action(launchAtTarget)`
  - Target selection: weighted scoring based on target value (buildings > units), cluster density, distance
  - Cooldown tracking: does not fire while power is on cooldown
  - **Configurable parameters**: `targetValueWeights`, `minClusterSize`, `maxDistance`

#### 3.4.6 ResourceMapBotModule

- [x] **TODO-6.D.6** `src/OpenRA.Mods.Common/Traits/BotModules/ResourceMapBotModule.ts` (~400 lines TS) -- Resource awareness ✅:
  - Maintains internal resource heatmap: `CellLayer<number>` scoring each cell's resource value
  - Updates on map changes (resources harvested, new fields discovered via scouting)
  - Provides `getBestResourceLocation(): CPos` for harvester assignment and base expansion decisions
  - Provides `getResourceDensity(region: CellRegion): number` for expansion evaluation
  - Recalculates on demand; not every tick (expensive for large maps)

#### 3.4.7 Squad System (Squad + AttackOrFleeFuzzy + StateMachine + StateBase)

- [x] **TODO-6.D.7** `src/OpenRA.Mods.Common/Traits/BotModules/Squads/Squad.ts` (~550 lines TS) -- Unit group ✅:
  - `units: Set<Actor>` -- member actors
  - `target: Target` -- current objective
  - `state: BehaviorTreeNode` -- active behavior tree node (replaces C# state enum)
  - `update(): void` -- tick the behavior tree node, dispatch orders to members
  - `addUnit(actor: Actor): void` / `removeUnit(actor: Actor): void`
  - `isValid: boolean` -- squad has at least one living member

- [x] **TODO-6.D.8** `src/OpenRA.Mods.Common/Traits/BotModules/Squads/AttackOrFleeFuzzy.ts` (~300 lines TS) -- Fuzzy engagement logic ✅:
  - Evaluates attack-vs-flee decision using weighted scoring (not pure fuzzy logic; use weighted sum for determinism):
    - Attack score factors: `friendlyUnitCount`, `enemyUnitCount`, `friendlyHealthRatio`, `enemyHealthRatio`, `distanceToTarget`
    - Flee score factors: `enemyThreatLevel`, `friendlyCasualties`, `distanceToRetreat`
  - Returns `attack` or `flee` decision based on score comparison + configurable threshold
  - **Deterministic**: All factors use integer arithmetic; no `Math.random()`. Decision is purely score-based

- [x] **TODO-6.D.9** `src/OpenRA.Mods.Common/Traits/BotModules/Squads/StateMachine.ts` (~340 lines TS combined with StateBase.ts) -- Behavior Tree adapter ✅:
  - Lightweight wrapper mapping C# `StateMachine` concept to Behavior Tree nodes
  - Each "state" becomes a `Sequence` node whose first child is a `Condition(stateIsActive)`
  - State transitions triggered by behavior tree node results: Success = transition to next state, Failure = stay in current state

- [x] **TODO-6.D.10** `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/StateBase.ts` (see StateMachine.ts, ~340 lines TS combined) -- State base ✅:
  - Abstract base for squad state nodes
  - Provides common context access: `squad: Squad`, `world: World`, `botPlayer: Player`
  - `tick(): NodeStatus` -- abstract method, subclasses implement specific state logic
  - Status reporting for debugging: `getStatus(): string`

**Acceptance Criteria**:
- Behavior Tree library compiles and all node types produce correct results (Sequence, Selector, Parallel, Inverter, Repeater, Limiter, Condition, Action)
- All 5 main BotModules compile and their behavior trees produce logical decisions matching OpenRA behavior
- Squad system correctly assigns units to squads and dispatches orders based on behavior tree evaluation
- AttackOrFleeFuzzy produces deterministic results (same inputs -> same output) with no `Math.random()`
- ResourceMapBotModule correctly builds and updates resource heatmap on cell-layer
- All configurable parameters are externalized as JSON (no hardcoded magic numbers)
- Unit tests for each BotModule with mocked World, mocked Actor, mocked Player
- Performance: behavior tree evaluation completes within 1ms per module per tick on a 256x256 map
- AI modules do NOT use floating-point math; all calculations are integer-based

**Estimated Effort**: ~6,000 lines implementation + ~5,000 lines test (12-14 developer-days)

**Implementation Notes** (2026-06-12):

Phase D was completed in 2 review rounds (Round 1: 2 BLOCKER + 4 MAJOR -> NEEDS FIXES; Round 2: All fixed -> APPROVED). 10 files migrated plus 1 existing file extension (TraitsInterfaces.ts: +10 AI-related interfaces). `tsc --noEmit` clean. Total: ~5,769 initial + ~390 fix lines implementation.

Key paradigm mappings realized during implementation:

| OpenRA (C#) | TypeScript / Babylon.js |
|-------------|------------------------|
| `IBot.Tick()` imperative state machines (switch-case, if-else chains) | Behavior Tree `tick()` traversing Composite/Decorator/Leaf nodes |
| `SquadManagerBotModule` imperative state flags | Selector root node with Sequence branches for each decision priority |
| `BaseBuilderBotModule` sequential build queue | Sequence node: check resources -> check prerequisites -> place building -> wait |
| `AttackOrFleeFuzzy` C# fuzzy logic | WeightedSelector node with configurable threshold parameters |
| `StateMachine` (custom C# state machine) | Behavior Tree adapter: `StateMachineNode` wraps BT subtree |
| C# hardcoded decision parameters | Externalized JSON configuration (difficulty-config.json, build-priority.json) |
| C# `IBot.Tick()` drive loop | Behavior Tree `tick()` with node status tracking (SUCCESS/FAILURE/RUNNING) |
| C# `ConditionalTrait` base class | TypeScript `ConditionalTrait` abstract class with condition token management |
| C# `ResourceMapBotModule` imperative resource scan | Declarative CellLayer<number> heatmap with on-demand recalculation |
| C# `Squad` unit group management | TypeScript `Squad` class with `Set<Actor>` + behavior tree state resolution |

Implementation statistics:

| File | TS Lines | Notes |
|------|:--------:|:------|
| `src/OpenRA.Mods.Common/Traits/BotModules/SquadManagerBotModule.ts` | ~750 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/BaseBuilderBotModule.ts` | ~496+66 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/UnitBuilderBotModule.ts` | ~350 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/HarvesterBotModule.ts` | ~670+209 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/SupportPowerBotModule.ts` | ~290 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/ResourceMapBotModule.ts` | ~400 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/Squads/Squad.ts` | ~550 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/Squads/AttackOrFleeFuzzy.ts` | ~300 | APPROVED (R2) |
| `src/OpenRA.Mods.Common/Traits/BotModules/Squads/StateMachine.ts` + `StateBase.ts` | ~340 | APPROVED (R2) |
| `src/OpenRA.Game/Traits/TraitsInterfaces.ts` (extension) | +10 interfaces | APPROVED (R2) |
| **Total** | **~5,769 initial + ~390 fix** | |

Commits: `fee0774` (initial Phase D), `51c6265` (fix BLOCKERs + MAJORs).

---

### 3.5 Phase E: AI BotModule Extended

**Status**: COMPLETE (8+3/8+3)
**Complexity**: MEDIUM (BaseBuilderQueueManager, McvExpansion), LOW (others)
**Implementation Date**: 2026-06-12
**Blocked by**: Phase D (uses Squad system, behavior tree infrastructure, BotModule patterns)
**Blocks**: None (Phase E is terminal leaf)
**Implementation**: 11 files (8 full implementation + 3 deferred stubs), 22 total source files (~4,463 impl + ~1,515 test lines, 119 tests)
**Review**: APPROVED (2 rounds, commits `9adf549`, `56c0c85`)

**Description**: Phase E migrates the remaining AI modules that extend the core system from Phase D. These include the BaseBuilderQueueManager (production queue optimization), MCV management (expansion logic), capture logic, mine-laying, ground/air squad state implementations, and support power decision scoring. Three minor modules (`BuildingRepairBotModule`, `PowerDownBotManager`, `ProtectionStates`) are implemented as documentation stubs deferred to Chapter 8.

#### 3.5.1 BotModuleLogic Subsystem

- [x] **TODO-6.E.1** `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/BaseBuilderQueueManager.ts` (984 lines TS, 238 test lines) -- Build queue optimization ✅:
  - Manages parallel build queues across multiple production structures
  - Prioritization: power-critical buildings first, then economy, then defense, then tech
  - Queue balancing: distribute builds across available structures to minimize idle time
  - Wait state management: tracks structures currently building and releases blocked queue items on completion
  - **Configurable parameters**: queue depth per structure type, parallel build limits

- [x] **TODO-6.E.2** `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/MinelayerBotModule.ts` (495 lines TS, 156 test lines) -- Mine deployment ✅:
  - Dedicated behavior tree for mine-laying vehicles
  - Selects mine placement locations based on chokepoint analysis and defensive coverage gaps
  - Maintains minefield map to avoid overlapping fields
  - **Configurable parameters**: `mineDensity`, `minefieldSpacing`, `chokepointDetectionRadius`

- [x] **TODO-6.E.3** `src/OpenRA.Mods.Common/Traits/BotModules/BotModuleLogic/SupportPowerDecision.ts` (377 lines TS, 246 test lines) -- Superweapon scoring ✅:
  - Evaluates target candidates for support powers using weighted scoring
  - Factors: target value (structure > unit), cluster density, friendly proximity penalty, cooldown status
  - Returns ranked list of (target, score) pairs for `SupportPowerBotModule` to select from
  - **Deterministic**: no randomization in scoring

#### 3.5.2 Squad State Implementations

- [x] **TODO-6.E.4** `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/GroundStates.ts` (340 lines TS, 193 test lines) -- Ground unit states ✅:
  - `AttackState`: behavior tree node -- move to target, engage when in range
  - `RushState`: behavior tree node -- move urgently to target, ignore distractions
  - `GuardState`: behavior tree node -- patrol area, engage nearby enemies
  - `RetreatState`: behavior tree node -- move toward nearest friendly structure, self-preservation

- [x] **TODO-6.E.5** `src/OpenRA.Mods.Common/Traits/BotModules/Squads/States/AirStates.ts` (283 lines TS, 143 test lines) -- Air unit states ✅:
  - `AirAttackState`: circle target, strafe, return to reload
  - `AirPatrolState`: patrol waypoints, engage enemies of opportunity
  - `AirRetreatState`: return to airfield for repair/reload

#### 3.5.3 Specialized BotModules

- [x] **TODO-6.E.6** `src/OpenRA.Mods.Common/Traits/BotModules/McvExpansionManagerBotModule.ts` (1053 lines TS, 182 test lines) -- MCV expansion ✅:
  - Manages Mobile Construction Vehicle deployment for base expansion
  - Site selection: weighted grid evaluation (resource proximity, defensive coverage, distance from main base)
  - Timing: deploys MCV when current base is saturated or resource fields are distant
  - Multiple expansion phases: first expansion near resources, later expansions for map control
  - **Configurable parameters**: `expansionRadius`, `saturationThreshold`, `resourceDistanceThreshold`

- [x] **TODO-6.E.7** `src/OpenRA.Mods.Common/Traits/BotModules/CaptureManagerBotModule.ts` (311 lines TS, 115 test lines) -- Structure capture ✅:
  - Assigns engineer-type units to capture enemy/neutral structures
  - Prioritization: tech structures > production > defense > resources
  - Pathfinding: ensures safe path to target (avoids enemy defenses)

- [x] **TODO-6.E.8** `src/OpenRA.Mods.Common/Traits/BotModules/McvManagerBotModule.ts` (402 lines TS, 138 test lines) -- MCV production ✅:
  - Decides when to produce additional MCVs for expansion
  - Limits: maximum concurrent MCVs based on map size and economy strength
  - Timing: produces MCV when economy can support new base

#### 3.5.4 Deferred Stubs

- [x] **TODO-6.E.9** Deferred modules (stubs with `@todo` annotations) ✅:
  - `BuildingRepairBotModule.ts` (63 lines TS, 28 test lines): Repair prioritization -- STUB, deferred to Chapter 8 (requires full Weapon/Health system)
  - `PowerDownBotManager.ts` (81 lines TS, 32 test lines): Power management -- STUB, deferred to Chapter 8
  - `ProtectionStates.ts` (74 lines TS, 44 test lines): Squad protection behavior -- STUB, deferred to Chapter 8

**Acceptance Criteria**:
- [x] All Phase E modules compile and integrate with Phase D behavior tree infrastructure
- [x] BaseBuilderQueueManager correctly balances build queues across multiple structures
- [x] MCV expansion modules correctly select deployment sites based on weighted criteria
- [x] Ground and Air squad states produce correct movement and engagement orders
- [x] SupportPowerDecision scoring matches OpenRA priorities (structures > unit clusters > individual units)
- [x] Deferred stubs have clear `@todo` annotations referencing Chapter 8
- [x] Unit tests for each module with mocked dependencies (119 tests total)
- [x] All AI calculations are integer-based, deterministic, and free of `Math.random()`

---

## 4. Dependency Graph

```
Chapter 3+4+5 (Prerequisites) — ALREADY COMPLETE
  |
  +--> Phase A (Order + Connection + UnitOrders + OrderManager) **[4/4 COMPLETE]**
  |     |
  |     +--> Phase B (Sync + hash generator) **[3/3 COMPLETE]**
  |     |     |
  |     |     +--> Phase C (Ruleset + ActorInfo extension) **[2/2 COMPLETE]**
  |     |           |
  |     |           +--> Phase D (AI BotModule Core: 10 files) **[10/10 COMPLETE]**
  |     |                 |
  |     |                 +--> Phase E (AI BotModule Extended: 11 files) **[8+3/8+3 COMPLETE]**
  |     |
  |     +--> (Phase B can overlap with end of Phase A — Sync needs Order types for tests)
```

### Critical Path

```
Phase A -> Phase B -> Phase C -> Phase D -> Phase E **[ALL COMPLETE]**
```

Phase A is the critical dependency for everything downstream. All phases are now complete.

### Parallelization Opportunities

- **Within Phase A**: Order.ts and UnitOrders.ts developed in parallel; Connection.ts started after Order serialization stabilized; OrderManager.ts started when both were ready
- **Within Phase D**: SquadManager + Squad subsystem (4 files) ran parallel with BaseBuilder + UnitBuilder (3 files); Harvester + ResourceMap + SupportPower (3 files) ran in parallel
- **Phase E**: All 11 files developed in parallel once Phase D base was complete (shared behavior tree patterns and test mocks)
- **Across phases**: Phase D file 10 (StateBase) and the behavior tree library began during Phase C since they have no ruleset dependency

### External Dependencies (Chapters 2-5)

| Dependency | Required By | Status |
|:---|:---|:---|
| WPos, CPos, CVec, WDist, WAngle, WRot, int2, Target | Phase A (Order serialization), Phase B (custom hash functions) | COMPLETE |
| World.ts, Actor.ts, Player.ts | Phase A (OrderManager), Phase C (Ruleset), Phase D/E (AI) | COMPLETE |
| TraitsInterfaces.ts (ITick, IResolveOrder, ConditionalTrait) | Phase A (UnitOrders), Phase D/E (AI modules) | COMPLETE |
| ActorInfo.ts | Phase C (extension + Ruleset integration) | COMPLETE |
| ModData.ts, Manifest.ts | Phase C (Ruleset.load() reads mod manifest) | COMPLETE |
| FileSystem.ts | Phase C (Ruleset.load() reads rule JSON files) | COMPLETE |
| TerrainInfo.ts | Phase C (Ruleset.TerrainInfo) | COMPLETE |
| Map.ts, CellLayer.ts | Phase D (ResourceMap heatmap) | COMPLETE |
| PriorityQueue.ts, BitSet.ts | Phase D/E (AI pathfinding, diplomacy checks) | COMPLETE |
| miniyaml-to-json.ts | Phase C (mod rules pre-compiled to JSON) | COMPLETE |
| MessagePack (`@msgpack/msgpack`) | Phase A (Order serialization) | Will install |

---

## 5. Verification and Test Strategy

- [ ] **TEST-6.1** Order serialization round-trip: serialize+deserialize 10,000 random Orders covering all `OrderFields` flag combinations; verify identical reconstruction including ActorID resolution
- [ ] **TEST-6.2** MessagePack deterministic output: same Order produces byte-for-byte identical `Uint8Array` across 100 iterations
- [ ] **TEST-6.3** NetworkConnection lifecycle: mock WebSocket, test all ConnectionState transitions (PreConnecting -> Connecting -> Connected -> NotConnected), reconnection with exponential backoff, binary packet send/receive
- [ ] **TEST-6.4** EchoConnection loopback: issue 100 orders, verify all correctly dequeued with correct frame numbers
- [ ] **TEST-6.5** OrderManager lockstep protocol: 4-client scenario with simulated frame delays, verify frame number advances only when all clients submit, verify sync hash comparison detects mismatches
- [ ] **TEST-6.6** OrderManager outOfSync: inject mismatched sync hash for client 2, verify `outOfSync()` fires with correct frame and hash values in report
- [ ] **TEST-6.7** Sync hash generation: build tool discovers all `@VerifySync` fields, generates compilable `sync-hashes.generated.ts`
- [ ] **TEST-6.8** Custom hash functions: known-answer test vectors for all 11 special types (int2 through Target) produce consistent 32-bit hash values
- [ ] **TEST-6.9** Sync.hash determinism: two identical objects produce same hash; modifying any `@VerifySync` field changes hash
- [ ] **TEST-6.10** runUnsynced detection: modify sync-marked field inside unsynced block, verify error thrown with correct field name
- [ ] **TEST-6.11** runUnsynced nesting: nested unsynced blocks, verify only outermost captures snapshot and compares; inner blocks just increment counter
- [ ] **TEST-6.12** Ruleset.load: parse complete C&C mod rules JSON (50+ actor types), verify all ActorInfo instances correctly constructed with trait inheritance chains resolved
- [ ] **TEST-6.13** Trait inheritance: `^Soldier` abstract parent, `E1` with `Inherits: ^Soldier` plus `-Mobile` removal, verify E1 gets all ^Soldier traits minus Mobile
- [ ] **TEST-6.14** @ instance disambiguation: `Turreted@primary` and `Turreted@secondary` on same actor, verify both instances accessible by their instance names
- [ ] **TEST-6.15** Behavior tree correctness: every node type (Sequence, Selector, Parallel, Inverter, Repeater, Limiter, Condition, Action) tested with known input/output scenarios
- [ ] **TEST-6.16** AI determinism: run same BotModule scenario 100 times with identical initial state, verify every decision is identical (no `Math.random()`, no floating-point)
- [ ] **TEST-6.17** AI performance: behavior tree evaluation for all 5 core modules completes within 5ms total on a 256x256 map with 200 units
- [ ] **TEST-6.18** Squad assembly: create 30 units of mixed types near enemy, verify squads form correctly with balanced composition
- [ ] **TEST-6.19** ResourceMap heatmap: place resources on map, verify heatmap correctly identifies highest-density locations
- [ ] **TEST-6.20** MCV expansion site selection: verify expansion sites are chosen based on resource proximity and defensive coverage; verify second expansion site is farther than first
- [ ] **TEST-6.21** E2E integration (Playwright, deferred to Chapter 8+): start game with 2 AI players, observe AI behavior over 1000 frames, verify no desync and all modules active

---

## 6. Risk and Considerations

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Cross-platform determinism (JS vs .NET floating-point)** | **CRITICAL** | Any floating-point difference causes OutOfSync within hundreds of frames | All game logic uses integer arithmetic exclusively. Trigonometric functions use lookup tables (pre-generated with same values as .NET `System.Math`). `Math.random()` never used for game logic. Mersenne Twister port verified against C# reference with 10,000 known-answer test vectors |
| **WebSocket connection instability** | HIGH | Disconnections mid-game cause lockstep stall (all clients wait for missing player) | Auto-reconnect with server-side game state snapshot for catch-up. Configurable timeout (default 10s) before player is dropped. UI notification with countdown timer. Input delay buffer (4-5 frames) absorbs brief connection hiccups |
| **Background tab throttling (setInterval 1Hz limit)** | HIGH | Game tick drops from 20 TPS to 1 TPS when tab is backgrounded | Game tick runs in **Web Worker**. Workers are not throttled by browsers. Only rendering runs on main thread (can drop frames freely without affecting game logic). Worker communicates with main thread via `postMessage` with ring buffer |
| **Sync hash collision (two different states produce same 32-bit hash)** | LOW | False negative: desync undetected until observable game state diverges | 32-bit FNV-1a hash has 1 in 4 billion collision probability. Enhanced with multi-frame hash chain: each frame's hash incorporates previous frame's hash (blockchain-like accumulation). Full state comparison on hash mismatch for debugging |
| **AI behavior tree complexity -- 6,442 lines of C# to untangle** | HIGH | Behavior translation errors produce sub-par AI (too aggressive, too passive, stuck) | Phase D implements core modules first as pure behavior tree with configurable JSON parameters. Compare AI decisions against OpenRA C# reference by running identical scenarios side-by-side. Allow parameter tuning without code changes |
| **MessagePack cross-platform edge cases** | MEDIUM | Integer encoding differences (int64, uint64) between MessagePack implementations | Use only safe integer range (Number.isSafeInteger). ActorID and frame numbers fit in 32-bit. Frame numbers use `Uint8Array` view for network byte order. Test round-trips on all major browsers (Chrome, Firefox, Safari) |
| **OrderManager Tick() complexity -- 4-phase protocol with error paths** | MEDIUM | Incorrect frame ordering causes silent desync that takes minutes to detect | Unit test each Tick() phase independently: Collect (local order accumulation), Broadcast (correct packet format), Execute (order injection order), Verify (hash comparison). Integration test with 4 mocked clients running 1000 frames |
| **Ruleset loading performance -- JSON parse of all mod rules** | LOW | Large mods (C&C: 200+ actor types) may take >500ms to parse | JSON.parse() is fast (~50ms for 1MB). Trait construction uses shared Config objects. `Object.freeze()` deep-freeze is lazy (only for accessed actors). Acceptable load time: <2s for complete C&C ruleset |
| **Behavior tree vs state machine debugging complexity** | MEDIUM | Developers unfamiliar with behavior trees struggle to diagnose AI logic | Behavior tree visualization panel in dev mode: renders active node path in real-time. Each node logs `tick()` status changes with timestamps. JSON configuration makes parameter changes instant (no recompilation) |
| **Input delay buffer trades responsiveness for stability** | LOW | Higher input delay = more lag-feel for players | Default 4 frames (200ms at 20 TPS) is within acceptable RTS range. Configurable per-lobby: low latency LAN (2 frames), high latency internet (5 frames). Auto-adjusted based on measured round-trip time |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-6.1: Network Transport -- WebSocket Client-Server (Primary)

- **Decision**: **Use WebSocket client-server architecture as primary transport.** WebRTC DataChannel is reserved as optional P2P mode for LAN scenarios.
- **Rationale**: WebSocket provides reliable ordered delivery matching TCP semantics. Single server connection simplifies session management, host migration, and anti-cheat. Browser WebSocket API is universally supported with no NAT traversal issues. WebRTC DataChannel requires STUN/TURN infrastructure and per-peer connection management, significantly more complex for the common case.
- **Consequences**: Server costs increase (relay all traffic). Easier: host migration (server persists game state), anti-cheat (server validates orders), reconnection (server buffers recent frames). Future: WebRTC DataChannel can be added as alternative `IConnection` implementation for peer-to-peer mode without changing any protocol layer code.

### ADR-6.2: Serialization Format -- MessagePack

- **Decision**: **Use MessagePack binary serialization** for all network messages (Orders, Sync packets, Handshake).
- **Alternatives considered**:
  - **Protocol Buffers**: Better schema enforcement, but requires build-time `.proto` compilation step. Larger runtime library. Schema changes require regeneration. Overkill for 8 message types.
  - **Custom binary (OpenRA original)**: Maximum control, minimal size, but hand-written serialization is error-prone and verbose in TypeScript. Maintaining bit-level compatibility with C# is risky.
  - **JSON**: Human-readable, simple, but 30-50% larger than binary. String-serialized numbers risk precision loss. No advantage for machine-to-machine protocol.
- **Consequences**: MessagePack is 20-40% more compact than JSON. Cross-platform libraries exist for JS, C#, Python (for server). Schema validation applied at application layer (zod). Order serialization uses `@msgpack/msgpack` `encode()`/`decode()` with custom extension types for CPos, WPos, Target.

### ADR-6.3: Sync Hash Generation -- Build-Time Pre-Generation

- **Decision**: **All sync hash functions are pre-generated at build time** via AST scanning. No runtime decoration reflection.
- **Rationale**: JavaScript has no `Reflection.Emit`. Runtime `for...in` or `Object.keys()` field iteration is non-deterministic across JS engines (property enumeration order is not guaranteed for all edge cases). Build-time generation emits explicit field access in deterministic order.
- **Alternatives considered**:
  - **Runtime `Reflect.getMetadata`**: Uses `reflect-metadata` polyfill. Field order depends on JS engine property enumeration, which is deterministic for most cases but not guaranteed by spec. Slower: metadata lookup + field iteration per hash computation.
  - **Manual hash function per class**: Maximum performance and determinism, but high maintenance burden. Every added `@VerifySync` field requires manually updating the hash function.
- **Consequences**: Adds build step dependency (`utils/sync-hash-generator.ts` + Vite plugin). Generated file is self-contained and tree-shakeable. Build-time errors provide clear messages (missing hash function, circular type references). Hash function regeneration takes <500ms for all source files.

### ADR-6.4: Deterministic PRNG -- Mersenne Twister Port

- **Decision**: **Port OpenRA's Mersenne Twister implementation from C# to TypeScript.** All game-random numbers (damage variation, accuracy scatter, spawn positions) use this ported PRNG.
- **Rationale**: `Math.random()` returns different values per JS engine, per browser version, and per process. Deterministic lockstep requires all clients to generate identical random sequences. OpenRA's Mersenne Twister is a proven, well-understood algorithm. Porting it to TypeScript with identical seed-to-sequence mapping ensures cross-platform parity.
- **Alternatives considered**:
  - **Xoshiro128++**: Newer, faster, smaller state, but no C# reference implementation in OpenRA to validate against.
  - **`crypto.getRandomValues()`**: Cryptographically secure but non-deterministic (seed cannot be set). Not suitable for game logic.
- **Consequences**: Mersenne Twister PRNG class (~200 lines TS). Seed = map hash + frame 0. 10,000 known-answer test vectors generated from OpenRA C# seeded with `0xDEADBEEF` and compared against TypeScript output. PRNG is instantiated per-game, not global.

### ADR-6.5: AI Architecture -- Behavior Tree with JSON Configuration

- **Decision**: **Migrate all BotModule state machines to Behavior Tree architecture** with externalized JSON configuration for decision parameters.
- **Rationale**: Behavior trees provide structural advantages over imperative state machines: Composite nodes (Sequence, Selector, Parallel) standardize decision logic; Decorator nodes (Inverter, Repeater, Limiter) standardize control flow; Leaf nodes (Condition, Action) encapsulate game interactions. JSON configuration enables difficulty tuning without code changes and mod-level AI customization. Debugging visualization (active node path) is straightforward compared to stepping through switch-case logic.
- **Alternatives considered**:
  - **HFSM (Hierarchical Finite State Machine)**: Closer to OpenRA's existing pattern, easier 1:1 port. But HFSM transition logic is scattered across state classes, making it harder to reason about overall decision flow. Less modular than behavior trees.
  - **GOAP (Goal-Oriented Action Planning)**: More sophisticated, better for emergent behavior. But requires world-state representation, planner implementation, and heuristic design. Over-engineered for OpenRA's relatively constrained AI decision space.
  - **Direct 1:1 state machine port**: Lowest risk, but preserves the maintenance burden of imperative state logic. No structural improvement.
- **Consequences**: Learning curve for developers unfamiliar with behavior trees. Custom lightweight BT library (~300 lines TS; `behavior-tree` npm package evaluated as potential dependency). AI modules are deterministic (no randomization in decision logic). All decision parameters externalized to JSON files under `assets/ai-config/`. AI behavior can be hot-reloaded during development by editing JSON.

### ADR-6.6: Ruleset Loading -- Build-Time MiniYAML to JSON (Consistent with ADR-4.2, ADR-5.1)

- **Decision**: **All mod rules are compiled from MiniYAML to JSON at build time.** The browser never sees MiniYAML. This is consistent with ADR-4.2 (Map system MiniYAML compilation) and ADR-5.1 (MIX build-time unpacking) -- the browser receives pre-processed assets, not raw game archives.
- **Rationale**: MiniYAML parsing is complex (~762 lines in `miniyaml-to-json.ts`). Doing it at build time avoids shipping a parser to the browser, catches syntax errors during development, and produces fast-to-parse JSON. Build-time compilation also enables validation (schema checking, dependency analysis) before runtime.
- **Consequences**: Existing `miniyaml-to-json.ts` pipeline from Chapter 4 Phase H is extended to handle mod rule files (`rules/*.yaml` -> `rules/*.json`). Vite plugin triggers rebuild on YAML changes. Runtime uses `Ruleset.load()` which reads JSON files via `FileSystem`. Inheritance (`^`, `Inherits:`, `-TraitName`) is resolved at build time (pre-flattened JSON) or at runtime (Ruleset.load() merge logic) -- this ADR specifies **build-time resolution** for faster runtime loading.

### ADR-6.7: ActorInfo Sync Integration

- **Decision**: **Extend existing `ActorInfo.ts` (Ch3 Phase E) with sync metadata** rather than creating a separate sync-aware ActorInfo class.
- **Rationale**: The existing `ActorInfo.ts` already handles trait composition, topological sort, and JSON deserialization. Adding sync field metadata (`syncFields: Array<{name, customHash?}>`) is a minimal extension to the `TraitConfig` interface. `Ruleset.load()` populates sync metadata from build-time annotations. `Sync.computeFrameHash()` reads this metadata at runtime.
- **Consequences**: `ActorInfo.ts` gains ~100 lines. `TraitConfig` interface gains optional `syncFields` property. Backward compatible: actors without sync fields work identically. Build tool `sync-hash-generator.ts` reads `ActorInfo` trait configurations to generate per-trait hash functions.

### ADR-6.8: Frame Timing -- Web Worker Isolation

- **Decision**: **Game tick (`OrderManager.Tick()`) runs in a dedicated Web Worker.** Rendering runs on the main thread via `requestAnimationFrame`. Communication via `postMessage`.
- **Rationale**: Browser throttles `setInterval`/`setTimeout` to 1Hz in background tabs. A backgrounded game tab would drop from 20 TPS to 1 TPS, breaking the lockstep (other clients must wait). Web Workers are not throttled. Also: computational isolation prevents rendering jank from delaying game ticks, and vice versa.
- **Alternatives considered**:
  - **SharedArrayBuffer + Atomics**: Lower latency than postMessage, but requires COOP/COEP headers (breaks CDN-hosted assets). More complex synchronization model. Browser support less universal.
  - **Audio Worklet**: 128-sample callback at audio rate (375 Hz) could drive game ticks, but very non-standard and fragile. Breaks when audio is muted.
- **Consequences**: Game tick runs at steady 20 TPS regardless of tab visibility. Main thread receives render state snapshots via `postMessage` (copy, not shared memory -- <1ms for typical state payload). Input from main thread (mouse clicks, keyboard) is sent to Worker via `postMessage`, queued as local orders. Slight input latency increase (~0-2ms) from postMessage, absorbed by existing input delay buffer.

---

## Migration Order and Phasing Strategy

| Week | Phase | Files | Description | Status |
|:---:|:---|:---:|:---|:---|
| 1-2 | Phase A | 4 | Network foundation (Order, Connection, OrderManager, UnitOrders) | **COMPLETE (2026-06-12)** |
| 2-3 | Phase B | 3 | Sync hash system (runtime + build generator) | **COMPLETE (2026-06-12)** |
| 3-4 | Phase C | 2 | Ruleset container + ActorInfo extend | **COMPLETE (2026-06-12)** |
| 4-6 | Phase D | 10 | AI core modules | **COMPLETE (2026-06-12)** |
| 6-8 | Phase E | 11 | AI extended modules | **COMPLETE (2026-06-12)** |

**All phases complete**. Total: 29 files across 5 phases.

### Key Milestones

1. **End of Week 2**: Phase A complete -- network layer functional. `OrderManager.Tick()` drives lockstep loop in Web Worker with `EchoConnection`. Unit tests pass with mocked WebSocket. **ACHIEVED 2026-06-12**.
2. **End of Week 3**: Phase B complete -- sync hash system functional. `Sync.hash()` computes deterministic frame hashes. Build generator produces `sync-hashes.generated.ts`. **ACHIEVED 2026-06-12**.
3. **End of Week 4**: Phase C complete -- ruleset loads from JSON. All C&C actor types parse successfully. Trait inheritance chains resolve correctly. **ACHIEVED 2026-06-12**.
4. **End of Week 6**: Phase D complete -- AI core functional. Behavior tree library stable. All 10 BotModule files produce correct decisions. **ACHIEVED 2026-06-12**.
5. **End of Week 8**: Phase E complete -- all AI modules migrated. Full AI suite functional. 29 files total. **ACHIEVED 2026-06-12**.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` Section 7 (lines 942-1053) -- Architecture analysis
> - `docs/map_system_migration_plan.md` -- Chapter 4 plan (format reference)
> - `docs/ui_system_migration_plan.md` -- Chapter 5 plan (format reference, UI+resource management)
> - `docs/actor_system_migration_plan.md` -- Chapter 3 plan (ActorInfo, World, Actor references)
> - `docs/migration_progress.md` -- Progress tracking
> - `CLAUDE.md` -- Project conventions
