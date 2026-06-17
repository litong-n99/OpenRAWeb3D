/**
 * ScriptTypes.test.ts — ScriptTypes unit tests
 *
 * Tests focus on: type conversion (toScriptValue, fromScriptValue, typeOf,
 * canConvert, disposeScriptValue) for all game primitives and edge cases.
 */

import { describe, it, expect } from 'vitest'
import { ScriptTypes } from './ScriptTypes'
import { CPos } from '../CPos'
import { WPos } from '../WPos'
import { WAngle } from '../WAngle'
import { WDist } from '../WDist'
import { WRot } from '../WRot'
import { CVec } from '../CVec'
import { WVec } from '../WVec'
import type { IScriptContext } from './ScriptMemberDescriptor'

// ---------------------------------------------------------------------------
// Minimal stub context for testing
// ---------------------------------------------------------------------------

const stubContext: IScriptContext = {
  world: { actors: [] } as any,
  worldRenderer: {},
  fatalErrorOccurred: false,
  errorMessage: null,
  getActorCommands: () => [],
  playerCommands: [],
  registerMapActor: () => {},
  fatalError: () => {},
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptTypes', () => {
  // -----------------------------------------------------------------------
  // toScriptValue — primitives
  // -----------------------------------------------------------------------

  describe('toScriptValue', () => {
    it('converts null to null', () => {
      expect(ScriptTypes.toScriptValue(null, stubContext)).toBeNull()
    })

    it('converts undefined to null', () => {
      expect(ScriptTypes.toScriptValue(undefined, stubContext)).toBeNull()
    })

    it('passes through numbers', () => {
      expect(ScriptTypes.toScriptValue(42, stubContext)).toBe(42)
    })

    it('passes through booleans', () => {
      expect(ScriptTypes.toScriptValue(true, stubContext)).toBe(true)
      expect(ScriptTypes.toScriptValue(false, stubContext)).toBe(false)
    })

    it('passes through strings', () => {
      expect(ScriptTypes.toScriptValue('hello', stubContext)).toBe('hello')
    })

    it('converts CPos to { x, y }', () => {
      const pos = new CPos(10, 20)
      const result = ScriptTypes.toScriptValue(pos, stubContext) as any
      expect(result).toEqual({ x: 10, y: 20 })
    })

    it('converts WPos to { x, y, z }', () => {
      const pos = new WPos(100, 200, 300)
      const result = ScriptTypes.toScriptValue(pos, stubContext) as any
      expect(result).toEqual({ x: 100, y: 200, z: 300 })
    })

    it('converts WAngle to number', () => {
      const angle = new WAngle(256) // 90 degrees
      expect(ScriptTypes.toScriptValue(angle, stubContext)).toBe(256)
    })

    it('converts WDist to number', () => {
      const dist = new WDist(1024)
      expect(ScriptTypes.toScriptValue(dist, stubContext)).toBe(1024)
    })

    it('converts WRot to { yaw, pitch, roll }', () => {
      const rot = new WRot(WAngle.Zero, WAngle.Zero, WAngle.Zero)
      const result = ScriptTypes.toScriptValue(rot, stubContext) as any
      expect(result).toHaveProperty('yaw')
      expect(result).toHaveProperty('pitch')
      expect(result).toHaveProperty('roll')
    })

    it('converts WVec to { x, y, z }', () => {
      const vec = new WVec(50, 60, 70)
      const result = ScriptTypes.toScriptValue(vec, stubContext) as any
      expect(result).toEqual({ x: 50, y: 60, z: 70 })
    })

    it('converts CVec to { x, y }', () => {
      const vec = new CVec(5, -3)
      const result = ScriptTypes.toScriptValue(vec, stubContext) as any
      expect(result).toEqual({ x: 5, y: -3 })
    })

    it('converts ColorStub to { r, g, b, a }', () => {
      const color = { r: 255, g: 128, b: 64, a: 255 }
      const result = ScriptTypes.toScriptValue(color, stubContext) as any
      expect(result).toEqual({ r: 255, g: 128, b: 64, a: 255 })
    })

    it('converts arrays recursively', () => {
      const input = [42, 'hello', true]
      const result = ScriptTypes.toScriptValue(input, stubContext)
      expect(result).toEqual([42, 'hello', true])
    })

    it('converts nested arrays of CPos recursively', () => {
      const input = [new CPos(1, 2), new CPos(3, 4)]
      const result = ScriptTypes.toScriptValue(input, stubContext) as any
      expect(result).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }])
    })
  })

  // -----------------------------------------------------------------------
  // fromScriptValue — conversion to game types
  // -----------------------------------------------------------------------

  describe('fromScriptValue', () => {
    it('converts null to null for nil type', () => {
      expect(ScriptTypes.fromScriptValue(null, 'nil')).toBeNull()
    })

    it('converts boolean values', () => {
      expect(ScriptTypes.fromScriptValue(true, 'boolean')).toBe(true)
      expect(ScriptTypes.fromScriptValue(false, 'boolean')).toBe(false)
    })

    it('converts number values', () => {
      expect(ScriptTypes.fromScriptValue(42, 'number')).toBe(42)
    })

    it('converts string values', () => {
      expect(ScriptTypes.fromScriptValue('test', 'string')).toBe('test')
    })

    it('converts { x, y } to CPos', () => {
      const result = ScriptTypes.fromScriptValue({ x: 10, y: 20 }, 'CPos') as CPos
      expect(result).toBeInstanceOf(CPos)
      expect(result.X).toBe(10)
      expect(result.Y).toBe(20)
    })

    it('converts { x, y, z } to WPos', () => {
      const result = ScriptTypes.fromScriptValue({ x: 100, y: 200, z: 300 }, 'WPos') as WPos
      expect(result).toBeInstanceOf(WPos)
      expect(result.X).toBe(100)
      expect(result.Y).toBe(200)
      expect(result.Z).toBe(300)
    })

    it('converts number to WAngle', () => {
      const result = ScriptTypes.fromScriptValue(256, 'WAngle') as WAngle
      expect(result).toBeInstanceOf(WAngle)
      expect(result.angle).toBe(256)
    })

    it('converts number to WDist', () => {
      const result = ScriptTypes.fromScriptValue(1024, 'WDist') as WDist
      expect(result).toBeInstanceOf(WDist)
      expect(result.length).toBe(1024)
    })

    it('converts { yaw, pitch, roll } to WRot', () => {
      const result = ScriptTypes.fromScriptValue({ yaw: 0, pitch: 0, roll: 0 }, 'WRot') as WRot
      expect(result).toBeInstanceOf(WRot)
    })

    it('converts { r, g, b, a } to Color', () => {
      const result = ScriptTypes.fromScriptValue({ r: 255, g: 128, b: 64, a: 255 }, 'Color') as any
      expect(result).toEqual({ r: 255, g: 128, b: 64, a: 255 })
    })

    it('converts array to typed array', () => {
      const result = ScriptTypes.fromScriptValue([{ x: 1, y: 2 }, { x: 3, y: 4 }], 'CPos[]') as unknown[]
      expect(result).toHaveLength(2)
      expect(result[0]).toBeInstanceOf(CPos)
      expect((result[0] as CPos).X).toBe(1)
    })

    it('handles any type passthrough', () => {
      const obj = { a: 1 }
      expect(ScriptTypes.fromScriptValue(obj, 'any')).toBe(obj)
    })

    it('throws on invalid conversion', () => {
      expect(() => ScriptTypes.fromScriptValue('not_a_number', 'number'))
        .toThrow(/Cannot convert/)
    })

    it('converts null for any non-nil type', () => {
      expect(ScriptTypes.fromScriptValue(null, 'boolean')).toBeNull()
      expect(ScriptTypes.fromScriptValue(null, 'Actor')).toBeNull()
    })

    it('throws when passing ScriptPlayerInterface to fromScriptValue with Actor type', () => {
      // Stub: has _player but NOT _actor (mimics ScriptPlayerInterface shape)
      const playerWrapper = { _player: { playerName: 'Commander' } }
      expect(() => ScriptTypes.fromScriptValue(playerWrapper, 'Actor'))
        .toThrow(/Cannot convert/)
    })

    it('throws when passing ScriptActorInterface to fromScriptValue with Player type', () => {
      // Stub: has _actor but NOT _player (mimics ScriptActorInterface shape)
      const actorWrapper = { _actor: { actorId: 1, isInWorld: true, isDead: false, disposed: false } }
      expect(() => ScriptTypes.fromScriptValue(actorWrapper, 'Player'))
        .toThrow(/Cannot convert/)
    })

    it('round-trips CPos → toScriptValue → fromScriptValue', () => {
      const original = new CPos(50, 60)
      const scriptVal = ScriptTypes.toScriptValue(original, stubContext)
      const roundTripped = ScriptTypes.fromScriptValue(scriptVal, 'CPos') as CPos
      expect(roundTripped.X).toBe(original.X)
      expect(roundTripped.Y).toBe(original.Y)
    })

    it('round-trips WPos → toScriptValue → fromScriptValue', () => {
      const original = new WPos(100, 200, 300)
      const scriptVal = ScriptTypes.toScriptValue(original, stubContext)
      const roundTripped = ScriptTypes.fromScriptValue(scriptVal, 'WPos') as WPos
      expect(roundTripped.X).toBe(original.X)
      expect(roundTripped.Y).toBe(original.Y)
      expect(roundTripped.Z).toBe(original.Z)
    })

    it('handles empty object {} for CPos defaults', () => {
      const result = ScriptTypes.fromScriptValue({}, 'CPos') as CPos
      expect(result).toBeInstanceOf(CPos)
      expect(result.X).toBe(0)
      expect(result.Y).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // typeOf
  // -----------------------------------------------------------------------

  describe('typeOf', () => {
    it('returns nil for null', () => {
      expect(ScriptTypes.typeOf(null)).toBe('nil')
    })

    it('returns boolean', () => {
      expect(ScriptTypes.typeOf(true)).toBe('boolean')
    })

    it('returns number', () => {
      expect(ScriptTypes.typeOf(42)).toBe('number')
    })

    it('returns string', () => {
      expect(ScriptTypes.typeOf('hello')).toBe('string')
    })

    it('returns function', () => {
      expect(ScriptTypes.typeOf(() => {})).toBe('function')
    })

    it('returns CPos for CPos instance', () => {
      expect(ScriptTypes.typeOf(new CPos(1, 2))).toBe('CPos')
    })

    it('returns WPos for WPos instance', () => {
      expect(ScriptTypes.typeOf(new WPos(1, 2, 3))).toBe('WPos')
    })

    it('returns WAngle for WAngle instance', () => {
      expect(ScriptTypes.typeOf(new WAngle(90))).toBe('WAngle')
    })

    it('returns table for plain object', () => {
      expect(ScriptTypes.typeOf({ a: 1 })).toBe('table')
    })

    it('returns table for array', () => {
      expect(ScriptTypes.typeOf([1, 2, 3])).toBe('table')
    })

    it('returns Actor for IGameActor', () => {
      const actor = { actorId: 1, isInWorld: true, isDead: false, disposed: false }
      expect(ScriptTypes.typeOf(actor)).toBe('Actor')
    })

    it('returns Player for PlayerStub', () => {
      const player = { playerName: 'Commander' }
      expect(ScriptTypes.typeOf(player)).toBe('Player')
    })

    it('returns Color for ColorStub', () => {
      const color = { r: 255, g: 128, b: 64, a: 255 }
      expect(ScriptTypes.typeOf(color)).toBe('Color')
    })
  })

  // -----------------------------------------------------------------------
  // canConvert
  // -----------------------------------------------------------------------

  describe('canConvert', () => {
    it('returns true for valid conversions', () => {
      expect(ScriptTypes.canConvert(42, 'number')).toBe(true)
      expect(ScriptTypes.canConvert(true, 'boolean')).toBe(true)
      expect(ScriptTypes.canConvert('hello', 'string')).toBe(true)
      expect(ScriptTypes.canConvert(null, 'nil')).toBe(true)
    })

    it('returns false for invalid conversions', () => {
      expect(ScriptTypes.canConvert('hello', 'number')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // disposeScriptValue
  // -----------------------------------------------------------------------

  describe('disposeScriptValue', () => {
    it('is a no-op for Tier 1 (no error)', () => {
      expect(() => ScriptTypes.disposeScriptValue(42)).not.toThrow()
      expect(() => ScriptTypes.disposeScriptValue('hello')).not.toThrow()
      expect(() => ScriptTypes.disposeScriptValue(null)).not.toThrow()
      expect(() => ScriptTypes.disposeScriptValue({ x: 1 })).not.toThrow()
    })
  })
})
