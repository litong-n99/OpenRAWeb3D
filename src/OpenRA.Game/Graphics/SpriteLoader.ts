/**
 * SpriteLoader.ts — 精灵帧加载器接口定义
 * OpenRA 对照: OpenRA.Game/Graphics/SpriteLoader.cs
 *
 * 核心范式转换:
 * - C# Stream s → Uint8Array (整个文件缓冲区)
 * - C# out ISpriteFrame[] frames → ISpriteFrame[] | null 返回值
 * - C# out TypeDictionary metadata → object | null 返回值
 * - C# SpriteFrameType enum → TypeScript const enum 替代
 */

// ---------------------------------------------------------------------------
// SpriteFrameType (对应 OpenRA SpriteFrameType enum)
// ---------------------------------------------------------------------------

/** 精灵帧像素格式类型。
 *
 * OpenRA 对照: OpenRA.Graphics.SpriteFrameType
 */
export const SpriteFrameType = {
  /** 8-bit indexed color, palette lookup required. */
  Indexed8: 0,
  /** 32-bit BGRA, no palette lookup needed. */
  Bgra32: 1,
} as const

export type SpriteFrameType = (typeof SpriteFrameType)[keyof typeof SpriteFrameType]

// ---------------------------------------------------------------------------
// Size (对应 OpenRA Primitives.Size)
// ---------------------------------------------------------------------------

/** 二维整数尺寸。
 *
 * OpenRA 对照: OpenRA.Primitives.Size
 */
export interface Size {
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// float2 (对应 OpenRA float2)
// ---------------------------------------------------------------------------

/** 二维浮点向量，用于精灵偏移。
 *
 * OpenRA 对照: OpenRA.float2 (实际上是 (X, Y) 元组)
 */
export interface Float2 {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// ISpriteFrame (对应 OpenRA ISpriteFrame)
// ---------------------------------------------------------------------------

/**
 * 单个精灵帧接口。
 *
 * OpenRA 对照: OpenRA.Graphics.ISpriteFrame
 *
 * 表示精灵表中的单个帧图像。帧可以是索引色（需要调色板查找）
 * 或 BGRA32（直接显示）。
 */
export interface ISpriteFrame {
  /** 像素格式类型。OpenRA 对照: ISpriteFrame.Type */
  readonly type: SpriteFrameType

  /** 帧的裁剪/有效尺寸。OpenRA 对照: ISpriteFrame.Size */
  readonly size: Size

  /** 帧的原始（画布）尺寸。OpenRA 对照: ISpriteFrame.FrameSize */
  readonly frameSize: Size

  /** 帧相对于画布中心的偏移量（像素）。OpenRA 对照: ISpriteFrame.Offset */
  readonly offset: Float2

  /** 帧像素数据。对于 Indexed8，每个字节是一个调色板索引。
   * 对于 Bgra32，每 4 个字节是一个像素 (B, G, R, A)。
   * OpenRA 对照: ISpriteFrame.Data */
  readonly data: Uint8Array

  /** 是否禁用导出填充。OpenRA 对照: ISpriteFrame.DisableExportPadding */
  readonly disableExportPadding: boolean
}

// ---------------------------------------------------------------------------
// ISpriteLoader (对应 OpenRA ISpriteLoader)
// ---------------------------------------------------------------------------

/**
 * 精灵加载器接口 — 尝试解析特定格式的精灵文件。
 *
 * OpenRA 对照: OpenRA.Graphics.ISpriteLoader
 *
 * 加载器检查文件头魔数/格式标记来判断是否能处理该文件。
 * 如果格式不匹配，返回 null（不抛出异常）。
 */
export interface ISpriteLoader {
  /**
   * 尝试将字节缓冲区解析为此加载器支持的精灵帧数组。
   *
   * OpenRA 对照: ISpriteLoader.TryParseSprite(Stream, string, out ISpriteFrame[], out TypeDictionary)
   *
   * @param data — 文件全部内容的字节数组
   * @param filename — 文件名（用于格式识别）
   * @returns { frames, metadata } 如果格式匹配，否则返回 null
   */
  tryParseSprite(
    data: Uint8Array,
    filename: string,
  ): { frames: ISpriteFrame[]; metadata: Record<string, unknown> | null } | null
}
