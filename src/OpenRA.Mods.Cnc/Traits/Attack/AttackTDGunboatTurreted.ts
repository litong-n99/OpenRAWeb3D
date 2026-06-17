/**
 * AttackTDGunboatTurreted.ts — TD Gunboat 炮塔攻击（海军单位专用）
 * OpenRA 对照: OpenRA.Mods.Cnc/Traits/Attack/AttackTDGunboatTurreted.cs (83 lines)
 *
 * 核心范式转换:
 * - C# AttackTDGunboatTurreted : AttackTurreted → TS extends AttackTurreted
 * - C# AttackTDGunboatTurretedActivity : Activity → TS stub activity
 * - C# yield return → TS array-based TargetLineNodes
 * - 3D: turret node rotation on parent hull TransformNode
 */

import type { Target as TargetType_ } from '../../../OpenRA.Game/Traits/Target.js'
import { TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { TargetLineNode } from '../../../OpenRA.Game/Activities/Activity.js'
import {
  AttackTurreted,
  AttackTurretedInfo,
} from '../../../OpenRA.Mods.Common/Traits/Attack/AttackTurreted.js'
import { AttackSource } from '../../../OpenRA.Mods.Common/Traits/Attack/AttackBase.js'

// ---------------------------------------------------------------------------
// AttackTDGunboatTurretedInfo
// ---------------------------------------------------------------------------

export class AttackTDGunboatTurretedInfo extends AttackTurretedInfo {
  constructor(
    params: ConstructorParameters<typeof AttackTurretedInfo>[0] = {},
  ) {
    super(params)
  }
}

// ---------------------------------------------------------------------------
// GunboatAttackActivity
// ---------------------------------------------------------------------------

class GunboatAttackActivity {
  private readonly attack: AttackTDGunboatTurreted
  private readonly target: TargetType_
  private readonly targetLineColor: { r: number; g: number; b: number; a: number } | null
  private hasTicked: boolean = false

  constructor(
    attack: AttackTDGunboatTurreted,
    target: TargetType_,
    targetLineColor: { r: number; g: number; b: number; a: number } | null,
  ) {
    this.attack = attack
    this.target = target
    this.targetLineColor = targetLineColor
  }

  tick(self: IGameActor): boolean {
    const target = this.target as unknown as { isValidFor?: (owner: unknown) => boolean }
    if (target.isValidFor?.(self.owner) === false) return true

    if (this.attack.isTraitDisabled) return false

    const requested = this.attack.getRequestedTarget()
    if (this.hasTicked && requested.type === TargetType.Invalid) return true

    // OpenRA 对照: attack.ChooseArmamentsForTarget(target, forceAttack).FirstOrDefault()
    // Validate at least one armament can fire before committing to this target
    const chosen = this.attack.chooseArmamentsForTarget(this.target as TargetType_, false)
    if (!chosen || chosen.length === 0) return false

    // Use the parent's setRequestedTarget via duck-typed access
    const base = this.attack as unknown as {
      setRequestedTarget(t: TargetType_, forceAttack: boolean): void
    }
    base.setRequestedTarget(this.target, false)
    this.hasTicked = true

    return false
  }

  targetLineNodes(): TargetLineNode[] {
    if (this.targetLineColor !== null) {
      return [new TargetLineNode(this.target, this.targetLineColor)]
    }
    return []
  }
}

// ---------------------------------------------------------------------------
// AttackTDGunboatTurreted
// ---------------------------------------------------------------------------

export class AttackTDGunboatTurreted extends AttackTurreted {
  constructor(info: AttackTDGunboatTurretedInfo) {
    super(info)
  }

  override getAttackActivity(
    _self: IGameActor,
    _source: AttackSource,
    target: TargetType_,
    _allowMove: boolean,
    _forceAttack: boolean,
    targetLineColor?: string,
  ): unknown {
    const colorStub = targetLineColor
      ? { r: 220, g: 20, b: 60, a: 255 }
      : null

    return new GunboatAttackActivity(this, target, colorStub)
  }

  getRequestedTarget(): TargetType_ {
    const base = this as unknown as { requestedTarget?: TargetType_ }
    return base.requestedTarget ?? { type: TargetType.Invalid } as TargetType_
  }
}
