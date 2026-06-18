/**
 * Glob.ts — 文件名通配符模式匹配工具
 * OpenRA 对照: OpenRA.Mods.Cnc/UtilityCommands/Glob.cs (127 lines)
 *
 * 核心范式转换:
 * - C# Directory.EnumerateDirectories / Directory.GetFiles → Node.js fs.readdirSync + statSync
 * - C# Path.DirectorySeparatorChar / AltDirectorySeparatorChar → 统一使用正斜杠 (/) + path.sep
 * - C# yield return 枚举器 → 数组返回 + 递归展开
 * - C# Path.Combine → path.join
 *
 * 支持的通配符:
 * - *  — 匹配单个路径段中的任意字符（不包括目录分隔符）
 * - ** — 匹配任意数量的路径段（计划中，目前 C# 版本也不支持 **）
 * - ?  — 匹配单个路径段中的任意单个字符（计划中）
 *
 * Glob 类提供 expand() 方法，将包含通配符的文件路径展开为匹配文件列表。
 * 使用静态属性 Enabled 来全局启用/禁用通配符展开。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 文件系统接口，用于依赖注入和测试模拟。 */
export interface FileSystemInterface {
  /** 检查路径是否存在。 */
  existsSync(filePath: string): boolean
  /** 读取目录条目（文件和子目录名）。 */
  readdirSync(dirPath: string): string[]
  /** 检查路径是否为目录。 */
  isDirectorySync(filePath: string): boolean
  /** 获取文件状态。 */
  statSync(filePath: string): { isDirectory(): boolean; isFile(): boolean }
}

// ---------------------------------------------------------------------------
// Default Node.js filesystem adapter
// ---------------------------------------------------------------------------

const defaultFs: FileSystemInterface = {
  existsSync(filePath: string): boolean {
    return fs.existsSync(filePath)
  },
  readdirSync(dirPath: string): string[] {
    return fs.readdirSync(dirPath)
  },
  isDirectorySync(filePath: string): boolean {
    try {
      return fs.statSync(filePath).isDirectory()
    } catch {
      return false
    }
  },
  statSync(filePath: string) {
    return fs.statSync(filePath)
  },
}

// ---------------------------------------------------------------------------
// Glob
// ---------------------------------------------------------------------------

/**
 * 文件名通配符展开工具类。
 *
 * 支持 * 和 ? 通配符，跨平台路径处理。
 * 在 C&C 旧版导入工具和其他命令行工具中使用，用于批量文件发现。
 *
 * OpenRA 对照: Glob
 */
export class Glob {
  /** 全局启用/禁用通配符展开。禁用时所有路径按原文返回。
   *
   * OpenRA 对照: Glob.Enabled
   */
  static Enabled = true

  private static readonly globChars = ['*', '?']
  private static readonly defaultFs: FileSystemInterface = defaultFs

  /**
   * 展开包含通配符的文件路径为匹配文件列表。
   *
   * OpenRA 对照: Glob.Expand(string)
   *
   * @param filePath — 可能包含通配符的文件路径
   * @param fs — 可选文件系统接口（默认使用 Node.js fs 模块）
   * @returns 匹配的文件路径数组
   */
  static expand(filePath: string, fs: FileSystemInterface = Glob.defaultFs): string[] {
    return Glob.expandInternal(filePath, fs)
  }

  private static needsExpansion(filePath: string): boolean {
    if (!Glob.Enabled) return false
    return Glob.globChars.some(c => filePath.includes(c))
  }

  private static expandInternal(
    filePath: string,
    fs: FileSystemInterface,
  ): string[] {
    if (!Glob.needsExpansion(filePath)) {
      return [filePath]
    }

    // 分割路径为段，保留 "." 或 ".." 前缀
    const sep = path.sep
    const parts = filePath.split(/[/\\]/)

    if (parts.length > 0 && (parts[0] === '.' || parts[0] === '..')) {
      parts[0] = parts[0] + sep
    }

    // 检查是否需要添加 "./" 前缀
    // OpenRA 对照: 同时检查 DirectorySeparatorChar 和 AltDirectorySeparatorChar
    const needDotSlash =
      parts.length === 0 ||
      (parts.length > 0 &&
        parts[0]![0] !== sep &&
        parts[0]![0] !== '/' &&
        parts[0]![0] !== '\\' &&
        !parts[0]!.includes(':') &&
        parts[0] !== '.' + sep &&
        parts[0] !== '..' + sep)

    if (needDotSlash) {
      parts.unshift('.' + sep)
    }

    // 如果最后一个 entry 以目录分隔符结尾，追加 '*'
    const lastPart = parts[parts.length - 1]!
    if (lastPart.endsWith('/') || lastPart.endsWith('\\')) {
      parts.push('*')
    }

    const root = parts[0]!
    const dirs = parts.slice(1, parts.length - 1)
    const file = parts[parts.length - 1]!

    return Glob.expandRecursive(root, dirs, 0, file, fs)
  }

  private static expandRecursive(
    basePath: string,
    dirs: string[],
    dirIndex: number,
    file: string,
    fs: FileSystemInterface,
  ): string[] {
    if (dirIndex < dirs.length) {
      const dir = dirs[dirIndex]!

      if (!Glob.needsExpansion(dir)) {
        const fullPath = path.join(basePath, dir)

        if (!fs.existsSync(fullPath) || !fs.isDirectorySync(fullPath)) {
          return []
        }

        return Glob.expandRecursive(fullPath, dirs, dirIndex + 1, file, fs)
      }

      // 展开中间目录中的通配符
      let dirPattern = dir
      if (dirPattern.endsWith('/') || dirPattern.endsWith('\\')) {
        dirPattern = dirPattern.slice(0, -1)
      }

      const results: string[] = []

      // 将通配符转换为正则表达式
      const dirRegex = Glob.globToRegex(dirPattern)

      try {
        const entries = fs.readdirSync(basePath)
        for (const entry of entries) {
          const fullEntry = path.join(basePath, entry)
          if (fs.isDirectorySync(fullEntry) && dirRegex.test(entry)) {
            results.push(
              ...Glob.expandRecursive(fullEntry, dirs, dirIndex + 1, file, fs),
            )
          }
        }
      } catch {
        // 目录不存在或不可读，返回空
      }

      return results
    }

    // 到达文件级别
    if (!Glob.needsExpansion(file)) {
      const fullPath = path.join(basePath, file)
      if (fs.existsSync(fullPath)) {
        return [fullPath]
      }
      return []
    }

    const fileRegex = Glob.globToRegex(file)
    const results: string[] = []

    try {
      const entries = fs.readdirSync(basePath)
      for (const entry of entries) {
        const fullEntry = path.join(basePath, entry)
        if (fs.statSync(fullEntry).isFile() && fileRegex.test(entry)) {
          results.push(fullEntry)
        }
      }
    } catch {
      // 目录不存在或不可读，返回空
    }

    return results
  }

  /**
   * 将参数列表中的每个参数通过 Glob.Expand 展开并合并。
   *
   * OpenRA 对照: ConvertPngToShpCommand.GlobArgs(string[], startIndex)
   *
   * 用于多个命令中的批量文件发现。
   *
   * @param args — 命令行参数数组
   * @param startIndex — 数组中开始展开的索引（默认 1，跳过命令名）
   * @param fs — 可选文件系统接口
   * @returns 展开后的唯一文件路径数组
   */
  static globArgs(
    args: string[],
    startIndex: number = 1,
    fs: FileSystemInterface = Glob.defaultFs,
  ): string[] {
    const seen = new Set<string>()
    const results: string[] = []

    for (let i = startIndex; i < args.length; i++) {
      for (const expanded of Glob.expand(args[i]!, fs)) {
        if (!seen.has(expanded)) {
          seen.add(expanded)
          results.push(expanded)
        }
      }
    }

    return results
  }

  /**
   * 将通配符模式转换为正则表达式。
   *
   * *  → 匹配零个或多个非分隔符字符
   * ?  → 匹配单个非分隔符字符
   */
  private static globToRegex(pattern: string): RegExp {
    let regexStr = '^'
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]!
      switch (ch) {
        case '*':
          regexStr += '[^/\\\\]*'
          break
        case '?':
          regexStr += '[^/\\\\]'
          break
        case '.':
          regexStr += '\\.'
          break
        case '^':
        case '$':
        case '{':
        case '}':
        case '(':
        case ')':
        case '+':
        case '|':
        case '[':
        case ']':
        case '\\':
          regexStr += '\\' + ch
          break
        default:
          regexStr += ch
          break
      }
    }
    regexStr += '$'
    return new RegExp(regexStr)
  }
}
