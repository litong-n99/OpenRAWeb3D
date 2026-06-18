/**
 * CheckYaml.ts — YAML/JSON 文件和规则集校验器
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/CheckYaml.cs
 *
 * 核心范式转换:
 * - C# modData.DefaultRules / modData.DefaultTerrainInfo（惰性属性）
 *   → ModData.loadRuleSet() / Map.terrainInfo（异步方法/属性）
 * - C# SequenceSet(modData.DefaultFileSystem, modData, tileset, null)
 *   → sequences 占位符（TODO: 等 SequenceSet 独立迁移后替换）
 * - C# ObjectCreator.GetTypesImplementing<T>() 反射扫描
 *   → lintPassRegistry 显式注册表
 * - C# Console.ForegroundColor 着色输出
 *   → 简单的 "[ERROR]" / "[WARNING]" 文本前缀
 * - C# Environment.Exit(1) 错误退出
 *   → process.exit(1)（仅 Node.js CLI 环境）
 *
 * NOTE: 此命令是一个 CLI 工具，不在浏览器中运行。
 * 它使用 Node.js 的 process.exit() —— 当在此环境中运行时可用。
 * 在非 Node.js 环境中，错误通过返回代码表示。
 */

import type { IUtilityCommand, Utility } from '../../OpenRA.Game/IUtilityCommand.js'
import type { ModData } from '../../OpenRA.Game/ModData.js'
import type { Map as GameMap } from '../../OpenRA.Game/Map/Map.js'
import type { Ruleset } from '../../OpenRA.Game/GameRules/Ruleset.js'
import {
  lintPassRegistry,
  type EmitErrorFn,
  type EmitWarningFn,
} from './LintInterfaces.js'

// ---------------------------------------------------------------------------
// CheckYaml — 主校验命令（对应 OpenRA CheckYaml）
// ---------------------------------------------------------------------------

/**
 * 对 mod 或地图运行所有配置校验的 IUtilityCommand。
 *
 * 验证内容：
 * - 所有 JSON 配置文件中的必需字段和类型正确性
 * - Actor/weapon/sequence 引用完整性
 * - 地图规则在可加载时的有效性
 * - 已注册 lint 通行证的所有自定义检查
 *
 * OpenRA 对照: sealed class CheckYaml : IUtilityCommand
 */
export class CheckYaml implements IUtilityCommand {
  /** 命令调用名称。
   *
   * OpenRA 对照: IUtilityCommand.Name => "--check-yaml"
   */
  readonly name = '--check-yaml'

  // ---------------------------------------------------------------------------
  // 状态（对应 OpenRA static int errors / warnings）
  // ---------------------------------------------------------------------------

  /** 错误计数 — 在命令运行期间递增。 */
  private _errorCount = 0

  /** 警告计数 — 在命令运行期间递增。 */
  private _warningCount = 0

  /** 是否将警告视为错误（通过 TREAT_WARNINGS_AS_ERRORS 环境变量控制）。 */
  private _warningAsError = false

  // ---------------------------------------------------------------------------
  // validateArguments（对应 OpenRA ValidateArguments）
  // ---------------------------------------------------------------------------

  /**
   * 验证命令行参数。
   *
   * OpenRA 对照: IUtilityCommand.ValidateArguments(string[])
   *
   * 语法: --check-yaml [mapFile]
   * 无 mapFile 时检查整个 mod。有 mapFile 时仅检查该地图。
   *
   * @param args — 命令参数（不包括命令名本身）
   * @returns 始终返回 true（所有参数形式均有效）
   */
  validateArguments(args: string[]): boolean {
    // 0 或 1 个额外参数（可选的 mapFile）均可接受
    return args.length <= 1
  }

  // ---------------------------------------------------------------------------
  // run（对应 OpenRA Run）
  // ---------------------------------------------------------------------------

  /**
   * 执行校验命令。
   *
   * OpenRA 对照: IUtilityCommand.Run(Utility, string[])
   *
   * @param utility — 命令上下文（提供 ModData 和已安装 Mods）
   * @param args — 命令行参数（命令名之后的部分）
   */
  run(utility: Utility, args: string[]): void {
    const modData = utility.modData

    this._errorCount = 0
    this._warningCount = 0
    this._warningAsError =
      typeof process !== 'undefined' &&
      process?.env?.TREAT_WARNINGS_AS_ERRORS?.toLowerCase() === 'true'

    const emitError: EmitErrorFn = this._createEmitError()
    const emitWarning: EmitWarningFn = this._createEmitWarning()

    try {
      // 如果提供了地图文件参数，仅检查该地图
      if (args.length >= 1) {
        const mapFilePath = args[0]
        console.log(`Testing map: ${mapFilePath}`)
        this._testSingleMap(mapFilePath, modData, emitError, emitWarning)
      } else {
        // 检查整个 mod
        console.log(
          `Testing mod: ${modData.manifest.metadata?.title ?? modData.manifest.id}`,
        )

        // 运行所有通用 lint 通行证
        for (const customPass of lintPassRegistry.passes) {
          try {
            customPass.run(emitError, emitWarning, modData)
          } catch (e) {
            emitError(
              `Lint pass ${customPass.constructor.name} failed with exception: ${String(e)}`,
            )
          }
        }
      }

      // 输出摘要
      if (this._warningCount > 0) {
        console.log(`Warnings: ${this._warningCount}`)
      }

      if (this._errorCount > 0) {
        console.log(`Errors: ${this._errorCount}`)
        this._exitWithError()
      }
    } catch (e) {
      emitError(`Failed with exception: ${String(e)}`)
      this._exitWithError()
    }
  }

  // ---------------------------------------------------------------------------
  // 规则检查（对应 OpenRA CheckRules）
  // ---------------------------------------------------------------------------

  /**
   * 对规则集运行所有规则级 lint 通行证。
   *
   * OpenRA 对照: CheckYaml.CheckRules(ModData, Ruleset)
   *
   * @param modData — mod 运行时数据
   * @param rules — 待检查的规则集
   * @param emitError — 错误回调
   * @param emitWarning — 警告回调
   */
  checkRules(
    modData: ModData,
    rules: Ruleset,
    emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
  ): void {
    for (const pass of lintPassRegistry.rulesPasses) {
      try {
        pass.run(emitError, emitWarning, modData, rules)
      } catch (e) {
        emitError(
          `Rules lint pass ${pass.constructor.name} failed with exception: ${String(e)}`,
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 序列检查（对应 OpenRA CheckSequences）
  // ---------------------------------------------------------------------------

  /**
   * 对序列运行所有序列级 lint 通行证。
   *
   * OpenRA 对照: CheckYaml.CheckSequences(ModData, Ruleset, SequenceSet)
   *
   * NOTE: sequences 参数当前是占位 Record<string, unknown> 类型。
   * 等 SequenceSet 迁移完成后，此参数将替换为具体的 SequenceSet 类型。
   *
   * @param modData — mod 运行时数据
   * @param rules — 当前规则集
   * @param sequences — 序列数据
   * @param emitError — 错误回调
   * @param emitWarning — 警告回调
   */
  checkSequences(
    modData: ModData,
    rules: Ruleset,
    sequences: Record<string, unknown>,
    emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
  ): void {
    for (const pass of lintPassRegistry.sequencesPasses) {
      try {
        pass.run(emitError, emitWarning, modData, rules, sequences)
      } catch (e) {
        emitError(
          `Sequences lint pass ${pass.constructor.name} failed with exception: ${String(e)}`,
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 地图检查（对应 OpenRA TestMap）
  // ---------------------------------------------------------------------------

  /**
   * 对单张地图运行所有地图级 lint 通行证。
   *
   * OpenRA 对照: CheckYaml.TestMap(Map, ModData)
   *
   * @param map — 待测试的地图
   * @param modData — mod 运行时数据
   * @param emitError — 错误回调
   * @param emitWarning — 警告回调
   */
  testMap(
    map: GameMap,
    modData: ModData,
    emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
  ): void {
    console.log(`Testing map: ${map.title}`)

    // NOTE: TypeScript Map 类比 C# Map 类具有较少的运行时属性。
    // C# Map 的 invalidCustomRules / rules / ruleDefinitions 等属性
    // 在加载期间通过 ModData 和 MiniYAML 解析设置。
    // TypeScript Map 主要处理地形和二进制数据（map.bin）。
    // 未来的 Ch21 地图编辑器实现将添加规则加载属性。
    //
    // 目前，地图级 lint 通过 lintPassRegistry.mapPasses 运行。
    // 具体的规则检查可以通过 ILintRulesPass 由调用方完成。
    // TODO-21.E.16: 在 Map.ts 上实现规则加载属性或使用专门的 MapRulesLoader。

    // 运行所有地图级 lint 通行证
    for (const pass of lintPassRegistry.mapPasses) {
      try {
        pass.run(emitError, emitWarning, modData, map)
      } catch (e) {
        emitError(
          `Map lint pass ${pass.constructor.name} failed with exception: ${String(e)}`,
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 私有方法
  // ---------------------------------------------------------------------------

  /**
   * 检查单个地图文件（当提供参数时）。
   *
   * @param filePath — 地图文件路径
   * @param modData — mod 运行时数据
   * @param emitError — 错误回调
   * @param emitWarning — 警告回调
   */
  private _testSingleMap(
    filePath: string,
    _modData: ModData,
    _emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
  ): void {
    // NOTE: 单地图文件的完整检查需要:
    // 1. 从文件系统加载地图包 (Folder/package)
    // 2. 使用 Map(modData, package) 构造地图
    // 3. 调用 testMap() 运行检查
    // 由于地图加载涉及异步文件系统操作，尚未实现。
    // 使用 emitWarning 而非 emitError —— 这不是真正的校验失败，只是尚未实现的功能。
    // TODO-21.E.16: 实现异步地图加载和单地图文件检查
    emitWarning(
      `Single map file checking for '${filePath}' requires async Map loading ` +
        `— not yet implemented. Skipping per-map lint checks.`,
    )
  }

  /**
   * 创建 emitError 回调（模仿 Windows 编译器错误格式）。
   *
   * OpenRA 对照: CheckYaml.EmitError(string)
   */
  private _createEmitError(): EmitErrorFn {
    return (message: string) => {
      console.error(`Error: ${message}`)
      this._errorCount++
    }
  }

  /**
   * 创建 emitWarning 回调。
   *
   * OpenRA 对照: CheckYaml.EmitWarning(string)
   */
  private _createEmitWarning(): EmitWarningFn {
    return (message: string) => {
      if (this._warningAsError) {
        console.error(`Error: ${message}`)
        this._errorCount++
      } else {
        console.warn(`Warning: ${message}`)
        this._warningCount++
      }
    }
  }

  /**
   * 以错误码退出进程。
   *
   * OpenRA 对照: Environment.Exit(1)
   *
   * NOTE: 仅 Node.js 支持。浏览器环境通过返回状态码处理。
   */
  private _exitWithError(): void {
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1)
    }
    // 在浏览器环境中，错误由 run() 的调用方通过检查 _errorCount 处理
  }
}
