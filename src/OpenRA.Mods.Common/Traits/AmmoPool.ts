/**
 * AmmoPool.ts -- Limited ammunition for actor weapons
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AmmoPool.cs (119 lines)
 *
 * 核心范式转换:
 * - C# INotifyCreated, INotifyAttack, ISync → TS interfaces
 * - C# Stack<int> for condition tokens → TS number[] as a stack
 * - C# HasAmmo/HasFullAmmo properties → TS getters
 * - C# AmmoUsage consumption on attack → TS attacking() method
 */

import type { IGameActor, ITraitInfoInterface, ISync } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { Barrel, INotifyAttack } from './CombatInterfaces.js'

// ---------------------------------------------------------------------------
// AmmoPoolInfo
// OpenRA 对照: AmmoPoolInfo (TraitInfo)
// ---------------------------------------------------------------------------

/** Configuration for an AmmoPool trait.
 *
 *  OpenRA 对照: AmmoPoolInfo
 */
export class AmmoPoolInfo implements ITraitInfoInterface {
  readonly instanceName?: string

  /** Name of this ammo pool, used to link reload traits.
   *
   *  OpenRA 对照: AmmoPoolInfo.Name (default "primary")
   */
  readonly name: string = 'primary'

  /** Name(s) of armament(s) that use this pool.
   *
   *  OpenRA 对照: AmmoPoolInfo.Armaments
   */
  readonly armaments: readonly string[] = ['primary', 'secondary']

  /** Maximum ammo capacity.
   *
   *  OpenRA 对照: AmmoPoolInfo.Ammo
   */
  readonly ammo: number = 1

  /** Initial ammo count (defaults to Ammo if -1).
   *
   *  OpenRA 对照: AmmoPoolInfo.InitialAmmo
   */
  readonly initialAmmo: number = -1

  /** Ammo reloaded per reload cycle.
   *
   *  OpenRA 对照: AmmoPoolInfo.ReloadCount
   */
  readonly reloadCount: number = 1

  /** Sound played for each reloaded ammo magazine.
   *
   *  OpenRA 对照: AmmoPoolInfo.RearmSound
   */
  readonly rearmSound: string | null = null

  // HACK: Temporarily kept until Rearm activity is gone
  /** Time to reload per ReloadCount on airfield etc.
   *
   *  OpenRA 对照: AmmoPoolInfo.ReloadDelay
   */
  readonly reloadDelay: number = 50

  /** Condition granted for each ammo point in this pool.
   *
   *  OpenRA 对照: AmmoPoolInfo.AmmoCondition
   */
  readonly ammoCondition: string | null = null

  constructor(params: {
    instanceName?: string
    name?: string
    armaments?: string[]
    ammo?: number
    initialAmmo?: number
    reloadCount?: number
    rearmSound?: string | null
    reloadDelay?: number
    ammoCondition?: string | null
  } = {}) {
    this.instanceName = params.instanceName
    this.name = params.name ?? 'primary'
    this.armaments = params.armaments ?? ['primary', 'secondary']
    this.ammo = params.ammo ?? 1
    this.initialAmmo = params.initialAmmo ?? -1
    this.reloadCount = params.reloadCount ?? 1
    this.rearmSound = params.rearmSound ?? null
    this.reloadDelay = params.reloadDelay ?? 50
    this.ammoCondition = params.ammoCondition ?? null
  }
}

// ---------------------------------------------------------------------------
// AmmoPool
// OpenRA 对照: AmmoPool (INotifyCreated, INotifyAttack, ISync)
// ---------------------------------------------------------------------------

/** Limited ammunition pool for actor weapons.
 *
 *  OpenRA 对照: AmmoPool
 *
 *  Manages ammo count, condition tokens, and consumption on attack.
 */
export class AmmoPool implements INotifyAttack, ISync {
  /** Configuration for this ammo pool. */
  readonly info: AmmoPoolInfo

  /** Current ammo count (network-synced).
   *
   *  OpenRA 对照: AmmoPool.CurrentAmmoCount
   */
  currentAmmoCount: number

  // HACK: Temporarily needed until Rearm activity is gone
  /** Remaining ticks until reload (network-synced).
   *
   *  OpenRA 对照: AmmoPool.RemainingTicks
   */
  remainingTicks: number

  /** Condition tokens granted per ammo point. */
  private tokens: number[] = []

  /** Whether this pool has any ammo.
   *
   *  OpenRA 对照: AmmoPool.HasAmmo
   */
  get hasAmmo(): boolean {
    return this.currentAmmoCount > 0
  }

  /** Whether this pool is at full capacity.
   *
   *  OpenRA 对照: AmmoPool.HasFullAmmo
   */
  get hasFullAmmo(): boolean {
    return this.currentAmmoCount >= this.info.ammo
  }

  constructor(info: AmmoPoolInfo) {
    this.info = info
    this.currentAmmoCount =
      info.initialAmmo < info.ammo && info.initialAmmo >= 0
        ? info.initialAmmo
        : info.ammo
    this.remainingTicks = info.reloadDelay
  }

  // ---------------------------------------------------------------------------
  // INotifyCreated
  // ---------------------------------------------------------------------------

  /** Initialize ammo conditions after actor creation.
   *
   *  OpenRA 对照: INotifyCreated.Created()
   */
  created(self: IGameActor): void {
    this.updateCondition(self)
    // HACK: Temporarily needed until Rearm activity is gone
    this.remainingTicks = this.info.reloadDelay
  }

  // ---------------------------------------------------------------------------
  // INotifyAttack
  // ---------------------------------------------------------------------------

  /** Callback before an armament fires (no-op for ammo pool).
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

  /** Consume ammo when an armament fires.
   *
   *  OpenRA 对照: INotifyAttack.Attacking()
   */
  attacking(
    self: IGameActor,
    _target: Target,
    armament: unknown,
    _barrel: Barrel,
  ): void {
    if (!armament) return

    const a = armament as { info: { name: string; ammoUsage: number } }
    if (this.info.armaments.includes(a.info.name)) {
      this.takeAmmo(self, a.info.ammoUsage)
    }
  }

  // ---------------------------------------------------------------------------
  // Ammo management
  // ---------------------------------------------------------------------------

  /** Give ammo to this pool.
   *
   *  OpenRA 对照: AmmoPool.GiveAmmo(Actor, int)
   *
   *  @returns true if ammo was actually added
   */
  giveAmmo(self: IGameActor, count: number): boolean {
    if (this.currentAmmoCount >= this.info.ammo || count < 0) return false

    this.currentAmmoCount = Math.max(
      0,
      Math.min(this.currentAmmoCount + count, this.info.ammo),
    )
    this.updateCondition(self)
    return true
  }

  /** Take ammo from this pool.
   *
   *  OpenRA 对照: AmmoPool.TakeAmmo(Actor, int)
   *
   *  @returns true if ammo was actually consumed
   */
  takeAmmo(self: IGameActor, count: number): boolean {
    if (this.currentAmmoCount <= 0 || count < 0) return false

    this.currentAmmoCount = Math.max(
      0,
      Math.min(this.currentAmmoCount - count, this.info.ammo),
    )
    this.updateCondition(self)
    return true
  }

  // ---------------------------------------------------------------------------
  // Condition management
  // OpenRA 对照: AmmoPool.UpdateCondition()
  // ---------------------------------------------------------------------------

  /** Update condition tokens to match current ammo count.
   *
   *  OpenRA 对照: AmmoPool.UpdateCondition()
   *
   *  Grants/revokes AmmoCondition tokens so the number of tokens equals
   *  currentAmmoCount (clamped to Ammo capacity).
   */
  private updateCondition(self: IGameActor): void {
    const condition = this.info.ammoCondition
    if (!condition) return

    const needed = Math.min(this.currentAmmoCount, this.info.ammo)

    while (needed > this.tokens.length && this.tokens.length < this.info.ammo) {
      const token = self.grantCondition?.(condition) ?? -1
      if (token >= 0) this.tokens.push(token)
      else break
    }

    while (needed < this.tokens.length && this.tokens.length > 0) {
      const token = this.tokens.pop()!
      self.revokeCondition?.(token)
    }
  }
}
