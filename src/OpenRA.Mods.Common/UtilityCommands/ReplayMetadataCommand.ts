/**
 * ReplayMetadataCommand.ts — 从回放文件中提取并输出游戏元数据
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/ReplayMetadataCommand.cs
 *
 * 核心范式转换:
 * - C# FileStream + FileMode.Open 直接文件访问
 *   → Node.js fs.readFileSync() 二进制读取
 * - C# ReplayMetadata.Read(string path) 文件路径 API
 *   → ReplayMetadata.readFromBuffer(ArrayBuffer) 二进制缓冲区 API
 * - C# FieldSaver.Save(GameInfo).ToLines(filePath)
 *   → GameInformation.toJSONString() JSON 序列化
 * - C# FieldSaver.Save(Player).ToLines(playerIndex)
 *   → GameInformationPlayer.toJSONObject() JSON 格式
 * - C# InvalidDataException 异常
 *   → Error 异常 + 控制台错误消息
 *
 * 输出格式:
 * 回放元数据以 JSON 格式打印到标准输出。
 * 这替换了 OpenRA 的 MiniYAML 多行输出格式，
 * 使其更易于脚本/CI 处理。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import {
  ReplayMetadata,
  type ReplayMetadata as ReplayMetadataType,
} from '../../OpenRA.Game/FileFormats/ReplayMetadata.js'
import type { GameInformationPlayer } from '../../OpenRA.Game/GameInformation.js'

// ---------------------------------------------------------------------------
// ReplayMetadataCommand（对应 OpenRA ReplayMetadataCommand）
// ---------------------------------------------------------------------------

/**
 * 读取回放文件并在标准输出上以 JSON 格式输出元数据。
 *
 * OpenRA 对照: sealed class ReplayMetadataCommand : IUtilityCommand
 */
export class ReplayMetadataCommand implements IUtilityCommand {
  /** 命令调用名称。
   *
   * OpenRA 对照: IUtilityCommand.Name => "--replay-metadata"
   */
  readonly name = '--replay-metadata'

  // ---------------------------------------------------------------------------
  // validateArguments（对应 OpenRA ValidateArguments）
  // ---------------------------------------------------------------------------

  /**
   * 验证命令行参数。
   *
   * OpenRA 对照: ValidateArguments(args) => args.Length >= 2
   *
   * 需要至少 1 个位置参数: 回放文件路径。
   *
   * @param args — 命令参数（不包括命令名本身）
   * @returns 提供至少 1 个参数时返回 true
   */
  validateArguments(args: string[]): boolean {
    return args.length >= 1
  }

  // ---------------------------------------------------------------------------
  // run（对应 OpenRA Run）
  // ---------------------------------------------------------------------------

  /**
   * 读取回放文件并打印元数据。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * 执行序列:
   * 1. 从文件系统读取回放文件二进制内容
   * 2. 使用 ReplayMetadata.readFromBuffer() 解析尾部元数据
   * 3. 将 GameInformation（含玩家）序列化为 JSON 格式
   * 4. 将 JSON 打印到标准输出
   *
   * @param utility — 命令上下文
   * @param args — [0] = 回放文件路径
   */
  run(utility: Utility, args: string[]): void {
    const replayFilePath = args[0]

    let replayMetadata: ReplayMetadataType | null = null

    try {
      // 尝试从文件系统读取回放文件
      const fileContent = this._readReplayFile(utility, replayFilePath)

      if (!fileContent) {
        this._emitError(
          `Failed to read replay file: ${replayFilePath}`,
        )
        return
      }

      // 从二进制缓冲区解析元数据
      replayMetadata = ReplayMetadata.readFromBuffer(fileContent)

      if (!replayMetadata) {
        this._emitError(
          `Failed to read replay metadata from: ${replayFilePath}`,
        )
        return
      }

      const gameInfo = replayMetadata.gameInfo
      replayMetadata.filePath = replayFilePath

      // 输出游戏信息（JSON 格式 —— 替代 OpenRA 的 FieldSaver MiniYAML 行输出）
      console.log(JSON.stringify({
        filePath: replayMetadata.filePath,
        game: {
          mod: gameInfo.mod,
          version: gameInfo.version,
          mapUid: gameInfo.mapUid,
          mapTitle: gameInfo.mapTitle,
          finalGameTick: gameInfo.finalGameTick,
          startTimeUtc: gameInfo.startTimeUtc.toISOString(),
          endTimeUtc: gameInfo.endTimeUtc?.toISOString() ?? null,
          duration: gameInfo.duration,
          isSinglePlayer: gameInfo.isSinglePlayer,
          humanPlayerCount: gameInfo.humanPlayers.length,
          totalPlayerCount: gameInfo.players.length,
          disabledSpawnPoints: Array.from(gameInfo.disabledSpawnPoints),
        },
        players: this._formatPlayers(gameInfo.players),
      }, null, 2))
    } catch (e) {
      this._emitError(
        `Exception: ${String(e)}`,
      )
    }
  }

  // ---------------------------------------------------------------------------
  // 私有方法
  // ---------------------------------------------------------------------------

  /**
   * 从文件系统读取回放文件内容为 ArrayBuffer。
   *
   * OpenRA 对照: new FileStream(path, FileMode.Open) + ReadInt32 / ReadBytes
   *
   * @param utility — 命令上下文
   * @param filePath — 回放文件路径
   * @returns ArrayBuffer 或 null（读取失败时）
   */
  private _readReplayFile(
    utility: Utility,
    filePath: string,
  ): ArrayBuffer | null {
    try {
      const fs = utility.modData.modFiles

      if (!fs.exists(filePath)) {
        // 后备：尝试从原生文件系统直接读取（Node.js/Bun 环境）
        return this._readFileNative(filePath)
      }

      // 检查 mock 文件系统是否提供直接二进制读取（用于测试）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockFs = fs as any
      if (typeof mockFs.tryReadFileAsBuffer === 'function') {
        const buffer = mockFs.tryReadFileAsBuffer(filePath) as ArrayBuffer | null
        if (buffer) return buffer
      }

      // 尝试通过字符串读取（用于纯文本内容的测试模拟）
      if (typeof mockFs.tryReadFileAsString === 'function') {
        const content = mockFs.tryReadFileAsString(filePath)
        if (content !== null) {
          const encoder = new TextEncoder()
          return encoder.encode(content).buffer as ArrayBuffer
        }
      }

      // 后备：尝试从原生文件系统直接读取
      return this._readFileNative(filePath)
    } catch {
      return null
    }
  }

  /**
   * 尝试使用原生文件系统（Node.js/Bun）读取文件。
   *
   * @param filePath — 文件路径
   * @returns ArrayBuffer 或 null
   */
  private _readFileNative(filePath: string): ArrayBuffer | null {
    if (typeof process !== 'undefined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('node:fs') as typeof import('node:fs')
        const buffer = fs.readFileSync(filePath)
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer
      } catch {
        // Node.js fs 不可用或读取失败
      }
    }
    return null
  }

  /**
   * 将玩家信息数组格式化为 JSON 友好的记录。
   *
   * OpenRA 对照: FieldSaver.Save(Player).ToLines(playerIndex)
   *
   * @param players — GameInformationPlayer 数组
   * @returns 序列化为 JSON 对象后的玩家信息数组
   */
  private _formatPlayers(
    players: GameInformationPlayer[],
  ): Record<string, unknown>[] {
    return players.map((player, index) => {
      const obj = player.toJSONObject()
      // 将一个数字索引键添加到玩家数据中，以匹配 OpenRA 的
      // FieldSaver.Save(p).ToLines($"{playerCount++}") 输出格式
      return {
        playerIndex: index,
        ...obj,
      }
    })
  }

  /**
   * 打印错误消息并以错误码 1 退出。
   *
   * OpenRA 对照: throw new InvalidDataException(...) → Environment.Exit(1)
   *
   * @param message — 错误消息
   */
  private _emitError(message: string): void {
    console.error(`Error: ${message}`)
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1)
    }
  }
}
