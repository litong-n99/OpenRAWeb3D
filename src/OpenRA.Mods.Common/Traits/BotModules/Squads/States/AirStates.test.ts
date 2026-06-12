/**
 * AirStates.test.ts — unit tests for air squad state implementations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  AirIdleState,
  AirAttackState,
  AirFleeState,
} from './AirStates.js'
import type { IState } from '../StateMachine.js'

// ---------------------------------------------------------------------------
// Mock squad
// ---------------------------------------------------------------------------

function makeAirSquad(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const unit = {
    actorId: 1,
    isIdle: false,
    isDead: false,
    isInWorld: true,
    location: { x: 10, y: 10 },
    centerPosition: { x: 10 * 1024, y: 10 * 1024, z: 0 },
    owner: {},
    info: { name: 'heli', hasTraitInfo: () => false },
    traitsImplementing: () => [],
    currentActivity: null,
  }
  return {
    isValid: true,
    isTargetValid: () => true,
    setActorToTarget: () => {},
    centerPosition: () => ({ x: 10 * 1024, y: 10 * 1024, z: 0 }),
    centerUnit: () => unit,
    get targetActor() { return this._targetActor ?? null },
    _targetActor: unit,
    target: { type: 1, actor: null, centerPosition: { x: 10 * 1024, y: 10 * 1024, z: 0 }, offset: { x: 0, y: 0, z: 0 } },
    units: new Set([unit]),
    squadManager: {
      getRandomBaseCenter: () => ({ x: 0, y: 0 }),
      isPreferredEnemyUnit: () => false,
      findClosestEnemyForSquad: () => ({ actor: null, offset: { x: 0, y: 0, z: 0 } }),
      info: {
        dangerScanRadius: 10,
        aircraftTargetType: { contains: () => false },
      },
      world: {
        findActorsInCircle: () => [],
        map: { bounds: { x: 0, y: 0, width: 128, height: 128 } },
        centerOfCell: (c: { x: number; y: number }) => ({ x: c.x * 1024, y: c.y * 1024, z: 0 }),
        findActorsOnLine: () => [],
      },
    },
    fuzzyStateMachine: {
      currentState: null as IState | null,
      changeState(_squad: unknown, ns: IState) { (this as { currentState: IState | null }).currentState = ns },
      update() {},
    },
    bot: {
      player: {},
      queueOrder: () => {},
    },
    random: {
      nextIntRange: () => 0,
      next: () => 42,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// AirIdleState
// ---------------------------------------------------------------------------

describe('AirIdleState', () => {
  let state: AirIdleState

  beforeEach(() => {
    state = new AirIdleState()
  })

  it('tick returns false when squad invalid', () => {
    const squad = makeAirSquad({ isValid: false })
    expect(state.tick(squad as any)).toBe(false)
  })

  it('activate does not throw', () => {
    const squad = makeAirSquad()
    expect(() => state.activate(squad as any)).not.toThrow()
  })

  it('deactivate does not throw', () => {
    const squad = makeAirSquad()
    expect(() => state.deactivate(squad as any)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// AirAttackState
// ---------------------------------------------------------------------------

describe('AirAttackState', () => {
  let state: AirAttackState

  beforeEach(() => {
    state = new AirAttackState()
  })

  it('tick returns false when squad invalid', () => {
    const squad = makeAirSquad({ isValid: false })
    expect(state.tick(squad as any)).toBe(false)
  })

  it('tick when no center unit returns false', () => {
    const squad = makeAirSquad({ centerUnit: () => null })
    expect(state.tick(squad as any)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AirFleeState
// ---------------------------------------------------------------------------

describe('AirFleeState', () => {
  let state: AirFleeState

  beforeEach(() => {
    state = new AirFleeState()
  })

  it('tick returns false when squad invalid', () => {
    const squad = makeAirSquad({ isValid: false })
    expect(state.tick(squad as any)).toBe(false)
  })

  it('transitions to idle after flee', () => {
    const squad = makeAirSquad()
    const sm = squad.fuzzyStateMachine as { currentState: IState | null; changeState(s: unknown, ns: IState): void }
    state.tick(squad as any)
    expect(sm.currentState).toBeInstanceOf(AirIdleState)
  })
})
