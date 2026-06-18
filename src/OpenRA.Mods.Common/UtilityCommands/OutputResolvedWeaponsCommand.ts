/**
 * OutputResolvedWeaponsCommand.ts — 输出完全解析的武器定义
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/OutputResolvedWeaponsCommand.cs (55 lines)
 *
 * 核心范式转换:
 * - C# MiniYaml.Nodes.WriteToString() → TypeScript JSON.stringify (MiniYAML 管道已预编译为 JSON)
 * - C# Game.ModData 单例 → 通过 utility.modData 显式传递
 * - C# UtilityHelpers.GetTopLevelNodeByKey → 已迁移的 TS 版本
 * - C# Environment.Exit(1) → 抛出 Error (CLI runner 捕获并设置进程退出码)
 *
 * 此命令输出给定武器的已解析武器 YAML。
 * 输入值区分大小写。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import { getTopLevelNodeByKey } from './UtilityHelpers.js'

// ---------------------------------------------------------------------------
// OutputResolvedWeaponsCommand
// ---------------------------------------------------------------------------

/**
 * 输出完全解析的武器定义。
 *
 * 用法: --resolved-weapons WEAPON [PATH/TO/MAP]
 *
 * 显示给定武器的最终合并后的 MiniYaml 树。
 * 可选的地图路径指定从中使用内联武器定义的地图。
 *
 * OpenRA 对照: public class OutputResolvedWeaponsCommand : IUtilityCommand
 */
export class OutputResolvedWeaponsCommand implements IUtilityCommand {
  readonly name = '--resolved-weapons'

  validateArguments(args: string[]): boolean {
    return args.length === 2 || args.length === 3
  }

  /**
   * 执行已解析武器输出。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param utility — 命令执行上下文
   * @param args — 参数数组 [commandName, key, mapPath?]
   */
  run(utility: Utility, args: string[]): void {
    const key = args[1]
    const modData = utility.modData

    // TODO-21.F.5: 集成武器数据加载以实现完整的 MiniYAML 输出。
    const cachedWeapons = (modData as unknown as Record<string, unknown>)._cachedWeapons as
      | Record<string, unknown>
      | undefined

    if (cachedWeapons && key in cachedWeapons) {
      const weaponDef = cachedWeapons[key]
      if (weaponDef !== undefined) {
        console.log(JSON.stringify(weaponDef, null, 2))
        return
      }
    }

    // 后备: 尝试通过缓存数据中的 weapon infos 获取
    const cachedInfos = (modData as unknown as Record<string, unknown>)._cachedWeaponInfos as
      | Record<string, unknown>
      | undefined
    if (cachedInfos && key in cachedInfos) {
      console.log(JSON.stringify(cachedInfos[key], null, 2))
      return
    }

    const weaponFiles: readonly string[] = modData.manifest.weapons
    console.error(
      `Could not find weapon '${key}' (name is case-sensitive). ` +
        `Weapon files: ${weaponFiles.join(', ')}`,
    )

    throw new Error(`Weapon '${key}' not found`)
  }

  /**
   * 根据预解析数据解析已解析武器。
   *
   * @param key — 要查找的武器名
   * @param parsedWeapons — 预解析的武器定义（武器名 → 定义对象）
   * @param mapWeapons — 可选的地图内联武器定义
   * @param log — 用于输出的日志回调（默认 console.log）
   * @returns 找到武器定义则返回 true，否则返回 false
   */
  resolveWeapons(
    key: string,
    parsedWeapons: Record<string, unknown>,
    mapWeapons: Record<string, unknown> | null,
    log: (message: string) => void = console.log,
  ): boolean {
    const result = getTopLevelNodeByKey(
      Object.keys(parsedWeapons),
      key,
      (_file: string) => parsedWeapons,
      mapWeapons,
    )

    if (result === undefined) {
      console.error(`Could not find weapon '${key}' (name is case-sensitive).`)
      return false
    }

    log(JSON.stringify(result, null, 2))
    return true
  }
}
