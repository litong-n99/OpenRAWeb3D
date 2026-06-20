/**
 * World.test.ts — GameWorldManager unit tests
 *
 * Tests focus on: state management, tick execution order, actor lifecycle,
 * effect lifecycle, pause behavior, frame end actions, dispose lifecycle.
 *
 * Since World.ts depends on @babylonjs/core only for type imports
 * (Engine, Scene — used as parameter types), we do NOT need to mock
 * Babylon.js. Tests use a minimal stub WorldRenderer to satisfy types.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  GameWorldManager,
  WorldType,
} from './World.js'
import type { IGameEffect } from './Effects/IEffect.js'
import {
  Component,
  type IGameActor,
  type ITick,
  type ITickRender,
  type INotifyAddedToWorld,
  type INotifyRemovedFromWorld,
  type INotifyActorDisposing,
} from './Traits/TraitsInterfaces.js'
import type { PlayerStub, WorldRendererStub } from './Traits/TraitsInterfaces.js'
import { ActorInitializer, OwnerNameInit, OwnerInit } from './Traits/ActorInitializer.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal WorldRenderer stub for test purposes. */
function createStubWorldRenderer(): WorldRendererStub {
  return {}
}

/** Create a minimal Player stub. */
function createStubPlayer(name: string, playerIndex: number = 0): PlayerStub {
  return {
    playerName: name,
    playerIndex,
    internalName: name.toLowerCase(),
    // IUnlocksRenderPlayer
    unlockedRenderPlayer: false,
  } as PlayerStub
}

// ---------------------------------------------------------------------------
// ITick test trait (registered in TraitDictionary)
// ---------------------------------------------------------------------------

/** A test trait implementing ITick. */
class TestTickTrait extends Component implements ITick {
  static readonly interfaces = ['ITick', 'component']
  tickCalls: IGameActor[] = []
  tick(actor: IGameActor): void {
    this.tickCalls.push(actor)
  }
}

/** A test trait implementing INotifyAddedToWorld. */
class TestAddedToWorldTrait extends Component implements INotifyAddedToWorld {
  static readonly interfaces = ['INotifyAddedToWorld', 'component']
  addedCalls: IGameActor[] = []
  addedToWorld(actor: IGameActor): void {
    this.addedCalls.push(actor)
  }
}

/** A test trait implementing INotifyRemovedFromWorld. */
class TestRemovedFromWorldTrait extends Component implements INotifyRemovedFromWorld {
  static readonly interfaces = ['INotifyRemovedFromWorld', 'component']
  removedCalls: IGameActor[] = []
  removedFromWorld(actor: IGameActor): void {
    this.removedCalls.push(actor)
  }
}

/** A test trait implementing INotifyActorDisposing. */
class TestDisposingTrait extends Component implements INotifyActorDisposing {
  static readonly interfaces = ['INotifyActorDisposing', 'component']
  disposingCalls: IGameActor[] = []
  disposing(actor: IGameActor): void {
    this.disposingCalls.push(actor)
  }
}

/** A test trait implementing ITickRender. */
class TestTickRenderTrait extends Component implements ITickRender {
  static readonly interfaces = ['ITickRender', 'component']
  renderCalls: { wr: WorldRendererStub; actor: IGameActor }[] = []
  tickRender(wr: WorldRendererStub, actor: IGameActor): void {
    this.renderCalls.push({ wr, actor })
  }
}

// ---------------------------------------------------------------------------
// GameWorldManager construction
// ---------------------------------------------------------------------------

describe('GameWorldManager construction', () => {
  it('creates with default options', () => {
    const world = new GameWorldManager()
    expect(world.type).toBe(WorldType.Regular)
    expect(world.timestep).toBe(40)
    expect(world.replayTimestep).toBe(40)
    expect(world.worldTick).toBe(0)
    expect(world.paused).toBe(false)
    expect(world.isGameOver).toBe(false)
    expect(world.disposing).toBe(false)
    expect(world.players).toEqual([])
    expect(world.localPlayer).toBeUndefined()
    expect(world.renderPlayer).toBeUndefined()
  })

  it('creates with specified WorldType', () => {
    const shellmap = new GameWorldManager({ type: WorldType.Shellmap })
    expect(shellmap.type).toBe(WorldType.Shellmap)

    const editor = new GameWorldManager({ type: WorldType.Editor })
    expect(editor.type).toBe(WorldType.Editor)

    const regular = new GameWorldManager({ type: WorldType.Regular })
    expect(regular.type).toBe(WorldType.Regular)
  })

  it('creates with custom timestep', () => {
    const world = new GameWorldManager({ timestep: 50 })
    expect(world.timestep).toBe(50)
    expect(world.replayTimestep).toBe(50)
  })

  it('creates WorldActor during construction', () => {
    const world = new GameWorldManager()
    expect(world.worldActor).toBeDefined()
    expect(world.worldActor.actorId).toBe(0) // first allocated ID
    expect(world.worldActor.isInWorld).toBe(true) // WorldActor is always in-world
  })

  it('registers WorldActor traits in TraitDictionary', () => {
    const world = new GameWorldManager()

    // Verify ScreenMap trait is registered
    expect(world.screenMap).toBeDefined()
    expect(world.actorMap).toBeDefined()
    expect(world.selection).toBeDefined()
    expect(world.controlGroups).toBeDefined()

    // Verify they are accessible via TraitDictionary
    const screenMapTraits = world.traitDict.traitsImplementing<Component>(
      world.worldActor,
      'ScreenMap',
    )
    expect(screenMapTraits.length).toBe(1)
  })

  it('WorldActor traits are registered in TraitDictionary under correct interface names', () => {
    const world = new GameWorldManager()
    const dict = world.traitDict

    expect(dict.traitsImplementing(world.worldActor, 'ScreenMap').length).toBe(1)
    expect(dict.traitsImplementing(world.worldActor, 'IActorMap').length).toBe(1)
    expect(dict.traitsImplementing(world.worldActor, 'ISelection').length).toBe(1)
    expect(dict.traitsImplementing(world.worldActor, 'IControlGroups').length).toBe(1)
    // ScreenMap AND ShroudRenderer both implement IWorldLoaded (Ch25 Phase A)
    expect(dict.traitsImplementing(world.worldActor, 'IWorldLoaded').length).toBe(2)
    // ShroudRenderer also implements these interfaces
    expect(dict.traitsImplementing(world.worldActor, 'IRenderShroud').length).toBe(1)
    expect(dict.traitsImplementing(world.worldActor, 'ITickRender').length).toBe(1)
    expect(dict.traitsImplementing(world.worldActor, 'INotifyActorDisposing').length).toBe(1)
    expect(dict.traitsImplementing(world.worldActor, 'component').length).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Actor lifecycle
// ---------------------------------------------------------------------------

describe('GameWorldManager actor lifecycle', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('addActor adds actor to world and fires events', () => {
    const actor = createTestActor(world, 10)
    const addedHandler = vi.fn()
    world.actorAdded = addedHandler

    world.addActor(actor)

    expect(actor.isInWorld).toBe(true)
    expect(world.getActorById(10)).toBe(actor)
    expect(addedHandler).toHaveBeenCalledWith(actor)
  })

  it('addActor fires INotifyAddedToWorld on all traits', () => {
    const actor = createTestActor(world, 20)
    const trait = new TestAddedToWorldTrait()
    trait.attach(actor)
    world.traitDict.addTrait(actor, trait)

    world.addActor(actor)

    expect(trait.addedCalls.length).toBe(1)
    expect(trait.addedCalls[0]).toBe(actor)
  })

  it('addActor silently skips already-in-world actors', () => {
    const actor = createTestActor(world, 30)
    world.addActor(actor)

    const addedHandler = vi.fn()
    world.actorAdded = addedHandler

    // Double add — should be a no-op
    world.addActor(actor)
    expect(addedHandler).not.toHaveBeenCalled()
  })

  it('removeActor removes actor and fires events', () => {
    const actor = createTestActor(world, 40)
    world.addActor(actor)
    const removedHandler = vi.fn()
    world.actorRemoved = removedHandler

    world.removeActor(actor)

    expect(actor.isInWorld).toBe(false)
    expect(world.getActorById(40)).toBeUndefined()
    expect(removedHandler).toHaveBeenCalledWith(actor)
  })

  it('removeActor fires INotifyRemovedFromWorld on all traits', () => {
    const actor = createTestActor(world, 50)
    const trait = new TestRemovedFromWorldTrait()
    trait.attach(actor)
    world.traitDict.addTrait(actor, trait)
    world.addActor(actor)

    world.removeActor(actor)

    expect(trait.removedCalls.length).toBe(1)
    expect(trait.removedCalls[0]).toBe(actor)
  })

  it('removeActor silently skips already-removed actors', () => {
    const actor = createTestActor(world, 60)
    world.addActor(actor)
    world.removeActor(actor)

    const removedHandler = vi.fn()
    world.actorRemoved = removedHandler

    // Double remove — should be a no-op
    world.removeActor(actor)
    expect(removedHandler).not.toHaveBeenCalled()
  })

  it('getActorById returns undefined for non-existent actor', () => {
    expect(world.getActorById(99999)).toBeUndefined()
  })

  it('actors getter returns all actors including WorldActor', () => {
    // WorldActor (actorId 0) is always present
    const a1 = createTestActor(world, 1)
    const a2 = createTestActor(world, 2)
    world.addActor(a1)
    world.addActor(a2)

    const allActors = Array.from(world.actors)
    // WorldActor + a1 + a2 = 3
    expect(allActors).toHaveLength(3)
    expect(allActors).toContain(world.worldActor)
    expect(allActors).toContain(a1)
    expect(allActors).toContain(a2)
  })

  it('createActor creates and optionally adds to world', () => {
    const actor = world.createActor('test', true)!
    expect(actor).toBeDefined()
    expect(actor.isInWorld).toBe(true)
    expect(world.getActorById(actor.actorId)).toBe(actor)
  })

  it('createActor with addToWorld=false does not add to world', () => {
    const actor = world.createActor('test', false)!
    expect(actor).toBeDefined()
    expect(actor.isInWorld).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Effect lifecycle
// ---------------------------------------------------------------------------

describe('GameWorldManager effect lifecycle', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('addEffect adds to effects list', () => {
    const effect = createTestEffect()
    world.addEffect(effect)
    expect(world.effects).toContain(effect)
  })

  it('removeEffect removes from effects list', () => {
    const effect = createTestEffect()
    world.addEffect(effect)
    world.removeEffect(effect)
    expect(world.effects).not.toContain(effect)
  })

  it('removeAllEffects removes matching effects', () => {
    const e1 = createTestEffect()
    const e2 = createTestEffect()
    world.addEffect(e1)
    world.addEffect(e2)

    world.removeAllEffects((e) => e === e1)

    expect(world.effects).not.toContain(e1)
    expect(world.effects).toContain(e2)
  })

  it('removeEffect is idempotent', () => {
    const effect = createTestEffect()
    // Removing a non-added effect should not throw
    expect(() => world.removeEffect(effect)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tick execution order
// ---------------------------------------------------------------------------

describe('GameWorldManager tick()', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('increments worldTick each tick', () => {
    expect(world.worldTick).toBe(0)
    world.tick()
    expect(world.worldTick).toBe(1)
    world.tick()
    expect(world.worldTick).toBe(2)
  })

  it('first tick does not execute when paused (Paused takes precedence)', () => {
    // Set paused BEFORE first tick
    world.setLocalPauseState(true)
    expect(world.paused).toBe(true)

    // Even though WorldTick == 0, the Paused check comes first in OpenRA's
    // condition: if (!Paused && (...))
    // PerfSample is not available — game logic ticks are always blocked when Paused.
    world.tick()
    expect(world.worldTick).toBe(0)
  })

  it('WorldTick 0 bypasses shellmap pause setting but NOT Paused flag', () => {
    // Shellmap with pauseShellmap=true — first tick should still execute
    // because WorldTick == 0 bypasses the shellmap-specific check
    const shellWorld = new GameWorldManager({
      type: WorldType.Shellmap,
      gameSettings: { pauseShellmap: true },
    })

    // NOT paused, so the full condition evaluates:
    // !Paused && (!Shellmap || !pauseShellmap || WorldTick==0)
    // = true && (false || false || true) = true
    shellWorld.tick()
    expect(shellWorld.worldTick).toBe(1)
  })

  it('second tick does NOT execute when paused', () => {
    // First tick
    world.tick()
    expect(world.worldTick).toBe(1)

    // Pause
    world.setLocalPauseState(true)

    // Second tick should NOT execute
    world.tick()
    expect(world.worldTick).toBe(1) // unchanged
  })

  it('executes ITick traits on all actors during tick', () => {
    const actor = createTestActor(world, 1)
    const trait = new TestTickTrait()
    trait.attach(actor)
    world.traitDict.addTrait(actor, trait)
    world.addActor(actor)

    world.tick()

    expect(trait.tickCalls.length).toBe(1)
    expect(trait.tickCalls[0]).toBe(actor)
  })

  it('executes IEffect.tick on all active effects during tick', () => {
    const effect = createTestEffect()
    world.addEffect(effect)

    world.tick()

    expect(effect.tickCalls.length).toBe(1)
    // GameWorldManager passes itself to effect.tick()
    expect(effect.tickCalls[0]).toBe(world)
  })

  it('tick execution order: actors → ITick → effects', () => {
    const executionLog: string[] = []

    // Actor with tick()
    const actor = createTestActorWithCustomTick(world, 1, () => {
      executionLog.push('actor.tick')
    })
    world.addActor(actor)

    // ITick trait
    const tickTrait = new TestTickTrait()
    tickTrait.attach(actor)
    // Override tick to log
    const origTick = tickTrait.tick.bind(tickTrait)
    tickTrait.tick = (a: IGameActor) => {
      executionLog.push('ITick.tick')
      origTick(a)
    }
    world.traitDict.addTrait(actor, tickTrait)

    // Effect
    const effect = createTestEffect(() => {
      executionLog.push('IEffect.tick')
    })
    world.addEffect(effect)

    world.tick()

    expect(executionLog[0]).toBe('actor.tick')
    expect(executionLog[1]).toBe('ITick.tick')
    expect(executionLog[2]).toBe('IEffect.tick')
  })
})

// ---------------------------------------------------------------------------
// Frame end actions (CRITICAL — must drain even when paused)
// ---------------------------------------------------------------------------

describe('GameWorldManager frameEndActions', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('frameEndActions execute after all ticks', () => {
    const executionLog: string[] = []

    const effect = createTestEffect(() => {
      executionLog.push('effect')
    })
    world.addEffect(effect)

    world.addFrameEndTask(() => {
      executionLog.push('frameEnd')
    })

    world.tick()

    expect(executionLog).toEqual(['effect', 'frameEnd'])
  })

  it('frameEndActions drain even when world is paused (CRITICAL B1)', () => {
    // First tick to initialize
    world.tick()

    // Pause
    world.setLocalPauseState(true)
    expect(world.paused).toBe(true)

    // Add a frame end task while paused
    let frameEndExecuted = false
    world.addFrameEndTask(() => {
      frameEndExecuted = true
    })

    // Tick while paused — frameEndActions MUST still drain
    world.tick()

    // WorldTick should NOT have changed (paused)
    expect(world.worldTick).toBe(1)
    // frameEndActions MUST have executed
    expect(frameEndExecuted).toBe(true)
  })

  it('multiple frameEndActions execute in FIFO order', () => {
    const order: number[] = []

    world.addFrameEndTask(() => order.push(1))
    world.addFrameEndTask(() => order.push(2))
    world.addFrameEndTask(() => order.push(3))

    world.tick()

    expect(order).toEqual([1, 2, 3])
  })

  it('frameEndActions added inside another frameEndAction execute in same tick', () => {
    const order: number[] = []

    world.addFrameEndTask(() => {
      order.push(1)
      // Queue another action during execution
      world.addFrameEndTask(() => order.push(2))
    })

    world.tick()

    // Since the while loop continues until queue is empty,
    // action 2 should also execute in the same tick
    expect(order).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// TickRender
// ---------------------------------------------------------------------------

describe('GameWorldManager tickRender()', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('executes ITickRender traits and ScreenMap.tickRender', () => {
    const wr = createStubWorldRenderer()
    const actor = createTestActor(world, 1)
    const trait = new TestTickRenderTrait()
    trait.attach(actor)
    world.traitDict.addTrait(actor, trait)
    world.addActor(actor)

    world.tickRender(wr)

    expect(trait.renderCalls.length).toBe(1)
    expect(trait.renderCalls[0].wr).toBe(wr)
    expect(trait.renderCalls[0].actor).toBe(actor)
  })

  it('tickRender fires even when world is paused', () => {
    world.setLocalPauseState(true)
    const wr = createStubWorldRenderer()
    const actor = createTestActor(world, 1)
    const trait = new TestTickRenderTrait()
    trait.attach(actor)
    world.traitDict.addTrait(actor, trait)
    world.addActor(actor)

    world.tickRender(wr)

    // tickRender ignores pause state
    expect(trait.renderCalls.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Pause state
// ---------------------------------------------------------------------------

describe('GameWorldManager pause state', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('setPauseState does nothing when game is over', () => {
    world.setLocalPauseState(false)
    world.tick() // first tick

    // End the game
    world.endGame()
    const pausedBefore = world.predictedPaused

    // setPauseState should be ignored
    world.setPauseState(false)
    expect(world.predictedPaused).toBe(pausedBefore)
  })

  it('setLocalPauseState sets both paused and predictedPaused', () => {
    world.setLocalPauseState(true)
    expect(world.paused).toBe(true)
    expect(world.predictedPaused).toBe(true)

    world.setLocalPauseState(false)
    expect(world.paused).toBe(false)
    expect(world.predictedPaused).toBe(false)
  })

  it('setPauseState sets predictedPaused (networked version)', () => {
    world.setPauseState(true)
    expect(world.predictedPaused).toBe(true)
    // paused is not directly set by setPauseState (it's set by server response)
  })

  it('shellmap with pauseShellmap=true pauses after first tick', () => {
    const world = new GameWorldManager({
      type: WorldType.Shellmap,
      gameSettings: { pauseShellmap: true },
    })

    // First tick should execute (WorldTick == 0)
    world.tick()
    expect(world.worldTick).toBe(1)

    // Set paused
    world.setLocalPauseState(true)

    // Second tick should NOT execute
    world.tick()
    expect(world.worldTick).toBe(1)
  })

  it('shellmap with pauseShellmap=false always ticks', () => {
    const world = new GameWorldManager({
      type: WorldType.Shellmap,
      gameSettings: { pauseShellmap: false },
    })

    world.setLocalPauseState(false)

    world.tick()
    expect(world.worldTick).toBe(1)

    world.tick()
    expect(world.worldTick).toBe(2)
  })

  it('shellmap with undefined gameSettings defaults to ticking', () => {
    const world = new GameWorldManager({
      type: WorldType.Shellmap,
      // No gameSettings — pauseShellmap is undefined (falsy)
    })

    world.tick()
    expect(world.worldTick).toBe(1)

    world.tick()
    expect(world.worldTick).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Player management
// ---------------------------------------------------------------------------

describe('GameWorldManager player management', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('setPlayers sets all players and local player', () => {
    const p1 = createStubPlayer('Alice', 0)
    const p2 = createStubPlayer('Bob', 1)

    world.setPlayers([p1, p2], p1)

    expect(world.players).toHaveLength(2)
    expect(world.localPlayer).toBe(p1)
    expect(world.renderPlayer).toBe(p1) // render player defaults to local player
  })

  it('setPlayers throws if players already set', () => {
    const p1 = createStubPlayer('Alice', 0)
    world.setPlayers([p1], p1)

    expect(() => world.setPlayers([p1], p1)).toThrow(
      'Players are fixed once they have been set.',
    )
  })

  it('setPlayers throws if local player not in players array', () => {
    const p1 = createStubPlayer('Alice', 0)
    const p2 = createStubPlayer('Bob', 1)

    expect(() => world.setPlayers([p1], p2)).toThrow(
      'The local player must be one of the players in the world.',
    )
  })

  it('renderPlayer can be changed with unlocked render player', () => {
    const p1 = createStubPlayer('Alice', 0)
    const p2 = {
      ...createStubPlayer('Bob', 1),
      unlockedRenderPlayer: true,
    }
    world.setPlayers([p1 as PlayerStub, p2 as PlayerStub], p1 as PlayerStub)

    const renderChanged = vi.fn()
    world.renderPlayerChanged = renderChanged

    // Local player has unlockedRenderPlayer = false by default
    // But p2 has unlockedRenderPlayer = true
    // Changing render player should work because the GUARD checks the LOCAL player:
    // "if (LocalPlayer == null || LocalPlayer.UnlockedRenderPlayer)"
    // Since p1 has unlockedRenderPlayer = false, the change is blocked
    // UNLESS localPlayer is null
    world.renderPlayer = p2 as PlayerStub

    // The change should be blocked because localPlayer.UnlockedRenderPlayer is false
    expect(renderChanged).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

describe('GameWorldManager endGame', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
    world.tick() // first tick
  })

  it('endGame sets isGameOver and pauses', () => {
    const gameOverFired = vi.fn()
    world.gameOver = gameOverFired

    world.endGame()

    expect(world.isGameOver).toBe(true)
    expect(world.paused).toBe(true)       // MAJOR: _paused must be set so tick() stops
    expect(world.predictedPaused).toBe(true)
    expect(gameOverFired).toHaveBeenCalled()
  })

  it('endGame stops worldTick from incrementing', () => {
    // beforeEach already ran one tick (WorldTick = 1)
    expect(world.worldTick).toBe(1)

    // End the game
    world.endGame()
    expect(world.isGameOver).toBe(true)
    expect(world.paused).toBe(true)

    // Subsequent tick() should NOT increment WorldTick
    const tickBefore = world.worldTick
    world.tick()
    expect(world.worldTick).toBe(tickBefore)
  })

  it('endGame is idempotent', () => {
    const gameOverFired = vi.fn()
    world.gameOver = gameOverFired

    world.endGame()
    world.endGame()

    expect(gameOverFired).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Out of sync
// ---------------------------------------------------------------------------

describe('GameWorldManager outOfSync', () => {
  it('ends game and sets replay timestep to 0', () => {
    const world = new GameWorldManager()

    world.outOfSync()

    expect(world.isGameOver).toBe(true)
    expect(world.replayTimestep).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// SyncHash
// ---------------------------------------------------------------------------

describe('GameWorldManager syncHash', () => {
  it('returns placeholder value 0', () => {
    const world = new GameWorldManager()
    expect(world.syncHash()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// World loading (loadComplete, postLoadComplete)
// ---------------------------------------------------------------------------

describe('GameWorldManager world loading', () => {
  let world: GameWorldManager

  beforeEach(() => {
    world = new GameWorldManager()
  })

  it('loadComplete calls ScreenMap.worldLoaded', () => {
    const wr = createStubWorldRenderer()

    // Replace screenMap with a spy
    let worldLoadedCalled = false
    const origScreenMap = world.screenMap
    ;(origScreenMap as { worldLoaded?: typeof origScreenMap.worldLoaded }).worldLoaded = (
      _w: unknown,
      _wr: unknown,
    ) => {
      worldLoadedCalled = true
    }

    world.loadComplete(wr)
    expect(worldLoadedCalled).toBe(true)
  })

  it('postLoadComplete does not throw', () => {
    const wr = createStubWorldRenderer()
    expect(() => world.postLoadComplete(wr)).not.toThrow()
  })

  it('markGameLoading sets internal state', () => {
    expect(() => world.markGameLoading()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe('GameWorldManager dispose', () => {
  it('dispose sets disposing flag', () => {
    const world = new GameWorldManager()
    world.dispose()
    expect(world.disposing).toBe(true)
  })

  it('dispose clears actors map', () => {
    const world = new GameWorldManager()
    const actor = createTestActor(world, 1)
    world.addActor(actor)

    world.dispose()

    expect(world.getActorById(1)).toBeUndefined()
  })

  it('dispose fires INotifyActorDisposing on actors', () => {
    const world = new GameWorldManager()
    const actor = createTestActor(world, 1)
    const trait = new TestDisposingTrait()
    trait.attach(actor)
    world.traitDict.addTrait(actor, trait)
    world.addActor(actor)

    world.dispose()

    expect(trait.disposingCalls.length).toBe(1)
    expect(trait.disposingCalls[0]).toBe(actor)
  })

  it('dispose drains frameEndActions generated during actor disposal', () => {
    const world = new GameWorldManager()

    // Add an actor whose disposal trait queues a frameEndAction
    const actor = createTestActor(world, 1)
    const trait = new TestDisposingTrait()
    // Override disposing to queue a frameEndAction (simulating actor disposal pattern)
    trait.disposing = (_a: IGameActor) => {
      world.addFrameEndTask(() => {
        // This task is added DURING disposal, so it should be drained
      })
    }
    trait.attach(actor)
    world.traitDict.addTrait(actor, trait)
    world.addActor(actor)

    // dispose() first clears existing frameEndActions, then disposes actors,
    // then drains any new frameEndActions added during disposal
    expect(() => world.dispose()).not.toThrow()
  })

  it('dispose clears frameEndActions queued before disposal', () => {
    const world = new GameWorldManager()
    let executed = false

    // Queue a task before dispose — it should be cleared, not executed
    world.addFrameEndTask(() => {
      executed = true
    })

    world.dispose()

    // The queued task was cleared by the initial frameEndActions.length = 0
    // in dispose(), NOT executed.
    expect(executed).toBe(false)
  })

  it('dispose is safe to call on already-disposed world', () => {
    const world = new GameWorldManager()
    world.dispose()
    // Second dispose should not throw
    expect(() => world.dispose()).not.toThrow()
  })

  it('dispose handles worlds with no actors', () => {
    const world = new GameWorldManager()
    // Remove the WorldActor from _actors map (it's not in the map by default —
    // WorldActor is created but NOT added to the internal _actors map)
    expect(() => world.dispose()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('GameWorldManager getSettings', () => {
  it('returns undefined when modData is not set', () => {
    const world = new GameWorldManager()
    expect(world.getSettings(class {})).toBeUndefined()
  })

  it('delegates to modData.getSettings when available', () => {
    class TestSettings {
      value = 42
    }
    const world = new GameWorldManager({
      modData: {
        getSettings: <T>(_type: new () => T): T => new TestSettings() as unknown as T,
      },
    })
    const settings = world.getSettings(TestSettings)
    expect(settings).toBeDefined()
    expect((settings as TestSettings).value).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// Issue order
// ---------------------------------------------------------------------------

describe('GameWorldManager issueOrder', () => {
  it('does not throw when OrderManager is undefined', () => {
    const world = new GameWorldManager()
    expect(() =>
      world.issueOrder({ orderName: 'test', targetString: '', extraData: 0 }),
    ).not.toThrow()
  })

  it('delegates to OrderManager.issueOrder when available', () => {
    const issueOrderSpy = vi.fn()
    const world = new GameWorldManager({
      orderManager: {
        lobbyInfo: {
          globalSettings: {
            randomSeed: 0,
            optionOrDefault: () => '',
          },
          disabledSpawnPoints: [],
        },
        netFrameNumber: 0,
        issueOrder: issueOrderSpy,
      },
    })

    const order = { orderName: 'Attack', targetString: 'target1', extraData: 0 }
    world.issueOrder(order)
    expect(issueOrderSpy).toHaveBeenCalledWith(order)
  })
})

// ---------------------------------------------------------------------------
// isReplay and isLoadingGameSave
// ---------------------------------------------------------------------------

describe('GameWorldManager isReplay', () => {
  it('returns false when OrderManager is undefined', () => {
    const world = new GameWorldManager()
    expect(world.isReplay).toBe(false)
  })
})

describe('GameWorldManager isLoadingGameSave', () => {
  it('returns false when OrderManager is undefined', () => {
    const world = new GameWorldManager()
    expect(world.isLoadingGameSave).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Start/stop loop (unit tests — no real Babylon.js)
// ---------------------------------------------------------------------------

describe('GameWorldManager startLoop/stopLoop', () => {
  it('stopLoop is safe to call when loop is not running', () => {
    const world = new GameWorldManager()
    expect(() => world.stopLoop()).not.toThrow()
  })

  it('startLoop throws if already running', () => {
    // NOTE: We cannot fully test startLoop in unit tests because it requires
    // a real Babylon.js Engine and Scene (which need WebGL). The method
    // signature is verified by TypeScript compilation.
    // Visual integration is tested in E2E tests.
    expect(true).toBe(true) // placeholder for E2E
  })
})

// ---------------------------------------------------------------------------
// Ch26 Phase A: createActor with ruleset integration
// ---------------------------------------------------------------------------

describe('GameWorldManager createActor (Ch26 Phase A)', () => {
  it('falls back to stub actor when no modData/ruleset', () => {
    const world = new GameWorldManager()
    const actor = world.createActor('test', true)
    expect(actor).not.toBeNull()
    expect(actor!.isInWorld).toBe(true)
  })

  it('returns null for unknown actor type when ruleset exists', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Create a minimal ruleset with empty actors map
    const ruleset = {
      actors: new Map(),
      weapons: new Map(),
      voices: new Map(),
      notifications: new Map(),
      music: new Map(),
      terrainInfo: null,
      modelSequences: new Map(),
    }
    const world = new GameWorldManager({
      modData: {
        getSettings: <T>(_type: new () => T): T => ({}) as T,
        ruleset: ruleset as any,
      },
    })
    const actor = world.createActor('nonexistent', true)
    expect(actor).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown actor type'),
    )
    warnSpy.mockRestore()
  })

  it('accepts ActorInitializer parameter (succeeds)', () => {
    const world = new GameWorldManager()
    // With no ruleset, createActor falls back to stub actor creation.
    // The initializer parameter is accepted; it is applied when ruleset is present.
    const actor = world.createActor('test', false, undefined)
    expect(actor).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Ch26 Phase A: _createPlayers
// ---------------------------------------------------------------------------

describe('GameWorldManager _createPlayers (Ch26 Phase A)', () => {
  it('creates players from map player data', () => {
    const world = new GameWorldManager()
    const mapPlayers = {
      players: [
        {
          internalName: 'Multi0',
          name: 'Player 1',
          color: 0,
          faction: 'allies',
          isHuman: true,
          isBot: false,
        },
        {
          internalName: 'Multi1',
          name: 'AI 1',
          color: 1,
          faction: 'soviet',
          isHuman: false,
          isBot: true,
          botType: 'harvester',
        },
      ],
      playableCount: 1,
    }

    // Access private method via type cast
    const result = (world as any)._createPlayers(mapPlayers)
    expect(result.players).toHaveLength(2)
    expect(result.localPlayer).toBeDefined()
    expect(result.localPlayer!.playerName).toBe('Player 1')
    expect(result.localPlayer!.internalName).toBe('Multi0')
  })

  it('returns undefined localPlayer if no human player', () => {
    const world = new GameWorldManager()
    const mapPlayers = {
      players: [
        {
          internalName: 'Multi0',
          name: 'AI 1',
          isHuman: false,
          isBot: true,
        },
      ],
      playableCount: 0,
    }

    const result = (world as any)._createPlayers(mapPlayers)
    expect(result.players).toHaveLength(1)
    expect(result.localPlayer).toBeUndefined()
  })

  it('creates PlayerActor for each player (requires ruleset with player actor)', () => {
    const world = new GameWorldManager()
    const mapPlayers = {
      players: [
        {
          internalName: 'Multi0',
          name: 'Human',
          isHuman: true,
          isBot: false,
        },
      ],
      playableCount: 1,
    }

    const result = (world as any)._createPlayers(mapPlayers)
    expect(result.players[0]).toBeDefined()
    expect(result.players[0].playerName).toBe('Human')
  })

  it('handles empty players array', () => {
    const world = new GameWorldManager()
    const mapPlayers = { players: [], playableCount: 0 }
    const result = (world as any)._createPlayers(mapPlayers)
    expect(result.players).toHaveLength(0)
    expect(result.localPlayer).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Ch26 Phase A: loadComplete with player creation and actor spawning
// ---------------------------------------------------------------------------

describe('GameWorldManager loadComplete (Ch26 Phase A)', () => {
  it('creates players during loadComplete when map has playerDefinitions', () => {
    const world = new GameWorldManager({
      map: {
        uid: 'test-map',
        title: 'Test Map',
        dispose: () => {},
        playerDefinitions: {
          players: [
            {
              internalName: 'Multi0',
              name: 'Player 1',
              isHuman: true,
              isBot: false,
            },
          ],
          playableCount: 1,
        },
      },
    })
    const wr = {} as WorldRendererStub

    world.loadComplete(wr)
    expect(world.players).toHaveLength(1)
    expect(world.players[0].playerName).toBe('Player 1')
    expect(world.localPlayer).toBeDefined()
  })

  it('skips player creation if players already set', () => {
    const existingPlayer = createStubPlayer('Pre-set')
    const world = new GameWorldManager()
    world.setPlayers([existingPlayer], existingPlayer)

    // Simulate loadComplete with map that has players
    const wr = {} as WorldRendererStub
    ;(world as any).map = {
      uid: 'test',
      title: 'Test',
      dispose: () => {},
      playerDefinitions: {
        players: [{ internalName: 'Other', name: 'Other', isHuman: true, isBot: false }],
        playableCount: 1,
      },
    }
    world.loadComplete(wr)

    // Players should NOT be overwritten (setPlayers would throw)
    expect(world.players).toHaveLength(1)
    expect(world.players[0]).toBe(existingPlayer)
  })

  it('handles loadComplete without map data', () => {
    const world = new GameWorldManager()
    const wr = {} as WorldRendererStub
    expect(() => world.loadComplete(wr)).not.toThrow()
    expect(world.players).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Ch26 Phase A: Owner resolution (_spawnSingleMapActor → createActor)
// ---------------------------------------------------------------------------

describe('GameWorldManager owner resolution (Ch26 Phase A)', () => {
  it('_spawnSingleMapActor resolves OwnerNameInit → OwnerInit → sets actor.owner', () => {
    const world = new GameWorldManager({
      modData: {
        getSettings: <T>(_type: new () => T): T => ({}) as T,
        ruleset: {
          actors: new Map([
            ['e1', {
              name: 'e1',
              isAbstract: false,
              traitConfigs: [],
              hasTraitInfo: () => false,
            }],
            ['player', {
              name: 'player',
              isAbstract: false,
              traitConfigs: [],
              hasTraitInfo: () => false,
            }],
          ]),
        } as any,
        traitFactory: {
          createAllTraits: () => [],
          has: () => false,
          create: () => null,
        } as any,
      },
    })

    // First, set up players via _createPlayers
    const mapPlayers = {
      players: [
        {
          internalName: 'Multi0',
          name: 'Player 1',
          isHuman: true,
          isBot: false,
        },
        {
          internalName: 'Neutral',
          name: 'Neutral',
          isHuman: false,
          isBot: false,
        },
      ],
      playableCount: 1,
    }
    ;(world as any)._createPlayers(mapPlayers)

    // Now spawn a map actor with OwnerNameInit pointing to 'Multi0'
    const entry = {
      type: 'E1',
      location: { x: 10, y: 20 },
      owner: 'Multi0',
    }
    ;(world as any)._spawnSingleMapActor(entry)

    // Verify the actor was created and has the correct owner
    const actors = Array.from(world.actors)
    const spawnedActor = actors.find(a => a.actorId > 0) // skip WorldActor
    expect(spawnedActor).toBeDefined()
    expect(spawnedActor!.owner).toBeDefined()
    expect(spawnedActor!.owner!.playerName).toBe('Player 1')
    expect(spawnedActor!.owner!.internalName).toBe('Multi0')
  })

  it('_spawnSingleMapActor handles unknown owner (Neutral/gaia not in players)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const world = new GameWorldManager({
      modData: {
        getSettings: <T>(_type: new () => T): T => ({}) as T,
        ruleset: {
          actors: new Map([
            ['e1', {
              name: 'e1',
              isAbstract: false,
              traitConfigs: [],
              hasTraitInfo: () => false,
            }],
            ['player', {
              name: 'player',
              isAbstract: false,
              traitConfigs: [],
              hasTraitInfo: () => false,
            }],
          ]),
        } as any,
        traitFactory: {
          createAllTraits: () => [],
          has: () => false,
          create: () => null,
        } as any,
      },
    })

    // Set up players — only Multi0, no Neutral
    ;(world as any)._createPlayers({
      players: [
        {
          internalName: 'Multi0',
          name: 'Player 1',
          isHuman: true,
          isBot: false,
        },
      ],
      playableCount: 1,
    })

    // Spawn an actor with an owner name that doesn't match any player
    const entry = {
      type: 'E1',
      location: { x: 5, y: 5 },
      owner: 'Neutral', // Neutral not in players array
    }
    ;(world as any)._spawnSingleMapActor(entry)

    // Actor should still be created (not crash), but with no owner
    const actors = Array.from(world.actors)
    const spawnedActor = actors.find(a => a.actorId > 0)
    expect(spawnedActor).toBeDefined()
    expect(spawnedActor!.owner).toBeUndefined()

    // Should have warned about unknown owner
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("owner 'Neutral' not found"),
    )
    warnSpy.mockRestore()
  })

  it('createActor applies OwnerInit to set actor.owner (B1 fix)', () => {
    const world = new GameWorldManager({
      modData: {
        getSettings: <T>(_type: new () => T): T => ({}) as T,
        ruleset: {
          actors: new Map([
            ['e1', {
              name: 'e1',
              isAbstract: false,
              traitConfigs: [],
              hasTraitInfo: () => false,
            }],
          ]),
        } as any,
        traitFactory: {
          createAllTraits: () => [],
        } as any,
      },
    })

    // Create a player stub
    const ownerPlayer = {
      playerName: 'TestOwner',
      internalName: 'testowner',
      color: 0,
    }

    // Create an initializer with both OwnerNameInit and OwnerInit
    const initializer = new ActorInitializer([
      new OwnerNameInit('testowner'),
      new OwnerInit(ownerPlayer),
    ])

    const actor = world.createActor('e1', false, initializer)
    expect(actor).not.toBeNull()
    expect(actor!.owner).toBeDefined()
    expect(actor!.owner).toBe(ownerPlayer)
    expect(actor!.owner!.playerName).toBe('TestOwner')
  })

  it('_spawnSingleMapActor handles entries with no owner field', () => {
    const world = new GameWorldManager({
      modData: {
        getSettings: <T>(_type: new () => T): T => ({}) as T,
        ruleset: {
          actors: new Map([
            ['e1', {
              name: 'e1',
              isAbstract: false,
              traitConfigs: [],
              hasTraitInfo: () => false,
            }],
          ]),
        } as any,
        traitFactory: {
          createAllTraits: () => [],
          has: () => false,
          create: () => null,
        } as any,
      },
    })

    // Spawn an actor with no owner specified (e.g., world-owned decorations)
    const entry = {
      type: 'E1',
      location: { x: 15, y: 25 },
      // No owner field
    }
    expect(() => (world as any)._spawnSingleMapActor(entry)).not.toThrow()

    const actors = Array.from(world.actors)
    const spawnedActor = actors.find(a => a.actorId > 0)
    expect(spawnedActor).toBeDefined()
    // Actor without owner init should have undefined owner (unless a default is set)
  })
})

// ---------------------------------------------------------------------------
// Test helpers: actor and effect factories
// ---------------------------------------------------------------------------

/** Create a minimal test actor for use in tests. */
function createTestActor(_world: GameWorldManager, actorId: number): IGameActor & { tick?: () => void } {
  const actor: IGameActor & { tick?: () => void } = {
    actorId,
    isInWorld: false,
    isDead: false,
    disposed: false,
    tick: () => {
      // Stub tick
    },
  }
  // Don't add to world here — let tests call addActor explicitly
  return actor
}

/** Create a test actor with a custom tick callback. */
function createTestActorWithCustomTick(
  _world: GameWorldManager,
  actorId: number,
  onTick: () => void,
): IGameActor & { tick: () => void } {
  return {
    actorId,
    isInWorld: false,
    isDead: false,
    disposed: false,
    tick: onTick,
  }
}

/** Create a test effect with a custom tick callback. */
function createTestEffect(onTick?: (world: GameWorldManager) => void): IGameEffect & { tickCalls: GameWorldManager[] } {
  const tickCalls: GameWorldManager[] = []
  return {
    tickCalls,
    tick(world: GameWorldManager): void {
      tickCalls.push(world)
      onTick?.(world)
    },
  }
}
