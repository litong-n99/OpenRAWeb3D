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
  readonly disguished: boolean
  readonly owner: PlayerStub
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
// Warhead
// ---------------------------------------------------------------------------

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
  getCreationActivity(): ActivityStub
}

/** Activity stub. */
export interface ActivityStub {
  // minimal stub — Activity system is Phase E
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
