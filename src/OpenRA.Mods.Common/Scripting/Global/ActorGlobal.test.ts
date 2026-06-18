/**
 * ActorGlobal.test.ts — Unit tests for ActorGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import './ActorGlobal.js'

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
            ['e1', { name: 'e1', hasTraitInfo: () => true, getTraitInfo: (n: string) => {
              if (n === 'BuildableInfo') return { buildDuration: 100, buildDurationModifier: 100, queue: ['Infantry'] }
              if (n === 'ValuedInfo') return { cost: 50 }
              return undefined
            }}],
            ['heli', { name: 'heli', hasTraitInfo: () => true, getTraitInfo: (n: string) => {
              if (n === 'AircraftInfo') return { getCruiseAltitude: () => ({ length: 1280 }) }
              return undefined
            }}],
          ]),
        },
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

describe('ActorGlobal', () => {
  it('registers with name "Actor"', () => expect(ScriptRegistry.getGlobal('Actor')).toBeDefined())

  it('Create throws without Owner init', () => {
    const Ctor = ScriptRegistry.getGlobal('Actor')!.ctor
    const inst = new Ctor(ctx())
    const createFn = inst.get('Create') as (type: string, add: boolean, table: Map<string, unknown>) => unknown
    expect(() => createFn('e1', false, new Map())).toThrow()
  })

  it('Create works with Owner init', () => {
    const Ctor = ScriptRegistry.getGlobal('Actor')!.ctor
    const inst = new Ctor(ctx())
    const createFn = inst.get('Create') as (type: string, add: boolean, table: Map<string, unknown>) => unknown
    const result = createFn('e1', false, new Map([['Owner', { playerName: 'Test' }]]))
    expect(result).toBeDefined()
  })

  it('BuildTime returns value', () => {
    const Ctor = ScriptRegistry.getGlobal('Actor')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('BuildTime') as (type: string) => number
    expect(fn('e1')).toBeGreaterThan(0)
  })

  it('BuildTime throws for unknown type', () => {
    const Ctor = ScriptRegistry.getGlobal('Actor')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('BuildTime') as (type: string) => number
    expect(() => fn('unknown')).toThrow()
  })

  it('CruiseAltitude returns 0 for ground units', () => {
    const Ctor = ScriptRegistry.getGlobal('Actor')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('CruiseAltitude') as (type: string) => number
    expect(fn('e1')).toBe(0)
  })

  it('CruiseAltitude returns altitude for aircraft', () => {
    const Ctor = ScriptRegistry.getGlobal('Actor')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('CruiseAltitude') as (type: string) => number
    expect(fn('heli')).toBe(1280)
  })

  it('Cost returns valued cost', () => {
    const Ctor = ScriptRegistry.getGlobal('Actor')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('Cost') as (type: string) => number
    expect(fn('e1')).toBe(50)
  })
})
