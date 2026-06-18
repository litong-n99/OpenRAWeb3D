/**
 * ExtractMapRules.ts — 从地图包中提取嵌入的规则定义
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/ExtractMapRules.cs (126 lines)
 *
 * 核心范式转换:
 * - C# MiniYaml MergeAndPrint → JSON 合并和序列化
 * - C# FieldLoader.GetValue<ImmutableArray<string>> → JSON 数组解析
 * - C# MiniYaml.FromStream + ToLines → JSON 字符串格式化
 * - C# FluentMessages base64 编码 → JSON 替代 base64
 *
 * 此命令合并自定义地图规则（Rules, Sequences, Weapons, Voices, Music,
 * Notifications, FluentMessages），并输出为适合包含在 map.yaml 中的格式。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// YAML/JSON node types (simplified for extraction)
// ---------------------------------------------------------------------------

/** 一个 YAML/JSON 节点，表示键值对。 */
export interface YamlNode {
  key: string
  value?: unknown
  nodes?: YamlNode[]
}

/** 用于处理 MiniYAML 流的抽象接口。 */
export interface MapRulesAccess {
  /** 打开包中的文件并返回其内容。 */
  openFile(filename: string): ArrayBuffer | null
  /** 检查包中是否包含某个文件。 */
  containsFile(filename: string): boolean
}

// ---------------------------------------------------------------------------
// Rule merging logic
// ---------------------------------------------------------------------------

/**
 * 合并并格式化地图的规则节点。
 *
 * OpenRA 对照: ExtractMapRules.MergeAndPrint(map, key, value)
 *
 * @param key — 顶级 YAML 键名
 * @param value — MiniYAML 节点（包含 "value" 属性用于 includes，和 "nodes" 子节点）
 * @param mapAccess — 用于读取地图包中文件的接口
 * @returns 合并后的输出字符串
 */
export function mergeAndPrint(
  key: string,
  value: YamlNode | null,
  mapAccess: MapRulesAccess,
): string {
  const nodes: YamlNode[] = []
  const includes: string[] = []

  if (value?.value !== undefined && value.value !== null) {
    // Parse includes from the value field (comma-separated list)
    const includeStr = String(value.value)
    const files = includeStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    let include = false
    for (const f of files) {
      include = include || mapAccess.containsFile(f)
      if (include) {
        // TODO-21.E.10: Parse file via MiniYAML.FromStream equivalent
        // nodes.push(...parseYamlFromBytes(mapAccess.openFile(f), f))
        nodes.push({ key: `# included: ${f}`, value: '(binary — TODO: parse YAML)' })
      } else {
        includes.push(f)
      }
    }
  }

  if (value?.nodes) {
    nodes.push(...value.nodes)
  }

  // Format output
  const includesStr = includes.join(', ')
  const lines: string[] = []
  lines.push(`${key}:${includesStr ? ` ${includesStr}` : ''}`)
  for (const node of nodes) {
    lines.push(`\t${node.key}: ${formatNodeValue(node)}`)
  }

  return lines.join('\n')
}

/**
 * 合并并格式化 Fluent 消息（base64 编码）。
 *
 * OpenRA 对照: ExtractMapRules.MergeAndPrintFluentMessages
 */
export function mergeAndPrintFluentMessages(
  key: string,
  value: YamlNode | null,
  mapAccess: MapRulesAccess,
): string {
  const nodes: YamlNode[] = []
  const includes: string[] = []

  if (value?.value !== undefined && value.value !== null) {
    const includeStr = String(value.value)
    const files = includeStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    let include = false
    for (const f of files) {
      include = include || mapAccess.containsFile(f)
      if (include) {
        const data = mapAccess.openFile(f)
        if (data) {
          const base64 = arrayBufferToBase64(data)
          nodes.push({ key: 'base64', value: base64 })
        }
      } else {
        includes.push(f)
      }
    }
  }

  if (value?.nodes) {
    nodes.push(...value.nodes)
  }

  const includesStr = includes.join(', ')
  const lines: string[] = []
  lines.push(`${key}:${includesStr ? ` ${includesStr}` : ''}`)
  for (const node of nodes) {
    lines.push(`\t${node.key}: ${formatNodeValue(node)}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNodeValue(node: YamlNode): string {
  if (node.value === undefined) return ''
  if (node.value === null) return 'null'
  if (typeof node.value === 'string') return node.value
  if (Array.isArray(node.value)) return node.value.join(', ')
  return String(node.value)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  // Use btoa in browser, or Node.js Buffer
  if (typeof btoa !== 'undefined') {
    return btoa(binary)
  }
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i]!
    const b2 = bytes[i + 1] ?? 0
    const b3 = bytes[i + 2] ?? 0
    result += chars.charAt(b1 >> 2)
    result += chars.charAt(((b1 & 3) << 4) | (b2 >> 4))
    result +=
      i + 1 < bytes.length ? chars.charAt(((b2 & 15) << 2) | (b3 >> 6)) : '='
    result += i + 2 < bytes.length ? chars.charAt(b3 & 63) : '='
  }
  return result
}

// ---------------------------------------------------------------------------
// ExtractMapRules
// ---------------------------------------------------------------------------

/**
 * 地图规则提取命令。
 *
 * 用法: --map-rules MAPFILE
 *
 * 合并自定义地图规则（Rules, Sequences, Weapons, Voices, Music,
 * Notifications, FluentMessages），输出适合包含在 map.yaml 中的格式。
 *
 * OpenRA 对照: ExtractMapRules
 */
export class ExtractMapRules implements IUtilityCommand {
  readonly name = '--map-rules'

  validateArguments(args: string[]): boolean {
    return args.length === 2
  }

  run(_utility: Utility, args: string[]): void {
    const mapPath = args[1]!

    console.log(`ExtractMapRules: Extracting rules from ${mapPath}`)

    // TODO-21.E.10: Implement full extraction when Map constructor with package
    // support and MiniYAML parsing are available.
    //
    // In OpenRA, this creates a Map from the package, then calls MergeAndPrint
    // for each rules section:
    //   var map = new Map(modData, package)
    //   MergeAndPrint(map, "Rules", map.RuleDefinitions)
    //   MergeAndPrint(map, "Sequences", map.SequenceDefinitions)
    //   MergeAndPrint(map, "ModelSequences", map.ModelSequenceDefinitions)
    //   MergeAndPrint(map, "Weapons", map.WeaponDefinitions)
    //   MergeAndPrint(map, "Voices", map.VoiceDefinitions)
    //   MergeAndPrint(map, "Music", map.MusicDefinitions)
    //   MergeAndPrint(map, "Notifications", map.NotificationDefinitions)
    //   MergeAndPrintFluentMessages(map, "FluentMessages", map.FluentMessageDefinitions)

    console.log('TODO-21.E.10: Complete map rules extraction requires:')
    console.log('  - Map constructor with package support')
    console.log('  - MiniYAML parsing (Ch4 Phase H)')
    console.log('  - Map property definitions (RuleDefinitions, SequenceDefinitions, etc.)')

    // Provide the mergeAndPrint utility functions for use when the
    // underlying infrastructure is ready
    console.log('mergeAndPrint() and mergeAndPrintFluentMessages() are available as exports.')
  }
}
