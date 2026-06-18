/**
 * Texture.ts — OpenRA 纹理到 Babylon.js RawTexture 的迁移实现
 * OpenRA 对照: OpenRA.Platforms.Default/Texture.cs
 *
 * 核心范式转换:
 * - glGenTextures + glTexImage2D + glTexParameteri → RawTexture 构造 + update()
 * - glTexParameteri (MAG_FILTER/MIN_FILTER/WRAP_S/T) → RawTexture 构造参数
 * - glCopyTexImage2D (SetDataFromReadBuffer) → engine.readPixels() (TODO)
 * - glGetTexImage / FBO+glReadPixels (GetData) → engine.readPixels() (TODO)
 * - Power-of-2 强制要求 → WebGL 2.0 NPOT 原生支持
 * - ThreadAffine 线程亲和验证 → 已移除（浏览器单线程）
 * - uint ID（OpenGL 纹理名称）→ babylonTexture.uniqueId
 * - TextureScaleFilter 属性 → samplingMode setter
 *
 * 关键设计:
 * - babylonTexture 属性是负载关键的 (load-bearing) —— Shader.ts 的
 *   getBabylonTexture() 通过鸭子类型检查此属性。如果缺少，setTexture() 将抛出运行时错误。
 * - 采用单一构造函数: (width, height, scaleFilter, engine, babylonTexture?)
 * - 可选的 babylonTexture 参数支持包装已存在的纹理，由 FrameBuffer 等组件使用。
 */

import {
  RawTexture,
  Engine,
  Constants,
} from '@babylonjs/core'

import {
  TextureScaleFilter,
  type ITexture,
  type Rectangle,
  type Size,
} from '../OpenRA.Game/Graphics/PlatformInterfaces'

import type { ITextureInternal } from './ITextureInternal'

// ---------------------------------------------------------------------------
// Texture — ITexture 和 ITextureInternal 接口的实现
//
// 对应 OpenRA sealed class Texture : ThreadAffine, ITextureInternal。
//
// 包装单个 BABYLON.RawTexture 实例，将 OpenRA 纹理操作
// 委托给 Babylon.js 的纹理管理 API。
//
// 生命周期:
//   1. 构造时创建 RawTexture（或包装已有的）
//   2. 通过 setData/setFloatData/setEmpty 上传数据
//   3. scaleFilter 属性控制采样模式
//   4. dispose() 清理 GPU 资源
//
// OpenRA 对照: Texture (Texture.cs:18-208)
// ---------------------------------------------------------------------------

export class Texture implements ITexture, ITextureInternal {
  // ---------------------------------------------------------------------------
  // 公开属性
  // ---------------------------------------------------------------------------

  /** 纹理尺寸 */
  private _size: Size

  /**
   * 底层 Babylon.js RawTexture（负载关键属性）。
   *
   * Shader.ts 的 getBabylonTexture() 通过鸭子类型检查此属性名称。
   * 如果修改此 getter 的名称，必须同步更新 Shader.ts 中的检查逻辑。
   */
  private _texture: RawTexture

  /** 纹理缩放过滤器 */
  private _scaleFilter: TextureScaleFilter

  /** 当前纹理数据类型（TEXTURETYPE_UNSIGNED_BYTE 或 TEXTURETYPE_FLOAT） */
  private _texType: number

  /** 引擎引用 */
  private readonly _engine: Engine

  /** 是否已销毁 */
  private _disposed = false

  // ---------------------------------------------------------------------------
  // 公开 getter/setter
  // ---------------------------------------------------------------------------

  /** 纹理尺寸（只读）。对应 OpenRA Texture.Size。 */
  get size(): Size {
    return { width: this._size.width, height: this._size.height }
  }

  /**
   * 纹理缩放过滤器。
   *
   * 对应 OpenRA Texture.ScaleFilter 属性。
   * 设置时更新底层 RawTexture 的 samplingMode。
   * 与 OpenRA 行为一致：如果新值与当前值相同则跳过更新。
   */
  get scaleFilter(): TextureScaleFilter {
    return this._scaleFilter
  }

  set scaleFilter(value: TextureScaleFilter) {
    if (this._disposed) return
    // 对应 OpenRA: if (scaleFilter == value) return;
    if (this._scaleFilter === value) return
    this._scaleFilter = value
    this.applySamplingMode()
  }

  /**
   * 底层 Babylon.js RawTexture 实例。
   *
   * 对应 OpenRA Texture.ID（OpenGL 纹理名称）。
   * 此属性是负载关键的 (load-bearing) —— Shader.ts 依赖此名称进行鸭子类型检查。
   *
   * @returns Babylon.js RawTexture 实例
   */
  get babylonTexture(): RawTexture {
    return this._texture
  }

  /**
   * 纹理标识符（用于调试/日志）。
   *
   * 对应 OpenRA ITextureInternal.ID（OpenGL uint 纹理名称）。
   * 迁移版使用 Babylon.js 的 uniqueId。
   */
  get id(): number {
    return this._texture.uniqueId
  }

  // ---------------------------------------------------------------------------
  // 构造函数（对应 OpenRA Texture()）
  //
  // NOTE: 与 OpenRA 的关键差异:
  // - OpenRA Texture() 无参数构造（仅调用 glGenTextures），尺寸在 SetData/SetEmpty 时设置
  // - 迁移版接受 width/height 参数以在构造时创建 RawTexture
  // - 原因: Babylon.js RawTexture 在构造时需要尺寸以分配 GPU 存储
  // - 可选的 babylonTexture 参数允许包装已存在的纹理（FrameBuffer 使用场景）
  // ---------------------------------------------------------------------------

  /**
   * 创建纹理实例。
   *
   * OpenRA 对照: Texture() 构造函数 (Texture.cs:43-47)
   *
   * @param width — 纹理宽度（像素）
   * @param height — 纹理高度（像素）
   * @param scaleFilter — 缩放过滤器（Nearest 或 Linear）
   * @param engine — Babylon.js Engine 实例
   * @param babylonTexture — 可选，已存在的 RawTexture 用于包装（不创建新纹理）
   */
  constructor(
    width: number,
    height: number,
    scaleFilter: TextureScaleFilter,
    engine: Engine,
    babylonTexture?: RawTexture,
  ) {
    if (width <= 0 || height <= 0) {
      throw new Error(
        `Texture size (${width}x${height}) must be positive`,
      )
    }

    this._size = { width, height }
    this._scaleFilter = scaleFilter
    this._engine = engine
    this._texType = Constants.TEXTURETYPE_UNSIGNED_BYTE

    if (babylonTexture) {
      // 包装已存在的纹理（FrameBuffer 使用场景）
      // NOTE: 假设包装的纹理为 RGBA BYTE 格式。若包装浮点纹理，
      // 调用方应确保不在同一 Texture 实例上混用 setData 和 setFloatData。
      this._texture = babylonTexture
      this.applySamplingMode()
    } else {
      // 对应 OpenRA: glGenTextures + PrepareTexture
      // 创建空 RawTexture（GL_CLAMP_TO_EDGE 是 Babylon.js 默认行为）
      this._texture = new RawTexture(
        null, // 空数据，后续通过 setData/setEmpty 填充
        width,
        height,
        Constants.TEXTUREFORMAT_RGBA,
        engine,
        false, // 无 Mipmap（对应 OpenRA TEXTURE_MAX_LEVEL=0）
        false, // 不翻转 Y（与 OpenRA BGRA 上传一致）
        scaleFilterToSamplingMode(scaleFilter),
        Constants.TEXTURETYPE_UNSIGNED_BYTE,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // setData（对应 OpenRA Texture.SetData(byte[], int, int)）
  // ---------------------------------------------------------------------------

  /**
   * 上传 RGBA 颜色数据到纹理。
   *
   * 对应 OpenRA Texture.SetData(byte[] colors, int width, int height)。
   *
   * 与 OpenRA 的关键差异:
   * - OpenRA 强制要求 Power-of-2 尺寸，抛出 InvalidDataException
   * - 迁移版允许 NPOT 尺寸（WebGL 2.0 原生支持），仅在控制台警告非标准尺寸
   * - OpenRA 使用 GL_BGRA 内部格式 → 迁移版使用 TEXTUREFORMAT_RGBA
   *
   * @param colors — RGBA 颜色数据（Uint8Array, 长度 = width * height * 4）
   * @param width — 纹理宽度（像素）
   * @param height — 纹理高度（像素）
   */
  setData(colors: Uint8Array, width: number, height: number): void {
    this.ensureNotDisposed()

    if (width <= 0 || height <= 0) {
      throw new Error(
        `Texture setData size (${width}x${height}) must be positive`,
      )
    }

    const expectedSize = width * height * 4
    if (colors.length < expectedSize) {
      throw new Error(
        `Data size mismatch: expected ${expectedSize} bytes for ${width}x${height}, ` +
        `got ${colors.length}`,
      )
    }

    // 如果尺寸变化或类型不匹配（例如之前调用过 setFloatData），
    // 重建纹理。RawTexture.update() 不支持调整尺寸或更改数据类型。
    if (width !== this._size.width || height !== this._size.height ||
        this._texType !== Constants.TEXTURETYPE_UNSIGNED_BYTE) {
      this.recreateTexture(width, height)
    }

    // 对应 OpenRA: glTexImage2D(GL_TEXTURE_2D, 0, internalFormat, w, h, 0, GL_BGRA, GL_UNSIGNED_BYTE, data)
    // NOTE: OpenRA 使用 BGRA 格式（由 SDL2 表面决定），
    // Web 环境中通常使用 RGBA。若需要 BGRA→RGBA 交换，由调用方负责。
    this._texture.update(colors)
  }

  // ---------------------------------------------------------------------------
  // setFloatData（对应 OpenRA Texture.SetFloatData(float[], int, int)）
  // ---------------------------------------------------------------------------

  /**
   * 上传浮点数据到纹理。
   *
   * 对应 OpenRA Texture.SetFloatData(float[] data, int width, int height)。
   *
   * OpenRA 使用 GL_RGBA16F 内部格式 + GL_FLOAT 类型。
   * 迁移版使用 TEXTURETYPE_FLOAT，Babylon.js 自动选择适当的内部格式。
   *
   * @param data — 浮点数据（Float32Array，长度 = width * height * 4）
   * @param width — 纹理宽度（像素）
   * @param height — 纹理高度（像素）
   */
  setFloatData(data: Float32Array, width: number, height: number): void {
    this.ensureNotDisposed()

    if (width <= 0 || height <= 0) {
      throw new Error(
        `Texture setFloatData size (${width}x${height}) must be positive`,
      )
    }

    const expectedSize = width * height * 4
    if (data.length < expectedSize) {
      throw new Error(
        `Float data size mismatch: expected ${expectedSize} floats for ${width}x${height}, ` +
        `got ${data.length}`,
      )
    }

    // 如果尺寸变化或纹理类型不匹配，重建纹理
    const needsRecreate =
      width !== this._size.width ||
      height !== this._size.height ||
      this._texType !== Constants.TEXTURETYPE_FLOAT

    if (needsRecreate) {
      this.recreateTextureWithType(
        width, height, Constants.TEXTURETYPE_FLOAT,
      )
    }

    // 对应 OpenRA: glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA16F, w, h, 0, GL_RGBA, GL_FLOAT, data)
    this._texture.update(data)
  }

  // ---------------------------------------------------------------------------
  // setDataFromReadBuffer（对应 OpenRA Texture.SetDataFromReadBuffer(Rectangle)）
  // ---------------------------------------------------------------------------

  /**
   * 从当前帧缓冲读取像素数据到纹理。
   *
   * 对应 OpenRA Texture.SetDataFromReadBuffer(Rectangle rect)。
   * OpenRA 使用 glCopyTexImage2D 从当前绑定的帧缓冲复制像素。
   *
   * NOTE: WebGL 2.0 不支持 glCopyTexImage2D 到纹理的等效操作。
   * 替代方案是 engine.readPixels() + 然后 setData() 上传。
   * 此方法当前阶段为占位实现。
   *
   * TODO: 需要 engine.readPixels() 实现（从当前帧缓冲读取）。
   *
   * @param _rect — 源矩形（像素坐标）。暂未使用，占位等待 readPixels 实现。
   */
  setDataFromReadBuffer(_rect: Rectangle): void {
    this.ensureNotDisposed()
    // 对应 OpenRA: glCopyTexImage2D(GL_TEXTURE_2D, 0, internalFormat, x, y, w, h, 0)
    // NOTE: WebGL 2.0 无直接对应。需通过 readPixels + 重新上传实现。
    // 参考: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/readPixels
    console.warn(
      'Texture.setDataFromReadBuffer: not implemented in WebGL migration. ' +
      'Use setData() with data from engine.readPixels() instead.',
    )
  }

  // ---------------------------------------------------------------------------
  // getData（对应 OpenRA Texture.GetData()）
  // ---------------------------------------------------------------------------

  /**
   * 从 GPU 读回纹理数据。
   *
   * 对应 OpenRA Texture.GetData()。
   * OpenRA 桌面 GL 使用 glGetTexImage，GLES 通过 FBO + glReadPixels 回读。
   *
   * NOTE: WebGL 2.0 不支持 glGetTexImage。
   * 替代方案需要绑定纹理到 FBO 然后 readPixels。
   * 此方法当前阶段返回空数据。
   *
   * TODO: 需要完整的 FBO 绑定 + readPixels 实现。
   *
   * @returns 空 Uint8Array（占位）
   */
  getData(): Uint8Array {
    this.ensureNotDisposed()
    // 对应 OpenRA:
    //   桌面 GL: glGetTexImage(GL_TEXTURE_2D, 0, GL_BGRA, GL_UNSIGNED_BYTE, data)
    //   GLES: 绑定 FBO → glReadPixels → 可能的 R/B 交换
    // NOTE: WebGL 2.0 要求通过 FBO + readPixels 回读纹理数据。
    //   此处返回空数组直到实现完整的回读管线。
    console.warn(
      'Texture.getData: not implemented in WebGL migration. ' +
      'Requires FBO binding + readPixels pipeline.',
    )
    const pixelCount = this._size.width * this._size.height * 4
    return new Uint8Array(pixelCount)
  }

  // ---------------------------------------------------------------------------
  // setEmpty（对应 OpenRA ITextureInternal.SetEmpty(int, int)）
  // ---------------------------------------------------------------------------

  /**
   * 分配未初始化的纹理存储空间。
   *
   * 对应 OpenRA ITextureInternal.SetEmpty(int width, int height)。
   *
   * @param width — 纹理宽度（像素）
   * @param height — 纹理高度（像素）
   */
  setEmpty(width: number, height: number): void {
    this.ensureNotDisposed()

    if (width <= 0 || height <= 0) {
      throw new Error(
        `Texture setEmpty size (${width}x${height}) must be positive`,
      )
    }

    // 对应 OpenRA: glTexImage2D(GL_TEXTURE_2D, 0, internalFormat, w, h, 0, GL_BGRA, GL_UNSIGNED_BYTE, IntPtr.Zero)
    // 通过重新创建 data=null 的 RawTexture 实现等效行为
    this._size = { width, height }
    this._texType = Constants.TEXTURETYPE_UNSIGNED_BYTE
    const oldTexture = this._texture

    this._texture = new RawTexture(
      null,
      width,
      height,
      Constants.TEXTUREFORMAT_RGBA,
      this._engine,
      false,
      false,
      scaleFilterToSamplingMode(this._scaleFilter),
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    )

    // 确保新纹理的采样模式与当前 _scaleFilter 一致
    this.applySamplingMode()

    // 释放旧纹理的 GPU 资源
    oldTexture.dispose()
  }

  // ---------------------------------------------------------------------------
  // dispose（对应 OpenRA Texture.Dispose()）
  // ---------------------------------------------------------------------------

  /**
   * 释放纹理的 GPU 资源。
   *
   * 对应 OpenRA Texture.Dispose()，内部调用 glDeleteTextures。
   *
   * 幂等操作 —— 重复调用不会产生副作用。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this._texture.dispose()
  }

  // ---------------------------------------------------------------------------
  // 私有辅助方法
  // ---------------------------------------------------------------------------

  /** 检查是否已销毁，已销毁则抛出异常 */
  private ensureNotDisposed(): void {
    if (this._disposed) {
      throw new Error(
        'Texture has been disposed. ' +
        '(对应 OpenRA ObjectDisposedException)',
      )
    }
  }

  /** 将当前 scaleFilter 应用到纹理的 samplingMode */
  private applySamplingMode(): void {
    if (this._disposed || !this._texture) return
    // 对应 OpenRA PrepareTexture() 中的:
    //   glTexParameteri(GL_TEXTURE_MAG_FILTER, filter)
    //   glTexParameteri(GL_TEXTURE_MIN_FILTER, filter)
    //   glTexParameterf(GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
    //   glTexParameterf(GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
    //   glTexParameteri(GL_TEXTURE_BASE_LEVEL, 0)
    //   glTexParameteri(GL_TEXTURE_MAX_LEVEL, 0)
    //
    // Babylon.js RawTexture 构造时已设置 CLAMP_TO_EDGE 和 BASE_LEVEL=0。
    // 此处更新采样模式。
    this._texture.updateSamplingMode(
      scaleFilterToSamplingMode(this._scaleFilter),
    )
  }

  /**
   * 按指定尺寸重建 RGBA UNSIGNED_BYTE 纹理。
   *
   * 对应 OpenRA 中重新调用 glTexImage2D 改变纹理尺寸的行为。
   */
  private recreateTexture(width: number, height: number): void {
    this._size = { width, height }
    this._texType = Constants.TEXTURETYPE_UNSIGNED_BYTE
    const oldTexture = this._texture

    this._texture = new RawTexture(
      null,
      width,
      height,
      Constants.TEXTUREFORMAT_RGBA,
      this._engine,
      false,
      false,
      scaleFilterToSamplingMode(this._scaleFilter),
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    )

    // 确保新纹理的采样模式与当前 _scaleFilter 一致
    // （构造时已设置，此处为防御性调用）
    this.applySamplingMode()

    oldTexture.dispose()
  }

  /**
   * 按指定尺寸和数据类型重建纹理。
   *
   * 用于 setFloatData 需要改变尺寸或从 BYTE 切换到 FLOAT 类型的场景。
   */
  private recreateTextureWithType(
    width: number,
    height: number,
    type: number,
  ): void {
    this._size = { width, height }
    this._texType = type
    const oldTexture = this._texture

    this._texture = new RawTexture(
      null,
      width,
      height,
      Constants.TEXTUREFORMAT_RGBA,
      this._engine,
      false,
      false,
      scaleFilterToSamplingMode(this._scaleFilter),
      type,
    )

    // 确保新纹理的采样模式与当前 _scaleFilter 一致
    this.applySamplingMode()

    oldTexture.dispose()
  }
}

// ---------------------------------------------------------------------------
// 模块级辅助函数
// ---------------------------------------------------------------------------

/**
 * 将 OpenRA TextureScaleFilter 映射到 Babylon.js samplingMode 常量。
 *
 * 对应 OpenRA PrepareTexture() 中的:
 *   var filter = scaleFilter == TextureScaleFilter.Linear ? GL_LINEAR : GL_NEAREST
 *
 * @param filter — OpenRA 纹理缩放过滤器
 * @returns Babylon.js samplingMode 常量
 */
function scaleFilterToSamplingMode(filter: TextureScaleFilter): number {
  return filter === TextureScaleFilter.Nearest
    ? Constants.TEXTURE_NEAREST_SAMPLINGMODE
    : Constants.TEXTURE_BILINEAR_SAMPLINGMODE
}
