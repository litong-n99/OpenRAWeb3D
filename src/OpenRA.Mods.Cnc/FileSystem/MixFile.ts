/**
 * MixFile.ts — MIX 归档格式（文档桩 + 运行时解析 + RSA/Blowfish 解密）
 * OpenRA 对照: OpenRA.Mods.Cnc/FileSystem/MixFile.cs
 *
 * 核心范式转换:
 * - C# 运行时 MIX 读取（Stream + Blowfish/RSA 解密）→ 委托给 MixFileRuntime
 * - C# Blowfish/RSA crypto → JavaScript BigInt (RSA) + Blowfish.ts (Phase C)
 * - C# tryParsePackage 返回 MixFile → 委托给 MixFileRuntime（C&C + all encrypted variants）
 * - 完整格式规范保留为 JSDoc，供构建工具作者使用
 * - 参考实现（parseHeader、parseIndex、decryptHeader）作为文档化但未使用的代码保留
 */

import type { IReadOnlyPackage, IReadOnlyFileSystem, IPackageLoader } from '../../OpenRA.Game/FileSystem/IPackage.js'
import { PackageEntry, PackageHashType } from './PackageEntry.js'
import { MixFileRuntime } from './MixFileRuntime.js'

// ---------------------------------------------------------------------------
// Module-level MIX hash database cache
// ---------------------------------------------------------------------------

/**
 * Active MIX hash database for filename resolution.
 *
 * Set via {@link MixLoader.setMixDb}. Shared across all MixLoader instances.
 * Keys are hex-formatted hash strings like `"0x1234ABCD"` (uppercase, 8-digit zero-padded).
 * Values are resolved filenames.
 */
let _mixDb: Map<string, string> | undefined

// ---------------------------------------------------------------------------
// MixLoader — MIX 包加载器（运行时 C&C + 构建时加密格式文档桩）
// ---------------------------------------------------------------------------

/**
 * MIX 包加载器。
 *
 * OpenRA 对照: OpenRA.Mods.Cnc.FileSystem.MixLoader
 *
 * **Phase A 运行时路径**: 对于 C&C 格式（未加密）的 MIX 文件，
 * 委托给 {@link MixFileRuntime.parse} 进行内存解析。
 *
 * **加密 MIX 文件 (RA/TS/RA2)**：不支持浏览器端解密，
 * 记录警告并返回 null。必须使用构建时工具解包。
 *
 * 构建时工作流（用于加密 MIX）:
 * ```
 * MIX 文件 → build-tool 中的 MixFile.parseHeader/parseIndex/decryptHeader
 *          → 每个文件写入输出目录 + 生成 JSON 清单
 *          → 浏览器加载标准 ZIP/目录
 * ```
 */
export class MixLoader implements IPackageLoader {
  /**
   * Set the MIX hash database for filename resolution.
   *
   * The database maps hex-formatted Westwood filename hashes to their
   * resolved filenames. This is shared across all MixLoader instances.
   *
   * OpenRA 对照: MixLoader.XccGlobalDatabase / XccLocalDatabase
   *
   * @param mixDb — hash-to-filename database.
   *                Keys are hex-formatted like `"0x1234ABCD"` (uppercase, 8-digit zero-padded).
   */
  static setMixDb(mixDb: Map<string, string>): void {
    _mixDb = mixDb
  }

  /**
   * Attempt to parse a stream as a MIX package.
   *
   * OpenRA 对照: MixLoader.TryParsePackage(Stream, string, FileSystem, out IReadOnlyPackage)
   *
   * Detection logic (Phase B: unified 3-way chain + db enrichment):
   * 1. If filename does not end with `.mix` (case-insensitive) → return null
   * 2. Delegate to {@link MixFileRuntime.parseAuto} for 3-way format detection
   *    (C&C → encrypted → Westwood classic)
   * 3. After successful parse, call {@link MixFileRuntime.buildMixDb} to
   *    extract the "local mix database.dat" entry and enrich the shared mixDb
   * 4. On unrecognized format → log diagnostic warning + return null
   *
   * @param filename — filename (for extension check and package name)
   * @param stream — file content (ArrayBuffer)
   * @param _files — file system context (unused)
   * @returns MixFileRuntime instance for recognized formats, null otherwise
   */
  tryParsePackage(
    filename: string,
    stream: ArrayBuffer,
    _files?: IReadOnlyFileSystem,
  ): IReadOnlyPackage | null {
    // Check 1: file extension
    if (!filename.toLowerCase().endsWith('.mix')) {
      return null
    }

    // Phase B: Use the unified 3-way format detection chain (parseAuto)
    // and enrich the mixDb from the MIX's own "local mix database.dat" entry.
    //
    // OpenRA 对照: MixLoader.TryParsePackage — constructs MixFile which
    //   internally calls ParseIndex to build the filename index from
    //   local/global databases.
    try {
      const mixInstance = MixFileRuntime.parseAuto(filename, stream, _mixDb)

      // Enrich the mix database from the MIX's own local database entry.
      // This allows subsequent MIX parses to resolve more filenames.
      const enrichedDb = MixFileRuntime.buildMixDb(
        stream,
        mixInstance.getEntries(),
        _mixDb,
      )

      // Merge enriched DB with existing: enriched takes priority (it's
      // more specific to this MIX file's content), then fall back to
      // the existing _mixDb for keys not in enriched.
      if (enrichedDb.size > 0) {
        const mergedDb = new Map(_mixDb) // copy existing
        for (const [key, value] of enrichedDb) {
          mergedDb.set(key, value)
        }
        MixLoader.setMixDb(mergedDb)
      }

      return mixInstance
    } catch (err) {
      const msg = String(err)

      // Log diagnostic info for unrecognized format
      if (msg.includes('not a recognized MIX format')) {
        console.warn(`MixLoader: ${msg}`)
      } else {
        console.warn(`MixLoader: Failed to parse "${filename}": ${msg}`)
      }

      return null
    }
  }
}

// ---------------------------------------------------------------------------
// MixFile — MIX 归档文档参考实现
// ---------------------------------------------------------------------------

/**
 * MIX 归档参考实现（ADR-5.1：不在浏览器中使用）。
 *
 * OpenRA 对照: MixLoader.MixFile (nested class)
 *
 * ## MIX 格式完整规范
 *
 * Westwood Studios 的 MIX 格式是 Command & Conquer、Red Alert、
 * Tiberian Sun 和 Red Alert 2 中使用的专有归档格式。
 * 存在两种变体：
 *
 * ### C&C 格式 (isCncMix = true)
 *
 * 当偏移量 0 处的第一个 uint16 != 0 时识别：
 *
 * ```
 * Offset  Size  Description
 * ------  ----  -----------
 * 0       2     numFiles (uint16 LE)
 * 2       4     dataSize (uint32 LE) — 数据块的总大小
 * 6       12×N  PackageEntry 记录（每个 12 字节）
 * 6+12×N  —     数据块（连续存储，无填充）
 * ```
 *
 * 不存在加密或标志字段。此格式用于：
 * - Command & Conquer (Tiberian Dawn)
 * - Red Alert 1
 * - Dune 2000
 *
 * ### RA/TS/RA2 格式 (isCncMix = false)
 *
 * 当偏移量 0 处的第一个 uint16 == 0 时识别：
 *
 * ```
 * Offset  Size  Description
 * ------  ----  -----------
 * 0       2     flags (uint16 LE):
 *                bit 0 — hasChecksum（头部后跟哈希表）
 *                bit 1 — isEncrypted（Blowfish + RSA 公钥）
 *                bit 2-15 — 保留
 * 2       2     numFiles (uint16 LE)
 * 4       4     dataSize (uint32 LE)
 * 8       80    加密的 Blowfish 密钥块（仅当 isEncrypted 时存在）
 * 8+80*   12×N  PackageEntry 记录（12 字节 × numFiles，可能被加密）
 * ```
 *
 * ### 包条目格式
 *
 * 每个条目均为 12 字节（3 个 uint32 LE）：
 * ```
 * Offset  Size  Description
 * ------  ----  -----------
 * +0      4     hash (uint32 LE) — 文件名的 Westwood 哈希
 * +4      4     offset (uint32 LE) — 从 dataStart 开始的字节偏移量
 * +8      4     length (uint32 LE) — 数据长度（字节）
 * ```
 *
 * ### 哈希查找（文件名解析）
 *
 * MIX 文件仅存储文件名哈希值，而非实际文件名。
 * 文件名通过以下方式解析：
 *
 * 1. **本地混音数据库**：在条目中搜索 `"local mix database.dat"` 的哈希。
 *    如果找到，将其解包并解析为 XCC 本地数据库
 *    （纯文本，每行一个文件名）。
 *
 * 2. **全局混音数据库**：如果未找到本地数据库，回退到
 *    `"global mix database.dat"`（XCC 全局数据库）。
 *
 * 3. **哈希匹配**：对每个候选文件名，计算 Classic 和 CRC32 两种哈希。
 *    使用匹配条目数更多的哈希类型（CRC32 优先）。
 *
 * 4. **未知哈希**：任何剩余的未解析哈希都会记录调试消息。
 *
 * ### Blowfish 加密（仅 RA/TS/RA2）
 *
 * 当 flags 的第 1 位置位时，MIX 头部会使用 Blowfish 加密：
 *
 * 1. **RSA 公钥**（Base64 编码）：
 *    `"AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V"`
 *
 * 2. **Blowfish 密钥派生**（OpenRA 对照: `BlowfishKeyProvider.DecryptKey`）：
 *    - 读取紧随标志后的 80 字节 `keyblock`
 *    - 使用 RSA 公钥解密以生成 56 字节的 Blowfish 密钥
 *    - RSA 指数：0x10001（65537）
 *    - 大数运算：64 个 uint32 数组，模幂运算
 *
 * 3. **头部解密**（OpenRA 对照: `MixFile.DecryptHeader`）：
 *    - 使用派生出的 Blowfish 密钥创建 Blowfish 密码实例
 *    - 数据以 8 字节块读取和加密（每个块 = 2 个 uint32）
 *    - 第一个块先解密以获得头部长度（numFiles）
 *    - 计算完整块数：`(13 + numFiles * 12) / 8`
 *    - 解密所有块
 *
 * 4. **Blowfish 密码**（OpenRA 对照: `Blowfish.cs`）：
 *    - 16 轮 Feistel 网络
 *    - P 数组：18 个 uint32（从密钥初始化）
 *    - S 盒：4 × 256 个 uint32（从密钥初始化）
 *    - 加密函数：F(a) = ((S0[a>>24] + S1[a>>16 & 0xFF]) ^ S2[a>>8 & 0xFF]) + S3[a & 0xFF]
 *    - 每轮：left ^= P[i]; right ^= F(left); swap(left, right)
 *    - 最终：left ^= P[16]; right ^= P[17]
 *
 * ### 实现说明
 *
 * - 构建时工作流：所有 MIX 文件解包成扁平目录 + JSON 清单
 * - 无需将 Blowfish/RSA 加密（~300KB WASM）打包到浏览器中
 * - 浏览器端运行时：`tryParsePackage()` 返回 null
 * - 下方的参考实现供构建工具作者使用
 */
export class MixFile implements IReadOnlyPackage {
  // -----------------------------------------------------------------------
  // IReadOnlyPackage — 仅存根实现（始终为空）
  // -----------------------------------------------------------------------

  readonly name: string

  constructor(_s: ArrayBuffer, filename: string) {
    this.name = filename
  }

  /** 始终返回空数组。 */
  get contents(): readonly string[] {
    return []
  }

  /** 始终返回 false。 */
  contains(_filename: string): boolean {
    return false
  }

  /** 始终返回 null。 */
  async open(_filename: string, _files?: IReadOnlyFileSystem): Promise<ArrayBuffer | null> {
    return null
  }

  /** 始终返回 null。 */
  openPackage(_filename: string, _files?: IReadOnlyFileSystem): IReadOnlyPackage | null {
    return null
  }

  /** 无操作存根。 */
  dispose(): void { /* 无 GPU 或其他需要清理的资源 */ }

  // -----------------------------------------------------------------------
  // 参考实现（供构建工具作者使用 — 不在浏览器中调用）
  // -----------------------------------------------------------------------

  /**
   * 解析 MIX 头部（文档参考实现）。
   *
   * OpenRA 对照: MixFile.ParseHeader(Stream, long, out long)
   *
   * 从给定偏移量读取 numFiles（uint16）和 dataSize（uint32），
   * 然后读取 numFiles 个 PackageEntry 记录。
   *
   * @param data — 原始 MIX 文件数据
   * @param offset — 头部开始处的字节偏移量
   * @param isCncMix — 如果为 true，头部格式为 C&C（头部无标志）；
   *                   如果为 false，头部格式为 RA/TS/RA2（标志位于偏移量 0）
   * @returns 解析出的条目和 dataStart 偏移量
   */
  static parseHeader(data: Uint8Array, offset: number, isCncMix: boolean): {
    entries: PackageEntry[]
    dataStart: number
  } {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)

    // NOTE: 当从外部调用时（offset != 0），调用者已经跳过了标志。
    // 当从构造函数调用时（offset == 0 且 isCncMix == false），
    // 需要跳过前 4 个字节（标志）。
    // 此处实现：如果 offset == 0 且不是 C&C，则跳过前 2+2 字节
    const adjustedOffset = isCncMix ? offset : 4

    const numFiles = dv.getUint16(adjustedOffset, true)
    // dataSize 未被使用，但为了正确性仍然读取
    // dv.getUint32(adjustedOffset + 2, true) — dataSize

    const entries: PackageEntry[] = []
    // 条目从 adjustedOffset + 2 (numFiles) + 4 (dataSize) = adjustedOffset + 6 开始
    let entryOffset = adjustedOffset + 6
    for (let i = 0; i < numFiles; i++) {
      const { entry, nextOffset } = PackageEntry.fromDataView(dv, entryOffset)
      entries.push(entry)
      entryOffset = nextOffset
    }

    const dataStart = entryOffset
    return { entries, dataStart }
  }

  /**
   * 从哈希索引中解析文件名（文档参考实现）。
   *
   * OpenRA 对照: MixFile.ParseIndex(Dictionary, string[])
   *
   * 给定一个哈希 → PackageEntry 的映射和一个全局文件名列表，
   * 尝试通过计算每个文件名的 Classic 和 CRC32 哈希来解析哈希值。
   * 使用匹配条目数更多的哈希类型（CRC32 优先）。
   *
   * @param entries — 哈希 → PackageEntry 的映射
   * @param globalFilenames — 已知文件名字符串数组
   * @returns 文件名 → PackageEntry 的映射
   */
  static parseIndex(
    entries: Map<number, PackageEntry>,
    globalFilenames: string[],
  ): Map<string, PackageEntry> {
    const allPossibleFilenames = new Set(globalFilenames)

    // 尝试查找本地混音数据库
    const dbNameClassic = PackageEntry.hashFilename(
      'local mix database.dat', PackageHashType.Classic,
    )
    const dbNameCRC = PackageEntry.hashFilename(
      'local mix database.dat', PackageHashType.CRC32,
    )
    for (const [key, entry] of entries) {
      if (key === dbNameClassic || key === dbNameCRC) {
        // NOTE: 在实际构建工具实现中，此处需要：
        // 1. 从 MIX 中提取数据库条目数据
        // 2. 将数据库解析为文件名（每行一个）
        // 3. 将文件名添加到 allPossibleFilenames 中
        // 参考实现为简洁起见省略此步骤
        void entry
        break
      }
    }

    const classicIndex = new Map<string, PackageEntry>()
    const crcIndex = new Map<string, PackageEntry>()

    for (const filename of allPossibleFilenames) {
      const classicHash = PackageEntry.hashFilename(filename, PackageHashType.Classic)
      const crcHash = PackageEntry.hashFilename(filename, PackageHashType.CRC32)

      const classicEntry = entries.get(classicHash)
      if (classicEntry) classicIndex.set(filename, classicEntry)

      const crcEntry = entries.get(crcHash)
      if (crcEntry) crcIndex.set(filename, crcEntry)
    }

    // 使用匹配条目数更多的哈希类型；匹配数相等时使用 Classic
    return crcIndex.size > classicIndex.size ? crcIndex : classicIndex
  }

  /**
   * 解密 MIX 头部（文档参考实现 — Blowfish + RSA）。
   *
   * OpenRA 对照: MixFile.DecryptHeader(Stream, long, out long)
   *
   * **此方法是一个文档参考桩。** 实现 Blowfish 解密需要
   * ~300KB 的 WASM 加密原语或完整的 Blowfish + RSA 实现。
   * 实际解密应委托给构建时工具。
   *
   * 解密流程：
   * 1. 在偏移量 4 处读取 80 字节的 keyblock
   * 2. 使用 RSA 公钥解密 keyblock → 56 字节 Blowfish 密钥
   * 3. 解密第一个 8 字节块以获得 numFiles
   * 4. 计算完整的头部块数
   * 5. 解密所有块
   *
   * @param _data — 原始 MIX 文件数据
   * @param _offset — 密钥块开始处的字节偏移量（通常为 4）
   * @returns 解密后的条目数据
   * @throws 始终抛出 — 浏览器端不支持 Blowfish 解密
   */
  static decryptHeader(_data: Uint8Array, _offset: number): {
    entries: PackageEntry[]
    dataStart: number
  } {
    throw new Error(
      'MixFile.decryptHeader: Blowfish decryption is not available in the browser. ' +
      'Use the build-time MIX unpacker instead. ' +
      'See ADR-5.1 for details.',
    )
  }

  // -----------------------------------------------------------------------
  // RSA 公钥（来自 OpenRA 的 BlowfishKeyProvider.PublicKeyString）
  // -----------------------------------------------------------------------

  /**
   * 用于 Blowfish 密钥解密的 RSA Base64 编码公钥。
   *
   * OpenRA 对照: BlowfishKeyProvider.PublicKeyString
   */
  static readonly RSA_PUBLIC_KEY = 'AihRvNoIbTn85FZRYNZRcT+i6KpU+maCsEqr3Q5q+LDB5tH7Tz2qQ38V'
}
