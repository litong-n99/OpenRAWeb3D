/**
 * ModRegistration.ts — mod 注册/ExternalMod 类型 + 注册表接口
 * OpenRA 对照: OpenRA.Game/ExternalMods.cs (296 lines, ModRegistration 枚举 + ExternalMod 类)
 *
 * 核心范式转换:
 * - C# [Flags] enum ModRegistration → const 对象 + 位操作辅助函数
 * - C# ExternalMod (Png icon 存储) → 简化的数据类（无 sprite/图标字段）
 * - C# ExternalMods (IReadOnlyDictionary + 文件系统持久化) → IModRegistry 接口
 * - C# Platform.GetSupportDir() → IModRegistry 实现内部处理
 *
 * 此文件定义了 mod 注册系统的最小共享类型。完整的 ExternalMods
 * 实现（包括图标加载、YAML 序列化）推迟到后续阶段。
 *
 * NOTE: 图标 (Icon/Icon2x/Icon3x) 在 TypeScript 中暂不实现 — 它们依赖 Sprite
 * 和 Sheet 系统，而 mod 注册是纯文件 I/O 操作（CI / CLI），无需渲染时访问。
 */

import type { Manifest } from '../Manifest.js'

// ---------------------------------------------------------------------------
// ModRegistration — 注册目标标志（对应 OpenRA [Flags] enum ModRegistration）
// ---------------------------------------------------------------------------

/** Mod 注册目标标志。
 *
 * OpenRA 对照: [Flags] enum ModRegistration { User = 1, System = 2 }
 */
export const ModRegistration = {
  /** 用户级注册（~/.openra/ModMetadata）。值为 1。 */
  User: 1,
  /** 系统级注册（/usr/share/openra/ModMetadata）。值为 2。 */
  System: 2,
} as const

/** Mod 注册目标的位掩码类型。 */
export type ModRegistration = number

// ---------------------------------------------------------------------------
// ExternalMod — 已注册 mod 的数据类（对应 OpenRA ExternalMod）
// ---------------------------------------------------------------------------

/**
 * 表示已在 mod 切换器中注册的外部 mod。
 *
 * OpenRA 对照: OpenRA.ExternalMod
 *
 * NOTE: Icon / Icon2x / Icon3x sprite 字段在 TypeScript 中省略 —
 * 这些是纯渲染时的关注点，仅由 mod 切换器 UI 使用。
 * CLI 注册/注销命令不操作图标。
 */
export interface ExternalModData {
  /** Mod 标识符。OpenRA 对照: ExternalMod.Id */
  id: string

  /** Mod 版本。OpenRA 对照: ExternalMod.Version */
  version: string

  /** 启动路径（可执行文件或目录）。OpenRA 对照: ExternalMod.LaunchPath */
  launchPath: string

  /** 额外启动参数。OpenRA 对照: ExternalMod.LaunchArgs (ImmutableArray<string>) */
  launchArgs: readonly string[]
}

// ---------------------------------------------------------------------------
// ExternalMod 辅助函数
// ---------------------------------------------------------------------------

/**
 * 生成用于索引已注册 mod 的键。
 *
 * OpenRA 对照: ExternalMod.MakeKey(Manifest) / ExternalMod.MakeKey(string, string)
 *
 * 键格式: "{id}-{version}"
 */
export function makeModKey(idOrMod: string | { id: string; version: string }, version?: string): string {
  if (typeof idOrMod === 'string') {
    return `${idOrMod}-${version}`
  }
  return `${idOrMod.id}-${idOrMod.version}`
}

// ---------------------------------------------------------------------------
// IModRegistry — mod 注册表接口（对应 OpenRA ExternalMods 公共 API）
// ---------------------------------------------------------------------------

/**
 * Mod 注册表接口 — 管理已注册 mod 的生命周期。
 *
 * OpenRA 对照: ExternalMods.Register() / Unregister() / ClearInvalidRegistrations()
 *
 * 在 C# 中，ExternalMods 是一个完整的类，在构造时加载所有注册表。
 * 在 TypeScript 中，此接口定义了 mod 注册系统必须实现的契约。
 * 具体实现（如 NodeModRegistry）负责将注册表持久化到磁盘。
 *
 * 实现必须：
 * - 是幂等的（多次 register 同一 mod 应无错误地更新注册表）
 * - 线程安全或保证在单线程环境中运行
 * - 如果持久化失败则抛错
 */
export interface IModRegistry {
  /**
   * 在 mod 切换器中注册一个 mod。
   *
   * OpenRA 对照: ExternalMods.Register(Manifest, string, IEnumerable<string>, ModRegistration)
   *
   * 将 mod 的元数据持久化到指定注册目标下的 "ModMetadata/{key}.yaml"。
   *
   * @param manifest — mod 清单（提供 id、version 和 icon 数据）
   * @param launchPath — 指向 mod 目录或启动脚本的路径
   * @param launchArgs — 额外的启动参数（通常为 ["Game.Mod={id}"]）
   * @param registration — 位掩码：ModRegistration.User | ModRegistration.System
   */
  register(
    manifest: Manifest,
    launchPath: string,
    launchArgs: string[],
    registration: ModRegistration,
  ): void

  /**
   * 从 mod 切换器中注销一个 mod。
   *
   * OpenRA 对照: ExternalMods.Unregister(Manifest, ModRegistration)
   *
   * 从指定注册目标中删除 mod 的元数据文件。
   *
   * @param manifest — 要注销的 mod 清单
   * @param registration — 位掩码：要清理的注册目标
   */
  unregister(manifest: Manifest, registration: ModRegistration): void

  /**
   * 清理无效的 mod 注册条目。
   *
   * OpenRA 对照: ExternalMods.ClearInvalidRegistrations(ModRegistration)
   *
   * 扫描指定注册目标下的所有 ".yaml" 元数据文件，并删除满足以下条件的条目：
   * - LaunchPath 不再存在（mod 目录已被删除/移动）
   * - 文件名与内部键不匹配
   * - YAML 解析失败
   * - 对同一 mod ID + 不同版本的过时条目
   *
   * @param registration — 位掩码：要清理的注册目标
   * @returns 已移除的条目数量
   */
  clearInvalidRegistrations(registration: ModRegistration): number
}

// ---------------------------------------------------------------------------
// ModRegistryHelper — 位掩码辅助函数
// ---------------------------------------------------------------------------

/**
 * 检查给定的 ModRegistration 值中是否包含特定标志。
 *
 * @param value — 组合的注册标志
 * @param flag — 要检查的单一标志
 * @returns true 表示 value 包含 flag
 */
export function hasModRegistrationFlag(value: ModRegistration, flag: ModRegistration): boolean {
  return (value & flag) !== 0
}
