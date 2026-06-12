/**
 * ReloadAmmoPool.ts -- Automatic reload of an ammo pool over time
 * OpenRA 对照: OpenRA.Mods.Common/Traits/ReloadAmmoPool.cs (95 lines)
 *
 * 核心范式转换:
 * - C# PausableConditionalTrait<ReloadAmmoPoolInfo>, ITick, INotifyAttack, ISync
 *   → TS ConditionalTrait<ReloadAmmoPoolInfo>, ITick, INotifyAttack, ISync
 * - C# IReloadAmmoModifier.GetReloadAmmoModifier() → TS duck-typed
 * - C# Game.Sound.PlayToPlayer() → TODO deferred
 */

import {
  type IGameActor,
  type ISync,
  type ITick,
  ConditionalTrait,
  type ConditionalTraitInfo,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { INotifyAttack, Barrel } from './CombatInterfaces.js'
import { isIReloadAmmoModifier } from './CombatInterfaces.js'
import { AmmoPool } from './AmmoPool.js'

// ---------------------------------------------------------------------------
// Helper: applyPercentageModifiers
// ---------------------------------------------------------------------------

/** Apply percentage modifiers sequentially using integer math.
 *
 *  OpenRA 对照: Util.ApplyPercentageModifiers(int, int[])
 */
function applyPercentageModifiers(base: number, percentages: number[]): number {
  let result = base
  for (const p of percentages) {
    result = Math.trunc((result * p) / 100)
  }
  return result
}

// ---------------------------------------------------------------------------
// ReloadAmmoPoolInfo
// OpenRA 对照: ReloadAmmoPoolInfo (PausableConditionalTraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for ReloadAmmoPool trait.
 *
 *  OpenRA 对照: ReloadAmmoPoolInfo
 */
export class ReloadAmmoPoolInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Name of the AmmoPool to reload.
   *
   *  OpenRA 对照: ReloadAmmoPoolInfo.AmmoPool
   */
  readonly ammoPool: string = 'primary'

  /** Reload time in ticks per Count.
   *
   *  OpenRA 对照: ReloadAmmoPoolInfo.Delay
   */
  readonly delay: number = 50

  /** How much ammo is reloaded after Delay.
   *
   *  OpenRA 对照: ReloadAmmoPoolInfo.Count
   */
  readonly count: number = 1

  /** Whether reload timer should be reset when ammo has been fired.
   *
   *  OpenRA 对照: ReloadAmmoPoolInfo.ResetOnFire
   */
  readonly resetOnFire: boolean = false

  /** Sound to play each time ammo is reloaded.
   *
   *  OpenRA 对照: ReloadAmmoPoolInfo.Sound
   */
  readonly sound: string | null = null

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    ammoPool?: string
    delay?: number
    count?: number
    resetOnFire?: boolean
    sound?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.ammoPool = params.ammoPool ?? 'primary'
    this.delay = params.delay ?? 50
    this.count = params.count ?? 1
    this.resetOnFire = params.resetOnFire ?? false
    this.sound = params.sound ?? null
  }
}

// ---------------------------------------------------------------------------
// ReloadAmmoPool
// OpenRA 对照: ReloadAmmoPool
// ---------------------------------------------------------------------------

/** Auto-reloads an ammo pool over time.
 *
 *  OpenRA 对照: ReloadAmmoPool (PausableConditionalTrait, ITick, INotifyAttack, ISync)
 */
export class ReloadAmmoPool
  extends ConditionalTrait<ReloadAmmoPoolInfo>
  implements ITick, INotifyAttack, ISync
{
  /** Reference to the linked AmmoPool (found by name at creation).
   *
   *  OpenRA 对照: ReloadAmmoPool.ammoPool
   */
  ammoPool: AmmoPool | null = null

  /** Active IReloadAmmoModifier traits (duck-typed).
   *
   *  OpenRA 对照: ReloadAmmoPool.modifiers
   */
  private modifiers: Array<{ getReloadAmmoModifier(): number }> = []

  /** Remaining ticks until next reload (network-synced).
   *
   *  OpenRA 对照: ReloadAmmoPool.remainingTicks
   */
  remainingTicks: number = 0

  constructor(info: ReloadAmmoPoolInfo) {
    super(info)
  }

  // ---------------------------------------------------------------------------
  // ITick
  // ---------------------------------------------------------------------------

  /** Tick: count down and reload when timer reaches 0.
   *
   *  OpenRA 对照: ITick.Tick()
   */
  tick(self: IGameActor): void {
    if (this.isTraitDisabled) return

    this.reload(self)
  }

  // ---------------------------------------------------------------------------
  // INotifyAttack
  // ---------------------------------------------------------------------------

  /** No-op for ammo pool reload.
   *
   *  OpenRA 对照: INotifyAttack.PreparingAttack()
   */
  preparingAttack(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    // no-op
  }

  /** Reset reload timer when ammo is fired (if ResetOnFire is set).
   *
   *  OpenRA 对照: INotifyAttack.Attacking()
   */
  attacking(
    _self: IGameActor,
    _target: Target,
    _armament: unknown,
    _barrel: Barrel,
  ): void {
    if (this.info.resetOnFire) {
      this.remainingTicks = this.getModifiedDelay()
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /** Initialize after actor creation: find AmmoPool by name, compute initial delay.
   *
   *  OpenRA 对照: ReloadAmmoPool.Created()
   */
  created(self: IGameActor): void {
    // Find AmmoPool by name via duck-typed trait query
    const traits = (self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }).getTraits?.<AmmoPool>('ammoPool')

    if (traits) {
      this.ammoPool = traits.find(ap => ap.info.name === this.info.ammoPool) ?? null
    }

    // Find IReloadAmmoModifier traits
    const modTraits = (self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }).getTraits?.<unknown>('')

    if (modTraits) {
      this.modifiers = modTraits.filter(isIReloadAmmoModifier).map(m => m as { getReloadAmmoModifier(): number })
    }

    this.remainingTicks = this.getModifiedDelay()
  }

  // ---------------------------------------------------------------------------
  // Reload logic
  // ---------------------------------------------------------------------------

  /** Core reload: decrement timer, give ammo when timer reaches 0.
   *
   *  OpenRA 对照: ReloadAmmoPool.Reload()
   */
  reload(self: IGameActor): void {
    if (!this.ammoPool) return
    if (this.ammoPool.hasFullAmmo) return

    if (--this.remainingTicks <= 0) {
      this.remainingTicks = this.getModifiedDelay()

      // TODO-8.D.ARMAMENT-DEFER: Sound playback requires SoundDevice integration
      // if (this.info.sound) { Game.Sound.PlayToPlayer(...) }

      this.ammoPool.giveAmmo(self, this.info.count)
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Compute the modified reload delay from active IReloadAmmoModifier traits. */
  private getModifiedDelay(): number {
    const percentages = this.modifiers.map(m => m.getReloadAmmoModifier())
    return applyPercentageModifiers(this.info.delay, percentages)
  }
}
