/**
 * ConvertSpriteToPngCommand.ts — 将 .shp/TMP/R8 精灵转换为 PNG 序列
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/ConvertSpriteToPngCommand.cs (104 lines)
 *
 * 核心范式转换:
 * - C# File.OpenRead(src) → Node.js fs.readFileSync 或浏览器 File API
 * - C# FrameLoader.GetFrames → 存根（精灵加载器尚未全部迁移）
 * - C# ImmutablePalette → HardwarePalette 或调色板数组
 * - C# Png.Save → Node.js sharp 或浏览器 canvas.toBlob
 *
 * NOTE: 完整的精灵转换需要 Ch19 的精灵加载器基础设施。
 * 此实现提供命令结构和参数解析，实际转换逻辑为存根。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// ConvertSpriteToPngCommand
// ---------------------------------------------------------------------------

/**
 * 精灵转 PNG 命令。
 *
 * 用法: --png SPRITEFILE PALETTE [--noshadow] [--nopadding]
 *
 * 将 .shp/TMP/R8 精灵文件转换为一系列 PNG 图像，
 * 可选移除阴影行和禁用填充。
 *
 * OpenRA 对照: ConvertSpriteToPngCommand
 */
export class ConvertSpriteToPngCommand implements IUtilityCommand {
  readonly name = '--png'

  validateArguments(args: string[]): boolean {
    return args.length >= 3
  }

  run(_utility: Utility, args: string[]): void {
    const src = args[1]!
    const palettePath = args[2]!

    const noShadow = args.includes('--noshadow')
    const noPadding = args.includes('--nopadding')

    console.log(`ConvertSpriteToPngCommand: Converting ${src}`)
    console.log(`  Palette: ${palettePath}`)
    if (noShadow) console.log('  No shadow')
    if (noPadding) console.log('  No padding')

    // Implement full sprite-to-PNG conversion when sprite loaders
    // (FrameLoader, SpriteLoader) from Ch19 are migrated.
    //
    // In OpenRA, the conversion pipeline is:
    // 1. Read sprite file: File.OpenRead(src)
    // 2. Load palette: new ImmutablePalette(palettePath, [0], shadowIndices)
    // 3. Extract palette colors: palette.GetColor(i) for i=0..255
    // 4. Load frames: FrameLoader.GetFrames(stream, modData.SpriteLoaders, src, out _)
    // 5. For each frame:
    //    a. Calculate frame size with/without padding
    //    b. Expand frame data if needed (zero-pad to frame size)
    //    c. Create PNG: new Png(pngData, SpriteFrameType.Indexed8, width, height, palColors)
    //    d. Save: png.Save($"{prefix}-{count:D4}.png")
    //
    // Required infrastructure:
    // - FrameLoader / SpriteLoader (Ch19)
    // - ImmutablePalette (Ch2 HardwarePalette.ts)
    // - Png encoder (needs sharp or canvas dependency)

    console.log(': Full sprite→PNG conversion requires:')
    console.log('  - Sprite Loaders (FrameLoader) from Ch19')
    console.log('  - Palette infrastructure (ImmutablePalette) from Ch2')
    console.log('  - PNG encoding (sharp for Node.js, canvas for browser)')

    // Show what would be produced
    console.log(`Would produce: ${src.replace(/\.[^.]+$/, '')}-[0000..NNNN].png`)
  }
}
