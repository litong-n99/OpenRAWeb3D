/**
 * TraitInterfaces.ts — Server trait interfaces and base classes for server
 * lifecycle hooks and command interpretation.
 *
 * OpenRA 对照: OpenRA.Game/Server/TraitInterfaces.cs (63 lines C#)
 *
 * 核心范式转换:
 * - C# interface methods with pascal-case naming → TypeScript interface methods
 *   with camelCase naming (matching project convention for method names)
 * - C# `abstract class ServerTrait { }` → TypeScript `abstract class ServerTrait`
 * - C# concrete `DebugServerTrait` with `Console.WriteLine()` → TypeScript
 *   `DebugServerTrait` with `console.log()`
 * - C# `Server` / `Connection` / `Session.Client` parameter types → TypeScript
 *   local placeholder interfaces (forward references — these will be replaced
 *   by `import type` from the real modules once Phase B/C creates them)
 */

// NOTE: Server, Connection, and SessionClient types do not yet exist (Phase B/C).
// We define minimal placeholder interfaces here so tsc can verify method
// signatures. These will be REMOVED and replaced with `import type` from the
// corresponding real modules once Phases B and C are implemented.
//
// The placeholder interfaces are intentionally empty/minimal — the trait
// interfaces only pass these objects around as opaque references. The only
// property access is `conn.PlayerIndex` in DebugServerTrait, which is
// handled via `(conn as any).PlayerIndex` until Connection.ts exists.

/**
 * Placeholder for Server type (will be replaced by import from Server.ts in Phase B).
 * @remarks : Replace with `import type { Server } from './Server.js'`
 */
export interface Server {
  // Minimal shape — server is passed as opaque reference by trait interfaces.
}

/**
 * Placeholder for Connection type (will be replaced by import from Connection.ts in Phase C).
 * @remarks : Replace with `import type { Connection } from './Connection.js'`
 */
export interface Connection {
  // Minimal shape — connection is passed as opaque reference by trait interfaces.
  // PlayerIndex is accessed via `(conn as any).PlayerIndex` in DebugServerTrait
  // until the real Connection type is available.
}

/**
 * Placeholder for SessionClient type (will be replaced by import from SessionTypes.ts in Phase B).
 * @remarks : Replace with `import type { SessionClient } from './SessionTypes.js'`
 */
export interface SessionClient {
  // Minimal shape — client is passed as opaque reference by trait interfaces.
}

// ---------------------------------------------------------------------------
// Server Trait Interfaces
// ---------------------------------------------------------------------------

/**
 * Interpret a chat/console command from a client.
 *
 * OpenRA 对照: IInterpretCommand
 *
 * @param server — the server instance
 * @param conn — the client's connection
 * @param client — the session client record
 * @param cmd — the command string
 * @returns `true` if the command was handled, `false` otherwise
 */
export interface IInterpretCommand {
  interpretCommand(
    server: Server,
    conn: Connection,
    client: SessionClient,
    cmd: string,
  ): boolean;
}

/**
 * Notified when lobby info has been synced to all clients.
 *
 * OpenRA 对照: INotifySyncLobbyInfo
 */
export interface INotifySyncLobbyInfo {
  lobbyInfoSynced(server: Server): void;
}

/**
 * Notified when the server starts listening for connections.
 *
 * OpenRA 对照: INotifyServerStart
 */
export interface INotifyServerStart {
  serverStarted(server: Server): void;
}

/**
 * Notified when the server has no remaining connected clients.
 *
 * OpenRA 对照: INotifyServerEmpty
 */
export interface INotifyServerEmpty {
  serverEmpty(server: Server): void;
}

/**
 * Notified when the server is shutting down.
 *
 * OpenRA 对照: INotifyServerShutdown
 */
export interface INotifyServerShutdown {
  serverShutdown(server: Server): void;
}

/**
 * Notified when the game starts.
 *
 * OpenRA 对照: IStartGame
 */
export interface IStartGame {
  gameStarted(server: Server): void;
}

/**
 * Notified when a client joins the server.
 *
 * OpenRA 对照: IClientJoined
 */
export interface IClientJoined {
  clientJoined(server: Server, conn: Connection): void;
}

/**
 * Notified when the game ends.
 *
 * OpenRA 对照: IEndGame
 */
export interface IEndGame {
  gameEnded(server: Server): void;
}

/**
 * Ticked every server update cycle.
 *
 * OpenRA 对照: ITick
 */
export interface ITick {
  tick(server: Server): void;
}

// ---------------------------------------------------------------------------
// ServerTrait — abstract base class
// ---------------------------------------------------------------------------

/**
 * Abstract base class for server traits.
 *
 * All server trait implementations must extend this class. It serves as a
 * type grouping mechanism — analogous to `TraitInfo<T>` vs `ITraitInfo` in
 * the actor system, but much simpler: it exists so that the server trait
 * dictionary can store and retrieve traits by type.
 *
 * OpenRA 对照: `abstract class ServerTrait { }`
 */
export abstract class ServerTrait {
  // Base class intentionally empty — traits implement interface methods directly.
}

// ---------------------------------------------------------------------------
// DebugServerTrait — debug/logging server trait
// ---------------------------------------------------------------------------

/**
 * Debug implementation that logs all server lifecycle events to the console.
 *
 * This is the server-side equivalent of the actor system's `DebugTrait`.
 * It implements most server trait interfaces and logs each method call,
 * making it useful for verifying the server lifecycle during development.
 *
 * OpenRA 对照: `DebugServerTrait`, including `Console.WriteLine()` calls
 *
 * NOTE: `conn.PlayerIndex` is referenced in the C# original but
 * `Connection.ts` does not exist yet. We type-cast to `any` as a temporary
 * workaround that will be removed when Connection.ts is created in Phase C.
 */
export class DebugServerTrait
  extends ServerTrait
  implements
    IInterpretCommand,
    IStartGame,
    INotifySyncLobbyInfo,
    INotifyServerStart,
    INotifyServerShutdown,
    IEndGame
{
  /**
   * Logs the received command. Never handles it (always returns false).
   *
   * OpenRA 对照: DebugServerTrait.InterpretCommand()
   */
  interpretCommand(
    _server: Server,
    conn: Connection,
    _client: SessionClient,
    cmd: string,
  ): boolean {
    const playerIndex = (conn as any).PlayerIndex ?? -1;
    console.log(
      `Server received command from player ${playerIndex}: ${cmd}`,
    );
    return false;
  }

  /**
   * Logs "GameStarted()" to console.
   *
   * OpenRA 对照: DebugServerTrait.GameStarted()
   */
  gameStarted(_server: Server): void {
    console.log('GameStarted()');
  }

  /**
   * Logs "LobbyInfoSynced()" to console.
   *
   * OpenRA 对照: DebugServerTrait.LobbyInfoSynced()
   */
  lobbyInfoSynced(_server: Server): void {
    console.log('LobbyInfoSynced()');
  }

  /**
   * Logs "ServerStarted()" to console.
   *
   * OpenRA 对照: DebugServerTrait.ServerStarted()
   */
  serverStarted(_server: Server): void {
    console.log('ServerStarted()');
  }

  /**
   * Logs "ServerShutdown()" to console.
   *
   * OpenRA 对照: DebugServerTrait.ServerShutdown()
   */
  serverShutdown(_server: Server): void {
    console.log('ServerShutdown()');
  }

  /**
   * Logs "GameEnded()" to console.
   *
   * OpenRA 对照: DebugServerTrait.GameEnded()
   */
  gameEnded(_server: Server): void {
    console.log('GameEnded()');
  }
}
