/**
 * Renderer.ts — OpenRA 主渲染器到 Babylon.js 的迁移实现
 * OpenRA 对照: OpenRA.Game/Renderer.cs
 *
 * 核心范式转换:
 * - SDL2/OpenGL 上下文 → BABYLON.Engine + HTMLCanvasElement
 * - 手动 FBO 管理 → BABYLON.RenderTargetTexture
 * - 手动帧循环 → Engine.runRenderLoop()
 * - depthMargin 伪深度 → Babylon.js 3D 天然 Z 轴深度
 */

import {
  Engine,
  Scene,
  Camera,
  TargetCamera,
  Vector3,
  RenderTargetTexture,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Tools,
  Color3,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 渲染阶段（erasableSyntaxOnly 兼容：const 对象 + 类型别名）
// ---------------------------------------------------------------------------

export const RenderType = {
  None: 'None',
  World: 'World',
  UI: 'UI',
} as const
export type RenderType = (typeof RenderType)[keyof typeof RenderType]

// ---------------------------------------------------------------------------
// 批量渲染器接口（OpenRA IBatchRenderer 映射）
// ---------------------------------------------------------------------------

export interface IBatchRenderer {
  flush(): void
}

// ---------------------------------------------------------------------------
// 子渲染器接口（OpenRA IRenderer 映射）
// ---------------------------------------------------------------------------

export interface IRenderer {
  setPalette(palette: unknown): void
}

// ---------------------------------------------------------------------------
// 尺寸结构（兼容 OpenRA Size）
// ---------------------------------------------------------------------------

export interface Size {
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// 2D 向量（兼容 OpenRA int2/float2）
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// 裁剪矩形
// ---------------------------------------------------------------------------

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// 渲染器依赖注入接口（用于测试 mock）
// ---------------------------------------------------------------------------

export interface RendererDeps {
  createEngine?: (canvas: HTMLCanvasElement, antialias: boolean) => Engine
  createScene?: (engine: Engine) => Scene
  createRenderTargetTexture?: (name: string, size: Size, scene: Scene) => RenderTargetTexture
}

// ---------------------------------------------------------------------------
// 相机模式（erasableSyntaxOnly 兼容）
// ---------------------------------------------------------------------------

export const CameraMode = {
  Orthographic: 'Orthographic',
  Perspective: 'Perspective',
} as const
export type CameraMode = (typeof CameraMode)[keyof typeof CameraMode]

// ---------------------------------------------------------------------------
// 主渲染器类
// ---------------------------------------------------------------------------

/**
 * 职责:
 * 1. 管理 Babylon.js Engine 与 HTMLCanvasElement 生命周期
 * 2. 维护 worldScene / uiScene 双场景架构
 * 3. 管理 worldRenderTarget 离屏渲染（替代 OpenRA worldBuffer）
 * 4. 维护渲染状态机 (None → World → UI → None)
 * 5. 管理批量渲染器切换与裁剪状态栈
 * 6. 提供正交/透视相机切换能力
 */
export class Renderer {
  // -----------------------------------------------------------------------
  // 子渲染器占位（TODO: 后续模块实现后替换为真实类型）
  // -----------------------------------------------------------------------
  worldSpriteRenderer: unknown
  worldRgbaSpriteRenderer: unknown
  worldRgbaColorRenderer: unknown
  worldRenderers: IRenderer[] = []
  rgbaColorRenderer: unknown
  spriteRenderer: unknown
  rgbaSpriteRenderer: unknown

  // -----------------------------------------------------------------------
  // Babylon.js 核心对象
  // -----------------------------------------------------------------------
  readonly engine: Engine
  readonly canvas: HTMLCanvasElement
  readonly worldScene: Scene
  readonly uiScene: Scene

  // -----------------------------------------------------------------------
  // 相机系统
  // -----------------------------------------------------------------------
  worldCamera: TargetCamera
  uiCamera: TargetCamera
  private cameraMode: CameraMode = CameraMode.Orthographic

  // -----------------------------------------------------------------------
  // 离屏渲染目标（替代 OpenRA 双 FBO）
  // -----------------------------------------------------------------------
  private worldRenderTarget: RenderTargetTexture | null = null
  private worldRenderTargetSize: Size = { width: 0, height: 0 }
  private screenRenderTarget: RenderTargetTexture | null = null

  /** 世界渲染降采样因子（OpenRA WorldDownscaleFactor） */
  worldDownscaleFactor = 1

  // -----------------------------------------------------------------------
  // 分辨率与缩放
  // -----------------------------------------------------------------------
  private lastWorldViewportSize: Size = { width: 0, height: 0 }
  private lastViewportLocation: Vec2 = { x: 0, y: 0 }
  private lastBufferSize: Size = { width: -1, height: -1 }
  private lastWorldViewport: Rect = { x: 0, y: 0, width: 0, height: 0 }

  /** 窗口有效分辨率 */
  get resolution(): Size {
    return {
      width: this.engine.getRenderWidth(),
      height: this.engine.getRenderHeight(),
    }
  }

  /** 窗口原生分辨率 */
  get nativeResolution(): Size {
    return {
      width: this.canvas.width,
      height: this.canvas.height,
    }
  }

  /** 窗口缩放因子 */
  windowScale = 1
  nativeWindowScale = 1

  // -----------------------------------------------------------------------
  // 渲染状态
  // -----------------------------------------------------------------------
  private renderType: RenderType = RenderType.None
  private currentBatchRenderer: IBatchRenderer | null = null
  private depthMargin = 0

  /** 当前渲染阶段 */
  get currentRenderType(): RenderType {
    return this.renderType
  }

  /** 当前批量渲染器 */
  get batchRenderer(): IBatchRenderer | null {
    return this.currentBatchRenderer
  }

  set batchRenderer(value: IBatchRenderer | null) {
    if (this.currentBatchRenderer === value) return
    this.currentBatchRenderer?.flush()
    this.currentBatchRenderer = value
  }

  // -----------------------------------------------------------------------
  // 调色板状态
  // -----------------------------------------------------------------------
  private currentPaletteTexture: unknown = null
  currentPaletteHeight = 0

  // -----------------------------------------------------------------------
  // 裁剪状态栈（替代 OpenRA scissorState）
  // -----------------------------------------------------------------------
  private scissorState: Rect[] = []

  /** 裁剪状态栈深度 */
  get scissorDepth(): number {
    return this.scissorState.length
  }

  // -----------------------------------------------------------------------
  // 输入/窗口状态
  // -----------------------------------------------------------------------
  windowHasInputFocus = true
  windowIsSuspended = false

  // -----------------------------------------------------------------------
  // 字体（TODO: 后续 SpriteFont 模块实现）
  // -----------------------------------------------------------------------
  fonts: Map<string, unknown> = new Map()

  // -----------------------------------------------------------------------
  // 构造函数
  // -----------------------------------------------------------------------
  constructor(
    canvas: HTMLCanvasElement,
    deps: RendererDeps = {},
  ) {
    this.canvas = canvas

    const createEngine = deps.createEngine ?? ((c, a) => new Engine(c, a))
    const createScene = deps.createScene ?? ((e) => new Scene(e))

    this.engine = createEngine(canvas, true)

    // 双场景架构: worldScene 渲染游戏世界, uiScene 渲染 UI 覆盖层
    this.worldScene = createScene(this.engine)
    this.uiScene = createScene(this.engine)

    // uiScene 不清除 backbuffer，保留 worldScene 的渲染结果
    this.uiScene.autoClear = false
    this.uiScene.autoClearDepthAndStencil = false

    // 创建相机
    this.worldCamera = this.createWorldCamera(CameraMode.Orthographic)
    this.uiCamera = this.createUICamera()

    // 绑定 resize 事件
    window.addEventListener('resize', this.onResize)
  }

  // -----------------------------------------------------------------------
  // 相机工厂
  // -----------------------------------------------------------------------
  private createWorldCamera(mode: CameraMode): TargetCamera {
    const cam = new TargetCamera('worldCam', Vector3.Zero(), this.worldScene)

    if (mode === CameraMode.Orthographic) {
      cam.mode = Camera.ORTHOGRAPHIC_CAMERA
      cam.position = new Vector3(0, 50, 0)
      cam.setTarget(Vector3.Zero())
      // 初始化正交边界
      cam.orthoLeft = -10
      cam.orthoRight = 10
      cam.orthoTop = 10
      cam.orthoBottom = -10
    } else {
      cam.mode = Camera.PERSPECTIVE_CAMERA
      cam.position = new Vector3(0, 50, 0)
      cam.setTarget(Vector3.Zero())
    }

    return cam
  }

  private createUICamera(): TargetCamera {
    const cam = new TargetCamera('uiCam', Vector3.Zero(), this.uiScene)
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA
    cam.position = new Vector3(0.5, 0.5, -10)
    cam.setTarget(new Vector3(0.5, 0.5, 0))
    cam.orthoLeft = 0
    cam.orthoRight = 1
    cam.orthoTop = 1
    cam.orthoBottom = 0
    return cam
  }

  // -----------------------------------------------------------------------
  // 相机模式切换
  // -----------------------------------------------------------------------
  setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) return
    this.cameraMode = mode

    const oldCam = this.worldCamera
    this.worldCamera = this.createWorldCamera(mode)
    this.worldScene.activeCamera = this.worldCamera
    oldCam.dispose()

    // 正交模式下默认保持 RTS 传统俯视感
    if (mode === CameraMode.Orthographic) {
      this.worldCamera.position = new Vector3(0, 50, 0)
      this.worldCamera.setTarget(Vector3.Zero())
    }
  }

  getCameraMode(): CameraMode {
    return this.cameraMode
  }

  // -----------------------------------------------------------------------
  // 深度边距（OpenRA 兼容: 存储值但不再用于伪深度计算）
  // -----------------------------------------------------------------------
  setDepthMargin(margin: number): void {
    this.depthMargin = margin
  }

  getDepthMargin(): number {
    return this.depthMargin
  }

  // -----------------------------------------------------------------------
  // 帧管理流程
  // -----------------------------------------------------------------------

  /**
   * 每帧开始时调用（替代 OpenRA BeginFrame）
   * Babylon.js Engine.runRenderLoop() 内部已自动处理缓冲清除与深度重置，
   * 此方法主要处理分辨率变更时的缓冲区重建。
   */
  beginFrame(): void {
    const surfaceSize = this.resolution
    const scale = this.windowScale

    const bufferSize: Size = {
      width: Math.ceil(surfaceSize.width / scale),
      height: Math.ceil(surfaceSize.height / scale),
    }

    if (bufferSize.width !== this.lastBufferSize.width || bufferSize.height !== this.lastBufferSize.height) {
      // 重建 screen render target（如果需要）
      this.ensureScreenRenderTarget(surfaceSize)
      this.lastBufferSize = bufferSize
    }
  }

  /**
   * 设置世界帧缓冲最大尺寸（替代 OpenRA SetMaximumViewportSize）
   */
  setMaximumViewportSize(size: Size): void {
    let worldBufferSize: Size

    if (this.depthMargin === 0) {
      const surfaceSize = this.resolution
      worldBufferSize = {
        width: Math.min(size.width, 2 * surfaceSize.width),
        height: Math.min(size.height, 2 * surfaceSize.height),
      }
    } else {
      worldBufferSize = { ...size }
    }

    // 仅在尺寸变化时重建
    if (
      worldBufferSize.width !== this.worldRenderTargetSize.width ||
      worldBufferSize.height !== this.worldRenderTargetSize.height
    ) {
      this.ensureWorldRenderTarget(worldBufferSize)
      this.worldRenderTargetSize = worldBufferSize
      this.lastWorldViewport = { x: 0, y: 0, width: 0, height: 0 }
    }
  }

  /**
   * 进入世界渲染阶段（替代 OpenRA BeginWorld）
   */
  beginWorld(viewportLocation: Vec2, viewportSize: Size): void {
    if (this.renderType !== RenderType.None) {
      throw new Error(`beginWorld called with renderType = ${this.renderType}, expected RenderType.None`)
    }

    this.beginFrame()

    if (!this.worldRenderTarget) {
      throw new Error('beginWorld called before setMaximumViewportSize has been set')
    }

    const centerLocation = {
      x: Math.round(viewportLocation.x),
      y: Math.round(viewportLocation.y),
    }

    // 计算降采样因子
    if (
      viewportSize.width !== this.lastWorldViewportSize.width ||
      viewportSize.height !== this.lastWorldViewportSize.height ||
      viewportLocation.x !== this.lastViewportLocation.x ||
      viewportLocation.y !== this.lastViewportLocation.y
    ) {
      this.lastViewportLocation = { ...viewportLocation }
      this.lastWorldViewportSize = { ...viewportSize }

      const vw = viewportSize.width
      const vh = viewportSize.height
      const bw = this.worldRenderTargetSize.width
      const bh = this.worldRenderTargetSize.height

      this.worldDownscaleFactor = 1
      while (vw / this.worldDownscaleFactor > bw || vh / this.worldDownscaleFactor > bh) {
        this.worldDownscaleFactor++
      }
    }

    // 设置世界相机视口参数
    const rect: Rect = { x: centerLocation.x, y: centerLocation.y, width: viewportSize.width, height: viewportSize.height }
    if (
      rect.x !== this.lastWorldViewport.x ||
      rect.y !== this.lastWorldViewport.y ||
      rect.width !== this.lastWorldViewport.width ||
      rect.height !== this.lastWorldViewport.height
    ) {
      const topLeft = {
        x: centerLocation.x - Math.floor(viewportSize.width / 2),
        y: centerLocation.y - Math.floor(viewportSize.height / 2),
      }
      this.updateWorldCameraViewport(topLeft, this.worldRenderTargetSize, this.worldDownscaleFactor)
      this.lastWorldViewport = rect
    }

    // 绑定世界渲染目标: worldCamera 的输出将写入此 RTT
    this.worldCamera.outputRenderTarget = this.worldRenderTarget

    this.renderType = RenderType.World
  }

  /**
   * 进入 UI 渲染阶段（替代 OpenRA BeginUI）
   */
  beginUI(): void {
    if (this.renderType === RenderType.World) {
      // 完成世界渲染
      this.flush()

      // 解除 worldCamera 的 RTT 绑定，使其不再影响后续渲染
      this.worldCamera.outputRenderTarget = null

      // 将 worldRenderTarget 内容通过全屏 quad 绘制到屏幕
      this.renderWorldToScreen()
    } else {
      // 世界渲染被跳过
      this.beginFrame()
    }

    this.renderType = RenderType.UI
  }

  /**
   * 结束帧（替代 OpenRA EndFrame）
   */
  endFrame(): void {
    if (this.renderType !== RenderType.UI) {
      throw new Error(`endFrame called with renderType = ${this.renderType}, expected RenderType.UI`)
    }

    this.flush()

    // 渲染 screen compositor 到 backbuffer（如果需要）
    // Babylon.js Engine 已自动管理 backbuffer 交换

    this.renderType = RenderType.None
  }

  // -----------------------------------------------------------------------
  // 渲染目标管理
  // -----------------------------------------------------------------------

  private ensureWorldRenderTarget(size: Size): void {
    this.worldRenderTarget?.dispose()

    const rtName = 'worldRenderTarget'
    this.worldRenderTarget = new RenderTargetTexture(
      rtName,
      { width: size.width, height: size.height },
      this.worldScene,
      {
        generateMipMaps: false,
        generateDepthBuffer: true,
        samplingMode: Texture.BILINEAR_SAMPLINGMODE,
        format: Engine.TEXTUREFORMAT_RGBA,
      },
    )
    this.worldRenderTarget.renderList = []
    this.worldScene.customRenderTargets.push(this.worldRenderTarget)
  }

  private ensureScreenRenderTarget(size: Size): void {
    this.screenRenderTarget?.dispose()
    this.screenRenderTarget = new RenderTargetTexture(
      'screenRenderTarget',
      { width: size.width, height: size.height },
      this.uiScene,
      {
        generateMipMaps: false,
        generateDepthBuffer: true,
      },
    )
  }

  private renderWorldToScreen(): void {
    if (!this.worldRenderTarget) return

    // 创建一次性全屏 quad 将 worldRenderTarget 绘制到屏幕
    // 在实际完整实现中，此 quad 应被缓存以避免每帧重建
    const quad = MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)
    const mat = new StandardMaterial('worldMat', this.uiScene)
    mat.diffuseTexture = this.worldRenderTarget
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.disableLighting = true
    quad.material = mat
    quad.position.z = 1

    // 一帧后销毁此临时 quad（在实际生产代码中应使用持久化 mesh）
    this.uiScene.onAfterRenderObservable.addOnce(() => {
      quad.dispose()
      mat.dispose()
    })
  }

  private updateWorldCameraViewport(topLeft: Vec2, worldSize: Size, downscale: number): void {
    if (this.worldCamera.mode !== Camera.ORTHOGRAPHIC_CAMERA) return

    const w = worldSize.width / downscale
    const h = worldSize.height / downscale
    this.worldCamera.orthoLeft = topLeft.x
    this.worldCamera.orthoRight = topLeft.x + w
    this.worldCamera.orthoTop = topLeft.y
    this.worldCamera.orthoBottom = topLeft.y + h
    this.worldCamera.getViewMatrix()
  }

  // -----------------------------------------------------------------------
  // 调色板管理
  // -----------------------------------------------------------------------
  setPalette(palette: { texture: unknown; height: number }): void {
    if (this.currentPaletteTexture === palette.texture && this.currentPaletteHeight === palette.height) {
      return
    }

    this.flush()
    this.currentPaletteTexture = palette.texture
    this.currentPaletteHeight = palette.height

    // TODO: 子渲染器设置调色板
    // this.spriteRenderer?.setPalette(palette)
    // this.worldSpriteRenderer?.setPalette(palette)
    // this.worldRenderers.forEach(r => r.setPalette(palette))
  }

  // -----------------------------------------------------------------------
  // 批量渲染与绘制委托
  // -----------------------------------------------------------------------

  /** 强制刷新当前批量渲染器 */
  flush(): void {
    // 通过 setter 触发前一个 batchRenderer 的 flush（与 OpenRA 行为一致）
    this.batchRenderer = null
  }

  // -----------------------------------------------------------------------
  // 裁剪（Scissor）状态栈
  // -----------------------------------------------------------------------

  enableScissor(rect: Rect): void {
    let r = { ...rect }

    // 必须保持在当前裁剪矩形内部
    if (this.scissorState.length > 0) {
      const parent = this.scissorState[this.scissorState.length - 1]
      r = intersectRect(r, parent)
    }

    this.flush()

    // Babylon.js 中 RenderTargetTexture 不直接支持裁剪测试，
    // 世界渲染阶段的裁剪通过 Engine 级别的 scissor 实现。
    // 注意：在 World 渲染阶段，scissor 作用于当前绑定的 FBO。
    this.engine.enableScissor(r.x, r.y, r.width, r.height)

    this.scissorState.push(r)
  }

  disableScissor(): void {
    this.scissorState.pop()
    this.flush()

    if (this.scissorState.length > 0) {
      const rect = this.scissorState[this.scissorState.length - 1]
      this.engine.enableScissor(rect.x, rect.y, rect.width, rect.height)
    } else {
      this.engine.disableScissor()
    }
  }

  // -----------------------------------------------------------------------
  // 深度缓冲
  // -----------------------------------------------------------------------
  enableDepthBuffer(): void {
    this.flush()
    // Babylon.js Scene 自动管理深度测试，此处保留 API 兼容性
  }

  disableDepthBuffer(): void {
    this.flush()
  }

  clearDepthBuffer(): void {
    this.flush()
    // Engine.runRenderLoop 每帧自动清除深度缓冲
  }

  // -----------------------------------------------------------------------
  // 抗锯齿/像素艺术缩放滤镜
  // -----------------------------------------------------------------------
  enableAntialiasingFilter(): void {
    if (this.renderType !== RenderType.UI) {
      throw new Error(`enableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
    }
    this.flush()
    // TODO: 通过 Texture 的 samplingMode 控制
  }

  disableAntialiasingFilter(): void {
    if (this.renderType !== RenderType.UI) {
      throw new Error(`disableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
    }
    this.flush()
  }

  // -----------------------------------------------------------------------
  // 工厂方法（兼容 OpenRA 资源创建 API）
  // -----------------------------------------------------------------------

  createFrameBuffer(size: Size): RenderTargetTexture {
    return new RenderTargetTexture(
      'frameBuffer',
      { width: size.width, height: size.height },
      this.worldScene,
      false,
      true,
    )
  }

  // -----------------------------------------------------------------------
  // 窗口/输入辅助
  // -----------------------------------------------------------------------

  grabWindowMouseFocus(): void {
    this.canvas.requestPointerLock()
  }

  releaseWindowMouseFocus(): void {
    document.exitPointerLock()
  }

  setVSyncEnabled(enabled: boolean): void {
    // Web 环境中 VSync 由浏览器控制，此处保留 API 兼容性
    void enabled
  }

  getClipboardText(): string {
    // 异步 API 无法同步返回，返回空字符串保留兼容性
    return ''
  }

  async setClipboardText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  tryOpenUrl(url: string): boolean {
    window.open(url, '_blank')
    return true
  }

  // -----------------------------------------------------------------------
  // 截图
  // -----------------------------------------------------------------------

  saveScreenshot(): Promise<string> {
    return new Promise((resolve) => {
      this.engine.onEndFrameObservable.addOnce(() => {
        Tools.CreateScreenshotUsingRenderTarget(
          this.engine,
          this.worldCamera,
          { width: this.resolution.width, height: this.resolution.height },
          resolve,
        )
      })
    })
  }

  // -----------------------------------------------------------------------
  // Resize 处理
  // -----------------------------------------------------------------------

  private onResize = (): void => {
    this.engine.resize()
  }

  // -----------------------------------------------------------------------
  // 渲染循环启动
  // -----------------------------------------------------------------------

  /**
   * 启动渲染循环（替代 OpenRA 手动帧循环）
   * @param callback 每帧回调，接收 deltaTime（毫秒）
   */
  startRenderLoop(callback: (deltaTime: number) => void): void {
    this.engine.runRenderLoop(() => {
      callback(this.engine.getDeltaTime())
    })
  }

  /**
   * 停止渲染循环
   */
  stopRenderLoop(): void {
    this.engine.stopRenderLoop()
  }

  // -----------------------------------------------------------------------
  // 资源释放
  // -----------------------------------------------------------------------

  dispose(): void {
    window.removeEventListener('resize', this.onResize)
    this.worldRenderTarget?.dispose()
    this.screenRenderTarget?.dispose()
    this.worldCamera.dispose()
    this.uiCamera.dispose()
    this.worldScene.dispose()
    this.uiScene.dispose()
    this.engine.dispose()
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function intersectRect(a: Rect, b: Rect): Rect {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  }
}
