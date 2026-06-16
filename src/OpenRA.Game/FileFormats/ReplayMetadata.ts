/**
 * ReplayMetadata.ts — 回放文件元数据包装器，支持二进制尾部格式
 * OpenRA 对照: OpenRA.Game/FileFormats/ReplayMetadata.cs
 *
 * 核心范式转换:
 * - C# FileStream + BinaryWriter/BinaryReader → DataView + Uint8Array
 * - C# BinaryWriter.Write(int32) → DataView.setInt32(offset, value, true)
 *   (小端序)
 * - C# BinaryReader.ReadInt32() → DataView.getInt32(offset, true)
 *   (小端序)
 * - C# Encoding.UTF8 + BinaryWriter.WriteLengthPrefixedString →
 *   TextEncoder.encode() + 写入 int32 长度前缀 + 字节
 * - C# ReadLengthPrefixedString(Encoding.UTF8, maxLength) →
 *   读取 int32 长度 + TextDecoder.decode(bytes)
 * - C# File.Move() / Path.Combine() → FilePath 字符串操作
 *   （实际文件系统操作由 IStorageProvider 处理）
 * - C# 异常处理 → 返回 null（fail-safe 模式，从不抛出）
 * - C# GameInformation.Serialize() / Deserialize() with MiniYaml →
 *   GameInformation.toJSONString() / fromJSONString() with JSON
 */

import { GameInformation } from '../GameInformation.js'

// ---------------------------------------------------------------------------
// 常量（对应 OpenRA ReplayMetadata 常量）
// ---------------------------------------------------------------------------

/**
 * 元数据起始标记 — 必须是无效的回放 'client' 值。
 *
 * OpenRA 对照: ReplayMetadata.MetaStartMarker = -1
 */
export const MetaStartMarker = -1

/**
 * 元数据结束标记。
 *
 * OpenRA 对照: ReplayMetadata.MetaEndMarker = -2
 */
export const MetaEndMarker = -2

/**
 * 当前支持的元数据版本。
 *
 * OpenRA 对照: ReplayMetadata.MetaVersion = 0x00000001
 */
export const MetaVersion = 0x00000001

/** UTF-8 字符串的最大长度（字节）——防止损坏文件的保护措施。 */
const MAX_STRING_BYTE_LENGTH = 100 * 1024 // 100KB

// ---------------------------------------------------------------------------
// ReplayMetadata（对应 OpenRA ReplayMetadata）
// ---------------------------------------------------------------------------

/**
 * 包装 GameInformation 并提供对回放文件尾部二进制元数据的序列化/反序列化。
 *
 * OpenRA 对照: ReplayMetadata class
 *
 * 二进制尾部格式（小端序 int32 帧）：
 * ```
 * [MetaStartMarker: int32 = -1]
 * [MetaVersion:     int32 = 1]
 * [data section:    dataLength 字节]
 *   [string length: int32 = N]
 *   [string bytes:  N 字节，UTF-8 编码的 JSON]
 * [dataLength:      int32 = dataLength (= 4 + N)]
 * [MetaEndMarker:   int32 = -2]
 * ```
 * 总尾部大小 = 20 + N 字节。
 */
export class ReplayMetadata {
  /** 包装的游戏元数据。
   *
   * OpenRA 对照: ReplayMetadata.GameInfo
   */
  readonly gameInfo: GameInformation

  /** 虚拟回放文件路径。
   *
   * OpenRA 对照: ReplayMetadata.FilePath
   */
  filePath: string

  /**
   * 从现有的 GameInformation 创建一个 ReplayMetadata。
   *
   * OpenRA 对照: ReplayMetadata(GameInformation info)
   *
   * @param gameInfo — 游戏元数据
   * @throws 如果 gameInfo 为 null
   */
  constructor(gameInfo: GameInformation) {
    if (!gameInfo) {
      throw new Error('GameInfo must not be null')
    }
    this.gameInfo = gameInfo
    this.filePath = ''
  }

  // ---------------------------------------------------------------------------
  // 二进制序列化 / 反序列化（对应 OpenRA Write / Read）
  // ---------------------------------------------------------------------------

  /**
   * 将元数据写入二进制尾部到目标缓冲区。
   *
   * OpenRA 对照: ReplayMetadata.Write(BinaryWriter)
   *
   * 以小端序字节顺序写入完整的尾部块，从给定的偏移量开始。
   * 不分配堆内存——直接写入提供的缓冲区。
   *
   * @param targetBuffer — 写入目标缓冲区（必须足够大）
   * @param offset — 开始写入的偏移量（字节）
   * @returns 写入的字节数
   */
  writeToBuffer(targetBuffer: Uint8Array, offset: number): number {
    const view = new DataView(
      targetBuffer.buffer,
      targetBuffer.byteOffset,
      targetBuffer.byteLength,
    )

    // 将 GameInfo 序列化为 JSON 并编码为 UTF-8
    const jsonString = this.gameInfo.toJSONString()
    const encoder = new TextEncoder()
    const stringBytes = encoder.encode(jsonString)

    const stringByteLength = stringBytes.length
    const dataLength = 4 + stringByteLength // 长度前缀 + 字符串字节

    // 写入 MetaStartMarker
    view.setInt32(offset, MetaStartMarker, true)
    // 写入 MetaVersion
    view.setInt32(offset + 4, MetaVersion, true)
    // 写入字符串长度前缀
    view.setInt32(offset + 8, stringByteLength, true)
    // 写入字符串字节
    targetBuffer.set(stringBytes, offset + 12)
    // 写入 dataLength（用于尾部解析）
    view.setInt32(offset + 12 + stringByteLength, dataLength, true)
    // 写入 MetaEndMarker
    view.setInt32(offset + 12 + stringByteLength + 4, MetaEndMarker, true)

    // 返回写入的总字节数
    return 16 + dataLength // = 20 + stringByteLength
  }

  /**
   * 从包含回放数据及尾部元数据的二进制缓冲区读取 ReplayMetadata。
   *
   * OpenRA 对照: ReplayMetadata.Read(string path)
   *
   * 解析文件末尾的二进制尾部。成功时返回一个新的
   * ReplayMetadata，否则返回 null（从不抛出异常）。
   *
   * 缓冲区应包含完整的回放文件，元数据位于末尾。
   *
   * @param data — 包含回放数据的 ArrayBuffer（含尾部）
   * @returns 成功时返回 ReplayMetadata，数据无效或损坏时返回 null
   */
  static readFromBuffer(data: ArrayBuffer): ReplayMetadata | null {
    try {
      // 最小大小：MetaStartMarker(4) + MetaVersion(4) +
      //   stringLength(4) + dataLength(4) + MetaEndMarker(4) = 20 字节
      if (data.byteLength < 20) {
        return null
      }

      const view = new DataView(data)

      // 从末尾读取 dataLength 和 MetaEndMarker
      const fileLength = data.byteLength
      const writtenDataLength = view.getInt32(fileLength - 8, true)
      const endMarker = view.getInt32(fileLength - 4, true)

      if (endMarker !== MetaEndMarker) {
        return null
      }

      // 计算元数据起始偏移量
      const startOffset = fileLength - 16 - writtenDataLength

      if (startOffset < 0 || startOffset + 12 > fileLength) {
        return null
      }

      // 验证 MetaStartMarker
      const startMarker = view.getInt32(startOffset, true)
      if (startMarker !== MetaStartMarker) {
        return null
      }

      // 读取并验证版本
      const version = view.getInt32(startOffset + 4, true)
      if (version > MetaVersion) {
        // 在返回 null 之前记录警告（未来的元数据版本无法解析）
        console.warn(
          `ReplayMetadata: unsupported metadata version ${version} ` +
            `(current: ${MetaVersion})`,
        )
        return null
      }

      // 读取长度前缀字符串
      const stringByteLength = view.getInt32(startOffset + 8, true)

      // 验证字符串长度
      if (
        stringByteLength < 0 ||
        stringByteLength > MAX_STRING_BYTE_LENGTH
      ) {
        return null
      }

      // 验证字符串字节不超出缓冲区
      if (startOffset + 12 + stringByteLength > fileLength) {
        return null
      }

      // 提取 UTF-8 字节
      const stringData = new Uint8Array(
        data,
        startOffset + 12,
        stringByteLength,
      )

      // 解码 UTF-8 字符串
      const decoder = new TextDecoder('utf-8', { fatal: false })
      const jsonString = decoder.decode(stringData)

      // 从 JSON 解析 GameInformation
      const gameInfo = GameInformation.fromJSONString(jsonString)
      if (!gameInfo) {
        return null
      }

      const metadata = new ReplayMetadata(gameInfo)
      return metadata
    } catch {
      // 任何解析错误 → 返回 null（fail-safe）
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // 文件路径管理（对应 OpenRA RenameFile）
  // ---------------------------------------------------------------------------

  /**
   * 重命名回放文件（更新虚拟路径）。
   *
   * OpenRA 对照: ReplayMetadata.RenameFile(string)
   *
   * 注意：在浏览器环境中，实际的文件系统操作由
   * IStorageProvider 处理。此方法仅更新内部 FilePath。
   * 调用方负责协调存储提供程序的 rename 操作。
   *
   * @param newFilenameWithoutExtension — 无扩展名的新文件名
   */
  renameFile(newFilenameWithoutExtension: string): void {
    // 从当前 FilePath 提取目录部分（如果已设置）
    const dirPath = this.filePath
      ? this.filePath.substring(
          0,
          Math.max(this.filePath.lastIndexOf('/'), 0),
        )
      : ''
    const dirPrefix = dirPath ? dirPath + '/' : ''

    this.filePath = `${dirPrefix}${newFilenameWithoutExtension}.orarep`
  }
}
