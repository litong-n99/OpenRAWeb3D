/**
 * ReinforcementsGlobal.test.ts — Unit tests for ReinforcementsGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import './ReinforcementsGlobal.js'

function ctx(): IScriptContext {
  return {
    world: {
      actors: [],
      createActor: () => ({ actorId: 1, disposed: false, isDead: false }),
      addFrameEndTask: (fn: () => void) => fn(),
      addActor: () => {},
      map: {
        rules: {
          actors: new Map([
            ['e1', { name: 'e1', hasTraitInfo: () => true, getTraitInfo: () => undefined }],
            ['truk', { name: 'truk', hasTraitInfo: () => true, getTraitInfo: () => undefined }],
          ]),
        },
        centerOfCell: () => ({ X: 0, Y: 0, Z: 0 }),
        facingBetween: () => ({ angle: 0 }),
      },
    } as unknown as IScriptContext['world'],
    worldRenderer: {} as IScriptContext['worldRenderer'],
    fatalErrorOccurred: false, errorMessage: null,
    getActorCommands: () => [], playerCommands: [],
    registerMapActor: () => {}, fatalError: () => {},
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

describe('ReinforcementsGlobal', () => {
  it('registers with name "Reinforcements"', () => {
    expect(ScriptRegistry.getGlobal('Reinforcements')).toBeDefined()
  })

  it('Reinforce returns actor array', () => {
    const Ctor = ScriptRegistry.getGlobal('Reinforcements')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('Reinforce') as (...args: unknown[]) => unknown[]
    const result = fn(
      { _player: { playerName: 'Test' } },
      ['e1', 'e1'],
      [CPos.Zero, new CPos(1, 1)],
      25,
      undefined,
    )
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)
  })

  it('ReinforceWithTransport returns transport and cargo', () => {
    const Ctor = ScriptRegistry.getGlobal('Reinforcements')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('ReinforceWithTransport') as (...args: unknown[]) => [unknown, unknown[]]
    const [transport, cargo] = fn(
      { _player: { playerName: 'Test' } },
      'truk',
      ['e1'],
      [CPos.Zero, new CPos(1, 1)],
      undefined, undefined, undefined, 3,
    )
    expect(transport).toBeDefined()
    expect(Array.isArray(cargo)).toBe(true)
  })

  it('throws for unknown actor type', () => {
    const Ctor = ScriptRegistry.getGlobal('Reinforcements')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('Reinforce') as (...args: unknown[]) => unknown[]
    expect(() => fn({ _player: { playerName: 'Test' } }, ['unknown'], [CPos.Zero])).toThrow()
  })
})
