/**
 * StateMachine.ts — lightweight state machine for Squad behavior state transitions
 * OpenRA 对照: OpenRA.Mods.Common/Traits/BotModules/Squads/StateMachine.cs
 *
 * 核心范式转换:
 * - C# IState interface (Activate/Tick/Deactivate) → TypeScript IState interface
 * - C# sealed StateMachine class → TypeScript StateMachine class
 * - C# mutable currentState field → TypeScript private _currentState with null guard
 * - State transitions are triggered by BT node results:
 *   Success → transition to next state
 *   Failure → stay in current state
 *
 * This is a thin wrapper that delegates to the current IState.
 * It does NOT contain behavior tree logic itself — the Squad uses this
 * to manage its state, and each state's tick() method can internally
 * use a behavior tree to make decisions.
 */

import type { Squad } from './Squad.js'

// ---------------------------------------------------------------------------
// IState — interface for squad states
// ---------------------------------------------------------------------------

/**
 * Interface for a squad state.
 *
 * OpenRA 对照: IState interface (in StateMachine.cs)
 *
 * States are pre-allocated singletons or flyweights — no per-frame allocation.
 * Each state can use a behavior tree internally for decision-making.
 */
export interface IState {
  /**
   * Called when this state is entered.
   *
   * OpenRA 对照: IState.Activate(Squad)
   */
  activate(squad: Squad): void

  /**
   * Called each tick while this state is active.
   *
   * OpenRA 对照: IState.Tick(Squad)
   *
   * @returns boolean: true if the state has completed (should transition), false if still running
   */
  tick(squad: Squad): boolean

  /**
   * Called when this state is exited.
   *
   * OpenRA 对照: IState.Deactivate(Squad)
   */
  deactivate(squad: Squad): void
}

// ---------------------------------------------------------------------------
// StateMachine
// ---------------------------------------------------------------------------

/**
 * Lightweight state machine for squad states.
 *
 * OpenRA 对照: StateMachine sealed class
 *
 * Manages the current state and delegates activate/tick/deactivate calls.
 * State transitions are triggered by return values from tick().
 *
 * Usage:
 * ```
 * const sm = new StateMachine()
 * sm.changeState(squad, new GroundUnitsIdleState())
 * // each tick:
 * sm.update(squad)
 * ```
 */
export class StateMachine {
  /** Current active state, or null if none. */
  private _currentState: IState | null = null

  /**
   * Update the current state for one tick.
   *
   * OpenRA 对照: StateMachine.Update(Squad)
   *
   * @param squad — the squad being updated
   */
  update(squad: Squad): void {
    if (this._currentState) {
      this._currentState.tick(squad)
    }
  }

  /**
   * Transition to a new state.
   *
   * OpenRA 对照: StateMachine.ChangeState(Squad, IState)
   *
   * Calls deactivate() on the current state, then activate() on the new state.
   * If the new state is null, the state machine becomes inactive.
   *
   * @param squad — the squad owning this state machine
   * @param newState — the state to transition to (null to deactivate)
   */
  changeState(squad: Squad, newState: IState | null): void {
    if (this._currentState) {
      this._currentState.deactivate(squad)
    }

    this._currentState = newState

    if (this._currentState) {
      this._currentState.activate(squad)
    }
  }

  /**
   * Get the current state (for debugging).
   */
  get currentState(): IState | null {
    return this._currentState
  }
}
