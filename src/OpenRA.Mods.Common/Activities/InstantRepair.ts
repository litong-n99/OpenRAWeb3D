/**
 * InstantRepair.ts — 即时修复活动 (extends Enter)
 * OpenRA 对照: OpenRA.Mods.Common/Activities/InstantRepair.cs
 *
 * 核心范式转换:
 * - C# sealed class InstantRepair : Enter → TypeScript class InstantRepair extends Enter
 * - C# IHealth trait → TypeScript duck-typed IHealthLike
 * - C# InstantlyRepairable trait → TypeScript duck-typed InstantlyRepairableLike
 * - C# self.Owner.RelationshipWith() → TypeScript duck-typed owner.relationshipWith()
 * - C# actor.InflictDamage(self, new Damage(-maxHP)) → TypeScript inflictDamage stub
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { Enter } from './Enter.js'
import type { GameActor } from '../../OpenRA.Game/Actor.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { ColorStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import {
  EnterBehaviour,
  DamageState,
  type IHealthLike,
  type InstantlyRepairableLike,
  type InstantlyRepairsInfoLike,
} from './UtilityActivityInterfaces.js'

// ---------------------------------------------------------------------------
// InstantRepair
// ---------------------------------------------------------------------------

/**
 * 即时修复 — 进入目标 actor 并立即将其 HP 恢复至满。
 *
 * OpenRA 对照: InstantRepair sealed class
 *
 * 继承 Enter 基类。TryStartEnter 检查目标是否可修复。
 * OnEnterComplete 执行一次性满血修复。
 */
export class InstantRepair extends Enter {
  private readonly info: InstantlyRepairsInfoLike

  private enterActor: GameActor | null = null
  private enterHealth: IHealthLike | null = null
  private enterInstantlyRepariable: InstantlyRepairableLike | null = null

  constructor(
    self: GameActor,
    target: Target,
    info: InstantlyRepairsInfoLike,
    targetLineColor: ColorStub | null = null,
  ) {
    super(self, target, targetLineColor)
    this.info = info
  }

  protected override tryStartEnter(self: GameActor, targetActor: GameActor): boolean {
    this.enterActor = targetActor
    this.enterHealth = InstantRepair._resolveHealth(targetActor)
    this.enterInstantlyRepariable = InstantRepair._resolveInstantlyRepairable(targetActor)

    const selfOwner = (self as unknown as { owner?: { relationshipWith?: (o: unknown) => number } }).owner
    const targetOwner = (targetActor as unknown as { owner?: unknown }).owner
    const stance = selfOwner?.relationshipWith?.(targetOwner) ?? 0

    if (this.enterHealth === null ||
        this.enterHealth.damageState === DamageState.Undamaged ||
        this.enterInstantlyRepariable === null ||
        this.enterInstantlyRepariable.isTraitDisabled ||
        !this.info.validRelationships.hasRelationship(stance)) {
      this.cancel(self, true)
      return false
    }

    return true
  }

  protected override onEnterComplete(self: GameActor, targetActor: GameActor): void {
    if (targetActor !== this.enterActor) return
    if (this.enterInstantlyRepariable === null || this.enterInstantlyRepariable.isTraitDisabled) return
    if (this.enterHealth === null || this.enterHealth.damageState === DamageState.Undamaged) return

    const selfOwner = (self as unknown as { owner?: { relationshipWith?: (o: unknown) => number } }).owner
    const targetOwner = (targetActor as unknown as { owner?: unknown }).owner
    const stance = selfOwner?.relationshipWith?.(targetOwner) ?? 0
    if (!this.info.validRelationships.hasRelationship(stance)) return

    // Full heal via negative damage
    const maxHP = this.enterHealth.maxHP
    const inflictFn = (targetActor as unknown as { inflictDamage?: (src: GameActor, dmg: { value: number }) => void }).inflictDamage
    if (inflictFn) {
      inflictFn.call(targetActor, self, { value: -maxHP })
    }

    // Audio stub — Sound system not yet migrated
    // if (this.info.repairSound) { Game.Sound.Play(...) }

    if (this.info.enterBehaviour === EnterBehaviour.Dispose) {
      self.dispose()
    } else if (this.info.enterBehaviour === EnterBehaviour.Suicide) {
      self.kill(self)
    }
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  private static _resolveHealth(actor: GameActor): IHealthLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<IHealthLike>
      if (typeof (t as { damageState?: unknown }).damageState !== 'undefined' &&
          typeof (t as { maxHP?: unknown }).maxHP === 'number') {
        return t as IHealthLike
      }
    }
    return null
  }

  private static _resolveInstantlyRepairable(actor: GameActor): InstantlyRepairableLike | null {
    const traits = (actor as unknown as { traits?: Map<string, unknown> }).traits
    for (const [, trait] of traits ?? []) {
      const t = trait as Partial<InstantlyRepairableLike>
      if (typeof (t as { isTraitDisabled?: unknown }).isTraitDisabled === 'boolean') {
        return t as InstantlyRepairableLike
      }
    }
    return null
  }
}
