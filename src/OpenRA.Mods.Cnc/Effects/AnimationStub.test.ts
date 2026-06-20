/**
 * AnimationStub.test.ts — AnimationStub unit tests
 *
 * Tests frame advancement logic, callback timing, looping, and
 * Babylon.js mesh-backed rendering (via mocked @babylonjs/core).
 *
 * Ch24 Phase A: Added tests for ShaderMaterial assignment, sheet texture
 * integration, explicit frameUVs, renderingGroupId, material disposal,
 * magenta fallback, setSheet/setFrameUVs, and complete lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — must be hoisted before imports
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const meshMocks: any[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shaderMaterialMocks: any[] = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const standardMaterialMocks: any[] = []

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
    renderingGroupId: 0,
    setEnabled: vi.fn(),
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

function makeShaderMaterialMock(name: string): Record<string, unknown> {
  const m = {
    name,
    setVector4: vi.fn(),
    setTexture: vi.fn(),
    setFloat: vi.fn(),
    setVector3: vi.fn(),
    dispose: vi.fn(),
    alphaMode: 0,
    backFaceCulling: true,
    needAlphaBlending: false,
  }
  shaderMaterialMocks.push(m)
  return m
}

function makeStandardMaterialMock(name: string): Record<string, unknown> {
  const m = {
    name,
    dispose: vi.fn(),
    alphaMode: 0,
    backFaceCulling: true,
    emissiveColor: null as unknown,
  }
  standardMaterialMocks.push(m)
  return m
}

vi.mock('@babylonjs/core', () => ({
  MeshBuilder: {
    CreatePlane: vi.fn((name: string, _options?: unknown) => makeMeshMock(name)),
  },
  Vector3: vi.fn(function (this: Record<string, unknown>, x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z
  }),
  Vector4: vi.fn(function (this: Record<string, unknown>, x = 0, y = 0, z = 0, w = 0) {
    this.x = x; this.y = y; this.z = z; this.w = w
  }),
  ShaderMaterial: vi.fn(function (
    this: Record<string, unknown>,
    name: string,
    _scene: unknown,
    _shaderPath: unknown,
    _options?: unknown,
  ) {
    const mock = makeShaderMaterialMock(name)
    Object.assign(this, mock)
  }),
  StandardMaterial: vi.fn(function (
    this: Record<string, unknown>,
    name: string,
    _scene: unknown,
  ) {
    const mock = makeStandardMaterialMock(name)
    Object.assign(this, mock)
  }),
  Color3: vi.fn(function (this: Record<string, unknown>, r = 0, g = 0, b = 0) {
    this.r = r; this.g = g; this.b = b
  }),
  Color4: vi.fn(function (this: Record<string, unknown>, r = 0, g = 0, b = 0, a = 0) {
    this.r = r; this.g = g; this.b = b; this.a = a
  }),
  Constants: {
    ALPHA_PREMULTIPLIED: 2,
    ALPHA_COMBINE: 0,
    ALPHA_ADD: 1,
    ALPHA_DISABLE: 3,
  },
  Texture: vi.fn(),
  RawTexture: {
    NEAREST_SAMPLINGMODE: 1,
    BILINEAR_SAMPLINGMODE: 2,
    CreateRGBATexture: vi.fn(),
  },
  Engine: vi.fn(),
  Scene: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mock setup — vitest hoists vi.mock, so @babylonjs/core
// resolves to the mocked module when AnimationStub is imported)
// ---------------------------------------------------------------------------

import { AnimationStub } from './AnimationStub.js'
import { WPos } from '../../OpenRA.Game/WPos.js'
import {
  MeshBuilder,
  ShaderMaterial,
  StandardMaterial,
  Color3,
  Constants,
  type Scene,
} from '@babylonjs/core'
import type { Sheet } from '../../OpenRA.Game/Graphics/Sheet.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePos(x = 0, y = 0, z = 0): WPos {
  return new WPos(x, y, z)
}

function makeFrameUVs(count: number): Float32Array[] {
  const uvs: Float32Array[] = []
  for (let i = 0; i < count; i++) {
    const u0 = i / count
    const u1 = (i + 1) / count
    uvs.push(new Float32Array([u0, 0, u1, 1]))
  }
  return uvs
}

function makeMockScene(): Scene {
  return {} as Scene
}

function makeMockSheet(): Sheet {
  return {
    size: { width: 256, height: 256 },
    type: 4, // BGRA
    getTexture: vi.fn(() => ({})),
    dispose: vi.fn(),
  } as unknown as Sheet
}

// ---------------------------------------------------------------------------
// Reset static state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  meshMocks.length = 0
  shaderMaterialMocks.length = 0
  standardMaterialMocks.length = 0
  // Reset the fallback warning flag so tests get consistent behavior
  ;(AnimationStub as unknown as { _fallbackWarningEmitted: boolean })._fallbackWarningEmitted = false
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnimationStub', () => {
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

    // Ch24 Phase A: constructor with optional params
    it('accepts optional Sheet parameter', () => {
      const sheet = makeMockSheet()
      const anim = new AnimationStub(null, 'img', 12, 1, sheet)
      expect(anim.material).toBeNull() // not created until render
    })

    it('accepts optional frameUVs parameter', () => {
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, undefined, uvs)
      expect(anim.length).toBe(4)
    })

    it('accepts optional Scene parameter', () => {
      const scene = makeMockScene()
      const anim = new AnimationStub(null, 'img', 12, 1, undefined, undefined, scene)
      expect(anim.material).toBeNull() // not created until render
    })

    it('accepts all optional parameters', () => {
      const sheet = makeMockSheet()
      const uvs = makeFrameUVs(4)
      const scene = makeMockScene()
      const anim = new AnimationStub(null, 'img', 4, 2, sheet, uvs, scene)
      expect(anim.length).toBe(4)
      expect(anim.tickPerFrame).toBe(2)
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
        undefined,
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

    // Ch24 Phase A: hides mesh when not started
    it('calls setEnabled(false) on mesh when not started (if mesh exists)', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!
      const setEnabledCallsBefore = (mesh.setEnabled as ReturnType<typeof vi.fn>).mock.calls.length

      // Simulate animation being stopped (hack: set _started to false)
      ;(anim as unknown as { _started: boolean })._started = false
      anim.render(makePos(0, 0, 0), 'p')

      const setEnabledCallsAfter = (mesh.setEnabled as ReturnType<typeof vi.fn>).mock.calls.length
      expect(setEnabledCallsAfter).toBeGreaterThan(setEnabledCallsBefore)
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
        undefined,
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
  // Ch24 Phase A: Material assignment
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — material assignment', () => {
    it('assigns ShaderMaterial to mesh when Sheet and Scene are provided', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mesh = anim.mesh!
      expect(mesh.material).not.toBeNull()
      expect(mesh.material).toBe(anim.material)
      expect(ShaderMaterial).toHaveBeenCalled()
    })

    it('falls back to magenta StandardMaterial when no Sheet but Scene available', () => {
      const scene = makeMockScene()
      const anim = new AnimationStub(null, 'img', 4, 1, undefined, undefined, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mesh = anim.mesh!
      expect(mesh.material).not.toBeNull()
      expect(StandardMaterial).toHaveBeenCalled()
      // Verify magenta emissive color (Color3(1, 0, 1))
      expect(Color3).toHaveBeenCalledWith(1, 0, 1)
    })

    it('does not create material when no Scene provided', () => {
      const sheet = makeMockSheet()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      expect(anim.material).toBeNull()
    })

    it('sets alphaMode to ALPHA_PREMULTIPLIED on ShaderMaterial', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mat = anim.material!
      expect(mat.alphaMode).toBe(Constants.ALPHA_PREMULTIPLIED)
    })

    it('sets backFaceCulling to false on ShaderMaterial', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mat = anim.material!
      expect(mat.backFaceCulling).toBe(false)
    })

    it('sets alphaMode on fallback StandardMaterial', () => {
      const scene = makeMockScene()
      const anim = new AnimationStub(null, 'img', 4, 1, undefined, undefined, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mat = anim.material!
      expect(mat.alphaMode).toBe(Constants.ALPHA_PREMULTIPLIED)
    })

    it('material is created lazily (only on first render)', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      // Before render, material should be null
      expect(anim.material).toBeNull()

      // After render, material should exist
      anim.render(makePos(0, 0, 0), 'p')
      expect(anim.material).not.toBeNull()
    })

    // MAJOR fix: renderUI first, then render — both meshes get material
    it('assigns material to world mesh when UI mesh was created first', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      // renderUI first — creates UI mesh + material
      anim.renderUI(null, { x: 0, y: 0 }, makePos(0, 0, 0), 1, 'p')
      expect(anim.uiMesh).not.toBeNull()
      expect(anim.material).not.toBeNull()
      expect(anim.uiMesh!.material).not.toBeNull()

      // render second — creates world mesh, should also get material
      anim.render(makePos(100, 200, 0), 'p')
      expect(anim.mesh).not.toBeNull()
      expect(anim.mesh!.material).not.toBeNull()
      expect(anim.mesh!.material).toBe(anim.material)
    })

    // Reverse: render first, then renderUI — UI mesh gets material
    it('assigns material to UI mesh when world mesh was created first', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      // render first — creates world mesh + material
      anim.render(makePos(100, 200, 0), 'p')
      expect(anim.mesh).not.toBeNull()
      expect(anim.material).not.toBeNull()
      expect(anim.mesh!.material).not.toBeNull()

      // renderUI second — creates UI mesh, should also get material
      anim.renderUI(null, { x: 0, y: 0 }, makePos(0, 0, 0), 1, 'p')
      expect(anim.uiMesh).not.toBeNull()
      expect(anim.uiMesh!.material).not.toBeNull()
      expect(anim.uiMesh!.material).toBe(anim.material)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: renderingGroupId
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — renderingGroupId', () => {
    it('sets renderingGroupId = 1 (Actor) on world mesh', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mesh = anim.mesh!
      expect(mesh.renderingGroupId).toBe(1)
    })

    it('sets renderingGroupId = 1 (Actor) on UI mesh', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})

      anim.renderUI(null, { x: 0, y: 0 }, makePos(0, 0, 0), 1, 'p')

      const mesh = anim.uiMesh!
      expect(mesh.renderingGroupId).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: UV update with explicit frameUVs
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — UV update with frameUVs', () => {
    it('uses explicit frameUVs when provided', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      // Create non-uniform UVs to verify they're used
      const uvs = [
        new Float32Array([0.0, 0.0, 0.25, 0.5]),   // frame 0
        new Float32Array([0.25, 0.0, 0.5, 0.5]),    // frame 1
        new Float32Array([0.5, 0.0, 0.75, 0.5]),    // frame 2
        new Float32Array([0.75, 0.5, 1.0, 1.0]),    // frame 3
      ]
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!

      // Get the UV data from the first updateVerticesData call for 'uv'
      const uvCalls = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === 'uv')
      const firstUvCall = uvCalls[0]!
      const uvData = firstUvCall[1] as Float32Array

      // Frame 0: uMin=0, vMin=0, uMax=0.25, vMax=0.5
      expect(uvData[0]).toBeCloseTo(0)     // uMin
      expect(uvData[1]).toBeCloseTo(0)     // vMin
      expect(uvData[2]).toBeCloseTo(0.25)  // uMax
      expect(uvData[3]).toBeCloseTo(0)     // vMin
      expect(uvData[4]).toBeCloseTo(0.25)  // uMax
      expect(uvData[5]).toBeCloseTo(0.5)   // vMax
      expect(uvData[6]).toBeCloseTo(0)     // uMin
      expect(uvData[7]).toBeCloseTo(0.5)   // vMax
    })

    it('uses correct UV rect for mid-sequence frame', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = [
        new Float32Array([0.0, 0.0, 0.2, 1.0]),
        new Float32Array([0.2, 0.0, 0.4, 1.0]),
        new Float32Array([0.4, 0.0, 0.6, 1.0]),
        new Float32Array([0.6, 0.0, 0.8, 1.0]),
      ]
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      // Advance to frame 2
      anim.tick(); anim.tick()

      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!

      const uvCalls = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === 'uv')
      // Get the last UV call (after frame advance)
      const lastUvCall = uvCalls[uvCalls.length - 1]!
      const uvData = lastUvCall[1] as Float32Array

      // Frame 2: uMin=0.4, uMax=0.6
      expect(uvData[0]).toBeCloseTo(0.4)
      expect(uvData[2]).toBeCloseTo(0.6)
      expect(uvData[4]).toBeCloseTo(0.6)
      expect(uvData[6]).toBeCloseTo(0.4)
    })

    it('falls back to evenly-spaced strip when no frameUVs provided', () => {
      const anim = new AnimationStub(null, 'img', 4)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!

      const uvCalls = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls
        .filter((c: unknown[]) => c[0] === 'uv')
      const firstUvCall = uvCalls[0]!
      const uvData = firstUvCall[1] as Float32Array

      // Frame 0 with evenly-spaced strip: u0=0/4=0, u1=1/4=0.25
      expect(uvData[0]).toBeCloseTo(0)
      expect(uvData[2]).toBeCloseTo(0.25)
    })

    it('updates UVs when frame changes via tick (with frameUVs)', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = [
        new Float32Array([0.0, 0.0, 0.25, 1.0]),
        new Float32Array([0.25, 0.0, 0.5, 1.0]),
        new Float32Array([0.5, 0.0, 0.75, 1.0]),
        new Float32Array([0.75, 0.0, 1.0, 1.0]),
      ]
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')
      const mesh = anim.mesh!
      const initialCallCount = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls.length

      // Tick to advance frame
      anim.tick() // frame 0→1

      const afterTickCallCount = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls.length
      expect(afterTickCallCount).toBeGreaterThan(initialCallCount)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: ShaderMaterial uniform update
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — ShaderMaterial uniform update', () => {
    it('calls setVector4 with correct frameUV on frame change', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = [
        new Float32Array([0.0, 0.0, 0.25, 1.0]),
        new Float32Array([0.25, 0.0, 0.5, 1.0]),
        new Float32Array([0.5, 0.0, 0.75, 1.0]),
      ]
      const anim = new AnimationStub(null, 'img', 3, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      // Get the ShaderMaterial mock (first one created)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = anim.material! as any
      const setVector4Calls = (mat.setVector4 as ReturnType<typeof vi.fn>).mock.calls

      // First call should be for frame 0: (0, 0, 0.25, 1)
      const frame0Call = setVector4Calls.find(
        (c: unknown[]) => c[0] === 'uFrameUV',
      )
      expect(frame0Call).toBeDefined()
      const v4_0 = frame0Call![1] as { x: number; y: number; z: number; w: number }
      expect(v4_0.x).toBeCloseTo(0)
      expect(v4_0.y).toBeCloseTo(0)
      expect(v4_0.z).toBeCloseTo(0.25)
      expect(v4_0.w).toBeCloseTo(1)

      // Advance frame and re-render
      anim.tick() // frame 1
      anim.render(makePos(0, 0, 0), 'p')

      const setVector4CallsAfter = (mat.setVector4 as ReturnType<typeof vi.fn>).mock.calls
      const frame1Calls = setVector4CallsAfter.filter(
        (c: unknown[]) => c[0] === 'uFrameUV',
      )
      // Should have more calls now (at least 2 for frame 0 and frame 1)
      expect(frame1Calls.length).toBeGreaterThanOrEqual(2)

      // Last call should be for frame 1: (0.25, 0, 0.5, 1)
      const lastCall = frame1Calls[frame1Calls.length - 1]!
      const v4_1 = lastCall[1] as { x: number; y: number; z: number; w: number }
      expect(v4_1.x).toBeCloseTo(0.25)
      expect(v4_1.y).toBeCloseTo(0)
      expect(v4_1.z).toBeCloseTo(0.5)
      expect(v4_1.w).toBeCloseTo(1)
    })

    it('calls setTexture with sheet texture', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mat = anim.material! as any
      expect(mat.setTexture).toHaveBeenCalledWith('uTexture', expect.anything())
      expect(sheet.getTexture).toHaveBeenCalledWith(scene)
    })

    it('does not call setVector4 on fallback StandardMaterial', () => {
      const scene = makeMockScene()
      const anim = new AnimationStub(null, 'img', 4, 1, undefined, undefined, scene)
      anim.playThen('fire', () => {})

      anim.render(makePos(0, 0, 0), 'p')

      const mat = anim.material!
      // StandardMaterial mock does not have setVector4
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (mat as any).setVector4).toBe('undefined')
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: setSheet and setFrameUVs
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — setSheet / setFrameUVs', () => {
    it('setSheet stores sheet and frameUVs', () => {
      const anim = new AnimationStub(null, 'img', 4)
      const sheet = makeMockSheet()
      const uvs = makeFrameUVs(4)

      anim.setSheet(sheet, uvs)

      // After setSheet, render should use the provided sheet
      const scene = makeMockScene()
      anim.setSheet(sheet, uvs, scene)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')

      expect(anim.material).not.toBeNull()
    })

    it('setSheet replaces existing fallback material with ShaderMaterial', () => {
      const scene = makeMockScene()
      const anim = new AnimationStub(null, 'img', 4, 1, undefined, undefined, scene)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')

      // Should have created fallback StandardMaterial
      expect(StandardMaterial).toHaveBeenCalled()

      // Now set sheet — should dispose old material and create ShaderMaterial
      const sheet = makeMockSheet()
      const uvs = makeFrameUVs(4)
      const disposeSpy = anim.material!.dispose as ReturnType<typeof vi.fn>
      expect(disposeSpy).toBeDefined()

      anim.setSheet(sheet, uvs)
      // Old material should be disposed
      expect(disposeSpy).toHaveBeenCalled()
    })

    it('setFrameUVs updates UVs without changing sheet', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs1 = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs1, scene)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')

      const mesh = anim.mesh!
      const callCountBefore = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls.length

      // Set different UVs
      const uvs2 = [
        new Float32Array([0.5, 0.5, 1.0, 1.0]),
        new Float32Array([0.0, 0.5, 0.5, 1.0]),
        new Float32Array([0.5, 0.0, 1.0, 0.5]),
        new Float32Array([0.0, 0.0, 0.5, 0.5]),
      ]
      anim.setFrameUVs(uvs2)

      const callCountAfter = (mesh.updateVerticesData as ReturnType<typeof vi.fn>).mock.calls.length
      expect(callCountAfter).toBeGreaterThan(callCountBefore)
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: dispose cleans up material
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — dispose with material', () => {
    it('dispose calls material.dispose', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')

      const mat = anim.material!
      expect(mat).not.toBeNull()

      anim.dispose()
      expect(mat.dispose).toHaveBeenCalled()
      expect(anim.material).toBeNull()
      expect(anim.mesh).toBeNull()
      expect(anim.uiMesh).toBeNull()
    })

    it('dispose works when no material was created (no scene)', () => {
      const anim = new AnimationStub(null, 'img', 5)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')

      anim.dispose()
      expect(anim.mesh).toBeNull()
    })

    it('dispose is idempotent', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')

      anim.dispose()
      anim.dispose() // should not throw
      anim.dispose() // should not throw

      expect(anim.material).toBeNull()
      expect(anim.mesh).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: registerWithWorld
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — registerWithWorld', () => {
    it('subscribes tick to world.onTick', () => {
      const anim = new AnimationStub(null, 'img', 5)
      const tickCallbacks: (() => void)[] = []
      const world = {
        onTick: vi.fn((cb: () => void) => {
          tickCallbacks.push(cb)
        }),
      }

      anim.registerWithWorld(world)
      expect(world.onTick).toHaveBeenCalledTimes(1)

      // Simulate world tick
      anim.playRepeating('idle')
      tickCallbacks.forEach(cb => cb())
      expect(anim.currentTick).toBe(1)
    })

    it('does nothing when world has no onTick', () => {
      const anim = new AnimationStub(null, 'img', 5)
      const world = {}

      expect(() => anim.registerWithWorld(world)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: complete lifecycle with material
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — complete lifecycle with material', () => {
    it('create → start → tick → render → onComplete → dispose', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(3)
      const anim = new AnimationStub(null, 'lifecycle', 3, 1, sheet, uvs, scene)

      // Not started yet
      expect(anim.isStarted).toBe(false)
      expect(anim.material).toBeNull()

      // Start
      const onComplete = vi.fn()
      anim.playThen('test', onComplete)
      expect(anim.isStarted).toBe(true)

      // First render — creates mesh + material
      const result = anim.render(makePos(10, 20, 5), 'palette')
      expect(result.length).toBe(1)
      expect(anim.mesh).not.toBeNull()
      expect(anim.material).not.toBeNull()

      // Tick through frames
      anim.tick() // frame 0→1
      expect(anim.currentFrame).toBe(1)

      anim.tick() // frame 1→2
      expect(anim.currentFrame).toBe(2)

      // Should not have completed yet (frame 2 is the last frame shown, tick=2)
      expect(onComplete).not.toHaveBeenCalled()

      anim.tick() // frame >= length → fires callback
      expect(onComplete).toHaveBeenCalledTimes(1)

      // Dispose
      anim.dispose()
      expect(anim.material).toBeNull()
      expect(anim.mesh).toBeNull()
    })

    it('repeating animation loops with material', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(3)
      const anim = new AnimationStub(null, 'loop', 3, 1, sheet, uvs, scene)
      anim.playRepeating('idle')

      anim.render(makePos(0, 0, 0), 'p')
      expect(anim.material).not.toBeNull()

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
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: material accessor
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — material accessor', () => {
    it('returns null before render', () => {
      const sheet = makeMockSheet()
      const scene = makeMockScene()
      const uvs = makeFrameUVs(4)
      const anim = new AnimationStub(null, 'img', 4, 1, sheet, uvs, scene)
      expect(anim.material).toBeNull()
    })

    it('returns non-null after render (with scene)', () => {
      const scene = makeMockScene()
      const anim = new AnimationStub(null, 'img', 4, 1, undefined, undefined, scene)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')
      expect(anim.material).not.toBeNull()
    })

    it('returns null after render (without scene)', () => {
      const anim = new AnimationStub(null, 'img', 4)
      anim.playThen('fire', () => {})
      anim.render(makePos(0, 0, 0), 'p')
      expect(anim.material).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Ch24 Phase A: backward compatibility with existing constructor
  // -----------------------------------------------------------------------

  describe('Ch24 Phase A — backward compatibility', () => {
    it('existing constructor signature works unchanged', () => {
      const anim = new AnimationStub(null, 'test', 12, 1)
      anim.playThen('fire', () => {})
      const result = anim.render(makePos(0, 0, 0), 'p')
      expect(result.length).toBe(1)
    })

    it('old two-argument constructor works unchanged', () => {
      const anim = new AnimationStub(null, 'test')
      expect(anim.length).toBe(12)
      expect(anim.tickPerFrame).toBe(1)
    })

    it('old three-argument constructor works unchanged', () => {
      const anim = new AnimationStub(null, 'test', 24)
      expect(anim.length).toBe(24)
      expect(anim.tickPerFrame).toBe(1)
    })

    it('old four-argument constructor works unchanged', () => {
      const anim = new AnimationStub(null, 'test', 12, 3)
      expect(anim.length).toBe(12)
      expect(anim.tickPerFrame).toBe(3)
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
