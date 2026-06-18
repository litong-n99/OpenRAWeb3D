/**
 * ExtractYamlStrings.ts — 从规则 YAML 文件中提取可翻译字符串并生成 .ftl 文件
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/ExtractYamlStrings.cs (411 lines)
 *
 * 核心范式转换:
 * - C# System.Reflection 扫描 TraitInfo 子类中的 FluentReferenceAttribute
 *   → TypeScript 显式注册表（无反射）
 * - C# MiniYaml.FromStream / MiniYamlBuilder → JSON 解析
 * - C# TraitInfo / Buildable / Tooltip / Encyclopedia 特殊处理 → 等效逻辑
 * - C# UpdateUtils.LoadModYaml / FilterExternalFiles → JSON 加载和过滤
 * - C# StreamWriter → Node.js fs 或内存缓冲区
 * - C# Fluent .ftl 格式 → 相同格式
 *
 * 此命令扫描 rules YAML 文件，查找带有 FluentReference 属性的 TraitInfo 字段，
 * 提取可翻译字符串（actor 名称、描述、tooltip），
 * 生成 Fluent .ftl 翻译文件，并更新 rules YAML 引用。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 用于规则字符串提取的候选项。 */
export interface YamlExtractionCandidate {
  /** 源文件名。 */
  filename: string | null
  /** 经过转换的 actor 名称（如 "actor-e1"、"meta-vehicle"）。 */
  actor: string
  /** 属性键（如 "name"、"description"、"tooltip"）。 */
  key: string
  /** 原始字符串值。 */
  value: string
  /** 引用的 YAML 节点（可变，用于更新引用）。 */
  nodes: YamlStringNode[]
}

/** 一个简化的 YAML 字符串节点（用于规则提取）。 */
export interface YamlStringNode {
  key: string
  value: { value: string; nodes?: YamlStringNode[] }
  /** 子节点（用于嵌套的 Children 或 trait 属性）。 */
  children?: YamlStringNode[]
}

/** 关于哪些 trait 字段可翻译的信息。 */
export interface TraitFluentInfo {
  /** Trait 名称（不含 "Info" 后缀）。 */
  traitName: string
  /** 带 FluentReference 标记的字段名列表。 */
  fluentFields: readonly string[]
}

// ---------------------------------------------------------------------------
// Name conversion helpers
// ---------------------------------------------------------------------------

/**
 * 将 actor 名称转换为小写、kebab-case 格式。
 *
 * OpenRA 对照: ExtractYamlStringsCommand.ToLowerActor
 *
 * 示例:
 * - "E1" → "actor-e1"
 * - "^Vehicle" → "meta-vehicle"
 * - "HARV.Player" → "actor-harv-player"
 */
export function toLowerActor(actor: string): string {
  const s = actor
    .replace(/\./g, '-')
    .replace(/_/g, '-')
    .toLowerCase()
  if (actor.startsWith('^')) {
    return `meta-${s.slice(1)}`
  }
  return `actor-${s}`
}

/**
 * 将 PascalCase/CamelCase 字符串转换为 kebab-case。
 *
 * OpenRA 对照: ExtractYamlStringsCommand.ToLower (StringBuilder)
 *
 * 示例:
 * - "TooltipName" → "tooltip-name"
 * - "EditorOnlyTooltip" → "editor-only-tooltip"
 */
export function toLower(value: string): string {
  if (!value || value.length === 0) return ''
  const result: string[] = []
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!
    if (c >= 'A' && c <= 'Z') {
      if (i > 0) result.push('-')
      result.push(c.toLowerCase())
    } else {
      result.push(c)
    }
  }
  return result.join('')
}

// ---------------------------------------------------------------------------
// Actor extraction
// ---------------------------------------------------------------------------

/**
 * 从 actor YAML 节点中递归提取可翻译字符串。
 *
 * OpenRA 对照: ExtractYamlStringsCommand.ExtractFromActor
 *
 * 遍历 actor 的所有 trait 节点，检查每个属性的字段是否
 * 在 trait 的 fluentFields 中（即带有 FluentReference 标记），
 * 并生成提取候选项。
 *
 * @param actor — actor YAML 节点
 * @param traitInfos — trait 名称 → 字段名映射
 * @param candidates — 输出：提取候选项列表
 */
export function extractFromActor(
  actor: YamlStringNode,
  traitInfos: ReadonlyMap<string, readonly string[]>,
  candidates: YamlExtractionCandidate[],
): void {
  const actorName = toLowerActor(actor.key)
  const traitNodes = actor.value?.nodes

  if (!traitNodes) return

  for (const trait of traitNodes) {
    if (!trait.key) continue

    const traitSplit = trait.key.split('@')
    const traitInfo = traitSplit[0]!
    const typeFields = traitInfos.get(traitInfo)
    if (!typeFields || !trait.value?.nodes) continue

    for (const property of trait.value.nodes) {
      if (!property.key) continue

      const propertyType = property.key.split('@')[0]!
      if (!typeFields.includes(propertyType)) continue

      const rawValue = property.value?.value
      if (!rawValue || !/[a-zA-Z0-9]/.test(rawValue)) continue

      // Check if already extracted (fluent key reference)
      if (/^[a-z][a-z0-9._-]*(\.[a-z][a-z0-9._-]*)*$/.test(rawValue.trim())) continue

      // Process value: handle \n replacement
      let replaced = false
      let value = rawValue
      if (value.includes('\\n')) {
        value = value.replace(/\\n/g, '\n    ')
        replaced = true
      }
      value = (replaced ? '\n    ' : '') + value.trim()

      // Special handling for Buildable trait
      if (traitInfo === 'Buildable') {
        candidates.push({
          filename: null,
          actor: actorName,
          key: toLower(propertyType),
          value,
          nodes: [property],
        })
        continue
      }

      // Special handling for Encyclopedia trait
      if (traitInfo === 'Encyclopedia') {
        candidates.push({
          filename: null,
          actor: actorName,
          key: toLower(traitInfo),
          value,
          nodes: [property],
        })
        continue
      }

      // Special handling for Tooltip / EditorOnlyTooltip
      if (traitInfo === 'Tooltip' || traitInfo === 'EditorOnlyTooltip') {
        let key: string
        if (traitSplit.length > 1) {
          key = `${traitSplit[1]!.toLowerCase()}-${propertyType}`
        } else {
          key = propertyType
        }
        candidates.push({
          filename: null,
          actor: actorName,
          key: toLower(key),
          value,
          nodes: [property],
        })
        continue
      }

      // General property handling
      let key = traitInfo
      if (traitSplit.length > 1) {
        key += `-${traitSplit[1]}`
      }
      key += `-${toLower(propertyType)}`

      candidates.push({
        filename: null,
        actor: actorName,
        key: key.toLowerCase(),
        value,
        nodes: [property],
      })
    }
  }
}

// ---------------------------------------------------------------------------
// FTL output for YAML rules
// ---------------------------------------------------------------------------

/**
 * 按规则文件名分组的提取候选项。
 */
export interface GroupedYamlCandidates {
  ruleFiles: ReadonlySet<string>
  candidates: YamlExtractionCandidate[]
}

/**
 * 将规则提取候选项分组到规则文件组中。
 *
 * OpenRA 对照: ExtractYamlStringsCommand.ExtractFromFile 中的分组逻辑
 */
export function groupYamlCandidates(
  unsortedCandidates: YamlExtractionCandidate[],
): GroupedYamlCandidates[] {
  const grouped = new Map<string, GroupedYamlCandidates>()

  for (const candidate of unsortedCandidates) {
    const ruleFile = candidate.filename ?? 'unknown'

    // Find existing group with matching actor+key+value
    let foundGroup: GroupedYamlCandidates | undefined
    for (const [, g] of grouped) {
      for (const c of g.candidates) {
        if (c.actor === candidate.actor && c.key === candidate.key && c.value === candidate.value) {
          foundGroup = g
          break
        }
      }
      if (foundGroup) break
    }

    if (foundGroup) {
      const newFiles = new Set(foundGroup.ruleFiles)
      newFiles.add(ruleFile)
      candidate.nodes.push(...foundGroup.candidates.find(
        (c) => c.actor === candidate.actor && c.key === candidate.key && c.value === candidate.value,
      )?.nodes ?? [])

      foundGroup.candidates = foundGroup.candidates.filter(
        (c) => !(c.actor === candidate.actor && c.key === candidate.key && c.value === candidate.value),
      )

      let mergedKey = [...newFiles].sort().join(',')
      let mergedGroup = grouped.get(mergedKey)
      if (mergedGroup) {
        mergedGroup.candidates.push(candidate)
      } else {
        mergedGroup = { ruleFiles: newFiles, candidates: [candidate] }
        grouped.set(mergedKey, mergedGroup)
      }
    } else {
      const existing = grouped.get(ruleFile)
      if (existing) {
        existing.candidates.push(candidate)
      } else {
        grouped.set(ruleFile, {
          ruleFiles: new Set([ruleFile]),
          candidates: [candidate],
        })
      }
    }
  }

  return [...grouped.values()].filter((g) => g.candidates.length > 0)
}

/**
 * 从规则提取候选项生成 FTL 输出。
 *
 * OpenRA 对照: ExtractYamlStringsCommand.ExtractFromFile 中的 FTL 写入逻辑
 */
export function generateYamlFtlOutput(grouped: GroupedYamlCandidates[]): string {
  const lines: string[] = []

  for (const group of grouped) {
    const filenames = [...group.ruleFiles].sort().join(', ')
    lines.push(`## ${filenames}`)

    // Group candidates by actor
    const byActor = new Map<string, YamlExtractionCandidate[]>()
    for (const c of group.candidates) {
      const existing = byActor.get(c.actor)
      if (existing) {
        existing.push(c)
      } else {
        byActor.set(c.actor, [c])
      }
    }

    let build = ''
    for (const [, groupings] of byActor) {
      if (groupings.length === 1) {
        const candidate = groupings[0]!
        let key = `${candidate.actor}-${candidate.key}`
        if (key === 'actor-world-missiondata-briefing') {
          key = 'briefing'
        }
        build += `${key} = ${candidate.value}\n`
        for (const node of candidate.nodes) {
          node.value.value = key
        }
      } else {
        if (build.length >= 2 && build.slice(-2) !== '\n\n') {
          build += '\n'
        }
        const key = groupings[0]!.key
        build += `${key} =\n`
        for (const candidate of groupings) {
          const type = candidate.key
          build += `    .${type} = ${candidate.value}\n`
          for (const node of candidate.nodes) {
            node.value.value = `${key}.${type}`
          }
        }
        build += '\n'
      }
    }

    lines.push(build.trimEnd())
  }

  return lines.join('\n').trim()
}

// ---------------------------------------------------------------------------
// ExtractYamlStringsCommand
// ---------------------------------------------------------------------------

/**
 * YAML 规则字符串提取命令。
 *
 * 用法: --extract-yaml-strings [FILENAME]
 *
 * 从 rules YAML 文件中提取可翻译字符串（actor 名称、描述、tooltip），
 * 生成 Fluent .ftl 翻译文件。
 * 如果指定了 MAPFILE 参数，则从特定地图提取。
 *
 * OpenRA 对照: ExtractYamlStringsCommand
 */
export class ExtractYamlStringsCommand implements IUtilityCommand {
  readonly name = '--extract-yaml-strings'

  validateArguments(args: string[]): boolean {
    return args.length <= 2
  }

  run(_utility: Utility, args: string[]): void {
    if (args.length === 2) {
      const mapPath = args[1]!
      console.log(`ExtractYamlStringsCommand: Extracting from map: ${mapPath}`)
    } else {
      console.log('ExtractYamlStringsCommand: Extracting strings from mod rules...')
    }

    // TODO-21.E.15: Implement full YAML string extraction when:
    // - TraitInfo type registry (ObjectCreator.GetTypes equivalent) is available
    // - FluentReferenceAttribute equivalent exists
    // - Rules YAML loading via MiniYAML is available
    // - Fluent package (.ftl file) read/write is available
    // - MapCache map enumeration is available
    //
    // The extraction algorithm has been fully implemented in the exported functions:
    // - toLowerActor() / toLower()
    // - extractFromActor()
    // - groupYamlCandidates()
    // - generateYamlFtlOutput()
    //
    // What's missing is the infrastructure to wire them together:
    // 1. Discover all TraitInfo subclasses + scan for @FluentReference fields
    // 2. Load rules YAML files from mod and maps
    // 3. Parse rules YAML into actor node trees
    // 4. Call extractFromActor() on each actor node
    // 5. Call groupYamlCandidates() to deduplicate
    // 6. Call generateYamlFtlOutput() to produce .ftl content
    // 7. Write .ftl to fluent package, update rules YAML references

    console.log('TODO-21.E.15: Full YAML string extraction requires:')
    console.log('  - TraitInfo type scanning (ObjectCreator)')
    console.log('  - FluentReference marker on trait fields')
    console.log('  - Rules YAML loading & parsing')
    console.log('  - Map enumeration (MapCache)')
    console.log('  - Fluent package .ftl file I/O')
    console.log()
    console.log('Core extraction algorithms are implemented. See exported functions.')
  }
}
