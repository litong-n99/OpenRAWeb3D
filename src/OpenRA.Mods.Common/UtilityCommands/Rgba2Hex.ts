/**
 * Rgba2Hex.ts — RGBA/ARGB 颜色值转十六进制字符串工具
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/Rgba2Hex.cs (286 lines)
 *
 * 核心范式转换:
 * - C# Exts.ParseByteInvariant / ToStringInvariant("X2") → Number.parseInt + toString(16).padStart(2, '0')
 * - C# Console.WriteLine → console.log / process.stdout.write
 * - C# [Desc] 属性 → JSDoc @description 注释 + name 属性
 *
 * 两个独立命令:
 * - Rgba2Hex: 将 "r,g,b[,a]" 三元组/四元组转换为十六进制颜色
 * - Argb2Hex: 将 "a,r,g,b" 四元组或 "r,g,b" 三元组转换为十六进制颜色
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** 解析颜色组件字符串，返回数值数组，无效组件返回 null。 */
export function parseByteComponents(input: string): number[] | null {
  const parts = input.split(',').filter(p => p.length > 0)
  const result: number[] = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const val = Number.parseInt(trimmed, 10)
    if (Number.isNaN(val) || val < 0 || val > 255) return null
    result.push(val)
  }

  return result
}

/** 将 RGB+可选 A 转换为十六进制字符串。
 *
 * OpenRA 对照: Rgba2Hex.Run — "X2" 格式化
 */
export function rgbToHex(r: number, g: number, b: number, a?: number): string {
  let hex = r.toString(16).padStart(2, '0').toUpperCase() +
    g.toString(16).padStart(2, '0').toUpperCase() +
    b.toString(16).padStart(2, '0').toUpperCase()
  if (a !== undefined && a < 255) {
    hex += a.toString(16).padStart(2, '0').toUpperCase()
  }
  return hex
}

/** 将 ARGB 转换为十六进制字符串（alpha 在红色之前）。
 *
 * OpenRA 对照: Argb2Hex.Run
 */
export function argbToHex(a: number, r: number, g: number, b: number): string {
  // 输出顺序: R G B [A]（alpha 仅在 < 255 时输出）
  let hex = r.toString(16).padStart(2, '0').toUpperCase() +
    g.toString(16).padStart(2, '0').toUpperCase() +
    b.toString(16).padStart(2, '0').toUpperCase()
  if (a < 255) {
    hex += a.toString(16).padStart(2, '0').toUpperCase()
  }
  return hex
}

// ---------------------------------------------------------------------------
// Rgba2Hex
// ---------------------------------------------------------------------------

/**
 * RGBA 转十六进制命令。
 *
 * 用法: --rgba2hex r1,g1,b1 [r2,g2,b2,a2 ...]
 *
 * 将 "r,g,b" 或 "r,g,b,a" 颜色值转换为十六进制字符串。
 * 示例: --rgba2hex 255,0,0 → FF0000
 *        --rgba2hex 255,0,0,128 → FF000080
 *
 * OpenRA 对照: Rgba2Hex
 */
export class Rgba2Hex implements IUtilityCommand {
  readonly name = '--rgba2hex'

  validateArguments(args: string[]): boolean {
    if (args.length <= 1) return printUsage('--rgba2hex')

    let invalid = false
    for (let i = 1; i < args.length; i++) {
      const parts = args[i]!.split(',').filter(p => p.length > 0)
      if (parts.length !== 3 && parts.length !== 4) {
        invalid = true
        console.log(`Invalid color (argument ${i}): ${args[i]}`)
      } else {
        for (const part of parts) {
          const val = Number.parseInt(part, 10)
          if (Number.isNaN(val) || val < 0 || val > 255) {
            invalid = true
            console.log(`Invalid component in color (argument ${i}): [${part}]: ${args[i]}`)
          }
        }
      }
    }

    return !invalid || printUsage('--rgba2hex')
  }

  run(_utility: Utility, args: string[]): void {
    const results: string[] = []

    for (let i = 1; i < args.length;) {
      const parts = args[i]!.split(',').filter(p => p.length > 0)

      if (parts.length === 3) {
        // r,g,b — 无 alpha 或全部作为 RGB
        const r = Number.parseInt(parts[0]!, 10)
        const g = Number.parseInt(parts[1]!, 10)
        const b = Number.parseInt(parts[2]!, 10)
        results.push(rgbToHex(r, g, b))
      } else {
        // parts.length === 4 — r,g,b,a
        const r = Number.parseInt(parts[0]!, 10)
        const g = Number.parseInt(parts[1]!, 10)
        const b = Number.parseInt(parts[2]!, 10)
        const alpha = Number.parseInt(parts[3]!, 10)
        results.push(rgbToHex(r, g, b, alpha))
      }

      i++
    }

    console.log(results.join(', '))
  }
}

// ---------------------------------------------------------------------------
// Argb2Hex
// ---------------------------------------------------------------------------

/**
 * ARGB 转十六进制命令。
 *
 * 用法: --argb2hex a1,r1,g1,b1 [a2,r2,g2,b2 ...]
 *        --argb2hex r1,g1,b1 [r2,g2,b2 ...]
 *
 * 将 "a,r,g,b" 或 "r,g,b" 格式的旧版颜色值转换为十六进制字符串。
 * ARGB 格式: Alpha 在红色之前（旧版 OpenRA 调色板格式）。
 *
 * OpenRA 对照: Argb2Hex
 */
export class Argb2Hex implements IUtilityCommand {
  readonly name = '--argb2hex'

  validateArguments(args: string[]): boolean {
    if (args.length <= 1) return printUsage('--argb2hex')

    let invalid = false
    for (let i = 1; i < args.length; i++) {
      const parts = args[i]!.split(',').filter(p => p.length > 0)
      if (parts.length !== 3 && parts.length !== 4) {
        invalid = true
        console.log(`Invalid color (argument ${i}): ${args[i]}`)
      } else {
        for (const part of parts) {
          const val = Number.parseInt(part, 10)
          if (Number.isNaN(val) || val < 0 || val > 255) {
            invalid = true
            console.log(`Invalid component in color (argument ${i}): [${part}]: ${args[i]}`)
          }
        }
      }
    }

    return !invalid || printUsage('--argb2hex')
  }

  run(_utility: Utility, args: string[]): void {
    const results: string[] = []

    for (let i = 1; i < args.length;) {
      const parts = args[i]!.split(',').filter(p => p.length > 0)

      if (parts.length === 3) {
        // r,g,b (无 alpha)
        const r = Number.parseInt(parts[0]!, 10)
        const g = Number.parseInt(parts[1]!, 10)
        const b = Number.parseInt(parts[2]!, 10)
        results.push(rgbToHex(r, g, b))
      } else {
        // parts.length === 4 — a,r,g,b
        const a = Number.parseInt(parts[0]!, 10)
        const r = Number.parseInt(parts[1]!, 10)
        const g = Number.parseInt(parts[2]!, 10)
        const b = Number.parseInt(parts[3]!, 10)
        results.push(argbToHex(a, r, g, b))
      }

      i++
    }

    console.log(results.join(', '))
  }
}

// ---------------------------------------------------------------------------
// Usage printer
// ---------------------------------------------------------------------------

/**
 * 打印命令用法说明。
 *
 * OpenRA 对照: Rgba2Hex.PrintUsage / Argb2Hex.PrintUsage
 *
 * @param command — 命令名（"--rgba2hex" 或 "--argb2hex"）
 * @returns 始终返回 false（供 validateArguments 使用）
 */
function printUsage(command: string): false {
  console.log('')
  console.log('Usage:')
  if (command === '--rgba2hex') {
    console.log('\tOpenRA.Utility.exe [MOD] --rgba2hex r1,g1,b1')
    console.log('\tOpenRA.Utility.exe [MOD] --rgba2hex r1,g1,b1,a1')
    console.log('\tOpenRA.Utility.exe [MOD] --rgba2hex r1,g1,b1 r2,g2,b2,a2')
    console.log('\tOpenRA.Utility.exe [MOD] --rgba2hex r1,g1,b1,a1 r2,g2,b2 ...')
    console.log('')
    console.log('\tNo spaces between the color components (red,green,blue[,alpha]).')
    console.log('\tSpaces between colors for a list; each argument is a color.')
    console.log('\tExtra commas are ignored.')
  } else {
    console.log('\tOpenRA.Utility.exe [MOD] --argb2hex a1,r1,g1,b1')
    console.log('\tOpenRA.Utility.exe [MOD] --argb2hex r1,g1,b1')
    console.log('\tOpenRA.Utility.exe [MOD] --argb2hex a1,r1,g1,b1 a2,r2,g2,b2')
    console.log('\tOpenRA.Utility.exe [MOD] --argb2hex a1,r1,g1,b1, a2,r2,g2,b2')
    console.log('\tOpenRA.Utility.exe [MOD] --argb2hex a1,r1,g1,b1 a2,r2,g2,b2 ...')
    console.log('')
    console.log('\tNo spaces between color components ([alpha,]red,green,blue).')
    console.log('\tSpaces between colors for a list; each argument is a color.')
    console.log('\tExtra commas are ignored; useful for pasting legacy color lists to the command line.')
  }
  console.log('')
  console.log('Where:')
  if (command === '--rgba2hex') {
    console.log('\tr# is a red component value (0-255)')
    console.log('\tg# is a green component value (0-255)')
    console.log('\tb# is a blue component value (0-255)')
    console.log('\ta# is an optional alpha component value (0-255)')
  } else {
    console.log('\ta# is an optional alpha component value (0-255)')
    console.log('\tr# is a red component value (0-255)')
    console.log('\tg# is a green component value (0-255)')
    console.log('\tb# is a blue component value (0-255)')
    console.log('\t[MOD] is any valid mod such as "all"')
    console.log('')
    console.log('Converting legacy color lists:')
    console.log('\tType into command line: OpenRA.Utility.exe all --argb2hex ')
    console.log('\tFollow with a space.')
    console.log('\tCopy legacy color list and paste into command line')
    console.log('\t1.) Copying from command line terminal:')
    console.log('\t\tPress Enter in command line terminal.')
    console.log('\t\tCopy hex color list from command line terminal.')
    console.log('\t2.) Append to file')
    console.log('\t\tSave any unsaved changes to file.')
    console.log('\t\tEnter ">>" into command line terminal without the quotes.')
    console.log('\t\tEnter relative or absolute path follow by a "/" to file directory if it is not the current directory.')
    console.log('\t\tEnter full filename with extension.')
    console.log('\t\tPress Enter.')
    console.log('\t\tOpen/reload file')
    console.log('')
  }
  console.log('')
  return false
}
