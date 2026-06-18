/**
 * OutputResolvedRulesCommand.ts — 输出完全解析的 actor 规则定义
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/OutputResolvedRulesCommand.cs (55 lines)
 *
 * 核心范式转换:
 * - C# MiniYaml.Nodes.WriteToString() → TypeScript JSON.stringify (MiniYAML 管道已预编译为 JSON)
 * - C# Game.ModData 单例 → 通过 utility.modData 显式传递
 * - C# UtilityHelpers.GetTopLevelNodeByKey → 已迁移的 TS 版本
 * - C# Environment.Exit(1) → 抛出 Error (CLI runner 捕获并设置进程退出码)
 *
 * 此命令输出给定 actor 的已解析规则 YAML。
 * 输入值区分大小写。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import { getTopLevelNodeByKey } from './UtilityHelpers.js'

// ---------------------------------------------------------------------------
// OutputResolvedRulesCommand
// ---------------------------------------------------------------------------

/**
 * 输出完全解析的 actor 规则定义。
 *
 * 用法: --resolved-rules ACTOR [PATH/TO/MAP]
 *
 * 显示给定 actor 的最终合并后的 MiniYaml 规则。
 * 可选的地图路径指定从中使用内联规则的地图。
 *
 * OpenRA 对照: public class OutputResolvedRulesCommand : IUtilityCommand
 */
export class OutputResolvedRulesCommand implements IUtilityCommand {
  readonly name = '--resolved-rules'

  validateArguments(args: string[]): boolean {
    return args.length === 2 || args.length === 3
  }

  /**
   * 执行已解析规则输出。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param utility — 命令执行上下文
   * @param args — 参数数组 [commandName, key, mapPath?]
   */
  run(utility: Utility, args: string[]): void {
    const key = args[1]
    // const mapPath = args.length === 3 ? args[2] : null // 用于可选的 map 内联规则

    const modData = utility.modData

    // NOTE: 在完整的 CLI 环境中，ModData.loadRuleSet() 会异步加载 Ruleset。
    // 由于 IUtilityCommand.run() 是同步的，我们延迟到外部调用方注入已解析的数据。
    // TODO-21.F.3: 集成 FileSystem 读取 + Ruleset 加载以完成完整的命令行流程。

    // 尝试从已缓存的数据中获取（如果调用方已注入）
    const cachedRules = (
      modData as unknown as Record<string, unknown>
    )._cachedRuleset as
      | { actors?: ReadonlyMap<string, unknown> }
      | undefined
    if (cachedRules?.actors) {
      const actorDef = cachedRules.actors.get(key)
      if (actorDef) {
        console.log(JSON.stringify(actorDef, null, 2))
        return
      }
    }

    // 后备: 请求从 manifest 中获取 actor 规则
    console.error(
      `Could not find actor '${key}' (name is case-sensitive). ` +
        `Rule files: ${modData.manifest.rules.join(', ')}`,
    )

    // NOTE: 在 CLI runner 中，此错误应设置进程退出码为 1。
    throw new Error(`Actor '${key}' not found`)
  }

  /**
   * 根据文件系统和 manifest 解析已解析规则。
   *
   * 与直接调用 run() 不同，此方法接受预解析的数据字典，
   * 适用于文件 I/O 由外部处理的测试或环境。
   *
   * @param key — 要查找的 actor 键
   * @param parsedRules — 预解析的规则定义（actor 名 → 定义对象）
   * @param mapRules — 可选的地图内联规则
   * @param log — 用于输出的日志回调（默认 console.log）
   * @returns 找到 actor 定义则返回 true，否则返回 false
   */
  resolveRules(
    key: string,
    parsedRules: Record<string, unknown>,
    mapRules: Record<string, unknown> | null,
    log: (message: string) => void = console.log,
  ): boolean {
    const result = getTopLevelNodeByKey(
      Object.keys(parsedRules),
      key,
      (_file: string) => parsedRules,
      mapRules,
    )

    if (result === undefined) {
      console.error(`Could not find actor '${key}' (name is case-sensitive).`)
      return false
    }

    log(JSON.stringify(result, null, 2))
    return true
  }
}
