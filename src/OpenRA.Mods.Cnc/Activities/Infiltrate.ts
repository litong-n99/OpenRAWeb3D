/**
 * Infiltrate.ts — 渗透活动（进入目标建筑并触发渗透效果）
 * OpenRA 对照: OpenRA.Mods.Cnc/Activities/Infiltrate.cs (79 lines)
 *
 * 核心范式转换:
 * - C# sealed class Infiltrate : Enter → TS Infiltrate extends Enter
 * - C# EnterBehaviour => EnterBehaviour.Dispose → TS EnterBehaviour.Dispose
 * - C# self.Dispose() / self.Kill(self) → TS actor disposal stub
 * - C# traits.TraitsImplementing<T>() → TS duck-typed trait query
 * - C# Target.FromActor(targetActor) → TS Target.fromActor
 */

import type { Target as TargetType_ } from '../../OpenRA.Game/Traits/Target.js'
import { Target as TargetClass } from '../../OpenRA.Game/Traits/Target.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.js'
import { Enter, EnterBehaviour } from '../../OpenRA.Mods.Common/Activities/Enter.js'

// ---------------------------------------------------------------------------
// Sound / text notification stubs
// ---------------------------------------------------------------------------

function playNotification(
  _self: IGameActor,
  _notification: string,
): void {
  // TODO-19.A.10-SOUND: Integrate with Ch7 Sound system
}

function addTransientLine(
  _owner: unknown,
  _text: string | null,
): void {
  // TODO-19.A.10-TEXT: Integrate with Ch16 TextNotificationsManager
}

// ---------------------------------------------------------------------------
// Infiltrates trait duck-type
// ---------------------------------------------------------------------------

interface InfiltratesFacade {
  info: { types: readonly string[]; notification: string | null; textNotification: string | null; enterBehaviour: number }
  isTraitDisabled: boolean
  canInfiltrateTarget(self: IGameActor, target: TargetType_): boolean
}

// ---------------------------------------------------------------------------
// Infiltrate
// OpenRA 对照: Infiltrate : Enter
// ---------------------------------------------------------------------------

/**
 * Activity that moves an infiltrator (spy, engineer) into a target building
 * and triggers all InfiltrateFor* effects.
 *
 * OpenRA 对照: Infiltrate (sealed class extending Enter)
 */
export class Infiltrate extends Enter {
  private readonly infiltrates: InfiltratesFacade
  private readonly notifiers: Array<{ infiltrating(self: IGameActor): void }> = []
  private enterActor: GameActor | null = null

  constructor(
    self: GameActor,
    target: TargetType_,
    infiltrates: InfiltratesFacade,
    targetLineColor: ColorStub | null,
  ) {
    super(self, target as TargetClass, targetLineColor)

    this.infiltrates = infiltrates

    // Cache INotifyInfiltration traits on the infiltrator
    const selfAny = self as unknown as {
      traitsImplementing?: <T>(_name: string) => T[]
    }
    const infNotifiers =
      selfAny.traitsImplementing?.<{ infiltrating(_s: IGameActor): void }>(
        'INotifyInfiltration',
      ) ?? []
    this.notifiers = infNotifiers
  }

  // ---------------------------------------------------------------------------
  // TickInner
  // ---------------------------------------------------------------------------

  protected override tickInner(
    self: GameActor,
    _target: TargetType_,
    _targetIsDeadOrHiddenActor: boolean,
  ): void {
    if (this.infiltrates.isTraitDisabled) {
      this.cancel(self, true)
    }
  }

  // ---------------------------------------------------------------------------
  // TryStartEnter
  // ---------------------------------------------------------------------------

  protected override tryStartEnter(
    self: GameActor,
    targetActor: GameActor,
  ): boolean {
    const targetAsActor = TargetClass.fromActor(
      targetActor as unknown as IActorRef,
    )
    if (
      !this.infiltrates.canInfiltrateTarget(
        self as unknown as IGameActor,
        targetAsActor as unknown as TargetType_,
      )
    ) {
      this.cancel(self, true)
      return false
    }

    this.enterActor = targetActor
    return true
  }

  // ---------------------------------------------------------------------------
  // OnEnterComplete
  // ---------------------------------------------------------------------------

  protected override onEnterComplete(
    self: GameActor,
    targetActor: GameActor,
  ): void {
    const targetAsActor = TargetClass.fromActor(
      targetActor as unknown as IActorRef,
    )

    if (
      targetActor !== this.enterActor ||
      !this.infiltrates.canInfiltrateTarget(
        self as unknown as IGameActor,
        targetAsActor as unknown as TargetType_,
      )
    ) {
      return
    }

    // Step 1: Notify infiltrator traits
    for (const notifier of this.notifiers) {
      notifier.infiltrating(self as unknown as IGameActor)
    }

    // Step 2: Trigger all InfiltrateFor* effects on target
    const targetAny = targetActor as unknown as {
      traitsImplementing?: <T>(_name: string) => T[]
    }
    const infiltratedTraits =
      targetAny.traitsImplementing?.<{
        infiltrated(
          target: IGameActor,
          infiltrator: IGameActor,
          types: readonly string[],
        ): void
      }>('INotifyInfiltrated') ?? []

    for (const trait of infiltratedTraits) {
      trait.infiltrated(
        targetActor as unknown as IGameActor,
        self as unknown as IGameActor,
        this.infiltrates.info.types,
      )
    }

    // Step 3: Notifications
    const notification = this.infiltrates.info.notification
    if (notification) {
      playNotification(self as unknown as IGameActor, notification)
    }

    const textNotification = this.infiltrates.info.textNotification
    if (textNotification) {
      addTransientLine(
        (self as unknown as { owner: unknown }).owner,
        textNotification,
      )
    }

    // Step 4: Self-destruct per EnterBehaviour
    const behaviour = this.infiltrates.info.enterBehaviour
    const selfAny = self as unknown as {
      dispose?: () => void
      kill?: (actor: GameActor) => void
    }

    if (behaviour === EnterBehaviour.Dispose) {
      selfAny.dispose?.()
    } else if (behaviour === EnterBehaviour.Suicide) {
      selfAny.kill?.(self)
    }
  }
}
