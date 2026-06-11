/**
 * miniyaml-to-json.ts -- MiniYAML to JSON build-time converter
 * OpenRA 对照: (无直接对应，新构建工具)
 *
 * 核心范式转换:
 * - OpenRA MiniYAML → JSON at build time
 * - C# MiniYAML parser → TypeScript recursive descent parser
 *
 * ADR-4.2: MiniYAML MUST be compiled to JSON at build time. The browser never sees MiniYAML.
 */

// ---------------------------------------------------------------------------
// Types and Interfaces
// ---------------------------------------------------------------------------

/** Represents a single parsed MiniYAML node with key, value, optional name, and children. */
interface MiniYamlNode {
  /** The node's key (may contain @Name suffix). */
  key: string
  /** The scalar value (null if no value). */
  value: string | null
  /** Children nodes (empty if leaf). */
  children: MiniYamlNode[]
  /** Source line number for error reporting. */
  line: number
  /** Whether this node was originally an object container (had children before inheritance). */
  wasContainer: boolean
}

/** Parsed line structure from the tokenizer. */
interface ParsedLine {
  /** Indentation level (tabs or 4-space groups). */
  level: number
  /** The key text. */
  key: string | null
  /** The value text (null if no value). */
  value: string | null
  /** Source line number (1-based). */
  line: number
}

/** Error thrown when MiniYAML parsing fails. */
export class MiniYamlParseError extends Error {
  /** Line number where the error occurred (0 if unknown). */
  readonly line: number

  constructor(message: string, line: number = 0) {
    super(line > 0 ? `Line ${line}: ${message}` : message)
    this.name = 'MiniYamlParseError'
    this.line = line
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPACES_PER_LEVEL = 4

/** File extensions recognized as MiniYAML. */
const MINI_YAML_EXTENSIONS = new Set(['.yaml', '.yml', '.miniyaml'])

// ---------------------------------------------------------------------------
// Tokenizer -- Convert raw text into structured lines
// ---------------------------------------------------------------------------

/**
 * Split input into lines, handling both LF and CRLF.
 * OpenRA 对照: MiniYaml.FromLines() line splitting logic
 */
function splitLines(input: string): string[] {
  return input.split(/\r?\n/)
}

/**
 * Parse a single line into indentation level, key, and value.
 * Supports tabs and spaces (4 spaces = 1 level).
 * OpenRA 对照: MiniYaml.FromLines() indentation + key/value extraction
 */
function parseLine(lineText: string, lineNumber: number): ParsedLine | null {
  if (lineText.length === 0) {
    return null
  }

  let level = 0
  let spaces = 0
  let pos = 0

  // Count indentation: tab = 1 level, 4 spaces = 1 level
  while (pos < lineText.length) {
    const ch = lineText.charCodeAt(pos)
    if (ch === 0x09) {
      // Tab
      level++
      pos++
    } else if (ch === 0x20) {
      // Space
      spaces++
      if (spaces >= SPACES_PER_LEVEL) {
        spaces = 0
        level++
      }
      pos++
    } else {
      break
    }
  }

  const content = lineText.slice(pos)

  // Skip comment-only lines
  if (content.length === 0 || content.charCodeAt(0) === 0x23) {
    return null
  }

  // Extract key, value, comment: format is `<key>: <value>#<comment>`
  // The # character is allowed in the value if escaped (\#).
  let key: string | null = null
  let value: string | null = null

  let colonIndex = -1
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 0x3a) {
      // ':'
      colonIndex = i
      break
    }
  }

  if (colonIndex >= 0) {
    key = content.slice(0, colonIndex).trim()
    if (key.length === 0) {
      key = null
    }

    let valueStart = colonIndex + 1
    let rawValue = content.slice(valueStart)

    // Strip inline comments (unescaped #)
    let commentIndex = -1
    for (let i = 0; i < rawValue.length; i++) {
      if (rawValue.charCodeAt(i) === 0x23 && (i === 0 || rawValue.charCodeAt(i - 1) !== 0x5c)) {
        // '#' not preceded by '\'
        commentIndex = i
        break
      }
    }

    if (commentIndex >= 0) {
      rawValue = rawValue.slice(0, commentIndex)
    }

    // Trim value
    rawValue = rawValue.trim()

    // Handle whitespace guards: leading \ before space/tab, trailing \ before space/tab
    if (rawValue.length > 1) {
      const firstChar = rawValue.charCodeAt(0)
      const secondChar = rawValue.charCodeAt(1)
      const lastChar = rawValue.charCodeAt(rawValue.length - 1)
      const secondLastChar = rawValue.charCodeAt(rawValue.length - 2)

      let trimLeading = 0
      let trimTrailing = 0

      if (firstChar === 0x5c && (secondChar === 0x20 || secondChar === 0x09)) {
        trimLeading = 1
      }
      if (lastChar === 0x5c && (secondLastChar === 0x20 || secondLastChar === 0x09)) {
        trimTrailing = 1
      }

      if (trimLeading + trimTrailing > 0) {
        rawValue = rawValue.slice(trimLeading, rawValue.length - trimTrailing)
      }
    }

    // Unescape \# -> #
    if (rawValue.includes('\\#')) {
      rawValue = rawValue.replace(/\\#/g, '#')
    }

    value = rawValue.length > 0 ? rawValue : null
  } else {
    // No colon: entire content is the key (value is null)
    const trimmed = content.trim()
    key = trimmed.length > 0 ? trimmed : null
  }

  return { level, key, value, line: lineNumber }
}

// ---------------------------------------------------------------------------
// Parser -- Build tree structure from tokenized lines
// ---------------------------------------------------------------------------

/**
 * Build a tree of MiniYamlNode from parsed lines.
 * Uses a two-phase approach matching OpenRA's BuildCompletedSubNode algorithm:
 * Phase 1: Collect all parsed lines into a flat list with level info.
 * Phase 2: Build the tree by grouping lines by level.
 * OpenRA 对照: MiniYaml.FromLines() BuildCompletedSubNode logic
 */
function buildTree(lines: ParsedLine[]): MiniYamlNode[] {
  if (lines.length === 0) {
    return []
  }

  // Build nodes bottom-up by tracking parent-child relationships
  // Each entry: { node: MiniYamlNode, level: number, parentIndex: number }
  const entries: Array<{
    node: MiniYamlNode
    level: number
    parentIndex: number
  }> = []

  // Stack tracks the index of the most recent node at each level
  const parentStack: number[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Validate: cannot skip more than one level ahead
    if (line.level > parentStack.length) {
      throw new MiniYamlParseError(
        `Bad indent: level ${line.level} follows level ${parentStack.length - 1}. ` +
          'Indentation must increase by exactly one level at a time.',
        line.line
      )
    }

    // Pop the stack to the correct level
    while (parentStack.length > line.level) {
      parentStack.pop()
    }

    // Determine parent index
    const parentIndex =
      parentStack.length > 0 ? parentStack[parentStack.length - 1] : -1

    const node: MiniYamlNode = {
      key: line.key ?? '',
      value: line.value,
      children: [],
      line: line.line,
      wasContainer: false,
    }

    const entryIndex = entries.length
    entries.push({ node, level: line.level, parentIndex })

    // Push this node as the current parent for the next level
    parentStack.push(entryIndex)
  }

  // Second pass: link children to parents and mark containers
  const rootNodes: MiniYamlNode[] = []
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.parentIndex >= 0) {
      entries[entry.parentIndex].node.children.unshift(entry.node)
      entries[entry.parentIndex].node.wasContainer = true
    } else {
      rootNodes.unshift(entry.node)
    }
  }

  return rootNodes
}

/**
 * Parse raw MiniYAML text into a tree of nodes.
 * This is the core recursive descent entry point.
 */
function parseToNodes(input: string): MiniYamlNode[] {
  const lines = splitLines(input)
  const parsedLines: ParsedLine[] = []

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i], i + 1)
    if (parsed !== null) {
      parsedLines.push(parsed)
    }
  }

  return buildTree(parsedLines)
}

// ---------------------------------------------------------------------------
// JSON Converter -- Convert MiniYamlNode tree to JSON object
// ---------------------------------------------------------------------------

/**
 * Check if a key represents a removal directive (-TraitName).
 * Removal: dash immediately followed by a non-space character.
 * Array item: dash followed by a space.
 * OpenRA 对照: MiniYaml.ResolveInherits() removal handling
 */
function isRemovalKey(key: string): boolean {
  return key.length > 1 && key.charCodeAt(0) === 0x2d && key.charCodeAt(1) !== 0x20 // '-' not followed by space
}

/**
 * Extract the base key and name from a @-suffixed key.
 * e.g. "Key@Name" -> { base: "Key", name: "Name" }
 * OpenRA 对照: MiniYaml @-node naming convention
 */
function parseNamedKey(key: string): { base: string; name: string | null } {
  const atIndex = key.indexOf('@')
  if (atIndex < 0) {
    return { base: key, name: null }
  }
  return {
    base: key.slice(0, atIndex),
    name: key.slice(atIndex + 1),
  }
}

/**
 * Check if a node's children represent an array (all children have dash-prefixed keys or no keys).
 * In MiniYAML, arrays are represented as children with leading dashes or as sequential items.
 */
function isArrayNode(node: MiniYamlNode): boolean {
  if (node.children.length === 0) return false
  // If all children start with '-' or have no keys (just values), it's an array
  let dashCount = 0
  let valueOnlyCount = 0
  for (const child of node.children) {
    if (child.key.length > 0 && child.key.charCodeAt(0) === 0x2d) {
      dashCount++
    } else if (child.key === '' && child.value !== null) {
      valueOnlyCount++
    }
  }
  return dashCount === node.children.length || valueOnlyCount === node.children.length
}

/**
 * Convert a MiniYamlNode tree to a JSON-compatible object.
 * Handles: nested objects, @-named nodes, -TraitName removals, arrays.
 */
function nodesToJson(nodes: MiniYamlNode[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const node of nodes) {
    const { base, name } = parseNamedKey(node.key)

    if (isRemovalKey(node.key)) {
      // -TraitName -> { "TraitName": { "__remove": true } }
      const removedKey = node.key.slice(1)
      result[removedKey] = { __remove: true }
      continue
    }

    if (node.children.length === 0) {
      // Leaf node: just a key-value pair
      if (name !== null) {
        // Named node: Key@Name -> { "Key": { "id": "Name", "value": "..." } }
        // or if value is null, just { "Key": { "id": "Name" } }
        const existing = result[base]
        if (existing !== undefined && Array.isArray(existing)) {
          // Append to existing array
          existing.push(
            name !== null
              ? node.value !== null
                ? { id: name, value: node.value }
                : { id: name }
              : node.value
          )
        } else if (existing !== undefined && typeof existing === 'object' && existing !== null) {
          // Convert to array
          result[base] = [
            existing,
            node.value !== null ? { id: name, value: node.value } : { id: name },
          ]
        } else {
          result[base] =
            node.value !== null ? { id: name, value: node.value } : { id: name }
        }
      } else {
        // If node was originally a container but now has no children, emit empty object
        result[node.key] = node.value !== null ? node.value : node.wasContainer ? {} : null
      }
    } else if (isArrayNode(node)) {
      // Array: children are list items
      const arr: unknown[] = []
      for (const child of node.children) {
        if (child.key.length > 0 && child.key.charCodeAt(0) === 0x2d) {
          // Strip leading dash for array items
          const itemKey = child.key.slice(1).trim()
          if (itemKey.length > 0) {
            // Named array item: "- Item1: value" or "- Item1" with children
            // The value may be on the node itself (from "- Item1: value" parsing)
            if (child.children.length > 0) {
              const childObj = nodesToJson(child.children)
              if (child.value !== null) {
                arr.push({ name: itemKey, value: child.value, ...childObj })
              } else {
                arr.push({ name: itemKey, ...childObj })
              }
            } else if (child.value !== null) {
              arr.push({ name: itemKey, value: child.value })
            } else {
              arr.push(itemKey)
            }
          } else if (child.value !== null) {
            // Value-only array item
            arr.push(child.value)
          } else if (child.children.length > 0) {
            arr.push(nodesToJson(child.children))
          }
        } else if (child.key === '' && child.value !== null) {
          // Value-only entry
          arr.push(child.value)
        } else {
          // Regular child as object
          const childObj = nodesToJson([child])
          arr.push(childObj)
        }
      }

      if (name !== null) {
        const existing = result[base]
        if (existing !== undefined && Array.isArray(existing)) {
          existing.push({ id: name, items: arr })
        } else if (existing !== undefined && typeof existing === 'object' && existing !== null) {
          result[base] = [existing, { id: name, items: arr }]
        } else {
          result[base] = { id: name, items: arr }
        }
      } else {
        result[node.key] = arr
      }
    } else {
      // Object with children
      const childObj = nodesToJson(node.children)

      if (name !== null) {
        const existing = result[base]
        if (existing !== undefined && Array.isArray(existing)) {
          existing.push(
            node.value !== null
              ? { id: name, value: node.value, ...childObj }
              : { id: name, ...childObj }
          )
        } else if (existing !== undefined && typeof existing === 'object' && existing !== null) {
          result[base] = [
            existing,
            node.value !== null
              ? { id: name, value: node.value, ...childObj }
              : { id: name, ...childObj },
          ]
        } else {
          result[base] =
            node.value !== null
              ? { id: name, value: node.value, ...childObj }
              : { id: name, ...childObj }
        }
      } else {
        if (node.value !== null) {
          // Node has both value and children: value goes into a special field
          childObj.__value = node.value
        }
        result[node.key] = childObj
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Inheritance Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve Inherits directives within a parsed tree.
 * This merges parent definitions into child nodes.
 * OpenRA 对照: MiniYaml.ResolveInherits() + MergePartial()
 *
 * NOTE: This is a simplified inheritance resolver. Full OpenRA inheritance
 * supports multi-source merging and complex override chains. For the build-time
 * pipeline, we resolve single-document inheritance.
 */
function resolveInheritance(nodes: MiniYamlNode[]): MiniYamlNode[] {
  // Build a lookup of top-level nodes by key
  const nodeMap = new Map<string, MiniYamlNode>()
  for (const node of nodes) {
    if (!isRemovalKey(node.key) && node.key !== 'Inherits' && !node.key.startsWith('Inherits@')) {
      nodeMap.set(node.key, node)
    }
  }

  const result: MiniYamlNode[] = []

  for (const node of nodes) {
    if (isRemovalKey(node.key)) {
      result.push(node)
      continue
    }

    const inheritedNode = resolveNodeInheritance(node, nodeMap, new Set())
    result.push(inheritedNode)
  }

  return result
}

/**
 * Recursively resolve inheritance for a single node.
 * Keeps Inherits nodes when the parent is not found in the document
 * (external references like ^Building from another file).
 */
function resolveNodeInheritance(
  node: MiniYamlNode,
  nodeMap: Map<string, MiniYamlNode>,
  visited: Set<string>
): MiniYamlNode {
  // Find Inherits directives in children
  const inheritsNodes: MiniYamlNode[] = []
  const otherChildren: MiniYamlNode[] = []

  for (const child of node.children) {
    if (child.key === 'Inherits' || child.key.startsWith('Inherits@')) {
      inheritsNodes.push(child)
    } else {
      otherChildren.push(child)
    }
  }

  if (inheritsNodes.length === 0) {
    // No inheritance: just recursively resolve children
    return {
      ...node,
      children: otherChildren.map((c) =>
        c.children.length > 0 ? resolveNodeInheritance(c, nodeMap, new Set(visited)) : c
      ),
      wasContainer: node.wasContainer || node.children.length > 0,
    }
  }

  // Merge inherited parents
  let mergedChildren: MiniYamlNode[] = [...otherChildren]
  const unresolvedInherits: MiniYamlNode[] = []

  for (const inheritNode of inheritsNodes) {
    const parentKey = inheritNode.value ?? ''
    if (visited.has(parentKey)) {
      throw new MiniYamlParseError(
        `Circular inheritance detected: '${parentKey}' was already inherited`,
        inheritNode.line
      )
    }

    const parent = nodeMap.get(parentKey)
    if (parent !== undefined) {
      const newVisited = new Set(visited)
      newVisited.add(parentKey)
      const resolvedParent = resolveNodeInheritance(parent, nodeMap, newVisited)
      mergedChildren = mergeNodeLists(resolvedParent.children, mergedChildren)
    } else {
      // Parent not found in this document: keep the Inherits node
      unresolvedInherits.push(inheritNode)
    }
  }

  return {
    ...node,
    children: [...unresolvedInherits, ...mergedChildren],
    wasContainer: node.wasContainer || node.children.length > 0,
  }
}

/**
 * Merge two node lists: base nodes are overridden by override nodes.
 * Removal nodes (-Key) remove matching keys from the result.
 * OpenRA 对照: MiniYaml.MergePartial() for node lists
 */
function mergeNodeLists(base: MiniYamlNode[], override: MiniYamlNode[]): MiniYamlNode[] {
  const result: MiniYamlNode[] = []
  const keys = new Set<string>()

  // Add base nodes first
  for (const node of base) {
    if (!isRemovalKey(node.key)) {
      result.push(node)
      keys.add(node.key)
    }
  }

  // Apply overrides and removals
  for (const node of override) {
    if (isRemovalKey(node.key)) {
      const removedKey = node.key.slice(1)
      const index = result.findIndex((n) => n.key === removedKey)
      if (index >= 0) {
        result.splice(index, 1)
        keys.delete(removedKey)
      }
    } else {
      const index = result.findIndex((n) => n.key === node.key)
      if (index >= 0) {
        // Merge: override value wins, children are merged
        const existing = result[index]
        result[index] = {
          ...node,
          value: node.value ?? existing.value,
          children:
            node.children.length > 0 || existing.children.length > 0
              ? mergeNodeLists(existing.children, node.children)
              : [],
          wasContainer: node.wasContainer || existing.wasContainer,
        }
      } else {
        result.push(node)
        keys.add(node.key)
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// MiniYamlParser -- Public API
// ---------------------------------------------------------------------------

/**
 * MiniYAML parser that converts OpenRA's MiniYAML format to JSON.
 *
 * OpenRA 对照: MiniYaml.FromString() + Merge() + ResolveInherits()
 *
 * Supported features:
 * - Tab/space indentation-based nesting
 * - Key: Value pairs
 * - @-named nodes (Key@Name)
 * - -TraitName removal markers
 * - Comment stripping (# to end of line)
 * - Inheritance resolution (Inherits: Parent)
 * - Array detection (children with leading dashes)
 * - Escaped hashes in values (\#)
 * - Whitespace guards (leading/trailing backslash)
 */
export class MiniYamlParser {
  /** Whether to resolve Inherits directives (default: true). */
  resolveInherits: boolean

  constructor(options: { resolveInherits?: boolean } = {}) {
    this.resolveInherits = options.resolveInherits ?? true
  }

  /**
   * Parse a MiniYAML string into a JSON-compatible object.
   *
   * @param input -- The MiniYAML text to parse.
   * @returns A JSON-compatible object representing the parsed YAML.
   * @throws MiniYamlParseError if the input is malformed.
   */
  parse(input: string): unknown {
    let nodes = parseToNodes(input)

    if (this.resolveInherits) {
      nodes = resolveInheritance(nodes)
    }

    return nodesToJson(nodes)
  }

  /**
   * Parse a MiniYAML string and return a JSON string.
   *
   * @param input -- The MiniYAML text to parse.
   * @returns A JSON string with 2-space indentation.
   */
  parseToString(input: string): string {
    const result = this.parse(input)
    return JSON.stringify(result, null, 2)
  }

  /**
   * Parse a MiniYAML file and return the JSON object.
   * NOTE: This is a build-time API. In the browser, this will throw.
   *
   * @param filePath -- Path to the MiniYAML file.
   * @returns Promise resolving to the parsed JSON object.
   * @throws MiniYamlParseError if the file cannot be read or parsed.
   */
  async parseFile(_filePath: string): Promise<unknown> {
    // In a browser environment, we can't read files directly.
    // This method is intended for build-time / Node.js usage.
    // For Vite plugin usage, the file content is passed directly to parse().
    throw new MiniYamlParseError(
      'parseFile() is not available in browser environments. ' +
        'Use parse() with file content string, or use the Vite plugin for build-time compilation.'
    )
  }
}

// ---------------------------------------------------------------------------
// Vite Plugin -- Build-time MiniYAML to JSON transformation
// ---------------------------------------------------------------------------

/**
 * Create a Vite plugin that transforms MiniYAML files to JSON at build time.
 *
 * OpenRA 对照: (new build tooling, no OpenRA equivalent)
 *
 * The plugin:
 * 1. Matches .yaml, .yml, and .miniyaml files
 * 2. Parses MiniYAML content to JSON
 * 3. Emits the result as `export default JSON.parse("...")`
 *
 * Usage in vite.config.ts:
 *   import { miniYamlPlugin } from './src/utils/miniyaml-to-json'
 *   export default { plugins: [miniYamlPlugin()] }
 */
export function miniYamlPlugin(): {
  name: string
  transform(code: string, id: string): { code: string; map: null } | undefined
} {
  return {
    name: 'miniyaml-to-json',

    transform(code: string, id: string): { code: string; map: null } | undefined {
      const ext = id.slice(id.lastIndexOf('.')).toLowerCase()
      if (!MINI_YAML_EXTENSIONS.has(ext)) {
        return undefined
      }

      try {
        const parser = new MiniYamlParser()
        const json = parser.parse(code)
        const jsonString = JSON.stringify(json)

        // Emit as ES module with JSON.parse for efficiency
        const output = `export default JSON.parse(${JSON.stringify(jsonString)});`

        return {
          code: output,
          map: null,
        }
      } catch (error) {
        if (error instanceof MiniYamlParseError) {
          throw error
        }
        throw new MiniYamlParseError(
          `Failed to transform ${id}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

/** Check if a file path has a MiniYAML extension. */
export function isMiniYamlFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return MINI_YAML_EXTENSIONS.has(ext)
}
