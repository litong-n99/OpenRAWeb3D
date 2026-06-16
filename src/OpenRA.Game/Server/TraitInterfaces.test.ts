/**
 * TraitInterfaces.test.ts — Server trait interfaces and DebugServerTrait unit tests
 *
 * Tests cover: interface definitions, ServerTrait base class, DebugServerTrait
 * lifecycle logging, interpretCommand behavior, and interface structural
 * conformance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ServerTrait,
  DebugServerTrait,
  type IInterpretCommand,
  type INotifySyncLobbyInfo,
  type INotifyServerStart,
  type INotifyServerShutdown,
  type IStartGame,
  type IEndGame,
} from './TraitInterfaces';

// NOTE: INotifyServerEmpty, IClientJoined, ITick are tested via `in` operator
// checks (they aren't imported because DebugServerTrait doesn't implement them)

// ---------------------------------------------------------------------------
// Type stubs for forward-referenced Server/Connection/SessionClient
// ---------------------------------------------------------------------------

/** Minimal stub for Server type (to be replaced by real Server in Phase B). */
interface StubServer {
  state: number;
}

/** Minimal stub for Connection type (to be replaced by real Connection in Phase C). */
interface StubConnection {
  PlayerIndex: number;
}

/** Minimal stub for SessionClient type (to be replaced by real SessionClient in Phase B). */
interface StubSessionClient {
  index: number;
  name: string;
}

// ---------------------------------------------------------------------------
// ServerTrait base class
// ---------------------------------------------------------------------------

describe('ServerTrait', () => {
  it('is an abstract class that can be extended', () => {
    class TestTrait extends ServerTrait {}
    const instance = new TestTrait();
    expect(instance).toBeInstanceOf(ServerTrait);
  });

  it('DebugServerTrait extends ServerTrait', () => {
    const dt = new DebugServerTrait();
    expect(dt).toBeInstanceOf(ServerTrait);
  });
});

// ---------------------------------------------------------------------------
// DebugServerTrait — structural interface conformance
// ---------------------------------------------------------------------------

describe('DebugServerTrait interface conformance', () => {
  it('can be used as IInterpretCommand', () => {
    const dt: IInterpretCommand = new DebugServerTrait();
    expect(typeof dt.interpretCommand).toBe('function');
  });

  it('can be used as INotifySyncLobbyInfo', () => {
    const dt: INotifySyncLobbyInfo = new DebugServerTrait();
    expect(typeof dt.lobbyInfoSynced).toBe('function');
  });

  it('can be used as INotifyServerStart', () => {
    const dt: INotifyServerStart = new DebugServerTrait();
    expect(typeof dt.serverStarted).toBe('function');
  });

  it('can be used as INotifyServerShutdown', () => {
    const dt: INotifyServerShutdown = new DebugServerTrait();
    expect(typeof dt.serverShutdown).toBe('function');
  });

  it('can be used as IStartGame', () => {
    const dt: IStartGame = new DebugServerTrait();
    expect(typeof dt.gameStarted).toBe('function');
  });

  it('can be used as IEndGame', () => {
    const dt: IEndGame = new DebugServerTrait();
    expect(typeof dt.gameEnded).toBe('function');
  });

  it('does NOT implement INotifyServerEmpty', () => {
    // DebugServerTrait does not implement INotifyServerEmpty
    const dt = new DebugServerTrait();
    expect('serverEmpty' in dt).toBe(false);
  });

  it('does NOT implement IClientJoined', () => {
    const dt = new DebugServerTrait();
    expect('clientJoined' in dt).toBe(false);
  });

  it('does NOT implement ITick', () => {
    const dt = new DebugServerTrait();
    expect('tick' in dt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DebugServerTrait — interpretCommand()
// ---------------------------------------------------------------------------

describe('DebugServerTrait.interpretCommand', () => {
  let dt: DebugServerTrait;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const stubServer: StubServer = { state: 0 };
  const stubConn: StubConnection = { PlayerIndex: 3 };
  const stubClient: StubSessionClient = { index: 3, name: 'TestPlayer' };

  beforeEach(() => {
    dt = new DebugServerTrait();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('always returns false', () => {
    const result = dt.interpretCommand(
      stubServer as any,
      stubConn as any,
      stubClient as any,
      '/help',
    );
    expect(result).toBe(false);
  });

  it('returns false for any command string', () => {
    const commands = ['/help', '/start', '/kick 3', '', 'hello'];
    for (const cmd of commands) {
      expect(
        dt.interpretCommand(
          stubServer as any,
          stubConn as any,
          stubClient as any,
          cmd,
        ),
      ).toBe(false);
    }
  });

  it('logs the command with player index from Connection.PlayerIndex', () => {
    dt.interpretCommand(
      stubServer as any,
      stubConn as any,
      stubClient as any,
      '/help',
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Server received command from player 3: /help',
    );
  });

  it('defaults player index to -1 when PlayerIndex is absent', () => {
    const connWithoutIndex = { NoPlayerIndex: 99 };
    dt.interpretCommand(
      stubServer as any,
      connWithoutIndex as any,
      stubClient as any,
      'test',
    );
    expect(logSpy).toHaveBeenCalledWith(
      'Server received command from player -1: test',
    );
  });
});

// ---------------------------------------------------------------------------
// DebugServerTrait — lifecycle method logging
// ---------------------------------------------------------------------------

describe('DebugServerTrait lifecycle methods', () => {
  let dt: DebugServerTrait;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const stubServer: StubServer = { state: 0 };

  beforeEach(() => {
    dt = new DebugServerTrait();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('gameStarted() logs "GameStarted()"', () => {
    dt.gameStarted(stubServer as any);
    expect(logSpy).toHaveBeenCalledWith('GameStarted()');
  });

  it('lobbyInfoSynced() logs "LobbyInfoSynced()"', () => {
    dt.lobbyInfoSynced(stubServer as any);
    expect(logSpy).toHaveBeenCalledWith('LobbyInfoSynced()');
  });

  it('serverStarted() logs "ServerStarted()"', () => {
    dt.serverStarted(stubServer as any);
    expect(logSpy).toHaveBeenCalledWith('ServerStarted()');
  });

  it('serverShutdown() logs "ServerShutdown()"', () => {
    dt.serverShutdown(stubServer as any);
    expect(logSpy).toHaveBeenCalledWith('ServerShutdown()');
  });

  it('gameEnded() logs "GameEnded()"', () => {
    dt.gameEnded(stubServer as any);
    expect(logSpy).toHaveBeenCalledWith('GameEnded()');
  });

  it('lifecycle methods do not throw (even with null/undefined server)', () => {
    expect(() => dt.gameStarted(null as any)).not.toThrow();
    expect(() => dt.lobbyInfoSynced(null as any)).not.toThrow();
    expect(() => dt.serverStarted(null as any)).not.toThrow();
    expect(() => dt.serverShutdown(null as any)).not.toThrow();
    expect(() => dt.gameEnded(null as any)).not.toThrow();
  });

  it('all logged methods log exactly once per call', () => {
    logSpy.mockClear();

    const server = stubServer as any;
    dt.gameStarted(server);
    dt.lobbyInfoSynced(server);
    dt.serverStarted(server);
    dt.serverShutdown(server);
    dt.gameEnded(server);

    expect(logSpy).toHaveBeenCalledTimes(5);
  });
});
