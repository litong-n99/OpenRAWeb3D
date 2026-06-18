/**
 * DevCommands.ts — 开发者作弊控制台命令
 * OpenRA 对照: OpenRA.Mods.Common/Commands/DevCommands.cs (318 lines)
 *
 * 核心范式转换:
 * - C# IChatCommand + IWorldLoaded trait → TS 显式命令注册 + WorldLoaded 适配
 * - C# Order(IssueOrder) → TS OrderStub + World.issueOrder()
 * - C# TextNotificationsManager + FluentProvider → TODO: 集成通知系统
 * - C# DeveloperMode.Orders 常量 → 本地常量和接口桩
 * - C# GainsExperience.CommandName/OrderName, PowerManager.CommandName/OrderName → TS 常量化
 *
 * 所有命令在调用前检查 DeveloperMode.Enabled。
 * 命令通过 WorldLoaded 向聊天控制台注册，由聊天解析器调用。
 */

import type { IGameActor, ITraitInfo } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { IActorRef } from '../../OpenRA.Game/Traits/IActorRef.js'
import type { OrderStub } from '../../OpenRA.Game/World.js'
import { Target } from '../../OpenRA.Game/Traits/Target.js'
import type { CommandRegistry } from './DebugVisualizationCommands.js'

// ---------------------------------------------------------------------------
// DevCommandsInfo — trait 配置标记（对应 OpenRA TraitInfo<DevCommands>）
// ---------------------------------------------------------------------------

/**
 * Trait 配置，用于将 DevCommands 附加到 WorldActor。
 *
 * OpenRA 对照: DevCommandsInfo : TraitInfo<DevCommands>
 *
 * 在 C# 中，此 TraitInfo 通过反射创建 trait 实例。
 * 在 TS 中，它是一个标记类，指示 WorldActor 应接收此 trait。
 *
 * @todo 当完整的 TraitInfo 注册系统（TODO-3.C.1）可用时集成。
 */
export class DevCommandsInfo implements ITraitInfo {
  readonly instanceName?: string

  constructor(params: { instanceName?: string } = {}) {
    this.instanceName = params.instanceName
  }
}

// ---------------------------------------------------------------------------
// DeveloperModeStub — 开发者模式的最小接口（对应 OpenRA DeveloperMode）
// ---------------------------------------------------------------------------

/**
 * DeveloperMode trait 的最小接口，用于命令权限门控。
 *
 * OpenRA 对照: OpenRA.Mods.Common/Traits/Player/DeveloperMode.cs
 *
 * 现有 DeveloperMode stub（src/OpenRA.Mods.Common/Traits/Player/DeveloperMode.ts）
 * 缺少 Enabled 属性和 Orders 常量。当 DeveloperMode 完整实现时
 * （TODO-21.D.5），此接口将不再需要。
 *
 * @todo 当 TODO-21.D.5 完整实现 DeveloperMode 后移除此接口。
 */
export interface DeveloperModeStub {
  /** 是否为该玩家启用了开发者模式。OpenRA 对照: DeveloperMode.Enabled */
  readonly enabled: boolean
}

// ---------------------------------------------------------------------------
// WorldStub — 命令执行所需的 World 最小接口
// ---------------------------------------------------------------------------

/**
 * 命令执行所需 World 方法的最小接口。
 *
 * OpenRA 对照: OpenRA.Game/World.cs
 *
 * 提取了 DevCommands 所需的世界 API 子集：
 * - issueOrder: 发出订单
 * - localPlayer: 用于玩家身份和资源访问
 * - selection: 用于目标选择的角色
 */
export interface DevCommandsWorld {
  /** 发出游戏订单。OpenRA 对照: World.IssueOrder(Order) */
  issueOrder(order: OrderStub): void

  /** 本地玩家。OpenRA 对照: World.LocalPlayer */
  readonly localPlayer: DevCommandsPlayer | null | undefined

  /** 选中的角色。OpenRA 对照: World.Selection */
  readonly selection: DevCommandsSelection | null | undefined
}

/**
 * 命令执行所需的 Player 最小接口。
 *
 * OpenRA 对照: OpenRA.Game/Player.cs
 */
export interface DevCommandsPlayer {
  /** 玩家内部 ID。OpenRA 对照: PlayerInternalName */
  readonly internalName: string

  /** 解析后的显示名称。OpenRA 对照: Player.ResolvedPlayerName */
  readonly resolvedPlayerName: string

  /** 玩家的 PlayerActor。OpenRA 对照: Player.PlayerActor */
  readonly playerActor: IGameActor
}

/**
 * 命令执行所需的 Selection 最小接口。
 *
 * OpenRA 对照: OpenRA.Game/ISelection.cs
 */
export interface DevCommandsSelection {
  /** 当前选中的角色。OpenRA 对照: Selection.Actors */
  readonly actors: readonly IGameActor[]
}

// ---------------------------------------------------------------------------
// 开发者模式订单常量（对应 OpenRA DeveloperMode.Orders）
// ---------------------------------------------------------------------------

/**
 * 开发者模式订单字符串。
 *
 * OpenRA 对照: DeveloperMode.Orders
 *
 * 这些字符串作为 orderName 发送，并由 DeveloperMode trait
 * 的 resolveOrder 方法处理。
 */
export const DevOrders = {
  /** 切换所有作弊。OpenRA 对照: DeveloperMode.Orders.All */
  All: 'DevAll',
  /** 解锁所有科技。OpenRA 对照: DeveloperMode.Orders.EnableTech */
  EnableTech: 'DevEnableTech',
  /** 快速充能（支援能力）。OpenRA 对照: DeveloperMode.Orders.FastCharge */
  FastCharge: 'DevFastCharge',
  /** 快速建造。OpenRA 对照: DeveloperMode.Orders.FastBuild */
  FastBuild: 'DevFastBuild',
  /** 给予现金。OpenRA 对照: DeveloperMode.Orders.GiveCash */
  GiveCash: 'DevGiveCash',
  /** 给予所有玩家现金。OpenRA 对照: DeveloperMode.Orders.GiveCashAll */
  GiveCashAll: 'DevGiveCashAll',
  /** 生长资源。OpenRA 对照: DeveloperMode.Orders.GrowResources */
  GrowResources: 'DevGrowResources',
  /** 切换可见性（战争迷雾）。OpenRA 对照: DeveloperMode.Orders.Visibility */
  Visibility: 'DevVisibility',
  /** 给予探索（清除战争迷雾）。OpenRA 对照: DeveloperMode.Orders.GiveExploration */
  GiveExploration: 'DevGiveExploration',
  /** 重置探索。OpenRA 对照: DeveloperMode.Orders.ResetExploration */
  ResetExploration: 'DevResetExploration',
  /** 无限电力。OpenRA 对照: DeveloperMode.Orders.UnlimitedPower */
  UnlimitedPower: 'DevUnlimitedPower',
  /** 随处建造。OpenRA 对照: DeveloperMode.Orders.BuildAnywhere */
  BuildAnywhere: 'DevBuildAnywhere',
  /** 玩家经验。OpenRA 对照: DeveloperMode.Orders.PlayerExperience */
  PlayerExperience: 'DevPlayerExperience',
  /** 治疗。OpenRA 对照: DeveloperMode.Orders.Heal */
  Heal: 'DevHeal',
  /** 击杀。OpenRA 对照: DeveloperMode.Orders.Kill */
  Kill: 'DevKill',
  /** 处置（移除）。OpenRA 对照: DeveloperMode.Orders.Dispose */
  Dispose: 'DevDispose',
} as const

// ---------------------------------------------------------------------------
// 命令常量（对应 OpenRA DevCommands.Commands）
// ---------------------------------------------------------------------------

/**
 * 聊天命令名称。
 *
 * OpenRA 对照: DevCommands.Commands
 */
export const DevCommandNames = {
  Visibility: 'visibility',
  GiveCash: 'give-cash',
  GiveCashAll: 'give-cash-all',
  FastBuild: 'instant-build',
  BuildAnywhere: 'build-anywhere',
  UnlimitedPower: 'unlimited-power',
  EnableTech: 'enable-tech',
  FastCharge: 'fast-charge',
  All: 'all',
  Crash: 'crash',
  GrowResources: 'grow-resources',
  GiveExploration: 'clear-shroud',
  ResetExploration: 'reset-shroud',
  PlayerExperience: 'player-experience',
  Kill: 'kill',
  Heal: 'heal',
  Dispose: 'dispose',
} as const

// ---------------------------------------------------------------------------
// 外部 trait 命令名称（对应 GainsExperience / PowerManager 常量）
// ---------------------------------------------------------------------------

/**
 * 升级命令名称。
 *
 * OpenRA 对照: GainsExperience.CommandName
 */
export const LevelUpCommandName = 'levelup'

/**
 * 升级订单名称。
 *
 * OpenRA 对照: GainsExperience.OrderName
 */
export const LevelUpOrderName = 'DevLevelUp'

/**
 * 停电命令名称。
 *
 * OpenRA 对照: PowerManager.CommandName
 */
export const PowerOutageCommandName = 'power-outage'

/**
 * 停电订单名称。
 *
 * OpenRA 对照: PowerManager.OrderName
 */
export const PowerOutageOrderName = 'DevPowerOutage'

// ---------------------------------------------------------------------------
// 命令处理函数签名
// ---------------------------------------------------------------------------

/**
 * DevCommands 的处理函数类型。
 *
 * OpenRA 对照: Action<string, World> 委托
 *
 * @param arg — 命令名称之后的参数字符串
 * @param world — 用于订单发出的世界实例
 */
export type DevCommandFn = (arg: string, world: DevCommandsWorld) => void

// ---------------------------------------------------------------------------
// 命令定义
// ---------------------------------------------------------------------------

/**
 * 单个 dev 命令的定义。
 */
interface DevCommandDef {
  /** 人类可读的描述键（Fluent 引用）。 */
  description: string
  /** 执行命令的处理函数。 */
  handler: DevCommandFn
}

// ---------------------------------------------------------------------------
// 通知键常量（对应 OpenRA Fluent 引用）
// ---------------------------------------------------------------------------

/** 禁用作弊通知键。OpenRA 对照: CheatsDisabled */
const CHEATS_DISABLED = 'notification-cheats-disabled'

/** 无效现金金额通知键。OpenRA 对照: InvalidCashAmount */
const INVALID_CASH_AMOUNT = 'notification-invalid-cash-amount'

// ---------------------------------------------------------------------------
// DevCommands — 开发者作弊命令注册器
// OpenRA 对照: DevCommands : IChatCommand, IWorldLoaded
// ---------------------------------------------------------------------------

/**
 * 暴露聊天控制台命令以提供开发者作弊功能。
 *
 * OpenRA 对照: DevCommands
 *
 * 命令在构造时注册，由聊天控制台解析器调用。
 * 所有命令在执行前验证开发者模式权限。
 *
 * 用法:
 * ```
 * const cmd = new DevCommands(world, devMode)
 * cmd.registerCommands(registry)  // 在 WorldLoaded 期间调用
 * // 随后由聊天控制台调用:
 * cmd.invokeCommand("give-cash", "2000")
 * ```
 */
export class DevCommands {
  // -----------------------------------------------------------------------
  // 通知键
  // -----------------------------------------------------------------------

  /** 作弊已禁用。OpenRA 对照: CheatsDisabled */
  static readonly cheatsDisabled = CHEATS_DISABLED

  /** 无效现金金额。OpenRA 对照: InvalidCashAmount */
  static readonly invalidCashAmount = INVALID_CASH_AMOUNT

  // -----------------------------------------------------------------------
  // 命令描述键（Fluent 引用；对应 OpenRA 描述常量）
  // -----------------------------------------------------------------------

  static readonly Descriptions = {
    ToggleVisibility: 'description-toggle-visibility',
    GiveCash: 'description-give-cash',
    GiveCashAll: 'description-give-cash-all',
    InstantBuilding: 'description-instant-building',
    BuildAnywhere: 'description-build-anywhere',
    UnlimitedPower: 'description-unlimited-power',
    EnableTech: 'description-enable-tech',
    FastCharge: 'description-fast-charge',
    DevCheatAll: 'description-dev-cheat-all',
    DevCrash: 'description-dev-crash',
    LevelUpActor: 'description-levelup-actor',
    PlayerExperience: 'description-player-experience',
    PowerOutage: 'description-power-outage',
    GrowResources: 'description-grow-resources',
    ClearShroud: 'description-clear-shroud',
    ResetShroud: 'description-reset-shroud',
    HealSelected: 'description-heal-selected-actors',
    KillSelected: 'description-kill-selected-actors',
    DisposeSelected: 'description-dispose-selected-actors',
  } as const

  // -----------------------------------------------------------------------
  // 实例状态
  // -----------------------------------------------------------------------

  /** 用于订单发出的世界引用。OpenRA 对照: world */
  private world: DevCommandsWorld | null = null

  /** 开发者模式 trait 用于权限检查。OpenRA 对照: developerMode */
  private devMode: DeveloperModeStub | null = null

  /** 从命令名称到定义的映射。OpenRA 对照: commandHandlers 字典 */
  private readonly commandDefs: Map<string, DevCommandDef>

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  /**
   * 创建 DevCommands 实例。
   *
   * OpenRA 对照: DevCommands 构造函数
   *
   * @param world — 用于发出订单的世界（可选；可在 WorldLoaded 期间稍后设置）
   * @param devMode — 用于权限门控的开发者模式 trait
   */
  constructor(
    world?: DevCommandsWorld | null,
    devMode?: DeveloperModeStub | null,
  ) {
    this.world = world ?? null
    this.devMode = devMode ?? null

    // 构建命令定义映射（对应 OpenRA commandHandlers 字典初始化）
    this.commandDefs = new Map<string, DevCommandDef>([
      [DevCommandNames.Visibility, { description: DevCommands.Descriptions.ToggleVisibility, handler: DevCommands.handleVisibility }],
      [DevCommandNames.GiveCash, { description: DevCommands.Descriptions.GiveCash, handler: DevCommands.handleGiveCash }],
      [DevCommandNames.GiveCashAll, { description: DevCommands.Descriptions.GiveCashAll, handler: DevCommands.handleGiveCashAll }],
      [DevCommandNames.FastBuild, { description: DevCommands.Descriptions.InstantBuilding, handler: DevCommands.handleFastBuild }],
      [DevCommandNames.BuildAnywhere, { description: DevCommands.Descriptions.BuildAnywhere, handler: DevCommands.handleBuildAnywhere }],
      [DevCommandNames.UnlimitedPower, { description: DevCommands.Descriptions.UnlimitedPower, handler: DevCommands.handleUnlimitedPower }],
      [DevCommandNames.EnableTech, { description: DevCommands.Descriptions.EnableTech, handler: DevCommands.handleEnableTech }],
      [DevCommandNames.FastCharge, { description: DevCommands.Descriptions.FastCharge, handler: DevCommands.handleFastCharge }],
      [DevCommandNames.All, { description: DevCommands.Descriptions.DevCheatAll, handler: DevCommands.handleAll }],
      [DevCommandNames.Crash, { description: DevCommands.Descriptions.DevCrash, handler: DevCommands.handleCrash }],
      [DevCommandNames.GrowResources, { description: DevCommands.Descriptions.GrowResources, handler: DevCommands.handleGrowResources }],
      [DevCommandNames.GiveExploration, { description: DevCommands.Descriptions.ClearShroud, handler: DevCommands.handleGiveExploration }],
      [DevCommandNames.ResetExploration, { description: DevCommands.Descriptions.ResetShroud, handler: DevCommands.handleResetExploration }],
      [LevelUpCommandName, { description: DevCommands.Descriptions.LevelUpActor, handler: DevCommands.handleLevelUp }],
      [DevCommandNames.PlayerExperience, { description: DevCommands.Descriptions.PlayerExperience, handler: DevCommands.handlePlayerExperience }],
      [PowerOutageCommandName, { description: DevCommands.Descriptions.PowerOutage, handler: DevCommands.handlePowerOutage }],
      [DevCommandNames.Kill, { description: DevCommands.Descriptions.KillSelected, handler: DevCommands.handleKill }],
      [DevCommandNames.Heal, { description: DevCommands.Descriptions.HealSelected, handler: DevCommands.handleHeal }],
      [DevCommandNames.Dispose, { description: DevCommands.Descriptions.DisposeSelected, handler: DevCommands.handleDispose }],
    ])
  }

  // -----------------------------------------------------------------------
  // WorldLoaded — 在聊天控制台中注册命令（对应 OpenRA WorldLoaded）
  // -----------------------------------------------------------------------

  /**
   * 向命令注册表注册所有 dev 命令。
   *
   * OpenRA 对照: DevCommands.WorldLoaded(World, WorldRenderer)
   *
   * 在游戏世界加载期间调用。注册每个命令及其帮助文本。
   *
   * @param registry — 用于注册的命令注册表
   * @param world — 用于订单发出的世界（覆盖构造函数参数）
   * @param devMode — 开发者模式 trait（覆盖构造函数参数）
   */
  registerCommands(
    registry: CommandRegistry,
    world?: DevCommandsWorld | null,
    devMode?: DeveloperModeStub | null,
  ): void {
    if (world) this.world = world
    if (devMode) this.devMode = devMode

    for (const [name, def] of this.commandDefs) {
      registry.registerCommand(name, (cmdName: string, arg: string) => {
        this.invokeCommand(cmdName, arg)
      })
      registry.registerHelp(name, def.description)
    }
  }

  // -----------------------------------------------------------------------
  // InvokeCommand — 命令分发（对应 OpenRA IChatCommand.InvokeCommand）
  // -----------------------------------------------------------------------

  /**
   * 调用一个 dev 命令。
   *
   * OpenRA 对照: DevCommands.InvokeCommand(string, string)
   *
   * 检查本地玩家、开发者模式权限，然后将命令
   * 分发给适当的处理函数。
   *
   * @param name — 命令名称（例如 "give-cash"）
   * @param arg — 命令的参数（例如 "2000"）
   */
  invokeCommand(name: string, arg: string): void {
    if (!this.world || !this.world.localPlayer) return

    if (!this.devMode || !this.devMode.enabled) {
      console.debug(`[DevCommands] ${CHEATS_DISABLED}`)
      return
    }

    const def = this.commandDefs.get(name)
    if (def) {
      def.handler(arg, this.world)
    }
  }

  // -----------------------------------------------------------------------
  // 静态命令处理函数（对应 OpenRA static 方法）
  // 每个处理函数接收参数字符串和世界引用，
  // 构造一个 OrderStub 并通过 world.issueOrder() 发出。
  // -----------------------------------------------------------------------

  /**
   * 切换可见性作弊（战争迷雾）。
   *
   * OpenRA 对照: DevCommands.Visibility(string, World)
   */
  static handleVisibility(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.Visibility)
  }

  /**
   * 给予本地玩家现金。
   *
   * OpenRA 对照: DevCommands.GiveCash(string, World)
   */
  static handleGiveCash(arg: string, world: DevCommandsWorld): void {
    DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, arg)
  }

  /**
   * 给予所有玩家现金。
   *
   * OpenRA 对照: DevCommands.GiveCashAll(string, World)
   */
  static handleGiveCashAll(arg: string, world: DevCommandsWorld): void {
    DevCommands.issueCashDevCommand(world, DevOrders.GiveCashAll, arg)
  }

  /**
   * 切换快速建造作弊。
   *
   * OpenRA 对照: DevCommands.InstantBuild(string, World)
   */
  static handleFastBuild(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.FastBuild)
  }

  /**
   * 切换随处建造作弊。
   *
   * OpenRA 对照: DevCommands.BuildAnywhere(string, World)
   */
  static handleBuildAnywhere(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.BuildAnywhere)
  }

  /**
   * 切换无限电力作弊。
   *
   * OpenRA 对照: DevCommands.UnlimitedPower(string, World)
   */
  static handleUnlimitedPower(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.UnlimitedPower)
  }

  /**
   * 切换启用所有科技作弊。
   *
   * OpenRA 对照: DevCommands.EnableTech(string, World)
   */
  static handleEnableTech(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.EnableTech)
  }

  /**
   * 切换快速充能作弊。
   *
   * OpenRA 对照: DevCommands.FastCharge(string, World)
   */
  static handleFastCharge(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.FastCharge)
  }

  /**
   * 切换所有作弊。
   *
   * OpenRA 对照: DevCommands.All(string, World)
   */
  static handleAll(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.All)
  }

  /**
   * 触发崩溃（用于开发测试）。
   *
   * OpenRA 对照: DevCommands.Crash(string, World)
   *
   * 在 C# 中，这会抛出 DevException。
   * 在 TypeScript 中，使用适当的堆栈跟踪抛出 Error。
   */
  static handleCrash(_arg: string, _world: DevCommandsWorld): void {
    throw new Error('Developer-triggered crash (DevException)')
  }

  /**
   * 生长地图上的资源。
   *
   * OpenRA 对照: DevCommands.GrowResources(string, World)
   */
  static handleGrowResources(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.GrowResources)
  }

  /**
   * 给予探索（清除战争迷雾）。
   *
   * OpenRA 对照: DevCommands.GiveExploration(string, World)
   */
  static handleGiveExploration(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.GiveExploration)
  }

  /**
   * 重置探索。
   *
   * OpenRA 对照: DevCommands.ResetExploration(string, World)
   */
  static handleResetExploration(_arg: string, world: DevCommandsWorld): void {
    DevCommands.issueDevCommand(world, DevOrders.ResetExploration)
  }

  /**
   * 升级选中的角色。
   *
   * OpenRA 对照: DevCommands.LevelUp(string, World)
   */
  static handleLevelUp(arg: string, world: DevCommandsWorld): void {
    const selection = world.selection
    if (!selection) return

    const level = parseInt(arg, 10)

    for (const actor of selection.actors) {
      if (actor.isDead) continue

      // 检查角色是否有 GainsExperienceInfo trait（对应 OpenRA HasTraitInfo<GainsExperienceInfo>()）
      const gainsExp = actor.traitsImplementing?.('GainsExperienceInfo')
      if (!gainsExp || gainsExp.length === 0) continue

      const levelupOrder: OrderStub = {
        orderName: LevelUpOrderName,
        targetString: '',
        extraData: isNaN(level) ? 0 : level,
      }
      world.issueOrder(levelupOrder)
    }
  }

  /**
   * 给予本地玩家经验值。
   *
   * OpenRA 对照: DevCommands.PlayerExperience(string, World)
   */
  static handlePlayerExperience(arg: string, world: DevCommandsWorld): void {
    const experience = parseInt(arg, 10)
    if (isNaN(experience)) return

    if (!world.localPlayer) return

    const order: OrderStub = {
      orderName: DevOrders.PlayerExperience,
      targetString: '',
      extraData: experience,
    }
    world.issueOrder(order)
  }

  /**
   * 触发停电。
   *
   * OpenRA 对照: DevCommands.PowerOutage(string, World)
   */
  static handlePowerOutage(_arg: string, world: DevCommandsWorld): void {
    if (!world.localPlayer) return

    const order: OrderStub = {
      orderName: PowerOutageOrderName,
      targetString: '',
      extraData: 250,
    }
    world.issueOrder(order)
  }

  /**
   * 治疗选中的角色。
   *
   * OpenRA 对照: DevCommands.Heal(string, World)
   */
  static handleHeal(_arg: string, world: DevCommandsWorld): void {
    const selection = world.selection
    if (!selection || !world.localPlayer) return

    for (const actor of selection.actors) {
      if (actor.isDead) continue

      const order: OrderStub = {
        orderName: DevOrders.Heal,
        targetString: '',
        extraData: 0,
        target: Target.fromActor(actor as unknown as IActorRef),
      }
      world.issueOrder(order)
    }
  }

  /**
   * 击杀选中的角色。
   *
   * OpenRA 对照: DevCommands.Kill(string, World)
   */
  static handleKill(_arg: string, world: DevCommandsWorld): void {
    const selection = world.selection
    if (!selection || !world.localPlayer) return

    for (const actor of selection.actors) {
      if (actor.isDead) continue

      const order: OrderStub = {
        orderName: DevOrders.Kill,
        targetString: '',
        extraData: 0,
        target: Target.fromActor(actor as unknown as IActorRef),
      }
      world.issueOrder(order)
    }
  }

  /**
   * 处置（移除）选中的角色。
   *
   * OpenRA 对照: DevCommands.Dispose(string, World)
   */
  static handleDispose(_arg: string, world: DevCommandsWorld): void {
    const selection = world.selection
    if (!selection || !world.localPlayer) return

    for (const actor of selection.actors) {
      if (actor.disposed) continue

      const order: OrderStub = {
        orderName: DevOrders.Dispose,
        targetString: '',
        extraData: 0,
        target: Target.fromActor(actor as unknown as IActorRef),
      }
      world.issueOrder(order)
    }
  }

  // -----------------------------------------------------------------------
  // 辅助静态方法（对应 OpenRA 私有辅助方法）
  // -----------------------------------------------------------------------

  /**
   * 发出一个简单的开发者模式订单（无额外数据或参数）。
   *
   * OpenRA 对照: DevCommands.IssueDevCommand(World, string)
   *
   * @param world — 用于发出订单的世界
   * @param command — 订单名称字符串
   */
  static issueDevCommand(world: DevCommandsWorld, command: string): void {
    if (!world.localPlayer) return

    const order: OrderStub = {
      orderName: command,
      targetString: '',
      extraData: 0,
    }
    world.issueOrder(order)
  }

  /**
   * 发出一个现金作弊订单。
   *
   * OpenRA 对照: DevCommands.IssueCashDevCommand(World, string, string)
   *
   * 解析参数字符串为现金金额并作为 ExtraData 发送。
   * 空参数默认为 0（使用 DeveloperModeInfo.Cash 默认值）。
   *
   * @param world — 用于发出订单的世界
   * @param command — 订单名称（GiveCash 或 GiveCashAll）
   * @param arg — 来自聊天输入的参数字符串
   */
  static issueCashDevCommand(
    world: DevCommandsWorld,
    command: string,
    arg: string,
  ): void {
    if (!world.localPlayer) return

    let cash: number
    if (!arg || arg.trim() === '') {
      cash = 0
    } else {
      const parsed = parseInt(arg, 10)
      if (isNaN(parsed)) {
        console.debug(`[DevCommands] ${INVALID_CASH_AMOUNT}`)
        return
      }
      cash = parsed
    }

    const order: OrderStub = {
      orderName: command,
      targetString: '',
      extraData: cash,
    }
    world.issueOrder(order)
  }

  // -----------------------------------------------------------------------
  // 公共辅助方法
  // -----------------------------------------------------------------------

  /**
   * 获取给定命令名称的人类可读描述。
   *
   * @param name — 命令名称
   * @returns 描述字符串（如果命令未知，则返回回退值）
   */
  getDescription(name: string): string {
    const def = this.commandDefs.get(name)
    return def ? def.description : name
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
   * 设置世界引用（用于延迟的 WorldLoaded 绑定）。
   *
   * @param world — 用于命令执行的 World 引用
   */
  setWorld(world: DevCommandsWorld): void {
    this.world = world
  }

  /**
   * 设置开发者模式引用（用于延迟的 WorldLoaded 绑定）。
   *
   * @param devMode — 用于权限门控的 DeveloperMode trait
   */
  setDevMode(devMode: DeveloperModeStub): void {
    this.devMode = devMode
  }
}
