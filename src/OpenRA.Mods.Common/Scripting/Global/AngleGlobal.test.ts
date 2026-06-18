/**
 * AngleGlobal.test.ts — Unit tests for AngleGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
// Static import triggers module-level registerGlobal()
import './AngleGlobal.js'

function createMockContext(): IScriptContext {
  return {
    world: { actors: [] } as unknown as IScriptContext['world'],
    worldRenderer: {} as IScriptContext['worldRenderer'],
    fatalErrorOccurred: false,
    errorMessage: null,
    getActorCommands: () => [],
    playerCommands: [],
    registerMapActor: () => {},
    fatalError: () => {},
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

describe('AngleGlobal', () => {
  it('registers with name "Angle"', () => {
    const reg = ScriptRegistry.getGlobal('Angle')
    expect(reg).toBeDefined()
    expect(reg!.name).toBe('Angle')
  })

  it('exposes 8 direction constants', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Angle')!
    const instance = new reg.ctor(ctx)

    expect(instance.get('North')).toBe(0)
    expect(instance.get('NorthWest')).toBe(128)
    expect(instance.get('West')).toBe(256)
    expect(instance.get('SouthWest')).toBe(384)
    expect(instance.get('South')).toBe(512)
    expect(instance.get('SouthEast')).toBe(640)
    expect(instance.get('East')).toBe(768)
    expect(instance.get('NorthEast')).toBe(896)
  })

  it('New() creates angles by value', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Angle')!
    const instance = new reg.ctor(ctx)

    const newFn = instance.get('New') as (a: number) => number
    expect(newFn(0)).toBe(0)
    expect(newFn(256)).toBe(256)
    expect(newFn(512)).toBe(512)
    // 1024 wraps to 0 (full circle)
    expect(newFn(1024)).toBe(0)
  })

  it('table name is correct', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Angle')!
    const instance = new reg.ctor(ctx)
    expect(instance.name).toBe('Angle')
  })
})
