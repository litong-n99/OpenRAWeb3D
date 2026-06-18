/**
 * LightingGlobal.test.ts — Unit tests for LightingGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './LightingGlobal.js'

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

describe('LightingGlobal', () => {
  it('registers with name "Lighting"', () => expect(ScriptRegistry.getGlobal('Lighting')).toBeDefined())

  it('Red/Green/Blue/Ambient default to 1', () => {
    const Ctor = ScriptRegistry.getGlobal('Lighting')!.ctor
    const inst = new Ctor(ctx())
    expect(inst.get('Red')).toBe(1)
    expect(inst.get('Green')).toBe(1)
    expect(inst.get('Blue')).toBe(1)
    expect(inst.get('Ambient')).toBe(1)
  })

  it('can set Red/Green/Blue/Ambient', () => {
    const Ctor = ScriptRegistry.getGlobal('Lighting')!.ctor
    const inst = new Ctor(ctx())
    inst.set('Red', 0.5)
    expect(inst.get('Red')).toBe(0.5)
    inst.set('Blue', 0.25)
    expect(inst.get('Blue')).toBe(0.25)
  })

  it('Flash method exists', () => {
    const Ctor = ScriptRegistry.getGlobal('Lighting')!.ctor
    const inst = new Ctor(ctx())
    const flash = inst.get('Flash') as (type?: string, ticks?: number) => void
    expect(typeof flash).toBe('function')
    flash('Test', 100)
  })
})
