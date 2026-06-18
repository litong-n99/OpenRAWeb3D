/**
 * MapGlobal.test.ts — Unit tests for MapGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import './MapGlobal.js'

function ctx(): IScriptContext {
  return {
    world: {
      actors: [],
      lobbyInfo: { nonBotPlayers: [] },
      type: 0, // Normal
      findActorsInCircle: () => [],
      actorMap: { actorsInBox: () => [] },
      map: {
        chooseRandomCell: () => CPos.Zero,
        chooseRandomEdgeCell: () => CPos.Zero,
        chooseClosestEdgeCell: () => CPos.Zero,
        centerOfCell: () => WPos.Zero,
        getTerrainInfo: () => ({ type: 'Clear' }),
        projectedTopLeft: WPos.Zero,
        projectedBottomRight: new WPos(1024, 1024, 0),
        allEdgeCells: [],
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

describe('MapGlobal', () => {
  it('registers with name "Map"', () => expect(ScriptRegistry.getGlobal('Map')).toBeDefined())

  it('CenterOfCell returns position', () => {
    const Ctor = ScriptRegistry.getGlobal('Map')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('CenterOfCell') as (c: unknown) => { x: number; y: number; z: number }
    const result = fn({ X: 0, Y: 0 })
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })

  it('TerrainType returns string', () => {
    const Ctor = ScriptRegistry.getGlobal('Map')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('TerrainType') as (c: CPos) => string
    expect(fn(CPos.Zero)).toBe('Clear')
  })

  it('TopLeft/BottomRight are WPos values', () => {
    const Ctor = ScriptRegistry.getGlobal('Map')!.ctor
    const inst = new Ctor(ctx())
    const tl = inst.get('TopLeft') as { x: number; y: number; z: number }
    const br = inst.get('BottomRight') as { x: number; y: number; z: number }
    expect(tl.x).toBe(0); expect(tl.y).toBe(0)
    expect(br.x).toBe(1024)
  })

  it('IsSinglePlayer returns boolean', () => {
    const Ctor = ScriptRegistry.getGlobal('Map')!.ctor
    const inst = new Ctor(ctx())
    expect(typeof inst.get('IsSinglePlayer')).toBe('boolean')
  })

  it('NamedActor returns null for unknown name', () => {
    const Ctor = ScriptRegistry.getGlobal('Map')!.ctor
    const inst = new Ctor(ctx())
    const fn = inst.get('NamedActor') as (n: string) => unknown
    expect(fn('nonexistent')).toBeNull()
  })

  it('ActorsInWorld returns array', () => {
    const Ctor = ScriptRegistry.getGlobal('Map')!.ctor
    const inst = new Ctor(ctx())
    const actors = inst.get('ActorsInWorld') as unknown[]
    expect(Array.isArray(actors)).toBe(true)
  })
})
