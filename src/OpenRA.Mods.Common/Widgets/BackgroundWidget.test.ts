/**
 * BackgroundWidget.test.ts -- BackgroundWidget migration unit tests
 *
 * Tests focus on:
 * - Construction and default values
 * - Clone copy constructor
 * - ClickThrough event handling
 * - DOM rendering (CSS border-image for 9-slice panels)
 * - Background collection name rendering
 * - data-background attribute for CSS styling
 */

import { describe, it, expect, vi } from 'vitest'
import { BackgroundWidget } from './BackgroundWidget.js'

// ---------------------------------------------------------------------------
// Mock ChromeProvider
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Graphics/ChromeProvider.js', () => ({
  ChromeProvider: {
    getImage: vi.fn((collection: string) => {
      if (collection === 'dialog') return '/assets/dialog.png'
      if (collection === 'panel') return '/assets/panel.png'
      if (collection === 'button') return '/assets/button.png'
      return ''
    }),
    getPanelSliceCss: vi.fn((collection: string) => {
      if (collection === 'dialog') return '10 10 10 10 fill'
      if (collection === 'panel') return '8 8 8 8 fill'
      return null
    }),
  },
}))

// ---------------------------------------------------------------------------
// Tests: Construction
// ---------------------------------------------------------------------------

describe('BackgroundWidget -- construction', () => {
  it('creates with default values', () => {
    const w = new BackgroundWidget()
    expect(w.background).toBe('dialog')
    expect(w.clickThrough).toBe(false)
  })

  it('can be constructed with custom background name', () => {
    const w = new BackgroundWidget()
    w.background = 'panel'
    expect(w.background).toBe('panel')
  })
})

// ---------------------------------------------------------------------------
// Tests: ClickThrough handling
// ---------------------------------------------------------------------------

describe('BackgroundWidget -- ClickThrough', () => {
  it('returns false from handleEvent when ClickThrough is true', () => {
    const w = new BackgroundWidget()
    w.clickThrough = true
    w.bounds = { x: 10, y: 10, width: 200, height: 200 }
    const event = {
      type: 'mousedown',
      clientX: 100,
      clientY: 100,
      button: 0,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(false)
  })

  it('returns true when ClickThrough is false and click is inside bounds', () => {
    const w = new BackgroundWidget()
    w.clickThrough = false
    w.bounds = { x: 10, y: 10, width: 200, height: 200 }
    const event = {
      type: 'mousedown',
      clientX: 100,
      clientY: 100,
      button: 0,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(true)
  })

  it('returns false when ClickThrough is false but click is outside bounds', () => {
    const w = new BackgroundWidget()
    w.clickThrough = false
    w.bounds = { x: 10, y: 10, width: 200, height: 200 }
    const event = {
      type: 'mousedown',
      clientX: 300,
      clientY: 300,
      button: 0,
      stopPropagation: () => {},
      target: null,
    }
    expect(w.handleEvent(event)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: Clone
// ---------------------------------------------------------------------------

describe('BackgroundWidget -- Clone', () => {
  it('creates a deep copy with independent properties', () => {
    const w = new BackgroundWidget()
    w.id = 'bg1'
    w.background = 'panel'
    w.clickThrough = true
    w.bounds = { x: 0, y: 0, width: 800, height: 600 }

    const cloned = w.clone()
    expect(cloned).toBeInstanceOf(BackgroundWidget)
    expect(cloned.id).toBe('bg1')
    expect(cloned.background).toBe('panel')
    expect(cloned.clickThrough).toBe(true)
    expect(cloned.bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 })

    // Independence
    cloned.background = 'dialog'
    expect(w.background).toBe('panel')
    expect(cloned.background).toBe('dialog')
  })

  it('clones with child widgets', () => {
    const parent = new BackgroundWidget()
    const child = new BackgroundWidget()
    child.id = 'child-bg'
    parent.addChild(child)

    const cloned = parent.clone()
    expect(cloned.children.length).toBe(1)
    expect(cloned.children[0].id).toBe('child-bg')
    expect(cloned.children[0]).toBeInstanceOf(BackgroundWidget)
  })
})

// ---------------------------------------------------------------------------
// Tests: DOM rendering
// ---------------------------------------------------------------------------

describe('BackgroundWidget -- DOM rendering', () => {
  it('renders as a div with background-widget class', () => {
    const w = new BackgroundWidget()
    w.bounds = { x: 0, y: 0, width: 400, height: 300 }
    const el = w.render()
    expect(el.tagName.toLowerCase()).toBe('div')
    expect(el.className).toContain('background-widget')
  })

  it('sets pointer-events: none when ClickThrough is true', () => {
    const w = new BackgroundWidget()
    w.clickThrough = true
    w.bounds = { x: 0, y: 0, width: 400, height: 300 }
    const el = w.render()
    expect(el.style.pointerEvents).toBe('none')
  })

  it('sets pointer-events: auto when ClickThrough is false', () => {
    const w = new BackgroundWidget()
    w.clickThrough = false
    w.bounds = { x: 0, y: 0, width: 400, height: 300 }
    const el = w.render()
    expect(el.style.pointerEvents).toBe('auto')
  })

  it('sets data-background attribute with background name', () => {
    const w = new BackgroundWidget()
    w.background = 'dialog'
    w.bounds = { x: 0, y: 0, width: 400, height: 300 }
    const el = w.render()
    expect(el.getAttribute('data-background')).toBe('dialog')
  })

  it('sets data-widget-id when id is provided', () => {
    const w = new BackgroundWidget()
    w.id = 'main-panel-bg'
    w.bounds = { x: 0, y: 0, width: 400, height: 300 }
    const el = w.render()
    expect(el.getAttribute('data-widget-id')).toBe('main-panel-bg')
  })

  it('applies CSS border-image for 9-slice panel', () => {
    const w = new BackgroundWidget()
    w.background = 'dialog'
    w.bounds = { x: 0, y: 0, width: 400, height: 300 }
    const el = w.render()

    // border-image properties should be set
    expect(el.style.borderImageSource).toContain('dialog.png')
    expect(el.style.borderImageRepeat).toBe('stretch')
  })

  it('falls back to simple background-image when no PanelRegion', () => {
    const w = new BackgroundWidget()
    w.background = 'button'
    w.bounds = { x: 0, y: 0, width: 200, height: 50 }
    const el = w.render()

    // Should use simple background-image (no 9-slice)
    expect(el.style.backgroundImage).toContain('button.png')
    expect(el.style.backgroundSize).toBe('100% 100%')
  })

  it('clears background when collection name is empty', () => {
    const w = new BackgroundWidget()
    w.background = ''
    w.bounds = { x: 0, y: 0, width: 400, height: 300 }
    const el = w.render()
    // No CSS background/border-image should be set
    expect(el.style.backgroundImage).toBe('')
    expect(el.style.borderImageSource).toBe('')
  })

  it('returns null cursor from getCursor', () => {
    const w = new BackgroundWidget()
    expect(w.getCursor({ x: 0, y: 0 })).toBeNull()
  })
})
