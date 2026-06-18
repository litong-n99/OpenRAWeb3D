/**
 * RemapShpCommand.ts — SHP 精灵调色板重映射命令
 * OpenRA 对照: OpenRA.Mods.Cnc/UtilityCommands/RemapShpCommand.cs (89 lines)
 *
 * 核心范式转换:
 * - C# ImmutablePalette → HardwarePalette / 调色板数组 (Ch2)
 * - C# ShpTDSprite → 存根（Ch19 精灵加载器尚未迁移）
 * - C# File.OpenRead → Node.js fs.readFileSync
 * - C# Color.FromArgb → 数值位运算提取 RGBA
 *
 * 将 SHP 精灵的颜色从一个调色板重映射到另一个调色板。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// Color distance computation
// ---------------------------------------------------------------------------

/**
 * 计算两个 ARGB 颜色值之间的曼哈顿距离。
 *
 * OpenRA 对照: RemapShpCommand.ColorDistance(uint a, uint b)
 *
 * 颜色格式为 0xAARRGGBB (Alpha 位于最高字节)。
 * 仅比较 RGB 通道（忽略 Alpha），通道权重相等。
 *
 * @param a — 32-bit ARGB 颜色值 (bits 24-31=Alpha, 16-23=Red, 8-15=Green, 0-7=Blue)
 * @param b — 32-bit ARGB 颜色值
 * @returns RGB 通道差的绝对值之和
 */
export function colorDistance(a: number, b: number): number {
  // ARGB 格式: bits 24-31=Alpha, 16-23=Red, 8-15=Green, 0-7=Blue
  const aR = (a >>> 16) & 0xff
  const aG = (a >>> 8) & 0xff
  const aB = a & 0xff
  const bR = (b >>> 16) & 0xff
  const bG = (b >>> 8) & 0xff
  const bB = b & 0xff

  return Math.abs(aR - bR) + Math.abs(aG - bG) + Math.abs(aB - bB)
}

// ---------------------------------------------------------------------------
// Palette remap computation
// ---------------------------------------------------------------------------

/**
 * 计算最佳调色板重映射表。
 *
 * 将固定条目（前 4 个索引）和玩家颜色重映射范围（16 个条目）映射后，
 * 其余颜色按曼哈顿距离找到目标调色板中的最佳匹配。
 *
 * OpenRA 对照: RemapShpCommand.Run — remap 字典构建
 *
 * @param srcRemapIndex — 源调色板的玩家颜色重映射索引
 * @param destRemapIndex — 目标调色板的玩家颜色重映射索引
 * @param srcPalette — 源调色板（index → 32-bit color）
 * @param destPalette — 目标调色板（index → 32-bit color）
 * @param paletteSize — 调色板大小（默认 256）
 * @returns 重映射表: srcIndex → destIndex
 */
export function computeRemap(
  srcRemapIndex: readonly number[],
  destRemapIndex: readonly number[],
  srcPalette: Uint32Array,
  destPalette: Uint32Array,
  paletteSize: number = 256,
): Map<number, number> {
  const remap = new Map<number, number>()

  // 固定前 4 个条目 (OpenRA 对照: "the first 4 entries are fixed")
  for (let i = 0; i < 4; i++) {
    remap.set(i, i)
  }

  // 玩家颜色重映射范围 — 最多 16 个条目，仅处理有值的索引
  // OpenRA 对照: "the remap range is always 16 entries"
  const remapRange = Math.min(srcRemapIndex.length, destRemapIndex.length, 16)
  for (let i = 0; i < remapRange; i++) {
    const srcIdx = srcRemapIndex[i]
    const destIdx = destRemapIndex[i]
    if (srcIdx === undefined || destIdx === undefined) continue
    remap.set(srcIdx, destIdx)
  }

  // 其余颜色按曼哈顿距离找最佳匹配
  // OpenRA 对照: for (var i = 0; i < Palette.Size; i++)
  // NOTE: 使用 Set 维护已使用的目标索引，O(1) 查找替代 C# 的 O(n) ContainsValue

  /** 已用作目标值的索引集合（O(1) 查找）。 */
  const usedDestIndices = new Set(remap.values())

  for (let i = 0; i < paletteSize; i++) {
    if (remap.has(i)) continue

    let bestDist = Number.MAX_SAFE_INTEGER
    let bestIdx = -1

    for (let j = 0; j < paletteSize; j++) {
      if (usedDestIndices.has(j)) continue

      const dist = colorDistance(destPalette[j]!, srcPalette[i]!)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = j
      }
    }

    if (bestIdx >= 0) {
      remap.set(i, bestIdx)
      usedDestIndices.add(bestIdx)
    }
  }

  return remap
}

// ---------------------------------------------------------------------------
// RemapShpCommand
// ---------------------------------------------------------------------------

/**
 * SHP 调色板重映射命令。
 *
 * 用法: --remap SRCMOD:PAL DESTMOD:PAL SRCSHP DESTSHP
 *
 * 将一个调色板的 SHP 精灵颜色重映射到另一个调色板。
 *
 * OpenRA 对照: RemapShpCommand
 */
export class RemapShpCommand implements IUtilityCommand {
  readonly name = '--remap'

  validateArguments(args: string[]): boolean {
    return args.length >= 5
  }

  run(_utility: Utility, args: string[]): void {
    const srcModPal = args[1]!
    const destModPal = args[2]!
    const srcShp = args[3]!
    const destShp = args[4]!

    console.log(`RemapShpCommand: Remapping ${srcShp} → ${destShp}`)
    console.log(`  Source mod:palette = ${srcModPal}`)
    console.log(`  Dest mod:palette   = ${destModPal}`)

    // TODO-21.G.3: Implement full SHP palette remapping when sprite loaders
    // (ShpTDSprite) and palette infrastructure (ImmutablePalette) are migrated
    // from Ch19 and Ch2 respectively.
    //
    // In OpenRA, the remap pipeline is:
    // 1. Parse srcMod:srcPal and destMod:destPal from args
    // 2. Load ModData for both mods: new ModData(utility.Mods[mod], utility.Mods)
    // 3. Extract PlayerColorPaletteInfo.RemapIndex from both mods
    // 4. Load ImmutablePalette from palette files (args[i].split(':')[1])
    // 5. Build remap dictionary:
    //    a. First 4 entries fixed (0→0, 1→1, 2→2, 3→3)
    //    b. 16 player color entries remapped by RemapIndex
    //    c. All other colors matched by minimum channel distance
    // 6. Open source SHP: new ShpTDSprite(File.OpenRead(srcShp))
    // 7. Remap frame pixel data: frame.Data.Select(px => remap[px])
    // 8. Write destination SHP: ShpTDSprite.Write(destStream, srcImage.Size, remappedFrames)
    //
    // Required infrastructure:
    // - ShpTDSprite loader/writer (Ch19, C&C-specific sprite format)
    // - ImmutablePalette (Ch2 HardwarePalette.ts)
    // - ModData with PlayerColorPaletteInfo trait

    console.log('TODO-21.G.3: Full SHP remap requires:')
    console.log('  - ShpTDSprite loader/writer (Ch19 C&C sprite format)')
    console.log('  - ImmutablePalette (Ch2 palette infrastructure)')
    console.log('  - PlayerColorPaletteInfo trait (Ch3 trait system)')
    console.log('  - ModData initialization with mod palette loading')
  }
}
