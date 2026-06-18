/**
 * LintInterfaces.ts — Lint 检查通行证接口定义
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/LintInterfaces.cs
 *
 * 核心范式转换:
 * - C# Action<string> 委托 → TypeScript (errorMsg: string) => void 回调
 * - C# 隐式 Assembly 扫描反射 → 显式 LintPassRegistry 注册
 * - C# ILintPass/ILintMapPass/ILintRulesPass/ILintSequencesPass → 等效 TS 接口
 */

import type { ModData } from '../../OpenRA.Game/ModData.js'
import type { Map } from '../../OpenRA.Game/Map/Map.js'
import type { Ruleset } from '../../OpenRA.Game/GameRules/Ruleset.js'

// ---------------------------------------------------------------------------
// Lint 回调类型（对应 OpenRA Action<string>）
// ---------------------------------------------------------------------------

/** 错误报告回调。
 *
 * OpenRA 对照: Action<string> emitError
 */
export type EmitErrorFn = (message: string) => void

/** 警告报告回调。
 *
 * OpenRA 对照: Action<string> emitWarning
 */
export type EmitWarningFn = (message: string) => void

// ---------------------------------------------------------------------------
// ILintPass — 基础 Lint 通行证（对应 OpenRA ILintPass）
// ---------------------------------------------------------------------------

/**
 * 基础 Lint 通行证接口 — 对 mod 数据运行通用检查。
 *
 * OpenRA 对照: ILintPass { void Run(Action<string>, Action<string>, ModData) }
 *
 * 实现此接口以在 `check-yaml` 命令期间对 mod 数据执行全局验证。
 */
export interface ILintPass {
  /** 针对 mod 数据运行 lint 通行证。
   *
   * @param emitError — 用于报告错误的回调
   * @param emitWarning — 用于报告警告的回调
   * @param modData — 当前 mod 运行时数据
   */
  run(
    emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
    modData: ModData,
  ): void
}

// ---------------------------------------------------------------------------
// ILintMapPass — 地图级 Lint 通行证（对应 OpenRA ILintMapPass）
// ---------------------------------------------------------------------------

/**
 * 地图级 Lint 通行证接口 — 对单张地图运行检查。
 *
 * OpenRA 对照: ILintMapPass { void Run(Action<string>, Action<string>, ModData, Map) }
 */
export interface ILintMapPass {
  /** 针对地图运行 lint 通行证。
   *
   * @param emitError — 用于报告错误的回调
   * @param emitWarning — 用于报告警告的回调
   * @param modData — 当前 mod 运行时数据
   * @param map — 待检查的地图
   */
  run(
    emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
    modData: ModData,
    map: Map,
  ): void
}

// ---------------------------------------------------------------------------
// ILintRulesPass — 规则级 Lint 通行证（对应 OpenRA ILintRulesPass）
// ---------------------------------------------------------------------------

/**
 * 规则级 Lint 通行证接口 — 对规则集运行检查。
 *
 * OpenRA 对照: ILintRulesPass { void Run(Action<string>, Action<string>, ModData, Ruleset) }
 */
export interface ILintRulesPass {
  /** 针对规则集运行 lint 通行证。
   *
   * @param emitError — 用于报告错误的回调
   * @param emitWarning — 用于报告警告的回调
   * @param modData — 当前 mod 运行时数据
   * @param rules — 待检查的规则集
   */
  run(
    emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
    modData: ModData,
    rules: Ruleset,
  ): void
}

// ---------------------------------------------------------------------------
// ILintSequencesPass — 序列级 Lint 通行证（对应 OpenRA ILintSequencesPass）
// ---------------------------------------------------------------------------

/**
 * 序列级 Lint 通行证接口 — 对序列集运行检查。
 *
 * OpenRA 对照: ILintSequencesPass { void Run(Action<string>, Action<string>, ModData, Ruleset, SequenceSet) }
 *
 * NOTE: SequenceSet 在 TypeScript 中等效于一个记录 sprite 序列名称到帧引用的映射。
 * 由于 SequenceSet 尚未独立迁移（与 Sprite/SpriteCache 紧密耦合），
 * 此接口使用一个简单的 Record<string, unknown> 类型占位 —— 在
 * Ch2 的 SequenceSet 完成迁移后可替换为更具体的类型。
 */
export interface ILintSequencesPass {
  /** 针对序列运行 lint 通行证。
   *
   * @param emitError — 用于报告错误的回调
   * @param emitWarning — 用于报告警告的回调
   * @param modData — 当前 mod 运行时数据
   * @param rules — 当前规则集
   * @param sequences — 序列数据（TODO: 迁移 SequenceSet 后替换为具体类型）
   */
  run(
    emitError: EmitErrorFn,
    emitWarning: EmitWarningFn,
    modData: ModData,
    rules: Ruleset,
    sequences: Record<string, unknown>,
  ): void
}

// ---------------------------------------------------------------------------
// LintPassRegistry — Lint 通行证显式注册表（TypeScript 特有）
// ---------------------------------------------------------------------------

/**
 * Lint 通行证注册表 — 替代 C# 的反射式 Assembly.GetTypes() 发现。
 *
 * OpenRA 对照: modData.ObjectCreator.GetTypesImplementing<ILintPass>()
 *
 * 在 C# 中，CheckYaml 通过 Assembly 扫描自动发现所有 ILintPass 实现。
 * TypeScript 无运行时反射，因此 lint 通行证在模块 import 时必须显式注册。
 *
 * 使用方式:
 * ```
 * // 在模块顶层注册（import 时执行）
 * import { lintPassRegistry } from './LintInterfaces.js'
 * lintPassRegistry.register(new CheckActorReferences())
 * ```
 */
class LintPassRegistry {
  private _passes: ILintPass[] = []
  private _mapPasses: ILintMapPass[] = []
  private _rulesPasses: ILintRulesPass[] = []
  private _sequencesPasses: ILintSequencesPass[] = []

  /** 注册一个通用 lint 通行证。
   *
   * @param pass — ILintPass 实现
   */
  register(pass: ILintPass): void {
    this._passes.push(pass)
  }

  /** 注册一个地图级 lint 通行证。
   *
   * @param pass — ILintMapPass 实现
   */
  registerMap(pass: ILintMapPass): void {
    this._mapPasses.push(pass)
  }

  /** 注册一个规则级 lint 通行证。
   *
   * @param pass — ILintRulesPass 实现
   */
  registerRules(pass: ILintRulesPass): void {
    this._rulesPasses.push(pass)
  }

  /** 注册一个序列级 lint 通行证。
   *
   * @param pass — ILintSequencesPass 实现
   */
  registerSequences(pass: ILintSequencesPass): void {
    this._sequencesPasses.push(pass)
  }

  /** 获取所有通用 lint 通行证。
   *
   * @returns 只读数组
   */
  get passes(): readonly ILintPass[] {
    return this._passes
  }

  /** 获取所有地图级 lint 通行证。
   *
   * @returns 只读数组
   */
  get mapPasses(): readonly ILintMapPass[] {
    return this._mapPasses
  }

  /** 获取所有规则级 lint 通行证。
   *
   * @returns 只读数组
   */
  get rulesPasses(): readonly ILintRulesPass[] {
    return this._rulesPasses
  }

  /** 获取所有序列级 lint 通行证。
   *
   * @returns 只读数组
   */
  get sequencesPasses(): readonly ILintSequencesPass[] {
    return this._sequencesPasses
  }

  /** 清除所有已注册的通行证。用于测试/重置。 */
  clear(): void {
    this._passes = []
    this._mapPasses = []
    this._rulesPasses = []
    this._sequencesPasses = []
  }
}

/** 全局 lint 通行证注册表单例。
 *
 * Lint 通行证在模块 import 时注册到此单例。
 * CheckYaml 命令在运行时读取所有已注册的通行证并执行它们。
 */
export const lintPassRegistry = new LintPassRegistry()
