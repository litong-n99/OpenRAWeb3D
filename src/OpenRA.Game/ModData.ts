/**
 * ModData.ts — 运行时 mod 协调器 + 对象工厂注册表
 * OpenRA 对照: OpenRA.Game/ModData.cs
 *
 * 核心范式转换:
 * - C# Assembly.GetTypes() / Activator.CreateInstance() 反射
 *   → ObjectCreator.register() 显式注册 + createObject() 工厂
 * - C# IFileSystemLoader.Mount() 解释性挂载
 *   → manifest.mounts 字符串数组 + FileSystem.mount() 循环
 * - C# Lazy<Ruleset>, Lazy<ITerrainInfo> 延迟初始化
 *   → init() Promise 显式异步初始化
 * - C# Thread / ThreadPool 多线程
 *   → JavaScript 单线程 (无需 HandleLoadingProgress)
 * - C# IDisposable 模式
 *   → dispose() 显式释放
 */

import type { IReadOnlyFileSystem } from './FileSystem/IPackage.js'
import type { FileSystem } from './FileSystem/FileSystem.js'
import { MapCache } from './Map/MapCache.js'
import type { Manifest } from './Manifest.js'
import { Ruleset } from './GameRules/Ruleset.js'
import type { ITerrainInfo } from './Map/Map.js'

// ---------------------------------------------------------------------------
// Constructor type — 类构造函数签名
// OpenRA 对照: 无（C# 使用 Activator.CreateInstance）
// ---------------------------------------------------------------------------

/**
 * 类构造函数类型。
 *
 * NOTE: 使用 `any[]` 而非 `unknown[]` 以支持 contravariant 参数类型 —
 * 实际的 constructor 注册表需要存储不同签名的构造函数。
 */
export type Constructor<T = unknown> = new (...args: any[]) => T

// ---------------------------------------------------------------------------
// ILoadScreen — 加载屏幕接口（存根）
// OpenRA 对照: OpenRA.ILoadScreen
// ---------------------------------------------------------------------------

/**
 * 加载屏幕接口 — 在 mod 加载期间显示进度。
 *
 * NOTE: 完整实现推迟到 Phase D/E。当前仅定义接口存根。
 */
export interface ILoadScreen {
  /**
   * 初始化加载屏幕。
   * OpenRA 对照: ILoadScreen.Init(Manifest, IReadOnlyFileSystem)
   */
  init(manifest: Manifest, fileSystem: IReadOnlyFileSystem): void

  /**
   * 刷新加载屏幕显示。
   * OpenRA 对照: ILoadScreen.Display()
   */
  display(): void

  /**
   * 释放加载屏幕资源。
   * OpenRA 对照: ILoadScreen.Dispose()
   */
  dispose(): void
}

// ---------------------------------------------------------------------------
// ObjectCreator — 类注册表 + 工厂
// OpenRA 对照: OpenRA.ObjectCreator
// ---------------------------------------------------------------------------

/**
 * 类注册表和对象工厂 — 替代 C# 反射式对象创建。
 *
 * 每个 mod 的类在 import 时通过 register() 注册自身，
 * 取代 C# 的 [assembly: Widget("Button")] 程序集级属性扫描。
 */
export class ObjectCreator {
  /** 类名 → 构造函数映射。 */
  private _registry = new Map<string, Constructor>()

  /**
   * 注册一个类。
   * OpenRA 对照: ObjectCreator 内部通过 Assembly.GetTypes() 自动填充
   *
   * @param name — 类名（必须唯一）
   * @param ctor — 构造函数
   */
  register(name: string, ctor: Constructor): void {
    this._registry.set(name, ctor)
  }

  /**
   * 查找已注册的类型，不实例化。
   * OpenRA 对照: ObjectCreator.FindType(string)
   *
   * @param name — 类名
   * @returns 构造函数，如果未找到则返回 undefined
   */
  getType(name: string): Constructor | undefined {
    return this._registry.get(name)
  }

  /**
   * 创建已注册类的实例。
   * OpenRA 对照: ObjectCreator.CreateObject<T>(string className)
   *
   * @param name — 类名
   * @param args — 构造函数参数
   * @returns 新实例，如果类未注册则返回 null
   */
  createObject<T = unknown>(name: string, ...args: unknown[]): T | null {
    const ctor = this._registry.get(name)
    if (!ctor) return null
    return new ctor(...args) as T
  }

  /**
   * 获取所有已注册的类名（只读）。
   *
   * NOTE: Allocates a new array per call. Acceptable — this is a
   * startup-only API, not called in render or update loops.
   */
  get registeredNames(): readonly string[] {
    return [...this._registry.keys()]
  }

  /**
   * 清理注册表。
   * OpenRA 对照: ObjectCreator.Dispose()
   */
  dispose(): void {
    this._registry.clear()
  }
}

// ---------------------------------------------------------------------------
// ModData — 运行时 mod 协调器
// OpenRA 对照: OpenRA.ModData
// ---------------------------------------------------------------------------

/**
 * 将所有运行时子系统绑定在一起的根对象: FileSystem, ObjectCreator, MapCache。
 *
 * 这是"游戏实例"的根对象，负责 mod 加载的全生命周期管理。
 */
export class ModData {
  /** Mod 清单。OpenRA 对照: ModData.Manifest */
  readonly manifest: Manifest

  /** 虚拟文件系统（此 mod 的挂载视图）。OpenRA 对照: ModData.ModFiles */
  readonly modFiles: FileSystem

  /** 默认文件系统（modFiles 的别名）。OpenRA 对照: ModData.DefaultFileSystem */
  get defaultFileSystem(): IReadOnlyFileSystem {
    return this.modFiles
  }

  /** 类注册表 + 对象工厂。OpenRA 对照: ModData.ObjectCreator */
  readonly objectCreator: ObjectCreator

  /** 地图缓存。OpenRA 对照: ModData.MapCache */
  readonly mapCache: MapCache

  /** Mod 加载屏幕（如果配置了）。OpenRA 对照: ModData.LoadScreen */
  loadScreen: ILoadScreen | null = null

  /** 已安装的 mod（用于依赖验证）。 */
  private _availableMods: Map<string, Manifest> | null

  /**
   * 创建 ModData 实例。
   *
   * OpenRA 对照: ModData(Manifest mod, InstalledMods mods, bool useLoadScreen)
   *
   * 构造函数执行同步初始化: ObjectCreator 和 MapCache 创建。
   * 异步初始化（挂载、加载屏幕）在 init() 中完成。
   *
   * @param manifest — mod 清单
   * @param modFiles — 为此 mod 预配置的文件系统
   * @param availableMods — 所有已安装 mod 的映射（用于依赖验证），可选
   */
  constructor(
    manifest: Manifest,
    modFiles: FileSystem,
    availableMods?: Map<string, Manifest>,
  ) {
    this.manifest = manifest
    this.modFiles = modFiles
    this._availableMods = availableMods ?? null

    // ObjectCreator 在构造时创建，类在 import 时已注册
    this.objectCreator = new ObjectCreator()

    // MapCache 从 manifest 创建（Manifest 结构上满足 ManifestStub）
    // NOTE: MapCache 不进行异步初始化 — 地图预览在按需时加载。
    this.mapCache = new MapCache(manifest)
  }

  // ---------------------------------------------------------------------------
  // init — 异步初始化序列
  // ---------------------------------------------------------------------------

  /**
   * 初始化 mod 运行时。
   * OpenRA 对照: ModData 构造函数体（同步部分）+ InitializeLoaders()
   *
   * 序列:
   * 1. 验证依赖（如果提供了 availableMods）
   * 2. 挂载所有 manifest.mounts 路径
   * 3. 加载 LoadScreen（如果配置了）
   *
   * 注意: WidgetLoader 创建推迟到 Phase D。
   *
   * @throws 如果依赖验证失败
   */
  async init(): Promise<void> {
    // 1. 验证依赖
    if (this._availableMods) {
      const missing = this.manifest.validateDependencies(this._availableMods)
      if (missing.length > 0) {
        throw new Error(
          `Mod '${this.manifest.id}' requires missing dependencies: ${missing.join(', ')}`,
        )
      }
    }

    // 2. 挂载所有 manifest.mounts 路径
    for (const mountPath of this.manifest.mounts) {
      await this.modFiles.mount(mountPath)
    }

    // 3. 加载 LoadScreen（如果配置了）
    // NOTE: LoadScreen 接口已定义，但具体实现推迟到 Phase D/E。
    // 当 WidgetLoader 就绪后可创建具体的 ILoadScreen 实例。
    // 实例化 LoadScreen 实现
    if (this.manifest.loadScreen && this.objectCreator) {
      // NOTE: this.objectCreator always truthy here — it is created in the
      // constructor and never nulled before init(). The guard is defensive
      // for potential future refactoring.
      // 存根：当具体的 LoadScreen 类注册后，取消注释：
      // const screenType = this.manifest.loadScreen['type'] as string | undefined
      // if (screenType) {
      //   this.loadScreen = this.objectCreator.createObject<ILoadScreen>(screenType)
      //   if (this.loadScreen) {
      //     this.loadScreen.init(this.manifest, this.modFiles)
      //     this.loadScreen.display()
      //   }
      // }
    }
  }

  // ---------------------------------------------------------------------------
  // loadRuleSet — 加载规则集（存根）
  // ---------------------------------------------------------------------------

  /**
   * 从文件系统加载规则集。
   *
   * OpenRA 对照: ModData.DefaultRules (Lazy<Ruleset>)
   *
   * Loads the ruleset from the mod's file system via Ruleset.loadAsync().
   * The terrainInfo parameter is null for the default ruleset (no preferred
   * tileset). Use loadRuleSetForTileSet() to load with a specific terrain.
   *
   * @returns 规则集，如果无法加载则返回 null
   */
  async loadRuleSet(): Promise<Ruleset | null> {
    try {
      return await Ruleset.loadAsync(this.manifest, this.modFiles)
    } catch (e) {
      console.error(`[ModData] Failed to load ruleset: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  /**
   * 从文件系统加载带有指定地形集的规则集。
   *
   * OpenRA 对照: ModData.DefaultRules + LoadDefaultsForTileSet
   *
   * @param terrainInfo — 地形信息（从 TileSet 或 TerrainInfo 加载）
   * @returns 规则集，如果无法加载则返回 null
   */
  async loadRuleSetForTileSet(terrainInfo: ITerrainInfo): Promise<Ruleset | null> {
    try {
      return await Ruleset.loadAsync(this.manifest, this.modFiles, terrainInfo)
    } catch (e) {
      console.error(`[ModData] Failed to load ruleset for tileset '${terrainInfo.id}': ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // getOrCreate — 获取或创建全局 mod 数据模块
  // ---------------------------------------------------------------------------

  /**
   * 获取或创建全局 mod 数据模块。
   * STUB — 完整实现需要 IGlobalModData 接口和 ObjectCreator 集成。
   *
   * OpenRA 对照: ModData.GetOrCreate<T>() where T : IGlobalModData
   *
   * @param _type — 类型标识（类构造函数）
   * @returns 模块实例，如果无法创建则返回 undefined
   */
  // NOTE: OpenRA's ModData.GetOrNull<T>() and GetSettings<T>() are deferred.
  // They depend on modules TypeDictionary and SettingsModule, which are not
  // yet migrated.  See OpenRA.Game/ModData.cs for reference.
  getOrCreate<T>(_type: unknown): T | undefined {
    // STUB: 完整实现需要:
    // 1. 检查 modules 字典中的已有实例
    // 2. 如果缺失则通过 ObjectCreator 创建默认实例
    // 3. 应用 FieldLoader（如果适用）
    return undefined
  }

  // ---------------------------------------------------------------------------
  // dispose — 释放所有资源
  // ---------------------------------------------------------------------------

  /**
   * 释放所有资源。
   * OpenRA 对照: ModData.Dispose()
   *
   * 释放顺序:
   * 1. 加载屏幕（如果存在）
   * 2. 地图缓存
   * 3. 对象创建器
   * 4. 文件系统
   */
  dispose(): void {
    this.loadScreen?.dispose()
    this.loadScreen = null

    this.mapCache.dispose()
    this.objectCreator.dispose()
    this.modFiles.dispose()
  }
}
