/**
 * BeaconGlobal.test.ts — Unit tests for BeaconGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './BeaconGlobal.js'

function createMockContext(): IScriptContext {
  const logs: string[] = []
  return {
    world: {
      actors: [],
      players: [],
      addFrameEndTask: (task: () => void) => { task() },
    } as unknown as IScriptContext['world'],
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

/** Create a Player in script-Layer format with PlaceBeacon trait. */
function createScriptPlayer(): unknown {
  return {
    _player: {
      playerName: 'Commander',
      internalName: 'commander',
      playerActor: {
        info: {
          traitInfoOrDefault: (name: string) => {
            if (name === 'PlaceBeacon') return { name: 'PlaceBeacon' }
            return undefined
          },
        },
      },
    },
  }
}

/** Create a WPos in script-Layer format. */
function createScriptWPos(x: number, y: number, z: number): unknown {
  return { x, y, z }
}

describe('BeaconGlobal', () => {
  it('registers with name "Beacon"', () => {
    const reg = ScriptRegistry.getGlobal('Beacon')
    expect(reg).toBeDefined()
    expect(reg!.name).toBe('Beacon')
  })

  it('New method exists', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Beacon')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    expect(inst.containsKey('New')).toBe(true)
  })

  it('New logs debug message', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Beacon')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const newFn = inst.get('New') as Function

    newFn(createScriptPlayer(), createScriptWPos(300, 400, 0))
    const logs = (ctx as any)._logs as string[]
    const beaconLog = logs.find((l: string) => l.includes('Beacon created'))
    expect(beaconLog).toBeDefined()
  })

  it('New with showRadarPings=false does not log radar ping', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Beacon')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const newFn = inst.get('New') as Function

    newFn(createScriptPlayer(), createScriptWPos(300, 400, 0), 500, false)
    const logs = (ctx as any)._logs as string[]
    const radarLog = logs.find((l: string) => l.includes('Radar ping'))
    expect(radarLog).toBeUndefined()
    const beaconLog = logs.find((l: string) => l.includes('Beacon created'))
    expect(beaconLog).toBeDefined()
  })

  it('throws when owner is null', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Beacon')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const newFn = inst.get('New') as Function

    // null passes through fromScriptValue as null, then _new checks !owner
    expect(() => newFn(null, createScriptWPos(300, 400, 0))).toThrow(/owner must not be null/)
  })

  it('throws when position is null', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Beacon')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const newFn = inst.get('New') as Function

    // null passes through fromScriptValue as null, then accessing position.X throws
    expect(() => newFn(createScriptPlayer(), null)).toThrow()
  })
})
