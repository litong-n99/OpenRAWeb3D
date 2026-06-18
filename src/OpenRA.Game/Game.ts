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
   * ADR-22.5: Shellmap 分阶段部署。
   * Phase 1: 静态深色背景色（当前实现）。
   * Phase 2: 预渲染地图图像（待实现）。
   * Phase 3: 完整动态 AI skirmish shellmap（待实现，依赖地图缓存填充 TODO-22.E）。
   *
   * 策略:
   * - 地图缓存为空 → setShellmapFallback()（Phase 1 静态背景）
   * - 地图缓存有数据 → chooseShellmap() 尝试选择 shellmap 标记的地图
   *   → 成功则 startGame(shellmapMap, Shellmap)
   *   → 失败则回退到 setShellmapFallback()
   */
  async loadShellMap(): Promise<void> {
    // Phase 1: 静态背景（当地图缓存为空时总是有效）
    if (!this.modData) {
      this.setShellmapFallback()
      return
    }

    // Phase 3 (future): 完整动态 shellmap
    // TODO-22.E: 当地图加载到 MapCache 中时，筛选标记为 shellmap 的地图
    // 并随机选择一个调用 startGame(map, Shellmap)。
    // 如果 shellmap 加载失败（缺少资产、规则等），捕获错误并回退。
    try {
      const shellmapUid = this.chooseShellmap()
      if (shellmapUid) {
        // TODO-22.E: Load map from MapCache by UID, then:
        //   await this.startGame(mapStub, WorldType.Shellmap)
        //   return
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
   * OpenRA 对照: LoadShellMap 中的隐式选择逻辑
   *
   * Phase 1: 地图缓存始终为空 → 总是返回 null。
   * Phase 3 (TODO-22.E): 筛选标记为 "shellmap" 的地图预览，
   * 随机选择一个并返回其 UID。
   *
   * @returns shellmap 地图 UID，如果没有可用 shellmap 则返回 null
   */
  private chooseShellmap(): string | null {
    if (!this.modData) return null

    // TODO-22.E: Map cache populated → iterate MapCache, filter by shellmap flag
    // Implementation sketch:
    //   const shellmaps = [...this.modData.mapCache].filter(p => p.shellmap)
    //   if (shellmaps.length === 0) return null
    //   return shellmaps[Math.floor(Math.random() * shellmaps.length)].uid
    return null
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
        onClick: () => this._showComingSoon('Settings'),
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
  }

  /**
   * 显示 "Coming Soon" 提示 — 主菜单按钮的临时 stub。
   *
   * 使用 runAfterTick 延迟执行以确保 DOM 更新不与渲染循环冲突。
   */
  private _showComingSoon(feature: string): void {
    // NOTE: 使用 alert 而非 DOM 工具提示以保证跨浏览器兼容性。
    // 完整 widgets 集成后（Ch5 Phase D），将用 Widget 工具提示替换。
    alert(`${feature} is coming soon!\n\nThis feature will be available in a future update.`)
  }

  /**
   * 退出到 Mod 选择器 — 导航回 `/`。
   *
   * 使用 history.pushState 触发 Router 的 popstate 监听器。
   */
  private _exitToModSelector(): void {
    // 动态导入 Router 以避免循环依赖（Router 在 main.ts 中使用 ModSelector，
    // 而 Game 不应直接依赖 Router）。
    // 直接使用 history.pushState 并分发 popstate 事件。
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

    this.modData?.dispose()
    this.modData = null

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
   * 4. Sound（如果已创建 — Phase C）
   * 5. ModData（dispose 加载屏幕 + MapCache + FileSystem + ObjectCreator）
   * 6. Renderer（stopRenderLoop + dispose Engine + Scenes + Cameras）
   *
   * 调用后设置 state = Disposed，游戏循环守卫停止所有 tick 活动。
   */
  dispose(): void {
    this.state = GameState.Disposed

    // 0. 清理主菜单 DOM（防止残留在 DOM 中）
    this.hideMainMenu()

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
