/**
 * VertexBuffer.ts — OpenRA 顶点缓冲到 Babylon.js Buffer/VertexBuffer 的迁移实现
 * OpenRA 对照: OpenRA.Platforms.Default/VertexBuffer.cs
 *
 * 核心范式转换:
 * - glGenBuffers + glBufferData + glBufferSubData → Babylon.js Buffer 构造 + updateDirectly
 * - glBindBuffer(GL_ARRAY_BUFFER, buffer) → bind() 为 no-op（Babylon.js Mesh 自动管理）
 * - ThreadAffine 线程亲和验证 → 已移除（浏览器单线程）
 * - Marshal.SizeOf<T>() 自动计算顶点大小 → 显式 stride 参数
 * - C# 泛型 struct 约束 (where T : struct) → TypeScript Float32Array 数据存储
 * - GL_DYNAMIC_DRAW / GL_STATIC_DRAW → Buffer 构造时 updatable 参数
 *
 * 关键设计决策:
 * - 不使用 C# 风格的泛型 VertexBuffer<T>。
 *   原因: TypeScript 在运行时擦除类型，无法像 C# 那样获取泛型结构的字节大小。
 *   所有顶点数据以 Float32Array（GPU 就绪格式）传入。
 * - bind() 为 no-op。
 *   原因: Babylon.js Mesh + ShaderMaterial 在渲染时自动绑定顶点属性和缓冲区。
 *   无需手动调用 glBindBuffer 或 glVertexAttribPointer。
 * - 属性描述符 (attributes) 在构造时存储，供外部代码查询顶点布局。
 */

import {
  Buffer,
  Engine,
} from '@babylonjs/core'

import type {
  IVertexBuffer,
  ShaderVertexAttribute,
} from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// VertexBuffer — IVertexBuffer<number> 接口的实现
//
// 对应 OpenRA sealed class VertexBuffer<T> : ThreadAffine, IDisposable,
//   IVertexBuffer<T> where T : struct。
//
// 包装 Babylon.js Buffer 实例。数据以 Float32Array 存储。
//
// 生命周期:
//   1. 构造时创建 Babylon.js Buffer + 上传初始数据
//   2. 通过 setData 更新全部/部分缓冲区数据
//   3. bind() 为 no-op
//   4. dispose() 清理 GPU 资源
//
// OpenRA 对照: VertexBuffer (VertexBuffer.cs:17-124)
// ---------------------------------------------------------------------------

export class VertexBuffer implements IVertexBuffer<number> {
  // ---------------------------------------------------------------------------
  // 公开属性
  // ---------------------------------------------------------------------------

  /** 顶点跨距（字节）。对应 OpenRA 的 static readonly VertexSize。 */
  readonly stride: number

  /** 顶点属性描述符数组。对应 OpenRA ShaderBindings.Attributes。 */
  readonly attributes: readonly ShaderVertexAttribute[]

  /** 引擎引用 */
  readonly engine: Engine

  // ---------------------------------------------------------------------------
  // 私有状态
  // ---------------------------------------------------------------------------

  /** 内部 Float32Array 数据副本 */
  private _data: Float32Array

  /** Babylon.js Buffer 实例 */
  private _buffer: Buffer | null

  /** 是否可动态更新 */
  private readonly _dynamic: boolean

  /** 是否已销毁 */
  private _disposed = false

  /** 顶点数量 = data.length / (stride / 4) */
  private _vertexCount: number

  // ---------------------------------------------------------------------------
  // 构造函数（对应 OpenRA VertexBuffer(T[] data, bool dynamic = true)）
  //
  // NOTE: 与 OpenRA VertexBuffer(int size) 的差异:
  // - OpenRA 具有第二个构造函数 VertexBuffer(int size)，创建未初始化的缓冲区并置零
  // - 迁移版不实现此重载。如需未初始化的缓冲区，可传入预置零的 Float32Array
  // - 原因: TypeScript 无法在运行时获取泛型结构的字节大小以自动计算缓冲区容量
  // ---------------------------------------------------------------------------

  /**
   * 创建顶点缓冲对象。
   *
   * OpenRA 对照: VertexBuffer(T[] data, bool dynamic = true) 构造函数
   *   (VertexBuffer.cs:58-77)
   *
   * 执行步骤（与 OpenRA 一致）:
   * 1. 分配 GPU 缓冲区 → new Buffer(engine, data, dynamic)
   * 2. 上传初始数据 → 由 Buffer 构造处理
   *
   * @param data — 顶点数据（Float32Array，GPU 就绪的扁平布局）
   * @param stride — 单个顶点的字节跨距（对应 Marshal.SizeOf<T>()）
   * @param attributes — 顶点属性布局描述符数组
   * @param engine — Babylon.js Engine 实例
   * @param dynamic — 缓冲区是否可动态更新。默认 true（对应 OpenRA GL_DYNAMIC_DRAW）
   */
  constructor(
    data: Float32Array,
    stride: number,
    attributes: readonly ShaderVertexAttribute[],
    engine: Engine,
    dynamic = true,
  ) {
    if (stride <= 0) {
      throw new Error(
        `VertexBuffer stride (${stride}) must be positive. ` +
        '(对应 OpenRA: 无效的顶点大小)',
      )
    }
    if (data.length === 0) {
      throw new Error(
        'VertexBuffer data must not be empty. ' +
        '(对应 OpenRA: 空顶点数组不合法)',
      )
    }

    this.stride = stride
    this.attributes = [...attributes]
    this.engine = engine
    this._dynamic = dynamic
    this._data = new Float32Array(data)

    // 计算顶点数量: 每个顶点占用 stride 字节 = stride/4 个 float
    const floatsPerVertex = stride / 4
    this._vertexCount = Math.floor(data.length / floatsPerVertex)

    // 验证数据长度是完整顶点数的整数倍
    if (data.length % floatsPerVertex !== 0) {
      console.warn(
        `VertexBuffer data length (${data.length}) is not a multiple of ` +
        `floats-per-vertex (${floatsPerVertex}). ${data.length % floatsPerVertex} ` +
        'trailing floats will be ignored.',
      )
    }

    // 对应 OpenRA: glGenBuffers + glBindBuffer + glBufferData(GL_DYNAMIC_DRAW)
    // Babylon.js Buffer 构造自动创建 WebGLBuffer 并上传数据
    this._buffer = new Buffer(
      engine,
      data,
      dynamic,
      stride, // byte stride
      false,   // postponeInternalCreation: 立即创建 WebGL 缓冲
      false,   // instanced
      true,    // useBytes: stride 是字节值
    )
  }

  // ---------------------------------------------------------------------------
  // bind（对应 OpenRA VertexBuffer.Bind()）
  // ---------------------------------------------------------------------------

  /**
   * 绑定顶点缓冲。
   *
   * 对应 OpenRA VertexBuffer.Bind() (VertexBuffer.cs:110-114)。
   *
   * 在 OpenRA 中，Bind() 调用 glBindBuffer(GL_ARRAY_BUFFER, buffer)，
   * 然后由 Shader.Bind() 调用 glVertexAttribPointer 设置属性指针。
   *
   * 迁移版为 no-op。
   * 原因: Babylon.js Mesh + ShaderMaterial 在渲染时自动处理所有缓冲区绑定
   * 和顶点属性设置。手动干预会与引擎的内部状态管理冲突。
   */
  bind(): void {
    this.ensureNotDisposed()
    // no-op — Babylon.js 自动管理顶点缓冲绑定
  }

  // ---------------------------------------------------------------------------
  // setData（对应 OpenRA VertexBuffer.SetData 重载）
  //
  // TypeScript 不支持 C# 风格的方法重载实现。
  // 使用重载签名 + 统一实现体的模式。
  // ---------------------------------------------------------------------------

  /**
   * 更新缓冲区中的全部或部分数据。
   *
   * 对应 OpenRA VertexBuffer.SetData(T[] data, int length)。
   * 将 data 中的前 length 个 float 复制到缓冲区的开头位置。
   *
   * @param vertices — 新顶点数据（Float32Array 或 number[]）
   * @param length — 要复制的 float 数量
   */
  setData(vertices: Float32Array | number[], length: number): void
  /**
   * 更新缓冲区中指定偏移范围内的数据。
   *
   * 对应 OpenRA VertexBuffer.SetData(T[] data, int offset, int start, int length)。
   *
   * @param vertices — 源顶点数据
   * @param offset — 源数组中的起始 float 索引
   * @param start — 目标缓冲区中的起始 float 索引
   * @param length — 要复制的 float 数量
   */
  setData(
    vertices: Float32Array | number[],
    offset: number,
    start: number,
    length: number,
  ): void
  /**
   * setData 统一实现。
   *
   * 对应 OpenRA glBufferSubData(GL_ARRAY_BUFFER, offsetBytes, sizeBytes, dataPtr)。
   *
   * 同时更新内部 Float32Array 副本和 GPU 缓冲区。
   * GPU 更新通过 Buffer.updateDirectly() 进行，仅上传变更部分。
   */
  setData(
    vertices: Float32Array | number[],
    lengthOrOffset: number,
    start?: number,
    length?: number,
  ): void {
    // 重载解析: 如果未提供 start/length，则为 2 参数重载
    // (对应 OpenRA SetData(T[], int length))
    const offset = start !== undefined ? lengthOrOffset : 0
    const s = start ?? 0
    const len = length ?? lengthOrOffset

    this.ensureNotDisposed()

    if (offset < 0) {
      throw new Error('VertexBuffer setData: offset must be >= 0')
    }
    if (s < 0) {
      throw new Error('VertexBuffer setData: start must be >= 0')
    }
    if (len <= 0) {
      throw new Error('VertexBuffer setData: length must be > 0')
    }

    // 验证源数据范围
    if (offset + len > vertices.length) {
      throw new Error(
        `VertexBuffer setData: source range [${offset}, ${offset + len}) ` +
        `exceeds source length ${vertices.length}`,
      )
    }

    // 验证目标缓冲区范围
    if (s + len > this._data.length) {
      throw new Error(
        `VertexBuffer setData: target range [${s}, ${s + len}) ` +
        `exceeds buffer length ${this._data.length}`,
      )
    }

    // Step 1: 更新内部 Float32Array 副本
    if (vertices instanceof Float32Array) {
      this._data.set(
        vertices.subarray(offset, offset + len),
        s,
      )
    } else {
      for (let i = 0; i < len; i++) {
        this._data[s + i] = vertices[offset + i]
      }
    }

    // Step 2: 上传变更部分到 GPU
    // 对应 OpenRA:
    //   glBufferSubData(GL_ARRAY_BUFFER, VertexSize * s, VertexSize * len, dataPtr + VertexSize * offset)
    //
    // Babylon.js Buffer.updateDirectly 接受 byte offset
    if (this._buffer) {
      // 从 Float32Array 创建完整的 ArrayBuffer 视图用于 GPU 上传
      // updateDirectly 需要整个缓冲区数据，但只更新指定范围
      // 我们使用 updateDirectly 的部分范围更新
      const byteOffset = s * 4 // 每个 float 4 字节
      const byteLength = len * 4

      // 创建仅包含变更部分数据的 ArrayBuffer
      const updateData = new Float32Array(
        this._data.buffer.slice(
          this._data.byteOffset + byteOffset,
          this._data.byteOffset + byteOffset + byteLength,
        ),
      )

      this._buffer.updateDirectly(
        updateData,
        byteOffset, // byte offset
        len,        // float count
      )
    }
  }

  // ---------------------------------------------------------------------------
  // 查询方法
  // ---------------------------------------------------------------------------

  /**
   * 获取内部数据的只读副本。
   *
   * @returns Float32Array 数据副本
   */
  getData(): Float32Array {
    return new Float32Array(this._data)
  }

  /**
   * 缓冲区中的顶点数量。
   *
   * 计算方式: data.length / (stride / 4)
   */
  get vertexCount(): number {
    return this._vertexCount
  }

  /**
   * 缓冲区是否可动态更新。
   *
   * 对应 OpenRA: 构造时的 dynamic 参数（GL_DYNAMIC_DRAW vs GL_STATIC_DRAW）。
   */
  get isDynamic(): boolean {
    return this._dynamic
  }

  // ---------------------------------------------------------------------------
  // dispose（对应 OpenRA VertexBuffer.Dispose()）
  // ---------------------------------------------------------------------------

  /**
   * 释放顶点缓冲的 GPU 资源。
   *
   * 对应 OpenRA VertexBuffer.Dispose()，内部调用 glDeleteBuffers。
   *
   * 幂等操作 —— 重复调用不会产生副作用。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    if (this._buffer) {
      this._buffer.dispose()
      this._buffer = null
    }
  }

  // ---------------------------------------------------------------------------
  // 私有辅助方法
  // ---------------------------------------------------------------------------

  /** 检查是否已销毁，已销毁则抛出异常 */
  private ensureNotDisposed(): void {
    if (this._disposed) {
      throw new Error(
        'VertexBuffer has been disposed. ' +
        '(对应 OpenRA ObjectDisposedException)',
      )
    }
  }
}
