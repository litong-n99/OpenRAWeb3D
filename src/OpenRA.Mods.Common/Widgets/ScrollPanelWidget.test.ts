/**
 * ScrollPanelWidget.test.ts — ScrollPanelWidget 迁移单元测试
 *
 * 测试覆盖:
 * - 构造和默认值
 * - ScrollPanelAlign 枚举值
 * - ScrollBar 枚举值
 * - 滚动状态管理 (scrollPosition, scrolledToBottom)
 * - scrollToTop / scrollToBottom / scroll / scrollTo
 * - scrollToItem / scrollToItemByKey / scrollToSelectedItem
 * - 滚动位置边界约束
 * - 滑块高度计算 (thumbHeight 公式)
 * - 滑块原点计算 (thumbOrigin)
 * - 鼠标滚轮处理 (wheel 事件)
 * - 滑块拖拽
 * - 箭头按钮按下/释放
 * - 键盘导航 (ArrowUp/Down, PageUp/Down, Home/End)
 * - 集合绑定 (IObservableCollection)
 * - addChild / removeChild / removeChildren + Layout 集成
 * - replaceChild
 * - 项目模板
 * - 平滑滚动物理 (UpdateSmoothScrolling 等价逻辑)
 * - Clone
 * - DOM 渲染
 * - yieldMouseFocus 重置状态
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ScrollPanelWidget,
  ScrollPanelAlign,
  ScrollBar,
  type IObservableCollection,
} from './ScrollPanelWidget.js'
import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import { ScrollItemWidget } from './ScrollItemWidget.js'

// ---------------------------------------------------------------------------
// Test widget subclass
// ---------------------------------------------------------------------------

/** 用于测试的具体 Widget 实现。 */
class TestWidget extends Widget {
  override render(): HTMLElement {
    const el = document.createElement('div')
    el.classList.add('test-widget')
    if (this.id) el.setAttribute('data-widget-id', this.id)
    return el
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 创建具有固定 bounds 的 ScrollPanelWidget。 */
function createPanel(
  width: number = 200,
  height: number = 400,
): ScrollPanelWidget {
  const panel = new ScrollPanelWidget()
  panel.bounds = { x: 0, y: 0, width, height }
  return panel
}

/** 创建具有指定高度的测试子 widget。 */
function createItem(height: number, id?: string): TestWidget {
  const w = new TestWidget()
  w.bounds = { x: 0, y: 0, width: 200, height }
  if (id) w.id = id
  return w
}

/** 创建具有指定高度和 itemKey 的 ScrollItemWidget。 */
function createScrollItem(
  height: number,
  key: string,
): ScrollItemWidget {
  const w = new ScrollItemWidget()
  w.bounds = { x: 0, y: 0, width: 200, height }
  w.itemKey = key
  w.visible = true
  return w
}

// ---------------------------------------------------------------------------
// ScrollPanelAlign
// ---------------------------------------------------------------------------

describe('ScrollPanelAlign', () => {
  it('should have Top and Bottom values', () => {
    expect(ScrollPanelAlign.Top).toBe('Top')
    expect(ScrollPanelAlign.Bottom).toBe('Bottom')
  })
})

// ---------------------------------------------------------------------------
// ScrollBar
// ---------------------------------------------------------------------------

describe('ScrollBar', () => {
  it('should have Left, Right, and Hidden values', () => {
    expect(ScrollBar.Left).toBe('Left')
    expect(ScrollBar.Right).toBe('Right')
    expect(ScrollBar.Hidden).toBe('Hidden')
  })
})

// ---------------------------------------------------------------------------
// ScrollPanelWidget
// ---------------------------------------------------------------------------

describe('ScrollPanelWidget', () => {
  let panel: ScrollPanelWidget

  beforeEach(() => {
    panel = createPanel()
  })

  // ---------------------------------------------------------------------------
  // Construction and defaults
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('should create with default values', () => {
      expect(panel).toBeInstanceOf(ScrollPanelWidget)
      expect(panel.scrollbarWidth).toBe(24)
      expect(panel.borderWidth).toBe(1)
      expect(panel.topBottomSpacing).toBe(2)
      expect(panel.itemSpacing).toBe(0)
      expect(panel.minimumThumbSize).toBe(10)
      expect(panel.panelAlign).toBe(ScrollPanelAlign.Top)
      expect(panel.scrollBar).toBe(ScrollBar.Right)
      expect(panel.collapseHiddenChildren).toBe(false)
      expect(panel.smoothScrollSpeed).toBe(0.333)
      expect(panel.contentHeight).toBe(0)
    })

    it('should default layout to ListLayout', () => {
      expect(panel.layout).toBeDefined()
    })

    it('should default scrollPosition to 0 (top)', () => {
      expect(panel.scrollPosition).toBe(0)
    })

    it('should default ignoreMouseOver to true (OpenRA convention)', () => {
      expect(panel.ignoreMouseOver).toBe(true)
    })

    it('should have scrolledToBottom = true when empty (content fits)', () => {
      // ContentHeight(0) <= bounds.height(400)
      expect(panel.scrolledToBottom).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Scroll state management
  // ---------------------------------------------------------------------------

  describe('scrollPosition', () => {
    it('should start at 0', () => {
      expect(panel.scrollPosition).toBe(0)
    })

    it('should be updated by scrollTo', () => {
      panel.contentHeight = 1000 // content larger than 400
      panel.scrollTo(-200, false)
      expect(panel.scrollPosition).toBe(-200)
    })
  })

  describe('scrolledToBottom', () => {
    it('should be true when content fits within bounds', () => {
      panel.contentHeight = 100
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      expect(panel.scrolledToBottom).toBe(true)
    })

    it('should be false when content is taller and not scrolled to end', () => {
      panel.contentHeight = 1000
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      expect(panel.scrolledToBottom).toBe(false)
    })

    it('should be true when scrolled to bottom limit', () => {
      panel.contentHeight = 1000
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      panel.scrollToBottom(false)
      expect(panel.scrolledToBottom).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // scrollToTop / scrollToBottom
  // ---------------------------------------------------------------------------

  describe('scrollToTop', () => {
    it('should set scrollPosition to 0 when PanelAlign is Top', () => {
      panel.panelAlign = ScrollPanelAlign.Top
      panel.contentHeight = 1000
      panel.scrollTo(-300, false)
      panel.scrollToTop(false)
      expect(panel.scrollPosition).toBe(0)
    })

    it('should set scrollPosition to max(0, height-contentHeight) when PanelAlign is Bottom', () => {
      panel.panelAlign = ScrollPanelAlign.Bottom
      panel.contentHeight = 1000
      // height - contentHeight = 400 - 1000 = -600, max(0, -600) = 0
      panel.scrollToTop(false)
      expect(panel.scrollPosition).toBe(0)
    })

    it('should use smooth scroll when smooth=true', () => {
      panel.contentHeight = 1000
      panel.scrollTo(-300, false)
      expect(panel.scrollPosition).toBe(-300)
      panel.scrollToTop(true)
      // With smooth scroll, target is set but current remains
      expect(panel.scrollPosition).toBe(-300) // Still at old position
    })
  })

  describe('scrollToBottom', () => {
    it('should set scrollPosition to min(0, height-contentHeight) when PanelAlign is Top', () => {
      panel.panelAlign = ScrollPanelAlign.Top
      panel.contentHeight = 1000
      // min(0, 400-1000) = min(0, -600) = -600
      panel.scrollToBottom(false)
      expect(panel.scrollPosition).toBe(-600)
    })

    it('should set scrollPosition when PanelAlign is Bottom', () => {
      panel.panelAlign = ScrollPanelAlign.Bottom
      panel.contentHeight = 1000
      // height - contentHeight = 400 - 1000 = -600
      panel.scrollToBottom(false)
      expect(panel.scrollPosition).toBe(-600)
    })
  })

  // ---------------------------------------------------------------------------
  // scroll / scrollTo
  // ---------------------------------------------------------------------------

  describe('scroll', () => {
    it('should scroll by steps of uiScrollSpeed', () => {
      panel.contentHeight = 1000
      panel.uiScrollSpeed = 30
      const oldPos = panel.scrollPosition
      panel.scroll(-2, false) // scroll down 2 steps
      expect(panel.scrollPosition).toBe(oldPos - 60)
    })

    it('should not scroll past bounds', () => {
      panel.contentHeight = 1000
      panel.uiScrollSpeed = 100
      // Max negative: 400 - 1000 = -600
      panel.scroll(-10, false) // would be -1000, clamped to -600
      expect(panel.scrollPosition).toBe(-600)
    })

    it('should not scroll above 0', () => {
      panel.contentHeight = 1000
      panel.scrollPosition // 0 initially
      panel.scroll(10, false) // would be +300, clamped to 0
      expect(panel.scrollPosition).toBe(0)
    })
  })

  describe('scrollTo', () => {
    it('should clamp to valid range', () => {
      panel.contentHeight = 1000
      panel.scrollTo(100, false) // above 0 → clamped to 0
      expect(panel.scrollPosition).toBe(0)

      panel.scrollTo(-1000, false) // below min → clamped
      expect(panel.scrollPosition).toBe(-600)
    })

    it('should accept position within range', () => {
      panel.contentHeight = 1000
      panel.scrollTo(-300, false)
      expect(panel.scrollPosition).toBe(-300)
    })
  })

  // ---------------------------------------------------------------------------
  // scrollToItem / scrollToItemByKey / scrollToSelectedItem
  // ---------------------------------------------------------------------------

  describe('scrollToItem', () => {
    /**
     * Helper: adds an item and manually sets up a tall content area.
     * addChild calls layout.adjustChild which auto-computes contentHeight
     * and item.bounds.y. We override both after addChild for testing scrollToItem.
     */
    function setupItem(
      panel: ScrollPanelWidget,
      item: Widget,
      desiredY: number,
      contentH: number,
      scrollTo: number,
    ): void {
      panel.addChild(item)
      // Override layout-assigned values for test scenario
      item.bounds.y = desiredY
      panel.contentHeight = contentH
      panel.scrollTo(scrollTo, false)
    }

    it('should scroll so item becomes visible when above viewport', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }

      const item = createItem(50, 'target')
      setupItem(panel, item, 100, 1000, -500)

      // Item at Y=100, scroll offset at -500: visible Y = 100-500 = -400
      // This is above viewport (y < 0), so scroll should adjust
      panel.scrollToItem(item, false)
      // newOffset = itemSpacing - item.bounds.y = 0 - 100 = -100
      expect(panel.scrollPosition).toBe(-100)
    })

    it('should scroll so item becomes visible when below viewport', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }

      const item = createItem(50, 'target')
      setupItem(panel, item, 800, 1000, 0)

      // Item at Y=800, scroll offset at 0: visible Y = 800
      // Bottom of item = 850, viewport height = 400
      // 850 > 400, so scroll should bring it into view
      panel.scrollToItem(item, false)
      // newOffset = height - item.y - item.height - itemSpacing = 400 - 800 - 50 - 0 = -450
      expect(panel.scrollPosition).toBe(-450)
    })

    it('should not scroll when item is already visible', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }

      const item = createItem(50, 'target')
      setupItem(panel, item, 250, 1000, -200)

      panel.scrollToItem(item, false)
      expect(panel.scrollPosition).toBe(-200) // unchanged
    })

    it('should scroll so item becomes visible from above with smooth scroll', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }

      const item = createItem(50, 'target')
      setupItem(panel, item, 100, 1000, -500)

      panel.scrollToItem(item, true) // smooth
      // With smooth, current stays but target gets set
      expect(panel.scrollPosition).toBe(-500) // unchanged immediately
      expect(panel['_targetListOffset']).toBe(-100) // target set
    })
  })

  describe('scrollToItemByKey', () => {
    it('should find item by itemKey and scroll to it', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }

      const item = createScrollItem(50, 'target-key')
      panel.addChild(item)
      // Override for test
      item.bounds.y = 800
      panel.contentHeight = 1000
      panel.scrollTo(0, false)

      panel.scrollToItemByKey('target-key', false)
      // item at Y=800, bottom at 850 > 400
      // offset = 400 - 800 - 50 = -450
      expect(panel.scrollPosition).toBe(-450)
    })

    it('should be a no-op for non-existent key', () => {
      panel.scrollToItemByKey('non-existent', false)
      expect(panel.scrollPosition).toBe(0)
    })
  })

  describe('scrollToSelectedItem', () => {
    it('should find selected item and scroll to it', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }

      const item = createScrollItem(50, 'sel-key')
      item.isSelected = () => true
      panel.addChild(item)
      // Override for test
      item.bounds.y = 900
      panel.contentHeight = 1000

      panel.scrollToSelectedItem()
      // offset = 400 - 900 - 50 - 0 = -550
      expect(panel.scrollPosition).toBe(-550)
    })

    it('should be a no-op when no item is selected', () => {
      panel.scrollToSelectedItem()
      expect(panel.scrollPosition).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Thumb geometry
  // ---------------------------------------------------------------------------

  describe('thumb geometry', () => {
    it('should have zero thumb height when content fits', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      panel.contentHeight = 200 // less than panel height
      // _thumbHeight is private; verify via DOM
      panel.render()
      const thumb = panel['_thumbEl'] as HTMLElement | null
      expect(thumb?.style.display).toBe('none')
    })

    it('should have positive thumb height when content overflows', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      panel.contentHeight = 800
      // scrollbarHeight = 400 - 2*24 = 352
      // thumbHeight = max(10, 352 * 400 / 800) = max(10, 176) = 176
      panel.render()
      const thumb = panel['_thumbEl'] as HTMLElement | null
      expect(thumb?.style.display).toBe('')
      const thumbH = parseInt(thumb?.style.height ?? '0', 10)
      expect(thumbH).toBe(176)
    })

    it('should respect minimumThumbSize', () => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      panel.minimumThumbSize = 20
      panel.contentHeight = 10000 // makes thumb very small
      panel.render()
      const thumb = panel['_thumbEl'] as HTMLElement | null
      const thumbH = parseInt(thumb?.style.height ?? '0', 10)
      expect(thumbH).toBeGreaterThanOrEqual(20)
    })
  })

  // ---------------------------------------------------------------------------
  // Mouse wheel handling
  // ---------------------------------------------------------------------------

  describe('handleEvent - wheel', () => {
    it('should scroll on wheel event', () => {
      panel.contentHeight = 1000
      panel.uiScrollSpeed = 30

      const event = {
        type: 'wheel',
        deltaY: 120,
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      }
      // deltaY positive = scroll down = -deltaY = -120
      // newTarget = 0 + (-120) * 30 = -3600... but clamped
      const handled = panel.handleEvent(event)
      expect(handled).toBe(true)
      // smooth = true, so only target changes, current stays
      expect(panel.scrollPosition).toBe(0) // smooth scroll, immediate stays
    })

    it('should return true to consume wheel event', () => {
      const event = {
        type: 'wheel',
        deltaY: 100,
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      }
      const handled = panel.handleEvent(event)
      expect(handled).toBe(true)
    })

    it('should handle negative deltaY (scroll up)', () => {
      panel.contentHeight = 1000
      // First scroll down
      panel.scrollTo(-200, false)
      expect(panel.scrollPosition).toBe(-200)

      const event = {
        type: 'wheel',
        deltaY: -120, // scroll up
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      }
      panel.handleEvent(event)
      // With smooth scrolling, current stays at -200, target changes
      expect(panel.scrollPosition).toBe(-200)
    })
  })

  // ---------------------------------------------------------------------------
  // Thumb dragging
  // ---------------------------------------------------------------------------

  describe('thumb dragging', () => {
    beforeEach(() => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      panel.contentHeight = 1000
      panel.scrollBar = ScrollBar.Right
      panel.render() // ensures rects are computed
    })

    it('should start thumb drag on mousedown within thumb rect', () => {
      // After render, thumb should be somewhere in the track
      // ThumbRect is computed in _updateRects
      const thumbRect = panel['_thumbRect']
      const midX = thumbRect.x + thumbRect.w / 2
      const midY = thumbRect.y + thumbRect.h / 2

      const handled = panel.handleEvent({
        type: 'mousedown',
        clientX: midX,
        clientY: midY,
        stopPropagation: () => {},
        target: null,
      })
      expect(handled).toBe(true)
      expect(panel['_thumbPressed']).toBe(true)
    })

    it('should update scroll position on mousemove during thumb drag', () => {
      // Start drag
      const thumbRect = panel['_thumbRect']
      const midY = thumbRect.y + thumbRect.h / 2

      panel.handleEvent({
        type: 'mousedown',
        clientX: thumbRect.x + 1,
        clientY: midY,
        stopPropagation: () => {},
        target: null,
      })

      // Move mouse down by 50px
      panel.handleEvent({
        type: 'mousemove',
        clientX: thumbRect.x + 1,
        clientY: midY + 50,
        stopPropagation: () => {},
        target: null,
      })

      // Scroll position should have changed
      expect(panel.scrollPosition).toBeLessThan(0)
    })

    it('should stop drag on mouseup', () => {
      const thumbRect = panel['_thumbRect']
      const midY = thumbRect.y + thumbRect.h / 2

      panel.handleEvent({
        type: 'mousedown',
        clientX: thumbRect.x + 1,
        clientY: midY,
        stopPropagation: () => {},
        target: null,
      })
      expect(panel['_thumbPressed']).toBe(true)

      panel.handleEvent({
        type: 'mouseup',
        clientX: thumbRect.x + 1,
        clientY: midY,
        stopPropagation: () => {},
        target: null,
      })
      expect(panel['_thumbPressed']).toBe(false)
    })

    it('should not drag when thumb has no height', () => {
      panel.contentHeight = 200 // fits in panel
      panel.render()

      // Try to click thumb area
      panel.handleEvent({
        type: 'mousedown',
        clientX: 188, // right scrollbar area
        clientY: 200,
        stopPropagation: () => {},
        target: null,
      })
      // _thumbPressed should remain false since thumb has no height
      expect(panel['_thumbPressed']).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Arrow button press/release
  // ---------------------------------------------------------------------------

  describe('arrow buttons', () => {
    beforeEach(() => {
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      panel.contentHeight = 1000
      panel.render()
    })

    it('should set upPressed on mousedown within up button rect', () => {
      const upRect = panel['_upButtonRect']
      panel.handleEvent({
        type: 'mousedown',
        clientX: upRect.x + 5,
        clientY: upRect.y + 5,
        stopPropagation: () => {},
        target: null,
      })
      expect(panel['_upPressed']).toBe(true)
    })

    it('should set downPressed on mousedown within down button rect', () => {
      const downRect = panel['_downButtonRect']
      panel.handleEvent({
        type: 'mousedown',
        clientX: downRect.x + 5,
        clientY: downRect.y + 5,
        stopPropagation: () => {},
        target: null,
      })
      expect(panel['_downPressed']).toBe(true)
    })

    it('should release buttons on mouseup', () => {
      const upRect = panel['_upButtonRect']
      panel.handleEvent({
        type: 'mousedown',
        clientX: upRect.x + 5,
        clientY: upRect.y + 5,
        stopPropagation: () => {},
        target: null,
      })
      panel.handleEvent({
        type: 'mouseup',
        clientX: upRect.x + 5,
        clientY: upRect.y + 5,
        stopPropagation: () => {},
        target: null,
      })
      expect(panel['_upPressed']).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  describe('keyboard navigation', () => {
    beforeEach(() => {
      panel.contentHeight = 1000
      panel.uiScrollSpeed = 30
    })

    it('should scroll up on ArrowUp', () => {
      panel.scrollTo(-200, false)
      const handled = panel.handleEvent({
        type: 'keydown',
        key: 'ArrowUp',
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      })
      expect(handled).toBe(true)
      expect(panel.scrollPosition).toBe(-170) // -200 + 30 = -170
    })

    it('should scroll down on ArrowDown', () => {
      panel.scrollTo(-200, false)
      const handled = panel.handleEvent({
        type: 'keydown',
        key: 'ArrowDown',
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      })
      expect(handled).toBe(true)
      expect(panel.scrollPosition).toBe(-230) // -200 - 30 = -230
    })

    it('should scroll up one page on PageUp', () => {
      panel.scrollTo(-100, false)
      panel.handleEvent({
        type: 'keydown',
        key: 'PageUp',
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      })
      // -100 + 400 = 300 → clamped to 0
      expect(panel.scrollPosition).toBe(0)
    })

    it('should scroll down one page on PageDown', () => {
      panel.handleEvent({
        type: 'keydown',
        key: 'PageDown',
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      })
      // 0 - 400 = -400
      expect(panel.scrollPosition).toBe(-400)
    })

    it('should scroll to top on Home', () => {
      panel.scrollTo(-300, false)
      panel.handleEvent({
        type: 'keydown',
        key: 'Home',
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      })
      expect(panel.scrollPosition).toBe(0)
    })

    it('should scroll to bottom on End', () => {
      panel.handleEvent({
        type: 'keydown',
        key: 'End',
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      })
      expect(panel.scrollPosition).toBe(-600)
    })

    it('should return false for unhandled keys', () => {
      const handled = panel.handleEvent({
        type: 'keydown',
        key: 'a',
        clientX: 0,
        clientY: 0,
        stopPropagation: () => {},
        target: null,
      })
      expect(handled).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Collection binding
  // ---------------------------------------------------------------------------

  describe('bindToCollection', () => {
    let collection: IObservableCollection<{ id: string; name: string }>
    let makeWidget: (item: { id: string; name: string }) => Widget

    beforeEach(() => {
      collection = {
        observedItems: [
          { id: 'a', name: 'Alice' },
          { id: 'b', name: 'Bob' },
        ],
      }
      makeWidget = (item) => {
        const w = createScrollItem(30, item.id)
        w.text = item.name
        return w
      }
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
    })

    it('should populate children from collection on bind', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)

      // Wait for microtask
      await new Promise((r) => setTimeout(r, 0))

      expect(panel.children.length).toBe(2)
      expect((panel.children[0] as ScrollItemWidget).itemKey).toBe('a')
      expect((panel.children[1] as ScrollItemWidget).itemKey).toBe('b')
    })

    it('should unbind previous collection when binding new one', async () => {
      const oldCollection: IObservableCollection<{ id: string }> = {
        observedItems: [{ id: 'old' }],
      }
      const oldMakeWidget = (item: { id: string }) =>
        createScrollItem(30, item.id)

      panel.bindToCollection(oldCollection, oldMakeWidget, null, false)
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(1)

      // Bind to new collection
      const newCollection: IObservableCollection<{ id: string }> = {
        observedItems: [{ id: 'new1' }, { id: 'new2' }],
      }
      const newMakeWidget = (item: { id: string }) =>
        createScrollItem(30, item.id)

      panel.bindToCollection(newCollection, newMakeWidget, null, false)
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(2)
    })

    it('should handle OnAdd', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(2)

      // Trigger add
      collection.observedItems.push({ id: 'c', name: 'Charlie' })
      collection.onAdd?.(collection, { id: 'c', name: 'Charlie' })
      await new Promise((r) => setTimeout(r, 0))

      expect(panel.children.length).toBe(3)
      expect((panel.children[2] as ScrollItemWidget).itemKey).toBe('c')
    })

    it('should handle OnRemove', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(2)

      // Remove 'a'
      const idx = collection.observedItems.findIndex((i) => i.id === 'a')
      if (idx >= 0) collection.observedItems.splice(idx, 1)
      collection.onRemove?.(collection, { id: 'a', name: 'Alice' })
      await new Promise((r) => setTimeout(r, 0))

      expect(panel.children.length).toBe(1)
      expect((panel.children[0] as ScrollItemWidget).itemKey).toBe('b')
    })

    it('should handle OnRemoveAt', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(2)

      // Remove at index 0
      collection.observedItems.splice(0, 1)
      collection.onRemoveAt?.(collection, 0)
      await new Promise((r) => setTimeout(r, 0))

      expect(panel.children.length).toBe(1)
      expect((panel.children[0] as ScrollItemWidget).itemKey).toBe('b')
    })

    it('should handle OnSet (replace)', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)
      await new Promise((r) => setTimeout(r, 0))

      const oldItem = { id: 'a', name: 'Alice' }
      const newItem = { id: 'a-replaced', name: 'Alice 2.0' }

      collection.onSet?.(collection, oldItem, newItem)
      await new Promise((r) => setTimeout(r, 0))

      // 'a' should be replaced by 'a-replaced'
      expect((panel.children[0] as ScrollItemWidget).itemKey).toBe(
        'a-replaced',
      )
    })

    it('should handle OnRefresh', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)
      await new Promise((r) => setTimeout(r, 0))

      // Refresh with new items
      collection.observedItems = [
        { id: 'x', name: 'Xavier' },
        { id: 'y', name: 'Yvonne' },
        { id: 'z', name: 'Zack' },
      ]
      collection.onRefresh?.(collection)
      await new Promise((r) => setTimeout(r, 0))

      expect(panel.children.length).toBe(3)
      expect((panel.children[0] as ScrollItemWidget).itemKey).toBe('x')
      expect((panel.children[1] as ScrollItemWidget).itemKey).toBe('y')
      expect((panel.children[2] as ScrollItemWidget).itemKey).toBe('z')
    })

    it('should auto-scroll when autoScroll is true', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id
      panel.contentHeight = 1000 // creates scrollable area

      // First bind with small collection
      const smallCollection: IObservableCollection<{ id: string }> =
        { observedItems: [{ id: 'a' }] }
      panel.bindToCollection(
        smallCollection,
        (item) => createScrollItem(30, (item as { id: string }).id),
        equals,
        true,
      )
      await new Promise((r) => setTimeout(r, 0))

      // Add many items to trigger auto-scroll
      for (let i = 0; i < 20; i++) {
        const item = { id: `item-${i}` }
        smallCollection.observedItems.push(item)
        smallCollection.onAdd?.(smallCollection, item)
      }
      await new Promise((r) => setTimeout(r, 0))

      // Should have scrolled to bottom
      const expectedBottom =
        Math.min(0, panel.bounds.height - panel.contentHeight)
      expect(panel['_targetListOffset']).toBe(expectedBottom)
    })

    it('should unbind via unbind()', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(2)

      panel.unbind()
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(0)
    })

    it('should handle null collection as unbind', async () => {
      const equals = (w: Widget, item: { id: string }) =>
        (w as ScrollItemWidget).itemKey === item.id

      panel.bindToCollection(collection, makeWidget, equals, false)
      await new Promise((r) => setTimeout(r, 0))

      panel.bindToCollection(null, null, null, false)
      await new Promise((r) => setTimeout(r, 0))
      expect(panel.children.length).toBe(0)
    })

    it('should not trigger old collection events after rebind', async () => {
      const oldCollection: IObservableCollection<{ id: string }> = {
        observedItems: [{ id: 'old-1' }, { id: 'old-2' }],
      }

      panel.bindToCollection(
        oldCollection,
        (item) => createScrollItem(30, (item as { id: string }).id),
        null,
        false,
      )
      await new Promise((r) => setTimeout(r, 0))

      // Now bind to new collection
      const newCollection: IObservableCollection<{ id: string }> = {
        observedItems: [{ id: 'new-1' }],
      }
      panel.bindToCollection(
        newCollection,
        (item) => createScrollItem(30, (item as { id: string }).id),
        null,
        false,
      )
      await new Promise((r) => setTimeout(r, 0))

      // Trigger event on old collection - should be ignored
      oldCollection.observedItems.push({ id: 'stale' })
      oldCollection.onAdd?.(oldCollection, { id: 'stale' })
      await new Promise((r) => setTimeout(r, 0))

      expect(panel.children.length).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // addChild / removeChild + Layout integration
  // ---------------------------------------------------------------------------

  describe('addChild with layout', () => {
    it('should increase contentHeight when adding children', () => {
      panel.topBottomSpacing = 2
      panel.itemSpacing = 0

      const item = createItem(50)
      panel.addChild(item)

      // ContentHeight includes topBottomSpacing and child height
      // adjustChild: for first child:
      //   contentHeight = 2*2 - 0 = 4
      //   then contentHeight += 50 + 0 = 54
      expect(panel.contentHeight).toBeGreaterThan(0)
    })

    it('should add child to children array', () => {
      const item = createItem(50)
      panel.addChild(item)
      expect(panel.children.length).toBe(1)
      expect(panel.children[0]).toBe(item)
    })

    it('should set child Y position via layout', () => {
      panel.topBottomSpacing = 5
      panel.itemSpacing = 2

      const item1 = createItem(50, 'item1')
      const item2 = createItem(30, 'item2')

      panel.addChild(item1)
      // First child: contentHeight initialized to 2*5-2=8
      // Y = 8 - 5 + 2 = 5
      // contentHeight += 50 + 2 = 60
      expect(item1.bounds.y).toBe(5)

      panel.addChild(item2)
      // contentHeight was 60
      // Y = 60 - 5 + 2 = 57
      expect(item2.bounds.y).toBe(57)
    })
  })

  describe('removeChild with layout', () => {
    it('should decrease contentHeight when removing children', () => {
      panel.topBottomSpacing = 2
      panel.itemSpacing = 0

      const item = createItem(50)
      panel.addChild(item)
      const heightAfterAdd = panel.contentHeight

      panel.removeChild(item)
      expect(panel.contentHeight).toBeLessThan(heightAfterAdd)
    })

    it('should remove child from array', () => {
      const item = createItem(50)
      panel.addChild(item)
      panel.removeChild(item)
      expect(panel.children.length).toBe(0)
    })

    it('should adjust remaining children positions', () => {
      panel.topBottomSpacing = 2
      panel.itemSpacing = 0

      const item1 = createItem(50, 'item1')
      const item2 = createItem(30, 'item2')

      panel.addChild(item1)
      panel.addChild(item2)

      const item2YBefore = item2.bounds.y
      panel.removeChild(item1)

      // After removing item1, item2 should move up
      expect(item2.bounds.y).toBeLessThan(item2YBefore)
    })
  })

  describe('removeChildren', () => {
    it('should remove all children and reset contentHeight', () => {
      for (let i = 0; i < 5; i++) {
        panel.addChild(createItem(30, `item-${i}`))
      }
      expect(panel.children.length).toBe(5)

      panel.removeChildren()
      expect(panel.children.length).toBe(0)
      expect(panel.contentHeight).toBe(0)
    })
  })

  describe('replaceChild', () => {
    it('should replace old child with new child', () => {
      const oldChild = createItem(30, 'old')
      const newChild = createItem(40, 'new')

      panel.addChild(oldChild)
      panel.replaceChild(oldChild, newChild)

      expect(panel.children.length).toBe(1)
      expect(panel.children[0]).toBe(newChild)
      expect(newChild.parent).toBe(panel)
    })
  })

  // ---------------------------------------------------------------------------
  // Item template
  // ---------------------------------------------------------------------------

  describe('itemTemplate', () => {
    it('should allow setting and getting template', () => {
      const template = new ScrollItemWidget()
      template.id = 'template-item'
      panel.setItemTemplate(template)
      expect(panel.getItemTemplate()).toBe(template)
    })

    it('should default to null', () => {
      expect(panel.getItemTemplate()).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Smooth scrolling physics
  // ---------------------------------------------------------------------------

  describe('smooth scrolling', () => {
    it('should interpolate current toward target', () => {
      panel.contentHeight = 1000
      panel.smoothScrollSpeed = 1.0 // full speed

      // Set target via smooth scroll
      panel.scrollTo(-200, true)
      expect(panel.scrollPosition).toBe(0) // Not yet moved

      // First tick initializes _lastSmoothScrollTime
      panel.tick()
      // Second tick actually moves (dt > 0)
      // We need to ensure enough time has passed, so use a micro-delay
      // Since tick uses performance.now(), consecutive ticks with no delay
      // may have dt=0 and not move. Let's simulate time passing.
      panel['_lastSmoothScrollTime'] = performance.now() - 100 // pretend 100ms passed
      panel.tick()
      // Should have moved toward -200
      expect(panel.scrollPosition).toBeLessThan(0)
    })

    it('should snap to target when difference is small (< 1px)', () => {
      panel.contentHeight = 1000
      // Use non-smooth to set position first
      panel.scrollTo(-200, false)
      expect(panel.scrollPosition).toBe(-200)

      // Now set target very close to current
      panel.scrollTo(-200.3, true)
      // After tick, should snap
      panel['_lastSmoothScrollTime'] = performance.now() - 50 // ensure dt > 0
      panel.tick()
      expect(panel.scrollPosition).toBe(-200.3)
    })

    it('should clamp smoothScrollSpeed to [0.1, 1.0]', () => {
      panel.contentHeight = 1000
      panel.smoothScrollSpeed = 0.05 // below minimum
      panel.scrollTo(-200, true)

      const beforeTick = panel.scrollPosition
      panel['_lastSmoothScrollTime'] = performance.now() - 50
      panel.tick()
      // Even with low speed, should move (clamped to 0.1 minimum)
      expect(panel.scrollPosition).toBeLessThanOrEqual(beforeTick)
    })
  })

  // ---------------------------------------------------------------------------
  // Tick (continuous button press + smooth scroll)
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('should scroll up when upPressed is true', () => {
      panel.contentHeight = 1000
      panel.scrollTo(-200, false)

      // Simulate mousedown on up button
      panel['_upPressed'] = true
      panel.tick()
      expect(panel.scrollPosition).toBeGreaterThan(-200) // scrolled up
    })

    it('should scroll down when downPressed is true', () => {
      panel.contentHeight = 1000
      panel.scrollTo(-200, false)

      panel['_downPressed'] = true
      panel.tick()
      expect(panel.scrollPosition).toBeLessThan(-200) // scrolled down
    })

    it('should update arrow disabled states', () => {
      panel.contentHeight = 1000
      panel.tick()
      // At top: up should be disabled, down enabled
      expect(panel['_upDisabled']).toBe(true)
      expect(panel['_downDisabled']).toBe(false)

      // Scroll to bottom
      panel.scrollToBottom(false)
      panel.tick()
      // At bottom: down should be disabled, up enabled
      expect(panel['_downDisabled']).toBe(true)
      expect(panel['_upDisabled']).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // yieldMouseFocus
  // ---------------------------------------------------------------------------

  describe('yieldMouseFocus', () => {
    it('should reset all button and thumb states', () => {
      panel['_upPressed'] = true
      panel['_downPressed'] = true
      panel['_thumbPressed'] = true

      panel.yieldMouseFocus()

      expect(panel['_upPressed']).toBe(false)
      expect(panel['_downPressed']).toBe(false)
      expect(panel['_thumbPressed']).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  describe('clone', () => {
    it('should return new ScrollPanelWidget instance', () => {
      const clone = panel.clone()
      expect(clone).toBeInstanceOf(ScrollPanelWidget)
      expect(clone).not.toBe(panel)
    })

    it('should copy all configuration properties', () => {
      panel.scrollbarWidth = 30
      panel.topBottomSpacing = 5
      panel.itemSpacing = 2
      panel.minimumThumbSize = 15
      panel.panelAlign = ScrollPanelAlign.Bottom
      panel.scrollBar = ScrollBar.Left
      panel.collapseHiddenChildren = true
      panel.uiScrollSpeed = 40
      panel.smoothScrollSpeed = 0.5

      const clone = panel.clone()
      expect(clone.scrollbarWidth).toBe(30)
      expect(clone.topBottomSpacing).toBe(5)
      expect(clone.itemSpacing).toBe(2)
      expect(clone.minimumThumbSize).toBe(15)
      expect(clone.panelAlign).toBe(ScrollPanelAlign.Bottom)
      expect(clone.scrollBar).toBe(ScrollBar.Left)
      expect(clone.collapseHiddenChildren).toBe(true)
      expect(clone.uiScrollSpeed).toBe(40)
      expect(clone.smoothScrollSpeed).toBe(0.5)
    })

    it('should clone child widgets (using cloneable ScrollItemWidget)', () => {
      const child = new ScrollItemWidget()
      child.id = 'child-1'
      child.bounds = { x: 0, y: 0, width: 200, height: 30 }
      panel.addChild(child)

      const clone = panel.clone()
      expect(clone.children.length).toBe(1)
      expect(clone.children[0].id).toBe('child-1')
      expect(clone.children[0]).not.toBe(child)
    })
  })

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('should return an HTMLElement', () => {
      const el = panel.render()
      expect(el).toBeInstanceOf(HTMLElement)
    })

    it('should have overflow:hidden style', () => {
      const el = panel.render()
      expect(el.style.overflow).toBe('hidden')
    })

    it('should include data-widget-id when id is set', () => {
      panel.id = 'scroll-panel-1'
      const el = panel.render()
      expect(el.getAttribute('data-widget-id')).toBe('scroll-panel-1')
    })

    it('should create content container', () => {
      const el = panel.render()
      const content = el.querySelector('.scroll-panel-content')
      expect(content).toBeTruthy()
    })

    it('should create scrollbar when not Hidden', () => {
      panel.scrollBar = ScrollBar.Right
      const el = panel.render()
      const scrollbar = el.querySelector('.scroll-panel-scrollbar')
      expect(scrollbar).toBeTruthy()
    })

    it('should not create scrollbar when Hidden', () => {
      panel.scrollBar = ScrollBar.Hidden
      const el = panel.render()
      const scrollbar = el.querySelector('.scroll-panel-scrollbar')
      expect(scrollbar).toBeNull()
    })

    it('should render child widgets inside content container', () => {
      const child = createItem(30, 'child-1')
      panel.addChild(child)

      const el = panel.render()
      const content = el.querySelector('.scroll-panel-content')
      expect(content).toBeTruthy()
      const childEl = content!.querySelector('[data-widget-id="child-1"]')
      expect(childEl).toBeTruthy()
    })

    it('should apply correct transform to content', () => {
      panel.contentHeight = 1000
      panel.scrollTo(-100, false)
      const el = panel.render()
      const content = el.querySelector(
        '.scroll-panel-content',
      ) as HTMLElement
      expect(content.style.transform).toBe('translateY(-100px)')
    })

    it('should position content left offset for Left scrollbar', () => {
      panel.scrollBar = ScrollBar.Left
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      const el = panel.render()
      const content = el.querySelector(
        '.scroll-panel-content',
      ) as HTMLElement
      expect(content.style.left).toBe('24px')
    })

    it('should position content at 0 for Right scrollbar', () => {
      panel.scrollBar = ScrollBar.Right
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      const el = panel.render()
      const content = el.querySelector(
        '.scroll-panel-content',
      ) as HTMLElement
      expect(content.style.left).toBe('0px')
    })

    it('should use full width for content when scrollbar Hidden', () => {
      panel.scrollBar = ScrollBar.Hidden
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      const el = panel.render()
      const content = el.querySelector(
        '.scroll-panel-content',
      ) as HTMLElement
      expect(content.style.width).toBe('200px')
    })
  })

  // ---------------------------------------------------------------------------
  // ScrollBar geometry (Left vs Right vs Hidden)
  // ---------------------------------------------------------------------------

  describe('scrollbar geometry (Left)', () => {
    it('should position scrollbar at left edge', () => {
      panel.scrollBar = ScrollBar.Left
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      const el = panel.render()
      const scrollbar = el.querySelector(
        '.scroll-panel-scrollbar',
      ) as HTMLElement
      expect(scrollbar.style.left).toBe('0px')
    })

    it('should position up button at top-left', () => {
      panel.scrollBar = ScrollBar.Left
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      panel.render()
      const upRect = panel['_upButtonRect']
      expect(upRect.x).toBe(0)
      expect(upRect.y).toBe(0)
    })
  })

  describe('scrollbar geometry (Right)', () => {
    it('should position scrollbar at right edge', () => {
      panel.scrollBar = ScrollBar.Right
      panel.bounds = { x: 0, y: 0, width: 200, height: 400 }
      const el = panel.render()
      const scrollbar = el.querySelector(
        '.scroll-panel-scrollbar',
      ) as HTMLElement
      expect(scrollbar.style.left).toBe('176px') // 200 - 24
    })
  })

  describe('scrollbar geometry (Hidden)', () => {
    it('should render no scrollbar elements', () => {
      panel.scrollBar = ScrollBar.Hidden
      const el = panel.render()
      expect(el.querySelector('.scroll-panel-scrollbar')).toBeNull()
      expect(el.querySelector('.scroll-panel-thumb')).toBeNull()
    })
  })
})
