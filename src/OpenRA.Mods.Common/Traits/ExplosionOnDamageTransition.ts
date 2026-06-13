/**
 * ExplosionOnDamageTransition.ts -- Explosion triggered by damage state change
 * OpenRA 对照: OpenRA.Mods.Common/Traits/ExplosionOnDamageTransition.cs (78 lines)
 *
 * 核心范式转换:
 * - C# ConditionalTrait<ExplosionOnDamageTransitionInfo>, INotifyDamageStateChanged
 *   → TS ConditionalTrait<ExplosionOnDamageTransitionInfo> implementing INotifyDamageStateChanged
 * - C# WeaponInfo.Impact() → TS duck-typed weapon.impact()
 * - C# DamageState enum → TS DamageState const object from TraitsInterfaces
 */

import {
  ConditionalTrait,
  type ConditionalTraitInfo,
  type IGameActor,
  type AttackInfo,
  type INotifyDamageStateChanged,
  DamageState,
  type DamageState as DamageStateEnum,
} from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'

// ---------------------------------------------------------------------------
// ExplosionOnDamageTransitionInfo
// OpenRA 对照: ExplosionOnDamageTransitionInfo (ConditionalTraitInfo, IRulesetLoaded, Requires<IHealthInfo>)
// ---------------------------------------------------------------------------

/** Configuration for ExplosionOnDamageTransition trait.
 *
 *  OpenRA 对照: ExplosionOnDamageTransitionInfo
 */
export class ExplosionOnDamageTransitionInfo implements ConditionalTraitInfo {
  readonly instanceName?: string
  readonly requiresCondition?: string

  /** Weapon name to use for explosion.
   *
   *  OpenRA 对照: ExplosionOnDamageTransitionInfo.Weapon
   */
  readonly weapon: string | null = null

  /** At which damage state explosion will trigger.
   *
   *  OpenRA 对照: ExplosionOnDamageTransitionInfo.DamageState (default DamageState.Heavy)
   */
  readonly damageState: DamageStateEnum = DamageState.Heavy

  /** Should the explosion only be triggered once?
   *
   *  OpenRA 对照: ExplosionOnDamageTransitionInfo.TriggerOnlyOnce (default false)
   */
  readonly triggerOnlyOnce: boolean = false

  /** Whether this trait is enabled by default. */
  readonly enabledByDefault: boolean = true

  constructor(params: {
    instanceName?: string
    requiresCondition?: string
    weapon?: string | null
    damageState?: DamageStateEnum
    triggerOnlyOnce?: boolean
    enabledByDefault?: boolean
  } = {}) {
    this.instanceName = params.instanceName
    this.requiresCondition = params.requiresCondition
    this.weapon = params.weapon ?? null
    this.damageState = params.damageState ?? DamageState.Heavy
    this.triggerOnlyOnce = params.triggerOnlyOnce ?? false
    this.enabledByDefault = params.enabledByDefault ?? true
  }
}

// ---------------------------------------------------------------------------
// ExplosionOnDamageTransition
// OpenRA 对照: ExplosionOnDamageTransition (ConditionalTrait<Info>, INotifyDamageStateChanged)
// ---------------------------------------------------------------------------

/** Triggers an explosion on itself when transitioning to a specific damage state.
 *
 *  OpenRA 对照: ExplosionOnDamageTransition
 */
export class ExplosionOnDamageTransition
  extends ConditionalTrait<ExplosionOnDamageTransitionInfo>
  implements INotifyDamageStateChanged
{
  /** Whether the explosion has already been triggered (for TriggerOnlyOnce).
   *
   *  OpenRA 对照: ExplosionOnDamageTransition.triggered
   */
  private triggered: boolean = false

  // Cached weapon info (resolved at ruleset load time in C#, duck-typed in TS)
  private weaponInfo: unknown | null = null

  constructor(info: ExplosionOnDamageTransitionInfo) {
    super(info)
  }

  /** Set the resolved weapon info.
   *
   *  OpenRA 对照: ExplosionOnDamageTransitionInfo.RulesetLoaded() weapon resolution
   *
   *  Called at ruleset load time. In TS, weapon info is passed in via this method
   *  or resolved from the weapon registry.
   */
  setWeaponInfo(weaponInfo: unknown): void {
    this.weaponInfo = weaponInfo
  }

  /** Handle damage state change: trigger explosion if threshold crossed.
   *
   *  OpenRA 对照: INotifyDamageStateChanged.DamageStateChanged(Actor self, AttackInfo e)
   *
   *  @param self — the actor
   *  @param e — attack information (contains DamageState, PreviousDamageState)
   */
  damageStateChanged(self: IGameActor, e: AttackInfo): void {
    if (!self.isInWorld) return
    if (this.triggered) return
    if (this.isTraitDisabled) return

    if (
      e.damageState >= this.info.damageState &&
      e.previousDamageState < this.info.damageState
    ) {
      if (this.info.triggerOnlyOnce) {
        this.triggered = true
      }

      // Fire the weapon impact at the actor's center position
      if (this.weaponInfo) {
        const centerPos = (self as unknown as { centerPosition?: unknown }).centerPosition
        const weapon = this.weaponInfo as {
          impact?: (target: Target, attacker: IGameActor) => void
        }
        if (weapon.impact && centerPos) {
          weapon.impact(
            Target.fromPos(centerPos as Parameters<typeof Target.fromPos>[0]),
            e.attacker,
          )
        }
      }
    }
  }
}
