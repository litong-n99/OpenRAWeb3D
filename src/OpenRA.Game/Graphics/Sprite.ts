/**
 * Sprite.ts — OpenRA 精灵定义到 TypeScript/Babylon.js 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/Sprite.cs
 *
 * 核心范式转换:
 * - C# readonly struct/reference type → TypeScript class + 只读属性
 * - Rectangle Bounds → bounds: Rect (像素坐标矩形)
 * - UV 内缩 1/128 像素（防止非 1:1 帧缓冲时的纹理出血） → 精确复制计算
 * - SpriteWithSecondaryData 次纹理 → 扩展属性（供 TerrainSpriteLayer 使用）
 * - Sheet → ISheet 接口（解耦，匹配 SpriteRenderer 的抽象）
 *
 * TextureChannel 枚举:
 *   Red=0, Green=1, Blue=2, Alpha=3, RGBA=4
 *   与 OpenRA TextureChannel (Sprite.cs:73-80) 完全一致。
 *   NOTE: Vertex.ts 中的 TextureChannel 使用不同的值（位编码格式），
 *   那是为 combined.vert 的 SelectChannelMask 位操作设计的，勿混淆。
 */

import type { BlendMode, Rect, Vec3 } from './SpriteRenderer'
import { Sheet } from './Sheet'

// ---------------------------------------------------------------------------
// TextureChannel 枚举（与 OpenRA 完全一致）
//
// 对照: OpenRA.Game/Graphics/Sprite.cs TextureChannel enum (line 73-80)
//
// 这是 TextureChannel 的规范定义。SpriteRenderer.ts 中有一个等价的副本，
// Vertex.ts 中有一个不同值的位编码版本（用于着色器属性）。
// ---------------------------------------------------------------------------

export const TextureChannel = {
  Red: 0,
  Green: 1,
  Blue: 2,
  Alpha: 3,
  RGBA: 4,
} as const
export type TextureChannel = (typeof TextureChannel)[keyof typeof TextureChannel]

// ---------------------------------------------------------------------------
// UV 内缩常量
//
// 某些 GPU 在非 1:1 帧缓冲中渲染时存在精度问题，导致绘制
// 精灵矩形外的一行纹素（纹理出血）。将纹理坐标内缩一小部分像素可避免此问题，
// 对 1:1 渲染的影响忽略不计。
//
// 对应 OpenRA: const float Inset = 1 / 128f; (Sprite.cs:45)
// ---------------------------------------------------------------------------

const UV_INSET = 1 / 128

// ---------------------------------------------------------------------------
// Sprite 类
//
// 对应 OpenRA class Sprite (Sprite.cs:17-51)
//
// Sprite 是精灵渲染的最基本数据单元，包含对纹理图集的引用、
// 像素矩形位置、归一化 UV 坐标，以及混合模式、通道类型、Z 渐变等元数据。
//
// 与 OpenRA 的关键差异:
//   - ISheet 代替具体的 Sheet 类型（与 SpriteRenderer 接口兼容）
//   - readonly 属性代替 C# readonly 字段
//   - 无 float3/float2 值类型 → 使用 {x,y,z} 和 {x,y} 对象
// ---------------------------------------------------------------------------

export class Sprite {
  // -----------------------------------------------------------------------
  // 公共只读属性（与 OpenRA 字段完全对应）
  // -----------------------------------------------------------------------

  /** 所属纹理图集 */
  readonly sheet: Sheet

  /** 图集中的像素坐标矩形 */
  readonly bounds: Rect

  /** 混合模式 */
  readonly blendMode: BlendMode

  /** 纹理通道类型（决定着色器采样方式） */
  readonly channel: TextureChannel

  /** Z 渐变（用于地形高度斜坡效果） */
  readonly zRamp: number

  /** 精灵在世界空间中的尺寸（含 ZRamp 影响） */
  readonly size: Vec3

  /** 精灵偏移（相对于 Actor/WPos 原点的世界空间偏移） */
  readonly offset: Vec3

  /** 归一化 UV 上边界 */
  readonly top: number

  /** 归一化 UV 左边界 */
  readonly left: number

  /** 归一化 UV 下边界 */
  readonly bottom: number

  /** 归一化 UV 右边界 */
  readonly right: number

  // -----------------------------------------------------------------------
  // 构造函数
  //
  // 对应 OpenRA 两个构造重载:
  //   1. Sprite(Sheet, Rectangle bounds, TextureChannel, float scale=1)
  //   2. Sprite(Sheet, Rectangle bounds, float zRamp, in float3 offset,
  //             TextureChannel, BlendMode blendMode, float scale=1f)
  //
  // TypeScript 迁移版将两个重载合并为单一构造函数，通过参数类型区分：
  //   - 若提供 offset 参数，则 param3 为 zRamp, param5 为 channel（完整版）
  //   - 若未提供 offset，则 param3 为 channel, param4 为 scale（简化版）
  // -----------------------------------------------------------------------

  /**
   * 构造 Sprite。
   *
   * 简化版: `new Sprite(sheet, bounds, channel, scale?)`
   *   等效于 `new Sprite(sheet, bounds, 0, {x:0,y:0,z:0}, channel, 'Alpha', scale??1)`
   *
   * 完整版: `new Sprite(sheet, bounds, zRamp, offset, channel, blendMode?, scale?)`
   *
   * @param sheet — 纹理图集
   * @param bounds — 像素坐标矩形
   * @param zRampOrChannel — Z 渐变（完整版）或纹理通道（简化版），类型区分
   * @param offsetOrScale — 精灵偏移（完整版）或缩放因子（简化版）
   * @param channelOrUndefined — 纹理通道（完整版），简化版时应为 undefined
   * @param blendMode — 混合模式（默认 'Alpha'）
   * @param scale — 缩放因子（默认 1）
   */
  constructor(
    sheet: Sheet,
    bounds: Rect,
    zRampOrChannel: number | TextureChannel,
    offsetOrScale?: Vec3 | number,
    channelOrUndefined?: TextureChannel,
    blendMode: BlendMode = 'Alpha',
    scale = 1,
  ) {
    this.sheet = sheet

    // 处理空精灵（size 为 0 时 bounds 为空矩形）
    if (bounds.width === 0 || bounds.height === 0) {
      this.bounds = { x: 0, y: 0, width: 0, height: 0 }
      this.channel = (typeof zRampOrChannel !== 'number'
        ? zRampOrChannel
        : channelOrUndefined!) as TextureChannel
      this.zRamp = 0
      this.offset = { x: 0, y: 0, z: 0 }
      this.blendMode = blendMode
      this.size = { x: 0, y: 0, z: 0 }
      this.left = 0; this.top = 0; this.right = 0; this.bottom = 0
      return
    }

    // 重载解析: 若 zRampOrChannel 是 TextureChannel 数值，则为简化版构造
    //   typeof TextureChannel.Red === 'number' → 与 zRamp 无法区分
    // 区分依据: 若 offsetOrScale 是 Vec3（有 x 属性），则为完整版
    const isFullVersion = offsetOrScale !== undefined
      && typeof offsetOrScale === 'object'
      && 'x' in offsetOrScale

    if (isFullVersion) {
      // 完整版: (sheet, bounds, zRamp, offset, channel, blendMode?, scale?)
      const zRamp = zRampOrChannel as number
      const offset = offsetOrScale as Vec3

      this.channel = channelOrUndefined!
      this.zRamp = zRamp
      this.offset = offset
      this.blendMode = blendMode
      this.bounds = bounds

      const w = bounds.width * scale
      const h = bounds.height * scale
      this.size = { x: w, y: h, z: h * zRamp }
    } else {
      // 简化版: (sheet, bounds, channel, scale?)
      const ch = zRampOrChannel as TextureChannel
      const sc = (typeof offsetOrScale === 'number') ? offsetOrScale : 1

      this.channel = ch
      this.zRamp = 0
      this.offset = { x: 0, y: 0, z: 0 }
      this.blendMode = 'Alpha'
      this.bounds = bounds

      const w = bounds.width * sc
      const h = bounds.height * sc
      this.size = { x: w, y: h, z: h * 0 /* zRamp=0 */ }
    }

    // 计算归一化 UV（与 OpenRA 完全一致）
    // 对应 OpenRA:
    //   Left = (Min(bounds.Left, bounds.Right) + Inset) / sheet.Size.Width;
    //   Top = (Min(bounds.Top, bounds.Bottom) + Inset) / sheet.Size.Height;
    //   Right = (Max(bounds.Left, bounds.Right) - Inset) / sheet.Size.Width;
    //   Bottom = (Max(bounds.Top, bounds.Bottom) - Inset) / sheet.Size.Height;
    const minX = Math.min(bounds.x, bounds.x + bounds.width)
    const maxX = Math.max(bounds.x, bounds.x + bounds.width)
    const minY = Math.min(bounds.y, bounds.y + bounds.height)
    const maxY = Math.max(bounds.y, bounds.y + bounds.height)

    const sheetW = sheet.size.width
    const sheetH = sheet.size.height

    this.left = (minX + UV_INSET) / sheetW
    this.top = (minY + UV_INSET) / sheetH
    this.right = (maxX - UV_INSET) / sheetW
    this.bottom = (maxY - UV_INSET) / sheetH
  }
}

// ---------------------------------------------------------------------------
// SpriteWithSecondaryData — 双纹理精灵
//
// 对应 OpenRA class SpriteWithSecondaryData : Sprite (Sprite.cs:53-71)
//
// 用于需要两个纹理源的精灵（例如带深度/法线数据的地形精灵）。
// 次纹理提供独立的 Sheet、Bounds、Channel 和 UV 坐标。
// ---------------------------------------------------------------------------

export class SpriteWithSecondaryData extends Sprite {
  // -----------------------------------------------------------------------
  // 次纹理属性
  // -----------------------------------------------------------------------

  /** 次纹理图集 */
  readonly secondarySheet: Sheet

  /** 次纹理像素矩形 */
  readonly secondaryBounds: Rect

  /** 次纹理通道类型 */
  readonly secondaryChannel: TextureChannel

  /** 次纹理归一化 UV 坐标 */
  readonly secondaryLeft: number
  readonly secondaryTop: number
  readonly secondaryRight: number
  readonly secondaryBottom: number

  /**
   * 构造 SpriteWithSecondaryData。
   *
   * 对应 OpenRA:
   *   SpriteWithSecondaryData(Sprite s, Sheet secondarySheet,
   *     Rectangle secondaryBounds, TextureChannel secondaryChannel)
   *     : base(s.Sheet, s.Bounds, s.ZRamp, s.Offset, s.Channel, s.BlendMode)
   *
   * @param baseSprite — 基础精灵（提供主纹理 + ZRamp/Offset/BlendMode）
   * @param secondarySheet — 次纹理图集
   * @param secondaryBounds — 次纹理像素矩形
   * @param secondaryChannel — 次纹理通道类型
   */
  constructor(
    baseSprite: Sprite,
    secondarySheet: Sheet,
    secondaryBounds: Rect,
    secondaryChannel: TextureChannel,
  ) {
    // 从基础精灵复制属性（对应 OpenRA base() 调用）
    super(
      baseSprite.sheet,
      baseSprite.bounds,
      baseSprite.zRamp,
      baseSprite.offset,
      baseSprite.channel,
      baseSprite.blendMode,
      1, // scale 已在基础精灵计算中应用
    )

    this.secondarySheet = secondarySheet
    this.secondaryBounds = secondaryBounds
    this.secondaryChannel = secondaryChannel

    // 次纹理 UV（与 OpenRA 完全一致）
    // 注意：次纹理 UV 不使用 Inset（与 OpenRA 一致）
    const sheetW = secondarySheet.size.width
    const sheetH = secondarySheet.size.height
    const minSecX = Math.min(secondaryBounds.x, secondaryBounds.x + secondaryBounds.width)
    const maxSecX = Math.max(secondaryBounds.x, secondaryBounds.x + secondaryBounds.width)
    const minSecY = Math.min(secondaryBounds.y, secondaryBounds.y + secondaryBounds.height)
    const maxSecY = Math.max(secondaryBounds.y, secondaryBounds.y + secondaryBounds.height)

    this.secondaryLeft = minSecX / sheetW
    this.secondaryTop = minSecY / sheetH
    this.secondaryRight = maxSecX / sheetW
    this.secondaryBottom = maxSecY / sheetH
  }
}
