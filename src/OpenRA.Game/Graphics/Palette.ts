/**
 * Palette.ts — OpenRA 调色板系统到 TypeScript 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/Palette.cs
 *
 * 核心范式转换:
 * - C# IPalette 接口（uint this[int] 索引器） → TypeScript IPalette 接口
 *   （at(index) 方法——JS 不支持 C# 风格索引器）
 * - ImmutablePalette uint[] colors → Uint32Array colors (256 元素)
 * - MutablePalette uint[] colors → Uint32Array colors (256 元素)
 * - Buffer.BlockCopy → Uint32Array.set()（类型安全批量复制）
 * - ImmutableArray<int> remap params → readonly number[]
 * - File/Stream 构造函数 → 工厂函数（Web 无文件系统直读）
 * - IPaletteRemap 接口保留（用于 PlayerColorRemap 等）
 *
 * NOTE: TypeScript 不支持 C# 风格的 this[int] 索引器。
 * 迁移版使用 at(index) 方法替代。调用 pal.at(i) 而非 pal[i]。
 */

import { fromArgb, toArgb } from '../Primitives/Color'

// ---------------------------------------------------------------------------
// 类型前向声明（避免循环依赖）
// ---------------------------------------------------------------------------

/** sRGB 颜色接口（与 PlatformInterfaces.Color 兼容） */
interface Color {
  r: number
  g: number
  b: number
  a: number
}

// ---------------------------------------------------------------------------
// IPalette 接口（与 OpenRA 一致，索引器替换为 at() 方法）
//
// OpenRA 对照: IPalette (Palette.cs:20-24)
// ---------------------------------------------------------------------------

/**
 * 只读调色板接口。
 *
 * 提供对 256 个 uint32 ARGB 颜色的索引访问。
 * 对应 OpenRA IPalette 接口。
 *
 * NOTE: OpenRA 使用 `uint this[int index]` C# 索引器。
 * TypeScript 不支持此语法，改为 `at(index: number): number` 方法。
 */
export interface IPalette {
  /**
   * 获取指定索引的 uint32 ARGB 颜色值。
   *
   * 对应 OpenRA IPalette.this[int index] 索引器。
   *
   * @param index — 调色板索引 (0-255)
   * @returns uint32 ARGB 编码颜色
   */
  at(index: number): number

  /**
   * 将调色板数据批量复制到目标数组。
   *
   * 对应 OpenRA IPalette.CopyToArray(Array destination, int destinationOffset)
   *
   * @param destination — 目标 Uint32Array
   * @param destinationOffset — 目标偏移量（以 uint32 为单位）
   */
  copyToArray(destination: Uint32Array, destinationOffset: number): void
}

// ---------------------------------------------------------------------------
// IPaletteRemap 接口（与 OpenRA 完全一致）
//
// OpenRA 对照: IPaletteRemap (Palette.cs:26)
// ---------------------------------------------------------------------------

/**
 * 调色板重映射接口。
 *
 * 用于对调色板颜色进行运行时修改（如玩家颜色替换、环境光照等）。
 * 对应 OpenRA IPaletteRemap 接口。
 */
export interface IPaletteRemap {
  /**
   * 获取重映射后的颜色。
   *
   * @param original — 原始颜色
   * @param index — 调色板索引 (0-255)
   * @returns 重映射后的颜色
   */
  getRemappedColor(original: Color, index: number): Color
}

// ---------------------------------------------------------------------------
// Palette 常量与静态方法
//
// OpenRA 对照: static class Palette (Palette.cs:28-54)
// ---------------------------------------------------------------------------

/**
 * 调色板常量（256 色固定大小）。
 *
 * 对应 OpenRA Palette.Size = 256。
 */
export const PALETTE_SIZE = 256

/**
 * 从 IPalette 的指定索引提取 RGBA 颜色。
 *
 * 对应 OpenRA Palette.GetColor(this IPalette palette, int index)
 * （即 Color.FromArgb(palette[index])）。
 *
 * @param palette — 调色板
 * @param index — 颜色索引
 * @returns Color { r, g, b, a }
 */
export function getPaletteColor(palette: IPalette, index: number): Color {
  return fromArgb(palette.at(index))
}

/**
 * 将调色板包装为只读视图。
 *
 * 对应 OpenRA Palette.AsReadOnly(this IPalette palette)
 *
 * 若已是 ImmutablePalette 实例则直接返回；
 * 否则创建一个 ReadOnlyPalette 包装器。
 *
 * @param palette — 任意 IPalette 实现
 * @returns 只读调色板
 */
export function asReadOnly(palette: IPalette): IPalette {
  if (palette instanceof ImmutablePalette) return palette
  return new ReadOnlyPalette(palette)
}

// ---------------------------------------------------------------------------
// ReadOnlyPalette（内部包装类）
//
// OpenRA 对照: Palette.ReadOnlyPalette (Palette.cs:44-54)
// ---------------------------------------------------------------------------

/**
 * 调色板只读包装器。
 *
 * 包装任意 IPalette 实现，提供只读访问保证。
 * 对应 OpenRA Palette.ReadOnlyPalette 内部类。
 *
 * @internal — 通过 Palette.asReadOnly() 创建，不应直接实例化
 */
class ReadOnlyPalette implements IPalette {
  private readonly _inner: IPalette

  constructor(palette: IPalette) {
    this._inner = palette
  }

  at(index: number): number {
    return this._inner.at(index)
  }

  copyToArray(destination: Uint32Array, destinationOffset: number): void {
    this._inner.copyToArray(destination, destinationOffset)
  }
}

// ---------------------------------------------------------------------------
// ImmutablePalette — 不可变调色板（256 uint32 ARGB 颜色）
//
// OpenRA 对照: ImmutablePalette (Palette.cs:57-122)
//
// 五种构造方式（对应 OpenRA 五个构造重载）：
//   1. 从 IPalette 复制        — static fromPalette(p)
//   2. 从 uint32 可迭代序列    — static fromColors(sourceColors)
//   3. 从 IPalette + Remap     — static fromRemapped(p, r)
//   4. 从字节数据（6-bit 格式）— static loadFromBytes(bytes, ...)
// ---------------------------------------------------------------------------

export class ImmutablePalette implements IPalette {
  private readonly _colors: Uint32Array

  // -----------------------------------------------------------------------
  // 构造 1: 从 IPalette 复制
  //
  // OpenRA 对照: ImmutablePalette(IPalette p) (Palette.cs:110-114)
  // -----------------------------------------------------------------------

  /**
   * 从现有 IPalette 创建不可变副本。
   *
   * OpenRA 对照: ImmutablePalette(IPalette p)
   */
  static fromPalette(p: IPalette): ImmutablePalette {
    const inst = new ImmutablePalette(new Uint32Array(PALETTE_SIZE))
    p.copyToArray(inst._colors, 0)
    return inst
  }

  // -----------------------------------------------------------------------
  // 构造 2: 从 uint32 颜色集合
  //
  // OpenRA 对照: ImmutablePalette(IEnumerable<uint> sourceColors) (Palette.cs:116-121)
  // -----------------------------------------------------------------------

  /**
   * 从 uint32 ARGB 颜色序列创建不可变调色板。
   *
   * OpenRA 对照: ImmutablePalette(IEnumerable<uint> sourceColors)
   *
   * @param sourceColors — uint32 ARGB 颜色值数组（最多 256 个）
   */
  static fromColors(sourceColors: number[] | Uint32Array): ImmutablePalette {
    const colors = new Uint32Array(PALETTE_SIZE)
    for (let i = 0; i < Math.min(sourceColors.length, PALETTE_SIZE); i++) {
      colors[i] = sourceColors[i]!
    }
    return new ImmutablePalette(colors)
  }

  // -----------------------------------------------------------------------
  // 构造 3: 从 IPalette + IPaletteRemap 重映射
  //
  // OpenRA 对照: ImmutablePalette(IPalette p, IPaletteRemap r) (Palette.cs:103-108)
  // -----------------------------------------------------------------------

  /**
   * 通过对现有调色板应用重映射创建不可变调色板。
   *
   * OpenRA 对照: ImmutablePalette(IPalette p, IPaletteRemap r)
   *
   * @param p — 源调色板
   * @param r — 重映射策略
   */
  static fromRemapped(p: IPalette, r: IPaletteRemap): ImmutablePalette {
    const colors = new Uint32Array(PALETTE_SIZE)
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const original = getPaletteColor(p, i)
      const remapped = r.getRemappedColor(original, i)
      colors[i] = toArgb(remapped.a, remapped.r, remapped.g, remapped.b)
    }
    return new ImmutablePalette(colors)
  }

  // -----------------------------------------------------------------------
  // 构造 4: 从字节数据创建（6-bit 调色板文件格式）
  //
  // OpenRA 对照: ImmutablePalette(string filename, ...) / ImmutablePalette(Stream s, ...)
  //
  // OpenRA 调色板文件格式：每色 3 字节 (R, G, B)，原值仅 6 位精度。
  // 加载时执行: byte << 2（扩展到 8 位），然后 OR 高位复制低 2 位。
  //
  // 公式: r = (rawR << 2) | (rawR >> 4)
  //       g = (rawG << 2) | (rawG >> 4)
  //       b = (rawB << 2) | (rawB >> 4)
  //       argb = (255 << 24) | (r << 16) | (g << 8) | b
  //
  // 然后应用 remapTransparent（强制 alpha=0）和 remapShadow（alpha=140）。
  // -----------------------------------------------------------------------

  /**
   * 从原始字节数据创建不可变调色板（6-bit 调色板文件格式）。
   *
   * OpenRA 对照: LoadFromStream (Palette.cs:79-101)
   *
   * 每颜色 3 字节 (R, G, B)，6 位精度扩展为 8 位。
   *
   * @param bytes — 原始字节数据（长度 >= PALETTE_SIZE * 3 = 768 字节）
   * @param remapTransparent — 要设为完全透明的颜色索引
   * @param remapShadow — 要设为半透明暗影的颜色索引 (alpha=140)
   * @returns ImmutablePalette 实例
   */
  static loadFromBytes(
    bytes: Uint8Array,
    remapTransparent: readonly number[] = [],
    remapShadow: readonly number[] = [],
  ): ImmutablePalette {
    const colors = new Uint32Array(PALETTE_SIZE)

    for (let i = 0; i < PALETTE_SIZE; i++) {
      const offset = i * 3
      // 6-bit → 8-bit 扩展（与 OpenRA 完全一致）
      const rawR = bytes[offset]!
      const rawG = bytes[offset + 1]!
      const rawB = bytes[offset + 2]!

      // 左移 2 位扩展到 8 位，然后 OR 高位复制低 2 位
      const r = (rawR << 2) | (rawR >> 6)
      const g = (rawG << 2) | (rawG >> 6)
      const b = (rawB << 2) | (rawB >> 6)

      // 构建 ARGB: A=255（透明/暗影索引稍后覆盖）
      colors[i] = ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0
    }

    // 应用透明重映射 (alpha=0)
    for (const idx of remapTransparent) {
      colors[idx] = 0
    }

    // 应用暗影重映射 (alpha=140)
    for (const idx of remapShadow) {
      colors[idx] = (140 << 24) >>> 0
    }

    return new ImmutablePalette(colors)
  }

  // -----------------------------------------------------------------------
  // 私有构造函数（内部使用 Static 工厂方法构造）
  // -----------------------------------------------------------------------

  private constructor(colors: Uint32Array) {
    this._colors = colors
  }

  // -----------------------------------------------------------------------
  // IPalette 实现
  // -----------------------------------------------------------------------

  /**
   * 获取指定索引的 uint32 ARGB 颜色值。
   *
   * 对应 OpenRA ImmutablePalette.this[int index]（C# 索引器）。
   *
   * @param index — 调色板索引 (0-255)
   * @returns uint32 ARGB 编码颜色
   */
  at(index: number): number {
    return this._colors[index]!
  }

  /**
   * 将调色板数据批量复制到目标数组。
   *
   * 对应 OpenRA ImmutablePalette.CopyToArray(Array, int)
   *
   * @param destination — 目标 Uint32Array
   * @param destinationOffset — 目标偏移量（以 uint32 为单位）
   */
  copyToArray(destination: Uint32Array, destinationOffset: number): void {
    destination.set(this._colors, destinationOffset)
  }

  /**
   * 获取内部颜色数组的副本。
   *
   * 提供只读访问，不暴露可变引用。
   *
   * @returns Uint32Array 副本
   */
  get colors(): Uint32Array {
    return new Uint32Array(this._colors)
  }
}

// ---------------------------------------------------------------------------
// MutablePalette — 可变调色板（256 uint32 ARGB 颜色，支持读写）
//
// OpenRA 对照: MutablePalette (Palette.cs:124-159)
//
// NOTE: TypeScript 不支持 C# 风格的 setter 索引器。
// 写操作通过 setColor() 方法实现。
// ---------------------------------------------------------------------------

/**
 * 可变调色板实现。
 *
 * 支持读写访问 256 个调色板条目，以及 ApplyRemap 重映射。
 * 通常由 HardwarePalette 用于管理可变调色板修改。
 *
 * 对应 OpenRA MutablePalette 类。
 */
export class MutablePalette implements IPalette {
  private readonly _colors: Uint32Array

  // -----------------------------------------------------------------------
  // 构造（从 IPalette 复制初始化）
  //
  // OpenRA 对照: MutablePalette(IPalette p) (Palette.cs:139-143)
  // -----------------------------------------------------------------------

  /**
   * 从现有 IPalette 创建可变副本。
   *
   * OpenRA 对照: MutablePalette(IPalette p)
   */
  constructor(p: IPalette) {
    this._colors = new Uint32Array(PALETTE_SIZE)
    p.copyToArray(this._colors, 0)
  }

  // -----------------------------------------------------------------------
  // IPalette 实现
  // -----------------------------------------------------------------------

  /**
   * 读取指定索引的 uint32 ARGB 颜色值。
   *
   * 对应 OpenRA MutablePalette.this[int index].get
   */
  at(index: number): number {
    return this._colors[index]!
  }

  /**
   * 将调色板数据批量复制到目标数组。
   *
   * 对应 OpenRA MutablePalette.CopyToArray(Array, int)
   */
  copyToArray(destination: Uint32Array, destinationOffset: number): void {
    destination.set(this._colors, destinationOffset)
  }

  // -----------------------------------------------------------------------
  // 写操作（对应 OpenRA MutablePalette public 方法）
  // -----------------------------------------------------------------------

  /**
   * 设置指定索引的颜色。
   *
   * 对应 OpenRA MutablePalette.SetColor(int index, Color color)
   * 和 MutablePalette.this[int index].set
   *
   * @param index — 调色板索引 (0-255)
   * @param color — RGBA 颜色
   */
  setColor(index: number, color: Color): void {
    this._colors[index] = toArgb(color.a, color.r, color.g, color.b)
  }

  /**
   * 从另一个 IPalette 复制全部 256 个颜色。
   *
   * 对应 OpenRA MutablePalette.SetFromPalette(IPalette p)
   *
   * @param p — 源调色板
   */
  setFromPalette(p: IPalette): void {
    p.copyToArray(this._colors, 0)
  }

  /**
   * 应用重映射到所有 256 个颜色。
   *
   * 对应 OpenRA MutablePalette.ApplyRemap(IPaletteRemap r)
   *
   * @param r — 重映射策略
   */
  applyRemap(r: IPaletteRemap): void {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const original = getPaletteColor(this, i)
      const remapped = r.getRemappedColor(original, i)
      this._colors[i] = toArgb(remapped.a, remapped.r, remapped.g, remapped.b)
    }
  }

  /**
   * 直接设置内部数组的指定索引值（绕过 Color 包装）。
   *
   * 用于 HardwarePalette 重置机制的高效批量更新。
   *
   * @param index — 调色板索引 (0-255)
   * @param argb — uint32 ARGB 颜色值
   * @internal
   */
  _rawSet(index: number, argb: number): void {
    this._colors[index] = argb
  }

  /**
   * 获取内部颜色数组的副本。
   *
   * @returns Uint32Array 副本（不暴露可变引用）
   */
  get colors(): Uint32Array {
    return new Uint32Array(this._colors)
  }
}
