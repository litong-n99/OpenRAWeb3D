/**
 * AttackWander.ts -- Wander-and-attack patrol behavior (STUB)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/AttackWander.cs (39 lines)
 *
 * 核心范式转换:
 * - C# AttackWander : Wanders → TS stub (Wanders not yet migrated)
 */

import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// TODO-8.D.DEFER-WANDERS: Full implementation requires Wanders trait (Chapter 14).
// When Wanders is migrated, AttackWander is a thin override:
//   class AttackWander extends Wanders {
//     override doAction(self, targetCell) {
//       self.queueActivity(new AttackMoveActivity(self, () => this.move.moveTo(targetCell), false))
//     }
//   }

// ---------------------------------------------------------------------------
// AttackWanderInfo
// ---------------------------------------------------------------------------

/** Stub configuration for AttackWander.
 *
 *  OpenRA 对照: AttackWanderInfo : WandersInfo
 */
export class AttackWanderInfo {
  readonly instanceName?: string

  /** Wander radius (from parent Wanders class).
   *
   *  OpenRA 对照: WandersInfo.WanderRadius
   */
  readonly wanderRadius: number = 1

  /** Time between wander actions (from parent Wanders class).
   *
   *  OpenRA 对照: WandersInfo.MinMoveDelay / MaxMoveDelay
   */
  readonly minMoveDelay: number = 0
  readonly maxMoveDelay: number = 0

  constructor(params: {
    instanceName?: string
    wanderRadius?: number
    minMoveDelay?: number
    maxMoveDelay?: number
  } = {}) {
    this.instanceName = params.instanceName
    this.wanderRadius = params.wanderRadius ?? 1
    this.minMoveDelay = params.minMoveDelay ?? 0
    this.maxMoveDelay = params.maxMoveDelay ?? 0
  }
}

// ---------------------------------------------------------------------------
// AttackWander (STUB)
// ---------------------------------------------------------------------------

/** Wander-and-attack patrol: picks random cells and attack-moves to them.
 *
 *  OpenRA 对照: AttackWander (sealed class, extends Wanders)
 *
 *  TODO-8.D.DEFER-WANDERS: Full implementation deferred until Wanders trait
 *  is migrated in Chapter 14.
 */
export class AttackWander {
  readonly info: AttackWanderInfo

  constructor(info: AttackWanderInfo) {
    this.info = info
  }

  /** Tick: when idle, pick a random cell and attack-move to it.
   *
   *  OpenRA 对照: Wanders.Tick() + AttackWander.DoAction()
   */
  tickIdle(_self: IGameActor): void {
    // TODO-8.D.DEFER-WANDERS: Implement when Wanders is available.
    // Wanders trait is planned for Chapter 14 (Activities).
    console.warn(
      'TODO-8.D.DEFER-WANDERS: AttackWander.tickIdle() not yet implemented. ' +
      'Wanders trait is planned for Chapter 14 (Activities).',
    )
  }
}
