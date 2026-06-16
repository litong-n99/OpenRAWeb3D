/**
 * TextFieldType.ts — 文本输入字段类型定义
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/TextFieldWidget.cs (line 20)
 *
 * 核心范式转换:
 * - C# enum TextFieldType { General, Filename, Integer } → const 对象 + 联合类型
 *   NOTE: C# 的 'General' 重命名为 'Text'（web 语境更清晰）
 *   NOTE: 新增 'Float'（原 C# 未支持，web 中添加以支持十进制输入）
 *   NOTE: 新增 'Password'（与 PasswordFieldWidget 配套）
 * - 使用 `as const` 对象替代 enum（erasableSyntaxOnly 兼容）
 */

// ---------------------------------------------------------------------------
// TextFieldType — 输入字段类型
// OpenRA 对照: public enum TextFieldType { General, Filename, Integer }
// ---------------------------------------------------------------------------

/** 文本输入字段类型值对象。OpenRA 对照: TextFieldType enum */
export const TextFieldType = {
  /** 自由文本输入（无过滤）。OpenRA 对照: General */
  Text: 'Text',
  /** 文件名输入（过滤非法文件名字符）。OpenRA 对照: Filename */
  Filename: 'Filename',
  /** 整数输入（仅允许数字和可选负号）。OpenRA 对照: Integer */
  Integer: 'Integer',
  /** 浮点数输入（允许数字、一个小数点和可选负号）。web 扩展 */
  Float: 'Float',
  /** 密码输入（视觉屏蔽，值保持明文）。web 扩展 */
  Password: 'Password',
} as const

/** 文本输入字段类型。OpenRA 对照: TextFieldType */
export type TextFieldType = (typeof TextFieldType)[keyof typeof TextFieldType]
