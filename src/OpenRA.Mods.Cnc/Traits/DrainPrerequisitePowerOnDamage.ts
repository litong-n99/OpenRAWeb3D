/**
 * DrainPrerequisitePowerOnDamage.ts — 受到伤害时消耗先决条件能量的支援能力
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/DrainPrerequisitePowerOnDamage.cs (62 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<DrainPrerequisitePowerOnDamageInfo> → TypeScript ConditionalTrait
 * - C# IDamageModifier.GetDamageModifier() → TypeScript damage modifier interface
 * - C# GrantPrerequisiteChargeDrainPower.DischargeableSupportPowerInstance cast
 *   → TypeScript runtime type check with method presence
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ConditionalTrait } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// DrainPrerequisitePowerOnDamageInfo
// OpenRA 对照: DrainPrerequisitePowerOnDamageInfo : ConditionalTraitInfo
// ---------------------------------------------------------------------------

/** Configuration for draining prerequisite power on damage.
 *
 * OpenRA 对照: DrainPrerequisitePowerOnDamageInfo
 */
export class DrainPrerequisitePowerOnDamageInfo implements ITraitInfo {
  /** The OrderName of the GrantPrerequisiteChargeDrainPower to drain.
   *
   * OpenRA 对照: DrainPrerequisitePowerOnDamageInfo.OrderName
   */
  readonly orderName: string

  /** Damage is multiplied by this number when converting to drain ticks.
   *
   * OpenRA 对照: DrainPrerequisitePowerOnDamageInfo.DamageMultiplier
   */
  readonly damageMultiplier: number

  /** Damage is divided by this number when converting to drain ticks.
   *
   * OpenRA 对照: DrainPrerequisitePowerOnDamageInfo.DamageDivisor
   */
  readonly damageDivisor: number

  /** Whether this trait can be paused.
   *
   * OpenRA 对照: ConditionalTraitInfo pausing support
   */
  readonly pausable?: boolean

  constructor(params?: {
    orderName?: string
    damageMultiplier?: number
    damageDivisor?: number
    pausable?: boolean
  }) {
    this.orderName = params?.orderName ?? 'GrantPrerequisiteChargeDrainPowerInfoOrder'
    this.damageMultiplier = params?.damageMultiplier ?? 1
    this.damageDivisor = params?.damageDivisor ?? 600
    this.pausable = params?.pausable
  }

  create(init: IGameActor): DrainPrerequisitePowerOnDamage {
    return new DrainPrerequisitePowerOnDamage(this)
  }
}

// ---------------------------------------------------------------------------
// DrainPrerequisitePowerOnDamage
// OpenRA 对照: DrainPrerequisitePowerOnDamage : ConditionalTrait<...>, INotifyOwnerChanged, IDamageModifier
// ---------------------------------------------------------------------------

/** Converts incoming damage to drain ticks on a GrantPrerequisiteChargeDrainPower.
 *
 * OpenRA 对照: DrainPrerequisitePowerOnDamage
 *
 * When the actor takes damage, a portion of the damage amount is converted
 * to subtick drain on a linked GrantPrerequisiteChargeDrainPower, effectively
 * depleting its charge faster while under attack.
 */
export class DrainPrerequisitePowerOnDamage extends ConditionalTrait<DrainPrerequisitePowerOnDamageInfo> {
  /** Reference to the player's SupportPowerManager.
   *
   * OpenRA 对照: DrainPrerequisitePowerOnDamage.spm (SupportPowerManager)
   */
  private _spm: unknown = null

  constructor(info: DrainPrerequisitePowerOnDamageInfo) {
    super(info)
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Called after the actor is created. Acquires the SupportPowerManager.
   *
   * OpenRA 对照: DrainPrerequisitePowerOnDamage.Created(Actor)
   */
  protected override onCreated(self: IGameActor): void {
    // NOTE: In OpenRA: spm = self.Owner.PlayerActor.Trait<SupportPowerManager>()
    // SupportPowerManager lookup requires PlayerActor access.
    // Store owner reference for later SPM access.
    const playerActor = (self as any).owner?.playerActor
    if (playerActor && typeof playerActor.getSupportPowerManager === 'function') {
      this._spm = playerActor.getSupportPowerManager()
    }
  }

  /** Handle owner change.
   *
   * OpenRA 对照: INotifyOwnerChanged.OnOwnerChanged(Actor, Player, Player)
   */
  onOwnerChanged(self: IGameActor): void {
    const playerActor = (self as any).owner?.playerActor
    if (playerActor && typeof playerActor.getSupportPowerManager === 'function') {
      this._spm = playerActor.getSupportPowerManager()
    }
  }

  // -------------------------------------------------------------------------
  // IDamageModifier
  // -------------------------------------------------------------------------

  /** Get the damage modifier. Converts damage to GrantPrerequisiteChargeDrainPower drain.
   *
   * OpenRA 对照: IDamageModifier.GetDamageModifier(Actor, Damage)
   *
   * @param self — the damaged actor
   * @param damage — the incoming damage (optional; null/undefined means no damage)
   * @returns 100 (always returns 100%, damage modification is not applied here)
   */
  getDamageModifier(self: IGameActor, damage?: { value: number } | null): number {
    if (this.isTraitDisabled || !damage || !this._spm) {
      return 100
    }

    // Convert damage to subtick drain
    // C#: (int)(damage.Value * 100L * Info.DamageMultiplier / Info.DamageDivisor)
    const damageSubTicks = Math.floor(
      (damage.value * 100 * this.info.damageMultiplier) / this.info.damageDivisor,
    )

    // Try to access the DischargeableSupportPowerInstance via the SPM
    const spm = this._spm as any
    if (spm?.powers?.has(this.info.orderName)) {
      const spi = spm.powers.get(this.info.orderName)
      if (spi && typeof spi.discharge === 'function') {
        spi.discharge(damageSubTicks)
      }
    }

    void self
    return 100
  }
}
