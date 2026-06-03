/**
 * SheetBuilder.ts — OpenRA 运行时纹理图集打包到 TypeScript 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/SheetBuilder.cs
 *
 * 核心范式转换:
 * - 运行时行式打包 (rectangle packing) → 完全复制 OpenRA 行式打包算法
 * - 通道循环 (R→G→B→A for Indexed) → 精确复制 NextChannel 逻辑
 * - ReleaseBufferAndTryTransferTo 缓冲区复用 → Array 引用转移
 * - Func<Sheet> 委托 → () => Sheet 工厂函数
 * - 构建时预打包 (maxrects-packer) → NOTE: 按指示使用运行时行式打包
 *
 * 关键设计:
 *   - Indexed 类型: 每通道独立纹理，4 个通道循环使用后才分配新 Sheet
 *   - BGRA 类型: 单 RGBA 通道，空间不足立即分配新 Sheet
 *   - margin=1 像素间距防止相邻精灵纹理出血
 *   - 空精灵 (0×0) 不占用图集空间，直接返回空 Sprite
 */

import { Sheet, SheetType } from './Sheet'
import { Sprite, TextureChannel } from './Sprite'
import { SpriteFrameType, fastCopyIntoChannel } from './Util'
import type { Vec3 } from './SpriteRenderer'

// ---------------------------------------------------------------------------
// 共享类型
// ---------------------------------------------------------------------------

interface Size {
  width: number
  height: number
}

interface Int2 {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// FrameTypeToSheetType — 将精灵帧类型转换为图集类型
//
// 对应 OpenRA SheetBuilder.FrameTypeToSheetType (SheetBuilder.cs:51-66)
// ---------------------------------------------------------------------------

/**
 * 根据 SpriteFrameType 确定 SheetType。
 *
 * 对应 OpenRA:
 *   Indexed8 → SheetType.Indexed
 *   Bgra32/Bgr24/Rgba32/Rgb24 → SheetType.BGRA
 *
 * @param frameType — 源精灵帧格式
 * @returns 对应的 SheetType
 */
export function frameTypeToSheetType(frameType: SpriteFrameType): SheetType {
  switch (frameType) {
    case SpriteFrameType.Indexed8:
      return SheetType.Indexed

    // Util.FastCopyIntoChannel 会自动将这些格式转换为 BGRA
    case SpriteFrameType.Bgra32:
    case SpriteFrameType.Bgr24:
    case SpriteFrameType.Rgba32:
    case SpriteFrameType.Rgb24:
      return SheetType.BGRA

    default:
      throw new Error(`Unknown SpriteFrameType ${frameType}`)
  }
}

// ---------------------------------------------------------------------------
// SheetBuilder 类
//
// 对应 OpenRA sealed class SheetBuilder : IDisposable (SheetBuilder.cs:33-170)
//
// 运行时行式图集打包器。
// 按行填充精灵到 Sheet，空间不足时分配新 Sheet。
// Indexed 类型额外利用 RGBA 4 个通道，每个通道容纳一组独立精灵。
// ---------------------------------------------------------------------------

export class SheetBuilder {
  // -----------------------------------------------------------------------
  // 公共属性（只读）
  // -----------------------------------------------------------------------

  /** 图集类型（Indexed=1 或 BGRA=4） */
  readonly type: SheetType

  /** 当前可写入的 Sheet */
  current: Sheet | null = null

  /** 当前写入通道 */
  currentChannel: number

  /** 已分配的所有 Sheet */
  get allSheets(): readonly Sheet[] {
    return this._sheets
  }

  // -----------------------------------------------------------------------
  // 私有状态
  // -----------------------------------------------------------------------

  /** 已分配的 Sheet 列表 */
  private _sheets: Sheet[] = []

  /** Sheet 工厂函数 */
  private readonly _allocateSheet: () => Sheet

  /** 精灵间距（像素） */
  private readonly _margin: number

  /** 当前打包位置（像素坐标） */
  private _p: Int2 = { x: 0, y: 0 }

  /** 当前行中最高精灵的高度 */
  private _rowHeight = 0

  // -----------------------------------------------------------------------
  // 静态工厂
  // -----------------------------------------------------------------------

  /**
   * 分配标准尺寸的 Sheet。
   *
   * 对应 OpenRA `static AllocateSheet(SheetType type, int sheetSize)` (SheetBuilder.cs:46-49)。
   *
   * @param type — 图集类型
   * @param sheetSize — Sheet 边长（正方形）
   * @returns 新分配的 Sheet
   */
  static allocateSheet(type: SheetType, sheetSize: number): Sheet {
    return new Sheet(type, { width: sheetSize, height: sheetSize })
  }

  // -----------------------------------------------------------------------
  // 构造函数
  //
  // 对应 OpenRA:
  //   1. SheetBuilder(SheetType t, int sheetSize, int margin = 1)
  //   2. SheetBuilder(SheetType t, Func<Sheet> allocateSheet, int margin = 1)
  // -----------------------------------------------------------------------

  /**
   * 构造 SheetBuilder（指定类型和尺寸）。
   *
   * 对应 OpenRA:
   *   SheetBuilder(SheetType t, int sheetSize, int margin = 1)
   *     : this(t, () => AllocateSheet(t, sheetSize), margin)
   *
   * @param type — 图集类型
   * @param sheetSize — Sheet 边长（正方形）
   * @param margin — 精灵间距（默认 1 像素）
   */
  constructor(type: SheetType, sheetSize: number, margin?: number)

  /**
   * 构造 SheetBuilder（自定义工厂函数）。
   *
   * 对应 OpenRA:
   *   SheetBuilder(SheetType t, Func<Sheet> allocateSheet, int margin = 1)
   *
   * @param type — 图集类型
   * @param allocateSheet — 自定义 Sheet 工厂函数
   * @param margin — 精灵间距（默认 1 像素）
   */
  constructor(type: SheetType, allocateSheet: () => Sheet, margin?: number)

  constructor(
    type: SheetType,
    sheetSizeOrFactory: number | (() => Sheet),
    margin = 1,
  ) {
    this.type = type

    if (typeof sheetSizeOrFactory === 'number') {
      const sheetSize = sheetSizeOrFactory
      this._allocateSheet = () => SheetBuilder.allocateSheet(type, sheetSize)
    } else {
      this._allocateSheet = sheetSizeOrFactory
    }

    this._margin = margin

    // 初始化当前通道（Indexed 从 Red 开始，BGRA 使用 RGBA）
    this.currentChannel = (type === SheetType.Indexed) ? 0 /* Red */ : 4 /* RGBA */
  }

  // -----------------------------------------------------------------------
  // Add 重载（对应 OpenRA Add 的 5 个重载）
  // -----------------------------------------------------------------------

  /**
   * 从 ISpriteFrame 添加精灵。
   *
   * 对应 OpenRA `Add(ISpriteFrame frame, bool premultiplied = false)`。
   */
  addFrame(frame: ISpriteFrame, premultiplied = false): Sprite {
    return this.addRaw(
      frame.data, frame.type, frame.size, 0,
      frame.offset ?? { x: 0, y: 0, z: 0 }, premultiplied,
    )
  }

  /**
   * 从原始字节数组添加精灵（简化版，无 ZRamp/Offset）。
   *
   * 对应 OpenRA `Add(byte[] src, SpriteFrameType type, Size size, bool premultiplied = false)`。
   */
  addSimple(
    src: Uint8Array, type: SpriteFrameType, size: Size, premultiplied = false,
  ): Sprite {
    return this.addRaw(src, type, size, 0, { x: 0, y: 0, z: 0 }, premultiplied)
  }

  /**
   * 从原始字节数组添加精灵（完整参数版）。
   *
   * 对应 OpenRA `Add(byte[] src, SpriteFrameType type, Size size, float zRamp, in float3 spriteOffset, bool premultiplied = false)`。
   *
   * 步骤:
   *   1. 确保 Current Sheet 存在
   *   2. 在 Current 中分配矩形区域
   *   3. 通过 FastCopyIntoChannel 复制像素数据
   *   4. 提交缓冲区（标记脏）
   *
   * @param src — 源像素数据
   * @param srcType — 源数据格式
   * @param size — 精灵尺寸
   * @param zRamp — Z 渐变
   * @param spriteOffset — 精灵偏移
   * @param premultiplied — 是否已预乘 Alpha
   * @returns 新分配的 Sprite
   */
  addRaw(
    src: Uint8Array,
    srcType: SpriteFrameType,
    size: Size,
    zRamp: number,
    spriteOffset: Vec3,
    premultiplied = false,
  ): Sprite {
    // 延迟创建第一个 Sheet
    this._ensureCurrent()

    // 空精灵不分配空间（对应 OpenRA）
    if (size.width === 0 || size.height === 0) {
      return new Sprite(
        this.current!,
        { x: 0, y: 0, width: 0, height: 0 },
        zRamp,
        spriteOffset,
        this.currentChannel as unknown as TextureChannel,
        'Alpha',
        1,
      )
    }

    // 分配矩形区域
    const sprite = this.allocate(size, zRamp, spriteOffset)

    // 复制像素数据到图集缓冲区
    const destData = sprite.sheet.getData()
    const stride = sprite.sheet.size.width

    fastCopyIntoChannel(
      destData,
      stride,
      sprite.bounds.x,
      sprite.bounds.y,
      sprite.bounds.width,
      sprite.bounds.height,
      src,
      srcType,
      sprite.channel as number,
      premultiplied,
    )

    // 标记脏（对应 OpenRA Current.CommitBufferedData()）
    sprite.sheet.commitBufferedData()

    return sprite
  }

  // -----------------------------------------------------------------------
  // Allocate — 在图集中分配矩形区域
  //
  // 对应 OpenRA Allocate 的 2 个重载:
  //   1. Allocate(Size imageSize, float scale = 1f)
  //   2. Allocate(Size imageSize, float zRamp, in float3 spriteOffset, float scale = 1f)
  // -----------------------------------------------------------------------

  /**
   * 分配精灵矩形区域。
   *
   * 对应 OpenRA Allocate 的两个重载:
   *   1. Allocate(Size imageSize, float scale = 1f)
   *   2. Allocate(Size imageSize, float zRamp, in float3 spriteOffset, float scale = 1f)
   *
   * 重载解析: 若提供 spriteOffset 参数，则第二个数字参数为 zRamp；
   * 否则为 scale（OpenRA 的简化版重载）。
   *
   * 算法:
   *   1. 确保 Current Sheet 存在
   *   2. 当前行水平空间不足 → 换行（X 归零，Y 增加行高）
   *   3. 更新行高（取当前行最高精灵）
   *   4. 当前 Sheet 垂直空间不足 → 尝试下一通道或分配新 Sheet
   *   5. 在当前位置分配矩形，X 前进
   *
   * @param imageSize — 精灵尺寸
   * @param zRampOrScale — Z 渐变（若有 offset）或缩放因子（若无 offset）
   * @param spriteOffset — 精灵偏移（提供时激活完整版重载）
   * @param scale — 缩放因子（完整版默认 1，简化版由第二个参数决定）
   * @returns 新分配的 Sprite（含图集位置信息）
   */
  allocate(
    imageSize: Size,
    zRampOrScale?: number,
    spriteOffset?: Vec3,
    scale?: number,
  ): Sprite {
    // 重载解析:
    //   allocate(size)           → zRamp=0, offset=zero, scale=1
    //   allocate(size, sc)       → zRamp=0, offset=zero, scale=sc
    //   allocate(size, z, off)   → zRamp=z, offset=off, scale=1
    //   allocate(size, z, off, s)→ zRamp=z, offset=off, scale=s
    const zRamp = (spriteOffset !== undefined) ? (zRampOrScale ?? 0) : 0
    const offset = spriteOffset ?? { x: 0, y: 0, z: 0 }
    const sc = (spriteOffset !== undefined) ? (scale ?? 1) : (zRampOrScale ?? 1)

    this._ensureCurrent()

    const margin = this._margin

    // 步骤 2: 当前行水平空间不足 → 换行
    // 对应 OpenRA: if (imageSize.Width + p.X + margin > Current.Size.Width)
    if (imageSize.width + this._p.x + margin > this.current!.size.width) {
      this._p = { x: 0, y: this._p.y + this._rowHeight + margin }
      this._rowHeight = imageSize.height
    }

    // 步骤 3: 更新行高
    // 对应 OpenRA: if (imageSize.Height > rowHeight) rowHeight = imageSize.Height;
    if (imageSize.height > this._rowHeight) {
      this._rowHeight = imageSize.height
    }

    // 步骤 4: 当前 Sheet 垂直空间不足 → 下一通道或新 Sheet
    // 对应 OpenRA: if (p.Y + imageSize.Height + margin > Current.Size.Height)
    if (this._p.y + imageSize.height + margin > this.current!.size.height) {
      const next = this._nextChannel(this.currentChannel)

      if (next === null) {
        // 无更多通道 → 分配新 Sheet
        const previous = this.current!
        this.current = this._allocateSheet()

        // 尝试复用前一个 Sheet 的缓冲区
        previous.releaseBufferAndTryTransferTo(this.current)

        this._sheets.push(this.current)

        // 重置通道
        this.currentChannel = (this.type === SheetType.Indexed) ? 0 /* Red */ : 4 /* RGBA */
      } else {
        // 使用当前 Sheet 的下一个通道
        this.currentChannel = next
      }

      // 重置打包位置
      this._rowHeight = imageSize.height
      this._p = { x: 0, y: 0 }
    }

    // 步骤 5: 在当前位置分配矩形
    const rect = new Sprite(
      this.current!,
      {
        x: this._p.x + margin,
        y: this._p.y + margin,
        width: imageSize.width,
        height: imageSize.height,
      },
      zRamp,
      offset,
      this.currentChannel as unknown as TextureChannel,
      'Alpha',
      sc,
    )

    // X 前进
    this._p = { x: this._p.x + imageSize.width + margin, y: this._p.y }

    return rect
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /**
   * 确保 Current Sheet 存在（延迟分配第一个 Sheet）。
   *
   * 对应 OpenRA Add/Allocate 中的:
   *   if (Current == null) { Current = allocateSheet(); sheets.Add(Current); }
   */
  private _ensureCurrent(): void {
    if (!this.current) {
      this.current = this._allocateSheet()
      this._sheets.push(this.current)
    }
  }

  /**
   * 获取下一个可用通道。
   *
   * 对应 OpenRA `NextChannel(TextureChannel t)` (SheetBuilder.cs:107-114)。
   *
   * Indexed 类型 (SheetType=1):
   *   0(Red) → 1(Green) → 2(Blue) → 3(Alpha) → null（需要新 Sheet）
   *
   * BGRA 类型 (SheetType=4):
   *   4(RGBA) + 4 = 8 > 3 → null（立即需要新 Sheet）
   *
   * @param t — 当前通道
   * @returns 下一个通道，或 null（表示所有通道已用尽）
   */
  private _nextChannel(t: number): number | null {
    const nextChannel = t + this.type
    if (nextChannel > 3 /* TextureChannel.Alpha */) {
      return null
    }
    return nextChannel
  }

  // -----------------------------------------------------------------------
  // 资源释放
  // -----------------------------------------------------------------------

  /**
   * 释放所有 Sheet 的 GPU 纹理资源。
   *
   * 对应 OpenRA SheetBuilder.Dispose() (SheetBuilder.cs:164-169):
   *   foreach (var sheet in sheets) sheet.Dispose();
   *   sheets.Clear();
   */
  dispose(): void {
    for (const sheet of this._sheets) {
      sheet.dispose()
    }
    this._sheets = []
    this.current = null
    this._p = { x: 0, y: 0 }
    this._rowHeight = 0
  }
}

// ---------------------------------------------------------------------------
// ISpriteFrame 接口（SheetBuilder 依赖的类型）
//
// 对应 OpenRA ISpriteFrame 接口。
// 在 SpriteLoader 迁移前，此处提供最小定义供 SheetBuilder 使用。
// ---------------------------------------------------------------------------

/**
 * 精灵帧接口（最小定义）。
 *
 * 对应 OpenRA ISpriteFrame 接口。
 * 完整定义将在 SpriteLoader 迁移时补全。
 */
export interface ISpriteFrame {
  /** 源像素数据 */
  readonly data: Uint8Array
  /** 数据格式 */
  readonly type: SpriteFrameType
  /** 帧尺寸 */
  readonly size: Size
  /** 帧偏移（可选） */
  readonly offset?: Vec3
}
