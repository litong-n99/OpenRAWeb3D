/**
 * Objects.ts — 文档生成工具的数据对象接口
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/Documentation/Objects/
 *   ExtractedClassFieldAttributeInfo.cs
 *   ExtractedClassFieldInfo.cs
 *   ExtractedClassInfo.cs
 *   ExtractedEnumInfo.cs
 *   ExtractedTraitInfo.cs
 *
 * 核心范式转换:
 * - C# class + { get; set; } entity → TypeScript interface (纯数据结构)
 * - C# IEnumerable<T> → readonly T[]
 * - C# IDictionary<int, string> → Record<number, string>
 * - C# 嵌套类 Parameter → Parameter 作为顶层接口导出
 */

// ---------------------------------------------------------------------------
// ExtractedClassFieldAttributeInfo.Parameter — 属性参数
// OpenRA 对照: ExtractedClassFieldAttributeInfo.Parameter
// ---------------------------------------------------------------------------

/** 属性构造函数参数。
 *
 * OpenRA 对照: ExtractedClassFieldAttributeInfo.Parameter
 */
export interface ExtractedClassFieldAttributeParameter {
  /** 参数名。 */
  readonly Name: string
  /** 参数值（字符串表示）。 */
  readonly Value: string
}

// ---------------------------------------------------------------------------
// ExtractedClassFieldAttributeInfo — 字段属性信息
// OpenRA 对照: ExtractedClassFieldAttributeInfo
// ---------------------------------------------------------------------------

/** 应用于字段的 C# 属性信息。
 *
 * OpenRA 对照: ExtractedClassFieldAttributeInfo
 */
export interface ExtractedClassFieldAttributeInfo {
  /** 属性名（不含 "Attribute" 后缀）。 */
  readonly Name: string
  /** 属性构造参数列表。 */
  readonly Parameters: readonly ExtractedClassFieldAttributeParameter[]
}

// ---------------------------------------------------------------------------
// ExtractedClassFieldInfo — 类字段信息
// OpenRA 对照: ExtractedClassFieldInfo
// ---------------------------------------------------------------------------

/** 从 TraitInfo 或 Settings 类中提取的字段信息。
 *
 * OpenRA 对照: ExtractedClassFieldInfo
 */
export interface ExtractedClassFieldInfo {
  /** YAML 属性名。 */
  readonly PropertyName: string
  /** 字段默认值（字符串表示）。 */
  readonly DefaultValue: string
  /** 内部类型名（如 "Int32"）。 */
  readonly InternalType: string
  /** 用户友好类型名（如 "integer"）。 */
  readonly UserFriendlyType: string
  /** 描述文本。 */
  readonly Description: string
  /** 其他属性（不含 DescAttribute 和 FieldLoader.LoadUsingAttribute）。 */
  readonly OtherAttributes: readonly ExtractedClassFieldAttributeInfo[]
}

// ---------------------------------------------------------------------------
// ExtractedClassInfo — 类信息
// OpenRA 对照: ExtractedClassInfo
// ---------------------------------------------------------------------------

/** 提取的类文档信息。
 *
 * OpenRA 对照: ExtractedClassInfo
 */
export interface ExtractedClassInfo {
  /** 类所在命名空间。 */
  readonly Namespace: string
  /** 类名。 */
  readonly Name: string
  /** 定义此类的源文件名。 */
  readonly Filename: string
  /** 类描述文本。 */
  readonly Description: string
  /** 继承的类型列表。 */
  readonly InheritedTypes: readonly string[]
  /** 字段属性列表。 */
  readonly Properties: readonly ExtractedClassFieldInfo[]
}

// ---------------------------------------------------------------------------
// ExtractedEnumInfo — 枚举信息
// OpenRA 对照: ExtractedEnumInfo (C# record)
// ---------------------------------------------------------------------------

/** 提取的枚举文档信息。
 *
 * OpenRA 对照: ExtractedEnumInfo
 */
export interface ExtractedEnumInfo {
  /** 枚举所在命名空间。 */
  readonly Namespace: string
  /** 枚举名。 */
  readonly Name: string
  /** 定义此枚举的源文件名。 */
  readonly Filename: string
  /** 枚举值映射: 整数值 → 名称。 */
  readonly Values: Record<number, string>
}

// ---------------------------------------------------------------------------
// ExtractedTraitInfo — Trait 信息（继承 ExtractedClassInfo）
// OpenRA 对照: ExtractedTraitInfo : ExtractedClassInfo
// ---------------------------------------------------------------------------

/** 提取的 Trait 文档信息，包含必需的 trait 依赖关系。
 *
 * OpenRA 对照: ExtractedTraitInfo : ExtractedClassInfo
 */
export interface ExtractedTraitInfo extends ExtractedClassInfo {
  /** 此 trait 所依赖的 trait 列表。 */
  readonly RequiresTraits: readonly string[]
}
