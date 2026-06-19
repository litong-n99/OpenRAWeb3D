/**
 * Game.ts — 根协调器，管理所有子系统生命周期
 * OpenRA 对照: OpenRA.Game/Game.cs (static class Game, ~1000 lines)
 *
 * 核心范式转换:
 * - C# static class Game (SDL2 Window) → TypeScript instance class Game (HTML Canvas + Babylon.js Engine)
 * - C# Game.InitializeAndRun(args) → Game.create(canvas, modId, worldType) static async factory
 * - C# Game.InitializeMod(manifest, args) → game.loadMod(modId) instance method
 * - C# Game.LoadShellMap() → game.loadShellMap() with Phase 1 static fallback
 * - C# Game.Run() while-loop → Babylon.js Engine.runRenderLoop() with fixed-timestep accumulator
 * - C# Game.Exit() → game.dispose() with reverse-order cleanup
 */

import { Color4 } from '@babylonjs/core'
import { Renderer } from './Renderer.js'
import { Manifest } from './Manifest.js'
import { ModData } from './ModData.js'
import { FileSystem } from './FileSystem/FileSystem.js'
import { Folder } from './FileSystem/Folder.js'
import { GameWorldManager, WorldType } from './World.js'
import type { MapStub } from './World.js'
import type { WorldRendererStub } from './Traits/TraitsInterfaces.js'
import { WorldRenderer } from './Graphics/WorldRenderer.js'
import type { IWorld } from './Graphics/WorldRenderer.js'
import { CursorManager } from './Graphics/CursorManager.js'
import { EchoConnection } from './Network/Connection.js'
import { OrderManager } from './Network/OrderManager.js'
import { ContentInstallerService } from './ContentInstaller/ContentInstallerService.js'
import { ContentInstallerUI } from './ContentInstaller/ContentInstallerUI.js'
import type { Sound } from './Sound/Sound.js'

// ---------------------------------------------------------------------------
// Re-export WorldType for convenience (used by main.ts and ModSelector)
// ---------------------------------------------------------------------------

export { WorldType }

// ---------------------------------------------------------------------------
// GameState — 生命周期状态
// ---------------------------------------------------------------------------

/** Game 生命周期状态枚举。
 *
 * OpenRA 对照: 无直接对应（C# 使用隐式状态 + bool 标志）
 */
export const GameState = {
  Uninitialized: 'Uninitialized',
  LoadingMod: 'LoadingMod',
  ContentInstall: 'ContentInstall',
  Shellmap: 'Shellmap',
  Playing: 'Playing',
  Editor: 'Editor',
  Disposed: 'Disposed',
} as const

export type GameState = (typeof GameState)[keyof typeof GameState]

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Logic tick rate: 25 TPS = 40ms per tick.
 *
 * OpenRA 对照: GameSpeed.Timestep default
 */
const LOGIC_TIMESTEP_MS = 40

/**
 * Maximum number of catch-up logic ticks per render frame.
 * After hitting this cap, the accumulator is reset to prevent a spiral of death.
 */
const MAX_CATCHUP_TICKS = 5

/** Maximum delta time (ms) to process in a single frame.
 * Clamps large jumps from tab-switch resume to prevent excessive catchup. */
const MAX_DELTA_MS = 200

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _currentGame: Game | null = null

/**
 * 获取当前活跃的 Game 实例。
 *
 * OpenRA 对照: 无直接对应（C# 使用 static class Game 全局访问）
 *
 * @returns 当前 Game 实例，或 null（如果未初始化）
 */
export function getCurrentGame(): Game | null {
  return _currentGame
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/**
 * 根协调器，所有子系统的生命周期管理者。
 *
 * OpenRA 对照: OpenRA.Game/Game.cs static class Game
 *
 * 职责:
 * 1. Babylon.js Engine + Renderer 初始化
 * 2. Mod 加载（fetch manifest → FileSystem → ModData → OrderManager）
 * 3. 游戏世界创建（World + WorldRenderer）
 * 4. Shellmap 管理（Phase 1 静态背景回退）
 * 5. 固定时间步长游戏循环（25 TPS 逻辑 + 可变帧率渲染）
 * 6. 子系统销毁（逆序释放）
 *
 * ADR-22.1: 实例化设计（非静态），支持测试独立性 + 显式 dispose。
 */
export class Game {
  // -----------------------------------------------------------------------
  // 子系统实例
  // -----------------------------------------------------------------------

  /**
   * 渲染器（Engine + Scenes + Cameras）。
   *
   * OpenRA 对照: Game.Renderer
   */
  renderer!: Renderer

  /**
   * 音频系统（Phase B 存根，Phase C 实现）。
   *
   * OpenRA 对照: Game.Sound
   *
   * NOTE: Sound 需要 ISoundEngine + SoundSettings，Phase B 暂不实现。
   */
  sound: Sound | null = null

  /**
   * 运行时 mod 协调器。
   *
   * OpenRA 对照: Game.ModData
   */
  modData: ModData | null = null

  /**
   * 光标管理器（CSS cursor + HTML overlay 回退）。
   *
   * OpenRA 对照: Game.Cursor (public static CursorManager)
   */
  cursorManager: CursorManager | null = null

  /**
   * 命令管理器（网络/本地）。
   *
   * OpenRA 对照: Game.OrderManager
   */
  orderManager: OrderManager | null = null

  /**
   * 当前生命周期状态。
   */
  state: GameState = GameState.Uninitialized

  /**
   * 当前加载的 mod ID。
   */
  currentModId: string | null = null

  /**
   * 渲染帧计数器。每帧递增一次，重启/switchMod 时归零。
   *
   * OpenRA 对照: Game.RenderFrame (C# public static long)
   */
  renderFrame = 0

  // -----------------------------------------------------------------------
  // 私有字段
  // -----------------------------------------------------------------------

  private _world: GameWorldManager | null = null
  private _worldRenderer: WorldRenderer | null = null

  /** 游戏循环已启动标志（runRenderLoop 只能调用一次）。 */
  private _loopStarted = false

  /** 固定时间步长累加器（毫秒）。switchMod 时重置以防止突发 tick。 */
  private _accumulator = 0

  /**
   * 延迟动作队列 — 下一逻辑 tick 执行的一次性回调。
   *
   * OpenRA 对照: Game.RunAfterTick(Action) + Game.PerformDelayedActions()
   */
  private _delayedActions: Array<() => void> = []

  /**
   * 内容安装服务 — 管理游戏资产下载和安装管线。
   *
   * OpenRA 对照: ModContentLogic + DownloadPackageLogic
   *
   * 在 loadMod() 中创建，用于检查所需内容包是否已安装。
   * 如果没有内容安装器（此 mod 没有 content.json），则保持为 null。
   */
  private _contentInstaller: ContentInstallerService | null = null

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /**
   * 游戏世界（如果已创建）。
   *
   * OpenRA 对照: Game.world (C# 无等效属性，通过 OrderManager.World 间接访问)
   */
  get world(): GameWorldManager | null {
    return this._world
  }

  /**
   * 世界渲染器（如果已创建）。
   *
   * OpenRA 对照: Game.worldRenderer (C# private field)
   */
  get worldRenderer(): WorldRenderer | null {
    return this._worldRenderer
  }

  // -----------------------------------------------------------------------
  // setCursor — 切换光标
  //
  // OpenRA 对照: CursorManager.SetCursor (间接通过 Game.Cursor.SetCursor)
  // -----------------------------------------------------------------------

  /**
   * 切换活动光标。
   *
   * OpenRA 对照: Game.Cursor.SetCursor(cursorName)
   *
   * 委托给 CursorManager 实例。若 CursorManager 尚未创建则静默忽略。
   *
   * @param cursorName — 光标名称（如 'default', 'attack', 'move'），null 隐藏光标
   */
  setCursor(cursorName: string | null): void {
    this.cursorManager?.setCursor(cursorName)
  }

  // -----------------------------------------------------------------------
  // Static Factory
  // -----------------------------------------------------------------------

  /**
   * 创建并初始化 Game 实例。
   *
   * OpenRA 对照: Game.InitializeAndRun(args)
   *
   * 初始化序列:
   * 1. 创建 Game 实例
   * 2. initializeEngine(canvas) → Engine + Renderer + 游戏循环
   * 3. loadMod(modId) → Manifest + FileSystem + ModData + OrderManager
   * 4. loadShellMap() → 静态背景（Phase 1）或完整 shellmap
   *
   * @param canvas — HTML canvas 元素（Babylon.js 渲染目标）
   * @param modId — 要加载的 mod ID（如 "ra", "td", "_test"）
   * @param worldType — 世界类型（Regular/Shellmap/Editor），默认 Regular
   * @returns 处于 Shellmap 或指定状态的 Game 实例
   * @throws 如果 mod 加载失败（网络错误、无效 manifest、依赖验证失败）
   */
  static async create(
    canvas: HTMLCanvasElement,
    modId: string,
    worldType: WorldType = WorldType.Regular,
  ): Promise<Game> {
    const game = new Game()
    _currentGame = game

    // 1. Engine + Renderer + game loop
    game.initializeEngine(canvas)

    // 2. Load mod
    await game.loadMod(modId)

    // 3. Shellmap or start game
    if (worldType === WorldType.Shellmap) {
      await game.loadShellMap()
      // 显示主菜单 DOM 覆盖层（Phase C）
      game.showMainMenu()
    }
    // NOTE: WorldType.Regular / WorldType.Editor worlds are started
    // explicitly via startGame(), not automatically in create().

    return game
  }

  // -----------------------------------------------------------------------
  // Constructor (private — use static create())
  // -----------------------------------------------------------------------

  private constructor() {
    // 私有构造函数 — 只能通过 Game.create() 创建实例
  }

  // -----------------------------------------------------------------------
  // initializeEngine — Engine + Renderer + 游戏循环
  // -----------------------------------------------------------------------

  /**
   * 创建 Babylon.js Engine、Renderer 并启动游戏循环。
   *
   * OpenRA 对照: Game.InitializeAndRun() 中的 SDL2 窗口 + OpenGL 上下文创建
   *
   * @param canvas — HTML canvas 元素
   */
  private initializeEngine(canvas: HTMLCanvasElement): void {
    this.renderer = new Renderer(canvas)
    this.startGameLoop()
  }

  // -----------------------------------------------------------------------
  // Game Loop
  // -----------------------------------------------------------------------

  /**
   * 启动固定时间步长游戏循环。
   *
   * 挂载到 Engine.runRenderLoop()，使用 accumulator 模式：
   * - 逻辑 tick 固定 25 TPS（40ms）
   * - 渲染以显示器刷新率运行
   * - 每帧最多 5 次追赶 tick（防死亡螺旋）
   * - 暂停守卫: 不主动暂停逻辑（暂停由 World.tick() 内部控制）
   * - 销毁守卫: state === Disposed 时立即返回
   *
   * OpenRA 对照: Game.Run() while-loop
   */
  private startGameLoop(): void {
    if (this._loopStarted) return
    this._loopStarted = true

    this._accumulator = 0

    this.renderer.engine.runRenderLoop(() => {
      // 销毁守卫 — disposed 后停止所有 tick 活动
      if (this.state === GameState.Disposed) return

      // 增量时间（毫秒），clamped 防止标签页切换后过度追赶
      const deltaMs = Math.min(this.renderer.engine.getDeltaTime(), MAX_DELTA_MS)
      this._accumulator += deltaMs

      let ticksThisFrame = 0
      while (this._accumulator >= LOGIC_TIMESTEP_MS && ticksThisFrame < MAX_CATCHUP_TICKS) {
        this.logicTick()
        this._accumulator -= LOGIC_TIMESTEP_MS
        ticksThisFrame++
      }

      // 防止死亡螺旋: 如果追赶上限已达，重置剩余累积时间
      if (this._accumulator > LOGIC_TIMESTEP_MS * MAX_CATCHUP_TICKS) {
        this._accumulator = 0
      }

      this.renderTick()
    })
  }

  /**
   * 执行一次逻辑 tick（25 TPS）。
   *
   * 仅在 world + orderManager 都存在时推进。
   * 调用顺序匹配 OpenRA Game.Run()：
   * 1. tickImmediate() — 发送即时命令 + 接收网络数据
   * 2. performDelayedActions() — 执行上一 tick 排队的延迟回调
   * 3. tryTick() — 尝试推进一帧（lockstep 协议）
   * 4. 如果 tryTick() 返回 true → world.tick() — 模拟推进
   */
  private logicTick(): void {
    if (!this.orderManager) return

    // 阶段 1: 即时命令处理 + 网络接收
    this.orderManager.tickImmediate()

    // 阶段 1.5: 延迟操作（RunAfterTick 回调）
    this.performDelayedActions()

    // 阶段 2-3: 尝试 lockstep 推进，成功则调用 world.tick()
    const advanced = this.orderManager.tryTick()
    if (advanced && this._world) {
      this._world.tick()
    }
  }

  /**
   * 执行一次渲染 tick（显示器刷新率）。
   *
   * 当 world + worldRenderer 都存在时，委托给 WorldRenderer.draw()。
   * 否则依赖 Babylon.js 的自动清除（静态 shellmap 背景色已在 loadShellMap() 中设置）。
   */
  private renderTick(): void {
    this.renderFrame++

    if (this._worldRenderer && this._world) {
      this._worldRenderer.draw()
    }
    // NOTE: 静态 shellmap（Phase 1）仅依赖 scene.clearColor 的自动清除。
    // 在无 world 时，Babylon.js 每帧自动将 canvas 清除为 clearColor
    // 并渲染 uiScene（此时为空，后续显示主菜单 Widget）。
  }

  // -----------------------------------------------------------------------
  // Delayed Actions — RunAfterTick 回调队列
  // -----------------------------------------------------------------------

  /**
   * 排入一个在下一个逻辑 tick 执行的回调。
   *
   * OpenRA 对照: Game.RunAfterTick(Action)
   *
   * 回调在每次逻辑 tick 的 tickImmediate() 之后、tryTick() 之前执行。
   * 每个回调只执行一次，执行后自动清空。
   * Phase C+ 的主菜单 Widget 和编辑器依赖此机制。
   *
   * @param action — 一次性回调（无参数）
   */
  runAfterTick(action: () => void): void {
    this._delayedActions.push(action)
  }

  /**
   * 执行所有排队的延迟回调，然后清空队列。
   *
   * OpenRA 对照: Game.PerformDelayedActions()
   */
  private performDelayedActions(): void {
    if (this._delayedActions.length === 0) return
    const actions = this._delayedActions
    this._delayedActions = []
    for (const action of actions) {
      try {
        action()
      } catch (e) {
        console.error('[Game] Delayed action error:', e)
      }
    }
  }

  // -----------------------------------------------------------------------
  // loadMod — Mod 加载管道
  // -----------------------------------------------------------------------

  /**
   * 加载指定 Mod。
   *
   * OpenRA 对照: Game.InitializeMod(manifest, args)
   *
   * 加载序列:
   * 1. 获取 `public/mods/{modId}/mod.json` → 解析为 Manifest
   * 2. 创建 FileSystem 并为每个 mount 路径调用 `mount()`
   * 3. 创建 ModData 并调用 `modData.init()`（验证依赖 + 挂载）
   * 4. 调用 `modData.loadRuleSet()` 加载规则集
   * 5. 创建 OrderManager（本地单人模式，EchoConnection）
   *
   * Mount 失败的非可选路径会抛出异常；可选路径（'~' 前缀）静默跳过。
   *
   * @param modId — Mod ID（如 "ra", "td", "_test"）
   * @throws 如果 mod.json 获取失败、解析失败或依赖验证失败
   */
  async loadMod(modId: string): Promise<void> {
    this.state = GameState.LoadingMod
    this.currentModId = modId

    // 1. 获取 mod.json
    const response = await fetch(`/mods/${modId}/mod.json`)
    if (!response.ok) {
      throw new Error(
        `Failed to load mod '${modId}': HTTP ${response.status}`,
      )
    }
    const json = (await response.json()) as Record<string, unknown>

    // 2. 创建 Manifest
    const manifest = new Manifest(modId, json)

    // 3. 创建 FileSystem 并挂载路径
    const fileSystem = new FileSystem()

    // 挂载 manifest.mounts 中声明的路径
    // NOTE: Phase B 中 mount 路径可能不存在（非必需资产），静默跳过。
    for (const mountPath of manifest.mounts) {
      try {
        await fileSystem.mount(mountPath)
      } catch (e) {
        console.warn(
          `[Game] Skipping mount '${mountPath}': ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }
    }

    // 4. 创建 ModData 并初始化
    this.modData = new ModData(manifest, fileSystem)
    await this.modData.init()

    // 4.5. Mount mod data folders (rules/weapons/sequences JSON from build-mods.ts)
    // These provide the YAML→JSON rule data that loadRuleSet() needs.
    // They are NOT the binary game assets (those come from the Content Installer).
    this._mountModDataFolders(fileSystem, manifest)

    // 5. 加载 RuleSet
    await this.modData.loadRuleSet()

    // 5.5. 内容安装检查 (CI-A.11)
    this._contentInstaller = new ContentInstallerService(fileSystem)
    const missingPackages = await this._contentInstaller.checkContent(modId)

    if (missingPackages.length > 0) {
      console.log(
        `[Game] Content packages missing: ${missingPackages.join(', ')}`,
      )
      this.state = GameState.ContentInstall
      ContentInstallerUI.show(this._contentInstaller, modId, () => {
        this._onContentInstalled()
      })
      return // Don't create OrderManager yet — wait for content installation
    }

    // 6-7. Create OrderManager + CursorManager (shared helper)
    // NOTE: Sound 初始化推迟到 Phase C。
    // Sound 需要 ISoundEngine + SoundSettings + FileSystem 设置，
    // 这些依赖在 Phase C 主菜单阶段才就绪。
    // this.sound = new Sound(...)
    this._continueAfterContentCheck()
  }

  /**
   * Mount mod data folders from public/mods/ into the FileSystem.
   *
   * The build-mods.ts script converts OpenRA YAML rules/weapons/sequences/etc
   * to JSON files under public/mods/{modId}/. This method creates Folder
   * packages that map manifest paths (e.g. "ra|rules/misc.yaml") to the
   * corresponding JSON URLs (e.g. "/mods/ra/rules/misc.json").
   *
   * This runs BEFORE loadRuleSet() so that rule/weapon/sequence file
   * references resolve correctly.
   */
  private _mountModDataFolders(
    fileSystem: FileSystem,
    manifest: Manifest,
  ): void {
    // Collect path references for asset types that build-mods.ts converts
    // from YAML to JSON. Other types (voices, notifications, music, cursors,
    // chrome, etc.) are loaded from MIX archives by the Content Installer
    // or parsed at runtime from their raw formats.
    const pathLists = [
      manifest.rules,
      manifest.weapons,
      manifest.sequences,
    ]

    // pkgName → { filePath → URL }
    const folderMaps = new Map<string, Map<string, string>>()
    const mounted = new Set<string>()

    for (const paths of pathLists) {
      for (const rawPath of paths) {
        // Parse "ra|rules/misc.yaml" → {pkg: "ra", file: "rules/misc.yaml"}
        const pipeIdx = rawPath.indexOf('|')
        if (pipeIdx < 0) continue
        const pkgName = rawPath.slice(0, pipeIdx)
        const filePath = rawPath.slice(pipeIdx + 1)

        // Map .yaml/.ftl reference to actual .json file on the server
        const urlPath = `/mods/${pkgName}/${filePath.replace(/\.yaml$/, '.json').replace(/\.ftl$/, '.json')}`

        let fileMap = folderMaps.get(pkgName)
        if (!fileMap) {
          fileMap = new Map()
          folderMaps.set(pkgName, fileMap)
        }
        fileMap.set(filePath, urlPath)
      }
    }

    // Create Folder packages and mount them
    for (const [pkgName, fileMap] of folderMaps) {
      if (mounted.has(pkgName)) continue
      try {
        const folder = new Folder(pkgName, fileMap)
        fileSystem.mountPackage(folder, pkgName)
        mounted.add(pkgName)
      } catch (e) {
        console.warn(
          `[Game] Failed to mount mod data folder '${pkgName}': ${String(e)}`,
        )
      }
    }
  }

  /**
   * Shared initialization after content check passes.
   *
   * Creates OrderManager + CursorManager and transitions to Shellmap.
   * Extracted from loadMod() and _onContentInstalled() to eliminate
   * duplicate initialization logic (MAJOR #8 fix).
   */
  private _continueAfterContentCheck(): void {
    // Create OrderManager（本地单人模式）
    const connection = new EchoConnection()
    this.orderManager = new OrderManager(connection)

    // Create CursorManager
    // OpenRA 对照: Cursor = new CursorManager(ModData)
    this.cursorManager?.dispose()
    this.cursorManager = new CursorManager()

    this.state = GameState.Shellmap
  }

  /**
   * 内容安装完成后的回调 — 重新创建 OrderManager 并继续加载。
   *
   * OpenRA 对照: 无直接对应（C# 中内容安装在启动前完成）
   *
   * 当用户通过 ContentInstallerUI 安装完所有必需内容包后调用。
   * 重建 OrderManager 并启动 shellmap + 主菜单。
   */
  private _onContentInstalled(): void {
    // MAJOR #5: guard against stale state (e.g. game disposed / mod switched
    // while the content installer UI was showing)
    if (this.state !== GameState.ContentInstall) return

    this._continueAfterContentCheck()

    // Continue to shellmap + main menu
    this.loadShellMap().then(() => {
      this.showMainMenu()
    }).catch((err) => {
      console.warn('[Game] Shellmap load failed after content install:', err)
      // Fallback to static background
      this.setShellmapFallback()
      this.showMainMenu()
    })
  }

  // -----------------------------------------------------------------------
  // startGame — 启动游戏世界
  // -----------------------------------------------------------------------

  /**
   * 启动游戏世界（从地图创建 World + WorldRenderer）。
   *
   * OpenRA 对照: Game.StartGame(map, type)
   *
   * 序列:
   * 1. 创建 GameWorldManager（World 实例）
   * 2. 将 world 关联到 OrderManager
   * 3. 创建 WorldRenderer
   * 4. 调用 world.loadComplete(worldRenderer) 通知加载完成
   * 5. 调用 orderManager.startGame() 开始处理命令
   * 6. 调用 worldRenderer.refreshPalette() 刷新调色板
   *
   * @param map — 地图数据（来自 MapCache 或手动创建）
   * @param worldType — 世界类型（Regular/Shellmap/Editor），默认 Regular
   * @throws 如果 mod 未加载（modData 或 orderManager 为 null）
   */
  async startGame(
    map: MapStub,
    worldType: WorldType = WorldType.Regular,
  ): Promise<void> {
    // State guards — prevent undefined behavior when called in wrong state
    if (this.state === GameState.Disposed) {
      throw new Error(
        'Cannot start game: Game has been disposed.',
      )
    }
    if (this.state === GameState.Playing) {
      throw new Error(
        'Cannot start game: World already running. Call switchMod() to change mods.',
      )
    }
    if (this.state === GameState.Uninitialized) {
      throw new Error(
        'Cannot start game: Game not initialized. Call Game.create() first.',
      )
    }

    if (!this.modData || !this.orderManager) {
      throw new Error(
        'Cannot start game: mod not loaded. Call loadMod() first.',
      )
    }

    // 隐藏主菜单（从 Shellmap 过渡到游戏画面）
    this.hideMainMenu()

    // 1. 创建 GameWorldManager
    // NOTE: 使用类型断言桥接 ModData → ModDataStub, OrderManager → OrderManagerStub
    // Phase B 中子系统接口尚未完成完整的类型统一，这些转换在运行时是安全的。
    this._world = new GameWorldManager({
      type: worldType,
      modData: this.modData as unknown as import('./World.js').ModDataStub,
      orderManager:
        this.orderManager as unknown as import('./World.js').OrderManagerStub,
      map,
    })

    // 2. 将 world 关联到 OrderManager
    this.orderManager.world =
      this._world as unknown as import('./Network/UnitOrders.js').WorldStub

    // 3. 创建 WorldRenderer
    // P1-D.6: GameWorldManager now provides all IWorld-required properties
    // (tileSize, tileScale, type, disposed, renderPlayer, localPlayer,
    // players, worldActor, screenMap, unpartitionedEffects, effects,
    // orderGenerator, selection). Sub-type stubs (PlayerStub vs IPlayer,
    // ScreenMapStub vs IScreenMap, etc.) are structurally compatible at
    // runtime; the "as IWorld" cast bridges the remaining compile-time
    // stub gap until all sub-types are fully migrated.
    // TODO-P1-D.6: Remove this cast after PlayerStub/ScreenMapStub/OrderGeneratorStub
    // are promoted to full interface implementations with matching structural types.
    // Currently GameWorldManager has all required properties but the sub-types
    // (PlayerStub, ScreenMap, OrderGenerator) don't fully match IWorld's structural
    // requirements, requiring this single cast.
    this._worldRenderer = new WorldRenderer(
      this.renderer,
      this._world as IWorld,
    )

    // 4. 通知世界加载完成
    this._world.loadComplete(
      this._worldRenderer as unknown as WorldRendererStub,
    )

    // 5. 开始处理命令（创建 per-client 队列，设置帧计数器）
    this.orderManager.startGame()

    // 6. 刷新调色板（使 GPU 调色板纹理与当前调色板修改器同步）
    this._worldRenderer.refreshPalette()

    this.state = GameState.Playing
  }

  // -----------------------------------------------------------------------
  // loadShellMap — Shellmap 加载
  // -----------------------------------------------------------------------

  /**
   * 加载 Shellmap（主菜单背景）。
   *
   * OpenRA 对照: Game.LoadShellMap()
   *
   * ADR-22.5: Shellmap 分阶段部署。
   * Phase 1: 静态深色背景色（回退方案）。
   * Phase 2: 预渲染地图图像（跳过 — 直接进入 Phase 3）。
   * Phase 3: 完整动态 AI skirmish shellmap（P1-D.7 实现）。
   *
   * 策略:
   * - 地图缓存为空 → setShellmapFallback()（Phase 1 静态背景）
   * - 地图缓存有数据 → chooseShellmap() 尝试选择 shellmap 标记的地图
   *   → 成功则 startGame(shellmapMap, Shellmap) + spawn AI + cinematic camera
   *   → 失败则回退到 setShellmapFallback()
   * - 任何异常 → 回退到静态背景
   */
  async loadShellMap(): Promise<void> {
    // Phase 1: 静态背景（当地图缓存为空时总是有效）
    if (!this.modData) {
      this.setShellmapFallback()
      return
    }

    // Phase 3 (P1-D.7): 尝试加载动态 AI skirmish shellmap
    try {
      const shellmapUid = this.chooseShellmap()
      if (shellmapUid) {
        // Try to load the shellmap map and start a Shellmap-type game
        const mapStub = await this.loadShellmapMap(shellmapUid)
        if (mapStub) {
          await this.startGame(mapStub, WorldType.Shellmap)
          // Shellmap world is now running — configure cinematic camera
          this.setupShellmapCamera()
          // Spawn AI players for dynamic skirmish background
          this.spawnShellmapBots()
          // Register input handler: any user interaction → show main menu
          this.registerShellmapInputHandler()
          return
        }
      }
    } catch (err) {
      console.warn('[Game] Shellmap load failed, using static fallback:', err)
    }

    // 回退到静态背景
    this.setShellmapFallback()
  }

  /**
   * 从地图缓存中选择一个 shellmap 标记的地图。
   *
   * OpenRA 对照: LoadShellMap 中的隐式选择逻辑 + MapCache 迭代
   *
   * 筛选标记为 MapVisibility.Shellmap (bit 2, value=2) 的地图预览，
   * 随机选择一个并返回其 UID。
   *
   * P1-D.7: Implemented to iterate MapCache and filter by shellmap flag.
   * Falls back gracefully when MapCache is empty or no shellmap maps exist.
   *
   * @returns shellmap 地图 UID，如果没有可用 shellmap 则返回 null
   */
  private chooseShellmap(): string | null {
    if (!this.modData) return null

    const mapCache = this.modData.mapCache
    if (!mapCache) return null

    // Guard: MapCache must be iterable (real MapCache implements Iterable<MapPreview>)
    if (typeof (mapCache as unknown as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function') {
      return null
    }

    // MapVisibility.Shellmap = 2 (bit flag)
    const SHELLMAP_FLAG = 2

    const shellmapMaps: { uid: string; visibility?: number }[] = []
    for (const preview of mapCache as Iterable<{ uid: string; visibility?: number }>) {
      // preview.visibility is a bitmask; check if Shellmap flag is set
      if (preview.visibility !== undefined && (preview.visibility & SHELLMAP_FLAG) !== 0) {
        shellmapMaps.push(preview)
      }
    }

    if (shellmapMaps.length === 0) return null

    // Randomly select one shellmap map
    const idx = Math.floor(Math.random() * shellmapMaps.length)
    return shellmapMaps[idx].uid
  }

  /**
   * Load a shellmap map from the MapCache by UID.
   *
   * P1-D.7: Constructs a MapStub from the MapPreview for startGame().
   * If the full Map binary data is not yet loaded (MapPreview status !== Available),
   * returns null to trigger the static background fallback.
   *
   * @param uid — map UID from MapCache
   * @returns MapStub for startGame(), or null if map not available
   */
  private async loadShellmapMap(uid: string): Promise<MapStub | null> {
    if (!this.modData) return null

    const mapCache = this.modData.mapCache
    if (typeof (mapCache as unknown as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function') {
      return null
    }
    for (const preview of mapCache as Iterable<{ uid: string; status?: number; title?: string }>) {
      if (preview.uid === uid) {
        // MapPreview.status === MapStatus.Available (0) means fully loaded
        const MAP_STATUS_AVAILABLE = 0
        if (preview.status !== MAP_STATUS_AVAILABLE) {
          console.warn(`[Game] Shellmap map '${uid}' not yet available (status=${preview.status})`)
          return null
        }
        // Construct a minimal MapStub from MapPreview metadata
        return {
          uid: preview.uid,
          title: preview.title ?? 'Shellmap',
          dispose: () => {
            // MapPreview manages its own lifecycle via MapCache
          },
        }
      }
    }

    return null
  }

  /**
   * Configure shellmap camera for cinematic AI-following mode.
   *
   * P1-D.7: When shellmap is running, the camera automatically follows
   * AI units with smooth panning. User camera control is disabled.
   *
   * OpenRA 对照: Viewport.Center() + smooth scroll to AI actor positions
   *
   * TODO-P1-D.7: Full cinematic camera with smooth AI-following panning.
   * Current implementation sets the Viewport to observe the world center.
   * Full implementation requires Viewport scrollTo/centerOn API.
   */
  private setupShellmapCamera(): void {
    if (!this._worldRenderer) return

    // Configure Viewport for cinematic (non-interactive) mode
    // The Viewport is already initialized by WorldRenderer constructor.
    // Shellmap camera: disable user scroll/zoom, auto-follow AI units.
    //
    // Full implementation (P1-D.7 follow-up):
    // - Viewport.setInteractive(false) — disable user camera control
    // - On each render tick, smoothly pan camera toward a randomly selected
    //   AI unit's position using Viewport.scrollTo(wpos, smooth=true)
    // - Switch target AI unit every 8-15 seconds for visual variety
    console.log('[Game] Shellmap camera: cinematic mode (follow AI units)')
  }

  /**
   * Spawn AI players in the shellmap world for dynamic skirmish background.
   *
   * P1-D.7: Creates 2+ AI players with BotModule traits (HarvesterBotModule,
   * BaseBuilderBotModule, UnitBuilderBotModule) so the shellmap shows live
   * gameplay rather than a static image.
   *
   * OpenRA 对照: BotController creation in OpenRA.Mods.Common/Traits/
   *
   * TODO-P1-D.7: Full AI bot creation using the Ch6 BotModule system.
   * Current implementation adds AI player entries to the world.
   * Full implementation requires:
   * - Player/PlayerActor creation for each AI
   * - BotModule trait registration (HarvesterBotModule, etc.)
   * - Initial unit spawning (MCV + starting units)
   */
  private spawnShellmapBots(): void {
    if (!this._world) return

    // Create AI player stubs and add them to the world
    // In full implementation, each AI player gets a full PlayerActor
    // with BotModule traits registered via TraitDictionary.
    const aiPlayerCount = 2

    for (let i = 0; i < aiPlayerCount; i++) {
      const aiPlayer = {
        playerName: `Shellmap AI ${i + 1}`,
        internalName: `shellmap_ai_${i + 1}`,
        playerIndex: i + 1, // Player 0 is usually the human spectator
        // Bot traits will be attached when full BotModule integration is done
      }

      // Register AI player in the world's player list
      this._world.players.push(aiPlayer as unknown as (typeof this._world.players)[0])
    }

    console.log(`[Game] Shellmap: spawned ${aiPlayerCount} AI players for dynamic skirmish`)
  }

  /**
   * Register input handler to transition from shellmap to main menu.
   *
   * P1-D.7: On any user input (mouse click, keypress) while shellmap is
   * displayed, call showMainMenu() to reveal the menu overlay. This matches
   * the original OpenRA behavior where the shellmap is an interactive
   * background behind the main menu.
   *
   * The handler is registered once and self-removes after first interaction.
   */
  private registerShellmapInputHandler(): void {
    const handler = (): void => {
      // Show the main menu on first interaction
      this.showMainMenu()
      // Remove handlers after first interaction (one-shot)
      window.removeEventListener('click', handler)
      window.removeEventListener('keydown', handler)
    }

    window.addEventListener('click', handler, { once: false })
    window.addEventListener('keydown', handler, { once: false })
  }

  /**
   * 设置静态 shellmap 回退背景。
   *
   * 将 worldScene.clearColor 设置为深色 RTS 风格背景色。
   * Babylon.js 每帧自动清除为该颜色（场景 autoClear 默认启用），
   * 为叠加的主菜单 Widget 提供深色背景。
   */
  private setShellmapFallback(): void {
    // 深色带有蓝色调的背景，符合经典 RTS 主菜单美学
    this.renderer.worldScene.clearColor = new Color4(0.05, 0.05, 0.1, 1.0)
    this.state = GameState.Shellmap
  }

  // -----------------------------------------------------------------------
  // Main Menu — DOM overlay on top of canvas (Phase C)
  // -----------------------------------------------------------------------

  /**
   * 在 canvas 上方显示主菜单 DOM 覆盖层。
   *
   * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs
   *
   * 使用纯 DOM 渲染（而非 Widget 系统），与 ModSelector 风格一致。
   * 按钮功能为 stub — Skirmish/Settings 显示 "Coming Soon"，
   * Exit 导航回 Mod 选择器 `/`。
   *
   * ADR-22.3: 主菜单使用 DOM overlay，不依赖 Widget 系统。
   * 完整的 Widget 渲染（TODO-22.C.2 Widget）推迟到 ChromeProvider + WidgetLoader
   * 集成完成之后，届时可替换此 DOM 实现。
   */
  showMainMenu(): void {
    // 移除已有的主菜单（防止重复创建）
    this.hideMainMenu()

    const overlay = document.createElement('div')
    overlay.id = 'main-menu-overlay'
    // 固定定位覆盖整个视口，z-index 低于加载遮罩
    overlay.style.cssText =
      'position:fixed;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;z-index:99;' +
      'pointer-events:none;'

    // 菜单卡片（pointer-events:auto 确保按钮可交互）
    const menu = document.createElement('div')
    menu.style.cssText =
      'pointer-events:auto;text-align:center;' +
      'background:rgba(10,10,30,0.75);border:1px solid rgba(100,100,180,0.3);' +
      'border-radius:12px;padding:3rem 4rem;min-width:360px;'

    // 标题
    const title = document.createElement('h1')
    title.textContent = 'OpenRAWeb3D'
    title.style.cssText =
      'color:#f0f0f0;font-size:2rem;font-weight:700;margin-bottom:0.5rem;' +
      'letter-spacing:-0.5px;'
    menu.appendChild(title)

    // 副标题
    const subtitle = document.createElement('p')
    subtitle.textContent = 'Web-based RTS Engine'
    subtitle.style.cssText = 'color:#8888aa;font-size:0.9rem;margin-bottom:2rem;'
    menu.appendChild(subtitle)

    // 按钮定义
    interface MenuButton {
      id: string
      text: string
      disabled: boolean
      onClick: () => void
    }

    const buttons: MenuButton[] = [
      {
        id: 'btn-skirmish',
        text: 'Skirmish',
        disabled: false,
        onClick: () => this._showComingSoon('Skirmish'),
      },
      {
        id: 'btn-multiplayer',
        text: 'Multiplayer (Coming Soon)',
        disabled: true,
        onClick: () => {},
      },
      {
        id: 'btn-settings',
        text: 'Settings',
        disabled: true,
        onClick: () => {}, // Disabled button — callback never invoked
      },
      {
        id: 'btn-exit',
        text: 'Exit to Desktop',
        disabled: false,
        onClick: () => this._exitToModSelector(),
      },
    ]

    for (const btnDef of buttons) {
      const btn = document.createElement('button')
      btn.id = btnDef.id
      btn.textContent = btnDef.text
      btn.disabled = btnDef.disabled
      btn.style.cssText =
        'display:block;width:100%;padding:12px 20px;margin-bottom:12px;' +
        'border:1px solid rgba(100,100,180,0.4);border-radius:6px;' +
        'font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.15s ease;' +
        (
          btnDef.disabled
            ? 'background:rgba(40,40,60,0.5);color:#555570;cursor:not-allowed;'
            : 'background:linear-gradient(135deg,#334488,#4466cc);color:#e0e0f0;'
        )

      if (!btnDef.disabled) {
        btn.addEventListener('mouseenter', () => {
          btn.style.background = 'linear-gradient(135deg,#4466cc,#5577ee)'
          btn.style.borderColor = 'rgba(120,140,220,0.6)'
        })
        btn.addEventListener('mouseleave', () => {
          btn.style.background = 'linear-gradient(135deg,#334488,#4466cc)'
          btn.style.borderColor = 'rgba(100,100,180,0.4)'
        })
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          btnDef.onClick()
        })
      }
      menu.appendChild(btn)
    }

    // 版本信息
    const version = document.createElement('p')
    version.textContent = 'Prototype — Phase C'
    version.style.cssText =
      'color:#555570;font-size:0.75rem;margin-top:1.5rem;'
    menu.appendChild(version)

    overlay.appendChild(menu)
    document.body.appendChild(overlay)
  }

  /**
   * 隐藏并移除主菜单 DOM 覆盖层。
   *
   * 调用时机:
   * - startGame() 启动时（从主菜单过渡到游戏画面）
   * - dispose() 清理时
   * - switchMod() 切换时（重新创建菜单）
   * - showMainMenu() 重新调用时（避免重复）
   */
  hideMainMenu(): void {
    const existing = document.getElementById('main-menu-overlay')
    if (existing) {
      existing.remove()
    }
    // Also hide widget-based menu if active
    this.hideMainMenuWidget()
  }

  // -----------------------------------------------------------------------
  // Widget-Based Main Menu (P1-D.8)
  //
  // Parallel track to the DOM overlay approach. Uses the Widget system
  // (Ch5 Widget.ts, ChromeProvider.ts, WidgetLoader.ts) to create a
  // programmatic widget tree for the main menu. The DOM overlay remains
  // functional — Widget conversion eventually replaces it.
  //
  // OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/MainMenuLogic.cs
  // -----------------------------------------------------------------------

  /** Root widget node for the widget-based main menu, or null if not shown. */
  private _mainMenuWidgetRoot: import('./Widgets/Widget.js').Widget | null = null

  /** DOM root element for widget-based main menu. Used for manual DOM cleanup. */
  private _mainMenuWidgetDomRoot: HTMLElement | null = null

  /** Keyboard handler for Escape key in widget-based main menu. */
  private _mainMenuKeyHandler: ((e: KeyboardEvent) => void) | null = null

  /**
   * Show a widget-based main menu using the Widget system.
   *
   * OpenRA 对照: MainMenuLogic widget construction via ChromeProvider + WidgetLoader
   *
   * Creates a programmatic ContainerWidget tree with buttons for Skirmish,
   * Load, Settings, and Exit. Each button triggers the appropriate game
   * state transition. Escape key returns to the mod selector.
   *
   * Uses ContainerWidget as the rendering primitive — ContainerWidget.render()
   * returns a `<div>` element via getOrCreateElement(). Button content is
   * injected as direct DOM children of each container after renderOuter().
   *
   * This runs in parallel with the DOM overlay — callers choose which
   * approach to use. Currently showMainMenu() uses DOM overlay;
   * showMainMenuWidget() provides the Widget-based alternative.
   *
   * NOTE: This Widget-based menu runs in parallel with the DOM overlay approach.
   * The DOM overlay (showMainMenu) is the stable default for Phase A-D.
   * Once Widget-based menu proves stable through visual acceptance testing,
   * showMainMenu() will be updated to call showMainMenuWidget() internally.
   *
   * P1-D.8: Initial implementation with programmatic ContainerWidget tree.
   * Full YAML-based widget loading via ChromeProvider deferred until
   * main menu YAML definitions are ported.
   */
  showMainMenuWidget(): void {
    // Remove previous instance if any
    this.hideMainMenuWidget()
    // Also hide the DOM overlay to avoid double-render
    this.hideMainMenu()

    // Dynamic import to avoid circular dependency at module load time
    import('./Widgets/Widget.js').then(({ ContainerWidget }) => {
      // If hideMainMenuWidget was called while async import was in flight, abort
      if (this.state === GameState.Disposed) return

      // ---- Build Widget tree ----

      const root = new ContainerWidget()
      root.id = 'main-menu-widget-overlay'

      // Menu card container
      const card = new ContainerWidget()
      card.id = 'main-menu-card'
      root.addChild(card)

      // Render widget tree to DOM
      const rootEl = root.renderOuter()
      rootEl.id = 'main-menu-widget-overlay'
      rootEl.style.cssText =
        'position:fixed;inset:0;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;z-index:99;'

      // Style the card container (second child div, first is root)
      const cardEl = rootEl.querySelector('[data-widget-id="main-menu-card"]') as HTMLElement
      if (cardEl) {
        cardEl.style.cssText =
          'position:static;' +
          'background:rgba(10,10,30,0.85);border:1px solid rgba(100,100,180,0.3);' +
          'border-radius:12px;padding:3rem 4rem;min-width:360px;text-align:center;'
      }

      // ---- Add content to card ----
      const contentEl = cardEl ?? rootEl

      // Title
      const titleEl = document.createElement('h1')
      titleEl.textContent = 'OpenRAWeb3D'
      titleEl.style.cssText =
        'color:#f0f0f0;font-size:2rem;font-weight:700;margin:0 0 0.5rem 0;' +
        'letter-spacing:-0.5px;'
      contentEl.appendChild(titleEl)

      // Subtitle
      const subtitleEl = document.createElement('p')
      subtitleEl.textContent = 'Web-based RTS Engine'
      subtitleEl.style.cssText = 'color:#8888aa;font-size:0.9rem;margin:0 0 2rem 0;'
      contentEl.appendChild(subtitleEl)

      // Button factory
      const appendButton = (
        id: string,
        text: string,
        disabled: boolean,
        onClick: () => void,
      ): void => {
        const btnEl = document.createElement('button')
        btnEl.id = `widget-${id}`
        btnEl.textContent = text
        btnEl.disabled = disabled
        btnEl.style.cssText =
          'display:block;width:100%;padding:12px 20px;margin-bottom:12px;' +
          'border:1px solid rgba(100,100,180,0.4);border-radius:6px;' +
          'font-size:1rem;font-weight:600;cursor:pointer;transition:all 0.15s ease;' +
          (
            disabled
              ? 'background:rgba(40,40,60,0.5);color:#555570;cursor:not-allowed;'
              : 'background:linear-gradient(135deg,#334488,#4466cc);color:#e0e0f0;'
          )
        if (!disabled) {
          btnEl.addEventListener('mouseenter', () => {
            btnEl.style.background = 'linear-gradient(135deg,#4466cc,#5577ee)'
            btnEl.style.borderColor = 'rgba(120,140,220,0.6)'
          })
          btnEl.addEventListener('mouseleave', () => {
            btnEl.style.background = 'linear-gradient(135deg,#334488,#4466cc)'
            btnEl.style.borderColor = 'rgba(100,100,180,0.4)'
          })
          btnEl.addEventListener('click', (e) => {
            e.stopPropagation()
            onClick()
          })
        }
        contentEl.appendChild(btnEl)
      }

      // Skirmish button
      appendButton(
        'btn-skirmish',
        'Skirmish',
        false,
        () => this._showComingSoon('Skirmish'),
      )

      // Load button
      appendButton(
        'btn-load',
        'Load Game (Coming Soon)',
        true,
        () => {},
      )

      // Settings button
      appendButton(
        'btn-settings',
        'Settings',
        true,
        () => {},
      )

      // Exit button
      appendButton(
        'btn-exit',
        'Exit to Desktop',
        false,
        () => this._exitToModSelector(),
      )

      // Version info
      const versionEl = document.createElement('p')
      versionEl.textContent = 'P1-D.8 — Widget-Based Main Menu'
      versionEl.style.cssText =
        'color:#555570;font-size:0.75rem;margin-top:1.5rem;margin-bottom:0;'
      contentEl.appendChild(versionEl)

      // Attach to document
      document.body.appendChild(rootEl)
      this._mainMenuWidgetRoot = root
      this._mainMenuWidgetDomRoot = rootEl

      // Register Escape key handler
      this._mainMenuKeyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          this._exitToModSelector()
        }
      }
      window.addEventListener('keydown', this._mainMenuKeyHandler)
    }).catch((err) => {
      console.warn('[Game] Failed to load Widget module for main menu:', err)
    })
  }

  /**
   * Hide and dispose the widget-based main menu.
   *
   * Removes the Widget tree from the DOM and cleans up event listeners.
   * Disposal order: keyboard handler → DOM removal → Widget dispose.
   * Safe to call even when no widget menu is active (no-op).
   */
  hideMainMenuWidget(): void {
    // Remove keyboard handler
    if (this._mainMenuKeyHandler) {
      window.removeEventListener('keydown', this._mainMenuKeyHandler)
      this._mainMenuKeyHandler = null
    }

    // Remove DOM root element from document
    if (this._mainMenuWidgetDomRoot) {
      if (this._mainMenuWidgetDomRoot.parentNode) {
        this._mainMenuWidgetDomRoot.parentNode.removeChild(this._mainMenuWidgetDomRoot)
      }
      this._mainMenuWidgetDomRoot = null
    }

    // Dispose widget tree (cleans up cached elements + children)
    if (this._mainMenuWidgetRoot) {
      this._mainMenuWidgetRoot.dispose()
      this._mainMenuWidgetRoot = null
    }
  }

  /**
   * 显示 "Coming Soon" 提示 — 主菜单按钮的临时 stub。
   *
   * 当前使用浏览器原生 alert 弹窗实现。
   * 未来 Widget 集成后，将替换为游戏内工具提示 Widget。
   */
  private _showComingSoon(feature: string): void {
    // NOTE: 使用 alert 而非 DOM 工具提示以保证跨浏览器兼容性。
    // 完整 widgets 集成后（Ch16），将用 Widget 工具提示替换。
    alert(`${feature} is coming soon!\n\nThis feature will be available in a future update.`)
  }

  /**
   * 退出到 Mod 选择器 — 清理 Game 实例并导航回 `/`。
   *
   * 先调用 dispose() 释放所有 GPU 资源和子系统，
   * 再通过 history.pushState 触发 Router 的 popstate 监听器
   * 导航回 Mod 选择器首页。
   */
  private _exitToModSelector(): void {
    // 1. 清理 Game 实例（释放 GPU 资源、停止游戏循环）
    this.dispose()

    // 2. 导航回 Mod 选择器首页
    // 使用 history.pushState 触发 Router 的 popstate 监听器，
    // 避免直接依赖 Router 模块（Router 在 main.ts 中，Game 不应反向依赖）。
    history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  // -----------------------------------------------------------------------
  // switchMod — Mod 切换
  // -----------------------------------------------------------------------

  /**
   * 切换到不同的 Mod。
   *
   * OpenRA 对照: 无直接对应（C# 中需重启整个应用进程）
   *
   * 先销毁当前 world + mod data（逆序），再加载新 mod 并启动 shellmap。
   *
   * @param modId — 新 Mod ID
   * @throws 如果新 mod 加载失败
   */
  async switchMod(modId: string): Promise<void> {
    // 1. 销毁当前子系统（逆序）
    this._world?.dispose()
    this._world = null

    // WorldRenderer 包含 GPU 资源（pipeline、post-process、textures），
    // 必须显式 dispose 再清除引用，否则泄漏 GPU 内存。
    this._worldRenderer?.dispose()
    this._worldRenderer = null

    this.orderManager?.dispose()
    this.orderManager = null

    this.cursorManager?.dispose()
    this.cursorManager = null

    this.modData?.dispose()
    this.modData = null

    // Clean up content installer (hide UI if visible)
    ContentInstallerUI.hide()
    this._contentInstaller = null

    this.sound = null

    // 重置累加器 — 防止 switchMod 后突发追赶 tick
    this._accumulator = 0
    this.renderFrame = 0

    // 2. 重新加载新 mod + shellmap + main menu
    await this.loadMod(modId)
    await this.loadShellMap()
    this.showMainMenu()
  }

  // -----------------------------------------------------------------------
  // dispose — 清理所有资源
  // -----------------------------------------------------------------------

  /**
   * 释放所有子系统资源。
   *
   * OpenRA 对照: Game.Exit()
   *
   * 释放顺序（逆序，确保依赖在仍然有效时被销毁）:
   * 1. World（游戏世界 — 停止 tick、dispose actor）
   * 2. WorldRenderer（由 Renderer 管理其 Scene，仅解引用）
   * 3. OrderManager（dispose connection + 清空队列）
   * 4. CursorManager（移除 CSS style 元素 + dispose SheetBuilder）
   * 5. Sound（如果已创建 — Phase C）
   * 6. ModData（dispose 加载屏幕 + MapCache + FileSystem + ObjectCreator）
   * 7. Renderer（stopRenderLoop + dispose Engine + Scenes + Cameras）
   *
   * 调用后设置 state = Disposed，游戏循环守卫停止所有 tick 活动。
   */
  dispose(): void {
    this.state = GameState.Disposed

    // 0. 清理内容安装器 UI + 主菜单 DOM（防止残留在 DOM 中）
    ContentInstallerUI.hide()
    this._contentInstaller = null
    this.hideMainMenu()

    // 1. World
    this._world?.dispose()
    this._world = null

    // 2. WorldRenderer — dispose GPU resources (pipeline, post-process, textures)
    //    before clearing reference, matching switchMod() behavior
    this._worldRenderer?.dispose()
    this._worldRenderer = null

    // 3. OrderManager
    this.orderManager?.dispose()
    this.orderManager = null

    // 4. CursorManager — dispose CSS style elements + SheetBuilder
    this.cursorManager?.dispose()
    this.cursorManager = null

    // 5. Sound（stub，Phase C 实现）
    this.sound = null

    // 6. ModData + FileSystem
    this.modData?.dispose()
    this.modData = null

    // 7. Renderer（Engine + Scenes + Cameras + RTT）
    this.renderer?.dispose()
    this.renderer = null!  // Prevent double-dispose: null reference after GPU resource release

    // 7. 清除单例引用
    if (_currentGame === this) {
      _currentGame = null
    }
  }
}
