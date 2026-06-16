/**
 * CreditsLogic.test.ts — CreditsLogic 单元测试
 *
 * 测试范围: 文本解析、tab 切换、返回按钮、构造/销毁生命周期。
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { CreditsLogic, type ICreditsData } from './CreditsLogic.js'
import type { Widget } from '../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

class MockWidget {
  id: string
  children: Map<string, MockWidget> = new Map()
  parentVal: MockWidget | null = null
  isVisibleFn: (() => boolean) | null = null
  isHighlightedFn: (() => boolean) | null = null
  onClickFn: () => void = () => {}
  getTextFn: (() => string) | null = null

  constructor(id: string) { this.id = id }

  get parent() { return this.parentVal }
  addChild(child: MockWidget) { child.parentVal = this; this.children.set(child.id, child) }

  getOrNull<T>(id: string): T | null {
    if (this.id === id) return this as unknown as T
    for (const [, c] of this.children) {
      const found = c.getOrNull<T>(id)
      if (found) return found
    }
    return null
  }

  get<T>(id: string): T {
    const t = this.getOrNull<T>(id)
    if (!t) throw new Error(`Widget ${this.id} has no child ${id}`)
    return t
  }

  // Property delegates for widget binding
  set isVisible(fn: () => boolean) { this.isVisibleFn = fn }
  set isHighlighted(fn: () => boolean) { this.isHighlightedFn = fn }
  set onClick(fn: () => void) { this.onClickFn = fn }
  get onClick() { return this.onClickFn }
  set getText(fn: () => string) { this.getTextFn = fn }
}

function buildCreditsWidget(showBothTabs: boolean): MockWidget {
  const widget = new MockWidget('root')
  const panel = new MockWidget('CREDITS_PANEL')

  panel.children.set('BACK_BUTTON', new MockWidget('BACK_BUTTON'))

  const tabContainer = new MockWidget('TAB_CONTAINER')
  if (showBothTabs) {
    tabContainer.children.set('MOD_TAB', new MockWidget('MOD_TAB'))
    tabContainer.children.set('ENGINE_TAB', new MockWidget('ENGINE_TAB'))
  }
  panel.children.set('TAB_CONTAINER', tabContainer)

  panel.children.set('CREDITS_DISPLAY', new MockWidget('CREDITS_DISPLAY'))
  widget.children.set('CREDITS_PANEL', panel)

  return widget
}

function createSingleTabCreditsData(): ICreditsData {
  return {
    modCreditsText: 'Lead Developer: Test\nAssistant: Helper',
    engineCreditsText: null,
    modTabTitle: 'Mod Credits',
  }
}

function createBothTabsCreditsData(): ICreditsData {
  return {
    modCreditsText: 'Lead Developer: Test\nAssistant: Helper',
    engineCreditsText: 'Engine by OpenRA Team\nPhysics: Custom',
    modTabTitle: 'Mod Credits',
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CreditsLogic', () => {
  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('constructs with single tab (mod only)', () => {
    const widget = buildCreditsWidget(false)
    const data = createSingleTabCreditsData()
    const onExit = vi.fn()

    const logic = new CreditsLogic(widget as unknown as Widget, null, onExit, data)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('constructs with both tabs', () => {
    const widget = buildCreditsWidget(true)
    const data = createBothTabsCreditsData()
    const onExit = vi.fn()

    const logic = new CreditsLogic(widget as unknown as Widget, null, onExit, data)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  it('constructs with neither tab (empty credits)', () => {
    const widget = buildCreditsWidget(false)
    const data: ICreditsData = {
      modCreditsText: null,
      engineCreditsText: null,
      modTabTitle: 'Credits',
    }
    const onExit = vi.fn()

    const logic = new CreditsLogic(widget as unknown as Widget, null, onExit, data)
    expect(logic).toBeDefined()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // BACK_BUTTON
  // ---------------------------------------------------------------------------

  it('BACK_BUTTON calls onExit', () => {
    const widget = buildCreditsWidget(false)
    const data = createSingleTabCreditsData()
    const onExit = vi.fn()

    const logic = new CreditsLogic(widget as unknown as Widget, null, onExit, data)

    const backBtn = widget.get<MockWidget>('CREDITS_PANEL').children.get('BACK_BUTTON')
    expect(backBtn?.onClickFn).toBeDefined()
    backBtn?.onClickFn?.()

    expect(onExit).toHaveBeenCalled()
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // creditsText
  // ---------------------------------------------------------------------------

  it('creditsText returns mod text by default', () => {
    const widget = buildCreditsWidget(false)
    const data = createSingleTabCreditsData()
    const logic = new CreditsLogic(widget as unknown as Widget, null, () => {}, data)

    const text = logic.creditsText
    expect(text).toContain('Lead Developer')
    // The raw input has '*' which gets converted to '•' via parseCreditsText
    // But our test data doesn't have '*', so we just verify the content exists
    expect(text.length).toBeGreaterThan(0)
    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // Tab buttons
  // ---------------------------------------------------------------------------

  it('MOD_TAB and ENGINE_TAB buttons switch active tab', () => {
    const widget = buildCreditsWidget(true)
    const data = createBothTabsCreditsData()
    const logic = new CreditsLogic(widget as unknown as Widget, null, () => {}, data)

    const tabContainer = widget.get<MockWidget>('CREDITS_PANEL').children.get('TAB_CONTAINER')

    const modTab = tabContainer?.children.get('MOD_TAB')
    const engineTab = tabContainer?.children.get('ENGINE_TAB')

    expect(modTab?.onClickFn).toBeDefined()
    expect(engineTab?.onClickFn).toBeDefined()

    // Click engine tab
    engineTab?.onClickFn?.()
    expect(logic.creditsText).toContain('OpenRA Team')

    // Click mod tab
    modTab?.onClickFn?.()
    expect(logic.creditsText).toContain('Lead Developer')

    logic.dispose()
  })

  // ---------------------------------------------------------------------------
  // parseCreditsText
  // ---------------------------------------------------------------------------

  it('parseCreditsText converts CRLF to LF', () => {
    const result = CreditsLogic.parseCreditsText('Line1\r\nLine2')
    expect(result).toBe('Line1\nLine2')
  })

  it('parseCreditsText converts tabs to spaces', () => {
    const result = CreditsLogic.parseCreditsText('Col1\tCol2')
    expect(result).toBe('Col1    Col2')
  })

  it('parseCreditsText converts asterisks to bullets', () => {
    const result = CreditsLogic.parseCreditsText('* Developer')
    expect(result).toBe('• Developer')
  })

  it('parseCreditsText handles empty string', () => {
    const result = CreditsLogic.parseCreditsText('')
    expect(result).toBe('')
  })

  it('parseCreditsText handles all replacements together', () => {
    const result = CreditsLogic.parseCreditsText('* Lead\r\n\tAssistant\r\n* Tester')
    expect(result).toBe('• Lead\n    Assistant\n• Tester')
  })

  // ---------------------------------------------------------------------------
  // ChromeLogic interface
  // ---------------------------------------------------------------------------

  it('tick does not throw', () => {
    const widget = buildCreditsWidget(false)
    const data = createSingleTabCreditsData()
    const logic = new CreditsLogic(widget as unknown as Widget, null, () => {}, data)

    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })

  it('dispose does not throw', () => {
    const widget = buildCreditsWidget(false)
    const data = createSingleTabCreditsData()
    const logic = new CreditsLogic(widget as unknown as Widget, null, () => {}, data)

    expect(() => logic.dispose()).not.toThrow()
  })

  // ---------------------------------------------------------------------------
  // ICreditsData type
  // ---------------------------------------------------------------------------

  it('ICreditsData can be implemented', () => {
    const data: ICreditsData = {
      modCreditsText: 'Test',
      engineCreditsText: null,
      modTabTitle: 'Credits',
    }
    expect(data.modTabTitle).toBe('Credits')
    expect(data.engineCreditsText).toBeNull()
  })
})
