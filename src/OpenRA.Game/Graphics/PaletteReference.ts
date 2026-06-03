/**
 * PaletteReference.ts — OpenRA 调色板引用到 TypeScript 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/PaletteReference.cs
 *
 * 核心范式转换:
 * - C# sealed class → TypeScript class
 * - readonly string Name → readonly name
 * - IPalette Palette { get; internal set; } → palette (get + internal set)
 * - HardwarePalette 引用 → 弱引用（后向指针，用于 HasColorShift 查询）
 */

import type { IPalette } from './Palette'
import type { HardwarePalette } from './HardwarePalette'

// ---------------------------------------------------------------------------
// PaletteReference 类
//
// 对应 OpenRA class PaletteReference (PaletteReference.cs:14-31)
//
// PaletteReference 是调色板在硬件中的注册信息，包含：
// - 名称（标识符，如 "player"、"terrain" 等）
// - 在硬件调色板纹理中的行索引（TextureIndex）
// - 调色板数据的引用（IPalette）
// - 硬件调色板后向引用（用于查询 HasColorShift）
// ---------------------------------------------------------------------------

export class PaletteReference {
  /** 调色板名称标识符 */
  readonly name: string

  /** 在硬件调色板纹理中的行索引（行 0 保留给非索引精灵） */
  readonly textureIndex: number

  /** 调色板数据 */
  palette: IPalette

  /** 硬件调色板后向引用（用于查询 HasColorShift） */
  private readonly _hardwarePalette: HardwarePalette | null

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA PaletteReference 构造函数）
  //
  // OpenRA 对照:
  //   PaletteReference(string name, int index, IPalette palette,
  //                   HardwarePalette hardwarePalette)
  // -----------------------------------------------------------------------

  /**
   * 构造 PaletteReference。
   *
   * OpenRA 对照: PaletteReference(string name, int index, IPalette palette, HardwarePalette hardwarePalette)
   *
   * @param name — 调色板名称
   * @param textureIndex — 硬件调色板纹理中的行索引
   * @param palette — 调色板数据
   * @param hardwarePalette — 硬件调色板后向引用
   */
  constructor(
    name: string,
    textureIndex: number,
    palette: IPalette,
    hardwarePalette: HardwarePalette | null = null,
  ) {
    this.name = name
    this.textureIndex = textureIndex
    this.palette = palette
    this._hardwarePalette = hardwarePalette
  }

  // -----------------------------------------------------------------------
  // HasColorShift（对应 OpenRA PaletteReference.HasColorShift）
  //
  // OpenRA 对照:
  //   public bool HasColorShift => hardwarePalette.HasColorShift(Name);
  // -----------------------------------------------------------------------

  /**
   * 查询此调色板是否应用了颜色偏移。
   *
   * OpenRA 对照: PaletteReference.HasColorShift => hardwarePalette.HasColorShift(Name)
   *
   * 颜色偏移用于玩家颜色替换（PlayerColorRemap），
   * 通过修改 HSV 分量实现颜色重新着色。
   *
   * @returns true 如果此调色板有颜色偏移
   */
  get hasColorShift(): boolean {
    if (!this._hardwarePalette) return false
    return this._hardwarePalette.hasColorShift(this.name)
  }
}
