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
import { GameWorldManager, WorldType } from './World.js'
import type { MapStub } from './World.js'
import type { WorldRendererStub } from './Traits/TraitsInterfaces.js'
import { WorldRenderer } from './Graphics/WorldRenderer.js'
import type { IWorld } from './Graphics/WorldRenderer.js'
import { EchoConnection } from './Network/Connection.js'
import { OrderManager } from './Network/OrderManager.js'
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

    // 5. 加载 RuleSet
    await this.modData.loadRuleSet()

    // 6. 创建 OrderManager（本地单人模式）
    const connection = new EchoConnection()
    this.orderManager = new OrderManager(connection)

    // TODO-22.C: Create CursorManager
    // OpenRA C# InitializeMod() creates a CursorManager here, which manages
    // hardware cursor sprites and palette. The TS CursorManager consumes
    // SheetBuilder + HardwarePalette resources. Implement in Phase C when
    // the main menu widget shell is created.

    // NOTE: Sound 初始化推迟到 Phase C。
    // Sound 需要 ISoundEngine + SoundSettings + FileSystem 设置，
    // 这些依赖在 Phase C 主菜单阶段才就绪。
    // this.sound = new Sound(...)

    this.state = GameState.Shellmap
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
    // NOTE: 类型断言 — GameWorldManager 通过 `as unknown as IWorld` 桥接。
    // IWorld 接口要求 14 个属性（tileSize, tileScale, type, disposed,
    // renderPlayer, localPlayer, players, worldActor, screenMap,
    // unpartitionedEffects, effects, orderGenerator, selection, 及方法）。
    // GameWorldManager 已提供 tileSize / type / disposed / worldActor；
    // renderPlayer / localPlayer / screenMap / effects / selection 在
    // Phase C-E 中将逐步对齐。
    // TODO-22.D: 使 GameWorldManager 直接实现 IWorld 接口，消除此类型断言。
    this._worldRenderer = new WorldRenderer(
      this.renderer,
      this._world as unknown as IWorld,
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
   * Phase 1 回退: 设置静态深色背景色。
   * 不创建 World 或加载地图 — 仅设置 `worldScene.clearColor`。
   * 主菜单 Widget（Phase C）将渲染在 uiScene 中，覆盖此背景。
   *
   * ADR-22.5: Shellmap 分阶段部署。
   * Phase 2: 预渲染地图图像（待实现）。
   * Phase 3: 完整动态 AI skirmish shellmap（待实现）。
   */
  async loadShellMap(): Promise<void> {
    // Phase 1: 静态深色 RTS 风格背景
    // NOTE: ADR-22.5 — 深色带有蓝色调的背景，符合经典 RTS 主菜单美学。
    // clearColor 由 Babylon.js 每帧自动应用（场景 autoClear 默认启用）。
    this.renderer.worldScene.clearColor = new Color4(0.05, 0.05, 0.1, 1.0)

    this.state = GameState.Shellmap
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

    this.modData?.dispose()
    this.modData = null

    this.sound = null

    // 重置累加器 — 防止 switchMod 后突发追赶 tick
    this._accumulator = 0
    this.renderFrame = 0

    // 2. 重新加载新 mod + shellmap
    await this.loadMod(modId)
    await this.loadShellMap()
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
   * 4. Sound（如果已创建 — Phase C）
   * 5. ModData（dispose 加载屏幕 + MapCache + FileSystem + ObjectCreator）
   * 6. Renderer（stopRenderLoop + dispose Engine + Scenes + Cameras）
   *
   * 调用后设置 state = Disposed，游戏循环守卫停止所有 tick 活动。
   */
  dispose(): void {
    this.state = GameState.Disposed

    // 1. World
    this._world?.dispose()
    this._world = null

    // 2. WorldRenderer — 其 Scene 由 Renderer 管理，仅清除引用
    this._worldRenderer = null

    // 3. OrderManager
    this.orderManager?.dispose()
    this.orderManager = null

    // 4. Sound（stub，Phase C 实现）
    this.sound = null

    // 5. ModData + FileSystem
    this.modData?.dispose()
    this.modData = null

    // 6. Renderer（Engine + Scenes + Cameras + RTT）
    this.renderer?.dispose()
    this.renderer = null!  // Prevent double-dispose: null reference after GPU resource release

    // 7. 清除单例引用
    if (_currentGame === this) {
      _currentGame = null
    }
  }
}
