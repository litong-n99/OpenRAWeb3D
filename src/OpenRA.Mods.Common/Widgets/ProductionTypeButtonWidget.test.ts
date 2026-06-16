/**
 * ProductionTypeButtonWidget.test.ts — ProductionTypeButtonWidget unit tests
 *
 * Tests focus on: construction, ProductionGroup property, clone/copy,
 * and integration with ButtonWidget base class behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProductionTypeButtonWidget } from './ProductionTypeButtonWidget.js'
import { ButtonWidget } from './ButtonWidget.js'

describe('ProductionTypeButtonWidget', () => {
  let widget: ProductionTypeButtonWidget

  beforeEach(() => {
    widget = new ProductionTypeButtonWidget('Building')
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  it('constructs with ProductionGroup', () => {
    const w = new ProductionTypeButtonWidget('Infantry')
    expect(w.productionGroup).toBe('Infantry')
  })

  it('constructs with empty ProductionGroup by default', () => {
    const w = new ProductionTypeButtonWidget()
    expect(w.productionGroup).toBe('')
  })

  it('extends ButtonWidget', () => {
    expect(widget).toBeInstanceOf(ButtonWidget)
    expect(widget).toBeInstanceOf(ProductionTypeButtonWidget)
  })

  // -----------------------------------------------------------------------
  // ButtonWidget inherited properties
  // -----------------------------------------------------------------------

  it('inherits button text and background', () => {
    widget.text = 'Build'
    widget.background = 'button-building'
    expect(widget.text).toBe('Build')
    expect(widget.background).toBe('button-building')
  })

  it('inherits disabled state', () => {
    widget.disabled = true
    expect(widget.isDisabled()).toBe(true)
    widget.disabled = false
    expect(widget.isDisabled()).toBe(false)
  })

  it('inherits click callback', () => {
    const onClick = vi.fn()
    widget.onClick = onClick

    widget.onMouseUp?.({} as unknown as Parameters<typeof widget.onMouseUp>[0])
    expect(onClick).toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // ProductionGroup property
  // -----------------------------------------------------------------------

  it('productionGroup returns the category', () => {
    const w = new ProductionTypeButtonWidget('Defense')
    expect(w.productionGroup).toBe('Defense')
  })

  it('productionGroup is writable', () => {
    widget.productionGroup = 'Vehicle'
    expect(widget.productionGroup).toBe('Vehicle')
  })

  // -----------------------------------------------------------------------
  // Clone
  // -----------------------------------------------------------------------

  it('clone copies ProductionGroup', () => {
    const w = new ProductionTypeButtonWidget('Aircraft')
    w.text = 'Air Units'
    w.id = 'btn-aircraft'

    const clone = w.clone()
    expect(clone).toBeInstanceOf(ProductionTypeButtonWidget)
    expect(clone.productionGroup).toBe('Aircraft')
    expect(clone.text).toBe('Air Units')
    expect(clone.id).toBe('btn-aircraft')
  })

  it('clone preserves bounds', () => {
    widget.bounds = { x: 10, y: 20, width: 100, height: 30 }
    const clone = widget.clone()
    expect(clone.bounds).toEqual({ x: 10, y: 20, width: 100, height: 30 })
  })

  it('clone copies children', () => {
    const child = new ButtonWidget()
    child.id = 'child-btn'
    widget.addChild(child)

    const clone = widget.clone()
    expect(clone.children.length).toBe(1)
    expect(clone.children[0]!.id).toBe('child-btn')
  })

  // -----------------------------------------------------------------------
  // DOM rendering
  // -----------------------------------------------------------------------

  it('renders as a button DOM element', () => {
    widget.bounds = { x: 0, y: 0, width: 80, height: 30 }
    widget.text = 'Units'

    const el = widget.render()
    expect(el.tagName).toBe('DIV')
    expect(el.className).toContain('button-widget')
  })

  // -----------------------------------------------------------------------
  // Integration with ProductionTabsWidget (conceptual)
  // -----------------------------------------------------------------------

  it('can represent different production groups', () => {
    const buildingBtn = new ProductionTypeButtonWidget('Building')
    const defenseBtn = new ProductionTypeButtonWidget('Defense')
    const infantryBtn = new ProductionTypeButtonWidget('Infantry')

    expect(buildingBtn.productionGroup).toBe('Building')
    expect(defenseBtn.productionGroup).toBe('Defense')
    expect(infantryBtn.productionGroup).toBe('Infantry')

    // All should be independent
    buildingBtn.productionGroup = 'Navy'
    expect(buildingBtn.productionGroup).toBe('Navy')
    expect(defenseBtn.productionGroup).toBe('Defense')
  })
})
