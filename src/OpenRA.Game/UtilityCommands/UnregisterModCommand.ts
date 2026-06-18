/**
 * UnregisterModCommand.ts — 从 mod 切换器中移除 mod 注册的命令
 * OpenRA 对照: OpenRA.Game/UtilityCommands/UnregisterModCommand.cs (43 lines)
 *
 * 核心范式转换:
 * - C# ModRegistration enum → ModRegistration User/System 常量
 * - C# new ExternalMods().Unregister() → 通过 Utility.modRegistry 接口调用
 * - C# DescAttribute → JSDoc 描述
 *
 * 此命令根据 manifest 从用户/系统 mod 注册表中删除 mod 的元数据。
 * 注意: 仅删除注册表条目，不删除 mod 文件本身。
 */

import { Utility, type IUtilityCommand } from '../IUtilityCommand.js'
import type { IModRegistry } from './ModRegistration.js'
import { parseModRegistrationArg } from '../../OpenRA.Mods.Common/UtilityCommands/UtilityHelpers.js'

// ---------------------------------------------------------------------------
// UnregisterModCommand
// ---------------------------------------------------------------------------

export class UnregisterModCommand implements IUtilityCommand {
  /** 命令调用名。OpenRA 对照: IUtilityCommand.Name => "--unregister-mod" */
  readonly name = '--unregister-mod'

  /** 命令描述。OpenRA 对照: DescAttribute
   *
   * (system|user|both)
   * Removes the mod metadata entry for the in-game mod switcher.
   */
  readonly description =
    '(system|user|both) — Removes the mod metadata entry for the in-game mod switcher.'

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
   * 执行 mod 注销。
   *
   * 从用户/系统注册表中删除 mod 的元数据文件。
   * 不会以任何方式修改 mod 文件本身。
   *
   * @param utility — 命令上下文（须提供 .modRegistry）
   * @param args — [0]: "system"|"user"|"both"
   */
  run(utility: Utility, args: string[]): void {
    const registrationType = parseModRegistrationArg(args[0])

    const manifest = utility.modData.manifest

    const registry: IModRegistry = (utility as Utility & { modRegistry?: IModRegistry }).modRegistry
      ?? createNoopModRegistry()

    registry.unregister(manifest, registrationType)
  }
}

// ---------------------------------------------------------------------------
// createNoopModRegistry — 回退空操作实现
// ---------------------------------------------------------------------------

/** 当未注入真实注册表时的无操作回退。 */
function createNoopModRegistry(): IModRegistry {
  return {
    register(): void {
      console.warn('ModRegistry not initialized. Mod registration is a no-op.')
    },
    unregister(): void {
      console.warn('ModRegistry not initialized. Mod unregistration is a no-op.')
    },
    clearInvalidRegistrations(): number {
      console.warn('ModRegistry not initialized. ClearInvalidRegistrations is a no-op.')
      return 0
    },
  }
}
