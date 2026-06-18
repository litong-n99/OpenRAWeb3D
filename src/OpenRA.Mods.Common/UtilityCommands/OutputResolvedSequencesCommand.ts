/**
 * OutputResolvedSequencesCommand.ts — 输出完全解析的精灵序列定义
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/OutputResolvedSequencesCommand.cs (55 lines)
 *
 * 核心范式转换:
 * - C# MiniYaml.Nodes.WriteToString() → TypeScript JSON.stringify (MiniYAML 管道已预编译为 JSON)
 * - C# Game.ModData 单例 → 通过 utility.modData 显式传递
 * - C# UtilityHelpers.GetTopLevelNodeByKey → 已迁移的 TS 版本
 * - C# Environment.Exit(1) → 抛出 Error (CLI runner 捕获并设置进程退出码)
 *
 * 此命令输出给定图像的已解析序列 YAML 树。
 * 输入值区分大小写。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import { getTopLevelNodeByKey } from './UtilityHelpers.js'

// ---------------------------------------------------------------------------
// OutputResolvedSequencesCommand
// ---------------------------------------------------------------------------

/**
 * 输出完全解析的精灵序列定义。
 *
 * 用法: --resolved-sequences IMAGE-NAME [PATH/TO/MAP]
 *
 * 显示给定图像的最终合并后的 MiniYaml 序列树。
 * 可选的地图路径指定从中使用内联序列的地图。
 *
 * OpenRA 对照: public class OutputResolvedSequencesCommand : IUtilityCommand
 */
export class OutputResolvedSequencesCommand implements IUtilityCommand {
  readonly name = '--resolved-sequences'

  validateArguments(args: string[]): boolean {
    return args.length === 2 || args.length === 3
  }

  /**
   * 执行已解析序列输出。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param utility — 命令执行上下文
   * @param args — 参数数组 [commandName, key, mapPath?]
   */
  run(utility: Utility, args: string[]): void {
    const key = args[1]
    const modData = utility.modData

    // 集成序列数据加载以实现完整的迷你 YAML 输出。
    // 在 OpenRA 中，序列从单独的 MiniYaml 文件加载，
    // 由 manifest.Sequences 列出，与 Rules 类似。
    //
    // 目前，序列从预缓存的数据中获取（如果调用方已注入）。
    const cachedSeqs = (modData as unknown as Record<string, unknown>)._cachedSequences as
      | Record<string, unknown>
      | undefined

    if (cachedSeqs && key in cachedSeqs) {
      const seqDef = cachedSeqs[key]
      if (seqDef !== undefined) {
        console.log(JSON.stringify(seqDef, null, 2))
        return
      }
    }

    // 后备: 检查 manifest 的序列文件引用
    const seqFiles: readonly string[] = modData.manifest.sequences
    console.error(
      `Could not find image '${key}' (name is case-sensitive). ` +
        `Sequence files: ${seqFiles.join(', ')}`,
    )

    throw new Error(`Image '${key}' not found in sequences`)
  }

  /**
   * 根据预解析数据解析已解析序列。
   *
   * @param key — 要查找的图像名
   * @param parsedSequences — 预解析的序列定义（图像名 → 定义对象）
   * @param mapSequences — 可选的地图内联序列
   * @param log — 用于输出的日志回调（默认 console.log）
   * @returns 找到序列定义则返回 true，否则返回 false
   */
  resolveSequences(
    key: string,
    parsedSequences: Record<string, unknown>,
    mapSequences: Record<string, unknown> | null,
    log: (message: string) => void = console.log,
  ): boolean {
    const result = getTopLevelNodeByKey(
      Object.keys(parsedSequences),
      key,
      (_file: string) => parsedSequences,
      mapSequences,
    )

    if (result === undefined) {
      console.error(`Could not find image '${key}' (name is case-sensitive).`)
      return false
    }

    log(JSON.stringify(result, null, 2))
    return true
  }
}
