# OpenRA to Babylon.js Migration Plan: Chapter 17 — Replay & Save System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.6 (Network/Replay) + Section 4.3 (Traits)
> **Chapter Status**: IN PROGRESS (2/8 migrated, 25%, Phase A COMPLETE)
> **Planning Date**: 2026-06-16
> **Prerequisite**: Chapters 2-7 COMPLETE (162/162, 100%), Chapter 6 Phase A (Order + Connection) COMPLETE
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: Core Foundation — GameInformation + ReplayMetadata](#31-phase-a-core-foundation--gameinformation--replaymetadata)
   - 3.2 [Phase B: Replay Recording & Playback](#32-phase-b-replay-recording--playback)
   - 3.3 [Phase C: Game Save System](#33-phase-c-game-save-system)
   - 3.4 [Phase D: Sync Reporting & Save Support Traits](#34-phase-d-sync-reporting--save-support-traits)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

Chapter 17 implements the replay recording/playback and game save/load systems. Unlike previous chapters that focused on rendering or gameplay mechanics, Ch17 is primarily a **data persistence layer** — capturing and restoring game state via binary file formats. This is the first chapter where the web platform's lack of a traditional filesystem becomes a central design concern.

The core paradigm shifts:

- **Binary file I/O** — C# `FileStream`/`BinaryWriter`/`BinaryReader` → TypeScript `ArrayBuffer`/`DataView`/`Uint8Array` for in-memory binary manipulation, with browser storage APIs for persistence
- **Filesystem paths** — C# `Platform.SupportDir/Replays/{modId}/{version}/` → IndexedDB object stores with composite keys, with OPFS (Origin Private File System) for directory-like browsing
- **Reflection-based trait serialization** — C# `Expression.Lambda<T>` + `[Sync]`/`[VerifySync]` attributes for ISync value extraction → TypeScript build-time code generation extending the existing `sync-hash-generator.ts` pattern (Ch6 Phase B)
- **Server-coupled save logic** — C# `GameSave.DispatchOrders()` called by `Server.cs` → `LocalGameCoordinator` virtual server pattern for single-player, with the same `GameSave` class reused in multiplayer via WebSocket server (Ch18)
- **MiniYAML trait data** — C# `MiniYaml` strings in `.orasav` format → JSON strings (output of Ch4 Phase H MiniYAML pipeline), maintaining binary framing compatibility
- **Connection transparency** — C# `ReplayConnection : IConnection` → TypeScript `implements IConnection` (already migrated in Ch6 Phase A), making replay playback completely transparent to `OrderManager`

### 1.2 Architecture Principles

1. **Binary format parity**: The `.orarep` (replay) and `.orasav` (save) binary layouts are preserved byte-for-byte. All multi-byte values use little-endian encoding matching C# `BinaryWriter`. This enables cross-compatibility between OpenRA desktop and OpenRAWeb3D for sharing replay files.

2. **Connection abstraction reuse**: `ReplayConnection` implements the existing `IConnection` interface from Chapter 6 Phase A. `Send()` and `SendImmediate()` are no-ops; `Receive()` feeds pre-recorded orders to `OrderManager` frame-by-frame. The game engine never knows whether orders come from a live network or a replay file.

3. **Storage provider abstraction**: All filesystem operations go through an `IStorageProvider` interface. Default implementation uses IndexedDB for persistent storage. Alternative backends: File System Access API for import/export, OPFS for directory browsing, in-memory for unit tests. This decouples game logic from browser storage specifics.

4. **Deferred trait data collection**: `GameSave` collects `IGameSaveTraitData` via `IssueTraitData()` before save, stores as JSON strings in the `.orasav` trait data section, and restores via `ResolveTraitData()` after load. This follows OpenRA's exact actor-traversal pattern.

5. **Build-time code generation for sync dumps**: `SyncReport`'s trait value extraction replaces C# runtime expression tree compilation with build-time generated dump functions (extending `sync-hash-generator.ts`). Zero runtime reflection overhead.

6. **Single-player virtual server**: In the browser single-player context, a `LocalGameCoordinator` hosts the `GameSave` instance and handles save/load lifecycle. This is the same `GameSave` class that a WebSocket server (Ch18) will use for multiplayer saves — no code duplication.

### 1.3 Completed Foundation

The following infrastructure from Chapters 2-7 is available for Chapter 17:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `IConnection`, `OrderManager`, `UnitOrders` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, `ISync` interface, `sync-hashes.generated.ts` |
| Session & Ruleset | Ch6 Phase C | `Session`, `Ruleset`, lobby data structures |
| World + Actor + TraitDictionary | Ch3 | `GameWorldManager`, `GameActor`, `TraitDictionary`, `ITick`, `INotifyCreated` |
| TraitsInterfaces | Ch3 | `ITraitInfo`, `TraitInfo<T>`, `ITick`, `IWorldLoaded`, `INotifyGameLoaded` |
| CoordinateTransformer | Ch4 Phase I | `wPosToVector3()`, `vector3ToWPos()`, WPos string parsing/formatting |
| FileSystem | Ch5 Phase A | `IPackage`, `Folder`, `FileSystem` (virtual path abstractions) |
| MOD System | Ch5 Phase C | `Manifest`, `ModData`, mod metadata access |
| Widget core + ChromeProvider | Ch5 Phases C-D | `Widget`, `ChromeProvider`, `WidgetLoader` (for Phase D UI integration) |
| Viewport | Ch7 Phase B | `Viewport`, `CenterPosition` (for GameSaveViewportManager) |
| WorldRenderer | Ch2 | `WorldRenderer` (for GameSaveViewportManager viewport access) |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (8 files across 4 Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: Core Foundation** | | | | | |
| 1 | `OpenRA.Game/GameInformation.cs` | `src/OpenRA.Game/GameInformation.ts` | `GameInformation` | 237 | MEDIUM | A |
| 2 | `OpenRA.Game/FileFormats/ReplayMetadata.cs` | `src/OpenRA.Game/FileFormats/ReplayMetadata.ts` | `ReplayMetadata` | 110 | MEDIUM | A |
| **Phase B: Replay Recording & Playback** | | | | | |
| 3 | `OpenRA.Game/Network/ReplayRecorder.cs` | `src/OpenRA.Game/Network/ReplayRecorder.ts` | `ReplayRecorder` | 119 | MEDIUM | B |
| 4 | `OpenRA.Game/Network/ReplayConnection.cs` | `src/OpenRA.Game/Network/ReplayConnection.ts` | `ReplayConnection` | 136 | MEDIUM | B |
| **Phase C: Game Save System** | | | | | |
| 5 | `OpenRA.Game/Network/GameSave.cs` | `src/OpenRA.Game/Network/GameSave.ts` | `GameSave` + `SlotClient` | 333 | **HIGH** | C |
| **Phase D: Sync Reporting & Save Support Traits** | | | | | |
| 6 | `OpenRA.Game/Network/SyncReport.cs` | `src/OpenRA.Game/Network/SyncReport.ts` | `SyncReport` | 342 | MEDIUM | D |
| 7 | `OpenRA.Mods.Common/Traits/World/AutoSave.cs` | `src/OpenRA.Mods.Common/Traits/World/AutoSave.ts` | `AutoSave` + `AutoSaveSettings` | 106 | LOW | D |
| 8 | `OpenRA.Mods.Common/Traits/Player/GameSaveViewportManager.cs` | `src/OpenRA.Mods.Common/Traits/Player/GameSaveViewportManager.ts` | `GameSaveViewportManager` | 65 | LOW | D |

> **Complexity Legend**:
> - **LOW**: Data structures or simple tick-based logic with few dependencies. 65-110 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with binary parsing, multiple interface implementations, or storage abstractions. 110-342 lines of C# with careful byte-level correctness requirements.
> - **HIGH**: Complex serialization logic with binary file format handling, trait data collection across actors, slot-client remapping, and state management. 333 lines of C# with significant integration surface.

### 2.2 Scope Notes

**Files explicitly added to scope** (not in original `remaining_systems_migration_plan.md` listing):
- **`GameInformation.cs`** (237 lines): `ReplayMetadata` wraps `GameInformation` as its central data object. `ReplayRecorder` creates metadata from it. Without `GameInformation.ts`, neither Phase A nor B can proceed.
- **`ReplayMetadata.cs`** (110 lines): `ReplayRecorder` has `Metadata.Write(writer)` in `Dispose()`. `ReplayConnection` calls `ReplayMetadata.Read(filename)` in its constructor. Hard dependency for replay subsystem.

**Files explicitly NOT in Ch17 scope** (already handled or deferred elsewhere):
- `ReplayBrowserLogic.cs` — Migrated in Ch16 (uses `ReplayMetadataStub`; to be updated after Ch17)
- `GameSaveBrowserLogic.cs` — Migrated in Ch16 (uses `GameSaveStub`; to be updated after Ch17)
- `GameSaveLoadingLogic.cs` — 47-line progress bar; deferred to Ch16 UI update
- `GameSaveUtils.cs` / `ReplayUtils.cs` — UI utility functions; deferred to Ch16
- `OrderIO.cs` — Packet parsing functions (`TryParseDisconnect`, `TryParseSync`, `TryParseOrderPacket`) already absorbed into existing `Order.ts` migration (Ch6 Phase A)
- `IGameSaveTraitData` interface — Defined in `TraitsInterfaces.cs`; to be added to existing `src/OpenRA.Game/TraitsInterfaces.ts` as a minor Ch3 update (not a standalone Ch17 file)

### 2.3 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 8 |
| **Phase A (Foundation)** | 2 files |
| **Phase B (Replay)** | 2 files |
| **Phase C (GameSave)** | 1 file |
| **Phase D (SyncReport + Traits)** | 3 files |
| **HIGH complexity** | 1 file (GameSave) |
| **MEDIUM complexity** | 4 files |
| **LOW complexity** | 3 files |
| **Total OpenRA C# source lines** | ~1,448 |

| Phase | Files | C# Lines | TS Lines (est.) | Tests (est.) | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| A: Foundation | 2 | 347 | 482+274=~756 | ~61 | ✅ COMPLETE |
| B: Replay | 2 | 255 | ~700 | ~40 | PLANNING |
| C: GameSave | 1 | 333 | ~1,000 | ~35 | PLANNING |
| D: SyncReport + Traits | 3 | 513 | ~900 | ~45 | PLANNING |
| **Total** | **8** | **~1,448** | **~3,250** | **~160** | **PLANNING** |

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: Core Foundation — GameInformation + ReplayMetadata

**Status**: ✅ COMPLETE (2/2 migrated, 61 tests)
**Complexity**: Medium
**Review**: PENDING (commit `68a96fa`)
**Blocked by**: Chapter 6 Phase C (Ruleset/Session for map/mod metadata), Chapter 4 Phase E (MapGenerationArgs) — COMPLETE
**Blocks**: Phase B (ReplayRecorder writes ReplayMetadata; ReplayConnection reads ReplayMetadata), Phase C (GameSave references similar metadata concepts)

**Description**: Phase A establishes the data model foundation that both replay and save systems depend on. `GameInformation` is a plain data transfer object containing all metadata about a game session (mod, version, map, players, duration, outcome). `ReplayMetadata` wraps `GameInformation` and handles the binary serialization format for the replay file footer. These two files are small but foundational — every other file in this chapter references them.

The key challenge is binary format fidelity: the replay file footer has a specific byte layout (`MetaStartMarker` = -1, `MetaVersion` = 0x01, length-prefixed UTF-8 YAML string for game info, `dataLength` int32, `MetaEndMarker` = -2) that must be written and read exactly. In TypeScript, this means careful use of `DataView.setInt32(offset, value, true)` (little-endian) and `TextEncoder`/`TextDecoder` for UTF-8 string handling.

**Paradigm Shifts**:
- C# `DateTime` → `Date` (with `.toISOString()` for serialization)
- C# `BinaryWriter.Write(int32)` → `DataView.setInt32(offset, value, true)` (little-endian)
- C# `FileStream.Seek(-12, SeekOrigin.End)` → ArrayBuffer with known footer offset via `byteLength - 12`
- C# `FieldLoader.Load<GameInformation>()` using MiniYAML → TypeScript `fromJSON()` factory method
- C# `List<GameInformation.Player>` mutable list → TypeScript typed array with validation
- C# `MiniYaml` string serialization → JSON (compatible evolution within the same binary framing)

#### 3.1.1 GameInformation

- [x] **TODO-17.A.1** `src/OpenRA.Game/GameInformation.ts` (237 lines C#) ✅ — Game metadata data transfer object:
  - Properties: `Mod: string`, `Version: string`, `MapUid: string`, `MapTitle: string`, `FinalGameTick: number`, `StartTimeUtc: Date`, `EndTimeUtc: Date`
  - `Duration: number` computed property (EndTimeUtc - StartTimeUtc in seconds)
  - `Players: GameInformationPlayer[]` array
  - `HumanPlayers: GameInformationPlayer[]` filter getter
  - `IsSinglePlayer: boolean` check
  - `MapGenerationArgs?: MapGenerationArgs` optional property
  - `DisabledSpawnPoints: Set<number>` for spawn restrictions
  - Inner class `GameInformationPlayer`:
    - Properties: `PlayerName`, `PlayerId`, `FactionId`, `FactionName`, `Team`, `SpawnPoint`, `IsHuman`, `IsBot`, `DisconnectFrame`, `WinState` (enum: Undefined/Won/Lost), `OutcomeTimestampUtc`
    - `PlayerActorId?: number` for actor reference
    - `fromJSON()` / `toJSON()` static methods
  - `fromJSON(json: string): GameInformation` static factory — parses JSON into typed object
  - `toJSON(): string` — serializes to JSON string for ReplayMetadata binary embedding
  - `addPlayer(name: string): GameInformationPlayer` factory method
  - `disconnectedPlayers(): GameInformationPlayer[]` filter for non-null DisconnectFrame
  - Validation: MapUid non-empty, at least one human player

#### 3.1.2 ReplayMetadata

- [x] **TODO-17.A.2** `src/OpenRA.Game/FileFormats/ReplayMetadata.ts` (110 lines C#) ✅ — Replay file metadata container with binary footer format:
  - Constants: `MetaStartMarker = -1`, `MetaEndMarker = -2`, `MetaVersion = 0x00000001`
  - `GameInfo: GameInformation` property (the wrapped game metadata)
  - `FilePath: string` for replay file location (virtual path)
  - `constructor(gameInfo: GameInformation)` — creates metadata wrapper from game info
  - `static readFromBuffer(data: ArrayBuffer): ReplayMetadata | null` — parses metadata from replay file footer:
    - Reads last 8 bytes: `dataLength: int32` + `MetaEndMarker: int32`
    - Computes metadata start offset: `totalLength - 12 - dataLength`
    - Verifies `MetaStartMarker` and `MetaVersion` at metadata start
    - Reads length-prefixed UTF-8 string → JSON → `GameInformation.fromJSON()`
    - Returns null for invalid/corrupt data (no throw — handles unknown replay versions gracefully)
  - `writeToBuffer(targetBuffer: Uint8Array, offset: number): number` — writes metadata to binary buffer:
    - Writes `MetaStartMarker`, `MetaVersion`
    - Writes length-prefixed UTF-8 JSON string of GameInfo
    - Writes total data length (for footer parsing)
    - Writes `MetaEndMarker`
    - Returns number of bytes written
  - `renameFile(newFilenameWithoutExtension: string): void` — updates FilePath
  - Version compatibility: rejects MetaVersion > 0x01 with clear error message

**Phase A Summary**: 2 files, ~347 C# lines. Target: `GameInformation.ts` + `ReplayMetadata.ts`. Estimated ~40 tests (~1,200 test lines).

---

### 3.2 Phase B: Replay Recording & Playback

**Status**: 📋 PLANNING (0/2 migrated)
**Complexity**: Medium
**Blocked by**: Phase A (ReplayMetadata for metadata writing/reading), Chapter 6 Phase A (IConnection, OrderManager, Order types)
**Blocks**: Nothing downstream (leaf nodes from a dependency perspective)

**Description**: Phase B implements the replay recording and playback loop. `ReplayRecorder` captures raw network order packets during gameplay and writes them to a binary `.orarep` file, with replay metadata appended on close. `ReplayConnection` reads a replay file and feeds recorded orders frame-by-frame into `OrderManager`, implementing the `IConnection` interface to make replay playback transparent to the game engine.

The replay binary format is simple: each packet is `[clientID: int32][dataLength: int32][data: byte[]]`. Frame-0 packets contain lobby and game-start orders; frame N+ packets are regular gameplay orders. The replay footer contains the metadata block (from Phase A). The pre-start buffer pattern (buffer everything until `StartGame` order is detected at frame 0, then flush to file) prevents recording incomplete games.

**Paradigm Shifts**:
- C# `BinaryWriter` over `FileStream` → `DataView` over growing `Uint8Array` buffer, then IndexedDB/Blob for persistence
- C# `MemoryStream preStartBuffer` → `Uint8Array` chunks array or single buffer with manual position tracking
- C# `File.Create()` / `Directory.CreateDirectory()` → IndexedDB object store `put()`, or `Blob` + `URL.createObjectURL` for download
- C# `OrderIO.TryParseOrderPacket()` → existing TypeScript `Order.deserialize()` from Ch6 Phase A
- C# `rs.ReadInt32()` / `rs.ReadBytes()` → `DataView.getInt32(offset, true)` / `buffer.slice(offset, offset+n)`
- C# `BitConverter.ToInt32(packet, 0)` for frame extraction → `new DataView(packet.buffer).getInt32(0, true)`
- C# `Queue<Chunk>` → `Chunk[]` array used as FIFO (single-threaded, no concurrent access)

#### 3.2.1 ReplayRecorder

- [ ] **TODO-17.B.1** `src/OpenRA.Game/Network/ReplayRecorder.ts` (119 lines C#) — Replay recording engine:
  - `Metadata: ReplayMetadata` property
  - `preStartBuffer: Uint8Array` with dynamic resize (or `number[][]` chunk list for append efficiency)
  - `chooseFilename: () => string` callback for filename generation
  - `static isGameStart(data: Uint8Array): boolean` — detects StartGame order at frame 0:
    - Parses packet via `Order.deserialize()`
    - Checks frame === 0 and any order has `orderString === "StartGame"`
  - `receive(clientID: number, data: Uint8Array): void` — writes `[clientID][data.length][data]` tuple:
    - If preStartBuffer active and `isGameStart(data)`: flush preStartBuffer to file, create real file
    - Write clientID (int32), data length (int32), data bytes
  - `receiveFrame(clientID: number, frame: number, data: Uint8Array): void` — convenience: prepends frame int32 to data then calls `receive()`
  - `startSavingReplay(initialContent: Uint8Array): void` — creates replay file:
    - Generates filename via `chooseFilename()` with collision avoidance (up to 128 retries, appending `-{id}`)
    - Writes initialContent (pre-start buffer) to file
    - Switches writer from buffer to persistent storage
  - `dispose(): void` — finalizes replay:
    - Sets `Metadata.GameInfo.EndTimeUtc = new Date()`
    - Writes `ReplayMetadata.writeToBuffer()` footer
    - Closes storage handle
  - Integration with storage provider for file creation and path resolution
  - `disposed: boolean` guard for double-dispose

#### 3.2.2 ReplayConnection

- [ ] **TODO-17.B.2** `src/OpenRA.Game/Network/ReplayConnection.ts` (136 lines C#) — Replay playback connection implementing `IConnection`:
  - Inner `Chunk` class: `Frame: number`, `Packets: { clientId: number; packet: Uint8Array }[]`
  - `chunks: Chunk[]` FIFO queue (no concurrency, so Array.shift() is acceptable)
  - `sync: { frame: number; syncHash: number; defeatState: bigint }[]` queue
  - `orderLatency: number` from game speed config
  - `TickCount: number`, `FinalGameTick: number`, `IsValid: boolean`, `LobbyInfo: Session`, `Filename: string` public properties
  - `constructor(replayFilename: string, replayData: ArrayBuffer)` — parses entire replay file:
    - Reads metadata from footer via `ReplayMetadata.readFromBuffer()`
    - Parses packet stream: reads `[clientID: int32][packetLen: int32][packet: byte[packetLen]]` tuples
    - Frame-0 packets: parses StartGame (sets IsValid=true) and SyncInfo (parses LobbyInfo)
    - Frame N+ packets: groups into Chunks by frame number
    - Skips Disconnect and SyncHash packet types in chunking (they're replayed separately)
    - Tracks `TickCount = Math.max(TickCount, frame)`
    - Computes `orderLatency` from `LobbyInfo.GlobalSettings.GameSpeed → GameSpeeds.Speeds[name].OrderLatency`
  - `startGame(): void` — no-op (replay provides all orders, game is already "started")
  - `send(frame: number, orders: Order[]): void` — **no-op**: ignore locally generated orders during replay
  - `sendImmediate(orders: Order[]): void` — **no-op**: replay is playback-only
  - `sendSync(frame: number, syncHash: number, defeatState: bigint): void` — enqueues sync hash for Receive
  - `receive(orderManager: OrderManager): void` — main playback loop:
    - First, dequeue all sync hashes and feed to `orderManager.receiveSync()`
    - Then, dequeue chunks where `chunk.Frame <= orderManager.netFrameNumber + orderLatency`
    - For each chunk packet: parse via `OrderIO` equivalents → dispatch to appropriate OrderManager method:
      - `TryParseDisconnect` → `orderManager.receiveDisconnect(clientId, frame)`
      - `TryParseSync` → `orderManager.receiveSync(sync)`
      - `TryParseOrderPacket` → frame===0 ? `receiveImmediateOrders` : `receiveOrders`
    - Throw `Error` on unknown packet format
  - `localClientId: number` getter — returns -1 (observer/spectator)
  - `dispose(): void` — no-op (no native resources to release)

**Phase B Summary**: 2 files, ~255 C# lines. Target: `ReplayRecorder.ts` + `ReplayConnection.ts`. Estimated ~40 tests (~1,500 test lines).

---

### 3.3 Phase C: Game Save System

**Status**: 📋 PLANNING (0/1 migrated)
**Complexity**: **HIGH** (complex binary format, trait data collection across actors, slot-client remapping)
**Blocked by**: Phase A (ReplayMetadata — shares binary serialization patterns), Chapter 6 Phase A (Order, Connection, OrderManager, Session types), Chapter 6 Phase C (Ruleset for MapCache)
**Blocks**: Phase D (AutoSave triggers GameSave; GameSaveViewportManager implements IGameSaveTraitData consumed by GameSave)

**Description**: Phase C is the most complex single file in Chapter 17. `GameSave` handles the complete save/load lifecycle: capturing all game state (network orders, sync hash, lobby configuration, slot-client mappings, trait-specific data) into a binary `.orasav` file, and restoring that state during load. It includes the `SlotClient` inner class for serializing client state (faction, team, color, spawn point).

The `.orasav` binary format has three sections separated by marker sentinels:
1. **Orders stream** (variable length): raw network frame data as `[dataLength+8: int32][frame: int32][clientSlot: int32][data: byte[]]`
2. **Metadata section** (between `MetadataMarker` and `TraitDataMarker`): lobby settings, slots, slot-clients, map args
3. **Trait data section** (between `TraitDataMarker` and footer): per-trait custom data keyed by trait index
4. **Footer** (last 12 bytes): `[ordersStreamLength: int32][traitDataOffset: int32][EOFMarker: int32]`

The critical architectural consideration is that `GameSave.DispatchOrders()` and `GameSave.ParseOrders()` are server-side logic in OpenRA. For browser single-player, a `LocalGameCoordinator` hosts the `GameSave` instance and handles save/load orders without a network server.

**Paradigm Shifts**:
- C# `File.OpenRead()` / `File.Create()` → `ArrayBuffer` read from / `Blob` write to IndexedDB
- C# `BinaryWriter.WriteLengthPrefixedString(Encoding.UTF8, ...)` → `TextEncoder.encode(str)`, write length as int32, write bytes
- C# `BinaryReader.ReadLengthPrefixedString(Encoding.UTF8, maxLength)` → read int32 length, `TextDecoder.decode(buffer.slice(pos, pos+len))`
- C# `MiniYaml.FromString()` / `FieldLoader.Load<T>()` for metadata → `JSON.parse()` with typed `fromJSON()` factories
- C# `Exts.ParseInt32Invariant()` → `parseInt(str, 10)` or `Number(str)`
- C# `Session.Global.Serialize()` / `Session.Slot.Serialize()` → existing Session serialization from Ch6 Phase C
- C# `FieldSaver.Save(this)` for SlotClient → `JSON.stringify(client.toJSON())`
- C# server calls `DispatchOrders()` / `ParseOrders()` → `LocalGameCoordinator` for single-player, WebSocket server (Ch18) for multiplayer
- C# `MemoryStream` with `Seek`/`CopyTo` → `Uint8Array` subarray views with manual position tracking

#### 3.3.1 GameSave + SlotClient

- [ ] **TODO-17.C.1** `src/OpenRA.Game/Network/GameSave.ts` (333 lines C#) — Complete game save serialization/deserialization:

  **Constants & Core State**:
  - `EOFMarker = -2`, `MetadataMarker = -1`, `TraitDataMarker = -3`
  - `ordersStream: Uint8Array` with manual write position (append-only, dynamic resize)
  - `LastOrdersFrame: number` (initialized to -1)
  - `LastSyncFrame: number` (initialized to -1)
  - `lastSyncPacket: Uint8Array` (length = `Order.SyncHashOrderLength`, typically 13 bytes)
  - `GlobalSettings: Session.Global`
  - `Slots: Map<string, Session.Slot>`
  - `SlotClients: Map<string, SlotClient>`
  - `TraitData: Map<number, any>` (JSON values instead of MiniYaml)
  - `MapGenerationArgs?: MapGenerationArgs`
  - `clientsBySlotIndex: number[]` (private, set in `startGame()`)
  - `firstBotSlotIndex: number` (private, set in `startGame()`, initialized to -1)

  **SlotClient inner class**:
  - Properties: `Color: Color`, `Faction: string`, `SpawnPoint: number`, `Team: number`, `Handicap: number`, `Slot: string`, `Bot: string | null`, `IsAdmin: boolean`, `BotName: string`
  - `static deserialize(data: any): SlotClient` — creates from JSON object
  - `serialize(key: string): { key: string; value: any }` — serializes to JSON-compatible object
  - `applyTo(client: Session.Client): void` — copies SlotClient state to a Session.Client

  **Constructor (empty save)**:
  - `constructor()` — initializes `LastOrdersFrame = -1`, empty Slots, empty ordersStream

  **Constructor (load from file)**:
  - `constructor(filepath: string, data: ArrayBuffer)` — loads save from binary buffer:
    - Reads footer: last 12 bytes → `metadataOffset: int32`, `traitDataOffset: int32`, verify `EOFMarker`
    - Seeks to `metadataOffset`, verifies `MetadataMarker`
    - Reads `LastOrdersFrame`, `LastSyncFrame`, `lastSyncPacket` (SyncHashOrderLength bytes)
    - Reads length-prefixed UTF-8 strings: globalSettings → `Session.Global.deserialize(JSON.parse(...))`
    - Reads slots → `Map<string, Session.Slot>` via `Session.Slot.deserialize()`
    - Reads slotClients → `Map<string, SlotClient>` via `SlotClient.deserialize()`
    - Reads mapGenerationArgs (may be empty string → null)
    - Seeks to `traitDataOffset`, verifies `TraitDataMarker`
    - Reads trait data: length-prefixed UTF-8 string → `JSON.parse()` → `Map<number, any>` (key=int index, value=per-trait data)
    - Copies orders section (bytes 0 to metadataOffset) to `ordersStream`

  **Game Lifecycle Methods**:
  - `startGame(lobbyInfo: Session, map: MapPreview): void`:
    - Stores `MapGenerationArgs` for generated maps
    - Builds `clientsBySlotIndex`: maps slot key → client index (spectators → -1)
    - Deep-clones `GlobalSettings`, `Slots`, `SlotClients` via serialize/deserialize round-trip
    - Identifies `firstBotSlotIndex` for bot order remapping hack (see `dispatchOrders`)
    - Skips non-playable player references
  - `dispatchOrders(conn: Connection, frame: number, data: Uint8Array): void`:
    - Sync packet handling: if data[0] === OrderType.SyncHash && frame > LastSyncFrame → update LastSyncFrame + lastSyncPacket
    - Skips orders with frame <= LastOrdersFrame (dedup)
    - Skips immediate orders (data[0] === 0xFE)
    - Maps `conn.playerIndex` to `clientSlot` via `clientsBySlotIndex`
    - **HACK**: If clientSlot === -1 (spectator sending bot orders), maps to `firstBotSlotIndex`
    - Writes to ordersStream: `[data.length + 8: int32][frame: int32][clientSlot: int32][data: byte[]]`
    - Updates `LastOrdersFrame = frame`
  - `parseOrders(lobbyInfo: Session, packetFn: (frame: number, clientIndex: number, data: Uint8Array) => void): void`:
    - First: emits all `TraitData` entries as "SaveTraitData" orders (guarantees trait data available when needed)
    - Iterates ordersStream: reads `[dataLength: int32][frame: int32][slot: int32][data: byte[]]`
    - Remaps `slot → clientIndex` via `clientsBySlotIndex`
    - Bot controller remapping: if client is a bot, uses `client.botControllerClientIndex`
    - Calls `packetFn(frame, clientIndex, data)` for each order
    - Finally: emits lastSyncPacket to validate restore
  - `addTraitData(traitIndex: number, data: any): void` — stores trait-specific data:
    - `TraitData.set(traitIndex, data)`
  - `save(path: string): Blob` — serializes complete `.orasav` binary file:
    - Writes ordersStream (raw bytes)
    - Writes `MetadataMarker`, `LastOrdersFrame`, `LastSyncFrame`, `lastSyncPacket`
    - Writes length-prefixed UTF-8 JSON strings: globalSettings, slots, slotClients, mapGenerationArgs
    - Records `traitDataOffset`; writes `TraitDataMarker`
    - Writes length-prefixed UTF-8 JSON string of serialized TraitData
    - Writes footer: `ordersStream.length`, `traitDataOffset`, `EOFMarker`
    - Returns `Blob` for download or IndexedDB storage

**Phase C Summary**: 1 file, ~333 C# lines. Target: `GameSave.ts` (includes `SlotClient`). Estimated ~35 tests (~2,000 test lines).

---

### 3.4 Phase D: Sync Reporting & Save Support Traits

**Status**: 📋 PLANNING (0/3 migrated)
**Complexity**: Low-Medium
**Blocked by**: Phase C (AutoSave triggers GameSave; GameSaveViewportManager implements IGameSaveTraitData consumed by GameSave's trait data collection), Chapter 6 Phase B (ISync interface, Sync.Hash for SyncReport)
**Blocks**: Nothing (leaf nodes — no other files depend on these)

**Description**: Phase D contains three independent files that build on the save infrastructure. `SyncReport` is a diagnostic tool for debugging network desyncs — it snapshots sync state (ISync trait values, effects, pending orders) across recent frames in a ring buffer and dumps a detailed report when a desync is detected. `AutoSave` is a world trait that periodically triggers `GameSave` based on a configurable interval, with automatic file rotation. `GameSaveViewportManager` implements `IGameSaveTraitData` to save and restore the viewport camera position across save/load cycles.

The most technically interesting file is `SyncReport`: the C# version uses runtime `Expression.Lambda<T>` compilation to efficiently extract `[VerifySync]`-annotated field values from ISync trait instances. In TypeScript, we replace this with build-time code generation — extending the existing `sync-hash-generator.ts` (Ch6 Phase B) to also emit "sync dump" functions that return name-value pairs for all sync fields.

**Paradigm Shifts**:
- C# `Expression.Lambda<Func<ISync, object>>` + `Compile()` → TypeScript build-time generated dump functions in `sync-hashes.generated.ts`
- C# `[VerifySync]` attribute → `/** @VerifySync */` JSDoc marker (existing convention from Ch6 Phase B)
- C# `Values` struct (4-slot inline storage optimization) → plain `unknown[]` array (JS arrays are heap-allocated anyway)
- C# `Log.AddChannel("sync", filename)` / `Log.Write()` → custom `SyncLogBuffer` writing to a downloadable text blob
- C# `DirectoryInfo.EnumerateFiles("autosave-*")` → IndexedDB cursor iteration with prefix filter
- C# `File.Delete()` / `File.GetCreationTime()` → IndexedDB `objectStore.delete(key)` / record timestamp
- C# `FieldLoader.GetValue<WPos>()` — WPos string format → `WPos.fromString()` static factory
- C# `worldRenderer.Viewport.Center()` → existing `Viewport.centerPosition` setter (Ch7 Phase B)

#### 3.4.1 SyncReport

- [ ] **TODO-17.D.1** `src/OpenRA.Game/Network/SyncReport.ts` (342 lines C#) — Desync diagnostic report generator:
  - `NumSyncReports = 7` (ring buffer size — captures last 7 frames)
  - Inner `Report` class: `Frame: number`, `SyncedRandom: number`, `TotalCount: number`, `Traits: TraitReport[]`, `Effects: EffectReport[]`, `Orders: ClientOrder[]`
  - Inner `TraitReport` interface: `ActorID: number`, `Type: string`, `Owner: string`, `Trait: string`, `Hash: number`, `NamesValues: Record<string, unknown>`
  - Inner `EffectReport` interface: `Name: string`, `Hash: number`, `NamesValues: Record<string, unknown>`
  - `syncReports: Report[]` ring buffer (pre-allocated array of 7 empty Reports)
  - `curIndex: number` ring buffer write position
  - `typeInfoCache: Map<string, SyncTypeInfo>` — maps trait class name → dump function + property names:
    - Each `SyncTypeInfo` stores: `names: string[]`, `dumpFn: (instance: ISync) => unknown[]`
    - Dump functions are generated at build time and imported from `sync-hashes.generated.ts`
  - `dumpSyncTrait(sync: ISync): { names: string[]; values: unknown[] }`:
    - Looks up type in `typeInfoCache`
    - Calls `dumpFn(sync)` to extract all `@VerifySync` field values
    - Returns name-value pair
  - `updateSyncReport(orders: ClientOrder[]): void`:
    - Calls `generateSyncReport(syncReports[curIndex], orders)`
    - Advances `curIndex = (curIndex + 1) % NumSyncReports`
  - `generateSyncReport(report: Report, orders: ClientOrder[]): void`:
    - Records `Frame = orderManager.netFrameNumber`
    - Records `SyncedRandom = world.sharedRandom.last`, `TotalCount = world.sharedRandom.totalCount`
    - Iterates `world.actorsHavingTrait<ISync>()`:
      - For each actor, for each sync hash → compute `Sync.hash(trait)`
      - If hash !== 0: record TraitReport with ActorID, Type, Owner, Trait name, Hash, and dumped NamesValues
    - Iterates `world.syncedEffects`:
      - For each effect → compute `Sync.hash(effect)`
      - If hash !== 0: record EffectReport with name, hash, and dumped NamesValues
    - Copies orders list
  - `dumpSyncReport(frame: number): string`:
    - Generates timestamp: `new Date().toISOString().replace(/[:.]/g, '')`
    - Formats report filename-like identifier
    - Searches ring buffer for matching frame
    - If found: builds detailed multiline report string with:
      - Player info, platform info, game ID, mod version
      - SharedRandom state
      - All synced traits with field values (indented)
      - All synced effects with field values (indented)
      - All issued orders
    - If not found: reports "Recorded frames do not contain the frame"
    - Returns report string (for download or console output)
    - Also outputs list of all recorded frames for context

#### 3.4.2 AutoSave

- [ ] **TODO-17.D.2** `src/OpenRA.Mods.Common/Traits/World/AutoSave.ts` (106 lines C#) — Automatic save trait with file rotation:
  - `AutoSaveSettings` class (shared settings module):
    - `AutoSaveInterval: number` — frequency in seconds (0 = disabled, default 0)
    - `AutoSaveMaxFileCount: number` — max files to keep (default 10, minimum 3)
  - `AutoSaveInfo` class implementing `ITraitInfo`:
    - `[TraitLocation(SystemActors.World)]`
    - `create(init: ActorInitializer): AutoSave`
  - `AutoSave` class implementing `ITick`:
    - Constants: `AutoSavePattern = "autosave-"`, `SaveFileExtension = ".orasav"`
    - `ticksUntilAutoSave: number` countdown timer
    - `lastSaveInterval: number` for interval change detection
    - `isDisabled: boolean` — true when: dedicated server, replay mode, game save loading, >1 non-bot client (multiplayer)
    - `autoSaveSettings: AutoSaveSettings` reference
    - `constructor(self: Actor, info: AutoSaveInfo)`:
      - Loads settings via `self.world.getSettings<AutoSaveSettings>()`
      - Initializes `ticksUntilAutoSave = getTicksBetweenAutosaves(self)`
      - Sets `isDisabled` based on game mode checks
    - `tick(self: Actor): void`:
      - Returns early if `isDisabled || world.isReplay || world.isLoadingGameSave || autoSaveInterval === 0`
      - Detects interval change → recalculates timer
      - Decrements `ticksUntilAutoSave`; returns if > 0
      - File rotation: enumerates existing auto-save files, sorts by creation time desc, deletes all beyond `autoSaveMaxFileCount - 1`
      - Generates filename: `autosave-{ISO datetime}.orasav`
      - Calls `self.world.requestGameSave(filename, isAutosave=true)`
      - Resets timer
    - `getAutoSaveFiles(): StorageEntry[]`:
      - Queries IndexedDB for entries matching `autosave-*.orasav` pattern
      - Returns sorted by creation timestamp
    - `getTicksBetweenAutosaves(self: Actor): number`:
      - Returns `1000 / self.world.timestep * autoSaveSettings.autoSaveInterval`

#### 3.4.3 GameSaveViewportManager

- [ ] **TODO-17.D.3** `src/OpenRA.Mods.Common/Traits/Player/GameSaveViewportManager.ts` (65 lines C#) — Viewport state save/restore across save/load:
  - `GameSaveViewportManagerInfo` class implementing `ITraitInfo`:
    - `[TraitLocation(SystemActors.Player)]`
    - `create(init: ActorInitializer): GameSaveViewportManager`
  - `GameSaveViewportManager` class implementing `IWorldLoaded`, `IGameSaveTraitData`:
    - `worldRenderer: WorldRenderer` reference (set in `worldLoaded()`)
    - `worldLoaded(w: World, wr: WorldRenderer): void` — stores WorldRenderer reference
    - `issueTraitData(self: Actor): Record<string, any> | null`:
      - **HACK**: Stores observer viewport on first bot's trait for skirmish saves
      - Checks: if localPlayer exists and self !== localPlayer.playerActor → return null
      - If localPlayer === null (observer) and self.owner is not first bot → return null
      - Returns `{ Viewport: wPosToString(worldRenderer.viewport.centerPosition), RenderPlayer?: actorId }`
      - `RenderPlayer` only included for observer mode
    - `resolveTraitData(self: Actor, data: Record<string, any>): void`:
      - If `data.Viewport` exists: parses WPos string → `worldRenderer.viewport.center(wPos)`
      - If `data.RenderPlayer` exists: finds actor by ID → `world.renderPlayer = actor.owner`
  - **Note**: WPos serialization uses `WPos.toString()` format; deserialization uses `WPos.fromString()`.

**Phase D Summary**: 3 files, ~513 C# lines. Target: `SyncReport.ts` + `AutoSave.ts` + `GameSaveViewportManager.ts`. Estimated ~45 tests (~1,500 test lines).

---

## 4. Dependency Graph

```
Chapters 2-7 (COMPLETE — Foundation)
  │
  ├── Phase A (GameInformation + ReplayMetadata: 2 files)
  │     │
  │     ├── Phase B (ReplayRecorder + ReplayConnection: 2 files)
  │     │     └── (leaf — nothing depends on Replay subsystem)
  │     │
  │     └── Phase C (GameSave: 1 file)
  │           │
  │           └── Phase D (AutoSave + GameSaveViewportManager: 2 files)
  │                 └── (leaf)
  │
  └── Phase D (SyncReport: 1 file, independent — only needs ISync from Ch6 Phase B)

Internal Dependencies:

  GameInformation.cs ──── (pure data class, no code deps)
  ReplayMetadata.cs ───── GameInformation.cs (wraps GameInfo property)
  ReplayRecorder.cs ───── ReplayMetadata.cs (writes metadata footer), IConnection
  ReplayConnection.cs ─── ReplayMetadata.cs (reads metadata), IConnection, OrderManager, Order types
  GameSave.cs ─────────── Session types (Ch6 Phase C), Order types (Ch6 Phase A)
  AutoSave.cs ─────────── GameSave.ts (Phase C), ITick, World.RequestGameSave()
  SyncReport.cs ───────── ISync (Ch6 Phase B), World.actorsHavingTrait, Sync.Hash()
  GameSaveViewportManager.cs ─── IGameSaveTraitData (Ch3 interfaces), WorldRenderer (Ch2), Viewport (Ch7)
```

### 4.1 Critical Path

```
Phase A ──→ Phase C ──→ Phase D (AutoSave + GameSaveViewportManager)
Phase A ──→ Phase B (parallel with C)
Phase D (SyncReport) — independent, any time after Ch6 Phase B
```

Total serial depth: **3 phases** (A → C → D). Phase B and Phase D (SyncReport) can run in parallel.

### 4.2 Parallelization Opportunities

| Parallel Group | Files | Blocking Dependency |
|:---|:---|:---|
| Group 1 | Phase A: GameInformation + ReplayMetadata | (ReplayMetadata after GameInformation — sequential within group) |
| Group 2A | Phase B: ReplayRecorder + ReplayConnection | Phase A complete |
| Group 2B | Phase C: GameSave | Phase A complete |
| Group 3A | Phase D: SyncReport | Ch6 Phase B — can run ANY time |
| Group 3B | Phase D: AutoSave + GameSaveViewportManager | Phase C complete |

Maximum parallel agents: 3 (SyncReport in parallel with Phase B, while Phase C blocks Phase D traits).

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

All 8 files are pure logic (no GPU rendering), making them ideal for unit testing. Babylon.js mocking is not required — only `Order`, `OrderManager`, `Session`, `ISync`, and storage abstractions need mocking.

#### Phase A Tests

- [ ] **TEST-17.A.1** GameInformation — serialization round-trip: `fromJSON(toJSON(gameInfo))` produces identical object
- [ ] **TEST-17.A.2** GameInformation — Player array integrity: HumanPlayers filter, IsSinglePlayer check, disconnectedPlayers filter
- [ ] **TEST-17.A.3** GameInformation — `addPlayer()` correctly initializes default player properties
- [ ] **TEST-17.A.4** GameInformation — fromJSON rejects malformed JSON (missing required fields)
- [ ] **TEST-17.A.5** ReplayMetadata — `writeToBuffer()` + `readFromBuffer()` round-trip preserves all GameInfo fields
- [ ] **TEST-17.A.6** ReplayMetadata — `readFromBuffer()` rejects corrupt data (wrong MetaStartMarker, wrong MetaVersion, truncated buffer)
- [ ] **TEST-17.A.7** ReplayMetadata — `readFromBuffer()` returns null for files from future MetaVersion
- [ ] **TEST-17.A.8** ReplayMetadata — footer offset computation correct for various file sizes

#### Phase B Tests

- [ ] **TEST-17.B.1** ReplayRecorder — `isGameStart()` correctly detects StartGame order at frame 0
- [ ] **TEST-17.B.2** ReplayRecorder — `isGameStart()` returns false for non-StartGame order at frame 0
- [ ] **TEST-17.B.3** ReplayRecorder — pre-start buffer: orders before StartGame buffered, flushed on StartGame detection
- [ ] **TEST-17.B.4** ReplayRecorder — `receive()` writes correct binary format: `[clientID: int32][dataLen: int32][data: bytes]`
- [ ] **TEST-17.B.5** ReplayRecorder — `dispose()` writes metadata footer and closes storage
- [ ] **TEST-17.B.6** ReplayRecorder — double dispose is safe (idempotent)
- [ ] **TEST-17.B.7** ReplayConnection — parses replay binary format correctly; extracts chunks grouped by frame
- [ ] **TEST-17.B.8** ReplayConnection — `receive()` feeds orders to OrderManager at correct frame (respecting orderLatency)
- [ ] **TEST-17.B.9** ReplayConnection — `send()` and `sendImmediate()` are no-ops (don't modify any state)
- [ ] **TEST-17.B.10** ReplayConnection — `sendSync()` enqueues sync hash correctly
- [ ] **TEST-17.B.11** ReplayConnection — `receive()` processes sync hashes before chunks
- [ ] **TEST-17.B.12** ReplayConnection — frame-0 StartGame order sets `IsValid = true`
- [ ] **TEST-17.B.13** ReplayConnection — frame-0 SyncInfo order parses LobbyInfo correctly
- [ ] **TEST-17.B.14** ReplayConnection — `localClientId` returns -1
- [ ] **TEST-17.B.15** ReplayConnection — `TickCount` tracks maximum frame number across all chunks

#### Phase C Tests

- [ ] **TEST-17.C.1** SlotClient — `serialize()` + `deserialize()` round-trip preserves all fields
- [ ] **TEST-17.C.2** SlotClient — `applyTo(Session.Client)` correctly transfers all properties
- [ ] **TEST-17.C.3** GameSave — constructor() initializes with LastOrdersFrame = -1, empty state
- [ ] **TEST-17.C.4** GameSave — `save()` + constructor(data) round-trip preserves all metadata fields
- [ ] **TEST-17.C.5** GameSave — binary format: footer has correct offsets and EOFMarker
- [ ] **TEST-17.C.6** GameSave — `save()` produces valid .orasav format (markers at correct positions)
- [ ] **TEST-17.C.7** GameSave — constructor(data) correctly parses all sections: orders, metadata, trait data
- [ ] **TEST-17.C.8** GameSave — constructor(data) throws on missing EOFMarker
- [ ] **TEST-17.C.9** GameSave — `dispatchOrders()` skips orders with frame <= LastOrdersFrame
- [ ] **TEST-17.C.10** GameSave — `dispatchOrders()` skips immediate orders (0xFE prefix)
- [ ] **TEST-17.C.11** GameSave — `dispatchOrders()` correctly updates LastSyncFrame for sync packets
- [ ] **TEST-17.C.12** GameSave — `dispatchOrders()` handles spectator-to-bot order remapping (HACK path)
- [ ] **TEST-17.C.13** GameSave — `parseOrders()` replays trait data orders before frame orders
- [ ] **TEST-17.C.14** GameSave — `parseOrders()` replays orders in correct frame-slot sequence
- [ ] **TEST-17.C.15** GameSave — `parseOrders()` remaps bot slot to controller client correctly
- [ ] **TEST-17.C.16** GameSave — `parseOrders()` emits lastSyncPacket as final order
- [ ] **TEST-17.C.17** GameSave — `startGame()` correctly deep-clones lobby state (modifying original doesn't affect save)
- [ ] **TEST-17.C.18** GameSave — `startGame()` builds clientsBySlotIndex correctly
- [ ] **TEST-17.C.19** GameSave — `addTraitData()` stores and retrieves trait data by index
- [ ] **TEST-17.C.20** GameSave — UTF-8 length-prefixed strings handle Unicode characters correctly

#### Phase D Tests

- [ ] **TEST-17.D.1** SyncReport — ring buffer wraps correctly at NumSyncReports boundary
- [ ] **TEST-17.D.2** SyncReport — `generateSyncReport()` records Frame, SyncedRandom, TotalCount
- [ ] **TEST-17.D.3** SyncReport — `generateSyncReport()` extracts ISync trait values for actors with non-zero hash
- [ ] **TEST-17.D.4** SyncReport — `generateSyncReport()` records synced effects
- [ ] **TEST-17.D.5** SyncReport — `dumpSyncReport()` finds matching frame in ring buffer and formats report
- [ ] **TEST-17.D.6** SyncReport — `dumpSyncReport()` handles frame-not-found gracefully (records list of available frames)
- [ ] **TEST-17.D.7** AutoSave — generates correct filename pattern: `autosave-{ISO datetime}.orasav`
- [ ] **TEST-17.D.8** AutoSave — disables itself during replay mode
- [ ] **TEST-17.D.9** AutoSave — disables itself during game save loading
- [ ] **TEST-17.D.10** AutoSave — disables itself for >1 non-bot client (multiplayer)
- [ ] **TEST-17.D.11** AutoSave — decrements tick countdown correctly; triggers save at zero
- [ ] **TEST-17.D.12** AutoSave — recalculates timer when AutoSaveInterval setting changes
- [ ] **TEST-17.D.13** AutoSave — file rotation: deletes oldest files beyond AutoSaveMaxFileCount
- [ ] **TEST-17.D.14** GameSaveViewportManager — `issueTraitData()` returns Viewport WPos string
- [ ] **TEST-17.D.15** GameSaveViewportManager — `resolveTraitData()` correctly restores Viewport.Center()
- [ ] **TEST-17.D.16** GameSaveViewportManager — `issueTraitData()` returns null for non-local non-observer players
- [ ] **TEST-17.D.17** GameSaveViewportManager — `resolveTraitData()` restores RenderPlayer for observer mode

### 5.2 Integration Testing

- [ ] **TEST-17.I1** End-to-end replay recording: Record simulated game session → verify binary file format → play back via ReplayConnection → verify OrderManager receives identical orders at identical frames
- [ ] **TEST-17.I2** End-to-end save/load: Create GameSave mid-session → serialize to binary → load via new GameSave(data) → verify ParseOrders replays all trait data + orders
- [ ] **TEST-17.I3** Auto-save cycle: Simulate AutoSave tick countdown → verify GameSave triggered → verify file stored → load and verify state
- [ ] **TEST-17.I4** Cross-compatibility: Parse a known-good `.orarep` file from OpenRA desktop in ReplayConnection → verify metadata and order extraction

### 5.3 Visual Acceptance Testing

No visual acceptance tests are needed for this chapter — all logic is non-rendering game state serialization. However, after Ch17 completion, the Ch16 acceptance test pages for `ReplayBrowserLogic` and `GameSaveBrowserLogic` should be updated to use real types instead of stubs.

### 5.4 Performance Acceptance Criteria

| Metric | Threshold | Rationale |
|--------|:---:|-----------|
| ReplayConnection file parse (100K frame replay) | < 500ms | Replay files can be large; parsing must be fast enough for smooth UX |
| GameSave.save() (mid-game, 1000 actors) | < 200ms | Save must not cause noticeable frame hitch |
| GameSave constructor(load) (mid-game, 1000 actors) | < 300ms | Load time should be comparable to OpenRA desktop |
| AutoSave file enumeration (100 files) | < 50ms | IndexedDB cursor iteration must be fast |
| SyncReport.generateSyncReport() (1000 actors × 5 traits each) | < 10ms | Must not impact frame time (only called during development/debug) |

---

## 6. Risk and Considerations

### 6.1 High-Risk Items

| Risk | Severity | Impact | Mitigation |
|:---|:---:|:---|:---|
| **Binary format byte-order mismatch** | **HIGH** | Replay/save files incompatible with OpenRA desktop; cross-version sharing broken | All `DataView` operations use `true` for littleEndian. Validate against known-good `.orarep`/`.orasav` files from OpenRA desktop in CI. |
| **IndexedDB storage quota** | MEDIUM | Auto-saves fail silently; user loses progress | Check `navigator.storage.estimate()` before save. Enforce `AutoSaveMaxFileCount` rotation aggressively. Warn users when quota is low. |
| **GameSave server coupling** | MEDIUM | `dispatchOrders()`/`parseOrders()` have no server to call them in single-player | Design `LocalGameCoordinator` virtual server pattern. Test single-player save/load without any server dependency. |
| **ReplayConnection order latency** | MEDIUM | Replay desyncs if orderLatency doesn't match recording speed | Use exact C# formula: `gameSpeeds[speedName].OrderLatency` from Session. Parse latency from replay's LobbyInfo. |
| **Long replay memory usage** | MEDIUM | 100K+ frame replays consume hundreds of MB in ArrayBuffer | Implement streaming parse mode for ReplayConnection. Consider chunk-based loading from IndexedDB for very large replays. |
| **UTF-8 string edge cases** | LOW | Corrupted save files with non-ASCII player names, chat messages | Standard `TextEncoder`/`TextDecoder` handles all Unicode. Write fuzz tests with emoji, CJK, RTL characters. |
| **SyncReport build-time code gen** | LOW | Adding new `@VerifySync` fields requires rebuild to regenerate dump functions | Already the case for hash functions (Ch6 Phase B). Document the build step in developer guide. |

### 6.2 Browser-Specific Limitations

| Limitation | Impact | Workaround |
|:---|:---|:---|
| No persistent writable filesystem | Auto-save needs IndexedDB; manual save needs download prompt | ADR-17.2 two-tier storage strategy |
| No `Platform.SupportDir` equivalent | Save/replay paths must be virtualized | Abstract path layer via `IStorageProvider` |
| File System Access API not universal | Directory-based save browsing not available in all browsers | Fallback to IndexedDB-only listing with import/export buttons |
| Browser storage eviction under pressure | IndexedDB may be cleared by browser | Warn users; suggest downloading important saves as files |
| No server in single-player context | `GameSave.dispatchOrders()` has no server caller | `LocalGameCoordinator` virtual server pattern (ADR-17.3) |

### 6.3 Cross-Chapter Integration Points

After Ch17 migration, the following existing files need updates:

| File | Change Needed | Priority |
|:---|:---|:---|
| `src/OpenRA.Game/World.ts` | Add `requestGameSave()` method (traverses IGameSaveTraitData actors, emits SaveTraitData orders) | After Phase C |
| `src/OpenRA.Game/Network/UnitOrders.ts` | Add "SaveTraitData" and "CreateGameSave" order type constants | After Phase C |
| `src/OpenRA.Game/Traits/TraitsInterfaces.ts` | Add `IGameSaveTraitData` interface definition | Before Phase D |
| `src/OpenRA.Mods.Common/Widgets/Logic/ReplayBrowserLogic.ts` | Replace `ReplayMetadataStub` with real `ReplayMetadata` | After Phase A |
| `src/OpenRA.Mods.Common/Widgets/Logic/GameSaveBrowserLogic.ts` | Replace `GameSaveStub`/`SlotClientStub` with real types | After Phase C |
| `utils/sync-hash-generator.ts` | Extend to emit sync dump functions alongside hash functions | Before Phase D (SyncReport) |

### 6.4 Deferral Candidates

Some components can be deferred to a later phase without blocking core functionality:

| Component | Reason | Deferral Impact |
|:---|:---|:---|
| `SyncReport.ts` | Debug tool only; not needed for gameplay | No replay/save diagnostics until implemented |
| `GameSaveViewportManager.ts` | Quality-of-life; camera defaults to world center on load without it | Minor UX regression on save load |
| `AutoSave.ts` | Requires stable storage layer first | Manual save/load still works |
| Bot order remapping in `GameSave` | Only needed for multiplayer saves with AI bots | Single-player/local saves work correctly |

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-17.1: Binary Format Parity with OpenRA Desktop

**Decision**: Replay `.orarep` and save `.orasav` binary formats will be preserved exactly — little-endian int32 framing, length-prefixed UTF-8 strings, identical marker sentinel values (`MetaStartMarker = -1`, `MetaEndMarker = -2`, `TraitDataMarker = -3`, `EOFMarker = -2`). TypeScript uses `DataView`/`Uint8Array` for all binary I/O with `littleEndian=true` on all multi-byte operations. The MiniYAML payloads within the binary format evolve to JSON (a backward-compatible change since the framing is unchanged).

**Rationale**: Enables cross-compatibility — replay files from OpenRA desktop can be played in the web version and vice versa. This is critical for community replay sharing and save-file portability. The binary formats are well-defined, relatively simple, and `DataView` provides everything needed for byte-level manipulation.

**Alternatives Considered**:
- **JSON-based format**: Simpler to implement, but breaks all cross-compatibility. Rejected.
- **MessagePack-based format**: More efficient than JSON, still breaks compatibility. Rejected.

**Consequences**:
- All multi-byte read/write operations must explicitly pass `true` for littleEndian
- Binary format validation tests must compare against known-good files from OpenRA desktop
- The JSON-instead-of-MiniYaml evolution is transparent to the binary framing layer

### ADR-17.2: Abstract Storage Provider for File I/O

**Decision**: All filesystem operations (read, write, delete, enumerate) go through an `IStorageProvider` interface. The default implementation uses **IndexedDB** for persistent storage with a virtual path hierarchy (object stores with composite keys). Alternative implementations: File System Access API / OPFS for directory browsing, in-memory for unit testing, `Blob` download/upload for file exchange.

```typescript
interface IStorageProvider {
  write(path: string, data: ArrayBuffer): Promise<void>;
  read(path: string): Promise<ArrayBuffer>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<StorageEntry[]>;
  exists(path: string): Promise<boolean>;
}
```

**Rationale**: Browsers have no traditional filesystem. IndexedDB provides async persistent storage with quota management. The abstraction layer allows swapping storage backends without changing game logic, and enables clean unit testing with in-memory mocks.

**Alternatives Considered**:
- **IndexedDB-only**: Insufficient for user-facing file management (no download/export).
- **File System Access API only**: Not supported in Safari or Firefox.
- **Two-tier with abstraction**: **Selected** — maximum flexibility.

**Consequences**:
- Storage provider is injected at construction time for all Ch17 classes
- IndexedDB schema: database `OpenRAWeb3D_Storage`, object stores `replays/` and `saves/` with path as key
- File creation timestamps stored as metadata alongside binary data
- In-memory mock provider used for all unit tests

### ADR-17.3: LocalGameCoordinator for Single-Player Save/Load

**Decision**: In single-player browser context, a `LocalGameCoordinator` class acts as a virtual server for save/load operations. It hosts a `GameSave` instance, handles `"CreateGameSave"` / `"LoadGameSave"` orders, and manages the save/load lifecycle without network overhead. In multiplayer (future Ch18), a WebSocket-connected server runs the same `GameSave` logic server-side. The `GameSave` class itself is environment-agnostic (operates purely on `ArrayBuffer`).

**Rationale**: `GameSave.DispatchOrders()` and `GameSave.ParseOrders()` are server-side in OpenRA. Without a server abstraction, single-player saves would require duplicating this logic. The `LocalGameCoordinator` avoids duplication and preserves the architectural separation between game logic and save infrastructure.

**Consequences**:
- The existing `OrderManager.gameSaveLastFrame`/`gameSaveLastSyncFrame` placeholders (already in `OrderManager.ts`) are wired into the coordinator
- `World.isLoadingGameSave` flag is set during fast-forward of saved frames
- The coordinator pattern cleanly extends to multiplayer when Ch18 Server is implemented

### ADR-17.4: Build-Time Code Generation for SyncReport Trait Dump

**Decision**: `SyncReport`'s trait value extraction replaces C# runtime `Expression.Lambda<T>` compilation with **build-time generated dump functions** that extend the existing `sync-hash-generator.ts` (established in Ch6 Phase B). Each `@VerifySync`-annotated class gets a generated `dumpSyncState(instance: T): Record<string, unknown>` function. These are written to `sync-hashes.generated.ts` alongside existing hash functions.

**Rationale**: TypeScript cannot dynamically compile functions at runtime (no `eval` in the design constraints). Decorators are prohibited by `erasableSyntaxOnly` tsconfig. Manual `toSyncDump()` methods on every ISync class would be error-prone and high maintenance. Build-time generation is already the established pattern for sync hashes — this just extends it.

**Alternatives Considered**:
- **Runtime `Object.keys()` with metadata registry**: Cannot distinguish `@VerifySync` from non-sync fields without decorators.
- **Manual `toSyncDump()` on each class**: Error-prone, duplicates field names, high maintenance.
- **Build-time code generation**: **Selected**. Consistent with existing architecture. Zero runtime overhead.

**Consequences**:
- Adding a new `@VerifySync` field requires a build step to regenerate. Already the case for hash functions.
- The `sync-hash-generator.ts` utility must be updated to emit dump functions (estimated +50 lines).
- `SyncReport` at runtime simply calls `dumpSyncState(instance)` and serializes the result.

### ADR-17.5: JSON Trait Data in GameSave (MiniYAML Evolution)

**Decision**: `GameSave` stores trait data as JSON strings within the `.orasav` binary format (using the same length-prefixed UTF-8 framing). `IGameSaveTraitData.IssueTraitData()` returns `Record<string, any>` instead of `MiniYaml` nodes. The Ch4 Phase H MiniYAML-to-JSON pipeline handles backward compatibility for existing MiniYAML trait data.

**Rationale**: TypeScript has native JSON support (`JSON.parse`/`JSON.stringify`). MiniYAML parsing adds unnecessary complexity and dependency. Since all YAML is preprocessed to JSON at build time (Ch4 Phase H), there is no reason for runtime trait data to use MiniYAML.

**Consequences**:
- Binary framing (length-prefixed UTF-8 strings) is identical — format remains backward-compatible
- If OpenRA desktop `.orasav` files contain MiniYAML trait data, a conversion shim is needed for cross-loading
- For OpenRAWeb3D-generated saves, trait data is always JSON

### ADR-17.6: ReplayConnection Implements Existing IConnection Interface

**Decision**: `ReplayConnection` implements the existing `IConnection` interface from Chapter 6 Phase A. `send()` and `sendImmediate()` are no-ops; `receive()` feeds pre-recorded orders to `OrderManager` frame-by-frame, respecting `orderLatency` for proper timing. `localClientId` returns -1 (observer/spectator).

**Rationale**: This is exactly how OpenRA's replay playback works — the `ReplayConnection` replaces the network connection transparently. `OrderManager` does not know or care whether orders come from a network socket or a replay file. This clean separation is one of OpenRA's best architectural decisions and should be preserved.

**Consequences**:
- Replay playback works with zero changes to `OrderManager` or game logic
- Game code checks `world.isReplay` which internally checks `orderManager.connection instanceof ReplayConnection`
- Replay speed is controlled via `World.ReplayTimestep` (already migrated from Ch3)

---

## Migration Order and Phasing Strategy

| Batch | Phase | Files | Est. Time | Parallelizable |
|:---:|:---|:---:|:---:|:---:|
| 1 | A | 2 (GameInformation + ReplayMetadata) | 1 session | Sequential (ReplayMetadata after GameInformation) |
| 2 | B + C | 3 (ReplayRecorder + ReplayConnection + GameSave) | 2 sessions | YES — Phase B files in parallel with Phase C |
| 3 | D | 3 (SyncReport + AutoSave + GameSaveViewportManager) | 1 session | YES — all three are independent |

**Total estimated**: ~4 development sessions for implementation + ~2 sessions for review rounds. Due to small file count and mostly data-structure/logic migration (no rendering), this chapter can complete faster than previous gameplay chapters.

---

> **Again**: `OpenRA/` directory is the original reference source code, **DO NOT MODIFY**. All migration work is completed in the corresponding `src/` paths.

> **Reference Documents**:
> - `docs/openra_migration.agent.final.converted.md` — Architecture analysis
> - `docs/remaining_systems_migration_plan.md` Section 3.10 — Original Ch17 file listing
> - `docs/chapter8_weapons_combat_migration_plan.md` — Plan format reference
> - `docs/migration_progress.md` — Progress tracking
> - `CLAUDE.md` — Project conventions
