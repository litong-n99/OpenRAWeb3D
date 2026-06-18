/**
 * DateTimeGlobal.test.ts — Unit tests for DateTimeGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './DateTimeGlobal.js'

function ctx(): IScriptContext {
  return {
    world: { actors: [], worldTick: 1000 } as unknown as IScriptContext['world'],
    worldRenderer: {} as IScriptContext['worldRenderer'],
    fatalErrorOccurred: false, errorMessage: null,
    getActorCommands: () => [], playerCommands: [],
    registerMapActor: () => {}, fatalError: () => {},
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

describe('DateTimeGlobal', () => {
  it('registers with name "DateTime"', () => {
    expect(ScriptRegistry.getGlobal('DateTime')).toBeDefined()
  })

  it('GameTime returns worldTick', () => {
    const Ctor = ScriptRegistry.getGlobal('DateTime')!.ctor
    const inst = new Ctor(ctx())
    expect(inst.get('GameTime')).toBe(1000)
  })

  it('Seconds converts to ticks', () => {
    const Ctor = ScriptRegistry.getGlobal('DateTime')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('Seconds') as (s: number) => number
    expect(fn(1)).toBe(25)
    expect(fn(10)).toBe(250)
  })

  it('Minutes converts to ticks', () => {
    const Ctor = ScriptRegistry.getGlobal('DateTime')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('Minutes') as (m: number) => number
    expect(fn(1)).toBe(1500) // 60 * 25
  })

  it('current date/time properties return values', () => {
    const Ctor = ScriptRegistry.getGlobal('DateTime')!.ctor
    const inst = new Ctor(ctx())
    expect(typeof inst.get('CurrentYear')).toBe('number')
    expect(typeof inst.get('CurrentMonth')).toBe('number')
    expect(typeof inst.get('CurrentDay')).toBe('number')
  })

  it('TimeLimit get/set works', () => {
    const Ctor = ScriptRegistry.getGlobal('DateTime')!.ctor
    const inst = new Ctor(ctx())
    expect(inst.get('TimeLimit')).toBe(0)
    inst.set('TimeLimit', 500)
    // TimeLimit = value + GameTime = 500 + 1000
    expect(inst.get('TimeLimit')).toBe(1500)
    inst.set('TimeLimit', 0)
    expect(inst.get('TimeLimit')).toBe(0)
  })
})
