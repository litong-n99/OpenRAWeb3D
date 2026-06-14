/**
 * Sheet.ts — OpenRA 纹理图集（Texture Atlas）到 Babylon.js RawTexture 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/Sheet.cs
 *
 * 核心范式转换:
 * - ITexture 延迟创建 (Game.Renderer.Context.CreateTexture) → RawTexture 延迟构造
 * - byte[] CPU 缓冲区管理 → Uint8Array 缓冲区管理
 * - GL_BGRA 格式直接上传 → 上传时 BGRA→RGBA byte swap（R↔B）
 * - CommitBufferedData / ReleaseBuffer 模式 → dirty flag + releaseBufferOnCommit flag
 * - ReleaseBufferAndTryTransferTo 缓冲区复用 → Array 引用转移
 *
 * NOTE: RawTexture 始终使用 RGBA 内部格式。WebGL 2.0 不原生支持 BGRA
 * 内部格式，因此在 getTexture() 上传时执行 BGRA→RGBA 字节交换。
 * CPU 端缓冲区保持 BGRA（与 OpenRA 一致），GPU 端存储 RGBA。
 */

import { RawTexture } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// 共享类型（与 SpriteRenderer.ts ISheet 一致）
// ---------------------------------------------------------------------------

/** 对应 OpenRA Size 结构 */
interface Size {
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// SheetType 枚举（与 OpenRA 完全一致，值表示每像素通道数）
//
// OpenRA 对照: SheetBuilder.cs SheetType enum (SheetBuilder.cs:27-31)
// ---------------------------------------------------------------------------

export const SheetType = {
  /** 单通道索引纹理（每像素 1 字节，值作为调色板索引） */
  Indexed: 1,
  /** 四通道 BGRA 纹理（每像素 4 字节，CPU 端 BGRA，GPU 端 RGBA） */
  BGRA: 4,
} as const
export type SheetType = (typeof SheetType)[keyof typeof SheetType]

// ---------------------------------------------------------------------------
// BGRA→RGBA 字节交换（上传时使用）
//
// OpenRA CPU 缓冲区为 BGRA 顺序（Util.ChannelMasks = [2, 1, 0, 3]），
// WebGL 纹理为 RGBA 顺序，因此在调用 RawTexture 构造函数前需交换 R↔B。
// ---------------------------------------------------------------------------

/**
 * 原地交换 Uint8Array 中每 4 字节组的第 0 和第 2 字节（BGRA → RGBA）。
 *
 * 对应 OpenRA Util.ChannelMasks = [2, 1, 0, 3]（B↔R 交换, G 不变, A 不变）。
 *
 * @param data — BGRA 像素数据（将被原地修改为 RGBA）
 */
function swapRB(data: Uint8Array): void {
  for (let i = 0; i + 3 < data.length; i += 4) {
    const b = data[i]
    const r = data[i + 2]
    data[i] = r       // R → offset 0 (RGBA)
    data[i + 2] = b   // B → offset 2 (RGBA)
  }
}

// ---------------------------------------------------------------------------
// Sheet 类
//
// 对应 OpenRA sealed class Sheet : IDisposable (Sheet.cs:19-172)
//
// 生命周期（与 OpenRA 完全一致）:
//   1. 构造时指定类型和尺寸（可选传入已有 RawTexture）
//   2. 通过 getData() 获取 CPU 缓冲区（Uint8Array, BGRA 格式）
//   3. 外部代码写入像素数据到缓冲区
//   4. 调用 commitBufferedData() 标记脏
//   5. 调用 getTexture(scene) 将脏数据上传到 GPU（同时执行 BGRA→RGBA 转换）
//   6. 调用 releaseBuffer() 释放 CPU 缓冲区（下一次上传后清除）
//   7. 调用 dispose() 释放 GPU 纹理
// ---------------------------------------------------------------------------

export class Sheet {
  // -----------------------------------------------------------------------
  // 公共属性（只读，与 OpenRA 完全一致）
  // -----------------------------------------------------------------------

  /** 纹理图集尺寸（像素），对应 OpenRA Sheet.Size */
  readonly size: Size

  /** 图集类型（Indexed=1 或 BGRA=4），对应 OpenRA Sheet.Type */
  readonly type: SheetType

  // -----------------------------------------------------------------------
  // 私有状态
  // -----------------------------------------------------------------------

  /** GPU 纹理（延迟创建），对应 OpenRA Sheet.texture */
  private _texture: RawTexture | null = null

  /** CPU 端像素缓冲（BGRA 格式），对应 OpenRA Sheet.data */
  private _data: Uint8Array | null = null

  /** 是否有未上传的修改，对应 OpenRA Sheet.dirty */
  private _dirty = false

  /** releaseBuffer() 调用后，下次上传时释放 CPU 缓冲 */
  private _releaseBufferOnCommit = false

  /** Babylon.js Scene 引用（用于延迟创建 RawTexture） */
  private _scene: Scene | null = null

  // -----------------------------------------------------------------------
  // 构造函数（对应 OpenRA Sheet 的 3 个构造重载）
  // -----------------------------------------------------------------------

  /**
   * 构造 Sheet（指定类型和尺寸）。
   *
   * 对应 OpenRA `Sheet(SheetType type, Size size)` (Sheet.cs:37-41)。
   * 不立即分配 CPU 缓冲区或 GPU 纹理 —— 两者均延迟按需创建。
   *
   * @param type — 图集类型（Indexed=1 或 BGRA=4）
   * @param size — 纹理尺寸（像素）
   * @param scene — Babylon.js Scene（用于延迟创建 RawTexture），可延迟传入
   */
  constructor(type: SheetType, size: Size, scene?: Scene)

  /**
   * 构造 Sheet（包装已有 RawTexture）。
   *
   * 对应 OpenRA `Sheet(SheetType type, ITexture texture)` (Sheet.cs:43-48)。
   *
   * @param type — 图集类型
   * @param texture — 已有的 Babylon.js RawTexture
   */
  constructor(type: SheetType, texture: RawTexture)

  constructor(type: SheetType, sizeOrTexture: Size | RawTexture, scene?: Scene) {
    this.type = type

    // NOTE: Use duck-typing instead of instanceof RawTexture to support
    // mocked environments (vitest/happy-dom) where RawTexture may not be a
    // callable constructor.
    if (sizeOrTexture && typeof sizeOrTexture === 'object' && 'getSize' in sizeOrTexture) {
      this._texture = sizeOrTexture as RawTexture
      const texSize = sizeOrTexture.getSize()
      this.size = { width: texSize.width, height: texSize.height }
    } else {
      this.size = { width: (sizeOrTexture as Size).width, height: (sizeOrTexture as Size).height }
      if (scene) {
        this._scene = scene
      }
    }
  }

  // -----------------------------------------------------------------------
  // 纹理访问（对应 OpenRA GetTexture / ITexture）
  // -----------------------------------------------------------------------

  /**
   * 获取 GPU 纹理（延迟创建 + 按需上传）。
   *
   * 对应 OpenRA `GetTexture()` (Sheet.cs:61-78)。
   *
   * 首次调用时创建 RawTexture，并在数据脏时上传。
   * 上传前自动执行 BGRA→RGBA 字节交换（仅 BGRA 类型）。
   * Indexed 类型的数据是调色板索引，不做字节交换。
   *
   * @param scene — Babylon.js Scene（如果构造时未传入）
   * @returns RawTexture 实例（永不为 null）
   */
  getTexture(scene?: Scene): RawTexture {
    if (!this._texture) {
      const s = scene ?? this._scene
      if (!s) {
        throw new Error(
          'Sheet: Cannot create texture without a Scene. ' +
          'Pass Scene to constructor or getTexture().',
        )
      }
      this._scene = s

      // 准备初始数据
      const initData = this._data
        ? this._createRgbaUploadBuffer()
        : new Uint8Array(4 * this.size.width * this.size.height)

      this._texture = RawTexture.CreateRGBATexture(
        initData,
        this.size.width,
        this.size.height,
        s,
        false,  // generateMipMaps = false（像素艺术纹理不需要 mipmap）
        false,  // invertY = false
        RawTexture.NEAREST_SAMPLINGMODE,
      )

      // 初始数据已上传，清除脏标记
      this._dirty = false
      if (this._data && this._releaseBufferOnCommit) {
        this._data = null
        this._releaseBufferOnCommit = false
      }

      return this._texture
    }

    // 纹理已存在：若脏则更新（对应 OpenRA texture.SetData）
    if (this._data && this._dirty) {
      const rgbaData = this._createRgbaUploadBuffer()
      this._texture.update(rgbaData)
      this._dirty = false

      if (this._releaseBufferOnCommit) {
        this._data = null
        this._releaseBufferOnCommit = false
      }
    }

    return this._texture
  }

  /**
   * 返回当前 GPU 纹理（不触发延迟创建或上传）。
   *
   * @returns RawTexture 或 null（若尚未创建）
   */
  get currentTexture(): RawTexture | null {
    return this._texture
  }

  // -----------------------------------------------------------------------
  // 缓冲区管理（对应 OpenRA Sheet 缓冲区 API）
  // -----------------------------------------------------------------------

  /**
   * 是否已缓冲（有 CPU 数据，或纹理尚未创建）。
   *
   * 对应 OpenRA `Buffered` 属性 (Sheet.cs:35):
   *   public bool Buffered => data != null || texture == null;
   */
  get buffered(): boolean {
    return this._data !== null || this._texture === null
  }

  /**
   * 获取 CPU 端像素缓冲区（BGRA 格式，延迟分配）。
   *
   * 对应 OpenRA `GetData()` (Sheet.cs:29-33)。
   *
   * 若缓冲区不存在：
   *   - 纹理不存在 → 分配新零填充缓冲区
   *   - 纹理已存在 → 分配新缓冲区（Babylon.js RawTexture 不支持直接读回）
   *
   * @returns BGRA 格式的像素数据（每像素 4 字节）
   */
  getData(): Uint8Array {
    this.createBuffer()
    return this._data!
  }

  /**
   * 确保 CPU 缓冲区已分配。
   *
   * 对应 OpenRA `CreateBuffer()` (Sheet.cs:109-118)。
   *
   * 若缓冲区已存在，直接返回（幂等）。
   * 否则分配 4 * width * height 字节的新缓冲区。
   */
  createBuffer(): void {
    if (this._data) return

    // 对应 OpenRA:
    //   if (texture == null) data = new byte[4 * Size.Width * Size.Height];
    //   else data = texture.GetData();
    //
    // NOTE: Babylon.js RawTexture 默认不支持 GPU→CPU 读回。
    // 迁移版始终保持 CPU 缓冲，纹理上传后不再反向同步。
    this._data = new Uint8Array(4 * this.size.width * this.size.height)
    this._releaseBufferOnCommit = false
  }

  /**
   * 标记缓冲区数据已修改，需在下一次 getTexture() 调用时上传。
   *
   * 对应 OpenRA `CommitBufferedData()` (Sheet.cs:120-129)。
   *
   * @throws 若 Sheet 未缓冲（无 CPU 数据且纹理已存在）
   */
  commitBufferedData(): void {
    if (!this.buffered) {
      throw new Error(
        'This sheet is unbuffered. You cannot call CommitBufferedData on an unbuffered sheet. ' +
        'If you need to completely replace the texture data you should set data into the ' +
        'texture directly. If you need to make only small changes to the texture data ' +
        'consider creating a buffered sheet instead.',
      )
    }

    this._dirty = true
  }

  /**
   * 释放 CPU 缓冲区，标记下次上传后释放内存。
   *
   * 对应 OpenRA `ReleaseBuffer()` (Sheet.cs:131-141)。
   *
   * 若 Scene 可用（等价于 OpenRA `Game.Renderer != null`），立即尝试上传。
   * 上传失败（Scene 不可用）时静默跳过，延迟到下次 getTexture(scene) 调用。
   */
  releaseBuffer(): void {
    if (!this.buffered) return

    this._dirty = true
    this._releaseBufferOnCommit = true

    // 对应 OpenRA: if (Game.Renderer != null) GetTexture()
    if (this._scene) {
      try {
        this.getTexture()
      } catch {
        // Scene 在构造时传入但可能已销毁，延迟到下次 getTexture(scene)
      }
    }
  }

  /**
   * 释放缓冲区并尝试转移到底目标 Sheet。
   *
   * 对应 OpenRA `ReleaseBufferAndTryTransferTo()` (Sheet.cs:144-165)。
   *
   * 转移条件（全部满足）:
   *   1. 目标 Sheet 尺寸相同
   *   2. 目标 Sheet 无 CPU 数据
   *   3. 目标 Sheet 无 GPU 纹理
   *   4. 当前 Sheet 的缓冲非空
   *
   * 转移后清空源缓冲区（零填充）但保留分配，供目标复用。
   *
   * @param destination — 目标 Sheet
   * @returns 是否成功转移
   * @throws 若目标 Sheet 尺寸不匹配
   */
  releaseBufferAndTryTransferTo(destination: Sheet): boolean {
    if (this.size.width !== destination.size.width ||
        this.size.height !== destination.size.height) {
      throw new Error('Destination sheet does not have the same size')
    }

    const buffer = this._data
    this.releaseBuffer()

    // 对应 OpenRA: if (Game.Renderer == null) return false
    if (!this._scene) return false

    // 仅当目标无数据且无纹理时转移
    if (buffer && !destination._data && !destination._texture) {
      buffer.fill(0)          // 对应 OpenRA Array.Clear(buffer, 0, buffer.Length)
      destination._data = buffer
      return true
    }

    return false
  }

  // -----------------------------------------------------------------------
  // 像素艺术缩放（对应 OpenRA EnablePixelArtScaling）
  // -----------------------------------------------------------------------

  /**
   * 设置像素艺术缩放模式。
   *
   * - true  → NEAREST 采样（锐利像素艺术，默认）
   * - false → BILINEAR 采样（平滑）
   *
   * 若纹理已存在，立即更新其采样模式。
   *
   * @param enabled — 是否启用像素艺术缩放
   */
  setPixelArtScaling(enabled: boolean): void {
    if (this._texture) {
      this._texture.updateSamplingMode(
        enabled
          ? RawTexture.NEAREST_SAMPLINGMODE
          : RawTexture.BILINEAR_SAMPLINGMODE,
      )
    }
  }

  // -----------------------------------------------------------------------
  // 内部辅助
  // -----------------------------------------------------------------------

  /**
   * 从 CPU 缓冲区创建 RGBA 格式的上传缓冲区。
   *
   * BGRA 类型: 深拷贝＋R↔B 字节交换（保留 CPU 端原始 BGRA 数据不变）。
   * Indexed 类型: 直接返回 CPU 缓冲区引用（无交换，调色板索引是单字节值）。
   *
   * 对应 OpenRA: GL_BGRA 格式直接上传 glTexImage2D（无转换），
   * 迁移版: WebGL 2.0 不保证 BGRA 内部格式可用，统一转为 RGBA。
   *
   * @returns RGBA 格式的 Uint8Array
   */
  private _createRgbaUploadBuffer(): Uint8Array {
    if (!this._data) {
      return new Uint8Array(4 * this.size.width * this.size.height)
    }

    if (this.type === SheetType.BGRA) {
      // BGRA → RGBA: 深拷贝以避免原地修改 CPU 缓冲区
      const copy = new Uint8Array(this._data)
      swapRB(copy)
      return copy
    }

    // Indexed: 数据是调色板索引，不需要字节交换
    return this._data
  }

  // -----------------------------------------------------------------------
  // 资源释放（对应 OpenRA IDisposable）
  // -----------------------------------------------------------------------

  /**
   * 释放 GPU 纹理资源。
   *
   * 对应 OpenRA Sheet.Dispose() (Sheet.cs:167-169):
   *   texture?.Dispose();
   *
   * NOTE: 不主动释放 CPU 缓冲区（由 GC 自动回收）。
   */
  dispose(): void {
    this._texture?.dispose()
    this._texture = null
    this._data = null
    this._dirty = false
    this._releaseBufferOnCommit = false
  }
}
