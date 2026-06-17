/**
 * ScriptActorInterface.ts — Actor-scoped script access with trait filtering
 * OpenRA 对照: ScriptActorInterface.cs
 *
 * 核心范式转换:
 * - C# ActorCommands[actor.Info] filtered via reflection + HasAttribute
 *   → ScriptRegistry.getActorCommands() with trait name matching
 * - C# [ExposedForDestroyedActors] attribute
 *   → exposedForDestroyedActors: boolean on ActorPropertyRegistration
 * - C# CreateObjects() reflection-based constructor invocation
 *   → Direct new ctor(context, actor) from registration
 */

import type { IGameActor } from '../Traits/TraitsInterfaces.js'
import type { IScriptContext } from './ScriptMemberDescriptor.js'
import type { MemberDescriptor, ActorPropertyRegistration } from './ScriptMemberDescriptor.js'
import { ScriptObjectWrapper } from './ScriptObjectWrapper.js'
import { ScriptRegistry } from './ScriptRegistry.js'

// ---------------------------------------------------------------------------
// ScriptActorProperties — abstract base for actor-scoped property groups
// ---------------------------------------------------------------------------

/**
 * Abstract base class for trait-specific scripting properties on an actor.
 *
 * OpenRA 对照: ScriptActorProperties (ScriptContext.cs:48-53)
 *
 * Each subclass exposes trait methods to scripts (e.g., HealthProperties
 * exposes actor.Health, GeneralProperties exposes actor.IsDead).
 *
 * Subclasses use requiredTraits to declare which traits must be present on
 * the actor. ScriptActorInterface filters available property classes
 * based on the actor's actual trait set.
 *
 * Paradigm shift:
 * - C# constructor takes (ScriptContext, Actor) directly
 * - TS constructor takes (context, self) where self is IGameActor
 * - C# [ScriptPropertyGroup("category")] attribute → static readonly category + registerActorProperty
 */
export abstract class ScriptActorProperties {
  /** The actor these properties are bound to. */
  protected readonly self: IGameActor

  /** The owning ScriptContext. */
  protected readonly context: IScriptContext

  constructor(context: IScriptContext, self: IGameActor) {
    this.context = context
    this.self = self
  }

  /** The category this property group belongs to (e.g., "General", "Combat").
   *
   * OpenRA 对照: [ScriptPropertyGroup("category")] attribute
   *
   * Subclasses MUST override this with a static value.
   */
  static readonly category: string

  /** Required trait interface names for this property group.
   *
   * OpenRA 对照: Requires<TInfo> generic interface constraints
   *
   * Example: HealthProperties requires ['IHealthInfo']
   *
   * Empty array means no traits required (e.g., BaseActorProperties
   * for destroyed-actor-safe properties).
   */
  static readonly requiredTraits: readonly string[]

  /** Whether this property group is safe to access on destroyed actors.
   *
   * OpenRA 对照: [ExposedForDestroyedActors] attribute
   *
   * Only BaseActorProperties sets this to true.
   */
  static readonly exposedForDestroyedActors: boolean
}

// ---------------------------------------------------------------------------
// ScriptActorInterface — actor-scoped script wrapper
// ---------------------------------------------------------------------------

/**
 * Script-accessible interface for a specific game actor.
 *
 * OpenRA 对照: ScriptActorInterface (ScriptActorInterface.cs:16-56)
 *
 * Wraps an actor and exposes its trait-based property groups to scripts.
 * Automatically filters available commands based on the actor's traits
 * and alive/destroyed state.
 */
export class ScriptActorInterface extends ScriptObjectWrapper {
  /** The wrapped actor. */
  private readonly _actor: IGameActor

  /** The property class instances currently bound to this actor. */
  private _commandInstances = new Map<new (...args: any[]) => ScriptActorProperties, ScriptActorProperties>()

  /** The property registrations this interface was initialized with. */
  private _commandClasses: readonly ActorPropertyRegistration[] = []

  /** Cached trait info check function. */
  private _hasTraitInfoFn?: (traitName: string) => boolean

  /**
   * @param context — the owning ScriptContext
   * @param actor — the actor to wrap
   */
  constructor(context: IScriptContext, actor: IGameActor) {
    super(context)
    this._actor = actor
    this._initializeBindings()
  }

  // ---------------------------------------------------------------------------
  // Public accessors
  // ---------------------------------------------------------------------------

  /** The wrapped actor. */
  get actor(): IGameActor {
    return this._actor
  }

  // ---------------------------------------------------------------------------
  // Error Messages
  // ---------------------------------------------------------------------------

  protected override duplicateKeyError(memberName: string): string {
    return `Actor '${this._actor.info?.name ?? 'unknown'}' defines the command '${memberName}' on multiple traits`
  }

  protected override memberNotFoundError(memberName: string): string {
    let actorName = this._actor.info?.name ?? 'unknown'
    if (this._actor.isDead) actorName += ' (dead)'
    return `Actor '${actorName}' does not define a property '${memberName}'`
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Called when the actor is destroyed. Removes bindings for property
   * groups not marked ExposedForDestroyedActors.
   *
   * OpenRA 对照: ScriptActorInterface.OnActorDestroyed()
   */
  onActorDestroyed(): void {
    const commands = this._commandClasses
    for (const cmd of commands) {
      if (!cmd.exposedForDestroyedActors) {
        this.unbind(cmd.ctor as new (...args: any[]) => ScriptActorProperties)
        this._commandInstances.delete(
          cmd.ctor as new (...args: any[]) => ScriptActorProperties,
        )
      }
    }
  }

  /**
   * Re-initialize the bindings (used after trait changes, e.g., upgrades).
   */
  reinitializeBindings(): void {
    this._commandInstances.clear()
    this._initializeBindings()
  }

  // ---------------------------------------------------------------------------
  // Member Binding
  // ---------------------------------------------------------------------------

  /**
   * Select property groups and create instances.
   */
  private _initializeBindings(): void {
    if (!this._actor.info) return

    const hasTraitInfo = this._makeHasTraitInfoFn()

    this._commandClasses = ScriptRegistry.getActorCommands(
      this._actor.info,
      hasTraitInfo,
    )

    // If the actor is already destroyed, filter to ExposedForDestroyedActors only
    const filtered = this._actor.disposed
      ? this._commandClasses.filter(c => c.exposedForDestroyedActors)
      : this._commandClasses

    const instances: ScriptActorProperties[] = []
    for (const cmd of filtered) {
      const instance = new cmd.ctor(this.context, this._actor)
      this._commandInstances.set(
        cmd.ctor as new (...args: any[]) => ScriptActorProperties,
        instance,
      )
      instances.push(instance)
    }

    if (instances.length > 0) {
      this.bind(instances)
    }
  }

  /**
   * Get member descriptors from property instances.
   *
   * Each ScriptActorProperties subclass overrides getOwnMemberDescriptors()
   * to declare its public members.
   */
  protected override getMemberDescriptors(obj: object): MemberDescriptor[] {
    if (obj instanceof ScriptActorProperties) {
      return (obj as any).getOwnMemberDescriptors?.() ?? []
    }
    return []
  }

  /**
   * Set the trait info check function (used when actor info doesn't provide its own).
   */
  setHasTraitInfoFn(fn: (traitName: string) => boolean): void {
    this._hasTraitInfoFn = fn
  }

  /**
   * Check if the actor has a given trait info.
   *
   * OpenRA 对照: ActorInfo.HasTraitInfo<T>() — reflection-based
   *
   * In TS, this delegates to the actor's trait query system.
   */
  private _makeHasTraitInfoFn(): (traitName: string) => boolean {
    return (traitName: string): boolean => {
      if (this._hasTraitInfoFn) return this._hasTraitInfoFn(traitName)

      // Fallback: check if the actor itself has the trait
      const traits = this._actor.traitsImplementing?.(traitName)
      return (traits?.length ?? 0) > 0
    }
  }
}
