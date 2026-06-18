/**
 * ColorUtils.ts — Color helper functions and constants for Phase C ScriptGlobals
 * OpenRA 对照: OpenRA.Game/Primitives/Color.cs (full class — not yet migration-ready)
 *
 * The existing src/OpenRA.Game/Primitives/Color.ts module contains only
 * math utility functions (srgbToLinear, premultiplyAlpha, etc.).
 * This module provides the higher-level Color type and named constants
 * needed by ColorGlobal and other Phase C Globals.
 */

/**
 * Color type — packed ARGB uint32 (matching OpenRA System.Drawing.Color / uint).
 *
 * OpenRA 对照: Color struct with single uint argb field
 */
export type ScriptColor = number

// ---------------------------------------------------------------------------
// Construction functions
// ---------------------------------------------------------------------------

/**
 * Create a color from AHSL components.
 *
 * OpenRA 对照: Color.FromAhsl(byte a, float h, float s, float l)
 */
export function colorFromAhsl(a: number, h: number, s: number, l: number): ScriptColor {
  // Convert HSL to RGB using standard algorithm
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h * 6) % 2 - 1))
  const m = l - c / 2

  let r1: number, g1: number, b1: number
  const h6 = h * 6
  if (h6 < 1) { r1 = c; g1 = x; b1 = 0 }
  else if (h6 < 2) { r1 = x; g1 = c; b1 = 0 }
  else if (h6 < 3) { r1 = 0; g1 = c; b1 = x }
  else if (h6 < 4) { r1 = 0; g1 = x; b1 = c }
  else if (h6 < 5) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }

  const r = Math.round((r1 + m) * 255)
  const g = Math.round((g1 + m) * 255)
  const b = Math.round((b1 + m) * 255)

  return colorFromArgb(a, r, g, b)
}

/**
 * Create a color from ARGB components.
 * Each component is clamped to 0-255.
 *
 * OpenRA 对照: Color.FromArgb(int a, int r, int g, int b)
 */
export function colorFromArgb(a: number, r: number, g: number, b: number): ScriptColor {
  const ca = Math.max(0, Math.min(255, a)) & 0xff
  const cr = Math.max(0, Math.min(255, r)) & 0xff
  const cg = Math.max(0, Math.min(255, g)) & 0xff
  const cb = Math.max(0, Math.min(255, b)) & 0xff
  return ((ca << 24) | (cr << 16) | (cg << 8) | cb) >>> 0
}

/**
 * Try to parse a hex color string.
 * Accepts formats: "rrggbb" (6 hex chars) and "rrggbbaa" (8 hex chars).
 *
 * OpenRA 对照: Color.TryParse(string value, out Color color)
 *
 * @returns the ARGB color, or null if parsing fails
 */
export function colorTryParse(value: string): ScriptColor | null {
  const hex = value.replace(/^#/, '')
  if (hex.length === 6) {
    const num = parseInt(hex, 16)
    if (isNaN(num)) return null
    // rrggbb → aarrggbb with alpha=255
    return (0xff000000 | num) >>> 0
  }
  if (hex.length === 8) {
    const num = parseInt(hex, 16)
    if (isNaN(num)) return null
    // rraaggbb → aarrggbb (swap alpha to front)
    const rr = (num >>> 24) & 0xff
    const gg = (num >>> 16) & 0xff
    const bb = (num >>> 8) & 0xff
    const aa = num & 0xff
    return ((aa << 24) | (rr << 16) | (gg << 8) | bb) >>> 0
  }
  return null
}

/**
 * Convert color to hex string "RRGGBBAA".
 *
 * OpenRA 对照: Color.ToString()
 */
export function colorToHexString(color: ScriptColor): string {
  return color.toString(16).padStart(8, '0').toUpperCase()
}

// ---------------------------------------------------------------------------
// Named color constants (matching OpenRA System.Drawing.Color)
// ---------------------------------------------------------------------------

/** FromHex("00FFFF") */
export const Color_Aqua: ScriptColor       = 0xFF00FFFF
/** FromHex("000000") */
export const Color_Black: ScriptColor      = 0xFF000000
/** FromHex("0000FF") */
export const Color_Blue: ScriptColor       = 0xFF0000FF
/** FromHex("A52A2A") */
export const Color_Brown: ScriptColor      = 0xFFA52A2A
/** FromHex("00FFFF") */
export const Color_Cyan: ScriptColor       = 0xFF00FFFF
/** FromHex("00008B") */
export const Color_DarkBlue: ScriptColor   = 0xFF00008B
/** FromHex("008B8B") */
export const Color_DarkCyan: ScriptColor   = 0xFF008B8B
/** FromHex("A9A9A9") */
export const Color_DarkGray: ScriptColor   = 0xFFA9A9A9
/** FromHex("006400") */
export const Color_DarkGreen: ScriptColor  = 0xFF006400
/** FromHex("FF8C00") */
export const Color_DarkOrange: ScriptColor = 0xFFFF8C00
/** FromHex("8B0000") */
export const Color_DarkRed: ScriptColor    = 0xFF8B0000
/** FromHex("FF00FF") */
export const Color_Fuchsia: ScriptColor    = 0xFFFF00FF
/** FromHex("FFD700") */
export const Color_Gold: ScriptColor       = 0xFFFFD700
/** FromHex("808080") */
export const Color_Gray: ScriptColor       = 0xFF808080
/** FromHex("008000") */
export const Color_Green: ScriptColor      = 0xFF008000
/** FromHex("7CFC00") */
export const Color_LawnGreen: ScriptColor  = 0xFF7CFC00
/** FromHex("ADD8E6") */
export const Color_LightBlue: ScriptColor  = 0xFFADD8E6
/** FromHex("E0FFFF") */
export const Color_LightCyan: ScriptColor  = 0xFFE0FFFF
/** FromHex("D3D3D3") */
export const Color_LightGray: ScriptColor  = 0xFFD3D3D3
/** FromHex("90EE90") */
export const Color_LightGreen: ScriptColor = 0xFF90EE90
/** FromHex("FFFFE0") */
export const Color_LightYellow: ScriptColor = 0xFFFFFFE0
/** FromHex("00FF00") */
export const Color_Lime: ScriptColor       = 0xFF00FF00
/** FromHex("32CD32") */
export const Color_LimeGreen: ScriptColor  = 0xFF32CD32
/** FromHex("FF00FF") */
export const Color_Magenta: ScriptColor    = 0xFFFF00FF
/** FromHex("800000") */
export const Color_Maroon: ScriptColor     = 0xFF800000
/** FromHex("000080") */
export const Color_Navy: ScriptColor       = 0xFF000080
/** FromHex("808000") */
export const Color_Olive: ScriptColor      = 0xFF808000
/** FromHex("FFA500") */
export const Color_Orange: ScriptColor     = 0xFFFFA500
/** FromHex("FF4500") */
export const Color_OrangeRed: ScriptColor  = 0xFFFF4500
/** FromHex("800080") */
export const Color_Purple: ScriptColor     = 0xFF800080
/** FromHex("FF0000") */
export const Color_Red: ScriptColor        = 0xFFFF0000
/** FromHex("FA8072") */
export const Color_Salmon: ScriptColor     = 0xFFFA8072
/** FromHex("87CEEB") */
export const Color_SkyBlue: ScriptColor    = 0xFF87CEEB
/** FromHex("008080") */
export const Color_Teal: ScriptColor       = 0xFF008080
/** FromHex("FFFF00") */
export const Color_Yellow: ScriptColor     = 0xFFFFFF00
/** FromHex("FFFFFF") */
export const Color_White: ScriptColor      = 0xFFFFFFFF
