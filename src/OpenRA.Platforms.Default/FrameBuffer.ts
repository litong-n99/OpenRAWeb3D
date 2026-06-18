/**
 * FrameBuffer.ts — 帧缓冲到 RenderTargetTexture 的迁移实现
 * OpenRA 对照: OpenRA.Platforms.Default/FrameBuffer.cs
 *
 * 核心范式转换:
 * - OpenGL glGenFramebuffers + glFramebufferTexture2D → RenderTargetTexture 构造
 *   （自动管理 FBO + 颜色纹理 + 深度渲染缓冲）
 * - glBindFramebuffer → engine.bindFramebuffer() + viewport 管理
 * - glScissor + GL_SCISSOR_TEST → engine.enableScissor() / disableScissor()
 * - glDeleteFramebuffers + glDeleteRenderbuffers → rtt.dispose()
 * - FBO 完整性检查 → Babylon.js 内部自动处理
 * - Power-of-2 尺寸要求 → WebGL 2.0 NPOT 原生支持，仅对过大尺寸警告
 */

import {
  Engine,
  RenderTargetTexture,
  Constants,
} from '@babylonjs/core'

import {
  TextureScaleFilter,
  type IFrameBuffer,
  type ITexture,
  type Rectangle,
  type Size,
  type Color,
} from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// ITexture 轻量包装（RenderTargetTexture 内部纹理的 ITexture 适配器）
//
// 注意：完整的 ITexture 实现属于 TODO-2.8.3（Texture.ts 迁移）。
// 此包装器仅暴露 FrameBuffer 使用所需的基本操作，
// 部分方法（如 getData）在当前阶段为 TODO 占位。
// ---------------------------------------------------------------------------

/**
 * Babylon.js InternalTexture 的轻量类型投影。
 *
 * 仅包含 FrameBuffer 所需的 samplingMode 和 dispose 成员，
 * 避免直接依赖 `@babylonjs/core` 的 InternalTexture 类型定义。
 *
 * @internal — 不属于公共 API，FrameBuffer 内部使用
 */
interface InternalTextureRef {
  samplingMode: number
  dispose(): void
}

/**
 * RenderTargetTexture 内部纹理的 ITexture 适配器。
 *
 * 将 Babylon.js InternalTexture 包装为 OpenRA 兼容的 ITexture 接口。
 * 完整 ITexture 实现属于 TODO-2.8.3（Texture.ts 迁移）。
 *
 * @internal — 仅供 FrameBuffer 内部使用，不应直接实例化
 */
class FrameBufferTexture implements ITexture {
  private readonly _internalTexture: InternalTextureRef | null
  private readonly _size: Size
  private _disposed = false

  /**
   * 内部数据缓存（用于 mock getData / setData）。
   *
   * 在真实 GPU 环境中，setData 会通过 engine.updateTextureData() 上传数据，
   * getData 通过 engine.readPixels() 回读。在测试环境 (无 WebGL) 中，
   * 使用此缓存模拟数据流。
   *
   * @internal
   */
  private _dataCache: Uint8Array | null = null

  constructor(internalTexture: InternalTextureRef | null, size: Size) {
    this._internalTexture = internalTexture
    this._size = size
  }

  get size(): Size {
    return { width: this._size.width, height: this._size.height }
  }

  get scaleFilter(): TextureScaleFilter {
    if (this._disposed || !this._internalTexture) return TextureScaleFilter.Linear
    return this._internalTexture.samplingMode === Constants.TEXTURE_NEAREST_SAMPLINGMODE
      ? TextureScaleFilter.Nearest
      : TextureScaleFilter.Linear
  }

  set scaleFilter(value: TextureScaleFilter) {
    if (this._disposed || !this._internalTexture) return
    this._internalTexture.samplingMode =
      value === TextureScaleFilter.Nearest
        ? Constants.TEXTURE_NEAREST_SAMPLINGMODE
        : Constants.TEXTURE_BILINEAR_SAMPLINGMODE
  }

  /**
   * 上传 RGBA 颜色数据到纹理。
   *
   * ## 真实 GPU 实现路径 (TODO)
   *   1. engine.updateTextureData(this._internalTexture, colors, width, height)
   *   2. 如果尺寸变化，需要先重建纹理
   *
   * ## 当前 mock 实现
   *   在测试环境中，将数据缓存到 _dataCache 以便后续 getData() 验证。
   *   此行为允许通过 setData → getData 循环验证数据传递。
   *
   * @param colors — RGBA 颜色数据 (Uint8Array)
   * @param _width — 纹理宽度（忽略，RTT 尺寸固定）
   * @param _height — 纹理高度（忽略，RTT 尺寸固定）
   */
  setData(colors: Uint8Array, _width: number, _height: number): void {
    // TODO: 真实 GPU 实现 — engine.updateTextureData(this._internalTexture, colors, width, height)
    // Mock 实现: 缓存数据用于 getData 验证
    this._dataCache = new Uint8Array(colors)
  }

  setFloatData(_data: Float32Array, _width: number, _height: number): void {
    // TODO: 浮点纹理数据上传 — engine.updateTextureData with FLOAT type
  }

  setDataFromReadBuffer(_rect: Rectangle): void {
    // TODO: 从读取缓冲区复制数据 — 需要完整的 readPixels + upload 管线
  }

  /**
   * 从纹理读回像素数据。
   *
   * ## 真实 GPU 实现路径 (TODO)
   *   1. 绑定此 RT 纹理到临时 FBO
   *   2. engine.readPixels(0, 0, width, height) 回读
   *   3. 返回读回的 Uint8Array
   *
   * ## 当前 mock 实现
   *   返回之前通过 setData() 缓存的数据。如果未调用过 setData，
   *   回退到零填充数组（尺寸 = width * height * 4）。
   *
   *   此设计允许测试环境验证 setData → getData 循环。
   *
   * @returns Uint8Array — RGBA 像素数据
   */
  getData(): Uint8Array {
    if (this._dataCache) {
      return new Uint8Array(this._dataCache)
    }
    // 回退: 返回正确尺寸的零填充数组
    const pixelCount = this._size.width * this._size.height * 4
    return new Uint8Array(pixelCount)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._dataCache = null
    if (this._internalTexture) {
      this._internalTexture.dispose()
    }
  }
}

// ---------------------------------------------------------------------------
// 视口缓存类型
// ---------------------------------------------------------------------------

interface ViewportRect {
  x: number
  y: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// FrameBuffer 类
// ---------------------------------------------------------------------------

/**
 * 帧缓冲对象，封装离屏渲染目标。
 *
 * 对应 OpenRA FrameBuffer，实现 IFrameBuffer 接口。
 *
 * 核心职责:
 * 1. 管理 RenderTargetTexture（FBO + 颜色纹理 + 深度缓冲）
 * 2. Bind/Unbind 时保存/恢复视口状态
 * 3. 管理裁剪（scissor）测试状态
 * 4. 暴露底层颜色纹理以供读取/采样
 */
export class FrameBuffer implements IFrameBuffer {
  // ---------------------------------------------------------------------------
  // 公开属性
  // ---------------------------------------------------------------------------

  /** 帧缓冲尺寸 */
  readonly size: Size

  /** 颜色纹理（ITexture 适配器） */
  readonly texture: ITexture

  // ---------------------------------------------------------------------------
  // 私有状态
  // ---------------------------------------------------------------------------

  private readonly rtt: RenderTargetTexture
  private readonly engine: Engine
  private readonly clearColor: Color
  private disposed = false
  private scissored = false

  /**
   * 缓存的视口参数。
   * Bind() 时保存当前视口，Unbind() 时恢复。
   * null 表示尚未绑定过。
   */
  private cachedViewport: ViewportRect | null = null

  // ---------------------------------------------------------------------------
  // 构造函数（对应 OpenRA FrameBuffer(Size, ITextureInternal, Color)）
  // ---------------------------------------------------------------------------

  /**
   * 创建帧缓冲对象。
   *
   * OpenRA 对照: FrameBuffer(Size size, ITextureInternal texture, Color clearColor)
   *
   * 与 OpenRA 的关键差异:
   * - OpenRA 接受外部创建的 ITextureInternal 并附加到 FBO
   * - 迁移版在内部创建 RenderTargetTexture（自动管理颜色+深度）
   * - 原因: Babylon.js RenderTargetTexture 封装了完整的 FBO 生命周期
   *
   * @param size — 帧缓冲尺寸（像素）。OpenRA 要求 Power-of-2，WebGL 2.0 支持 NPOT。
   * @param engine — Babylon.js 引擎实例
   * @param clearColor — 清除颜色 (RGBA 0-255)，Bind() 时用于清除。默认 (0,0,0,0)=黑色。
   */
  constructor(
    size: Size,
    engine: Engine,
    clearColor: Color = { r: 0, g: 0, b: 0, a: 0 },
  ) {
    if (size.width <= 0 || size.height <= 0) {
      throw new Error(
        `FrameBuffer size (${size.width}x${size.height}) must be positive`,
      )
    }

    // NOTE: OpenRA 要求 size 为 2 的幂，否则抛出 InvalidDataException。
    // WebGL 2.0 原生支持 NPOT 纹理，因此不强制要求，但对过大尺寸发出警告。
    // 16k 是多数 GPU 的最大纹理尺寸上限（WebGL MAX_TEXTURE_SIZE）。
    // 使用 console.warn 而非抛出异常，因为此限制因设备而异。
    if (size.width > 16384 || size.height > 16384) {
      console.warn(
        `FrameBuffer size (${size.width}x${size.height}) exceeds typical limits. ` +
        'Consider reducing for performance.',
      )
    }

    this.size = { width: size.width, height: size.height }
    this.engine = engine
    this.clearColor = { ...clearColor }

    // 对应 OpenRA: glGenFramebuffers + glFramebufferTexture2D + glGenRenderbuffers
    // Babylon.js RenderTargetTexture 自动创建:
    //   - FBO 对象
    //   - 颜色附件纹理 (RGBA, UNSIGNED_BYTE)
    //   - 深度渲染缓冲 (或深度纹理，取决于配置)
    //   - 自动检查 FBO 完整性
    //
    // NOTE: scene 参数为 null 表示此 RTT 是独立 FBO（非场景级渲染目标）。
    //   Babylon.js 内部通过 Engine.LastCreatedEngine 获取引擎引用。
    //   FrameBuffer 构造时已持有 engine 引用，确保引擎在 RTT 之前存在。
    //   若将来 Babylon.js 版本废弃 scene=null 构造路径，可改为:
    //   engine.createRenderTargetTexture(name, size) 或
    //   通过内部 API 直接构造 RenderTargetWrapper。
    this.rtt = new RenderTargetTexture(
      'frameBuffer',
      { width: size.width, height: size.height },
      null,
      {
        generateMipMaps: false,
        generateDepthBuffer: true,
        generateStencilBuffer: false,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      },
    )

    // 包装内部纹理为 ITexture 适配器
    // HACK: getInternalTexture() 返回 Babylon.js InternalTexture 类型，
    // 此处向下转型为 InternalTextureRef（最小接口投影），
    // 避免 FrameBufferTexture 直接依赖 Babylon.js 完整类型定义。
    const internalTex = this.rtt.getInternalTexture() as InternalTextureRef | null
    this.texture = new FrameBufferTexture(internalTex, this.size)

    // 对应 OpenRA: 构造完成后 glBindFramebuffer(GL_FRAMEBUFFER, 0) 恢复默认缓冲
    // Babylon.js RenderTargetTexture 构造后默认不绑定，无需显式恢复
  }

  // ---------------------------------------------------------------------------
  // Bind / Unbind（对应 OpenRA FrameBuffer.Bind() / Unbind()）
  // ---------------------------------------------------------------------------

  /**
   * 绑定帧缓冲为当前渲染目标。
   *
   * OpenRA 对照: FrameBuffer.Bind()
   *
   * 执行步骤（与 OpenRA 一致）:
   * 1. 保存当前视口参数（用于 Unbind 时恢复）
   * 2. 绑定 FBO → engine.bindFramebuffer(this.rtt)
   * 3. 设置视口为 FBO 尺寸 → engine.setViewport(0, 0, size.W, size.H)
   * 4. 使用 clearColor 清除颜色+深度缓冲 → engine.clear()
   */
  bind(): void {
    if (this.disposed) {
      throw new Error('FrameBuffer is disposed')
    }

    // 步骤 1: 缓存当前视口（对应 OpenRA ViewportRectangle() / glGetIntegerv(GL_VIEWPORT)）
    const vp = this.engine.currentViewport ?? { x: 0, y: 0, width: 0, height: 0 }
    this.cachedViewport = {
      x: vp.x,
      y: vp.y,
      width: vp.width > 0 ? vp.width : this.engine.getRenderWidth(),
      height: vp.height > 0 ? vp.height : this.engine.getRenderHeight(),
    }

    // 步骤 2: 绑定 FBO（对应 OpenRA glBindFramebuffer(GL_FRAMEBUFFER, framebuffer)）
    this.engine.bindFramebuffer(this.rtt.renderTarget!)

    // 步骤 3: 设置视口（对应 OpenRA glViewport(0, 0, size.Width, size.Height)）
    this.engine.setViewport({
      x: 0,
      y: 0,
      width: this.size.width,
      height: this.size.height,
    })

    // 步骤 4: 清除缓冲（对应 OpenRA glClearColor + glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)）
    this.engine.clear(
      {
        r: this.clearColor.r / 255,
        g: this.clearColor.g / 255,
        b: this.clearColor.b / 255,
        a: this.clearColor.a / 255,
      },
      true, // color
      true, // depth
      false, // stencil
    )
  }

  /**
   * 解除帧缓冲绑定，恢复默认渲染目标。
   *
   * OpenRA 对照: FrameBuffer.Unbind()
   *
   * 执行步骤（与 OpenRA 一致）:
   * 1. 检查无活动的裁剪区域
   *    （与 OpenRA 完全一致——scissor 启用时禁止 Unbind，抛出异常）
   * 2. 恢复默认帧缓冲 → engine.bindFramebuffer(null)
   * 3. 恢复缓存的视口参数 → engine.setViewport(cached)
   *
   * @throws Error 如果裁剪区域仍然启用
   */
  unbind(): void {
    if (this.scissored) {
      throw new Error(
        'Attempting to unbind FrameBuffer with an active scissor region.',
      )
    }
    if (this.disposed) {
      throw new Error('FrameBuffer is disposed')
    }

    // 步骤 2: 恢复默认帧缓冲（对应 OpenRA glBindFramebuffer(GL_FRAMEBUFFER, 0)）
    this.engine.unBindFramebuffer(this.rtt.renderTarget!)

    // 步骤 3: 恢复缓存的视口（对应 OpenRA glViewport(cv[0], cv[1], cv[2], cv[3])）
    if (this.cachedViewport) {
      this.engine.setViewport(this.cachedViewport)
      this.cachedViewport = null
    }
  }

  // ---------------------------------------------------------------------------
  // 裁剪（Scissor）管理（对应 OpenRA FrameBuffer.EnableScissor / DisableScissor）
  // ---------------------------------------------------------------------------

  /**
   * 启用裁剪测试。
   *
   * OpenRA 对照: FrameBuffer.EnableScissor(Rectangle rect)
   *
   * 对应 OpenRA:
   *   glScissor(rect.X, rect.Y, Math.Max(rect.Width, 0), Math.Max(rect.Height, 0))
   *   glEnable(GL_SCISSOR_TEST)
   *
   * @param rect — 裁剪矩形（像素坐标）。负的宽/高会被钳位为 0。
   */
  enableScissor(rect: Rectangle): void {
    if (this.disposed) {
      throw new Error('FrameBuffer is disposed')
    }

    this.engine.enableScissor(
      rect.x,
      rect.y,
      Math.max(0, rect.width),
      Math.max(0, rect.height),
    )
    this.scissored = true
  }

  /**
   * 禁用裁剪测试。
   *
   * OpenRA 对照: FrameBuffer.DisableScissor()
   *
   * 对应 OpenRA: glDisable(GL_SCISSOR_TEST)
   */
  disableScissor(): void {
    if (this.disposed) {
      throw new Error('FrameBuffer is disposed')
    }

    this.engine.disableScissor()
    this.scissored = false
  }

  // ---------------------------------------------------------------------------
  // 资源释放（对应 OpenRA FrameBuffer.Dispose()）
  // ---------------------------------------------------------------------------

  /**
   * 释放帧缓冲及其关联的 GPU 资源。
   *
   * OpenRA 对照: FrameBuffer.Dispose()
   *
   * 对应 OpenRA 中的:
   *   - texture.Dispose()
   *   - glDeleteFramebuffers(1, ref framebuffer)
   *   - glDeleteRenderbuffers(1, ref depth)
   *
   * 在 Babylon.js 中，RenderTargetTexture.dispose() 内部处理所有 GL 资源释放。
   *
   * 此方法是幂等的——重复调用不会产生副作用（对应 OpenRA 的 disposed 检查）。
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // 如果裁剪仍启用，先禁用再释放
    if (this.scissored) {
      this.engine.disableScissor()
      this.scissored = false
    }

    // 先释放纹理适配器（标记 _disposed，防止访问已释放的 InternalTexture）
    this.texture.dispose()

    // 释放 RTT（内部释放 FBO + 颜色纹理 + 深度缓冲）
    this.rtt.dispose()
  }
}
