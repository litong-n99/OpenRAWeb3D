/**
 * AnimationStub.test.ts — AnimationStub unit tests
 *
 * Tests frame advancement logic, callback timing, looping, and
 * Babylon.js mesh-backed rendering (via mocked @babylonjs/core).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — must be hoisted before imports
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const meshMocks: any[] = []

function makeMeshMock(name: string): Record<string, unknown> {
  const m = {
    name,
    dispose: vi.fn(),
    material: null as unknown,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scaling: { x: 1, y: 1, z: 1 },
    isVisible: true,
    isPickable: true,
    updateVerticesData: vi.fn(),
    getVerticesData: vi.fn(() => new Float32Array(24)),
    _geometry: {
      setVerticesData: vi.fn(),
      updateVerticesData: vi.fn(),
    },
  }
  meshMocks.push(m)
  return m
}

vi.mock('@babylonjs/core', () => ({
  MeshBuilder: {
    CreatePlane: vi.fn((name: string, _options?: unknown) => makeMeshMock(name)),
  },
  Vector3: vi.fn(function (this: Record<string, unknown>, x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z
  }),
  StandardMaterial: vi.fn(),
  Texture: vi.fn(),
  RawTexture: {
    NEAREST_SAMPLINGMODE: 1,
    BILINEAR_SAMPLINGMODE: 2,
    CreateRGBATexture: vi.fn(),
  },
  Engine: vi.fn(),
  Scene: vi.fn(),
  Color3: vi.fn(),
  Color4: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mock setup — vitest hoists vi.mock, so @babylonjs/core
// resolves to the mocked module when AnimationStub is imported)
// ---------------------------------------------------------------------------

import { AnimationStub } from './AnimationStub.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import { MeshBuilder } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePos(x = 0, y = 0, z = 0): WPos {
  return new WPos(x, y, z)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnimationStub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    meshMocks.length = 0
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('stores image name', () => {
      const anim = new AnimationStub(null, 'testImage')
      expect(anim.image).toBe('testImage')
    })

    it('defaults to 12 frames', () => {
      const anim = new AnimationStub(null, 'img')
      expect(anim.length).toBe(12)
    })

    it('accepts custom frame count', () => {
      const anim = new AnimationStub(null, 'img', 24)
      expect(anim.length).toBe(24)
    })

    it('defaults tickPerFrame to 1', () => {
      const anim = new AnimationStub(null, 'img')
      expect(anim.tickPerFrame).toBe(1)
    })

    it('accepts custom tickPerFrame', () => {
      const anim = new AnimationStub(null, 'img', 12, 3)
      expect(anim.tickPerFrame).toBe(3)
    })

    it('is not started initially', () => {
      const anim = new AnimationStub(null, 'img')
      expect(anim.isStarted).toBe(false)
    })

    it('has no mesh initially', () => {
      const anim = new AnimationStub(null, 'img')
      expect(anim.mesh).toBeNull()
      expect(anim.uiMesh).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // playThen
  // -----------------------------------------------------------------------

  describe('playThen', () => {
    it('starts the animation', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      expect(anim.isStarted).toBe(true)
    })

    it('sets sequence name', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      expect(anim.sequence).toBe('fire')
    })

    it('resets tick counter to 0', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      expect(anim.currentTick).toBe(0)
    })

    it('resets frame to 0', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      expect(anim.currentFrame).toBe(0)
    })

    it('calls onComplete after all frames played (tickPerFrame=1)', () => {
      const anim = new AnimationStub(null, 'img', 3)
      const onComplete = vi.fn()

      anim.playThen('fire', onComplete)

      // Frame 0 → 1 (tick 1)
      anim.tick()
      expect(anim.currentFrame).toBe(1)
      expect(onComplete).not.toHaveBeenCalled()

      // Frame 1 → 2 (tick 2)
      anim.tick()
      expect(anim.currentFrame).toBe(2)
      expect(onComplete).not.toHaveBeenCalled()

      // Frame 2 → done (tick 3) — frame >= length, fires callback
      anim.tick()
      expect(anim.currentFrame).toBe(2) // clamped to last frame
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('calls onComplete at the correct tick with tickPerFrame > 1', () => {
      const anim = new AnimationStub(null, 'img', 3, 2)
      const onComplete = vi.fn()

      anim.playThen('fire', onComplete)

      // tick 1: frame still 0 (1 / 2 = 0)
      anim.tick()
      expect(anim.currentFrame).toBe(0)

      // tick 2: frame advances to 1 (2 / 2 = 1)
      anim.tick()
      expect(anim.currentFrame).toBe(1)

      // tick 3: frame still 1 (3 / 2 = 1)
      anim.tick()
      expect(anim.currentFrame).toBe(1)

      // tick 4: frame advances to 2 (4 / 2 = 2)
      anim.tick()
      expect(anim.currentFrame).toBe(2)

      // tick 5: frame still 2 (5 / 2 = 2), callback not yet
      anim.tick()
      expect(anim.currentFrame).toBe(2)
      expect(onComplete).not.toHaveBeenCalled()

      // tick 6: frame advances to 3 (6 / 2 = 3), past length → fires callback
      anim.tick()
      expect(anim.currentFrame).toBe(2) // clamped
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('does not fire onComplete more than once', () => {
      const anim = new AnimationStub(null, 'img', 2)
      const onComplete = vi.fn()

      anim.playThen('fire', onComplete)

      anim.tick() // frame 0→1
      anim.tick() // done, fires callback
      anim.tick() // extra tick, should not fire again
      anim.tick() // extra tick, should not fire again

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('second playThen replaces first', () => {
      const anim = new AnimationStub(null, 'img', 3)
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      anim.playThen('seq1', cb1)
      anim.tick() // frame 0→1

      // Replace with new sequence
      anim.playThen('seq2', cb2)

      expect(anim.sequence).toBe('seq2')
      expect(anim.currentTick).toBe(0)
      expect(anim.currentFrame).toBe(0)
      expect(cb1).not.toHaveBeenCalled() // old callback discarded

      // Play through to completion
      anim.tick() // frame 0→1
      anim.tick() // frame 1→2
      anim.tick() // done

      expect(cb2).toHaveBeenCalledTimes(1)
      expect(cb1).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // playRepeating
  // -----------------------------------------------------------------------

  describe('playRepeating', () => {
    it('starts the animation', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playRepeating('idle')
      expect(anim.isStarted).toBe(true)
    })

    it('sets sequence name', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playRepeating('idle')
      expect(anim.sequence).toBe('idle')
    })

    it('resets tick and frame', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playRepeating('idle')
      expect(anim.currentTick).toBe(0)
      expect(anim.currentFrame).toBe(0)
    })

    it('loops back to frame 0 after last frame', () => {
      const anim = new AnimationStub(null, 'img', 3)
      anim.playRepeating('idle')

      // Play through frames 0, 1, 2
      anim.tick()
      expect(anim.currentFrame).toBe(1)
      anim.tick()
      expect(anim.currentFrame).toBe(2)
      anim.tick()
      // Should loop: frame becomes 0 again, ticks reset
      expect(anim.currentFrame).toBe(0)
      expect(anim.currentTick).toBe(0)
    })

    it('loops indefinitely', () => {
      const anim = new AnimationStub(null, 'img', 3)
      anim.playRepeating('idle')

      // 3 full loops
      for (let loop = 0; loop < 3; loop++) {
        expect(anim.currentFrame).toBe(0)
        anim.tick()
        expect(anim.currentFrame).toBe(1)
        anim.tick()
        expect(anim.currentFrame).toBe(2)
        anim.tick()
      }

      expect(anim.currentFrame).toBe(0)
      expect(anim.isStarted).toBe(true)
    })

    it('loops with tickPerFrame > 1', () => {
      const anim = new AnimationStub(null, 'img', 2, 3)
      anim.playRepeating('idle')

      // Frame 0 (ticks 0-2)
      anim.tick(); anim.tick()
      expect(anim.currentFrame).toBe(0)

      // Frame 1 (ticks 3-5)
      anim.tick()
      expect(anim.currentFrame).toBe(1)

      anim.tick(); anim.tick()
      expect(anim.currentFrame).toBe(1)

      // Loop: frame wraps (tick 6)
      anim.tick()
      expect(anim.currentFrame).toBe(0)
      expect(anim.currentTick).toBe(0)
    })

    it('does not call onComplete (no callback in repeating mode)', () => {
      const anim = new AnimationStub(null, 'img', 2)
      const spy = vi.fn()

      // Re-assign completion to spy (since playRepeating sets null)
      anim.playRepeating('idle')
      // Force a callback to verify it's not called in repeating mode
      ;(anim as any)._onComplete = spy

      anim.tick()
      anim.tick()
      anim.tick() // loop

      expect(spy).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // tick
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('does nothing when not started', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.tick()
      expect(anim.currentTick).toBe(0)
      expect(anim.currentFrame).toBe(0)
    })

    it('increments tick counter each call', () => {
      const anim = new AnimationStub(null, 'img', 10)
      anim.playRepeating('idle')

      anim.tick()
      expect(anim.currentTick).toBe(1)

      anim.tick()
      expect(anim.currentTick).toBe(2)

      anim.tick()
      expect(anim.currentTick).toBe(3)
    })

    it('advances frame at correct tickPerFrame interval', () => {
      const anim = new AnimationStub(null, 'img', 5, 3)
      anim.playRepeating('idle')

      // ticks 0-2: frame 0
      anim.tick(); anim.tick()
      expect(anim.currentFrame).toBe(0)

      // tick 3: frame 1
      anim.tick()
      expect(anim.currentFrame).toBe(1)

      // ticks 4-5: frame 1
      anim.tick(); anim.tick()
      expect(anim.currentFrame).toBe(1)

      // tick 6: frame 2
      anim.tick()
      expect(anim.currentFrame).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // render
  // -----------------------------------------------------------------------

  describe('render', () => {
    it('returns empty array when not started', () => {
      const anim = new AnimationStub(null, 'img')
      const result = anim.render(makePos(100, 200, 0), 'palette')
      expect(result).toEqual([])
    })

    it('returns non-empty array after playThen', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      const result = anim.render(makePos(100, 200, 0), 'palette')
      expect(result.length).toBe(1)
    })

    it('returns non-empty array after playRepeating', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playRepeating('idle')

      const result = anim.render(makePos(100, 200, 0), 'palette')
      expect(result.length).toBe(1)
    })

    it('creates a mesh via MeshBuilder.CreatePlane on first render', () => {
      const anim = new AnimationStub(null, 'testImg', 5)
      anim.playThen('fire', () => {})

      anim.render(makePos(100, 200, 0), 'palette')

      expect(MeshBuilder.CreatePlane).toHaveBeenCalledWith(
        'anim-ws-testImg',
        { width: 1, height: 1 },
      )
      expect(anim.mesh).not.toBeNull()
    })

    it('reuses the same mesh on subsequent renders', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')
      const mesh1 = anim.mesh

      anim.render(makePos(10, 10, 0), 'p')
      const mesh2 = anim.mesh

      expect(mesh2).toBe(mesh1)
      expect(MeshBuilder.CreatePlane).toHaveBeenCalledTimes(1)
    })

    it('positions mesh at the given WPos', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.render(makePos(100, 200, 50), 'palette')

      const mesh = anim.mesh!
      expect(mesh.position.x).toBe(100)
      expect(mesh.position.y).toBe(200)
      expect(mesh.position.z).toBe(50)
    })

    it('updates UVs on render', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mesh = anim.mesh!
      expect(mesh.updateVerticesData).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // renderUI
  // -----------------------------------------------------------------------

  describe('renderUI', () => {
    it('returns empty array when not started', () => {
      const anim = new AnimationStub(null, 'img')
      const result = anim.renderUI(
        null, null, makePos(0, 0, 0), 1, 'palette',
      )
      expect(result).toEqual([])
    })

    it('returns non-empty array after playThen', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      const result = anim.renderUI(
        null, null, makePos(0, 0, 0), 1, 'palette',
      )
      expect(result.length).toBe(1)
    })

    it('returns non-empty array after playRepeating', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playRepeating('idle')

      const result = anim.renderUI(
        null, null, makePos(0, 0, 0), 1, 'palette',
      )
      expect(result.length).toBe(1)
    })

    it('creates a UI mesh via MeshBuilder.CreatePlane on first renderUI', () => {
      const anim = new AnimationStub(null, 'uiImg', 5)
      anim.playThen('fire', () => {})

      anim.renderUI(null, null, makePos(0, 0, 0), 1, 'palette')

      expect(MeshBuilder.CreatePlane).toHaveBeenCalledWith(
        'anim-ui-uiImg',
        { width: 1, height: 1 },
      )
      expect(anim.uiMesh).not.toBeNull()
    })

    it('reuses the same UI mesh on subsequent calls', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.renderUI(null, null, makePos(0, 0, 0), 1, 'p')
      const mesh1 = anim.uiMesh

      anim.renderUI(null, { x: 100, y: 200 }, makePos(0, 0, 0), 2, 'p')
      const mesh2 = anim.uiMesh

      expect(mesh2).toBe(mesh1)
    })

    it('positions UI mesh at screen position', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.renderUI(null, { x: 320, y: 240 }, makePos(0, 0, 0), 1, 'palette')

      expect(anim.uiMesh!.position.x).toBe(320)
      expect(anim.uiMesh!.position.y).toBe(240)
      expect(anim.uiMesh!.position.z).toBe(0)
    })

    it('applies scale to UI mesh', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.renderUI(null, { x: 0, y: 0 }, makePos(0, 0, 0), 2.5, 'palette')

      expect(anim.uiMesh!.scaling.x).toBe(2.5)
      expect(anim.uiMesh!.scaling.y).toBe(2.5)
    })

    it('keeps world mesh and UI mesh separate', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.render(makePos(100, 200, 0), 'p')
      anim.renderUI(null, { x: 50, y: 50 }, makePos(0, 0, 0), 1, 'p')

      expect(anim.mesh).not.toBeNull()
      expect(anim.uiMesh).not.toBeNull()
      expect(anim.mesh).not.toBe(anim.uiMesh)
    })
  })

  // -----------------------------------------------------------------------
  // Frame length configurability (tickPerFrame)
  // -----------------------------------------------------------------------

  describe('tickPerFrame configurability', () => {
    it('tickPerFrame=1: each tick advances one frame', () => {
      const anim = new AnimationStub(null, 'img', 5, 1)
      anim.playRepeating('idle')

      anim.tick()
      expect(anim.currentFrame).toBe(1)
      anim.tick()
      expect(anim.currentFrame).toBe(2)
    })

    it('tickPerFrame=2: frame advances every other tick', () => {
      const anim = new AnimationStub(null, 'img', 5, 2)
      anim.playRepeating('idle')

      anim.tick()
      expect(anim.currentFrame).toBe(0) // 1/2 = 0
      anim.tick()
      expect(anim.currentFrame).toBe(1) // 2/2 = 1
      anim.tick()
      expect(anim.currentFrame).toBe(1) // 3/2 = 1
      anim.tick()
      expect(anim.currentFrame).toBe(2) // 4/2 = 2
    })

    it('tickPerFrame=40: simulates 25fps animation (40 ticks/frame)', () => {
      const anim = new AnimationStub(null, 'img', 3, 40)
      anim.playRepeating('idle')

      // 39 ticks: still frame 0
      for (let i = 0; i < 39; i++) anim.tick()
      expect(anim.currentFrame).toBe(0)

      // tick 40: frame 1
      anim.tick()
      expect(anim.currentFrame).toBe(1)

      // tick 79: still frame 1
      for (let i = 0; i < 39; i++) anim.tick()
      expect(anim.currentFrame).toBe(1)

      // tick 80: frame 2
      anim.tick()
      expect(anim.currentFrame).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // Multiple playThen calls in sequence
  // -----------------------------------------------------------------------

  describe('multiple playThen calls', () => {
    it('second call replaces first (different sequence)', () => {
      const anim = new AnimationStub(null, 'img', 3)
      const cb1 = vi.fn()
      const cb2 = vi.fn()

      anim.playThen('open', cb1)
      anim.tick() // frame 0→1

      anim.playThen('close', cb2)

      // Should be at start of 'close'
      expect(anim.sequence).toBe('close')
      expect(anim.currentTick).toBe(0)
      expect(anim.currentFrame).toBe(0)

      // Play through 'close'
      anim.tick() // 0→1
      anim.tick() // 1→2
      anim.tick() // done

      expect(cb2).toHaveBeenCalledTimes(1)
      expect(cb1).not.toHaveBeenCalled()
    })

    it('third call replaces second', () => {
      const anim = new AnimationStub(null, 'img', 2)
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      const cb3 = vi.fn()

      anim.playThen('a', cb1)
      anim.playThen('b', cb2)
      anim.playThen('c', cb3)

      expect(anim.sequence).toBe('c')
      expect(anim.currentTick).toBe(0)

      anim.tick() // 0→1
      anim.tick() // done

      expect(cb3).toHaveBeenCalledTimes(1)
      expect(cb1).not.toHaveBeenCalled()
      expect(cb2).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // UV updates
  // -----------------------------------------------------------------------

  describe('UV updates', () => {
    it('updates UVs when frame changes via tick', () => {
      const anim = new AnimationStub(null, 'img', 4)
      anim.playThen('fire', () => {})

      // First render creates mesh
      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!

      const initialCallCount = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls.length

      // Tick to advance frame
      anim.tick() // frame 0→1 → should call updateVerticesData

      const afterTickCallCount = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls.length
      expect(afterTickCallCount).toBeGreaterThan(initialCallCount)
    })

    it('computes correct UVs for frame 0 of N', () => {
      const anim = new AnimationStub(null, 'img', 4)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!

      // First call should have UVs for frame 0: u0=0/4=0, u1=1/4=0.25
      const calls = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls
      // At least one call with 'uv' kind
      const uvCalls = calls.filter((c: unknown[]) => c[0] === 'uv')
      expect(uvCalls.length).toBeGreaterThanOrEqual(1)

      // The first UV call should have frame 0 UVs:
      //   [0/4, 0, 1/4, 0, 1/4, 1, 0/4, 1] = [0, 0, 0.25, 0, 0.25, 1, 0, 1]
      const uvData = uvCalls[0]![1] as Float32Array
      expect(uvData[0]).toBeCloseTo(0)      // u0
      expect(uvData[1]).toBeCloseTo(0)      // v0
      expect(uvData[2]).toBeCloseTo(0.25)   // u1
      expect(uvData[3]).toBeCloseTo(0)      // v0
      expect(uvData[4]).toBeCloseTo(0.25)   // u1
      expect(uvData[5]).toBeCloseTo(1)      // v1
      expect(uvData[6]).toBeCloseTo(0)      // u0
      expect(uvData[7]).toBeCloseTo(1)      // v1
    })

    it('computes correct UVs for mid-sequence frame', () => {
      const anim = new AnimationStub(null, 'img', 4)
      anim.playThen('fire', () => {})

      // Advance to frame 2
      anim.tick(); anim.tick()

      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!

      const calls = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls
      // Find the most recent UV call
      const uvCalls = calls.filter((c: unknown[]) => c[0] === 'uv')
      const lastUvCall = uvCalls[uvCalls.length - 1]!
      const uvData = lastUvCall[1] as Float32Array

      // Frame 2: u0=2/4=0.5, u1=3/4=0.75
      expect(uvData[0]).toBeCloseTo(0.5)
      expect(uvData[2]).toBeCloseTo(0.75)
      expect(uvData[4]).toBeCloseTo(0.75)
      expect(uvData[6]).toBeCloseTo(0.5)
    })
  })

  // -----------------------------------------------------------------------
  // isComplete accessor
  // -----------------------------------------------------------------------

  describe('isComplete', () => {
    it('returns false when animation has not finished', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      expect(anim.isComplete).toBe(false)

      anim.tick()
      expect(anim.isComplete).toBe(false)
    })

    it('returns true when animation has finished', () => {
      const anim = new AnimationStub(null, 'img', 2)
      anim.playThen('fire', () => {})

      anim.tick() // frame 0→1
      expect(anim.isComplete).toBe(false)

      anim.tick() // done
      expect(anim.isComplete).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles frameCount=1 correctly', () => {
      const anim = new AnimationStub(null, 'img', 1)
      const onComplete = vi.fn()

      anim.playThen('once', onComplete)
      expect(anim.currentFrame).toBe(0)

      anim.tick()
      // frame = floor(1/1) = 1, which is >= length (1)
      // So fires onComplete and clamps to frame 0
      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('handles large frameCount', () => {
      const anim = new AnimationStub(null, 'img', 100)
      anim.playRepeating('long')

      for (let i = 0; i < 99; i++) {
        anim.tick()
      }
      expect(anim.currentFrame).toBe(99)

      anim.tick()
      expect(anim.currentFrame).toBe(0) // looped
    })

    it('dispose on mesh is available', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')

      expect(anim.mesh!.dispose).toBeDefined()
      expect(typeof anim.mesh!.dispose).toBe('function')
    })

    it('renderUI with missing screenPos uses default positioning', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      // screenPos is null → should not throw
      const result = anim.renderUI(null, null, makePos(0, 0, 0), 1, 'p')
      expect(result.length).toBe(1)
      // Position should remain at default (0,0,0) since screenPos is null
      expect(anim.uiMesh!.position.x).toBe(0)
      expect(anim.uiMesh!.position.y).toBe(0)
    })
  })
})
