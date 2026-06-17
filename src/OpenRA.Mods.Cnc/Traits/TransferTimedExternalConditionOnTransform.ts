/**
 * TransferTimedExternalConditionOnTransform.ts — 变形时转移临时外部条件
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/TransferTimedExternalConditionOnTransform.cs (63 lines)
 *
 * 核心范式转换:
 * - C# IConditionTimerWatcher → TypeScript condition timer watcher interface
 * - C# INotifyTransform → TypeScript transform notification interface
 * - C# ExternalCondition.GrantCondition() → TypeScript external condition grant
 * - C# TraitImplementing<ExternalCondition>().FirstOrDefault()
 *   → TypeScript array find with predicate
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// TransferTimedExternalConditionOnTransformInfo
// OpenRA 对照: TransferTimedExternalConditionOnTransformInfo : TraitInfo, Requires<TransformsInfo>
// ---------------------------------------------------------------------------

/** Configuration for transferring timed external conditions during transform.
 *
 * OpenRA 对照: TransferTimedExternalConditionOnTransformInfo
 */
export class TransferTimedExternalConditionOnTransformInfo implements ITraitInfo {
  /** External condition to transfer.
   *
   * OpenRA 对照: TransferTimedExternalConditionOnTransformInfo.Condition
   */
  readonly condition: string

  constructor(params?: { condition?: string }) {
    this.condition = params?.condition ?? ''
  }

  create(_init: IGameActor): TransferTimedExternalConditionOnTransform {
    return new TransferTimedExternalConditionOnTransform(this)
  }
}

// ---------------------------------------------------------------------------
// TransferTimedExternalConditionOnTransform
// OpenRA 对照: TransferTimedExternalConditionOnTransform : IConditionTimerWatcher, INotifyTransform
// ---------------------------------------------------------------------------

/** Re-grants a timed external condition when the actor transforms.
 *
 * OpenRA 对照: TransferTimedExternalConditionOnTransform
 *
 * This trait does not work with permanently granted external conditions.
 * It changes the external condition source, so cannot be used for conditions
 * that may later be revoked.
 */
export class TransferTimedExternalConditionOnTransform {
  readonly info: TransferTimedExternalConditionOnTransformInfo

  /** Duration of the condition being tracked.
   *
   * OpenRA 对照: TransferTimedExternalConditionOnTransform.duration
   */
  private duration: number = 0

  /** Remaining ticks of the condition being tracked.
   *
   * OpenRA 对照: TransferTimedExternalConditionOnTransform.remaining
   */
  private remaining: number = 0

  constructor(info: TransferTimedExternalConditionOnTransformInfo) {
    this.info = info
  }

  // -------------------------------------------------------------------------
  // INotifyTransform
  // -------------------------------------------------------------------------

  /** Called before transform. No-op for this trait.
   *
   * OpenRA 对照: INotifyTransform.BeforeTransform(Actor)
   */
  beforeTransform(_self: IGameActor): void {
    // No-op
  }

  /** Called during transform. No-op for this trait.
   *
   * OpenRA 对照: INotifyTransform.OnTransform(Actor)
   */
  onTransform(_self: IGameActor): void {
    // No-op
  }

  /** Called after transform. Transfers the tracked condition to the new actor.
   *
   * OpenRA 对照: INotifyTransform.AfterTransform(Actor)
   *
   * @param toActor — the actor after transformation
   */
  afterTransform(toActor: IGameActor): void {
    if (this.remaining <= 0) {
      return
    }

    // C#: toActor.TraitsImplementing<ExternalCondition>()
    //   .FirstOrDefault(t => t.Info.Condition == info.Condition && t.CanGrantCondition(this))
    const externalConditions = (toActor as any).traitsImplementing?.('ExternalCondition') ?? []
    const external = externalConditions.find(
      (t: any) =>
        t.info?.condition === this.info.condition &&
        typeof t.canGrantCondition === 'function' &&
        t.canGrantCondition(this),
    )

    if (external && typeof external.grantCondition === 'function') {
      external.grantCondition(toActor, this, this.duration, this.remaining)
    }
  }

  // -------------------------------------------------------------------------
  // IConditionTimerWatcher
  // -------------------------------------------------------------------------

  /** Update the tracked condition timer.
   *
   * OpenRA 对照: IConditionTimerWatcher.Update(int, int)
   *
   * @param duration — total duration of the condition
   * @param remaining — remaining ticks of the condition
   */
  update(duration: number, remaining: number): void {
    this.duration = duration
    this.remaining = remaining
  }

  /** The condition name being watched.
   *
   * OpenRA 对照: IConditionTimerWatcher.Condition
   */
  get condition(): string {
    return this.info.condition
  }

  /** Get remaining ticks (for testing).
   *
   * OpenRA 对照: TransferTimedExternalConditionOnTransform.remaining (private)
   */
  get remainingTicks(): number {
    return this.remaining
  }

  /** Get duration (for testing).
   *
   * OpenRA 对照: TransferTimedExternalConditionOnTransform.duration (private)
   */
  get durationTicks(): number {
    return this.duration
  }
}
