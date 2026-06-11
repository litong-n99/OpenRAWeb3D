/**
 * World.ts — GameWorldManager: root container for game simulation + render
 * OpenRA 对照: OpenRA.Game/World.cs
 *
 * 核心范式转换:
 * - C# World class (650 lines, game simulation container) → TypeScript
 *   GameWorldManager wrapping BABYLON.Scene for render integration
 * - C# Actor concrete type → IGameActor forward interface (Phase D
 *   GameActor will implement it; co-created with World)
 * - C# Queue<Action<World>> for frameEndActions → simple FIFO array
 * - C# SortedDictionary<uint, Actor> → Map<number, IGameActor> (insertion
 *   order OK for Tick; sorted cache for SyncHash)
 * - C# IEffect.Tick(World) → IGameEffect.tick(world: GameWorldManager)
 *   (IGameEffect is defined in Effects/IEffect.ts — single source of truth)
 * - C# Tick() called by Game loop at 25 TPS → fixed timestep accumulator
 *   driven by requestAnimationFrame, capped at 5 ticks/frame
 * - C# TickRender() called by WorldRenderer.Draw() → hooks into
 *   BABYLON.Scene.onBeforeRenderObservable
 * - C# Action<World> delegate for frameEndActions → () => void closure
 *   (GameWorldManager instance captured in closure scope)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { Engine, Scene } from '@babylonjs/core'
import { TraitDictionary, type TraitPair } from './TraitDictionary.js'
import { Component } from './Traits/TraitsInterfaces.js'
import type {
  IGameActor,
  ITick,
  ITickRender,
  INotifyAddedToWorld,
  INotifyRemovedFromWorld,
  INotifyActorDisposing,
  IWorldLoaded,
  IPostWorldLoaded,
  INotifyGameLoading,
  INotifyGameLoaded,
  IGameOver,
  PlayerStub,
  WorldRendererStub,
  WorldStub,
  ActivityStub,
  ActorInfoStub,
} from './Traits/TraitsInterfaces.js'
import type { IGameEffect, IGameEffectSync } from './Effects/IEffect.js'

// ---------------------------------------------------------------------------
// WorldType enum (对应 OpenRA WorldType)
// ---------------------------------------------------------------------------

/**
 * Type of game world.
 *
 * OpenRA 对照: WorldType enum
 */
export const WorldType = {
  Regular: 'Regular',
  Shellmap: 'Shellmap',
  Editor: 'Editor',
} as const

export type WorldType = (typeof WorldType)[keyof typeof WorldType]

// ---------------------------------------------------------------------------
// Forward stubs for unmigrated types
// ---------------------------------------------------------------------------

/**
 * GameSettings stub — provides PauseShellmap flag.
 *
 * OpenRA 对照: OpenRA.Settings/GameSettings.cs
 * TODO-3.F: Replace with full GameSettings when settings module is migrated.
 */
export interface GameSettingsStub {
  /** Whether to pause the shellmap when the settings menu is open. */
  readonly pauseShellmap?: boolean
}

/**
 * ModData stub — provides settings access.
 *
 * OpenRA 对照: OpenRA.Game/ModData.cs
 * TODO-3.F: Replace with full ModData when mod system is migrated.
 */
export interface ModDataStub {
  getSettings<T>(settingsType: new () => T): T
}

/**
 * OrderManager stub — provides lobby info and order issuing.
 *
 * OpenRA 对照: OpenRA.Network/OrderManager.cs
 * TODO-3.H: Replace with full OrderManager when networking is migrated.
 */
export interface OrderManagerStub {
  readonly lobbyInfo: SessionStub
  readonly netFrameNumber: number
  issueOrder(order: OrderStub): void
  dispose?(): void
}

/**
 * Session stub — provides lobby configuration.
 *
 * OpenRA 对照: OpenRA.Network/Session.cs
 */
export interface SessionStub {
  readonly globalSettings: {
    readonly randomSeed: number
    optionOrDefault(key: string, defaultValue: string): string
  }
  readonly disabledSpawnPoints: number[]
}

/**
 * GameSpeed stub — provides tick rate.
 *
 * OpenRA 对照: OpenRA.Game/GameSpeed.cs
 */
export interface GameSpeedStub {
  readonly timestep: number
}

/**
 * Order stub — a player-issued command.
 *
 * OpenRA 对照: OpenRA.Orders/Order.cs
 */
export interface OrderStub {
  readonly orderName: string
  readonly targetString: string
  readonly extraData: number
}

/**
 * Map stub — provides map metadata.
 *
 * OpenRA 对照: OpenRA.Game/Map/Map.cs
 * TODO-3.I: Replace with full Map when map module is migrated.
 */
export interface MapStub {
  readonly uid: string
  readonly title: string
  dispose(): void
}

/**
 * MersenneTwister stub — pseudo-random number generator.
 *
 * OpenRA 对照: OpenRA.Support/MersenneTwister.cs
 */
export interface MersenneTwisterStub {
  next(): number
  readonly last: number
}

/**
 * ScreenMap stub — spatial index for screen-space queries.
 *
 * OpenRA 对照: OpenRA.Game/ScreenMap.cs
 * TODO-3.I: Replace with full ScreenMap when spatial index is migrated.
 */
export interface ScreenMapStub {
  worldLoaded(world: GameWorldManager, wr: WorldRendererStub): void
  tickRender(): void
}

/**
 * ActorMap stub — spatial index for actor positions.
 *
 * OpenRA 对照: OpenRA.Game/IActorMap.cs
 * TODO-3.I: Replace with full IActorMap when spatial index is migrated.
 */
export interface ActorMapStub {
  // Minimal stub — methods added incrementally as spatial queries are migrated
}

/**
 * Selection stub — selected actor tracking.
 *
 * OpenRA 对照: OpenRA.Game/ISelection.cs
 * TODO-3.E: Replace with full ISelection implementation.
 */
export interface SelectionStub {
  // Minimal stub — methods added incrementally
}

/**
 * ControlGroups stub — control group management.
 *
 * OpenRA 对照: OpenRA.Game/IControlGroups.cs
 * TODO-3.E: Replace with full IControlGroups implementation.
 */
export interface ControlGroupsStub {
  // Minimal stub — methods added incrementally
}

/**
 * OrderGenerator stub — generates orders from player input.
 *
 * OpenRA 对照: OpenRA.Orders/IOrderGenerator.cs
 * TODO-3.D: Replace with full IOrderGenerator when Orders module is migrated.
 */
export interface OrderGeneratorStub {
  deactivate?(): void
}

/**
 * IValidateOrder stub.
 *
 * OpenRA 对照: OpenRA.Traits/IValidateOrder.cs
 */
export interface ValidateOrderStub {
  orderValidation(
    orderManager: OrderManagerStub,
    world: GameWorldManager,
    clientId: number,
    order: OrderStub,
  ): boolean
}

/**
 * INotifyPlayerDisconnected stub.
 *
 * OpenRA 对照: OpenRA.Traits/INotifyPlayerDisconnected.cs
 */
export interface NotifyPlayerDisconnectedStub {
  playerDisconnected(actor: IGameActor, player: PlayerStub): void
}

/**
 * GameInformation stub — tracks game metadata for replays.
 *
 * OpenRA 对照: OpenRA.Game/GameInformation.cs
 */
export interface GameInformationStub {
  readonly mod: string
  readonly version: string
  readonly mapUid: string
  readonly mapTitle: string
  readonly startTimeUtc: Date
  readonly finalGameTick?: number
  players: GameInformationPlayerStub[]
  disabledSpawnPoints: readonly number[]
}

/** Player entry in GameInformation. */
export interface GameInformationPlayerStub {
  playerName: string
  outcome?: string
  outcomeTimestampUtc?: Date
  disconnectFrame?: number
}

// ---------------------------------------------------------------------------
// StubActor — minimal IGameActor for WorldActor and pre-Phase-D actors
// ---------------------------------------------------------------------------

/**
 * Minimal actor implementation used by GameWorldManager before Phase D
 * GameActor is implemented.
 *
 * OpenRA 对照: OpenRA.Game/Actor.cs (subset)
 *
 * This class provides the minimum required by GameWorldManager:
 * - actorId assignment
 * - isInWorld state
 * - tick() method (Activity.TickOuter stub)
 * - TraitDictionary integration
 *
 * NOTE: When Phase D GameActor is completed, it will replace StubActor.
 * StubActor exists so World.ts can be implemented and tested without
 * waiting for the full Actor class.
 */
class StubActor implements IGameActor {
  actorId: number
  isInWorld: boolean = false
  isDead: boolean = false
  disposed: boolean = false
  owner: PlayerStub | undefined = undefined
  world: WorldStub | undefined = undefined
  info: ActorInfoStub | undefined = undefined
  willDispose: boolean = false
  generation: number = 0

  constructor(actorId: number) {
    this.actorId = actorId
  }

  get isIdle(): boolean {
    return true // StubActor has no activity; always idle
  }

  // -----------------------------------------------------------------------
  // Condition system stubs (Phase D)
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  grantCondition(_condition: string): number {
    return -1 // InvalidConditionToken — conditions not supported on StubActor
  }

  /** @inheritdoc */
  revokeCondition(_token: number): number {
    return -1
  }

  /** @inheritdoc */
  hasCondition(_condition: string): boolean {
    return false
  }

  /** @inheritdoc */
  tokenValid(_token: number): boolean {
    return false
  }

  // -----------------------------------------------------------------------
  // Activity system stubs (Phase D stubs, Phase E full impl)
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  queueActivity(_nextActivity: ActivityStub): void {
    // TODO-3.E: Full Activity chain implementation
  }

  /** @inheritdoc */
  cancelActivity(): void {
    // TODO-3.E: Full Activity cancellation
  }

  // -----------------------------------------------------------------------
  // Tick (existing)
  // -----------------------------------------------------------------------

  /**
   * Called by World.Tick() for each actor.
   *
   * OpenRA 对照: Actor.Tick() → currentActivity.TickOuter(self)
   *
   * NOTE: Activity.TickOuter is Phase E. Currently a stub that will be
   * replaced when the Activity system is migrated.
   */
  tick(): void {
    // TODO-3.E: Call currentActivity.TickOuter(this) when Activity system
    // is migrated.
  }
}

// ---------------------------------------------------------------------------
// Stub trait Components for WorldActor
// ---------------------------------------------------------------------------

/**
 * Stub ScreenMap component registered as a trait on WorldActor.
 */
class StubScreenMapComponent extends Component implements ScreenMapStub {
  static readonly interfaces = ['ScreenMap', 'IWorldLoaded', 'component']

  worldLoaded(_world: GameWorldManager, _wr: WorldRendererStub): void {
    // TODO-3.I: Full ScreenMap.WorldLoaded implementation
  }

  tickRender(): void {
    // TODO-3.I: Full ScreenMap.TickRender implementation
  }
}

/**
 * Stub ActorMap component registered as a trait on WorldActor.
 */
class StubActorMapComponent extends Component implements ActorMapStub {
  static readonly interfaces = ['IActorMap', 'component']
}

/**
 * Stub Selection component registered as a trait on WorldActor.
 */
class StubSelectionComponent extends Component implements SelectionStub {
  static readonly interfaces = ['ISelection', 'component']
}

/**
 * Stub ControlGroups component registered as a trait on WorldActor.
 */
class StubControlGroupsComponent extends Component implements ControlGroupsStub {
  static readonly interfaces = ['IControlGroups', 'component']
}

// ---------------------------------------------------------------------------
// WorldActorResult — returned by createWorldActor()
// ---------------------------------------------------------------------------

/**
 * Bundles the WorldActor with its registered trait instances.
 */
interface WorldActorResult {
  actor: IGameActor
  screenMap: ScreenMapStub
  actorMap: ActorMapStub
  selection: SelectionStub
  controlGroups: ControlGroupsStub
}

// ---------------------------------------------------------------------------
// GameWorldManagerOptions
// ---------------------------------------------------------------------------

/**
 * Constructor options for GameWorldManager.
 *
 * All properties are optional — the game loop can be started without
 * full game state. Stubs and defaults are provided for missing values.
 */
export interface GameWorldManagerOptions {
  /** World type (Regular, Shellmap, Editor). Default: Regular. */
  type?: WorldType

  /** Logic tick timestep in milliseconds. Default: 40 (25 TPS). */
  timestep?: number

  /** ModData for settings access. */
  modData?: ModDataStub

  /** OrderManager for networking. */
  orderManager?: OrderManagerStub

  /** Map data. */
  map?: MapStub

  /** Game settings (pause shellmap, etc.). */
  gameSettings?: GameSettingsStub

  /** Game speed configuration. */
  gameSpeed?: GameSpeedStub
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default tick rate: 25 ticks per second = 40ms per tick.
 *
 * OpenRA 对照: GameSpeed.Timestep default
 */
const DEFAULT_TIMESTEP = 40

/** Maximum logic ticks per render frame to prevent spiral of death.
 *
 * OpenRA 对照: implicit in engine loop design (no hard cap in OpenRA;
 * this is a migration addition for robustness)
 */
const MAX_TICKS_PER_FRAME = 5

// ---------------------------------------------------------------------------
// IGameWorld — minimal interface for pathfinding (avoids circular imports)
// ---------------------------------------------------------------------------

/**
 * Minimal world interface for pathfinding operations.
 *
 * OpenRA 对照: World (subset)
 *
 * STUB: This is a minimal interface for Phase G pathfinding.
 * Full GameWorldManager implements this interface implicitly.
 */
export interface IGameWorld {
  /** The game world tick counter. */
  readonly worldTick: number
  /** Whether the game is paused. */
  readonly paused: boolean
}

// ---------------------------------------------------------------------------
// GameWorldManager
// ---------------------------------------------------------------------------

/**
 * Root container for the entire game simulation.
 *
 * OpenRA 对照: World class
 *
 * GameWorldManager owns:
 * - The actor map (all actors in the world)
 * - The trait dictionary (centralized trait storage/query)
 * - Active visual effects
 * - Frame-end deferred task queue
 * - Tick state (paused, worldTick counter)
 * - Player references (local, render, all players)
 *
 * The game loop is driven by a fixed-timestep accumulator using
 * requestAnimationFrame. Logic ticks at a fixed rate (25 TPS default)
 * while rendering ticks at display refresh rate.
 *
 * Usage:
 * ```
 * const world = new GameWorldManager({ type: WorldType.Regular })
 * world.startLoop(engine, scene, worldRenderer)
 * ```
 */
export class GameWorldManager {
  // -----------------------------------------------------------------------
  // Static
  // -----------------------------------------------------------------------

  /** Next available actor ID.
   *
   * OpenRA 对照: World.nextAID
   */
  private nextActorId = 0

  // -----------------------------------------------------------------------
  // Public properties (readonly / read-write)
  // -----------------------------------------------------------------------

  /** Centralized trait storage and query system.
   *
   * OpenRA 对照: World.TraitDict
   */
  readonly traitDict = new TraitDictionary()

  /** All actors in the world, indexed by actorId.
   *
   * OpenRA 对照: World.actors (SortedDictionary<uint, Actor>)
   *
   * Map preserves insertion order which is acceptable for Tick() iteration.
   * For SyncHash deterministic ordering, a sorted cache is built on demand.
   */
  private readonly _actors = new Map<number, IGameActor>()

  /** Active visual effects, ticked each logic tick.
   *
   * OpenRA 对照: World.effects (List<IEffect>)
   */
  private readonly _effects: IGameEffect[] = []

  /** Effects that are sync-relevant (for SyncHash).
   *
   * OpenRA 对照: World.syncedEffects (List<ISync>)
   */
  private readonly _syncedEffects: IGameEffectSync[] = []

  /** Deferred tasks executed at the end of every tick.
   *
   * OpenRA 对照: World.frameEndActions (Queue<Action<World>>)
   *
   * OpenRA uses `Action<World>` which receives the World as parameter.
   * In TypeScript, callbacks capture GameWorldManager via closure so
   * the parameter is not needed. Tasks are simple `() => void`.
   *
   * CRITICAL (Reviewer B1): frameEndActions MUST drain EVERY tick,
   * including when paused. This matches OpenRA L453-454 which is
   * outside the pause block.
   */
  private readonly _frameEndActions: Array<() => void> = []

  /** World type: Regular, Shellmap, or Editor.
   *
   * OpenRA 对照: World.Type
   */
  readonly type: WorldType

  /** Logic tick timestep in milliseconds.
   *
   * OpenRA 对照: World.Timestep
   */
  readonly timestep: number

  /** Replay timestep (may differ from timestep during replays).
   *
   * OpenRA 对照: World.ReplayTimestep
   */
  replayTimestep: number

  /** ModData for settings and mod access.
   *
   * OpenRA 对照: World.modData
   */
  readonly modData: ModDataStub | undefined

  /** OrderManager for networking.
   *
   * OpenRA 对照: World.OrderManager
   */
  readonly orderManager: OrderManagerStub | undefined

  /** Map data.
   *
   * OpenRA 对照: World.Map
   */
  readonly map: MapStub | undefined

  /** Game settings.
   *
   * OpenRA 对照: World.gameSettings
   */
  readonly gameSettings: GameSettingsStub | undefined

  /** Game speed.
   *
   * OpenRA 对照: World.GameSpeed
   */
  readonly gameSpeed: GameSpeedStub | undefined

  /** All players in the game.
   *
   * OpenRA 对照: World.Players
   */
  players: PlayerStub[] = []

  /** The local player (this client's player).
   *
   * OpenRA 对照: World.LocalPlayer
   */
  localPlayer: PlayerStub | undefined

  /** The player whose perspective is rendered.
   *
   * OpenRA 对照: World.RenderPlayer
   */
  private _renderPlayer: PlayerStub | undefined

  /** The special WorldActor holding global system traits.
   *
   * OpenRA 对照: World.WorldActor
   *
   * Created during construction. Holds IActorMap, ScreenMap, ISelection,
   * IControlGroups, and other global traits as TraitDictionary entries.
   */
  readonly worldActor: IGameActor

  /** ScreenMap trait (retrieved from WorldActor).
   *
   * OpenRA 对照: World.ScreenMap
   */
  readonly screenMap: ScreenMapStub

  /** ActorMap trait (retrieved from WorldActor).
   *
   * OpenRA 对照: World.ActorMap
   */
  readonly actorMap: ActorMapStub

  /** Selection trait (retrieved from WorldActor).
   *
   * OpenRA 对照: World.Selection
   */
  readonly selection: SelectionStub

  /** ControlGroups trait (retrieved from WorldActor).
   *
   * OpenRA 对照: World.ControlGroups
   */
  readonly controlGroups: ControlGroupsStub

  /** Order validators (retrieved from WorldActor).
   *
   * OpenRA 对照: World.OrderValidators
   */
  readonly orderValidators: readonly ValidateOrderStub[] = []

  /** Notify player disconnected handlers (retrieved from WorldActor).
   *
   * OpenRA 对照: World.notifyDisconnected
   */
  readonly notifyDisconnected: readonly NotifyPlayerDisconnectedStub[] = []

  /** Current logic tick counter.
   *
   * OpenRA 对照: World.WorldTick
   */
  private _worldTick = 0

  /** Whether the game is paused.
   *
   * OpenRA 对照: World.Paused
   */
  private _paused = false

  /** Predicted pause state (for network latency compensation).
   *
   * OpenRA 对照: World.PredictedPaused
   */
  predictedPaused = false

  /** Whether the game has ended.
   *
   * OpenRA 对照: World.IsGameOver
   */
  isGameOver = false

  /** Whether the world is being disposed.
   *
   * OpenRA 对照: World.Disposing
   */
  disposing = false

  /** Whether this is a replay.
   *
   * OpenRA 对照: World.IsReplay
   */
  get isReplay(): boolean {
    return this.orderManager != null && 'isReplayConnection' in this.orderManager
      ? (this.orderManager as unknown as { isReplayConnection: boolean }).isReplayConnection
      : false
  }

  /** Whether the game save is still loading.
   *
   * OpenRA 对照: World.IsLoadingGameSave
   */
  get isLoadingGameSave(): boolean {
    if (!this.orderManager) return false
    const om = this.orderManager
    // GameSaveLastFrame may not exist on stub
    const lastFrame = (om as unknown as { gameSaveLastFrame?: number }).gameSaveLastFrame
    if (lastFrame === undefined) return false
    return om.netFrameNumber <= lastFrame
  }

  /** Game save loading percentage (0-100).
   *
   * OpenRA 对照: World.GameSaveLoadingPercentage
   */
  get gameSaveLoadingPercentage(): number {
    if (!this.orderManager) return 0
    const om = this.orderManager
    const lastFrame = (om as unknown as { gameSaveLastFrame?: number }).gameSaveLastFrame
    if (!lastFrame || lastFrame === 0) return 0
    return (om.netFrameNumber * 100) / lastFrame
  }

  /** Current order generator (controls input mode).
   *
   * OpenRA 对照: World.OrderGenerator
   */
  private _orderGenerator: OrderGeneratorStub | undefined

  /** Whether rules contain a temporary blocker actor.
   *
   * OpenRA 对照: World.RulesContainTemporaryBlocker
   */
  readonly rulesContainTemporaryBlocker = false

  /** Event fired when the render player changes.
   *
   * OpenRA 对照: World.RenderPlayerChanged event
   */
  renderPlayerChanged: ((player: PlayerStub) => void) | null = null

  /** Event fired when the game is over.
   *
   * OpenRA 对照: World.GameOver event
   */
  gameOver: (() => void) | null = null

  /** Event fired when an actor is added.
   *
   * OpenRA 对照: World.ActorAdded event
   */
  actorAdded: ((actor: IGameActor) => void) | null = null

  /** Event fired when an actor is removed.
   *
   * OpenRA 对照: World.ActorRemoved event
   */
  actorRemoved: ((actor: IGameActor) => void) | null = null

  /** Game information for replay metadata.
   *
   * OpenRA 对照: World.gameInfo
   */
  gameInfo: GameInformationStub | null = null

  /** Whether the world was loading a game save.
   *
   * OpenRA 对照: World.wasLoadingGameSave
   */
  private wasLoadingGameSave = false

  /** Game save trait data (index → MiniYaml) for save restoration.
   *
   * OpenRA 对照: World.gameSaveTraitData
   */
  private readonly gameSaveTraitData = new Map<number, unknown>()

  /** rAF handle for the game loop, null if not running.
   *
   * NOTE: OpenRA does not have this concept (SDL2 event loop is external).
   */
  private _loopHandle: number | null = null

  /** WorldRenderer reference for TickRender, set by startLoop().
   *
   * NOTE: OpenRA passes WorldRenderer to TickRender from WorldRenderer.Draw().
   */
  private _worldRenderer: WorldRendererStub | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new game world.
   *
   * OpenRA 对照: World(Map, ModData, OrderManager, WorldType)
   *
   * Creates the WorldActor and registers its system traits in the
   * TraitDictionary. All constructor parameters are optional to support
   * incremental construction and testing.
   *
   * @param options — construction options
   */
  constructor(options: GameWorldManagerOptions = {}) {
    this.type = options.type ?? WorldType.Regular
    this.timestep = options.timestep ?? DEFAULT_TIMESTEP
    this.replayTimestep = this.timestep
    this.modData = options.modData
    this.orderManager = options.orderManager
    this.map = options.map
    this.gameSettings = options.gameSettings
    this.gameSpeed = options.gameSpeed

    // Create the WorldActor and its system traits
    const waResult = this.createWorldActor()
    this.worldActor = waResult.actor
    this.screenMap = waResult.screenMap
    this.actorMap = waResult.actorMap
    this.selection = waResult.selection
    this.controlGroups = waResult.controlGroups
  }

  // -----------------------------------------------------------------------
  // Properties (getters matching OpenRA public fields)
  // -----------------------------------------------------------------------

  /** All actors in the world.
   *
   * OpenRA 对照: World.Actors (IEnumerable<Actor>)
   *
   * @returns iterator of all actors in insertion order
   */
  get actors(): Iterable<IGameActor> {
    return this._actors.values()
  }

  /** Current logic tick number.
   *
   * OpenRA 对照: World.WorldTick
   */
  get worldTick(): number {
    return this._worldTick
  }

  /** Whether the game is paused.
   *
   * OpenRA 对照: World.Paused
   */
  get paused(): boolean {
    return this._paused
  }

  /** Render player (whose perspective to render).
   *
   * OpenRA 对照: World.RenderPlayer
   */
  get renderPlayer(): PlayerStub | undefined {
    return this._renderPlayer
  }

  set renderPlayer(value: PlayerStub | undefined) {
    // Guard: only change if local player is null or has unlocked render player
    if (this.localPlayer == null || this.canUnlockRenderPlayer(this.localPlayer)) {
      this._renderPlayer = value
      if (value) {
        this.renderPlayerChanged?.(value)
      }
    }
  }

  /** Current order generator.
   *
   * OpenRA 对照: World.OrderGenerator
   */
  get orderGenerator(): OrderGeneratorStub | undefined {
    return this._orderGenerator
  }

  /** Active effects (read-only snapshot for iteration).
   *
   * OpenRA 对照: World.Effects
   */
  get effects(): readonly IGameEffect[] {
    return this._effects
  }

  /** Sync-relevant effects (read-only snapshot for SyncHash).
   *
   * OpenRA 对照: World.SyncedEffects
   */
  get syncedEffects(): readonly IGameEffectSync[] {
    return this._syncedEffects
  }

  // -----------------------------------------------------------------------
  // Game loop (对应 OpenRA Tick + Game loop)
  // -----------------------------------------------------------------------

  /**
   * Start the fixed-timestep game loop.
   *
   * OpenRA 对照: N/A (OpenRA uses SDL2 event loop + Game.Tick())
   *
   * Uses requestAnimationFrame with an accumulator to call tick() at
   * fixed intervals. tickRender() is called every render frame.
   *
   * Spiral-of-death protection: maximum 5 logic ticks per render frame.
   *
   * @param engine — Babylon.js Engine (for scene.render())
   * @param scene — Babylon.js Scene (rendering target)
   * @param worldRenderer — WorldRenderer for TickRender integration
   * @throws if loop is already running
   */
  startLoop(
    _engine: Engine,
    scene: Scene,
    worldRenderer: WorldRendererStub,
  ): void {
    if (this._loopHandle !== null) {
      throw new Error('GameWorldManager.startLoop: loop is already running')
    }

    // Store scene reference for use in the loop closure
    const capturedScene = scene
    this._worldRenderer = worldRenderer

    let lastTime = performance.now()
    let accumulator = 0

    // Single rAF loop drives both logic ticks and rendering
    const loop = (): void => {
      const now = performance.now()
      let dt = now - lastTime
      lastTime = now

      // Clamp dt to prevent spiral of death from tab-out
      if (dt > 1000) {
        dt = 1000
      }

      accumulator += dt

      // Fixed timestep logic ticks (cap at MAX_TICKS_PER_FRAME)
      let tickCount = 0
      while (accumulator >= this.timestep && tickCount < MAX_TICKS_PER_FRAME) {
        this.tick()
        accumulator -= this.timestep
        tickCount++
      }

      // If we hit the cap, discard remaining accumulated time to
      // prevent spiral of death
      if (tickCount >= MAX_TICKS_PER_FRAME && accumulator >= this.timestep) {
        accumulator = 0
      }

      // Render tick (every frame, regardless of pause)
      try {
        this.tickRender(this._worldRenderer!)
        capturedScene.render()
      } catch {
        // Ignore render errors in production; they should not crash the loop
      }

      this._loopHandle = requestAnimationFrame(loop)
    }

    // Kick off the loop
    this._loopHandle = requestAnimationFrame(loop)
  }

  /**
   * Stop the game loop.
   *
   * Cancels the current requestAnimationFrame callback.
   * Safe to call even if the loop is not running.
   */
  stopLoop(): void {
    if (this._loopHandle !== null) {
      cancelAnimationFrame(this._loopHandle)
      this._loopHandle = null
    }
    this._worldRenderer = null
  }

  /**
   * Execute one logic tick.
   *
   * OpenRA 对照: World.Tick()
   *
   * Tick execution order (MUST match OpenRA exactly):
   *
   * IF not paused (and shellmap pause rules allow):
   *   1. Increment worldTick
   *   2. Execute actor.Tick() for all actors (Activity.TickOuter)
   *   3. Execute ITick.tick() for all actors via TraitDictionary
   *   4. Execute IGameEffect.tick() for all active effects
   *
   * ALWAYS (even when paused):
   *   5. Process frameEndActions queue (FIFO drain)
   *
   * Note: SyncHash is NOT called from tick(). It is called separately
   * by the networking layer (OrderManager). This matches OpenRA behavior
   * where SyncHash is called from OrderManager.Tick(), not World.Tick().
   *
   * The first tick always executes (WorldTick == 0) to allow traits
   * to initialize important state.
   */
  tick(): void {
    // Handle game save loading completion
    if (this.wasLoadingGameSave && !this.isLoadingGameSave) {
      this.completeGameSaveLoad()
    }

    // Pause logic: always tick at least once (WorldTick 0) for initialization
    // Shellmap pause: if gameSettings.pauseShellmap is false, always tick shellmap
    const shouldTick =
      !this._paused &&
      (this.type !== WorldType.Shellmap ||
       !this.gameSettings?.pauseShellmap ||
       this._worldTick === 0)

    if (shouldTick) {
      this._worldTick++

      // Step 2: Execute actor.Tick() (Activity.TickOuter)
      // OpenRA: using (new PerfSample("tick_actors"))
      //   foreach (var a in actors.Values) a.Tick();
      for (const a of this._actors.values()) {
        // Call tick() on actors that have it (StubActor / GameActor)
        const actorWithTick = a as IGameActor & { tick?: () => void }
        actorWithTick.tick?.()
      }

      // Step 3: Execute ITick.tick() for all actors
      // OpenRA: ApplyToActorsWithTraitTimed<ITick>(
      //   (actor, trait) => trait.Tick(actor), "Trait")
      this.traitDict.applyToActorsWithTraitTimed<ITick & Component>(
        'ITick',
        (actor, trait) => trait.tick(actor),
        'Trait',
      )

      // Step 4: Execute IGameEffect.tick() for all active effects
      // OpenRA: effects.DoTimed(e => e.Tick(this), "Effect")
      for (const effect of this._effects) {
        effect.tick(this)
      }
    }

    // Step 5: ALWAYS drain frameEndActions (even when paused)
    // CRITICAL (Reviewer B1): This matches OpenRA L453-454 which is
    // outside the pause condition block.
    // OpenRA: while (frameEndActions.Count != 0)
    //   frameEndActions.Dequeue()(this);
    while (this._frameEndActions.length > 0) {
      const action = this._frameEndActions.shift()!
      action()
    }
  }

  /**
   * Execute one render tick (called every render frame).
   *
   * OpenRA 对照: World.TickRender(WorldRenderer)
   *
   * Call order:
   * 1. Execute ITickRender.tickRender() for all actors via TraitDictionary
   * 2. Execute ScreenMap.TickRender()
   *
   * @param wr — the world renderer
   */
  tickRender(wr: WorldRendererStub): void {
    // Step 1: Execute ITickRender.tickRender() for all actors
    // OpenRA: ApplyToActorsWithTraitTimed<ITickRender>(
    //   (actor, trait) => trait.TickRender(wr, actor), "Render")
    this.traitDict.applyToActorsWithTraitTimed<ITickRender & Component>(
      'ITickRender',
      (actor, trait) => trait.tickRender(wr, actor),
      'Render',
    )

    // Step 2: ScreenMap.TickRender()
    this.screenMap.tickRender()
  }

  // -----------------------------------------------------------------------
  // Actor lifecycle (对应 OpenRA Add/Remove/CreateActor)
  // -----------------------------------------------------------------------

  /**
   * Allocate the next actor ID.
   *
   * OpenRA 对照: World.NextAID()
   */
  private nextAID(): number {
    return this.nextActorId++
  }

  /**
   * Create the special WorldActor with system traits.
   *
   * OpenRA 对照: World constructor → CreateActor(SystemActors.World, [])
   *
   * The WorldActor holds global traits: IActorMap, ScreenMap, ISelection,
   * IControlGroups, IValidateOrder[], INotifyPlayerDisconnected[].
   */
  private createWorldActor(): WorldActorResult {
    const wa = new StubActor(this.nextAID())

    // Register system trait stubs in the TraitDictionary
    const screenMap = new StubScreenMapComponent()
    screenMap.attach(wa)
    this.traitDict.addTrait(wa, screenMap)

    const actorMap = new StubActorMapComponent()
    actorMap.attach(wa)
    this.traitDict.addTrait(wa, actorMap)

    const selection = new StubSelectionComponent()
    selection.attach(wa)
    this.traitDict.addTrait(wa, selection)

    const controlGroups = new StubControlGroupsComponent()
    controlGroups.attach(wa)
    this.traitDict.addTrait(wa, controlGroups)

    // Mark as in-world and add to actors map (WorldActor is always in the world)
    // OpenRA: CreateActor(worldActorType, []) calls World.Add(this) via
    // Initialize(addToWorld=true) → World.Add(this)
    wa.isInWorld = true
    this._actors.set(wa.actorId, wa)

    return { actor: wa, screenMap, actorMap, selection, controlGroups }
  }

  /**
   * Add an actor to the world.
   *
   * OpenRA 对照: World.Add(Actor)
   *
   * Sets IsInWorld = true, adds to the actors map, fires the ActorAdded
   * event, and notifies all INotifyAddedToWorld traits on the actor.
   *
   * CAUTION: This does NOT add the actor's traits to the TraitDictionary.
   * TraitDictionary registration happens during actor construction
   * (GameActor.initialize / StubActor setup). Callers must ensure traits
   * are registered before calling addActor.
   *
   * @param actor — the actor to add
   */
  addActor(actor: IGameActor): void {
    if ((actor as { isInWorld?: boolean }).isInWorld === true) {
      // Actor is already in the world — silently skip (matching OpenRA
      // behavior where double-add would corrupt the SortedDictionary)
      return
    }

    ;(actor as { isInWorld: boolean }).isInWorld = true
    this._actors.set(actor.actorId, actor)
    this.actorAdded?.(actor)

    // Notify all INotifyAddedToWorld traits
    const addedTraits = this.traitDict.traitsImplementing<INotifyAddedToWorld & Component>(
      actor,
      'INotifyAddedToWorld',
    )
    for (const t of addedTraits) {
      t.addedToWorld(actor)
    }
  }

  /**
   * Remove an actor from the world.
   *
   * OpenRA 对照: World.Remove(Actor)
   *
   * Sets IsInWorld = false, removes from the actors map, fires the
   * ActorRemoved event, and notifies all INotifyRemovedFromWorld traits.
   *
   * Actual disposal of the actor is NOT done here — it should be
   * deferred to a frameEndAction to avoid modifying collections
   * during tick iteration.
   *
   * @param actor — the actor to remove
   */
  removeActor(actor: IGameActor): void {
    if ((actor as { isInWorld?: boolean }).isInWorld === false) {
      // Actor is already out of the world — silently skip
      return
    }

    ;(actor as { isInWorld: boolean }).isInWorld = false
    this._actors.delete(actor.actorId)
    this.actorRemoved?.(actor)

    // Notify all INotifyRemovedFromWorld traits
    const removedTraits = this.traitDict.traitsImplementing<INotifyRemovedFromWorld & Component>(
      actor,
      'INotifyRemovedFromWorld',
    )
    for (const t of removedTraits) {
      t.removedFromWorld(actor)
    }
  }

  /**
   * Look up an actor by its unique ID.
   *
   * OpenRA 对照: World.GetActorById(uint)
   *
   * @param actorId — the actor ID to look up
   * @returns the actor, or undefined if not found
   */
  getActorById(actorId: number): IGameActor | undefined {
    return this._actors.get(actorId)
  }

  /**
   * Create a new actor (stub implementation).
   *
   * OpenRA 对照: World.CreateActor(string, TypeDictionary) AND
   *             World.CreateActor(bool, string, TypeDictionary)
   *
   * NOTE: This is a simplified stub. The full CreateActor involves:
   * 1. Instantiating ActorInfo from YAML
   * 2. Creating trait instances via the object creator
   * 3. Calling Actor.Initialize(addToWorld) which attaches traits
   *    to TraitDictionary and calls INotifyCreated.traits
   * 4. Optionally calling Add() to add to world
   *
   * TODO-3.D: Integrate with GameActor when Phase D is complete.
   *
   * @param name — actor type name (e.g., "world", "e1")
   * @param addToWorld — whether to add to world immediately (default true)
   * @returns the created actor stub
   */
  createActor(_name: string, addToWorld: boolean = true): IGameActor {
    // Create a stub actor — Phase D will replace with full GameActor
    const actor = new StubActor(this.nextAID())

    // NOTE: Full trait initialization from ActorInfo YAML goes here
    // (Phase D + ActorConfig integration)

    if (addToWorld) {
      this.addActor(actor)
    }

    return actor
  }

  // -----------------------------------------------------------------------
  // Effect lifecycle (对应 OpenRA Add/Remove Effect)
  // -----------------------------------------------------------------------

  /**
   * Add a visual effect to the world.
   *
   * OpenRA 对照: World.Add(IEffect)
   *
   * @param effect — the effect to add
   */
  addEffect(effect: IGameEffect): void {
    this._effects.push(effect)

    if (this.isEffectSync(effect)) {
      this._syncedEffects.push(effect)
    }
  }

  /**
   * Remove a visual effect from the world.
   *
   * OpenRA 对照: World.Remove(IEffect)
   *
   * @param effect — the effect to remove
   */
  removeEffect(effect: IGameEffect): void {
    const idx = this._effects.indexOf(effect)
    if (idx !== -1) {
      this._effects.splice(idx, 1)
    }

    if (this.isEffectSync(effect)) {
      const syncIdx = this._syncedEffects.indexOf(effect)
      if (syncIdx !== -1) {
        this._syncedEffects.splice(syncIdx, 1)
      }
    }
  }

  /**
   * Remove all effects matching a predicate.
   *
   * OpenRA 对照: World.RemoveAll(Predicate<IEffect>)
   *
   * @param predicate — function returning true for effects to remove
   */
  removeAllEffects(predicate: (effect: IGameEffect) => boolean): void {
    // Remove from effects list
    for (let i = this._effects.length - 1; i >= 0; i--) {
      if (predicate(this._effects[i])) {
        this._effects.splice(i, 1)
      }
    }

    // Remove from synced effects list
    for (let i = this._syncedEffects.length - 1; i >= 0; i--) {
      if (predicate(this._syncedEffects[i])) {
        this._syncedEffects.splice(i, 1)
      }
    }
  }

  /** Type guard for IGameEffectSync. */
  private isEffectSync(_effect: IGameEffect): _effect is IGameEffectSync {
    // IGameEffectSync is a marker interface — effects that want to
    // participate in SyncHash should explicitly implement it.
    // For now, check via duck-typing: if it has no extra methods
    // beyond tick(), it's potentially sync. Full implementation
    // will use instanceof or a marker property.
    return false // Default: no effects are sync-relevant unless explicitly marked
  }

  // -----------------------------------------------------------------------
  // Frame end actions (对应 OpenRA AddFrameEndTask)
  // -----------------------------------------------------------------------

  /**
   * Schedule a task to run at the end of the current tick.
   *
   * OpenRA 对照: World.AddFrameEndTask(Action<World>)
   *
   * Frame end tasks execute after all ITick and IEffect ticks have
   * completed, but before the next logic tick begins. This is the
   * safe place to dispose actors, spawn new actors, or perform
   * other operations that would corrupt active iterations.
   *
   * In OpenRA, the callback receives `World` as a parameter:
   *   `queue.Enqueue(w => { ... })`.
   * In TypeScript, callbacks capture GameWorldManager via closure:
   *   `world.addFrameEndTask(() => { ... })` — no World parameter needed.
   *
   * @param action — the task to execute at frame end
   */
  addFrameEndTask(action: () => void): void {
    this._frameEndActions.push(action)
  }

  // -----------------------------------------------------------------------
  // Player management (对应 OpenRA SetPlayers/SetLocalPlayer/SetWorldOwner)
  // -----------------------------------------------------------------------

  /**
   * Set the players for this world.
   *
   * OpenRA 对照: World.SetPlayers(IEnumerable<Player>, Player)
   *
   * Players are fixed once set — calling this method again after players
   * have been set will throw.
   *
   * @param players — all players in the game
   * @param localPlayer — the local player (this client)
   * @throws if players have already been set
   */
  setPlayers(players: PlayerStub[], localPlayer: PlayerStub): void {
    if (this.players.length > 0) {
      throw new Error(
        'GameWorldManager.setPlayers: Players are fixed once they have been set.',
      )
    }

    this.players = [...players]
    this.setLocalPlayer(localPlayer)
  }

  /**
   * Set the local player.
   *
   * OpenRA 对照: World.SetLocalPlayer(Player)
   *
   * @param localPlayer — the local player
   * @throws if localPlayer is not in the players array
   */
  private setLocalPlayer(localPlayer: PlayerStub): void {
    if (!localPlayer) return

    if (!this.players.includes(localPlayer)) {
      throw new Error(
        'GameWorldManager.setLocalPlayer: The local player must be one of the players in the world.',
      )
    }

    if (this.isReplay) return

    this.localPlayer = localPlayer
    // Set the render player backing field directly
    this._renderPlayer = localPlayer
  }

  /**
   * Set the owner of the WorldActor.
   *
   * OpenRA 对照: World.SetWorldOwner(Player)
   *
   * @param p — the new owner player
   */
  setWorldOwner(p: PlayerStub): void {
    ;(this.worldActor as { owner?: PlayerStub }).owner = p
  }

  // -----------------------------------------------------------------------
  // Pause state (对应 OpenRA SetPauseState/SetLocalPauseState)
  // -----------------------------------------------------------------------

  /**
   * Set the pause state (networked — sends an order).
   *
   * OpenRA 对照: World.SetPauseState(bool)
   *
   * Does nothing if the game is already over.
   *
   * @param paused — true to pause, false to unpause
   */
  setPauseState(paused: boolean): void {
    if (this.isGameOver) return

    // In OpenRA, this sends an Order to toggle pause.
    // For now, we just update the predicted pause state.
    // TODO-3.H: Send PauseGame order through OrderManager when networking
    // is migrated.
    this.predictedPaused = paused
  }

  /**
   * Set the pause state locally (non-networked, for immediate feedback).
   *
   * OpenRA 对照: World.SetLocalPauseState(bool)
   *
   * Directly sets both Paused and PredictedPaused to the same value.
   *
   * @param paused — true to pause, false to unpause
   */
  setLocalPauseState(paused: boolean): void {
    this._paused = paused
    this.predictedPaused = paused
  }

  // -----------------------------------------------------------------------
  // Game over (对应 OpenRA EndGame)
  // -----------------------------------------------------------------------

  /**
   * End the game.
   *
   * OpenRA 对照: World.EndGame()
   *
   * Pauses the world, sets IsGameOver = true, fires IGameOver traits,
   * records the final tick, and fires the GameOver event.
   */
  endGame(): void {
    if (this.isGameOver) return

    // Use setLocalPauseState so BOTH _paused and predictedPaused are set.
    // setPauseState() only sets predictedPaused (it sends a network order),
    // which would leave _paused = false and allow tick() to continue.
    this.setLocalPauseState(true)
    this.isGameOver = true

    // Notify IGameOver traits on WorldActor
    const gameOverTraits = this.traitDict.traitsImplementing<IGameOver & Component>(
      this.worldActor,
      'IGameOver',
    )
    for (const t of gameOverTraits) {
      t.gameOver(this)
    }

    if (this.gameInfo) {
      this.gameInfo.finalGameTick as number | undefined
      // HACK: TypeScript readonly prevents assignment; this will be
      // updated when GameInformation is fully migrated.
    }

    this.gameOver?.()
  }

  // -----------------------------------------------------------------------
  // World loading (对应 OpenRA LoadComplete/PostLoadComplete)
  // -----------------------------------------------------------------------

  /**
   * Complete world loading.
   *
   * OpenRA 对照: World.LoadComplete(WorldRenderer)
   *
   * Initializes the ScreenMap first, then fires IWorldLoaded on all
   * traits (on WorldActor first, then each player's PlayerActor).
   * Finally populates GameInformation and recording metadata.
   *
   * @param wr — the world renderer
   */
  loadComplete(wr: WorldRendererStub): void {
    // Initialize ScreenMap first (before anything else)
    this.screenMap.worldLoaded(this, wr)

    // Notify IWorldLoaded traits on WorldActor (skip ScreenMap — already done)
    const worldLoadedTraits = this.traitDict.traitsImplementing<IWorldLoaded & Component>(
      this.worldActor,
      'IWorldLoaded',
    )
    for (const t of worldLoadedTraits) {
      // Skip ScreenMap (already called)
      if ((t as unknown) === (this.screenMap as unknown)) continue
      t.worldLoaded(this as unknown as GameWorldManager & WorldStub, wr)
    }

    // Notify IWorldLoaded traits on each player's PlayerActor
    for (const p of this.players) {
      const playerActor = (p as unknown as { playerActor?: IGameActor }).playerActor
      if (!playerActor) continue

      const pTraits = this.traitDict.traitsImplementing<IWorldLoaded & Component>(
        playerActor,
        'IWorldLoaded',
      )
      for (const t of pTraits) {
        t.worldLoaded(this as unknown as GameWorldManager & WorldStub, wr)
      }
    }

    // Set game info metadata
    if (this.gameInfo) {
      this.gameInfo.startTimeUtc as Date
      // HACK: Readonly; will be properly mutable when GameInformation is migrated
    }
  }

  /**
   * Complete post-world-loading initialization.
   *
   * OpenRA 对照: World.PostLoadComplete(WorldRenderer)
   *
   * Fires IPostWorldLoaded on all traits (WorldActor first, then
   * each player's PlayerActor).
   *
   * @param wr — the world renderer
   */
  postLoadComplete(wr: WorldRendererStub): void {
    // Notify IPostWorldLoaded traits on WorldActor
    const postTraits = this.traitDict.traitsImplementing<IPostWorldLoaded & Component>(
      this.worldActor,
      'IPostWorldLoaded',
    )
    for (const t of postTraits) {
      t.postWorldLoaded(this as unknown as GameWorldManager & WorldStub, wr)
    }

    // Notify IPostWorldLoaded traits on each player's PlayerActor
    for (const p of this.players) {
      const playerActor = (p as unknown as { playerActor?: IGameActor }).playerActor
      if (!playerActor) continue

      const pTraits = this.traitDict.traitsImplementing<IPostWorldLoaded & Component>(
        playerActor,
        'IPostWorldLoaded',
      )
      for (const t of pTraits) {
        t.postWorldLoaded(this as unknown as GameWorldManager & WorldStub, wr)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Game save loading (对应 OpenRA Tick game save handling)
  // -----------------------------------------------------------------------

  /**
   * Complete game save loading (called at the end of load).
   *
   * OpenRA 对照: World.Tick() lines 415-436 (wasLoadingGameSave block)
   *
   * Resolves trait save data, clears save state, and fires
   * INotifyGameLoaded on WorldActor traits.
   */
  private completeGameSaveLoad(): void {
    // Resolve trait data for each saved trait index
    for (const [key, value] of this.gameSaveTraitData) {
      const pairs = this.traitDict.actorsWithTrait<Component>('IGameSaveTraitData')
      if (key >= pairs.length) break

      const tp = pairs[key]
      const resolve = (tp.trait as unknown as { resolveTraitData?: (actor: IGameActor, data: unknown) => void }).resolveTraitData
      if (resolve && tp.actor) {
        resolve(tp.actor, value)
      }
    }

    this.gameSaveTraitData.clear()
    this.wasLoadingGameSave = false

    // Notify INotifyGameLoaded traits on WorldActor
    const loadedTraits = this.traitDict.traitsImplementing<INotifyGameLoaded & Component>(
      this.worldActor,
      'INotifyGameLoaded',
    )
    for (const t of loadedTraits) {
      t.gameLoaded(this as unknown as GameWorldManager & WorldStub)
    }
  }

  /**
   * Mark the world as loading a game save.
   *
   * OpenRA 对照: World.LoadComplete() → wasLoadingGameSave = true
   *
   * Called when the world detects it is loading a game save.
   * Sets internal state and fires INotifyGameLoading on WorldActor traits.
   */
  markGameLoading(): void {
    this.wasLoadingGameSave = true

    const loadingTraits = this.traitDict.traitsImplementing<INotifyGameLoading & Component>(
      this.worldActor,
      'INotifyGameLoading',
    )
    for (const t of loadingTraits) {
      t.gameLoading(this as unknown as GameWorldManager & WorldStub)
    }
  }

  /**
   * Add game save trait data for later resolution.
   *
   * OpenRA 对照: World.AddGameSaveTraitData(int, MiniYaml)
   */
  addGameSaveTraitData(traitIndex: number, data: unknown): void {
    this.gameSaveTraitData.set(traitIndex, data)
  }

  // -----------------------------------------------------------------------
  // SyncHash (对应 OpenRA SyncHash)
  // -----------------------------------------------------------------------

  /**
   * Compute a deterministic hash for network sync validation.
   *
   * OpenRA 对照: World.SyncHash()
   *
   * Hash components:
   * 1. All actors (by actorId, sorted for determinism)
   * 2. ISync trait hashes
   * 3. Synced effects
   * 4. Shared random number generator state
   * 5. Player unlock render player status
   *
   * NOTE: Full implementation requires:
   * - Sync.HashActor(Actor) — hash of actor trait state
   * - Sync.Hash(ISync) — hash of sync-annotated fields
   * - Sync.HashPlayer(Player) — hash of player state
   *
   * TODO-3.H: Implement full SyncHash when networking/sync module is migrated.
   * For now, returns a placeholder value.
   *
   * @returns the deterministic sync hash
   */
  syncHash(): number {
    // Placeholder implementation — returns 0 for now
    // Full implementation in TODO-3.H
    return 0
  }

  // -----------------------------------------------------------------------
  // Settings (对应 OpenRA GetSettings)
  // -----------------------------------------------------------------------

  /**
   * Get a settings module by type.
   *
   * OpenRA 对照: World.GetSettings<T>()
   *
   * @param settingsType — the settings class constructor
   * @returns the settings instance
   */
  getSettings<T>(_settingsType: new () => T): T | undefined {
    if (!this.modData) return undefined
    return this.modData.getSettings(_settingsType)
  }

  // -----------------------------------------------------------------------
  // Order issuing (对应 OpenRA IssueOrder)
  // -----------------------------------------------------------------------

  /**
   * Issue an order through the OrderManager.
   *
   * OpenRA 对照: World.IssueOrder(Order)
   *
   * @param order — the order to issue
   */
  issueOrder(order: OrderStub): void {
    this.orderManager?.issueOrder(order)
  }

  // -----------------------------------------------------------------------
  // Out of sync (对应 OpenRA OutOfSync)
  // -----------------------------------------------------------------------

  /**
   * Handle an out-of-sync event (replay desync).
   *
   * OpenRA 对照: World.OutOfSync()
   *
   * Ends the game and permanently pauses the replay.
   */
  outOfSync(): void {
    this.endGame()
    // Permanently pause — set replay timestep to 0
    this.replayTimestep = 0
  }

  // -----------------------------------------------------------------------
  // Fog / shroud visibility helpers (对应 OpenRA FogObscures/ShroudObscures)
  // -----------------------------------------------------------------------

  /**
   * Check if an actor is obscured by fog for the current render player.
   *
   * OpenRA 对照: World.FogObscures(Actor)
   *
   * @param _a — the actor to check (unused in stub)
   * @returns true if obscured by fog
   */
  fogObscuresActor(_a: IGameActor): boolean {
    // TODO-3.G: Implement fog visibility check when shroud/fog is migrated
    return false
  }

  // -----------------------------------------------------------------------
  // Render player helpers (对应 OpenRA RenderPlayer unlock check)
  // -----------------------------------------------------------------------

  /**
   * Check if a player can unlock the render player (spectator mode).
   *
   * OpenRA 对照: Player.UnlockedRenderPlayer
   */
  private canUnlockRenderPlayer(player: PlayerStub): boolean {
    const unlocked = (player as unknown as { unlockedRenderPlayer?: boolean }).unlockedRenderPlayer
    return unlocked === true
  }

  // -----------------------------------------------------------------------
  // Trait dictionary delegates (对应 OpenRA TraitDict forwarding methods)
  // -----------------------------------------------------------------------

  /**
   * Get all (actor, trait) pairs for traits implementing a given interface.
   *
   * OpenRA 对照: World.ActorsWithTrait<T>()
   */
  actorsWithTrait<T extends Component>(interfaceName: string): readonly TraitPair<T>[] {
    return this.traitDict.actorsWithTrait<T>(interfaceName)
  }

  /**
   * Get all actors having a trait implementing a given interface.
   *
   * OpenRA 对照: World.ActorsHavingTrait<T>()
   */
  actorsHavingTrait(interfaceName: string): readonly IGameActor[] {
    return this.traitDict.actorsHavingTrait(interfaceName)
  }

  /**
   * Apply an action to all actors with a trait implementing a given interface.
   *
   * OpenRA 对照: World.ApplyToActorsWithTrait<T>(Action<Actor, T>)
   */
  applyToActorsWithTrait<T extends Component>(
    interfaceName: string,
    action: (actor: IGameActor, trait: T) => void,
  ): void {
    this.traitDict.applyToActorsWithTrait(interfaceName, action)
  }

  /**
   * Apply a timed action to all actors with a trait implementing a given interface.
   *
   * OpenRA 对照: World.ApplyToActorsWithTraitTimed<T>(Action<Actor, T>, string)
   */
  applyToActorsWithTraitTimed<T extends Component>(
    interfaceName: string,
    action: (actor: IGameActor, trait: T) => void,
    text?: string,
  ): void {
    this.traitDict.applyToActorsWithTraitTimed(interfaceName, action, text ?? interfaceName)
  }

  // -----------------------------------------------------------------------
  // Dispose (对应 OpenRA Dispose)
  // -----------------------------------------------------------------------

  /**
   * Dispose the game world and all contained actors/resources.
   *
   * OpenRA 对照: World.Dispose()
   *
   * Disposal order:
   * 1. Set Disposing = true
   * 2. Deactivate order generator
   * 3. Clear frame end actions
   * 4. Stop the game loop
   * 5. Dispose actors (newest first, WorldActor last)
   * 6. Drain any remaining frame end actions from actor disposal
   * 7. Dispose map
   */
  dispose(): void {
    this.disposing = true

    // Deactivate order generator
    this._orderGenerator?.deactivate?.()

    // Clear pending frame end actions (they won't run after disposal)
    this._frameEndActions.length = 0

    // Stop the game loop
    this.stopLoop()

    // Dispose actors in reverse order (newest first, WorldActor last)
    // OpenRA: foreach (var a in actors.Values.Reverse()) a.Dispose();
    const actorArray = Array.from(this._actors.values()).reverse()
    for (const a of actorArray) {
      // Notify INotifyActorDisposing traits
      const disposingTraits = this.traitDict.traitsImplementing<INotifyActorDisposing & Component>(
        a,
        'INotifyActorDisposing',
      )
      for (const t of disposingTraits) {
        t.disposing(a)
      }

      // Mark as disposed
      ;(a as { disposed: boolean }).disposed = true

      // Remove all traits from the dictionary
      this.traitDict.removeActor(a)
    }

    // Drain any frame end actions generated by actor disposal
    // OpenRA: Actor disposals are done in a FrameEndTask
    while (this._frameEndActions.length > 0) {
      const action = this._frameEndActions.shift()!
      action()
    }

    // Dispose OrderManager (shellmap only)
    // OpenRA: if (Type == WorldType.Shellmap) OrderManager.Dispose();
    if (this.type === WorldType.Shellmap) {
      this.orderManager?.dispose?.()
    }

    // Dispose map
    this.map?.dispose()

    // Clear the actors map
    this._actors.clear()
  }
}
