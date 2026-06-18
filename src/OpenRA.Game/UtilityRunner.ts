/**
 * UtilityRunner.ts — 命令行/控制台命令调度器
 * OpenRA 对照: OpenRA.Utility/Program.cs (472 lines)
 *
 * 核心范式转换:
 * - C# static void Main(string[]) 入口点 → UtilityRunner.run() 实例方法
 * - C# Utility.Run() 反射式命令发现 → 显式 Map<string, IUtilityCommand> 注册表
 * - C# 同步控制台输入/输出 → 异步 (await UtilityRunner.run())
 * - C# Assembly.GetTypes() + Attribute.IsDefined 扫描 → register() 显式注册
 *
 * UtilityRunner 是一个轻量级命令调度器——替代 C# 的 OpenRA.Utility.exe。
 * 命令通过 register() 显式注册到内部 Map，而非通过运行时反射发现。
 * 这样做的优势：tree-shakable、可测试、无需 C# Attribute 支持。
 */

import { Utility, type IUtilityCommand } from './IUtilityCommand.js'
import type { ModData } from './ModData.js'
import type { Manifest } from './Manifest.js'
import type { IModRegistry } from './UtilityCommands/ModRegistration.js'

// ---------------------------------------------------------------------------
// UtilityRunner — 命令调度器（对应 OpenRA Utility + Program 的结合体）
// ---------------------------------------------------------------------------

/**
 * 命令调度器，用于注册和执行 IUtilityCommand 实现。
 *
 * OpenRA 对照: OpenRA.Utility.Run() 静态方法 + OpenRA.Utility/Program.cs
 *
 * 使用方式:
 * ```
 * const runner = new UtilityRunner()
 * runner.register(new RegisterModCommand())
 * runner.register(new CheckYamlCommand())
 * await runner.run(process.argv.slice(2))
 * ```
 */
export class UtilityRunner {
  /** 已注册的命令（命令名 → 命令实例）。 */
  private _commands = new Map<string, IUtilityCommand>()

  // ---- ModData 工厂（可选，用于延迟初始化） ----

  /**
   * 可选的 ModData 工厂函数，用于在 run() 中延迟初始化 ModData。
   *
   * 如果设置，run() 会在执行命令前调用此函数来构建 ModData。
   * 如果未设置，命令必须自行提供 ModData（通过 Utility 上下文传递
   * 预先构造的 ModData）。
   *
   * OpenRA 对照: OpenRA.Utility.ModData (在 Utility 构造函数中初始化)
   */
  private _modDataFactory: ((args: string[]) => ModData | null) | null = null

  // ---- 安装的 Mod 提供者 ----

  /**
   * 可选的已安装 mod 列表提供函数。
   *
   * 如果设置，在 run() 中调用此函数以获取所有已安装 mod 的映射。
   * 这在 register-mod / unregister-mod 等命令中用于查找可用的 mod。
   */
  private _modsProvider: (() => ReadonlyMap<string, Manifest>) | null = null

  /**
   * 可选的 mod 注册表，注入到 Utility 上下文中。
   *
   * 如果设置，run() 会将此注册表附加到 Utility 实例，
   * 使 RegisterModCommand / UnregisterModCommand / ClearInvalidModRegistrationsCommand
   * 能够操作真实的 mod 注册表，而非回退到无操作实现。
   */
  private _modRegistry: IModRegistry | null = null

  // ---------------------------------------------------------------------------
  // 公共 API
  // ---------------------------------------------------------------------------

  /**
   * 注册一个命令。
   *
   * 如果命令名已被注册，则抛出错误（防止重复注册）。
   *
   * @param command — 要注册的命令实例
   * @throws 如果命令名已被注册
   */
  register(command: IUtilityCommand): void {
    if (this._commands.has(command.name)) {
      throw new Error(
        `UtilityRunner: duplicate command registration for "${command.name}"`,
      )
    }
    this._commands.set(command.name, command)
  }

  /**
   * 注销一个命令。
   *
   * @param name — 要移除的命令名
   * @returns true 表示成功移除，false 表示命令未找到
   */
  unregister(name: string): boolean {
    return this._commands.delete(name)
  }

  /**
   * 设置 ModData 工厂函数。
   *
   * 工厂函数接收命令行参数数组（run() 接收的完整 args），
   * 返回 ModData 实例或 null（表示无法构建 ModData）。
   * 通常第一个参数是要加载的 mod ID 或 manifest 路径。
   *
   * @param factory — 构建 ModData 的工厂函数
   */
  setModDataFactory(factory: (args: string[]) => ModData | null): void {
    this._modDataFactory = factory
  }

  /**
   * 设置已安装 mod 的提供函数。
   *
   * 在需要 mod 发现的操作中使用（如 register-mod 需要知道已安装的 mod）。
   *
   * @param provider — 返回已安装 mod 映射的函数
   */
  setModsProvider(provider: () => ReadonlyMap<string, Manifest>): void {
    this._modsProvider = provider
  }

  /**
   * 设置 mod 注册表。
   *
   * 注册表在执行时附加到 Utility 上下文，
   * 使 mod 管理命令能够持久化 mod 注册。
   *
   * 如果未设置，mod 命令将回退到无操作实现（记录警告但不会崩溃）。
   *
   * @param registry — IModRegistry 实现（如 NodeModRegistry）
   */
  setModRegistry(registry: IModRegistry): void {
    this._modRegistry = registry
  }

  /**
   * 获取所有已注册的命令名列表（只读）。
   *
   * @returns 命令名数组
   */
  get registeredCommands(): readonly string[] {
    return [...this._commands.keys()]
  }

  /**
   * 获取指定名称的命令实例。
   *
   * @param name — 命令名
   * @returns 命令实例，如果未注册则返回 undefined
   */
  getCommand(name: string): IUtilityCommand | undefined {
    return this._commands.get(name)
  }

  /**
   * 获取已注册命令的数量。
   */
  get commandCount(): number {
    return this._commands.size
  }

  // ---------------------------------------------------------------------------
  // 执行
  // ---------------------------------------------------------------------------

  /**
   * 解析参数并执行匹配的命令。
   *
   * OpenRA 对照: OpenRA.Utility.Run(string[] args)
   *
   * 执行流程:
   * 1. 验证参数不为空
   * 2. 提取命令名（args 中匹配已注册命令的第一个参数）
   * 3. 调用命令的 validateArguments()
   * 4. 构建 ModData（如果设置了工厂）
   * 5. 构建 Utility 上下文
   * 6. 调用命令的 run()
   *
   * @param args — 命令行参数数组（不包括可执行文件路径）
   * @returns Promise，成功时解析为 undefined，命令未找到或参数无效时抛出错误
   * @throws 如果 args 为空、命令未找到、参数无效、或工厂构建 ModData 失败
   */
  async run(args: string[]): Promise<void> {
    if (args.length === 0) {
      this._printHelp()
      return
    }

    // 在 args 中查找匹配已注册命令的标记
    const commandName = args.find((a) => this._commands.has(a))
    if (!commandName) {
      console.error(`Unknown command. First argument must be one of:`)
      for (const name of this._commands.keys()) {
        console.error(`  ${name}`)
      }
      throw new Error(`Unknown command in arguments: ${args.join(' ')}`)
    }

    const command = this._commands.get(commandName)!

    // 收集命令名之后的参数（不包括命令名之前可能存在的额外参数）
    const commandIndex = args.indexOf(commandName)
    const commandArgs = args.slice(commandIndex + 1)

    // 验证参数
    if (!command.validateArguments(commandArgs)) {
      throw new Error(
        `Invalid arguments for command "${commandName}": ${commandArgs.join(' ')}`,
      )
    }

    // 构建 ModData（如果配置了工厂）
    let modData: ModData | null = null
    if (this._modDataFactory) {
      modData = this._modDataFactory(args)
      if (!modData) {
        throw new Error(
          `Failed to initialize ModData for command "${commandName}"`,
        )
      }
      await modData.init()
    }

    // 构建 Utility 上下文
    const mods = this._modsProvider
      ? this._modsProvider()
      : new Map<string, Manifest>()

    // 如果工厂未产生 ModData，尝试从第一条非命令参数构建（如果可能）
    const utility = new Utility(
      modData ?? ({} as ModData), // 如果没有 factory，命令无法使用 modData
      mods,
    )

    // 注入 mod 注册表（使 mod 管理命令能够持久化注册）
    if (this._modRegistry) {
      (utility as Utility & { modRegistry: IModRegistry }).modRegistry = this._modRegistry
    }

    // 执行命令
    command.run(utility, commandArgs)
  }

  // ---------------------------------------------------------------------------
  // 帮助
  // ---------------------------------------------------------------------------

  /**
   * 打印所有已注册命令的帮助信息。
   *
   * 当 run() 在没有参数的情况下被调用时触发。
   */
  private _printHelp(): void {
    console.log('Usage: runner <mod> <command> [args...]')
    console.log()
    console.log('Registered commands:')
    for (const [name, command] of this._commands) {
      console.log(`  ${name}`)
      // NOTE: 当 IUtilityCommand 扩展了 description 属性后，
      // 可以在此处打印描述文本。
      void command // 保留 command 引用以供将来扩展
    }
    console.log()
    console.log(
      'Run with a command name to see command-specific help (where available).',
    )
  }
}
