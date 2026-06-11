/**
 * Manifest.ts — mod 配置清单与元数据
 * OpenRA 对照: OpenRA.Game/Manifest.cs
 *
 * 核心范式转换:
 * - C# mod.yaml + Include 指令 → JSON mod.json（构建时由 MiniYAML 管道预编译）
 * - C# MiniYaml 递归解析 + FieldLoader 反射注入 → JSON 对象键直接读取
 * - C# FrozenDictionary → Map<string, string>
 * - C# ImmutableArray → readonly string[]
 * - C# ReservedModuleNames 静态集合 → Manifest._reservedKeys Set
 * - C# RequiresMods 隐式检查 → validateDependencies() 显式验证
 */

// ---------------------------------------------------------------------------
// ModMetadata — mod 元数据
// OpenRA 对照: OpenRA.ModMetadata
// ---------------------------------------------------------------------------

export interface ModMetadata {
  /** Mod 标题（显示名）。OpenRA 对照: ModMetadata.Title */
  title: string

  /** Mod 版本号。OpenRA 对照: ModMetadata.Version */
  version: string

  /** 作者名（可选）。OpenRA 对照: 无（扩展字段） */
  author?: string

  /** Mod 描述（可选）。OpenRA 对照: 无（扩展字段） */
  description?: string

  /** 官网 URL（可选）。OpenRA 对照: ModMetadata.Website */
  website?: string

  /** 窗口标题（可选）。OpenRA 对照: ModMetadata.WindowTitle */
  windowTitle?: string

  /** 是否在 mod 选择器中隐藏。OpenRA 对照: ModMetadata.Hidden */
  hidden?: boolean
}

// ---------------------------------------------------------------------------
// RendererConstants — 渲染器常量配置
// OpenRA 对照: OpenRA.RendererConstants
// ---------------------------------------------------------------------------

export interface RendererConstants {
  /** 字体图集大小（默认 512）。OpenRA 对照: RendererConstants.FontSheetSize */
  fontSheetSize: number

  /** 光标图集大小（默认 512）。OpenRA 对照: RendererConstants.CursorSheetSize */
  cursorSheetSize: number

  /** 地图预览图集大小（默认 2048）。OpenRA 对照: RendererConstants.MapPreviewSheetSize */
  mapPreviewSheetSize: number

  /** BGRA 序列图集大小（默认 2048）。OpenRA 对照: RendererConstants.SequenceBgraSheetSize */
  sequenceBgraSheetSize: number

  /** 索引色序列图集大小（默认 2048）。OpenRA 对照: RendererConstants.SequenceIndexedSheetSize */
  sequenceIndexedSheetSize: number

  /** 顶点批次大小（默认 8192）。OpenRA 对照: RendererConstants.VertexBatchSize */
  vertexBatchSize: number
}

/** RendererConstants 默认值。 */
const DEFAULT_RENDERER_CONSTANTS: RendererConstants = {
  fontSheetSize: 512,
  cursorSheetSize: 512,
  mapPreviewSheetSize: 2048,
  sequenceBgraSheetSize: 2048,
  sequenceIndexedSheetSize: 2048,
  vertexBatchSize: 8192,
}

// ---------------------------------------------------------------------------
// Manifest — mod 配置清单
// OpenRA 对照: OpenRA.Manifest
// ---------------------------------------------------------------------------

/**
 * 从预编译的 mod.json 对象构造的 mod 清单。
 *
 * 所有 Include 指令在构建时已由 MiniYAML 管道解析并内联。
 * mod.json 是单一输出文件，Manifest 从中直接读取结构化数据。
 */
export class Manifest {
  // ---- 标识 ----

  /** Mod 标识符（通常是目录名）。OpenRA 对照: Manifest.Id */
  readonly id: string

  // ---- 元数据 ----

  /** Mod 元数据。OpenRA 对照: Manifest.Metadata */
  readonly metadata: ModMetadata

  // ---- 依赖 ----

  /** 依赖的 mod ID 列表。OpenRA 对照: Manifest.RequiresMods（由 YAML 推导） */
  readonly requiresMods: string[]

  // ---- 文件系统挂载 ----

  /** 文件系统挂载路径列表。OpenRA 对照: Manifest.FileSystem MiniYaml 键 */
  readonly mounts: string[]

  // ---- 资源路径列表 ----

  /** 规则定义文件列表。OpenRA 对照: Manifest.Rules */
  readonly rules: string[]

  /** 精灵序列定义文件列表。OpenRA 对照: Manifest.Sequences */
  readonly sequences: string[]

  /** 模型序列定义文件列表。OpenRA 对照: Manifest.ModelSequences */
  readonly modelSequences: string[]

  /** 光标定义文件列表。OpenRA 对照: Manifest.Cursors */
  readonly cursors: string[]

  /** Chrome UI 定义文件列表。OpenRA 对照: Manifest.Chrome */
  readonly chrome: string[]

  /** Chrome 布局定义文件列表。OpenRA 对照: Manifest.ChromeLayout */
  readonly chromeLayout: string[]

  /** 武器定义文件列表。OpenRA 对照: Manifest.Weapons */
  readonly weapons: string[]

  /** 语音定义文件列表。OpenRA 对照: Manifest.Voices */
  readonly voices: string[]

  /** 通知定义文件列表。OpenRA 对照: Manifest.Notifications */
  readonly notifications: string[]

  /** 音乐定义文件列表。OpenRA 对照: Manifest.Music */
  readonly music: string[]

  /** Fluent 翻译消息文件列表。OpenRA 对照: Manifest.FluentMessages */
  readonly fluentMessages: string[]

  /** 地形集定义文件列表。OpenRA 对照: Manifest.TileSets */
  readonly tileSets: string[]

  /** Chrome 指标定义文件列表。OpenRA 对照: Manifest.ChromeMetrics */
  readonly chromeMetrics: string[]

  /** 任务定义文件列表。OpenRA 对照: Manifest.Missions */
  readonly missions: string[]

  /** 快捷键定义文件列表。OpenRA 对照: Manifest.Hotkeys */
  readonly hotkeys: string[]

  /** 服务器特征定义文件列表。OpenRA 对照: Manifest.ServerTraits */
  readonly serverTraits: string[]

  // ---- 地图 ----

  /** 地图文件夹映射（文件夹名 → 路径）。OpenRA 对照: Manifest.MapFolders */
  readonly mapFolders: Map<string, string>

  /** 地图兼容性 ID 列表（包含自身 ID）。OpenRA 对照: Manifest.MapCompatibility */
  readonly mapCompatibility: string[]

  // ---- 加载屏幕 ----

  /** 加载屏幕配置（JSON 子对象），若无则 null。OpenRA 对照: Manifest.LoadScreen */
  readonly loadScreen: Record<string, unknown> | null

  // ---- 默认命令生成器 ----

  /** 默认命令生成器类名。OpenRA 对照: Manifest.DefaultOrderGenerator */
  readonly defaultOrderGenerator: string | null

  // ---- 渲染器常量 ----

  /** 渲染器常量配置。OpenRA 对照: Manifest.RendererConstants */
  readonly rendererConstants: RendererConstants

  // ---- 包格式 ----

  /** 预期的包格式列表。OpenRA 对照: Manifest.PackageFormats */
  readonly packageFormats: string[]

  // ---- 未分类的全局 mod 数据 ----

  /**
   * 未分类的 mod 全局数据（mod.json 中未被保留键识别的条目）。
   * OpenRA 对照: Manifest.GlobalModData (FrozenDictionary<string, MiniYaml>)
   */
  readonly globalModData: Map<string, Record<string, unknown>>

  // ---- 保留键（已知的 mod.json 顶级键） ----

  /**
   * 保留的模块名称集合 — 这些键由 Manifest 字段处理，不进入 globalModData。
   * OpenRA 对照: Manifest.ReservedModuleNames
   */
  private static readonly _reservedKeys = new Set([
    'Metadata',
    'RequiresMods',
    'FileSystem',
    'MapFolders',
    'Rules',
    'Sequences',
    'ModelSequences',
    'Cursors',
    'Chrome',
    'ChromeLayout',
    'Weapons',
    'Voices',
    'Notifications',
    'Music',
    'FluentMessages',
    'TileSets',
    'ChromeMetrics',
    'Missions',
    'Hotkeys',
    'ServerTraits',
    'LoadScreen',
    'SupportsMapsFrom',
    'DefaultOrderGenerator',
    'Assemblies',
    'PackageFormats',
    'SoundFormats',
    'SpriteFormats',
    'VideoFormats',
    'SpriteSequenceFormat',
    'TerrainFormat',
    'AllowUnusedFluentMessagesInExternalPackages',
    'RendererConstants',
  ])

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * 从预编译的 JSON 对象创建 Manifest。
   *
   * OpenRA 对照: new Manifest(string modId, IReadOnlyPackage package)
   *   原构造函数从包中读取 mod.yaml 并解析 MiniYAML。
   *   构建时已完成的: Include 解析、YAML→JSON 转换、字段扁平化。
   *
   * @param id — mod 标识符
   * @param json — 从 mod.json 解析的对象
   */
  constructor(id: string, json: Record<string, unknown>) {
    this.id = id

    // ---- Metadata ----
    const meta = (json['Metadata'] as Record<string, unknown>) ?? {}
    this.metadata = {
      title: String(meta['Title'] ?? id),
      version: String(meta['Version'] ?? '1.0'),
      ...(meta['Author'] !== undefined ? { author: String(meta['Author']) } : {}),
      ...(meta['Description'] !== undefined
        ? { description: String(meta['Description']) }
        : {}),
      ...(meta['Website'] !== undefined
        ? { website: String(meta['Website']) }
        : {}),
      ...(meta['WindowTitle'] !== undefined
        ? { windowTitle: String(meta['WindowTitle']) }
        : {}),
      ...(meta['Hidden'] !== undefined
        ? { hidden: Boolean(meta['Hidden']) }
        : {}),
    }

    // ---- RequiresMods ----
    this.requiresMods = parseStringArray(json, 'RequiresMods')

    // ---- FileSystem (mounts) ----
    const fileSystem = json['FileSystem']
    this.mounts =
      fileSystem !== null &&
      typeof fileSystem === 'object' &&
      !Array.isArray(fileSystem)
        ? Object.keys(fileSystem as Record<string, unknown>)
        : []

    // ---- Resource lists ----
    this.rules = parseStringArray(json, 'Rules')
    this.sequences = parseStringArray(json, 'Sequences')
    this.modelSequences = parseStringArray(json, 'ModelSequences')
    this.cursors = parseStringArray(json, 'Cursors')
    this.chrome = parseStringArray(json, 'Chrome')
    this.chromeLayout = parseStringArray(json, 'ChromeLayout')
    this.weapons = parseStringArray(json, 'Weapons')
    this.voices = parseStringArray(json, 'Voices')
    this.notifications = parseStringArray(json, 'Notifications')
    this.music = parseStringArray(json, 'Music')
    this.fluentMessages = parseStringArray(json, 'FluentMessages')
    this.tileSets = parseStringArray(json, 'TileSets')
    this.chromeMetrics = parseStringArray(json, 'ChromeMetrics')
    this.missions = parseStringArray(json, 'Missions')
    this.hotkeys = parseStringArray(json, 'Hotkeys')
    this.serverTraits = parseStringArray(json, 'ServerTraits')

    // ---- MapFolders ----
    const mapFoldersRaw = (json['MapFolders'] as Record<string, unknown>) ?? {}
    this.mapFolders = new Map<string, string>()
    for (const [key, value] of Object.entries(mapFoldersRaw)) {
      this.mapFolders.set(key, String(value))
    }

    // ---- MapCompatibility / SupportsMapsFrom ----
    const compat = [id]
    const supportsMapsFrom = json['SupportsMapsFrom']
    if (typeof supportsMapsFrom === 'string') {
      compat.push(
        ...supportsMapsFrom
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
      )
    }
    this.mapCompatibility = compat

    // ---- LoadScreen ----
    const loadScreenRaw = json['LoadScreen']
    this.loadScreen =
      loadScreenRaw && typeof loadScreenRaw === 'object'
        ? (loadScreenRaw as Record<string, unknown>)
        : null

    // ---- DefaultOrderGenerator ----
    const defaultOrderGen = json['DefaultOrderGenerator']
    this.defaultOrderGenerator =
      typeof defaultOrderGen === 'string' ? defaultOrderGen : null

    // ---- RendererConstants ----
    const rcRaw = (json['RendererConstants'] as Record<string, unknown>) ?? {}
    this.rendererConstants = {
      fontSheetSize:
        parseOptionalInt(rcRaw, 'FontSheetSize') ??
        DEFAULT_RENDERER_CONSTANTS.fontSheetSize,
      cursorSheetSize:
        parseOptionalInt(rcRaw, 'CursorSheetSize') ??
        DEFAULT_RENDERER_CONSTANTS.cursorSheetSize,
      mapPreviewSheetSize:
        parseOptionalInt(rcRaw, 'MapPreviewSheetSize') ??
        DEFAULT_RENDERER_CONSTANTS.mapPreviewSheetSize,
      sequenceBgraSheetSize:
        parseOptionalInt(rcRaw, 'SequenceBgraSheetSize') ??
        DEFAULT_RENDERER_CONSTANTS.sequenceBgraSheetSize,
      sequenceIndexedSheetSize:
        parseOptionalInt(rcRaw, 'SequenceIndexedSheetSize') ??
        DEFAULT_RENDERER_CONSTANTS.sequenceIndexedSheetSize,
      vertexBatchSize:
        parseOptionalInt(rcRaw, 'VertexBatchSize') ??
        DEFAULT_RENDERER_CONSTANTS.vertexBatchSize,
    }

    // ---- PackageFormats ----
    this.packageFormats = parseStringArray(json, 'PackageFormats')

    // ---- GlobalModData (unrecognized top-level keys) ----
    this.globalModData = new Map<string, Record<string, unknown>>()
    for (const [key, value] of Object.entries(json)) {
      if (Manifest._reservedKeys.has(key)) continue
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.globalModData.set(key, value as Record<string, unknown>)
      }
    }

    // NOTE: C# 特有字段（Assemblies, SoundFormats, SpriteFormats, VideoFormats,
    //   SpriteSequenceFormat, TerrainFormat, AllowUnusedFluentMessagesInExternalPackages,
    //   FluentCulture）在此 TS 版本中省略。这些字段分别处理 .NET 程序集加载、
    //   平台特定格式注册和 Fluent 本地化，在 web 环境中不适用或推迟到后续阶段。
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * 便捷工厂方法 — 从预编译的 JSON 对象创建 Manifest。
   * OpenRA 对照: 无（新增，用于 JSON 解析工作流）
   *
   * @param id — mod 标识符
   * @param json — 从 mod.json 解析的对象
   * @returns 新 Manifest 实例
   */
  static fromJSON(id: string, json: Record<string, unknown>): Manifest {
    return new Manifest(id, json)
  }

  // ---------------------------------------------------------------------------
  // Dependency Validation
  // ---------------------------------------------------------------------------

  /**
   * 验证此 mod 的所有依赖项。
   * OpenRA 对照: 无（新增，替代 C# RequiresMods 隐式解析 + 启动时崩溃）
   *
   * 深度优先搜索整个依赖树，包含循环检测。
   *
   * @param availableMods — 已安装的 mod 映射 (id → Manifest)
   * @returns 缺失的依赖 ID 列表（空数组 = 全部满足）
   */
  validateDependencies(availableMods: Map<string, Manifest>): string[] {
    const missing: string[] = []
    const visited = new Set<string>()
    for (const depId of this.requiresMods) {
      this._validateTransitive(depId, availableMods, visited, missing)
    }
    return missing
  }

  /**
   * 递归检查传递依赖。
   *
   * @param modId — 要检查的 mod ID
   * @param availableMods — 已安装的 mod
   * @param visited — 已访问的 mod（用于循环检测）
   * @param missing — 累积的缺失 ID 列表
   */
  private _validateTransitive(
    modId: string,
    availableMods: Map<string, Manifest>,
    visited: Set<string>,
    missing: string[],
  ): void {
    // 循环检测
    if (visited.has(modId)) return
    visited.add(modId)

    const dep = availableMods.get(modId)
    if (!dep) {
      // 避免重复添加同一个缺失 ID
      if (!missing.includes(modId)) {
        missing.push(modId)
      }
      return
    }

    // 递归检查依赖的依赖
    for (const subDepId of dep.requiresMods) {
      this._validateTransitive(subDepId, availableMods, visited, missing)
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * 从 JSON 对象中以数组形式提取字符串列表。
 *
 * OpenRA 对照: Manifest.YamlList() (C#)
 *
 * @param json — 源对象
 * @param key — 键名
 * @returns 字符串数组（如果键不存在或不是数组则返回空数组）
 */
function parseStringArray(
  json: Record<string, unknown>,
  key: string,
): string[] {
  const raw = json[key]
  if (!Array.isArray(raw)) return []
  return raw.map((item) => String(item))
}

/**
 * 从 JSON 对象中提取可选整数。
 *
 * @param json — 源对象
 * @param key — 键名
 * @returns 整数值，如果键不存在或无法解析则返回 undefined
 */
function parseOptionalInt(
  json: Record<string, unknown>,
  key: string,
): number | undefined {
  const raw = json[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number') return Math.trunc(raw)
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}
