/**
 * RadarGlobal.test.ts — Unit tests for RadarGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './RadarGlobal.js'

function createMockContext(): IScriptContext {
  return {
    world: { actors: [], players: [] } as unknown as IScriptContext['world'],
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

/** Create a Player in script-Layer format (ScriptPlayerInterface wrapper with _player). */
function createScriptPlayer(): unknown {
  return {
    _player: {
      playerName: 'Commander',
      internalName: 'commander',
    },
  }
}

/** Create a WPos in script-Layer format (plain { x, y, z } object). */
function createScriptWPos(x: number, y: number, z: number): unknown {
  return { x, y, z }
}

/** Create a Color in script-Layer format (plain { r, g, b, a } object). */
function createScriptColor(r: number, g: number, b: number, a: number = 255): unknown {
  return { r, g, b, a }
}

describe('RadarGlobal', () => {
  it('registers with name "Radar"', () => {
    const reg = ScriptRegistry.getGlobal('Radar')
    expect(reg).toBeDefined()
    expect(reg!.name).toBe('Radar')
  })

  it('Ping method exists', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Radar')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    expect(inst.containsKey('Ping')).toBe(true)
  })

  it('Ping method is callable without throwing', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Radar')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const ping = inst.get('Ping') as Function
    // Arguments in script format: Player as { _player }, WPos as { x, y, z }, Color as { r, g, b, a }
    expect(() => ping(
      createScriptPlayer(),
      createScriptWPos(100, 200, 0),
      createScriptColor(255, 0, 0),
    )).not.toThrow()
  })

  it('Ping with color parameter is callable', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Radar')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const ping = inst.get('Ping') as Function
    // Color in script format: { r, g, b, a }
    expect(() => ping(
      createScriptPlayer(),
      createScriptWPos(100, 200, 0),
      createScriptColor(255, 0, 0),
    )).not.toThrow()
  })

  it('throws/errors when player is null', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Radar')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const ping = inst.get('Ping') as Function
    // Calling Ping with null player should throw (accesses .world on null after conversion)
    expect(() => ping(null, createScriptWPos(100, 200, 0))).toThrow()
  })
})
