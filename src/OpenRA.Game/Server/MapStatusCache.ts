/**
 * MapStatusCache.ts -- 地图状态验证缓存：本地评估地图状态并异步执行
 * lint 检查，将结果通知服务器。
 *
 * OpenRA 对照: OpenRA.Game/Server/MapStatusCache.cs (106 lines C#)
 *
 * 核心范式转换:
 * - C# Dictionary<MapPreview, Session.MapStatus> 索引器 → TypeScript 方法 getStatus(map)
 * - C# ThreadPool.QueueUserWorkItem → queueMicrotask() (浏览器单线程)
 * - C# ModData.ObjectCreator.GetTypesImplementing<T> →
 *   通过 duck-typing 检查 lint pass 实现
 * - C# ILintServerMapPass.Run() → TypeScript ILintServerMapPass.run()
 * - C# MapPreview.LoadRuleset() / DefinesUnsafeCustomRules() →
 *   可选的 map 方法（MapPreview 存根可能不包含它们）
 */

import { MapStatus } from './SessionTypes.js'
import { MapPlayers } from '../Map/MapPlayers.js'
import type { ModData } from '../ModData.js'

// ---------------------------------------------------------------------------
// MapPreview for Server (minimal interface needed by MapStatusCache)
// ---------------------------------------------------------------------------

/**
 * MapPreview 的服务器端最小接口。包括 MapStatusCache 需要的地图元数据
 * 和可选的 ruleset 加载方法。
 */
export interface ServerMapPreview {
  /** 地图唯一标识符。 */
  uid: string

  /** 地图标题。 */
  readonly title?: string

  /** 地图下载/安装状态（MapPreview.MapStatus: 0=Unavailable, 2=Available）。 */
  status: number

  /** 玩家槽位配置。 */
  readonly players?: MapPlayers | { players: Map<string, unknown> }

  /** 可选：从地图加载自定义 ruleset。 */
  loadRuleset?(): unknown

  /** 可选：检查地图是否定义了不安全的自定义规则。 */
  definesUnsafeCustomRules?(): boolean
}

// ---------------------------------------------------------------------------
// ILintServerMapPass (对应 OpenRA ILintServerMapPass)
// ---------------------------------------------------------------------------

/**
 * 服务器地图 lint 检查接口。
 * 实现者执行一个特定的 lint 检查，通过回调报告错误和警告。
 *
 * OpenRA 对照: ILintServerMapPass interface
 */
export interface ILintServerMapPass {
  /**
   * 执行 lint 检查。
   *
   * OpenRA 对照: ILintServerMapPass.Run(Action<string>, Action<string>,
   *   ModData, MapPreview, Ruleset)
   *
   * @param emitError — 报告 lint 错误的回调
   * @param emitWarning — 报告 lint 警告的回调
   * @param modData — MOD 运行时数据
   * @param map — 待检查的地图
   * @param mapRules — 地图的自定义 ruleset
   */
  run(
    emitError: (message: string) => void,
    emitWarning: (message: string) => void,
    modData: ModData,
    map: ServerMapPreview,
    mapRules: unknown,
  ): void
}

// ---------------------------------------------------------------------------
// MapStatusCache
// ---------------------------------------------------------------------------

/**
 * 地图状态验证缓存。
 * 第一次查询地图时评估其状态，缓存结果，并在状态变化时通知服务器。
 * 需要 lint 的地图将通过 queueMicrotask 异步执行 lint 检查。
 *
 * OpenRA 对照: class MapStatusCache
 */
export class MapStatusCache {
  /** 缓存：map uid → 会话 MapStatus 位标志。 */
  private readonly cache: Map<string, MapStatus> = new Map()

  /** 状态变化回调。 */
  private readonly onStatusChanged: (uid: string, status: MapStatus) => void

  /** 是否对非本地安装的地图启用远程 lint 检查。 */
  private readonly enableRemoteLinting: boolean

  /** MOD 运行时数据。 */
  private readonly modData: ModData

  // ---------------------------------------------------------------------------
  // Constructor (对应 OpenRA MapStatusCache 构造函数)
  // ---------------------------------------------------------------------------

  /**
   * @param modData — MOD 运行时数据（用于获取 lint pass 实现）
   * @param onStatusChanged — 当地图状态变化时调用的回调
   * @param enableRemoteLinting — 是否对远程地图启用 lint 检查
   */
  constructor(
    modData: ModData,
    onStatusChanged: (uid: string, status: MapStatus) => void,
    enableRemoteLinting: boolean,
  ) {
    this.modData = modData
    this.onStatusChanged = onStatusChanged
    this.enableRemoteLinting = enableRemoteLinting
  }

  // ---------------------------------------------------------------------------
  // getStatus (对应 OpenRA indexer this[MapPreview map])
  // ---------------------------------------------------------------------------

  /**
   * 获取地图的服务器端验证状态。首次查询时计算状态并缓存；
   * 后续查询返回缓存值。需要 lint 的地图将异步调度 lint 检查。
   *
   * OpenRA 对照: MapStatusCache.this[MapPreview map]
   *
   * @param map — 待查询的地图预览
   * @returns 地图的 MapStatus 位标志组合
   */
  getStatus(map: ServerMapPreview): MapStatus {
    // 先检查缓存
    const cached = this.cache.get(map.uid)
    if (cached !== undefined) {
      return cached
    }

    let rules: unknown = null
    let status: MapStatus

    try {
      // 尝试加载地图的自定义 ruleset
      if (typeof map.loadRuleset === 'function') {
        rules = map.loadRuleset()
      }

      // 本地已安装的地图不需要 lint 检查
      // NOTE: C# MapPreview.MapStatus.Available = 2 maps to MapStatus.Playable = 2
      status =
        this.enableRemoteLinting && map.status !== MapStatus.Playable
          ? MapStatus.Validating
          : MapStatus.Playable

      // 检查不安全的自定义规则
      if (typeof map.definesUnsafeCustomRules === 'function') {
        if (map.definesUnsafeCustomRules()) {
          status |= MapStatus.UnsafeCustomRules
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(
        `[server] Failed to load rules for \`${map.title ?? map.uid}\` with error: ${msg}`,
      )
      status = MapStatus.Incompatible
    }

    // 检查最大玩家数
    const playerCount = this._getPlayerCount(map)
    if (playerCount > MapPlayers.MaximumPlayerCount) {
      console.log(
        `[server] Failed to load \`${map.title ?? map.uid}\`: Player count exceeds maximum (${playerCount}/${MapPlayers.MaximumPlayerCount}).`,
      )
      status = MapStatus.Incompatible
    }

    // 缓存结果
    this.cache.set(map.uid, status)

    // 如果需要 lint，通过 queueMicrotask 异步执行
    if ((status & MapStatus.Validating) !== 0) {
      queueMicrotask(() => {
        this._runLintTests(map, rules)
      })
    }

    return status
  }

  // ---------------------------------------------------------------------------
  // _runLintTests (对应 OpenRA RunLintTests)
  // ---------------------------------------------------------------------------

  /**
   * 对地图运行所有已注册的 lint 检查 pass。
   *
   * OpenRA 对照: MapStatusCache.RunLintTests(MapPreview, Ruleset)
   */
  private _runLintTests(map: ServerMapPreview, rules: unknown): void {
    const cached = this.cache.get(map.uid)
    if (cached === undefined) return

    let status = cached
    let failed = false

    const emitError = (message: string): void => {
      console.log(
        `[server] Map ${map.title ?? map.uid} failed lint with error: ${message}`,
      )
      failed = true
    }

    const emitWarning = (_message: string): void => {
      // 警告暂不处理（C# 原版中也是空方法体）
    }

    // 获取所有 ILintServerMapPass 实现
    const lintPasses = this._getLintPassImplementations()

    for (const lintPass of lintPasses) {
      try {
        lintPass.run(emitError, emitWarning, this.modData, map, rules)
      } catch (e: unknown) {
        emitError(e instanceof Error ? e.message : String(e))
      }
    }

    // 更新状态：清除 Validating 标志，设置最终结果
    status &= ~MapStatus.Validating
    status |= failed ? MapStatus.Incompatible : MapStatus.Playable

    this.cache.set(map.uid, status)
    this.onStatusChanged(map.uid, status)
  }

  // ---------------------------------------------------------------------------
  // _getLintPassImplementations (获取 ILintServerMapPass 实现)
  // ---------------------------------------------------------------------------

  /**
   * 从 ModData 获取所有 ILintServerMapPass 实现。
   * 使用 duck-typing：检查对象是否有 `run` 方法。
   *
   * OpenRA 对照: modData.ObjectCreator.GetTypesImplementing<ILintServerMapPass>()
   */
  private _getLintPassImplementations(): ILintServerMapPass[] {
    const passes: ILintServerMapPass[] = []

    // 通过 objectCreator 获取实现类型名称列表并实例化
    try {
      // NOTE: ModData.objectCreator 的类型因 MOD 而异。
      // 这里我们尝试通过已注册的名称获取实现。
      const creator = (this.modData as unknown as Record<string, unknown>).objectCreator as
        | { getTypesImplementing?(interfaceName: string): string[]; createBasic?(typeName: string): unknown }
        | undefined

      if (creator?.getTypesImplementing) {
        const typeNames = creator.getTypesImplementing('ILintServerMapPass')
        for (const typeName of typeNames) {
          try {
            const instance = creator.createBasic?.(typeName)
            if (instance && typeof (instance as ILintServerMapPass).run === 'function') {
              passes.push(instance as ILintServerMapPass)
            }
          } catch {
            // 实例化失败 → 跳过
          }
        }
      }
    } catch {
      // objectCreator 不可用 → 跳过
    }

    return passes
  }

  // ---------------------------------------------------------------------------
  // _getPlayerCount (获取地图玩家数量)
  // ---------------------------------------------------------------------------

  /**
   * 获取地图定义的玩家槽位数量。
   */
  private _getPlayerCount(map: ServerMapPreview): number {
    if (!map.players) return 0

    // MapPlayers 类型
    if (map.players instanceof MapPlayers) {
      return map.players.players.size
    }

    // 普通对象类型（如 MapPreviewStub）
    const players = map.players.players
    if (players instanceof Map) {
      return players.size
    }

    return 0
  }
}
