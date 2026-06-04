/**
 * Actor.ts — GameActor: universal game entity with trait composition + condition system
 * OpenRA 对照: OpenRA.Game/Actor.cs
 *
 * 核心范式转换:
 * - C# sealed Actor class (reflection-based trait creation from YAML)
 *   → TypeScript GameActor extending BABYLON.TransformNode
 * - C# TraitDictionary (global, binary-search by generic type)
 *   → DUAL system: per-actor Map<string, Component> + global TraitDictionary sync
 * - C# condition system with Dictionary<string, ConditionState>
 *   → TypeScript Map<string, ConditionState> with same reference-counting semantics
 * - C# IEnumerable<IRenderable> Render(WorldRenderer) with yield return
 *   → TypeScript IRenderable[] with caching per WorldRenderer instance
 * - C# Lua scripting interface (IScriptBindable, etc.)
 *   → NOT migrated (web uses different scripting approach)
 *
 * Key Architecture Decision (ADR-3.1):
 * GameActor extends TransformNode directly rather than wrapping it.
 * This enables direct scene graph participation, built-in position/rotation/scale,
 * and automatic frustum culling.
 *
 * RISK: TransformNode.dispose() disposes all child nodes by default.
 * Child meshes owned by rendering traits MUST be removed from the GameActor
 * node before super.dispose() is called, OR super.dispose(false, true) must
 * be used to prevent cascade disposal.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { TransformNode } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type {
  IGameActor,
  INotifyCreated,
  INotifyActorDisposing,
  INotifyOwnerChanged,
  INotifyBecomingIdle,
  INotifyIdle,
  IResolveOrder,
  IRender,
  IRenderModifier,
  IMouseBounds,
  IVisibilityModifier,
  IDefaultVisibility,
  IObservesVariables,
  ICreationActivity,
  IHealth,
  IFacing,
  IOccupySpace,
  ITargetable,
  ITargetablePositions,
  IEffectiveOwner,
  ICrushable,
  PlayerStub,
  ActorInfoStub,
  ActivityStub,
  VariableObserver,
  VariableObserverNotifier,
} from './Traits/TraitsInterfaces.js'
import { Component } from './Traits/TraitsInterfaces.js'
import type { GameWorldManager } from './World.js'
import type { WRot } from './WRot.js'
import type { WPos } from './WPos.js'
import type { CPos } from './CPos.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Value returned by grantCondition for invalid/empty conditions.
 *
 * OpenRA 对照: Actor.InvalidConditionToken = -1
 */
export const INVALID_CONDITION_TOKEN = -1

// ---------------------------------------------------------------------------
// SystemActors enum (对应 OpenRA SystemActors)
// ---------------------------------------------------------------------------

/**
 * Bit flags identifying special system-owned actors.
 *
 * OpenRA 对照: SystemActors [Flags] enum
 */
export const SystemActors = {
  Player: 0,
  EditorPlayer: 1,
  World: 2,
  EditorWorld: 4,
} as const

export type SystemActors = (typeof SystemActors)[keyof typeof SystemActors]

// ---------------------------------------------------------------------------
// ConditionState — per-condition tracking (对应 OpenRA Actor.ConditionState)
// ---------------------------------------------------------------------------

/**
 * Internal state for a single named condition.
 *
 * OpenRA 对照: Actor.ConditionState (private sealed class)
 *
 * Tracks:
 * - The set of active tokens (reference counting)
 * - Registered observer notifiers (called when token count changes)
 */
class ConditionState {
  /**
   * Delegates registered to be notified when this condition changes.
   *
   * OpenRA 对照: ConditionState.Notifiers (List<VariableObserverNotifier>)
   */
  readonly notifiers: VariableObserverNotifier[] = []

  /**
   * Unique integer tokens identifying granted instances of this condition.
   *
   * OpenRA 对照: ConditionState.Tokens (HashSet<int>)
   */
  readonly tokens = new Set<number>()
}

// ---------------------------------------------------------------------------
// SyncHashEntry — per-trait sync hash provider (对应 Actor.SyncHash)
// ---------------------------------------------------------------------------

/**
 * Wraps a sync-enabled trait with its hash function.
 *
 * OpenRA 对照: Actor.SyncHash (internal readonly struct)
 *
 * NOTE: Full SyncHash implementation requires the Sync module (Support file).
 * For now, this is a placeholder struct.
 * TODO-3.D.8: Integrate with Sync module for network sync validation.
 */
interface SyncHashEntry {
  /** The trait that provides sync data. */
  trait: Component
  /** Cached hash function for this trait. */
  hashFunction: (trait: Component) => number
}

// ---------------------------------------------------------------------------
// ActivityStubLocal — minimal Activity base for Phase D (Phase E full impl)
// ---------------------------------------------------------------------------

/**
 * Minimal abstract Activity base class used within Actor before Phase E.
 *
 * OpenRA 对照: OpenRA.Game/Activities/Activity.cs (subset)
 *
 * NOTE: This is a LOCAL stub. When Phase E (Activity system) is complete,
 * this will be replaced by the full Activity class from Activities/Activity.ts.
 * Only the methods needed by Actor are declared here.
 */
abstract class ActivityStubLocal {
  /** The next activity in the chain.
   *
   * OpenRA 对照: Activity.NextActivity
   */
  nextActivity: ActivityStubLocal | null = null

  /**
   * Append an activity to the end of the chain.
   *
   * OpenRA 对照: Activity.Queue(Activity)
   */
  queue(activity: ActivityStubLocal): void {
    if (this.nextActivity === null) {
      this.nextActivity = activity
    } else {
      this.nextActivity.queue(activity)
    }
  }

  /**
   * Execute one tick of this activity.
   *
   * OpenRA 对照: Activity.Tick(Actor)
   *
   * @returns the next activity to run, or null if the chain is complete
   */
  abstract tick(actor: IGameActor): ActivityStubLocal | null

  /**
   * Cancel this activity, notifying it that it was aborted.
   *
   * OpenRA 对照: Activity.Cancel(Actor)
   */
  abstract cancel(actor: IGameActor): void

  /**
   * Called when the actor is being disposed, for outer cleanup.
   *
   * OpenRA 对照: Activity.OnActorDisposeOuter(Actor)
   */
  onActorDisposeOuter(_actor: IGameActor): void {
    // Default: cancel the activity chain
    this.cancel(_actor)
    if (this.nextActivity) {
      this.nextActivity.onActorDisposeOuter(_actor)
    }
  }

  /**
   * Skip any activities in the chain that have already completed.
   *
   * OpenRA 对照: Activity.SkipDoneActivities(Activity)
   */
  static skipDoneActivities(current: ActivityStubLocal | null): ActivityStubLocal | null {
    let c = current
    while (c !== null) {
      // In full implementation, activities can be marked "done".
      // For the stub, always return as-is.
      break
    }
    return c
  }
}

// ---------------------------------------------------------------------------
// ActorOptions — constructor parameters for GameActor
// ---------------------------------------------------------------------------

/**
 * Options passed to the GameActor constructor.
 *
 * OpenRA 对照: Actor constructor parameters (World, string name, TypeDictionary initDict)
 *
 * TypeScript uses an options object instead of positional parameters
 * to allow optional scene and incremental initialization.
 */
export interface ActorOptions {
  /** The world this actor belongs to.
   *
   * OpenRA 对照: World parameter
   */
  world: GameWorldManager

  /** Actor type name (e.g., "e1", "tank"). Must exist in world.Map.Rules.Actors.
   *
   * OpenRA 对照: name parameter
   */
  name: string

  /** Babylon.js Scene for TransformNode construction.
   * Optional — actors can be created without a scene and parented later.
   */
  scene?: Scene
}

// ---------------------------------------------------------------------------
// GameActor
// ---------------------------------------------------------------------------

/**
 * Universal game entity — a lightweight container where all functionality
 * comes from Trait composition.
 *
 * OpenRA 对照: Actor class (650 lines)
 *
 * GameActor extends BABYLON.TransformNode, enabling direct participation
 * in the Babylon.js scene graph for position, rotation, scale, and frustum
 * culling. All game logic (health, movement, rendering) is implemented by
 * Component subclasses (Traits) attached to this actor.
 *
 * ## Lifecycle State Machine
 *
 * ```
 * Created → initialize() → InWorld → NotInWorld → Disposed
 *            ↑                         │
 *            │  addToWorld=true        │  world.removeActor()
 *            │                         ↓
 *            └─────── addToWorld=false ──→ NotInWorld → dispose() → Disposed
 * ```
 *
 * ## Condition System
 *
 * Conditions are named boolean flags with reference counting. The same
 * condition can be granted multiple times (generating different tokens).
 * The condition is removed ONLY when ALL tokens are revoked.
 *
 * ```
 * grant("deployed") → token 1  // deployed active (refcount=1)
 * grant("deployed") → token 2  // deployed active (refcount=2)
 * revoke(token 1)   → OK       // deployed still active (refcount=1)
 * revoke(token 2)   → OK       // deployed removed (refcount=0)
 * ```
 *
 * ## Dispose Pattern
 *
 * CRITICAL: super.dispose() must be called with doNotRecurse=true to
 * prevent Babylon.js from disposing child meshes that are owned by
 * rendering traits. Trait-owned GPU resources are disposed separately
 * through INotifyActorDisposing.
 */
export class GameActor extends TransformNode implements IGameActor {
  // -----------------------------------------------------------------------
  // Static
  // -----------------------------------------------------------------------

  /** Invalid condition token constant (matching OpenRA). */
  static readonly INVALID_CONDITION_TOKEN = INVALID_CONDITION_TOKEN

  // -----------------------------------------------------------------------
  // Identity & core references
  // -----------------------------------------------------------------------

  /**
   * Globally unique actor identifier (uint32).
   *
   * OpenRA 对照: Actor.ActorID
   */
  readonly actorId: number

  /**
   * Static actor type metadata (from YAML/JSON config).
   *
   * OpenRA 对照: Actor.Info
   */
  info: ActorInfoStub | undefined

  /**
   * The world this actor belongs to.
   *
   * OpenRA 对照: Actor.World
   */
  world: GameWorldManager

  /**
   * The player that owns this actor.
   *
   * OpenRA 对照: Actor.Owner
   */
  owner: PlayerStub | undefined

  /**
   * Whether this actor is currently in the game world.
   *
   * OpenRA 对照: Actor.IsInWorld
   */
  isInWorld: boolean = false

  /**
   * Whether this actor has been flagged for deferred disposal.
   * Once true, the actor should not be referenced by game logic.
   *
   * OpenRA 对照: Actor.WillDispose
   */
  willDispose: boolean = false

  /**
   * Whether this actor has been fully disposed.
   *
   * OpenRA 对照: Actor.Disposed
   */
  disposed: boolean = false

  /**
   * Replacement generation counter. Incremented when the actor is
   * replaced (e.g., building upgrade, mind-control owner change).
   *
   * OpenRA 对照: Actor.Generation
   */
  generation: number = 0

  /**
   * The actor that replaced this one (e.g., upgraded building).
   *
   * OpenRA 对照: Actor.ReplacedByActor
   */
  replacedByActor: GameActor | null = null

  // -----------------------------------------------------------------------
  // Health / death state
  // -----------------------------------------------------------------------

  /** Cached health trait reference.
   *
   * OpenRA 对照: Actor.health (IHealth field)
   */
  private _health: IHealth | undefined

  /** Whether this actor has been killed (HP reached 0).
   *
   * OpenRA 对照: Actor.IsDead
   */
  get isDead(): boolean {
    return this.disposed || (this._health?.isDead ?? false)
  }

  /** Whether the actor has no current activity.
   *
   * OpenRA 对照: Actor.IsIdle
   */
  get isIdle(): boolean {
    return this._currentActivity === null
  }

  // -----------------------------------------------------------------------
  // Cached trait references (OpenRA PERF fast-path cache)
  // -----------------------------------------------------------------------

  /**
   * Cached facing trait for O(1) orientation queries.
   *
   * OpenRA 对照: Actor.facing (IFacing field)
   */
  private _facing: IFacing | undefined

  /**
   * The actor's current orientation in 3D space.
   *
   * OpenRA 对照: Actor.Orientation
   */
  get orientation(): WRot | null {
    return this._facing?.orientation ?? null
  }

  /**
   * Cached IOccupySpace trait for O(1) spatial queries.
   *
   * OpenRA 对照: Actor.OccupiesSpace
   */
  occupiesSpace: IOccupySpace | undefined

  /**
   * The cell position of this actor (top-left of occupied footprint).
   *
   * OpenRA 对照: Actor.Location
   */
  get location(): CPos | undefined {
    return this.occupiesSpace?.topLeft
  }

  /**
   * The world-space center position of this actor.
   *
   * OpenRA 对照: Actor.CenterPosition
   */
  get centerPosition(): WPos | undefined {
    return this.occupiesSpace?.centerPosition
  }

  /**
   * Cached ITargetable traits for O(1) targeting queries.
   *
   * OpenRA 对照: Actor.Targetables
   */
  targetables: ITargetable[] = []

  /**
   * Cached ITargetablePositions traits for O(1) position queries.
   *
   * OpenRA 对照: Actor.EnabledTargetablePositions
   */
  enabledTargetablePositions: ITargetablePositions[] = []

  /**
   * Cached world positions from enabled targetable positions.
   *
   * OpenRA 对照: Actor.enabledTargetableWorldPositions
   */
  private _enabledTargetableWorldPositions: WPosLike[] = []

  /**
   * Cached IEffectiveOwner trait for O(1) ownership queries.
   *
   * OpenRA 对照: Actor.EffectiveOwner
   */
  effectiveOwner: IEffectiveOwner | undefined

  /**
   * Cached ICrushable traits.
   *
   * OpenRA 对照: Actor.Crushables
   */
  private _crushables: ICrushable[] | undefined

  /** @inheritdoc */
  get crushables(): ICrushable[] {
    if (!this._crushables) {
      throw new Error(`Crushables for actor ${this.actorId} are not initialized.`)
    }
    return this._crushables
  }

  // -----------------------------------------------------------------------
  // Fast-path cached trait arrays (matching OpenRA PERF pattern)
  // -----------------------------------------------------------------------

  private _resolveOrders: IResolveOrder[] = []
  private _renderModifiers: IRenderModifier[] = []
  private _renders: IRender[] = []
  private _mouseBounds: IMouseBounds[] = []
  private _visibilityModifiers: IVisibilityModifier[] = []
  private _defaultVisibility: IDefaultVisibility | undefined
  private _becomingIdles: INotifyBecomingIdle[] = []
  private _tickIdles: INotifyIdle[] = []

  // -----------------------------------------------------------------------
  // SyncHash entries
  // -----------------------------------------------------------------------

  /**
   * Sync hash entries for network sync validation.
   *
   * OpenRA 对照: Actor.SyncHashes
   */
  private _syncHashes: SyncHashEntry[] = []

  // -----------------------------------------------------------------------
  // Component storage (TODO-3.D.2 — per-actor component Map)
  // -----------------------------------------------------------------------

  /**
   * Per-actor component storage keyed by component class name.
   * For interface-based lookup, use getComponentsImplementing().
   *
   * OpenRA 对照: N/A (C# uses global TraitDictionary exclusively)
   *
   * NOTE: This is IN ADDITION to global TraitDictionary registration.
   * Both stores are kept in sync by addComponent/removeComponent.
   */
  private readonly _components = new Map<string, Component>()

  // -----------------------------------------------------------------------
  // Condition system (TODO-3.D.3)
  // -----------------------------------------------------------------------

  /**
   * Per-condition-name state: tokens + notifiers.
   *
   * OpenRA 对照: Actor.conditionStates (Dictionary<string, ConditionState>)
   */
  private readonly _conditionStates = new Map<string, ConditionState>()

  /**
   * Token → condition name mapping for revocation.
   *
   * OpenRA 对照: Actor.conditionTokens (Dictionary<int, string>)
   */
  private readonly _conditionTokens = new Map<number, string>()

  /**
   * Condition name → active token count (reference count cache).
   *
   * OpenRA 对照: Actor.conditionCache (Dictionary<string, int>)
   */
  private readonly _conditionCache = new Map<string, number>()

  /**
   * Read-only version of conditionCache passed to observers.
   *
   * OpenRA 对照: Actor.readOnlyConditionCache
   */
  private readonly _readOnlyConditionCache: ReadonlyMap<string, number>

  /**
   * Monotonically increasing token counter.
   *
   * OpenRA 对照: Actor.nextConditionToken
   */
  private _nextConditionToken: number = 1

  /**
   * Whether the Initialize() method has been called.
   * Gates condition change notifications — observers are only notified
   * after initialization is complete.
   *
   * OpenRA 对照: Actor.created (bool)
   */
  private _created: boolean = false

  // -----------------------------------------------------------------------
  // Activity system (TODO-3.D.4 — stubs for Phase E)
  // -----------------------------------------------------------------------

  /**
   * Currently executing activity, or null if idle.
   *
   * OpenRA 对照: Actor.CurrentActivity
   */
  private _currentActivity: ActivityStubLocal | null = null

  // -----------------------------------------------------------------------
  // Render caching
  // -----------------------------------------------------------------------

  /**
   * Cached renderables for the last WorldRenderer that called Render().
   *
   * OpenRA 对照: Actor.renderables (IEnumerable<IRenderable> field)
   */
  private _renderables: IRenderableLike[] | null = null

  /**
   * The last WorldRenderer that called Render(). Used for cache invalidation.
   *
   * OpenRA 对照: Actor.lastWorldRenderer
   */
  private _lastWorldRenderer: object | null = null

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a new GameActor.
   *
   * OpenRA 对照: Actor(World, string, TypeDictionary)
   *
   * The constructor performs:
   * 1. TransformNode initialization (name, optional scene)
   * 2. Actor ID assignment from world.NextAID()
   * 3. Owner extraction from init options (if provided)
   * 4. ActorInfo lookup from world rules
   *
   * Full trait initialization is deferred to initialize() to allow
   * two-phase construction (create actor, then initialize traits).
   *
   * @param options — construction options (world, name, optional scene)
   */
  constructor(options: ActorOptions) {
    super(options.name, options.scene)
    this._readOnlyConditionCache = this._conditionCache

    this.world = options.world
    this.actorId = (this.world as unknown as { nextAID?: () => number }).nextAID?.() ?? 0

    // NOTE: Full trait creation from ActorInfo YAML is deferred to
    // initialize(). In OpenRA, the constructor iterates Info.TraitsInConstructOrder()
    // and creates traits immediately. We defer this because:
    // 1. Trait creation from JSON/YAML is Phase E (ActorInfo)
    // 2. Two-phase construction (create + initialize) is more flexible for
    //    testing and incremental setup
    //
    // TODO-3.E: Move trait creation from ActorConfig/ActorInfo into initialize()
    // when Phase E is complete.

    // Basic info setup
    this.info = { name: options.name }
  }

  // -----------------------------------------------------------------------
  // Initialization (TODO-3.D.6 — lifecycle state machine)
  // -----------------------------------------------------------------------

  /**
   * Initialize the actor after construction.
   *
   * OpenRA 对照: Actor.Initialize(bool addToWorld)
   *
   * This method:
   * 1. Sets the `created` flag (enables condition notifications)
   * 2. Fires INotifyCreated on all traits
   * 3. Collects IObservesVariables and builds observer registrations
   * 4. Initializes condition cache from any pre-existing grants
   * 5. Notifies all observers of initial condition state
   * 6. Searches for ICreationActivity (throws if more than one enabled)
   * 7. Optionally adds the actor to the world
   *
   * @param addToWorld — whether to add to world immediately (default: true)
   * @throws if more than one enabled ICreationActivity trait is found
   */
  initialize(addToWorld: boolean = true): void {
    this._created = true

    // Step 1: Fire INotifyCreated on all traits
    const createdTraits = this.traitsImplementing<INotifyCreated & Component>('INotifyCreated')
    for (const t of createdTraits) {
      t.created(this)
    }

    // Step 2: Collect all IObservesVariables and build observer registrations
    const allObserverNotifiers = new Set<VariableObserverNotifier>()
    const observerTraits = this.traitsImplementing<IObservesVariables & Component>('IObservesVariables')
    for (const provider of observerTraits) {
      for (const variableUser of provider.getVariableObservers()) {
        allObserverNotifiers.add(variableUser.notifier)
        for (const variable of variableUser.variables) {
          let cs = this._conditionStates.get(variable)
          if (!cs) {
            cs = new ConditionState()
            this._conditionStates.set(variable, cs)
          }
          cs.notifiers.push(variableUser.notifier)

          // Initialize conditions that have not yet been granted to 0.
          // NOTE: Some conditions may have already been granted by
          // INotifyCreated calling grantCondition, and we assign the
          // token count to safely cover both cases.
          this._conditionCache.set(variable, cs.tokens.size)
        }
      }
    }

    // Step 3: Notify all observers of initial condition state
    for (const notify of allObserverNotifiers) {
      notify(this, this._readOnlyConditionCache)
    }

    // Step 4: Find ICreationActivity (at most one enabled)
    let creationActivityTrait: ICreationActivity | null = null
    const creationTraits = this.traitsImplementing<ICreationActivity & Component>('ICreationActivity')
    for (const ica of creationTraits) {
      // Check if trait is enabled (via Component.enabled or IDisabledTrait)
      const enabledCheck = ica as Component & { isTraitDisabled?: boolean }
      if (enabledCheck.enabled !== false && !enabledCheck.isTraitDisabled) {
        if (creationActivityTrait !== null) {
          throw new Error(
            `More than one enabled ICreationActivity trait: ` +
            `${(creationActivityTrait as unknown as { constructor?: { name?: string } }).constructor?.name} and ` +
            `${(ica as unknown as { constructor?: { name?: string } }).constructor?.name}`,
          )
        }
        const activity = ica.getCreationActivity()
        if (activity !== null) {
          creationActivityTrait = ica
          // Queue the creation activity, prepending any existing activity
          const stubActivity = activity as unknown as ActivityStubLocal
          if (this._currentActivity) {
            stubActivity.queue(this._currentActivity)
          }
          this._currentActivity = stubActivity
        }
      }
    }

    // Step 5: Optionally add to world
    if (addToWorld) {
      this.world.addActor(this)
    }
  }

  // -----------------------------------------------------------------------
  // Component storage (TODO-3.D.2)
  // -----------------------------------------------------------------------

  /**
   * Get a component by its class name (convenience lookup).
   *
   * OpenRA 对照: N/A (C# uses TraitDict.Get<T>(this); this is a
   *   migration addition for per-actor component management)
   *
   * @param name — the component class name
   * @returns the component, or undefined if not found
   */
  getComponent<T extends Component>(name: string): T | undefined {
    return this._components.get(name) as T | undefined
  }

  /**
   * Get all components implementing a given interface.
   *
   * OpenRA 对照: N/A (C# uses World.TraitDict.WithInterface<T>(this))
   *
   * Filters the per-actor component map by checking each component's
   * static interfaces array.
   *
   * @param interfaceName — the interface name to filter by
   * @returns array of matching components (may be empty)
   */
  getComponentsImplementing<T extends Component>(interfaceName: string): T[] {
    const result: T[] = []
    for (const component of this._components.values()) {
      const ctor = component.constructor as
        | { interfaces?: readonly string[] }
        | undefined
      const ifaces = ctor?.interfaces
      if (ifaces && ifaces.includes(interfaceName)) {
        result.push(component as unknown as T)
      }
    }
    return result
  }

  /**
   * Add a component to this actor. Synchronizes with the global
   * TraitDictionary and calls component.attach(this).
   *
   * OpenRA 对照: Actor.AddTrait(object)
   *
   * @param component — the component to add
   * @throws if a component with the same class name already exists
   */
  addComponent(component: Component): void {
    const name = component.constructor.name
    if (this._components.has(name)) {
      throw new Error(
        `Actor ${this.actorId}: duplicate component '${name}'`,
      )
    }

    // Attach to actor
    component.attach(this)

    // Store in per-actor map
    this._components.set(name, component)

    // Synchronize with global TraitDictionary
    this.world.traitDict.addTrait(this, component)
  }

  /**
   * Remove a component from this actor. Synchronizes with the global
   * TraitDictionary and calls component.detach(this).
   *
   * OpenRA 对照: N/A (C# removes via TraitDictionary.RemoveActor)
   *
   * @param component — the component to remove
   */
  removeComponent(component: Component): void {
    const name = component.constructor.name
    if (this._components.get(name) !== component) {
      return // Not our component
    }

    // Remove from per-actor map
    this._components.delete(name)

    // Synchronize with global TraitDictionary FIRST (before detach clears
    // the actor reference, which TraitDictionary.removeTrait validates)
    this.world.traitDict.removeTrait(this, component)

    // Detach from actor (clears _actor property)
    component.detach(this)
  }

  /**
   * Get all components on this actor.
   *
   * @returns iterator of all components
   */
  get allComponents(): Iterable<Component> {
    return this._components.values()
  }

  // -----------------------------------------------------------------------
  // Trait query delegation (delegates to global TraitDictionary)
  // -----------------------------------------------------------------------

  /**
   * Get the single trait implementing the given interface.
   * Throws if not found or if multiple traits match.
   *
   * OpenRA 对照: Actor.Trait<T>()
   *
   * @param interfaceName — the interface name to query
   * @returns the matching trait
   * @throws if no trait or multiple traits match
   */
  trait<T extends Component>(interfaceName: string): T {
    return this.world.traitDict.trait<T>(this, interfaceName)
  }

  /**
   * Get the first trait implementing the given interface,
   * or undefined if not found.
   *
   * OpenRA 对照: Actor.TraitOrDefault<T>()
   *
   * @param interfaceName — the interface name to query
   * @returns the first matching trait, or undefined
   */
  traitOrDefault<T extends Component>(interfaceName: string): T | undefined {
    return this.world.traitDict.traitOrDefault<T>(this, interfaceName)
  }

  /**
   * Get all traits implementing the given interface.
   *
   * OpenRA 对照: Actor.TraitsImplementing<T>()
   *
   * @param interfaceName — the interface name to query
   * @returns array of matching traits (may be empty)
   */
  traitsImplementing<T extends Component>(interfaceName: string): T[] {
    return this.world.traitDict.traitsImplementing<T>(this, interfaceName)
  }

  /**
   * Check if this actor has at least one trait implementing the given interface.
   *
   * OpenRA 对照: (no direct equivalent; common usage pattern)
   *
   * @param interfaceName — the interface name to check
   * @returns true if at least one trait matches
   */
  hasTrait(interfaceName: string): boolean {
    return this.world.traitDict.hasTrait(this, interfaceName)
  }

  // -----------------------------------------------------------------------
  // Tick (对应 OpenRA Actor.Tick)
  // -----------------------------------------------------------------------

  /**
   * Execute one logic tick for this actor.
   *
   * OpenRA 对照: Actor.Tick()
   *
   * Tick logic:
   * 1. Run the current Activity chain via ActivityUtils-like runner
   * 2. If actor became idle this tick: fire INotifyBecomingIdle on all
   *    traits, then re-run activities (queued activities may have been added)
   * 3. If actor was already idle: fire INotifyIdle.tickIdle() on all traits
   *
   * Called by GameWorldManager.tick() for each actor in the world.
   */
  tick(): void {
    const wasIdle = this.isIdle

    // Run the activity chain
    this._currentActivity = this.runActivity(this._currentActivity)

    if (!wasIdle && this.isIdle) {
      // Actor became idle this tick — fire becoming-idle notifications,
      // then re-run activities to process any queued activities
      for (const n of this._becomingIdles) {
        n.onBecomingIdle(this)
      }
      // Re-run: if OnBecomingIdle queued a new activity, start it now
      this._currentActivity = this.runActivity(this._currentActivity)
    } else if (wasIdle) {
      // Actor is staying idle — fire idle tick
      for (const tickIdle of this._tickIdles) {
        tickIdle.tickIdle(this)
      }
    }
  }

  /**
   * Run the activity chain until it completes or blocks.
   *
   * OpenRA 对照: ActivityUtils.RunActivity(Actor, Activity)
   *
   * NOTE: Full implementation is in Phase E (ActivityUtils).
   * This is a local minimal implementation for Phase D.
   *
   * @param root — the root activity to start from
   * @returns the next activity to run (or null if chain is complete)
   */
  private runActivity(
    root: ActivityStubLocal | null,
  ): ActivityStubLocal | null {
    let current = root
    while (current !== null) {
      const next = current.tick(this)
      if (next === current) {
        // Activity wants to continue running
        return current
      }
      // Activity returned a different activity (or null = chain complete)
      current = next
    }
    return null
  }

  // -----------------------------------------------------------------------
  // Render (对应 OpenRA Actor.Render / ScreenBounds / MouseBounds)
  // -----------------------------------------------------------------------

  /**
   * Collect renderable objects for this actor.
   *
   * OpenRA 对照: Actor.Render(WorldRenderer)
   *
   * Caches the renderables per WorldRenderer instance to avoid re-allocation
   * when the same WorldRenderer calls Render() multiple times per frame.
   *
   * @param wr — the world renderer (used as cache key, not for rendering itself)
   * @returns array of renderable objects, passed through all IRenderModifier traits
   */
  render(wr: object): IRenderableLike[] {
    // PERF: Cache renderables per WorldRenderer (matching OpenRA pattern)
    if (this._lastWorldRenderer !== wr) {
      this._lastWorldRenderer = wr
      this._renderables = this.collectRenderables()
    }

    // Pass through all IRenderModifier traits
    let modifiedRenderables = this._renderables ?? []
    for (const modifier of this._renderModifiers) {
      modifiedRenderables = modifier.modifyRender(
        this,
        wr as WorldRendererStubLocal,
        modifiedRenderables,
      ) as unknown as IRenderableLike[]
    }
    return modifiedRenderables
  }

  /**
   * Collect raw renderables from all IRender traits.
   *
   * OpenRA 对照: Actor.Renderables(WorldRenderer)
   */
  private collectRenderables(): IRenderableLike[] {
    const buffer: IRenderableLike[] = []
    // PERF: Avoid LINQ — iterating arrays directly
    for (const render of this._renders) {
      const r = render.render(this, undefined as unknown as WorldRendererStubLocal)
      for (const renderable of r) {
        buffer.push(renderable as unknown as IRenderableLike)
      }
    }
    return buffer
  }

  /**
   * Get screen-space bounds for this actor.
   *
   * OpenRA 对照: Actor.ScreenBounds(WorldRenderer)
   *
   * @param wr — the world renderer
   * @returns array of rectangles in screen space
   */
  screenBounds(wr: object): RectLike[] {
    let bounds = this.collectScreenBounds()
    for (const modifier of this._renderModifiers) {
      bounds = modifier.modifyScreenBounds(
        this,
        wr as WorldRendererStubLocal,
        bounds,
      ) as unknown as RectLike[]
    }
    return bounds
  }

  /**
   * Collect raw screen bounds from all IRender traits.
   *
   * OpenRA 对照: Actor.Bounds(WorldRenderer)
   */
  private collectScreenBounds(): RectLike[] {
    const buffer: RectLike[] = []
    for (const render of this._renders) {
      const r = render.screenBounds(this, undefined as unknown as WorldRendererStubLocal)
      for (const rect of r) {
        if (!rectIsEmpty(rect)) {
          buffer.push(rect)
        }
      }
    }
    return buffer
  }

  /**
   * Get the mouse hit-test polygon for this actor.
   *
   * OpenRA 对照: Actor.MouseBounds(WorldRenderer)
   *
   * @param wr — the world renderer
   * @returns the first valid mouse bound polygon, or an empty polygon
   */
  mouseBounds(wr: object): PolygonLike {
    for (const mb of this._mouseBounds) {
      const bounds = mb.mouseoverBounds(this, wr as WorldRendererStubLocal)
      if (!polygonIsEmpty(bounds)) {
        return bounds
      }
    }
    return EMPTY_POLYGON
  }

  // -----------------------------------------------------------------------
  // Activity queueing (TODO-3.D.4)
  // -----------------------------------------------------------------------

  /**
   * Queue an activity for this actor.
   *
   * OpenRA 对照: Actor.QueueActivity(Activity) AND Actor.QueueActivity(bool, Activity)
   *
   * Two overloads:
   * - `queueActivity(activity)` — queue with default behavior
   * - `queueActivity(activity, queued)` — if `queued` is false, cancels
   *   the current activity before queueing the new one
   *
   * If the actor has no current activity, it starts immediately.
   * Otherwise, it is appended to the end of the activity chain.
   *
   * @param nextActivity — the activity to queue
   * @param queued — if false, cancel current activity before queueing (optional)
   * @throws if the actor has not been initialized yet
   */
  queueActivity(nextActivity: ActivityStub): void
  queueActivity(nextActivity: ActivityStub, queued: boolean): void
  queueActivity(nextActivity: ActivityStub, queued?: boolean): void {
    if (!this._created) {
      throw new Error(
        'An activity was queued before the actor was created. ' +
        'Queue it inside the INotifyCreated.Created callback instead.',
      )
    }

    // OpenRA: QueueActivity(bool queued, Activity nextActivity)
    // If queued is false, cancel existing activities first.
    if (queued === false) {
      this.cancelActivity()
    }

    const localActivity = nextActivity as unknown as ActivityStubLocal

    if (this._currentActivity === null) {
      this._currentActivity = localActivity
    } else {
      this._currentActivity.queue(localActivity)
    }
  }

  /**
   * Cancel the actor's current activity and all queued activities.
   *
   * OpenRA 对照: Actor.CancelActivity()
   */
  cancelActivity(): void {
    if (this._currentActivity) {
      this._currentActivity.cancel(this)
      this._currentActivity = null
    }
  }

  // -----------------------------------------------------------------------
  // Owner change (对应 OpenRA Actor.ChangeOwner/ChangeOwnerSync)
  // -----------------------------------------------------------------------

  /**
   * Change the actor's owner (deferred to frame end).
   *
   * OpenRA 对照: Actor.ChangeOwner(Player)
   *
   * @param newOwner — the new owning player
   */
  changeOwner(newOwner: PlayerStub): void {
    this.world.addFrameEndTask(() => {
      this.changeOwnerSync(newOwner)
    })
  }

  /**
   * Change the actor's owner immediately (must only be called from within
   * a FrameEndTask).
   *
   * OpenRA 对照: Actor.ChangeOwnerSync(Player)
   *
   * Temporarily removes the actor from the world, updates ownership,
   * increments Generation, and fires INotifyOwnerChanged on both this
   * actor and the WorldActor.
   *
   * @param newOwner — the new owning player
   */
  changeOwnerSync(newOwner: PlayerStub): void {
    if (this.disposed) return

    const oldOwner = this.owner
    const wasInWorld = this.isInWorld

    // Momentarily remove from world so ownership queries are consistent
    if (wasInWorld) {
      this.world.removeActor(this)
    }

    this.owner = newOwner
    this.generation++

    // Notify this actor's traits
    const ownerChangedTraits = this.traitsImplementing<
      INotifyOwnerChanged & Component
    >('INotifyOwnerChanged')
    for (const t of ownerChangedTraits) {
      t.onOwnerChanged(this, oldOwner!, newOwner)
    }

    // Notify WorldActor's traits too (global ownership tracking)
    const worldActorTraits = this.world.traitDict.traitsImplementing<
      INotifyOwnerChanged & Component
    >(this.world.worldActor, 'INotifyOwnerChanged')
    for (const t of worldActorTraits) {
      t.onOwnerChanged(this, oldOwner!, newOwner)
    }

    if (wasInWorld) {
      this.world.addActor(this)
    }
  }

  // -----------------------------------------------------------------------
  // Damage (对应 OpenRA Actor.GetDamageState/InflictDamage/Kill)
  // -----------------------------------------------------------------------

  /**
   * Get the current damage state of this actor.
   *
   * OpenRA 对照: Actor.GetDamageState()
   *
   * @returns the damage state enum value
   */
  getDamageState(): DamageStateLike {
    if (this.disposed) return DAMAGE_STATE_DEAD
    if (!this._health) return DAMAGE_STATE_UNDAMAGED
    return this._health.damageState
  }

  /**
   * Inflict damage on this actor.
   *
   * OpenRA 对照: Actor.InflictDamage(Actor, Damage)
   *
   * @param attacker — the actor that dealt the damage
   * @param damage — the damage value and type
   */
  inflictDamage(attacker: IGameActor, damage: DamageLike): void {
    if (this.disposed || !this._health) return
    this._health.inflictDamage(this, attacker, damage, false)
  }

  /**
   * Kill this actor.
   *
   * OpenRA 对照: Actor.Kill(Actor, BitSet<DamageType>)
   *
   * @param attacker — the actor that killed this one
   * @param damageTypes — optional damage type bit set
   */
  kill(attacker: IGameActor, damageTypes?: BitSetStubLocal): void {
    if (this.disposed || !this._health) return
    this._health.kill(this, attacker, damageTypes ?? EMPTY_BITSET)
  }

  // -----------------------------------------------------------------------
  // Visibility (对应 OpenRA Actor.CanBeViewedByPlayer)
  // -----------------------------------------------------------------------

  /**
   * Check if this actor can be viewed by a given player.
   *
   * OpenRA 对照: Actor.CanBeViewedByPlayer(Player)
   *
   * @param player — the player to check visibility for
   * @returns true if the actor is visible to the player
   */
  canBeViewedByPlayer(player: PlayerStub): boolean {
    // PERF: Avoid LINQ
    for (const visibilityModifier of this._visibilityModifiers) {
      if (!visibilityModifier.isVisible(this, player)) {
        return false
      }
    }
    return this._defaultVisibility?.isVisible(this, player) ?? true
  }

  // -----------------------------------------------------------------------
  // Targeting (对应 OpenRA Actor target type queries)
  // -----------------------------------------------------------------------

  /**
   * Get all target types for this actor (enabled + disabled).
   *
   * OpenRA 对照: Actor.GetAllTargetTypes()
   */
  getAllTargetTypes(): BitSetStubLocal {
    let result: BitSetStubLocal = EMPTY_BITSET
    for (const targetable of this.targetables) {
      result = bitSetUnion(result, targetable.targetTypes)
    }
    return result
  }

  /**
   * Get enabled target types for this actor.
   *
   * OpenRA 对照: Actor.GetEnabledTargetTypes()
   */
  getEnabledTargetTypes(): BitSetStubLocal {
    let result: BitSetStubLocal = EMPTY_BITSET
    for (const targetable of this.targetables) {
      if (isTraitEnabledLocal(targetable)) {
        result = bitSetUnion(result, targetable.targetTypes)
      }
    }
    return result
  }

  /**
   * Check if this actor is targetable by another actor.
   *
   * OpenRA 对照: Actor.IsTargetableBy(Actor)
   *
   * @param byActor — the actor that wants to target this one
   * @returns true if targetable
   */
  isTargetableBy(byActor: IGameActor): boolean {
    for (const targetable of this.targetables) {
      if (targetable.targetableBy(this, byActor)) {
        return true
      }
    }
    return false
  }

  /**
   * Get all targetable world positions for this actor.
   *
   * OpenRA 对照: Actor.GetTargetablePositions()
   */
  getTargetablePositions(): WPosLike[] {
    if (this.enabledTargetablePositions.length > 0) {
      return this._enabledTargetableWorldPositions
    }
    // Fallback: center position
    if (this.occupiesSpace) {
      return [this.occupiesSpace.centerPosition as unknown as WPosLike]
    }
    return []
  }

  // -----------------------------------------------------------------------
  // Order resolution (TODO-3.D.7)
  // -----------------------------------------------------------------------

  /**
   * Dispatch a player command to all IResolveOrder traits.
   *
   * OpenRA 对照: Actor.ResolveOrder(Order)
   *
   * @param order — the order to resolve
   */
  resolveOrder(order: OrderStubLocal): void {
    for (const r of this._resolveOrders) {
      r.resolveOrder(this, order)
    }
  }

  // -----------------------------------------------------------------------
  // Condition system (TODO-3.D.3)
  // -----------------------------------------------------------------------

  /**
   * Update condition state after a grant or revoke operation.
   *
   * OpenRA 对照: Actor.UpdateConditionState(string, int, bool)
   *
   * @param condition — the condition name
   * @param token — the token being granted or revoked
   * @param isRevoke — true if revoking, false if granting
   */
  private updateConditionState(
    condition: string,
    token: number,
    isRevoke: boolean,
  ): void {
    let state = this._conditionStates.get(condition)
    if (!state) {
      state = new ConditionState()
      this._conditionStates.set(condition, state)
    }

    if (isRevoke) {
      state.tokens.delete(token)
    } else {
      state.tokens.add(token)
    }

    // Update the reference count cache
    this._conditionCache.set(condition, state.tokens.size)

    // Notify observers if the actor has been created.
    // Conditions granted/revoked before initialization are buffered;
    // notifications are sent during initialize() when all observers
    // are registered.
    if (this._created) {
      for (const notify of state.notifiers) {
        notify(this, this._readOnlyConditionCache)
      }
    }
  }

  /**
   * Grant a named condition to this actor.
   *
   * OpenRA 对照: Actor.GrantCondition(string)
   *
   * Conditions are reference-counted via unique tokens. The same condition
   * can be granted multiple times, generating different tokens each time.
   * The condition is removed only when ALL tokens are revoked.
   *
   * @param condition — the condition name to grant
   * @returns a unique integer token for revocation, or INVALID_CONDITION_TOKEN
   *          (-1) if the condition is null or empty
   */
  grantCondition(condition: string): number {
    if (!condition) {
      return INVALID_CONDITION_TOKEN
    }

    const token = this._nextConditionToken++
    this._conditionTokens.set(token, condition)
    this.updateConditionState(condition, token, false)
    return token
  }

  /**
   * Revoke a previously granted condition by its token.
   *
   * OpenRA 对照: Actor.RevokeCondition(int)
   *
   * @param token — the token returned by grantCondition
   * @returns INVALID_CONDITION_TOKEN (-1) on success
   * @throws if the token is not valid
   */
  revokeCondition(token: number): number {
    const condition = this._conditionTokens.get(token)
    if (condition === undefined) {
      throw new Error(
        `Attempting to revoke condition with invalid token ${token} for actor ${this.actorId}.`,
      )
    }

    this._conditionTokens.delete(token)
    this.updateConditionState(condition, token, true)
    return INVALID_CONDITION_TOKEN
  }

  /**
   * Check whether a condition is currently active (has at least one token).
   *
   * OpenRA 对照: conditionCache[condition] > 0 (no direct C# method)
   *
   * @param condition — the condition name to check
   * @returns true if the condition has at least one active token
   */
  hasCondition(condition: string): boolean {
    const count = this._conditionCache.get(condition)
    return count !== undefined && count > 0
  }

  /**
   * Check whether a revocation token is still valid.
   *
   * OpenRA 对照: Actor.TokenValid(int)
   *
   * @param token — the token to check
   * @returns true if the token can still be used to revoke a condition
   */
  tokenValid(token: number): boolean {
    return this._conditionTokens.has(token)
  }

  /**
   * Get the current condition cache (read-only).
   * Each entry maps condition name to active token count.
   *
   * OpenRA 对照: Actor.readOnlyConditionCache
   */
  get conditionCache(): ReadonlyMap<string, number> {
    return this._readOnlyConditionCache
  }

  // -----------------------------------------------------------------------
  // Observer registration (called during initialize())
  // -----------------------------------------------------------------------

  /**
   * Register a variable observer with this actor.
   *
   * OpenRA 对照: (inlined in Actor.Initialize — extracted as a method for reuse)
   *
   * This is called by the condition system during initialize() and is
   * also available for traits that need to register observers dynamically.
   *
   * @param observer — the observer configuration
   */
  registerObserver(observer: VariableObserver): void {
    for (const variable of observer.variables) {
      let cs = this._conditionStates.get(variable)
      if (!cs) {
        cs = new ConditionState()
        this._conditionStates.set(variable, cs)
      }
      cs.notifiers.push(observer.notifier)
    }
  }

  // -----------------------------------------------------------------------
  // Cached trait reference setup
  // -----------------------------------------------------------------------

  /**
   * Build cached trait reference arrays after all traits are added.
   *
   * OpenRA 对照: (inlined in Actor constructor — extracted for clarity)
   *
   * This is the TypeScript equivalent of OpenRA's PERF cache blocks
   * in the Actor constructor. It should be called once after all
   * components are added via addComponent().
   */
  buildCachedTraitRefs(): void {
    // Fast-path single-trait caches
    this._health = this.traitOrDefault<IHealth & Component>('IHealth')
    this._facing = this.traitOrDefault<IFacing & Component>('IFacing')
    this.occupiesSpace = this.traitOrDefault<IOccupySpace & Component>('IOccupySpace')
    this.effectiveOwner = this.traitOrDefault<IEffectiveOwner & Component>('IEffectiveOwner')
    this._defaultVisibility = this.traitOrDefault<IDefaultVisibility & Component>('IDefaultVisibility')

    // Array caches
    this._resolveOrders = this.traitsImplementing<IResolveOrder & Component>('IResolveOrder')
    this._renderModifiers = this.traitsImplementing<IRenderModifier & Component>('IRenderModifier')
    this._renders = this.traitsImplementing<IRender & Component>('IRender')
    this._mouseBounds = this.traitsImplementing<IMouseBounds & Component>('IMouseBounds')
    this._visibilityModifiers = this.traitsImplementing<IVisibilityModifier & Component>('IVisibilityModifier')
    this._becomingIdles = this.traitsImplementing<INotifyBecomingIdle & Component>('INotifyBecomingIdle')
    this._tickIdles = this.traitsImplementing<INotifyIdle & Component>('INotifyIdle')

    this.targetables = this.traitsImplementing<ITargetable & Component>('ITargetable')
    this.enabledTargetablePositions = this.traitsImplementing<ITargetablePositions & Component>('ITargetablePositions')
      .filter(t => isTraitEnabledLocal(t))

    // Cache world positions
    this._enabledTargetableWorldPositions = []
    for (const tp of this.enabledTargetablePositions) {
      const positions = tp.targetablePositions(this)
      for (const pos of positions) {
        this._enabledTargetableWorldPositions.push(pos as unknown as WPosLike)
      }
    }

    this._crushables = this.traitsImplementing<ICrushable & Component>('ICrushable')

    // SyncHash entries from ISync traits
    // NOTE: Full hash function requires the Sync module (pending TODO-3.D.8).
    // For now, each trait contributes 0 to the hash.
    const syncTraits = this.traitsImplementing<Component>('ISync')
    this._syncHashes = syncTraits.map(trait => ({
      trait,
      hashFunction: () => 0, // TODO-3.D.8: Use Sync.getHashFunction(trait)
    }))
  }

  // -----------------------------------------------------------------------
  // SyncHash (TODO-3.D.8 — placeholder)
  // -----------------------------------------------------------------------

  /**
   * Compute a deterministic hash for network sync validation.
   *
   * OpenRA 对照: Actor.SyncHash (internal struct) + Sync.GetHashFunction()
   *
   * NOTE: Full implementation requires the Sync module.
   * TODO-3.D.8: Integrate with Sync module for network sync validation.
   *
   * @returns a hash value for this actor's sync-relevant state
   */
  computeSyncHash(): number {
    if (this._syncHashes.length === 0) return 0
    let hash = 0
    for (const entry of this._syncHashes) {
      hash += entry.hashFunction(entry.trait)
    }
    return hash
  }

  // -----------------------------------------------------------------------
  // ToString (对应 OpenRA Actor.ToString)
  // -----------------------------------------------------------------------

  /**
   * Get a human-readable string representation of this actor.
   *
   * OpenRA 对照: Actor.ToString()
   */
  override toString(): string {
    let name = `${this.info?.name ?? 'Unknown'} ${this.actorId}`
    if (!this.isInWorld) {
      name += ' (not in world)'
    }
    return name
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * Dispose this actor and all its traits.
   *
   * OpenRA 对照: Actor.Dispose()
   *
   * Disposal order:
   * 1. Call OnActorDisposeOuter on current activity (cleanup)
   * 2. Set WillDispose = true (blocks new references)
   * 3. Defer actual disposal to frame end (safe removal during tick)
   *
   * In the frame end task:
   * 4. Remove from world (fires INotifyRemovedFromWorld)
   * 5. Fire INotifyActorDisposing on all traits
   * 6. Remove all traits from global TraitDictionary
   * 7. Set Disposed = true
   * 8. Call super.dispose() with doNotRecurse to prevent cascade
   *
   * CRITICAL: super.dispose() is called with doNotRecurse=true to prevent
   * Babylon.js from disposing child meshes owned by rendering traits.
   * Trait-owned GPU resources must be disposed through INotifyActorDisposing.
   */
  dispose(): void {
    if (this.willDispose || this.disposed) return

    // Step 1: Clean up current activity
    if (this._currentActivity) {
      this._currentActivity.onActorDisposeOuter(this)
    }

    // Step 2: Flag for deferred disposal
    this.willDispose = true

    // Step 3: Defer actual cleanup to frame end
    const self = this
    this.world.addFrameEndTask(() => {
      if (self.disposed) return

      // Step 4: Remove from world if still in it
      if (self.isInWorld) {
        self.world.removeActor(self)
      }

      // Step 5: Fire INotifyActorDisposing on all traits
      const disposingTraits = self.traitsImplementing<INotifyActorDisposing & Component>(
        'INotifyActorDisposing',
      )
      for (const t of disposingTraits) {
        t.disposing(self)
      }

      // Step 6: Remove all traits from TraitDictionary
      self.world.traitDict.removeActor(self)

      // Step 7: Dispose all components
      for (const component of self._components.values()) {
        component.dispose()
      }
      self._components.clear()

      // Step 8: Clear condition state
      self._conditionStates.clear()
      self._conditionTokens.clear()
      self._conditionCache.clear()

      // Step 9: Mark as disposed
      self.disposed = true

      // Step 10: Dispose TransformNode
      // CRITICAL: doNotRecurse=true prevents Babylon.js from disposing
      // child meshes that are owned by rendering traits. Trait-owned
      // GPU resources must be cleaned up in INotifyActorDisposing handlers
      // before this point.
      if (!self.isDisposed()) {
        // NOTE: super.dispose() is called via the prototype to avoid
        // recursion. doNotRecurse=true, disposeMaterialAndTextures=false.
        TransformNode.prototype.dispose.call(self, true, false)
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Condition Expression Evaluator (对应 OpenRA RequiresCondition expressions)
// ---------------------------------------------------------------------------

/**
 * Evaluate a condition expression string against a condition checker.
 *
 * OpenRA 对照: ConditionManager.RequiresCondition evaluation
 *
 * Supports boolean expressions with:
 * - Simple condition names: "deployed"
 * - Negation: "!deployed"
 * - AND: "deployed && upgraded"
 * - OR: "deployed || upgraded"
 * - Parentheses: "(deployed || upgraded) && !disabled"
 *
 * Implementation: simple recursive-descent parser.
 *
 * @param expression — the condition expression string
 * @param hasCondition — function that checks if a named condition is active
 * @returns true if the expression evaluates to true
 */
export function evaluateConditionExpression(
  expression: string,
  hasCondition: (condition: string) => boolean,
): boolean {
  const trimmed = expression.trim()
  if (!trimmed) return true // empty expression = always satisfied

  return parseOr(trimmed, hasCondition)
}

/**
 * Parse OR expressions (lowest precedence).
 */
function parseOr(
  expr: string,
  hasCondition: (condition: string) => boolean,
): boolean {
  let depth = 0
  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i]
    if (ch === ')') depth++
    else if (ch === '(') depth--
    else if (depth === 0 && ch === '|' && i > 0 && expr[i - 1] === '|') {
      // Found || at top level
      const left = expr.substring(0, i - 1).trim()
      const right = expr.substring(i + 1).trim()
      return parseOr(left, hasCondition) || parseAnd(right, hasCondition)
    }
  }
  return parseAnd(expr, hasCondition)
}

/**
 * Parse AND expressions (higher precedence than OR).
 */
function parseAnd(
  expr: string,
  hasCondition: (condition: string) => boolean,
): boolean {
  let depth = 0
  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i]
    if (ch === ')') depth++
    else if (ch === '(') depth--
    else if (depth === 0 && ch === '&' && i > 0 && expr[i - 1] === '&') {
      // Found && at top level
      const left = expr.substring(0, i - 1).trim()
      const right = expr.substring(i + 1).trim()
      return parseAnd(left, hasCondition) && parseNot(right, hasCondition)
    }
  }
  return parseNot(expr, hasCondition)
}

/**
 * Parse NOT expressions (highest precedence).
 */
function parseNot(
  expr: string,
  hasCondition: (condition: string) => boolean,
): boolean {
  const trimmed = expr.trim()
  if (trimmed.startsWith('!')) {
    return !parseNot(trimmed.substring(1), hasCondition)
  }
  return parsePrimary(trimmed, hasCondition)
}

/**
 * Parse primary expressions: condition names or parenthesized sub-expressions.
 */
function parsePrimary(
  expr: string,
  hasCondition: (condition: string) => boolean,
): boolean {
  const trimmed = expr.trim()

  // Check if the expression is wrapped in matching outer parentheses.
  // We track nesting depth to avoid being fooled by expressions like
  // `(deployed) || (upgraded)` where startsWith('(') && endsWith(')')
  // would incorrectly strip the outer parens.
  if (trimmed.startsWith('(')) {
    let depth = 0
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') depth++
      else if (trimmed[i] === ')') depth--
      // If depth reaches 0 at the last character, the entire expression
      // is wrapped in a single outer pair — strip them and recurse.
      if (depth === 0 && i === trimmed.length - 1) {
        return parseOr(trimmed.substring(1, trimmed.length - 1), hasCondition)
      }
      // If depth reaches 0 before the end, the expression is NOT fully
      // wrapped in a single pair — fall through to hasCondition.
      if (depth === 0) break
    }
  }

  return hasCondition(trimmed)
}

// ---------------------------------------------------------------------------
// Local stub types (used internally to avoid circular imports)
// ---------------------------------------------------------------------------

/** Minimal WPos-like type used for targetable positions. */
interface WPosLike {
  x: number
  y: number
  z: number
}

/** Minimal renderable-like type used in render collection. */
interface IRenderableLike {
  pos: WPosLike
  zOffset: number
  isDecoration: boolean
}

/** Minimal WorldRenderer stub interface for render methods. */
interface WorldRendererStubLocal {
  // marker — actual WorldRenderer methods not needed by Actor.Render
}

/** Minimal rect type for screen bounds. */
interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

/** Minimal polygon type for mouse bounds. */
interface PolygonLike {
  vertices: readonly { x: number; y: number }[]
}

/** Minimal bit set for damage and target types. */
interface BitSetStubLocal {
  contains(value: number): boolean
  isEmpty(): boolean
}

/** Minimal order stub for resolveOrder. */
interface OrderStubLocal {
  readonly orderName: string
  readonly targetString: string
  readonly extraData: unknown
}

/** Minimal damage stub for inflictDamage. */
interface DamageLike {
  readonly value: number
  readonly damageTypes: BitSetStubLocal
}

/** Damage state enum values (local stub matching TraitsInterfaces). */
const DAMAGE_STATE_UNDAMAGED = 1
const DAMAGE_STATE_DEAD = 32

/** DamageState-like type. */
type DamageStateLike = number

/** Empty bit set sentinel. */
const EMPTY_BITSET: BitSetStubLocal = {
  contains: () => false,
  isEmpty: () => true,
}

/** Bit set union — local minimal implementation. */
function bitSetUnion(
  a: BitSetStubLocal,
  b: unknown,
): BitSetStubLocal {
  // Stub: return a new object combining both
  const aContains = a.contains.bind(a)
  const bCast = b as BitSetStubLocal
  return {
    contains(v: number): boolean {
      return aContains(v) || bCast.contains(v)
    },
    isEmpty(): boolean {
      return a.isEmpty() && bCast.isEmpty()
    },
  }
}

/** Check if a trait is enabled (local helper matching OpenRA Exts.IsTraitEnabled). */
function isTraitEnabledLocal(trait: unknown): boolean {
  const t = trait as { isTraitDisabled?: boolean; enabled?: boolean }
  if (typeof t.isTraitDisabled === 'boolean') {
    return !t.isTraitDisabled
  }
  if (typeof t.enabled === 'boolean') {
    return t.enabled
  }
  return true
}

/** Check if a rect is empty. */
function rectIsEmpty(r: RectLike): boolean {
  return r.width <= 0 || r.height <= 0
}

/** Check if a polygon is empty. */
function polygonIsEmpty(p: PolygonLike): boolean {
  return !p.vertices || p.vertices.length === 0
}

/** Empty polygon sentinel. */
const EMPTY_POLYGON: PolygonLike = { vertices: [] }
