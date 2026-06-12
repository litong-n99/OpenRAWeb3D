/**
 * ProtectionStates.ts — squad states for defensive/protection behavior (STUB)
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/Squads/States/ProtectionStates.cs
 *
 * 核心范式转换:
 * - C# GroundStateBase : StateBase, IState → TypeScript stub classes
 * - C# UnitsForProtectionIdleState, AttackState, FleeState → deferred stubs
 *
 * STUB — full migration deferred to Chapter 8.
 * Phase D/E squad states (GroundStates, AirStates) are implemented separately.
 *
 * @todo Chapter 8: Implement protection squad logic with full attack/retreat AI.
 */

import { StateBase } from './StateBase.js'
import type { IState } from '../StateMachine.js'
import type { Squad } from '../Squad.js'

// ---------------------------------------------------------------------------
// UnitsForProtectionIdleState (STUB)
// ---------------------------------------------------------------------------

/**
 * Protection squad idle state — STUB.
 *
 * OpenRA 对照: UnitsForProtectionIdleState : GroundStateBase, IState
 *
 * @todo Chapter 8: Implement idle behavior for protection squads.
 */
export class UnitsForProtectionIdleState extends StateBase implements IState {
  activate(_squad: Squad): void { }
  tick(_squad: Squad): boolean {
    return false
  }
  deactivate(_squad: Squad): void { }
}

// ---------------------------------------------------------------------------
// UnitsForProtectionAttackState (STUB)
// ---------------------------------------------------------------------------

/**
 * Protection squad attack state — STUB.
 *
 * OpenRA 对照: UnitsForProtectionAttackState : GroundStateBase, IState
 *
 * @todo Chapter 8: Implement attack behavior for protection squads.
 */
export class UnitsForProtectionAttackState extends StateBase implements IState {
  activate(_squad: Squad): void { }
  tick(_squad: Squad): boolean {
    return false
  }
  deactivate(_squad: Squad): void { }
}

// ---------------------------------------------------------------------------
// UnitsForProtectionFleeState (STUB)
// ---------------------------------------------------------------------------

/**
 * Protection squad flee state — STUB.
 *
 * OpenRA 对照: UnitsForProtectionFleeState : GroundStateBase, IState
 *
 * @todo Chapter 8: Implement flee behavior for protection squads.
 */
export class UnitsForProtectionFleeState extends StateBase implements IState {
  activate(_squad: Squad): void { }
  tick(_squad: Squad): boolean {
    return false
  }
  deactivate(_squad: Squad): void { }
}
