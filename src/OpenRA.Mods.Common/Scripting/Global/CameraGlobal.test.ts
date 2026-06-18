/**
 * CameraGlobal.test.ts — Unit tests for CameraGlobal
 */
import { describe, it, expect } from 'vitest'
import { ScriptRegistry } from '../../../OpenRA.Game/Scripting/ScriptRegistry.js'
import type { IScriptContext } from '../../../OpenRA.Game/Scripting/ScriptMemberDescriptor.js'
import { WPos } from '../../../OpenRA.Game/WPos.js'
import './CameraGlobal.js'

function createMockContext(): IScriptContext {
  let _center = new WPos(100, 200, 0)
  return {
    world: { actors: [] } as unknown as IScriptContext['world'],
    worldRenderer: {
      viewport: {
        get centerPosition() { return _center },
        center: (pos: WPos) => { _center = pos },
      },
    } as unknown as IScriptContext['worldRenderer'],
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

describe('CameraGlobal', () => {
  it('registers with name "Camera"', () => {
    const reg = ScriptRegistry.getGlobal('Camera')
    expect(reg).toBeDefined()
  })

  it('Position property returns viewport center', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Camera')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    const pos = inst.get('Position') as { x: number; y: number; z: number }
    expect(pos.x).toBe(100)
    expect(pos.y).toBe(200)
  })

  it('Position property sets viewport center', () => {
    const ctx = createMockContext()
    const reg = ScriptRegistry.getGlobal('Camera')!
    const Ctor = reg.ctor
    const inst = new Ctor(ctx)
    // fromScriptValue('WPos') expects { x, y, z } — the script-value format
    inst.set('Position', { x: 500, y: 600, z: 0 })
    const pos = inst.get('Position') as { x: number; y: number; z: number }
    expect(pos.x).toBe(500)
    expect(pos.y).toBe(600)
  })
})
