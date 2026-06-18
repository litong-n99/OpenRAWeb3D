/**
 * DebugVisualizationCommands.test.ts — DebugVisualizationCommands 迁移单元测试
 *
 * 测试焦点：状态管理、命令注册、命令分发、权限检查、
 * 切换逻辑和错误处理。
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// 导入被测模块
// ---------------------------------------------------------------------------

import {
  DebugVisualizationCommands,
  DebugVisualizationCommandsInfo,
  type DebugVisualizations,
  type CommandRegistry,
} from './DebugVisualizationCommands'

// ---------------------------------------------------------------------------
// 测试辅助：创建一个可变的 DebugVisualizations 桩
// ---------------------------------------------------------------------------

function createMockDebugVis(overrides: Partial<DebugVisualizations> = {}): DebugVisualizations {
  return {
    combatGeometry: false,
    renderGeometry: false,
    screenMap: false,
    depthBuffer: false,
    actorTags: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 测试辅助：创建一个模拟的 CommandRegistry
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

describe('DebugVisualizationCommands', () => {
  // -----------------------------------------------------------------------
  // 命令常量
  // -----------------------------------------------------------------------

  describe('Commands constants', () => {
    it('defines five command names', () => {
      expect(DebugVisualizationCommands.Commands.CombatGeometry).toBe('combat-geometry')
      expect(DebugVisualizationCommands.Commands.RenderGeometry).toBe('render-geometry')
      expect(DebugVisualizationCommands.Commands.ScreenMap).toBe('screen-map')
      expect(DebugVisualizationCommands.Commands.DepthBuffer).toBe('depth-buffer')
      expect(DebugVisualizationCommands.Commands.ActorTags).toBe('actor-tags')
    })
  })

  describe('Orders constants', () => {
    it('defines order strings for each command', () => {
      expect(DebugVisualizationCommands.Orders.CombatGeometry).toBe('DevCombatGeometry')
      expect(DebugVisualizationCommands.Orders.RenderGeometry).toBe('DevRenderGeometry')
      expect(DebugVisualizationCommands.Orders.ScreenMap).toBe('DevScreenMap')
      expect(DebugVisualizationCommands.Orders.DepthBuffer).toBe('DevDepthBuffer')
      expect(DebugVisualizationCommands.Orders.ActorTags).toBe('DevActorTags')
    })
  })

  describe('Descriptions constants', () => {
    it('provides description keys for each command', () => {
      expect(DebugVisualizationCommands.Descriptions.CombatGeometry).toBeTruthy()
      expect(DebugVisualizationCommands.Descriptions.RenderGeometry).toBeTruthy()
      expect(DebugVisualizationCommands.Descriptions.ScreenMap).toBeTruthy()
      expect(DebugVisualizationCommands.Descriptions.DepthBuffer).toBeTruthy()
      expect(DebugVisualizationCommands.Descriptions.ActorTags).toBeTruthy()
    })
  })

  // -----------------------------------------------------------------------
  // 静态切换方法
  // -----------------------------------------------------------------------

  describe('static toggle methods', () => {
    let debugVis: DebugVisualizations

    beforeEach(() => {
      debugVis = createMockDebugVis()
    })

    it('toggleCombatGeometry flips combatGeometry from false to true', () => {
      expect(debugVis.combatGeometry).toBe(false)
      DebugVisualizationCommands.toggleCombatGeometry(debugVis)
      expect(debugVis.combatGeometry).toBe(true)
    })

    it('toggleCombatGeometry flips combatGeometry from true to false', () => {
      debugVis.combatGeometry = true
      DebugVisualizationCommands.toggleCombatGeometry(debugVis)
      expect(debugVis.combatGeometry).toBe(false)
    })

    it('toggleRenderGeometry flips renderGeometry', () => {
      expect(debugVis.renderGeometry).toBe(false)
      DebugVisualizationCommands.toggleRenderGeometry(debugVis)
      expect(debugVis.renderGeometry).toBe(true)
      DebugVisualizationCommands.toggleRenderGeometry(debugVis)
      expect(debugVis.renderGeometry).toBe(false)
    })

    it('toggleScreenMap flips screenMap', () => {
      expect(debugVis.screenMap).toBe(false)
      DebugVisualizationCommands.toggleScreenMap(debugVis)
      expect(debugVis.screenMap).toBe(true)
    })

    it('toggleDepthBuffer flips depthBuffer', () => {
      expect(debugVis.depthBuffer).toBe(false)
      DebugVisualizationCommands.toggleDepthBuffer(debugVis)
      expect(debugVis.depthBuffer).toBe(true)
    })

    it('toggleActorTags flips actorTags', () => {
      expect(debugVis.actorTags).toBe(false)
      DebugVisualizationCommands.toggleActorTags(debugVis)
      expect(debugVis.actorTags).toBe(true)
    })

    it('each toggle is independent', () => {
      DebugVisualizationCommands.toggleCombatGeometry(debugVis)
      DebugVisualizationCommands.toggleRenderGeometry(debugVis)
      expect(debugVis.combatGeometry).toBe(true)
      expect(debugVis.renderGeometry).toBe(true)
      expect(debugVis.screenMap).toBe(false)
      expect(debugVis.depthBuffer).toBe(false)
      expect(debugVis.actorTags).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // 构造
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('creates instance with all parameters null by default', () => {
      const cmd = new DebugVisualizationCommands()
      const names = Array.from(cmd.getCommandNames())
      expect(names).toHaveLength(5)
      expect(names).toContain('combat-geometry')
    })

    it('creates instance with provided debugVis and devMode', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode, 'TestPlayer')
      const names = Array.from(cmd.getCommandNames())
      expect(names).toHaveLength(5)
    })

    it('getCommandNames returns all five command names', () => {
      const cmd = new DebugVisualizationCommands()
      const names = Array.from(cmd.getCommandNames())
      expect(names.sort()).toEqual([
        'actor-tags',
        'combat-geometry',
        'depth-buffer',
        'render-geometry',
        'screen-map',
      ])
    })
  })

  // -----------------------------------------------------------------------
  // getDescription
  // -----------------------------------------------------------------------

  describe('getDescription', () => {
    it('returns description for known command', () => {
      const cmd = new DebugVisualizationCommands()
      const desc = cmd.getDescription('combat-geometry')
      expect(desc).toBe(DebugVisualizationCommands.Descriptions.CombatGeometry)
    })

    it('returns the command name as fallback for unknown command', () => {
      const cmd = new DebugVisualizationCommands()
      const desc = cmd.getDescription('unknown-command')
      expect(desc).toBe('unknown-command')
    })
  })

  // -----------------------------------------------------------------------
  // registerCommands
  // -----------------------------------------------------------------------

  describe('registerCommands', () => {
    it('registers all commands when debugVis, devMode, and enableDepthBuffer are available', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode, 'TestPlayer')
      const { registry, commands } = createMockRegistry()

      // 显式传递 enableDepthBuffer=true 以注册所有 5 个命令
      cmd.registerCommands(registry, true)

      expect(commands.size).toBe(5)
      expect(commands.has('combat-geometry')).toBe(true)
      expect(commands.has('render-geometry')).toBe(true)
      expect(commands.has('screen-map')).toBe(true)
      expect(commands.has('depth-buffer')).toBe(true)
      expect(commands.has('actor-tags')).toBe(true)
    })

    it('registers help text for each command', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode)
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      for (const [, entry] of commands) {
        expect(entry.help).toBeTruthy()
        expect(typeof entry.help).toBe('string')
      }
    })

    it('skips depth-buffer when enableDepthBuffer is false', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode)
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry, false)

      expect(commands.size).toBe(4)
      expect(commands.has('depth-buffer')).toBe(false)
      expect(commands.has('combat-geometry')).toBe(true)
    })

    it('includes depth-buffer when enableDepthBuffer is true', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode)
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry, true)

      expect(commands.size).toBe(5)
      expect(commands.has('depth-buffer')).toBe(true)
    })

    it('does not register commands when debugVis is null (constructor default)', () => {
      const cmd = new DebugVisualizationCommands() // 没有 debugVis
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      expect(commands.size).toBe(0)
    })

    it('does not register commands when devMode is null', () => {
      const debugVis = createMockDebugVis()
      const cmd = new DebugVisualizationCommands(debugVis, null) // 没有 devMode
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      expect(commands.size).toBe(0)
    })

    it('respects enableDepthBuffer default of false', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode)
      const { registry, commands } = createMockRegistry()

      // 无显式 enableDepthBuffer — 默认为 false
      cmd.registerCommands(registry)

      expect(commands.has('depth-buffer')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // invokeCommand — 命令分发
  // -----------------------------------------------------------------------

  describe('invokeCommand', () => {
    let debugVis: DebugVisualizations
    let devMode: { enabled: boolean }
    let cmd: DebugVisualizationCommands

    beforeEach(() => {
      debugVis = createMockDebugVis()
      devMode = { enabled: true }
      cmd = new DebugVisualizationCommands(debugVis, devMode, 'TestPlayer')
    })

    it('toggles combat-geometry via invokeCommand', () => {
      expect(debugVis.combatGeometry).toBe(false)
      cmd.invokeCommand('combat-geometry', '')
      expect(debugVis.combatGeometry).toBe(true)
      cmd.invokeCommand('combat-geometry', '')
      expect(debugVis.combatGeometry).toBe(false)
    })

    it('toggles render-geometry via invokeCommand', () => {
      cmd.invokeCommand('render-geometry', '')
      expect(debugVis.renderGeometry).toBe(true)
    })

    it('toggles screen-map via invokeCommand', () => {
      cmd.invokeCommand('screen-map', '')
      expect(debugVis.screenMap).toBe(true)
    })

    it('toggles depth-buffer via invokeCommand', () => {
      cmd.invokeCommand('depth-buffer', '')
      expect(debugVis.depthBuffer).toBe(true)
    })

    it('toggles actor-tags via invokeCommand', () => {
      cmd.invokeCommand('actor-tags', '')
      expect(debugVis.actorTags).toBe(true)
    })

    it('ignores unknown command names', () => {
      const before = { ...debugVis }
      cmd.invokeCommand('nonexistent', '')
      expect(debugVis).toEqual(before)
    })

    it('ignores arg parameter (toggle commands are arg-less)', () => {
      cmd.invokeCommand('combat-geometry', 'some-ignored-arg')
      expect(debugVis.combatGeometry).toBe(true)
    })

    // -------------------------------------------------------------------
    // 权限检查
    // -------------------------------------------------------------------

    describe('permission checks', () => {
      it('blocks command when devMode is disabled', () => {
        devMode.enabled = false
        cmd.invokeCommand('combat-geometry', '')
        expect(debugVis.combatGeometry).toBe(false) // 未更改
      })

      it('blocks command when devMode is null (constructor)', () => {
        const noDevCmd = new DebugVisualizationCommands(debugVis, null)
        noDevCmd.invokeCommand('combat-geometry', '')
        expect(debugVis.combatGeometry).toBe(false)
      })

      it('blocks command when debugVis is null', () => {
        const noVisCmd = new DebugVisualizationCommands(undefined, devMode)
        noVisCmd.invokeCommand('combat-geometry', '')
        // 不应抛出异常 — 静默无操作
      })
    })
  })

  // -----------------------------------------------------------------------
  // 命令注册表集成 — 注册的命令正确触发切换
  // -----------------------------------------------------------------------

  describe('command registry integration', () => {
    it('registered command handler toggles the correct flag', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode, 'Player')
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      // 通过注册表调用 render-geometry 处理函数
      const entry = commands.get('render-geometry')
      expect(entry).toBeDefined()
      entry!.handler('render-geometry', '')

      expect(debugVis.renderGeometry).toBe(true)
    })

    it('registered command respects devMode.enabled', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: false }
      const cmd = new DebugVisualizationCommands(debugVis, devMode, 'Player')
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      const entry = commands.get('screen-map')
      entry!.handler('screen-map', '')

      expect(debugVis.screenMap).toBe(false) // 被阻止
    })

    it('multiple toggles compound correctly through registry', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode, 'Player')
      const { registry, commands } = createMockRegistry()

      cmd.registerCommands(registry)

      commands.get('actor-tags')!.handler('actor-tags', '')
      commands.get('combat-geometry')!.handler('combat-geometry', '')
      commands.get('render-geometry')!.handler('render-geometry', '')

      expect(debugVis.actorTags).toBe(true)
      expect(debugVis.combatGeometry).toBe(true)
      expect(debugVis.renderGeometry).toBe(true)
      expect(debugVis.screenMap).toBe(false)
      expect(debugVis.depthBuffer).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // 通知行为
  // -----------------------------------------------------------------------

  describe('notification behavior', () => {
    it('does not throw when invoking with all valid parameters', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode, 'Player')

      expect(() => {
        cmd.invokeCommand('combat-geometry', '')
      }).not.toThrow()
    })

    it('does not throw when playerName is empty', () => {
      const debugVis = createMockDebugVis()
      const devMode = { enabled: true }
      const cmd = new DebugVisualizationCommands(debugVis, devMode, '')

      expect(() => {
        cmd.invokeCommand('render-geometry', '')
      }).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // DebugVisualizationCommandsInfo — TraitInfo marker
  // -----------------------------------------------------------------------

  describe('DebugVisualizationCommandsInfo', () => {
    it('creates with default instanceName undefined', () => {
      const info = new DebugVisualizationCommandsInfo()
      expect(info.instanceName).toBeUndefined()
    })

    it('creates with explicit instanceName', () => {
      const info = new DebugVisualizationCommandsInfo({ instanceName: 'my-debug-cmds' })
      expect(info.instanceName).toBe('my-debug-cmds')
    })

    it('implements ITraitInfo marker', () => {
      const info = new DebugVisualizationCommandsInfo()
      // 如果没有 instanceName 方法，这至少验证 info 的类型安全性
      expect('instanceName' in info).toBe(true)
    })
  })
})
