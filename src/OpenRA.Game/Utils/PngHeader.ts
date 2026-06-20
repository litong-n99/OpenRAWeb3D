/**
 * PngHeader.ts -- Minimal PNG IHDR header parser for extracting image dimensions
 * OpenRA 对照: OpenRA.Platforms.Default/Png.cs (Png.LoadFromStream header parsing)
 *
 * 核心范式转换:
 * - C# Png.LoadFromStream() full PNG decoder → minimal IHDR parser
 *   (仅提取宽度/高度，无需完整解码像素数据)
 * - C# BinaryReader.ReadInt32() 大端序 → DataView.getUint32() 手动字节交换
 *
 * 用于解析远程 API 返回的 base64 解码后 PNG 数据，以获取小地图尺寸。
 */

// ---------------------------------------------------------------------------
// PNG Signature (8 bytes)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

// ---------------------------------------------------------------------------
// parsePngDimensions
// ---------------------------------------------------------------------------

/**
 * 从 PNG 数据中解析 IHDR 块的宽度和高度。
 *
 * 仅解析 PNG 签名和第一个块（应为 IHDR），提取 4 字节宽度（偏移 16）
 * 和 4 字节高度（偏移 20），均为大端序。
 *
 * 无效签名或数据过短时返回 null。
 *
 * OpenRA 对照: Png.LoadFromStream() 的 IHDR 解析部分
 *
 * @param data -- PNG 文件的原始字节数据
 * @returns 宽度和高度，解析失败时返回 null
 */
export function parsePngDimensions(
  data: Uint8Array,
): { width: number; height: number } | null {
  // 最少需要 8 (签名) + 4 (长度) + 4 (IHDR) + 4 (宽度) + 4 (高度) = 24 字节
  if (data.length < 24) return null

  // 验证 PNG 签名
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) return null
  }

  // IHDR 长度（大端序），偏移 8-11
  const ihdrLength =
    (data[8] << 24) | (data[9] << 16) | (data[10] << 8) | data[11]

  // 标准 IHDR 长度为 13 字节
  if (ihdrLength !== 13) return null

  // 验证 "IHDR" ASCII 标签，偏移 12-15
  // IHDR tag is always ASCII; String.fromCharCode is safe here
  const ihdrTag = String.fromCharCode(
    data[12],
    data[13],
    data[14],
    data[15],
  )
  if (ihdrTag !== 'IHDR') return null

  // 宽度（大端序），偏移 16-19
  // >>> 0 防止移位产生有符号 32 位负数（如 0xFFFFFFFF → -1）
  const width =
    ((data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19]) >>> 0

  // 高度（大端序），偏移 20-23
  const height =
    ((data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23]) >>> 0

  return { width, height }
}
