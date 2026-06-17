/**
 * AttackTesla.ts — 特斯拉线圈攻击（充能后发射，支持多段充能）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Attack/AttackTesla.cs (174 lines)
 *
 * 核心范式转换:
 * - C# AttackTesla : AttackBase, ITick, INotifyAttack → TS extends AttackBase
 * - C# ChargeAttack : Activity, IActivityNotifyStanceChanged → TS stub activity
 * - C# INotifyTeslaCharging event → TS callbacks array pattern
 * - 3D: charge animation = ShaderMaterial emissive intensity ramp-up
 *       lightning zap = LinesMesh dynamic vertex generation
 *
 * 核心架构:
 * 充电阶段: 通知 INotifyTeslaCharging → 等待 InitialChargeDelay
 * 发射阶段: doAttack() → 等待 ChargeDelay
 * 充能管理: MaxCharges 次射击后需等待 ReloadDelay 重新充能
 */

import { TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import {
  AttackBase,
  AttackBaseInfo,
  AttackSource,
} from '../../../OpenRA.Mods.Common/Traits/Attack/AttackBase.js'
import {
  UnitStance,
  type IActivityNotifyStanceChanged,
} from '../../../OpenRA.Mods.Common/Traits/CombatInterfaces.js'
import { type INotifyTeslaCharging } from '../../TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// AttackTeslaInfo
// ---------------------------------------------------------------------------

export class AttackTeslaInfo extends AttackBaseInfo {
  readonly maxCharges: number = 1
  readonly reloadDelay: number = 120
  readonly initialChargeDelay: number = 22
  readonly chargeDelay: number = 3
  readonly chargeAudio: string | null = null

  constructor(
    params: Partial<AttackTeslaInfo> &
      ConstructorParameters<typeof AttackBaseInfo>[0] = {},
  ) {
    super(params)
    this.maxCharges = params.maxCharges ?? 1
    this.reloadDelay = params.reloadDelay ?? 120
    this.initialChargeDelay = params.initialChargeDelay ?? 22
    this.chargeDelay = params.chargeDelay ?? 3
    this.chargeAudio = params.chargeAudio ?? null
  }
}

// ---------------------------------------------------------------------------
// ChargeAttackActivity
// ---------------------------------------------------------------------------

class ChargeAttackActivity implements IActivityNotifyStanceChanged {
  private readonly attack: AttackTesla
  private readonly target: TargetType_
  private readonly forceAttack: boolean
  private readonly targetLineColor: { r: number; g: number; b: number; a: number } | null

  /** Tick counter for charge delays. Counts down from InitialChargeDelay
   *  before first shot, then from ChargeDelay between subsequent shots.
   *
   *  OpenRA 对照: AttackTesla.InitialChargeDelay (22 ticks) +
   *               AttackTesla.ChargeDelay (3 ticks per shot)
   */
  private chargeTick: number

  /** Whether the initial charge-up phase has completed. */
  private initialChargeComplete: boolean = false

  constructor(
    attack: AttackTesla,
    target: TargetType_,
    forceAttack: boolean,
    targetLineColor: { r: number; g: number; b: number; a: number } | null,
  ) {
    this.attack = attack
    this.target = target
    this.forceAttack = forceAttack
    this.targetLineColor = targetLineColor
    this.chargeTick = attack.getInitialChargeDelay()
  }

  /** Per-tick logic: waits for charge delay, fires INotifyTeslaCharging
   *  during wind-up, then fires the weapon when delay expires.
   *
   *  OpenRA 对照: AttackTesla.ChargeAttack.Tick()
   *  - C# yield return InitialChargeDelay → TS chargeTick countdown
   *  - C# ChargeFire sub-activity → TS inline (TODO-19.A.22-FULL)
   *
   *  TODO-19.A.22-FULL: Extract ChargeFire as a separate activity with
   *  Wait child activities for proper animation sequencing.
   */
  tick(self: IGameActor): boolean {
    if (!this.attack.canAttack(self, this.target)) return true
    if (this.attack.getCharges() === 0) return false

    // Count down the current charge delay
    if (--this.chargeTick > 0) return false

    // Fire INotifyTeslaCharging during initial charge-up
    if (!this.initialChargeComplete) {
      const selfAny = self as unknown as {
        traitsImplementing?: <T>(_name: string) => T[]
      }
      const chargingListeners =
        selfAny.traitsImplementing?.<INotifyTeslaCharging>(
          'INotifyTeslaCharging',
        ) ?? []

      for (const listener of chargingListeners) {
        listener.charging(self, this.target)
      }

      this.initialChargeComplete = true
    }

    this.attack.playChargeAudio(self)
    this.attack.doAttack(self, this.target)

    // Reset charge delay for next shot (ChargeDelay ticks between shots)
    this.chargeTick = this.attack.getChargeDelay()

    return false
  }

  stanceChanged(
    _self: IGameActor,
    autoTarget: unknown,
    oldStance: UnitStance,
    newStance: UnitStance,
  ): void {
    if (newStance > oldStance || this.forceAttack) return

    void autoTarget
  }

  targetLineNodes(): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(this.target, this.targetLineColor)]
    }
    return []
  }
}

// ---------------------------------------------------------------------------
// AttackTesla
// ---------------------------------------------------------------------------

export class AttackTesla extends AttackBase {
  private charges: number
  private timeToRechargeInternal: number

  constructor(info: AttackTeslaInfo) {
    super(info)
    this.charges = info.maxCharges
    this.timeToRechargeInternal = 0
  }

  /** Typed info accessor. */
  private get teslaInfo(): AttackTeslaInfo {
    return this.info as unknown as AttackTeslaInfo
  }

  tick(_self: IGameActor): void {
    if (--this.timeToRechargeInternal <= 0) {
      this.charges = this.teslaInfo.maxCharges
    }
  }

  override canAttack(self: IGameActor, target: TargetType_): boolean {
    if (target.type === TargetType.Invalid) return false
    return super.canAttack(self, target)
  }

  onAttack(): void {
    this.charges--
    this.timeToRechargeInternal = this.teslaInfo.reloadDelay
  }

  onPreparingAttack(): void {
    // No-op
  }

  override getAttackActivity(
    _self: IGameActor,
    _source: AttackSource,
    target: TargetType_,
    _allowMove: boolean,
    forceAttack: boolean,
    targetLineColor?: string,
  ): unknown {
    // Convert string color to ColorStub-like object
    const colorStub = targetLineColor
      ? { r: 0, g: 128, b: 255, a: 255 }
      : null

    return new ChargeAttackActivity(this, target, forceAttack, colorStub)
  }

  getCharges(): number { return this.charges }
  getTimeToRecharge(): number { return this.timeToRechargeInternal }
  getChargeDelay(): number { return this.teslaInfo.chargeDelay }
  getInitialChargeDelay(): number { return this.teslaInfo.initialChargeDelay }

  playChargeAudio(self: IGameActor): void {
    const chargeAudio = this.teslaInfo.chargeAudio
    if (!chargeAudio) return
    // TODO-19.A.22-AUDIO: Play chargeAudio sound at self.centerPosition
    // Requires Ch7 Phase D Sound system integration.
    // OpenRA 对照: Game.Sound.Play(SoundType.World, info.ChargeAudio, self.CenterPosition)
    void self // reference for future sound position lookup
  }
}
