/**
 * Drag.test.ts — Drag 迁移单元测试
 *
 * Tests focus on: position interpolation, tick counting, completion, facing queue.
 */

import { describe, it, expect } from 'vitest'
import { Drag } from './Drag.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import type { GameActor } from '../../../OpenRA.Game/Actor.js'
import type { IPositionable, IDisabledTrait } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Mock actor
// ---------------------------------------------------------------------------

function mockActor(pos: WPos = WPos.Zero): GameActor & { _pos: WPos; _setPosCalls: WPos[] } {
  return {
    actorId: 1,
    isInWorld: true,
    isDead: false,
    disposed: false,
    _pos: pos,
    _setPosCalls: [],
    toString() { return 'Actor 1' },
  } as unknown as GameActor & { _pos: WPos; _setPosCalls: WPos[] }
}

function mockPositionable(actor: GameActor & { _pos: WPos; _setPosCalls: WPos[] }): IPositionable {
  return {
    setCenterPosition(_self: GameActor, value: WPos) {
      actor._pos = value
      actor._setPosCalls.push(value)
    },
    canCenterPositionChange() { return true },
    isInWorld: true,
    isLeavingMap() { return false },
  } as unknown as IPositionable
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Drag', () => {
  it('interpolates position over multiple ticks', () => {
    const start = new WPos(0, 0, 0)
    const end = new WPos(1024, 0, 0)
    const actor = mockActor(start)
    const posable = mockPositionable(actor)

    const drag = new Drag(actor as unknown as GameActor, start, end, 4)
    // Override positionable to use mock
    ;(drag as unknown as { positionable: IPositionable }).positionable = posable

    // First tick: lerp(0, 1024, 0, 3) = 0
    drag.tick(actor as unknown as GameActor)
    expect(actor._setPosCalls.length).toBe(1)
    expect(actor._setPosCalls[0].X).toBe(0)

    // Second tick: lerp(0, 1024, 1, 3) = 341
    drag.tick(actor as unknown as GameActor)
    expect(actor._setPosCalls.length).toBe(2)
    expect(actor._setPosCalls[1].X).toBe(341)

    // Third tick: lerp(0, 1024, 2, 3) = 682
    drag.tick(actor as unknown as GameActor)
    expect(actor._setPosCalls.length).toBe(3)
    expect(actor._setPosCalls[2].X).toBe(682)

    // Fourth tick: lerp(0, 1024, 3, 3) = 1024, returns true
    const done = drag.tick(actor as unknown as GameActor)
    expect(done).toBe(true)
    expect(actor._setPosCalls.length).toBe(4)
    expect(actor._setPosCalls[3].X).toBe(1024)
  })

  it('jumps to end immediately when length is 1', () => {
    const start = new WPos(0, 0, 0)
    const end = new WPos(1024, 0, 0)
    const actor = mockActor(start)
    const posable = mockPositionable(actor)

    const drag = new Drag(actor as unknown as GameActor, start, end, 1)
    ;(drag as unknown as { positionable: IPositionable }).positionable = posable

    const done = drag.tick(actor as unknown as GameActor)
    expect(done).toBe(true)
    expect(actor._setPosCalls[0].X).toBe(1024)
  })

  it('pauses when disabled', () => {
    const start = new WPos(0, 0, 0)
    const end = new WPos(1024, 0, 0)
    const actor = mockActor(start)
    const posable = mockPositionable(actor)

    const drag = new Drag(actor as unknown as GameActor, start, end, 4)
    ;(drag as unknown as { positionable: IPositionable }).positionable = posable

    // Simulate disabled trait
    const disabled = { isTraitDisabled: true } as IDisabledTrait
    ;(drag as unknown as { disableable: IDisabledTrait | null }).disableable = disabled

    const done = drag.tick(actor as unknown as GameActor)
    expect(done).toBe(false)
    expect(actor._setPosCalls.length).toBe(0)
  })

  it('returns correct targets', () => {
    const start = new WPos(0, 0, 0)
    const end = new WPos(1024, 0, 0)
    const actor = mockActor(start)

    const drag = new Drag(actor as unknown as GameActor, start, end, 4)
    const targets = drag.getTargets(actor as unknown as GameActor)
    expect(targets.length).toBe(1)
    expect(targets[0].centerPosition.X).toBe(1024)
  })

  it('returns target line nodes', () => {
    const start = new WPos(0, 0, 0)
    const end = new WPos(1024, 0, 0)
    const actor = mockActor(start)

    const drag = new Drag(actor as unknown as GameActor, start, end, 4)
    const nodes = drag.targetLineNodes(actor as unknown as GameActor)
    expect(nodes.length).toBe(1)
    expect(nodes[0].target.centerPosition.X).toBe(1024)
  })

  it('is not interruptible', () => {
    const start = new WPos(0, 0, 0)
    const end = new WPos(1024, 0, 0)
    const actor = mockActor(start)

    const drag = new Drag(actor as unknown as GameActor, start, end, 4)
    expect(drag.isInterruptible).toBe(false)
  })
})