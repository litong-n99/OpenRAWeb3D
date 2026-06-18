/**
 * ScriptTriggers.ts — Trait bridging 18 game events to script callbacks
 * OpenRA 对照: OpenRA.Mods.Common/Scripting/ScriptTriggers.cs (560 lines)
 *
 * 核心范式转换:
 * - C# INotify* pattern with world.Disposing guard + LuaFunction.Call() + Dispose()
 *   → TypeScript INotify* pattern with _worldDisposingFn guard + TriggerCallback invocation
 * - C# Triggerable struct (LuaFunction + ScriptContext + LuaValue self) with CopyReference/Dispose
 *   → TypeScript Triggerable interface (plain fn reference, GC-managed)
 * - C# event Action<Actor> OnKilledInternal (C# event keyword)
 *   → TypeScript Set<(actor: IGameActor) => void> (typed listener sets)
 * - C# Enum.GetValues<Trigger>().Length → TRIGGER_COUNT constant
 * - C# actor.ToLuaValue(context) argument marshaling
 *   → Direct game-type arguments (Phase B); toScriptValue() wrapping in Phase C
 */

import type { IScriptContext } from '../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { IGameActor, PlayerStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CPos } from '../../OpenRA.Game/CPos.js'

import type { INotifyIdle } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyDamage } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyKilled } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyCapture } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifySold } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyAddedToWorld } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyRemovedFromWorld } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { INotifyActorDisposing } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

import type { INotifyProduction } from './TriggerInterfaces.js'
import type { INotifyOtherProduction } from './TriggerInterfaces.js'
import type { INotifyBuildingPlaced } from './TriggerInterfaces.js'
import type { INotifyObjectivesUpdated } from './TriggerInterfaces.js'
import type { INotifyInfiltrated } from './TriggerInterfaces.js'
import type { INotifyDiscovered } from './TriggerInterfaces.js'
import type { INotifyPassengerEntered } from './TriggerInterfaces.js'
import type { INotifyPassengerExited } from './TriggerInterfaces.js'
import type { INotifyWinStateChanged } from './TriggerInterfaces.js'
import type { INotifyTimeLimit } from './TriggerInterfaces.js'

// ---------------------------------------------------------------------------
// Trigger enum (对应 OpenRA Trigger)
// ---------------------------------------------------------------------------

/**
 * Enumeration of all script trigger types.
 *
 * OpenRA 对照: Trigger enum (ScriptTriggers.cs:22-28)
 *
 * Each value maps to a named callback list. Scripts register callbacks
 * via TriggerGlobal (Phase C) which calls ScriptTriggers.registerCallback().
 *
 * Uses const-object pattern (erasableSyntaxOnly-compatible).
 */
export const Trigger = {
  OnIdle: 0,
  OnDamaged: 1,
  OnKilled: 2,
  OnProduction: 3,
  OnOtherProduction: 4,
  OnBuildingPlaced: 5,
  OnPlayerWon: 6,
  OnPlayerLost: 7,
  OnObjectiveAdded: 8,
  OnObjectiveCompleted: 9,
  OnObjectiveFailed: 10,
  OnCapture: 11,
  OnInfiltrated: 12,
  OnAddedToWorld: 13,
  OnRemovedFromWorld: 14,
  OnDiscovered: 15,
  OnPlayerDiscovered: 16,
  OnPassengerEntered: 17,
  OnPassengerExited: 18,
  OnSold: 19,
  OnTimerExpired: 20,
} as const

export type Trigger = (typeof Trigger)[keyof typeof Trigger]

/** Number of trigger types.
 *
 * OpenRA 对照: Enum.GetValues<Trigger>().Length
 */
export const TRIGGER_COUNT = 21

// ---------------------------------------------------------------------------
// TriggerCallback type
// ---------------------------------------------------------------------------

/**
 * A generic script callback function.
 *
 * OpenRA 对照: LuaFunction.Call(LuaValue...)
 *
 * The args array contains the marshaled arguments from the INotify* handler.
 * The callback is responsible for understanding the expected argument types
 * based on which trigger was registered.
 *
 * In Phase B, args are passed as raw game types (IGameActor, PlayerStub,
 * number, string). Phase C TriggerGlobal wraps these with toScriptValue().
 */
export type TriggerCallback = (context: IScriptContext, ...args: unknown[]) => void

// ---------------------------------------------------------------------------
// Triggerable
// ---------------------------------------------------------------------------

/**
 * A registered callback for a specific trigger.
 *
 * OpenRA 对照: ScriptTriggers.Triggerable struct (lines 52-69)
 *
 * Paradigm shift:
 * - C# stores LuaFunction (CopyReference) + LuaValue self + ScriptContext
 *   and explicitly Disposes them in Clear()
 * - TS stores a plain function reference; GC handles cleanup.
 *   The fn is nulled on clear to break reference cycles.
 */
export interface Triggerable {
  /** The callback function. */
  fn: TriggerCallback
  /** The owning script context. */
  context: IScriptContext
  /**
   * The pre-marshaled "self" argument.
   * For most triggers this is the actor that owns the ScriptTriggers trait.
   * null for triggers that don't pass self (OnTimerExpired).
   */
  selfArg: unknown
}

// ---------------------------------------------------------------------------
// Internal event callback types
// ---------------------------------------------------------------------------

/**
 * Callback for single-actor internal events.
 *
 * OpenRA 对照: event Action<Actor>
 */
export type ActorEventCallback = (actor: IGameActor) => void

/**
 * Callback for paired-actor internal events.
 *
 * OpenRA 对照: event Action<Actor, Actor>
 */
export type ActorPairCallback = (a: IGameActor, b: IGameActor) => void

// ---------------------------------------------------------------------------
// ScriptTriggersInfo
// ---------------------------------------------------------------------------

/**
 * Trait info for ScriptTriggers.
 *
 * OpenRA 对照: ScriptTriggersInfo (ScriptTriggers.cs:30-34)
 *
 * Simple marker trait with no configurable fields. The map script system
 * detects this trait to know the actor is eligible for script triggers.
 */
export class ScriptTriggersInfo {
  // Empty — ScriptTriggers has no configurable properties
}

// ---------------------------------------------------------------------------
// ScriptTriggers
// ---------------------------------------------------------------------------

/**
 * Trait that bridges 18 game event interfaces to user-registered script
 * callbacks.
 *
 * OpenRA 对照: ScriptTriggers (ScriptTriggers.cs:36-559)
 *
 * Attached to individual actors. When a game event fires (e.g., actor is
 * killed, damaged, produced), ScriptTriggers iterates the matching trigger
 * list and invokes all registered callbacks.
 *
 * ## Internal Events
 *
 * In addition to script callbacks, ScriptTriggers fires 6 "internal" events
 * AFTER the script callbacks. These are used by C# traits for inter-trait
 * communication (e.g., GivesBounty subscribes to OnKilledInternal).
 *
 * ## World Disposing Guard
 *
 * Every handler checks whether the world is currently disposing before
 * dispatching callbacks. This matches OpenRA's `if (world.Disposing) return;`
 * pattern (e.g., line 94 in ScriptTriggers.cs).
 */
export class ScriptTriggers
  implements
    INotifyIdle,
    INotifyDamage,
    INotifyKilled,
    INotifyProduction,
    INotifyOtherProduction,
    INotifyBuildingPlaced,
    INotifyWinStateChanged,
    INotifyObjectivesUpdated,
    INotifyCapture,
    INotifyInfiltrated,
    INotifyAddedToWorld,
    INotifyRemovedFromWorld,
    INotifyDiscovered,
    INotifyPassengerEntered,
    INotifyPassengerExited,
    INotifySold,
    INotifyTimeLimit,
    INotifyActorDisposing
{
  // ---------------------------------------------------------------------------
  // Public internal events (对应 C# event Action<> 字段)
  // ---------------------------------------------------------------------------

  /**
   * Fires after OnKilled Lua callbacks, with the victim actor.
   *
   * OpenRA 对照: ScriptTriggers.OnKilledInternal (line 43)
   */
  readonly onKilledInternal = new Set<ActorEventCallback>()

  /**
   * Fires after OnCapture Lua callbacks, with the captured actor.
   *
   * OpenRA 对照: ScriptTriggers.OnCapturedInternal (line 44)
   */
  readonly onCapturedInternal = new Set<ActorEventCallback>()

  /**
   * Fires after OnRemovedFromWorld Lua callbacks, with the removed actor.
   *
   * OpenRA 对照: ScriptTriggers.OnRemovedInternal (line 45)
   */
  readonly onRemovedInternal = new Set<ActorEventCallback>()

  /**
   * Fires after OnAddedToWorld Lua callbacks, with the added actor.
   *
   * OpenRA 对照: ScriptTriggers.OnAddedInternal (line 46)
   */
  readonly onAddedInternal = new Set<ActorEventCallback>()

  /**
   * Fires after OnProduction Lua callbacks, with (producer, produced).
   *
   * OpenRA 对照: ScriptTriggers.OnProducedInternal (line 47)
   */
  readonly onProducedInternal = new Set<ActorPairCallback>()

  /**
   * Fires after OnOtherProduction Lua callbacks, with (producee, produced).
   *
   * OpenRA 对照: ScriptTriggers.OnOtherProducedInternal (line 48)
   */
  readonly onOtherProducedInternal = new Set<ActorPairCallback>()

  // ---------------------------------------------------------------------------
  // Private state
  // ---------------------------------------------------------------------------

  /**
   * 21 arrays of trigger callbacks, indexed by Trigger enum value.
   *
   * OpenRA 对照: triggerables[] (line 50)
   */
  private _triggerables: Triggerable[][] = Array.from({ length: TRIGGER_COUNT }, () => [])

  /**
   * The actor that owns this trait. Used as selfArg for most triggers.
   */
  private _self: IGameActor

  /**
   * Optional callback to check if the world is disposing.
   * Set via setWorldDisposingCheck(). If not set, all handlers proceed.
   */
  private _worldDisposingFn: (() => boolean) | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a ScriptTriggers trait on an actor.
   *
   * OpenRA 对照: ScriptTriggers(World world, Actor self) (lines 71-75)
   *
   * @param self — the actor this trait is attached to
   */
  constructor(self: IGameActor) {
    this._self = self
  }

  // ---------------------------------------------------------------------------
  // World disposing check
  // ---------------------------------------------------------------------------

  /**
   * Register a callback that returns whether the world is disposing.
   *
   * OpenRA 对照: world.Disposing property check
   *
   * All INotify* handlers call this before dispatching callbacks.
   * If not set, disposing is assumed false.
   */
  setWorldDisposingCheck(fn: (() => boolean) | null): void {
    this._worldDisposingFn = fn
  }

  // ---------------------------------------------------------------------------
  // Trigger list accessor (对应 Triggerables() 方法)
  // ---------------------------------------------------------------------------

  /**
   * Get the triggerable list for a Trigger enum value.
   *
   * OpenRA 对照: Triggerables(Trigger trigger) (lines 77-80)
   */
  private _getTriggerables(trigger: Trigger): Triggerable[] {
    return this._triggerables[trigger as number]
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Register a script callback for a trigger type.
   *
   * OpenRA 对照: RegisterCallback(Trigger, LuaFunction, ScriptContext) (lines 82-85)
   *
   * @param trigger — which trigger to listen for
   * @param fn — the callback function
   * @param context — the owning script context
   */
  registerCallback(trigger: Trigger, fn: TriggerCallback, context: IScriptContext): void {
    if (!fn) throw new Error('ScriptTriggers.registerCallback: fn must not be null')
    this._getTriggerables(trigger).push({
      fn,
      context,
      selfArg: this._self,
    })
  }

  /**
   * Check whether any callbacks are registered for a trigger type.
   *
   * OpenRA 对照: HasAnyCallbacksFor(Trigger) (lines 87-90)
   */
  hasAnyCallbacksFor(trigger: Trigger): boolean {
    return this._getTriggerables(trigger).length > 0
  }

  /**
   * Remove and release all callbacks for a specific trigger.
   *
   * OpenRA 对照: Clear(Trigger) (lines 538-547)
   *
   * OpenRA queues this via world.AddFrameEndTask to avoid modifying
   * the triggerable list during iteration. In TS, we clear immediately
   * since we don't have a frame-end-queue and callers are expected
   * to not call Clear() from within a trigger callback.
   *
   * @param trigger — the Trigger enum value (or numeric index) to clear
   */
  clear(trigger: number): void {
    const list = this._triggerables[trigger]
    if (!list) return
    // Release references to help GC
    for (const t of list) {
      ;(t as Mutable<Triggerable>).fn = null!
      ;(t as Mutable<Triggerable>).context = null!
      ;(t as Mutable<Triggerable>).selfArg = null
    }
    list.length = 0
  }

  /**
   * Remove and release all callbacks for ALL trigger types.
   *
   * OpenRA 对照: ClearAll() (lines 549-553)
   */
  clearAll(): void {
    for (let i = 0; i < TRIGGER_COUNT; i++) {
      this.clear(i)
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyIdle (对应 lines 92-109)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  tickIdle(_self: IGameActor): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnIdle)) {
      try {
        t.fn(t.context, t.selfArg)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyDamage (对应 lines 111-130)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  damaged(_self: IGameActor, e: AttackInfo): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnDamaged)) {
      try {
        t.fn(t.context, t.selfArg, e.attacker, e.damage.value)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyKilled (对应 lines 132-154)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  killed(self: IGameActor, e: AttackInfo): void {
    if (this._worldDisposingFn?.()) return

    for (const t of this._getTriggerables(Trigger.OnKilled)) {
      try {
        t.fn(t.context, t.selfArg, e.attacker)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }

    // Fire internal event
    for (const listener of this.onKilledInternal) {
      try { listener(self) } catch { /* internal listeners should not crash */ }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyProduction (对应 lines 156-178)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  unitProduced(self: IGameActor, other: IGameActor, _exitCell: CPos): void {
    if (this._worldDisposingFn?.()) return

    for (const t of this._getTriggerables(Trigger.OnProduction)) {
      try {
        t.fn(t.context, t.selfArg, other)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }

    for (const listener of this.onProducedInternal) {
      try { listener(self, other) } catch { /* swallow */ }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyWinStateChanged — OnPlayerWon (对应 lines 180-198)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onPlayerWon(player: PlayerStub): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnPlayerWon)) {
      try {
        t.fn(t.context, player)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyWinStateChanged — OnPlayerLost (对应 lines 200-218)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onPlayerLost(player: PlayerStub): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnPlayerLost)) {
      try {
        t.fn(t.context, player)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyObjectivesUpdated — OnObjectiveAdded (对应 lines 220-238)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onObjectiveAdded(player: PlayerStub, id: number): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnObjectiveAdded)) {
      try {
        t.fn(t.context, player, id)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyObjectivesUpdated — OnObjectiveCompleted (对应 lines 241-259)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onObjectiveCompleted(player: PlayerStub, id: number): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnObjectiveCompleted)) {
      try {
        t.fn(t.context, player, id)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyObjectivesUpdated — OnObjectiveFailed (对应 lines 262-280)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onObjectiveFailed(player: PlayerStub, id: number): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnObjectiveFailed)) {
      try {
        t.fn(t.context, player, id)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyBuildingPlaced (对应 lines 283-303)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  buildingPlaced(_self: IGameActor, building: IGameActor): void {
    if (this._worldDisposingFn?.()) return
    // NOTE: OpenRA also passes self.Owner (the placing player).
    // In Phase B we pass selfArg (the builder) and the placed building.
    // The owner can be derived from selfArg by the callback if needed.
    for (const t of this._getTriggerables(Trigger.OnBuildingPlaced)) {
      try {
        t.fn(t.context, t.selfArg, building)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyCapture (对应 lines 305-328)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onCapture(
    self: IGameActor,
    captor: IGameActor,
    oldOwner: PlayerStub,
    newOwner: PlayerStub,
    _captureTypes: number,
  ): void {
    if (this._worldDisposingFn?.()) return

    for (const t of this._getTriggerables(Trigger.OnCapture)) {
      try {
        t.fn(t.context, t.selfArg, captor, oldOwner, newOwner)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }

    for (const listener of this.onCapturedInternal) {
      try { listener(self) } catch { /* swallow */ }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyInfiltrated (对应 lines 330-348)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  infiltrated(_self: IGameActor, infiltrator: IGameActor, _types: number): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnInfiltrated)) {
      try {
        t.fn(t.context, t.selfArg, infiltrator)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyAddedToWorld (对应 lines 350-370)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  addedToWorld(self: IGameActor): void {
    if (this._worldDisposingFn?.()) return

    for (const t of this._getTriggerables(Trigger.OnAddedToWorld)) {
      try {
        t.fn(t.context, t.selfArg)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }

    for (const listener of this.onAddedInternal) {
      try { listener(self) } catch { /* swallow */ }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyRemovedFromWorld (对应 lines 372-393)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  removedFromWorld(self: IGameActor): void {
    if (this._worldDisposingFn?.()) return

    for (const t of this._getTriggerables(Trigger.OnRemovedFromWorld)) {
      try {
        t.fn(t.context, t.selfArg)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }

    for (const listener of this.onRemovedInternal) {
      try { listener(self) } catch { /* swallow */ }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifySold — Selling (no-op: 对应 line 395)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  selling(_self: IGameActor): void {
    // No-op for scripts — OpenRA's Selling() is empty for Lua dispatch.
    // Only Sold() fires script callbacks.
  }

  // ---------------------------------------------------------------------------
  // INotifySold — Sold (对应 lines 396-414)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  sold(_self: IGameActor): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnSold)) {
      try {
        t.fn(t.context, t.selfArg)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyOtherProduction (对应 lines 416-440)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  unitProducedByOther(
    _self: IGameActor,
    producee: IGameActor,
    produced: IGameActor,
    productionType: string,
    _init: Record<string, unknown>,
  ): void {
    if (this._worldDisposingFn?.()) return

    for (const t of this._getTriggerables(Trigger.OnOtherProduction)) {
      try {
        t.fn(t.context, producee, produced, productionType)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }

    for (const listener of this.onOtherProducedInternal) {
      try { listener(producee, produced) } catch { /* swallow */ }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyDiscovered (对应 lines 442-475)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onDiscovered(_self: IGameActor, discoverer: PlayerStub, _playNotification: boolean): void {
    if (this._worldDisposingFn?.()) return

    // OnDiscovered trigger — self is the discovered actor
    for (const t of this._getTriggerables(Trigger.OnDiscovered)) {
      try {
        t.fn(t.context, t.selfArg, discoverer)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }

    // OnPlayerDiscovered trigger — owner is the discovered player
    for (const t of this._getTriggerables(Trigger.OnPlayerDiscovered)) {
      try {
        // OpenRA passes: self.Owner, discoverer, self
        // We pass: selfArg (actor), discoverer — the owner can be derived
        t.fn(t.context, t.selfArg, discoverer, t.selfArg)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyPassengerEntered (对应 lines 477-496)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onPassengerEntered(_self: IGameActor, passenger: IGameActor): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnPassengerEntered)) {
      try {
        t.fn(t.context, t.selfArg, passenger)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyPassengerExited (对应 lines 498-517)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  onPassengerExited(_self: IGameActor, passenger: IGameActor): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnPassengerExited)) {
      try {
        t.fn(t.context, t.selfArg, passenger)
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyTimeLimit (对应 lines 519-536)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  notifyTimerExpired(_self: IGameActor): void {
    if (this._worldDisposingFn?.()) return
    for (const t of this._getTriggerables(Trigger.OnTimerExpired)) {
      try {
        t.fn(t.context) // OnTimerExpired has no args (OpenRA line 528: f.Function.Call())
      } catch (ex) {
        t.context.fatalError(ex as Error)
        return
      }
    }
  }

  // ---------------------------------------------------------------------------
  // INotifyActorDisposing (对应 lines 555-558)
  // ---------------------------------------------------------------------------

  /** @inheritdoc */
  disposing(_self: IGameActor): void {
    this.clearAll()
  }
}

// ---------------------------------------------------------------------------
// Mutable helper (类型工具 — used internally by clear())
// ---------------------------------------------------------------------------

type Mutable<T> = { -readonly [P in keyof T]: T[P] }
