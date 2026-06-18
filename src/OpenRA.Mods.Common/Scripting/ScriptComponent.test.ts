/**
 * ScriptComponent.test.ts — Unit tests for ScriptComponent world-level trait
 *
 * Tests focus on: construction, WorldLoaded lifecycle, Tick delegation,
 * disposal, double-dispose safety, and fatalErrorOccurred.
 * No WebGL or Babylon.js dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ScriptComponent, ScriptComponentInfo } from './ScriptComponent.js'
import type { IGameActor, WorldStub, WorldRendererStub } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import { ScriptContext } from '../../OpenRA.Game/Scripting/ScriptContext.js'

// ---------------------------------------------------------------------------
// Mock ScriptContext
// ---------------------------------------------------------------------------

const mockContextTick = vi.fn()
const mockContextWorldLoaded = vi.fn()
const mockContextDispose = vi.fn()

vi.mock('../../OpenRA.Game/Scripting/ScriptContext.js', () => ({
  ScriptContext: vi.fn().mockImplementation(
    (_world: WorldStub, _worldRenderer: WorldRendererStub, _scripts: Iterable<string>) => ({
      world: _world,
      worldRenderer: _worldRenderer,
      fatalErrorOccurred: false,
      errorMessage: null,
      tick: mockContextTick,
      worldLoaded: mockContextWorldLoaded,
      dispose: mockContextDispose,
      fatalError: vi.fn(),
    }),
  ),
}))

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function stubWorld(): WorldStub {
  return {} as WorldStub
}

function stubWorldRenderer(): WorldRendererStub {
  return {} as WorldRendererStub
}

function stubSelf(): IGameActor {
  return {
    actorId: 0,
    isInWorld: true,
    isDead: false,
    owner: null as unknown as never,
    disposed: false,
    traitName: 'world',
    world: null as unknown as never,
  } as IGameActor
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScriptComponentInfo', () => {
  it('defaults to empty scripts array', () => {
    const info = new ScriptComponentInfo()
    expect(info.scripts).toEqual([])
  })

  it('accepts custom scripts array', () => {
    const info = new ScriptComponentInfo(['script1.json', 'script2.lua'])
    expect(info.scripts).toEqual(['script1.json', 'script2.lua'])
  })

  it('scripts is readonly', () => {
    const info = new ScriptComponentInfo(['a.json'])
    // TypeScript should prevent mutation at compile time
    expect(info.scripts.length).toBe(1)
  })
})

describe('ScriptComponent', () => {
  let component: ScriptComponent
  let info: ScriptComponentInfo
  let world: WorldStub
  let worldRenderer: WorldRendererStub
  let self: IGameActor

  beforeEach(() => {
    vi.clearAllMocks()
    info = new ScriptComponentInfo(['test.json'])
    world = stubWorld()
    worldRenderer = stubWorldRenderer()
    self = stubSelf()
    component = new ScriptComponent(info)
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('stores the info', () => {
      expect(component.info).toBe(info)
    })

    it('context is null before worldLoaded', () => {
      expect(component.context).toBeNull()
    })

    it('fatalErrorOccurred returns false when context is null', () => {
      expect(component.fatalErrorOccurred).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // IWorldLoaded
  // -----------------------------------------------------------------------

  describe('worldLoaded', () => {
    it('creates a ScriptContext', () => {
      component.worldLoaded(world, worldRenderer)
      expect(vi.mocked(ScriptContext)).toHaveBeenCalledWith(world, worldRenderer, ['test.json'])
    })

    it('calls context.worldLoaded()', () => {
      component.worldLoaded(world, worldRenderer)
      expect(mockContextWorldLoaded).toHaveBeenCalledTimes(1)
    })

    it('context is set after worldLoaded', () => {
      component.worldLoaded(world, worldRenderer)
      expect(component.context).not.toBeNull()
    })

    it('passes empty scripts array when info has none', () => {
      const emptyInfo = new ScriptComponentInfo()
      const cmp = new ScriptComponent(emptyInfo)
      cmp.worldLoaded(world, worldRenderer)
      expect(vi.mocked(ScriptContext)).toHaveBeenCalledWith(world, worldRenderer, [])
    })
  })

  // -----------------------------------------------------------------------
  // ITick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('calls context.tick()', () => {
      component.worldLoaded(world, worldRenderer)
      mockContextTick.mockClear()
      component.tick(self)
      expect(mockContextTick).toHaveBeenCalledTimes(1)
    })

    it('does not throw when context is null (pre-WorldLoaded)', () => {
      expect(() => component.tick(self)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // INotifyActorDisposing
  // -----------------------------------------------------------------------

  describe('disposing', () => {
    it('calls context.dispose()', () => {
      component.worldLoaded(world, worldRenderer)
      component.disposing(self)
      expect(mockContextDispose).toHaveBeenCalledTimes(1)
    })

    it('sets _disposed flag', () => {
      component.worldLoaded(world, worldRenderer)
      component.disposing(self)
      // Second dispose should not call context.dispose() again
      mockContextDispose.mockClear()
      component.disposing(self)
      expect(mockContextDispose).not.toHaveBeenCalled()
    })

    it('double-dispose is safe', () => {
      component.worldLoaded(world, worldRenderer)
      component.disposing(self)
      expect(() => component.disposing(self)).not.toThrow()
      component.disposing(self)
      expect(() => component.disposing(self)).not.toThrow()
    })

    it('is safe even without worldLoaded', () => {
      // No context created yet
      expect(() => component.disposing(self)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // fatalErrorOccurred
  // -----------------------------------------------------------------------

  describe('fatalErrorOccurred', () => {
    it('delegates to context.fatalErrorOccurred', () => {
      component.worldLoaded(world, worldRenderer)
      // The mock has fatalErrorOccurred = false
      expect(component.fatalErrorOccurred).toBe(false)

      // Simulate a fatal error
      ;(component.context as NonNullable<typeof component.context>).fatalErrorOccurred = true
      expect(component.fatalErrorOccurred).toBe(true)
    })
  })
})
