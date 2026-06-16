/**
 * main.ts -- SyncReport Diagnostic Dump 人工验收测试
 *
 * 测试目标:
 *   1. 环形缓冲区（7 slots）轮转正确性
 *   2. dumpSyncReport 格式化输出包含所有必要部分
 *   3. dumpSyncReport 未找到帧时的处理
 *   4. ISync dump 函数注册表（register/get/clear）
 *   5. Trait 报告: 注册的 ISync trait 在报告中正确显示字段值
 *
 * OpenRA 对照: OpenRA.Game/Network/SyncReport.cs
 */

import {
  SyncReport,
  registerSyncDump,
  getSyncDump,
  clearSyncDumpRegistry,
} from '../../../../OpenRA.Game/Network/SyncReport.js'
import type {
  SyncReportOrderManager,
  SyncReportWorld,
  SyncReportActorEntry,
  SyncDumpFn,
  ClientOrder,
} from '../../../../OpenRA.Game/Network/SyncReport.js'
import type { ISync } from '../../../../OpenRA.Game/Sync.js'

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
// Mock ISync trait for testing
// ---------------------------------------------------------------------------

class MockHealthTrait implements ISync {
  hp = 100
  maxHp = 100
  armor = 5
  constructor(hp?: number, maxHp?: number, armor?: number) {
    if (hp !== undefined) this.hp = hp
    if (maxHp !== undefined) this.maxHp = maxHp
    if (armor !== undefined) this.armor = armor
  }
}

class MockPositionTrait implements ISync {
  x = 1024
  y = 2048
  z = 0
}

// ---------------------------------------------------------------------------
// Mock World with ISync actors and effects
// ---------------------------------------------------------------------------

function createMockWorld(): SyncReportWorld {
  return {
    syncedRandomLast: 12345,
    syncedRandomTotal: 100,
    getSyncActors(): readonly SyncReportActorEntry[] {
      return [
        {
          actorId: 1,
          type: 'e1',
          owner: 'Player1',
          syncTraits: [
            { trait: new MockHealthTrait(80, 100, 5), hash: 12345 },
            { trait: new MockPositionTrait(), hash: 67890 },
          ],
        },
        {
          actorId: 2,
          type: 'harv',
          owner: 'Player2',
          syncTraits: [
            { trait: new MockHealthTrait(50, 100, 3), hash: 11111 },
          ],
        },
      ]
    },
    syncedEffects: [
      new MockPositionTrait(), // effect at position
    ],
  }
}

// ---------------------------------------------------------------------------
// Mock OrderManager
// ---------------------------------------------------------------------------

function createMockOrderManager(
  netFrameNumber: number = 0,
): SyncReportOrderManager {
  return {
    netFrameNumber,
    world: createMockWorld(),
    localClient: { index: 0 },
  }
}

// ---------------------------------------------------------------------------
// Test 1: Ring buffer
// ---------------------------------------------------------------------------

function testRingBuffer(): string {
  const lines: string[] = []
  const om = createMockOrderManager(0)
  const sr = new SyncReport(om)

  // Initial state
  lines.push(resultLine(SyncReport.NumSyncReports === 7,
    `NumSyncReports = 7 (常量)`))
  lines.push(resultLine(sr.reports.length === 7,
    `reports.length = 7`))
  lines.push(resultLine(sr.currentIndex === 0,
    `初始 currentIndex = 0`, `got ${sr.currentIndex}`))

  // Feed 10 reports to exercise wrapping
  const emptyOrders: ClientOrder[] = []
  for (let i = 0; i < 10; i++) {
    ;(om as unknown as Record<string, unknown>).netFrameNumber = i + 1
    sr.updateSyncReport(emptyOrders)
  }

  // After 10 updates, currentIndex should be 10 % 7 = 3
  const expectedIndex = 10 % 7
  lines.push(resultLine(sr.currentIndex === expectedIndex,
    `10 次 updateSyncReport 后 currentIndex = ${expectedIndex}`,
    `got ${sr.currentIndex}`))

  // All frames should be in range (4..10 for the 7 most recent)
  const frames = sr.reports.map(r => r.frame)
  lines.push(resultLine(frames.length === 7,
    `reports 始终 7 个条目 (got ${frames.length})`))
  // The oldest should be frame 4 (10 - 7 + 1)
  lines.push(resultLine(Math.min(...frames) === 4,
    `最旧帧 = 4 (第4次更新的帧)`,
    `got ${Math.min(...frames)}`))
  lines.push(resultLine(Math.max(...frames) === 10,
    `最新帧 = 10 (第10次更新的帧)`,
    `got ${Math.max(...frames)}`))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 2: dumpSyncReport format
// ---------------------------------------------------------------------------

function testDumpFormat(): string {
  const lines: string[] = []
  const om = createMockOrderManager(0)
  const sr = new SyncReport(om)

  // Register mock dump functions
  registerMockDumpFns()

  // Feed some reports with orders
  for (let i = 1; i <= 7; i++) {
    ;(om as unknown as Record<string, unknown>).netFrameNumber = i
    const orders: ClientOrder[] = i === 5 ? [
      { frame: 5, clientId: 0, orderData: 'AttackMove order to (10,10)' },
      { frame: 5, clientId: 1, orderData: 'Build order Barracks at (5,5)' },
    ] : []
    sr.updateSyncReport(orders)
  }

  // Dump frame 5
  const dump = sr.dumpSyncReport(5)

  // Check dump format
  lines.push(resultLine(dump.includes('syncreport-'),
    'dump 第一行以 "syncreport-" 开头'))
  lines.push(resultLine(dump.includes('--- Sync Report ---'),
    'dump 包含 "--- Sync Report ---"'))
  lines.push(resultLine(dump.includes('Player Index: 0'),
    'dump 包含 "Player Index: 0"'))
  lines.push(resultLine(dump.includes('Sync for net frame 5'),
    'dump 包含 "Sync for net frame 5"'))
  lines.push(resultLine(dump.includes('SharedRandom:'),
    'dump 包含 "SharedRandom:"'))
  lines.push(resultLine(dump.includes('Synced Traits:'),
    'dump 包含 "Synced Traits:" 部分'))
  lines.push(resultLine(dump.includes('Synced Effects:'),
    'dump 包含 "Synced Effects:" 部分'))
  lines.push(resultLine(dump.includes('Orders Issued:'),
    'dump 包含 "Orders Issued:" 部分'))
  lines.push(resultLine(dump.includes('Sync Report System Info:'),
    'dump 包含 "Sync Report System Info:" 部分'))
  lines.push(resultLine(dump.includes('Out of sync frame: 5'),
    'dump 包含 "Out of sync frame: 5"'))
  lines.push(resultLine(dump.includes('Recorded frames:'),
    'dump 包含 "Recorded frames:" 行'))

  // Display formatted dump
  const escaped = dump.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  lines.push(`<div style="font-size:11px; margin-top:8px; color:#8af;">完整 dump 输出:</div>`)
  lines.push(`<div class="dump-output">${escaped}</div>`)

  clearSyncDumpRegistry()
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 3: dumpSyncReport not found
// ---------------------------------------------------------------------------

function testNotFound(): string {
  const lines: string[] = []
  const om = createMockOrderManager(0)
  const sr = new SyncReport(om)

  // Feed some reports
  const emptyOrders: ClientOrder[] = []
  for (let i = 1; i <= 3; i++) {
    ;(om as unknown as Record<string, unknown>).netFrameNumber = i
    sr.updateSyncReport(emptyOrders)
  }

  // Request a non-existent frame
  const dump = sr.dumpSyncReport(999)

  lines.push(resultLine(dump.includes('Recorded frames do not contain the frame 999'),
    'dump 包含 "Recorded frames do not contain the frame 999"'))
  lines.push(resultLine(dump.includes('No sync report available'),
    'dump 包含 "No sync report available!"'))
  lines.push(resultLine(dump.includes('Recorded frames: 1,2,3'),
    'dump 列出所有记录帧 "1,2,3" (或其他顺序)'))

  // Display output
  const escaped = dump.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  lines.push(`<div style="font-size:11px; margin-top:8px; color:#8af;">dumpSyncReport(999) 输出:</div>`)
  lines.push(`<div class="dump-output">${escaped}</div>`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 4: ISync dump registry
// ---------------------------------------------------------------------------

function testRegistry(): string {
  const lines: string[] = []

  // Clear first for clean state
  clearSyncDumpRegistry()

  // Register a test dump function
  const dumpFn: SyncDumpFn = (instance: ISync) => {
    const mh = instance as MockHealthTrait
    return { hp: mh.hp, maxHp: mh.maxHp, armor: mh.armor }
  }
  const names = ['hp', 'maxHp', 'armor']
  registerSyncDump('MockHealthTrait', names, dumpFn)

  // Get it back
  const info = getSyncDump('MockHealthTrait')
  lines.push(resultLine(info !== undefined,
    'registerSyncDump 后 getSyncDump("MockHealthTrait") 非 undefined'))
  if (info) {
    lines.push(resultLine(info.names.length === 3,
      `注册 names 数量 = 3`, `got ${info.names.length}`))
    lines.push(resultLine(info.names[0] === 'hp',
      `names[0] = "hp"`, `got "${info.names[0]}"`))
    lines.push(resultLine(info.names[1] === 'maxHp',
      `names[1] = "maxHp"`, `got "${info.names[1]}"`))
    lines.push(resultLine(info.names[2] === 'armor',
      `names[2] = "armor"`, `got "${info.names[2]}"`))

    // Test the dump function
    const trait = new MockHealthTrait(42, 100, 7)
    const dumped = info.dumpFn(trait)
    lines.push(resultLine(dumped.hp === 42,
      `dumpFn: hp = 42`, `got ${dumped.hp}`))
    lines.push(resultLine(dumped.maxHp === 100,
      `dumpFn: maxHp = 100`, `got ${dumped.maxHp}`))
    lines.push(resultLine(dumped.armor === 7,
      `dumpFn: armor = 7`, `got ${dumped.armor}`))
  }

  // Test unknown
  const unknown = getSyncDump('NonExistentTrait')
  lines.push(resultLine(unknown === undefined,
    'getSyncDump("NonExistentTrait") = undefined'))

  // Test clear
  clearSyncDumpRegistry()
  const afterClear = getSyncDump('MockHealthTrait')
  lines.push(resultLine(afterClear === undefined,
    'clearSyncDumpRegistry 后 getSyncDump("MockHealthTrait") = undefined'))

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Test 5: Trait report content
// ---------------------------------------------------------------------------

function testTraitReport(): string {
  const lines: string[] = []

  // Register dump functions
  registerMockDumpFns()

  const om = createMockOrderManager(5)
  const sr = new SyncReport(om)

  // Feed one report with orders
  const orders: ClientOrder[] = [
    { frame: 5, clientId: 0, orderData: 'Move order to (15,20)' },
  ]
  sr.updateSyncReport(orders)

  // Dump frame 5
  const dump = sr.dumpSyncReport(5)

  // Check for specific trait entries
  lines.push(resultLine(dump.includes('e1'),
    'dump 包含 actor type "e1"'))
  lines.push(resultLine(dump.includes('MockHealthTrait'),
    'dump 包含 trait 类名 "MockHealthTrait"'))
  lines.push(resultLine(dump.includes('MockPositionTrait'),
    'dump 包含 trait 类名 "MockPositionTrait"'))
  lines.push(resultLine(dump.includes('harv'),
    'dump 包含 actor type "harv"'))

  // Check field values are present
  lines.push(resultLine(dump.includes('hp: 80'),
    'dump 包含字段值 "hp: 80"'))
  lines.push(resultLine(dump.includes('maxHp: 100'),
    'dump 包含字段值 "maxHp: 100"'))
  lines.push(resultLine(dump.includes('armor: 5'),
    'dump 包含字段值 "armor: 5"'))
  lines.push(resultLine(dump.includes('x: 1024'),
    'dump 包含字段值 "x: 1024"'))

  // Check hash values are present in the actor lines
  lines.push(resultLine(dump.includes('(12345)'),
    'dump 包含 hash "(12345)"'))
  lines.push(resultLine(dump.includes('(67890)'),
    'dump 包含 hash "(67890)"'))

  // Check orders are present
  lines.push(resultLine(dump.includes('Move order to (15,20)'),
    'dump 包含订单数据 "Move order to (15,20)"'))

  // Display dump
  const escaped = dump.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  lines.push(`<div style="font-size:11px; margin-top:8px; color:#8af;">dumpSyncReport(5) 输出 (含注册的 trait):</div>`)
  lines.push(`<div class="dump-output">${escaped}</div>`)

  clearSyncDumpRegistry()
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Helper: register mock dump functions
// ---------------------------------------------------------------------------

function registerMockDumpFns(): void {
  clearSyncDumpRegistry()

  registerSyncDump('MockHealthTrait', ['hp', 'maxHp', 'armor'], (instance: ISync) => {
    const mh = instance as MockHealthTrait
    return { hp: mh.hp, maxHp: mh.maxHp, armor: mh.armor }
  })

  registerSyncDump('MockPositionTrait', ['x', 'y', 'z'], (instance: ISync) => {
    const mp = instance as MockPositionTrait
    return { x: mp.x, y: mp.y, z: mp.z }
  })
}

// ---------------------------------------------------------------------------
// Full test
// ---------------------------------------------------------------------------

function runFullTest(): void {
  setSection('section-buffer', testRingBuffer())
  setSection('section-dump', testDumpFormat())
  setSection('section-notfound', testNotFound())
  setSection('section-registry', testRegistry())
  setSection('section-traits', testTraitReport())
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
document.getElementById('btn-test-buffer')!.addEventListener('click', () => setSection('section-buffer', testRingBuffer()))
document.getElementById('btn-test-dump')!.addEventListener('click', () => setSection('section-dump', testDumpFormat()))
document.getElementById('btn-test-notfound')!.addEventListener('click', () => setSection('section-notfound', testNotFound()))
document.getElementById('btn-test-registry')!.addEventListener('click', () => setSection('section-registry', testRegistry()))
document.getElementById('btn-test-traits')!.addEventListener('click', () => setSection('section-traits', testTraitReport()))

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

updateInfoBar()
setInterval(updateInfoBar, 1000)

// Auto-run all tests on load
runFullTest()

console.log('[ch17-replay/syncreport] Acceptance test page loaded.')
