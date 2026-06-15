/**
 * TraitsInterfaces.ts — Trait system interface contracts, organized into 4 categories
 * OpenRA 对照: OpenRA.Game/Traits/TraitsInterfaces.cs
 *
 * 核心范式转换:
 * - C# interface + reflection-based type dispatch → TypeScript interface + type guard functions
 * - C# [RequireExplicitImplementation] attribute → JSDoc convention (no TS equivalent)
 * - C# generic Requires<T>/NotBefore<T> compile-time constraints → runtime marker interfaces
 *   + build-time JSON Schema validation (see TODO-3.C.1 ActorInfo)
 * - C# Actor concrete type as trait method parameter → IGameActor forward interface
 *   (avoids circular dependency with GameActor, Phase D)
 * - C# TraitInfo reflection-driven factory → Component abstract base with attach/detach
 *
 * Interface categories (matching OpenRA 4-category organization):
 *   1. Update / Render      — per-tick logic + per-frame render
 *   2. Lifecycle            — actor creation, world entry, disposal, death
 *   3. Game Logic           — orders, health, facing, targeting, movement
 *   4. Dependency / State   — trait ordering, variable observation
 */

import type { WPos } from '../WPos'
import type { WAngle } from '../WAngle'
import type { WDist } from '../WDist'
import type { CPos } from '../CPos'
import type { WRot } from '../WRot'
import type { SubCell as SubCellEnum } from './SubCell'
import type { Activity } from '../Activities/Activity'
import type { Target } from './Target'

// ---------------------------------------------------------------------------
// Forward type stubs (types not yet migrated, referenced by interfaces)
// ---------------------------------------------------------------------------

/**
 * Order stub — forward reference to OpenRA.Game/Orders/Order.cs.
 * Full Order class will be defined in a later phase.
 *
 * OpenRA 对照: OpenRA.Game/Orders/Order.cs
 * TODO-3.D: Replace with full Order class when Orders module is migrated.
 */
export interface OrderStub {
  readonly orderName: string
  readonly targetString: string
  readonly extraData: unknown
}

/** Type alias for the stub — will be replaced with real Order class. */
export type Order = OrderStub

/**
 * WorldRenderer stub — forward reference for render-related trait interfaces.
 * Full WorldRenderer is already migrated in src/OpenRA.Game/Graphics/WorldRenderer.ts.
 *
 * OpenRA 对照: OpenRA.Game/Graphics/WorldRenderer.cs
 */
export interface WorldRendererStub {
  // Minimal stub — actual WorldRenderer methods used by traits will be added
  // incrementally as specific render traits are implemented.
}

/**
 * Player stub — forward reference to OpenRA.Game/Player.cs.
 *
 * OpenRA 对照: OpenRA.Game/Player.cs
 * TODO-3.E: Replace with full Player class when Player module is migrated.
 */
export interface PlayerStub {
  readonly playerName: string
}

/**
 * FrozenActor stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Game/Traits/FrozenActor.cs
 * TODO-3.G: Replace with full FrozenActor class when fog-of-war is migrated.
 */
export interface FrozenActorStub {
  readonly isValid: boolean
  readonly visible: boolean
  readonly hidden: boolean
  readonly centerPosition: WPos
}

/**
 * Minimal reference to a FrozenActor for visibility change callbacks.
 *
 * OpenRA 对照: FrozenActor (subset used by ICreatesFrozenActors callbacks)
 *
 * Exposes the fields and methods needed by FrozenUnderFog and similar
 * traits when reacting to visibility transitions. This avoids a circular
 * dependency between TraitsInterfaces and FrozenActorLayer.
 */
export interface IFrozenActorRef {
  readonly viewer: PlayerStub
  readonly visible: boolean
  readonly hidden: boolean
  readonly centerPosition: WPos
  refreshHidden(): void
}

/**
 * Interface for traits that create FrozenActor snapshots.
 *
 * OpenRA 对照: ICreatesFrozenActors
 *
 * When a FrozenActor's visibility state changes, the creating trait is
 * notified so it can synchronize its own state.
 */
export interface ICreatesFrozenActors {
  onVisibilityChanged(frozen: IFrozenActorRef): void
}

/**
 * IReadOnlyFileSystem stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Game/FileSystem/IReadOnlyFileSystem.cs
 */
export interface IReadOnlyFileSystemStub {
  open(filename: string): { read(): ArrayBuffer } | null
}

/**
 * MersenneTwister stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Support/MersenneTwister.cs
 */
export interface MersenneTwisterStub {
  next(): number
}

/**
 * Session stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Network/Session.cs
 */
export interface SessionStub {
  readonly clients: unknown[]
}

/**
 * MapPreview stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Game/Map/MapPreview.cs
 */
export interface MapPreviewStub {
  readonly uid: string
}

/**
 * Ruleset stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Game/GameRules/Ruleset.cs
 */
export interface RulesetStub {
  readonly actors: Map<string, unknown>
}

/**
 * ActorInfo stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Game/ActorInfo.cs
 * TODO-3.C.1: Replace with full ActorConfig class.
 */
export interface ActorInfoStub {
  readonly name: string
}

/**
 * MiniYaml stub — forward reference.
 *
 * OpenRA 对照: OpenRA.Game/MiniYaml.cs
 */
export interface MiniYamlStub {
  readonly nodes: unknown[]
}

/**
 * BitSet stub — forward reference for damage types and target types.
 *
 * OpenRA 对照: OpenRA.Primitives/BitSet.cs
 */
export interface BitSetStub<_T> {
  contains(value: number): boolean
  isEmpty(): boolean
}

/**
 * LongBitSet stub — forward reference for player bit masks.
 *
 * OpenRA 对照: OpenRA.Primitives/LongBitSet.cs
 */
export interface LongBitSetStub<_T> {
  contains(value: number): boolean
  isEmpty(): boolean
}

// ---------------------------------------------------------------------------
// IGameActor — forward interface for Actor (avoids circular dependency)
// ---------------------------------------------------------------------------

/**
 * Forward reference to the GameActor class.
 *
 * OpenRA 对照: OpenRA.Game/Actor.cs
 *
 * This interface exposes the members that trait interfaces need to interact
 * with actors. The full GameActor class (Phase D) implements this interface.
 * Pattern matches {@link IActorRef} — a lightweight contract to break
 * circular dependencies between traits and the actor container.
 *
 * Expanded in Phase D to include condition system, activity system,
 * and trait query delegation methods.
 */
export interface IGameActor {
  // -----------------------------------------------------------------------
  // Identity & state (Phase B — original, REQUIRED)
  // -----------------------------------------------------------------------

  /** Globally unique actor identifier.
   *
   * OpenRA 对照: Actor.ActorID
   */
  readonly actorId: number

  /** Whether this actor is currently in the game world.
   *
   * OpenRA 对照: Actor.IsInWorld
   */
  readonly isInWorld: boolean

  /** Whether this actor has been killed.
   *
   * OpenRA 对照: Actor.IsDead
   */
  readonly isDead: boolean

  /** Whether this actor has been disposed.
   *
   * OpenRA 对照: Actor.Disposed
   */
  readonly disposed: boolean

  // -----------------------------------------------------------------------
  // Core references (Phase D — optional to preserve compatibility with
  // minimal stub actors used in tests)
  // -----------------------------------------------------------------------

  /** The player that owns this actor.
   *
   * OpenRA 对照: Actor.Owner
   */
  owner?: PlayerStub | undefined

  /** The world this actor belongs to.
   *
   * OpenRA 对照: Actor.World
   */
  world?: WorldStub | undefined

  /** Static actor type metadata.
   *
   * OpenRA 对照: Actor.Info
   */
  info?: ActorInfoStub | undefined

  /** Whether this actor is flagged for deferred disposal.
   *
   * OpenRA 对照: Actor.WillDispose
   */
  willDispose?: boolean

  /** Replacement generation counter (incremented on upgrade / owner change).
   *
   * OpenRA 对照: Actor.Generation
   */
  generation?: number

  /** Whether the actor currently has no activity.
   *
   * OpenRA 对照: Actor.IsIdle
   */
  readonly isIdle?: boolean

  // -----------------------------------------------------------------------
  // Condition system (Phase D — optional for stub/minimal actors)
  // -----------------------------------------------------------------------

  /**
   * Grant a named condition to this actor.
   *
   * OpenRA 对照: Actor.GrantCondition(string)
   *
   * Conditions are reference-counted: granting the same condition twice
   * creates two tokens. The condition is removed only when ALL tokens
   * are revoked.
   *
   * @param condition — the condition name to grant
   * @returns a unique integer token for revocation, or -1 if condition
   *          is null/empty (InvalidConditionToken)
   */
  grantCondition?(condition: string): number

  /**
   * Revoke a previously granted condition by its token.
   *
   * OpenRA 对照: Actor.RevokeCondition(int)
   *
   * @param token — the token returned by grantCondition
   * @returns -1 (InvalidConditionToken) on success
   * @throws if the token is not valid
   */
  revokeCondition?(token: number): number

  /**
   * Check whether a condition is currently active (has at least one token).
   *
   * OpenRA 对照: conditionCache check (not a direct C# method, but equivalent
   *   to checking conditionCache[condition] > 0)
   *
   * @param condition — the condition name to check
   * @returns true if the condition is currently active
   */
  hasCondition?(condition: string): boolean

  /**
   * Check whether a revocation token is still valid.
   *
   * OpenRA 对照: Actor.TokenValid(int)
   *
   * @param token — the token to check
   * @returns true if the token is still valid for revocation
   */
  tokenValid?(token: number): boolean

  // -----------------------------------------------------------------------
  // Activity system (Phase D stubs, full impl Phase E — optional for stubs)
  // -----------------------------------------------------------------------

  /**
   * Queue an activity for this actor.
   *
   * OpenRA 对照: Actor.QueueActivity(Activity)
   *
   * If the actor has no current activity, the new activity starts immediately.
   * Otherwise, it is appended to the end of the activity chain.
   *
   * @param nextActivity — the activity to queue
   */
  queueActivity?(nextActivity: ActivityStub): void

  /**
   * Cancel the actor's current activity and all queued activities.
   *
   * OpenRA 对照: Actor.CancelActivity()
   */
  cancelActivity?(): void

  // -----------------------------------------------------------------------
  // Trait lookup (optional — available when trait system is built out)
  // -----------------------------------------------------------------------

  /** Get all traits on this actor implementing the specified interface.
   *
   * OpenRA 对照: Actor.TraitsImplementing<T>()
   *
   * Returns trait instances matching the interface identifier.
   * Optional method — stub actors may not support trait lookup.
   *
   * @param interfaceId — unique string identifier for the interface
   * @param typeGuard — optional type guard for type-safe filtering
   * @returns array of matching trait instances
   */
  traitsImplementing?(interfaceId: string): unknown[]

  /** Kill this actor (HP to 0, invoking death notifications).
   *
   * OpenRA 对照: Actor.Kill(Actor attacker)
   *
   * Optional method — stub actors may not support kill.
   *
   * @param attacker — the actor that caused the kill
   */
  kill?(attacker: IGameActor): void

  /** Dispose this actor (silently remove from world).
   *
   * OpenRA 对照: Actor.Dispose()
   *
   * Optional method — stub actors may not support dispose.
   */
  dispose?(): void
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Damage state flags for actor health visualization.
 *
 * OpenRA 对照: DamageState (Flags enum)
 */
export const DamageState = {
  Undamaged: 1,
  Light: 2,
  Medium: 4,
  Heavy: 8,
  Critical: 16,
  Dead: 32,
} as const

export type DamageState = (typeof DamageState)[keyof typeof DamageState]

/**
 * Player diplomatic relationship flags.
 *
 * OpenRA 对照: PlayerRelationship (Flags enum)
 */
export const PlayerRelationship = {
  None: 0,
  Enemy: 1,
  Neutral: 2,
  Ally: 4,
} as const

export type PlayerRelationship = (typeof PlayerRelationship)[keyof typeof PlayerRelationship]

/** Extension helpers for PlayerRelationship bitwise checks. */
export const PlayerRelationshipExts = {
  /** Check if a relationship value has a specific relationship flag set. */
  hasRelationship(r: PlayerRelationship, relationship: PlayerRelationship): boolean {
    return (r & relationship) === relationship
  },
} as const

/**
 * Target modifier flags for order targeting (force-attack, force-queue, force-move).
 *
 * OpenRA 对照: TargetModifiers (Flags enum)
 */
export const TargetModifiers = {
  None: 0,
  ForceAttack: 1,
  ForceQueue: 2,
  ForceMove: 4,
} as const

export type TargetModifiers = (typeof TargetModifiers)[keyof typeof TargetModifiers]

/** Extension helpers for TargetModifiers bitwise checks. */
export const TargetModifiersExts = {
  hasModifier(self: TargetModifiers, m: TargetModifiers): boolean {
    return (self & m) === m
  },
} as const

// ---------------------------------------------------------------------------
// PlaceBuildingCellType — placement validity flags
// OpenRA 对照: PlaceBuildingCellType (Flags enum in PlaceBuildingOrderGenerator.cs)
// ---------------------------------------------------------------------------

/** Placement validity flags for building placement preview.
 *
 * OpenRA 对照: PlaceBuildingCellType { None = 0, Valid = 1, Invalid = 2, LineBuild = 4 }
 */
export const PlaceBuildingCellType = {
  None: 0,
  Valid: 1,
  Invalid: 2,
  LineBuild: 4,
} as const

export type PlaceBuildingCellType =
  (typeof PlaceBuildingCellType)[keyof typeof PlaceBuildingCellType]

// ---------------------------------------------------------------------------
// EnterBehaviour — how actors enter transports
// OpenRA 对照: EnterBehaviour { Exit = 0, Suicide = 1, Dispose = 2 }
// ---------------------------------------------------------------------------

/** Behaviour when an actor enters a transport.
 *
 * OpenRA 对照: EnterBehaviour enum
 *
 * Exit:    The actor exits normally (can re-enter).
 * Suicide: The actor is killed (used by demolition/saboteur).
 * Dispose: The actor is silently removed.
 */
export const EnterBehaviour = {
  Exit: 0,
  Suicide: 1,
  Dispose: 2,
} as const

export type EnterBehaviour = (typeof EnterBehaviour)[keyof typeof EnterBehaviour]

/**
 * Post-process render pass type — determines when a post-process effect runs
 * in the render pipeline.
 *
 * OpenRA 对照: PostProcessPassType enum
 */
export const PostProcessPassType = {
  AfterShroud: 0,
  AfterWorld: 1,
  AfterActors: 2,
  AfterAnnotations: 3,
} as const

export type PostProcessPassType = (typeof PostProcessPassType)[keyof typeof PostProcessPassType]

/**
 * Selection priority modifier flags (Ctrl, Alt) for selection logic.
 *
 * OpenRA 对照: SelectionPriorityModifiers (Flags enum)
 */
export const SelectionPriorityModifiers = {
  None: 0,
  Ctrl: 1,
  Alt: 2,
} as const

export type SelectionPriorityModifiers =
  (typeof SelectionPriorityModifiers)[keyof typeof SelectionPriorityModifiers]

// ---------------------------------------------------------------------------
// Value classes
// ---------------------------------------------------------------------------

/**
 * Information about an attack event, passed to INotifyKilled and related
 * lifecycle handlers.
 *
 * OpenRA 对照: AttackInfo class
 */
export class AttackInfo {
  /** The damage dealt in this attack. */
  damage: Damage

  /** The actor that performed the attack. */
  attacker: IGameActor

  /** The resulting damage state after the attack. */
  damageState: DamageState

  /** The damage state before the attack. */
  previousDamageState: DamageState

  constructor(
    damage: Damage,
    attacker: IGameActor,
    damageState: DamageState,
    previousDamageState: DamageState,
  ) {
    this.damage = damage
    this.attacker = attacker
    this.damageState = damageState
    this.previousDamageState = previousDamageState
  }
}

/**
 * Damage value with associated damage type tags.
 *
 * OpenRA 对照: Damage class
 */
export class Damage {
  /** The numeric damage value. */
  readonly value: number

  /** The damage type tag(s) (bit set). */
  readonly damageTypes: BitSetStub<unknown>

  constructor(value: number, damageTypes?: BitSetStub<unknown>) {
    this.value = value
    this.damageTypes = damageTypes ?? { contains: () => false, isEmpty: () => true }
  }
}

// ---------------------------------------------------------------------------
// Marker interfaces (empty — used for type tagging only)
// ---------------------------------------------------------------------------

/**
 * Empty marker interface for trait info types.
 * All *Info interfaces (IHealthInfo, IFacingInfo, etc.) extend this.
 *
 * OpenRA 对照: ITraitInfoInterface
 */
export interface ITraitInfoInterface {
  // intentionally empty — marker interface
}

/**
 * Marker interface for traits that participate in network sync hashing.
 *
 * OpenRA 对照: ISync (marker interface)
 *
 * Any trait implementing ISync will have its hash included in the actor's
 * SyncHash computation for network desync detection.
 */
export interface ISync {
  // intentionally empty — marker interface
}

// ---------------------------------------------------------------------------
// Trait metadata interfaces
// ---------------------------------------------------------------------------

/**
 * Abstract base for trait configuration metadata.
 *
 * OpenRA 对照: TraitInfo abstract class
 *
 * In C#, TraitInfo is instantiated via reflection from YAML and has a
 * Create() factory method. In TypeScript, TraitInfo is a pure data
 * interface; construction logic moves to ActorConfig (Phase C).
 *
 * TODO-3.C.1: Integrate with ActorConfig for YAML/JSON deserialization.
 */
export interface ITraitInfo {
  /** Optional instance name for disambiguation when multiple traits of the
   * same type are on one actor.
   *
   * OpenRA 对照: TraitInfo.InstanceName
   */
  readonly instanceName?: string
}

// ---------------------------------------------------------------------------
// 1. Update / Render interfaces
// ---------------------------------------------------------------------------

/**
 * Called every game tick (locked at 25 TPS, paused when the game is paused).
 * Drives deterministic game logic updates.
 *
 * OpenRA 对照: ITick
 */
export interface ITick {
  tick(actor: IGameActor): void
}

/**
 * Called every render frame (variable frame rate, not affected by pause).
 * Drives visual interpolation and camera-dependent updates.
 *
 * OpenRA 对照: ITickRender
 */
export interface ITickRender {
  tickRender(wr: WorldRendererStub, actor: IGameActor): void
}

/**
 * Collects renderable objects for an actor into the render pipeline.
 *
 * OpenRA 对照: IRender
 */
export interface IRender {
  render(actor: IGameActor, wr: WorldRendererStub): readonly IRenderable[]
  screenBounds(actor: IGameActor, wr: WorldRendererStub): readonly RectangleStub[]
}

/** Renderable object stub — will be refined when SpriteRenderable is migrated. */
export interface IRenderable {
  // minimal stub
}

/** Rectangle stub for screen bounds. */
export interface RectangleStub {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * Provides a polygon for mouse hit-testing on an actor.
 *
 * OpenRA 对照: IMouseBounds
 */
export interface IMouseBounds {
  mouseoverBounds(actor: IGameActor, wr: WorldRendererStub): PolygonStub
}

/** Minimal marker for mouse bound info types. */
export interface IMouseBoundsInfo extends ITraitInfoInterface {
  // marker
}

/** Polygon stub. */
export interface PolygonStub {
  readonly vertices: readonly { readonly x: number; readonly y: number }[]
}

/**
 * Provides an automatic rectangular mouse bound for an actor.
 *
 * OpenRA 对照: IAutoMouseBounds
 */
export interface IAutoMouseBounds {
  autoMouseoverBounds(actor: IGameActor, wr: WorldRendererStub): RectangleStub
}

/**
 * Modifies an actor's renderable objects before they enter the render pipeline.
 * Allows traits to add visual effects (e.g., cloaking, selection boxes).
 *
 * OpenRA 对照: IRenderModifier
 */
export interface IRenderModifier {
  modifyRender(
    actor: IGameActor,
    wr: WorldRendererStub,
    r: readonly IRenderable[],
  ): readonly IRenderable[]

  // HACK: This is here to support the WithShadow trait.
  // That trait should be rewritten using standard techniques, and then this
  // interface method removed
  modifyScreenBounds(
    actor: IGameActor,
    wr: WorldRendererStub,
    r: readonly RectangleStub[],
  ): readonly RectangleStub[]
}

/**
 * Renders above the world (on top of terrain, below actors).
 *
 * OpenRA 对照: IRenderAboveWorld
 */
export interface IRenderAboveWorld {
  renderAboveWorld(actor: IGameActor, wr: WorldRendererStub): void
}

/**
 * Renders the shroud (fog-of-war) layer.
 *
 * OpenRA 对照: IRenderShroud
 */
export interface IRenderShroud {
  renderShroud(wr: WorldRendererStub): void
}

/**
 * Renders terrain into the world.
 *
 * OpenRA 对照: IRenderTerrain
 */
export interface IRenderTerrain {
  renderTerrain(wr: WorldRendererStub, viewport: ViewportStub): void
}

/** Viewport stub. */
export interface ViewportStub {
  readonly topLeft: CPos
  readonly bottomRight: CPos
}

/**
 * Provides terrain lighting tints per cell position.
 *
 * OpenRA 对照: ITerrainLighting
 */
export interface ITerrainLighting {
  /** Fires when lighting for a cell changes. */
  onCellChanged: ((cell: unknown) => void) | null

  /**
   * Get the light tint at a world position.
   *
   * OpenRA 对照: ITerrainLighting.TintAt(WPos)
   */
  tintAt(pos: WPos): { readonly x: number; readonly y: number; readonly z: number }
}

/**
 * Renders above the shroud layer (visible even through fog-of-war).
 *
 * OpenRA 对照: IRenderAboveShroud
 */
export interface IRenderAboveShroud {
  renderAboveShroud(actor: IGameActor, wr: WorldRendererStub): readonly IRenderable[]
  readonly spatiallyPartitionable: boolean
}

/**
 * Renders above the shroud only when the actor is selected.
 *
 * OpenRA 对照: IRenderAboveShroudWhenSelected
 */
export interface IRenderAboveShroudWhenSelected {
  renderAboveShroud(actor: IGameActor, wr: WorldRendererStub): readonly IRenderable[]
  readonly spatiallyPartitionable: boolean
}

/**
 * Renders annotations (health bars, pips, etc.) on an actor.
 *
 * OpenRA 对照: IRenderAnnotations
 */
export interface IRenderAnnotations {
  renderAnnotations(actor: IGameActor, wr: WorldRendererStub): readonly IRenderable[]
  readonly spatiallyPartitionable: boolean
}

/**
 * Renders annotations only when the actor is selected.
 *
 * OpenRA 对照: IRenderAnnotationsWhenSelected
 */
export interface IRenderAnnotationsWhenSelected {
  renderAnnotations(actor: IGameActor, wr: WorldRendererStub): readonly IRenderable[]
  readonly spatiallyPartitionable: boolean
}

/**
 * Performs a post-process render pass at a specific point in the pipeline.
 *
 * OpenRA 对照: IRenderPostProcessPass
 */
export interface IRenderPostProcessPass {
  readonly type: PostProcessPassType
  readonly enabled: boolean
  draw(wr: WorldRendererStub): void
}

/**
 * Renders an overlay on top of the world.
 *
 * OpenRA 对照: IRenderOverlay
 */
export interface IRenderOverlay {
  render(wr: WorldRendererStub): void
}

// ---------------------------------------------------------------------------
// 2. Lifecycle Notification interfaces
// ---------------------------------------------------------------------------

/**
 * Called after the actor has been fully created (all traits initialized).
 *
 * OpenRA 对照: INotifyCreated
 */
export interface INotifyCreated {
  created(actor: IGameActor): void
}

/**
 * Called when the actor is added to the world (becomes active).
 * Traits register renderables, subscribe to events here.
 *
 * OpenRA 对照: INotifyAddedToWorld
 */
export interface INotifyAddedToWorld {
  addedToWorld(actor: IGameActor): void
}

/**
 * Called when the actor is removed from the world (exits game map).
 * Traits unregister renderables, unsubscribe from events here.
 *
 * OpenRA 对照: INotifyRemovedFromWorld
 */
export interface INotifyRemovedFromWorld {
  removedFromWorld(actor: IGameActor): void
}

/**
 * Called when the actor is being disposed. Last chance to release resources.
 *
 * OpenRA 对照: INotifyActorDisposing
 */
export interface INotifyActorDisposing {
  disposing(actor: IGameActor): void
}

/**
 * Called when the actor's owner changes.
 *
 * OpenRA 对照: INotifyOwnerChanged
 */
export interface INotifyOwnerChanged {
  onOwnerChanged(
    actor: IGameActor,
    oldOwner: PlayerStub,
    newOwner: PlayerStub,
  ): void
}

/**
 * Called when the actor's effective owner changes (e.g., mind control).
 *
 * OpenRA 对照: INotifyEffectiveOwnerChanged
 */
export interface INotifyEffectiveOwnerChanged {
  onEffectiveOwnerChanged(
    actor: IGameActor,
    oldEffectiveOwner: PlayerStub,
    newEffectiveOwner: PlayerStub,
  ): void
}

/**
 * Called when the actor loses its owner (owner defeated/disconnected).
 *
 * OpenRA 对照: INotifyOwnerLost
 */
export interface INotifyOwnerLost {
  onOwnerLost(actor: IGameActor): void
}

/**
 * Called when the actor is killed (HP reaches 0).
 *
 * OpenRA 对照: INotifyKilled
 */
export interface INotifyKilled {
  killed(actor: IGameActor, attackInfo: AttackInfo): void
}

/**
 * Called when the actor takes damage from an attack.
 *
 * OpenRA 对照: INotifyDamage
 *
 * Handlers receive the attack information and can respond (e.g.,
 * FloatingSpriteEmitter resets its emission duration on damage).
 */
export interface INotifyDamage {
  damaged(actor: IGameActor, attackInfo: AttackInfo): void
}

/**
 * Called when the actor's damage state changes (e.g., Light -> Heavy).
 *
 * OpenRA 对照: INotifyDamageStateChanged
 *
 * Handlers can respond by swapping animations to damage variants
 * (e.g., WithIdleOverlay replaces its overlay with a damage-prefixed sequence).
 */
export interface INotifyDamageStateChanged {
  damageStateChanged(actor: IGameActor, attackInfo: AttackInfo): void
}

/**
 * Called when the actor is selected by the player.
 *
 * OpenRA 对照: INotifySelected
 */
export interface INotifySelected {
  selected(actor: IGameActor): void
}

/**
 * Called when the selection changes (not for a specific actor, global signal).
 *
 * OpenRA 对照: INotifySelection
 */
export interface INotifySelection {
  selectionChanged(): void
}

/**
 * Called when the actor becomes idle (no activity in queue).
 *
 * OpenRA 对照: INotifyBecomingIdle
 */
export interface INotifyBecomingIdle {
  onBecomingIdle(actor: IGameActor): void
}

/**
 * Called every tick when the actor is idle (has no queued activities).
 *
 * OpenRA 对照: INotifyIdle
 */
export interface INotifyIdle {
  tickIdle(actor: IGameActor): void
}

/**
 * Called when the world finishes loading.
 *
 * OpenRA 对照: IWorldLoaded
 */
export interface IWorldLoaded {
  worldLoaded(w: WorldStub, wr: WorldRendererStub): void
}

/** World stub for forward reference. */
export interface WorldStub {
  readonly actors: Iterable<IGameActor>
}

/**
 * Called after the world has loaded and all actors are initialized.
 *
 * OpenRA 对照: IPostWorldLoaded
 */
export interface IPostWorldLoaded {
  postWorldLoaded(w: WorldStub, wr: WorldRendererStub): void
}

/**
 * Called when a game is being loaded (before actors are created).
 *
 * OpenRA 对照: INotifyGameLoading
 */
export interface INotifyGameLoading {
  gameLoading(w: WorldStub): void
}

/**
 * Called after a game has been loaded.
 *
 * OpenRA 对照: INotifyGameLoaded
 */
export interface INotifyGameLoaded {
  gameLoaded(w: WorldStub): void
}

/**
 * Called after a game has been saved.
 *
 * OpenRA 对照: INotifyGameSaved
 */
export interface INotifyGameSaved {
  gameSaved(w: WorldStub, isAutoSave: boolean): void
}

/**
 * Called when a player disconnects from the game.
 *
 * OpenRA 对照: INotifyPlayerDisconnected
 */
export interface INotifyPlayerDisconnected {
  playerDisconnected(actor: IGameActor, p: PlayerStub): void
}

/**
 * Provides trait data for game save serialization.
 *
 * OpenRA 对照: IGameSaveTraitData
 */
export interface IGameSaveTraitData {
  issueTraitData(actor: IGameActor): MiniYamlStub[]
  resolveTraitData(actor: IGameActor, data: MiniYamlStub): void
}

// ---------------------------------------------------------------------------
// 3. Game Logic interfaces
// ---------------------------------------------------------------------------

/**
 * Handles a player-issued order.
 *
 * OpenRA 对照: IResolveOrder
 */
export interface IResolveOrder {
  resolveOrder(actor: IGameActor, order: Order): void
}

/**
 * Provides the set of orders that an actor can issue.
 *
 * OpenRA 对照: IIssueOrder
 */
export interface IIssueOrder {
  readonly orders: readonly IOrderTargeter[]
  issueOrder(
    actor: IGameActor,
    order: IOrderTargeter,
    target: TargetStub,
    queued: boolean,
  ): Order
}

/** Target stub for OrderTargeter. */
export interface TargetStub {
  // minimal stub — full Target defined in Target.ts
}

/**
 * Describes a specific order that can be issued (e.g., "Attack", "Move", "Deploy").
 *
 * OpenRA 对照: IOrderTargeter
 */
export interface IOrderTargeter {
  readonly orderID: string
  readonly orderPriority: number
  canTarget(
    actor: IGameActor,
    target: TargetStub,
    modifiers: TargetModifiers,
    cursor: string,
  ): boolean
  readonly isQueued: boolean
  targetOverridesSelection(
    actor: IGameActor,
    target: TargetStub,
    actorsAt: readonly IGameActor[],
    xy: CPos,
    modifiers: TargetModifiers,
  ): boolean
}

/**
 * Validates an order before it is sent to the server.
 *
 * OpenRA 对照: IValidateOrder
 */
export interface IValidateOrder {
  orderValidation(
    orderManager: unknown,
    world: WorldStub,
    clientId: number,
    order: Order,
  ): boolean
}

// ---------------------------------------------------------------------------
// IOrderGenerator — generates orders from player input
// OpenRA 对照: OpenRA.Orders.IOrderGenerator
// ---------------------------------------------------------------------------

/** Generates orders from player input (e.g., placing buildings, unit commands).
 *
 * OpenRA 对照: IOrderGenerator
 *
 * An order generator is an input mode that processes mouse/keyboard events
 * and produces Order objects. Examples: PlaceBuildingOrderGenerator,
 * UnitCommandOrderGenerator, etc.
 */
export interface IOrderGenerator {
  /** Unique key identifying this order generator (for serialization/hotkey lookup).
   *
   * OpenRA 对照: IOrderGenerator.OrderGeneratorKey (convention, not on C# interface)
   */
  readonly orderGeneratorKey: string

  /** Process mouse input and yield orders.
   *
   * OpenRA 对照: IOrderGenerator.Order(World, CPos, int2, MouseInput)
   *
   * @param world — the game world
   * @param cell — the map cell under the cursor
   * @param modifiers — keyboard modifiers active
   * @returns an iterable of orders (empty = no order)
   */
  order(
    world: WorldStub,
    cell: CPos,
    modifiers: TargetModifiers,
  ): Generator<Order | null>

  /** Called each logic tick to update state.
   *
   * OpenRA 对照: IOrderGenerator.Tick(World)
   */
  tick(world: WorldStub): void

  /** Render above the shroud layer (visible through fog-of-war).
   *
   * OpenRA 对照: IOrderGenerator.RenderAboveShroud(WorldRenderer, World)
   */
  renderAboveShroud(
    worldRenderer: WorldRendererStub,
    world: WorldStub,
  ): void

  /** Render annotations (range circles, grid lines) on top of everything.
   *
   * OpenRA 对照: IOrderGenerator.RenderAnnotations(WorldRenderer, World)
   */
  renderAnnotations(
    worldRenderer: WorldRendererStub,
    world: WorldStub,
  ): void

  /** Get the cursor for the given cell.
   *
   * OpenRA 对照: IOrderGenerator.GetCursor(World, CPos, int2, MouseInput)
   *
   * @param world — the game world
   * @param cell — the map cell under the cursor
   * @returns the cursor name string
   */
  getCursor(world: WorldStub, cell: CPos): string

  /** Handle a keyboard input event.
   *
   * OpenRA 对照: IOrderGenerator.HandleKeyPress(KeyInput)
   *
   * @param e — the key input event
   * @returns true if the event was handled (consumed)
   */
  handleKeyPress(e: unknown): boolean

  /** Handle a mouse input event.
   *
   * OpenRA 对照: IOrderGenerator is called via World.OrderGenerator, which
   *   dispatches mouse input through the active generator.
   *
   * @param mouseInput — the mouse input event
   * @returns true if the event was handled
   */
  handleMouseInput(mouseInput: unknown): boolean
}

/**
 * Provides a voice phrase for an order (audio feedback).
 *
 * OpenRA 对照: IOrderVoice
 */
export interface IOrderVoice {
  voicePhraseForOrder(actor: IGameActor, order: Order): string
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Trait info for health — provides max HP configuration.
 *
 * OpenRA 对照: IHealthInfo
 */
export interface IHealthInfo extends ITraitInfoInterface {
  readonly maxHP: number
}

/**
 * Health trait — tracks actor HP, damage state, and death.
 *
 * OpenRA 对照: IHealth
 */
export interface IHealth {
  readonly damageState: DamageState
  readonly hp: number
  readonly maxHP: number
  readonly displayHP: number
  readonly isDead: boolean

  inflictDamage(
    actor: IGameActor,
    attacker: IGameActor,
    damage: Damage,
    ignoreModifiers: boolean,
  ): void

  kill(
    actor: IGameActor,
    attacker: IGameActor,
    damageTypes: BitSetStub<unknown>,
  ): void
}

// ---------------------------------------------------------------------------
// Facing
// ---------------------------------------------------------------------------

/**
 * Trait info for facing — provides initial facing angle.
 *
 * OpenRA 对照: IFacingInfo
 */
export interface IFacingInfo extends ITraitInfoInterface {
  getInitialFacing(): WAngle
}

/**
 * Facing trait — actor's rotation/turret direction.
 *
 * OpenRA 对照: IFacing
 */
export interface IFacing {
  readonly turnSpeed: WAngle
  facing: WAngle
  readonly orientation: WRot
}

// ---------------------------------------------------------------------------
// Occupies space
// ---------------------------------------------------------------------------

/**
 * Info for space-occupying traits.
 *
 * OpenRA 对照: IOccupySpaceInfo
 */
export interface IOccupySpaceInfo extends ITraitInfoInterface {
  occupiedCells(
    info: ActorInfoStub,
    location: CPos,
    subCell?: SubCellEnum,
  ): ReadonlyMap<CPos, SubCellEnum>
  readonly sharesCell: boolean
}

/**
 * Space occupation trait — tracks which cells an actor occupies on the map.
 *
 * OpenRA 对照: IOccupySpace
 */
export interface IOccupySpace {
  readonly centerPosition: WPos
  readonly topLeft: CPos
  occupiedCells(): readonly OccupiedCell[]
}

/** A cell/sub-cell pair that an actor occupies. */
export interface OccupiedCell {
  readonly cell: CPos
  readonly subCell: SubCellEnum
}

// ---------------------------------------------------------------------------
// Targetable
// ---------------------------------------------------------------------------

/**
 * Info for targetable traits — what target types this actor has.
 *
 * OpenRA 对照: ITargetableInfo
 */
export interface ITargetableInfo extends ITraitInfoInterface {
  getTargetTypes(): BitSetStub<unknown>
}

/**
 * Targetable trait — makes an actor selectable as a target.
 *
 * OpenRA 对照: ITargetable
 */
export interface ITargetable {
  readonly targetTypes: BitSetStub<unknown>
  targetableBy(actor: IGameActor, byActor: IGameActor): boolean
  readonly requiresForceFire: boolean
}

/**
 * Provides multiple targetable positions for an actor (for range checks).
 *
 * OpenRA 对照: ITargetablePositions
 */
export interface ITargetablePositions {
  targetablePositions(actor: IGameActor): readonly WPos[]
}

// ---------------------------------------------------------------------------
// Targetable cells — list of cell/sub-cell pairs that can be targeted
// OpenRA 对照: ITargetableCells
// ---------------------------------------------------------------------------

/** A targetable cell/sub-cell pair. */
export interface TargetableCell {
  readonly cell: CPos
  readonly subCell: SubCellEnum
}

/** Provides the set of cells that can be targeted on this actor.
 *
 * OpenRA 对照: ITargetableCells
 */
export interface ITargetableCells {
  readonly targetableCells: readonly [CPos, SubCellEnum][]
}

// ---------------------------------------------------------------------------
// Demolishable
// OpenRA 对照: IDemolishableInfo + IDemolishable
// ---------------------------------------------------------------------------

/** Info for demolishable traits — validates if a target can be demolished.
 *
 * OpenRA 对照: IDemolishableInfo
 */
export interface IDemolishableInfo extends ITraitInfoInterface {
  /** Check whether the given actor is a valid demolition target.
   *
   * @param target — the actor to check for demolition
   * @param saboteur — the actor attempting the demolition
   * @returns true if the target can be demolished
   */
  readonly isValidTarget: (target: IGameActor, saboteur: IGameActor) => boolean
}

/** Marker on traits that can be demolished (e.g., Building, Bridge).
 *
 * OpenRA 对照: IDemolishable
 */
export interface IDemolishable {
  readonly demolishableInfo: IDemolishableInfo
}

// ---------------------------------------------------------------------------
// Place building decoration
// OpenRA 对照: IPlaceBuildingDecorationInfo
// ---------------------------------------------------------------------------

/** Marker interface for building decoration preview traits.
 *
 * OpenRA 对照: IPlaceBuildingDecorationInfo
 */
export interface IPlaceBuildingDecorationInfo extends ITraitInfoInterface {
  // intentionally empty — marker interface
}

// ---------------------------------------------------------------------------
// Place building preview
// OpenRA 对照: IPlaceBuildingPreviewGeneratorInfo + IPlaceBuildingPreview
//   (from PlaceBuildingOrderGenerator.cs)
// ---------------------------------------------------------------------------

/** Info for place-building preview generators.
 *
 * OpenRA 对照: IPlaceBuildingPreviewGeneratorInfo
 */
export interface IPlaceBuildingPreviewGeneratorInfo extends ITraitInfoInterface {
  readonly previewType: string

  /** Create a preview renderer for the given actor type.
   *
   * @param worldRenderer — the world renderer instance
   * @param actorInfo — info for the actor being placed
   * @param init — initialization dictionary
   * @returns a preview renderer
   */
  createPreview(
    worldRenderer: WorldRendererStub,
    actorInfo: ActorInfoStub,
    init: Map<string, unknown>,
  ): IPlaceBuildingPreview
}

/** Renders a preview of a building that is about to be placed.
 *
 * OpenRA 对照: IPlaceBuildingPreview
 */
export interface IPlaceBuildingPreview {
  /** Screen-space pixel offset from the cell center to the top-left corner of the preview. */
  readonly topLeftScreenOffset: { readonly x: number; readonly y: number }

  /** Advance the preview animation/logic by one tick. */
  tick(): void

  /** Render the building preview footprint overlay.
   *
   * @param worldRenderer — the world renderer
   * @param topLeft — the top-left cell of the placement
   * @param validCells — map of cell to placement validity
   * @returns renderable objects
   */
  render(
    worldRenderer: WorldRendererStub,
    topLeft: CPos,
    validCells: ReadonlyMap<number, PlaceBuildingCellType>,
  ): readonly IRenderable[]

  /** Render annotation overlay (e.g., range circles, grid lines).
   *
   * @param worldRenderer — the world renderer
   * @param topLeft — the top-left cell of the placement
   * @returns renderable annotations
   */
  renderAnnotations(
    worldRenderer: WorldRendererStub,
    topLeft: CPos,
  ): readonly IRenderable[]
}

// ---------------------------------------------------------------------------
// Temporary blocker
// ---------------------------------------------------------------------------

/**
 * Info marker for temporary blocker traits.
 *
 * OpenRA 对照: ITemporaryBlockerInfo
 */
export interface ITemporaryBlockerInfo extends ITraitInfoInterface {
  // marker
}

/**
 * Temporary blocker — an actor that can temporarily block cell passage.
 *
 * OpenRA 对照: ITemporaryBlocker
 */
export interface ITemporaryBlocker {
  canRemoveBlockage(actor: IGameActor, blocking: IGameActor): boolean
  isBlocking(actor: IGameActor, cell: CPos): boolean
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

/**
 * Info for move traits — target line color, speed config.
 *
 * OpenRA 对照: IMoveInfo
 */
export interface IMoveInfo extends ITraitInfoInterface {
  getTargetLineColor(): ColorStub
}

/** Color stub. */
export interface ColorStub {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * Central movement trait — provides movement activities and utilities.
 *
 * OpenRA 对照: IMove
 */
export interface IMove {
  /** Move to a target position/actor.
   *
   * OpenRA 对照: IMove.MoveTo(Target)
   */
  moveTo(source: IGameActor, target: Target): Activity

  /** Move to within a given range of a target.
   *
   * OpenRA 对照: IMove.MoveWithinRange(Target, WDist, WPos?, Target?)
   */
  moveWithinRange(
    source: IGameActor,
    target: Target,
    range: WDist,
    initialTarget?: Target,
  ): Activity

  /** Follow a target while staying within range of a second target.
   *
   * OpenRA 对照: IMove.MoveFollow(Target, WDist, WDist?, Target?)
   */
  moveFollow(
    source: IGameActor,
    target: Target,
    range: WDist,
    followTarget: Target,
    initialTarget?: Target,
  ): Activity

  /** Move to a target for attacking/interaction.
   *
   * OpenRA 对照: IMove.MoveToTarget(Target)
   */
  moveToTarget(source: IGameActor, target: Target): Activity

  /** Move onto a target's cell (for passenger/transport interactions).
   *
   * OpenRA 对照: IMove.MoveIntoTarget(Target)
   */
  moveIntoTarget(source: IGameActor, target: Target): Activity

  /** Move onto a target's position, facing a specific target.
   *
   * OpenRA 对照: IMove.MoveOntoTarget(Target, WAngle?, Target?)
   */
  moveOntoTarget(
    source: IGameActor,
    target: Target,
    facingTarget: Target,
  ): Activity

  /** Move to a specific world position (local/within-screen repositioning).
   *
   * OpenRA 对照: IMove.LocalMove(WPos)
   */
  localMove(source: IGameActor, destination: WPos): Activity

  /** Estimate the duration (in ticks) to move between two world positions.
   *
   * OpenRA 对照: IMove.EstimatedMoveDuration(WPos, WPos)
   */
  estimatedMoveDuration(source: IGameActor, from: WPos, to: WPos): number

  /** Find the nearest cell position that is reachable by this actor.
   *
   * OpenRA 对照: IMove.NearestMoveableCell(WPos)
   */
  nearestMoveableCell(source: IGameActor, target: WPos): CPos

  /** Check whether this actor can enter the target cell(s) right now.
   *
   * OpenRA 对照: IMove.CanEnterTargetNow(Target)
   */
  canEnterTargetNow(source: IGameActor, target: Target): boolean

  /** Bitfield-like string set tracking which movement types are currently active
   * (e.g., "Horizontal", "Turn", "Vertical").
   *
   * OpenRA 对照: IMove.CurrentMovementTypes
   */
  readonly currentMovementTypes: Set<string>
}

/**
 * Notification interface — called each tick while the actor is moving.
 *
 * OpenRA 对照: INotifyMoving
 */
export interface INotifyMoving {
  onNotifyMoving(self: IGameActor): void
}

/**
 * Notification interface — called when the actor finishes moving.
 *
 * OpenRA 对照: INotifyFinishedMoving
 */
export interface INotifyFinishedMoving {
  onNotifyFinishedMoving(self: IGameActor): void
}

/**
 * Wrapping movement — transforms a world position for map-edge wrapping.
 *
 * OpenRA 对照: IWrapMove
 */
export interface IWrapMove {
  onWrapMove(self: IGameActor, oldPos: WPos, newPos: WPos): WPos
}

/**
 * Notification interface — called when an actor's center position changes.
 *
 * OpenRA 对照: INotifyCenterPositionChanged
 */
export interface INotifyCenterPositionChanged {
  onCenterPositionChanged(self: IGameActor): void
}

/**
 * Notification interface — called when movement is blocked by another actor.
 *
 * OpenRA 对照: INotifyBlockingMove
 */
export interface INotifyBlockingMove {
  onNotifyBlockingMove(self: IGameActor, blocking: IGameActor): void
}

/**
 * Positionable trait — extends IOccupySpace with center-position updates
 * and map-leaving checks.
 *
 * OpenRA 对照: IPositionable
 */
export interface IPositionable extends IOccupySpace {
  /** Whether the center position can change in the current state.
   *
   * OpenRA 对照: IPositionable.CanCenterPositionChange
   */
  canCenterPositionChange(self: IGameActor): boolean

  /** Set the center position.
   *
   * OpenRA 对照: IPositionable.SetCenterPosition(WPos)
   */
  setCenterPosition(self: IGameActor, value: WPos): void

  /** Whether the actor is currently in the visible world area.
   *
   * OpenRA 对照: IPositionable.IsInWorld
   */
  isInWorld: boolean

  /** Whether the actor is currently leaving the map (e.g., aircraft flying off).
   *
   * OpenRA 对照: IPositionable.IsLeavingMap
   */
  isLeavingMap(self: IGameActor): boolean
}

// ---------------------------------------------------------------------------
// Crushable
// ---------------------------------------------------------------------------

/**
 * Crushable trait — an actor that can be crushed by other actors (e.g., infantry by tanks).
 *
 * OpenRA 对照: ICrushable
 */
export interface ICrushable {
  crushableBy(
    actor: IGameActor,
    crusher: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): boolean

  crushableByPlayerMask(
    actor: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): LongBitSetStub<unknown>
}

/**
 * Notification interface — called when an actor is crushed by another.
 *
 * OpenRA 对照: INotifyCrushed
 */
export interface INotifyCrushed {
  onCrush(
    actor: IGameActor,
    crusher: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): void

  warnCrush(
    actor: IGameActor,
    crusher: IGameActor,
    crushClasses: BitSetStub<unknown>,
  ): void
}

/**
 * Notification interface — called when an actor changes custom movement layers.
 *
 * OpenRA 对照: INotifyCustomLayerChanged
 */
export interface INotifyCustomLayerChanged {
  customLayerChanged(
    self: IGameActor,
    oldLayer: number,
    newLayer: number,
  ): void
}

/**
 * Modifies actor preview inits (e.g., map editor preview direction).
 *
 * OpenRA 对照: IActorPreviewInitModifier
 */
export interface IActorPreviewInitModifier {
  modifyActorPreviewInit(
    self: IGameActor,
    inits: Map<string, unknown>,
  ): void
}

/**
 * Modifies death actor inits (e.g., husk direction and speed).
 *
 * OpenRA 对照: IDeathActorInitModifier
 */
export interface IDeathActorInitModifier {
  modifyDeathActorInit(
    self: IGameActor,
    init: Map<string, unknown>,
  ): void
}

// ---------------------------------------------------------------------------
// Selectable
// ---------------------------------------------------------------------------

/**
 * Info for selectable traits — selection priority and voice.
 *
 * OpenRA 对照: ISelectableInfo
 */
export interface ISelectableInfo extends ITraitInfoInterface {
  readonly priority: number
  readonly priorityModifiers: SelectionPriorityModifiers
  readonly voice: string
}

/**
 * Selection management trait (usually on the Player actor).
 *
 * OpenRA 对照: ISelection
 */
export interface ISelection {
  readonly hash: number
  readonly actors: readonly IGameActor[]

  add(a: IGameActor): void
  remove(a: IGameActor): void
  contains(a: IGameActor): boolean
  combine(
    world: WorldStub,
    newSelection: readonly IGameActor[],
    isCombine: boolean,
    isClick: boolean,
  ): void
  clear(): void
  rolloverContains(a: IGameActor): boolean
  setRollover(actors: readonly IGameActor[]): void
}

// ---------------------------------------------------------------------------
// Control groups
// ---------------------------------------------------------------------------

/**
 * Info for control group traits.
 *
 * OpenRA 对照: IControlGroupsInfo
 */
export interface IControlGroupsInfo extends ITraitInfoInterface {
  readonly groups: readonly string[]
}

/**
 * Control group management trait (usually on the Player actor).
 *
 * OpenRA 对照: IControlGroups
 */
export interface IControlGroups {
  readonly groups: readonly string[]

  selectControlGroup(group: number): void
  createControlGroup(group: number): void
  addSelectionToControlGroup(group: number): void
  combineSelectionWithControlGroup(group: number): void
  addToControlGroup(a: IGameActor, group: number): void
  removeFromControlGroup(a: IGameActor): void
  getControlGroupForActor(a: IGameActor): number | undefined
  getActorsInControlGroup(group: number): readonly IGameActor[]
}

// ---------------------------------------------------------------------------
// Voiced
// ---------------------------------------------------------------------------

/**
 * Voiced trait — provides voice lines for an actor (acknowledgement, attack, etc.).
 *
 * OpenRA 对照: IVoiced
 */
export interface IVoiced {
  readonly voiceSet: string
  playVoice(actor: IGameActor, phrase: string, variant: string): boolean
  playVoiceLocal(
    actor: IGameActor,
    phrase: string,
    variant: string,
    volume: number,
  ): boolean
  hasVoice(actor: IGameActor, voice: string): boolean
}

// ---------------------------------------------------------------------------
// Stores resources
// ---------------------------------------------------------------------------

/**
 * Info for resource storage traits.
 *
 * OpenRA 对照: IStoresResourcesInfo
 */
export interface IStoresResourcesInfo extends ITraitInfoInterface {
  readonly resourceTypes: readonly string[]
}

/**
 * Resource storage trait (e.g., refinery, silo).
 *
 * OpenRA 对照: IStoresResources
 */
export interface IStoresResources {
  hasType(resourceType: string): boolean
  readonly capacity: number
  readonly contents: ReadonlyMap<string, number>
  readonly contentsSum: number

  /** Returns the amount of value that was NOT added (overflow). */
  addResource(resourceType: string, value: number): number

  /** Returns the amount of value that was NOT removed (underflow). */
  removeResource(resourceType: string, value: number): number
}

// ---------------------------------------------------------------------------
// Effective owner
// ---------------------------------------------------------------------------

/**
 * Effective owner trait — the actor may appear to belong to a different player
 * (e.g., spies disguised as enemy units).
 *
 * OpenRA 对照: IEffectiveOwner
 */
export interface IEffectiveOwner {
  readonly disguised: boolean
  readonly owner: PlayerStub | null
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/**
 * Info for tooltip traits.
 *
 * OpenRA 对照: ITooltipInfo
 */
export interface ITooltipInfo extends ITraitInfoInterface {
  tooltipForPlayerStance(stance: PlayerRelationship): string
  readonly isOwnerRowVisible: boolean
}

/**
 * Tooltip trait — provides a tooltip string for an actor.
 *
 * OpenRA 对照: ITooltip
 */
export interface ITooltip {
  readonly tooltipInfo: ITooltipInfo
  readonly owner: PlayerStub
}

/**
 * Provides tooltip text from a context-sensitive source.
 *
 * OpenRA 对照: IProvideTooltipInfo
 */
export interface IProvideTooltipInfo {
  isTooltipVisible(forPlayer: PlayerStub): boolean
  readonly tooltipText: string
}

// ---------------------------------------------------------------------------
// Disabled trait
// ---------------------------------------------------------------------------

/**
 * Disabled trait — marks a trait as temporarily disabled (e.g., EMP effect).
 *
 * OpenRA 对照: IDisabledTrait
 */
export interface IDisabledTrait {
  readonly isTraitDisabled: boolean
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Marker info for default visibility traits.
 *
 * OpenRA 对照: IDefaultVisibilityInfo
 */
export interface IDefaultVisibilityInfo extends ITraitInfoInterface {
  // marker
}

/**
 * Default visibility trait — determines if an actor is visible to a player.
 *
 * OpenRA 对照: IDefaultVisibility
 */
export interface IDefaultVisibility {
  isVisible(actor: IGameActor, byPlayer: PlayerStub): boolean
}

/**
 * Visibility modifier — can override default visibility (e.g., cloaking).
 *
 * OpenRA 对照: IVisibilityModifier
 */
export interface IVisibilityModifier {
  isVisible(actor: IGameActor, byPlayer: PlayerStub): boolean
}

// ---------------------------------------------------------------------------
// Actor map (spatial index)
// ---------------------------------------------------------------------------

/**
 * Spatial index of all actors on the map. Provides cell-based and
 * proximity-based queries.
 *
 * OpenRA 对照: IActorMap
 *
 * NOTE: This is a large interface. Implementation may be split across
 * multiple classes in the spatial indexing module.
 */
export interface IActorMap {
  getActorsAt(a: CPos): readonly IGameActor[]
  getActorsAt(a: CPos, sub: SubCellEnum): readonly IGameActor[]
  hasFreeSubCell(cell: CPos, checkTransient?: boolean): boolean
  freeSubCell(
    cell: CPos,
    preferredSubCell?: SubCellEnum,
    checkTransient?: boolean,
  ): SubCellEnum
  freeSubCell(
    cell: CPos,
    preferredSubCell: SubCellEnum,
    checkIfBlocker: (a: IGameActor) => boolean,
  ): SubCellEnum
  anyActorsAt(a: CPos): boolean
  anyActorsAt(a: CPos, sub: SubCellEnum, checkTransient?: boolean): boolean
  anyActorsAt(
    a: CPos,
    sub: SubCellEnum,
    withCondition: (a: IGameActor) => boolean,
  ): boolean
  allActors(): readonly IGameActor[]
  addInfluence(actor: IGameActor, ios: IOccupySpace): void
  removeInfluence(actor: IGameActor, ios: IOccupySpace): void
  addCellTrigger(
    cells: readonly CPos[],
    onEntry: (a: IGameActor) => void,
    onExit: (a: IGameActor) => void,
  ): number
  triggerPositions(): readonly CPos[]
  removeCellTrigger(id: number): void
  addProximityTrigger(
    pos: WPos,
    range: WDist,
    vRange: WDist,
    onEntry: (a: IGameActor) => void,
    onExit: (a: IGameActor) => void,
  ): number
  removeProximityTrigger(id: number): void
  updateProximityTrigger(
    id: number,
    newPos: WPos,
    newRange: WDist,
    newVRange: WDist,
  ): void
  addPosition(a: IGameActor, ios: IOccupySpace): void
  removePosition(a: IGameActor, ios: IOccupySpace): void
  updatePosition(a: IGameActor, ios: IOccupySpace): void
  actorsInBox(a: WPos, b: WPos): readonly IGameActor[]
  readonly largestActorRadius: WDist
  readonly largestBlockingActorRadius: WDist
  updateOccupiedCells(ios: IOccupySpace): void
  onCellUpdated: ((c: CPos) => void) | null
}

// ---------------------------------------------------------------------------
// Palette / rendering support
// ---------------------------------------------------------------------------

/**
 * Palette loading from filesystem.
 *
 * OpenRA 对照: ILoadsPalettes
 */
export interface ILoadsPalettes {
  loadPalettes(wr: WorldRendererStub): void
}

/**
 * Player-specific palette loading.
 *
 * OpenRA 对照: ILoadsPlayerPalettes
 */
export interface ILoadsPlayerPalettes {
  loadPlayerPalettes(
    wr: WorldRendererStub,
    playerName: string,
    playerColor: ColorStub,
    replaceExisting: boolean,
  ): void
}

/**
 * Palette modification after loading.
 *
 * OpenRA 对照: IPaletteModifier
 */
export interface IPaletteModifier {
  adjustPalette(b: ReadonlyMap<string, MutablePaletteStub>): void
}

/** MutablePalette stub. */
export interface MutablePaletteStub {
  // minimal stub
}

/**
 * Provides a cursor palette from the filesystem.
 *
 * OpenRA 对照: IProvidesCursorPaletteInfo
 */
export interface IProvidesCursorPaletteInfo extends ITraitInfoInterface {
  readonly palette: string
  readPalette(fileSystem: IReadOnlyFileSystemStub): ImmutablePaletteStub
}

/** ImmutablePalette stub. */
export interface ImmutablePaletteStub {
  // minimal stub
}

/**
 * Tileset-specific palette info marker.
 *
 * OpenRA 对照: ITilesetSpecificPaletteInfo
 */
export interface ITilesetSpecificPaletteInfo extends ITraitInfoInterface {
  readonly tileset: string
}

// ---------------------------------------------------------------------------
// Selection bars / decorations
// ---------------------------------------------------------------------------

/**
 * Selection bar (health bar above selected unit).
 *
 * OpenRA 对照: ISelectionBar
 */
export interface ISelectionBar {
  getValue(): number
  getColor(): ColorStub
  readonly displayWhenEmpty: boolean
}

/**
 * Selection decorations (pips, status icons on selected units).
 *
 * OpenRA 对照: ISelectionDecorations
 */
export interface ISelectionDecorations {
  renderSelectionAnnotations(
    actor: IGameActor,
    worldRenderer: WorldRendererStub,
    color: ColorStub,
  ): readonly IRenderable[]

  getDecorationOrigin(
    actor: IGameActor,
    wr: WorldRendererStub,
    pos: string,
    margin: { readonly x: number; readonly y: number },
  ): { readonly x: number; readonly y: number }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

/**
 * Marker for editor selection layer traits.
 *
 * OpenRA 对照: IEditorSelectionLayer
 */
export interface IEditorSelectionLayer extends ITraitInfoInterface {
  // marker
}

/**
 * Marker for editor paste layer traits.
 *
 * OpenRA 对照: IEditorPasteLayer
 */
export interface IEditorPasteLayer extends ITraitInfoInterface {
  // marker
}

/**
 * Map preview signature info.
 *
 * OpenRA 对照: IMapPreviewSignatureInfo
 */
export interface IMapPreviewSignatureInfo extends ITraitInfoInterface {
  populateMapPreviewSignatureCells(
    map: unknown,
    ai: ActorInfoStub,
    s: unknown,
    destinationBuffer: { readonly uv: unknown; readonly color: ColorStub }[],
  ): void
}

// ---------------------------------------------------------------------------
// Map generator
// ---------------------------------------------------------------------------

/**
 * Map generator info.
 *
 * OpenRA 对照: IMapGeneratorInfo
 */
export interface IMapGeneratorInfo extends ITraitInfoInterface {
  readonly type: string
  readonly name: string
  readonly mapTitle: string

  generate(modData: unknown, args: unknown): unknown
  tryGenerateMetadata(modData: unknown, args: unknown): {
    players: unknown
    rules: Map<string, unknown>
  } | null
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------

/**
 * Bot info — configuration for AI bot players.
 *
 * OpenRA 对照: IBotInfo
 */
export interface IBotInfo extends ITraitInfoInterface {
  readonly type: string
  readonly name: string
}

/**
 * Bot trait — AI controller for a player.
 *
 * OpenRA 对照: IBot
 */
export interface IBot {
  activate(p: PlayerStub): void
  queueOrder(order: Order): void
  readonly info: IBotInfo
  readonly player: PlayerStub
}

// ---------------------------------------------------------------------------
// AI BotModule interfaces (Phase D)
// ---------------------------------------------------------------------------

/**
 * Called when the bot is enabled (receives the IBot reference for order queuing).
 *
 * OpenRA 对照: IBotEnabled
 */
export interface IBotEnabled {
  botEnabled(bot: IBot): void
}

/**
 * Called each logic tick on enabled bot modules.
 *
 * OpenRA 对照: IBotTick
 */
export interface IBotTick {
  botTick(bot: IBot): void
}

/**
 * Called when an owned actor is damaged — allows AI to respond to attacks.
 *
 * OpenRA 对照: IBotRespondToAttack
 */
export interface IBotRespondToAttack {
  respondToAttack(bot: IBot, self: IGameActor, e: AttackInfo): void
}

/**
 * Called when the bot's base or defense center changes.
 *
 * OpenRA 对照: IBotPositionsUpdated
 */
export interface IBotPositionsUpdated {
  updatedBaseCenter(newLocation: CPos): void
  updatedDefenseCenter(newLocation: CPos): void
}

/**
 * Called when the set of idle units around the base changes.
 *
 * OpenRA 对照: IBotNotifyIdleBaseUnits
 */
export interface IBotNotifyIdleBaseUnits {
  updatedIdleBaseUnits(idleUnits: IGameActor[]): void
}

/**
 * Allows bot modules to request production of specific unit types.
 *
 * OpenRA 对照: IBotRequestUnitProduction
 */
export interface IBotRequestUnitProduction {
  requestUnitProduction(bot: IBot, requestedActor: string): void
  requestedProductionCount(bot: IBot, requestedActor: string): number
}

/**
 * Allows bot modules to pause unit production (e.g., when refinery count is low).
 *
 * OpenRA 对照: IBotRequestPauseUnitProduction
 */
export interface IBotRequestPauseUnitProduction {
  readonly pauseUnitProduction: boolean
}

/**
 * Allows bot modules to trigger base expansion.
 *
 * OpenRA 对照: IBotBaseExpansion
 */
export interface IBotBaseExpansion {
  updateExpansionParams(bot: IBot, fallback: boolean, undeployEvenNoBase: boolean, mustUndeploy: IGameActor | null): void
}

/**
 * Allows bot modules to suggest refinery placement locations.
 *
 * OpenRA 对照: IBotSuggestRefineryProduction
 */
export interface IBotSuggestRefineryProduction {
  requestLocation(refineryLocation: CPos, conyardLocation: CPos, expandActor: IGameActor): void
}

/**
 * ConditionalTraitInfo — trait info that can be enabled/disabled by conditions.
 *
 * OpenRA 对照: ConditionalTraitInfo abstract class
 *
 * In OpenRA, ConditionalTraitInfo extends TraitInfo and adds RequiresCondition.
 * In TypeScript, this is a marker interface.
 */
export interface ConditionalTraitInfo extends ITraitInfo {
  readonly requiresCondition?: string
}

// NOTE: ConditionalTrait class is defined after Component below,
// because it extends Component.

/**
 * Warhead trait — applies damage effects on impact.
 *
 * OpenRA 对照: IWarhead
 */
export interface IWarhead {
  readonly delay: number
  isValidAgainst(victim: IGameActor, firedBy: IGameActor): boolean
  isValidAgainstFrozen(victim: FrozenActorStub, firedBy: IGameActor): boolean
  doImpact(target: TargetStub, args: unknown): void
}

// ---------------------------------------------------------------------------
// Ruleset loaded
// ---------------------------------------------------------------------------

/**
 * Called when a ruleset is loaded — allows traits to resolve references.
 *
 * OpenRA 对照: IRulesetLoaded<TInfo>
 */
export interface IRulesetLoaded<TInfo = ActorInfoStub> {
  rulesetLoaded(ruleset: RulesetStub, info: TInfo): void
}

/** Marker — extends IRulesetLoaded<ActorInfo>. */
export interface IRulesetLoadedMarker extends IRulesetLoaded<ActorInfoStub>, ITraitInfoInterface {
  // marker
}

// ---------------------------------------------------------------------------
// Create players
// ---------------------------------------------------------------------------

/**
 * Creates player objects when a game starts.
 *
 * OpenRA 对照: ICreatePlayers
 */
export interface ICreatePlayers {
  createPlayers(w: WorldStub, playerRandom: MersenneTwisterStub): void
}

/**
 * Info for player creation traits.
 *
 * OpenRA 对照: ICreatePlayersInfo
 */
export interface ICreatePlayersInfo extends ITraitInfoInterface {
  createServerPlayers(
    map: MapPreviewStub,
    session: SessionStub,
    players: unknown[],
    playerRandom: MersenneTwisterStub,
  ): void
}

// ---------------------------------------------------------------------------
// Assign spawn points
// ---------------------------------------------------------------------------

/**
 * Assigns spawn/home locations for players.
 *
 * OpenRA 对照: IAssignSpawnPoints
 */
export interface IAssignSpawnPoints {
  assignHomeLocation(
    world: WorldStub,
    client: unknown,
    playerRandom: MersenneTwisterStub,
  ): CPos

  spawnPointForPlayer(player: PlayerStub): number
}

/**
 * Info for spawn point assignment traits.
 *
 * OpenRA 对照: IAssignSpawnPointsInfo
 */
export interface IAssignSpawnPointsInfo extends ITraitInfoInterface {
  initializeState(map: MapPreviewStub, lobbyInfo: SessionStub): unknown
  assignSpawnPoint(
    state: unknown,
    lobbyInfo: SessionStub,
    client: unknown,
    playerRandom: MersenneTwisterStub,
  ): number
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

/**
 * Called when the game ends.
 *
 * OpenRA 对照: IGameOver
 */
export interface IGameOver {
  gameOver(w: WorldStub): void
}

// ---------------------------------------------------------------------------
// Render player unlock
// ---------------------------------------------------------------------------

/**
 * Unlocks render player (spectator mode).
 *
 * OpenRA 对照: IUnlocksRenderPlayer
 */
export interface IUnlocksRenderPlayer {
  readonly renderPlayerUnlocked: boolean
}

// ---------------------------------------------------------------------------
// Creation activity
// ---------------------------------------------------------------------------

/**
 * Provides a creation activity for an actor (e.g., building construction).
 *
 * OpenRA 对照: ICreationActivity
 */
export interface ICreationActivity {
  getCreationActivity(): ActivityStub | null
}

/**
 * Activity stub — forward reference to the full Activity class.
 *
 * OpenRA 对照: OpenRA.Game/Activities/Activity.cs
 *
 * This interface exposes the minimal surface that IGameActor needs:
 * queue (append to chain), cancel (abort), and onActorDisposeOuter
 * (cleanup on actor disposal). The full Activity class (Phase F)
 * implements this interface plus many additional methods.
 *
 * After Phase F, ActivityStub is structurally compatible with Activity.
 */
export interface ActivityStub {
  /** Append an activity to the end of the chain.
   *
   * OpenRA 对照: Activity.Queue(Activity)
   */
  queue(activity: ActivityStub): void

  /** Cancel this activity, notifying it that it was aborted.
   *
   * OpenRA 对照: Activity.Cancel(Actor)
   */
  cancel(actor: IGameActor): void

  /** Called when the actor is being disposed, for cascading cleanup.
   *
   * OpenRA 对照: Activity.OnActorDisposeOuter(Actor)
   */
  onActorDisposeOuter(actor: IGameActor): void
}

// ---------------------------------------------------------------------------
// Lobby options
// ---------------------------------------------------------------------------

/**
 * Provides lobby options for map configuration.
 *
 * OpenRA 对照: ILobbyOptions
 */
export interface ILobbyOptions extends ITraitInfoInterface {
  lobbyOptions(map: MapPreviewStub): readonly LobbyOptionStub[]
}

/** LobbyOption stub. */
export interface LobbyOptionStub {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly values: ReadonlyMap<string, string>
  readonly defaultValue: string
  readonly isLocked: boolean
  readonly isVisible: boolean
  readonly displayOrder: number
}

// ---------------------------------------------------------------------------
// 4. Dependency / State interfaces
// ---------------------------------------------------------------------------

/**
 * Observes variable changes (used by condition/upgrade system).
 *
 * OpenRA 对照: IObservesVariables
 */
export interface IObservesVariables {
  getVariableObservers(): readonly VariableObserver[]
}

/**
 * Info marker for variable observing traits.
 *
 * OpenRA 对照: IObservesVariablesInfo
 */
export interface IObservesVariablesInfo extends ITraitInfoInterface {
  // marker
}

/**
 * Callback signature for variable change notifications.
 *
 * OpenRA 对照: VariableObserverNotifier delegate
 */
export type VariableObserverNotifier = (
  actor: IGameActor,
  variables: ReadonlyMap<string, number>,
) => void

/**
 * A variable observer — binds a set of variable names to a callback.
 *
 * OpenRA 对照: VariableObserver (readonly record struct)
 */
export interface VariableObserver {
  readonly notifier: VariableObserverNotifier
  readonly variables: readonly string[]
}

// ---------------------------------------------------------------------------
// Dependency tag interfaces (conceptual — validated at build time)
// ---------------------------------------------------------------------------

/**
 * Tag interface declaring that this trait REQUIRES another trait of type T.
 *
 * OpenRA 对照: Requires<T>
 *
 * NOTE: In C# this is a compile-time constraint validated by ActorInfo's
 * topological sort. In TypeScript, this becomes a conceptual marker.
 * Validation is performed at build time by JSON Schema and/or
 * ActorConfig.validateDependencies().
 *
 * TODO-3.C.1: Integrate with ActorConfig dependency validation.
 */
export interface Requires<_T extends ITraitInfoInterface> {
  // Intentionally empty — this is a conceptual marker interface.
  // TypeScript cannot enforce "you must implement this alongside T"
  // at compile time; we use build-time validation instead.
}

/**
 * Tag interface declaring that this trait must NOT be created BEFORE
 * another trait of type T.
 *
 * OpenRA 对照: NotBefore<T>
 *
 * NOTE: Same conceptual treatment as Requires<T> — runtime code can
 * inspect this via type metadata, but compilation does not enforce it.
 *
 * TODO-3.C.1: Integrate with ActorConfig dependency validation.
 */
export interface NotBefore<_T extends ITraitInfoInterface> {
  // intentionally empty — conceptual marker
}

/**
 * Lobby custom rules ignore marker.
 *
 * OpenRA 对照: ILobbyCustomRulesIgnore
 */
export interface ILobbyCustomRulesIgnore {
  // intentionally empty — marker
}

/**
 * Activity interface marker.
 *
 * OpenRA 对照: IActivityInterface
 */
export interface IActivityInterface {
  // intentionally empty — marker
}

// ---------------------------------------------------------------------------
// Component — abstract base class for all Traits
// ---------------------------------------------------------------------------

/**
 * Abstract base class for all trait components.
 *
 * OpenRA 对照: N/A (C# uses object + reflection; TS needs explicit base)
 *
 * Every trait (logic or render) extends Component. Lifecycle methods are
 * non-abstract with empty defaults — subclasses override only what they need.
 *
 * To register with TypeDictionary, each subclass MUST declare:
 * ```
 * static readonly interfaces: string[] = ['ITick', 'INotifyCreated', 'component']
 * ```
 * listing all interface/type names this component implements (including
 * all parent class names).
 */
export abstract class Component {
  /** The actor this component is attached to, or null if not yet attached.
   *
   * OpenRA 对照: N/A (C# traits receive Actor via method parameters)
   */
  protected _actor: IGameActor | null = null

  /** Whether this component is currently enabled.
   *
   * OpenRA 对照: IDisabledTrait.IsTraitDisabled (inverted)
   */
  protected _enabled: boolean = true

  /** Whether this component has been disposed. */
  protected _disposed: boolean = false

  // -----------------------------------------------------------------------
  // Lifecycle (non-abstract — subclasses override what they need)
  // -----------------------------------------------------------------------

  /**
   * Called when this component is attached to an actor.
   *
   * OpenRA 对照: N/A (C# uses constructor injection; TS needs explicit attach)
   *
   * Override to perform initialization that requires the actor reference.
   * Always call `super.attach(actor)` first in overrides.
   *
   * @param actor — the actor this component is being attached to
   */
  attach(actor: IGameActor): void {
    this._actor = actor
  }

  /**
   * Called when this component is detached from its actor.
   *
   * OpenRA 对照: N/A (C# uses IDisposable pattern; TS needs explicit detach)
   *
   * Override to release resources and unsubscribe from events.
   * Always call `super.detach()` LAST in overrides (cleanup before clearing ref).
   *
   * @param actor — the actor this component was attached to
   */
  detach(actor: IGameActor): void {
    if (this._actor === actor) {
      this._actor = null
    }
  }

  /**
   * Called when the component's enabled state changes.
   *
   * OpenRA 对照: N/A (C# uses conditions system; TS hook for state changes)
   *
   * @param enabled — the new enabled state
   */
  onEnabledChanged(enabled: boolean): void {
    this._enabled = enabled
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** The actor this component is attached to. */
  get actor(): IGameActor | null {
    return this._actor
  }

  /** Whether this component is currently enabled. */
  get enabled(): boolean {
    return this._enabled
  }

  /** Whether this component has been disposed. */
  get disposed(): boolean {
    return this._disposed
  }

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  /**
   * Dispose this component, releasing all resources.
   *
   * Override to clean up GPU resources, event subscriptions, etc.
   * Always call `super.dispose()` LAST in overrides.
   */
  dispose(): void {
    this._disposed = true
    this._actor = null
  }
}

// ---------------------------------------------------------------------------
// ConditionalTrait — abstract base for condition-enabled traits
// ---------------------------------------------------------------------------

/**
 * ConditionalTrait — abstract base for traits that can be enabled/disabled.
 *
 * OpenRA 对照: ConditionalTrait<Info> abstract class
 *
 * Subclasses must:
 * - Check isTraitDisabled before performing any actions
 * - Override traitEnabled/traitDisabled for enable/disable lifecycle
 * - Handle the requiresCondition expression
 *
 * NOTE: This extends Component so it integrates with the actor-trait system.
 */
export abstract class ConditionalTrait<TInfo extends ConditionalTraitInfo> extends Component {
  /** User-facing configuration for this trait. */
  readonly info: TInfo

  /** Whether this trait is currently disabled by conditions. */
  get isTraitDisabled(): boolean {
    return !this._enabled
  }

  /** Whether this trait is currently paused (not disabled, but no ammo).
   *
   *  OpenRA 对照: PausableConditionalTrait.IsTraitPaused
   *
   *  Paused traits are enabled but cannot act (e.g., weapon has no ammo).
   *  Subclasses should set this to true/false as ammo state changes.
   */
  protected _paused: boolean = false

  /** Whether this trait is currently paused (enabled but unable to act).
   *
   *  OpenRA 对照: PausableConditionalTrait.IsTraitPaused
   */
  get isTraitPaused(): boolean {
    return this._paused
  }

  constructor(info: TInfo) {
    super()
    this.info = info
  }

  /**
   * Check if the condition expression is currently satisfied.
   *
   * OpenRA 对照: TraitEnabled check (condition system evaluation)
   *
   * Full condition expression evaluator supporting:
   * - Named conditions (e.g., "building")
   * - Negation with `!` (e.g., "!disabled")
   * - Conjunction with `&&` (e.g., "building && powered")
   * - Disjunction with `||` (e.g., "building || deployed")
   * - Parenthesized groups (e.g., "(A && B) || C")
   *
   * @param hasCondition — function to check if a named condition is active
   * @returns true if conditions allow this trait to be enabled
   */
  protected checkConditions(hasCondition: (condition: string) => boolean): boolean {
    if (!this.info.requiresCondition) return true
    return ConditionalTrait._evaluateConditionExpression(
      this.info.requiresCondition.trim(),
      hasCondition,
    )
  }

  /**
   * Recursive descent expression evaluator for condition strings.
   *
   * Precedence (lowest to highest):
   *   1. `||`  (disjunction)
   *   2. `&&`  (conjunction)
   *   3. `!`   (negation, prefix)
   *   4. `(...)`  (parenthesized group)
   *   5. name  (terminal — condition lookup)
   *
   * @param expr — the condition expression string (WHITESPACE-TRIMMED by caller)
   * @param hasCondition — the condition lookup function
   * @returns the boolean result of evaluating this expression
   */
  private static _evaluateConditionExpression(
    expr: string,
    hasCondition: (condition: string) => boolean,
  ): boolean {
    // --- || (lowest precedence) ---
    {
      let depth = 0
      for (let i = 0; i < expr.length - 1; i++) {
        const c = expr[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        else if (depth === 0 && c === '|' && expr[i + 1] === '|') {
          return ConditionalTrait._evaluateConditionExpression(
            expr.substring(0, i).trim(),
            hasCondition,
          ) || ConditionalTrait._evaluateConditionExpression(
            expr.substring(i + 2).trim(),
            hasCondition,
          )
        }
      }
    }

    // --- && ---
    {
      let depth = 0
      for (let i = 0; i < expr.length - 1; i++) {
        const c = expr[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        else if (depth === 0 && c === '&' && expr[i + 1] === '&') {
          return ConditionalTrait._evaluateConditionExpression(
            expr.substring(0, i).trim(),
            hasCondition,
          ) && ConditionalTrait._evaluateConditionExpression(
            expr.substring(i + 2).trim(),
            hasCondition,
          )
        }
      }
    }

    // --- ! (prefix negation) ---
    if (expr.startsWith('!')) {
      return !ConditionalTrait._evaluateConditionExpression(
        expr.substring(1).trim(),
        hasCondition,
      )
    }

    // --- ( ... ) parenthesized group ---
    if (expr.startsWith('(') && expr.endsWith(')')) {
      return ConditionalTrait._evaluateConditionExpression(
        expr.substring(1, expr.length - 1).trim(),
        hasCondition,
      )
    }

    // --- terminal: named condition ---
    return expr.length > 0 ? hasCondition(expr) : true
  }

  /**
   * Called when the trait is enabled (conditions satisfied).
   *
   * OpenRA 对照: TraitEnabled(Actor)
   */
  protected traitEnabled(_actor: IGameActor): void {
    this._enabled = true
  }

  /**
   * Called when the trait is disabled (conditions not satisfied).
   *
   * OpenRA 对照: TraitDisabled(Actor)
   */
  protected traitDisabled(_actor: IGameActor): void {
    this._enabled = false
  }
}

// ---------------------------------------------------------------------------
// BehaviorComponent — base for rendering traits that use Babylon.js
// ---------------------------------------------------------------------------

/**
 * Abstract base class for rendering-related traits that integrate with
 * Babylon.js behavior system.
 *
 * OpenRA 对照: N/A (C# rendering traits directly implement IRender, etc.)
 *
 * BehaviorComponent combines the Component lifecycle with Babylon.js
 * Behavior<T> pattern. Rendering traits (RenderSprites, WithInfantryBody,
 * etc.) extend this class rather than plain Component.
 *
 * NOTE: Full integration with Babylon.js Behavior<T> will be implemented
 * when rendering traits are migrated (Phase G+). For now, this is a stub
 * extending Component that marks traits requiring render-scene access.
 *
 * @typeParam T — the Babylon.js node type this behavior attaches to
 */
export abstract class BehaviorComponent<
  _T = unknown,
> extends Component {
  // NOTE: When Babylon.js integration is complete, this will:
  // 1. Accept a BABYLON.Behavior<T> compatible interface
  // 2. Register with scene.onBeforeRenderObservable
  // 3. Integrate with Babylon's node lifecycle
  //
  // For now, rendering traits use this as a type tag to distinguish
  // themselves from logic-only Component subclasses.
}

// ---------------------------------------------------------------------------
// Type guard functions
// ---------------------------------------------------------------------------

/**
 * Type guard for ITick.
 *
 * OpenRA 对照: typeof(ITick).IsAssignableFrom(obj.GetType())
 */
export function isITick(obj: unknown): obj is ITick {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tick' in obj &&
    typeof (obj as Record<string, unknown>).tick === 'function'
  )
}

/**
 * Type guard for ITickRender.
 */
export function isITickRender(obj: unknown): obj is ITickRender {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tickRender' in obj &&
    typeof (obj as Record<string, unknown>).tickRender === 'function'
  )
}

/**
 * Type guard for IRender.
 */
export function isIRender(obj: unknown): obj is IRender {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'render' in obj &&
    typeof (obj as Record<string, unknown>).render === 'function' &&
    'screenBounds' in obj &&
    typeof (obj as Record<string, unknown>).screenBounds === 'function'
  )
}

/**
 * Type guard for INotifyCreated.
 */
export function isINotifyCreated(obj: unknown): obj is INotifyCreated {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'created' in obj &&
    typeof (obj as Record<string, unknown>).created === 'function'
  )
}

/**
 * Type guard for INotifyAddedToWorld.
 */
export function isINotifyAddedToWorld(obj: unknown): obj is INotifyAddedToWorld {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'addedToWorld' in obj &&
    typeof (obj as Record<string, unknown>).addedToWorld === 'function'
  )
}

/**
 * Type guard for INotifyRemovedFromWorld.
 */
export function isINotifyRemovedFromWorld(
  obj: unknown,
): obj is INotifyRemovedFromWorld {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'removedFromWorld' in obj &&
    typeof (obj as Record<string, unknown>).removedFromWorld === 'function'
  )
}

/**
 * Type guard for INotifyActorDisposing.
 */
export function isINotifyActorDisposing(
  obj: unknown,
): obj is INotifyActorDisposing {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'disposing' in obj &&
    typeof (obj as Record<string, unknown>).disposing === 'function'
  )
}

/**
 * Type guard for INotifyKilled.
 */
export function isINotifyKilled(obj: unknown): obj is INotifyKilled {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'killed' in obj &&
    typeof (obj as Record<string, unknown>).killed === 'function'
  )
}

/**
 * Type guard for IResolveOrder.
 */
export function isIResolveOrder(obj: unknown): obj is IResolveOrder {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'resolveOrder' in obj &&
    typeof (obj as Record<string, unknown>).resolveOrder === 'function'
  )
}

/**
 * Type guard for IIssueOrder.
 */
export function isIIssueOrder(obj: unknown): obj is IIssueOrder {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'issueOrder' in obj &&
    typeof (obj as Record<string, unknown>).issueOrder === 'function' &&
    'orders' in obj
  )
}

/**
 * Type guard for INotifySelected.
 */
export function isINotifySelected(obj: unknown): obj is INotifySelected {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'selected' in obj &&
    typeof (obj as Record<string, unknown>).selected === 'function'
  )
}

/**
 * Type guard for INotifySelection.
 */
export function isINotifySelection(obj: unknown): obj is INotifySelection {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'selectionChanged' in obj &&
    typeof (obj as Record<string, unknown>).selectionChanged === 'function'
  )
}

/**
 * Type guard for INotifyBecomingIdle.
 */
export function isINotifyBecomingIdle(
  obj: unknown,
): obj is INotifyBecomingIdle {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'onBecomingIdle' in obj &&
    typeof (obj as Record<string, unknown>).onBecomingIdle === 'function'
  )
}

/**
 * Type guard for INotifyIdle.
 */
export function isINotifyIdle(obj: unknown): obj is INotifyIdle {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tickIdle' in obj &&
    typeof (obj as Record<string, unknown>).tickIdle === 'function'
  )
}

/**
 * Type guard for INotifyOwnerChanged.
 */
export function isINotifyOwnerChanged(
  obj: unknown,
): obj is INotifyOwnerChanged {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'onOwnerChanged' in obj &&
    typeof (obj as Record<string, unknown>).onOwnerChanged === 'function'
  )
}

/**
 * Type guard for IOccupySpace.
 */
export function isIOccupySpace(obj: unknown): obj is IOccupySpace {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'centerPosition' in obj &&
    'topLeft' in obj &&
    'occupiedCells' in obj &&
    typeof (obj as Record<string, unknown>).occupiedCells === 'function'
  )
}

/**
 * Type guard for ITargetable.
 */
export function isITargetable(obj: unknown): obj is ITargetable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'targetTypes' in obj &&
    'targetableBy' in obj &&
    typeof (obj as Record<string, unknown>).targetableBy === 'function' &&
    'requiresForceFire' in obj
  )
}

/**
 * Type guard for IFacing.
 */
export function isIFacing(obj: unknown): obj is IFacing {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'turnSpeed' in obj &&
    'facing' in obj &&
    'orientation' in obj
  )
}

/**
 * Type guard for IHealth.
 */
export function isIHealth(obj: unknown): obj is IHealth {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'damageState' in obj &&
    'hp' in obj &&
    'maxHP' in obj &&
    'isDead' in obj &&
    'inflictDamage' in obj &&
    typeof (obj as Record<string, unknown>).inflictDamage === 'function'
  )
}

/**
 * Type guard for IRenderAboveShroud.
 */
export function isIRenderAboveShroud(
  obj: unknown,
): obj is IRenderAboveShroud {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'renderAboveShroud' in obj &&
    typeof (obj as Record<string, unknown>).renderAboveShroud === 'function'
  )
}

/**
 * Type guard for IRenderAnnotations.
 */
export function isIRenderAnnotations(
  obj: unknown,
): obj is IRenderAnnotations {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'renderAnnotations' in obj &&
    typeof (obj as Record<string, unknown>).renderAnnotations === 'function'
  )
}

/**
 * Type guard for IWorldLoaded.
 */
export function isIWorldLoaded(obj: unknown): obj is IWorldLoaded {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'worldLoaded' in obj &&
    typeof (obj as Record<string, unknown>).worldLoaded === 'function'
  )
}

/**
 * Type guard for IMove.
 */
export function isIMove(obj: unknown): obj is IMove {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'moveTo' in obj &&
    typeof (obj as Record<string, unknown>).moveTo === 'function' &&
    'nearestMoveableCell' in obj &&
    typeof (obj as Record<string, unknown>).nearestMoveableCell === 'function' &&
    'currentMovementTypes' in obj
  )
}

/**
 * Type guard for INotifyMoving.
 */
export function isINotifyMoving(obj: unknown): obj is INotifyMoving {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'onNotifyMoving' in obj &&
    typeof (obj as Record<string, unknown>).onNotifyMoving === 'function'
  )
}

/**
 * Type guard for IPositionable.
 */
export function isIPositionable(obj: unknown): obj is IPositionable {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'centerPosition' in obj &&
    'topLeft' in obj &&
    'occupiedCells' in obj &&
    typeof (obj as Record<string, unknown>).occupiedCells === 'function' &&
    'canCenterPositionChange' in obj &&
    typeof (obj as Record<string, unknown>).canCenterPositionChange === 'function' &&
    'setCenterPosition' in obj &&
    typeof (obj as Record<string, unknown>).setCenterPosition === 'function' &&
    'isInWorld' in obj &&
    'isLeavingMap' in obj &&
    typeof (obj as Record<string, unknown>).isLeavingMap === 'function'
  )
}

// ---------------------------------------------------------------------------
// Chapter 10 — Resource & Economy System interfaces
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (Resource/Economy section)
//
// 核心范式转换:
// - C# BitSet<DockType> → number bitmask (power-of-2 values)
// - C# IDockHost (BitSet, DockClientManager refs) → TS IDockHost (number, unknown forward ref)
// - C# IResourceLayer CellChanged event → TS onCellChanged callback
// - C# ResourceLayerContents readonly struct → TS interface + Object.freeze() sentinel
// - C# out params (bool TryGet*) → TS return type | undefined
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DockType — docking type bitmask (for BitSet usage)
// OpenRA 对照: DockType (implicit flags from IDockHost/IDockClient usage)
// ---------------------------------------------------------------------------

/** Docking type bitmask values.
 *
 *  OpenRA 对照: DockType flags used with BitSet<DockType>
 *
 *  These are power-of-2 values for use with bitwise operations.
 *  Multiple types can be combined with bitwise OR.
 */
export const DockType = {
  Unload: 1,
  Repair: 2,
  Refuel: 4,
} as const

/** Numeric type for DockType bitmask values. */
export type DockTypeValue = number

// ---------------------------------------------------------------------------
// IDockHostInfo + IDockHost
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs lines 248-278
// ---------------------------------------------------------------------------

/** Marker info interface for docking host traits (e.g., Refinery, RepairPad).
 *
 *  OpenRA 对照: IDockHostInfo : ITraitInfoInterface
 */
export interface IDockHostInfo extends ITraitInfoInterface {
  // marker — no additional members
}

/** Docking host trait — an actor that other actors can dock at.
 *
 *  OpenRA 对照: IDockHost (lines 250-278)
 *
 *  NOTE: DockClientManager reference is typed as `unknown` since
 *  DockClientManager is not yet migrated (deferred to Chapter 14).
 *  QueueMoveActivity and QueueDockActivity are deferred to Chapter 14.
 */
export interface IDockHost {
  /** The docking types this host supports (bitmask of DockType values).
   *
   *  OpenRA 对照: IDockHost.GetDockType
   */
  readonly getDockType: DockTypeValue

  /** Whether this host is currently enabled and in the world.
   *
   *  OpenRA 对照: IDockHost.IsEnabledAndInWorld
   */
  readonly isEnabledAndInWorld: boolean

  /** Current number of reserved dock slots.
   *
   *  OpenRA 对照: IDockHost.ReservationCount
   */
  readonly reservationCount: number

  /** Whether this host can accept new reservations.
   *
   *  OpenRA 对照: IDockHost.CanBeReserved
   */
  readonly canBeReserved: boolean

  /** World position where docking clients should approach.
   *
   *  OpenRA 对照: IDockHost.DockPosition
   */
  readonly dockPosition: WPos

  /** Check whether a docking client can dock at this host.
   *
   *  OpenRA 对照: IDockHost.IsDockingPossible(Actor, IDockClient, bool)
   *
   *  Does NOT check DockType or whether the client is enabled.
   *
   *  @param clientActor — the actor that wants to dock
   *  @param client — the docking client trait (unknown until DockClientManager is migrated)
   *  @param ignoreReservations — if true, skip reservation checks
   *  @returns true if docking is possible at this host
   */
  isDockingPossible(
    clientActor: IGameActor,
    client: unknown,
    ignoreReservations?: boolean,
  ): boolean

  /** Reserve a dock slot for a client.
   *
   *  OpenRA 对照: IDockHost.Reserve(Actor, DockClientManager)
   *
   *  @param self — the host actor
   *  @param client — the docking client manager (unknown until Ch14)
   *  @returns true if the reservation was successful
   */
  reserve(self: IGameActor, client: unknown): boolean

  /** Release all dock reservations.
   *
   *  OpenRA 对照: IDockHost.UnreserveAll()
   */
  unreserveAll(): void
}

// ---------------------------------------------------------------------------
// IAcceptResources
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs line 351-354
// ---------------------------------------------------------------------------

/** Accepts resource deliveries (e.g., Refinery).
 *
 *  OpenRA 对照: IAcceptResources (lines 351-354)
 */
export interface IAcceptResources {
  /** Accept resources delivered by a harvester.
   *
   *  OpenRA 对照: IAcceptResources.AcceptResources(Actor, string, int)
   *
   *  @param self — the actor accepting resources
   *  @param resourceType — the type of resource being delivered
   *  @param count — the amount of resources to accept (default 1)
   *  @returns the amount actually accepted (less than count if storage is full)
   */
  acceptResources(
    self: IGameActor,
    resourceType: string,
    count?: number,
  ): number
}

// ---------------------------------------------------------------------------
// ResourceLayerContents
// OpenRA 对照: ResourceLayerContents (readonly struct in ResourceLayer.cs)
// ---------------------------------------------------------------------------

/** Contents of a resource cell — type and density.
 *
 *  OpenRA 对照: ResourceLayerContents (readonly struct)
 */
export interface ResourceLayerContents {
  /** The resource type identifier (e.g., "Tiberium", "Ore"), or empty string if none. */
  readonly type: string
  /** The density/amount of resource at this cell (0 if empty). */
  readonly density: number
}

/** Sentinel value for an empty resource cell.
 *
 *  OpenRA 对照: ResourceLayerContents.Empty (default struct)
 *
 *  Object.freeze() prevents accidental mutation of the shared empty sentinel.
 */
export const ResourceLayerContentsEmpty: ResourceLayerContents = Object.freeze({
  type: '',
  density: 0,
})

// ---------------------------------------------------------------------------
// IResourceLayerInfo + IResourceLayer
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs lines 814-834
// ---------------------------------------------------------------------------

/** Config info for the resource layer trait.
 *
 *  OpenRA 对照: IResourceLayerInfo : ITraitInfoInterface (lines 814-818)
 */
export interface IResourceLayerInfo extends ITraitInfoInterface {
  /** Try to get the terrain type associated with a resource type.
   *
   *  OpenRA 对照: IResourceLayerInfo.TryGetTerrainType(string, out string)
   *
   *  @param resourceType — the resource type to look up
   *  @returns the terrain type string, or undefined if not found
   */
  tryGetTerrainType(resourceType: string): string | undefined

  /** Try to get the resource index (byte) for a resource type.
   *
   *  OpenRA 对照: IResourceLayerInfo.TryGetResourceIndex(string, out byte)
   *
   *  @param resourceType — the resource type to look up
   *  @returns the resource index (0-255), or undefined if not found
   */
  tryGetResourceIndex(resourceType: string): number | undefined
}

/** World-level resource layer — manages the map's resource data.
 *
 *  OpenRA 对照: IResourceLayer (lines 820-834)
 *
 *  The ResourceLayer trait stores a CellLayer<ResourceLayerContents> that maps
 *  each map cell to its resource type and density. This interface provides
 *  the public API for querying and modifying resources.
 */
export interface IResourceLayer {
  /** Config info for this resource layer.
   *
   *  OpenRA 对照: IResourceLayer.Info
   */
  readonly info: IResourceLayerInfo

  /** Whether the resource layer has no resources.
   *
   *  OpenRA 对照: IResourceLayer.IsEmpty
   */
  readonly isEmpty: boolean

  /** Get the resource contents at a map cell.
   *
   *  OpenRA 对照: IResourceLayer.GetResource(CPos)
   *
   *  @param cell — the map cell to query
   *  @returns the resource contents (type and density), EMPTY if none
   */
  getResource(cell: CPos): ResourceLayerContents

  /** Get the maximum density for a resource type.
   *
   *  OpenRA 对照: IResourceLayer.GetMaxDensity(string)
   *
   *  @param resourceType — the resource type
   *  @returns the maximum density value
   */
  getMaxDensity(resourceType: string): number

  /** Check whether a resource can be added to a cell.
   *
   *  OpenRA 对照: IResourceLayer.CanAddResource(string, CPos, byte)
   *
   *  @param resourceType — the resource type to add
   *  @param cell — the target map cell
   *  @param amount — the amount to add (default 1)
   *  @returns true if the resource can be added
   */
  canAddResource(
    resourceType: string,
    cell: CPos,
    amount?: number,
  ): boolean

  /** Add resources to a cell, respecting MaxDensity.
   *
   *  OpenRA 对照: IResourceLayer.AddResource(string, CPos, byte)
   *
   *  @param resourceType — the resource type to add
   *  @param cell — the target map cell
   *  @param amount — the amount to add (default 1)
   *  @returns the amount actually added
   */
  addResource(
    resourceType: string,
    cell: CPos,
    amount?: number,
  ): number

  /** Remove resources from a cell.
   *
   *  OpenRA 对照: IResourceLayer.RemoveResource(string, CPos, byte)
   *
   *  @param resourceType — the resource type to remove
   *  @param cell — the target map cell
   *  @param amount — the amount to remove (default 1)
   *  @returns the amount actually removed
   */
  removeResource(
    resourceType: string,
    cell: CPos,
    amount?: number,
  ): number

  /** Clear all resources from a cell.
   *
   *  OpenRA 对照: IResourceLayer.ClearResources(CPos)
   *
   *  @param cell — the cell to clear
   */
  clearResources(cell: CPos): void

  /** Check whether resources at a cell are visible to the given player.
   *
   *  OpenRA 对照: IResourceLayer.IsVisible(CPos)
   *
   *  NOTE: Shroud integration deferred to Chapter 12. Initial implementation
   *  always returns true.
   *
   *  @param cell — the cell to check
   *  @returns true if resources at this cell are visible
   */
  isVisible(cell: CPos): boolean

  /** Callback fired when a cell's resource state changes.
   *
   *  OpenRA 对照: IResourceLayer.CellChanged (event Action<CPos, string>)
   *
   *  @param cell — the cell that changed
   *  @param resourceType — the new resource type, or null if the cell was cleared
   */
  onCellChanged(cell: CPos, resourceType: string | null): void
}

// ---------------------------------------------------------------------------
// IResourceRenderer
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs lines 837-844
// ---------------------------------------------------------------------------

/** Renders resources on the terrain using sprite layers.
 *
 *  OpenRA 对照: IResourceRenderer (lines 837-844)
 *
 *  The ResourceRenderer trait manages one TerrainSpriteLayer per resource type
 *  and updates sprite frames based on resource density changes.
 */
export interface IResourceRenderer {
  /** The set of resource type strings this renderer handles.
   *
   *  OpenRA 对照: IResourceRenderer.ResourceTypes
   */
  readonly resourceTypes: Iterable<string>

  /** Get the resource type rendered at a given cell.
   *
   *  OpenRA 对照: IResourceRenderer.GetRenderedResourceType(CPos)
   *
   *  @param cell — the map cell to query
   *  @returns the resource type string, or null if no resource is rendered there
   */
  getRenderedResourceType(cell: CPos): string | null

  /** Get the tooltip string for resources rendered at a given cell.
   *
   *  OpenRA 对照: IResourceRenderer.GetRenderedResourceTooltip(CPos)
   *
   *  @param cell — the map cell to query
   *  @returns the tooltip string, or null if no resource at this cell
   */
  getRenderedResourceTooltip(cell: CPos): string | null
}

// ---------------------------------------------------------------------------
// IResourceValueModifier
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs line 488
// ---------------------------------------------------------------------------

/** Modifies the cash value of resources (e.g., ResourcePurifier).
 *
 *  OpenRA 对照: IResourceValueModifier (line 488)
 *
 *  Stackable: multiple IResourceValueModifier traits multiply together.
 */
export interface IResourceValueModifier {
  /** Get the resource value modifier percentage.
   *
   *  OpenRA 对照: IResourceValueModifier.GetResourceValueModifier()
   *
   *  @returns the modifier as an integer percentage (100 = normal, 200 = double)
   */
  getResourceValueModifier(): number
}

// ---------------------------------------------------------------------------
// ISpeedModifier
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs line 449
// ---------------------------------------------------------------------------

/** Modifies an actor's movement speed (e.g., Harvester when fully loaded).
 *
 *  OpenRA 对照: ISpeedModifier (line 449)
 */
export interface ISpeedModifier {
  /** Get the speed modifier percentage.
   *
   *  OpenRA 对照: ISpeedModifier.GetSpeedModifier()
   *
   *  @returns the modifier as an integer percentage (100 = normal, 85 = 85% speed)
   */
  getSpeedModifier(): number
}

// ---------------------------------------------------------------------------
// INotifyCapture
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs line 179
// ---------------------------------------------------------------------------

/** Called when an actor is captured (e.g., Engineer capture).
 *
 *  OpenRA 对照: INotifyCapture (line 179)
 */
export interface INotifyCapture {
  /** Called when this actor is captured.
   *
   *  OpenRA 对照: INotifyCapture.OnCapture(Actor, Actor, Player, Player, BitSet<CaptureType>)
   *
   *  @param self — the captured actor
   *  @param captor — the actor that performed the capture
   *  @param oldOwner — the previous owner (PlayerStub until Player is fully migrated)
   *  @param newOwner — the new owner
   *  @param captureTypes — bitmask of capture types used
   */
  onCapture(
    self: IGameActor,
    captor: IGameActor,
    oldOwner: unknown,
    newOwner: unknown,
    captureTypes: number,
  ): void
}

// ---------------------------------------------------------------------------
// INotifySold
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs lines 69-73
// ---------------------------------------------------------------------------

/** Called when an actor is being sold.
 *
 *  OpenRA 对照: INotifySold (lines 69-73)
 */
export interface INotifySold {
  /** Called when the actor begins the sell process.
   *
   *  OpenRA 对照: INotifySold.Selling(Actor)
   *
   *  @param self — the actor being sold
   */
  selling(self: IGameActor): void

  /** Called when the actor has been sold.
   *
   *  OpenRA 对照: INotifySold.Sold(Actor)
   *
   *  @param self — the actor that was sold
   */
  sold(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyTransform
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs (transform lifecycle)
// ---------------------------------------------------------------------------

/** Called when an actor is about to transform into another actor type.
 *
 *  OpenRA 对照: INotifyTransform (BeforeTransform, OnTransform, AfterTransform)
 */
export interface INotifyTransform {
  /** Called before the actor transforms.
   *
   *  @param self — the actor about to transform
   */
  beforeTransform(self: IGameActor): void

  /** Called when the actor transforms.
   *
   *  @param self — the actor that is transforming
   */
  onTransform(self: IGameActor): void

  /** Called after the actor has transformed.
   *
   *  @param self — the actor that has transformed
   */
  afterTransform(self: IGameActor): void
}

// ---------------------------------------------------------------------------
// INotifyResourceAccepted
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs line 175
// ---------------------------------------------------------------------------

/** Called when a refinery accepts resources from a harvester.
 *
 *  OpenRA 对照: INotifyResourceAccepted (line 175)
 */
export interface INotifyResourceAccepted {
  /** Called when resources are accepted by a refinery.
   *
   *  OpenRA 对照: INotifyResourceAccepted.OnResourceAccepted(Actor, Actor, string, int, int)
   *
   *  @param self — the harvester (or resource donor)
   *  @param refinery — the refinery that accepted the resources
   *  @param resourceType — the type of resource accepted
   *  @param count — the amount of resource accepted
   *  @param value — the cash value of the accepted resources
   */
  onResourceAccepted(
    self: IGameActor,
    refinery: IGameActor,
    resourceType: string,
    count: number,
    value: number,
  ): void
}

// ---------------------------------------------------------------------------
// ISeedableResource
// OpenRA 对照: OpenRA.Mods.Common/TraitsInterfaces.cs line 187
// ---------------------------------------------------------------------------

/** A trait that can seed (spawn) resources around the actor.
 *
 *  OpenRA 对照: ISeedableResource (line 187)
 */
export interface ISeedableResource {
  /** Seed resources around this actor.
   *
   *  OpenRA 对照: ISeedableResource.Seed(Actor)
   *
   *  @param self — the actor seeding resources
   */
  seed(self: IGameActor): void
}
