/**
 * widgets/production-palette/main.ts — ProductionPaletteWidget icon grid acceptance test
 *
 * Mocks a ProductionQueue with items at various build progress states
 * to verify clock overlay angles, overlay text, and visual state transitions.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.cs
 */
import { Ui, type WidgetEvent } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ProductionPaletteWidget } from '../../../../OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.js'
import { HotkeyReference, Hotkey } from '../../../../OpenRA.Game/Input/HotkeyReference.js'
import { KeyCode } from '../../../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../../../OpenRA.Game/Input/IInputHandler.js'
import type { ActorInfoStub } from '../../../../OpenRA.Game/Traits/TraitsInterfaces.js'

// ---------------------------------------------------------------------------
// Minimal mock types for ProductionItem and ProductionQueue
// ---------------------------------------------------------------------------

interface MockProductionItem {
  item: string
  totalCost: number
  remainingCost: number
  totalTime: number
  remainingTime: number
  done: boolean
  paused: boolean
  infinite: boolean
  remainingTimeActual: number
}

interface MockProductionQueue {
  actor: { isInWorld: boolean; ownerId: number }
  allItems: () => ActorInfoStub[]
  buildableItems: () => ActorInfoStub[]
  allQueued: () => MockProductionItem[]
  remainingTimeActual: (item: MockProductionItem) => number
}

interface MockActorInfo extends ActorInfoStub {
  name: string
  traits: string[]
  _buildableInfo: { buildPaletteOrder: number; iconPalette: string }
  _buildingInfo?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-fps')!.textContent = '-'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}
updateInfoBar()
setInterval(updateInfoBar, 1000)

// ---------------------------------------------------------------------------
// Mock actor data with BuildableInfo
// ---------------------------------------------------------------------------

const mockActors: MockActorInfo[] = [
  { name: 'e1',     traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 0, iconPalette: 'chrome' } },
  { name: 'e2',     traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 1, iconPalette: 'chrome' } },
  { name: 'e3',     traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 2, iconPalette: 'chrome' } },
  { name: 'e4',     traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 3, iconPalette: 'chrome' } },
  { name: 'shok',   traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 4, iconPalette: 'chrome' } },
  { name: 'dog',    traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 5, iconPalette: 'chrome' } },
  { name: 'harv',   traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 6, iconPalette: 'chrome' }, _buildingInfo: {} },
  { name: 'mcv',    traits: ['Buildable', 'Mobile'],    _buildableInfo: { buildPaletteOrder: 7, iconPalette: 'chrome' }, _buildingInfo: {} },
  { name: 'powr',   traits: ['Buildable'],              _buildableInfo: { buildPaletteOrder: 8, iconPalette: 'chrome' }, _buildingInfo: {} },
  { name: 'barr',   traits: ['Buildable'],              _buildableInfo: { buildPaletteOrder: 9, iconPalette: 'chrome' }, _buildingInfo: {} },
  { name: 'tent',   traits: ['Buildable'],              _buildableInfo: { buildPaletteOrder: 10, iconPalette: 'chrome' }, _buildingInfo: {} },
  { name: 'weap',   traits: ['Buildable'],              _buildableInfo: { buildPaletteOrder: 11, iconPalette: 'chrome' }, _buildingInfo: {} },
]

// ---------------------------------------------------------------------------
// Mock queued items (in-progress, paused, done)
// ---------------------------------------------------------------------------

const mockQueuedItems: MockProductionItem[] = [
  {
    item: 'e1',
    totalCost: 100, remainingCost: 20,
    totalTime: 200, remainingTime: 40,
    done: false, paused: false, infinite: false,
    remainingTimeActual: 40,
  },
  {
    item: 'e2',
    totalCost: 125, remainingCost: 0,
    totalTime: 250, remainingTime: 0,
    done: true, paused: false, infinite: false,
    remainingTimeActual: 0,
  },
  {
    item: 'e3',
    totalCost: 150, remainingCost: 100,
    totalTime: 300, remainingTime: 200,
    done: false, paused: true, infinite: false,
    remainingTimeActual: 200,
  },
  {
    item: 'shok',
    totalCost: 500, remainingCost: 450,
    totalTime: 500, remainingTime: 450,
    done: false, paused: false, infinite: false,
    remainingTimeActual: 450,
  },
  {
    item: 'e4',
    totalCost: 100, remainingCost: 100,
    totalTime: 200, remainingTime: 200,
    done: false, paused: false, infinite: true,
    remainingTimeActual: 200,
  },
  {
    item: 'e1', // second queue of e1
    totalCost: 100, remainingCost: 100,
    totalTime: 200, remainingTime: 200,
    done: false, paused: false, infinite: false,
    remainingTimeActual: 200,
  },
]

// Build a lookup: actorName -> MockProductionItem[]
const queuedByActor = new Map<string, MockProductionItem[]>()
for (const qi of mockQueuedItems) {
  const arr = queuedByActor.get(qi.item) || []
  arr.push(qi)
  queuedByActor.set(qi.item, arr)
}

// ---------------------------------------------------------------------------
// Mock ProductionQueue
// ---------------------------------------------------------------------------

const mockQueue: MockProductionQueue = {
  actor: { isInWorld: true, ownerId: 1 },
  allItems: () => mockActors as ActorInfoStub[],
  buildableItems: () => mockActors as ActorInfoStub[],
  allQueued: () => mockQueuedItems,
  remainingTimeActual: (item: MockProductionItem) => item.remainingTimeActual,
}

// ---------------------------------------------------------------------------
// Create and configure widget
// ---------------------------------------------------------------------------

const container = document.getElementById('palette-container')!

const palette = new ProductionPaletteWidget()
palette.id = 'production-palette-test'
palette.columns = 4
palette.iconWidth = 72
palette.iconHeight = 56
palette.iconMarginX = 4
palette.iconMarginY = 4
palette.bounds = { x: 0, y: 0, width: 4 * (72 + 4), height: 3 * (56 + 4) + 20 }
palette.drawTime = true
palette.overlayFont = 'bold 11px monospace'
palette.textColor = '#FFFFFF'
palette.hotkeyCount = 9
palette.hotkeyPrefix = 'F'

// Pre-compute hotkeys
const hotkeys: HotkeyReference[] = []
for (let i = 0; i < 9; i++) {
  const hr = new HotkeyReference(new Hotkey(KeyCode.F1 + i, Modifiers.None))
  hotkeys.push(hr)
}
;(palette as any)._hotkeys = hotkeys

// Silence sound
ProductionPaletteWidget.soundPlayer = null

// Layout
function layoutPalette(): void {
  const rect = container.getBoundingClientRect()
  const w = 4 * (palette.iconWidth + palette.iconMarginX) + 16
  const h = Math.max(3, Math.ceil(mockActors.length / palette.columns)) * (palette.iconHeight + palette.iconMarginY) + 20
  palette.bounds = {
    x: Math.max(0, (rect.width - w) / 2),
    y: Math.max(0, (rect.height - h) / 2),
    width: w,
    height: h,
  }
}
layoutPalette()

// Mount into DOM
function mountWidget(): void {
  while (container.firstChild) container.removeChild(container.firstChild)
  const el = palette.renderOuter()
  container.appendChild(el)

  const eventTypes = ['mousedown', 'mouseup', 'mousemove', 'click', 'wheel', 'keydown', 'keyup']
  for (const type of eventTypes) {
    container.addEventListener(type, (e: Event) => {
      const me = e as MouseEvent
      // Transform screen-absolute clientX/Y to container-relative coordinates
      const rect = container.getBoundingClientRect()
      const widgetEvent: WidgetEvent = {
        type,
        stopPropagation: () => e.stopPropagation(),
        target: me.target as HTMLElement | null,
        clientX: me.clientX - rect.left,
        clientY: me.clientY - rect.top,
        button: me.button,
        deltaY: (e as WheelEvent).deltaY,
        key: (e as KeyboardEvent).key,
        ctrlKey: (e as KeyboardEvent).ctrlKey,
        altKey: (e as KeyboardEvent).altKey,
        shiftKey: (e as KeyboardEvent).shiftKey,
        metaKey: (e as KeyboardEvent).metaKey,
        repeat: (e as KeyboardEvent).repeat,
      }
      const handled = palette.handleEventOuter(widgetEvent)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Set up mock queue data on the palette
// ---------------------------------------------------------------------------

// Override internal methods to use our mock data
;(palette as any)._allBuildables = mockActors
;(palette as any)._currentQueue = mockQueue

// Build the icon map directly
function rebuildIcons(): void {
  const icons = new Map<string, { rect: import('../../../../OpenRA.Game/Widgets/Widget.js').WidgetBounds; icon: import('../../../../OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.js').ProductionIcon }>()
  const cols = palette.columns
  const iconW = palette.iconWidth
  const iconH = palette.iconHeight
  const marginX = palette.iconMarginX
  const marginY = palette.iconMarginY

  mockActors.forEach((actor, idx) => {
    const row = Math.floor(idx / cols)
    const col = idx % cols
    const px = col * (iconW + marginX)
    const py = row * (iconH + marginY)
    const rect = { x: palette.bounds.x + px, y: palette.bounds.y + py, width: iconW, height: iconH }

    const queued = queuedByActor.get(actor.name) || []
    const hotkey = idx < hotkeys.length ? hotkeys[idx] : null

    const iconData: import('../../../../OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.js').ProductionIcon = {
      actor: actor as ActorInfoStub,
      name: actor.name,
      hotkey: hotkey as unknown as null, // cast: HotkeyReference compatibility
      sprite: null,
      palette: actor._buildableInfo.iconPalette,
      iconClockPalette: 'chrome',
      iconDarkenPalette: 'chrome',
      pos: { x: palette.bounds.x + px, y: palette.bounds.y + py },
      queued: queued.map((qi) => ({
        item: qi.item,
        totalCost: qi.totalCost,
        remainingCost: qi.remainingCost,
        totalTime: qi.totalTime,
        remainingTime: qi.remainingTime,
        remainingTimeActual: qi.remainingTimeActual,
        done: qi.done,
        paused: qi.paused,
        infinite: qi.infinite,
        started: qi.remainingCost < qi.totalCost,
        displayColor: '#FFFFFF',
        requiresTechTreeRefresh: false,
      } as unknown as import('../../../../OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.js').ProductionIcon['queued'][0])),
      productionQueue: mockQueue as unknown as import('../../../../OpenRA.Mods.Common/Widgets/ProductionPaletteWidget.js').ProductionIcon['productionQueue'],
    }

    icons.set(actor.name, { rect, icon: iconData })
  })

  ;(palette as any)._icons = icons
  palette.displayedIconCount = mockActors.length

  // Force full icon rebuild on next render
  ;(palette as any)._lastRenderedIconKeys = ''
}

rebuildIcons()
mountWidget()

// ---------------------------------------------------------------------------
// Status monitoring
// ---------------------------------------------------------------------------

const stIconCount = document.getElementById('st-icon-count')!
const stQueueCount = document.getElementById('st-queue-count')!
const stHovered = document.getElementById('st-hovered')!
const stLastOp = document.getElementById('st-last-op')!

function monitorState(): void {
  stIconCount.textContent = `${palette.displayedIconCount}`
  stQueueCount.textContent = `${mockQueuedItems.length}`
  stHovered.textContent = (palette as any)._hoveredIconName ?? '-'

  requestAnimationFrame(monitorState)
}
requestAnimationFrame(monitorState)

// ---------------------------------------------------------------------------
// Button controls
// ---------------------------------------------------------------------------

// Progress: reduce remainingCost on in-progress items
document.getElementById('btn-progress')!.addEventListener('click', () => {
  for (const qi of mockQueuedItems) {
    if (!qi.done && !qi.paused) {
      qi.remainingCost = Math.max(0, qi.remainingCost - 15)
      qi.remainingTime = Math.max(0, qi.remainingTime - 30)
      qi.remainingTimeActual = qi.remainingTime
      qi.done = qi.remainingCost === 0
    }
  }
  ;(palette as any)._lastRenderedIconKeys = ''
  stLastOp.textContent = '推进所有建造进度 (remainingCost -15)'
})

// Reset
document.getElementById('btn-reset')!.addEventListener('click', () => {
  // Reset item states
  for (const qi of mockQueuedItems) {
    qi.remainingCost = qi.totalCost
    qi.remainingTime = qi.totalTime
    qi.remainingTimeActual = qi.totalTime
    qi.done = false
    qi.paused = false
  }
  // Un-pause e3
  const e3Item = mockQueuedItems.find((q) => q.item === 'e3')
  if (e3Item) e3Item.paused = false
  ;(palette as any)._lastRenderedIconKeys = ''
  stLastOp.textContent = '重置所有队列'
})

// Add queue entry
let extraQueueSeq = 0
document.getElementById('btn-add-queue')!.addEventListener('click', () => {
  extraQueueSeq++
  const newItem: MockProductionItem = {
    item: 'e1',
    totalCost: 100, remainingCost: 100,
    totalTime: 200, remainingTime: 200,
    done: false, paused: false, infinite: false,
    remainingTimeActual: 200,
  }
  mockQueuedItems.push(newItem)
  const arr = queuedByActor.get('e1') || []
  arr.push(newItem)
  queuedByActor.set('e1', arr)
  rebuildIcons()
  mountWidget()
  stLastOp.textContent = `添加第 ${mockQueuedItems.length} 个队列项目`
})

// Remove queue entry
document.getElementById('btn-remove-queue')!.addEventListener('click', () => {
  if (mockQueuedItems.length > 0) {
    const removed = mockQueuedItems.pop()!
    const arr = queuedByActor.get(removed.item)
    if (arr) {
      const idx = arr.indexOf(removed)
      if (idx >= 0) arr.splice(idx, 1)
    }
    rebuildIcons()
    mountWidget()
    stLastOp.textContent = `移除队列项目 (${removed.item})`
  }
})

// Complete one
document.getElementById('btn-complete-one')!.addEventListener('click', () => {
  for (const qi of mockQueuedItems) {
    if (!qi.done && !qi.paused) {
      qi.remainingCost = 0
      qi.remainingTime = 0
      qi.remainingTimeActual = 0
      qi.done = true
      ;(palette as any)._lastRenderedIconKeys = ''
      stLastOp.textContent = `完成: ${qi.item}`
      break
    }
  }
})

// Restore e3 paused state initially
{
  const e3Item = mockQueuedItems.find((q) => q.item === 'e3')
  if (e3Item) e3Item.paused = true
}

// ---------------------------------------------------------------------------
// Game loop tick
// ---------------------------------------------------------------------------

function gameLoopTick(): void {
  Ui.tick()
  requestAnimationFrame(gameLoopTick)
}
requestAnimationFrame(gameLoopTick)

// ---------------------------------------------------------------------------
// Dev console access
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  palette,
  mockQueue,
  mockQueuedItems,
  mockActors,
  Ui,
  rebuildIcons,
  mountWidget,
  getClockAngles: () => {
    const cells = container.querySelectorAll('.production-icon-cell')
    const results: Record<string, string> = {}
    for (const cell of cells) {
      const name = cell.getAttribute('data-icon-name') ?? '?'
      const clock = cell.querySelector('.production-clock-overlay') as HTMLElement | null
      if (clock) {
        results[name] = clock.style.background
      }
    }
    return results
  },
}
