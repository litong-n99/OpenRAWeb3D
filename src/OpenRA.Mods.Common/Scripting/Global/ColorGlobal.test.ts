/**
 * ColorGlobal.test.ts — Unit tests for ColorGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './ColorGlobal.js'

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

describe('ColorGlobal', () => {
  it('registers with name "HSLColor"', () => {
    expect(ScriptRegistry.getGlobal('HSLColor')).toBeDefined()
  })

  it('FromRGB creates ARGB colors', () => {
    const Ctor = ScriptRegistry.getGlobal('HSLColor')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('FromRGB') as (r: number, g: number, b: number, a?: number) => number
    expect(fn(255, 0, 0)).toBe(0xFFFF0000)
    expect(fn(0, 255, 0)).toBe(0xFF00FF00)
    expect(fn(0, 0, 255)).toBe(0xFF0000FF)
    expect(fn(0, 0, 0)).toBe(0xFF000000)
    expect(fn(255, 255, 255)).toBe(0xFFFFFFFF)
  })

  it('FromHex parses hex strings', () => {
    const Ctor = ScriptRegistry.getGlobal('HSLColor')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('FromHex') as (v: string) => number
    expect(fn('00FFFF')).toBe(0xFF00FFFF)
    expect(fn('000000')).toBe(0xFF000000)
    expect(fn('FFFFFF')).toBe(0xFFFFFFFF)
    expect(() => fn('xyz')).toThrow()
  })

  it('exposes named color constants', () => {
    const Ctor = ScriptRegistry.getGlobal('HSLColor')!.ctor
    const inst = new Ctor(ctx())
    expect(inst.get('Red')).toBe(0xFFFF0000)
    expect(inst.get('Green')).toBe(0xFF008000)
    expect(inst.get('Blue')).toBe(0xFF0000FF)
    expect(inst.get('White')).toBe(0xFFFFFFFF)
    expect(inst.get('Black')).toBe(0xFF000000)
  })

  it('containsKey works for named colors', () => {
    const Ctor = ScriptRegistry.getGlobal('HSLColor')!.ctor
    const inst = new Ctor(ctx())
    expect(inst.containsKey('Red')).toBe(true)
    expect(inst.containsKey('FromRGB')).toBe(true)
    expect(inst.containsKey('Nonexistent')).toBe(false)
  })
})
