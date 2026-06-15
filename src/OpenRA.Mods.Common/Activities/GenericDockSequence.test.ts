/**
 * GenericDockSequence.test.ts — GenericDockSequence 迁移单元测试
 *
 * 测试重点: 状态机 (6 个状态)、取消、主机死亡、拖拽、通知、虚拟方法。
 */

import { describe, it, expect, vi } from 'vitest'
import { GenericDockSequence, DockingState } from './GenericDockSequence.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { IDockHost } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { WVec } from '../../OpenRA.Game/WVec.js'
import type {
  INotifyDockClient,
  INotifyDockHost,
  IDockClientBody,
  WithDockingOverlay,
} from './EconomicActivityInterfaces.js'
import type { DockClientManagerLike } from './MoveToDock.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockActor(overrides: Record<string, unknown> = {}): GameActor {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traits: new Map(),
    centerPosition: new WPos(100, 100, 0),
    ...overrides,
  } as unknown as GameActor
}

function createMockHostActor(overrides: Record<string, unknown> = {}): GameActor {
  return {
    actorId: 2,
    isInWorld: true,
    isDead: false,
    disposed: false,
    traits: new Map(),
    centerPosition: new WPos(200, 200, 0),
    ...overrides,
  } as unknown as GameActor
}

function createMockDockHost(): IDockHost {
  return {
    getDockType: 1,
    isEnabledAndInWorld: true,
    reservationCount: 0,
    canBeReserved: true,
    dockPosition: new WPos(200, 200, 0),
    isDockingPossible: vi.fn(() => true),
    reserve: vi.fn(() => true),
    unreserveAll: vi.fn(),
  } as unknown as IDockHost
}

function createMockDockClient(overrides: Record<string, unknown> = {}): DockClientManagerLike {
  return {
    isTraitDisabled: false,
    info: { searchForDockDelay: 25 },
    reservedHost: null,
    reservedHostActor: null,
    closestDock: vi.fn(() => null),
    availableDockHosts: vi.fn(() => []),
    reserveHost: vi.fn(() => true),
    unreserveHost: vi.fn(),
    canDockAt: vi.fn(() => true),
    onDockStarted: vi.fn(),
    onDockTick: vi.fn(() => false),
    onDockCompleted: vi.fn(),
    ...overrides,
  } as unknown as DockClientManagerLike
}

function createMockNotifyDockClient(): INotifyDockClient {
  return {
    docked: vi.fn(),
    undocked: vi.fn(),
  }
}

function createMockNotifyDockHost(): INotifyDockHost {
  return {
    docked: vi.fn(),
    undocked: vi.fn(),
  }
}

function createMockDockClientBody(): IDockClientBody {
  return {
    playDockAnimation: vi.fn((_self, after) => after()),
    playReverseDockAnimation: vi.fn((_self, after) => after()),
  }
}

function createMockWithDockingOverlay(): WithDockingOverlay {
  return {
    visible: false,
    info: { sequence: 'dock-overlay' },
    withOffset: {
      animation: {
        playThen: vi.fn((_seq, after) => after()),
        playBackwardsThen: vi.fn((_seq, after) => after()),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GenericDockSequence', () => {
  describe('constructor', () => {
    it('creates with required parameters', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      expect(sequence).toBeDefined()
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Drag)
    })

    it('queues Wait child on construction', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 5, false, WVec.Zero, 10,
      )
      expect(sequence.childActivity).not.toBeNull()
    })
  })

  describe('tick state machine', () => {
    it('transitions from Drag to Dock', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      // Wait child completes first
      sequence.tick(self)
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Dock)
    })

    it('cancels in Drag state when host is dead', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor({ isDead: true })
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      const result = sequence.tick(self)
      expect(result).toBe(true)
      expect(client.unreserveHost).toHaveBeenCalled()
    })

    it('cancels in Drag state when host not in world', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor({ isInWorld: false })
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      const result = sequence.tick(self)
      expect(result).toBe(true)
    })

    it('transitions from Dock to Loop', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      // First tick: Drag -> Dock
      sequence.tick(self)
      // Second tick: Dock -> Loop
      sequence.tick(self)
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Loop)
    })

    it('notifies docked in Dock state', () => {
      const notifyClient = createMockNotifyDockClient()
      const notifyHost = createMockNotifyDockHost()
      const self = createMockActor({
        traits: new Map<string, unknown>([['NotifyClient', notifyClient]]),
      })
      const hostActor = createMockHostActor({
        traits: new Map<string, unknown>([['NotifyHost', notifyHost]]),
      })
      const client = createMockDockClient()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      sequence.tick(self) // Drag -> Dock
      sequence.tick(self) // Dock -> notifyDocked -> Loop
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Loop)
      expect(notifyClient.docked).toHaveBeenCalled()
      expect(notifyHost.docked).toHaveBeenCalled()
    })

    it('stays in Loop when onDockTick returns false', () => {
      const self = createMockActor()
      const client = createMockDockClient({
        onDockTick: vi.fn(() => false),
      })
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      // Drag -> Dock -> Loop
      sequence.tick(self)
      sequence.tick(self)
      const result = sequence.tick(self)
      expect(result).toBe(false)
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Loop)
    })

    it('transitions to Undock when onDockTick returns true', () => {
      const self = createMockActor()
      const client = createMockDockClient({
        onDockTick: vi.fn(() => true),
      })
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      // Drag -> Dock -> Loop
      sequence.tick(self)
      sequence.tick(self)
      sequence.tick(self)
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Undock)
    })

    it('completes the sequence', () => {
      const self = createMockActor()
      const client = createMockDockClient({
        onDockTick: vi.fn(() => true), // Force transition to Undock
      })
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      // Drag -> Dock -> Loop -> Undock -> Complete
      sequence.tick(self) // Drag -> Dock
      sequence.tick(self) // Dock -> Loop
      sequence.tick(self) // Loop -> Undock (onDockTick returns true)
      sequence.tick(self) // Undock -> Complete
      const result = sequence.tick(self) // Complete -> return true
      expect(result).toBe(true)
    })

    it('notifies undocked on completion', () => {
      const notifyClient = createMockNotifyDockClient()
      const notifyHost = createMockNotifyDockHost()
      const self = createMockActor({
        traits: new Map<string, unknown>([['NotifyClient', notifyClient]]),
      })
      const hostActor = createMockHostActor({
        traits: new Map<string, unknown>([['NotifyHost', notifyHost]]),
      })
      const client = createMockDockClient({
        onDockTick: vi.fn(() => true), // Force transition to Undock
      })
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      // Complete the sequence: Drag -> Dock -> Loop -> Undock -> Complete
      sequence.tick(self) // Drag -> Dock
      sequence.tick(self) // Dock -> Loop
      sequence.tick(self) // Loop -> Undock (onDockTick returns true)
      sequence.tick(self) // Undock -> Complete
      sequence.tick(self) // Complete -> notifyUndocked + return true
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Complete)
      expect(notifyClient.undocked).toHaveBeenCalled()
      expect(notifyHost.undocked).toHaveBeenCalled()
    })

    it('queues Drag child when isDragRequired is true', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, true, WVec.Zero, 10,
      )
      sequence.tick(self) // Drag state queues Drag child
      expect(sequence.childActivity).not.toBeNull()
    })
  })

  describe('playDockAnimations', () => {
    it('transitions to Loop without overlay', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      sequence.playDockAnimations(self)
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Loop)
    })

    it('plays overlay animation when WithDockingOverlay exists', () => {
      const overlay = createMockWithDockingOverlay()
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor({
        traits: new Map<string, unknown>([['WithDockingOverlay', overlay]]),
      })
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      sequence.playDockAnimations(self)
      // playThen mock calls callback synchronously, so visible ends up false
      // But playThen should have been called with the overlay sequence
      expect(overlay.withOffset.animation.playThen).toHaveBeenCalledWith(
        'dock-overlay',
        expect.any(Function),
      )
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Loop)
    })
  })

  describe('playDockClientAnimation', () => {
    it('calls after directly when no IDockClientBody', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      const after = vi.fn()
      sequence.playDockClientAnimation(self, after)
      expect(after).toHaveBeenCalled()
    })

    it('plays body animation when IDockClientBody exists', () => {
      const body = createMockDockClientBody()
      const self = createMockActor({
        traits: new Map([['DockClientBody', body]]),
      })
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      const after = vi.fn()
      sequence.playDockClientAnimation(self, after)
      expect(body.playDockAnimation).toHaveBeenCalled()
    })
  })

  describe('playUndockAnimations', () => {
    it('transitions to Complete without overlay', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      sequence.playUndockAnimations(self)
      expect((sequence as unknown as { dockingState: DockingState }).dockingState).toBe(DockingState.Complete)
    })
  })

  describe('target lines', () => {
    it('returns target from host actor', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      const targets = sequence.getTargets(self)
      expect(targets.length).toBe(1)
    })

    it('returns target line node', () => {
      const self = createMockActor()
      const client = createMockDockClient()
      const hostActor = createMockHostActor()
      const host = createMockDockHost()
      const sequence = new GenericDockSequence(
        self, client, hostActor, host, 0, false, WVec.Zero, 10,
      )
      const nodes = sequence.targetLineNodes(self)
      expect(nodes.length).toBe(1)
      expect(nodes[0].color).toEqual({ r: 0, g: 1, b: 0, a: 1 })
    })
  })
})
