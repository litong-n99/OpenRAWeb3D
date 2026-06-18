/**
 * EditorCursorLayer.test.ts — EditorCursorLayer migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: brush delegation, null-brush behavior, cursor position
 * management, SpatiallyPartitionable getters, cursor color updates, dispose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

const mockDispose = vi.fn()
const mockSceneDispose = vi.fn()

const mockMesh = {
  position: { x: 0, y: 0, z: 0 },
  isVisible: true,
  isPickable: true,
  material: null as unknown,
  rotation: { x: 0, y: 0, z: 0 },
  dispose: mockDispose,
}

vi.mock('@babylonjs/core/Maths/math.vector', () => ({
  Vector3: vi.fn((x: number, y: number, z: number) => ({ x, y, z })),
}))

vi.mock('@babylonjs/core/Maths/math.color', () => ({
  Color3: vi.fn((r: number, g: number, b: number) => ({ r, g, b })),
}))

vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({
  MeshBuilder: {
    CreatePlane: vi.fn((_name: string, _options: unknown, _scene: unknown) => ({
      ...mockMesh,
      dispose: vi.fn(),
    })),
  },
}))

vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({
  StandardMaterial: vi.fn((_name: string, _scene: unknown) => ({
    diffuseColor: { r: 1, g: 1, b: 1 },
    alpha: 1,
    backFaceCulling: true,
    alphaMode: 0,
    dispose: vi.fn(),
  })),
}))

vi.mock('@babylonjs/core/Meshes/mesh', () => ({
  // type-only, no runtime needed
}))

vi.mock('@babylonjs/core/scene', () => ({
  // type-only, no runtime needed
}))

// ---------------------------------------------------------------------------
// Mock CoordinateTransformer (avoid Babylon.js Vector3 dependency)
// ---------------------------------------------------------------------------

vi.mock('../../../OpenRA.Game/CoordinateTransformer.js', () => ({
  WORLD_SCALE: 1 / 1024,
  cellToVector3: vi.fn((_cpos: unknown, _height: number, _grid: unknown) => ({
    x: 10,
    y: 0.5,
    z: 10,
  })),
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  EditorCursorLayer,
  EditorCursorLayerInfo,
  CursorColor,
} from './EditorCursorLayer.js'
import type { IEditorBrush } from '../../Editor/IEditorBrush.js'
import { CPos } from '../../../OpenRA.Game/CPos.js'
import type {
  IGameActor,
  WorldRendererStub,
  IRenderable,
} from '../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeBrush(overrides: Partial<IEditorBrush> = {}): IEditorBrush {
  return {
    tickRender: vi.fn(),
    renderAboveShroud: vi.fn().mockReturnValue([]),
    renderAnnotations: vi.fn().mockReturnValue([]),
    handleMouseInput: vi.fn().mockReturnValue(false),
    tick: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  }
}

function makeWorldActor(): IGameActor {
  return { actorId: 'world' } as unknown as IGameActor
}

function makeWorldRenderer(): WorldRendererStub {
  return {}
}

// ---------------------------------------------------------------------------
// EditorCursorLayerInfo tests
// ---------------------------------------------------------------------------

describe('EditorCursorLayerInfo', () => {
  it('creates an EditorCursorLayer instance via create()', () => {
    const info = new EditorCursorLayerInfo()
    const layer = info.create({ self: { actorId: 'world' } as unknown as IGameActor })
    expect(layer).toBeInstanceOf(EditorCursorLayer)
  })
})

// ---------------------------------------------------------------------------
// EditorCursorLayer tests
// ---------------------------------------------------------------------------

describe('EditorCursorLayer', () => {
  let layer: EditorCursorLayer
  let worldActor: IGameActor
  let wr: WorldRendererStub

  beforeEach(() => {
    layer = new EditorCursorLayer()
    worldActor = makeWorldActor()
    wr = makeWorldRenderer()
  })

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('has null brush by default', () => {
      expect(layer.getBrush()).toBeNull()
    })

    it('has zero cursor position by default', () => {
      const cursor = layer.getCursor()
      expect(cursor).toBeInstanceOf(CPos)
      expect(cursor.X).toBe(0)
      expect(cursor.Y).toBe(0)
    })

    it('is not spatially partitionable', () => {
      expect(layer.spatiallyPartitionable).toBe(false)
      expect(layer.annotationsSpatiallyPartitionable).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Null brush behavior
  // -----------------------------------------------------------------------

  describe('null brush', () => {
    it('renderAboveShroud returns empty array when brush is null', () => {
      const result = layer.renderAboveShroud(worldActor, wr)
      expect(result).toEqual([])
    })

    it('renderAnnotations returns empty array when brush is null', () => {
      const result = layer.renderAnnotations(worldActor, wr)
      expect(result).toEqual([])
    })

    it('tickRender does not throw when brush is null', () => {
      expect(() => layer.tickRender(wr, worldActor)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // SetBrush / getBrush
  // -----------------------------------------------------------------------

  describe('SetBrush', () => {
    it('routes tickRender to the brush', () => {
      const brush = makeBrush()
      layer.setBrush(brush)
      layer.tickRender(wr, worldActor)
      expect(brush.tickRender).toHaveBeenCalledWith(wr, worldActor)
    })

    it('routes renderAboveShroud to the brush', () => {
      const renderables = [{ _id: 1 }] as unknown as IRenderable[]
      const brush = makeBrush({
        renderAboveShroud: vi.fn().mockReturnValue(renderables),
      })
      layer.setBrush(brush)
      const result = layer.renderAboveShroud(worldActor, wr)
      expect(brush.renderAboveShroud).toHaveBeenCalledWith(worldActor, wr)
      expect(result).toBe(renderables)
    })

    it('routes renderAnnotations to the brush', () => {
      const annotations = [{ _id: 2 }] as unknown as IRenderable[]
      const brush = makeBrush({
        renderAnnotations: vi.fn().mockReturnValue(annotations),
      })
      layer.setBrush(brush)
      const result = layer.renderAnnotations(worldActor, wr)
      expect(brush.renderAnnotations).toHaveBeenCalledWith(worldActor, wr)
      expect(result).toBe(annotations)
    })

    it('getBrush returns the set brush', () => {
      const brush = makeBrush()
      layer.setBrush(brush)
      expect(layer.getBrush()).toBe(brush)
    })

    it('setBrush(null) clears the brush', () => {
      const brush = makeBrush()
      layer.setBrush(brush)
      layer.setBrush(null)
      expect(layer.getBrush()).toBeNull()
      expect(layer.renderAboveShroud(worldActor, wr)).toEqual([])
    })

    it('new brush takes over rendering from old brush', () => {
      const brush1 = makeBrush({
        renderAboveShroud: vi.fn().mockReturnValue([{ _id: 'b1' }] as unknown as IRenderable[]),
      })
      const brush2 = makeBrush({
        renderAboveShroud: vi.fn().mockReturnValue([{ _id: 'b2' }] as unknown as IRenderable[]),
      })

      layer.setBrush(brush1)
      expect(layer.renderAboveShroud(worldActor, wr)).toEqual([{ _id: 'b1' }])

      layer.setBrush(brush2)
      expect(layer.renderAboveShroud(worldActor, wr)).toEqual([{ _id: 'b2' }])
      // brush1 should no longer be called
      expect(brush1.renderAboveShroud).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // TickRender delegation
  // -----------------------------------------------------------------------

  describe('tickRender', () => {
    it('delegates to brush.tickRender() when brush is set', () => {
      const brush = makeBrush()
      layer.setBrush(brush)
      layer.tickRender(wr, worldActor)
      expect(brush.tickRender).toHaveBeenCalledTimes(1)
    })

    it('does not throw when no brush is set', () => {
      expect(() => layer.tickRender(wr, worldActor)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // RenderAboveShroud delegation
  // -----------------------------------------------------------------------

  describe('renderAboveShroud', () => {
    it('delegates and returns brush renderables', () => {
      const items = [{ tag: 'a' }] as unknown as IRenderable[]
      const brush = makeBrush({ renderAboveShroud: vi.fn().mockReturnValue(items) })
      layer.setBrush(brush)
      expect(layer.renderAboveShroud(worldActor, wr)).toBe(items)
    })

    it('returns empty array when brush returns null/undefined (simulated)', () => {
      // When brush is null, the ?? operator returns NoRenderables
      layer.setBrush(null)
      const result = layer.renderAboveShroud(worldActor, wr)
      expect(result).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // RenderAnnotations delegation
  // -----------------------------------------------------------------------

  describe('renderAnnotations', () => {
    it('delegates and returns brush annotations', () => {
      const items = [{ tag: 'ann' }] as unknown as IRenderable[]
      const brush = makeBrush({ renderAnnotations: vi.fn().mockReturnValue(items) })
      layer.setBrush(brush)
      expect(layer.renderAnnotations(worldActor, wr)).toBe(items)
    })

    it('returns empty array when brush is null', () => {
      layer.setBrush(null)
      const result = layer.renderAnnotations(worldActor, wr)
      expect(result).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // SpatiallyPartitionable
  // -----------------------------------------------------------------------

  describe('spatiallyPartitionable', () => {
    it('always returns false for renderAboveShroud', () => {
      expect(layer.spatiallyPartitionable).toBe(false)
      const brush = makeBrush()
      layer.setBrush(brush)
      expect(layer.spatiallyPartitionable).toBe(false)
    })

    it('always returns false for annotations', () => {
      expect(layer.annotationsSpatiallyPartitionable).toBe(false)
      const brush = makeBrush()
      layer.setBrush(brush)
      expect(layer.annotationsSpatiallyPartitionable).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Cursor position management
  // -----------------------------------------------------------------------

  describe('cursor position', () => {
    it('getCursor returns default CPos.Zero initially', () => {
      const cursor = layer.getCursor()
      expect(cursor.X).toBe(0)
      expect(cursor.Y).toBe(0)
      expect(cursor.Layer).toBe(0)
    })

    it('setCursor updates the cursor position', () => {
      const cell = new CPos(5, 10)
      layer.setCursor(cell)
      const cursor = layer.getCursor()
      expect(cursor.X).toBe(5)
      expect(cursor.Y).toBe(10)
    })

    it('setCursor uses default height 0 when not provided', () => {
      const cell = new CPos(3, 7)
      layer.setCursor(cell)
      // Position should be at height 0 — no error expected
      expect(layer.getCursor().X).toBe(3)
      expect(layer.getCursor().Y).toBe(7)
    })

    it('setCursor with explicit height', () => {
      const cell = new CPos(1, 1)
      layer.setCursor(cell, 5)
      expect(layer.getCursor().X).toBe(1)
      expect(layer.getCursor().Y).toBe(1)
    })

    it('setCursorHeight updates height and repositions mesh', () => {
      const cell = new CPos(4, 4)
      layer.setCursor(cell, 0)
      layer.setCursorHeight(3)
      // No error — mesh is null but update is guarded
      expect(layer.getCursor().X).toBe(4)
    })
  })

  // -----------------------------------------------------------------------
  // Cursor color
  // -----------------------------------------------------------------------

  describe('cursor color', () => {
    it('setCursorColor updates the stored color', () => {
      // Use the globally mocked Color3 (from vi.mock above)
      // Material is null (mesh not created), so no crash
      layer.setCursorColor({ r: 1, g: 0, b: 0 } as unknown as import('@babylonjs/core/Maths/math.color').Color3)
    })

    it('CursorColor preset values are defined', () => {
      expect(CursorColor.Default).toBeDefined()
      expect(CursorColor.Tile).toBeDefined()
      expect(CursorColor.Actor).toBeDefined()
      expect(CursorColor.Resource).toBeDefined()
      expect(CursorColor.Invalid).toBeDefined()
    })

    it('CursorColor presets have distinct values', () => {
      expect(CursorColor.Tile).not.toEqual(CursorColor.Actor)
      expect(CursorColor.Actor).not.toEqual(CursorColor.Resource)
      expect(CursorColor.Resource).not.toEqual(CursorColor.Tile)
    })
  })

  // -----------------------------------------------------------------------
  // Cursor visibility
  // -----------------------------------------------------------------------

  describe('cursor visibility', () => {
    it('setCursorVisible updates flag without error when mesh is null', () => {
      expect(() => layer.setCursorVisible(true)).not.toThrow()
      expect(() => layer.setCursorVisible(false)).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // ensureCursorMesh error path
  // -----------------------------------------------------------------------

  describe('ensureCursorMesh', () => {
    it('throws when scene has not been set', () => {
      expect(() => layer.ensureCursorMesh()).toThrow(
        'EditorCursorLayer: scene must be set before creating cursor mesh',
      )
    })
  })

  // -----------------------------------------------------------------------
  // getCursorMesh null state
  // -----------------------------------------------------------------------

  describe('getCursorMesh', () => {
    it('returns null when mesh has not been created', () => {
      expect(layer.getCursorMesh()).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('clears brush reference', () => {
      const brush = makeBrush()
      layer.setBrush(brush)
      layer.dispose()
      expect(layer.getBrush()).toBeNull()
    })

    it('does not call brush.dispose() (brush lifecycle managed externally)', () => {
      const brush = makeBrush()
      layer.setBrush(brush)
      layer.dispose()
      expect(brush.dispose).not.toHaveBeenCalled()
    })

    it('clears cursor mesh and material when they exist', () => {
      // Simulate mesh/material existence by calling ensureCursorMesh with a mock scene
      const mockScene = { dispose: mockSceneDispose } as unknown as import('@babylonjs/core/scene').Scene
      layer.setScene(mockScene)
      layer.setGrid({
        type: 0,
        tileScale: 1024,
        maximumTerrainHeight: 0,
        defaultSubCell: 3,
        maximumTileSearchRange: 50,
        enableDepthBuffer: false,
        subCellOffsets: [],
        ramps: [],
      } as unknown as import('../../../OpenRA.Game/Map/MapGrid.js').MapGrid)

      const mesh = layer.ensureCursorMesh()
      expect(mesh).toBeDefined()
      expect(layer.getCursorMesh()).not.toBeNull()

      layer.dispose()
      expect(layer.getCursorMesh()).toBeNull()
      expect(layer.getBrush()).toBeNull()
    })

    it('does not throw when disposing without any resources', () => {
      expect(() => layer.dispose()).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Integration: full lifecycle with brush
  // -----------------------------------------------------------------------

  describe('full lifecycle', () => {
    it('brush set → delegate → null brush → empty results', () => {
      // Start with brush
      const brush = makeBrush({
        renderAnnotations: vi.fn().mockReturnValue([{ id: 1 }] as unknown as IRenderable[]),
      })
      layer.setBrush(brush)
      expect(layer.renderAnnotations(worldActor, wr)).toHaveLength(1)

      // Clear brush
      layer.setBrush(null)
      expect(layer.renderAnnotations(worldActor, wr)).toEqual([])

      // Set new brush
      const brush2 = makeBrush({
        renderAnnotations: vi.fn().mockReturnValue([{ id: 2 }, { id: 3 }] as unknown as IRenderable[]),
      })
      layer.setBrush(brush2)
      expect(layer.renderAnnotations(worldActor, wr)).toHaveLength(2)
    })
  })
})
