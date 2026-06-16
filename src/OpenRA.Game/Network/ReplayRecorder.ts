/**
 * ReplayRecorder.ts — 回放录制引擎：捕获网络数据包并写入 .orarep 二进制格式
 * OpenRA 对照: OpenRA.Game/Network/ReplayRecorder.cs (119 lines)
 *
 * 核心范式转换:
 * - C# BinaryWriter over FileStream → DataView + 内存 Uint8Array 缓冲区
 * - C# MemoryStream preStartBuffer → preStartChunks 数组（在 StartGame 时刷新）
 * - C# File.Create() / Directory.CreateDirectory() → 内存缓冲区 + getBuffer()
 *   输出（调用方负责持久化）
 * - C# BinaryWriter.Write(int32) → DataView.setInt32(offset, value, true)
 *   (小端序 — 匹配 C# BinaryWriter 默认行为)
 * - C# OrderIO.TryParseOrderPacket() → 已迁移的 tryParseOrderPacket()
 * - C# IDisposable → dispose()，带 disposed 守卫以实现幂等性
 * - C# chooseFilename 回调 + 128 次重试 → 直接回调（无文件系统碰撞检测，
 *   因为所有数据都在内存中）
 */

import { tryParseOrderPacket } from './Order.js'
import type { ReplayMetadata } from '../FileFormats/ReplayMetadata.js'
import {
  MetaStartMarker,
  MetaVersion,
  MetaEndMarker,
} from '../FileFormats/ReplayMetadata.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** Int32 的字节大小（全部使用小端序）。 */
const INT32_SIZE = 4

/** 每条数据包头部的大小：[clientID: int32][dataLength: int32] = 8 字节。 */
const PACKET_HEADER_SIZE = 8

// ---------------------------------------------------------------------------
// ReplayRecorder (对应 OpenRA ReplayRecorder)
// ---------------------------------------------------------------------------

/**
 * 回放录制引擎。捕获网络订单数据包并以 .orarep 二进制格式存储。
 * 在检测到 frame 0 的 StartGame 订单之前使用预启动缓冲区；
 * 检测到后，将预启动缓冲区刷新到主存储并继续录制。
 *
 * OpenRA 对照: ReplayRecorder class
 *
 * 所有数据保存在内存中。调用方可以在 dispose() 之后通过
 * getBuffer() 获取完整的 .orarep 缓冲区以进行持久化。
 */
export class ReplayRecorder {
  /** 此回放的元数据包装器。在 dispose() 时写入尾部。
   *
   * OpenRA 对照: ReplayRecorder.Metadata
   */
  metadata: ReplayMetadata | null = null

  /**
   * 用于生成基础文件名的回调（无扩展名）。
   *
   * OpenRA 对照: chooseFilename: Func<string>
   */
  private readonly _chooseFilename: () => string

  /**
   * 在 StartGame 之前缓冲的数据包。
   * 每条：{ clientId, data } — data 为原始网络数据包字节。
   */
  private readonly _preStartChunks: Array<{
    clientId: number
    data: Uint8Array
  }> = []

  /**
   * StartGame 之后录制的主数据包。
   * 每条：{ clientId, data } — data 为原始网络数据包字节。
   */
  private readonly _mainChunks: Array<{
    clientId: number
    data: Uint8Array
  }> = []

  /** 是否已经从预启动阶段转换为文件录制模式。 */
  private _recordingToFile = false

  /** 选定的文件名（不含扩展名）。 */
  private _chosenFilename = ''

  /** 用于幂等 dispose 的守卫标志。 */
  private _disposed = false

  /** 完全序列化后的回放缓冲区（仅在 dispose() 后可用）。 */
  private _finalBuffer: Uint8Array | null = null

  // ---------------------------------------------------------------------------
  // 静态辅助方法
  // ---------------------------------------------------------------------------

  /**
   * 通过检查 data 是否包含 frame 0 的 StartGame 订单来判断游戏是否开始。
   *
   * OpenRA 对照: ReplayRecorder.IsGameStart(byte[])
   *
   * 反序列化数据包并检查 frame === 0 且是否存在
   * orderString === "StartGame" 的订单。
   *
   * @param data — 原始网络数据包（4 字节帧前缀 + 序列化的订单）
   * @returns 如果此数据包在 frame 0 包含 StartGame 则返回 true
   */
  static isGameStart(data: Uint8Array): boolean {
    const parsed = tryParseOrderPacket(data)
    if (!parsed) return false
    if (parsed.frame !== 0) return false

    for (const order of parsed.packet.getOrders(null)) {
      if (order.orderString === 'StartGame') return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // 构造
  // ---------------------------------------------------------------------------

  /**
   * 创建一个新的 ReplayRecorder。
   *
   * OpenRA 对照: ReplayRecorder(Func<string>)
   *
   * @param chooseFilename — 返回基础文件名（不含扩展名）的回调
   */
  constructor(chooseFilename: () => string) {
    this._chooseFilename = chooseFilename
  }

  // ---------------------------------------------------------------------------
  // 数据包录制（对应 OpenRA Receive / ReceiveFrame）
  // ---------------------------------------------------------------------------

  /**
   * 录制一个原始网络数据包。
   *
   * OpenRA 对照: ReplayRecorder.Receive(int, byte[])
   *
   * 写入 [clientID: int32 LE][dataLength: int32 LE][data: bytes] 元组。
   * 如果仍处于预启动缓冲模式且 data 包含 StartGame：
   * 切换到文件录制模式并生成文件名，后续数据包将写入主存储。
   *
   * 如果已 dispose，则此方法为空操作。
   *
   * @param clientId — 发送客户端 ID
   * @param data — 原始网络数据包字节（含 4 字节帧前缀）
   */
  receive(clientId: number, data: Uint8Array): void {
    if (this._disposed) return

    // 检查预启动到文件的转换
    if (!this._recordingToFile && ReplayRecorder.isGameStart(data)) {
      this._recordingToFile = true
      this._chosenFilename = this._chooseFilename()
    }

    // 复制数据以确保安全（调用方可能复用缓冲区）
    const dataCopy = new Uint8Array(data)

    if (this._recordingToFile) {
      this._mainChunks.push({ clientId, data: dataCopy })
    } else {
      this._preStartChunks.push({ clientId, data: dataCopy })
    }
  }

  /**
   * 录制一个帧数据包（在 data 前追加 frame 前缀）。
   *
   * OpenRA 对照: ReplayRecorder.ReceiveFrame(int, int, byte[])
   *
   * 创建一个新缓冲区：`[frame: int32 LE][data: bytes]`，
   * 并作为 data 参数传递给 receive()。
   * 这是一个便利方法，使调用方无需手动创建帧前缀缓冲区。
   *
   * @param clientId — 发送客户端 ID
   * @param frame — 帧编号
   * @param data — 原始数据包字节（不含帧前缀）
   */
  receiveFrame(clientId: number, frame: number, data: Uint8Array): void {
    // NOTE: 帧号使用大端序写入以匹配网络协议（OrderPacket.serialize 使用 BE）。
    // C# BinaryWriter.Write(int32) 使用小端序，但我们的网络协议使用大端序，
    // 回放格式必须与传入的原始网络数据包格式一致。
    const combined = new Uint8Array(INT32_SIZE + data.length)
    const view = new DataView(combined.buffer)
    view.setInt32(0, frame, false) // 大端序（匹配网络协议）
    combined.set(data, INT32_SIZE)
    this.receive(clientId, combined)
  }

  // ---------------------------------------------------------------------------
  // 文件名
  // ---------------------------------------------------------------------------

  /**
   * 选定的回放文件名（不含扩展名）。
   * 在检测到 StartGame 之前为空字符串。
   *
   * OpenRA 对照: (派生自 chooseFilename 调用)
   */
  get chosenFilename(): string {
    return this._chosenFilename
  }

  /** 此录制器是否已开始录制到主存储。 */
  get recordingToFile(): boolean {
    return this._recordingToFile
  }

  /** 此录制器是否已被销毁。 */
  get disposed(): boolean {
    return this._disposed
  }

  // ---------------------------------------------------------------------------
  // 序列化 / 缓冲区获取
  // ---------------------------------------------------------------------------

  /**
   * 获取完整的序列化回放缓冲区。
   * 包含预启动数据包、主录制数据包和元数据尾部。
   *
   * 仅在 dispose() 之后可用；否则返回 null。
   *
   * @returns 完整的 .orarep 二进制缓冲区，如果尚未 dispose 则返回 null
   */
  getBuffer(): Uint8Array | null {
    return this._finalBuffer
  }

  /**
   * 将所有数据包和元数据尾部序列化为最终的 .orarep 二进制缓冲区。
   *
   * 格式：
   * ```
   * [preStart 数据包...]
   * [main 数据包...]
   * [MetaStartMarker: int32 LE = -1]  ← 标记数据包结束/元数据开始
   * [ReplayMetadata 尾部]
   * ```
   *
   * @returns 完整的 .orarep 二进制缓冲区
   */
  private _serialize(): Uint8Array {
    const allChunks = [...this._preStartChunks, ...this._mainChunks]

    // 计算数据包部分的总大小
    let packetSectionSize = 0
    for (const chunk of allChunks) {
      packetSectionSize += PACKET_HEADER_SIZE + chunk.data.length
    }

    // 如果连接了元数据，则为元数据尾部预留空间
    const hasMetadata = this.metadata !== null
    let metadataSize = 0
    let cachedJsonString = ''
    let cachedEncodedBytes: Uint8Array | null = null
    if (hasMetadata) {
      // Pre-compute JSON once to avoid double string encoding (once for size
      // calculation, once inside writeToBuffer). The cached bytes are passed
      // to a direct write below instead of calling writeToBuffer which would
      // internally call toJSONString() + TextEncoder.encode() again.
      cachedJsonString = this.metadata!.gameInfo.toJSONString()
      cachedEncodedBytes = new TextEncoder().encode(cachedJsonString)
      // MetaStartMarker(4) + MetaVersion(4) + stringLen(4) + stringBytes + dataLen(4) + MetaEndMarker(4)
      metadataSize =
        INT32_SIZE * 5 + cachedEncodedBytes.length // = 20 + stringBytes
    }

    const totalSize = packetSectionSize + metadataSize
    const buffer = new Uint8Array(totalSize)
    const view = new DataView(buffer.buffer)

    // 写入所有数据包
    let offset = 0
    for (const chunk of allChunks) {
      // clientID: int32 LE
      view.setInt32(offset, chunk.clientId, true)
      offset += INT32_SIZE

      // dataLength: int32 LE
      view.setInt32(offset, chunk.data.length, true)
      offset += INT32_SIZE

      // data 字节
      buffer.set(chunk.data, offset)
      offset += chunk.data.length
    }

    // 写入元数据尾部（使用预先计算的编码字节以避免双重 JSON 编码）
    if (hasMetadata && cachedEncodedBytes !== null) {
      // NOTE: 使用直接写入而非 writeToBuffer，因为我们已经预先计算了 JSON 字节。
      // writeToBuffer 会在内部再次调用 toJSONString() + TextEncoder.encode()。
      const stringByteLength = cachedEncodedBytes.length
      const dataLength = 4 + stringByteLength // 长度前缀 + 字符串字节

      // MetaStartMarker
      view.setInt32(offset, MetaStartMarker, true)
      // MetaVersion
      view.setInt32(offset + 4, MetaVersion, true)
      // 字符串长度前缀
      view.setInt32(offset + 8, stringByteLength, true)
      // 字符串字节
      buffer.set(cachedEncodedBytes, offset + 12)
      // dataLength
      view.setInt32(offset + 12 + stringByteLength, dataLength, true)
      // MetaEndMarker
      view.setInt32(
        offset + 12 + stringByteLength + 4,
        MetaEndMarker,
        true,
      )

      const writtenSize = 20 + stringByteLength
      // 断言：写入的元数据大小必须与预先计算的值一致
      if (writtenSize !== metadataSize) {
        throw new Error(
          `ReplayRecorder: metadata write size mismatch ` +
          `(expected ${metadataSize}, wrote ${writtenSize})`,
        )
      }
    }

    return buffer
  }

  // ---------------------------------------------------------------------------
  // 销毁（对应 OpenRA Dispose）
  // ---------------------------------------------------------------------------

  /**
   * 完成回放录制。
   *
   * OpenRA 对照: ReplayRecorder.Dispose()
   *
   * 设置 Metadata.GameInfo.EndTimeUtc，序列化完整回放（含元数据尾部），
   * 并释放所有内部缓冲区。
   *
   * 幂等操作：多次调用 dispose() 是安全的。
   */
  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    // 完成元数据
    if (this.metadata) {
      if (this.metadata.gameInfo) {
        this.metadata.gameInfo.endTimeUtc = new Date()
      }
    }

    // 序列化完整回放
    this._finalBuffer = this._serialize()

    // 清除待处理的块以释放内存
    this._preStartChunks.length = 0
    this._mainChunks.length = 0
  }
}
