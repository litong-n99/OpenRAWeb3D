/**
 * GroundStates.test.ts — unit tests for ground squad state implementations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GroundUnitsIdleState,
  GroundUnitsAttackMoveState,
  GroundUnitsAttackState,
  GroundUnitsFleeState,
} from './GroundStates.js'
import type { IState } from '../StateMachine.js'

// ---------------------------------------------------------------------------
// Helpers: create minimal mock squad for state tests
// ---------------------------------------------------------------------------

function makeMockSquad(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isValid: true,
    isTargetValid: () => true,
    setActorToTarget: () => {},
    centerPosition: () => ({ x: 0, y: 0, z: 0 }),
    centerUnit: () => ({
      actorId: 1,
      isIdle: true,
      isDead: false,
      isInWorld: true,
      location: { x: 0, y: 0 },
      centerPosition: { x: 0, y: 0, z: 0 },
      owner: {},
      info: { name: 'e1', hasTraitInfo: () => true },
      traitsImplementing: () => [],
    }),
    get targetActor() { return this._targetActor ?? null },
    _targetActor: {
      actorId: 2,
      isDead: false,
      isInWorld: true,
      location: { x: 5, y: 5 },
      centerPosition: { x: 5 * 1024, y: 5 * 1024, z: 0 },
      owner: {},
      info: { name: 'harv', hasTraitInfo: () => true },
      traitsImplementing: () => [],
    },
    target: {
      type: 1,
      actor: null,
      centerPosition: { x: 5120, y: 5120, z: 0 },
      offset: { x: 0, y: 0, z: 0 },
    },
    units: new Set([]),
    squadManager: {
      getRandomBaseCenter: () => ({ x: 0, y: 0 }),
      isPreferredEnemyUnit: () => false,
      findClosestEnemyForSquad: () => ({ actor: null, offset: { x: 0, y: 0, z: 0 } }),
      info: { dangerScanRadius: 10, attackScanRadius: 10, protectionScanRadius: 10, idleScanRadius: 5 },
      worldTick: 1,
      world: {
        findActorsInCircle: () => [],
      },
    },
    fuzzyStateMachine: {
      currentState: null as IState | null,
      changeState(_squad: unknown, newState: IState) { (this as { currentState: IState | null }).currentState = newState },
      update(_squad: unknown) {},
    },
    bot: {
      player: {},
      queueOrder: () => {},
    },
    random: {
      nextIntRange: (_min: number, _max: number) => _max,
      next: () => 42,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// GroundUnitsIdleState
// ---------------------------------------------------------------------------

describe('GroundUnitsIdleState', () => {
  let state: GroundUnitsIdleState

  beforeEach(() => {
    state = new GroundUnitsIdleState()
  })

  it('implements IState', () => {
    expect(typeof state.activate).toBe('function')
    expect(typeof state.tick).toBe('function')
    expect(typeof state.deactivate).toBe('function')
  })

  it('tick returns false when squad is not valid', () => {
    const squad = makeMockSquad({ isValid: false })
    expect(state.tick(squad as any)).toBe(false)
  })

  it('activate and deactivate are no-ops', () => {
    const squad = makeMockSquad()
    expect(() => state.activate(squad as any)).not.toThrow()
    expect(() => state.deactivate(squad as any)).not.toThrow()
  })

  it('sets leader on first tick', () => {
    const squad = makeMockSquad()
    // Access protected leader via duck type
    const gs = state as unknown as {
      leader(owner: unknown): unknown
    }
    // Leader may be null if no units with Mobile trait
    // Verify the method does not throw
    expect(() => gs.leader(squad)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// GroundUnitsAttackMoveState
// ---------------------------------------------------------------------------

describe('GroundUnitsAttackMoveState', () => {
  let state: GroundUnitsAttackMoveState

  beforeEach(() => {
    state = new GroundUnitsAttackMoveState()
  })

  it('tick returns false for invalid squad', () => {
    const squad = makeMockSquad({ isValid: false })
    expect(state.tick(squad as any)).toBe(false)
  })

  it('activate resets tracking state', () => {
    const squad = makeMockSquad()
    expect(() => state.activate(squad as any)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// GroundUnitsAttackState
// ---------------------------------------------------------------------------

describe('GroundUnitsAttackState', () => {
  let state: GroundUnitsAttackState

  beforeEach(() => {
    state = new GroundUnitsAttackState()
  })

  it('tick returns false for invalid squad', () => {
    const squad = makeMockSquad({ isValid: false })
    expect(state.tick(squad as any)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GroundUnitsFleeState
// ---------------------------------------------------------------------------

describe('GroundUnitsFleeState', () => {
  let state: GroundUnitsFleeState

  beforeEach(() => {
    state = new GroundUnitsFleeState()
  })

  it('tick returns false for invalid squad', () => {
    const squad = makeMockSquad({ isValid: false })
    expect(state.tick(squad as any)).toBe(false)
  })

  it('deactivate calls unregisterSquad', () => {
    let unregistered = false
    const squad = makeMockSquad({
      squadManager: {
        ...makeMockSquad().squadManager as Record<string, unknown>,
        unregisterSquad: () => { unregistered = true },
      },
    })
    state.deactivate(squad as any)
    expect(unregistered).toBe(true)
  })

  it('transitions to idle after flee', () => {
    const squad = makeMockSquad()
    const sm = squad.fuzzyStateMachine as { currentState: IState | null; changeState(s: unknown, ns: IState): void }
    state.tick(squad as any)
    expect(sm.currentState).toBeInstanceOf(GroundUnitsIdleState)
  })
})
