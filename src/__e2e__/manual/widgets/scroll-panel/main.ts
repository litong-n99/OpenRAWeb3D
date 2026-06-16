/**
 * widgets/scroll-panel/main.ts — ScrollPanelWidget comprehensive scroll test
 *
 * Verifies scroll behavior: mouse wheel, thumb drag, keyboard navigation,
 * proportional thumb sizing, smooth scrolling physics, scroll clamping.
 *
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/ScrollPanelWidget.cs
 */
import { Ui, type WidgetEvent } from '../../../../OpenRA.Game/Widgets/Widget.js'
import { ScrollPanelWidget, ScrollBar } from '../../../../OpenRA.Mods.Common/Widgets/ScrollPanelWidget.js'
import { LabelWidget } from '../../../../OpenRA.Mods.Common/Widgets/LabelWidget.js'
import { TextAlign } from '../../../../OpenRA.Mods.Common/Widgets/TextAlign.js'
import type { Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'

/** Generate pseudo-lorem text for list items. */
function generateLoremText(i: number): string {
  const words = [
    'Lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur',
    'adipiscing', 'elit', 'sed', 'do', 'eiusmod', 'tempor',
    'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna',
    'aliqua', 'enim', 'veniam', 'quis', 'nostrud', 'exercitation',
    'ullamco', 'laboris', 'nisi', 'aliquip', 'commodo', 'consequat',
  ]
  const len = 5 + (i % 8)
  const parts: string[] = []
  for (let j = 0; j < len; j++) {
    parts.push(words[(i + j) % words.length])
  }
  return parts.join(' ') + '.'
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
// Create the ScrollPanelWidget
// ---------------------------------------------------------------------------

const container = document.getElementById('scroll-container')!
const itemCount = 50
const itemHeight = 30
const itemSpacing = 2
const totalContentHeight = itemCount * (itemHeight + itemSpacing)

const sp = new ScrollPanelWidget()
sp.id = 'scroll-panel-test'
sp.scrollBar = ScrollBar.Right
sp.scrollbarWidth = 24
sp.topBottomSpacing = 4
sp.itemSpacing = itemSpacing
sp.uiScrollSpeed = itemHeight + itemSpacing // 1 item per scroll step
sp.smoothScrollSpeed = 0.333
sp.contentHeight = totalContentHeight

// Position: fill the container with some padding
function layoutScrollPanel(): void {
  const rect = container.getBoundingClientRect()
  sp.bounds = {
    x: 0,
    y: 0,
    width: rect.width,
    height: rect.height,
  }
}
layoutScrollPanel()
window.addEventListener('resize', () => {
  layoutScrollPanel()
  // Re-render
  mountWidget(sp, container)
})

// Create 50 items with alternating colors and selection capability
for (let i = 0; i < itemCount; i++) {
  const item = new LabelWidget()
  const isHeader = i % 10 === 0
  const isSelected = i === 24 // Item #25

  if (isHeader) {
    item.text = `--- Section ${Math.floor(i / 10) + 1} ---`
    item.textColor = '#58a6ff'
    item.font = 'bold 14px Arial'
  } else {
    item.text = `Item #${i + 1}: ${generateLoremText(i)}`
    item.textColor = isSelected ? '#f9a825' : '#cccccc'
    item.font = '13px Arial'
  }
  if (isSelected) {
    // Add a subtle indicator
    item.contrast = true
    item.contrastColorDark = '#000000'
    item.contrastColorLight = '#3a3a00'
    item.contrastRadius = 1
  }
  item.align = TextAlign.Left
  item.bounds = { x: 4, y: i * (itemHeight + itemSpacing), width: sp.bounds.width - sp.scrollbarWidth - 8, height: itemHeight }
  item.id = `item-${i + 1}`
  sp.addChild(item)
}

// ---------------------------------------------------------------------------
// Mount into DOM and set up event routing
// ---------------------------------------------------------------------------

function mountWidget(widget: Widget, parent: HTMLElement): void {
  // Clear previous content
  while (parent.firstChild) parent.removeChild(parent.firstChild)
  const el = widget.renderOuter()
  parent.appendChild(el)

  // Remove old listeners by cloning (simplified approach)
  const eventTypes = ['mousedown', 'mouseup', 'mousemove', 'click', 'wheel', 'keydown', 'keyup']
  for (const type of eventTypes) {
    parent.addEventListener(type, (e: Event) => {
      const me = e as MouseEvent
      const widgetEvent: WidgetEvent = {
        type,
        stopPropagation: () => e.stopPropagation(),
        target: me.target as HTMLElement | null,
        clientX: me.clientX,
        clientY: me.clientY,
        button: me.button,
        deltaY: (e as WheelEvent).deltaY,
        key: (e as KeyboardEvent).key,
        ctrlKey: (e as KeyboardEvent).ctrlKey,
        altKey: (e as KeyboardEvent).altKey,
        shiftKey: (e as KeyboardEvent).shiftKey,
        metaKey: (e as KeyboardEvent).metaKey,
        repeat: (e as KeyboardEvent).repeat,
      }
      // Route to ScrollPanelWidget specifically
      const handled = sp.handleEventOuter(widgetEvent)
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    })
  }
}

mountWidget(sp, container)

// ---------------------------------------------------------------------------
// Status monitoring
// ---------------------------------------------------------------------------

const stOffset = document.getElementById('st-offset')!
const stTarget = document.getElementById('st-target')!
const stContentH = document.getElementById('st-content-h')!
const stVisibleH = document.getElementById('st-visible-h')!
const stThumbH = document.getElementById('st-thumb-h')!
const stThumbY = document.getElementById('st-thumb-y')!
const stUpBtn = document.getElementById('st-up-btn')!
const stDownBtn = document.getElementById('st-down-btn')!
const stThumbState = document.getElementById('st-thumb-state')!
const stLastOp = document.getElementById('st-last-op')!

let lastOffset = 0
let lastThumbPressed = false
let lastUpPressed = false
let lastDownPressed = false

function monitorState(): void {
  const currentOffset = (sp as any)._currentListOffset ?? 0
  const targetOffset = (sp as any)._targetListOffset ?? 0
  const thumbHeight = (sp as any)._thumbHeight ?? 0
  const thumbOrigin = (sp as any)._thumbOrigin ?? 0
  const upDisabled = (sp as any)._upDisabled ?? false
  const downDisabled = (sp as any)._downDisabled ?? false
  const thumbPressed = (sp as any)._thumbPressed ?? false
  const upPressed = (sp as any)._upPressed ?? false
  const downPressed = (sp as any)._downPressed ?? false

  stOffset.textContent = `${currentOffset.toFixed(1)}px`
  stTarget.textContent = `${targetOffset.toFixed(1)}px`
  stContentH.textContent = `${sp.contentHeight}px`
  stVisibleH.textContent = `${sp.bounds.height}px`
  stThumbH.textContent = `${thumbHeight.toFixed(1)}px`
  stThumbY.textContent = `${thumbOrigin.toFixed(1)}px`
  stUpBtn.textContent = upDisabled ? '禁用' : '启用'
  stDownBtn.textContent = downDisabled ? '禁用' : '启用'
  stThumbState.textContent = thumbPressed ? '拖拽中' : '释放'

  // Detect scroll actions
  if (Math.abs(currentOffset - lastOffset) > 0.5) {
    const direction = currentOffset < lastOffset ? 'up' : 'down'
    stLastOp.textContent = `滚动 ${direction} (${(currentOffset - lastOffset).toFixed(0)}px)`
    lastOffset = currentOffset
  }
  if (thumbPressed && !lastThumbPressed) stLastOp.textContent = '滑块开始拖拽'
  if (!thumbPressed && lastThumbPressed) stLastOp.textContent = '滑块释放'
  if (upPressed && !lastUpPressed) stLastOp.textContent = '上箭头按钮按下'
  if (downPressed && !lastDownPressed) stLastOp.textContent = '下箭头按钮按下'

  lastThumbPressed = thumbPressed
  lastUpPressed = upPressed
  lastDownPressed = downPressed

  requestAnimationFrame(monitorState)
}
requestAnimationFrame(monitorState)

// ---------------------------------------------------------------------------
// Button controls
// ---------------------------------------------------------------------------

document.getElementById('btn-scroll-top')!.addEventListener('click', () => {
  sp.scrollToTop(true)
  stLastOp.textContent = '命令: ScrollToTop (smooth)'
})

document.getElementById('btn-scroll-bottom')!.addEventListener('click', () => {
  sp.scrollToBottom(true)
  stLastOp.textContent = '命令: ScrollToBottom (smooth)'
})

document.getElementById('btn-scroll-up')!.addEventListener('click', () => {
  sp.scroll(5, true)
  stLastOp.textContent = '命令: Scroll up 5 items (smooth)'
})

document.getElementById('btn-scroll-down')!.addEventListener('click', () => {
  sp.scroll(-5, true)
  stLastOp.textContent = '命令: Scroll down 5 items (smooth)'
})

document.getElementById('btn-scroll-item')!.addEventListener('click', () => {
  const item25 = sp.children.find((c) => c.id === 'item-25')
  if (item25) {
    sp.scrollToItem(item25, true)
    stLastOp.textContent = '命令: ScrollToItem #25 (smooth)'
  }
})

// Keyboard: focus the container
container.tabIndex = 0
container.focus()

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
  scrollPanel: sp,
  Ui,
  getContentHeight: () => sp.contentHeight,
  getScrollPosition: () => (sp as any)._currentListOffset,
  getThumbHeight: () => (sp as any)._thumbHeight,
}
