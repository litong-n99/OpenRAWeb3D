/**
 * PlayerGlobal.test.ts — Unit tests for PlayerGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import type { PlayerStub } from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'
import './PlayerGlobal.js'

function createMockContext(players: PlayerStub[] = []): IScriptContext {
  return {
    world: { actors: [], players } as unknown as IScriptContext['world'],
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

describe('PlayerGlobal', () => {
  it('registers with name "Player"', () => {
    const reg = ScriptRegistry.getGlobal('Player')
    expect(reg).toBeDefined()
    expect(reg!.name).toBe('Player')
  })

  it('GetPlayer returns player by internal name', () => {
    const p1 = { playerName: 'Alice', internalName: 'alice' } as PlayerStub & { internalName: string }
    const p2 = { playerName: 'Bob', internalName: 'bob' } as PlayerStub & { internalName: string }
    const ctx = createMockContext([p1, p2])
    const reg = ScriptRegistry.getGlobal('Player')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)

    const getPlayer = inst.get('GetPlayer') as (name: string) => PlayerStub | null
    expect(getPlayer('alice')).toBe(p1)
    expect(getPlayer('bob')).toBe(p2)
    expect(getPlayer('charlie')).toBeNull()
  })

  it('GetPlayers returns all players when no filter', () => {
    const p1 = { playerName: 'Alice' } as PlayerStub
    const p2 = { playerName: 'Bob' } as PlayerStub
    const ctx = createMockContext([p1, p2])
    const reg = ScriptRegistry.getGlobal('Player')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)

    const getPlayers = inst.get('GetPlayers') as (filter?: (p: unknown) => boolean) => PlayerStub[]
    expect(getPlayers()).toEqual([p1, p2])
  })
})
