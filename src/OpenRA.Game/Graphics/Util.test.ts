/**
 * Util.test.ts — Util 工具函数迁移单元测试
 *
 * 测试: createQuadIndices, premultiplyAlpha, SpriteFrameType,
 * fastCreateQuad, fastCreateQuadCorners, fastCopyIntoChannel
 */

import { describe, it, expect } from 'vitest'
import {
  createQuadIndices,
  premultiplyAlpha,
  SpriteFrameType,
  fastCreateQuad,
  fastCreateQuadCorners,
  fastCopyIntoChannel,
} from './Util'

// ---------------------------------------------------------------------------
// createQuadIndices
// ---------------------------------------------------------------------------

describe('createQuadIndices', () => {
  it('creates correct number of indices (6 per quad)', () => {
    expect(createQuadIndices(1).length).toBe(6)
    expect(createQuadIndices(10).length).toBe(60)
    expect(createQuadIndices(0).length).toBe(0)
  })

  it('first quad has vertex pattern [0,1,2,2,3,0]', () => {
    const indices = createQuadIndices(1)
    expect(indices[0]).toBe(0)
    expect(indices[1]).toBe(1)
    expect(indices[2]).toBe(2)
    expect(indices[3]).toBe(2)
    expect(indices[4]).toBe(3)
    expect(indices[5]).toBe(0)
  })

  it('second quad starts at base vertex 4', () => {
    const indices = createQuadIndices(2)
    // Second quad starts at indices[6], base vertex = 4
    expect(indices[6]).toBe(4)   // 0 + 4
    expect(indices[7]).toBe(5)   // 1 + 4
    expect(indices[8]).toBe(6)   // 2 + 4
    expect(indices[9]).toBe(6)   // 2 + 4
    expect(indices[10]).toBe(7)  // 3 + 4
    expect(indices[11]).toBe(4)  // 0 + 4
  })

  it('returns Uint32Array', () => {
    expect(createQuadIndices(4)).toBeInstanceOf(Uint32Array)
  })
})

// ---------------------------------------------------------------------------
// premultiplyAlpha
// ---------------------------------------------------------------------------

describe('premultiplyAlpha', () => {
  it('no change when alpha is 255 (fast path)', () => {
    const result = premultiplyAlpha(100, 150, 200, 255)
    expect(result).toEqual([100, 150, 200, 255])
  })

  it('multiplies RGB by alpha ratio', () => {
    const result = premultiplyAlpha(255, 0, 128, 128)
    // 128/255 ≈ 0.502
    expect(result[0]).toBe(Math.round(255 * 128 / 255)) // 128
    expect(result[1]).toBe(0)
    expect(result[2]).toBe(Math.round(128 * 128 / 255)) // ~64
    expect(result[3]).toBe(128)
  })

  it('fully transparent results in black', () => {
    const result = premultiplyAlpha(255, 255, 255, 0)
    expect(result).toEqual([0, 0, 0, 0])
  })

  it('returns tuple of 4 numbers', () => {
    const result = premultiplyAlpha(10, 20, 30, 200)
    expect(result).toHaveLength(4)
    expect(typeof result[0]).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// SpriteFrameType
// ---------------------------------------------------------------------------

describe('SpriteFrameType', () => {
  it('has all 5 frame types', () => {
    expect(SpriteFrameType.Indexed8).toBe(0)
    expect(SpriteFrameType.Bgra32).toBe(1)
    expect(SpriteFrameType.Bgr24).toBe(2)
    expect(SpriteFrameType.Rgba32).toBe(3)
    expect(SpriteFrameType.Rgb24).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// fastCreateQuadCorners
// ---------------------------------------------------------------------------

describe('fastCreateQuadCorners', () => {
  it('writes 4 vertices at the specified offset', () => {
    const vertices: any[] = new Array(10).fill(null).map(() => ({}))
    const sprite = {
      left: 0.1, right: 0.9, top: 0.1, bottom: 0.9, channel: 0,
    }
    const samplers = { x: 0, y: 0 }

    fastCreateQuadCorners(
      vertices,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      sprite as any,
      samplers,
      0,
      { x: 1, y: 1, z: 1 },
      1,
      0,
    )

    // 4 vertices written as nv, nv+1, nv+2, nv+3
    expect(vertices[0]).toBeDefined()
    expect(vertices[1]).toBeDefined()
    expect(vertices[2]).toBeDefined()
    expect(vertices[3]).toBeDefined()
    // Original nv+4 is untouched
    expect(vertices[4]).toEqual({})
  })

  it('sets correct UVs for each corner', () => {
    const vertices: any[] = new Array(4).fill(null).map(() => ({}))
    const sprite = {
      left: 0.0, right: 1.0, top: 0.0, bottom: 1.0, channel: 4 /* RGBA */,
    }
    const samplers = { x: 0, y: 0 }

    fastCreateQuadCorners(
      vertices,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      sprite as any,
      samplers,
      0,
      { x: 1, y: 1, z: 1 },
      1,
      0,
    )

    // TL: (left, top)
    expect(vertices[0].s).toBe(0.0)
    expect(vertices[0].t).toBe(0.0)
    // TR: (right, top)
    expect(vertices[1].s).toBe(1.0)
    expect(vertices[1].t).toBe(0.0)
    // BR: (right, bottom)
    expect(vertices[2].s).toBe(1.0)
    expect(vertices[2].t).toBe(1.0)
    // BL: (left, bottom)
    expect(vertices[3].s).toBe(0.0)
    expect(vertices[3].t).toBe(1.0)
  })

  it('encodes palette index in attribute bits 16-31', () => {
    const vertices: any[] = new Array(4).fill(null).map(() => ({}))
    const sprite = {
      left: 0, right: 1, top: 0, bottom: 1, channel: 0 /* Red */,
    }
    const samplers = { x: 0, y: 0 }

    fastCreateQuadCorners(
      vertices,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      sprite as any,
      samplers,
      42, // palette row 42
      { x: 1, y: 1, z: 1 },
      1,
      0,
    )

    // Palette row should be encoded in bits 16-31
    expect((vertices[0].c >>> 16) & 0xffff).toBe(42)
  })

  it('encodes sampler index in attribute bits 6-8', () => {
    const vertices: any[] = new Array(4).fill(null).map(() => ({}))
    const sprite = {
      left: 0, right: 1, top: 0, bottom: 1, channel: 0,
    }
    const samplers = { x: 5, y: 3 }

    fastCreateQuadCorners(
      vertices,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      sprite as any,
      samplers,
      0,
      { x: 1, y: 1, z: 1 },
      1,
      0,
    )

    // Sampler index in bits 6-8
    expect((vertices[0].c >>> 6) & 0x7).toBe(5)
  })

  it('applies tint and alpha to all vertices', () => {
    const vertices: any[] = new Array(4).fill(null).map(() => ({}))
    const sprite = {
      left: 0, right: 1, top: 0, bottom: 1, channel: 0,
    }
    const samplers = { x: 0, y: 0 }

    fastCreateQuadCorners(
      vertices,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
      sprite as any,
      samplers,
      0,
      { x: 0.5, y: 0.6, z: 0.7 }, // tint
      0.8, // alpha
      0,
    )

    for (let i = 0; i < 4; i++) {
      expect(vertices[i].r).toBe(0.5)
      expect(vertices[i].g).toBe(0.6)
      expect(vertices[i].b).toBe(0.7)
      expect(vertices[i].a).toBe(0.8)
    }
  })
})

// ---------------------------------------------------------------------------
// fastCreateQuad
// ---------------------------------------------------------------------------

describe('fastCreateQuad', () => {
  it('creates quad with no rotation (simple rectangle)', () => {
    const vertices: any[] = new Array(10).fill(null).map(() => ({}))
    const sprite = {
      left: 0, right: 1, top: 0, bottom: 1, channel: 0,
    }
    const samplers = { x: 0, y: 0 }

    fastCreateQuad(
      vertices,
      { x: 10, y: 20, z: 0 },
      sprite as any,
      samplers,
      0,
      0,
      { x: 5, y: 5, z: 0 },
      { x: 1, y: 1, z: 1 },
      1,
      0,
    )

    // With no rotation, TL at origin
    expect(vertices[0].x).toBe(10)
    expect(vertices[0].y).toBe(20)
    // TR at origin + size.X
    expect(vertices[1].x).toBe(15)
    expect(vertices[1].y).toBe(20)
  })

  it('creates quad with rotation', () => {
    const vertices: any[] = new Array(10).fill(null).map(() => ({}))
    const sprite = {
      left: 0, right: 1, top: 0, bottom: 1, channel: 0,
    }
    const samplers = { x: 0, y: 0 }

    // 90 degree rotation (PI/2)
    fastCreateQuad(
      vertices,
      { x: 10, y: 20, z: 0 },
      sprite as any,
      samplers,
      0,
      0,
      { x: 2, y: 2, z: 0 },
      { x: 1, y: 1, z: 1 },
      1,
      Math.PI / 2,
    )

    // With rotation, vertices should differ from unrotated positions
    expect(vertices[0].x).not.toBe(10)
  })
})

// ---------------------------------------------------------------------------
// fastCopyIntoChannel — RGBA/BGRA / Indexed
// ---------------------------------------------------------------------------

describe('fastCopyIntoChannel', () => {
  it('copies BGRA data into full RGBA dest rect', () => {
    // Create a 4x4 destination buffer (all zeros)
    const dest = new Uint8Array(4 * 4 * 4) // stride=4, height=4
    // Source: 2x2 BGRA pixels
    // Pixel 1: B=10, G=20, R=30, A=255
    // Pixel 2: B=40, G=50, R=60, A=128
    const src = new Uint8Array([
      10, 20, 30, 255,  // BGRA pixel 1 (top-left)
      40, 50, 60, 128,  // BGRA pixel 2 (top-right)
      70, 80, 90, 255,  // BGRA pixel 3 (bottom-left)
      100, 110, 120, 128, // BGRA pixel 4 (bottom-right)
    ])

    fastCopyIntoChannel(
      dest, 4, // stride=4
      0, 0,    // dest x=0, y=0
      2, 2,    // width=2, height=2
      src,
      SpriteFrameType.Bgra32,
      4 /* RGBA */,
      true, // premultiplied (skip alpha premultiply)
    )

    // Check first pixel: B=10 stays at [0], R=30 at [2] — stored as BGRA uint
    // Uint32 LE: [B, G, R, A] → bytes: B=10, G=20, R=30, A=255
    expect(dest[0]).toBe(10)   // B
    expect(dest[1]).toBe(20)   // G
    expect(dest[2]).toBe(30)   // R
    expect(dest[3]).toBe(255)  // A
  })

  it('copies Indexed data into single channel of dest', () => {
    const dest = new Uint8Array(4 * 4 * 4).fill(0xff)
    // Source: 2x2 indexed bytes
    const src = new Uint8Array([42, 43, 44, 45])

    fastCopyIntoChannel(
      dest, 4,  // stride=4
      0, 0,     // x=0, y=0
      2, 2,     // width=2, height=2
      src,
      SpriteFrameType.Indexed8,
      0 /* Red channel */,  // CHANNEL_MASKS[0] = 2 (byte 2 = R channel)
      false,
    )

    // For channel=0 (Red), CHANNEL_MASKS[0] = 2
    // dest offset = stride*4 * y + x*4 + 2 = 0*4*4 + 0*4 + 2 = 2
    // Every 4 bytes, read src byte into dest[offset], offset += 4
    expect(dest[2]).toBe(42)   // First pixel's R channel
    expect(dest[6]).toBe(43)   // Second pixel's R channel
    // Next row: dest offset = stride*4 * 1 + 0*4 + 2 = 18
    expect(dest[18]).toBe(44)  // Third pixel's R channel
    expect(dest[22]).toBe(45)  // Fourth pixel's R channel
  })

  it('premultiplies alpha when premultiplied=false for BGRA fast path', () => {
    const dest = new Uint8Array(4 * 2 * 2) // 2x2 RGBA
    // Source: one BGRA pixel with alpha=128
    const src = new Uint8Array([100, 0, 0, 128]) // B=100, G=0, R=0, A=128

    fastCopyIntoChannel(
      dest, 2,    // stride=2
      0, 0,       // x=0, y=0
      1, 1,       // 1x1 copy
      src,
      SpriteFrameType.Bgra32,
      4 /* RGBA */,
      false, // NOT premultiplied → needs premultiply
    )

    // After premultiply: R=0*128/255≈0, B=100*128/255≈50
    // Stored as BGRA (dest uint): [B, G, R, A]
    const b = dest[0]
    expect(b).toBeGreaterThan(0)    // B was premultiplied
    expect(b).toBeLessThan(100)     // Should be ~50
  })

  // -----------------------------------------------------------------------
  // 慢速路径: Bgr24, Rgba32, Rgb24
  // -----------------------------------------------------------------------

  it('copies Bgr24 data (3 bytes/pixel, no alpha) into RGBA dest', () => {
    // Bgr24 is 3 bytes per pixel: B, G, R (no alpha byte)
    const dest = new Uint8Array(4 * 2 * 2) // 2x2 RGBA
    const src = new Uint8Array([
      10, 20, 30,  // BGR pixel 1
      40, 50, 60,  // BGR pixel 2
      70, 80, 90,  // BGR pixel 3
      100, 110, 120, // BGR pixel 4
    ])

    fastCopyIntoChannel(
      dest, 2,    // stride=2
      0, 0,       // x=0, y=0
      2, 2,       // 2x2 copy
      src,
      SpriteFrameType.Bgr24,
      4 /* RGBA */,
      true, // premultiplied (no-op for alpha=255)
    )

    // Bgr24 → stored as BGRA uint: [B, G, R, A=255]
    // dest Uint32 LE: bytes [B, G, R, A]
    expect(dest[0]).toBe(10)   // B (was src[0])
    expect(dest[1]).toBe(20)   // G (was src[1])
    expect(dest[2]).toBe(30)   // R (was src[2])
    expect(dest[3]).toBe(255)  // A=255 (implicit, no alpha in source)
  })

  it('copies Rgba32 data (RGBA byte order) into BGRA dest', () => {
    // Rgba32 is 4 bytes per pixel: R, G, B, A (PNG byte order)
    const dest = new Uint8Array(4 * 2 * 1) // 2x1 RGBA
    const src = new Uint8Array([
      30, 20, 10, 255,  // RGBA pixel 1: R=30, G=20, B=10, A=255
      60, 50, 40, 128,  // RGBA pixel 2: R=60, G=50, B=40, A=128
    ])

    fastCopyIntoChannel(
      dest, 2,    // stride=2
      0, 0,       // x=0, y=0
      2, 1,       // 2x1 copy
      src,
      SpriteFrameType.Rgba32,
      4 /* RGBA */,
      true, // premultiplied
    )

    // Rgba32 → stored as BGRA uint: bytes [B, G, R, A]
    expect(dest[0]).toBe(10)   // B (was src[2])
    expect(dest[1]).toBe(20)   // G (was src[1])
    expect(dest[2]).toBe(30)   // R (was src[0])
    expect(dest[3]).toBe(255)  // A (was src[3])
  })

  it('copies Rgb24 data (RGB byte order, no alpha) into BGRA dest', () => {
    // Rgb24 is 3 bytes per pixel: R, G, B (no alpha byte)
    const dest = new Uint8Array(4 * 2 * 2) // 2x2 RGBA
    const src = new Uint8Array([
      30, 20, 10,  // RGB pixel 1
      60, 50, 40,  // RGB pixel 2
      90, 80, 70,  // RGB pixel 3
      120, 110, 100, // RGB pixel 4
    ])

    fastCopyIntoChannel(
      dest, 2,    // stride=2
      0, 0,       // x=0, y=0
      2, 2,       // 2x2 copy
      src,
      SpriteFrameType.Rgb24,
      4 /* RGBA */,
      true,
    )

    // Rgb24 → stored as BGRA uint: bytes [B, G, R, A=255]
    expect(dest[0]).toBe(10)   // B (was src[2])
    expect(dest[1]).toBe(20)   // G (was src[1])
    expect(dest[2]).toBe(30)   // R (was src[0])
    expect(dest[3]).toBe(255)  // A=255 (implicit)
  })

  it('Rgba32 slow path premultiplies alpha when premultiplied=false', () => {
    const dest = new Uint8Array(4 * 1 * 1)
    // Rgba32: R=100, G=0, B=0, A=128
    const src = new Uint8Array([100, 0, 0, 128])

    fastCopyIntoChannel(
      dest, 1,    // stride=1
      0, 0,       // x=0, y=0
      1, 1,       // 1x1
      src,
      SpriteFrameType.Rgba32,
      4 /* RGBA */,
      false, // NOT premultiplied
    )

    // After premultiply: R=100*128/255≈50, B=0*128/255=0 → stored as BGRA: [B≈0, G=0, R≈50, A=128]
    expect(dest[0]).toBe(0)            // B (premultiplied: 0)
    expect(dest[1]).toBe(0)            // G (premultiplied: 0)
    expect(dest[2]).toBeGreaterThan(0) // R (premultiplied: ~50)
    expect(dest[2]).toBeLessThan(100)
    expect(dest[3]).toBe(128)          // A unchanged
  })

  it('throws for unknown SpriteFrameType', () => {
    const dest = new Uint8Array(16)
    const src = new Uint8Array([1, 2, 3])

    expect(() => {
      fastCopyIntoChannel(
        dest, 2, 0, 0, 1, 1, src,
        99 as any, // Invalid type
        4, false,
      )
    }).toThrow(/Unknown SpriteFrameType/)
  })
})
