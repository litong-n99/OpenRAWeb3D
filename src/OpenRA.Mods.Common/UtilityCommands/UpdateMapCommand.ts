/**
 * UpdateMapCommand.ts — 将旧格式地图更新到最新引擎版本
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/UpdateMapCommand.cs (162 lines)
 *
 * 核心范式转换:
 * - C# UpdateRule / UpdatePath / UpdateUtils → 存根（更新规则延迟迁移）
 * - C# System.Reflection 扫描 UpdateRule 类型 → 显式注册
 * - C# Console.ForegroundColor → ANSI 颜色转义序列 (或简单控制台输出)
 *
 * NOTE: 更新规则系统 (OpenRA.Mods.Common.UpdateRules) 已在整个迁移计划中
 * 被标记为延迟项。此命令当前仅提供帮助文本和参数验证存根。
 * 完整的更新逻辑将在 TODO-21.E.8 的实施工作中添加。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'

// ---------------------------------------------------------------------------
// UpdateMapCommand
// ---------------------------------------------------------------------------

/**
 * 地图更新命令 — 将地图更新到最新的引擎版本。
 *
 * 用法: --update-map MAP SOURCE [--detailed] [--apply]
 *
 * SOURCE 可以是一个已知的更新路径标签或单个更新规则名称。
 *
 * OpenRA 对照: UpdateMapCommand (sealed class)
 */
export class UpdateMapCommand implements IUtilityCommand {
  readonly name = '--update-map'

  validateArguments(args: string[]): boolean {
    return args.length >= 2
  }

  run(_utility: Utility, args: string[]): void {
    // TODO-21.E.8: Implement UpdateMapCommand fully when UpdateRules system is migrated.
    // The UpdateRules module (OpenRA.Mods.Common.UpdateRules) is deferred in the
    // migration plan because it involves C#-specific YAML-to-YAML migration rules
    // for upgrading old mod files. In TypeScript, mod updates will use JSON schema
    // migration instead.
    //
    // Currently prints help text listing known update paths and rules.

    console.log('--update-map MAP SOURCE [--detailed] [--apply]')

    if (args.length > 2) {
      console.log(`Unknown source: ${args[2]}`)
    }

    console.log('NOTE: Update rules system has not yet been migrated.')
    console.log('Map format updates are not currently supported.')
    console.log('See TODO-21.E.8 in the Chapter 21 migration plan.')
  }
}
