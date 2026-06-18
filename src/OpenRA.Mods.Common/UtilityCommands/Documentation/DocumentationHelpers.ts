/**
 * DocumentationHelpers.ts — 文档生成共享工具函数
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/Documentation/DocumentationHelpers.cs (205 lines)
 *
 * 核心范式转换:
 * - C# PDB/PE 读取 (MetadataReader, PEReader) → 不适用（TypeScript 使用纯 JSON 数据，无 .dll/.pdb）
 * - C# System.Reflection 字段发现 → 显式 TraitInfo 注册表
 * - C# FieldLoader.FieldLoadInfo 反射 → 预提取的字段描述符 JSON
 * - C# ObjectCreator.CreateBasic() → 从预计算默认值注册表查找
 * - C# Enum.GetNames/Enum.Parse → TypeScript 预序列化的枚举值映射 (Record<number, string>)
 * - C# Cache<T> / Lazy<T> → 简单 Map / 函数闭包
 *
 * 此模块提供跨多个文档命令共享的纯字符串格式化工具。
 * 所有反射式数据提取推迟到构建时（MiniYAML 管道），
 * 运行时数据通过显式注册表提供。
 */

import type {
  ExtractedClassFieldInfo,
  ExtractedClassFieldAttributeInfo,
  ExtractedEnumInfo,
  ExtractedTraitInfo,
  ExtractedClassInfo,
} from './Objects.js'

// ---------------------------------------------------------------------------
// TraitDescriptor — 用于文档生成的 trait 信息描述符
// OpenRA 对照: 无（C# 使用反射从 Type 直接提取）
// ---------------------------------------------------------------------------

/** Trait 字段描述符。
 *
 * 表示单个 YAML 可配置字段，预提取自 TraitInfo 类。
 *
 * 比 ExtractedClassFieldInfo 更轻量 —— 仅包含文档生成所需的最小字段集。
 * 调用方在构建时从 YAML/JSON Schema 中填充此数据。
 */
export interface TraitFieldDescriptor {
  /** YAML 属性名。 */
  readonly propertyName: string
  /** 字段类型（用户友好名，如 "integer", "boolean", "string"）。 */
  readonly type: string
  /** 字段默认值（字符串表示）。 */
  readonly defaultValue: string
  /** 描述文本。 */
  readonly description: string
  /** 其他属性（可选）。 */
  readonly attributes?: readonly TraitFieldAttributeDescriptor[]
}

/** 字段属性描述符。 */
export interface TraitFieldAttributeDescriptor {
  readonly name: string
  readonly parameters: Readonly<Record<string, string>>
}

/** Trait 描述符。
 *
 * 表示单个 TraitInfo 类型，包含其字段。
 */
export interface TraitDescriptor {
  /** 命名空间。 */
  readonly namespace: string
  /** trait 名。 */
  readonly name: string
  /** 源文件路径。 */
  readonly filename: string
  /** 描述文本。 */
  readonly description: string
  /** 父类/接口列表。 */
  readonly inheritedTypes: readonly string[]
  /** 此 trait 依赖的其他 trait。 */
  readonly requiresTraits: readonly string[]
  /** 可配置字段列表。 */
  readonly fields: readonly TraitFieldDescriptor[]
}

// ---------------------------------------------------------------------------
// EnumDescriptor — 用于文档生成的枚举描述符
// ---------------------------------------------------------------------------

/** 枚举描述符。 */
export interface EnumDescriptor {
  /** 命名空间。 */
  readonly namespace: string
  /** 枚举名。 */
  readonly name: string
  /** 源文件路径。 */
  readonly filename: string
  /** 整数值 → 名称映射。 */
  readonly values: Record<number, string>
}

// ---------------------------------------------------------------------------
// getAllTraitInfos — 获取所有 trait 信息
// OpenRA 对照: 无直接等价（C# 使用 ObjectCreator.GetTypesImplementing）
// ---------------------------------------------------------------------------

/**
 * 从注册表中获取所有已注册的 trait 描述符。
 *
 * OpenRA 对照: ObjectCreator.GetTypesImplementing<TraitInfo<T>>() 的等效逻辑
 *
 * 在 C# 中，通过反射扫描所有程序集查找 TraitInfo 子类。
 * 在 TypeScript 中，trait 描述符在构建时预先提取并通过注册表传入。
 *
 * @param registry — trait 描述符注册表（名称 → 描述符）
 * @returns 所有 trait 的 ExtractedTraitInfo 条目数组
 */
export function getAllTraitInfos(
  registry: Readonly<Record<string, TraitDescriptor>>,
): ExtractedTraitInfo[] {
  return Object.values(registry).map((desc) => {
    const properties: ExtractedClassFieldInfo[] = desc.fields.map((field) => {
      const otherAttributes: ExtractedClassFieldAttributeInfo[] = (field.attributes ?? []).map(
        (attr) => ({
          Name: attr.name,
          Parameters: Object.entries(attr.parameters).map(([Name, Value]) => ({
            Name,
            Value,
          })),
        }),
      )

      return {
        PropertyName: field.propertyName,
        DefaultValue: field.defaultValue,
        InternalType: field.type,
        UserFriendlyType: field.type,
        Description: field.description,
        OtherAttributes: otherAttributes,
      }
    })

    return {
      Namespace: desc.namespace,
      Name: desc.name,
      Filename: desc.filename,
      Description: desc.description,
      InheritedTypes: desc.inheritedTypes,
      RequiresTraits: desc.requiresTraits,
      Properties: properties,
    }
  })
}

// ---------------------------------------------------------------------------
// getTraitFields — 获取 trait 的可配置字段
// OpenRA 对照: DocumentationHelpers.GetClassFieldInfos()
// ---------------------------------------------------------------------------

/**
 * 从 trait 描述符中提取字段信息。
 *
 * OpenRA 对照: DocumentationHelpers.GetClassFieldInfos(Type type,
 *   IEnumerable<FieldLoader.FieldLoadInfo> fields, HashSet<Type> relatedEnumTypes,
 *   ObjectCreator objectCreator)
 *
 * 在 C# 中，该方法:
 * 1. 使用 FieldLoader 枚举 YAML 可配置字段
 * 2. 检测枚举类型并将其加入 relatedEnumTypes
 * 3. 使用 ObjectCreator 创建默认实例以获取默认值
 * 4. 使用反射读取 DescAttribute 获取描述文本
 *
 * 在 TypeScript 中，所有这些数据在 trait 注册时已预先计算。
 *
 * @param trait — trait 描述符
 * @returns 提取的字段信息数组
 */
export function getTraitFields(trait: TraitDescriptor): ExtractedClassFieldInfo[] {
  return trait.fields.map((field) => {
    const otherAttributes: ExtractedClassFieldAttributeInfo[] = (field.attributes ?? []).map(
      (attr) => ({
        Name: attr.name,
        Parameters: Object.entries(attr.parameters).map(([Name, Value]) => ({
          Name,
          Value,
        })),
      }),
    )

    return {
      PropertyName: field.propertyName,
      DefaultValue: field.defaultValue,
      InternalType: field.type,
      UserFriendlyType: field.type,
      Description: field.description,
      OtherAttributes: otherAttributes,
    }
  })
}

// ---------------------------------------------------------------------------
// getEnumValues — 解析枚举值定义
// OpenRA 对照: DocumentationHelpers.GetRelatedEnumInfos()
// ---------------------------------------------------------------------------

/**
 * 从枚举描述符注册表中解析相关的枚举信息。
 *
 * OpenRA 对照: DocumentationHelpers.GetRelatedEnumInfos(
 *   HashSet<Type> relatedEnumTypes,
 *   Cache<string, IReadOnlyDictionary<string, ImmutableArray<string>>> pdbTypesCache)
 *
 * 在 C# 中，该方法:
 * 1. 遍历 relatedEnumTypes
 * 2. 使用 PDB 缓存查找源文件
 * 3. 使用 Enum.GetNames/Enum.Parse 提取值映射
 *
 * 在 TypeScript 中，所有数据在构建时预提取。
 *
 * @param enumNames — 要查询的枚举名集合
 * @param registry — 枚举描述符注册表（名称 → 描述符）
 * @returns 匹配的枚举信息数组，按名称排序
 */
export function getEnumValues(
  enumNames: ReadonlySet<string>,
  registry: Readonly<Record<string, EnumDescriptor>>,
): ExtractedEnumInfo[] {
  return [...enumNames]
    .filter((name) => name in registry)
    .map((name) => {
      const desc = registry[name]
      return {
        Namespace: desc.namespace,
        Name: desc.name,
        Filename: desc.filename,
        Values: { ...desc.values },
      }
    })
    .sort((a, b) => a.Name.localeCompare(b.Name))
}

// ---------------------------------------------------------------------------
// getSourceFilenameForType — 获取类型的源文件名（存根）
// OpenRA 对照: DocumentationHelpers.GetSourceFilenameForType()
// ---------------------------------------------------------------------------

/**
 * 获取类型的源文件名。
 *
 * OpenRA 对照: DocumentationHelpers.GetSourceFilenameForType(Type type,
 *   Cache<string, IReadOnlyDictionary<string, ImmutableArray<string>>> pdbTypesCache)
 *
 * 在 C# 中，此方法读取 .pdb 文件以将类型映射回其源文件。
 * 在 TypeScript 中，源文件映射由 trait/枚举注册表在构建时提供。
 *
 * @param typeName — 完整类型名
 * @param filenameMap — 类型名到文件名的映射（构建时提供）
 * @returns 源文件路径，如果未知则返回 "(unknown)"
 */
export function getSourceFilenameForType(
  typeName: string,
  filenameMap: Readonly<Record<string, string>>,
): string {
  return filenameMap[typeName] ?? '(unknown)'
}

// ---------------------------------------------------------------------------
// formatTraitDoc — 将 trait 格式化为 markdown 文档
// OpenRA 对照: ExtractTraitDocsCommand.WriteTraitDocs() 的内联格式化逻辑
// ---------------------------------------------------------------------------

/**
 * 将 trait 信息格式化为 markdown 文档。
 *
 * @param trait — trait 信息
 * @param relatedEnums — 关联的枚举信息数组
 * @returns trait 的 markdown 字符串
 */
export function formatTraitDoc(
  trait: ExtractedTraitInfo,
  relatedEnums: readonly ExtractedEnumInfo[],
): string {
  const lines: string[] = []

  lines.push(`# ${trait.Name}`)
  lines.push('')
  lines.push(`**Namespace:** ${trait.Namespace}`)
  lines.push(`**Source:** ${trait.Filename}`)
  lines.push('')

  if (trait.Description) {
    lines.push(trait.Description)
    lines.push('')
  }

  if (trait.InheritedTypes && trait.InheritedTypes.length > 0) {
    lines.push('## Inherited Types')
    lines.push('')
    for (const t of trait.InheritedTypes) {
      lines.push(`- \`${t}\``)
    }
    lines.push('')
  }

  if (trait.RequiresTraits && trait.RequiresTraits.length > 0) {
    lines.push('## Required Traits')
    lines.push('')
    for (const t of trait.RequiresTraits) {
      lines.push(`- \`${t}\``)
    }
    lines.push('')
  }

  if (trait.Properties && trait.Properties.length > 0) {
    lines.push('## Properties')
    lines.push('')
    lines.push('| Property | Type | Default | Description |')
    lines.push('|----------|------|---------|-------------|')
    for (const prop of trait.Properties) {
      const desc = prop.Description.replace(/\|/g, '\\|')
      lines.push(
        `| \`${prop.PropertyName}\` | ${prop.UserFriendlyType} | \`${prop.DefaultValue}\` | ${desc} |`,
      )
    }
    lines.push('')
  }

  if (relatedEnums.length > 0) {
    lines.push('## Related Enums')
    lines.push('')
    for (const enumInfo of relatedEnums) {
      lines.push(`### ${enumInfo.Name}`)
      lines.push('')
      lines.push(`**Source:** ${enumInfo.Filename}`)
      lines.push('')
      lines.push('| Value | Name |')
      lines.push('|-------|------|')
      for (const [value, name] of Object.entries(enumInfo.Values)) {
        lines.push(`| ${value} | \`${name}\` |`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// formatClassInfo — 将类信息格式化为 markdown
// ---------------------------------------------------------------------------

/**
 * 将通用类信息格式化为 markdown。
 *
 * @param classInfo — 提取的类信息
 * @returns markdown 字符串
 */
export function formatClassInfo(classInfo: ExtractedClassInfo): string {
  const lines: string[] = []

  lines.push(`# ${classInfo.Name}`)
  lines.push('')
  lines.push(`**Namespace:** ${classInfo.Namespace}`)
  lines.push(`**Source:** ${classInfo.Filename}`)
  lines.push('')

  if (classInfo.Description) {
    lines.push(classInfo.Description)
    lines.push('')
  }

  if (classInfo.InheritedTypes && classInfo.InheritedTypes.length > 0) {
    lines.push('## Inherited Types')
    lines.push('')
    for (const t of classInfo.InheritedTypes) {
      lines.push(`- \`${t}\``)
    }
    lines.push('')
  }

  if (classInfo.Properties && classInfo.Properties.length > 0) {
    lines.push('## Properties')
    lines.push('')
    lines.push('| Property | Type | Default | Description |')
    lines.push('|----------|------|---------|-------------|')
    for (const prop of classInfo.Properties) {
      const desc = prop.Description.replace(/\|/g, '\\|')
      lines.push(
        `| \`${prop.PropertyName}\` | ${prop.UserFriendlyType} | \`${prop.DefaultValue}\` | ${desc} |`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// SettingsFieldDescriptor — 设置字段描述符（用于 ExtractSettingsDocs）
// ---------------------------------------------------------------------------

/** 设置字段描述符。
 *
 * 表示 SettingsModule 字段，具有先决条件和默认值。
 * OpenRA 对照: Utility.GetFields + DescAttribute 读取
 */
export interface SettingsFieldDescriptor {
  /** 字段名。 */
  readonly name: string
  /** 描述文本行数组。 */
  readonly descriptionLines: readonly string[]
  /** 默认值（字符串表示），如果无默认值则为 null。 */
  readonly defaultValue: string | null
}

// ---------------------------------------------------------------------------
// SettingsSection — 设置节描述符
// OpenRA 对照: SettingsModule.YamlNodeAttribute.Key → 字段集合
// ---------------------------------------------------------------------------

/** 设置节描述符。
 *
 * 表示一个设置节（例如 "Sound", "Graphics", "Input"），
 * 具有其 YAML key 和字段列表。
 *
 * OpenRA 对照: SettingsModule 子类 + YamlNodeAttribute
 */
export interface SettingsSection {
  /** YAML 节键（例如 "Sound", "Graphics"）。 */
  readonly key: string
  /** 此节中的字段。 */
  readonly fields: readonly SettingsFieldDescriptor[]
}
