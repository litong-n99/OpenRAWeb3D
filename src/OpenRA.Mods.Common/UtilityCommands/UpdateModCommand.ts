/**
 * UpdateModCommand.ts — mod YAML 规则/序列/地形/Chrome 更新工具
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/UpdateModCommand.cs (294 lines)
 *
 * 核心范式转换:
 * - C# UpdatePath / UpdateRule 系统（反射 + YAML 重写） → TypeScript 存根接口
 * - C# MiniYamlNodeBuilder / MiniYaml → 简化 JSON 表示
 * - C# File.CreateText / Console.ReadKey → Node.js console + readline
 * - C# IEnumerable<UpdateRule> rules → IUpdateRule[] 数组
 * - C# UpdateUtils.UpdateMod/UpdateMap (~200 lines) → 推迟实现
 * - C# YamlFileSet = List<(IReadWritePackage, string, List<MiniYamlNodeBuilder>)> → 推迟
 *
 * 此命令将 mod 的 YAML 资产（规则、序列、地形集、chrome 布局、
 * chrome 提供者）从旧格式更新到当前格式。在 C# 中，它使用反射式
 * UpdateRule 发现（UpdatePath.FromSource）和 YAML 节点树重写。
 *
 * 在 TypeScript 中，UpdateRules 系统（UpdatePath、UpdateRule、UpdateUtils
 * —— OpenRA.Mods.Common/UpdateRules/ 下的 ~10 个文件）尚未迁移。
 * 此命令提供了正确的接口结构，并将实际更新逻辑推迟到真正的
 * UpdateRules 迁移完成之后。
 *
 * NOTE: 完整的 UpdateRule 应用逻辑取决于：
 * - Ch4 MiniYAML 管道（解析 + 写入 YAML 文件）
 * - UpdateRule / UpdatePath / UpdateUtils 迁移（尚未规划）
 * - Ch5 FileSystem（IReadWritePackage — 尚未完整迁移）
 * - Ch4 MapCache（枚举地图包）
 */

import { Utility, type IUtilityCommand } from '../../OpenRA.Game/IUtilityCommand.js'
import type { ModData } from '../../OpenRA.Game/ModData.js'

// ---------------------------------------------------------------------------
// IUpdateRule — UpdateRule 的缩简接口
// ---------------------------------------------------------------------------

/**
 * UpdateRule 的缩简接口 — 定义了将 mod 资产从旧格式更新到当前格式
 * 所需的方法签名子集。
 *
 * OpenRA 对照: OpenRA.Mods.Common.UpdateRules.UpdateRule
 *
 * NOTE: 完整的 UpdateRule 抽象类有 ~100 行 C# 代码，
 * 包含 BeforeUpdate、AfterUpdate、UpdateActorNode、UpdateWeaponNode 等。
 * 此接口捕获 CLI 工具所需的核心契约，其完整实现推迟到
 * UpdateRules 迁移（TODO-21.E.X — 尚未规划）。
 */
export interface IUpdateRule {
  /** 规则的可读名称。OpenRA 对照: UpdateRule.Name */
  readonly name: string

  /** 规则的描述（可能包含多行）。OpenRA 对照: UpdateRule.Description */
  readonly description: string

  /**
   * 在更新开始前调用。
   * OpenRA 对照: UpdateRule.BeforeUpdate(ModData)
   *
   * @param modData — 当前 mod 数据
   * @returns 在此自动更新之后需要手动执行的操作步骤
   */
  beforeUpdate?(modData: ModData): string[]

  /**
   * 在更新完成后调用。
   * OpenRA 对照: UpdateRule.AfterUpdate(ModData)
   *
   * @param modData — 当前 mod 数据
   * @returns 需要手动执行的操作步骤
   */
  afterUpdate?(modData: ModData): string[]

  // NOTE: UpdateActorNode / UpdateWeaponNode / UpdateSequenceNode /
  // UpdateTilesetNode / UpdateChromeNode / UpdateChromeProviderNode
  // 推迟到完整的 UpdateRule 迁移。
}

// ---------------------------------------------------------------------------
// IUpdateRuleSource — 更新规则来源提供者
// ---------------------------------------------------------------------------

/**
 * 更新规则来源提供者 — 通过名称查找更新规则。
 *
 * OpenRA 对照: UpdatePath.FromSource(ObjectCreator, string)
 *
 * 在 C# 中，UpdatePath 定义预配置的更新路径（release-X → release-Y），
 * 每条路径包含一个 UpdateRule 实例列表。来源参数可以是一个
 * 已知的路径名称（如 "release-20250330"）或一个具体的 UpdateRule 类名。
 */
export interface IUpdateRuleSource {
  /**
   * 通过名称查找更新规则。
   *
   * @param sourceName — 路径标签或规则类名
   * @returns 匹配的规则数组，如果来源未知则返回 null
   */
  getRules(sourceName: string): IUpdateRule[] | null

  /**
   * 获取所有已知的更新路径名称。
   */
  readonly knownPaths: string[]

  /**
   * 获取所有已知的规则类名。
   */
  readonly knownRuleNames: string[]
}

// ---------------------------------------------------------------------------
// UpdateModCommand
// ---------------------------------------------------------------------------

export class UpdateModCommand implements IUtilityCommand {
  /** 命令调用名。OpenRA 对照: IUtilityCommand.Name => "--update-mod" */
  readonly name = '--update-mod'

  /** 命令描述。OpenRA 对照: DescAttribute */
  readonly description =
    'SOURCE [--detailed] [--apply] [--skip-maps] [--yes] — Updates a mod to the latest version.'

  /** 用于查找规则的可选规则来源。通过构造函数注入以支持测试。 */
  private _ruleSource: IUpdateRuleSource | null

  constructor(ruleSource?: IUpdateRuleSource) {
    this._ruleSource = ruleSource ?? null
  }

  // ---------------------------------------------------------------------------
  // IUtilityCommand 实现
  // ---------------------------------------------------------------------------

  /**
   * 验证参数: --update-mod 始终接受参数。
   * 参数数量可变，因为 --detailed、--apply、--skip-maps、--yes 为可选。
   *
   * @param _args — 命令名之后的参数
   * @returns 始终为 true（若源不存在则在 run 中打印帮助）
   */
  validateArguments(_args: string[]): boolean {
    // 此命令接受可变参数；有效性检查在 run() 中处理。
    return true
  }

  /**
   * 执行 mod 更新。
   *
   * 工作流:
   * 1. 解析 SOURCE 参数
   * 2. 如果 SOURCE 缺失或未知则打印帮助 + 已知路径/规则
   * 3. 如果 --apply：应用更新规则（如果可用），否则警告
   * 4. 否则：打印更新规则摘要（--detailed 以获取详细描述）
   *
   * @param utility — 命令上下文（提供 ModData）
   * @param args — 命令参数
   */
  run(utility: Utility, args: string[]): void {
    const modData = utility.modData

    // 解析标志
    const detailed = args.includes('--detailed')
    const apply = args.includes('--apply')
    const skipMaps = args.includes('--skip-maps')
    const yes = args.includes('--yes')

    // 非标志的第一个参数是 SOURCE
    const source = args.find((a) => !a.startsWith('--'))

    if (source) {
      const rules: IUpdateRule[] | null = this._ruleSource
        ? this._ruleSource.getRules(source)
        : null

      if (!rules) {
        // 未知来源 — 打印帮助
        this._printHelp()
        if (source) {
          console.log(`Unknown source: ${source}`)
        }
        return
      }

      if (apply) {
        this._applyRules(rules, modData, skipMaps, yes)
      } else {
        this._printSummary(rules, detailed, modData)
      }
    } else {
      // 无来源 — 打印帮助
      this._printHelp()
    }
  }

  // ---------------------------------------------------------------------------
  // _printSummary — 打印更新规则摘要
  // ---------------------------------------------------------------------------

  /**
   * 打印所有匹配规则的摘要。
   *
   * OpenRA 对照: UpdateModCommand.PrintSummary()
   *
   * @param rules — 要总结的规则列表
   * @param detailed — 为 true 时打印每个规则的完整描述
   * @param modData — 当前 mod 数据（供子类使用）
   */
  private _printSummary(rules: IUpdateRule[], detailed: boolean, _modData: ModData): void {
    const count = rules.length
    if (count === 1) {
      console.log('Found 1 API change:')
    } else {
      console.log(`Found ${count} API changes:`)
    }

    for (const rule of rules) {
      console.log(`  * ${rule.name}`)
      if (detailed) {
        console.log(`     ${rule.description.replace(/\n/g, '\n     ')}`)
        console.log()
      }
    }

    if (!detailed) {
      console.log()
      console.log(
        'Run this command with the --detailed flag to view detailed information on each change.',
      )
    }

    console.log(
      'Run this command with the --apply flag to apply the update rules.',
    )
  }

  // ---------------------------------------------------------------------------
  // _applyRules — 应用更新规则
  // ---------------------------------------------------------------------------

  /**
   * 将更新规则应用于 mod 数据。
   *
   * OpenRA 对照: UpdateModCommand.ApplyRules()
   *
   * NOTE: 完整的 YAML 重写管线（LoadModYaml、UpdateUtils.UpdateMod、
   * UpdateUtils.UpdateMap、YamlFileSet.Save）推迟到真正的 UpdateRules
   * 迁移完成之后。
   *
   * 当前实现执行 BeforeUpdate → (无操作) → AfterUpdate 的顺序，
   * 收集所有手动步骤。对于完全自动化的迁移仍需迁移 UpdateRules 系统。
   *
   * @param rules — 要应用的规则
   * @param modData — 当前 mod 数据
   * @param skipMaps — 为 true 时跳过地图更新
   * @param yes — 为 true 时跳过确认提示
   */
  private _applyRules(
    rules: IUpdateRule[],
    modData: ModData,
    skipMaps: boolean,
    yes: boolean,
  ): void {
    if (!yes) {
      console.log(
        'WARNING: This command will automatically rewrite your mod rules.',
      )
      console.log()
      console.log(
        'We strongly recommend that you have a backup of your mod rules, and ',
      )
      console.log(
        'for best results, to use a Git client to review the line-by-line ',
      )
      console.log('changes and discard any unwanted side effects.')
      console.log()

      // NOTE: 在 Node.js 中，交互式确认需要 process.stdin。
      // 在测试/CI 环境中，--yes 标志可用于绕过。
      console.log(
        'Use --yes to skip confirmation, or run without --apply to preview changes.',
      )
      console.log()

      // 如果不进行交互则跳过
      if (!yes) {
        console.log('Update cancelled (use --yes to force).')
        return
      }
    }

    console.log()
    // NOTE: 日志写入 'update.log' 推迟到完整的 UpdateRules 迁移。

    const manualSteps: string[] = []

    for (const rule of rules) {
      console.log(`${rule.name}`)

      try {
        console.log('   Updating mod... ')

        // NOTE: UpdateUtils.UpdateMod() 推迟。
        // 在完整的 UpdateRules 迁移后，此调用将:
        // 1. 加载所有 mod YAML 文件 (LoadModYaml)
        // 2. 在每个文件上调用 rule.UpdateActorNode / rule.UpdateWeaponNode 等
        // 3. 将修改后的文件写回
        // 4. 收集手动操作步骤

        if (rule.beforeUpdate) {
          manualSteps.push(...rule.beforeUpdate(modData))
        }

        console.log('COMPLETE (preview mode — no files modified)')

        if (!skipMaps) {
          console.log('   Updating system maps... SKIPPED')
          // NOTE: UpdateUtils.UpdateMap() 推迟。
          // 完整实现需要 modData.mapCache.enumerateMapPackagesWithoutCaching()
        } else {
          console.log('   Updating system maps... SKIPPED')
        }

        if (rule.afterUpdate) {
          manualSteps.push(...rule.afterUpdate(modData))
        }
      } catch (e) {
        console.log('   FAILED')
        console.log()
        console.log(
          '   The automated changes for this rule were not applied because of an error.',
        )
        console.log(
          `   The exception reported was: ${e instanceof Error ? e.message : String(e)}`,
        )
        continue
      }
    }

    if (manualSteps.length > 0) {
      console.log()
      console.log(
        '   Manual changes are required to complete this update:',
      )
      for (const step of manualSteps) {
        console.log(`    * ${step}`)
      }
    }

    // NOTE: 外部文件名跟踪 (externalFilenames) 推迟。
    // "The following external mod files have been ignored..." 消息
    // 在完整实现中打印。

    console.log()
    console.log('Update preview complete.')
    console.log(
      'Review the messages above for any manual actions that must be applied.',
    )
    console.log(
      'NOTE: Files have not been modified. Full --apply support requires UpdateRules migration.',
    )
  }

  // ---------------------------------------------------------------------------
  // _printHelp — 打印已知路径 + 规则
  // ---------------------------------------------------------------------------

  /**
   * 打印可用的更新路径和规则名称列表。
   *
   * OpenRA 对照: UpdateModCommand.Run() 帮助输出块
   */
  private _printHelp(): void {
    console.log('--update-mod SOURCE [--detailed] [--apply] [--skip-maps] [--yes]')
    console.log()
    console.log('Updates a mod to the latest version.')
    console.log('SOURCE is either a known tag or the name of an update rule.')
    console.log()

    if (this._ruleSource) {
      // 打印已知路径
      const ruleGroups = new Map<string, string[]>()

      console.log('   Update Paths:')
      for (const path of this._ruleSource.knownPaths) {
        console.log(`      ${path}`)
        const rules = this._ruleSource.getRules(path)
        if (rules) {
          ruleGroups.set(
            path,
            rules
              .map((r) => r.name)
              .filter((n) => !Array.from(ruleGroups.values()).some((g) => g.includes(n))),
          )
        }
      }

      // 打印已知规则名称
      console.log('   Individual Rules:')
      for (const [group, names] of ruleGroups) {
        if (names.length === 0) continue
        console.log(`      ${group}:`)
        for (const name of names) {
          console.log(`         ${name}`)
        }
      }

      const other = this._ruleSource.knownRuleNames.filter(
        (n) => !Array.from(ruleGroups.values()).some((g) => g.includes(n)),
      )

      if (other.length > 0) {
        console.log('      Other:')
        for (const name of other) {
          console.log(`         ${name}`)
        }
      }
    } else {
      console.log('   (No update rules available — UpdateRules system not yet migrated)')
    }
  }
}
