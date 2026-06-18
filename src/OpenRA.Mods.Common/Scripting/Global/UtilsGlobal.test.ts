/**
 * UtilsGlobal.test.ts — Unit tests for UtilsGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './UtilsGlobal.js'

function ctx(): IScriptContext {
  return {
    world: {
      actors: [],
      sharedRandom: { next: (lo: number, _hi: number) => lo },
    } as unknown as IScriptContext['world'],
    worldRenderer: {} as IScriptContext['worldRenderer'],
    fatalErrorOccurred: false, errorMessage: null,
    getActorCommands: () => [], playerCommands: [],
    registerMapActor: () => {}, fatalError: () => {},
    logDebug: () => {},
    get namedActors() { return new Map() },
  }
}

describe('UtilsGlobal', () => {
  it('registers with name "Utils"', () => expect(ScriptRegistry.getGlobal('Utils')).toBeDefined())

  it('Do calls func on each element', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const results: number[] = []
    const doFn = inst.get('Do') as (c: unknown[], f: (x: unknown) => void) => void
    doFn([1, 2, 3], (x) => results.push(x as number))
    expect(results).toEqual([1, 2, 3])
  })

  it('Any detects matches', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const anyFn = inst.get('Any') as (c: unknown[], f: (x: unknown) => unknown) => boolean
    expect(anyFn([1, 2, 3], (x) => x === 2)).toBe(true)
    expect(anyFn([1, 2, 3], (x) => x === 9)).toBe(false)
  })

  it('All checks all match', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const allFn = inst.get('All') as (c: unknown[], f: (x: unknown) => unknown) => boolean
    expect(allFn([2, 2, 2], (x) => x === 2)).toBe(true)
    expect(allFn([2, 3, 2], (x) => x === 2)).toBe(false)
  })

  it('Where filters', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const whereFn = inst.get('Where') as (c: unknown[], f: (x: unknown) => unknown) => unknown[]
    expect(whereFn([1, 2, 3, 4], (x) => (x as number) > 2)).toEqual([3, 4])
  })

  it('Take returns first n', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const takeFn = inst.get('Take') as (n: number, s: unknown[]) => unknown[]
    expect(takeFn(2, [1, 2, 3])).toEqual([1, 2])
  })

  it('Skip skips first n', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const skipFn = inst.get('Skip') as (t: unknown[], n: number) => unknown[]
    expect(skipFn([1, 2, 3, 4], 2)).toEqual([3, 4])
  })

  it('Concat merges arrays', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const concatFn = inst.get('Concat') as (a: unknown[], b: unknown[]) => unknown[]
    expect(concatFn([1, 2], [3, 4])).toEqual([1, 2, 3, 4])
  })

  it('RandomInteger returns low when low >= high', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const fn = inst.get('RandomInteger') as (lo: number, hi: number) => number
    expect(fn(5, 3)).toBe(5)
  })

  it('FormatTime formats ticks', () => {
    const GlobalCtor = ScriptRegistry.getGlobal('Utils')!.ctor
    const inst = new GlobalCtor(ctx())
    const fn = inst.get('FormatTime') as (t: number, lz?: boolean) => string
    expect(fn(0)).toBe('00:00:00')
    // 25 tps * 3600 = 90000 ticks per hour
    expect(fn(90000)).toBe('01:00:00')
  })
})
