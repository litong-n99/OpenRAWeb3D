/**
 * UserInterfaceGlobal.test.ts — Unit tests for UserInterfaceGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './UserInterfaceGlobal.js'

function createMockContext(): IScriptContext {
  const logs: string[] = []
  return {
    world: { actors: [], players: [] } as unknown as IScriptContext['world'],
    worldRenderer: {} as IScriptContext['worldRenderer'],
    fatalErrorOccurred: false,
    errorMessage: null,
    getActorCommands: () => [],
    playerCommands: [],
    registerMapActor: () => {},
    fatalError: () => {},
    logDebug: (msg: string) => { logs.push(msg) },
    get namedActors() { return new Map() },
    _logs: logs,
  } as IScriptContext & { _logs: string[] }
}

/** Create a Color in script-Layer format (plain { r, g, b, a } object). */
function createScriptColor(r: number, g: number, b: number, a: number = 255): unknown {
  return { r, g, b, a }
}

describe('UserInterfaceGlobal', () => {
  it('registers with name "UserInterface"', () => {
    const reg = ScriptRegistry.getGlobal('UserInterface')
    expect(reg).toBeDefined()
    expect(reg!.name).toBe('UserInterface')
  })

  it('SetMissionText method exists', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('UserInterface')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    expect(inst.containsKey('SetMissionText')).toBe(true)
  })

  it('SetMissionText logs debug message', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('UserInterface')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const fn = inst.get('SetMissionText') as Function

    fn('Hello World')
    const logs = (ctx as any)._logs as string[]
    const textLog = logs.find((l: string) => l.includes('SetMissionText'))
    expect(textLog).toBeDefined()
    expect(textLog).toContain('Hello World')
  })

  it('SetMissionText with color logs color value', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('UserInterface')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const fn = inst.get('SetMissionText') as Function

    // Color in script format: { r, g, b, a }
    fn('Alert', createScriptColor(255, 0, 0))
    const logs = (ctx as any)._logs as string[]
    const colorLog = logs.find((l: string) => l.includes('color'))
    expect(colorLog).toBeDefined()
  })

  it('GetFluentMessage method exists', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('UserInterface')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    expect(inst.containsKey('GetFluentMessage')).toBe(true)
  })

  it('GetFluentMessage returns key as default when no translation', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('UserInterface')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const fn = inst.get('GetFluentMessage') as Function

    const result = fn('mission-objective-1')
    expect(result).toBe('mission-objective-1')
  })

  it('GetFluentMessage with args logs debug message', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('UserInterface')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const fn = inst.get('GetFluentMessage') as Function

    fn('unit-count', { count: 5 })
    const logs = (ctx as any)._logs as string[]
    const fluentLog = logs.find((l: string) => l.includes('GetFluentMessage'))
    expect(fluentLog).toBeDefined()
    expect(fluentLog).toContain('unit-count')
  })
})
