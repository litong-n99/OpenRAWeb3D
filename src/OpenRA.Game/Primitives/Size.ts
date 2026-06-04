/**
 * Size.ts — 2D size (integer width × height)
 * OpenRA 对照: OpenRA.Primitives.Size
 *
 * 核心范式转换:
 * - C# readonly struct (value type) → TypeScript interface
 * - Structural typing: any { width, height } object satisfies Size
 */

/**
 * 2D size with integer width and height.
 *
 * OpenRA 对照: OpenRA.Primitives.Size
 *
 * Used by CellLayer, Map, and rendering code.
 * Matches the project convention: `{ width: number, height: number }`.
 */
export interface Size {
  width: number
  height: number
}
