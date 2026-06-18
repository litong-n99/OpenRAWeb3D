/**
 * ConvertPngToShpCommand.ts — PNG 图像转 SHP 精灵格式命令
 * OpenRA 对照: OpenRA.Mods.Cnc/UtilityCommands/ConvertPngToShpCommand.cs (59 lines)
 *
 * 核心范式转换:
 * - C# Png(Stream) 图像加载 → 存根（需要 Node.js PNG 解码库如 sharp/pngjs）
 * - C# ShpTDSprite.Write 格式写入 → 存根（Ch19 C&C 精灵格式尚未迁移）
 * - C# Glob.Expand 文件展开 → Glob.expand() (同目录)
 * - C# File.OpenRead → Node.js fs.readFileSync
 *
 * 将一系列 PNG 图像合并为单个 SHP 精灵文件。
 * 所有帧必须具有相同的尺寸和索引调色板格式。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import { Glob } from './Glob.js'

// ---------------------------------------------------------------------------
// ConvertPngToShpCommand
// ---------------------------------------------------------------------------

/**
 * PNG 转 SHP 命令。
 *
 * 用法: --shp PNGFILE [PNGFILE ...]
 *
 * 将一系列 PNG 图像合并为单个 SHP 文件。文件名按字母顺序排序后，
 * 第一个文件名用 "-" 分割取第一部分作为输出文件名。
 *
 * 示例: --shp infantry-0001.png infantry-0002.png → infantry.shp
 *
 * OpenRA 对照: ConvertPngToShpCommand
 */
export class ConvertPngToShpCommand implements IUtilityCommand {
  readonly name = '--shp'

  validateArguments(args: string[]): boolean {
    return args.length >= 2
  }

  run(_utility: Utility, args: string[]): void {
    // 展开通配符参数
    const inputFiles = Glob.globArgs(args).sort()
    if (inputFiles.length === 0) {
      console.log('No input files found.')
      return
    }

    const firstFile = inputFiles[0]!
    const dest = firstFile.split('-')[0]! + '.shp'

    console.log(`ConvertPngToShpCommand: Converting ${inputFiles.length} PNG(s) → ${dest}`)

    // TODO-21.G.4: Implement full PNG-to-SHP conversion when PNG decoding and
    // ShpTDSprite writing infrastructure are available.
    //
    // In OpenRA, the conversion pipeline is:
    // 1. Glob-expand input file patterns (Glob.Expand)
    // 2. Sort input filenames alphabetically
    // 3. Determine output filename: first input's prefix before '-' + '.shp'
    // 4. Load all PNG frames: inputFiles.ConvertAll(a => new Png(File.OpenRead(a)))
    // 5. Validate: all frames must be SpriteFrameType.Indexed8 (paletted)
    // 6. Validate: all frames must have identical dimensions
    // 7. Write SHP: ShpTDSprite.Write(destStream, size, frames.Select(f => f.Data))
    //
    // Required infrastructure:
    // - PNG decoder (Indexed8 palette support) — sharp or pngjs for Node.js
    // - ShpTDSprite writer (Ch19, C&C-specific sprite format)
    // - SpriteFrameType enum (Indexed8 vs Rgba32)

    for (const file of inputFiles) {
      console.log(`  Input: ${file}`)
    }
    console.log(`  Output: ${dest}`)

    console.log('TODO-21.G.4: Full PNG→SHP conversion requires:')
    console.log('  - PNG decoder with Indexed8 palette support (sharp/pngjs)')
    console.log('  - ShpTDSprite writer (Ch19 C&C sprite format)')
    console.log('  - SpriteFrameType enum')
  }
}
