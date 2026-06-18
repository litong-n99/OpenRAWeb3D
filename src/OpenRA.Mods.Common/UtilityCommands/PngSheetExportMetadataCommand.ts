/**
 * PngSheetExportMetadataCommand.ts — PNG 精灵表元数据导出命令
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/PngSheetExportMetadataCommand.cs (38 lines)
 *
 * 核心范式转换:
 * - C# Png.EmbeddedData → JSON 对象存储嵌入式元数据
 * - C# MiniYamlNode → 键值对 JSON 对象
 * - C# .WriteToFile → Node.js fs.writeFileSync
 * - C# Path.ChangeExtension → 字符串操作 .replace(/\.\w+$/, '.yaml')
 *
 * 从 PNG 文件中提取嵌入式元数据（tEXt/iTXt 块）并写入 YAML 文件。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// PngSheetExportMetadataCommand
// ---------------------------------------------------------------------------

/**
 * PNG 精灵表元数据导出命令。
 *
 * 用法: --png-sheet-export PNGFILE
 *
 * 从 PNG 文件的 tEXt/iTXt 块中提取嵌入式元数据并写入同名的 .yaml 文件。
 *
 * OpenRA 对照: PngSheetExportMetadataCommand
 */
export class PngSheetExportMetadataCommand implements IUtilityCommand {
  readonly name = '--png-sheet-export'

  validateArguments(args: string[]): boolean {
    return args.length === 2
  }

  run(_utility: Utility, args: string[]): void {
    const pngFile = args[1]!
    const yamlFile = pngFile.replace(/\.\w+$/, '') + '.yaml'

    console.log(`PngSheetExportMetadataCommand: Exporting metadata from ${pngFile} → ${yamlFile}`)

    // TODO-21.G.5: Implement full PNG metadata export when PNG reading
    // infrastructure (Png class from Ch19) is available.
    //
    // In OpenRA, the export pipeline is:
    // 1. Open PNG file: File.OpenRead(args[1])
    // 2. Read PNG: new Png(stream)
    // 3. Extract embedded data: png.EmbeddedData
    //    (tEXt/iTXt chunks stored as key-value pairs)
    // 4. Convert to MiniYaml nodes:
    //    png.EmbeddedData.Select(m => new MiniYamlNode(m.Key, m.Value))
    // 5. Write to file: .WriteToFile(Path.ChangeExtension(args[1], "yaml"))
    //
    // Required infrastructure:
    // - PNG reader/decoder (sharp or pngjs for Node.js)
    // - tEXt/iTXt chunk extraction
    // - YAML serializer

    console.log('TODO-21.G.5: Full PNG metadata export requires:')
    console.log('  - PNG decoder with tEXt/iTXt chunk support (sharp/pngjs)')
    console.log('  - YAML serializer for metadata output')
    console.log(`  Would write: ${yamlFile}`)
  }
}
