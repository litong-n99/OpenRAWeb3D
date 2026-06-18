/**
 * DevCommands.test.ts — DevCommands 迁移单元测试
 *
 * 测试焦点：命令注册、命令分发、参数解析、权限检查、
 * 订单创建和边界情况处理。
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// 导入被测模块
// ---------------------------------------------------------------------------

import {
  DevCommands,
  DevOrders,
  DevCommandNames,
  LevelUpCommandName,
  LevelUpOrderName,
  PowerOutageCommandName,
  PowerOutageOrderName,
  type DevCommandsWorld,
  type DevCommandsPlayer,
  type DevCommandsSelection,
  type DeveloperModeStub,
} from './DevCommands'

import type { OrderStub } from '../../OpenRA.Game/World.js'
import type { IGameActor } from '../../OpenRA.Game/Traits/TraitsInterfaces.js'
import type { CommandRegistry } from './DebugVisualizationCommands'

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

/** 为测试创建最小 IGameActor。 */
function createMockActor(
  id: number,
  overrides: Partial<IGameActor> = {},
): IGameActor {
  return {
    actorId: id,
    traitName: `Actor_${id}`,
    isDead: false,
    disposed: false,
    isInWorld: true,
    destroy(): void {},
    ...overrides,
  } as unknown as IGameActor
}

/** 为测试创建最小 DevCommandsPlayer。 */
function createMockPlayer(
  overrides: Partial<DevCommandsPlayer> = {},
): DevCommandsPlayer {
  return {
    internalName: 'Player1',
    resolvedPlayerName: 'TestPlayer',
    playerActor: createMockActor(999),
    ...overrides,
  }
}

/** 为测试创建最小 DevCommandsSelection。 */
function createMockSelection(
  actors: readonly IGameActor[] = [],
): DevCommandsSelection {
  return { actors }
}

/** 为测试创建最小 DevCommandsWorld。 */
function createMockWorld(
  overrides: Partial<DevCommandsWorld> = {},
): DevCommandsWorld & { issuedOrders: OrderStub[] } {
  const issuedOrders: OrderStub[] = []
  return {
    localPlayer: createMockPlayer(),
    selection: createMockSelection(),
    issueOrder(order: OrderStub): void {
      issuedOrders.push(order)
    },
    ...overrides,
    issuedOrders,
  }
}

/** 为测试创建启用 dev 模式的 stub。 */
function createEnabledDevMode(): DeveloperModeStub {
  return { enabled: true }
}

/** 为测试创建禁用 dev 模式的 stub。 */
function createDisabledDevMode(): DeveloperModeStub {
  return { enabled: false }
}

// ---------------------------------------------------------------------------
// 模拟 CommandRegistry
// ---------------------------------------------------------------------------

interface RegisteredCommand {
  name: string
  handler: (name: string, arg: string) => void
  help?: string
}

function createMockRegistry(): {
  registry: CommandRegistry
  commands: Map<string, RegisteredCommand>
} {
  const commands = new Map<string, RegisteredCommand>()

  const registry: CommandRegistry = {
    registerCommand(name: string, handler: (name: string, arg: string) => void): void {
      const existing = commands.get(name) ?? { name, handler }
      existing.handler = handler
      commands.set(name, existing)
    },
    registerHelp(name: string, description: string): void {
      const existing = commands.get(name) ?? {
        name,
        handler: () => {},
      }
      existing.help = description
      commands.set(name, existing)
    },
  }

  return { registry, commands }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('DevCommands', () => {
  // -----------------------------------------------------------------------
  // 常量
  // -----------------------------------------------------------------------

  describe('constants', () => {
    it('DevOrders defines all expected order strings', () => {
      expect(DevOrders.All).toBe('DevAll')
      expect(DevOrders.EnableTech).toBe('DevEnableTech')
      expect(DevOrders.FastCharge).toBe('DevFastCharge')
      expect(DevOrders.FastBuild).toBe('DevFastBuild')
      expect(DevOrders.GiveCash).toBe('DevGiveCash')
      expect(DevOrders.GiveCashAll).toBe('DevGiveCashAll')
      expect(DevOrders.GrowResources).toBe('DevGrowResources')
      expect(DevOrders.Visibility).toBe('DevVisibility')
      expect(DevOrders.GiveExploration).toBe('DevGiveExploration')
      expect(DevOrders.ResetExploration).toBe('DevResetExploration')
      expect(DevOrders.UnlimitedPower).toBe('DevUnlimitedPower')
      expect(DevOrders.BuildAnywhere).toBe('DevBuildAnywhere')
      expect(DevOrders.PlayerExperience).toBe('DevPlayerExperience')
      expect(DevOrders.Heal).toBe('DevHeal')
      expect(DevOrders.Kill).toBe('DevKill')
      expect(DevOrders.Dispose).toBe('DevDispose')
    })

    it('DevCommandNames defines all expected command names', () => {
      expect(DevCommandNames.GiveCash).toBe('give-cash')
      expect(DevCommandNames.FastBuild).toBe('instant-build')
      expect(DevCommandNames.All).toBe('all')
      expect(DevCommandNames.Crash).toBe('crash')
      expect(DevCommandNames.Kill).toBe('kill')
      expect(DevCommandNames.Heal).toBe('heal')
      expect(DevCommandNames.Dispose).toBe('dispose')
    })

    it('LevelUpCommandName and LevelUpOrderName are defined', () => {
      expect(LevelUpCommandName).toBe('levelup')
      expect(LevelUpOrderName).toBe('DevLevelUp')
    })

    it('PowerOutageCommandName and PowerOutageOrderName are defined', () => {
      expect(PowerOutageCommandName).toBe('power-outage')
      expect(PowerOutageOrderName).toBe('DevPowerOutage')
    })
  })

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates instance with default null world and devMode', () => {
      const cmd = new DevCommands()
      const names = Array.from(cmd.getCommandNames())
      expect(names.length).toBeGreaterThanOrEqual(19)
      expect(names).toContain('give-cash')
      expect(names).toContain('kill')
      expect(names).toContain('levelup')
      expect(names).toContain('power-outage')
    })

    it('creates instance with provided world and devMode', () => {
      const world = createMockWorld()
      const devMode = createEnabledDevMode()
      const cmd = new DevCommands(world, devMode)
      const names = Array.from(cmd.getCommandNames())
      expect(names.length).toBeGreaterThanOrEqual(19)
    })

    it('getCommandNames returns all 19 command names', () => {
      const cmd = new DevCommands()
      const names = Array.from(cmd.getCommandNames())
      expect(names).toContain('visibility')
      expect(names).toContain('give-cash')
      expect(names).toContain('give-cash-all')
      expect(names).toContain('instant-build')
      expect(names).toContain('build-anywhere')
      expect(names).toContain('unlimited-power')
      expect(names).toContain('enable-tech')
      expect(names).toContain('fast-charge')
      expect(names).toContain('all')
      expect(names).toContain('crash')
      expect(names).toContain('grow-resources')
      expect(names).toContain('clear-shroud')
      expect(names).toContain('reset-shroud')
      expect(names).toContain('player-experience')
      expect(names).toContain('kill')
      expect(names).toContain('heal')
      expect(names).toContain('dispose')
      expect(names).toContain('levelup')
      expect(names).toContain('power-outage')
    })
  })

  // -----------------------------------------------------------------------
  // getDescription
  // -----------------------------------------------------------------------

  describe('getDescription', () => {
    it('returns description for known command', () => {
      const cmd = new DevCommands()
      const desc = cmd.getDescription('give-cash')
      expect(desc).toBeTruthy()
      expect(typeof desc).toBe('string')
    })

    it('returns command name as fallback for unknown command', () => {
      const cmd = new DevCommands()
      expect(cmd.getDescription('nonexistent')).toBe('nonexistent')
    })
  })

  // -----------------------------------------------------------------------
  // setWorld / setDevMode
  // -----------------------------------------------------------------------

  describe('setWorld and setDevMode', () => {
    it('setWorld updates the world reference', () => {
      const cmd = new DevCommands()
      const world = createMockWorld()
      cmd.setWorld(world)
      // 命令现在应该能成功执行（如果有 localPlayer）
      cmd.setDevMode(createEnabledDevMode())
      const { registry, commands } = createMockRegistry()
      cmd.registerCommands(registry)
      commands.get('visibility')!.handler('visibility', '')
      expect(world.issuedOrders.length).toBe(1)
    })

    it('setDevMode updates the devMode reference', () => {
      const world = createMockWorld()
      const cmd = new DevCommands(world, createDisabledDevMode())
      cmd.setDevMode(createEnabledDevMode())
      // 现在已启用
      const { registry, commands } = createMockRegistry()
      cmd.registerCommands(registry)
      commands.get('give-cash')!.handler('give-cash', '100')
      expect(world.issuedOrders.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // registerCommands
  // -----------------------------------------------------------------------

  describe('registerCommands', () => {
    it('registers all 19 commands', () => {
      const world = createMockWorld()
      const cmd = new DevCommands(world, createEnabledDevMode())
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      expect(commands.size).toBe(19)
    })

    it('registers help text for all commands', () => {
      const world = createMockWorld()
      const cmd = new DevCommands(world, createEnabledDevMode())
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      for (const [, entry] of commands) {
        expect(entry.help).toBeTruthy()
        expect(typeof entry.help).toBe('string')
      }
    })

    it('updates world reference via registerCommands parameter', () => {
      const cmd = new DevCommands()
      const world = createMockWorld()
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry, world, createEnabledDevMode())

      // 执行命令应发出订单
      commands.get('visibility')!.handler('visibility', '')
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.Visibility)
    })
  })

  // -----------------------------------------------------------------------
  // invokeCommand — 权限和基本分发
  // -----------------------------------------------------------------------

  describe('invokeCommand', () => {
    let world: ReturnType<typeof createMockWorld>
    let cmd: DevCommands

    beforeEach(() => {
      world = createMockWorld()
      cmd = new DevCommands(world, createEnabledDevMode())
    })

    it('executes known command and issues order', () => {
      cmd.invokeCommand('visibility', '')
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.Visibility)
    })

    it('ignores unknown command names', () => {
      cmd.invokeCommand('nonexistent', '')
      expect(world.issuedOrders.length).toBe(0)
    })

    it('blocks command when devMode is disabled', () => {
      const disabledWorld = createMockWorld()
      const disabledCmd = new DevCommands(disabledWorld, createDisabledDevMode())
      disabledCmd.invokeCommand('visibility', '')
      expect(disabledWorld.issuedOrders.length).toBe(0)
    })

    it('blocks command when devMode is null', () => {
      const noDevWorld = createMockWorld()
      const noDevCmd = new DevCommands(noDevWorld, null)
      noDevCmd.invokeCommand('visibility', '')
      expect(noDevWorld.issuedOrders.length).toBe(0)
    })

    it('blocks command when localPlayer is missing', () => {
      const noPlayerWorld = createMockWorld({ localPlayer: null })
      const noPlayerCmd = new DevCommands(noPlayerWorld, createEnabledDevMode())
      noPlayerCmd.invokeCommand('visibility', '')
      expect(noPlayerWorld.issuedOrders.length).toBe(0)
    })

    it('blocks command when world is null', () => {
      const nullWorldCmd = new DevCommands(null, createEnabledDevMode())
      nullWorldCmd.invokeCommand('visibility', '')
      // 不应抛出异常 — 静默无操作
    })
  })

  // -----------------------------------------------------------------------
  // issueDevCommand — 辅助方法
  // -----------------------------------------------------------------------

  describe('issueDevCommand', () => {
    it('issues simple dev order with zero extraData', () => {
      const world = createMockWorld()
      DevCommands.issueDevCommand(world, DevOrders.FastBuild)
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0]).toEqual({
        orderName: DevOrders.FastBuild,
        targetString: '',
        extraData: 0,
      })
    })

    it('does nothing when localPlayer is missing', () => {
      const world = createMockWorld({ localPlayer: null })
      DevCommands.issueDevCommand(world, DevOrders.All)
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // issueCashDevCommand — 辅助方法
  // -----------------------------------------------------------------------

  describe('issueCashDevCommand', () => {
    it('issues cash order with parsed amount', () => {
      const world = createMockWorld()
      DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, '2000')
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0]).toEqual({
        orderName: DevOrders.GiveCash,
        targetString: '',
        extraData: 2000,
      })
    })

    it('issues cash order with zero for empty arg', () => {
      const world = createMockWorld()
      DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, '')
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].extraData).toBe(0)
    })

    it('issues cash order with zero for whitespace-only arg', () => {
      const world = createMockWorld()
      DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, '   ')
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].extraData).toBe(0)
    })

    it('handles negative cash amounts', () => {
      const world = createMockWorld()
      DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, '-500')
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].extraData).toBe(-500)
    })

    it('does not issue order for non-numeric arg', () => {
      const world = createMockWorld()
      DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, 'abc')
      expect(world.issuedOrders.length).toBe(0)
    })

    it('handles large cash amounts', () => {
      const world = createMockWorld()
      DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, '999999')
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].extraData).toBe(999999)
    })

    it('does nothing when localPlayer is missing', () => {
      const world = createMockWorld({ localPlayer: null })
      DevCommands.issueCashDevCommand(world, DevOrders.GiveCash, '100')
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // 静态命令处理函数 — 简单切换命令
  // -----------------------------------------------------------------------

  describe('toggle command handlers', () => {
    let world: ReturnType<typeof createMockWorld>

    beforeEach(() => {
      world = createMockWorld()
    })

    it('handleVisibility issues visibility order', () => {
      DevCommands.handleVisibility('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.Visibility)
    })

    it('handleFastBuild issues fastBuild order', () => {
      DevCommands.handleFastBuild('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.FastBuild)
    })

    it('handleBuildAnywhere issues buildAnywhere order', () => {
      DevCommands.handleBuildAnywhere('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.BuildAnywhere)
    })

    it('handleUnlimitedPower issues unlimitedPower order', () => {
      DevCommands.handleUnlimitedPower('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.UnlimitedPower)
    })

    it('handleEnableTech issues enableTech order', () => {
      DevCommands.handleEnableTech('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.EnableTech)
    })

    it('handleFastCharge issues fastCharge order', () => {
      DevCommands.handleFastCharge('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.FastCharge)
    })

    it('handleAll issues all order', () => {
      DevCommands.handleAll('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.All)
    })

    it('handleGrowResources issues growResources order', () => {
      DevCommands.handleGrowResources('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.GrowResources)
    })

    it('handleGiveExploration issues giveExploration order', () => {
      DevCommands.handleGiveExploration('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.GiveExploration)
    })

    it('handleResetExploration issues resetExploration order', () => {
      DevCommands.handleResetExploration('', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.ResetExploration)
    })
  })

  // -----------------------------------------------------------------------
  // handleGiveCash / handleGiveCashAll
  // -----------------------------------------------------------------------

  describe('cash command handlers', () => {
    it('handleGiveCash issues giveCash order with amount', () => {
      const world = createMockWorld()
      DevCommands.handleGiveCash('500', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.GiveCash)
      expect(world.issuedOrders[0].extraData).toBe(500)
    })

    it('handleGiveCashAll issues giveCashAll order with amount', () => {
      const world = createMockWorld()
      DevCommands.handleGiveCashAll('1000', world)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.GiveCashAll)
      expect(world.issuedOrders[0].extraData).toBe(1000)
    })
  })

  // -----------------------------------------------------------------------
  // handleCrash
  // -----------------------------------------------------------------------

  describe('handleCrash', () => {
    it('throws an error when crash command is invoked', () => {
      const world = createMockWorld()
      expect(() => {
        DevCommands.handleCrash('', world)
      }).toThrow('Developer-triggered crash')
    })
  })

  // -----------------------------------------------------------------------
  // handleLevelUp
  // -----------------------------------------------------------------------

  describe('handleLevelUp', () => {
    it('issues levelup order for each selected actor', () => {
      const actors = [createMockActor(1), createMockActor(2)]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleLevelUp('3', world)

      expect(world.issuedOrders.length).toBe(2)
      expect(world.issuedOrders[0].orderName).toBe(LevelUpOrderName)
      expect(world.issuedOrders[0].extraData).toBe(3)
      expect(world.issuedOrders[1].orderName).toBe(LevelUpOrderName)
      expect(world.issuedOrders[1].extraData).toBe(3)
    })

    it('skips dead actors', () => {
      const actors = [
        createMockActor(1, { isDead: true }),
        createMockActor(2),
      ]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleLevelUp('2', world)

      expect(world.issuedOrders.length).toBe(1)
    })

    it('uses extraData 0 for non-numeric level arg', () => {
      const actors = [createMockActor(1)]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleLevelUp('notanumber', world)

      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].extraData).toBe(0)
    })

    it('does nothing when selection is null', () => {
      const world = createMockWorld({ selection: null })
      DevCommands.handleLevelUp('1', world)
      expect(world.issuedOrders.length).toBe(0)
    })

    it('does nothing when no actors selected', () => {
      const world = createMockWorld({
        selection: createMockSelection([]),
      })

      DevCommands.handleLevelUp('1', world)
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // handlePlayerExperience
  // -----------------------------------------------------------------------

  describe('handlePlayerExperience', () => {
    it('issues player experience order with parsed amount', () => {
      const world = createMockWorld()
      DevCommands.handlePlayerExperience('500', world)
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.PlayerExperience)
      expect(world.issuedOrders[0].extraData).toBe(500)
    })

    it('does not issue order for non-numeric arg', () => {
      const world = createMockWorld()
      DevCommands.handlePlayerExperience('abc', world)
      expect(world.issuedOrders.length).toBe(0)
    })

    it('does not issue order when localPlayer is missing', () => {
      const world = createMockWorld({ localPlayer: null })
      DevCommands.handlePlayerExperience('100', world)
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // handlePowerOutage
  // -----------------------------------------------------------------------

  describe('handlePowerOutage', () => {
    it('issues power outage order with extraData 250', () => {
      const world = createMockWorld()
      DevCommands.handlePowerOutage('', world)
      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].orderName).toBe(PowerOutageOrderName)
      expect(world.issuedOrders[0].extraData).toBe(250)
    })

    it('does nothing when localPlayer is missing', () => {
      const world = createMockWorld({ localPlayer: null })
      DevCommands.handlePowerOutage('', world)
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // handleHeal
  // -----------------------------------------------------------------------

  describe('handleHeal', () => {
    it('issues heal order for each selected actor', () => {
      const actors = [createMockActor(10), createMockActor(20)]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleHeal('', world)

      expect(world.issuedOrders.length).toBe(2)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.Heal)
      expect(world.issuedOrders[0].targetString).toBe('10')
      expect(world.issuedOrders[1].orderName).toBe(DevOrders.Heal)
      expect(world.issuedOrders[1].targetString).toBe('20')
    })

    it('skips dead actors', () => {
      const actors = [
        createMockActor(1, { isDead: true }),
        createMockActor(2),
        createMockActor(3, { isDead: true }),
      ]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleHeal('', world)

      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].targetString).toBe('2')
    })

    it('does nothing when selection is null', () => {
      const world = createMockWorld({ selection: null })
      DevCommands.handleHeal('', world)
      expect(world.issuedOrders.length).toBe(0)
    })

    it('does nothing when localPlayer is missing', () => {
      const world = createMockWorld({
        localPlayer: null,
        selection: createMockSelection([createMockActor(1)]),
      })
      DevCommands.handleHeal('', world)
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // handleKill
  // -----------------------------------------------------------------------

  describe('handleKill', () => {
    it('issues kill order for each selected actor', () => {
      const actors = [createMockActor(5), createMockActor(6)]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleKill('', world)

      expect(world.issuedOrders.length).toBe(2)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.Kill)
      expect(world.issuedOrders[0].targetString).toBe('5')
      expect(world.issuedOrders[1].orderName).toBe(DevOrders.Kill)
      expect(world.issuedOrders[1].targetString).toBe('6')
    })

    it('skips dead actors', () => {
      const actors = [
        createMockActor(1, { isDead: true }),
        createMockActor(2),
      ]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleKill('fire', world)

      expect(world.issuedOrders.length).toBe(1)
    })

    it('does nothing when selection is null', () => {
      const world = createMockWorld({ selection: null })
      DevCommands.handleKill('', world)
      expect(world.issuedOrders.length).toBe(0)
    })

    it('does nothing when localPlayer is missing', () => {
      const world = createMockWorld({
        localPlayer: null,
        selection: createMockSelection([createMockActor(1)]),
      })
      DevCommands.handleKill('', world)
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // handleDispose
  // -----------------------------------------------------------------------

  describe('handleDispose', () => {
    it('issues dispose order for each selected actor', () => {
      const actors = [createMockActor(7), createMockActor(8)]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleDispose('', world)

      expect(world.issuedOrders.length).toBe(2)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.Dispose)
      expect(world.issuedOrders[0].targetString).toBe('7')
      expect(world.issuedOrders[1].orderName).toBe(DevOrders.Dispose)
      expect(world.issuedOrders[1].targetString).toBe('8')
    })

    it('skips disposed actors', () => {
      const actors = [
        createMockActor(1, { disposed: true }),
        createMockActor(2, { disposed: false }),
        createMockActor(3, { disposed: true }),
      ]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })

      DevCommands.handleDispose('', world)

      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].targetString).toBe('2')
    })

    it('does nothing when selection is null', () => {
      const world = createMockWorld({ selection: null })
      DevCommands.handleDispose('', world)
      expect(world.issuedOrders.length).toBe(0)
    })

    it('does nothing when localPlayer is missing', () => {
      const world = createMockWorld({
        localPlayer: null,
        selection: createMockSelection([createMockActor(1)]),
      })
      DevCommands.handleDispose('', world)
      expect(world.issuedOrders.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // 命令注册表集成
  // -----------------------------------------------------------------------

  describe('command registry integration', () => {
    it('registered command triggers order via invokeCommand path', () => {
      const world = createMockWorld()
      const cmd = new DevCommands(world, createEnabledDevMode())
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      commands.get('give-cash')!.handler('give-cash', '200')

      expect(world.issuedOrders.length).toBe(1)
      expect(world.issuedOrders[0].orderName).toBe(DevOrders.GiveCash)
      expect(world.issuedOrders[0].extraData).toBe(200)
    })

    it('registered command respects devMode.enabled check', () => {
      const world = createMockWorld()
      const cmd = new DevCommands(world, createDisabledDevMode())
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)
      commands.get('visibility')!.handler('visibility', '')

      expect(world.issuedOrders.length).toBe(0)
    })

    it('registered command blocks when localPlayer is missing', () => {
      const world = createMockWorld({ localPlayer: null })
      const cmd = new DevCommands(world, createEnabledDevMode())
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)
      commands.get('give-cash')!.handler('give-cash', '100')

      expect(world.issuedOrders.length).toBe(0)
    })

    it('all registered commands are invocable without errors', () => {
      const actors = [createMockActor(1)]
      const world = createMockWorld({
        selection: createMockSelection(actors),
      })
      const cmd = new DevCommands(world, createEnabledDevMode())
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      // 所有简单切换命令应无异常执行
      for (const [name, entry] of commands) {
        if (name === 'crash') continue // 崩溃命令会抛出异常
        expect(() => entry.handler(name, '')).not.toThrow()
      }
    })

    it('crash command throws through registry', () => {
      const world = createMockWorld()
      const cmd = new DevCommands(world, createEnabledDevMode())
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      expect(() => {
        commands.get('crash')!.handler('crash', '')
      }).toThrow('Developer-triggered crash')
    })
  })

  // -----------------------------------------------------------------------
  // 描述内容
  // -----------------------------------------------------------------------

  describe('Descriptions', () => {
    it('all description keys are non-empty strings', () => {
      const descriptions = DevCommands.Descriptions
      for (const [, value] of Object.entries(descriptions)) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
    })
  })
})
