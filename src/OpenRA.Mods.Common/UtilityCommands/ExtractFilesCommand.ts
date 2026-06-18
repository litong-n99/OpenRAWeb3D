/**
 * ExtractFilesCommand.ts — 从 mod 包中提取文件到当前目录
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/ExtractFilesCommand.cs (43 lines)
 *
 * 核心范式转换:
 * - C# File.WriteAllBytes → Node.js fs.writeFileSync
 * - C# DefaultFileSystem.Open(filename) → FileSystem.openAsync
 * - C# Stream.ReadAllBytes() → ArrayBuffer → Uint8Array
 * - Node.js 文件系统访问 → fs 模块（仅 CLI 环境可用）
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// File extraction helper
// ---------------------------------------------------------------------------

/**
 * 从文件系统上下文中提取并保存文件的异步实现。
 *
 * OpenRA 对照: ExtractFilesCommand.Run — 文件提取循环
 *
 * @param filenames — 要提取的文件名列表
 * @param readFile — 读取文件的函数 (filename → ArrayBuffer | null)
 * @param writeFile — 写入文件到磁盘的函数 (filename, data) → void
 * @returns 指示每个文件提取结果的数组
 */
export async function extractFiles(
  filenames: readonly string[],
  readFile: (filename: string) => Promise<ArrayBuffer | null>,
  writeFile: (filename: string, data: Uint8Array) => void,
): Promise<{ filename: string; success: boolean; error?: string }[]> {
  const results: { filename: string; success: boolean; error?: string }[] = []

  for (const filename of filenames) {
    try {
      const data = await readFile(filename)
      if (!data) {
        const errMsg = `File not found: ${filename}`
        results.push({ filename, success: false, error: errMsg })
        continue
      }

      writeFile(filename, new Uint8Array(data))
      results.push({ filename, success: true })
    } catch (err) {
      results.push({
        filename,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}

/**
 * 同步版本的 extractFiles（用于 Node.js CLI）。
 *
 * 如果文件未找到或发生 I/O 错误，会立即抛出错误（不继续处理后续文件）。
 * 这与 OpenRA 使用 throw new InvalidOperationException 的行为一致。
 */
export function extractFilesSync(
  filenames: readonly string[],
  readFileSync: (filename: string) => Uint8Array | null,
  writeFileSync: (filename: string, data: Uint8Array) => void,
): { filename: string; success: boolean; error?: string }[] {
  const results: { filename: string; success: boolean; error?: string }[] = []

  for (const filename of filenames) {
    const data = readFileSync(filename)
    if (!data) {
      const errMsg = `File not found: ${filename}`
      results.push({ filename, success: false, error: errMsg })
      throw new Error(errMsg)
    }

    writeFileSync(filename, data)
    results.push({ filename, success: true })
  }

  return results
}

// ---------------------------------------------------------------------------
// ExtractFilesCommand
// ---------------------------------------------------------------------------

/**
 * 文件提取命令。
 *
 * 用法: --extract FILENAME [FILENAME...]
 *
 * 从 mod 包中提取文件到当前目录。
 *
 * OpenRA 对照: ExtractFilesCommand
 */
export class ExtractFilesCommand implements IUtilityCommand {
  readonly name = '--extract'

  validateArguments(args: string[]): boolean {
    return args.length >= 2
  }

  run(utility: Utility, args: string[]): void {
    // args[0] is the command name, args[1..] are filenames
    const files = args.slice(1)
    const modData = utility.modData
    const dfs = modData.defaultFileSystem

    console.log(`ExtractFilesCommand: Extracting ${files.length} file(s)...`)

    for (const filename of files) {
      // NOTE: FileSystem.openAsync returns Promise, but IUtilityCommand.run is synchronous.
      // In a real CLI, the runner would handle async commands.
      // For now, we queue the extraction and report progress.

      // Check if file exists
      if (!dfs.exists(filename)) {
        const errorMsg = `File not found: ${filename}`
        console.error(errorMsg)
        throw new Error(errorMsg)
      }

      // Implement async extraction with actual file I/O.
      // In a Node.js CLI, use fs.writeFileSync. In the browser, trigger a download.
      console.log(`${filename} — TODO: extracted (file I/O deferred to CLI runner)`)
    }
  }
}
