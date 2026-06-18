/**
 * GeneralProperties.ts — Script-exposed General category properties for actors
 * OpenRA 对照: GeneralProperties.cs
 *
 * 核心范式转换:
 * - C# [ScriptPropertyGroup("General")] attribute → static readonly category = 'General'
 * - C# [ExposedForDestroyedActors] attribute → static readonly exposedForDestroyedActors = true
 * - C# Requires<TInfo> generic constraints → static readonly requiredTraits: string[]
 * - C# Self.QueueActivity(new SimpleTeleport(cell)) → this.self.queueActivity(...)
 * - C# LuaFunction parameter → ScriptCallable type
 * - C# FlashTarget effect → this.context.world.addEffect(...)
 */

import type { IGameActor, PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IScriptContext, MemberDescriptor } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { ScriptActorProperties } from '../../../OpenRA.Game/Scripting/ScriptActorInterface.js'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import { createActivity } from './activityHelpers.js'

// ---------------------------------------------------------------------------
// ScriptColor — lightweight color type (replaces OpenRA.Primitives.Color)
// ---------------------------------------------------------------------------

/** Script-accessible color value (replaces OpenRA Color struct for Flash). */
interface ScriptColor {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a?: number
}

// ---------------------------------------------------------------------------
// ScriptCallable — script-invoked callback (replaces LuaFunction)
// ---------------------------------------------------------------------------

type ScriptCallable = (...args: unknown[]) => unknown

// ===========================================================================
// BaseActorProperties — safe on destroyed actors, no trait queries
// ===========================================================================

/**
 * Base actor properties available even on destroyed actors.
 *
 * OpenRA 对照: BaseActorProperties (GeneralProperties.cs:26-96)
 *
 * This class MUST NOT make any trait queries so that it remains safe
 * to call on dead/disposed actors. Only accesses core IGameActor fields.
 */
export class BaseActorProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits: readonly string[] = [] // safe on all actors
  static readonly exposedForDestroyedActors = true

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
  }

  // ---- Properties ----

  /** Specifies whether the actor is in the world. */
  get IsInWorld(): boolean {
    return this.self.isInWorld
  }

  set IsInWorld(value: boolean) {
    const world = this.self.world as any
    if (value) {
      // Add actor to world at end of frame
      world?.addFrameEndTask?.((w: unknown) => (w as any).add?.(this.self))
    } else {
      world?.addFrameEndTask?.((w: unknown) => (w as any).remove?.(this.self))
    }
  }

  /** Specifies whether the actor is alive or dead. */
  get IsDead(): boolean {
    return this.self.isDead ?? false
  }

  /** Specifies whether the actor is idle (not performing any activities). */
  get IsIdle(): boolean {
    return this.self.isIdle ?? false
  }

  /** The player that owns the actor. */
  get Owner(): PlayerStub {
    return this.self.owner!
  }

  set Owner(value: PlayerStub) {
    if (value == null) {
      throw new Error(
        `Attempted to change the owner of actor '${this.self.info?.name ?? 'unknown'}' to nil value.`,
      )
    }
    const changeOwner = (this.self as any).changeOwner
    if (this.self.owner !== value && changeOwner) {
      changeOwner.call(this.self, value)
    }
  }

  /** The type of the actor (e.g. "e1"). */
  get Type(): string {
    return this.self.info?.name ?? ''
  }

  /** The effective (displayed) owner — may differ for disguised actors. */
  get EffectiveOwner(): PlayerStub {
    const effOwner = (this.self as any).effectiveOwner
    if (effOwner == null || effOwner.owner == null) {
      return this.self.owner!
    }
    return effOwner.owner
  }

  // ---- Methods ----

  /** Test whether an actor has a specific property. */
  HasProperty(name: string): boolean {
    return (this.self as any).hasScriptProperty?.(name) ?? false
  }

  /**
   * Render a target flash on the actor.
   * @param color — flash color { r, g, b, a? }
   * @param count — number of flashes (default 2)
   * @param interval — interval in ticks (default 2)
   * @param delay — initial delay in ticks (default 0)
   */
  Flash(
    color: ScriptColor,
    count: number = 2,
    interval: number = 2,
    delay: number = 0,
  ): void {
    const world = this.self.world as any
    if (world?.addEffect) {
      world.addEffect('FlashTarget', {
        target: this.self,
        color,
        duration: 0.5,
        count,
        interval,
        delay,
      })
    }
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'IsInWorld', returnType: 'boolean',
        description: 'Specifies whether the actor is in the world.',
        get: () => this.IsInWorld,
        set: (_, v) => { this.IsInWorld = v as boolean },
      },
      {
        memberType: 'property', name: 'IsDead', returnType: 'boolean',
        description: 'Specifies whether the actor is alive or dead.',
        get: () => this.IsDead,
      },
      {
        memberType: 'property', name: 'IsIdle', returnType: 'boolean',
        description: 'Specifies whether the actor is idle (not performing any activities).',
        get: () => this.IsIdle,
      },
      {
        memberType: 'property', name: 'Owner', returnType: 'Player',
        description: 'The player that owns the actor.',
        get: () => this.Owner,
        set: (_, v) => { this.Owner = v as PlayerStub },
      },
      {
        memberType: 'property', name: 'Type', returnType: 'string',
        description: 'The type of the actor (e.g. "e1").',
        get: () => this.Type,
      },
      {
        memberType: 'method', name: 'HasProperty', returnType: 'boolean',
        description: 'Test whether an actor has a specific property.',
        parameters: [{ name: 'name', type: 'string', optional: false }],
        invoke: (_, args) => this.HasProperty(args[0] as string),
      },
      {
        memberType: 'method', name: 'Flash', returnType: 'nil',
        description: 'Render a target flash on the actor.',
        parameters: [
          { name: 'color', type: 'table', optional: false },
          { name: 'count', type: 'number', optional: true, defaultValue: 2 },
          { name: 'interval', type: 'number', optional: true, defaultValue: 2 },
          { name: 'delay', type: 'number', optional: true, defaultValue: 0 },
        ],
        invoke: (_, args) => {
          this.Flash(
            args[0] as ScriptColor,
            args[1] as number,
            args[2] as number,
            args[3] as number,
          )
        },
      },
      {
        memberType: 'property', name: 'EffectiveOwner', returnType: 'Player',
        description: 'The effective (displayed) owner of the actor.',
        get: () => this.EffectiveOwner,
      },
    ]
  }
}

// ===========================================================================
// GeneralProperties — actor trait-dependent properties
// ===========================================================================

/**
 * General scripting properties requiring actor traits.
 *
 * OpenRA 对照: GeneralProperties (GeneralProperties.cs:98-197)
 */
export class GeneralProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits: readonly string[] = [] // no Requires<T> in C#
  static readonly exposedForDestroyedActors = false

  private readonly _autotarget: any | null
  private readonly _scriptTags: any | null
  private readonly _tooltips: any[]

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._autotarget = (self as any).trait?.('AutoTarget') ?? null
    this._scriptTags = (self as any).trait?.('ScriptTags') ?? null
    this._tooltips = (self as any).traitsImplementing?.('Tooltip') ?? []
  }

  // ---- Methods ----

  /** Instantly moves the actor to the specified cell. */
  Teleport(cell: unknown): void {
    this.self.queueActivity?.(createActivity('SimpleTeleport', { cell }))
  }

  /** Run an arbitrary script function within the actor's activity queue. */
  CallFunc(func: ScriptCallable): void {
    this.self.queueActivity?.(createActivity('CallScriptFunc', { func, context: this.context }))
  }

  /** Wait for a specified number of game ticks (25 ticks = 1 second). */
  Wait(ticks: number): void {
    this.self.queueActivity?.(createActivity('Wait', { ticks }))
  }

  /** Remove the actor from the game, without triggering any death notification. */
  Destroy(): void {
    this.self.queueActivity?.(createActivity('RemoveSelf'))
  }

  /** Attempt to cancel any active activities. */
  Stop(): void {
    (this.self as any).cancelActivity?.()
  }

  // ---- Properties ----

  /** Current actor stance. Returns nil if this actor doesn't support stances. */
  get Stance(): string | null {
    return this._autotarget?.stance?.toString() ?? null
  }

  set Stance(value: string | null) {
    if (this._autotarget == null || value == null) return
    const stance = (value as string).toLowerCase()
    if (!this._autotarget.setStance) {
      throw new Error(`Unknown stance type '${value}'`)
    }
    this._autotarget.setStance(this.self, stance)
  }

  /** The actor's tooltip display name. Returns nil if the actor has no tooltip. */
  get TooltipName(): string | null {
    const tooltip = this._tooltips.find((t: any) => !t.isDisabled)
    if (tooltip == null) return null
    return tooltip.info?.name ?? null
  }

  /** Specifies whether or not the actor supports tags. */
  get IsTaggable(): boolean {
    return this._scriptTags != null
  }

  /** Add a tag to the actor. Returns true on success. */
  AddTag(tag: string): boolean {
    return this.IsTaggable && (this._scriptTags!.addTag(tag) ?? false)
  }

  /** Remove a tag from the actor. Returns true on success. */
  RemoveTag(tag: string): boolean {
    return this.IsTaggable && (this._scriptTags!.removeTag(tag) ?? false)
  }

  /** Specifies whether or not the actor has a particular tag. */
  HasTag(tag: string): boolean {
    return this.IsTaggable && (this._scriptTags!.hasTag(tag) ?? false)
  }

  // ---- Descriptors ----

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'method', name: 'Teleport', returnType: 'nil',
        description: 'Instantly moves the actor to the specified cell.',
        parameters: [{ name: 'cell', type: 'CPos', optional: false }],
        invoke: (_, args) => { this.Teleport(args[0]) },
      },
      {
        memberType: 'method', name: 'CallFunc', returnType: 'nil',
        description: 'Run an arbitrary script function.',
        parameters: [{ name: 'func', type: 'function', optional: false }],
        invoke: (_, args) => { this.CallFunc(args[0] as ScriptCallable) },
      },
      {
        memberType: 'method', name: 'Wait', returnType: 'nil',
        description: 'Wait for a specified number of game ticks (25 ticks = 1 second).',
        parameters: [{ name: 'ticks', type: 'number', optional: false }],
        invoke: (_, args) => { this.Wait(args[0] as number) },
      },
      {
        memberType: 'method', name: 'Destroy', returnType: 'nil',
        description: 'Remove the actor from the game, without triggering any death notification.',
        parameters: [],
        invoke: () => { this.Destroy() },
      },
      {
        memberType: 'method', name: 'Stop', returnType: 'nil',
        description: 'Attempt to cancel any active activities.',
        parameters: [],
        invoke: () => { this.Stop() },
      },
      {
        memberType: 'property', name: 'Stance', returnType: 'string',
        description: 'Current actor stance. Returns nil if this actor doesn\'t support stances.',
        get: () => this.Stance,
        set: (_, v) => { this.Stance = v as string | null },
      },
      {
        memberType: 'property', name: 'TooltipName', returnType: 'string',
        description: 'The actor\'s tooltip display name. Returns nil if the actor has no tooltip.',
        get: () => this.TooltipName,
      },
      {
        memberType: 'property', name: 'IsTaggable', returnType: 'boolean',
        description: 'Specifies whether or not the actor supports tags.',
        get: () => this.IsTaggable,
      },
      {
        memberType: 'method', name: 'AddTag', returnType: 'boolean',
        description: 'Add a tag to the actor. Returns true on success.',
        parameters: [{ name: 'tag', type: 'string', optional: false }],
        invoke: (_, args) => this.AddTag(args[0] as string),
      },
      {
        memberType: 'method', name: 'RemoveTag', returnType: 'boolean',
        description: 'Remove a tag from the actor. Returns true on success.',
        parameters: [{ name: 'tag', type: 'string', optional: false }],
        invoke: (_, args) => this.RemoveTag(args[0] as string),
      },
      {
        memberType: 'method', name: 'HasTag', returnType: 'boolean',
        description: 'Specifies whether or not the actor has a particular tag.',
        parameters: [{ name: 'tag', type: 'string', optional: false }],
        invoke: (_, args) => this.HasTag(args[0] as string),
      },
    ]
  }
}

// ===========================================================================
// LocationProperties — actor position in cell/world coordinates
// ===========================================================================

/**
 * Actor location properties (cell + world position).
 *
 * OpenRA 对照: LocationProperties (GeneralProperties.cs:199-210)
 */
export class LocationProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits = ['IOccupySpaceInfo'] as const
  static readonly exposedForDestroyedActors = false

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
  }

  /** The actor position in cell coordinates. */
  get Location(): unknown {
    return (this.self as any).location ?? null
  }

  /** The actor position in world coordinates. */
  get CenterPosition(): unknown {
    return (this.self as any).centerPosition ?? null
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Location', returnType: 'CPos',
        description: 'The actor position in cell coordinates.',
        get: () => this.Location,
      },
      {
        memberType: 'property', name: 'CenterPosition', returnType: 'WPos',
        description: 'The actor position in world coordinates.',
        get: () => this.CenterPosition,
      },
    ]
  }
}

// ===========================================================================
// FacingProperties — actor facing direction
// ===========================================================================

/**
 * Actor facing direction property.
 *
 * OpenRA 对照: FacingProperties (GeneralProperties.cs:212-225)
 */
export class FacingProperties extends ScriptActorProperties {
  static readonly category = 'General' as const
  static readonly requiredTraits = ['IFacingInfo'] as const
  static readonly exposedForDestroyedActors = false

  private readonly _facing: any | null

  constructor(context: IScriptContext, self: IGameActor) {
    super(context, self)
    this._facing = (self as any).trait?.('IFacing') ?? null
  }

  /** The direction that the actor is facing. */
  get Facing(): unknown {
    return this._facing?.facing ?? null
  }

  getOwnMemberDescriptors(): MemberDescriptor[] {
    return [
      {
        memberType: 'property', name: 'Facing', returnType: 'WAngle',
        description: 'The direction that the actor is facing.',
        get: () => this.Facing,
      },
    ]
  }
}

// ===========================================================================
// Module-level registration
// ===========================================================================

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: BaseActorProperties,
  requiredTraits: [],
  exposedForDestroyedActors: true,
  description: 'Core actor properties safe for use on dead actors: IsInWorld, IsDead, IsIdle, Owner, Type, HasProperty, Flash, EffectiveOwner',
})

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: GeneralProperties,
  requiredTraits: [],
  exposedForDestroyedActors: false,
  description: 'Actor trait-based general properties: Teleport, CallFunc, Wait, Destroy, Stop, Stance, TooltipName, IsTaggable, tags',
})

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: LocationProperties,
  requiredTraits: ['IOccupySpaceInfo'],
  exposedForDestroyedActors: false,
  description: 'Actor position in cell and world coordinates: Location, CenterPosition',
})

ScriptRegistry.registerActorProperty({
  category: 'General',
  ctor: FacingProperties,
  requiredTraits: ['IFacingInfo'],
  exposedForDestroyedActors: false,
  description: 'Actor facing direction: Facing',
})
