/**
 * HistoryLogLogic.test.ts — HistoryLogLogic 迁移单元测试
 *
 * happy-dom 不支持 WebGL，因此 @babylonjs/core 模块被 mock。
 * 测试关注：事件订阅、item 添加/移除、点击行为、dispose 清理。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  EditorActionStatus,
  EditorActionContainer,
  type EditorActionContainerCallback,
} from '../../../Traits/World/EditorActionManager.js'
import { HistoryLogLogic } from './HistoryLogLogic.js'
import type { IEditorAction } from '../../../Traits/World/EditorActionManager.js'

// ---------------------------------------------------------------------------
// Mock EditorActionManager
// ---------------------------------------------------------------------------

class MockEditorActionManager {
  readonly undoStack: EditorActionContainer[] = [
    new EditorActionContainer(0, {
      text: 'open', execute: () => {}, undo: () => {}, redo: () => {},
    }),
  ]
  readonly redoStack: EditorActionContainer[] = []

  private _itemAdded: EditorActionContainerCallback[] = []
  private _itemRemoved: EditorActionContainerCallback[] = []

  onItemAdded(cb: EditorActionContainerCallback): void { this._itemAdded.push(cb) }
  offItemAdded(cb: EditorActionContainerCallback): void { const i = this._itemAdded.indexOf(cb); if (i >= 0) this._itemAdded.splice(i, 1) }
  onItemRemoved(cb: EditorActionContainerCallback): void { this._itemRemoved.push(cb) }
  offItemRemoved(cb: EditorActionContainerCallback): void { const i = this._itemRemoved.indexOf(cb); if (i >= 0) this._itemRemoved.splice(i, 1) }

  Rewind(_id: number): void {}
  Forward(_id: number): void {}

  get itemAddedCallbacks() { return this._itemAdded }
  get itemRemovedCallbacks() { return this._itemRemoved }

  fireItemAdded(container: EditorActionContainer): void {
    for (const cb of this._itemAdded) cb(container)
  }
  fireItemRemoved(container: EditorActionContainer): void {
    for (const cb of this._itemRemoved) cb(container)
  }
}

// ---------------------------------------------------------------------------
// Mock Widget
// ---------------------------------------------------------------------------

class MockWidget {
  private map = new Map<string, MockWidget>()
  children: MockWidget[] = []
  cloneCount: number = 0
  textColor: number = 0xFFFFFFFF
  textColorDisabled: number = 0x80808080

  get(id: string): MockWidget | null { return this.map.get(id) ?? null }

  addChildWidget(id: string, child: MockWidget): void {
    this.map.set(id, child)
  }

  addChild(child: MockWidget): void {
    this.children.push(child)
  }
  removeChild(child: MockWidget): void {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
  }

  clone(): MockWidget {
    this.cloneCount++
    const c = new MockWidget()
    c.textColor = this.textColor
    c.textColorDisabled = this.textColorDisabled
    // Make clone support get()
    ;(c as any).get = (id: string) => {
      if (id === 'TITLE') {
        const label = new MockWidget()
        ;(label as any).getText = () => ''
        ;(label as any).getColor = () => 0xFFFFFFFF
        return label
      }
      return null
    }
    return c
  }

  getChildren(): MockWidget[] { return [...this.children] }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 100

function createAction(text: string, status: EditorActionStatus): EditorActionContainer {
  const action: IEditorAction = {
    text,
    execute: () => {},
    undo: () => {},
    redo: () => {},
  }
  const container = new EditorActionContainer(nextId++, action)
  container.status = status
  return container
}

function createTestWidget(): MockWidget {
  const widget = new MockWidget()
  const panel = new MockWidget()
  const template = new MockWidget()

  widget.addChildWidget('HISTORY_LIST', panel)
  // Template lives inside panel (real widget tree pattern)
  panel.addChildWidget('HISTORY_TEMPLATE', template)
  ;(template as any).textColor = 0xFFFFFFFF
  ;(template as any).textColorDisabled = 0x80808080

  return widget
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HistoryLogLogic', () => {
  let widget: MockWidget
  let actionManager: MockEditorActionManager

  beforeEach(() => {
    widget = createTestWidget()
    actionManager = new MockEditorActionManager()
  })

  it('subscribes to ItemAdded and ItemRemoved on construction', () => {
    new HistoryLogLogic(widget as any, actionManager as any)

    expect(actionManager.itemAddedCallbacks.length).toBe(1)
    expect(actionManager.itemRemovedCallbacks.length).toBe(1)
  })

  it('unsubscribes from events on dispose', () => {
    const logic = new HistoryLogLogic(widget as any, actionManager as any)
    expect(actionManager.itemAddedCallbacks.length).toBe(1)

    logic.dispose()
    expect(actionManager.itemAddedCallbacks.length).toBe(0)
    expect(actionManager.itemRemovedCallbacks.length).toBe(0)
  })

  it('creates scroll item widget when ItemAdded fires', () => {
    new HistoryLogLogic(widget as any, actionManager as any)

    const container = createAction('Test action', EditorActionStatus.Active)
    actionManager.fireItemAdded(container)

    const panel = widget.get('HISTORY_LIST') as MockWidget
    // Panel should have one child
    expect(panel.children.length).toBe(1)
  })

  it('removes scroll item widget when ItemRemoved fires', () => {
    new HistoryLogLogic(widget as any, actionManager as any)

    const container = createAction('Test action', EditorActionStatus.Active)
    actionManager.fireItemAdded(container)

    const panel = widget.get('HISTORY_LIST') as MockWidget
    expect(panel.children.length).toBe(1)

    actionManager.fireItemRemoved(container)
    expect(panel.children.length).toBe(0)
  })

  it('constructor works', () => {
    const logic = new HistoryLogLogic(widget as any, actionManager as any)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('handles item with Active status', () => {
    new HistoryLogLogic(widget as any, actionManager as any)

    const container = createAction('Active action', EditorActionStatus.Active)
    expect(() => actionManager.fireItemAdded(container)).not.toThrow()
  })

  it('handles item with Future status', () => {
    new HistoryLogLogic(widget as any, actionManager as any)

    const container = createAction('Future action', EditorActionStatus.Future)
    expect(() => actionManager.fireItemAdded(container)).not.toThrow()
  })

  it('handles item with History status', () => {
    new HistoryLogLogic(widget as any, actionManager as any)

    const container = createAction('History action', EditorActionStatus.History)
    expect(() => actionManager.fireItemAdded(container)).not.toThrow()
  })

  it('dispose does not throw when called twice', () => {
    const logic = new HistoryLogLogic(widget as any, actionManager as any)
    logic.dispose()
    expect(() => logic.dispose()).not.toThrow()
  })
})
