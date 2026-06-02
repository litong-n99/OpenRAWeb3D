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
  Mesh,
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
  // 离屏渲染目标（替代 OpenRA worldBuffer）
  // -----------------------------------------------------------------------
  private worldRenderTarget: RenderTargetTexture | null = null
  private worldRenderTargetSize: Size = { width: 0, height: 0 }

  // -----------------------------------------------------------------------
  // 全屏 quad 缓存（避免每帧创建/销毁 GPU 资源）
  // -----------------------------------------------------------------------
  private worldScreenQuad: Mesh | null = null
  private worldScreenMaterial: StandardMaterial | null = null

  /** 世界渲染降采样因子（OpenRA WorldDownscaleFactor） */
  worldDownscaleFactor = 1

  /** 世界帧缓冲尺寸（OpenRA WorldFrameBufferSize） */
  get worldFrameBufferSize(): Size {
    return { ...this.worldRenderTargetSize }
  }

  // -----------------------------------------------------------------------
  // 分辨率与缩放
  // -----------------------------------------------------------------------
  private lastWorldViewportSize: Size = { width: 0, height: 0 }
  private lastViewportLocation: Vec2 = { x: 0, y: 0 }
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

  /** 窗口缩放因子（来自 devicePixelRatio，响应 HiDPI） */
  windowScale: number
  nativeWindowScale: number

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

  initializeFonts(_modData: unknown): void {
    // TODO: 字体系统迁移后实现
    // 当前保留 API 兼容性存根
  }

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
    // 架构说明：采用方案B（RTT 离屏渲染）
    //   1. worldScene 通过 worldCamera.outputRenderTarget 渲染到 worldRenderTarget
    //   2. worldRenderTarget 通过全屏 quad 贴图进入 uiScene
    //   3. uiScene 渲染到 backbuffer
    // 因此 uiScene 需要正常清除（autoClear 保持默认 true），world 内容通过 quad 带入。
    this.worldScene = createScene(this.engine)
    this.uiScene = createScene(this.engine)

    // 创建相机
    this.worldCamera = this.createWorldCamera(CameraMode.Orthographic)
    this.uiCamera = this.createUICamera()

    // 绑定场景活跃相机（Bug-1: 构造函数中必须设置 activeCamera）
    this.worldScene.activeCamera = this.worldCamera
    this.uiScene.activeCamera = this.uiCamera

    // Diff-2: 从浏览器读取原生缩放因子
    this.nativeWindowScale = window.devicePixelRatio || 1
    this.windowScale = this.nativeWindowScale

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
  // UI 缩放
  // -----------------------------------------------------------------------
  setUIScale(scale: number): void {
    // Diff-2: windowScale = nativeWindowScale * UI 缩放系数
    this.windowScale = this.nativeWindowScale * scale
  }

  // -----------------------------------------------------------------------
  // 帧管理流程
  // -----------------------------------------------------------------------

  /**
   * 每帧开始时调用（替代 OpenRA BeginFrame）
   * 原始代码中负责：Context.Clear()、screenBuffer 重建、screenSprite 重建、
   * SpriteRenderer.SetViewportParams。
   *
   * 在 Babylon.js 架构下：
   *   - 缓冲清除由 scene.render() 自动处理
   *   - screenBuffer（screenRenderTarget）已移除，uiScene 直接渲染到 backbuffer
   *   - SpriteRenderer / 子渲染器迁移后将在此处设置 viewport 参数
   *
   * Diff-6: 当前为 API 兼容性空壳。子渲染器迁移后需在此处根据 resolution 和
   * windowScale 的变化更新子渲染器的视口参数（等效于原始 SetViewportParams）。
   */
  beginFrame(): void {
    // TODO: 子渲染器迁移后添加 SetViewportParams 等初始化逻辑
  }

  /**
   * 设置世界帧缓冲最大尺寸（替代 OpenRA SetMaximumViewportSize）
   */
  setMaximumViewportSize(size: Size): void {
    let worldBufferSize: Size

    if (this.depthMargin === 0) {
      const surfaceSize = this.resolution
      worldBufferSize = {
        width: nextPowerOf2(Math.min(size.width, 2 * surfaceSize.width)),
        height: nextPowerOf2(Math.min(size.height, 2 * surfaceSize.height)),
      }
    } else {
      worldBufferSize = {
        width: nextPowerOf2(size.width),
        height: nextPowerOf2(size.height),
      }
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

    // Diff-4: 保留 viewportLocation 的浮点精度用于子像素平滑滚动
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
      // Diff-4: 使用原始浮点 viewportLocation 计算相机边界，保留子像素精度
      const topLeft = {
        x: viewportLocation.x - viewportSize.width / 2,
        y: viewportLocation.y - viewportSize.height / 2,
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

      // Diff-3: 在解除 RTT 绑定前，先将 worldScene 渲染到 worldRenderTarget
      this.worldScene.render()

      // 解除 worldCamera 的 RTT 绑定，使其不再影响后续渲染
      this.worldCamera.outputRenderTarget = null

      // 将 worldRenderTarget 内容通过全屏 quad 绘制到 UI 场景
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

    // Diff-3: 渲染 UI 场景到 backbuffer
    // 在原始 OpenRA 中，screenBuffer 先被绑定，然后 UI 渲染到其中，
    // 最后 EndFrame 将 screenSprite 绘制到 backbuffer。
    // 在 Babylon.js 架构下，uiScene 直接渲染到 backbuffer，此调用替代了
    // 原始的 screen compositor + Present() 流程。
    this.uiScene.render()

    this.renderType = RenderType.None
  }

  // -----------------------------------------------------------------------
  // 渲染目标管理
  // -----------------------------------------------------------------------

  private ensureWorldRenderTarget(size: Size): void {
    this.worldRenderTarget?.dispose()
    // Bug-2: RTT 重建时同步销毁缓存的 quad/material，确保下次 renderWorldToScreen 重建
    this.worldScreenQuad?.dispose()
    this.worldScreenMaterial?.dispose()
    this.worldScreenQuad = null
    this.worldScreenMaterial = null

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
    // Bug-3: 不再设置空 renderList 或推入 customRenderTargets。
    // 使用 camera.outputRenderTarget 机制驱动离屏渲染，
    // worldCamera.outputRenderTarget = rtt 会在场景渲染时自动将相机视角输出到 RTT。
  }

  private renderWorldToScreen(): void {
    if (!this.worldRenderTarget) return

    // Bug-2: 缓存全屏 quad 与 material，避免每帧创建/销毁 GPU 资源
    if (!this.worldScreenQuad) {
      const quad = MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)
      // Bug-4: Y 轴翻转 — WebGL 纹理原点在左下角，屏幕坐标在左上角
      quad.rotation.x = Math.PI

      const mat = new StandardMaterial('worldMat', this.uiScene)
      mat.diffuseTexture = this.worldRenderTarget
      mat.emissiveColor = new Color3(1, 1, 1)
      mat.disableLighting = true
      // Bug-7: rotation.x = Math.PI 翻转后法线朝 -Z，相机从 -Z 看向 +Z，
      // 默认 backFaceCulling = true 会导致背面被剔除。禁用背面剔除确保可见。
      mat.backFaceCulling = false
      quad.material = mat
      quad.position.z = 1

      this.worldScreenQuad = quad
      this.worldScreenMaterial = mat
    } else {
      // RTT 重建后仅需更新 texture 引用
      if (this.worldScreenMaterial) {
        this.worldScreenMaterial.diffuseTexture = this.worldRenderTarget
      }
    }

    // Diff-5: 根据 worldRenderTarget 与屏幕分辨率的宽高比调整 quad scaling，
    // 避免画面拉伸。原始 OpenRA 中通过 bufferScale 精确控制 world→screen 映射。
    const quad = this.worldScreenQuad
    if (quad) {
      const res = this.resolution
      const worldW = this.worldRenderTargetSize.width
      const worldH = this.worldRenderTargetSize.height
      const screenAspect = res.width / res.height
      const worldAspect = worldW / worldH

      if (worldAspect > screenAspect) {
        // world 更宽，以宽度为基准，高度缩放
        quad.scaling.x = 1
        quad.scaling.y = screenAspect / worldAspect
      } else {
        // world 更高，以高度为基准，宽度缩放
        quad.scaling.x = worldAspect / screenAspect
        quad.scaling.y = 1
      }
    }
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

    // Diff-1: World 阶段的 scissor 需要根据 downscale 因子缩放
    const scissorRect = this.renderType === RenderType.World
      ? {
          x: Math.floor(r.x / this.worldDownscaleFactor),
          y: Math.floor(r.y / this.worldDownscaleFactor),
          width: Math.ceil(r.width / this.worldDownscaleFactor),
          height: Math.ceil(r.height / this.worldDownscaleFactor),
        }
      : r

    this.engine.enableScissor(scissorRect.x, scissorRect.y, scissorRect.width, scissorRect.height)

    this.scissorState.push(r)
  }

  disableScissor(): void {
    this.scissorState.pop()
    this.flush()

    if (this.scissorState.length > 0) {
      const r = this.scissorState[this.scissorState.length - 1]
      // Diff-1: World 阶段的 scissor 恢复时同样需要 downscale
      const scissorRect = this.renderType === RenderType.World
        ? {
            x: Math.floor(r.x / this.worldDownscaleFactor),
            y: Math.floor(r.y / this.worldDownscaleFactor),
            width: Math.ceil(r.width / this.worldDownscaleFactor),
            height: Math.ceil(r.height / this.worldDownscaleFactor),
          }
        : r
      this.engine.enableScissor(scissorRect.x, scissorRect.y, scissorRect.width, scissorRect.height)
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
  // 渲染缓冲快照（小地图等功能依赖）
  // -----------------------------------------------------------------------

  /**
   * 获取当前渲染缓冲快照。
   * 在 Babylon.js 架构下返回 worldRenderTarget 引用。
   * 调用者通常应在 world 渲染完成后（beginUI 之后）使用，此时 RTT 内容已稳定。
   */
  getRenderBufferSnapshot(): RenderTargetTexture | null {
    return this.worldRenderTarget
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
  // GL / 显示器 信息（Web 环境存根）
  // -----------------------------------------------------------------------

  get glProfile(): string {
    return 'WebGL2'
  }

  get supportedGLProfiles(): string[] {
    return ['WebGL2', 'WebGL1']
  }

  get glVersion(): string {
    return 'WebGL 2.0'
  }

  get displayCount(): number {
    return 1
  }

  get currentDisplay(): number {
    return 0
  }

  // -----------------------------------------------------------------------
  // 截图
  // -----------------------------------------------------------------------

  saveScreenshot(): Promise<string> {
    return new Promise((resolve) => {
      this.engine.onEndFrameObservable.addOnce(() => {
        // 使用 uiCamera 截图以包含 world quad + UI（与原始 screenBuffer 截图语义一致）
        Tools.CreateScreenshotUsingRenderTarget(
          this.engine,
          this.uiCamera,
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
    this.worldScreenQuad?.dispose()
    this.worldScreenMaterial?.dispose()
    this.worldRenderTarget?.dispose()
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

/** 计算不小于 n 的最小 2 的幂（Bug-5） */
function nextPowerOf2(n: number): number {
  if (n <= 1) return 1
  // 对于已经是 2 的幂的数，不递增（与 OpenRA Size.NextPowerOf2 行为一致）
  let p = 1
  while (p < n) {
    p <<= 1
  }
  return p
}

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
