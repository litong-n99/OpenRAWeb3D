/**
 * Color.ts — OpenRA 颜色数学工具函数到 TypeScript 的迁移
 * OpenRA 对照: OpenRA.Game/Primitives/Color.cs
 *
 * 核心范式转换:
 * - C# readonly struct Color(uint argb) → 纯函数模块（无类，仅函数）
 * - Color.ToLinear() → toLinear(a, r, g, b)
 * - Color.FromLinear(byte, float, float, float) → fromLinear(a, r, g, b)
 * - Color.RgbToHsv → rgbToHsv(r, g, b)
 * - Color.HsvToRgb → hsvToRgb(h, s, v)
 * - sRGB 伽玛校正使用标准公式（与 OpenRA 完全一致）
 *
 * NOTE: 此模块仅包含 Palette/HardwarePalette/PlayerColorRemap 所需的数学函数。
 * 完整的 Color 类（含命名颜色、解析等）属于后续迁移任务。
 */

// ---------------------------------------------------------------------------
// sRGB ↔ Linear 色彩空间转换
//
// 对应 OpenRA Color.SrgbToLinear / Color.LinearToSrgb
//
// 使用标准 sRGB 伽玛校正公式（非简单 2.2 伽玛）：
// 参考: https://entropymine.com/imageworsener/srgbformula/
// ---------------------------------------------------------------------------

/**
 * 将 sRGB 分量值转换为线性色彩空间。
 *
 * OpenRA 对照: Color.SrgbToLinear(float c)
 *
 * 公式:
 *   c <= 0.04045 → c / 12.92
 *   c > 0.04045  → ((c + 0.055) / 1.055) ^ 2.4
 *
 * @param c — sRGB 分量值 (0.0 到 1.0)
 * @returns 线性色彩空间值
 */
export function srgbToLinear(c: number): number {
  if (c <= 0.04045) return c / 12.92
  return Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * 将线性分量值转换为 sRGB 色彩空间。
 *
 * OpenRA 对照: Color.LinearToSrgb(float c)
 *
 * 公式:
 *   c <= 0.0031308 → c * 12.92
 *   c > 0.0031308  → 1.055 * c^(1/2.4) - 0.055
 *
 * @param c — 线性色彩空间分量值 (0.0 到 1.0)
 * @returns sRGB 分量值
 */
export function linearToSrgb(c: number): number {
  if (c <= 0.0031308) return c * 12.92
  return 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055
}

// ---------------------------------------------------------------------------
// ARGB ↔ RGBA 分量转换
// ---------------------------------------------------------------------------

/**
 * 将 uint32 ARGB 值拆分为 RGBA 分量。
 *
 * OpenRA 对照: Color.A / Color.R / Color.G / Color.B 属性
 *
 * @param argb — uint32 ARGB 编码颜色（格式: 0xAARRGGBB）
 * @returns { a, r, g, b } 分量 (0-255)
 */
export function fromArgb(argb: number): { a: number; r: number; g: number; b: number } {
  return {
    a: (argb >>> 24) & 0xff,
    r: (argb >>> 16) & 0xff,
    g: (argb >>> 8) & 0xff,
    b: argb & 0xff,
  }
}

/**
 * 将 RGBA 分量编码为 uint32 ARGB 值。
 *
 * OpenRA 对照: Color.FromArgb(int alpha, int red, int green, int blue)
 *
 * @param a — Alpha 分量 (0-255)
 * @param r — 红色分量 (0-255)
 * @param g — 绿色分量 (0-255)
 * @param b — 蓝色分量 (0-255)
 * @returns uint32 ARGB 编码颜色
 */
export function toArgb(a: number, r: number, g: number, b: number): number {
  return (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0
}

// ---------------------------------------------------------------------------
// sRGB ↔ Linear 完整颜色转换（含预乘 Alpha 处理）
//
// 对应 OpenRA Color.ToLinear() / Color.FromLinear()
// ---------------------------------------------------------------------------

/**
 * 将 sRGB 颜色转换为线性色彩空间（撤消预乘 Alpha 和伽玛校正）。
 *
 * OpenRA 对照: Color.ToLinear()
 *
 * 步骤:
 *   1. 撤消预乘 Alpha: r' = R / A, g' = G / A, b' = B / A
 *   2. 应用 sRGB→线性转换: srgbToLinear(r'), srgbToLinear(g'), srgbToLinear(b')
 *
 * @param a — Alpha 分量 (0-255)
 * @param r — sRGB 红色分量 (0-255)
 * @param g — sRGB 绿色分量 (0-255)
 * @param b — sRGB 蓝色分量 (0-255)
 * @returns { r, g, b } 线性色彩空间值
 */
export function toLinear(
  a: number, r: number, g: number, b: number,
): { r: number; g: number; b: number } {
  // 撤消预乘 Alpha
  const alpha = a / 255
  if (alpha === 0) return { r: 0, g: 0, b: 0 }

  return {
    r: srgbToLinear((r / 255) / alpha),
    g: srgbToLinear((g / 255) / alpha),
    b: srgbToLinear((b / 255) / alpha),
  }
}

/**
 * 从线性色彩空间值构建 sRGB 颜色（应用伽玛校正和预乘 Alpha）。
 *
 * OpenRA 对照: Color.FromLinear(byte a, float r, float g, float b)
 *
 * 步骤:
 *   1. 应用线性→sRGB 转换: linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)
 *   2. 应用预乘 Alpha: R' = srgb(r) * A, G' = srgb(g) * A, B' = srgb(b) * A
 *
 * @param a — Alpha 分量 (0-255)
 * @param r — 线性红色值
 * @param g — 线性绿色值
 * @param b — 线性蓝色值
 * @returns { r, g, b, a } sRGB 颜色分量 (0-255)
 */
export function fromLinear(
  a: number, r: number, g: number, b: number,
): { r: number; g: number; b: number; a: number } {
  return {
    r: Math.round(linearToSrgb(r) * a),
    g: Math.round(linearToSrgb(g) * a),
    b: Math.round(linearToSrgb(b) * a),
    a,
  }
}

// ---------------------------------------------------------------------------
// HSV ↔ RGB 转换
//
// 对应 OpenRA Color.RgbToHsv / Color.HsvToRgb
//
// 基于 http://lolengine.net/blog/2013/01/13/fast-rgb-to-hsv 和
//       http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl
// ---------------------------------------------------------------------------

/**
 * 将 RGB 颜色值转换为 HSV 色彩空间。
 *
 * OpenRA 对照: Color.RgbToHsv(float r, float g, float b)
 *
 * @param r — 红色分量 (0.0 到 1.0)
 * @param g — 绿色分量 (0.0 到 1.0)
 * @param b — 蓝色分量 (0.0 到 1.0)
 * @returns { h, s, v } 色调 (0-1)、饱和度 (0-1)、亮度 (0-1)
 */
export function rgbToHsv(
  r: number, g: number, b: number,
): { h: number; s: number; v: number } {
  const rgbMax = Math.max(r, Math.max(g, b))
  const rgbMin = Math.min(r, Math.min(g, b))
  const delta = rgbMax - rgbMin
  const v = rgbMax

  // 灰度定义为色调和饱和度为 0
  if (delta === 0.0) return { h: 0, s: 0, v }

  const s = delta / rgbMax

  let hue: number
  if (r === rgbMax) {
    hue = (g - b) / (6 * delta)
  } else if (g === rgbMax) {
    hue = (b - r) / (6 * delta) + 1 / 3
  } else {
    hue = (r - g) / (6 * delta) + 2 / 3
  }

  // 将负值包装到 [0, 1) 范围
  let h = hue - Math.floor(hue)
  if (h < 0) h++

  return { h, s, v }
}

/**
 * 将 HSV 色彩空间值转换为 RGB。
 *
 * OpenRA 对照: Color.HsvToRgb(float h, float s, float v)
 *
 * @param h — 色调 (0.0 到 1.0)
 * @param s — 饱和度 (0.0 到 1.0)
 * @param v — 亮度 (0.0 到 1.0)
 * @returns { r, g, b } RGB 分量 (0.0 到 1.0)
 */
export function hsvToRgb(
  h: number, s: number, v: number,
): { r: number; g: number; b: number } {
  const px = Math.abs(h * 6 - 3)
  const py = Math.abs(((h + 2 / 3) % 1) * 6 - 3)
  const pz = Math.abs(((h + 1 / 3) % 1) * 6 - 3)

  const r = v * lerp(1, clamp(px - 1, 0, 1), s)
  const gVal = v * lerp(1, clamp(py - 1, 0, 1), s)
  const b = v * lerp(1, clamp(pz - 1, 0, 1), s)

  return { r, g: gVal, b }
}

// ---------------------------------------------------------------------------
// 预乘 Alpha
//
// 对应 OpenRA Util.PremultiplyAlpha (Util.cs:320-326)
// 在 Color.ts 中重新导出以集中色彩函数依赖。
// ---------------------------------------------------------------------------

/**
 * 对 RGBA 颜色执行预乘 Alpha。
 *
 * 若 Alpha = 255，直接返回原值（热路径优化）。
 *
 * @param r — 红色分量 (0-255)
 * @param g — 绿色分量 (0-255)
 * @param b — 蓝色分量 (0-255)
 * @param a — Alpha 分量 (0-255)
 * @returns { r, g, b, a } 预乘后的分量
 */
export function premultiplyAlpha(
  r: number, g: number, b: number, a: number,
): { r: number; g: number; b: number; a: number } {
  if (a === 255) return { r, g, b, a }
  const f = a / 255
  return {
    r: Math.round(r * f),
    g: Math.round(g * f),
    b: Math.round(b * f),
    a,
  }
}

// ---------------------------------------------------------------------------
// 内部辅助函数
// ---------------------------------------------------------------------------

/** 线性插值 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 将值钳位于 [min, max] 范围 */
function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x
}
