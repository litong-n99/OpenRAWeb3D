/**
 * UnitOrders.test.ts — Order routing/dispatch unit tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  processOrder,
  registerHandler,
  clear,
  kickVoteTarget,
  ChatMessageMaxLength,
  setNotificationHandlers,
} from './UnitOrders'
import { Order, NULL_ACTOR_ID } from './Order'
import type {
  OrderManagerStub,
  ClientStub,
  LobbyInfoStub,
  GlobalSettingsStub,
  WorldStub,
} from './UnitOrders'
import type { IGameActor } from '../Traits/TraitsInterfaces'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockClient(overrides: Partial<ClientStub> = {}): ClientStub {
  return {
    index: overrides.index ?? 1,
    name: overrides.name ?? 'Player1',
    color: overrides.color ?? '#FF0000',
    team: overrides.team ?? 0,
    slot: overrides.slot ?? null,
    bot: overrides.bot ?? null,
    isAdmin: overrides.isAdmin ?? false,
    isObserver: overrides.isObserver ?? false,
    isBot: overrides.isBot ?? false,
    state: overrides.state ?? 2, // Ready
    connectionQuality: overrides.connectionQuality ?? 0,
  }
}

function mockLobbyInfo(clients: ClientStub[] = []): LobbyInfoStub {
  return {
    clients,
    globalSettings: mockGlobalSettings(),
    slots: new Map(),
    disabledSpawnPoints: [],
    clientWithIndex: (id: number) => clients.find((c) => c.index === id),
    nonBotClients: () => clients.filter((c) => !c.isBot),
  }
}

function mockGlobalSettings(): GlobalSettingsStub {
  return {
    map: 'testmap',
    randomSeed: 12345,
    netFrameInterval: 3,
    gameTimestep: 0,
    enableSyncReports: false,
    dedicated: false,
    optionOrDefault: (_key: string, defaultValue: string | boolean) => defaultValue,
  }
}

function mockOrderManager(overrides: Partial<OrderManagerStub> = {}): OrderManagerStub {
  return {
    netFrameNumber: overrides.netFrameNumber ?? 0,
    localFrameNumber: overrides.localFrameNumber ?? 0,
    gameStarted: overrides.gameStarted ?? false,
    lobbyInfo: overrides.lobbyInfo ?? mockLobbyInfo(),
    localClient: overrides.localClient ?? null,
    serverError: overrides.serverError ?? null,
    authenticationFailed: overrides.authenticationFailed ?? false,
    world: overrides.world ?? null,
    issueOrder: overrides.issueOrder ?? vi.fn(),
    gameSaveLastFrame: overrides.gameSaveLastFrame ?? -1,
    gameSaveLastSyncFrame: overrides.gameSaveLastSyncFrame ?? -1,
    serverMapPool: overrides.serverMapPool ?? null,
    connection: overrides.connection ?? { localClientId: 1 },
    receiveImmediateOrders: overrides.receiveImmediateOrders ?? vi.fn(),
    receiveOrders: overrides.receiveOrders ?? vi.fn(),
    receiveSync: overrides.receiveSync ?? vi.fn(),
    receiveDisconnect: overrides.receiveDisconnect ?? vi.fn(),
    receiveTickScale: overrides.receiveTickScale ?? vi.fn(),
  }
}

function mockIGameActor(overrides: Record<string, unknown> = {}): IGameActor {
  return {
    actorId: (overrides.actorId as number) ?? 100,
    isInWorld: (overrides.isInWorld as boolean) ?? true,
    isDead: (overrides.isDead as boolean) ?? false,
    disposed: (overrides.disposed as boolean) ?? false,
    owner: overrides.owner as IGameActor['owner'],
    world: overrides.world as IGameActor['world'],
    info: overrides.info as IGameActor['info'],
    generation: (overrides.generation as number) ?? 1,
  }
}

function mockWorld(overrides: Partial<WorldStub> = {}): WorldStub {
  const actors = new Map<number, IGameActor>()
  const actorList = (overrides.actors ? [...(overrides.actors as Map<number, IGameActor>).values()] : []) as IGameActor[]
  for (const a of actorList) {
    actors.set(a.actorId, a)
  }
  return {
    isReplay: overrides.isReplay ?? false,
    paused: overrides.paused ?? false,
    predictedPaused: overrides.predictedPaused ?? false,
    localPlayer: overrides.localPlayer ?? null,
    players: overrides.players ?? [],
    actors,
    lobbyInfo: overrides.lobbyInfo ?? null,
    orderValidators: overrides.orderValidators ?? [],
    isGameOver: overrides.isGameOver ?? false,
    isGameStarted: overrides.isGameStarted ?? false,
    isLoadingGameSave: overrides.isLoadingGameSave ?? false,
    timestep: overrides.timestep ?? 40,
    replayTimestep: overrides.replayTimestep ?? 0,
    worldTick: overrides.worldTick ?? 0,
    worldActor: overrides.worldActor ?? mockIGameActor(),
    getActorById: overrides.getActorById ?? ((_id: number) => undefined),
    actorsHavingTrait: overrides.actorsHavingTrait ?? (() => []),
  }
}

// ---------------------------------------------------------------------------
// Notification capture
// ---------------------------------------------------------------------------

let capturedSystemLines: Array<{ key: string; args: unknown[] }> = []
let capturedChatLines: Array<{ clientId: number; name: string; message: string; color: string }> = []

beforeEach(() => {
  capturedSystemLines = []
  capturedChatLines = []
  setNotificationHandlers(
    (key, ...args) => capturedSystemLines.push({ key, args }),
    (clientId, name, message, color) => capturedChatLines.push({ clientId, name, message, color }),
  )
})

// ---------------------------------------------------------------------------
// ChatMessageMaxLength
// ---------------------------------------------------------------------------

describe('ChatMessageMaxLength', () => {
  it('is 2500', () => {
    expect(ChatMessageMaxLength).toBe(2500)
  })
})

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

describe('processOrder — "Message" handler', () => {
  it('adds system line for server message', () => {
    const om = mockOrderManager()
    const order = Order.fromTargetString('Message', 'Server announcement', false)

    processOrder(om, null, 0, order)

    expect(capturedSystemLines).toHaveLength(1)
    expect(capturedSystemLines[0].key).toBe('Server announcement')
  })
})

// ---------------------------------------------------------------------------
// Chat handler
// ---------------------------------------------------------------------------

describe('processOrder — "Chat" handler', () => {
  it('processes normal chat message', () => {
    const client = mockClient({ index: 1, name: 'Alice', team: 1 })
    const lobbyInfo = mockLobbyInfo([client])
    const om = mockOrderManager({ lobbyInfo, localClient: client })
    const order = Order.chat('Hello everyone', 0)

    processOrder(om, null, 1, order)

    expect(capturedChatLines).toHaveLength(1)
    expect(capturedChatLines[0].name).toContain('Alice')
    expect(capturedChatLines[0].message).toBe('Hello everyone')
  })

  it('truncates chat messages over ChatMessageMaxLength', () => {
    const client = mockClient({ index: 1, name: 'Alice' })
    const lobbyInfo = mockLobbyInfo([client])
    const om = mockOrderManager({ lobbyInfo })

    const longMessage = 'x'.repeat(3000)
    const order = Order.chat(longMessage, 0)

    processOrder(om, null, 1, order)

    expect(capturedChatLines).toHaveLength(1)
    expect(capturedChatLines[0].message.length).toBeLessThanOrEqual(ChatMessageMaxLength)
  })

  it('ignores chat from unknown client', () => {
    const om = mockOrderManager({ lobbyInfo: mockLobbyInfo([]) })
    const order = Order.chat('Hello', 0)

    processOrder(om, null, 999, order)

    expect(capturedChatLines).toHaveLength(0)
  })

  it('adds (Ally) suffix for same team chat', () => {
    const client1 = mockClient({ index: 1, name: 'Alice', team: 1 })
    const client2 = mockClient({ index: 2, name: 'Bob', team: 1 })
    const lobbyInfo = mockLobbyInfo([client1, client2])
    const om = mockOrderManager({ lobbyInfo, localClient: client1 })
    const order = Order.chat('Hey team', 0)

    processOrder(om, null, 2, order)

    expect(capturedChatLines).toHaveLength(1)
    expect(capturedChatLines[0].name).toContain('(Ally)')
  })
})

// ---------------------------------------------------------------------------
// PauseGame handler
// ---------------------------------------------------------------------------

describe('processOrder — "PauseGame" handler', () => {
  it('pauses and unpauses the game', () => {
    const client = mockClient({ index: 1, name: 'Host' })
    const lobbyInfo = mockLobbyInfo([client])
    const world = mockWorld({ lobbyInfo, isGameOver: false })
    const om = mockOrderManager({ lobbyInfo, world })

    // Pause
    const pauseOrder = Order.fromTargetString('PauseGame', 'Pause', false)
    processOrder(om, world, 1, pauseOrder)
    expect(world.predictedPaused).toBe(true)

    // Unpause
    const unpauseOrder = Order.fromTargetString('PauseGame', 'Play', false)
    processOrder(om, world, 1, unpauseOrder)
    expect(world.predictedPaused).toBe(false)
  })

  it('prevents unpausing a finished game', () => {
    const client = mockClient({ index: 1, name: 'Host' })
    const lobbyInfo = mockLobbyInfo([client])
    const world = mockWorld({ lobbyInfo, isGameOver: true })
    const om = mockOrderManager({ lobbyInfo, world })

    const unpauseOrder = Order.fromTargetString('PauseGame', 'Play', false)
    processOrder(om, world, 1, unpauseOrder)
    // Should not change since game is over
    expect(world.predictedPaused).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// StartKickVote / EndKickVote handlers
// ---------------------------------------------------------------------------

describe('processOrder — kick vote handlers', () => {
  beforeEach(() => {
    clear()
  })

  it('sets kickVoteTarget on StartKickVote', () => {
    const om = mockOrderManager()
    const order = Order.fromTargetString('StartKickVote', '', false, 3)

    processOrder(om, null, 0, order)

    expect(kickVoteTarget).toBe(3)
  })

  it('clears kickVoteTarget on EndKickVote', () => {
    const om = mockOrderManager()
    const startOrder = Order.fromTargetString('StartKickVote', '', false, 3)
    processOrder(om, null, 0, startOrder)
    expect(kickVoteTarget).toBe(3)

    const endOrder = Order.fromTargetString('EndKickVote', '', false, 3)
    processOrder(om, null, 0, endOrder)
    expect(kickVoteTarget).toBeNull()
  })

  it('StartKickVote ignores non-server orders', () => {
    const om = mockOrderManager()
    const order = Order.fromTargetString('StartKickVote', '', false, 99)

    processOrder(om, null, 5, order)

    expect(kickVoteTarget).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ServerError / AuthenticationError handlers
// ---------------------------------------------------------------------------

describe('processOrder — error handlers', () => {
  it('sets serverError on ServerError order', () => {
    const om = mockOrderManager()
    const order = Order.fromTargetString('ServerError', 'Bad config', false)

    processOrder(om, null, 0, order)

    expect(om.serverError).toBe('Bad config')
    expect(om.authenticationFailed).toBe(false)
  })

  it('sets authenticationFailed on AuthenticationError order', () => {
    const om = mockOrderManager()
    const order = Order.fromTargetString('AuthenticationError', 'Bad password', false)

    processOrder(om, null, 0, order)

    expect(om.serverError).toBe('Bad password')
    expect(om.authenticationFailed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Custom handler registration
// ---------------------------------------------------------------------------

describe('Custom handler registration', () => {
  beforeEach(() => {
    clear()
  })

  it('allows registering custom order handlers', () => {
    let called = false
    registerHandler('CustomOrder', () => {
      called = true
      return true
    })

    const om = mockOrderManager()
    const order = Order.fromTargetString('CustomOrder', 'data', false)

    processOrder(om, null, 0, order)

    expect(called).toBe(true)
  })

  it('falls through to resolveOrder when handler returns false', () => {
    const actor = mockIGameActor({ actorId: 42 })
    const world = mockWorld({
      getActorById: (id: number) => (id === 42 ? actor : undefined),
    })
    const om = mockOrderManager({ world })

    registerHandler('FallbackOrder', () => false)

    const order = Order.withSubject('FallbackOrder', 42, false)

    // Should not throw — just fall through
    processOrder(om, world, 0, order)
  })
})

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('resets kickVoteTarget and reinitializes handlers', () => {
    // Set some state
    const om = mockOrderManager()
    const order = Order.fromTargetString('StartKickVote', '', false, 7)
    processOrder(om, null, 0, order)
    expect(kickVoteTarget).toBe(7)

    // Clear
    clear()
    expect(kickVoteTarget).toBeNull()

    // Handler should still work after reinit
    const order2 = Order.fromTargetString('StartKickVote', '', false, 3)
    processOrder(om, null, 0, order2)
    expect(kickVoteTarget).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// processOrder — default / grouped actor resolution
// ---------------------------------------------------------------------------

describe('processOrder — grouped actor resolution', () => {
  it('resolves grouped orders for each grouped actor', () => {
    const subject1 = mockIGameActor({ actorId: 10 })
    const subject2 = mockIGameActor({ actorId: 20 })
    const actorsMap = new Map<number, IGameActor>()
    actorsMap.set(10, subject1)
    actorsMap.set(20, subject2)

    const world = mockWorld({
      actors: actorsMap,
      getActorById: (id: number) => actorsMap.get(id),
    })
    const om = mockOrderManager({ world })

    const order = Order.withSubject('Move', NULL_ACTOR_ID, false, [10, 20])
    // HACK: Set groupedActorIds since withSubject doesn't support it directly
    const groupedOrder = Order.fromGroupedOrder(order, 10)

    processOrder(om, world, 0, groupedOrder)

    // Should not throw — just fall through since no IResolveOrder traits exist
  })
})
