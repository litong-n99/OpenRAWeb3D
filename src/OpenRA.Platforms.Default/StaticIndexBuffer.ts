/**
 * StaticIndexBuffer.ts — OpenRA 索引缓冲到 Uint32Array 的迁移实现
 * OpenRA 对照: OpenRA.Platforms.Default/StaticIndexBuffer.cs
 *
 * 核心范式转换:
 * - glGenBuffers + glBufferData(GL_ELEMENT_ARRAY_BUFFER, GL_STATIC_DRAW)
 *   → Uint32Array 存储 + 可选 DataBuffer（按需创建）
 * - glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffer) → bind() 为 no-op
 *   （Babylon.js Mesh 自动管理索引缓冲绑定）
 * - glDeleteBuffers → dispose() 释放 Uint32Array 引用
 * - ThreadAffine 线程亲和验证 → 已移除（浏览器单线程）
 * - uint[] indices（C#）→ Uint32Array（TypeScript）
 *
 * 关键设计决策:
 * - bind() 为 no-op。
 *   原因: Babylon.js Mesh 在渲染时通过其内部的 subMesh 管理索引缓冲绑定。
 *   手动调用 glBindBuffer(GL_ELEMENT_ARRAY_BUFFER) 会干扰引擎状态管理。
 * - 数据存储为 Uint32Array（JavaScript 原生无符号 32 位整数数组）。
 *   对应 OpenRA 的 uint[]（const int UintSize = 4）。
 * - 构造函数仅接受 Uint32Array。对应 OpenRA 的单构造函数 StaticIndexBuffer(uint[] indices)。
 *   不支持运行时修改索引数据（这是 Static 的含义 —— 一次性上传，不可变）。
 */

import type { IIndexBuffer } from '../OpenRA.Game/Graphics/PlatformInterfaces'

// ---------------------------------------------------------------------------
// StaticIndexBuffer — IIndexBuffer 接口的实现
//
// 对应 OpenRA sealed class StaticIndexBuffer : ThreadAffine, IDisposable,
//   IIndexBuffer。
//
// 仅存储 Uint32Array 索引数据。bind() 为 no-op。
// 可选 DataBuffer 在需要 GPU 交互时由外部创建。
//
// 生命周期:
//   1. 构造时存储索引数据的副本
//   2. bind() 为 no-op
//   3. dispose() 清理数据引用
//
// OpenRA 对照: StaticIndexBuffer (StaticIndexBuffer.cs:17-61)
// ---------------------------------------------------------------------------

export class StaticIndexBuffer implements IIndexBuffer {
  // ---------------------------------------------------------------------------
  // 私有状态
  // ---------------------------------------------------------------------------

  /** 索引数据副本 */
  private _data: Uint32Array

  /** 是否已销毁 */
  private _disposed = false

  // ---------------------------------------------------------------------------
  // 构造函数（对应 OpenRA StaticIndexBuffer(uint[] indices)）
  //
  // 对应 OpenRA:
  //   glGenBuffers(1, out buffer)
  //   glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffer)
  //   glBufferData(GL_ELEMENT_ARRAY_BUFFER, UintSize * indices.Length,
  //                dataPtr, GL_STATIC_DRAW)
  //
  // 迁移版创建数据副本（类似 OpenRA 的 GL_STATIC_DRAW 语义 ——
  // 数据写一次，不可修改。这也是 "Static" 的含义）。
  // ---------------------------------------------------------------------------

  /**
   * 创建静态索引缓冲。
   *
   * OpenRA 对照: StaticIndexBuffer(uint[] indices) 构造函数
   *   (StaticIndexBuffer.cs:23-42)
   *
   * @param indices — 索引数据（Uint32Array，32 位无符号整数）。
   *   对应 OpenRA 的 uint[]（const int UintSize = 4）。
   */
  constructor(indices: Uint32Array) {
    if (indices.length === 0) {
      throw new Error(
        'StaticIndexBuffer indices must not be empty. ' +
        '(对应 OpenRA: 空索引数组不合法)',
      )
    }

    // 创建数据副本（对应 OpenRA glBufferData GL_STATIC_DRAW 语义）
    this._data = new Uint32Array(indices)
  }

  // ---------------------------------------------------------------------------
  // 公开属性
  // ---------------------------------------------------------------------------

  /**
   * 索引数据（只读副本）。
   *
   * 对应 OpenRA StaticIndexBuffer 内部存储的 uint[]。
   * 返回数据副本以保护内部状态。
   *
   * @returns Uint32Array 索引数据副本
   */
  get data(): Uint32Array {
    this.ensureNotDisposed()
    return new Uint32Array(this._data)
  }

  /**
   * 索引数量。
   */
  get count(): number {
    return this._data.length
  }

  // ---------------------------------------------------------------------------
  // bind（对应 OpenRA StaticIndexBuffer.Bind()）
  // ---------------------------------------------------------------------------

  /**
   * 绑定索引缓冲。
   *
   * 对应 OpenRA StaticIndexBuffer.Bind() (StaticIndexBuffer.cs:45-50)。
   *
   * OpenRA 实现:
   *   VerifyThreadAffinity()
   *   glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, buffer)
   *   CheckGLError()
   *
   * 迁移版为 no-op。
   * 原因: Babylon.js Mesh 通过其内部的 subMesh 结构自动管理索引缓冲绑定。
   * 引擎在绘制调用前自动绑定正确的索引缓冲。
   * 手动干预会与引擎的内部状态管理冲突。
   */
  bind(): void {
    this.ensureNotDisposed()
    // no-op — Babylon.js 自动管理索引缓冲绑定
  }

  // ---------------------------------------------------------------------------
  // dispose（对应 OpenRA StaticIndexBuffer.Dispose()）
  // ---------------------------------------------------------------------------

  /**
   * 释放索引缓冲。
   *
   * 对应 OpenRA StaticIndexBuffer.Dispose()，内部调用 glDeleteBuffers。
   *
   * 迁移版释放所有内部数据引用。
   * 幂等操作 —— 重复调用不会产生副作用。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    // 释放内部数据引用
    // 对应 OpenRA: glDeleteBuffers(1, ref buffer)
    // 在 Web 环境中，将数据引用置空即可让 GC 回收
    // 注意: 如果此缓冲区已上传到 GPU（通过外部 DataBuffer），
    // 外部 DataBuffer 需要单独处理其生命周期
    this._data = new Uint32Array(0)
  }

  // ---------------------------------------------------------------------------
  // 私有辅助方法
  // ---------------------------------------------------------------------------

  /** 检查是否已销毁，已销毁则抛出异常 */
  private ensureNotDisposed(): void {
    if (this._disposed) {
      throw new Error(
        'StaticIndexBuffer has been disposed. ' +
        '(对应 OpenRA ObjectDisposedException)',
      )
    }
  }
}
