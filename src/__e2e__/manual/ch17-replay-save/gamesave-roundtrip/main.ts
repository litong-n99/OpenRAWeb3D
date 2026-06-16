/**
 * main.ts -- GameSave Binary Format Round-Trip 人工验收测试
 *
 * 测试目标:
 *   1. 空 GameSave 初始状态验证
 *   2. startGame() 配置快照正确性
 *   3. dispatchOrders() 订单录制行为
 *   4. save() 二进制输出格式规范
 *   5. 从二进制数据重新构造 GameSave 的往返一致性
 *   6. addTraitData + parseOrders 数据完整性
 *
 * OpenRA 对照: OpenRA.Game/Network/GameSave.cs
 */

import {
  GameSave,
  EOF_MARKER,
  METADATA_MARKER,
  TRAIT_DATA_MARKER,
} from '../../../../OpenRA.Game/Network/GameSave.js'
import type {
  GameSaveLobbyInfo,
  GameSaveMapPreview,
  GameSaveConnection,
} from '../../../../OpenRA.Game/Network/GameSave.js'
import { SYNC_HASH_ORDER_LENGTH } from '../../../../OpenRA.Game/Network/Order.js'
import { ClientState, ConnectionQuality, MapStatus } from '../../../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'
import type { SessionClient, SessionSlot, SessionGlobal } from '../../../../OpenRA.Mods.Common/Widgets/Logic/Lobby/LobbyTypes.js'

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
// Mock factories (mirrored from GameSave.test.ts)
// ---------------------------------------------------------------------------

function makeSessionClient(overrides: Partial<{
  index: number; name: string; color: string; team: number; slot: string | null
  bot: string | null; isAdmin: boolean; isObserver: boolean; isBot: boolean
  isReady: boolean; isInvalid: boolean
  spawnPoint: number; handicap: number; faction: string; fingerprint: string | null
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
    isReady: overrides.isReady ?? true,
    isInvalid: overrides.isInvalid ?? false,
    state: ClientState.Ready,
    connectionQuality: ConnectionQuality.Good,
    spawnPoint: overrides.spawnPoint ?? 0,
    handicap: overrides.handicap ?? 0,
    faction: overrides.faction ?? 'allies',
    fingerprint: 'fingerprint' in overrides ? overrides.fingerprint! : null,
  }
}

function makeSessionSlot(playerReference: string = 'Multi0'): SessionSlot {
  return {
    playerReference,
    closed: false,
    allowBots: true,
    lockFaction: false,
    lockColor: false,
    lockTeam: false,
    lockSpawn: false,
    lockHandicap: false,
    required: false,
  }
}

function makeSessionGlobal(): SessionGlobal {
  return {
    serverName: 'TestServer',
    map: 'test_map',
    mapStatus: MapStatus.Available,
    randomSeed: 42,
    dedicated: false,
    allowSpectators: true,
    enableSingleplayer: true,
    enableMapGeneration: true,
    lobbyOptions: {} as SessionGlobal['lobbyOptions'],
  }
}

function makeLobbyInfo(
  globalSettings: SessionGlobal,
  clients: SessionClient[],
  slots: Array<[string, SessionSlot]>,
): GameSaveLobbyInfo {
  const slotsMap = new Map(slots)
  return {
    globalSettings,
    clients,
    slots: slotsMap,
    clientInSlot(slotKey: string) {
      for (const c of clients) {
        if (c.slot === slotKey) return c
      }
      return undefined
    },
    clientWithIndex(index: number) {
      return clients.find((c) => c.index === index) as
        | (SessionClient & { readonly botControllerClientIndex?: number })
        | undefined
    },
  }
}

function makeMapPreview(mapClass: string = 'System'): GameSaveMapPreview {
  return {
    class: mapClass,
    players: {
      players: new Map([
        ['Multi0', { playable: true, allowBots: true }],
        ['Multi1', { playable: true, allowBots: true }],
      ]),
    },
  }
}

function makeConnection(playerIndex: number): GameSaveConnection {
  return { playerIndex }
}

function makeSyncPacket(): Uint8Array {
  const packet = new Uint8Array(SYNC_HASH_ORDER_LENGTH)
  packet[0] = 0x65 // OrderType.SyncHash
  for (let i = 1; i < SYNC_HASH_ORDER_LENGTH; i++) {
    packet[i] = i
  }
  return packet
}

function makeOrderPacket(dataLength: number = 10): Uint8Array {
  const packet = new Uint8Array(dataLength)
  packet[0] = 0xff // OrderType.Fields
  return packet
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  // Create a proper copy so it has its own buffer
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

// ---------------------------------------------------------------------------
// Test 1: Empty GameSave
// ---------------------------------------------------------------------------

function testEmpty(): string {
  const lines: string[] = []
  const gs = new GameSave()

  lines.push(resultLine(gs.LastOrdersFrame === -1,
    `LastOrdersFrame = -1`, `got ${gs.LastOrdersFrame}`))
  lines.push(resultLine(gs.LastSyncFrame === -1,
    `LastSyncFrame = -1`, `got ${gs.LastSyncFrame}`))
  lines.push(resultLine(gs.ordersStreamLength === 0,
    `ordersStreamLength = 0`, `got ${gs.ordersStreamLength}`))
  lines.push(resultLine(gs.ordersChunkCount === 0,
    `ordersChunkCount = 0`, `got ${gs.ordersChunkCount}`))
  lines.push(resultLine(gs.GlobalSettings === null,
    `GlobalSettings = null`, `got ${gs.GlobalSettings}`))
  lines.push(resultLine(gs.Slots.size === 0,
    `Slots.size = 0`, `got ${gs.Slots.size}`))
  lines.push(resultLine(gs.SlotClients.size === 0,
    `SlotClients.size = 0`, `got ${gs.SlotClients.size}`))
  lines.push(resultLine(gs.TraitData.size === 0,
    `TraitData.size = 0`, `got ${gs.TraitData.size}`))
  lines.push(resultLine(gs.MapGenerationArgs === undefined,
    `MapGenerationArgs = undefined`))
  lines.push(resultLine(gs.clientsBySlotIndex.length === 0,
    `clientsBySlotIndex.length = 0`))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 2: startGame
// ---------------------------------------------------------------------------

function testStartGame(): { html: string; gs: GameSave } {
  const lines: string[] = []
  const gs = new GameSave()

  const client0 = makeSessionClient({ index: 0, name: 'Player1', color: '#0000FF', faction: 'allies', team: 1 })
  const client1 = makeSessionClient({ index: 1, name: 'Bot1', color: '#FF0000', faction: 'soviet', team: 1, bot: 'EasyBot', isBot: true })
  const clients = [client0, client1]
  const slots: Array<[string, SessionSlot]> = [
    ['Multi0', makeSessionSlot('Multi0')],
    ['Multi1', makeSessionSlot('Multi1')],
  ]
  const globalSettings = makeSessionGlobal()
  const lobbyInfo = makeLobbyInfo(globalSettings, clients, slots)
  const mapPreview = makeMapPreview('System')

  gs.startGame(lobbyInfo, mapPreview)

  lines.push(resultLine(gs.GlobalSettings !== null,
    'GlobalSettings 非 null'))
  if (gs.GlobalSettings) {
    lines.push(resultLine(gs.GlobalSettings.map === 'test_map',
      `GlobalSettings.map = "test_map"`, `got "${gs.GlobalSettings.map}"`))
    lines.push(resultLine(gs.GlobalSettings.randomSeed === 42,
      `GlobalSettings.randomSeed = 42`, `got ${gs.GlobalSettings.randomSeed}`))
  }

  lines.push(resultLine(gs.Slots.size === 2,
    `Slots.size = 2`, `got ${gs.Slots.size}`))
  lines.push(resultLine(gs.SlotClients.size === 2,
    `SlotClients.size = 2 (可玩槽位)`, `got ${gs.SlotClients.size}`))

  // Verify SlotClients content
  const sc0 = gs.SlotClients.get('Multi0')
  if (sc0) {
    lines.push(resultLine(sc0.faction === 'allies',
      `SlotClient[Multi0].faction = "allies"`, `got "${sc0.faction}"`))
    lines.push(resultLine(sc0.team === 1,
      `SlotClient[Multi0].team = 1`, `got ${sc0.team}`))
    lines.push(resultLine(sc0.spawnPoint === 0,
      `SlotClient[Multi0].spawnPoint = 0`, `got ${sc0.spawnPoint}`))
  } else {
    lines.push(resultLine(false, 'SlotClient[Multi0] 存在'))
  }

  const sc1 = gs.SlotClients.get('Multi1')
  if (sc1) {
    lines.push(resultLine(sc1.faction === 'soviet',
      `SlotClient[Multi1].faction = "soviet"`, `got "${sc1.faction}"`))
    lines.push(resultLine(sc1.bot === 'EasyBot',
      `SlotClient[Multi1].bot = "EasyBot"`, `got "${sc1.bot}"`))
  } else {
    lines.push(resultLine(false, 'SlotClient[Multi1] 存在'))
  }

  // Verify deep copy: modify source, check snapshot unchanged
  const oldMap = globalSettings.map
  ;(globalSettings as unknown as Record<string, unknown>).map = 'CHANGED'
  lines.push(resultLine(gs.GlobalSettings!.map === oldMap,
    '深拷贝验证: 修改源数据后 GlobalSettings.map 不变'))

  return { html: lines.join('\n'), gs }
}

// ---------------------------------------------------------------------------
// Test 3: dispatchOrders
// ---------------------------------------------------------------------------

function testDispatchOrders(gs: GameSave): string {
  const lines: string[] = []
  const conn = makeConnection(0)

  const initialChunks = gs.ordersChunkCount
  lines.push(resultLine(initialChunks >= 0,
    `初始 ordersChunkCount = ${initialChunks}`))

  // Dispatch a normal order at frame 1
  const order1 = makeOrderPacket(10)
  gs.dispatchOrders(conn, 1, order1)
  lines.push(resultLine(gs.ordersChunkCount === initialChunks + 1,
    `dispatchOrders(frame=1) 后: ordersChunkCount = ${gs.ordersChunkCount}`,
    `期望 ${initialChunks + 1}, 得到 ${gs.ordersChunkCount}`))
  lines.push(resultLine(gs.LastOrdersFrame === 1,
    `dispatchOrders(frame=1) 后: LastOrdersFrame = 1`, `got ${gs.LastOrdersFrame}`))

  // Dispatch another order at frame 2
  const order2 = makeOrderPacket(10)
  gs.dispatchOrders(conn, 2, order2)
  lines.push(resultLine(gs.LastOrdersFrame === 2,
    `dispatchOrders(frame=2) 后: LastOrdersFrame = 2`, `got ${gs.LastOrdersFrame}`))

  // Test frame dedup: same frame should be skipped
  const orderDup = makeOrderPacket(10)
  const chunksBeforeDup = gs.ordersChunkCount
  gs.dispatchOrders(conn, 1, orderDup) // frame 1 <= LastOrdersFrame (2)
  lines.push(resultLine(gs.ordersChunkCount === chunksBeforeDup,
    'frame=1 (<= LastOrdersFrame=2) 被跳过: ordersChunkCount 不变',
    `期望 ${chunksBeforeDup}, 得到 ${gs.ordersChunkCount}`))

  // Test sync packet
  const syncPkt = makeSyncPacket()
  const chunksBeforeSync = gs.ordersChunkCount
  gs.dispatchOrders(conn, 5, syncPkt)
  // Sync packets: updated LastSyncFrame but NOT added to ordersChunks
  lines.push(resultLine(gs.LastSyncFrame === 5,
    `dispatchOrders(sync frame=5): LastSyncFrame = 5`, `got ${gs.LastSyncFrame}`))
  lines.push(resultLine(gs.ordersChunkCount === chunksBeforeSync,
    '同步包不写入订单流: ordersChunkCount 不变',
    `期望 ${chunksBeforeSync}, 得到 ${gs.ordersChunkCount}`))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 4: save() binary output
// ---------------------------------------------------------------------------

function testSave(gs: GameSave): { html: string; buffer: Uint8Array } {
  const lines: string[] = []

  const buffer = gs.save()
  lines.push(resultLine(buffer instanceof Uint8Array,
    `save() 返回 Uint8Array`))
  lines.push(resultLine(buffer.length > 0,
    `二进制大小 = ${buffer.length} 字节 (> 0)`))

  // Check footer (last 12 bytes)
  if (buffer.length >= 12) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const footerStart = buffer.length - 12
    const metadataOffset = view.getInt32(footerStart, true)
    const traitDataOffset = view.getInt32(footerStart + 4, true)
    const eofMarker = view.getInt32(footerStart + 8, true)

    lines.push(resultLine(eofMarker === EOF_MARKER,
      `尾部 EOF_MARKER = -2 (${eofMarker})`, eofMarker === EOF_MARKER ? undefined : `got ${eofMarker}`))
    lines.push(resultLine(metadataOffset >= 0,
      `尾部 metadataOffset = ${metadataOffset} (>= 0)`))
    lines.push(resultLine(traitDataOffset >= metadataOffset,
      `尾部 traitDataOffset = ${traitDataOffset} (>= metadataOffset)`))

    // Check metadata marker at metadataOffset
    if (metadataOffset + 4 <= buffer.length) {
      const metaMarker = view.getInt32(metadataOffset, true)
      lines.push(resultLine(metaMarker === METADATA_MARKER,
        `metadataOffset 位置 marker = -1 (${metaMarker})`, metaMarker === METADATA_MARKER ? undefined : `got ${metaMarker}`))
    }

    // Check trait data marker
    if (traitDataOffset + 4 <= buffer.length) {
      const traitMarker = view.getInt32(traitDataOffset, true)
      lines.push(resultLine(traitMarker === TRAIT_DATA_MARKER,
        `traitDataOffset 位置 marker = -3 (${traitMarker})`, traitMarker === TRAIT_DATA_MARKER ? undefined : `got ${traitMarker}`))
    }
  }

  // Hex dump of tail
  const tailHex = formatHexDumpTail(buffer, 128)
  setSection('section-hex', `<pre class="hex-dump">${tailHex}</pre>`)

  return { html: lines.join('\n'), buffer }
}

function formatHexDumpTail(data: Uint8Array, tailBytes: number): string {
  const start = Math.max(0, data.length - tailBytes)
  const slice = data.slice(start)
  let result = `--- 尾部 ${slice.length} 字节 (偏移 ${start}) ---\n`
  for (let i = 0; i < slice.length; i += 16) {
    const offset = (start + i).toString(16).padStart(8, '0')
    const hexBytes: string[] = []
    const asciiChars: string[] = []
    for (let j = 0; j < 16 && i + j < slice.length; j++) {
      const b = slice[i + j]!
      hexBytes.push(b.toString(16).padStart(2, '0'))
      asciiChars.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')
    }
    result += `${offset}: ${hexBytes.join(' ').padEnd(48)} |${asciiChars.join('')}|\n`
  }
  return result
}

// ---------------------------------------------------------------------------
// Test 5: Round-trip load
// ---------------------------------------------------------------------------

function testRoundTrip(original: GameSave, buffer: Uint8Array): string {
  const lines: string[] = []

  // Create new GameSave from buffer
  let loaded: GameSave
  try {
    loaded = new GameSave('test.orasav', toArrayBuffer(buffer))
  } catch (err) {
    lines.push(resultLine(false, `构造 GameSave(buffer) 失败: ${err}`))
    return lines.join('\n')
  }

  // Compare all fields
  const checks: Array<[string, unknown, unknown]> = [
    ['LastOrdersFrame', original.LastOrdersFrame, loaded.LastOrdersFrame],
    ['LastSyncFrame', original.LastSyncFrame, loaded.LastSyncFrame],
    ['ordersStreamLength', original.ordersStreamLength, loaded.ordersStreamLength],
    ['ordersChunkCount', original.ordersChunkCount, loaded.ordersChunkCount],
    ['Slots.size', original.Slots.size, loaded.Slots.size],
    ['SlotClients.size', original.SlotClients.size, loaded.SlotClients.size],
    ['TraitData.size', original.TraitData.size, loaded.TraitData.size],
  ]

  for (const [field, expected, actual] of checks) {
    const pass = expected === actual
    lines.push(resultLine(pass,
      `往返: ${field} = ${expected}`, `loaded = ${actual}`))
  }

  // Compare GlobalSettings
  if (original.GlobalSettings && loaded.GlobalSettings) {
    lines.push(resultLine(
      original.GlobalSettings.map === loaded.GlobalSettings.map,
      `往返: GlobalSettings.map = "${original.GlobalSettings.map}"`,
      `loaded = "${loaded.GlobalSettings.map}"`,
    ))
    lines.push(resultLine(
      original.GlobalSettings.randomSeed === loaded.GlobalSettings.randomSeed,
      `往返: GlobalSettings.randomSeed = ${original.GlobalSettings.randomSeed}`,
      `loaded = ${loaded.GlobalSettings.randomSeed}`,
    ))
  }

  // Compare SlotClients content
  let scAllMatch = true
  for (const [key, originalSC] of original.SlotClients) {
    const loadedSC = loaded.SlotClients.get(key)
    if (!loadedSC) {
      lines.push(resultLine(false, `往返: SlotClient[${key}] 在 loaded 中丢失`))
      scAllMatch = false
      continue
    }
    const factionMatch = originalSC.faction === loadedSC.faction
    const teamMatch = originalSC.team === loadedSC.team
    const spawnMatch = originalSC.spawnPoint === loadedSC.spawnPoint
    if (!factionMatch || !teamMatch || !spawnMatch) {
      lines.push(resultLine(false, `往返: SlotClient[${key}] 内容不匹配`))
      scAllMatch = false
    }
  }
  if (scAllMatch) {
    lines.push(resultLine(true, '往返: 所有 SlotClient 内容匹配'))
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 6: addTraitData + parseOrders
// ---------------------------------------------------------------------------

function testTraitData(gs: GameSave): string {
  const lines: string[] = []

  // Add trait data
  gs.addTraitData(0, { type: 'production', progress: 50 })
  gs.addTraitData(1, { type: 'health', value: 100 })
  lines.push(resultLine(gs.TraitData.size === 2,
    `addTraitData 后: TraitData.size = 2`, `got ${gs.TraitData.size}`))
  lines.push(resultLine(gs.TraitData.get(0) !== undefined,
    'TraitData[0] 存在'))
  lines.push(resultLine(gs.TraitData.get(1) !== undefined,
    'TraitData[1] 存在'))

  // Test parseOrders
  const parseLog: Array<{ frame: number; clientIndex: number; dataLen: number }> = []
  const lobbyInfo = makeLobbyInfo(
    makeSessionGlobal(),
    [makeSessionClient({ index: 0 }), makeSessionClient({ index: 1, bot: 'EasyBot', isBot: true })],
    [['Multi0', makeSessionSlot('Multi0')], ['Multi1', makeSessionSlot('Multi1')]],
  )

  gs.parseOrders(lobbyInfo, (frame, clientIndex, data) => {
    parseLog.push({ frame, clientIndex, dataLen: data.length })
  })

  lines.push(resultLine(parseLog.length > 0,
    `parseOrders 回调 ${parseLog.length} 次 (> 0)`))

  // First entries should be trait data (frame 0)
  const traitDataEntries = parseLog.filter(e => e.frame === 0)
  lines.push(resultLine(traitDataEntries.length === 2,
    `parseOrders: trait data 条目数 = 2 (TraitData 有 ${gs.TraitData.size} 个条目)`,
    `got ${traitDataEntries.length}`))

  const orderEntries = parseLog.filter(e => e.frame > 0)
  lines.push(resultLine(orderEntries.length >= 2,
    `parseOrders: frame > 0 订单条目数 >= 2`, `got ${orderEntries.length}`))

  // Display parse log
  let logHtml = '<div style="font-size:11px; margin-top:8px;">'
  logHtml += '<div style="color:#8af; margin-bottom:4px;">parseOrders 回调日志:</div>'
  for (const entry of parseLog) {
    logHtml += `<div style="color:#aaa; padding:1px 0;">[frame=${entry.frame}] client=${entry.clientIndex} dataLen=${entry.dataLen}</div>`
  }
  logHtml += '</div>'
  lines.push(logHtml)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Full test
// ---------------------------------------------------------------------------

let sharedGS: GameSave | null = null

function runFullTest(): void {
  // Test 1: Empty
  setSection('section-empty', testEmpty())

  // Test 2: startGame
  const { html: startHtml, gs } = testStartGame()
  sharedGS = gs
  setSection('section-startgame', startHtml)

  // Test 3: dispatchOrders
  setSection('section-dispatch', testDispatchOrders(gs))

  // Test 4: save
  const { html: saveHtml, buffer } = testSave(gs)
  setSection('section-serialize', saveHtml)

  // Test 5: round-trip
  setSection('section-roundtrip', testRoundTrip(gs, buffer))

  // Test 6: addTraitData + parseOrders
  setSection('section-traits', testTraitData(gs))
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
document.getElementById('btn-test-empty')!.addEventListener('click', () => {
  setSection('section-empty', testEmpty())
})
document.getElementById('btn-test-startgame')!.addEventListener('click', () => {
  const { html } = testStartGame()
  setSection('section-startgame', html)
})
document.getElementById('btn-test-dispatch')!.addEventListener('click', () => {
  if (sharedGS) {
    setSection('section-dispatch', testDispatchOrders(sharedGS))
  } else {
    const { gs } = testStartGame()
    sharedGS = gs
    setSection('section-dispatch', testDispatchOrders(gs))
  }
})
document.getElementById('btn-test-serialize')!.addEventListener('click', () => {
  if (sharedGS) {
    const { html: saveHtml, buffer } = testSave(sharedGS)
    setSection('section-serialize', saveHtml)
    setSection('section-roundtrip', testRoundTrip(sharedGS, buffer))
  } else {
    const { gs } = testStartGame()
    sharedGS = gs
    const { html: saveHtml, buffer } = testSave(gs)
    setSection('section-serialize', saveHtml)
    setSection('section-roundtrip', testRoundTrip(gs, buffer))
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

updateInfoBar()
setInterval(updateInfoBar, 1000)

// Auto-run all tests on load
runFullTest()

console.log('[ch17-replay/gamesave-roundtrip] Acceptance test page loaded.')
