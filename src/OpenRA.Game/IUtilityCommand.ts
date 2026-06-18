/**
 * IUtilityCommand.ts — 命令行/控制台命令接口
 * OpenRA 对照: OpenRA.Game/IUtilityCommand.cs
 *
 * 核心范式转换:
 * - C# [RequireExplicitImplementation] 属性标记 → JSDoc 文档约定（命令必须显式注册）
 * - C# Utility 反射（FieldInfo / MemberInfo / Attribute） → TypeScript 静态注册表（无需反射）
 * - C# ConcurrentCache<Type, FieldInfo[]> → TypeScript 不需要等效结构（没有运行时反射需求）
 * - C# IUtilityCommand 运行时发现 → 显式 Map<string, IUtilityCommand> 注册表
 *
 * IUtilityCommand 是所有 CLI 构建工具和游戏内控制台命令的公共接口。
 * 在 TypeScript 中，命令通过显式注册表（Map<string, IUtilityCommand>）发现，
 * 而非 C# 的运行时 Assembly 扫描 + Attribute.IsDefined 反射。
 */

import type { ModData } from './ModData.js'
import type { Manifest } from './Manifest.js'

// ---------------------------------------------------------------------------
// Utility — 命令调度上下文（对应 OpenRA Utility）
// ---------------------------------------------------------------------------

/**
 * 命令执行上下文，提供 ModData 和已安装 mod 列表的访问。
 *
 * OpenRA 对照: OpenRA.Utility
 *
 * 在 C# 中，Utility 是一个带有反射辅助方法的命令行调度器。
 * 在 TypeScript 中，Utility 简化为一个轻量级上下文对象，只携带
 * ModData 和 InstalledMods（用 Map<string, Manifest> 表示）。
 *
 * NOTE: C# Utility 的 GetFields() / HasAttribute() / GetCustomAttributes()
 * 反射方法在 TypeScript 中不需要 —— 没有 C# Attribute 装饰器等效项。
 * 命令通过显式的 Map<string, IUtilityCommand> 注册表发现。
 */
export class Utility {
  /** 当前 mod 的 ModData。OpenRA 对照: Utility.ModData */
  readonly modData: ModData

  /**
   * 所有已安装 mod 的映射（ID → Manifest）。
   * OpenRA 对照: Utility.Mods (InstalledMods, 实现了 IReadOnlyDictionary<string, Manifest>)
   */
  readonly mods: ReadonlyMap<string, Manifest>

  /**
   * 创建 Utility 上下文。
   *
   * OpenRA 对照: Utility(ModData modData, InstalledMods mods)
   *
   * @param modData — 当前 mod 的 ModData 实例
   * @param mods — 已安装 mod 映射（ID → Manifest）
   */
  constructor(modData: ModData, mods: ReadonlyMap<string, Manifest>) {
    this.modData = modData
    this.mods = mods
  }
}

// ---------------------------------------------------------------------------
// IUtilityCommand — 命令接口（对应 OpenRA IUtilityCommand）
// ---------------------------------------------------------------------------

/**
 * 命令行/控制台命令接口。
 *
 * OpenRA 对照: OpenRA.IUtilityCommand
 *
 * 所有 CLI 构建工具和游戏内控制台命令都实现此接口。
 * 在 C# 中，此接口标记了 [RequireExplicitImplementation]，
 * 要求每个实现类在注册时显式声明接口。在 TypeScript 中，
 * 所有命令通过显式的 Map<string, IUtilityCommand> 注册表进行管理。
 *
 * 使用模式：
 * ```
 * const registry = new Map<string, IUtilityCommand>()
 * registry.set("my-command", new MyCommand())
 * ```
 */
export interface IUtilityCommand {
  /**
   * 用于调用此命令的字符串。
   *
   * OpenRA 对照: IUtilityCommand.Name
   */
  readonly name: string

  /**
   * 验证参数语法。
   *
   * OpenRA 对照: IUtilityCommand.ValidateArguments(string[])
   *
   * @param args — 传递给命令的参数数组（命令名之后的 argv）
   * @returns true 表示参数有效，false 表示参数无效
   */
  validateArguments(args: string[]): boolean

  /**
   * 执行命令。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param utility — 命令执行上下文（提供 ModData 和 InstalledMods 访问）
   * @param args — 传递给命令的参数数组（命令名之后的 argv）
   */
  run(utility: Utility, args: string[]): void
}
