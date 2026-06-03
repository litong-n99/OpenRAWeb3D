/**
 * PlayerColorRemap.ts — OpenRA 玩家颜色重映射到 TypeScript 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/PlayerColorRemap.cs
 *
 * 核心范式转换:
 * - C# IPaletteRemap 实现 → TypeScript IPaletteRemap 实现
 * - Color.ToLinear() 元组解构 → toLinear(a, r, g, b) 函数调用
 * - Color.FromLinear() → fromLinear(a, r, g, b) 函数调用
 * - Color.RgbToHsv / HsvToRgb → rgbToHsv / hsvToRgb 独立函数
 * - ImmutableArray<int> remapIndices → readonly number[]
 *
 * 玩家颜色重映射算法:
 *   1. 仅在 remapIndices 中的索引上应用重映射
 *   2. 将原始颜色转换为线性空间（撤消预乘 Alpha + 伽玛校正）
 *   3. 计算原始颜色的亮度（HSV Value = max(r, g, b)）
 *   4. 使用玩家色调/饱和度 + 原始亮度 × valueMultiplier 构建新 HSV
 *   5. 将新 HSV 转换为线性 RGB
 *   6. 从线性空间转回 sRGB（重新应用伽玛 + 预乘 Alpha）
 *
 * 颜色数学在 linear RGB 色彩空间中执行：
 *   - ToLinear():  撤消预乘 Alpha → srgbToLinear
 *   - FromLinear(): linearToSrgb → 重新预乘 Alpha
 */

import type { IPaletteRemap } from './Palette'
import { toLinear, fromLinear, rgbToHsv } from '../Primitives/Color'

// ---------------------------------------------------------------------------
// Color 局部类型（与 PlatformInterfaces.Color 兼容）
// ---------------------------------------------------------------------------

interface Color {
  r: number
  g: number
  b: number
  a: number
}

// ---------------------------------------------------------------------------
// PlayerColorRemap 类
//
// 对应 OpenRA class PlayerColorRemap : IPaletteRemap (PlayerColorRemap.cs:18-52)
//
// 线性 HSV 重映射用于玩家颜色替换。
// 例如，将单位上的蓝色调色板颜色替换为红色（根据玩家选择的阵营色）。
// ---------------------------------------------------------------------------

export class PlayerColorRemap implements IPaletteRemap {
  /** 需要重映射的调色板索引列表 */
  private readonly _remapIndices: readonly number[]

  /** 玩家颜色色调（0-1） */
  private readonly _hue: number

  /** 玩家颜色饱和度（0-1） */
  private readonly _saturation: number

  /** 玩家颜色亮度值（用于亮度缩放） */
  private readonly _value: number

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA PlayerColorRemap 构造函数）
  //
  // OpenRA 对照:
  //   PlayerColorRemap(ImmutableArray<int> remapIndices, Color color)
  //
  //   1. 将玩家颜色转换为线性空间
  //   2. 提取 HSV 分量（保留色调、饱和度、亮度）
  //   3. 存储 remapIndices 用于后续查找判断
  // -----------------------------------------------------------------------

  /**
   * 构造 PlayerColorRemap。
   *
   * OpenRA 对照: PlayerColorRemap(ImmutableArray<int> remapIndices, Color color)
   *
   * @param remapIndices — 需要重映射的调色板颜色索引列表
   * @param playerColor — 玩家阵营颜色（sRGB, 0-255)
   */
  constructor(remapIndices: readonly number[], playerColor: Color) {
    this._remapIndices = remapIndices

    // 将玩家颜色转换到线性色彩空间
    // 对应 OpenRA: var (r, g, b) = color.ToLinear();
    const { r, g, b } = toLinear(
      playerColor.a, playerColor.r, playerColor.g, playerColor.b,
    )

    // 提取 HSV 分量
    // 对应 OpenRA: (hue, saturation, value) = Color.RgbToHsv(r, g, b);
    const hsv = rgbToHsv(r, g, b)

    this._hue = hsv.h
    this._saturation = hsv.s
    this._value = hsv.v
  }

  // -----------------------------------------------------------------------
  // GetRemappedColor（对应 OpenRA PlayerColorRemap.GetRemappedColor）
  //
  // OpenRA 对照:
  //   Color GetRemappedColor(Color original, int index)
  // -----------------------------------------------------------------------

  /**
   * 获取重映射后的颜色。
   *
   * OpenRA 对照: PlayerColorRemap.GetRemappedColor(Color original, int index)
   *
   * 若原始颜色索引不在 remapIndices 中，直接返回原始颜色（不变）。
   * 否则在 HSV 色彩空间中应用玩家颜色替换。
   *
   * 算法步骤:
   *   1. 检查索引是否在 remapIndices 中
   *   2. 将原始颜色转换为线性空间
   *   3. 计算原始颜色的亮度: value = max(r, g, b)（单行内联 RgbToHsv）
   *   4. 构造新颜色: HsvToRgb(_hue, _saturation, value * _value)
   *   5. 从线性空间转回 sRGB
   *
   * @param original — 原始颜色（sRGB, 0-255)
   * @param index — 调色板索引
   * @returns 重映射后的颜色（或原始颜色如果索引不在 remapIndices 中）
   */
  getRemappedColor(original: Color, index: number): Color {
    // 仅在 remapIndices 中的索引上应用重映射
    // 对应 OpenRA: if (!remapIndices.Contains(index)) return original;
    if (!this._remapIndices.includes(index)) {
      return original
    }

    // 步骤 2: 将原始颜色转换为线性色彩空间
    // 对应 OpenRA: var (r, g, b) = original.ToLinear();
    const linear = toLinear(
      original.a, original.r, original.g, original.b,
    )

    // 步骤 3: 计算亮度（内联 RgbToHsv 的 Value 计算）
    // 对应 OpenRA: var value = Math.Max(Math.Max(r, g), b);
    const value = Math.max(linear.r, Math.max(linear.g, linear.b))

    // 步骤 4: 构造新的 HSV → RGB 颜色
    // 对应 OpenRA: (r, g, b) = Color.HsvToRgb(hue, saturation, value * this.value);
    // 内联 hsvToRgb 计算
    const newRgb = this._hsvToRgb(
      this._hue, this._saturation, value * this._value,
    )

    // 步骤 5: 从线性空间转回 sRGB（重新应用伽玛 + 预乘 Alpha）
    // 对应 OpenRA: return Color.FromLinear(original.A, r, g, b);
    return fromLinear(
      original.a, newRgb.r, newRgb.g, newRgb.b,
    )
  }

  // -----------------------------------------------------------------------
  // 内部 HSV→RGB 转换（内联实现以匹配 OpenRA 的 Color.HsvToRgb）
  //
  // 对应 OpenRA Color.HsvToRgb (Color.cs:109-121)
  // -----------------------------------------------------------------------

  /**
   * 将 HSV 色彩空间值转换为线性 RGB。
   *
   * 与 Color.ts 中的 hsvToRgb 函数完全一致的实现。
   * 作为私有方法内联以保持类自包含（匹配 OpenRA 直接调用 Color.HsvToRgb）。
   *
   * @param h — 色调 (0-1)
   * @param s — 饱和度 (0-1)
   * @param v — 亮度 (0-1)
   * @returns 线性 RGB 分量
   */
  private _hsvToRgb(
    h: number, s: number, v: number,
  ): { r: number; g: number; b: number } {
    const px = Math.abs(h * 6 - 3)
    const py = Math.abs(((h + 2 / 3) % 1) * 6 - 3)
    const pz = Math.abs(((h + 1 / 3) % 1) * 6 - 3)

    const r = v * this._lerp(1, this._clamp(px - 1, 0, 1), s)
    const g = v * this._lerp(1, this._clamp(py - 1, 0, 1), s)
    const b = v * this._lerp(1, this._clamp(pz - 1, 0, 1), s)

    return { r, g, b }
  }

  private _lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  private _clamp(x: number, min: number, max: number): number {
    return x < min ? min : x > max ? max : x
  }
}
