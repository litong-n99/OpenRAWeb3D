/**
 * PackageEntry.ts — Westwood 包条目元数据 + 文件名哈希算法
 * OpenRA 对照: OpenRA.Mods.Cnc/FileSystem/PackageEntry.cs
 *
 * 核心范式转换:
 * - C# Stream 读取 → DataView/Uint8Array 基于偏移量的解析
 * - C# stackalloc + MemoryMarshal.Cast → 手动 uint32 重新解释
 * - C# CRC32.Calculate → 内联查表 CRC32（避免额外依赖）
 * - C# 32 位无符号整数（uint）→ TypeScript `>>> 0` 无符号转换
 */

// ---------------------------------------------------------------------------
// PackageHashType 枚举
// ---------------------------------------------------------------------------

/**
 * Westwood 文件名哈希算法类型。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileSystem.PackageHashType
 *
 * NOTE: 使用 const 对象代替 enum 以兼容 erasableSyntaxOnly。
 * 当用作类型时使用 `PackageHashType` 类型别名。
 */
export const PackageHashType = {
  /** 经典 Westwood 哈希 (RA1, TD, Dune 2000) */
  Classic: 0,
  /** CRC32 哈希 (TS, RA2) */
  CRC32: 1,
} as const

/** PackageHashType 值的类型别名。 */
export type PackageHashType = (typeof PackageHashType)[keyof typeof PackageHashType]

// ---------------------------------------------------------------------------
// CRC32 查表（OpenRA 对照: OpenRA.FileFormats.CRC32.LookUp）
// ---------------------------------------------------------------------------

/**
 * CRC32 查表，多项式 0xEDB88320（标准 IEEE 802.3）。
 * 与 OpenRA 的 CRC32.LookUp 表完全一致。
 */
const CRC32_LOOKUP: Uint32Array = new Uint32Array([
  0x00000000, 0x77073096, 0xEE0E612C, 0x990951BA,
  0x076DC419, 0x706AF48F, 0xE963A535, 0x9E6495A3,
  0x0EDB8832, 0x79DCB8A4, 0xE0D5E91E, 0x97D2D988,
  0x09B64C2B, 0x7EB17CBD, 0xE7B82D07, 0x90BF1D91,
  0x1DB71064, 0x6AB020F2, 0xF3B97148, 0x84BE41DE,
  0x1ADAD47D, 0x6DDDE4EB, 0xF4D4B551, 0x83D385C7,
  0x136C9856, 0x646BA8C0, 0xFD62F97A, 0x8A65C9EC,
  0x14015C4F, 0x63066CD9, 0xFA0F3D63, 0x8D080DF5,
  0x3B6E20C8, 0x4C69105E, 0xD56041E4, 0xA2677172,
  0x3C03E4D1, 0x4B04D447, 0xD20D85FD, 0xA50AB56B,
  0x35B5A8FA, 0x42B2986C, 0xDBBBC9D6, 0xACBCF940,
  0x32D86CE3, 0x45DF5C75, 0xDCD60DCF, 0xABD13D59,
  0x26D930AC, 0x51DE003A, 0xC8D75180, 0xBFD06116,
  0x21B4F4B5, 0x56B3C423, 0xCFBA9599, 0xB8BDA50F,
  0x2802B89E, 0x5F058808, 0xC60CD9B2, 0xB10BE924,
  0x2F6F7C87, 0x58684C11, 0xC1611DAB, 0xB6662D3D,
  0x76DC4190, 0x01DB7106, 0x98D220BC, 0xEFD5102A,
  0x71B18589, 0x06B6B51F, 0x9FBFE4A5, 0xE8B8D433,
  0x7807C9A2, 0x0F00F934, 0x9609A88E, 0xE10E9818,
  0x7F6A0DBB, 0x086D3D2D, 0x91646C97, 0xE6635C01,
  0x6B6B51F4, 0x1C6C6162, 0x856530D8, 0xF262004E,
  0x6C0695ED, 0x1B01A57B, 0x8208F4C1, 0xF50FC457,
  0x65B0D9C6, 0x12B7E950, 0x8BBEB8EA, 0xFCB9887C,
  0x62DD1DDF, 0x15DA2D49, 0x8CD37CF3, 0xFBD44C65,
  0x4DB26158, 0x3AB551CE, 0xA3BC0074, 0xD4BB30E2,
  0x4ADFA541, 0x3DD895D7, 0xA4D1C46D, 0xD3D6F4FB,
  0x4369E96A, 0x346ED9FC, 0xAD678846, 0xDA60B8D0,
  0x44042D73, 0x33031DE5, 0xAA0A4C5F, 0xDD0D7CC9,
  0x5005713C, 0x270241AA, 0xBE0B1010, 0xC90C2086,
  0x5768B525, 0x206F85B3, 0xB966D409, 0xCE61E49F,
  0x5EDEF90E, 0x29D9C998, 0xB0D09822, 0xC7D7A8B4,
  0x59B33D17, 0x2EB40D81, 0xB7BD5C3B, 0xC0BA6CAD,
  0xEDB88320, 0x9ABFB3B6, 0x03B6E20C, 0x74B1D29A,
  0xEAD54739, 0x9DD277AF, 0x04DB2615, 0x73DC1683,
  0xE3630B12, 0x94643B84, 0x0D6D6A3E, 0x7A6A5AA8,
  0xE40ECF0B, 0x9309FF9D, 0x0A00AE27, 0x7D079EB1,
  0xF00F9344, 0x8708A3D2, 0x1E01F268, 0x6906C2FE,
  0xF762575D, 0x806567CB, 0x196C3671, 0x6E6B06E7,
  0xFED41B76, 0x89D32BE0, 0x10DA7A5A, 0x67DD4ACC,
  0xF9B9DF6F, 0x8EBEEFF9, 0x17B7BE43, 0x60B08ED5,
  0xD6D6A3E8, 0xA1D1937E, 0x38D8C2C4, 0x4FDFF252,
  0xD1BB67F1, 0xA6BC5767, 0x3FB506DD, 0x48B2364B,
  0xD80D2BDA, 0xAF0A1B4C, 0x36034AF6, 0x41047A60,
  0xDF60EFC3, 0xA867DF55, 0x316E8EEF, 0x4669BE79,
  0xCB61B38C, 0xBC66831A, 0x256FD2A0, 0x5268E236,
  0xCC0C7795, 0xBB0B4703, 0x220216B9, 0x5505262F,
  0xC5BA3BBE, 0xB2BD0B28, 0x2BB45A92, 0x5CB36A04,
  0xC2D7FFA7, 0xB5D0CF31, 0x2CD99E8B, 0x5BDEAE1D,
  0x9B64C2B0, 0xEC63F226, 0x756AA39C, 0x026D930A,
  0x9C0906A9, 0xEB0E363F, 0x72076785, 0x05005713,
  0x95BF4A82, 0xE2B87A14, 0x7BB12BAE, 0x0CB61B38,
  0x92D28E9B, 0xE5D5BE0D, 0x7CDCEFB7, 0x0BDBDF21,
  0x86D3D2D4, 0xF1D4E242, 0x68DDB3F8, 0x1FDA836E,
  0x81BE16CD, 0xF6B9265B, 0x6FB077E1, 0x18B74777,
  0x88085AE6, 0xFF0F6A70, 0x66063BCA, 0x11010B5C,
  0x8F659EFF, 0xF862AE69, 0x616BFFD3, 0x166CCF45,
  0xA00AE278, 0xD70DD2EE, 0x4E048354, 0x3903B3C2,
  0xA7672661, 0xD06016F7, 0x4969474D, 0x3E6E77DB,
  0xAED16A4A, 0xD9D65ADC, 0x40DF0B66, 0x37D83BF0,
  0xA9BCAE53, 0xDEBB9EC5, 0x47B2CF7F, 0x30B5FFE9,
  0xBDBDF21C, 0xCABAC28A, 0x53B39330, 0x24B4A3A6,
  0xBAD03605, 0xCDD70693, 0x54DE5729, 0x23D967BF,
  0xB3667A2E, 0xC4614AB8, 0x5D681B02, 0x2A6F2B94,
  0xB40BBE37, 0xC30C8EA1, 0x5A05DF1B, 0x2D02EF8D,
])

// ---------------------------------------------------------------------------
// PackageEntry
// ---------------------------------------------------------------------------

/**
 * Westwood 包中的单个文件条目。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileSystem.PackageEntry
 *
 * 包含文件在归档中的元数据：哈希值（用于 MIX 查找）、偏移量和长度。
 */
export class PackageEntry {
  /** 每个条目在归档中的字节大小（3 个 uint32）。OpenRA 对照: PackageEntry.Size */
  static readonly SIZE = 12

  /** Westwood 文件名哈希。
   * OpenRA 对照: PackageEntry.Hash */
  readonly hash: number

  /** 归档内数据块的偏移量（字节）。
   * OpenRA 对照: PackageEntry.Offset */
  readonly offset: number

  /** 数据块的长度（字节）。
   * OpenRA 对照: PackageEntry.Length */
  readonly length: number

  /**
   * 创建新的包条目。
   *
   * OpenRA 对照: PackageEntry(uint, uint, uint)
   *
   * @param hash — 文件名哈希
   * @param offset — 数据偏移量
   * @param length — 数据长度
   */
  constructor(hash: number, offset: number, length: number) {
    this.hash = hash >>> 0
    this.offset = offset >>> 0
    this.length = length >>> 0
  }

  /**
   * 从 DataView 的给定偏移量处解析一个 PackageEntry。
   *
   * OpenRA 对照: PackageEntry(Stream s)
   *
   * 从流中读取三个小端序 uint32：hash、offset、length。
   *
   * @param dv — 数据视图
   * @param offset — 起始偏移量
   * @returns 包含解析出的条目和下一字节偏移量的对象
   */
  static fromDataView(dv: DataView, offset: number): { entry: PackageEntry; nextOffset: number } {
    const hash = dv.getUint32(offset, true)
    const off = dv.getUint32(offset + 4, true)
    const len = dv.getUint32(offset + 8, true)
    return {
      entry: new PackageEntry(hash, off, len),
      nextOffset: offset + PackageEntry.SIZE,
    }
  }

  /**
   * 返回此条目的可读字符串表示。
   *
   * OpenRA 对照: PackageEntry.ToString()
   *
   * @returns 格式为 "0x{HASH:x8} - offset 0x{OFFSET:x8} - length 0x{LENGTH:x8}" 的字符串
   */
  toString(): string {
    return `0x${this.hash.toString(16).padStart(8, '0').toUpperCase()} - ` +
      `offset 0x${this.offset.toString(16).padStart(8, '0').toUpperCase()} - ` +
      `length 0x${this.length.toString(16).padStart(8, '0').toUpperCase()}`
  }

  // -----------------------------------------------------------------------
  // 哈希算法
  // -----------------------------------------------------------------------

  /**
   * 计算文件名的 Westwood 哈希。
   *
   * OpenRA 对照: PackageEntry.HashFilename(string, PackageHashType)
   *
   * 支持两种哈希类型：
   * - **Classic**：RA1/TD/Dune 2000 使用的 Westwood 滚动哈希
   *   1. 将文件名转为大写（不变区域文化）
   *   2. 末尾用 null 字符（\0）填充到 4 字节边界
   *   3. 将 ASCII 字节序列重新解释为小端序 uint32 数组
   *   4. 结果 = 0；对每个 uint32：结果 = ((结果 << 1) | (结果 >>> 31)) + uint32
   * - **CRC32**：TS/RA2 使用的标准 CRC32（多项式 0xEDB88320）
   *   1. 将文件名转为大写（不变区域文化）
   *   2. 如果长度不是 4 的倍数：在首字节填入余数，然后用最后对齐的字符填充
   *   3. 计算 ASCII 字节上的 CRC32
   *
   * @param name — 要计算哈希的文件名
   * @param type — 哈希算法类型
   * @returns 32 位无符号哈希值
   */
  static hashFilename(name: string, type: PackageHashType): number {
    const upper = name.toUpperCase()
    const padding = name.length % 4 !== 0 ? 4 - (name.length % 4) : 0
    const paddedLength = name.length + padding

    switch (type) {
      case PackageHashType.Classic:
        return PackageEntry._hashClassic(upper, paddedLength, padding)
      case PackageHashType.CRC32:
        return PackageEntry._hashCRC32(upper, paddedLength, padding)
      default:
        throw new Error(`Unknown hash type: ${type}`)
    }
  }

  /**
   * Classic Westwood 滚动哈希实现。
   *
   * OpenRA 对照: PackageHashType.Classic 分支
   *
   * 算法：
   * 1. 用 null 字节填充到 4 字节边界（无符号 char = 0）
   * 2. 转换为 ASCII 字节
   * 3. 重新解释为 little-endian uint32 数组
   * 4. 滚动左移并累加
   */
  private static _hashClassic(upperName: string, paddedLength: number, padding: number): number {
    // 1. 用 ""\0" 填充到 4 字节边界
    const chars = upperName + '\0'.repeat(padding)

    // 2. ASCII 编码 — 逐字符 charCodeAt（与 C# Encoding.ASCII.GetBytes 完全一致）
    //    ASCII 仅支持 0-127，因此 charCodeAt 会正确映射
    const asciiBytes = new Uint8Array(paddedLength)
    for (let i = 0; i < paddedLength; i++) {
      asciiBytes[i] = chars.charCodeAt(i) & 0xFF
    }

    // 3. 重新解释为 little-endian uint32
    //    OpenRA 对照: MemoryMarshal.Cast<byte, uint>(asciiBytes)
    const numUints = paddedLength / 4
    let result = 0
    for (let i = 0; i < numUints; i++) {
      const base = i * 4
      // 小端序：b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
      const next = (asciiBytes[base] |
        (asciiBytes[base + 1] << 8) |
        (asciiBytes[base + 2] << 16) |
        (asciiBytes[base + 3] << 24)) >>> 0

      // 4. result = ((result << 1) | (result >>> 31)) + next
      result = (((result << 1) | (result >>> 31)) >>> 0) + next
    }

    return result >>> 0
  }

  /**
   * CRC32 哈希实现。
   *
   * OpenRA 对照: PackageHashType.CRC32 分支
   *
   * 算法：
   * 1. 如果长度不是 4 的倍数，使用特殊填充（与 Classic 的空填充不同）
   *    - 在位置 [length] 处填入 (length - lengthRoundedDownToFour) 作为 char
   *    - 然后将该位置之后的填充字节设为最后对齐位置的字符
   * 2. 转换为 ASCII 字节
   * 3. 使用标准 CRC32（多项式 0xFFFFFFFF 为初始值，结束时与其异或）
   */
  private static _hashCRC32(upperName: string, paddedLength: number, _padding: number): number {
    const nameLen = upperName.length
    const lengthRoundedDownToFour = Math.floor(nameLen / 4) * 4

    // 构建字符数组
    const chars = new Array<string>(paddedLength)
    for (let i = 0; i < nameLen; i++) {
      chars[i] = upperName[i]
    }

    if (nameLen !== lengthRoundedDownToFour) {
      // OpenRA: upperPaddedName[length] = (char)(length - lengthRoundedDownToFour);
      chars[nameLen] = String.fromCharCode(nameLen - lengthRoundedDownToFour)
      // OpenRA: for (var p = 1; p < padding; p++)
      //            upperPaddedName[length + p] = upperPaddedName[lengthRoundedDownToFour];
      for (let p = 1; p < paddedLength - nameLen; p++) {
        chars[nameLen + p] = upperName[lengthRoundedDownToFour]
      }
    } else {
      // 无填充 — 恰好对齐到 4 字节
      // 不需要填充字符（padding = 0）
      // 填充数组中剩余的元素以便安全
      for (let i = nameLen; i < paddedLength; i++) {
        chars[i] = '\0'
      }
    }

    // 转换为 ASCII 字节
    const asciiBytes = new Uint8Array(paddedLength)
    for (let i = 0; i < paddedLength; i++) {
      asciiBytes[i] = (chars[i]?.charCodeAt(0) ?? 0) & 0xFF
    }

    // CRC32 计算（完全按照 OpenRA 标准）
    return PackageEntry._crc32(asciiBytes)
  }

  /**
   * 标准 CRC32 计算（多项式 0xEDB88320）。
   *
   * OpenRA 对照: CRC32.Calculate(ReadOnlySpan<byte>)
   *
   * 算法：crc = 0xFFFFFFFF; 对每个字节：crc = (crc >> 8) ^ LOOKUP[(crc & 0xFF) ^ byte];
   * 结束时：crc ^= 0xFFFFFFFF
   *
   * @param data — 输入字节
   * @returns 32 位 CRC32 校验和
   */
  private static _crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ CRC32_LOOKUP[(crc & 0xFF) ^ data[i]]
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
}

// NOTE: OpenRA's Names dictionary and AddStandardName() are intentionally
// omitted per ADR-5.1. Hash-to-name resolution is performed by the build-time
// MIX unpacker and stored in a JSON manifest. The browser runtime receives
// pre-resolved filenames from the unpacked directory structure.
