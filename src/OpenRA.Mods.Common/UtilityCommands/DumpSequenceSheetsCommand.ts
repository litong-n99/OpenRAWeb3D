/**
 * DumpSequenceSheetsCommand.ts — 导出纹理图集为 PNG 图像集
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/DumpSequenceSheetsCommand.cs (174 lines)
 *
 * 核心范式转换:
 * - C# SheetBuilder + Sheet → Texture 图集 + RawTexture
 * - C# CursorManager.SheetBuilder → Babylon.js SpriteManager
 * - C# SequenceSet → 精灵序列定义
 * - C# ImmutablePalette → 调色板纹理
 * - C# IDumpSheetsTerrainInfo 接口 → TypeScript 接口（存根）
 * - C# Sheet.AsPng() → 使用 sharp/canvas 提取纹理数据为 PNG
 *
 * NOTE: 完整的精灵序列导出需要 Ch2 的 Sheet/SheetBuilder/SequenceSet
 * 和 Ch19 的精灵加载器基础设施。此实现提供命令结构和参数解析，
 * 实际导出逻辑为存根。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// IDumpSheetsTerrainInfo interface
// ---------------------------------------------------------------------------

/**
 * 支持导出精灵表的地形信息接口。
 *
 * OpenRA 对照: IDumpSheetsTerrainInfo (nested in DumpSequenceSheetsCommand.cs)
 */
export interface IDumpSheetsTerrainInfo {
  /**
   * 导出给定地形名称的精灵表。
   *
   * @param terrainName — 地形名称
   * @param palette — 调色板（可选，用于索引纹理）
   * @param sheetCount — 精灵表计数器（引用传递，自增）
   */
  dumpSheets(terrainName: string, palette: unknown | null, sheetCount: { value: number }): void
}

// ---------------------------------------------------------------------------
// DumpSequenceSheetsCommand
// ---------------------------------------------------------------------------

/**
 * 序列精灵表导出命令。
 *
 * 用法: --dump-sheets [PALETTE] [TILESET-OR-MAP]
 *
 * 将纹理图集导出为一组 PNG 图像。
 * 如果未指定调色板，只导出 BGRA 表。
 * 如果未指定 tileset-or-map，导出所有 tileset。
 *
 * OpenRA 对照: DumpSequenceSheetsCommand
 */
export class DumpSequenceSheetsCommand implements IUtilityCommand {
  readonly name = '--dump-sheets'

  /** 通道遮罩顺序，对应 OpenRA 的 [2, 1, 0, 3]。 */
  static readonly CHANNEL_MASKS: readonly number[] = [2, 1, 0, 3]

  validateArguments(args: string[]): boolean {
    return args.length >= 1
  }

  run(_utility: Utility, args: string[]): void {
    const paletteArg = args.length > 1 ? args[1] : null
    const targetArg = args.length > 2 ? args[2] : null

    console.log(`DumpSequenceSheetsCommand: Dumping sprite sheets`)
    if (paletteArg) console.log(`  Palette: ${paletteArg}`)
    if (targetArg) console.log(`  Target: ${targetArg}`)

    // Implement full sequence sheet dumping when the sprite
    // infrastructure (Sheet, SheetBuilder, SequenceSet, CursorManager,
    // SpriteCache) from Ch2 and Ch19 is fully migrated.
    //
    // In OpenRA, the dump pipeline is:
    // 1. Load palette if specified: new ImmutablePalette(args[1], [0], [])
    // 2. For a specific tileset-or-map target:
    //    a. Try as tileset: modData.DefaultTerrainInfo[name]
    //    b. Try as map: new Folder(...).OpenPackage(...) → new Map(modData, package)
    //    c. Create SequenceSet: new SequenceSet(modData.ModFiles, modData, tileset, null)
    // 3. For all tilesets: iterate modData.DefaultTerrainInfo.Keys
    // 4. Dump cursor sheets: CursorManager.SheetBuilder.AllSheets
    // 5. For each sequence: dump Indexed and BGRA sheets
    // 6. For each terrain: dump terrain-specific sheets via IDumpSheetsTerrainInfo
    //
    // Required infrastructure:
    // - Sheet / SheetBuilder (Ch2)
    // - SequenceSet / SpriteCache (Ch2)
    // - CursorManager (Ch2)
    // - ImmutablePalette (Ch2 HardwarePalette.ts)
    // - IDumpSheetsTerrainInfo implementations (Ch19)
    // - PNG encoding (sharp or canvas)

    console.log(': Full sequence sheet dumping requires:')
    console.log('  - Sheet / SheetBuilder / SequenceSet (Ch2)')
    console.log('  - CursorManager (Ch2)')
    console.log('  - Sprite loaders (Ch19)')
    console.log('  - PNG encoding (sharp for Node.js, canvas for browser)')
    console.log()
    console.log('CommitSheet() utility function is available for use when underlying')
    console.log('infrastructure is ready. See DumpSequenceSheetsCommand.CommitSheet.')
  }

  /**
   * 提交（保存）一个精灵表为 PNG。
   *
   * OpenRA 对照: DumpSequenceSheetsCommand.CommitSheet
   *
   * @param builder — SheetBuilder 实例（null 表示 BGRA 表，不需要通道分离）
   * @param sheet — 要导出的 Sheet
   * @param name — 文件名前缀
   * @param palette — 调色板（用于索引纹理的通道分离）
   * @param count — 精灵表计数器（会被自增）
   */
  static commitSheet(
    builder: unknown | null,
    _sheet: unknown,
    name: string,
    palette: unknown | null,
    count: { value: number },
  ): void {
    // Implement CommitSheet when Sheet/SheetBuilder/Palette are migrated.
    //
    // In OpenRA:
    //   if (builder == null)
    //       sheet.AsPng().Save($"{count++}.{name}.png", CompressionLevel.Fastest);
    //   else {
    //       if (palette != null) {
    //           var channels = sheet == builder.Current ? (int)builder.CurrentChannel + 1 : 4;
    //           for (var i = 0; i < channels; i++)
    //               sheet.AsPng((TextureChannel)ChannelMasks[i], palette)
    //                    .Save($"{count}.{i}.{name}.png", CompressionLevel.Fastest);
    //           count++;
    //       }
    //   }
    console.log(
      `CommitSheet: name=${name}, count=${count.value}, builder=${builder ? 'present' : 'null'}, palette=${palette ? 'present' : 'null'}`,
    )
    count.value++
  }
}
