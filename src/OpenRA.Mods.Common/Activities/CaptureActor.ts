/**
 * CaptureActor.ts — 工程师占领敌方建筑的活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/CaptureActor.cs
 *
 * 核心范式转换:
 * - C# CaptureActor extends Enter → TypeScript extends Enter
 * - C# CaptureManager trait access → duck-typed interface
 * - C# Captures trait access → duck-typed interface
 * - C# ownership transfer via ChangeOwnerSync → deferred frame-end action
 * - C# INotifyCapture callbacks → duck-typed notification array
 * - C# PlayerExperience → duck-typed trait access
 * - C# World.AddFrameEndTask → deferred action queue
 *
 * NOTE: Minimal Phase B implementation. Full capture with condition grants
 * and sabotage logic is TODO-14.B.3-EXTENDED.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Enter } from './Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target, TargetType } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// CaptureActor
// ---------------------------------------------------------------------------

/**
 * Engineer capture activity: enter an enemy building and transfer ownership.
 *
 * OpenRA 对照: CaptureActor activity
 *
 * The capture sequence:
 * 1. Approach target building (inherited from Enter)
 * 2. tickInner: validate target still has CaptureManager and can be captured
 * 3. tryStartEnter: verify capture is still valid; start capture process
 * 4. OnEnterComplete: transfer ownership, grant conditions, award experience
 *
 * Supports two capture modes:
 * - Consumed capture: engineer enters and is disposed after capture
 * - Non-consumed capture: engineer captures from outside (no entering)
 */
export class CaptureActor extends Enter {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Duck-typed CaptureManager trait on the capturing actor. */
  private readonly manager: {
    canTarget(targetCaptureManager: unknown): boolean
    startCapture(targetCaptureManager: unknown, out: { captures: unknown }): boolean
    cancelCapture(targetActor: GameActor | null, targetCaptureManager: unknown | null): void
    validCapturesWithLowestSabotageThreshold(targetCaptureManager: unknown): unknown | null
  } | null

  /** The target actor being captured (updated in tickInner/TryStartEnter). */
  private enterActor: GameActor | null = null

  /** Duck-typed CaptureManager trait on the target actor. */
  private enterCaptureManager: unknown | null = null

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a CaptureActor activity.
   *
   * OpenRA 对照: CaptureActor(Actor, Target, Color?)
   *
   * @param self — the engineer/actor performing the capture
   * @param target — the target building to capture
   * @param targetLineColor — optional color for target line rendering
   */
  constructor(self: GameActor, target: Target, targetLineColor: ColorStub | null = null) {
    super(self, target, targetLineColor)

    // Resolve CaptureManager trait on self
    const actorAny = self as unknown as {
      traits?: Map<string, unknown>
    }
    this.manager = (actorAny.traits?.get('CaptureManager') ?? null) as CaptureActor['manager']
  }

  // ---------------------------------------------------------------------------
  // Enter hook: tickInner
  // ---------------------------------------------------------------------------

  /**
   * Called early each tick. Validate target can still be captured.
   *
   * OpenRA 对照: CaptureActor.TickInner(Actor, Target, bool)
   *
   * @param self — the actor performing the capture
   * @param target — the current target
   * @param targetIsDeadOrHiddenActor — whether the target is dead or hidden
   */
  protected override tickInner(self: GameActor, target: Target, targetIsDeadOrHiddenActor: boolean): void {
    // Update enterActor if target changed
    if (target.type === TargetType.Actor && this.enterActor !== target.actor) {
      this.enterActor = target.actor as unknown as GameActor
      this.enterCaptureManager = this.findCaptureManager(target.actor as unknown as GameActor)
    }

    // Cancel if target is not a valid capture target
    if (!targetIsDeadOrHiddenActor &&
        target.type !== TargetType.FrozenActor &&
        (this.enterCaptureManager === null ||
         this.manager === null ||
         !this.manager.canTarget(this.enterCaptureManager))) {
      this.cancel(self, true)
    }
  }

  // ---------------------------------------------------------------------------
  // Enter hook: tryStartEnter
  // ---------------------------------------------------------------------------

  /**
   * Called when ready to enter. Verify capture is still valid and start capture.
   *
   * OpenRA 对照: CaptureActor.TryStartEnter(Actor, Actor)
   *
   * @param self — the actor performing the capture
   * @param targetActor — the target actor to capture
   * @returns true to proceed with entering, false to cancel or wait
   */
  protected override tryStartEnter(self: GameActor, targetActor: GameActor): boolean {
    // Update references
    if (this.enterActor !== targetActor) {
      this.enterActor = targetActor
      this.enterCaptureManager = this.findCaptureManager(targetActor)
    }

    // Verify we can still capture the target
    if (this.enterCaptureManager === null ||
        this.manager === null ||
        !this.manager.canTarget(this.enterCaptureManager)) {
      this.cancel(self, true)
      return false
    }

    // StartCapture returns false when a capture delay is enabled
    const out = { captures: null as unknown }
    if (!this.manager.startCapture(this.enterCaptureManager, out)) {
      return false
    }

    const captures = out.captures as {
      info: {
        consumedByCapture: boolean
        sabotageThreshold: number
        sabotageHPRemoval: number
        sabotageDamageTypes: ReadonlySet<string>
        captureTypes: ReadonlySet<string>
        playerExperienceRelationships: number
      }
    } | null

    if (captures === null) {
      this.cancel(self, true)
      return false
    }

    // Non-consumed capture: capture immediately without entering
    if (!captures.info.consumedByCapture) {
      this.doCapture(self, captures)
      this.cancel(self, true)
      return false
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Enter hook: onEnterComplete
  // ---------------------------------------------------------------------------

  /**
   * Called after successfully entering the target. Complete the capture.
   *
   * OpenRA 对照: CaptureActor.OnEnterComplete(Actor, Actor)
   *
   * @param self — the actor performing the capture
   * @param targetActor — the target actor that was entered
   */
  protected override onEnterComplete(self: GameActor, targetActor: GameActor): void {
    // Make sure the target hasn't changed while entering
    if (this.enterActor !== targetActor) return

    // Verify capture is still valid
    if (this.enterCaptureManager === null ||
        this.manager === null ||
        !this.manager.canTarget(this.enterCaptureManager)) {
      return
    }

    // Find the best capture option (prioritize capturing over sabotaging)
    const captures = this.manager.validCapturesWithLowestSabotageThreshold(this.enterCaptureManager) as {
      info: {
        consumedByCapture: boolean
        sabotageThreshold: number
        sabotageHPRemoval: number
        sabotageDamageTypes: ReadonlySet<string>
        captureTypes: ReadonlySet<string>
        playerExperienceRelationships: number
      }
    } | null

    if (captures === null) return

    this.doCapture(self, captures)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle cleanup
  // ---------------------------------------------------------------------------

  /**
   * Cancel the capture process on activity cancellation.
   *
   * OpenRA 对照: CaptureActor.CancelCapture()
   */
  private cancelCapture(): void {
    if (this.manager !== null) {
      this.manager.cancelCapture(this.enterActor, this.enterCaptureManager)
    }
  }

  /**
   * Called when the activity is cancelled.
   *
   * OpenRA 对照: CaptureActor.Cancel(Actor, bool)
   */
  override cancel(self: GameActor, keepQueue: boolean = false): void {
    this.cancelCapture()
    super.cancel(self, keepQueue)
  }

  /**
   * Called on activity last run.
   *
   * OpenRA 对照: CaptureActor.OnLastRun(Actor)
   */
  protected override onLastRun(self: GameActor): void {
    this.cancelCapture()
    super.onLastRun(self)
  }

  /**
   * Called when the actor is disposed.
   *
   * OpenRA 对照: CaptureActor.OnActorDispose(Actor)
   */
  protected override onActorDispose(self: GameActor): void {
    this.cancelCapture()
    super.onActorDispose(self)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Perform the actual capture: ownership transfer, notifications, experience.
   *
   * OpenRA 对照: CaptureActor.DoCapture(Actor, Captures)
   *
   * @param self — the actor performing the capture
   * @param captures — the capture trait configuration
   */
  private doCapture(self: GameActor, captures: {
    info: {
      consumedByCapture: boolean
      sabotageThreshold: number
      sabotageHPRemoval: number
      sabotageDamageTypes: ReadonlySet<string>
      captureTypes: ReadonlySet<string>
      playerExperienceRelationships: number
    }
  }): void {
    if (this.enterActor === null) return

    const oldOwner = (this.enterActor as unknown as { owner?: unknown }).owner

    const world = (self as unknown as {
      world?: {
        frameEndActions?: Array<() => void>
      }
    }).world

    const frameEndAction = (): void => {
      // The target died or was already captured during this tick
      if (this.enterActor === null) return
      const currentOwner = (this.enterActor as unknown as { owner?: unknown }).owner
      if (currentOwner !== oldOwner) return

      // Check for sabotage (damage instead of capture)
      const isNonCombatant = (currentOwner as { nonCombatant?: boolean })?.nonCombatant ?? false
      if (captures.info.sabotageThreshold > 0 && !isNonCombatant) {
        const health = this.findHealthTrait(this.enterActor)
        if (health !== null) {
          const hpRatio = (100 * health.hp) / health.maxHP
          if (hpRatio > captures.info.sabotageThreshold) {
            const damage = Math.trunc((health.maxHP * captures.info.sabotageHPRemoval) / 100)
            this.inflictDamage(this.enterActor, self, damage, captures.info.sabotageDamageTypes)

            if (captures.info.consumedByCapture) {
              const dispose = (self as unknown as { dispose?: () => void }).dispose
              dispose?.()
            }
            return
          }
        }
      }

      // Do the capture: change ownership
      this.changeOwner(this.enterActor, (self as unknown as { owner?: unknown }).owner)

      // Notify capture listeners
      this.notifyCapture(this.enterActor, self, oldOwner, captures.info.captureTypes)

      // Award player experience
      const relationship = this.getRelationship(self, oldOwner)
      if (this.hasRelationship(relationship, captures.info.playerExperienceRelationships)) {
        const playerExperience = this.findPlayerExperience(self)
        if (playerExperience !== null) {
          playerExperience.giveExperience(captures.info.playerExperienceRelationships)
        }
      }

      // Dispose the capturing actor if consumed
      if (captures.info.consumedByCapture) {
        const dispose = (self as unknown as { dispose?: () => void }).dispose
        dispose?.()
      }
    }

    if (world?.frameEndActions) {
      world.frameEndActions.push(frameEndAction)
    } else {
      frameEndAction()
    }
  }

  /**
   * Find the CaptureManager trait on a target actor.
   */
  private findCaptureManager(target: GameActor): unknown | null {
    const targetAny = target as unknown as {
      traits?: Map<string, unknown>
    }
    return targetAny.traits?.get('CaptureManager') ?? null
  }

  /**
   * Find the IHealth trait on an actor.
   */
  private findHealthTrait(actor: GameActor): { hp: number; maxHP: number } | null {
    const actorAny = actor as unknown as {
      traits?: Map<string, unknown>
    }
    const health = actorAny.traits?.get('health')
    if (health && typeof health === 'object') {
      const h = health as { hp?: number; maxHP?: number }
      if (h.hp !== undefined && h.maxHP !== undefined) {
        return { hp: h.hp, maxHP: h.maxHP }
      }
    }
    return null
  }

  /**
   * Inflict damage on an actor.
   */
  private inflictDamage(target: GameActor, attacker: GameActor, damage: number, _damageTypes: ReadonlySet<string>): void {
    const inflict = (target as unknown as {
      inflictDamage?: (attacker: GameActor, damage: unknown) => void
    }).inflictDamage
    if (inflict) {
      inflict(attacker, { value: damage })
    }
  }

  /**
   * Change the owner of an actor.
   */
  private changeOwner(actor: GameActor, newOwner: unknown): void {
    const change = (actor as unknown as {
      changeOwnerSync?: (owner: unknown) => void
    }).changeOwnerSync
    change?.(newOwner)
  }

  /**
   * Notify INotifyCapture listeners.
   */
  private notifyCapture(target: GameActor, captor: GameActor, oldOwner: unknown, captureTypes: ReadonlySet<string>): void {
    const targetAny = target as unknown as {
      traits?: Map<string, unknown>
    }
    const allTraits = targetAny.traits ? Array.from(targetAny.traits.values()) : []
    const notifiers = (Array.isArray(allTraits) ? allTraits : []).filter(
      (t): t is { onCapture: (target: GameActor, captor: GameActor, oldOwner: unknown, newOwner: unknown, types: ReadonlySet<string>) => void } =>
        typeof t === 'object' && t !== null && 'onCapture' in t,
    )
    const newOwner = (captor as unknown as { owner?: unknown }).owner
    for (const n of notifiers) {
      n.onCapture(target, captor, oldOwner, newOwner, captureTypes)
    }
  }

  /**
   * Get relationship between two actors' owners.
   */
  private getRelationship(self: GameActor, otherOwner: unknown): number {
    const selfOwner = (self as unknown as { owner?: { relationshipWith?: (other: unknown) => number } }).owner
    if (selfOwner?.relationshipWith) {
      return selfOwner.relationshipWith(otherOwner)
    }
    return 0
  }

  /**
   * Check if a relationship value has a specific relationship bit.
   */
  private hasRelationship(relationship: number, mask: number): boolean {
    return (relationship & mask) !== 0
  }

  /**
   * Find PlayerExperience trait on the actor's owner.
   */
  private findPlayerExperience(self: GameActor): { giveExperience: (amount: number) => void } | null {
    const owner = (self as unknown as { owner?: { playerActor?: { traits?: Map<string, unknown> } } }).owner
    if (!owner?.playerActor?.traits) return null
    const pe = owner.playerActor.traits.get('PlayerExperience')
    if (pe && typeof pe === 'object' && 'giveExperience' in pe) {
      return pe as { giveExperience: (amount: number) => void }
    }
    return null
  }
}
