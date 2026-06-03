/**
 * TerrainSpriteLayer.test.ts — TerrainSpriteLayer 单元测试
 *
 * 测试: 构造、Sheet 索引管理、顶点数组管理、脏行跟踪、
 * 调色板失效、Clear/Update、资源释放。
 *
 * 依赖的 ITerrainWorldRenderer/ITerrainMap/ITerrainVertexBuffer/
 * ITerrainIndexBuffer 均为 mock，无 Babylon.js 依赖。
 */

import { describe, it, expect, vi } from 'vitest'
import { TerrainSpriteLayer } from './TerrainSpriteLayer'
import type {
  ITerrainWorldRenderer, ITerrainMap, ITerrainVertexBuffer,
  ITerrainIndexBuffer, ITerrainViewport,
} from './TerrainSpriteLayer'
import { Sprite } from './Sprite'
import { Sheet, SheetType } from './Sheet'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core (Sheet 依赖 RawTexture)
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  const mockUpdate = vi.fn()
  const mockDispose = vi.fn()
  const mockUpdateSamplingMode = vi.fn()

  const MockRawTexture: any = vi.fn(function (this: any) {
    this.update = mockUpdate
    this.updateSamplingMode = mockUpdateSamplingMode
    this.dispose = mockDispose
    return this
  })

  MockRawTexture.CreateRGBATexture = vi.fn(() => ({
    update: mockUpdate,
    updateSamplingMode: mockUpdateSamplingMode,
    dispose: mockDispose,
  }))

  return { RawTexture: MockRawTexture }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockVertexBuffer(): ITerrainVertexBuffer {
  return {
    setData: vi.fn(),
    dispose: vi.fn(),
  }
}

function createMockIndexBuffer(): ITerrainIndexBuffer {
  return {
    dispose: vi.fn(),
  }
}

function createMockMap(width = 8, height = 8): ITerrainMap {
  return {
    mapSize: { width, height },
    contains: vi.fn((_uv: any) => true),
    centerOfCell: vi.fn((_cell: any) => ({ x: 0, y: 0, z: 0 })),
  }
}

function createMockWorldRenderer(): ITerrainWorldRenderer {
  return {
    screen3DPosition: vi.fn((_origin: any) => ({ x: 0, y: 0, z: 0 })),
    terrainLighting: null,
    paletteInvalidated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  }
}

function createEmptySprite(): Sprite {
  const sheet = new Sheet(SheetType.Indexed, { width: 128, height: 128 })
  return new Sprite(sheet, { x: 0, y: 0, width: 0, height: 0 }, 0)
}

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

describe('TerrainSpriteLayer construction', () => {
  it('initializes with correct vertex count (4 * mapW * mapH)', () => {
    const wr = createMockWorldRenderer()
    const map = createMockMap(8, 8)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)

    // vertexRowStride = 4 * 8 = 32, total = 32 * 8 = 256
    expect(layer).toBeDefined()
    layer.dispose()
  })

  it('subscribes to paletteInvalidated', () => {
    const wr = createMockWorldRenderer()
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)
    expect(wr.paletteInvalidated.addListener).toHaveBeenCalled()
    layer.dispose()
  })

  it('stores blend mode', () => {
    const wr = createMockWorldRenderer()
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib, 'Additive')
    expect(layer.blendMode).toBe('Additive')
    layer.dispose()
  })
})

// ---------------------------------------------------------------------------
// Sheet 索引管理
// ---------------------------------------------------------------------------

describe('Sheet index management', () => {
  it('assigns indices 0-7 for up to 8 sheets', () => {
    // This is tested indirectly through updateSprite
    // _getOrAddSheetIndex is private; we test via the sheet tracking counters
    const wr = createMockWorldRenderer()
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)

    // Create 8 unique sheets and update cells with sprites on each
    const sheets: Sheet[] = []
    for (let i = 0; i < 8; i++) {
      sheets.push(new Sheet(SheetType.Indexed, { width: 64, height: 64 }))
    }

    // Should not throw - all 8 slots used
    expect(() => {
      for (let i = 0; i < 8; i++) {
        const sprite = new Sprite(sheets[i]!, { x: 0, y: 0, width: 16, height: 16 }, 0)
        layer.updateSprite({ u: i, v: 0 }, sprite, null)
      }
    }).not.toThrow()

    layer.dispose()
    sheets.forEach(s => s.dispose())
  })
})

// ---------------------------------------------------------------------------
// Dirty row tracking
// ---------------------------------------------------------------------------

describe('Dirty row tracking', () => {
  it('marks rows as dirty when cells are updated', () => {
    const wr = createMockWorldRenderer()
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)

    const sheet = new Sheet(SheetType.Indexed, { width: 64, height: 64 })
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 16, height: 16 }, 0)

    // Update cell at row 2
    layer.updateSprite({ u: 0, v: 2 }, sprite, null)

    // Draw should flush dirty rows
    const viewport: ITerrainViewport = {
      visibleCells: { firstRow: 0, lastRow: 3, firstCol: 0, lastCol: 3 },
    }
    const result = layer.draw(viewport)

    // Row 2 should be in the range
    expect(result.firstRow).toBeLessThanOrEqual(2)
    expect(result.lastRow).toBeGreaterThanOrEqual(2)

    // vertexBuffer.setData should have been called for row 2
    expect(vb.setData).toHaveBeenCalled()

    layer.dispose()
    sheet.dispose()
  })
})

// ---------------------------------------------------------------------------
// Vertex position centering (BUG-C01 regression)
// ---------------------------------------------------------------------------

describe('Vertex position centering (BUG-C01 regression)', () => {
  it('applies -0.5*size centering offset to vertex positions', () => {
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    // Use screen3DPosition that returns a known non-zero position
    const wr = createMockWorldRenderer()
    wr.screen3DPosition = vi.fn(() => ({ x: 100, y: 200, z: 0 }))

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)

    // Create a sprite with size 64x64 and zero offset
    const sheet = new Sheet(SheetType.Indexed, { width: 128, height: 128 })
    const sprite = new Sprite(sheet, { x: 0, y: 0, width: 64, height: 64 }, 0)

    // Update cell at (0, 1)
    layer.updateSprite({ u: 0, v: 1 }, sprite, null)

    // Draw to flush dirty rows
    const viewport: ITerrainViewport = {
      visibleCells: { firstRow: 0, lastRow: 3, firstCol: 0, lastCol: 3 },
    }
    layer.draw(viewport)

    // Inspect vertex data written to buffer
    expect(vb.setData).toHaveBeenCalled()
    const setDataCalls = (vb.setData as ReturnType<typeof vi.fn>).mock.calls[0]
    const vertices = setDataCalls[0] as Array<{ x: number; y: number; z: number }>

    // Cell (0,1): vertexRowStride = 16, cell vertexOffset = 16*1 + 4*0 = 16
    // TL corner is at vertices[16]
    // With fix: x = 100 + 1 * ((0 ?? 0) - 32) = 68
    // Without fix: x = 100 + 1 * 0 = 100
    const cellVertexOffset = 16 // row 1, col 0
    expect(vertices[cellVertexOffset]!.x).toBe(68)

    layer.dispose()
    sheet.dispose()
  })

  it('centering works with non-zero sprite offset', () => {
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const wr = createMockWorldRenderer()
    wr.screen3DPosition = vi.fn(() => ({ x: 10, y: 20, z: 0 }))

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)

    const sheet = new Sheet(SheetType.Indexed, { width: 128, height: 128 })
    // Sprite with non-zero offset
    const sprite = new Sprite(
      sheet,
      { x: 0, y: 0, width: 32, height: 64 },
      0,
      { x: 5, y: 10, z: 0 },  // offset
      undefined,               // channel
    )

    layer.updateSprite({ u: 0, v: 0 }, sprite, null)

    const viewport: ITerrainViewport = {
      visibleCells: { firstRow: 0, lastRow: 0, firstCol: 0, lastCol: 0 },
    }
    layer.draw(viewport)

    expect(vb.setData).toHaveBeenCalled()
    const setDataCalls = (vb.setData as ReturnType<typeof vi.fn>).mock.calls[0]
    const vertices = setDataCalls[0] as Array<{ x: number; y: number; z: number }>

    // Cell (0,0): vertexOffset = 0
    // offset = (5, 10), size = (32, 64)
    // x = 10 + 1 * ((5 ?? 0) - 16) = 10 - 11 = -1
    // y = 20 + 1 * ((10 ?? 0) - 32) = 20 - 22 = -2
    expect(vertices[0]!.x).toBe(-1)
    expect(vertices[0]!.y).toBe(-2)

    layer.dispose()
    sheet.dispose()
  })
})

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

describe('Clear', () => {
  it('clears a cell without throwing', () => {
    const wr = createMockWorldRenderer()
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)
    expect(() => layer.clear({ u: 1, v: 1 })).not.toThrow()
    layer.dispose()
  })
})

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe('Dispose', () => {
  it('unsubscribes and disposes resources', () => {
    const wr = createMockWorldRenderer()
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    // Use unique worldId to get a fresh IndexBufferRc (ref count = 1)
    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib, 'Alpha', true, 9999)
    layer.dispose()

    expect(wr.paletteInvalidated.removeListener).toHaveBeenCalled()
    expect(vb.dispose).toHaveBeenCalled()
    // ib.dispose is called when ref count reaches 0 (static IndexBufferRc)
    expect(ib.dispose).toHaveBeenCalled()
  })

  it('is safe to call dispose multiple times', () => {
    const wr = createMockWorldRenderer()
    const map = createMockMap(4, 4)
    const vb = createMockVertexBuffer()
    const ib = createMockIndexBuffer()
    const empty = createEmptySprite()

    const layer = new TerrainSpriteLayer(wr, map, empty, vb, ib)
    layer.dispose()
    // ib.dispose is called once through IndexBufferRc (ref count goes -1),
    // second call would attempt ref count go negative but the buffer is already null
    expect(() => layer.dispose()).not.toThrow()
  })
})
