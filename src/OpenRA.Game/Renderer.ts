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

import { FrameBuffer } from '../OpenRA.Platforms.Default/FrameBuffer'
import type { IFrameBuffer, Color } from '../OpenRA.Game/Graphics/PlatformInterfaces'

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
  /** 帧开始通知（替代 OpenRA IRenderer.BeginFrame） */
  beginFrame?(): void
  /** 帧结束通知（替代 OpenRA IRenderer.EndFrame） */
  endFrame?(): void
  /** 设置调色板（替代 OpenRA IRenderer.SetPalette） */
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
// 视口参数（供 SpriteRenderer 迁移后使用）
// ---------------------------------------------------------------------------

export interface ViewportParams {
  /** 降采样因子，对应 OpenRA WorldDownscaleFactor */
  downscale: number
  /** 视口宽度（逻辑像素） */
  width: number
  /** 视口高度（逻辑像素） */
  height: number
  /** 深度边距 */
  depthMargin: number
  /** 窗口缩放因子 */
  windowScale: number
}

// ---------------------------------------------------------------------------
// 调色板接口（HardwarePalette 迁移前的类型占位）
// ---------------------------------------------------------------------------

export interface IPalette {
  texture: unknown // TODO: HardwarePalette 迁移后替换为具体类型
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

  /**
   * 像素艺术缩放标志（默认启用，保持 OpenRA 像素艺术视觉风格）。
   * - true  → NEAREST 采样（锐利像素艺术）
   * - false → BILINEAR 采样（平滑抗锯齿）
   *
   * 对应 OpenRA 的 SpriteRenderer.EnablePixelArtScaling()。
   * 在 beginUI 的 world→screen 合成阶段应临时启用。
   */
  private pixelArtScaling = true

  /** 当前帧视口参数（供 SpriteRenderer 迁移后使用） */
  private currentViewportParams: ViewportParams | null = null

  /** 获取当前帧视口参数（供子渲染器读取） */
  get viewportParams(): ViewportParams | null {
    return this.currentViewportParams
  }

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
   *
   * 原始 OpenRA BeginFrame 职责与 Babylon.js 映射：
   *   1. Context.Clear()           → Babylon.js scene.render() 自动清除
   *   2. 创建/重建 screenBuffer    → 已移除（uiScene 直接渲染到 backbuffer）
   *   3. 创建/重建 screenSprite    → 已替换为 renderWorldToScreen() 的全屏 quad
   *   4. SpriteRenderer.SetViewportParams() → 子渲染器迁移后将在此处设置
   *   5. HiDPI 缩放计算            → 已在 beginWorld() 中通过 worldDownscaleFactor 处理
   *
   * Diff-6: 当前阶段主要作为 API 兼容性占位。
   * 子渲染器迁移后需在此处：
   *   - 根据 resolution / windowScale 计算 ViewportParams
   *   - 调用 spriteRenderer.setViewportParams(params)
   *   - 设置 worldCamera 的正交投影参数
   *
   * @param _viewportParams 视口参数（可选，供 SpriteRenderer 迁移后使用）
   */
  beginFrame(_viewportParams?: Partial<ViewportParams>): void {
    if (_viewportParams) {
      this.currentViewportParams = {
        downscale: _viewportParams.downscale ?? 1,
        width: _viewportParams.width ?? this.resolution.width,
        height: _viewportParams.height ?? this.resolution.height,
        depthMargin: _viewportParams.depthMargin ?? this.depthMargin,
        windowScale: _viewportParams.windowScale ?? this.windowScale,
      }
    }
    // 子渲染器迁移后：
    //   this.spriteRenderer?.setViewportParams(
    //     this.resolution, this.windowScale,
    //     this.currentViewportParams?.downscale ?? 1,
    //     this.currentViewportParams?.depthMargin ?? 0,
    //   )
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

    // 默认使用 NEAREST 采样以保持像素艺术锐利度。
    // enableAntialiasingFilter() / disableAntialiasingFilter() 可在运行时切换。
    const samplingMode = this.pixelArtScaling
      ? Texture.NEAREST_SAMPLINGMODE
      : Texture.BILINEAR_SAMPLINGMODE

    const rtName = 'worldRenderTarget'
    this.worldRenderTarget = new RenderTargetTexture(
      rtName,
      { width: size.width, height: size.height },
      this.worldScene,
      {
        generateMipMaps: false,
        generateDepthBuffer: true,
        samplingMode,
        format: Engine.TEXTUREFORMAT_RGBA,
      },
    )
    // Bug-3: 不再设置空 renderList 或推入 customRenderTargets。
    // 使用 camera.outputRenderTarget 机制驱动离屏渲染，
    // worldCamera.outputRenderTarget = rtt 会在场景渲染时自动将相机视角输出到 RTT。
  }

  /**
   * 将 worldRenderTarget 内容绘制到 UI 场景的全屏 quad 上。
   *
   * 坐标系与可见性分析（Babylon.js 9.x）：
   *   - MeshBuilder.CreatePlane 默认创建在 XY 平面，法线朝 +Z
   *   - uiCamera 位于 (0.5, 0.5, -10)，看向 (0.5, 0.5, 0)，视线沿 +Z 方向
   *   - plane 默认法线朝 +Z，相机看到的是平面背面
   *   - quad.rotation.x = Math.PI 将 plane 绕 X 轴旋转 180°，法线翻转为 -Z，
   *     使其正面正对相机视线方向（从 -Z 看 +Z）
   *   - 同时此旋转将 Y 轴翻转，纠正了 WebGL 纹理原点（左下角）与屏幕坐标（左上角）的差异
   *   - backFaceCulling = false 作为防御性保险
   *   - position.z = 1 位于目标点 z=0 后方，但在正交投影中不影响可见性
   */
  private renderWorldToScreen(): void {
    if (!this.worldRenderTarget) return

    // 缓存全屏 quad 与 material，避免每帧创建/销毁 GPU 资源
    if (!this.worldScreenQuad) {
      const quad = MeshBuilder.CreatePlane('worldQuad', { size: 2 }, this.uiScene)
      // 绕 X 轴旋转 180°：法线翻转为 -Z（正对相机）+ 翻转纹理 Y 轴
      quad.rotation.x = Math.PI

      const mat = new StandardMaterial('worldMat', this.uiScene)
      mat.diffuseTexture = this.worldRenderTarget
      mat.emissiveColor = new Color3(1, 1, 1)
      mat.disableLighting = true
      // 防御性：禁用背面剔除，确保 plane 在所有朝向下均可见
      mat.backFaceCulling = false
      quad.material = mat
      // Bug-10: uiCamera ortho 范围 [0,1]×[0,1]，视口中心在 (0.5, 0.5)。
      // CreatePlane 默认中心在 (0,0)，需位移到视口中心才能全屏显示。
      quad.position.x = 0.5
      quad.position.y = 0.5
      quad.position.z = 1

      this.worldScreenQuad = quad
      this.worldScreenMaterial = mat
    }
    // 注意：无需 else 分支更新 texture 引用 — ensureWorldRenderTarget 在重建
    // RTT 时已销毁 worldScreenQuad/worldScreenMaterial（设为 null），下次
    // renderWorldToScreen 必然进入 if 分支重建。缓存重建由 ensureWorldRenderTarget 负责。

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

    /**
   * 更新世界相机正交视口边界。
   *
   * 坐标系映射约定：
   *   - worldCamera 位于 (0, 50, 0)，看向 (0, 0, 0)，视线沿 -Y
   *   - 视平面为 XZ 平面（通过 orthoLeft/Right/Top/Bottom 控制）
   *   - OpenRA 2D X → 3D X，OpenRA 2D Y → 3D Z
   *   - 因此 orthoTop/orthoBottom 被赋予 OpenRA 的 Y 坐标
   *   - WorldRenderer 中放置的内容必须在 XZ 平面上（Y=0 作为 Z 坐标）
   *   - 此映射需在 WorldRenderer 集成时验证
   */
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
  setPalette(palette: IPalette): void {
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
  // 深度缓冲（OpenRA API 兼容性封装）
  //
  // 原始 OpenRA 通过 Context.EnableDepthBuffer() / Context.DisableDepthBuffer()
  // / Context.ClearDepthBuffer() 实际操作 OpenGL 深度状态。
  //
  // 在 Babylon.js 架构下：
  //   - scene.autoClearDepthAndStencil (默认 true) 每帧自动清除深度缓冲
  //   - 深度测试由 material.needDepthPrePass / mesh.renderingGroupId 按材质控制
  //   - 全局深度状态切换不再需要（Babylon.js 内部管理）
  //
  // 这些方法保留 flush() 以确保批次一致性，但不操作底层深度状态。
  // 如需精确控制特定渲染阶段的深度写入，请使用 material 级别的配置。
  // -----------------------------------------------------------------------
  enableDepthBuffer(): void {
    this.flush()
    // Babylon.js Scene 自动管理深度测试：深度写入由 material 级别控制
    // 默认情况下 scene.autoClearDepthAndStencil = true 保证每帧深度缓冲正确清除
  }

  disableDepthBuffer(): void {
    this.flush()
    // 如需禁用深度写入，推荐在对应的 material 上设置 disableDepthWrite = true
  }

  clearDepthBuffer(): void {
    this.flush()
    // Engine.runRenderLoop 每帧自动清除深度缓冲（scene.autoClearDepthAndStencil 默认为 true）
    // 如需在帧中立即清除深度缓冲，使用 scene 级别的深度清除机制
  }

  // -----------------------------------------------------------------------
  // 抗锯齿/像素艺术缩放滤镜
  // -----------------------------------------------------------------------
  /**
   * 启用抗锯齿滤镜（OpenRA EnablePixelArtScaling(false) 的等效）。
   *
   * 将 world→screen 合成纹理的采样模式切换为 BILINEAR，
   * 使放大后的图像平滑而非锐利。
   *
   * OpenRA 对照：SpriteRenderer.EnablePixelArtScaling(false)
   */
  enableAntialiasingFilter(): void {
    if (this.renderType !== RenderType.UI) {
      throw new Error(`enableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
    }
    this.flush()
    this.pixelArtScaling = false
    // 更新 RTT 采样模式为双线性（平滑）
    this.worldRenderTarget?.updateSamplingMode(Texture.BILINEAR_SAMPLINGMODE)
  }

  /**
   * 禁用抗锯齿滤镜（OpenRA EnablePixelArtScaling(true) 的等效）。
   *
   * 将 world→screen 合成纹理的采样模式切换为 NEAREST，
   * 保持像素艺术的锐利边缘。这是 OpenRA 的默认视觉风格。
   *
   * OpenRA 对照：SpriteRenderer.EnablePixelArtScaling(true)
   */
  disableAntialiasingFilter(): void {
    if (this.renderType !== RenderType.UI) {
      throw new Error(`disableAntialiasingFilter called with renderType = ${this.renderType}, expected UI`)
    }
    this.flush()
    this.pixelArtScaling = true
    // 更新 RTT 采样模式为最近邻（锐利像素艺术）
    this.worldRenderTarget?.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE)
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

  /**
   * 创建帧缓冲对象（替代 OpenRA Context.CreateFrameBuffer）。
   *
   * OpenRA 对照: Renderer.CreateFrameBuffer(Size s)
   *
   * 与原始 OpenRA 的关键差异:
   * - 原始：调用 Context.CreateFrameBuffer → 新 GL FBO + 新纹理 + FrameBuffer 包装
   * - 迁移：直接创建 FrameBuffer 实例，内部自动管理 RenderTargetTexture
   *
   * **调用者负责管理返回的 FrameBuffer 的生命周期**，
   * 包括在不再需要时调用 `.dispose()` 释放 GPU 内存。
   *
   * @param size — 帧缓冲尺寸（像素）。WebGL 2.0 支持 NPOT。
   * @param clearColor — 可选清除颜色 (RGBA 0-255)，默认 (0,0,0,0)。
   * @returns FrameBuffer 实例（实现 IFrameBuffer 接口）
   */
  createFrameBuffer(size: Size, clearColor?: Color): IFrameBuffer {
    return new FrameBuffer(size, this.engine, clearColor)
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

  /**
   * 设置 VSync（垂直同步）开关。
   *
   * **平台限制（Web 环境）**：浏览器自行控制 VSync 行为，JavaScript 无法手动启用/禁用。
   * `requestAnimationFrame` 的回调速率由浏览器调度器决定，始终与显示器刷新率同步。
   * 因此此方法在 Web 平台为空操作，仅保留 API 兼容性。
   *
   * 原始 OpenRA：通过 Window.Context.SetVSyncEnabled() 实际控制 SDL2/OpenGL 的 swap interval。
   *
   * @param enabled 原始语义：true = 启用 VSync（与显示器刷新率同步），false = 禁用（不限制帧率）
   */
  setVSyncEnabled(enabled: boolean): void {
    // Web 环境中 VSync 由浏览器控制，此处保留 API 兼容性
    void enabled
  }

  /**
   * 获取剪贴板文本内容。
   *
   * **功能退化（Web 平台限制）**：
   * Web 平台的 `navigator.clipboard.readText()` 是异步 API 且需要用户授予剪贴板读取权限，
   * 无法像原始 OpenRA（`Window.GetClipboardText()`）那样同步返回剪贴板内容。
   * 因此此方法始终返回空字符串以保留 API 兼容性。
   *
   * **推荐替代方案**：调用方应迁移到异步版本的剪贴板读取，例如通过浏览器的
   * `navigator.clipboard.readText()` 并在 paste 事件中处理。
   *
   * 原始 OpenRA：通过 SDL2 Window.GetClipboardText() 同步获取剪贴板文本。
   *
   * @returns 始终返回空字符串（Web 平台限制）
   */
  getClipboardText(): string {
    // 异步 API 无法同步返回，返回空字符串保留兼容性
    return ''
  }

  /**
   * 设置剪贴板文本内容。
   *
   * 使用 Web 平台的 `navigator.clipboard.writeText()` 异步 API。
   * 与原始 OpenRA 的同步 `Window.SetClipboardText()` 不同，此方法返回 Promise。
   *
   * @param text 要写入剪贴板的文本
   * @returns Promise<true> 成功；Promise<false> 失败（权限拒绝或浏览器不支持）
   */
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
  //
  // **API 语义差异（Web 平台限制）**：
  //   原始 OpenRA：SaveScreenshot() 从 screenBuffer.Texture 读取原始像素数据，
  //   提取屏幕矩形区域，编码为 PNG 后同步保存到本地文件路径。
  //   迁移版：使用 Babylon.js 内置的 Tools.CreateScreenshotUsingRenderTarget()
  //   通过 uiCamera 渲染一帧，异步返回 data URL (Promise<string>)。
  //
  //   关键差异：
  //     - 原始：同步写入磁盘文件
  //     - 迁移：异步返回 `data:image/png;base64,...` 格式的 data URL
  //     - 原始：从 screenBuffer 截图，迁移：从 uiCamera 渲染截图
  //   调用方需要处理 Promise 返回值和 data URL 格式。
  //
  //   如需保存到本地文件，可在返回的 data URL 上使用：
  //     const link = document.createElement('a')
  //     link.download = 'screenshot.png'
  //     link.href = dataUrl
  //     link.click()
  // -----------------------------------------------------------------------

  /**
   * 截取当前画面并返回 data URL。
   *
   * 使用 uiCamera 截图以包含 world quad + UI（与原始 screenBuffer 截图语义一致）。
   *
   * @returns Promise，解析为 `data:image/png;base64,...` 格式的 data URL
   */
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
    // 先停止渲染循环，防止销毁过程中回调再次触发访问已释放资源
    this.engine.stopRenderLoop()
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
