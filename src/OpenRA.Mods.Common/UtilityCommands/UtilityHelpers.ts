/**
 * UtilityHelpers.ts — 构建工具共享辅助函数
 * OpenRA 对照: OpenRA.Mods.Common/UtilityCommands/UtilityHelpers.cs (53 lines)
 *
 * 核心范式转换:
 * - C# MiniYamlNode / MiniYaml → TypeScript 简化的 JSON 表示
 * - C# Platform.EngineDir → Node.js process.cwd() / 可配置项目根
 * - C# Folder.OpenPackage() → TypeScript Folder.openPackage() (Ch5 已迁移)
 * - C# Map 构造函数 (ModData, IReadOnlyPackage) → Map.fromLoaderInput() (Ch4 已迁移)
 * - C# Console.WriteLine 日志 → console.log / console.error
 *
 * 此文件提供在多个构建命令之间共享的工具函数。
 */

import type { ModData } from '../../OpenRA.Game/ModData.js'
import type { Manifest } from '../../OpenRA.Game/Manifest.js'
import type { Map } from '../../OpenRA.Game/Map/Map.js'

// ---------------------------------------------------------------------------
// Helper — loadModData
// ---------------------------------------------------------------------------

/**
 * 从 manifest 路径创建 ModData。
 *
 * OpenRA 对照: 内联在多个 Utility 命令中的 `new ModData(manifest)` 调用
 *
 * NOTE: 完整实现需要构建一个 FileSystem + 挂载 manifest.mounts 条目。
 * 在 TypeScript 中，ModData 构造函数需要预先配置的 FileSystem。
 * 此函数接受一个预构建的 ModData 工厂回调，而不是直接加载。
 *
 * 在典型的 CLI 场景中，调用方在调用此函数之前:
 * 1. 从 manifest 路径加载 Manifest
 * 2. 配置 FileSystem 并挂载所有依赖项
 * 3. 将两者传递给此方法以构造 ModData
 *
 * @param manifest — mod 清单
 * @param modDataFactory — 从 manifest 创建 ModData 的回调实现（由调用方提供）
 * @returns 初始化完成的 ModData 实例
 */
export async function getModData(
  manifest: Manifest,
  modDataFactory: (manifest: Manifest) => Promise<ModData>,
): Promise<ModData> {
  const modData = await modDataFactory(manifest)
  return modData
}

// ---------------------------------------------------------------------------
// Helper — loadMap
// ---------------------------------------------------------------------------

/**
 * 从文件路径加载地图。
 *
 * OpenRA 对照: `new Map(modData, new Folder(path).OpenPackage(mapPath, ...))`
 *
 * 在 TypeScript 中，Map 使用 Map.fromLoaderInput() 工厂方法构建。
 * 此函数从给定路径的 package 中加载地图二进制和 YAML 数据。
 *
 * NOTE: 完整实现需要:
 * 1. 从 path 读取 map.yaml 和 map.bin
 * 2. 解析 YAML 元数据 + 二进制数据
 * 3. 构造 TerrainInfo（如果尚未加载）
 * 4. 调用 Map.fromLoaderInput() 创建地图实例
 *
 * 由于此功能紧密依赖于 ModData 的文件系统配置和 TerrainInfo 加载，
 * 实际实现由调用方提供 mapFactory 回调。
 *
 * @param modData — 当前 mod 数据（提供文件系统和 TerrainInfo 访问）
 * @param mapPath — 地图 package 的路径（文件夹或 .oramap 文件）
 * @param mapFactory — 从文件系统路径加载 Map 的回调实现
 * @returns 已加载的地图对象，加载失败则返回 null
 */
export async function loadMap(
  modData: ModData,
  mapPath: string,
  mapFactory: (modData: ModData, mapPath: string) => Promise<Map | null>,
): Promise<Map | null> {
  try {
    return await mapFactory(modData, mapPath)
  } catch (e) {
    console.error(`Could not load map '${mapPath}': ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Helper — saveMap
// ---------------------------------------------------------------------------

/**
 * 将地图保存到文件路径。
 *
 * OpenRA 对照: map.Save() / map.SaveAs()
 *
 * NOTE: 完整实现需要将 Map 数据序列化为 .oramap 格式
 * （包含 map.yaml + map.bin 的 ZIP 文件）。
 * Map 序列化逻辑在 Ch4 Map.ts 中尚未完整实现。
 *
 * 此存根提供接口形状供后续实现使用。
 *
 * @param map — 要保存的地图
 * @param path — 目标文件路径
 * @param saveFactory — 将 Map 保存到指定路径的回调实现
 * @returns Promise，保存失败时 reject
 */
export async function saveMap(
  map: Map,
  path: string,
  saveFactory: (map: Map, path: string) => Promise<void>,
): Promise<void> {
  await saveFactory(map, path)
}

// ---------------------------------------------------------------------------
// Helper — getTopLevelNodeByKey
// OpenRA 对照: UtilityHelpers.GetTopLevelNodeByKey()
// ---------------------------------------------------------------------------

/**
 * 从合并后的 mod + 地图 YAML 节点集合中获取顶层节点。
 *
 * OpenRA 对照: UtilityHelpers.GetTopLevelNodeByKey(
 *   ModData modData, string key,
 *   Func<Manifest, ImmutableArray<string>> manifestPropertySelector,
 *   Func<Map, MiniYaml> mapPropertySelector = null,
 *   string mapPath = null,
 * )
 *
 * 在 C# 中，此函数:
 * 1. 可选地加载地图
 * 2. 从 manifest 获取文件列表
 * 3. 从地图获取内联的 YAML 属性
 * 4. 使用 MiniYaml.Load() 合并所有文件
 * 5. 返回第一个匹配键的节点
 *
 * TypeScript 简化版:
 * - MiniYaml 系统在 Ch4 Phase H 中已迁移为 JSON 管道
 * - YAML 文件在构建时预编译为 JSON
 * - 此函数改为接收预解析的键来查找
 *
 * 对于需要 YAML 合并功能的命令（如 CheckYaml），应使用
 * miniyaml 解析器 + FileSystem 的完整实现。
 *
 * @param files — 从 manifest 属性选择器获取的文件列表
 * @param key — 要查找的顶层节点键
 * @param parseYaml — 解析单个 YAML 文件内容的回调
 * @param mapYaml — 可选的地图内联 YAML 数据
 * @returns 第一个匹配键的节点，如果未找到则返回 undefined
 */
export function getTopLevelNodeByKey<T>(
  files: readonly string[],
  key: string,
  parseYaml: (fileContent: string) => Record<string, T>,
  mapYaml?: Record<string, T> | null,
): T | undefined {
  // 先检查地图内联数据
  if (mapYaml && key in mapYaml) {
    return mapYaml[key]
  }

  // 检查 manifest 文件列表
  for (const file of files) {
    // NOTE: 实际实现需要从 FileSystem 读取文件内容
    // 此处接口保持简单，真正的文件读取由 parseYaml 回调处理
    // 回调负责从 FileSystem 读取并解析特定文件
    const parsed = parseYaml(`[file: ${file}]`)
    if (parsed && key in parsed) {
      return parsed[key]
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Helper — parseModRegistration (TypeScript 特有)
// ---------------------------------------------------------------------------

/**
 * 解析 mod 注册类型参数。
 *
 * OpenRA 对照: RegisterModCommand / UnregisterModCommand 中的内联解析
 *
 * 在 C# 的多条命令中，所有命令都解析相同的 "system" / "user" / "both"
 * 参数并转换为 ModRegistration 标志。此辅助函数集中处理此逻辑。
 *
 * @param arg — 注册类型字符串 ("system", "user", "both")
 * @returns ModRegistration 标志位（User=1, System=2）
 * @throws 如果参数不是有效值
 */
export function parseModRegistrationArg(arg: string): number {
  let type = 0
  if (arg === 'system' || arg === 'both') {
    type |= 2 // System
  }
  if (arg === 'user' || arg === 'both') {
    type |= 1 // User
  }
  if (type === 0) {
    throw new Error(
      `Invalid mod registration type: "${arg}". Must be "system", "user", or "both".`,
    )
  }
  return type
}
