/**
 * RegisterModCommand.ts — 在 mod 切换器中注册 mod 的命令
 * OpenRA 对照: OpenRA.Game/UtilityCommands/RegisterModCommand.cs (47 lines)
 *
 * 核心范式转换:
 * - C# ModRegistration enum → ModRegistration User/System 常量
 * - C# new ExternalMods().Register() → 通过 Utility.modRegistry 接口调用
 * - C# DescAttribute → JSDoc 描述
 * - C# 显式接口实现 (IUtilityCommand.Name) → TypeScript 类属性
 *
 * 此命令将 mod 的元数据持久化到用户/系统 mod 注册表中，
 * 使其在 mod 切换器 UI 中可见。
 */

import { Utility, type IUtilityCommand } from '../IUtilityCommand.js'
import type { IModRegistry } from './ModRegistration.js'
import { parseModRegistrationArg } from '../../OpenRA.Mods.Common/UtilityCommands/UtilityHelpers.js'

// ---------------------------------------------------------------------------
// RegisterModCommand
// ---------------------------------------------------------------------------

export class RegisterModCommand implements IUtilityCommand {
  /** 命令调用名。OpenRA 对照: IUtilityCommand.Name => "--register-mod" */
  readonly name = '--register-mod'

  /** 命令描述。OpenRA 对照: DescAttribute
   *
   * LAUNCHPATH (system|user|both)
   * 在启动器中注册 mod 元数据条目。
   */
  readonly description =
    'LAUNCHPATH (system|user|both) — Generates a mod metadata entry for the in-game mod switcher.'

  // ---------------------------------------------------------------------------
  // IUtilityCommand 实现
  // ---------------------------------------------------------------------------

  /**
   * 验证参数: 需要 launchPath + registration 类型 (2 个参数)。
   *
   * OpenRA 对照: args.Length >= 3 && new string[] { "system", "user", "both" }.Contains(args[2])
   *   (C# 中 args[0] 是命令名本身；TypeScript 中 args 不包含命令名)
   *
   * @param args — 命令名之后的参数 [0]: launchPath, [1]: "system"|"user"|"both"
   * @returns args.length >= 2 && args[1] 有效
   */
  validateArguments(args: string[]): boolean {
    if (args.length < 2) return false
    return ['system', 'user', 'both'].includes(args[1])
  }

  /**
   * 执行 mod 注册。
   *
   * @param utility — 命令上下文（须提供 .modRegistry）
   * @param args — [0]: launchPath, [1]: "system"|"user"|"both"
   */
  run(utility: Utility, args: string[]): void {
    const launchPath = args[0]
    const registrationType = parseModRegistrationArg(args[1])

    const manifest = utility.modData.manifest

    // 使用 utility 上的 modRegistry（如果可用）
    // NOTE: 在完整实现中，modRegistry 由 UtilityRunner 在构建 Utility 上下文时注入。
    // 如果 modRegistry 不可用，则回退到一个空实现（不破坏其他命令）。
    const registry: IModRegistry = (utility as Utility & { modRegistry?: IModRegistry }).modRegistry
      ?? createDefaultModRegistry()

    registry.register(manifest, launchPath, [], registrationType)
  }
}

// ---------------------------------------------------------------------------
// createDefaultModRegistry — 回退（无操作）实现
// ---------------------------------------------------------------------------

/**
 * 当未将真实注册表注入 Utility 上下文时，创建一个无操作 IModRegistry。
 *
 * 这确保命令即使在没有设置完整注册表基础设施的开发/测试中也
 * 能正常失败，而非因缺少属性而崩溃。
 *
 * NOTE: 生产环境必须由 UtilityRunner 或在调用方注入真实的注册表。
 */
function createDefaultModRegistry(): IModRegistry {
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
