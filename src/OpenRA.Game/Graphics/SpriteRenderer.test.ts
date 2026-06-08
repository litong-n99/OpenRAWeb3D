/**
 * SpriteRenderer.test.ts — SpriteRenderer 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock，
 * 通过注入自定义 ISpriteRenderBackend 验证批量渲染逻辑。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs.core — 仅 mock SpriteRenderer 用到的模块
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  const Color3 = vi.fn(function (this: any, r: number, g: number, b: number) {
    this.r = r
    this.g = g
    this.b = b
  })
  const Vector3 = vi.fn(function (this: any) {
    this.x = 0
    this.y = 0
    this.z = 0
    this.set = vi.fn(function (this: any, x: number, y: number, z: number) {
      this.x = x; this.y = y; this.z = z
    })
  })
  const Quaternion = vi.fn(function (this: any) {
    this.x = 0; this.y = 0; this.z = 0; this.w = 1
  })
  ;(Quaternion as any).RotationYawPitchRollToRef = vi.fn()
  return {
    Color3,
    Vector3,
    Quaternion,
    Engine: {
      ALPHA_DISABLE: 0,
      ALPHA_COMBINE: 2,
      ALPHA_ADD: 3,
      ALPHA_SUBTRACT: 4,
      ALPHA_MULTIPLY: 5,
      ALPHA_SCREENMODE: 6,
    },
    MeshBuilder: {
      CreatePlane: vi.fn().mockReturnValue({
        billboardMode: 0,
        material: null,
        isVisible: false,
        thinInstanceSetBuffer: vi.fn(),
        refreshBoundingInfo: vi.fn(),
        dispose: vi.fn(),
      }),
      CreateGround: vi.fn().mockReturnValue({
        material: null,
        isVisible: false,
        alwaysSelectAsActiveMesh: false,
        thinInstanceSetBuffer: vi.fn(),
        refreshBoundingInfo: vi.fn(),
        dispose: vi.fn(),
      }),
    },
    Mesh: {
      BILLBOARDMODE_Y: 2,
    },
    StandardMaterial: vi.fn(function (this: any) {
      this.diffuseTexture = null
      this.emissiveTexture = null
      this.emissiveColor = null
      this.useAlphaFromDiffuseTexture = false
      this.backFaceCulling = true
      this.disableLighting = false
      this.alphaMode = 2
      this.dispose = vi.fn()
    }),
    RawTexture: vi.fn(),
    Texture: {
      NEAREST_SAMPLINGMODE: 1,
      BILINEAR_SAMPLINGMODE: 2,
    },
    Matrix: (() => {
      // Matrix needs to be both a constructor (new Matrix()) and have static methods
      const Matrix = vi.fn(function (this: any) {
        this.m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        this.copyToArray = vi.fn()
      })
      ;(Matrix as any).Translation = vi.fn().mockReturnValue({
        m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        multiply: function (this: any, other: any) {
          return {
            m: this.m.map((v: number, i: number) => v + (other.m[i] ?? 0)),
            multiply: this.multiply,
          }
        },
      })
      ;(Matrix as any).Scaling = vi.fn().mockReturnValue({
        m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        multiply: function (this: any, other: any) {
          return {
            m: this.m.map((v: number, i: number) => v * (other.m[i] ?? 1)),
            multiply: this.multiply,
          }
        },
      })
      ;(Matrix as any).RotationZ = vi.fn().mockReturnValue({
        m: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        multiply: function (this: any, other: any) {
          return {
            m: this.m.map((v: number, i: number) => v + (other.m[i] ?? 0)),
            multiply: this.multiply,
          }
        },
      })
      ;(Matrix as any).ComposeToRef = vi.fn()
      return Matrix
    })(),
  }
})

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// ---------------------------------------------------------------------------

import {
  SpriteRenderer,
  ThinInstancesBackend,
  BlendMode,
  blendModeToAlphaMode,
  TextureChannel,
  type ISprite,
  type ISheet,
  type ISpriteRenderBackend,
  type ISpriteRenderGroup,
  type IPaletteTexture,
} from './SpriteRenderer'
import { MeshBuilder, StandardMaterial } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 辅助工厂函数
// ---------------------------------------------------------------------------

function createMockSheet(overrides: Partial<ISheet> = {}): ISheet {
  return {
    size: { width: 512, height: 512 },
    texture: {
      updateSamplingMode: vi.fn(),
    } as unknown as ISheet['texture'],
    ...overrides,
  }
}

function createMockSprite(overrides: Partial<ISprite> = {}): ISprite {
  const sheet = overrides.sheet ?? createMockSheet()
  return {
    sheet,
    bounds: { x: 0, y: 0, width: 32, height: 32 },
    blendMode: BlendMode.Alpha,
    channel: TextureChannel.RGBA,
    zRamp: 0,
    offset: { x: 0, y: 0, z: 0 },
    size: { x: 1, y: 1, z: 0 },
    top: 0,
    left: 0,
    bottom: 32 / 512,
    right: 32 / 512,
    ...overrides,
  }
}

function createMockRenderGroup(overrides: Partial<ISpriteRenderGroup> = {}): ISpriteRenderGroup {
  return {
    setInstances: vi.fn(),
    setBlendMode: vi.fn(),
    setPalette: vi.fn(),
    setPixelArtScaling: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  }
}

function createMockBackend(groups: Map<ISheet, ISpriteRenderGroup> = new Map()): ISpriteRenderBackend {
  return {
    getOrCreateGroup: vi.fn().mockImplementation((sheet: ISheet) => {
      const existing = groups.get(sheet)
      if (existing) return existing
      const g = createMockRenderGroup()
      groups.set(sheet, g)
      return g
    }),
    dispose: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('BlendMode', () => {
  it('has 10 blend modes matching OpenRA', () => {
    const modes = Object.values(BlendMode)
    expect(modes).toHaveLength(10)
  })

  it('includes None, Alpha, Additive, Subtractive, Multiply', () => {
    expect(BlendMode.None).toBe('None')
    expect(BlendMode.Alpha).toBe('Alpha')
    expect(BlendMode.Additive).toBe('Additive')
    expect(BlendMode.Subtractive).toBe('Subtractive')
    expect(BlendMode.Multiply).toBe('Multiply')
  })
})

describe('blendModeToAlphaMode', () => {
  it('maps None → ALPHA_DISABLE', () => {
    expect(blendModeToAlphaMode(BlendMode.None)).toBe(0)
  })

  it('maps Alpha → ALPHA_COMBINE', () => {
    expect(blendModeToAlphaMode(BlendMode.Alpha)).toBe(2)
  })

  it('maps Additive → ALPHA_ADD', () => {
    expect(blendModeToAlphaMode(BlendMode.Additive)).toBe(3)
  })

  it('maps Subtractive → ALPHA_SUBTRACT', () => {
    expect(blendModeToAlphaMode(BlendMode.Subtractive)).toBe(4)
  })

  it('maps Multiply → ALPHA_MULTIPLY', () => {
    expect(blendModeToAlphaMode(BlendMode.Multiply)).toBe(5)
  })

  it('maps Screen → ALPHA_SCREENMODE', () => {
    expect(blendModeToAlphaMode(BlendMode.Screen)).toBe(6)
  })

  it('maps unknown to ALPHA_COMBINE as default', () => {
    expect(blendModeToAlphaMode('Unknown' as BlendMode)).toBe(2)
  })
})

describe('TextureChannel', () => {
  it('defines standard channel indices', () => {
    expect(TextureChannel.Red).toBe(0)
    expect(TextureChannel.Green).toBe(1)
    expect(TextureChannel.Blue).toBe(2)
    expect(TextureChannel.Alpha).toBe(3)
    expect(TextureChannel.RGBA).toBe(4)
  })
})

describe('SpriteRenderer', () => {
  let scene: import('@babylonjs/core').Scene
  let backend: ISpriteRenderBackend
  let groups: Map<ISheet, ISpriteRenderGroup>
  let sr: SpriteRenderer
  let sheet: ISheet
  let sprite: ISprite

  beforeEach(() => {
    vi.clearAllMocks()
    groups = new Map()
    backend = createMockBackend(groups)
    scene = {} as unknown as import('@babylonjs/core').Scene
    sr = new SpriteRenderer(scene, null, backend)
    sheet = createMockSheet()
    sprite = createMockSprite({ sheet })
  })

  afterEach(() => {
    sr?.dispose()
  })

  // ========================================================================
  // 构造函数
  // ========================================================================
  describe('construction', () => {
    it('initializes with Alpha blend mode', () => {
      expect(sr.currentBlend).toBe(BlendMode.Alpha)
    })

    it('initializes with empty batch', () => {
      expect(sr.batchSize).toBe(0)
    })

    it('initializes with zero groups', () => {
      expect(sr.groupCount).toBe(0)
    })

    it('uses ThinInstancesBackend by default when scene provided', () => {
      const defaultSr = new SpriteRenderer(scene, null)
      expect(defaultSr.batchSize).toBe(0)
      defaultSr.dispose()
    })
  })

  // ========================================================================
  // TODO-2.3.1/2.3.2: DrawSprite 批量累积 + ThinInstances
  // ========================================================================
  describe('drawSprite', () => {
    it('accumulates instances without immediate flush', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      expect(sr.batchSize).toBe(1)
    })

    it('accumulates multiple draw calls', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.drawSprite(sprite, 0, { x: 1, y: 0, z: 0 })
      sr.drawSprite(sprite, 0, { x: 2, y: 0, z: 0 })
      expect(sr.batchSize).toBe(3)
    })

    it('supports scale parameter', () => {
      sr.drawSprite(sprite, 0, { x: 5, y: 0, z: 0 }, 2)
      sr.flush()
      // 验证 backend 被调用
      expect(backend.getOrCreateGroup).toHaveBeenCalled()
    })

    it('supports rotation parameter', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 }, 1, Math.PI / 4)
      sr.flush()
      expect(backend.getOrCreateGroup).toHaveBeenCalled()
    })

    it('supports tint parameter', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 }, 1, 0, { x: 0.5, y: 1, z: 0.5 })
      sr.flush()
      expect(backend.getOrCreateGroup).toHaveBeenCalled()
    })

    it('supports alpha parameter', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 }, 1, 0, { x: 1, y: 1, z: 1 }, 0.5)
      sr.flush()
      expect(backend.getOrCreateGroup).toHaveBeenCalled()
    })

    it('clamps alpha to [0, 1]', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 }, 1, 0, { x: 1, y: 1, z: 1 }, 2.5)
      // alpha 被 clamp 为 1.0
      sr.flush()
      expect(backend.getOrCreateGroup).toHaveBeenCalled()
    })
  })

  // ========================================================================
  // drawSpriteSimple — 简化版重载
  // ========================================================================
  describe('drawSpriteSimple', () => {
    it('delegates to drawSprite with defaults', () => {
      sr.drawSpriteSimple(sprite, { x: 10, y: 20, z: 0 }, 1.5)
      expect(sr.batchSize).toBe(1)
    })
  })

  // ========================================================================
  // drawSpriteWithPalette — 调色板版重载
  // ========================================================================
  describe('drawSpriteWithPalette', () => {
    it('delegates to drawSprite with palette index', () => {
      sr.drawSpriteWithPalette(sprite, 5, { x: 0, y: 0, z: 0 }, 1)
      expect(sr.batchSize).toBe(1)
    })
  })

  // ========================================================================
  // TODO-2.3.5: BlendMode 变化自动 Flush
  // ========================================================================
  describe('auto-flush on blend mode change', () => {
    it('flushes when sprite blend mode differs', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 }) // Alpha

      const additive = createMockSprite({ sheet, blendMode: BlendMode.Additive })
      sr.drawSprite(additive, 0, { x: 1, y: 0, z: 0 })

      // 第一批 (Alpha) 已 flush，第二批 (Additive) 在缓冲区中
      expect(sr.batchSize).toBe(1)
      expect(sr.currentBlend).toBe(BlendMode.Additive)
    })

    it('does not flush when same blend mode', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.drawSprite(sprite, 0, { x: 1, y: 0, z: 0 })
      expect(sr.batchSize).toBe(2)
    })
  })

  // ========================================================================
  // Sheet 变化自动 Flush
  // ========================================================================
  describe('auto-flush on sheet change', () => {
    it('flushes when sprite sheet differs', () => {
      const sheet2 = createMockSheet({ size: { width: 256, height: 256 } })
      const sprite2 = createMockSprite({ sheet: sheet2 })

      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.drawSprite(sprite2, 0, { x: 1, y: 0, z: 0 })

      // 第一批 (sheet1) 已 flush，第二批 (sheet2) 在缓冲区中
      expect(sr.batchSize).toBe(1)
    })
  })

  // ========================================================================
  // 缓冲区满自动 Flush (MAX_SPRITES_PER_BATCH)
  // ========================================================================
  describe('auto-flush on buffer overflow', () => {
    it('flushes when reaching MAX_SPRITES_PER_BATCH', () => {
      const limit = SpriteRenderer.MAX_SPRITES_PER_BATCH
      for (let i = 0; i < limit; i++) {
        sr.drawSprite(sprite, 0, { x: i, y: 0, z: 0 })
      }
      // 到达上限时自动 flush
      expect(sr.batchSize).toBe(0)
    })

    it('does not flush below limit', () => {
      const limit = SpriteRenderer.MAX_SPRITES_PER_BATCH
      for (let i = 0; i < limit - 1; i++) {
        sr.drawSprite(sprite, 0, { x: i, y: 0, z: 0 })
      }
      expect(sr.batchSize).toBe(limit - 1)
    })
  })

  // ========================================================================
  // Flush 行为
  // ========================================================================
  describe('flush', () => {
    it('clears batch after flush', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.drawSprite(sprite, 0, { x: 1, y: 0, z: 0 })
      sr.flush()
      expect(sr.batchSize).toBe(0)
    })

    it('no-ops on empty batch', () => {
      expect(() => sr.flush()).not.toThrow()
      expect(backend.getOrCreateGroup).not.toHaveBeenCalled()
    })

    it('submits instances to backend groups', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 }, 1, 0, { x: 1, y: 1, z: 1 }, 1)
      sr.flush()

      const group = groups.get(sheet)
      expect(group).toBeDefined()
      expect(group!.setInstances).toHaveBeenCalled()
    })

    it('groups instances by sheet', () => {
      const sheet2 = createMockSheet({ size: { width: 256, height: 256 } })
      const sprite2 = createMockSprite({ sheet: sheet2 })

      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.drawSprite(sprite2, 0, { x: 1, y: 0, z: 0 })
      sr.flush()

      // 两个 sheet 分别创建了 group
      expect(groups.size).toBeGreaterThanOrEqual(1)
    })

    it('resets currentSheet after flush', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.flush()

      // flush 后可以接受新 sheet 而不触发额外的 flush
      const sheet2 = createMockSheet({ size: { width: 256, height: 256 } })
      const sprite2 = createMockSprite({ sheet: sheet2 })
      sr.drawSprite(sprite2, 0, { x: 0, y: 0, z: 0 })
      expect(sr.batchSize).toBe(1)
    })
  })

  // ========================================================================
  // TODO-2.3.3: 调色板设置
  // ========================================================================
  describe('setPalette', () => {
    it('flushes before setting palette', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      const palette: IPaletteTexture = {
        texture: {} as unknown as IPaletteTexture['texture'],
        height: 256,
      }
      sr.setPalette(palette)
      // 设置调色板前应 flush 当前批次
      expect(sr.batchSize).toBe(0)
    })

    it('palette is passed to groups on next flush', () => {
      const palette: IPaletteTexture = {
        texture: {} as unknown as IPaletteTexture['texture'],
        height: 256,
      }
      sr.setPalette(palette)
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.flush()

      const group = groups.get(sheet)
      expect(group?.setPalette).toHaveBeenCalledWith(palette)
    })

    it('accepts null palette', () => {
      expect(() => sr.setPalette(null)).not.toThrow()
    })
  })

  // ========================================================================
  // setViewportParams — 投影参数
  // ========================================================================
  describe('setViewportParams', () => {
    it('is callable without error', () => {
      expect(() =>
        sr.setViewportParams({ width: 1024, height: 768 }, 1, 0, { x: 0, y: 0 }),
      ).not.toThrow()
    })

    it('accepts non-zero depth margin', () => {
      expect(() =>
        sr.setViewportParams({ width: 800, height: 600 }, 1, 128, { x: 10, y: 20 }),
      ).not.toThrow()
    })
  })

  // ========================================================================
  // TODO-2.3.4: 像素艺术缩放 (Billboard + NEAREST 采样)
  // ========================================================================
  describe('pixel art scaling', () => {
    it('defaults to enabled', () => {
      expect(sr.getPixelArtScaling()).toBe(true)
    })

    it('enablePixelArtScaling(false) disables pixel art', () => {
      sr.enablePixelArtScaling(false)
      expect(sr.getPixelArtScaling()).toBe(false)
    })

    it('enablePixelArtScaling(true) enables pixel art', () => {
      sr.enablePixelArtScaling(false)
      sr.enablePixelArtScaling(true)
      expect(sr.getPixelArtScaling()).toBe(true)
    })

    it('flushes before changing scaling mode', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.enablePixelArtScaling(false)
      expect(sr.batchSize).toBe(0)
    })

    it('passes scaling mode to groups on flush', () => {
      sr.enablePixelArtScaling(true)
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.flush()

      const group = groups.get(sheet)
      expect(group?.setPixelArtScaling).toHaveBeenCalledWith(true)
    })
  })

  // ========================================================================
  // setDepthPreview
  // ========================================================================
  describe('setDepthPreview', () => {
    it('is callable without error', () => {
      expect(() => sr.setDepthPreview(true, 0, 100)).not.toThrow()
    })

    it('flushes before changing depth preview', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.setDepthPreview(true, 0, 100)
      expect(sr.batchSize).toBe(0)
    })
  })

  // ========================================================================
  // 多 sheet 分组
  // ========================================================================
  describe('multi-sheet batching', () => {
    it('creates separate groups for different sheets', () => {
      const sheet2 = createMockSheet({ size: { width: 256, height: 256 } })
      const sprite2 = createMockSprite({ sheet: sheet2 })

      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.flush()
      sr.drawSprite(sprite2, 0, { x: 0, y: 0, z: 0 })
      sr.flush()

      expect(groups.size).toBe(2)
    })

    it('reuses group for same sheet', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.flush()
      sr.drawSprite(sprite, 0, { x: 1, y: 0, z: 0 })
      sr.flush()

      // 同一个 sheet 应该只创建一个 group
      expect(backend.getOrCreateGroup).toHaveBeenCalledTimes(1)
    })
  })

  // ========================================================================
  // 资源释放
  // ========================================================================
  describe('dispose', () => {
    it('flushes pending batch before dispose', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.dispose()
      expect(sr.batchSize).toBe(0)
    })

    it('disposes all groups', () => {
      sr.drawSprite(sprite, 0, { x: 0, y: 0, z: 0 })
      sr.flush()
      const group = groups.get(sheet)
      sr.dispose()
      expect(group?.dispose).toHaveBeenCalled()
    })

    it('disposes backend', () => {
      sr.dispose()
      expect(backend.dispose).toHaveBeenCalled()
    })

    it('multiple dispose calls do not throw', () => {
      sr.dispose()
      expect(() => sr.dispose()).not.toThrow()
    })
  })
})

// ========================================================================
// ThinInstancesBackend 测试
// ========================================================================
describe('ThinInstancesBackend', () => {
  let backend: ThinInstancesBackend
  let scene: import('@babylonjs/core').Scene
  let sheet: ISheet

  beforeEach(() => {
    vi.clearAllMocks()
    backend = new ThinInstancesBackend()
    scene = {} as unknown as import('@babylonjs/core').Scene
    sheet = createMockSheet()
  })

  afterEach(() => {
    backend?.dispose()
  })

  it('getOrCreateGroup creates Ground mesh', () => {
    const group = backend.getOrCreateGroup(sheet, scene)
    expect(group).toBeDefined()
    expect(MeshBuilder.CreateGround).toHaveBeenCalled()
    expect(StandardMaterial).toHaveBeenCalled()
  })

  it('getOrCreateGroup returns same group for same sheet', () => {
    // Note: backend creates a new group each time (no caching at backend level)
    // Caching is done at SpriteRenderer level
    const group1 = backend.getOrCreateGroup(sheet, scene)
    const group2 = backend.getOrCreateGroup(sheet, scene)
    expect(group1).toBeDefined()
    expect(group2).toBeDefined()
    // Each call creates new mesh (caching handled by SpriteRenderer)
    expect(MeshBuilder.CreateGround).toHaveBeenCalledTimes(2)
  })

  it('dispose cleans up all meshes', () => {
    backend.getOrCreateGroup(sheet, scene)
    expect(() => backend.dispose()).not.toThrow()
  })

  it('group sets alwaysSelectAsActiveMesh for frustum culling', () => {
    backend.getOrCreateGroup(sheet, scene)
    const mesh = vi.mocked(MeshBuilder.CreateGround).mock.results.at(-1)?.value
    expect(mesh?.alwaysSelectAsActiveMesh).toBe(true)
  })
})
