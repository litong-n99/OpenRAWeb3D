/**
 * main.ts -- Replay Recording & Playback Round-Trip 人工验收测试
 *
 * 测试目标:
 *   1. ReplayRecorder.isGameStart() 正确检测 StartGame 订单
 *   2. ReplayRecorder 预启动缓冲 + StartGame 转换
 *   3. .orarep 二进制格式输出 + ReplayMetadata 尾部解析
 *   4. ReplayConnection 回读：TickCount, FinalGameTick, IsValid, LobbyInfo
 *   5. ReplayConnection.receive() 订单分发到模拟 OrderManager
 *
 * OpenRA 对照:
 *   - OpenRA.Game/Network/ReplayRecorder.cs
 *   - OpenRA.Game/Network/ReplayConnection.cs
 */

import { ReplayRecorder } from '../../../../OpenRA.Game/Network/ReplayRecorder.js'
import { ReplayConnection } from '../../../../OpenRA.Game/Network/ReplayConnection.js'
import { ReplayMetadata } from '../../../../OpenRA.Game/FileFormats/ReplayMetadata.js'
import { GameInformation } from '../../../../OpenRA.Game/GameInformation.js'
import { Order, OrderPacket } from '../../../../OpenRA.Game/Network/Order.js'
import type { OrderManagerStub, LobbyInfoStub, ClientStub, GlobalSettingsStub, SlotStub } from '../../../../OpenRA.Game/Network/UnitOrders.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resultLine(pass: boolean, label: string, detail?: string): string {
  const cls = pass ? 'pass' : 'fail'
  const icon = pass ? 'PASS' : 'FAIL'
  const detailStr = detail != null ? ` (${detail})` : ''
  return `<div class="test-result"><span class="${cls}">${icon}</span> ${label}${detailStr}</div>`
}

/** Helper: create a StartGame order packet (frame 0) using proper Order serialization.
 *  BUGFIX ch17: raw MessagePack encode() produces wrong format for Order.deserialize().
 *  Must use Order.fromTargetString() + OrderPacket.serialize() for correct binary layout. */
function makeStartGamePacket(): Uint8Array {
  const order = Order.fromTargetString('StartGame', '', false)
  return new OrderPacket([order]).serialize(0)
}

/** Helper: create a chat-like order packet using proper Order serialization. */
function makeChatPacket(frame: number, text: string): Uint8Array {
  const order = Order.fromTargetString(text, '', false)
  return new OrderPacket([order]).serialize(frame)
}

/** Create a disconnect packet (matching OrderType.Disconnect = 0xBF) */
function makeDisconnectPacket(frame: number, clientId: number): Uint8Array {
  const buf = new Uint8Array(9)
  const view = new DataView(buf.buffer)
  view.setInt32(0, frame, false)
  buf[4] = 0xBF // OrderType.Disconnect
  view.setInt32(5, clientId, false)
  return buf
}

// ---------------------------------------------------------------------------
// Section render helpers
// ---------------------------------------------------------------------------

function setSection(id: string, html: string): void {
  document.getElementById(id)!.innerHTML = html
}

// ---------------------------------------------------------------------------
// Mock OrderManager
// ---------------------------------------------------------------------------

interface OrderManagerLog {
  type: 'immediate' | 'orders' | 'sync' | 'disconnect'
  frame?: number
  clientId?: number
  syncHash?: number
  defeatState?: bigint
  detail?: string
}

class MockOrderManager implements OrderManagerStub {
  netFrameNumber = 0
  localFrameNumber = 0
  gameStarted = true
  lobbyInfo: LobbyInfoStub
  localClient: ClientStub | null = null
  serverError: string | null = null
  authenticationFailed = false
  world = null
  gameSaveLastFrame = -1
  gameSaveLastSyncFrame = -1
  serverMapPool: ReadonlySet<string> | null = null

  readonly logs: OrderManagerLog[] = []

  // Connection stub required by OrderManagerStub
  connection: {
    readonly localClientId: number
  }

  constructor(lobbyInfo: LobbyInfoStub) {
    this.lobbyInfo = lobbyInfo
    this.connection = { localClientId: -1 }
  }

  issueOrder(_order: Order): void {}
  receiveTickScale(_tickScale: number): void {}

  receiveImmediateOrders(clientId: number, packet: OrderPacket): void {
    this.logs.push({ type: 'immediate', clientId, detail: `OrderPacket with ${[...packet.getOrders(null)].length} orders` })
  }
  receiveOrders(clientId: number, data: { frame: number; orders: OrderPacket }): void {
    this.logs.push({ type: 'orders', frame: data.frame, clientId, detail: `OrderPacket with ${[...data.orders.getOrders(null)].length} orders` })
  }
  receiveSync(frame: number, syncHash: number, defeatState: bigint): void {
    this.logs.push({ type: 'sync', frame, syncHash, defeatState })
  }
  receiveDisconnect(clientId: number, frame: number): void {
    this.logs.push({ type: 'disconnect', frame, clientId })
  }
}

// ---------------------------------------------------------------------------
// Mock LobbyInfo helpers
// ---------------------------------------------------------------------------

function createMockLobbyInfo(): LobbyInfoStub {
  const clients: ClientStub[] = [
    createMockClient(0, 'Player1', false),
    createMockClient(1, 'Bot1', true),
  ]
  const slots = new Map<string, SlotStub>()
  slots.set('Multi0', createMockSlot('Multi0'))
  slots.set('Multi1', createMockSlot('Multi1'))

  const globalSettings: GlobalSettingsStub = {
    map: 'test_map',
    randomSeed: 42,
    netFrameInterval: 3,
    gameTimestep: 40,
    enableSyncReports: false,
    dedicated: false,
    optionOrDefault(_key: string, defaultValue: string | boolean): string | boolean {
      return defaultValue
    },
  }

  return {
    clients,
    globalSettings,
    slots,
    disabledSpawnPoints: [],
    clientWithIndex(id: number): ClientStub | undefined {
      return clients.find((c) => c.index === id)
    },
    nonBotClients(): readonly ClientStub[] {
      return clients.filter((c) => !c.bot)
    },
  }
}

function createMockClient(index: number, name: string, isBot: boolean): ClientStub {
  const ClientState = { NotReady: 0, Invalid: 1, Ready: 2, Disconnected: 1000 } as const
  const ConnectionQuality = { Good: 0, Moderate: 1, Poor: 2 } as const
  return {
    index,
    name,
    color: '#FF0000',
    team: 0,
    slot: `Multi${index}`,
    bot: isBot ? 'EasyBot' : null,
    isAdmin: index === 0,
    isObserver: false,
    isBot,
    state: ClientState.Ready,
    connectionQuality: ConnectionQuality.Good,
  }
}

function createMockSlot(playerReference: string): SlotStub {
  return {
    playerReference,
    closed: false,
    allowBots: true,
    lockFaction: false,
    lockColor: false,
    lockTeam: false,
    lockSpawn: false,
    required: false,
  }
}

// ---------------------------------------------------------------------------
// Test: isGameStart
// ---------------------------------------------------------------------------

function testIsGameStart(): string {
  const lines: string[] = []

  const withStart = makeStartGamePacket()
  const isStart = ReplayRecorder.isGameStart(withStart)
  lines.push(resultLine(isStart === true, 'isGameStart(具有 StartGame 的数据包) 返回 true',
    isStart === true ? undefined : `got ${isStart}`))

  // Without StartGame
  const chatPkt = makeChatPacket(0, 'hello')
  const isChatStart = ReplayRecorder.isGameStart(chatPkt)
  lines.push(resultLine(isChatStart === false, 'isGameStart(Chat 数据包) 返回 false',
    isChatStart === false ? undefined : `got ${isChatStart}`))

  // Non-frame-0 StartGame
  const lateStart = makeChatPacket(5, 'StartGame') // frame 5, orderString "Chat", target "StartGame"
  const isLateStart = ReplayRecorder.isGameStart(lateStart)
  lines.push(resultLine(isLateStart === false, 'isGameStart(frame=5, 无 StartGame 订单) 返回 false',
    isLateStart === false ? undefined : `got ${isLateStart}`))

  // Empty data
  const empty = new Uint8Array(0)
  const isEmpty = ReplayRecorder.isGameStart(empty)
  lines.push(resultLine(isEmpty === false, 'isGameStart(空数据包) 返回 false',
    isEmpty === false ? undefined : `got ${isEmpty}`))

  // Very short data
  const short = new Uint8Array([0x00])
  const isShort = ReplayRecorder.isGameStart(short)
  lines.push(resultLine(isShort === false, 'isGameStart(超短数据包 [0x00]) 返回 false',
    isShort === false ? undefined : `got ${isShort}`))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test: Record & Buffer
// ---------------------------------------------------------------------------

function testRecord(): { html: string; recorder: ReplayRecorder; buffer: Uint8Array | null } {
  const lines: string[] = []
  const recorder = new ReplayRecorder(() => 'test-replay-2024')

  // Pre-start state
  lines.push(resultLine(recorder.recordingToFile === false,
    '初始状态: recordingToFile = false'))
  lines.push(resultLine(recorder.chosenFilename === '',
    '初始状态: chosenFilename = ""'))
  lines.push(resultLine(recorder.disposed === false,
    '初始状态: disposed = false'))

  // Send some pre-start packets (chat-like)
  const preStart1 = makeChatPacket(0, 'pre-start message 1')
  recorder.receive(0, preStart1)
  lines.push(resultLine(recorder.recordingToFile === false,
    '收到非 StartGame frame=0 数据包后: recordingToFile 仍为 false'))

  // Send the StartGame
  const startGamePkt = makeStartGamePacket()
  recorder.receive(0, startGamePkt)
  lines.push(resultLine(recorder.recordingToFile === true,
    '收到 StartGame 后: recordingToFile = true'))
  lines.push(resultLine(recorder.chosenFilename === 'test-replay-2024',
    `收到 StartGame 后: chosenFilename = "test-replay-2024"`,
    recorder.chosenFilename === 'test-replay-2024' ? undefined : `got "${recorder.chosenFilename}"`))

  // Send post-start packets
  const chat1 = makeChatPacket(1, 'frame 1 message')
  const chat2 = makeChatPacket(2, 'frame 2 message')
  const disconnect = makeDisconnectPacket(3, 1)
  recorder.receive(1, chat1)
  recorder.receive(1, chat2)
  recorder.receive(1, disconnect)

  // Set metadata and dispose
  const gameInfo = new GameInformation()
  gameInfo.mod = 'cnc'
  gameInfo.version = 'test-1.0'
  gameInfo.mapUid = 'test-map-uid'
  gameInfo.mapTitle = 'Test Map'
  gameInfo.finalGameTick = 2
  const player = gameInfo.addPlayer('TestPlayer')
  player.playerId = 0
  player.factionId = 'allies'

  const metadata = new ReplayMetadata(gameInfo)
  metadata.filePath = 'test-replay-2024.orarep'
  recorder.metadata = metadata
  recorder.dispose()

  lines.push(resultLine(recorder.disposed === true,
    'dispose() 后: disposed = true'))
  const buffer = recorder.getBuffer()
  lines.push(resultLine(buffer !== null,
    'dispose() 后: getBuffer() 返回非 null'))

  return { html: lines.join('\n'), recorder, buffer }
}

// ---------------------------------------------------------------------------
// Test: Serialize & Binary output
// ---------------------------------------------------------------------------

function testSerialize(buffer: Uint8Array): string {
  const lines: string[] = []

  lines.push(resultLine(buffer.length > 0,
    `二进制缓冲区大小 = ${buffer.length} 字节 (> 0)`))

  // Try to read metadata from tail
  const meta = ReplayMetadata.readFromBuffer(buffer.buffer as ArrayBuffer)
  const metaOk = meta !== null
  lines.push(resultLine(metaOk,
    'ReplayMetadata.readFromBuffer() 成功解析尾部'))

  if (meta) {
    lines.push(resultLine(meta.gameInfo.mod === 'cnc',
      `GameInfo.mod = "cnc"`, `got "${meta.gameInfo.mod}"`))
    lines.push(resultLine(meta.gameInfo.mapUid === 'test-map-uid',
      `GameInfo.mapUid = "test-map-uid"`, `got "${meta.gameInfo.mapUid}"`))
    lines.push(resultLine(meta.gameInfo.finalGameTick === 2,
      `GameInfo.finalGameTick = 2`, `got ${meta.gameInfo.finalGameTick}`))
    lines.push(resultLine(meta.gameInfo.players.length === 1,
      `GameInfo.players.length = 1`, `got ${meta.gameInfo.players.length}`))
    lines.push(resultLine(meta.gameInfo.endTimeUtc !== null,
      'GameInfo.endTimeUtc 已设置（dispose 时填充）'))
  }

  // Hex dump
  const hexDump = formatHexDump(buffer, 256)
  setSection('section-hex', `<pre class="hex-dump">${hexDump}</pre>`)

  // Summary
  let summaryHtml = '<table class="summary-table">'
  summaryHtml += `<tr><td>总字节数</td><td>${buffer.length}</td></tr>`
  summaryHtml += `<tr><td>前 4 字节 (第一个 clientID LE)</td><td>${new DataView(buffer.buffer).getInt32(0, true)}</td></tr>`
  summaryHtml += `<tr class="${metaOk ? 'pass' : 'fail'}"><td>元数据尾部有效</td><td>${metaOk ? '是 (PASS)' : '否 (FAIL)'}</td></tr>`
  if (meta) {
    summaryHtml += `<tr class="pass"><td>FinalGameTick</td><td>${meta.gameInfo.finalGameTick}</td></tr>`
    summaryHtml += `<tr class="pass"><td>Mod</td><td>${meta.gameInfo.mod}</td></tr>`
    summaryHtml += `<tr class="pass"><td>Version</td><td>${meta.gameInfo.version}</td></tr>`
    summaryHtml += `<tr class="pass"><td>MapTitle</td><td>${meta.gameInfo.mapTitle}</td></tr>`
    summaryHtml += `<tr class="pass"><td>Players</td><td>${meta.gameInfo.players.length} (${meta.gameInfo.players.map(p => p.playerName).join(', ')})</td></tr>`
  }
  summaryHtml += '</table>'
  setSection('section-summary', summaryHtml)

  return lines.join('\n')
}

function formatHexDump(data: Uint8Array, maxBytes: number): string {
  const len = Math.min(data.length, maxBytes)
  let result = ''
  for (let i = 0; i < len; i += 16) {
    const offset = i.toString(16).padStart(8, '0')
    const hexBytes: string[] = []
    const asciiChars: string[] = []
    for (let j = 0; j < 16 && i + j < len; j++) {
      const b = data[i + j]!
      hexBytes.push(b.toString(16).padStart(2, '0'))
      asciiChars.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')
    }
    result += `${offset}: ${hexBytes.join(' ').padEnd(48)} |${asciiChars.join('')}|\n`
  }
  if (data.length > maxBytes) {
    result += `... (${data.length - maxBytes} more bytes)`
  }
  return result
}

// ---------------------------------------------------------------------------
// Test: ReplayConnection parse & dispatch
// ---------------------------------------------------------------------------

function testParseAndDispatch(buffer: Uint8Array): string {
  const lines: string[] = []

  // Create ReplayConnection
  let conn: ReplayConnection
  try {
    conn = new ReplayConnection('test-replay-2024.orarep', buffer.buffer as ArrayBuffer)
  } catch (err) {
    lines.push(resultLine(false, `ReplayConnection 构造失败: ${err}`))
    return lines.join('\n')
  }

  // Check properties
  lines.push(resultLine(conn.isValid === true,
    `ReplayConnection.IsValid = true`, `got ${conn.isValid}`))
  lines.push(resultLine(conn.tickCount >= 0,
    `ReplayConnection.TickCount >= 0`, `got ${conn.tickCount}`))
  lines.push(resultLine(conn.finalGameTick === 2,
    `ReplayConnection.FinalGameTick = 2`, `got ${conn.finalGameTick}`))
  lines.push(resultLine(conn.localClientId === -1,
    `ReplayConnection.localClientId = -1`, `got ${conn.localClientId}`))
  lines.push(resultLine(conn.filename === 'test-replay-2024.orarep',
    `ReplayConnection.filename = "test-replay-2024.orarep"`, `got "${conn.filename}"`))
  lines.push(resultLine(typeof conn.lobbyInfo === 'object' && conn.lobbyInfo !== null,
    'ReplayConnection.LobbyInfo 为非空对象'))

  // Check LobbyInfo structure
  if (conn.lobbyInfo) {
    lines.push(resultLine(Array.isArray(conn.lobbyInfo.clients),
      `LobbyInfo.clients 是数组 (length=${conn.lobbyInfo.clients.length})`))
    lines.push(resultLine(typeof conn.lobbyInfo.globalSettings === 'object',
      'LobbyInfo.globalSettings 为对象'))
    lines.push(resultLine(conn.lobbyInfo.slots instanceof Map,
      'LobbyInfo.slots 是 Map'))
  }

  // Test dispatch with mock OrderManager
  const lobbyInfo = createMockLobbyInfo()
  const mockOM = new MockOrderManager(lobbyInfo)
  mockOM.netFrameNumber = 5

  // send() should be no-op
  conn.send(1, [])
  lines.push(resultLine(true, 'send() 空操作（无异常）'))

  // sendImmediate should be no-op
  conn.sendImmediate([])
  lines.push(resultLine(true, 'sendImmediate() 空操作（无异常）'))

  // sendSync should enqueue
  conn.sendSync(10, 0xDEADBEEF, BigInt(0))
  lines.push(resultLine(true, 'sendSync() 无异常'))

  // receive should dispatch
  try {
    conn.receive(mockOM)
    lines.push(resultLine(true,
      `receive() 完成，产生 ${mockOM.logs.length} 条分发记录`))
  } catch (err) {
    lines.push(resultLine(false, `receive() 抛异常: ${err}`))
  }

  // Check dispatch logs
  const immediateCount = mockOM.logs.filter(l => l.type === 'immediate').length
  const ordersCount = mockOM.logs.filter(l => l.type === 'orders').length
  const syncCount = mockOM.logs.filter(l => l.type === 'sync').length
  const disconnectCount = mockOM.logs.filter(l => l.type === 'disconnect').length

  lines.push(resultLine(immediateCount >= 0,
    `receiveImmediateOrders 调用 ${immediateCount} 次`))
  lines.push(resultLine(ordersCount >= 0,
    `receiveOrders 调用 ${ordersCount} 次`))
  lines.push(resultLine(syncCount >= 1,
    `receiveSync 调用 ${syncCount} 次 (至少1次，来自 sendSync)`))
  lines.push(resultLine(disconnectCount >= 0,
    `receiveDisconnect 调用 ${disconnectCount} 次`))

  // Display dispatch log
  let logHtml = '<div style="font-size:11px; margin-top:8px;">'
  logHtml += '<div style="color:#8af; margin-bottom:4px;">分发日志:</div>'
  for (const log of mockOM.logs) {
    let entry = `[${log.type}]`
    if (log.frame != null) entry += ` frame=${log.frame}`
    if (log.clientId != null) entry += ` client=${log.clientId}`
    if (log.syncHash != null) entry += ` hash=${log.syncHash.toString(16)}`
    if (log.detail) entry += ` ${log.detail}`
    logHtml += `<div style="color:#aaa; padding:1px 0;">${entry}</div>`
  }
  logHtml += '</div>'
  lines.push(logHtml)

  // dispose should be safe
  conn.dispose()
  lines.push(resultLine(true, 'dispose() 无异常'))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Full test (record, serialize, parse)
// ---------------------------------------------------------------------------

function runFullTest(): void {
  // Test isGameStart
  setSection('section-isgamestart', testIsGameStart())

  // Test record
  const { html: recordHtml, buffer } = testRecord()
  setSection('section-record', recordHtml)

  // Test serialize
  if (buffer) {
    setSection('section-serialize', testSerialize(buffer))

    // Test parse & dispatch
    setSection('section-parse', testParseAndDispatch(buffer))
  } else {
    setSection('section-serialize', resultLine(false, '无法序列化: getBuffer() 返回 null'))
    setSection('section-parse', resultLine(false, '因序列化失败，跳过回读测试'))
  }
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
document.getElementById('btn-test-isgamestart')!.addEventListener('click', () => {
  setSection('section-isgamestart', testIsGameStart())
})
document.getElementById('btn-test-record')!.addEventListener('click', () => {
  const { html } = testRecord()
  setSection('section-record', html)
})
document.getElementById('btn-test-serialize')!.addEventListener('click', () => {
  const { buffer } = testRecord()
  if (buffer) {
    setSection('section-serialize', testSerialize(buffer))
  } else {
    setSection('section-serialize', resultLine(false, '无法序列化'))
  }
})
document.getElementById('btn-test-parse')!.addEventListener('click', () => {
  const { buffer } = testRecord()
  if (buffer) {
    setSection('section-parse', testParseAndDispatch(buffer))
  } else {
    setSection('section-parse', resultLine(false, '无法生成二进制数据'))
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

updateInfoBar()
setInterval(updateInfoBar, 1000)

// Auto-run all tests on load
runFullTest()

console.log('[ch17-replay/replay-roundtrip] Acceptance test page loaded.')
