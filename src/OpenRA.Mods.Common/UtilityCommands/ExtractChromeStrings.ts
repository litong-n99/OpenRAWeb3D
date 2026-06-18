/**
 * ExtractChromeStrings.ts — 从 Chrome YAML 中提取可翻译字符串并生成 .ftl 文件
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/ExtractChromeStrings.cs (386 lines)
 *
 * 核心范式转换:
 * - C# System.Reflection 扫描 Widget 子类中的 FluentReferenceAttribute
 *   → TypeScript 显式注册表（无反射）
 * - C# MiniYaml.FromFile → JSON 解析（Ch4 Phase H 管道）
 * - C# MiniYamlNodeBuilder (可变 YAML 节点) → JS 可变对象
 * - C# StreamWriter → Node.js fs 或内存缓冲区
 * - C# Fluent .ftl 格式 → 相同格式（Fluent 是标准）
 *
 * 此命令扫描 Chrome 布局文件，查找带有 FluentReference 属性的 Widget 字段，
 * 提取未翻译的字符串，生成 Fluent .ftl 翻译文件，并更新 Chrome 布局。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 提取候选项 — 表示一个要从 Chrome 布局中提取的可翻译字符串。 */
export interface ExtractionCandidate {
  chrome: string | null
  key: string
  type: string
  value: string
  nodes: ChromeYamlNode[]
}

/** 一个简化的 Chrome YAML 节点。 */
export interface ChromeYamlNode {
  key: string
  value: ChromeYamlValue
  children?: ChromeYamlNode[]
}

/** Chrome YAML 节点的值。 */
export interface ChromeYamlValue {
  value: string
  nodes?: ChromeYamlNode[]
}

/** Widget 信息 — 记录一个 widget 类型中哪些字段带有 FluentReference。 */
export interface WidgetFluentInfo {
  /** Widget 类型名称（不含 "Widget" 后缀）。 */
  widgetType: string
  /** 带 FluentReference 属性的字段名列表。 */
  fluentFields: readonly string[]
}

// ---------------------------------------------------------------------------
// String extraction helper functions
// ---------------------------------------------------------------------------

/**
 * 清理容器名称中的噪音词（Background, Container, Panel, headers）。
 *
 * OpenRA 对照: ExtractChromeStringsCommand.ClearContainersAndToLower
 */
export function clearContainersAndToLower(node: string): string {
  return node
    .replace(/Background/gi, '')
    .replace(/Container/gi, '')
    .replace(/Panel/gi, '')
    .toLowerCase()
    .replace(/headers/gi, '')
}

/**
 * 清理并规范化 widget 类型名称。
 *
 * OpenRA 对照: ExtractChromeStringsCommand.ClearTypesAndToLower
 */
export function clearTypesAndToLower(node: string): string {
  return node
    .replace(/LabelForInput/gi, 'Label')
    .replace(/LabelWithHighlight/gi, 'Label')
    .replace(/DropdownButton/gi, 'Dropdown')
    .replace(/CheckboxButton/gi, 'Checkbox')
    .replace(/MenuButton/gi, 'Button')
    .replace(/WorldButton/gi, 'Button')
    .replace(/ProductionTypeButton/gi, 'Button')
    .toLowerCase()
}

/**
 * 检查字符串是否已经被提取（包含 fluent key 引用）。
 *
 * OpenRA 对照: UpdateUtils.IsAlreadyExtracted
 */
export function isAlreadyExtracted(value: string): boolean {
  // A value that has already been extracted is a reference like "key-name"
  // rather than the actual display text. Already extracted strings:
  // - start with a letter
  // - contain only lowercase letters, digits, hyphens, dots, underscores
  // - do not contain spaces or uppercase letters
  const alreadyExtractedPattern = /^[a-z][a-z0-9._-]*(\.[a-z][a-z0-9._-]*)*$/
  return alreadyExtractedPattern.test(value.trim())
}

/**
 * 递归扫描 Chrome 布局节点以查找可提取的字符串。
 *
 * OpenRA 对照: ExtractChromeStringsCommand.FromChromeLayout
 *
 * @param node — 当前 YAML 节点
 * @param widgetInfos — Widget → 字段名映射
 * @param container — 当前容器名称上下文
 * @param candidates — 输出：发现的提取候选项列表
 */
export function fromChromeLayout(
  node: ChromeYamlNode,
  widgetInfos: ReadonlyMap<string, readonly string[]>,
  container: string | null,
  candidates: ExtractionCandidate[],
): void {
  const nodeSplit = node.key.split('@')
  const widgetType = nodeSplit[0]!
  let nodeId: string | null = null
  if (nodeSplit.length > 1) {
    nodeId = clearContainersAndToLower(nodeSplit[1]!)
  }

  // Track container context
  let currentContainer = container
  if (
    (widgetType === 'Background' || widgetType === 'Container') &&
    nodeId !== null
  ) {
    currentContainer = nodeId
  }

  // Collect valid translatable child fields
  const validChildTypes: { node: ChromeYamlNode; type: string; value: string }[] = []
  const fieldNames = widgetInfos.get(widgetType)
  if (fieldNames && node.value?.nodes) {
    for (const childNode of node.value.nodes) {
      const childSplit = childNode.key.split('@')
      const childType = childSplit[0]!
      const childValue = childNode.value?.value

      if (
        fieldNames.includes(childType) &&
        childValue &&
        !isAlreadyExtracted(childValue) &&
        /[a-zA-Z0-9]/.test(childValue)
      ) {
        let replaced = false
        let value = childValue
        if (value.includes('\\n')) {
          value = value.replace(/\\n/g, '\n    ')
          replaced = true
        }

        value = value
          .replace(/\{/g, '<')
          .replace(/\}/g, '>')
          .trim()

        // Preserve indentation
        if (replaced) {
          value = '\n    ' + value
        }

        validChildTypes.push({
          node: childNode,
          type: childType.toLowerCase(),
          value,
        })
      }
    }
  }

  // Generate string key
  if (validChildTypes.length > 0) {
    let cleanedWidgetType = clearTypesAndToLower(widgetType)
    let key = cleanedWidgetType

    if (currentContainer && currentContainer.length > 0) {
      const containerParts = currentContainer
        .split('_')
        .filter((s) => s !== cleanedWidgetType && s.length > 0)
      const containerType = containerParts.join('-')
      if (containerType.length > 0) {
        key = `${key}-${containerType}`
      }
    }

    if (nodeId !== null && nodeId.length > 0) {
      const excludeSet = new Set(
        currentContainer
          ? [...currentContainer.split('_'), cleanedWidgetType]
          : [cleanedWidgetType],
      )
      const filteredNodeId = nodeId
        .split('_')
        .filter((s) => !excludeSet.has(s) && s.length > 0)
        .join('-')

      if (filteredNodeId.length > 0) {
        key = `${key}-${filteredNodeId}`
      }
    }

    for (const { node: childNode, type: childType, value: childValue } of validChildTypes) {
      candidates.push({
        chrome: null,
        key,
        type: childType,
        value: childValue,
        nodes: [childNode],
      })
    }
  }

  // Recurse into Children
  if (node.value?.nodes) {
    for (const childNode of node.value.nodes) {
      if (childNode.key === 'Children' && childNode.value?.nodes) {
        for (const grandchild of childNode.value.nodes) {
          fromChromeLayout(grandchild, widgetInfos, currentContainer, candidates)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// FTL output generation
// ---------------------------------------------------------------------------

/**
 * 将 Chrome 布局候选字符串按 FTL 块组织。
 *
 * 按 chrome 文件名分组候选字符串，匹配重复的键，
 * 并根据匹配数将每个候选放入相应的分组。
 */
export interface GroupedCandidates {
  /** 此组适用的 Chrome 文件名集合。 */
  chromeFiles: ReadonlySet<string>
  /** 属于此组的提取候选项。 */
  candidates: ExtractionCandidate[]
}

/**
 * 将提取候选项分组到 Chrome 文件组中。
 *
 * OpenRA 对照: ExtractChromeStringsCommand.Run 中的分组逻辑
 *
 * @param unsortedCandidates — 未排序的提取候选项
 * @returns 按 chrome 文件名分组的候选项列表
 */
export function groupChromeCandidates(
  unsortedCandidates: ExtractionCandidate[],
): GroupedCandidates[] {
  const grouped = new Map<string, GroupedCandidates>()

  for (const candidate of unsortedCandidates) {
    const chromeFile = candidate.chrome ?? 'unknown'

    // Find an existing group with matching key+type+value
    let foundGroup: GroupedCandidates | undefined
    for (const [, g] of grouped) {
      for (const c of g.candidates) {
        if (c.key === candidate.key && c.type === candidate.type && c.value === candidate.value) {
          foundGroup = g
          break
        }
      }
      if (foundGroup) break
    }

    if (foundGroup) {
      // Merge: create new group with combined files
      const newFiles = new Set(foundGroup.chromeFiles)
      newFiles.add(chromeFile)
      candidate.nodes.push(...foundGroup.candidates.find(
        (c) => c.key === candidate.key && c.type === candidate.type && c.value === candidate.value,
      )?.nodes ?? [])

      // Remove from old group
      const oldCandidates = foundGroup.candidates.filter(
        (c) => !(c.key === candidate.key && c.type === candidate.type && c.value === candidate.value),
      )
      foundGroup.candidates = oldCandidates

      // Find or create merged group
      let mergedKey = [...newFiles].sort().join(',')
      let mergedGroup = grouped.get(mergedKey)
      if (mergedGroup) {
        mergedGroup.candidates.push(candidate)
      } else {
        mergedGroup = { chromeFiles: newFiles, candidates: [candidate] }
        grouped.set(mergedKey, mergedGroup)
      }
    } else {
      // New group for this chrome file
      const existing = grouped.get(chromeFile)
      if (existing) {
        existing.candidates.push(candidate)
      } else {
        grouped.set(chromeFile, {
          chromeFiles: new Set([chromeFile]),
          candidates: [candidate],
        })
      }
    }
  }

  return [...grouped.values()].filter((g) => g.candidates.length > 0)
}

/**
 * 生成 FTL 格式的输出字符串。
 *
 * @param grouped — 分组候选项数组
 * @returns FTL 格式的字符串
 */
export function generateFtlOutput(grouped: GroupedCandidates[]): string {
  const lines: string[] = []

  for (const group of grouped) {
    const chromeFilenames = [...group.chromeFiles].sort().join(', ')
    lines.push(`## ${chromeFilenames}`)

    // Group candidates by key
    const byKey = new Map<string, ExtractionCandidate[]>()
    for (const c of group.candidates) {
      const existing = byKey.get(c.key)
      if (existing) {
        existing.push(c)
      } else {
        byKey.set(c.key, [c])
      }
    }

    let build = ''
    for (const [, groupings] of byKey) {
      if (groupings.length === 1) {
        const candidate = groupings[0]!
        let key = candidate.key
        if (candidate.type !== 'text') {
          key = `${key}-${candidate.type.replace(/text/gi, '')}`
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
          let type = candidate.type
          if (candidate.type !== 'label') {
            if (candidate.type === 'text') {
              type = 'label'
            } else {
              type = type.replace(/text/gi, '')
            }
          }
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
// ExtractChromeStringsCommand
// ---------------------------------------------------------------------------

/**
 * Chrome 字符串提取命令。
 *
 * 用法: --extract-chrome-strings
 *
 * 从 Chrome YAML 布局中提取可翻译字符串，
 * 生成 Fluent .ftl 翻译文件，并更新布局引用。
 *
 * OpenRA 对照: ExtractChromeStringsCommand
 */
export class ExtractChromeStringsCommand implements IUtilityCommand {
  readonly name = '--extract-chrome-strings'

  validateArguments(_args: string[]): boolean {
    return true // no argument requirements
  }

  run(_utility: Utility, _args: string[]): void {
    console.log('ExtractChromeStringsCommand: Extracting chrome strings...')

    // Implement full chrome string extraction when
    // - Widget type registry (ObjectCreator.GetTypes equivalent) is available
    // - FluentReferenceAttribute equivalent exists
    // - Chrome layout loading via MiniYAML is available
    // - Fluent package (.ftl file) read/write is available
    //
    // The extraction algorithm has been fully implemented in the exported functions:
    // - clearContainersAndToLower()
    // - clearTypesAndToLower()
    // - isAlreadyExtracted()
    // - fromChromeLayout()
    // - groupChromeCandidates()
    // - generateFtlOutput()
    //
    // What's missing is the infrastructure to wire them together:
    // 1. Discover all Widget subclasses via ObjectCreator + scan for @FluentReference fields
    // 2. Load chrome layout YAML files from manifest
    // 3. Parse layout YAML into ChromeYamlNode trees
    // 4. Call fromChromeLayout() on root nodes
    // 5. Call groupChromeCandidates() to deduplicate
    // 6. Call generateFtlOutput() to produce .ftl content
    // 7. Write .ftl to fluent package, update layout YAML references

    console.log(': Full chrome string extraction requires:')
    console.log('  - Widget type scanning (ObjectCreator)')
    console.log('  - FluentReference marker on widget fields')
    console.log('  - Chrome layout YAML loading & parsing')
    console.log('  - Fluent package .ftl file I/O')
    console.log()
    console.log('Core extraction algorithms are implemented. See exported functions.')
  }
}
