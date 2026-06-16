# OpenRA to Babylon.js Migration Plan: Chapter 18 -- Server System

> **Source Reference**: `docs/openra_migration.agent.final.converted.md` Section 4.6 (Network/Server)
> **Chapter Status**: PLANNING (0/9 files migrated, 0%)
> **Planning Date**: 2026-06-16
> **Prerequisite**: Chapters 2-7 COMPLETE (162/162, 100%), Chapter 6 Phase A (Order + Connection) COMPLETE, Chapter 6 Phase B (Sync) COMPLETE
>
> **Important Statement**: `OpenRA/` directory is the original C# source reference library, **for reference only, DO NOT MODIFY**. All migration implementations should be done in TypeScript files under the corresponding `src/` paths.

---

## Table of Contents

1. [Overall Strategy and Architecture Principles](#1-overall-strategy-and-architecture-principles)
2. [File Mapping Table](#2-file-mapping-table)
3. [Core Migration Tasks (TODO)](#3-core-migration-tasks-todo)
   - 3.1 [Phase A: TBD](#31-phase-a-tbd)
   - 3.2 [Phase B: TBD](#32-phase-b-tbd)
   - 3.3 [Phase C: TBD](#33-phase-c-tbd)
4. [Dependency Graph](#4-dependency-graph)
5. [Verification and Test Strategy](#5-verification-and-test-strategy)
6. [Risk and Considerations](#6-risk-and-considerations)
7. [Appendix: Architecture Decisions Record (ADR)](#7-appendix-architecture-decisions-record-adr)

---

## 1. Overall Strategy and Architecture Principles

### 1.1 Core Paradigm Shift

> **To be completed by Architect**

Chapter 18 implements the dedicated server infrastructure for multiplayer game hosting. The core paradigm shifts from **C# dedicated server process with TCP/IP sockets** to a **Node.js WebSocket server** (or optionally a Web Worker in a browser host tab).

Key paradigm shifts to address:

- **TCP Socket I/O** -- C# `TcpListener` / `NetworkStream` → Node.js `ws` WebSocket library for client connections
- **Multi-threaded server** -- C# `Server` runs in its own thread → Node.js single-threaded event loop with async I/O
- **Order broadcasting** -- C# multicast through `foreach client in conns` → WebSocket broadcast via `wss.clients.forEach()`
- **Client-server validation** -- Sync hash verification and order validation logic preserved 1:1
- **Peer-hosted option** -- C# `Server` as a subprocess → Web Worker in a browser tab for peer-hosted games (no dedicated server needed)

### 1.2 Architecture Principles

> **To be completed by Architect**

1. **Protocol parity**: The OpenRA network protocol (order framing, sync hashes, handshake, disconnect detection) is preserved byte-for-byte over WebSocket.
2. **Deterministic lockstep**: Per OpenRA, the server enforces a fixed tick rate and broadcasts complete order sets each frame.
3. **Server-authoritative validation**: Sync hash mismatches detected server-side; desynced clients notified and disconnected.
4. **Dual deployment modes**: Dedicated Node.js server (for community-hosted games) AND Web Worker mode (for peer-hosted browser games).
5. **Type-reuse from Chapter 6**: Order types, Connection, OrderManager, Sync hash infrastructure all reused server-side.

### 1.3 Completed Foundation

The following infrastructure from earlier chapters is available for Chapter 18:

| System | Source Chapter | Key Types Available |
|--------|:---:|-----------|
| Order + Connection + OrderManager | Ch6 Phase A | `Order`, `IConnection`, `OrderManager`, `UnitOrders`, `Order.deserialize()` |
| Sync hash system | Ch6 Phase B | `Sync`, `TraitHash`, `ISync` interface |
| Ruleset container | Ch6 Phase C | `Ruleset`, `Session`, lobby data structures |
| World + Actor + TraitDictionary | Ch3 | `GameWorldManager`, `GameActor`, `TraitDictionary` |
| Manifest + ModData | Ch5 Phase C | `Manifest`, `ModData` |
| CoordinateTransformer | Ch4 Phase I | WPos/WDist arithmetic |

---

## 2. File Mapping Table

### 2.1 Complete File Inventory (9 files across N Phases)

| # | OpenRA Source | Target TypeScript File | Class/Interface | Lines (C#) | Complexity | Phase |
|:---:|:---|:---|:---|:---:|:---:|:---:|
| **Phase A: TBD -- to be completed by Architect** | | | | | |
| 1 | `OpenRA.Game/Server/Server.cs` | `src/OpenRA.Game/Server/Server.ts` | `Server` | 1594 | HIGHEST | A |
| 2 | `OpenRA.Game/Server/Connection.cs` | `src/OpenRA.Game/Server/Connection.ts` | `ServerConnection` | 220 | MEDIUM | A |
| 3 | `OpenRA.Game/Server/OrderBuffer.cs` | `src/OpenRA.Game/Server/OrderBuffer.ts` | `OrderBuffer` | 139 | MEDIUM | A |
| 4 | `OpenRA.Game/Server/VoteKickTracker.cs` | `src/OpenRA.Game/Server/VoteKickTracker.ts` | `VoteKickTracker` | 223 | LOW | TBD |
| 5 | `OpenRA.Game/Server/ProtocolVersion.cs` | `src/OpenRA.Game/Server/ProtocolVersion.ts` | `ProtocolVersion` | 82 | LOW | TBD |
| 6 | `OpenRA.Game/Server/TraitInterfaces.cs` | `src/OpenRA.Game/Server/TraitInterfaces.ts` | Server trait interfaces | 63 | LOW | TBD |
| 7 | `OpenRA.Game/Server/Exts.cs` | `src/OpenRA.Game/Server/Exts.ts` | `Exts` (server utilities) | 24 | LOW | TBD |
| 8 | `OpenRA.Game/Server/MapStatusCache.cs` | `src/OpenRA.Game/Server/MapStatusCache.ts` | `MapStatusCache` | 106 | LOW | TBD |
| 9 | `OpenRA.Game/Server/PlayerMessageTracker.cs` | `src/OpenRA.Game/Server/PlayerMessageTracker.ts` | `PlayerMessageTracker` | 86 | LOW | TBD |

> **Complexity Legend**:
> - **LOW**: Data structures or simple logic with few dependencies. 24-110 lines of C#. Can be parallel-assigned.
> - **MEDIUM**: Moderate logic with multiple interface implementations or protocol-level handling. 139-220 lines of C#.
> - **HIGH**: Complex logic with state machines, socket management, or cross-client coordination. 300+ lines of C#.
> - **HIGHEST**: Very complex logic -- server main loop, client management, order dispatch, sync verification, lobby handling. 1500+ lines of C#. Must be completed by one developer (not parallelizable).

### 2.2 Summary Statistics

| Metric | Count |
|--------|-------|
| **Total mapped files** | 9 |
| **HIGHEST complexity** | 1 file (Server.ts) |
| **MEDIUM complexity** | 2 files (ServerConnection, OrderBuffer) |
| **LOW complexity** | 6 files |
| **Total OpenRA C# source lines** | ~2,537 |

| Phase | Files | C# Lines | TS Lines (est.) | Tests (est.) | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| **Total** | **9** | **~2,537** | **TBD** | **TBD** | **PLANNING** |

> **To be completed by Architect**: Phase breakdown, per-phase estimates, and dependency assignments.

---

## 3. Core Migration Tasks (TODO)

### 3.1 Phase A: TBD

**Status**: 📋 待迁移 (0/N migrated)
**Complexity**: TBD
**Review**: N/A
**Blocked by**: TBD
**Blocks**: TBD

**Description**: > **To be completed by Architect**

> **The Architect will populate this section with detailed TODO items following the checklist format from Chapter 8 and Chapter 17 plans. Each file gets its own subsection with checkbox items for all implementation tasks.**

---

> **Remaining phases and their TODO sections to be added by Architect**

---

## 4. Dependency Graph

```
Chapters 2-7 (COMPLETE -- Foundation)
  │
  ├── Chapter 6 Phase A (Order + Connection + OrderManager)
  ├── Chapter 6 Phase B (Sync hash system)
  ├── Chapter 6 Phase C (Ruleset + Session)
  │
  └── Chapter 18 Phases (TBD by Architect)

Internal Dependencies (TBD by Architect):
```

### 4.1 Critical Path

> **To be completed by Architect**

### 4.2 Parallelization Opportunities

> **To be completed by Architect**

---

## 5. Verification and Test Strategy

### 5.1 Unit Testing Strategy

> **To be completed by Architect**

All Chapter 18 files involve no GPU rendering, making them ideal for unit testing. Babylon.js mocking is not required.

WebSocket mocking requires a lightweight mock `ws` server for unit tests (the `ws` library supports in-process testing).

### 5.2 Integration Testing

> **To be completed by Architect**

### 5.3 Visual Acceptance Testing

No visual acceptance tests are needed for this chapter -- all logic is non-rendering server state management.

### 5.4 Performance Acceptance Criteria

> **To be completed by Architect**

---

## 6. Risk and Considerations

### 6.1 High-Risk Items

> **To be completed by Architect**

### 6.2 Node.js-Specific Limitations

> **To be completed by Architect** -- include discussion of single-threaded event loop, WebSocket vs TCP considerations, npm package dependencies.

### 6.3 Cross-Chapter Integration Points

> **To be completed by Architect**

### 6.4 Deferral Candidates

> **To be completed by Architect**

---

## 7. Appendix: Architecture Decisions Record (ADR)

### ADR-18.1: Node.js Game Server with `ws` WebSocket Library

**Decision**: The OpenRAWeb3D dedicated server runs in Node.js using the `ws` WebSocket library for client-server communication. Order broadcasting and sync hash verification logic are ported 1:1 from C#.

**Rationale**: Node.js is the natural server runtime for a TypeScript codebase -- maximum code reuse between client and server. The `ws` library is the most mature WebSocket implementation for Node.js, providing per-frame binary message passing compatible with the OpenRA lockstep protocol. WebSocket is the only bidirectional binary protocol universally available in browsers (TCP/UDP sockets are not accessible from browser JS).

**Alternatives Considered** (to be completed by Architect):
- **WebRTC DataChannel**: P2P-capable but complex signaling; not suitable for dedicated server model.
- **Server-Sent Events + HTTP POST**: Half-duplex only; cannot match lockstep tick rate requirements.

**Consequences** (to be completed by Architect).

### ADR-18.2: Web Worker Hosted Server for Peer-Hosted Games

**Decision**: The server can optionally run as a Web Worker in a "host" browser tab for peer-hosted games. This eliminates the need for a dedicated server in casual play scenarios. The Web Worker runs the same `Server` class, communicating with client tabs via `postMessage()` and relaying to remote clients via the same `ws` client connection pattern.

**Rationale**: Not all players will have access to a dedicated Node.js server. A Web Worker-based host enables "host-and-play" without infrastructure. The `Server.ts` class is environment-agnostic (operates purely on abstract connections), so the same code runs in both Node.js and Web Worker contexts.

**Alternatives Considered** (to be completed by Architect).

**Consequences** (to be completed by Architect).

> **Additional ADRs to be added by Architect as needed.**

---

## Migration Order and Phasing Strategy

> **To be completed by Architect** -- week-by-week breakdown or phase ordering strategy.

---
