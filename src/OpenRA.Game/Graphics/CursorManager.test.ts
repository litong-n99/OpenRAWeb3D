/**
 * CursorManager.test.ts — CursorManager 单元测试
 *
 * 测试: 构造与光标加载、setCursor、Tick 动画、Lock/Unlock、
 * convertIndexedToBgra、dispose。
 *
 * @babylonjs/core 完全 mock（CursorManager → SheetBuilder → Sheet → RawTexture）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core (SheetBuilder → Sheet → RawTexture)
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
// Imports (after mock)
// ---------------------------------------------------------------------------

import { CursorManager, convertIndexedToBgra } from './CursorManager'
import type { CursorConfig } from './CursorManager'
import { ImmutablePalette } from './Palette'
import { PALETTE_SIZE } from './Palette'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestPalette(): ImmutablePalette {
  // Create a palette where each index maps to ARGB: (255, index, index, index)
  return ImmutablePalette.fromColors(
    new Array(PALETTE_SIZE).fill(0).map((_, i) => {
      return ((255 << 24) | (i << 16) | (i << 8) | i) >>> 0
    }),
  )
}

function createCursorConfig(
  name: string,
  frameCount = 1,
  indexed = false,
): CursorConfig {
  const frames = []
  for (let i = 0; i < frameCount; i++) {
    const data = indexed
      ? new Uint8Array([i % 256, (i + 1) % 256])
      : new Uint8Array([10, 20, 30, 255]) // BGRA pixel
    frames.push({
      type: (indexed ? 0 : 1) as 0 | 1, // Indexed8=0, Bgra32=1
      data,
      size: { width: 1, height: indexed ? 2 : 1 },
      offset: { x: 0, y: 0 },
    })
  }
  return {
    name,
    frames,
    palette: indexed ? createTestPalette() : null,
    hotspot: { x: 0, y: 0 },
  }
}

// ---------------------------------------------------------------------------
// 构造
// ---------------------------------------------------------------------------

describe('CursorManager construction', () => {
  it('creates with empty configs', () => {
    const cm = new CursorManager([], 256)
    expect(cm.sheetBuilder).toBeDefined()
    expect(cm.cursorNames).toEqual([])
    cm.dispose()
  })

  it('loads cursor configs and extracts names', () => {
    const configs = [
      createCursorConfig('default', 1),
      createCursorConfig('attack', 2),
    ]
    const cm = new CursorManager(configs, 256)
    expect(cm.cursorNames).toContain('default')
    expect(cm.cursorNames).toContain('attack')
    cm.dispose()
  })
})

// ---------------------------------------------------------------------------
// setCursor
// ---------------------------------------------------------------------------

describe('setCursor', () => {
  let cm: CursorManager

  beforeEach(() => {
    const configs = [
      createCursorConfig('default', 1),
      createCursorConfig('attack', 4),
    ]
    cm = new CursorManager(configs, 256)
  })

  it('sets active cursor by name', () => {
    cm.setCursor('default')
    expect(cm.currentCursorName).toBe('default')
  })

  it('hides cursor when null is passed', () => {
    cm.setCursor('default')
    expect(cm.currentCursorName).toBe('default')
    cm.setCursor(null)
    expect(cm.currentCursorName).toBeNull()
  })

  it('no-ops when setting same cursor', () => {
    cm.setCursor('default')
    cm.setCursor('default') // Should not throw or change state
    expect(cm.currentCursorName).toBe('default')
  })

  it('defaults to null for unknown cursor name', () => {
    cm.setCursor('nonexistent')
    expect(cm.currentCursorName).toBeNull()
  })

  afterEach(() => cm.dispose())
})

// ---------------------------------------------------------------------------
// Tick (animation)
// ---------------------------------------------------------------------------

describe('Tick animation', () => {
  let cm: CursorManager

  beforeEach(() => {
    const configs = [createCursorConfig('anim', 4)]
    cm = new CursorManager(configs, 256)
    cm.setCursor('anim')
  })

  it('ticks do not throw on single-frame cursor', () => {
    const singleConfig = [createCursorConfig('static', 1)]
    const cm2 = new CursorManager(singleConfig, 256)
    cm2.setCursor('static')
    expect(() => cm2.tick()).not.toThrow()
    cm2.dispose()
  })

  it('ticks do not throw on multi-frame cursor', () => {
    expect(() => cm.tick()).not.toThrow()
    expect(() => cm.tick()).not.toThrow()
  })

  it('does nothing when no cursor is set', () => {
    cm.setCursor(null)
    expect(() => cm.tick()).not.toThrow()
  })

  afterEach(() => cm.dispose())
})

// ---------------------------------------------------------------------------
// Lock / Unlock
// ---------------------------------------------------------------------------

describe('Lock and Unlock', () => {
  it('lock/unlock do not throw', () => {
    const cm = new CursorManager([], 256)
    expect(() => cm.lock({ x: 100, y: 200 })).not.toThrow()
    expect(() => cm.unlock()).not.toThrow()
    cm.dispose()
  })
})

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

describe('Render', () => {
  it('render does not throw when no cursor is set', () => {
    const cm = new CursorManager([], 256)
    expect(() => cm.render({ x: 50, y: 50 })).not.toThrow()
    cm.dispose()
  })

  it('render does not throw when cursor is set', () => {
    const configs = [createCursorConfig('default', 1)]
    const cm = new CursorManager(configs, 256)
    cm.setCursor('default')
    expect(() => cm.render({ x: 50, y: 50 })).not.toThrow()
    cm.dispose()
  })
})

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe('Dispose', () => {
  it('clears cursors and disposes sheetBuilder', () => {
    const configs = [createCursorConfig('test', 1)]
    const cm = new CursorManager(configs, 256)
    cm.dispose()

    expect(cm.cursorNames).toEqual([])
  })

  it('is idempotent', () => {
    const cm = new CursorManager([], 256)
    cm.dispose()
    expect(() => cm.dispose()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// convertIndexedToBgra
// ---------------------------------------------------------------------------

describe('convertIndexedToBgra', () => {
  it('converts indexed 8-bit data to BGRA using palette', () => {
    const palette = createTestPalette()
    // 2x2 indexed data: indices [10, 20, 30, 40]
    const frame = {
      type: 0 as const, // Indexed8
      data: new Uint8Array([10, 20, 30, 40]),
      size: { width: 2, height: 2 },
      offset: { x: 0, y: 0 },
    }

    const result = convertIndexedToBgra(frame, palette)

    // Should be 4 bytes per pixel × 2 × 2 = 16 bytes
    expect(result.length).toBe(16)

    // First pixel (index 10): R=10, G=10, B=10, A=255
    // Stored as BGRA uint32 LE: [B, G, R, A] = [10, 10, 10, 255]
    expect(result[0]).toBe(10)   // B
    expect(result[1]).toBe(10)   // G
    expect(result[2]).toBe(10)   // R
    expect(result[3]).toBe(255)  // A
  })

  it('returns empty array for zero-size frame', () => {
    const palette = createTestPalette()
    const frame = {
      type: 0 as const,
      data: new Uint8Array(0),
      size: { width: 0, height: 0 },
      offset: { x: 0, y: 0 },
    }

    const result = convertIndexedToBgra(frame, palette)
    expect(result.length).toBe(0)
  })

  it('throws for non-indexed frame type', () => {
    const palette = createTestPalette()
    const frame = {
      type: 1 as const, // Bgra32
      data: new Uint8Array(4),
      size: { width: 1, height: 1 },
      offset: { x: 0, y: 0 },
    }

    expect(() => convertIndexedToBgra(frame, palette)).toThrow(/indexed/)
  })
})
