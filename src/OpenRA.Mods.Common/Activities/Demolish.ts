/**
 * Demolish.ts — 放置炸药并延迟引爆的活动
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Demolish.cs
 *
 * 核心范式转换:
 * - C# Demolish extends Enter → TypeScript extends Enter
 * - C# IDemolishable trait access → duck-typed interface check
 * - C# INotifyDemolition callbacks → duck-typed array iteration
 * - C# FlashTarget effect → deferred effect queue (world.frameEndActions)
 * - C# World.AddFrameEndTask → deferred action queue
 * - C# EnterBehaviour enum → EnterBehaviour const object
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Enter, EnterBehaviour } from './Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Demolish
// ---------------------------------------------------------------------------

/**
 * Place explosives on a target actor, with delayed detonation.
 *
 * OpenRA 对照: Demolish activity
 *
 * An engineer/saboteur enters a target building, places explosives,
 * and the target is demolished after a delay. The entering actor
 * may be disposed or killed based on EnterBehaviour.
 *
 * The demolition sequence:
 * 1. Approach target (inherited from Enter)
 * 2. Enter target cell (inherited from Enter)
 * 3. OnEnterComplete: place explosives, schedule delayed detonation
 * 4. Actor exits (inherited from Enter)
 * 5. After delay: target is destroyed
 */
export class Demolish extends Enter {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /** Delay in ticks before detonation. */
  readonly delay: number

  /** Number of flash visual effects before detonation. */
  readonly flashes: number

  /** Delay before flashes start. */
  readonly flashesDelay: number

  /** Interval between flashes. */
  readonly flashInterval: number

  /** Damage types for the demolition. */
  readonly damageTypes: ReadonlySet<string>

  /** What happens to the entering actor after demolition. */
  readonly enterBehaviour: EnterBehaviour

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** The target actor being demolished. */
  private enterActor: GameActor | null = null

  /** Traits on the target that can be demolished. */
  private enterDemolishables: Array<{
    isValidTarget(target: GameActor, attacker: GameActor): boolean
    demolish(target: GameActor, attacker: GameActor, delay: number, damageTypes: ReadonlySet<string>): void
  }> = []

  /** Notification traits on the attacker. */
  private readonly notifiers: Array<{
    demolishing(self: GameActor): void
  }> = []

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * Create a Demolish activity.
   *
   * OpenRA 对照: Demolish(Actor, Target, EnterBehaviour, int, int, int, int, BitSet, Color?)
   *
   * @param self — the actor placing explosives
   * @param target — the target to demolish
   * @param enterBehaviour — what happens to self after demolition
   * @param delay — ticks before detonation
   * @param flashes — number of visual flashes
   * @param flashesDelay — ticks before flashes start
   * @param flashInterval — ticks between flashes
   * @param damageTypes — damage type tags
   * @param targetLineColor — optional target line color
   */
  constructor(
    self: GameActor,
    target: Target,
    enterBehaviour: EnterBehaviour,
    delay: number,
    flashes: number,
    flashesDelay: number,
    flashInterval: number,
    damageTypes: ReadonlySet<string>,
    targetLineColor: ColorStub | null = null,
  ) {
    super(self, target, targetLineColor)
    this.enterBehaviour = enterBehaviour
    this.delay = delay
    this.flashes = flashes
    this.flashesDelay = flashesDelay
    this.flashInterval = flashInterval
    this.damageTypes = damageTypes

    // Collect INotifyDemolition traits from self
    const actorAny = self as unknown as {
      traits?: Map<string, unknown>
    }
    const allTraits = actorAny.traits ? Array.from(actorAny.traits.values()) : []
    this.notifiers = (Array.isArray(allTraits) ? allTraits : []).filter(
      (t): t is Demolish['notifiers'][number] =>
        typeof t === 'object' && t !== null && 'demolishing' in t,
    )
  }

  // ---------------------------------------------------------------------------
  // Enter hooks
  // ---------------------------------------------------------------------------

  /**
   * Called when ready to enter the target. Verify demolition is still valid.
   *
   * OpenRA 对照: Demolish.TryStartEnter(Actor, Actor)
   *
   * @param self — the actor placing explosives
   * @param targetActor — the target actor to demolish
   * @returns true to proceed with entering, false to cancel
   */
  protected override tryStartEnter(self: GameActor, targetActor: GameActor): boolean {
    this.enterActor = targetActor

    // Find IDemolishable traits on the target
    const targetAny = targetActor as unknown as {
      traits?: Map<string, unknown>
    }
    const allTargetTraits = targetAny.traits ? Array.from(targetAny.traits.values()) : []
    this.enterDemolishables = (Array.isArray(allTargetTraits) ? allTargetTraits : []).filter(
      (t): t is Demolish['enterDemolishables'][number] =>
        typeof t === 'object' && t !== null && 'isValidTarget' in t && 'demolish' in t,
    )

    // Make sure we can still demolish the target
    if (!this.enterDemolishables.some(d => d.isValidTarget(targetActor, self))) {
      this.cancel(self, true)
      return false
    }

    return true
  }

  /**
   * Called after successfully entering the target. Place explosives.
   *
   * OpenRA 对照: Demolish.OnEnterComplete(Actor, Actor)
   *
   * Deferred via world.frameEndActions to prevent mid-tick state mutation.
   *
   * @param self — the actor placing explosives
   * @param targetActor — the target actor that was entered
   */
  protected override onEnterComplete(self: GameActor, targetActor: GameActor): void {
    const world = (self as unknown as {
      world?: {
        frameEndActions?: Array<() => void>
      }
    }).world

    const frameEndAction = (): void => {
      // Make sure the target hasn't changed while entering
      if (targetActor !== this.enterActor) return

      // Verify demolition is still valid
      if (!this.enterDemolishables.some(d => d.isValidTarget(targetActor, self))) return

      // TODO-14.B.4-VISUAL: Add FlashTarget visual effect
      // C#: w.Add(new FlashTarget(enterActor, Color.White, count: flashes, interval: flashInterval, delay: flashesDelay))

      // Notify demolition listeners
      for (const ind of this.notifiers) {
        ind.demolishing(self)
      }

      // Trigger demolition on all demolishable traits
      for (const d of this.enterDemolishables) {
        d.demolish(targetActor, self, this.delay, this.damageTypes)
      }

      // Handle enter behaviour for the demolishing actor
      if (this.enterBehaviour === EnterBehaviour.Dispose) {
        const dispose = (self as unknown as { dispose?: () => void }).dispose
        dispose?.()
      } else if (this.enterBehaviour === EnterBehaviour.Suicide) {
        const kill = (self as unknown as { kill?: (attacker: GameActor) => void }).kill
        kill?.(self)
      }
    }

    // Queue the frame-end action
    if (world?.frameEndActions) {
      world.frameEndActions.push(frameEndAction)
    } else {
      // Fallback: execute immediately if no frameEndActions available
      frameEndAction()
    }
  }
}
