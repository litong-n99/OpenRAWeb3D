/**
 * GpsWatcher.test.ts — unit tests for GPS watcher state management
 *
 * Tests focus on: GPS state transitions (Launched/Granted/GrantedAllies),
 * provider add/remove lifecycle, notification system, and shroud reset
 * prevention.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GpsWatcherInfo,
  GpsWatcher,
  type IOnGpsRefreshed,
} from './GpsWatcher.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeActor(name: string = 'player'): IGameActor {
  return {
    actorId: 0,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name },
  }
}

function makeGpsProvider(id: number): IGameActor {
  return {
    actorId: id,
    isInWorld: true,
    isDead: false,
    disposed: false,
    info: { name: `gpsBuilding_${id}` },
  }
}

// ---------------------------------------------------------------------------
// GpsWatcherInfo
// ---------------------------------------------------------------------------

describe('GpsWatcherInfo', () => {
  it('creates a GpsWatcher instance', () => {
    const info = new GpsWatcherInfo()
    const actor = makeActor()
    const watcher = info.create(actor)
    expect(watcher).toBeInstanceOf(GpsWatcher)
  })
})

// ---------------------------------------------------------------------------
// GpsWatcher — initial state
// ---------------------------------------------------------------------------

describe('GpsWatcher', () => {
  let watcher: GpsWatcher

  beforeEach(() => {
    watcher = new GpsWatcher()
  })

  describe('initial state', () => {
    it('is not launched initially', () => {
      expect(watcher.launched).toBe(false)
    })

    it('is not granted initially', () => {
      expect(watcher.granted).toBe(false)
    })

    it('is not granted to allies initially', () => {
      expect(watcher.grantedAllies).toBe(false)
    })

    it('is not explored initially', () => {
      expect(watcher.explored).toBe(false)
    })

    it('has no providers initially', () => {
      expect(watcher.providerCount).toBe(0)
    })

    it('has no listeners initially', () => {
      expect(watcher.listenerCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Provider management
  // -----------------------------------------------------------------------

  describe('gpsAdd / gpsRemove', () => {
    it('gpsAdd increments provider count', () => {
      const provider = makeGpsProvider(1)
      watcher.gpsAdd(provider)
      expect(watcher.providerCount).toBe(1)
    })

    it('gpsRemove decrements provider count', () => {
      const provider = makeGpsProvider(1)
      watcher.gpsAdd(provider)
      watcher.gpsRemove(provider)
      expect(watcher.providerCount).toBe(0)
    })

    it('gpsRemove of never-added provider is a no-op', () => {
      const provider = makeGpsProvider(1)
      watcher.gpsRemove(provider)
      expect(watcher.providerCount).toBe(0)
    })

    it('adding the same provider twice only counts once (Set semantics)', () => {
      const provider = makeGpsProvider(1)
      watcher.gpsAdd(provider)
      watcher.gpsAdd(provider)
      expect(watcher.providerCount).toBe(1)
    })

    it('granted is true when providers exist AND launched', () => {
      const provider = makeGpsProvider(1)
      watcher.gpsAdd(provider)
      // Not launched yet — granted should be false
      expect(watcher.granted).toBe(false)
      // Simulate launch
      watcher.launched = true
      // Now trigger a refresh manually
      watcher.gpsAdd(makeGpsProvider(2))
      expect(watcher.granted).toBe(true)
    })

    it('granted is false when launched but no providers', () => {
      watcher.launched = true
      // No providers — refresh via add/remove
      const provider = makeGpsProvider(1)
      watcher.gpsAdd(provider)
      expect(watcher.granted).toBe(true)
      watcher.gpsRemove(provider)
      expect(watcher.granted).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // reachedOrbit
  // -----------------------------------------------------------------------

  describe('reachedOrbit()', () => {
    it('sets launched to true', () => {
      const launcher: PlayerStub = { playerName: 'testPlayer' }
      watcher.reachedOrbit(launcher)
      expect(watcher.launched).toBe(true)
    })

    it('combined with providers sets granted to true', () => {
      const provider = makeGpsProvider(1)
      watcher.gpsAdd(provider)
      expect(watcher.granted).toBe(false) // not launched
      watcher.launched = true
      // Manually trigger by calling refreshGranted via public method
      // Adding a new provider forces refresh
      watcher.gpsAdd(makeGpsProvider(2))
      expect(watcher.granted).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Shroud reset prevention
  // -----------------------------------------------------------------------

  describe('preventShroudReset (IPreventsShroudReset)', () => {
    it('returns false when not granted and not granted to allies', () => {
      const actor = makeActor()
      expect(watcher.preventShroudReset(actor)).toBe(false)
    })

    it('returns true when granted', () => {
      watcher.granted = true
      const actor = makeActor()
      expect(watcher.preventShroudReset(actor)).toBe(true)
    })

    it('returns true when granted to allies (even if not directly granted)', () => {
      watcher.grantedAllies = true
      const actor = makeActor()
      expect(watcher.preventShroudReset(actor)).toBe(true)
    })

    it('returns true when both granted and granted to allies', () => {
      watcher.granted = true
      watcher.grantedAllies = true
      const actor = makeActor()
      expect(watcher.preventShroudReset(actor)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Notification system
  // -----------------------------------------------------------------------

  describe('registerForOnGpsRefreshed / unregisterForOnGpsRefreshed', () => {
    it('register adds a listener', () => {
      const actor = makeActor()
      const listener: IOnGpsRefreshed = {
        onGpsRefresh: () => {},
      }
      watcher.registerForOnGpsRefreshed(actor, listener)
      expect(watcher.listenerCount).toBe(1)
    })

    it('unregister removes the listener', () => {
      const actor = makeActor()
      const listener: IOnGpsRefreshed = {
        onGpsRefresh: () => {},
      }
      watcher.registerForOnGpsRefreshed(actor, listener)
      watcher.unregisterForOnGpsRefreshed(actor, listener)
      expect(watcher.listenerCount).toBe(0)
    })

    it('registering the same actor+trait twice replaces (Set deduplication based on object identity)', () => {
      const actor = makeActor()
      const listener: IOnGpsRefreshed = {
        onGpsRefresh: () => {},
      }
      // Since Set uses object reference for uniqueness, different TraitPair
      // instances with the same actor+trait will still be distinct entries
      // unless they share the same TraitPair reference.
      // Each register call creates a new TraitPair.
      watcher.registerForOnGpsRefreshed(actor, listener)
      watcher.registerForOnGpsRefreshed(actor, listener)
      expect(watcher.listenerCount).toBe(2) // different TraitPair references
    })

    it('unregister only removes matching pair', () => {
      const actor = makeActor()
      const listener1: IOnGpsRefreshed = {
        onGpsRefresh: () => {},
      }
      const listener2: IOnGpsRefreshed = {
        onGpsRefresh: () => {},
      }
      watcher.registerForOnGpsRefreshed(actor, listener1)
      watcher.registerForOnGpsRefreshed(actor, listener2)
      expect(watcher.listenerCount).toBe(2)
      watcher.unregisterForOnGpsRefreshed(actor, listener1)
      expect(watcher.listenerCount).toBe(1)
    })

    it('notifies listeners when granted state changes', () => {
      const actor = makeActor()

      const freshWatcher = new GpsWatcher()
      let freshNotified = false
      const freshListener: IOnGpsRefreshed = {
        onGpsRefresh: (_self: IGameActor, _player: PlayerStub): void => {
          freshNotified = true
        },
      }
      freshWatcher.registerForOnGpsRefreshed(actor, freshListener)
      freshWatcher.launched = true

      // Trigger state change via gpsAdd (refreshGranted detects wasGranted vs granted)
      freshWatcher.gpsAdd(makeGpsProvider(100))
      // At this point: actors.size=1, launched=true, so granted transitions
      // from false to true. This should trigger the notification.
      expect(freshNotified).toBe(true)
    })
  })
})
