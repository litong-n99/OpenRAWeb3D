/**
 * CoordinateGlobals.test.ts — Unit tests for all 5 Coordinate Globals
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './CoordinateGlobals.js'

function ctx(): IScriptContext {
  return {
    world: { actors: [] } as unknown as IScriptContext['world'],
    worldRenderer: {} as IScriptContext['worldRenderer'],
    fatalErrorOccurred: false, errorMessage: null,
    getActorCommands: () => [], playerCommands: [],
    registerMapActor: () => {}, fatalError: () => {},
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

describe('CoordinateGlobals', () => {
  describe('CPosGlobal', () => {
    it('registers CPos', () => expect(ScriptRegistry.getGlobal('CPos')).toBeDefined())
    it('New creates CPos', () => {
      const Ctor = ScriptRegistry.getGlobal('CPos')!.ctor
      const inst = new Ctor(ctx())
      const fn = inst.get('New') as (x: number, y: number) => unknown
      const result = fn(5, 10) as { x: number; y: number }
      expect(result.x).toBe(5); expect(result.y).toBe(10)
    })
    it('Zero returns origin', () => {
      const Ctor = ScriptRegistry.getGlobal('CPos')!.ctor
      const inst = new Ctor(ctx())
      const z = inst.get('Zero') as { x: number; y: number }
      expect(z.x).toBe(0); expect(z.y).toBe(0)
    })
  })

  describe('CVecGlobal', () => {
    it('registers CVec', () => expect(ScriptRegistry.getGlobal('CVec')).toBeDefined())
    it('New creates CVec', () => {
      const Ctor = ScriptRegistry.getGlobal('CVec')!.ctor
      const inst = new Ctor(ctx())
      const fn = inst.get('New') as (x: number, y: number) => unknown
      const result = fn(3, 4) as { x: number; y: number }
      expect(result.x).toBe(3); expect(result.y).toBe(4)
    })
  })

  describe('WPosGlobal', () => {
    it('registers WPos', () => expect(ScriptRegistry.getGlobal('WPos')).toBeDefined())
    it('New creates WPos', () => {
      const Ctor = ScriptRegistry.getGlobal('WPos')!.ctor
      const inst = new Ctor(ctx())
      const fn = inst.get('New') as (x: number, y: number, z: number) => unknown
      const result = fn(1, 2, 3) as { x: number; y: number; z: number }
      expect(result.x).toBe(1); expect(result.y).toBe(2); expect(result.z).toBe(3)
    })
  })

  describe('WVecGlobal', () => {
    it('registers WVec', () => expect(ScriptRegistry.getGlobal('WVec')).toBeDefined())
    it('New creates WVec', () => {
      const Ctor = ScriptRegistry.getGlobal('WVec')!.ctor
      const inst = new Ctor(ctx())
      const fn = inst.get('New') as (x: number, y: number, z: number) => unknown
      const result = fn(10, 20, 30) as { x: number; y: number; z: number }
      expect(result.x).toBe(10)
    })
  })

  describe('WDistGlobal', () => {
    it('registers WDist', () => expect(ScriptRegistry.getGlobal('WDist')).toBeDefined())
    it('New creates WDist', () => {
      const Ctor = ScriptRegistry.getGlobal('WDist')!.ctor
      const inst = new Ctor(ctx())
      const fn = inst.get('New') as (r: number) => number
      expect(fn(100)).toBe(100)
    })
    it('FromCells creates WDist', () => {
      const Ctor = ScriptRegistry.getGlobal('WDist')!.ctor
      const inst = new Ctor(ctx())
      const fn = inst.get('FromCells') as (n: number) => number
      expect(fn(3)).toBeGreaterThan(0)
    })
  })
})
