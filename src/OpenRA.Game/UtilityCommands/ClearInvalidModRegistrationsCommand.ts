/**
 * ClearInvalidModRegistrationsCommand.ts — 清理无效 mod 注册条目的命令
 * OpenRA 对照: OpenRA.Game/UtilityCommands/ClearInvalidModRegistrationsCommand.cs (47 lines)
 *
 * 核心范式转换:
 * - C# ModRegistration enum → ModRegistration User/System 常量
 * - C# new ExternalMods().ClearInvalidRegistrations() → 通过 Utility.modRegistry 接口调用
 * - C# DescAttribute → JSDoc 描述
 *
 * 此命令扫描 mod 注册表并移除满足以下条件的条目:
 * - 启动路径（LaunchPath）不再指向有效目录
 * - 元数据文件已损坏或名称不匹配
 * - 重复/冲突的条目
 */

import { Utility, type IUtilityCommand } from '../IUtilityCommand.js'
import type { IModRegistry } from './ModRegistration.js'
import { parseModRegistrationArg } from '../../OpenRA.Mods.Common/UtilityCommands/UtilityHelpers.js'

// ---------------------------------------------------------------------------
// ClearInvalidModRegistrationsCommand
// ---------------------------------------------------------------------------

export class ClearInvalidModRegistrationsCommand implements IUtilityCommand {
  /** 命令调用名。OpenRA 对照: IUtilityCommand.Name => "--clear-invalid-mod-registrations" */
  readonly name = '--clear-invalid-mod-registrations'

  /** 命令描述。OpenRA 对照: DescAttribute
   *
   * (system|user|both)
   * Removes invalid metadata entries for the in-game mod switcher.
   */
  readonly description =
    '(system|user|both) — Removes invalid metadata entries for the in-game mod switcher.'

  // ---------------------------------------------------------------------------
  // IUtilityCommand 实现
  // ---------------------------------------------------------------------------

  /**
   * 验证参数: 需要正好 1 个参数（注册类型）。
   *
   * @param args — [0]: 注册类型
   * @returns args.length >= 1 && args[0] 有效
   */
  validateArguments(args: string[]): boolean {
    if (args.length < 1) return false
    return ['system', 'user', 'both'].includes(args[0])
  }

  /**
   * 执行无效注册清理。
   *
   * 扫描指定注册目标中的 ModMetadata 目录，
   * 删除所有不再有效的注册条目。
   *
   * @param utility — 命令上下文（须提供 .modRegistry）
   * @param args — [0]: "system"|"user"|"both"
   */
  run(utility: Utility, args: string[]): void {
    const registrationType = parseModRegistrationArg(args[0])

    const registry: IModRegistry = (utility as Utility & { modRegistry?: IModRegistry }).modRegistry
      ?? createNoopModRegistry()

    const removedCount = registry.clearInvalidRegistrations(registrationType)

    console.log(`Cleared ${removedCount} invalid mod registration(s).`)
  }
}

// ---------------------------------------------------------------------------
// createNoopModRegistry — 回退空操作实现
// ---------------------------------------------------------------------------

/** 当未注入真实注册表时的无操作回退。 */
function createNoopModRegistry(): IModRegistry {
  return {
    register(): void {
      console.warn('ModRegistry not initialized. Register is a no-op.')
    },
    unregister(): void {
      console.warn('ModRegistry not initialized. Unregister is a no-op.')
    },
    clearInvalidRegistrations(): number {
      console.warn('ModRegistry not initialized. ClearInvalidRegistrations is a no-op.')
      return 0
    },
  }
}
