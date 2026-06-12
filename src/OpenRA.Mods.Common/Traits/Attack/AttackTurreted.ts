/**
 * AttackTurreted.ts -- Turret-based attack (turret must face target)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Attack/AttackTurreted.cs (51 lines)
 *
 * 核心范式转换:
 * - C# AttackTurreted : AttackFollow → TS AttackTurreted extends AttackFollow
 * - C# Turreted trait (turret rotation) → TS duck-typed Turreted
 * - canAttack checks that all turrets can face target
 */

import { Target, TargetType } from '../../../OpenRA.Game/Traits/Target.js'
import type { IGameActor } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { AttackFollow, AttackFollowInfo } from './AttackFollow.js'

// ---------------------------------------------------------------------------
// AttackTurretedInfo
// ---------------------------------------------------------------------------

/** Configuration for AttackTurreted.
 *
 *  OpenRA 对照: AttackTurretedInfo : AttackFollowInfo, Requires<TurretedInfo>
 */
export class AttackTurretedInfo extends AttackFollowInfo {
  /** Turret names to check.
   *
   *  OpenRA 对照: AttackTurretedInfo.Turrets
   */
  readonly turrets: readonly string[] = ['primary']

  constructor(
    params: {
      armaments?: string[]
      turrets?: string[]
      opportunityFire?: boolean
      persistentTargeting?: boolean
      rangeMargin?: number | null
      abortOnResupply?: boolean
    } & ConstructorParameters<typeof AttackFollowInfo>[0] = {},
  ) {
    super(params)
    this.turrets = params.turrets ?? ['primary']
  }
}

// ---------------------------------------------------------------------------
// AttackTurreted
// OpenRA 对照: AttackTurreted (AttackFollow)
// ---------------------------------------------------------------------------

/** Turret-based attack: all turrets must face the target.
 *
 *  OpenRA 对照: AttackTurreted
 *
 *  Requires Turreted trait on the actor. Uses duck-typed access
 *  since Turreted is in Phase E.
 */
export class AttackTurreted extends AttackFollow {
  /** Duck-typed turret traits matching configured names. */
  protected turretTraits: Array<{
    name?: string
    faceTarget?: (self: IGameActor, target: Target) => boolean
  }> = []

  constructor(info: AttackTurretedInfo) {
    super(info)

    // Store turret name list for later resolution
    this._turretNames = info.turrets
  }

  private _turretNames: readonly string[]

  /** Initialize after actor creation: find turret traits.
   *
   *  OpenRA 对照: AttackTurreted constructor (finds Turreted traits)
   */
  override onCreated(self: IGameActor): void {
    super.onCreated(self)

    const actorAny = self as unknown as {
      getTraits?: <T>(name: string) => T[]
    }
    const turrets = (actorAny.getTraits?.<unknown>('turreted') ?? []) as Array<{
      name?: string
      info?: { turret?: string }
      faceTarget?: (self: IGameActor, target: Target) => boolean
    }>

    this.turretTraits = turrets.filter(t =>
      this._turretNames.includes(t.info?.turret ?? 'primary'),
    )
  }

  /** Check if turrets can face the target before allowing attack.
   *
   *  OpenRA 对照: AttackTurreted.CanAttack(Actor, Target)
   */
  canAttack(self: IGameActor, target: Target): boolean {
    if (target.type === TargetType.Invalid) return false

    // Bring all turrets to bear on the target
    let turretReady = false
    for (const t of this.turretTraits) {
      if (t.faceTarget?.(self, target)) {
        turretReady = true
      }
    }

    return turretReady && super.canAttack(self, target)
  }
}
