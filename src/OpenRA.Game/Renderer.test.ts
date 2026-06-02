/**
 * Renderer.test.ts — Renderer 迁移单元测试
 *
 * 由于 happy-dom 不支持 WebGL，测试中对 @babylonjs/core 进行 mock，
 * 重点验证状态管理逻辑、API 兼容性与 OpenRA 行为一致性。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs.core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => {
  function makeEngineMock(this: any) {
    this.runRenderLoop = vi.fn()
    this.stopRenderLoop = vi.fn()
    this.resize = vi.fn()
    this.getDeltaTime = vi.fn(() => 16.67)
    this.getRenderWidth = vi.fn(() => 800)
    this.getRenderHeight = vi.fn(() => 600)
    this.setState = vi.fn()
    this.enableScissor = vi.fn()
    this.disableScissor = vi.fn()
    this.onEndFrameObservable = { addOnce: vi.fn((cb: () => void) => cb()) }
    this.dispose = vi.fn()
  }

  function makeSceneMock(this: any) {
    this.render = vi.fn()
    this.dispose = vi.fn()
    this.autoClear = true
    this.autoClearDepthAndStencil = true
    this.customRenderTargets = []
    this.onAfterRenderObservable = { addOnce: vi.fn() }
    this.activeCamera = null
  }

  function makeCameraMock(this: any) {
    this.dispose = vi.fn()
    this.position = { x: 0, y: 0, z: 0 }
    this.setTarget = vi.fn()
    this.getViewMatrix = vi.fn()
    this.mode = 1
    this.orthoLeft = 0
    this.orthoRight = 0
    this.orthoTop = 0
    this.orthoBottom = 0
    this.outputRenderTarget = null
  }

  function makeVector3Mock(this: any, x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
  makeVector3Mock.Zero = function () {
    return new (makeVector3Mock as any)(0, 0, 0)
  }

  function makeColor4Mock(this: any, r = 0, g = 0, b = 0, a = 1) {
    this.r = r
    this.g = g
    this.b = b
    this.a = a
  }

  function makeColor3Mock(this: any, r = 0, g = 0, b = 0) {
    this.r = r
    this.g = g
    this.b = b
  }

  const EngineMock = vi.fn(makeEngineMock)
  const SceneMock = vi.fn(makeSceneMock)
  const TargetCameraMock = vi.fn(makeCameraMock)
  const Vector3Mock = vi.fn(makeVector3Mock) as any
  Vector3Mock.Zero = makeVector3Mock.Zero
  const Color4Mock = vi.fn(makeColor4Mock)
  const Color3Mock = vi.fn(makeColor3Mock)

  return {
    Engine: EngineMock,
    Scene: SceneMock,
    TargetCamera: TargetCameraMock,
    Camera: {
      ORTHOGRAPHIC_CAMERA: 1,
      PERSPECTIVE_CAMERA: 0,
    },
    Vector3: Vector3Mock,
    RenderTargetTexture: vi.fn(function RenderTargetTextureMock(this: any) {
      this.dispose = vi.fn()
      this.renderList = []
    }),
    MeshBuilder: {
      CreatePlane: vi.fn().mockImplementation(() => ({
        dispose: vi.fn(),
        material: null,
        position: { z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scaling: { x: 1, y: 1, z: 1 },
      })),
    },
    StandardMaterial: vi.fn(function StandardMaterialMock(this: any) {
      this.dispose = vi.fn()
      this.diffuseTexture = null
      this.emissiveColor = null
      this.disableLighting = false
    }),
    Texture: { BILINEAR_SAMPLINGMODE: 2 },
    Color4: Color4Mock,
    Tools: {
      CreateScreenshotUsingRenderTarget: vi.fn(),
    },
    Color3: Color3Mock,
  }
})

// ---------------------------------------------------------------------------
// 导入被测模块（必须在 vi.mock 之后）
// ---------------------------------------------------------------------------

import { Engine, RenderTargetTexture, MeshBuilder, StandardMaterial, Tools } from '@babylonjs/core'
import { Renderer, RenderType, CameraMode, type IBatchRenderer } from './Renderer'

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('Renderer', () => {
  let canvas: HTMLCanvasElement
  let renderer: Renderer

  beforeEach(() => {
    vi.clearAllMocks()
    canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    // happy-dom 中 requestPointerLock 不存在，提前绑定
    if (!('requestPointerLock' in canvas)) {
      Object.defineProperty(canvas, 'requestPointerLock', {
        value: vi.fn().mockResolvedValue(undefined),
        configurable: true,
      })
    }
    if (!('exitPointerLock' in document)) {
      Object.defineProperty(document, 'exitPointerLock', {
        value: vi.fn().mockResolvedValue(undefined),
        configurable: true,
      })
    }
    renderer = new Renderer(canvas)
  })

  afterEach(() => {
    if (renderer?.currentRenderType === RenderType.UI) {
      renderer.endFrame()
    }
    renderer?.dispose()
  })

  // ========================================================================
  // TODO-2.1.1 / TODO-2.1.2: Engine + Canvas 初始化
  // ========================================================================
  describe('construction', () => {
    it('creates Engine with provided canvas', () => {
      expect(Engine).toHaveBeenCalledTimes(1)
      expect(Engine).toHaveBeenCalledWith(canvas, true)
    })

    it('creates two Scenes (world + ui)', () => {
      expect(renderer.worldScene).toBeDefined()
      expect(renderer.uiScene).toBeDefined()
    })

    it('uiScene uses default autoClear (true) in RTT-based architecture', () => {
      // 方案B（RTT 离屏渲染）下，world 内容通过 quad 贴图进入 uiScene，
      // 不需要 uiScene.autoClear = false 来保留 backbuffer。
      expect(renderer.uiScene.autoClear).toBe(true)
      expect(renderer.uiScene.autoClearDepthAndStencil).toBe(true)
    })

    it('creates worldCamera and uiCamera', () => {
      expect(renderer.worldCamera).toBeDefined()
      expect(renderer.uiCamera).toBeDefined()
    })

    it('defaults to Orthographic camera mode', () => {
      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
    })

    it('exposes resolution from engine render size', () => {
      expect(renderer.resolution).toEqual({ width: 800, height: 600 })
    })

    it('exposes nativeResolution from canvas size', () => {
      expect(renderer.nativeResolution).toEqual({ width: 800, height: 600 })
    })
  })

  // ========================================================================
  // TODO-2.1.3: 渲染循环
  // ========================================================================
  describe('render loop', () => {
    it('startRenderLoop delegates to engine.runRenderLoop', () => {
      const callback = vi.fn()
      renderer.startRenderLoop(callback)
      expect(renderer.engine.runRenderLoop).toHaveBeenCalledTimes(1)
    })

    it('stopRenderLoop delegates to engine.stopRenderLoop', () => {
      renderer.stopRenderLoop()
      expect(renderer.engine.stopRenderLoop).toHaveBeenCalledTimes(1)
    })
  })

  // ========================================================================
  // TODO-2.1.5: depthMargin（兼容存储，不再用于伪深度）
  // ========================================================================
  describe('depth margin', () => {
    it('stores depthMargin value', () => {
      renderer.setDepthMargin(1024)
      expect(renderer.getDepthMargin()).toBe(1024)
    })

    it('defaults to 0', () => {
      expect(renderer.getDepthMargin()).toBe(0)
    })
  })

  // ========================================================================
  // UI 缩放
  // ========================================================================
  describe('UI scale', () => {
    // Diff-2: windowScale 应从 devicePixelRatio 初始化
    it('initializes windowScale from devicePixelRatio', () => {
      // happy-dom 中 devicePixelRatio 默认为 1
      expect(renderer.nativeWindowScale).toBe(1)
      expect(renderer.windowScale).toBe(1)
    })

    it('setUIScale updates windowScale relative to nativeWindowScale', () => {
      renderer.setUIScale(1.5)
      // windowScale = nativeWindowScale * 1.5 = 1 * 1.5 = 1.5
      expect(renderer.windowScale).toBe(1.5)
    })

    it('setUIScale updates windowScale used by downscale logic', () => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
      renderer.setUIScale(2)
      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
      // windowScale 增大后，bufferSize 变大，worldDownscaleFactor 应相应变化
      expect(renderer.windowScale).toBe(2)
    })
  })

  // ========================================================================
  // TODO-2.1.6: 正交/透视相机切换
  // ========================================================================
  describe('camera mode switching', () => {
    it('switches from Orthographic to Perspective', () => {
      renderer.setCameraMode(CameraMode.Perspective)
      expect(renderer.getCameraMode()).toBe(CameraMode.Perspective)
    })

    it('switches back to Orthographic', () => {
      renderer.setCameraMode(CameraMode.Perspective)
      renderer.setCameraMode(CameraMode.Orthographic)
      expect(renderer.getCameraMode()).toBe(CameraMode.Orthographic)
    })

    it('no-op when switching to same mode', () => {
      const prevCallCount = vi.mocked(Engine).mock.calls.length
      renderer.setCameraMode(CameraMode.Orthographic)
      expect(vi.mocked(Engine).mock.calls.length).toBe(prevCallCount)
    })

    it('disposes old camera when switching', () => {
      const oldCam = renderer.worldCamera as unknown as { dispose: ReturnType<typeof vi.fn> }
      renderer.setCameraMode(CameraMode.Perspective)
      expect(oldCam.dispose).toHaveBeenCalled()
    })

    it('updates worldScene.activeCamera to new camera', () => {
      const oldActiveCamera = renderer.worldScene.activeCamera
      renderer.setCameraMode(CameraMode.Perspective)
      expect(renderer.worldScene.activeCamera).not.toBe(oldActiveCamera)
      expect(renderer.worldScene.activeCamera).toBe(renderer.worldCamera)
    })
  })

  // ========================================================================
  // Diff-3: beginUI / endFrame 中的 scene 渲染
  // ========================================================================
  describe('scene rendering in frame lifecycle', () => {
    beforeEach(() => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
    })

    it('beginUI triggers worldScene.render when transitioning from World', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      renderer.beginUI()
      expect(renderer.worldScene.render).toHaveBeenCalled()
    })

    it('endFrame triggers uiScene.render', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      renderer.beginUI()
      renderer.endFrame()
      expect(renderer.uiScene.render).toHaveBeenCalled()
    })
  })

  // ========================================================================
  // 帧状态机: None → World → UI → None
  // ========================================================================
  describe('render type state machine', () => {
    beforeEach(() => {
      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
    })

    it('initial renderType is None', () => {
      expect(renderer.currentRenderType).toBe(RenderType.None)
    })

    it('beginWorld transitions None → World', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
      expect(renderer.currentRenderType).toBe(RenderType.World)
    })

    it('beginUI transitions World → UI', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
      renderer.beginUI()
      expect(renderer.currentRenderType).toBe(RenderType.UI)
    })

    it('endFrame transitions UI → None', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
      renderer.beginUI()
      renderer.endFrame()
      expect(renderer.currentRenderType).toBe(RenderType.None)
    })

    it('throws when beginWorld called from non-None state', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
      expect(() => renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })).toThrow(
        'beginWorld called with renderType = World',
      )
    })

    it('throws when endFrame called from non-UI state', () => {
      expect(() => renderer.endFrame()).toThrow('endFrame called with renderType = None')
    })

    it('allows beginUI without beginWorld (world skipped)', () => {
      renderer.beginUI()
      expect(renderer.currentRenderType).toBe(RenderType.UI)
    })
  })

  // ========================================================================
  // WorldDownscaleFactor 计算
  // ========================================================================
  describe('world downscale factor', () => {
    beforeEach(() => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
    })

    it('defaults to 1 when viewport fits', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      expect(renderer.worldDownscaleFactor).toBe(1)
    })

    it('increases to 2 when viewport exceeds buffer by >2x', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
    })

    it('increases to 3 when viewport exceeds buffer by >3x', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 1600, height: 1600 })
      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(3)
    })

    it('recomputes on viewport change', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      expect(renderer.worldDownscaleFactor).toBe(1)

      renderer.beginUI()
      renderer.endFrame()
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)
    })
  })

  // ========================================================================
  // Flush & BatchRenderer 管理
  // ========================================================================
  describe('flush and batch renderer', () => {
    it('flush resets current batch renderer', () => {
      const mockBatch: IBatchRenderer = { flush: vi.fn() }
      renderer.batchRenderer = mockBatch
      expect(renderer.batchRenderer).toBe(mockBatch)

      renderer.flush()
      expect(renderer.batchRenderer).toBeNull()
    })

    it('batchRenderer setter flushes previous renderer', () => {
      const prevBatch: IBatchRenderer = { flush: vi.fn() }
      const nextBatch: IBatchRenderer = { flush: vi.fn() }

      renderer.batchRenderer = prevBatch
      renderer.batchRenderer = nextBatch

      expect(prevBatch.flush).toHaveBeenCalledTimes(1)
      expect(renderer.batchRenderer).toBe(nextBatch)
    })

    it('batchRenderer setter no-op when same renderer', () => {
      const batch: IBatchRenderer = { flush: vi.fn() }
      renderer.batchRenderer = batch
      renderer.batchRenderer = batch
      expect(batch.flush).toHaveBeenCalledTimes(0)
    })
  })

  // ========================================================================
  // Scissor 裁剪状态栈
  // ========================================================================
  describe('scissor state stack', () => {
    it('pushes rect onto stack', () => {
      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
      expect(renderer.scissorDepth).toBe(1)
    })

    it('pops rect from stack', () => {
      renderer.enableScissor({ x: 10, y: 20, width: 100, height: 200 })
      renderer.disableScissor()
      expect(renderer.scissorDepth).toBe(0)
    })

    it('intersects nested scissor with parent', () => {
      renderer.enableScissor({ x: 0, y: 0, width: 100, height: 100 })
      renderer.enableScissor({ x: 50, y: 50, width: 100, height: 100 })
      expect(renderer.scissorDepth).toBe(2)
      // 验证 engine.enableScissor 收到的最终矩形是交集
      const lastCall = vi.mocked(renderer.engine.enableScissor).mock.calls.at(-1)
      expect(lastCall).toEqual([50, 50, 50, 50])
    })

    it('handles disableScissor with empty stack gracefully', () => {
      renderer.disableScissor()
      expect(renderer.scissorDepth).toBe(0)
    })

    it('flushes on enableScissor', () => {
      const batch: IBatchRenderer = { flush: vi.fn() }
      renderer.batchRenderer = batch
      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
      expect(batch.flush).toHaveBeenCalledTimes(1)
    })

    it('flushes on disableScissor', () => {
      const batch: IBatchRenderer = { flush: vi.fn() }
      renderer.enableScissor({ x: 0, y: 0, width: 10, height: 10 })
      renderer.batchRenderer = batch
      renderer.disableScissor()
      expect(batch.flush).toHaveBeenCalledTimes(1)
    })

    // Diff-1: World 阶段 scissor 需要除以 worldDownscaleFactor
    it('scales scissor rect by worldDownscaleFactor in World state', () => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
      renderer.beginWorld({ x: 0, y: 0 }, { width: 1200, height: 1200 })
      expect(renderer.worldDownscaleFactor).toBeGreaterThanOrEqual(2)

      const factor = renderer.worldDownscaleFactor
      renderer.enableScissor({ x: 0, y: 0, width: 100, height: 100 })

      // engine.enableScissor 应该被传入缩小后的矩形
      const lastCall = vi.mocked(renderer.engine.enableScissor).mock.calls.at(-1)
      expect(lastCall).toBeDefined()
      expect(lastCall![2]).toBeLessThanOrEqual(Math.ceil(100 / factor) + 1)
      expect(lastCall![3]).toBeLessThanOrEqual(Math.ceil(100 / factor) + 1)
    })
  })

  // ========================================================================
  // setMaximumViewportSize depthMargin !== 0 分支
  // ========================================================================
  describe('setMaximumViewportSize with depthMargin', () => {
    it('uses size directly when depthMargin is non-zero', () => {
      renderer.setDepthMargin(128)
      renderer.setMaximumViewportSize({ width: 256, height: 256 })
      // depthMargin !== 0 时，worldBufferSize = nextPowerOf2(size)，不限制为 2*surfaceSize
      expect(renderer.worldFrameBufferSize).toEqual({ width: 256, height: 256 })
    })

    it('applies nextPowerOf2 even in depthMargin branch', () => {
      renderer.setDepthMargin(1)
      renderer.setMaximumViewportSize({ width: 300, height: 300 })
      // 300 不是 2 的幂，应向上取整到 512
      expect(renderer.worldFrameBufferSize).toEqual({ width: 512, height: 512 })
    })
  })

  // ========================================================================
  // 世界帧缓冲尺寸查询
  // ========================================================================
  describe('world frame buffer size', () => {
    it('returns size after setMaximumViewportSize', () => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
      expect(renderer.worldFrameBufferSize).toEqual({ width: 512, height: 512 })
    })

    it('returns zero size before initialization', () => {
      const fresh = new Renderer(document.createElement('canvas'))
      expect(fresh.worldFrameBufferSize).toEqual({ width: 0, height: 0 })
      fresh.dispose()
    })
  })

  // ========================================================================
  // 渲染缓冲快照
  // ========================================================================
  describe('render buffer snapshot', () => {
    beforeEach(() => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
    })

    it('returns worldRenderTarget when in World state', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      const worldRT = (renderer as unknown as { worldRenderTarget: unknown }).worldRenderTarget
      expect(renderer.getRenderBufferSnapshot()).toBe(worldRT)
    })

    it('returns worldRenderTarget when in UI state', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      renderer.beginUI()
      // Bug-6 修复后：无论 World 还是 UI 阶段，始终返回 worldRenderTarget
      const snapshot = renderer.getRenderBufferSnapshot()
      const worldRT = (renderer as unknown as { worldRenderTarget: unknown }).worldRenderTarget
      expect(snapshot).toBe(worldRT)
    })

    it('returns null when nothing is initialized', () => {
      const fresh = new Renderer(document.createElement('canvas'))
      expect(fresh.getRenderBufferSnapshot()).toBeNull()
      fresh.dispose()
    })
  })

  // ========================================================================
  // 字体初始化
  // ========================================================================
  describe('font initialization', () => {
    it('initializeFonts is callable', () => {
      expect(() => renderer.initializeFonts({})).not.toThrow()
    })
  })

  // ========================================================================
  // GL / 显示器 信息存根
  // ========================================================================
  describe('GL and display info stubs', () => {
    it('returns WebGL2 profile', () => {
      expect(renderer.glProfile).toBe('WebGL2')
    })

    it('returns supported profiles', () => {
      expect(renderer.supportedGLProfiles).toEqual(['WebGL2', 'WebGL1'])
    })

    it('returns WebGL 2.0 version', () => {
      expect(renderer.glVersion).toBe('WebGL 2.0')
    })

    it('returns single display', () => {
      expect(renderer.displayCount).toBe(1)
      expect(renderer.currentDisplay).toBe(0)
    })
  })

  // ========================================================================
  // 调色板管理
  // ========================================================================
  describe('palette management', () => {
    it('accepts palette and stores reference', () => {
      const palette = { texture: 'tex-1', height: 256 }
      renderer.setPalette(palette)
      expect((renderer as unknown as { currentPaletteHeight: number }).currentPaletteHeight).toBe(256)
    })

    it('skips update when same palette texture and height', () => {
      const palette = { texture: 'tex-1', height: 256 }
      renderer.setPalette(palette)
      const batch: IBatchRenderer = { flush: vi.fn() }
      renderer.batchRenderer = batch
      renderer.setPalette(palette)
      expect(batch.flush).toHaveBeenCalledTimes(0)
    })

    it('flushes when palette changes', () => {
      const batch: IBatchRenderer = { flush: vi.fn() }
      renderer.batchRenderer = batch
      renderer.setPalette({ texture: 'tex-1', height: 256 })
      expect(batch.flush).toHaveBeenCalledTimes(1)
    })
  })

  // ========================================================================
  // renderWorldToScreen mesh/material 创建
  // ========================================================================
  describe('renderWorldToScreen', () => {
    beforeEach(() => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
    })

    it('creates quad via MeshBuilder.CreatePlane on first call', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      renderer.beginUI()
      expect(MeshBuilder.CreatePlane).toHaveBeenCalled()
    })

    it('creates StandardMaterial for world quad', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      renderer.beginUI()
      expect(StandardMaterial).toHaveBeenCalled()
    })

    it('reuses cached quad on subsequent calls', () => {
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      renderer.beginUI()
      const callCount = vi.mocked(MeshBuilder.CreatePlane).mock.calls.length

      renderer.endFrame()
      renderer.beginWorld({ x: 0, y: 0 }, { width: 400, height: 400 })
      renderer.beginUI()
      expect(MeshBuilder.CreatePlane).toHaveBeenCalledTimes(callCount)
    })
  })

  // ========================================================================
  // saveScreenshot Promise 解析
  // ========================================================================
  describe('saveScreenshot', () => {
    it('resolves to data url via CreateScreenshotUsingRenderTarget', async () => {
      const mockDataUrl = 'data:image/png;base64,abc123'
      vi.mocked(Tools.CreateScreenshotUsingRenderTarget).mockImplementation(
        (_engine: any, _camera: any, _size: any, callback?: (data: string) => void) => {
          callback?.(mockDataUrl)
        },
      )

      const result = await renderer.saveScreenshot()
      expect(result).toBe(mockDataUrl)
    })
  })

  // ========================================================================
  // createFrameBuffer 返回值
  // ========================================================================
  describe('createFrameBuffer', () => {
    it('returns a RenderTargetTexture', () => {
      const rt = renderer.createFrameBuffer({ width: 128, height: 128 })
      expect(rt).toBeDefined()
      expect(rt.dispose).toBeDefined()
    })
  })

  // ========================================================================
  // resize 事件触发
  // ========================================================================
  describe('resize event', () => {
    it('calls engine.resize when window resize fires', () => {
      window.dispatchEvent(new Event('resize'))
      expect(renderer.engine.resize).toHaveBeenCalled()
    })
  })

  // ========================================================================
  // 窗口/输入辅助 API
  // ========================================================================
  describe('window helpers', () => {
    it('grabWindowMouseFocus calls requestPointerLock', () => {
      renderer.grabWindowMouseFocus()
      expect(canvas.requestPointerLock).toHaveBeenCalled()
    })

    it('releaseWindowMouseFocus calls exitPointerLock', () => {
      renderer.releaseWindowMouseFocus()
      expect(document.exitPointerLock).toHaveBeenCalled()
    })

    it('tryOpenUrl opens window', () => {
      const spy = vi.spyOn(window, 'open').mockImplementation(() => null)
      renderer.tryOpenUrl('https://example.com')
      expect(spy).toHaveBeenCalledWith('https://example.com', '_blank')
      spy.mockRestore()
    })
  })

  // ========================================================================
  // 抗锯齿滤镜 API 状态检查
  // ========================================================================
  describe('antialiasing filter', () => {
    beforeEach(() => {
      renderer.setMaximumViewportSize({ width: 1024, height: 768 })
      renderer.beginWorld({ x: 0, y: 0 }, { width: 800, height: 600 })
      renderer.beginUI()
    })

    it('enableAntialiasingFilter requires UI render type', () => {
      expect(() => renderer.enableAntialiasingFilter()).not.toThrow()
    })

    it('disableAntialiasingFilter requires UI render type', () => {
      expect(() => renderer.disableAntialiasingFilter()).not.toThrow()
    })

    it('enableAntialiasingFilter throws when not in UI', () => {
      renderer.endFrame()
      expect(() => renderer.enableAntialiasingFilter()).toThrow('enableAntialiasingFilter called with renderType = None')
    })
  })

  // ========================================================================
  // Dispose 资源释放
  // ========================================================================
  describe('dispose', () => {
    it('disposes engine and scenes', () => {
      renderer.dispose()
      expect(renderer.worldScene.dispose).toHaveBeenCalled()
      expect(renderer.uiScene.dispose).toHaveBeenCalled()
      expect(renderer.engine.dispose).toHaveBeenCalled()
    })

    it('disposes render targets if created', () => {
      renderer.setMaximumViewportSize({ width: 512, height: 512 })
      renderer.dispose()
      expect(RenderTargetTexture).toHaveBeenCalled()
    })

    it('allows multiple dispose calls without error', () => {
      renderer.dispose()
      expect(() => renderer.dispose()).not.toThrow()
    })
  })

  // ========================================================================
  // beginFrame 空壳兼容性
  // ========================================================================
  describe('beginFrame compatibility stub', () => {
    it('is callable without error', () => {
      expect(() => renderer.beginFrame()).not.toThrow()
    })
  })
})
