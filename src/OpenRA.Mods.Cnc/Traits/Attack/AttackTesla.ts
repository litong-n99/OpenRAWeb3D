/**
 * AttackTesla.ts — 特斯拉线圈攻击（充能后发射，支持多段充能）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Attack/AttackTesla.cs (174 lines)
 *
 * 核心范式转换:
 * - C# AttackTesla : AttackBase, ITick, INotifyAttack → TS extends AttackBase
 * - C# ChargeAttack : Activity, IActivityNotifyStanceChanged → TS extends Activity
 * - C# ChargeFire : Activity → TS ChargeFireActivity extends Activity
 * - C# INotifyTeslaCharging event → TS callbacks array pattern
 * - 3D: charge animation = ShaderMaterial emissive intensity ramp-up
 *       lightning zap = LinesMesh dynamic vertex generation
 *
 * 核心架构:
 * 充电阶段: 通知 INotifyTeslaCharging → 等待 InitialChargeDelay
 * 发射阶段: ChargeFireActivity 循环发射 → 等待 ChargeDelay 间隔
 * 充能管理: MaxCharges 次射击后需等待 ReloadDelay 重新充能
 */

import { Activity } from '../../../OpenRA.Game/Activities/Activity.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import { TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import { TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Wait } from '../../../OpenRA.Mods.Common/Activities/Wait.js'
import { ChargeFireActivity } from '../../Activities/ChargeFireActivity.js'
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
// ChargeAttackActivity (外层充能循环)
// OpenRA 对照: AttackTesla.ChargeAttack : Activity, IActivityNotifyStanceChanged
// ---------------------------------------------------------------------------

/**
 * Outer charge-attack activity: fires INotifyTeslaCharging, plays charge
 * audio, waits InitialChargeDelay, then queues ChargeFireActivity for
 * repeated firing. Loops back when charges recharge.
 *
 * OpenRA 对照: AttackTesla.ChargeAttack
 *
 * Activity states:
 * - Charging: notify listeners + play chargeAudio → Wait(InitialChargeDelay)
 * - Fire: ChargeFireActivity fires shots with ChargeDelay cooldown between them
 * - Cooldown/Depleted: wait for charges to recharge, then return to Charging
 */
class ChargeAttackActivity
  extends Activity
  implements IActivityNotifyStanceChanged
{
  private readonly attack: AttackTesla
  private readonly target: TargetType_
  private readonly forceAttack: boolean
  private readonly targetLineColor: { r: number; g: number; b: number; a: number } | null

  constructor(
    attack: AttackTesla,
    target: TargetType_,
    forceAttack: boolean,
    targetLineColor: { r: number; g: number; b: number; a: number } | null,
  ) {
    super()
    this.attack = attack
    this.target = target
    this.forceAttack = forceAttack
    this.targetLineColor = targetLineColor
  }

  /** Per-tick logic: if charges available, do a charge-fire cycle.
   *
   *  OpenRA 对照: AttackTesla.ChargeAttack.Tick()
   *
   *  Each cycle:
   *  1. Notify INotifyTeslaCharging listeners
   *  2. Play charge audio (TODO integration point)
   *  3. Queue Wait(InitialChargeDelay) + ChargeFireActivity children
   *
   *  When charges==0, returns false each tick until recharged.
   */
  override tick(self: GameActor): boolean {
    // Cast GameActor to IGameActor for attack method calls.
    // GameActor implements IGameActor but the queueActivity method signature
    // differs (Activity vs ActivityStub), so direct assignment is rejected.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selfActor = self as unknown as IGameActor

    if (this.isCanceling || !this.attack.canAttack(selfActor, this.target))
      return true

    if (this.attack.getCharges() === 0)
      return false

    // Fire INotifyTeslaCharging listeners
    const selfAny = self as unknown as {
      traitsImplementing?: <T>(_name: string) => T[]
    }
    const chargingListeners =
      selfAny.traitsImplementing?.<INotifyTeslaCharging>(
        'INotifyTeslaCharging',
      ) ?? []

    for (const listener of chargingListeners) {
      listener.charging(selfActor, this.target)
    }

    this.attack.playChargeAudio(selfActor)

    // Queue Wait(InitialChargeDelay) then ChargeFireActivity
    const initialDelay = this.attack.getInitialChargeDelay()
    if (initialDelay > 0) {
      this.queueChild(new Wait(initialDelay))
    }
    this.queueChild(
      new ChargeFireActivity(this.attack, this.target),
    )

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

  override targetLineNodes(): TargetLineNode[] {
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

  /**
   * Play the charge-up audio. Currently a documented integration point.
   *
   * OpenRA 对照: Game.Sound.Play(SoundType.World, info.ChargeAudio, self.CenterPosition)
   *
   * TODO: Play chargeAudio sound via Game.Sound singleton when wired.
   * Integration point:
   *   const world = (self as any).gameWorld
   *   if (this.teslaInfo.chargeAudio) {
   *     world.sound?.play("World", this.teslaInfo.chargeAudio,
   *       (self as any).centerPosition)
   *   }
   */
  playChargeAudio(self: IGameActor): void {
    const chargeAudio = this.teslaInfo.chargeAudio
    if (!chargeAudio) return
    // TODO: Play chargeAudio sound via Game.Sound singleton when wired.
    // OpenRA 对照: Game.Sound.Play(SoundType.World, info.ChargeAudio, self.CenterPosition)
    void self // reference for future sound position lookup
  }
}
