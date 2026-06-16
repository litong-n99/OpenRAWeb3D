/**
 * TextAlign.ts — 文本对齐枚举定义
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/LabelWidget.cs (lines 19-20)
 *
 * 核心范式转换:
 * - C# enum TextAlign { Left, Center, Right } → TypeScript const 对象 + 字面量类型
 * - C# enum TextVAlign { Top, Middle, Bottom } → TypeScript const 对象 + 字面量类型
 * - CSS 映射: TextAlign → CSS text-align, TextVAlign → CSS flex align-items
 *
 * 注意: 使用 `as const` 对象模式而非 `enum` 关键字，
 * 以满足 `erasableSyntaxOnly` 编译选项要求。
 *
 * 这些枚举被 LabelWidget、ButtonWidget 和许多其他 widget 使用。
 */

// ---------------------------------------------------------------------------
// TextAlign — 水平对齐
// OpenRA 对照: public enum TextAlign { Left, Center, Right }
// ---------------------------------------------------------------------------

/** 水平文本对齐方式。OpenRA 对照: TextAlign */
export const TextAlign = {
  Left: 'Left',
  Center: 'Center',
  Right: 'Right',
} as const

/** 水平文本对齐方式类型。 */
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign]

// ---------------------------------------------------------------------------
// TextVAlign — 垂直对齐
// OpenRA 对照: public enum TextVAlign { Top, Middle, Bottom }
// ---------------------------------------------------------------------------

/** 垂直文本对齐方式。OpenRA 对照: TextVAlign */
export const TextVAlign = {
  Top: 'Top',
  Middle: 'Middle',
  Bottom: 'Bottom',
} as const

/** 垂直文本对齐方式类型。 */
export type TextVAlign = (typeof TextVAlign)[keyof typeof TextVAlign]
