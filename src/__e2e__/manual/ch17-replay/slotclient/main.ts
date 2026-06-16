/**
 * main.ts -- SlotClient Serialization Round-Trip 人工验收测试
 *
 * 测试目标:
 *   1. 默认构造器所有字段为预期默认值
 *   2. SessionClient 构造器正确提取游戏相关字段（含 color hex 解析）
 *   3. serialize/deserialize JSON 往返完全等价
 *   4. applyTo 正确传输所有属性到 MutableSessionClient
 *   5. 边界情况: null Bot, 空字符串, 特殊颜色值
 *
 * OpenRA 对照: SlotClient inner class in GameSave.cs
 */

import { SlotClient } from '../../../../OpenRA.Game/Network/GameSave.js'
import type { MutableSessionClient } from '../../../../OpenRA.Game/Network/GameSave.js'
import { ClientState, ConnectionQuality } from '../../../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'
import type { SessionClient } from '../../../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resultLine(pass: boolean, label: string, detail?: string): string {
  const cls = pass ? 'pass' : 'fail'
  const icon = pass ? 'PASS' : 'FAIL'
  const detailStr = detail != null ? ` (${detail})` : ''
  return `<div class="test-result"><span class="${cls}">${icon}</span> ${label}${detailStr}</div>`
}

function setSection(id: string, html: string): void {
  document.getElementById(id)!.innerHTML = html
}

// ---------------------------------------------------------------------------
// Mock SessionClient factory
// ---------------------------------------------------------------------------

function makeSessionClient(overrides: Partial<{
  index: number; name: string; color: string; team: number; slot: string | null
  bot: string | null; isAdmin: boolean; isObserver: boolean; isBot: boolean
  spawnPoint: number; handicap: number; faction: string
}> = {}): SessionClient {
  return {
    index: overrides.index ?? 0,
    name: overrides.name ?? 'Player',
    color: overrides.color ?? '#FF0000',
    team: overrides.team ?? 0,
    slot: 'slot' in overrides ? overrides.slot! : 'Multi0',
    bot: 'bot' in overrides ? overrides.bot! : null,
    isAdmin: overrides.isAdmin ?? false,
    isObserver: overrides.isObserver ?? false,
    isBot: overrides.isBot ?? false,
    isReady: true,
    isInvalid: false,
    state: ClientState.Ready,
    connectionQuality: ConnectionQuality.Good,
    spawnPoint: overrides.spawnPoint ?? 0,
    handicap: overrides.handicap ?? 0,
    faction: overrides.faction ?? 'allies',
    fingerprint: null,
  }
}

// ---------------------------------------------------------------------------
// Test 1: Default constructor
// ---------------------------------------------------------------------------

function testDefault(): string {
  const lines: string[] = []
  const sc = new SlotClient()

  const checks: Array<[string, unknown, unknown]> = [
    ['color', JSON.stringify(sc.color), JSON.stringify({ r: 0, g: 0, b: 0, a: 255 })],
    ['faction', sc.faction, ''],
    ['spawnPoint', sc.spawnPoint, 0],
    ['team', sc.team, 0],
    ['handicap', sc.handicap, 0],
    ['slot', sc.slot, ''],
    ['bot', sc.bot, null],
    ['isAdmin', sc.isAdmin, false],
    ['botName', sc.botName, ''],
  ]

  for (const [field, actual, expected] of checks) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected)
    lines.push(resultLine(pass,
      `${field}: ${JSON.stringify(expected)}`,
      `got ${JSON.stringify(actual)}`))
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 2: SessionClient constructor
// ---------------------------------------------------------------------------

function testFromClient(): string {
  const lines: string[] = []

  // Test with a human player
  const client = makeSessionClient({
    index: 0,
    name: 'Commander',
    color: '#3366FF',
    faction: 'soviet',
    team: 2,
    spawnPoint: 1,
    handicap: 80,
    slot: 'Multi2',
    isAdmin: true,
    bot: null,
    isBot: false,
  })

  const sc = new SlotClient(client)

  // Color: #3366FF -> { r: 0x33=51, g: 0x66=102, b: 0xFF=255, a: 255 }
  lines.push(resultLine(sc.color.r === 0x33,
    `color.r = 51 (0x33)`, `got ${sc.color.r}`))
  lines.push(resultLine(sc.color.g === 0x66,
    `color.g = 102 (0x66)`, `got ${sc.color.g}`))
  lines.push(resultLine(sc.color.b === 0xFF,
    `color.b = 255 (0xFF)`, `got ${sc.color.b}`))
  lines.push(resultLine(sc.color.a === 255,
    `color.a = 255`, `got ${sc.color.a}`))
  lines.push(resultLine(sc.faction === 'soviet',
    `faction = "soviet"`, `got "${sc.faction}"`))
  lines.push(resultLine(sc.team === 2,
    `team = 2`, `got ${sc.team}`))
  lines.push(resultLine(sc.spawnPoint === 1,
    `spawnPoint = 1`, `got ${sc.spawnPoint}`))
  lines.push(resultLine(sc.handicap === 80,
    `handicap = 80`, `got ${sc.handicap}`))
  lines.push(resultLine(sc.slot === 'Multi2',
    `slot = "Multi2"`, `got "${sc.slot}"`))
  lines.push(resultLine(sc.isAdmin === true,
    `isAdmin = true`, `got ${sc.isAdmin}`))
  lines.push(resultLine(sc.bot === null,
    `bot = null`, `got ${JSON.stringify(sc.bot)}`))
  lines.push(resultLine(sc.botName === '',
    'bot=null 时 botName = ""', `got "${sc.botName}"`))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 3: serialize/deserialize round-trip
// ---------------------------------------------------------------------------

function testSerializeRoundTrip(): string {
  const lines: string[] = []

  // Create a fully-populated SlotClient
  const client = makeSessionClient({
    name: 'General',
    color: '#AA4477',
    faction: 'allies',
    team: 1,
    spawnPoint: 3,
    handicap: 50,
    slot: 'Multi3',
    isAdmin: false,
    bot: 'HardBot',
    isBot: true,
  })
  const original = new SlotClient(client)

  // Serialize
  const serialized = original.serialize('Multi3')
  lines.push(resultLine(serialized.key === 'SlotClient@Multi3',
    `serialize key = "SlotClient@Multi3"`, `got "${serialized.key}"`))
  lines.push(resultLine(typeof serialized.value === 'object' && serialized.value !== null,
    'serialize value 为非空对象'))

  // Show JSON
  const jsonStr = JSON.stringify(serialized.value, null, 2)
  setSection('section-serialize',
    `<div class="test-section" style="margin:0;border:none;"><h4>序列化输出</h4><div class="body"><div class="json-display">${jsonStr}</div></div></div>` +
    lines.map(l => `<div>${l}</div>`).join(''))

  // Deserialize
  const restored = SlotClient.deserialize(serialized.value)

  const checks: Array<[string, unknown, unknown, (a: unknown, b: unknown) => boolean]> = [
    ['color', JSON.stringify(original.color), JSON.stringify(restored.color), (a, b) => a === b],
    ['faction', original.faction, restored.faction, (a, b) => a === b],
    ['spawnPoint', original.spawnPoint, restored.spawnPoint, (a, b) => a === b],
    ['team', original.team, restored.team, (a, b) => a === b],
    ['handicap', original.handicap, restored.handicap, (a, b) => a === b],
    ['slot', original.slot, restored.slot, (a, b) => a === b],
    ['bot', original.bot, restored.bot, (a, b) => a === b],
    ['isAdmin', original.isAdmin, restored.isAdmin, (a, b) => a === b],
    ['botName', original.botName, restored.botName, (a, b) => a === b],
  ]

  for (const [field, expected, actual, cmp] of checks) {
    const pass = cmp(expected, actual)
    lines.push(resultLine(pass,
      `往返: ${field} = ${JSON.stringify(expected)}`,
      `restored = ${JSON.stringify(actual)}`))
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 4: applyTo
// ---------------------------------------------------------------------------

function testApplyTo(): string {
  const lines: string[] = []

  // Create SlotClient from bot (to test name transfer)
  const client = makeSessionClient({
    name: 'RobotX',
    color: '#00FF00',
    faction: 'soviet',
    team: 3,
    spawnPoint: 2,
    handicap: 100,
    slot: 'Multi1',
    isAdmin: false,
    bot: 'EasyBot',
    isBot: true,
  })
  const sc = new SlotClient(client)

  // Create mutable client with all fields different
  const mutable: MutableSessionClient = {
    color: '#000000',
    faction: '',
    spawnPoint: 0,
    team: 0,
    handicap: 0,
    slot: null,
    bot: null,
    isAdmin: false,
    name: '',
  }

  sc.applyTo(mutable)

  // Verify all fields transferred
  lines.push(resultLine(mutable.color === '#00ff00',
    `applyTo: color = "#00ff00"`, `got "${mutable.color}"`))
  lines.push(resultLine(mutable.faction === 'soviet',
    `applyTo: faction = "soviet"`, `got "${mutable.faction}"`))
  lines.push(resultLine(mutable.spawnPoint === 2,
    `applyTo: spawnPoint = 2`, `got ${mutable.spawnPoint}`))
  lines.push(resultLine(mutable.team === 3,
    `applyTo: team = 3`, `got ${mutable.team}`))
  lines.push(resultLine(mutable.handicap === 100,
    `applyTo: handicap = 100`, `got ${mutable.handicap}`))
  lines.push(resultLine(mutable.slot === 'Multi1',
    `applyTo: slot = "Multi1"`, `got "${mutable.slot}"`))
  lines.push(resultLine(mutable.bot === 'EasyBot',
    `applyTo: bot = "EasyBot"`, `got "${mutable.bot}"`))
  lines.push(resultLine(mutable.isAdmin === false,
    `applyTo: isAdmin = false`, `got ${mutable.isAdmin}`))
  lines.push(resultLine(mutable.name === 'RobotX',
    `applyTo: bot !== null -> name = "RobotX"`, `got "${mutable.name}"`))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 5: Edge cases
// ---------------------------------------------------------------------------

function testEdgeCases(): string {
  const lines: string[] = []

  // Edge 1: null bot client
  const humanClient = makeSessionClient({ bot: null, isBot: false, name: 'Human' })
  const sc1 = new SlotClient(humanClient)
  lines.push(resultLine(sc1.bot === null,
    'null Bot: bot = null'))
  lines.push(resultLine(sc1.botName === '',
    'null Bot: botName = ""'))

  // Edge 2: serialize default SlotClient
  const defaultSc = new SlotClient()
  const serialized = defaultSc.serialize('')
  lines.push(resultLine(serialized.key === 'SlotClient@',
    '默认 SC: serialize key = "SlotClient@"'))
  const defaultJson = JSON.stringify(serialized.value)
  lines.push(resultLine(defaultJson.includes('"faction"'),
    '默认 SC: serialize 包含 faction 字段'))
  lines.push(resultLine(defaultJson.includes('"bot"'),
    '默认 SC: serialize 包含 bot 字段'))

  // Edge 3: color parsing variations
  // "#AABBCC" -> { r: 0xAA, g: 0xBB, b: 0xCC, a: 255 }
  const colorClient1 = makeSessionClient({ color: '#AABBCC' })
  const sc2 = new SlotClient(colorClient1)
  lines.push(resultLine(sc2.color.r === 0xAA && sc2.color.g === 0xBB && sc2.color.b === 0xCC && sc2.color.a === 255,
    'color "#AABBCC": r=170 g=187 b=204 a=255',
    `got r=${sc2.color.r} g=${sc2.color.g} b=${sc2.color.b} a=${sc2.color.a}`))

  // "#DDEEFF00" (with alpha) -> { r: 0xEE, g: 0xFF, b: 0x00, a: 0xDD }
  const colorClient2 = makeSessionClient({ color: '#DDEEFF00' })
  const sc3 = new SlotClient(colorClient2)
  lines.push(resultLine(sc3.color.r === 0xEE && sc3.color.g === 0xFF && sc3.color.b === 0x00 && sc3.color.a === 0xDD,
    'color "#DDEEFF00": r=238 g=255 b=0 a=221',
    `got r=${sc3.color.r} g=${sc3.color.g} b=${sc3.color.b} a=${sc3.color.a}`))

  // Edge 4: deserialize from empty object
  const restored = SlotClient.deserialize({})
  lines.push(resultLine(restored.faction === '',
    'deserialize({}): faction = ""'))
  lines.push(resultLine(restored.bot === null,
    'deserialize({}): bot = null'))
  lines.push(resultLine(restored.botName === '',
    'deserialize({}): botName = ""'))

  // Edge 5: applyTo with null bot (name should NOT be transferred)
  const humanSc = new SlotClient(humanClient)
  const mutable2: MutableSessionClient = {
    color: '', faction: '', spawnPoint: 0, team: 0, handicap: 0,
    slot: null, bot: null, isAdmin: false, name: 'ORIGINAL_NAME',
  }
  humanSc.applyTo(mutable2)
  lines.push(resultLine(mutable2.name === 'ORIGINAL_NAME',
    'applyTo(bot=null): name 不受影响 = "ORIGINAL_NAME"',
    `got "${mutable2.name}"`))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Full test
// ---------------------------------------------------------------------------

function runFullTest(): void {
  setSection('section-default', testDefault())
  setSection('section-client', testFromClient())
  setSection('section-serialize', testSerializeRoundTrip())
  setSection('section-applyto', testApplyTo())
  setSection('section-edge', testEdgeCases())
}

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Button wiring
// ---------------------------------------------------------------------------

document.getElementById('btn-run-all')!.addEventListener('click', runFullTest)
document.getElementById('btn-test-default')!.addEventListener('click', () => setSection('section-default', testDefault()))
document.getElementById('btn-test-client')!.addEventListener('click', () => setSection('section-client', testFromClient()))
document.getElementById('btn-test-serialize')!.addEventListener('click', () => {
  testSerializeRoundTrip()
})
document.getElementById('btn-test-applyto')!.addEventListener('click', () => setSection('section-applyto', testApplyTo()))
document.getElementById('btn-test-edge')!.addEventListener('click', () => setSection('section-edge', testEdgeCases()))

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

updateInfoBar()
setInterval(updateInfoBar, 1000)

// Auto-run all tests on load
runFullTest()

console.log('[ch17-replay/slotclient] Acceptance test page loaded.')
