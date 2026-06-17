/**
 * SpriteLoader.test.ts — ISpriteFrame/ISpriteLoader interface tests
 *
 * Tests focus on: interface contract compliance, type definitions.
 */

import { describe, it, expect } from 'vitest'
import {
  type ISpriteFrame,
  type ISpriteLoader,
  type Size,
  type Float2,
  SpriteFrameType,
} from './SpriteLoader.js'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpriteFrameType', () => {
  it('defines Indexed8 and Bgra32 constants', () => {
    expect(SpriteFrameType.Indexed8).toBe(0)
    expect(SpriteFrameType.Bgra32).toBe(1)
  })
})

describe('ISpriteFrame (structural conformance)', () => {
  class TestFrame implements ISpriteFrame {
    readonly type = SpriteFrameType.Indexed8
    readonly size: Size = { width: 32, height: 32 }
    readonly frameSize: Size = { width: 64, height: 64 }
    readonly offset: Float2 = { x: 0, y: 0 }
    readonly data: Uint8Array = new Uint8Array(1024)
    readonly disableExportPadding = false
  }

  it('creates a valid ISpriteFrame implementation', () => {
    const frame = new TestFrame()
    expect(frame.type).toBe(SpriteFrameType.Indexed8)
    expect(frame.size.width).toBe(32)
    expect(frame.size.height).toBe(32)
    expect(frame.frameSize.width).toBe(64)
    expect(frame.frameSize.height).toBe(64)
    expect(frame.offset.x).toBe(0)
    expect(frame.offset.y).toBe(0)
    expect(frame.data.length).toBe(1024)
    expect(frame.disableExportPadding).toBe(false)
  })

  it('supports Bgra32 frame type', () => {
    class BgraFrame implements ISpriteFrame {
      readonly type = SpriteFrameType.Bgra32
      readonly size: Size = { width: 16, height: 16 }
      readonly frameSize: Size = { width: 16, height: 16 }
      readonly offset: Float2 = { x: 0, y: 0 }
      readonly data: Uint8Array = new Uint8Array(1024)
      readonly disableExportPadding = true
    }
    const frame = new BgraFrame()
    expect(frame.type).toBe(SpriteFrameType.Bgra32)
    expect(frame.disableExportPadding).toBe(true)
  })

  it('supports non-zero offset', () => {
    class OffsetFrame implements ISpriteFrame {
      readonly type = SpriteFrameType.Indexed8
      readonly size: Size = { width: 20, height: 20 }
      readonly frameSize: Size = { width: 32, height: 32 }
      readonly offset: Float2 = { x: -6, y: -6 }
      readonly data: Uint8Array = new Uint8Array(400)
      readonly disableExportPadding = false
    }
    const frame = new OffsetFrame()
    expect(frame.offset.x).toBe(-6)
    expect(frame.offset.y).toBe(-6)
    expect(frame.size.width).toBe(20)
    expect(frame.frameSize.width).toBe(32)
  })
})

describe('ISpriteLoader (structural conformance)', () => {
  class TestLoader implements ISpriteLoader {
    tryParseSprite(
      _data: Uint8Array,
      _filename: string,
    ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null {
      return { frames: [], metadata: null }
    }
  }

  it('returns null for unsupported format', () => {
    class NullLoader implements ISpriteLoader {
      tryParseSprite(
        _data: Uint8Array,
        _filename: string,
      ): null {
        return null
      }
    }
    const result = new NullLoader().tryParseSprite(new Uint8Array(4), 'test.bin')
    expect(result).toBeNull()
  })

  it('returns frames for supported format', () => {
    const loader = new TestLoader()
    const result = loader.tryParseSprite(new Uint8Array(4), 'test.sprite')
    expect(result).not.toBeNull()
    expect(result!.frames).toEqual([])
    expect(result!.metadata).toBeNull()
  })

  it('can return frames with metadata', () => {
    class MetaLoader implements ISpriteLoader {
      tryParseSprite(
        _data: Uint8Array,
        _filename: string,
      ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } {
        return { frames: [], metadata: { version: 2 } }
      }
    }
    const result = new MetaLoader().tryParseSprite(new Uint8Array(4), 'test.sprite')
    expect(result!.metadata).toEqual({ version: 2 })
  })
})
