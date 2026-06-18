/**
 * PngSheetImportMetadataCommand.ts — PNG 精灵表元数据导入命令
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/PngSheetImportMetadataCommand.cs (68 lines)
 *
 * 核心范式转换:
 * - C# Png.EmbeddedData 写入器 → JSON 键值对嵌入到 PNG tEXt 块
 * - C# MiniYaml.FromFile → JSON/YAML 文件读取
 * - C# FieldLoader.GetValue<Size> → JSON 解析 + 尺寸验证
 * - C# Path.ChangeExtension → 字符串操作
 *
 * 从 YAML 文件中读取元数据并嵌入到 PNG 文件中。
 * 验证帧尺寸和数量与 PNG 图像尺寸一致。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Metadata types
// ---------------------------------------------------------------------------

/** 精灵表元数据结构。
 *
 * OpenRA 对照: YAML 节点 FrameSize + FrameAmount + 自定义键值对
 */
export interface PngSheetMetadata {
  /** 单个帧的尺寸（宽x高）。 */
  FrameSize?: { Width: number; Height: number }
  /** 帧总数。 */
  FrameAmount?: number
  /** 自定义嵌入式元数据键值对。 */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * 验证帧尺寸和帧数量与 PNG 图像尺寸是否一致。
 *
 * OpenRA 对照: PngSheetImportMetadataCommand.Run — 帧计数验证
 *
 * @param frameSize — 单个帧的尺寸（像素）
 * @param frameAmount — 帧总数
 * @param pngWidth — PNG 图像宽度（像素）
 * @param pngHeight — PNG 图像高度（像素）
 * @returns 错误消息，如果有效则返回 null
 */
export function validateFrameCount(
  frameSize: { Width: number; Height: number } | undefined,
  frameAmount: number | undefined,
  pngWidth: number,
  pngHeight: number,
): string | null {
  if (!frameSize) return null

  const cols = Math.floor(pngWidth / frameSize.Width)
  const rows = Math.floor(pngHeight / frameSize.Height)
  const maxFrames = cols * rows

  if (frameAmount !== undefined && frameAmount > maxFrames) {
    return `.png file is too small for given FrameSize and FrameAmount. ` +
      `PNG: ${pngWidth}x${pngHeight}, Frame: ${frameSize.Width}x${frameSize.Height}, ` +
      `Max frames: ${maxFrames}, Requested: ${frameAmount}`
  }

  return null
}

/**
 * 解析尺寸字符串为 Width/Height 对象。
 *
 * OpenRA 对照: FieldLoader.GetValue<Size>("FrameSize", frameSizeField)
 *
 * @param value — 尺寸字符串（格式：W,H 或 Width,H 或 W x H 等）
 * @returns Size 对象，解析失败返回 null
 */
export function parseSize(value: string): { Width: number; Height: number } | null {
  // 支持各种格式：W,H 或 W,H 或 WxH
  const cleaned = value.replace(/[xX]/g, ',').replace(/\s+/g, '')
  const parts = cleaned.split(',')
  if (parts.length < 2) return null

  const w = Number.parseInt(parts[0]!, 10)
  const h = Number.parseInt(parts[1]!, 10)
  if (Number.isNaN(w) || Number.isNaN(h) || w <= 0 || h <= 0) return null

  return { Width: w, Height: h }
}

// ---------------------------------------------------------------------------
// PngSheetImportMetadataCommand
// ---------------------------------------------------------------------------

/**
 * PNG 精灵表元数据导入命令。
 *
 * 用法: --png-sheet-import PNGFILE
 *
 * 从同名的 .yaml 文件中读取元数据（FrameSize, FrameAmount, 自定义键值对），
 * 验证帧数量与 PNG 图像尺寸一致，然后将元数据嵌入到 PNG 文件中。
 *
 * OpenRA 对照: PngSheetImportMetadataCommand
 */
export class PngSheetImportMetadataCommand implements IUtilityCommand {
  readonly name = '--png-sheet-import'

  validateArguments(args: string[]): boolean {
    return args.length === 2
  }

  run(_utility: Utility, args: string[]): void {
    const pngFile = args[1]!
    const yamlFile = pngFile.replace(/\.\w+$/, '') + '.yaml'

    console.log(`PngSheetImportMetadataCommand: Importing metadata from ${yamlFile} → ${pngFile}`)

    // TODO-21.G.6: Implement full PNG metadata import when PNG reading/writing
    // and YAML parsing infrastructure are available.
    //
    // In OpenRA, the import pipeline is:
    // 1. Read PNG file: File.OpenRead(args[1]) → new Png(pngStream)
    // 2. Read YAML file: MiniYaml.FromFile(Path.ChangeExtension(args[1], "yaml"))
    // 3. Extract FrameSize from YAML if present:
    //    - Parse as Size using FieldLoader.GetValue<Size>
    //    - If FrameAmount also present, validate:
    //      frameAmount <= png.Width / frameSize.Width * (png.Height / frameSize.Height)
    //    - Throw InvalidDataException if PNG is too small
    // 4. Merge all YAML nodes into png.EmbeddedData:
    //    foreach (var node in yaml) png.EmbeddedData[node.Key] = node.Value.Value
    // 5. Save PNG: png.Save(args[1])
    //
    // Required infrastructure:
    // - PNG decoder + encoder (sharp or pngjs for Node.js)
    // - tEXt/iTXt chunk reader + writer
    // - YAML parser (js-yaml for Node.js)
    // - FieldLoader equivalent for Size parsing

    console.log('TODO-21.G.6: Full PNG metadata import requires:')
    console.log('  - PNG decoder/encoder with tEXt/iTXt chunk support')
    console.log('  - YAML parser (js-yaml for Node.js)')
    console.log('  - Size field parser (FieldLoader equivalent)')
    console.log(`  Would read from: ${yamlFile}`)
    console.log(`  Would write to: ${pngFile}`)
  }
}
