/**
 * GridLayout.test.ts — GridLayout 单元测试
 *
 * 测试覆盖:
 * - 构建 + ColumnCount 属性
 * - AdjustChild — 第一个子 widget 初始化 contentHeight
 * - AdjustChild — 水平排列子 widget（同行）
 * - AdjustChild — 换行行为（超出可用宽度）
 * - AdjustChild — 更新 ContentHeight
 * - AdjustChildren — 重新计算所有子 widget 布局
 * - 空 children 场景
 * - ILayout 接口实现
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GridLayout, type IGridLayoutHost } from './GridLayout.js'
import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Mock widget for layout
// ---------------------------------------------------------------------------

class MockLayoutWidget extends Widget {
  constructor(
    width: number = 80,
    height: number = 30,
  ) {
    super()
    this.bounds = { x: 0, y: 0, width, height }
  }

  override render(): HTMLElement {
    return this.getOrCreateElement('div', 'mock-layout-widget')
  }
}

// ---------------------------------------------------------------------------
// Mock host (simulates ScrollPanelWidget state)
// ---------------------------------------------------------------------------

function createMockHost(
  overrides: Partial<IGridLayoutHost> = {},
): IGridLayoutHost {
  return {
    children: [],
    contentHeight: 0,
    itemSpacing: 4,
    topBottomSpacing: 2,
    boundsWidth: 400,
    scrollbarWidth: 0,
    columnCount: undefined,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GridLayout', () => {
  let host: IGridLayoutHost
  let layout: GridLayout

  beforeEach(() => {
    host = createMockHost()
    layout = new GridLayout(host)
  })

  describe('construction and properties', () => {
    it('creates with default columnCount 0 (auto)', () => {
      expect(layout.columnCount).toBe(0)
    })

    it('creates with specified columnCount', () => {
      const grid = new GridLayout(host, 3)
      expect(grid.columnCount).toBe(3)
    })

    it('columnCount property is settable', () => {
      layout.columnCount = 4
      expect(layout.columnCount).toBe(4)
    })
  })

  describe('adjustChild — first child', () => {
    it('initializes contentHeight for first child', () => {
      const child = new MockLayoutWidget()
      host.children.push(child)

      layout.adjustChild(child)

      // ContentHeight should be initialized to 2 * topBottomSpacing
      expect(host.contentHeight).toBeGreaterThanOrEqual(2 * host.topBottomSpacing)
    })

    it('positions first child at itemSpacing from left', () => {
      const child = new MockLayoutWidget(80, 30)
      host.children.push(child)

      layout.adjustChild(child)

      // Child x should be at itemSpacing (since parent x was 0 + itemSpacing)
      expect(child.bounds.x).toBe(host.itemSpacing)
      // Child y should be at topBottomSpacing
      expect(child.bounds.y).toBe(host.topBottomSpacing)
    })
  })

  describe('adjustChild — multiple children', () => {
    it('positions second child to the right of first', () => {
      const child1 = new MockLayoutWidget(80, 30)
      host.children.push(child1)
      layout.adjustChild(child1)

      const child2 = new MockLayoutWidget(80, 30)
      host.children.push(child2)
      layout.adjustChild(child2)

      // Child2 should be to the right of child1
      expect(child2.bounds.x).toBeGreaterThan(child1.bounds.x)
      // Same row — same y
      expect(child2.bounds.y).toBe(child1.bounds.y)
    })

    it('wraps to next row when child overflows available width', () => {
      // Use a narrow host
      host = createMockHost({ boundsWidth: 200 })
      layout = new GridLayout(host)

      const child1 = new MockLayoutWidget(150, 30)
      host.children.push(child1)
      layout.adjustChild(child1)

      const child2 = new MockLayoutWidget(100, 30)
      host.children.push(child2)
      layout.adjustChild(child2)

      // Child2 should be on a new row (higher y)
      expect(child2.bounds.y).toBeGreaterThan(child1.bounds.y)
      // Child2 should start at left edge
      expect(child2.bounds.x).toBe(host.itemSpacing)
    })

    it('updates contentHeight for multi-row layout', () => {
      host = createMockHost({ boundsWidth: 200 })
      layout = new GridLayout(host)

      const child1 = new MockLayoutWidget(150, 40)
      host.children.push(child1)
      layout.adjustChild(child1)

      const child2 = new MockLayoutWidget(100, 50)
      host.children.push(child2)
      layout.adjustChild(child2)

      // ContentHeight should account for both rows
      // First row: topBottomSpacing + 40
      // Second row: itemSpacing between rows + 50 + topBottomSpacing
      expect(host.contentHeight).toBeGreaterThanOrEqual(
        host.topBottomSpacing + 40 + host.itemSpacing + 50 + host.topBottomSpacing,
      )
    })

    it('subtracts scrollbarWidth from available width', () => {
      host = createMockHost({ boundsWidth: 300, scrollbarWidth: 24 })
      layout = new GridLayout(host)

      const child1 = new MockLayoutWidget(256, 30) // Almost fills available width
      host.children.push(child1)
      layout.adjustChild(child1)

      const child2 = new MockLayoutWidget(50, 30)
      host.children.push(child2)
      layout.adjustChild(child2)

      // Child2 should wrap because availableWidth = 300 - 24 = 276
      // child1.x (likely ~4) + child1.width (256) + spacing (4) = 264
      // 264 + 50 + 4 = 318 > 276, so wrap
      expect(child2.bounds.y).toBeGreaterThan(child1.bounds.y)
    })
  })

  describe('adjustChildren', () => {
    it('does nothing when children is empty', () => {
      // Constructor initializes contentHeight to 2 * topBottomSpacing = 4
      // adjustChildren preserves this when no children
      const before = host.contentHeight
      layout.adjustChildren()
      expect(host.contentHeight).toBe(before)
    })

    it('recalculates all child positions', () => {
      const child1 = new MockLayoutWidget(80, 30)
      const child2 = new MockLayoutWidget(80, 30)
      const child3 = new MockLayoutWidget(80, 30)

      host.children.push(child1, child2, child3)
      layout.adjustChild(child1)
      layout.adjustChild(child2)
      layout.adjustChild(child3)

      // Modify child bounds manually
      child1.bounds.x = 999
      child2.bounds.y = 999

      // Recalculate
      layout.adjustChildren()

      // All children should be properly positioned again
      expect(child1.bounds.x).toBe(host.itemSpacing)
      expect(child2.bounds.x).toBeGreaterThan(child1.bounds.x)
      // Child2 should not be at y=999 anymore
      expect(child2.bounds.y).toBeLessThan(900)
    })

    it('recalculates contentHeight', () => {
      const child1 = new MockLayoutWidget(80, 30)
      const child2 = new MockLayoutWidget(80, 30)

      host.children.push(child1, child2)
      layout.adjustChild(child1)
      layout.adjustChild(child2)

      const heightBefore = host.contentHeight

      // Force a bad value
      host.contentHeight = 0

      layout.adjustChildren()

      expect(host.contentHeight).toBe(heightBefore)
    })
  })

  describe('columnCount mode', () => {
    it('uses uniform cell width when columnCount is set', () => {
      const grid = new GridLayout(host, 4)
      const child = new MockLayoutWidget(80, 30)
      host.children.push(child)

      grid.adjustChild(child)

      // With 4 columns, cellWidth = (400 - 4*5) / 4 = (400-20)/4 = 95
      // bounds.width should be set to cellWidth = 95
      // But since child was already 80, and adjustChild sets bounds.width = Math.max(0, cellWidth)
      // In GridLayout with columnCount > 0, it sets w.bounds.width = cellWidth
      // So bounds.width should be the cell width
      const expectedCellWidth =
        (400 - host.itemSpacing * (4 + 1)) / 4
      expect(child.bounds.width).toBe(expectedCellWidth)
    })
  })

  describe('ILayout interface', () => {
    it('implements ILayout interface', () => {
      const grid = new GridLayout(host)
      expect(typeof grid.adjustChild).toBe('function')
      expect(typeof grid.adjustChildren).toBe('function')
    })
  })
})
