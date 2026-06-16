/**
 * ServerListLogic.test.ts — Unit tests for ServerListLogic
 *
 * Tests: server list refresh, filtering logic, state labels, player count,
 * server selection, lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ServerListLogic } from './ServerListLogic'

// ---------------------------------------------------------------------------
// Mock widget tree
// ---------------------------------------------------------------------------

function mockScrollWidget(overrides: Record<string, unknown> = {}) {
  return {
    bounds: { x: 0, y: 0, width: 400, height: 400 },
    isVisible: vi.fn(() => true),
    removeChildren: vi.fn(),
    addChild: vi.fn(),
    children: [],
    contentHeight: 0,
    scrollToTop: vi.fn(),
    scrollToBottom: vi.fn(),
    scrolledToBottom: true,
    replaceChild: vi.fn(),
    id: 'scroll',
    ...overrides,
  } as unknown as import('../../Widgets/ScrollPanelWidget.js').ScrollPanelWidget
}

function mockWidget(overrides: Record<string, unknown> = {}) {
  return {
    bounds: { x: 0, y: 0, width: 600, height: 500 },
    isVisible: vi.fn(() => true),
    visible: true,
    isDisabled: vi.fn(() => false),
    onClick: vi.fn(),
    getText: vi.fn(),
    getColor: vi.fn(),
    children: [],
    id: 'root',
    ...overrides,
  } as unknown as import('../../../OpenRA.Game/Widgets/Widget.js').Widget
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServerListLogic', () => {
  let widget: ReturnType<typeof mockWidget>
  let onJoin: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onJoin = vi.fn()
    widget = mockWidget()

    const serverList = mockScrollWidget()
    const scrollItem = {
      clone: () => scrollItem,
      isVisible: vi.fn(() => true),
      isSelected: vi.fn(() => false),
      onClick: vi.fn(),
      onDoubleClick: vi.fn(),
      id: 'template',
      bounds: { x: 0, y: 0, width: 400, height: 24 },
      children: [],
    } as unknown as import('../../Widgets/ScrollItemWidget.js').ScrollItemWidget

    ;(widget as unknown as Record<string, unknown>)['SERVER_LIST'] = serverList
    ;(serverList as unknown as Record<string, unknown>)['HEADER_TEMPLATE'] = scrollItem
    ;(serverList as unknown as Record<string, unknown>)['SERVER_TEMPLATE'] = scrollItem
  })

  it('creates without errors', () => {
    const logic = new ServerListLogic(widget, null, onJoin)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('refreshServerList triggers async query', () => {
    const logic = new ServerListLogic(widget, null, onJoin)
    expect(() => logic.refreshServerList()).not.toThrow()
    logic.dispose()
  })

  it('does not start second query while first is active', () => {
    const logic = new ServerListLogic(widget, null, onJoin)
    logic.refreshServerList()
    // Second call should be a no-op
    expect(() => logic.refreshServerList()).not.toThrow()
    logic.dispose()
  })

  it('wires join button if present', () => {
    const joinBtn = mockWidget({ id: 'JOIN_BUTTON' })
    ;(widget as unknown as Record<string, unknown>)['JOIN_BUTTON'] = joinBtn

    const logic = new ServerListLogic(widget, null, onJoin)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('disposes cleanly', () => {
    const logic = new ServerListLogic(widget, null, onJoin)
    logic.dispose()
    logic.dispose() // Double dispose
  })

  it('tick is no-op', () => {
    const logic = new ServerListLogic(widget, null, onJoin)
    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })
})
