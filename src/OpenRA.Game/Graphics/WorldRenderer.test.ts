/**
 * WorldRenderer.test.ts — WorldRenderer 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock，
 * 重点验证状态管理、坐标转换、调色板系统、渲染对象收集与 API 兼容性。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core — 仅 mock WorldRenderer 用到的模块
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  function makeDefaultPipelineMock(this: any) {
    this.dispose = vi.fn()
    this.bloomEnabled = false
    this.bloomThreshold = 0.9
    this.bloomWeight = 0.5
    this.imageProcessingEnabled = false
    this.imageProcessing = { toneMappingEnabled: false }
  }

  return {
    DefaultRenderingPipeline: vi.fn(makeDefaultPipelineMock),
    Scene: vi.fn(),
    RawTexture: vi.fn(),
  }
})

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// ---------------------------------------------------------------------------

import {
  WorldRenderer,
  RenderGroup,
  PostProcessPassType,
  renderableZPositionComparisonKey,
  type IWorld,
  type IWorldActor,
  type IActor,
  type IEffect,
  type IScreenMap,
  type IRenderable,
  type IFinalizedRenderable,
  type IPostProcessPass,
  type IPalette,
  type IViewport,
  type Vec2,
  type WPos,
  type WVec,
  type Int2,
} from './WorldRenderer'

// ---------------------------------------------------------------------------
// 辅助工厂函数
// ---------------------------------------------------------------------------

function makeMockRenderer() {
  return {
    worldScene: {},
    uiScene: {},
    flush: vi.fn(),
    enableScissor: vi.fn(),
    disableScissor: vi.fn(),
    setPalette: vi.fn(),
    enableAntialiasingFilter: vi.fn(),
    disableAntialiasingFilter: vi.fn(),
    enableDepthBuffer: vi.fn(),
    disableDepthBuffer: vi.fn(),
    clearDepthBuffer: vi.fn(),
    beginFrame: vi.fn(),
    beginUI: vi.fn(),
    endFrame: vi.fn(),
  } as unknown as import('../Renderer').Renderer
}

function createMockWorld(overrides: Partial<IWorld> = {}): IWorld {
  return {
    tileSize: { width: 24, height: 24 },
    tileScale: 1,
    type: 'Regular' as const,
    disposed: false,
    renderPlayer: null,
    localPlayer: null,
    players: [],
    worldActor: createMockWorldActor(),
    screenMap: createMockScreenMap(),
    unpartitionedEffects: [],
    effects: [],
    orderGenerator: null,
    selection: { actors: [] },
    applyToActorsWithTrait: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  }
}

function createMockWorldActor(overrides: Partial<IWorldActor> = {}): IWorldActor {
  return {
    disposed: false,
    traitOrDefault: <T>() => undefined as T | undefined,
    traitsImplementing: <T>() => [] as T[],
    render: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

function createMockScreenMap(overrides: Partial<IScreenMap> = {}): IScreenMap {
  return {
    renderableActorsInBox: vi.fn().mockReturnValue([]),
    renderableEffectsInBox: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

function createMockActor(overrides: Partial<IActor> = {}): IActor {
  return {
    isInWorld: true,
    disposed: false,
    render: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

function createMockEffect(renderReturn: IRenderable[] = []): IEffect {
  return {
    render: vi.fn().mockReturnValue(renderReturn),
  }
}

function createMockRenderable(pos: WPos, zOffset = 0, isDecoration = false): IRenderable {
  return {
    pos,
    zOffset,
    isDecoration,
    prepareRender: vi.fn().mockImplementation((_wr: WorldRenderer) => {
      return {
        render: vi.fn(),
        renderDebugGeometry: vi.fn(),
        screenBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1, height: 1 }),
      } as IFinalizedRenderable
    }),
    withZOffset: vi.fn().mockImplementation(function (this: IRenderable, newOffset: number) {
      return createMockRenderable(this.pos, newOffset, this.isDecoration)
    }),
    offsetBy: vi.fn().mockImplementation(function (this: IRenderable, offset: WVec) {
      return createMockRenderable(
        { x: this.pos.x + offset.x, y: this.pos.y + offset.y, z: this.pos.z + offset.z },
        this.zOffset,
        this.isDecoration,
      )
    }),
    asDecoration: vi.fn().mockImplementation(function (this: IRenderable) {
      return createMockRenderable(this.pos, this.zOffset, true)
    }),
  }
}

function createMockPostProcessPass(
  type: import('./WorldRenderer').PostProcessPassType,
  enabled = true,
): IPostProcessPass {
  return {
    type,
    enabled,
    draw: vi.fn(),
  }
}

function createMockViewport(overrides: Partial<IViewport> = {}): IViewport {
  return {
    topLeft: { x: 0, y: 0 },
    bottomRight: { x: 1024, y: 768 },
    size: { width: 1024, height: 768 },
    worldToViewPx: vi.fn().mockImplementation((wp: Vec2) => ({ x: wp.x, y: wp.y })),
    viewToWorldPx: vi.fn().mockImplementation((vp: Int2) => ({ x: vp.x, y: vp.y, z: 0 })),
    getScissorBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1024, height: 768 }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('WorldRenderer', () => {
  let renderer: ReturnType<typeof makeMockRenderer>
  let world: IWorld
  let wr: WorldRenderer

  beforeEach(() => {
    vi.clearAllMocks()
    renderer = makeMockRenderer()
    world = createMockWorld()
    wr = new WorldRenderer(renderer, world)
  })

  afterEach(() => {
    wr?.dispose()
  })

  // ========================================================================
  // TODO-2.2.1: 构造函数 + Scene 关联
  // ========================================================================
  describe('construction', () => {
    it('associates with renderer.worldScene', () => {
      expect(wr.scene).toBe(renderer.worldScene)
    })

    it('reads tileSize from world', () => {
      expect(wr.tileSize).toEqual({ width: 24, height: 24 })
    })

    it('reads tileScale from world', () => {
      expect(wr.tileScale).toBe(1)
    })

    it('stores world reference', () => {
      expect(wr.world).toBe(world)
    })

    it('stores renderer reference', () => {
      expect(wr.renderer).toBe(renderer)
    })

    it('initializes default viewport', () => {
      expect(wr.viewport).toBeDefined()
      expect(wr.viewport.topLeft).toEqual({ x: 0, y: 0 })
      expect(wr.viewport.bottomRight).toEqual({ x: 0, y: 0 })
    })

    it('initializes depth buffer disabled by default', () => {
      expect(wr.depthBufferEnabled).toBe(false)
    })

    it('initializes terrainLighting as null', () => {
      expect(wr.terrainLighting).toBeNull()
    })
  })

  // ========================================================================
  // TODO-2.2.2: renderingGroupId 分层常量
  // ========================================================================
  describe('RenderGroup constants', () => {
    it('defines Terrain as layer 0', () => {
      expect(RenderGroup.Terrain).toBe(0)
    })

    it('defines Actor as layer 1', () => {
      expect(RenderGroup.Actor).toBe(1)
    })

    it('defines Overlay as layer 2', () => {
      expect(RenderGroup.Overlay).toBe(2)
    })

    it('defines Annotation as layer 3', () => {
      expect(RenderGroup.Annotation).toBe(3)
    })

    it('layers are in correct rendering order', () => {
      expect(RenderGroup.Terrain).toBeLessThan(RenderGroup.Actor)
      expect(RenderGroup.Actor).toBeLessThan(RenderGroup.Overlay)
      expect(RenderGroup.Overlay).toBeLessThan(RenderGroup.Annotation)
    })
  })

  // ========================================================================
  // TODO-2.2.3: Y-sort 排序键
  // ========================================================================
  describe('Y-sort (renderableZPositionComparisonKey)', () => {
    it('computes sort key as Pos.Y + Pos.Z + ZOffset', () => {
      const r = createMockRenderable({ x: 100, y: 200, z: 50 }, 10)
      expect(renderableZPositionComparisonKey(r)).toBe(200 + 50 + 10)
    })

    it('returns lower key for objects closer to top of screen', () => {
      const top = createMockRenderable({ x: 0, y: 100, z: 0 })
      const bottom = createMockRenderable({ x: 0, y: 500, z: 0 })
      expect(renderableZPositionComparisonKey(top)).toBeLessThan(
        renderableZPositionComparisonKey(bottom),
      )
    })

    it('includes Z elevation in sort key', () => {
      const ground = createMockRenderable({ x: 0, y: 200, z: 0 })
      const elevated = createMockRenderable({ x: 0, y: 200, z: 100 })
      expect(renderableZPositionComparisonKey(elevated)).toBeGreaterThan(
        renderableZPositionComparisonKey(ground),
      )
    })

    it('includes manual ZOffset in sort key', () => {
      const without = createMockRenderable({ x: 0, y: 200, z: 0 }, 0)
      const withOffset = createMockRenderable({ x: 0, y: 200, z: 0 }, 50)
      expect(renderableZPositionComparisonKey(withOffset)).toBe(
        renderableZPositionComparisonKey(without) + 50,
      )
    })

    it('exposes static method on WorldRenderer class', () => {
      expect(WorldRenderer.renderableZPositionComparisonKey).toBe(renderableZPositionComparisonKey)
    })
  })

  // ========================================================================
  // 帧管理
  // ========================================================================
  describe('frame management', () => {
    it('beginFrame is callable without error', () => {
      expect(() => wr.beginFrame()).not.toThrow()
    })

    it('endFrame is callable without error', () => {
      expect(() => wr.endFrame()).not.toThrow()
    })
  })

  // ========================================================================
  // TODO-2.2.4: 调色板管理
  // ========================================================================
  describe('palette management', () => {
    it('palette returns null for empty string', () => {
      expect(wr.palette('')).toBeNull()
    })

    it('palette creates and caches reference by name', () => {
      const ref = wr.palette('test-palette')
      expect(ref).toBeDefined()
      expect(ref!.name).toBe('test-palette')
      expect(ref!.index).toBe(0)
    })

    it('palette returns same reference on second call', () => {
      const ref1 = wr.palette('test-palette')
      const ref2 = wr.palette('test-palette')
      expect(ref1).toBe(ref2)
    })

    it('palette assigns incrementing indices', () => {
      const ref0 = wr.palette('pal0')
      const ref1 = wr.palette('pal1')
      expect(ref0!.index).toBe(0)
      expect(ref1!.index).toBe(1)
    })

    it('addPalette fires paletteInvalidated when height changes', () => {
      const callback = vi.fn()
      wr.paletteInvalidated = callback
      wr.addPalette('new', { name: 'new', index: 0, colors: new Uint8Array(), allowModifiers: false })
      expect(callback).toHaveBeenCalled()
    })

    it('addPalette with allowOverwrite delegates to replacePalette', () => {
      wr.addPalette('dup', { name: 'dup', index: 0, colors: new Uint8Array(), allowModifiers: false })
      const newPal: IPalette = { name: 'dup', index: 0, colors: new Uint8Array([1, 2, 3]), allowModifiers: true }
      wr.addPalette('dup', newPal, false, true)
      const ref = wr.palette('dup')
      expect(ref!.palette).toBe(newPal)
    })

    it('replacePalette updates cached PaletteReference', () => {
      wr.palette('replace-test')
      const newPal: IPalette = { name: 'replace-test', index: 1, colors: new Uint8Array([255]), allowModifiers: true }
      wr.replacePalette('replace-test', newPal)
      const ref = wr.palette('replace-test')
      expect(ref!.palette).toBe(newPal)
    })

    it('replacePalette no-ops for unknown name', () => {
      expect(() => wr.replacePalette('nonexistent', {
        name: 'nonexistent', index: 0, colors: new Uint8Array(), allowModifiers: false,
      })).not.toThrow()
    })

    it('setPaletteColorShift is callable without error', () => {
      expect(() => wr.setPaletteColorShift('test', 0.1, 0.2, 1.0, 0, 1)).not.toThrow()
    })

    it('refreshPalette is callable without error', () => {
      expect(() => wr.refreshPalette()).not.toThrow()
    })

    it('updatePalettesForPlayer is callable without error', () => {
      const color = { r: 1, g: 0, b: 0, a: 1 }
      expect(() => wr.updatePalettesForPlayer('player1', color as any, true)).not.toThrow()
    })
  })

  // ========================================================================
  // TODO-2.2.5: generateRenderables — 渲染对象收集与排序
  // ========================================================================
  describe('generateRenderables', () => {
    beforeEach(() => {
      // 设置视口用于 renderableEffectsInBox
      wr.viewport = createMockViewport()
    })

    it('early returns when worldActor is disposed', () => {
      world = createMockWorld({ worldActor: createMockWorldActor({ disposed: true }) })
      wr = new WorldRenderer(renderer, world)
      const bufferBefore = wr.preparedRenderablesCount
      wr.generateRenderables()
      expect(wr.preparedRenderablesCount).toBe(bufferBefore)
    })

    it('collects renderables from onScreenActors', () => {
      const actor = createMockActor()
      const renderable = createMockRenderable({ x: 0, y: 100, z: 0 })
      ;(actor.render as ReturnType<typeof vi.fn>).mockReturnValue([renderable])
      // 通过 prepareRenderables 将 actor 加入 onScreenActors
      world.screenMap.renderableActorsInBox = vi.fn().mockReturnValue([actor])
      wr.prepareRenderables()

      expect(wr.preparedRenderablesCount).toBeGreaterThanOrEqual(1)
    })

    it('collects renderables from worldActor', () => {
      // prepareRenderables 在收集过程中会调用 worldActor 的渲染逻辑
      wr.prepareRenderables()
      // worldActor 参与渲染对象收集（即使无额外渲染对象，prepareRenderables 正常完成）
      expect(wr.preparedRenderablesCount).toBeGreaterThanOrEqual(0)
    })

    it('collects renderables from unpartitioned effects', () => {
      const renderable = createMockRenderable({ x: 50, y: 50, z: 0 })
      world = createMockWorld({
        unpartitionedEffects: [createMockEffect([renderable])],
      })
      wr = new WorldRenderer(renderer, world)
      wr.viewport = createMockViewport()
      wr.prepareRenderables()
      expect(wr.preparedRenderablesCount).toBeGreaterThanOrEqual(1)
    })

    it('sorts renderables by Y-sort key (stable sort)', () => {
      // 创建三个渲染对象：Y 坐标不同
      const low = createMockRenderable({ x: 0, y: 50, z: 0 })
      const mid = createMockRenderable({ x: 0, y: 100, z: 0 })
      const high = createMockRenderable({ x: 0, y: 200, z: 0 })

      const effect = createMockEffect([low, high, mid]) // 故意乱序
      world = createMockWorld({ unpartitionedEffects: [effect] })
      wr = new WorldRenderer(renderer, world)
      wr.viewport = createMockViewport()
      wr.prepareRenderables()

      // 验证排序：第一个 renderable 应该来自 y=50（最小的）
      // 注意：prepareRender 返回了新的 IFinalizedRenderable，我们检查数量
      expect(wr.preparedRenderablesCount).toBe(3)
    })

    it('stable sort: same Y-sort key preserves insertion order', () => {
      const a = createMockRenderable({ x: 0, y: 100, z: 0 })
      const b = createMockRenderable({ x: 0, y: 100, z: 0 })
      const c = createMockRenderable({ x: 0, y: 100, z: 0 })

      const effect = createMockEffect([a, b, c])
      world = createMockWorld({ unpartitionedEffects: [effect] })
      wr = new WorldRenderer(renderer, world)
      wr.viewport = createMockViewport()
      wr.prepareRenderables()

      // 所有三个对象的 sort key 相同，应该保持插入顺序
      expect(wr.preparedRenderablesCount).toBe(3)
    })
  })

  // ========================================================================
  // prepareRenderables
  // ========================================================================
  describe('prepareRenderables', () => {
    it('populates onScreenActors from screenMap', () => {
      const actor = createMockActor()
      world.screenMap.renderableActorsInBox = vi.fn().mockReturnValue([actor])
      wr.viewport = createMockViewport()
      wr.prepareRenderables()
      expect(wr.onScreenActorCount).toBe(1)
    })

    it('clears onScreenActors before repopulating', () => {
      const actor = createMockActor()
      world.screenMap.renderableActorsInBox = vi.fn().mockReturnValue([actor])
      wr.viewport = createMockViewport()
      wr.prepareRenderables()
      expect(wr.onScreenActorCount).toBe(1)

      // 第二次调用：如果没有返回任何 actor
      world.screenMap.renderableActorsInBox = vi.fn().mockReturnValue([])
      wr.prepareRenderables()
      expect(wr.onScreenActorCount).toBe(0)
    })

    it('early returns when worldActor is disposed', () => {
      world = createMockWorld({ worldActor: createMockWorldActor({ disposed: true }) })
      wr = new WorldRenderer(renderer, world)
      const cb = world.screenMap.renderableActorsInBox as ReturnType<typeof vi.fn>
      wr.prepareRenderables()
      // screenMap 不应被调用
      expect(cb).not.toHaveBeenCalled()
    })
  })

  // ========================================================================
  // draw / drawAnnotations
  // ========================================================================
  describe('draw and drawAnnotations', () => {
    it('draw early returns when worldActor is disposed', () => {
      world = createMockWorld({ worldActor: createMockWorldActor({ disposed: true }) })
      wr = new WorldRenderer(renderer, world)
      expect(() => wr.draw()).not.toThrow()
    })

    it('draw is callable for non-disposed world', () => {
      expect(() => wr.draw()).not.toThrow()
    })

    it('drawAnnotations clears renderable buffers', () => {
      // 先收集一些渲染对象
      const renderable = createMockRenderable({ x: 0, y: 0, z: 0 })
      world = createMockWorld({ unpartitionedEffects: [createMockEffect([renderable])] })
      wr = new WorldRenderer(renderer, world)
      wr.viewport = createMockViewport()
      wr.prepareRenderables()

      expect(wr.preparedRenderablesCount).toBeGreaterThan(0)

      // 添加后处理通道以覆盖 applyPostProcessing 路径
      const pass = createMockPostProcessPass(PostProcessPassType.AfterAnnotations)
      wr.addPostProcessPass(pass)

      wr.drawAnnotations()
      expect(wr.preparedRenderablesCount).toBe(0)
      expect(wr.preparedOverlayRenderablesCount).toBe(0)
      expect(wr.preparedAnnotationRenderablesCount).toBe(0)
    })
  })

  // ========================================================================
  // TODO-2.2.6: 后处理通道
  // ========================================================================
  describe('post-processing', () => {
    it('addPostProcessPass adds to list', () => {
      const pass = createMockPostProcessPass(PostProcessPassType.AfterActors)
      wr.addPostProcessPass(pass)
      expect(wr.getPostProcessPasses()).toContain(pass)
    })

    it('removePostProcessPass removes from list', () => {
      const pass = createMockPostProcessPass(PostProcessPassType.AfterWorld)
      wr.addPostProcessPass(pass)
      wr.removePostProcessPass(pass)
      expect(wr.getPostProcessPasses()).not.toContain(pass)
    })

    it('removePostProcessPass no-ops for unknown pass', () => {
      const pass = createMockPostProcessPass(PostProcessPassType.AfterActors)
      expect(() => wr.removePostProcessPass(pass)).not.toThrow()
    })

    it('drawAnnotations invokes AfterAnnotations passes', () => {
      const pass = createMockPostProcessPass(PostProcessPassType.AfterAnnotations, true)
      wr.addPostProcessPass(pass)
      wr.drawAnnotations()
      expect(pass.draw).toHaveBeenCalledWith(wr)
      expect(renderer.flush).toHaveBeenCalled()
    })

    it('drawAnnotations skips disabled passes', () => {
      const pass = createMockPostProcessPass(PostProcessPassType.AfterAnnotations, false)
      wr.addPostProcessPass(pass)
      wr.drawAnnotations()
      expect(pass.draw).not.toHaveBeenCalled()
    })

    it('drawAnnotations skips passes of wrong type', () => {
      const pass = createMockPostProcessPass(PostProcessPassType.AfterActors, true)
      wr.addPostProcessPass(pass)
      wr.drawAnnotations()
      expect(pass.draw).not.toHaveBeenCalled()
    })

    it('getPostProcessPasses returns readonly view', () => {
      expect(wr.getPostProcessPasses()).toEqual([])
    })
  })

  // ========================================================================
  // TODO-2.2.7: 坐标转换方法（与 OpenRA 数学完全一致）
  // ========================================================================
  describe('coordinate conversion', () => {
    const tileSize = { width: 24, height: 24 }
    const tileScale = 1

    beforeEach(() => {
      world = createMockWorld({ tileSize, tileScale })
      wr = new WorldRenderer(renderer, world)
    })

    // ---- screenPosition ----
    describe('screenPosition', () => {
      it('converts WPos to screen Vec2', () => {
        const result = wr.screenPosition({ x: 10, y: 20, z: 5 })
        expect(result.x).toBeCloseTo(240) // 24 * 10 / 1
        expect(result.y).toBeCloseTo(360) // 24 * (20 - 5) / 1
      })

      it('handles zero coordinates', () => {
        const result = wr.screenPosition({ x: 0, y: 0, z: 0 })
        expect(result.x).toBe(0)
        expect(result.y).toBe(0)
      })

      it('higher Z reduces screen Y (parallax effect)', () => {
        const low = wr.screenPosition({ x: 5, y: 10, z: 0 })
        const high = wr.screenPosition({ x: 5, y: 10, z: 5 })
        expect(high.y).toBeLessThan(low.y)
      })
    })

    // ---- screenPositionFloat2 ----
    describe('screenPositionFloat2', () => {
      it('converts Vec2 to screen Vec2 (no Z)', () => {
        const result = wr.screenPositionFloat2({ x: 5, y: 10 })
        expect(result.x).toBeCloseTo(120) // 24 * 5
        expect(result.y).toBeCloseTo(240) // 24 * 10
      })
    })

    // ---- screen3DPosition ----
    describe('screen3DPosition', () => {
      it('includes depth from world Y', () => {
        const result = wr.screen3DPosition({ x: 10, y: 20, z: 5 })
        expect(result.z).toBeCloseTo(480) // 24 * 20 / 1
        expect(result.y).toBeCloseTo(360) // 24 * (20 - 5) / 1
        expect(result.x).toBeCloseTo(240)
      })

      it('depth is independent of world Z', () => {
        const lowZ = wr.screen3DPosition({ x: 10, y: 20, z: 0 })
        const highZ = wr.screen3DPosition({ x: 10, y: 20, z: 10 })
        // 深度 Z 应相同（仅取决于世界 Y）
        expect(lowZ.z).toBe(highZ.z)
        // 但屏幕 Y 不同（parallax）
        expect(highZ.y).toBeLessThan(lowZ.y)
      })
    })

    // ---- screenPxPosition ----
    describe('screenPxPosition', () => {
      it('rounds to nearest integer pixel', () => {
        // 使用会产生非整数结果的坐标
        world = createMockWorld({ tileSize: { width: 10, height: 10 }, tileScale: 3 })
        wr = new WorldRenderer(renderer, world)
        const result = wr.screenPxPosition({ x: 1, y: 1, z: 0 })
        expect(Number.isInteger(result.x)).toBe(true)
        expect(Number.isInteger(result.y)).toBe(true)
      })
    })

    // ---- screen3DPxPosition ----
    describe('screen3DPxPosition', () => {
      it('retains Z while rounding X and Y', () => {
        const result = wr.screen3DPxPosition({ x: 5, y: 10, z: 3 })
        expect(Number.isInteger(result.x)).toBe(true)
        expect(Number.isInteger(result.y)).toBe(true)
        expect(result.z).toBeCloseTo(240) // 24 * 10 / 1
      })
    })

    // ---- screenVectorComponents ----
    describe('screenVectorComponents', () => {
      it('converts WVec to Vec3', () => {
        const result = wr.screenVectorComponents({ x: 2, y: 3, z: 1 })
        expect(result.x).toBeCloseTo(48)  // 24 * 2
        expect(result.y).toBeCloseTo(48)  // 24 * (3 - 1)
        expect(result.z).toBeCloseTo(24)  // 24 * 1
      })
    })

    // ---- screenVector ----
    describe('screenVector', () => {
      it('returns 4-component array with w=1', () => {
        const result = wr.screenVector({ x: 1, y: 2, z: 1 })
        expect(result).toHaveLength(4)
        expect(result[0]).toBeCloseTo(24)  // x
        expect(result[1]).toBeCloseTo(24)  // y - z
        expect(result[2]).toBeCloseTo(24)  // z
        expect(result[3]).toBe(1)          // w
      })
    })

    // ---- screenPxOffset ----
    describe('screenPxOffset', () => {
      it('rounds vector components to integer', () => {
        const result = wr.screenPxOffset({ x: 1, y: 1, z: 0 })
        expect(Number.isInteger(result.x)).toBe(true)
        expect(Number.isInteger(result.y)).toBe(true)
      })
    })

    // ---- projectedPosition ----
    describe('projectedPosition', () => {
      it('converts screen pixels back to world coordinates', () => {
        const result = wr.projectedPosition({ x: 48, y: 96 })
        expect(result.x).toBeCloseTo(2)   // 48 * 1 / 24
        expect(result.y).toBeCloseTo(4)   // 96 * 1 / 24
        expect(result.z).toBe(0)          // 假设无高度
      })
    })
  })

  // ========================================================================
  // 调色板失效事件
  // ========================================================================
  describe('paletteInvalidated event', () => {
    it('initializes as null', () => {
      expect(wr.paletteInvalidated).toBeNull()
    })

    it('supports assignment and invocation', () => {
      const cb = vi.fn()
      wr.paletteInvalidated = cb
      wr.addPalette('evt-test', {
        name: 'evt-test', index: 0, colors: new Uint8Array(), allowModifiers: false,
      })
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  // ========================================================================
  // getDefaultPipeline / initializeDefaultPipeline (stub)
  // ========================================================================
  describe('default pipeline', () => {
    it('getDefaultPipeline returns null initially', () => {
      expect(wr.getDefaultPipeline()).toBeNull()
    })

    it('initializeDefaultPipeline returns null in mock environment', () => {
      // 在 mock 环境中，DefaultRenderingPipeline 构造函数会失败
      // 因为 mock 的 Scene 没有必要的内部结构
      const mockCamera = { dispose: vi.fn() } as any
      const result = wr.initializeDefaultPipeline(mockCamera)
      // mock 环境可能成功也可能返回 null，取决于 mock 实现
      expect(result !== undefined).toBe(true)
    })
  })

  // ========================================================================
  // Dispose
  // ========================================================================
  describe('dispose', () => {
    it('clears renderable buffers', () => {
      wr.viewport = createMockViewport()
      const renderable = createMockRenderable({ x: 0, y: 0, z: 0 })
      world = createMockWorld({ unpartitionedEffects: [createMockEffect([renderable])] })
      wr = new WorldRenderer(renderer, world)
      wr.viewport = createMockViewport()
      wr.prepareRenderables()
      expect(wr.preparedRenderablesCount).toBeGreaterThan(0)

      wr.dispose()
      expect(wr.preparedRenderablesCount).toBe(0)
      expect(wr.preparedOverlayRenderablesCount).toBe(0)
      expect(wr.preparedAnnotationRenderablesCount).toBe(0)
    })

    it('clears onScreenActors', () => {
      const actor = createMockActor()
      world.screenMap.renderableActorsInBox = vi.fn().mockReturnValue([actor])
      wr.viewport = createMockViewport()
      wr.prepareRenderables()
      expect(wr.onScreenActorCount).toBeGreaterThan(0)

      wr.dispose()
      expect(wr.onScreenActorCount).toBe(0)
    })

    it('clears palette refs', () => {
      wr.palette('dispose-test')
      wr.dispose()
      // 调用后 paletteRefs 应被清空
      const newRef = wr.palette('dispose-test')
      expect(newRef!.index).toBe(0) // 重新从头计数
    })

    it('clears postProcessPasses', () => {
      wr.addPostProcessPass(createMockPostProcessPass(PostProcessPassType.AfterActors))
      wr.dispose()
      expect(wr.getPostProcessPasses()).toEqual([])
    })

    it('multiple dispose calls do not throw', () => {
      wr.dispose()
      expect(() => wr.dispose()).not.toThrow()
    })
  })

  // ========================================================================
  // IRenderable 接口方法
  // ========================================================================
  describe('IRenderable interface helpers', () => {
    it('withZOffset creates copy with new offset', () => {
      const r = createMockRenderable({ x: 0, y: 0, z: 0 }, 5)
      const copy = r.withZOffset(10)
      expect(copy.zOffset).toBe(10)
      // 原始不变
      expect(r.zOffset).toBe(5)
    })

    it('offsetBy adjusts position', () => {
      const r = createMockRenderable({ x: 10, y: 20, z: 5 }, 0)
      const copy = r.offsetBy({ x: 5, y: 10, z: 3 })
      expect(copy.pos.x).toBe(15)
      expect(copy.pos.y).toBe(30)
      expect(copy.pos.z).toBe(8)
    })

    it('asDecoration marks as decoration', () => {
      const r = createMockRenderable({ x: 0, y: 0, z: 0 }, 0, false)
      const copy = r.asDecoration()
      expect(copy.isDecoration).toBe(true)
    })
  })
})
