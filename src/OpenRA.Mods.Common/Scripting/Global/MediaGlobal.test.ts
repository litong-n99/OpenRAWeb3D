/**
 * MediaGlobal.test.ts — Unit tests for MediaGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import './MediaGlobal.js'

function ctx(): IScriptContext {
  return {
    world: {
      actors: [],
      localPlayer: null,
      map: { contains: () => true, cellContaining: () => ({}) },
    } as unknown as IScriptContext['world'],
    worldRenderer: {} as IScriptContext['worldRenderer'],
    fatalErrorOccurred: false, errorMessage: null,
    getActorCommands: () => [], playerCommands: [],
    registerMapActor: () => {}, fatalError: () => {},
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

describe('MediaGlobal', () => {
  it('registers with name "Media"', () => expect(ScriptRegistry.getGlobal('Media')).toBeDefined())

  it('PlaySound exists and is callable', () => {
    const Ctor = ScriptRegistry.getGlobal('Media')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('PlaySound') as (file: string) => void
    expect(typeof fn).toBe('function')
    fn('test.wav')
  })

  it('DisplayMessage skips empty text', () => {
    const Ctor = ScriptRegistry.getGlobal('Media')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('DisplayMessage') as (text: string) => void
    fn('') // should not throw
  })

  it('FloatingText skips empty text', () => {
    const Ctor = ScriptRegistry.getGlobal('Media')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('FloatingText') as (t: string, p: WPos) => void
    fn('', WPos.Zero) // should not throw
  })

  it('StopMusic exists', () => {
    const Ctor = ScriptRegistry.getGlobal('Media')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('StopMusic') as () => void
    expect(typeof fn).toBe('function')
  })

  it('PlayMusic with empty track', () => {
    const Ctor = ScriptRegistry.getGlobal('Media')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('PlayMusic') as (track?: string) => void
    fn() // should not throw
  })
})
