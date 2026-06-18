/**
 * DebugVisualizationCommands.ts — 调试可视化控制台命令
 * OpenRA 对照: OpenRA.Mods.Common/Commands/DebugVisualizationCommands.cs (155 lines)
 *
 * 核心范式转换:
 * - C# IChatCommand + IWorldLoaded trait → TS 显式命令注册 + WorldLoaded 适配
 * - C# ChatCommands.RegisterCommand / HelpCommand.RegisterHelp → TS CommandRegistry 接口
 * - C# TextNotificationsManager + FluentProvider → TODO: 集成通知系统
 * - C# DebugVisualizations trait → 本地接口桩（等待  完整实现）
 *
 * 每个命令切换 DebugVisualizations 上的一个布尔标志。
 * 命令在 WorldLoaded 期间注册，由聊天控制台解析器调用。
 */

// NOTE: IGameActor 从 TraitsInterfaces 导入（非 Actor.js），
// 以避免与 GameActor 类的循环依赖。

import type { ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// DebugVisualizationCommandsInfo — trait 配置标记（对应 OpenRA TraitInfo<DebugVisualizationCommands>）
// ---------------------------------------------------------------------------

/**
 * Trait 配置，用于将 DebugVisualizationCommands 附加到 WorldActor。
 *
 * OpenRA 对照: DebugVisualizationCommandsInfo : TraitInfo<DebugVisualizationCommands>
 *
 * 在 C# 中，此 TraitInfo 通过反射创建 trait 实例。
 * 在 TS 中，它是一个标记类，指示 WorldActor 应接收此 trait。
 *
 * @todo 当完整的 TraitInfo 注册系统（）可用时集成。
 */
export class DebugVisualizationCommandsInfo implements ITraitInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }
}

// ---------------------------------------------------------------------------
// DebugVisualizations — 调试可视化状态接口（对应 OpenRA DebugVisualizations trait）
// ---------------------------------------------------------------------------

/**
 * 调试可视化覆盖层的状态标志接口。
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/DebugVisualizations.cs
 *
* 此接口是完整 DebugVisualizations 实现的桩。
 * 当  完成时，替换为完整的 trait 实现，该实现
 * 还包含 render() 方法和 Babylon.js UtilityLayerRenderer 覆盖层。
 */
export interface DebugVisualizations {
  /** 战斗几何覆盖（武器范围、阻挡）。对应: DebugVisualizations.CombatGeometry */
  combatGeometry: boolean

  /** 渲染几何覆盖（足迹、包围盒）。对应: DebugVisualizations.RenderGeometry */
  renderGeometry: boolean

  /** 屏幕地图覆盖。对应: DebugVisualizations.ScreenMap */
  screenMap: boolean

  /** 深度缓冲可视化。对应: DebugVisualizations.DepthBuffer */
  depthBuffer: boolean

  /** 角色标签覆盖。对应: DebugVisualizations.ActorTags */
  actorTags: boolean
}

// ---------------------------------------------------------------------------
// CommandRegistry — 聊天命令注册接口（对应 OpenRA ChatCommands / HelpCommand）
// ---------------------------------------------------------------------------

/**
 * 聊天命令注册器的最小接口。
 *
 * OpenRA 对照: ChatCommands + HelpCommand
 *
 * 当聊天控制台系统完全迁移后（），此接口将被替换为
 * 完整的 CommandRegistry，具备参数验证、帮助文本和自动补全支持。
 *
 * @todo 集成聊天控制台系统后，连接完整的 ChatCommands trait。
 */
export interface CommandRegistry {
  /**
   * 注册一个聊天命令。
   *
   * OpenRA 对照: ChatCommands.RegisterCommand(string, IChatCommand)
   *
   * @param name — 命令调用名称（例如 "combat-geometry"）
   * @param handler — 处理命令调用的 IChatCommand 实例
   */
  registerCommand(name: string, handler: CommandHandler): void

  /**
   * 注册命令的帮助文本。
   *
   * OpenRA 对照: HelpCommand.RegisterHelp(string, string)
   *
   * @param name — 命令名称
   * @param description — 人类可读的描述
   */
  registerHelp(name: string, description: string): void
}

// ---------------------------------------------------------------------------
// CommandHandler — 聊天命令处理函数签名
// ---------------------------------------------------------------------------

/**
 * 聊天命令处理函数。
 *
 * OpenRA 对照: IChatCommand.InvokeCommand(string, string)
 *
 * @param name — 被调用的命令名称
 * @param arg — 命令名称之后的参数字符串（可能为空）
 */
export type CommandHandler = (name: string, arg: string) => void

// ---------------------------------------------------------------------------
// DebugVisualizationCommands — 调试可视化命令注册器
// OpenRA 对照: DebugVisualizationCommands : IChatCommand, IWorldLoaded
// ---------------------------------------------------------------------------

/**
 * 每种调试覆盖类型的命令定义。
 *
 * OpenRA 对照: DebugVisualizationCommands.commandHandlers Dictionary
 */
interface DebugCommandDef {
  /** 切换该覆盖的静态处理函数。对应值元组 .Handler */
  handler: (debugVis: DebugVisualizations) => void
  /** 获取当前状态的函数。对应值元组 .GetState */
  getState: (debugVis: DebugVisualizations) => boolean
}

/**
 * 暴露聊天控制台命令以切换调试可视化覆盖层。
 *
 * OpenRA 对照: DebugVisualizationCommands
 *
 * 命令在构造时注册，由聊天控制台解析器在玩家
 * 输入 "/debug <name>" 时调用。
 *
 * 用法:
 * ```
 * const cmd = new DebugVisualizationCommands(debugVis, devMode, playerName)
 * cmd.registerCommands(registry)  // 在 WorldLoaded 期间调用
 * // 随后由聊天控制台调用:
 * cmd.invokeCommand("combat-geometry", "")
 * ```
 */
export class DebugVisualizationCommands {
  /** 通知键 — 作弊已禁用。OpenRA 对照: CheatsDisabled */
  static readonly cheatsDisabled = 'notification-cheats-disabled'

  /** 通知键 — 作弊已启用。OpenRA 对照: CheatEnabled */
  static readonly cheatEnabled = 'notification-cheat-enabled'

  /** 通知键 — 作弊已禁用。OpenRA 对照: CheatDisabled */
  static readonly cheatDisabled = 'notification-cheat-disabled'

  // -----------------------------------------------------------------------
  // 命令常量（对应 OpenRA DebugVisualizationCommands.Commands / Orders）
  // -----------------------------------------------------------------------

  /** 聊天命令名称。OpenRA 对照: DebugVisualizationCommands.Commands */
  static readonly Commands = {
    CombatGeometry: 'combat-geometry',
    RenderGeometry: 'render-geometry',
    ScreenMap: 'screen-map',
    DepthBuffer: 'depth-buffer',
    ActorTags: 'actor-tags',
  } as const

  /** 订单字符串。OpenRA 对照: DebugVisualizationCommands.Orders */
  static readonly Orders = {
    CombatGeometry: 'DevCombatGeometry',
    RenderGeometry: 'DevRenderGeometry',
    ScreenMap: 'DevScreenMap',
    DepthBuffer: 'DevDepthBuffer',
    ActorTags: 'DevActorTags',
  } as const

  /** 命令描述键（Fluent 引用）。OpenRA 对照: FluentProvider.GetMessage 键 */
  static readonly Descriptions = {
    CombatGeometry: 'description-combat-geometry',
    RenderGeometry: 'description-render-geometry',
    ScreenMap: 'description-screen-map-overlay',
    DepthBuffer: 'description-depth-buffer',
    ActorTags: 'description-actor-tags-overlay',
  } as const

  // -----------------------------------------------------------------------
  // 命令定义（对应 OpenRA commandHandlers 字典）
  // -----------------------------------------------------------------------

  /**
   * 从命令名称映射到其处理函数和状态获取器。
   *
   * OpenRA 对照: commandHandlers Dictionary<string, (Description, Handler, CheatName, GetState)>
   */
  private readonly commandDefs: ReadonlyMap<string, DebugCommandDef>

  // -----------------------------------------------------------------------
  // 实例状态
  // -----------------------------------------------------------------------

  /** 被控制的调试可视化实例。OpenRA 对照: debugVis */
  private debugVis: DebugVisualizations | null = null

  /** 开发者模式 trait。OpenRA 对照: devMode */
  private devMode: { enabled: boolean } | null = null

  /** 本地玩家名称（用于通知）。OpenRA 对照: world.LocalPlayer.ResolvedPlayerName */
  private playerName: string = ''

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  /**
   * 创建 DebugVisualizationCommands 实例。
   *
   * OpenRA 对照: DebugVisualizationCommands 构造函数
   *
   * @param debugVis — 要切换的 DebugVisualizations 实例
   * @param devMode — 用于权限检查的 DeveloperMode trait
   * @param playerName — 本地玩家名称（用于通知）
   */
  constructor(
    debugVis?: DebugVisualizations,
    devMode?: { enabled: boolean } | null,
    playerName?: string,
  ) {
    this.debugVis = debugVis ?? null
    this.devMode = devMode ?? null
    this.playerName = playerName ?? ''

    // 构建命令定义映射
    const defs = new Map<string, DebugCommandDef>()
    defs.set(DebugVisualizationCommands.Commands.CombatGeometry, {
      handler: DebugVisualizationCommands.toggleCombatGeometry,
      getState: (d: DebugVisualizations) => d.combatGeometry,
    })
    defs.set(DebugVisualizationCommands.Commands.RenderGeometry, {
      handler: DebugVisualizationCommands.toggleRenderGeometry,
      getState: (d: DebugVisualizations) => d.renderGeometry,
    })
    defs.set(DebugVisualizationCommands.Commands.ScreenMap, {
      handler: DebugVisualizationCommands.toggleScreenMap,
      getState: (d: DebugVisualizations) => d.screenMap,
    })
    defs.set(DebugVisualizationCommands.Commands.DepthBuffer, {
      handler: DebugVisualizationCommands.toggleDepthBuffer,
      getState: (d: DebugVisualizations) => d.depthBuffer,
    })
    defs.set(DebugVisualizationCommands.Commands.ActorTags, {
      handler: DebugVisualizationCommands.toggleActorTags,
      getState: (d: DebugVisualizations) => d.actorTags,
    })
    this.commandDefs = defs
  }

  // -----------------------------------------------------------------------
  // WorldLoaded — 在聊天控制台中注册命令（对应 OpenRA WorldLoaded）
  // -----------------------------------------------------------------------

  /**
   * 向命令注册表注册所有调试可视化命令。
   *
   * OpenRA 对照: DebugVisualizationCommands.WorldLoaded(World, WorldRenderer)
   *
   * 在游戏世界加载期间调用。注册每个命令及其帮助文本。
   * 如果 DebugVisualizations 或 DeveloperMode 不可用，则静默跳过。
   *
   * @param registry — 用于注册的命令注册表
   * @param enableDepthBuffer — 是否允许深度缓冲命令（map 网格依赖）
   */
  registerCommands(registry: CommandRegistry, enableDepthBuffer: boolean = false): void {
    if (!this.debugVis || !this.devMode) return

    for (const [name] of this.commandDefs) {
      // 如果地图不支持深度缓冲，则跳过深度缓冲命令
      if (name === DebugVisualizationCommands.Commands.DepthBuffer && !enableDepthBuffer) {
        continue
      }

      registry.registerCommand(name, (cmdName: string, _arg: string) => {
        this.invokeCommand(cmdName, _arg)
      })
      registry.registerHelp(name, this.getDescription(name))
    }
  }

  // -----------------------------------------------------------------------
  // InvokeCommand — 命令分发（对应 OpenRA IChatCommand.InvokeCommand）
  // -----------------------------------------------------------------------

  /**
   * 调用一个调试可视化命令。
   *
   * OpenRA 对照: DebugVisualizationCommands.InvokeCommand(string, string)
   *
   * 根据名称查找命令，检查 dev 模式权限，
   * 切换相应的调试标志，并发送通知。
   *
   * @param name — 命令名称（例如 "combat-geometry"）
   * @param _arg — 未使用（参数被忽略用于调试切换命令）
   */
  invokeCommand(name: string, _arg: string): void {
    const def = this.commandDefs.get(name)
    if (!def) return

    // 检查开发者模式权限
    if (!this.devMode || !this.devMode.enabled) {
      this.sendNotification(DebugVisualizationCommands.cheatsDisabled, false, name)
      return
    }

    if (!this.debugVis) return

    // 执行切换
    def.handler(this.debugVis)

    // 发送启用/禁用通知
    const newState = def.getState(this.debugVis)
    this.sendNotification(
      newState
        ? DebugVisualizationCommands.cheatEnabled
        : DebugVisualizationCommands.cheatDisabled,
      newState,
      name,
    )
  }

  // -----------------------------------------------------------------------
  // 静态切换处理函数（对应 OpenRA static CombatGeometry() 等）
  // -----------------------------------------------------------------------

  /**
   * 切换战斗几何覆盖。
   *
   * OpenRA 对照: DebugVisualizationCommands.CombatGeometry(DebugVisualizations)
   */
  static toggleCombatGeometry(debugVis: DebugVisualizations): void {
    debugVis.combatGeometry = !debugVis.combatGeometry
  }

  /**
   * 切换渲染几何覆盖。
   *
   * OpenRA 对照: DebugVisualizationCommands.RenderGeometry(DebugVisualizations)
   */
  static toggleRenderGeometry(debugVis: DebugVisualizations): void {
    debugVis.renderGeometry = !debugVis.renderGeometry
  }

  /**
   * 切换屏幕地图覆盖。
   *
   * OpenRA 对照: DebugVisualizationCommands.ScreenMap(DebugVisualizations)
   */
  static toggleScreenMap(debugVis: DebugVisualizations): void {
    debugVis.screenMap = !debugVis.screenMap
  }

  /**
   * 切换深度缓冲可视化。
   *
   * OpenRA 对照: DebugVisualizationCommands.DepthBuffer(DebugVisualizations)
   */
  static toggleDepthBuffer(debugVis: DebugVisualizations): void {
    debugVis.depthBuffer = !debugVis.depthBuffer
  }

  /**
   * 切换角色标签覆盖。
   *
   * OpenRA 对照: DebugVisualizationCommands.ActorTags(DebugVisualizations)
   */
  static toggleActorTags(debugVis: DebugVisualizations): void {
    debugVis.actorTags = !debugVis.actorTags
  }

  // -----------------------------------------------------------------------
  // 辅助方法
  // -----------------------------------------------------------------------

  /**
   * 获取给定命令名称的人类可读描述。
   *
   * OpenRA 对照: commandHandlers[].Description
   *
   * @param name — 命令名称
   * @returns 描述字符串（如果命令未知，则返回回退值）
   */
  getDescription(name: string): string {
    const descMap: Record<string, string> = {
      [DebugVisualizationCommands.Commands.CombatGeometry]:
        DebugVisualizationCommands.Descriptions.CombatGeometry,
      [DebugVisualizationCommands.Commands.RenderGeometry]:
        DebugVisualizationCommands.Descriptions.RenderGeometry,
      [DebugVisualizationCommands.Commands.ScreenMap]:
        DebugVisualizationCommands.Descriptions.ScreenMap,
      [DebugVisualizationCommands.Commands.DepthBuffer]:
        DebugVisualizationCommands.Descriptions.DepthBuffer,
      [DebugVisualizationCommands.Commands.ActorTags]:
        DebugVisualizationCommands.Descriptions.ActorTags,
    }
    return descMap[name] ?? name
  }

  /**
   * 枚举所有注册的命令名称。
   *
   * @returns 命令名称的可迭代对象
   */
  getCommandNames(): IterableIterator<string> {
    return this.commandDefs.keys()
  }

  /**
   * 发送调试通知。
   *
   * OpenRA 对照: SendNotification(bool, string)
   *
* 当 FluentProvider / TextNotificationsManager 可用时集成。
   * 目前使用 console.debug 作为后备。
   *
   * @param notificationKey — Fluent 消息键
   * @param enabled — 切换是启用还是禁用状态
   * @param cheatName — 作弊命令名称
   */
  private sendNotification(
    _notificationKey: string,
    enabled: boolean,
    cheatName: string,
  ): void {
    // 集成 TextNotificationsManager.Debug() + FluentProvider.GetMessage()
    const stateLabel = enabled ? 'enabled' : 'disabled'
    const playerLabel = this.playerName ? ` (${this.playerName})` : ''
    console.debug(
      `[DebugVisualization] ${cheatName}: ${stateLabel}${playerLabel}`,
    )
  }
}
