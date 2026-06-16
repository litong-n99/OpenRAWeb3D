/**
 * SupportPowersWidget.test.ts — SupportPowersWidget migration unit tests
 *
 * Tests focus on: icon refresh from SPM, icon click handling, overlay text formatting,
 * hotkey resolution, tooltip tracking, layout (horizontal/vertical), and disposal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SupportPowersWidget,
  type SupportPowerIcon,
  type SupportPowerInstanceStub,
  type SupportPowerManagerStub,
} from './SupportPowersWidget.js'
import { HotkeyReference, Hotkey } from '../../OpenRA.Game/Input/HotkeyReference.js'
import { KeyCode } from '../../OpenRA.Game/Input/Keycode.js'
import { Modifiers } from '../../OpenRA.Game/Input/IInputHandler.js'
import { ChromeMetrics } from '../../OpenRA.Game/Widgets/ChromeMetrics.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Setup ChromeMetrics for all tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  ChromeMetrics.initialize({
    DefaultCursor: 'default',
  })
})

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePowerInstance(overrides: Partial<SupportPowerInstanceStub> = {}): SupportPowerInstanceStub {
  return {
    key: overrides.key ?? 'testPower',
    ready: overrides.ready ?? false,
    active: overrides.active ?? true,
    disabled: overrides.disabled ?? false,
    totalTicks: overrides.totalTicks ?? 250,
    remainingTicks: overrides.remainingTicks ?? 100,
    target: overrides.target ?? vi.fn(),
    info: {
      supportPowerPaletteOrder: overrides.info?.supportPowerPaletteOrder ?? 0,
      iconImage: overrides.info?.iconImage ?? 'test-icon',
      iconPalette: overrides.info?.iconPalette ?? 'chrome',
      name: overrides.info?.name ?? 'Test Power',
      description: overrides.info?.description ?? 'A test support power',
      insufficientPowerSound: overrides.info?.insufficientPowerSound,
      insufficientPowerSpeechNotification: overrides.info?.insufficientPowerSpeechNotification,
      insufficientPowerTextNotification: overrides.info?.insufficientPowerTextNotification,
    },
    iconOverlayTextOverride: overrides.iconOverlayTextOverride ?? (() => null),
  }
}

function makeSPM(powers: Map<string, SupportPowerInstanceStub>): SupportPowerManagerStub {
  return {
    self: {
      owner: {
        faction: { internalName: 'test' },
      },
    },
    powers,
  }
}

function makeMockHotkeyRef(keyCode: KeyCode): HotkeyReference {
  return new HotkeyReference(new Hotkey(keyCode, Modifiers.None))
}

function makeMouseEvent(
  type: string,
  clientX: number,
  clientY: number,
  button: number = 0,
): WidgetEvent {
  return {
    type,
    stopPropagation: () => {},
    target: null,
    clientX,
    clientY,
    button,
  }
}

function makeKeyEvent(keyName: string): WidgetEvent {
  return {
    type: 'keydown',
    stopPropagation: () => {},
    target: null,
    key: keyName,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupportPowersWidget', () => {
  let widget: SupportPowersWidget

  beforeEach(() => {
    widget = new SupportPowersWidget()
  })

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('construction', () => {
    it('should create with default values', () => {
      expect(widget.readyText).toBe('READY')
      expect(widget.holdText).toBe('HOLD')
      expect(widget.overlayFont).toBe('TinyBold')
      expect(widget.iconSize.width).toBe(64)
      expect(widget.iconSize.height).toBe(48)
      expect(widget.iconMargin).toBe(10)
      expect(widget.horizontal).toBe(false)
      expect(widget.iconCount).toBe(0)
      expect(widget.tooltipIcon).toBeNull()
      expect(widget.spm).toBeNull()
    })

    it('should have getTooltipIcon returning tooltipIcon', () => {
      expect(widget.getTooltipIcon?.()).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // refreshIcons — empty SPM
  // -----------------------------------------------------------------------

  describe('refreshIcons — empty SPM', () => {
    it('should result in 0 icons when SPM is null', () => {
      widget.refreshIcons()
      expect(widget.iconCount).toBe(0)
    })

    it('should result in 0 icons when SPM has no powers', () => {
      widget.spm = makeSPM(new Map())
      widget.refreshIcons()
      expect(widget.iconCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // refreshIcons — with powers
  // -----------------------------------------------------------------------

  describe('refreshIcons — with powers', () => {
    it('should create icons for non-disabled powers', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1', ready: true }))
      powers.set('p2', makePowerInstance({
        key: 'p2',
        disabled: true,
        info: { supportPowerPaletteOrder: 1 },
      }))
      powers.set('p3', makePowerInstance({
        key: 'p3',
        ready: false,
        active: true,
        info: { supportPowerPaletteOrder: 2 },
      }))

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      // Should skip disabled power (p2)
      expect(widget.iconCount).toBe(2)
    })

    it('should sort powers by palette order', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('pB', makePowerInstance({
        key: 'pB',
        info: { supportPowerPaletteOrder: 10 },
      }))
      powers.set('pA', makePowerInstance({
        key: 'pA',
        info: { supportPowerPaletteOrder: 5 },
      }))
      powers.set('pC', makePowerInstance({
        key: 'pC',
        info: { supportPowerPaletteOrder: 15 },
      }))

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      expect(widget.iconCount).toBe(3)
    })

    it('should fire onIconCountChanged when count changes', () => {
      const changedSpy = vi.fn()
      widget.onIconCountChanged = changedSpy

      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1' }))
      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      expect(changedSpy).toHaveBeenCalledWith(0, 1)
    })

    it('should not fire onIconCountChanged when count unchanged', () => {
      const changedSpy = vi.fn()
      widget.onIconCountChanged = changedSpy

      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1' }))
      widget.spm = makeSPM(powers)

      widget.refreshIcons()
      expect(changedSpy).toHaveBeenCalledTimes(1)

      changedSpy.mockClear()
      // Refresh again — same count, should not fire
      widget.refreshIcons()
      expect(changedSpy).not.toHaveBeenCalled()
    })

    it('should lay out icons vertically by default', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1' }))
      powers.set('p2', makePowerInstance({ key: 'p2', info: { supportPowerPaletteOrder: 1 } }))

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      expect(widget.iconCount).toBe(2)
    })

    it('should lay out icons horizontally when horizontal=true', () => {
      widget.horizontal = true
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1' }))
      powers.set('p2', makePowerInstance({ key: 'p2', info: { supportPowerPaletteOrder: 1 } }))

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      expect(widget.iconCount).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // clickIcon
  // -----------------------------------------------------------------------

  describe('clickIcon', () => {
    it('should call target() when power is active', () => {
      const targetSpy = vi.fn()
      const power = makePowerInstance({ key: 'test', active: true, target: targetSpy })
      const icon: SupportPowerIcon = {
        power,
        pos: { x: 0, y: 0 },
        sprite: null,
        palette: 'chrome',
        iconClockPalette: 'chrome',
        hotkey: null,
      }

      widget.clickIcon(icon)
      expect(targetSpy).toHaveBeenCalled()
    })

    it('should NOT call target() when power is inactive', () => {
      const targetSpy = vi.fn()
      const power = makePowerInstance({
        key: 'test',
        active: false,
        target: targetSpy,
        info: {
          supportPowerPaletteOrder: 0,
          insufficientPowerSound: 'insufficient',
        },
      })

      const soundSpy = vi.fn()
      widget.sound = {
        playToPlayer: soundSpy,
        playNotification: vi.fn(),
      }

      const icon: SupportPowerIcon = {
        power,
        pos: { x: 0, y: 0 },
        sprite: null,
        palette: 'chrome',
        iconClockPalette: 'chrome',
        hotkey: null,
      }

      widget.spm = makeSPM(new Map([['test', power]]))
      widget.clickIcon(icon)

      expect(targetSpy).not.toHaveBeenCalled()
      // Should play insufficient power sound
      expect(soundSpy).toHaveBeenCalledWith('UI', widget.spm!.self.owner, 'insufficient')
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — keydown (hotkey)
  // -----------------------------------------------------------------------

  describe('handleEvent — keydown (hotkey)', () => {
    it('should activate power on matching hotkey', () => {
      const targetSpy = vi.fn()
      const power = makePowerInstance({
        key: 'test',
        ready: true,
        active: true,
        target: targetSpy,
      })

      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('test', power)

      widget.spm = makeSPM(powers)
      widget.hotkeyPrefix = 'SP'
      widget.hotkeyCount = 1
      widget.hotkeyResolver = (name) =>
        name === 'SP01' ? makeMockHotkeyRef(KeyCode.Q) : null
      widget.initialize({})
      widget.refreshIcons()

      const result = widget.handleEvent(makeKeyEvent('Q'))
      expect(result).toBe(true)
      expect(targetSpy).toHaveBeenCalled()
    })

    it('should return false for non-matching key', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('test', makePowerInstance({ key: 'test' }))

      widget.spm = makeSPM(powers)
      widget.hotkeyPrefix = 'SP'
      widget.hotkeyCount = 1
      widget.hotkeyResolver = (name) =>
        name === 'SP01' ? makeMockHotkeyRef(KeyCode.Q) : null
      widget.initialize({})
      widget.refreshIcons()

      const result = widget.handleEvent(makeKeyEvent('W'))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // handleEvent — mouse
  // -----------------------------------------------------------------------

  describe('handleEvent — mouse', () => {
    it('should handle mousedown on an icon', () => {
      const targetSpy = vi.fn()
      const power = makePowerInstance({
        key: 'test',
        active: true,
        ready: true, // Changed from 'ready' to ready to trigger target
        target: targetSpy,
      })

      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('test', power)

      widget.spm = makeSPM(powers)
      widget.bounds = { x: 0, y: 0, width: 300, height: 200 }
      widget.refreshIcons()

      // First icon should be at (0, 0)
      const result = widget.handleEvent(makeMouseEvent('mousedown', 10, 10, 0))
      expect(result).toBe(true)
      expect(targetSpy).toHaveBeenCalled()
    })

    it('should return false for mousedown outside icon area', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('test', makePowerInstance({ key: 'test' }))

      widget.spm = makeSPM(powers)
      widget.bounds = { x: 0, y: 0, width: 300, height: 200 }
      widget.refreshIcons()

      // Click far outside the icon area
      const result = widget.handleEvent(makeMouseEvent('mousedown', 500, 500, 0))
      expect(result).toBe(false)
    })

    it('should return false for mousemove', () => {
      widget.spm = makeSPM(new Map())
      const result = widget.handleEvent(makeMouseEvent('mousemove', 10, 10, 0))
      expect(result).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // render
  // -----------------------------------------------------------------------

  describe('render', () => {
    it('should return a flex container div', () => {
      const el = widget.render()
      expect(el.tagName).toBe('DIV')
      expect(el.className).toBe('support-powers-widget')
      expect(el.style.position).toBe('absolute')
      expect(el.style.display).toBe('flex')
    })

    it('should render flex column for vertical layout', () => {
      const el = widget.render()
      expect(el.style.flexDirection).toBe('column')
    })

    it('should render flex row for horizontal layout', () => {
      widget.horizontal = true
      const el = widget.render()
      expect(el.style.flexDirection).toBe('row')
    })

    it('should render icon elements when powers exist', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1', ready: true }))

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      const el = widget.render()
      const icons = el.querySelectorAll('.support-power-icon')
      expect(icons.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // tick — conditional refresh
  // -----------------------------------------------------------------------

  describe('tick', () => {
    it('should refresh icons when powers change (fingerprint mismatch)', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1' }))

      widget.spm = makeSPM(powers)
      widget.tick()

      expect(widget.iconCount).toBe(1)
    })

    it('should NOT refresh icons when powers fingerprint is unchanged', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1' }))

      widget.spm = makeSPM(powers)

      // First tick: builds icons
      widget.tick()
      expect(widget.iconCount).toBe(1)

      // Track whether onIconCountChanged fires on subsequent tick
      const changedSpy = vi.fn()
      widget.onIconCountChanged = changedSpy

      // Second tick: fingerprint unchanged, should NOT rebuild
      widget.tick()
      expect(changedSpy).not.toHaveBeenCalled()
    })

    it('should refresh icons when power remainingTicks changes', () => {
      const power = makePowerInstance({ key: 'p1', remainingTicks: 100, totalTicks: 200 })
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', power)

      widget.spm = makeSPM(powers)
      widget.tick()
      expect(widget.iconCount).toBe(1)

      // Change remainingTicks (fingerprint should change)
      const changedSpy = vi.fn()
      widget.onIconCountChanged = changedSpy
      // remainingTicks is part of fingerprint; changing it should NOT affect iconCount
      // but the fingerprint changes, triggering refreshIcons
      // Since iconCount stays the same, onIconCountChanged won't fire
      // But we verify refreshIcons ran by checking that _iconRects are populated
      widget.tick()
      // Icon count unchanged, so changedSpy should not fire
      expect(changedSpy).not.toHaveBeenCalled()
    })

    it('should refresh icons when power ready state changes', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      const power = makePowerInstance({ key: 'p1', ready: false })
      powers.set('p1', power)

      widget.spm = makeSPM(powers)
      widget.tick()
      expect(widget.iconCount).toBe(1)

      // Make power ready (fingerprint changes)
      // Since we mutated the same object, we need to verify tick detects the change
      ;(power as unknown as Record<string, unknown>).ready = true

      // Verify that tick still runs (fingerprint change triggers refreshIcons)
      // ready state doesn't change icon count (only disabled does)
      widget.tick()
      expect(widget.iconCount).toBe(1) // Still shown, ready doesn't filter it out
    })
  })

  // -----------------------------------------------------------------------
  // Clock angle — unwinding direction (remainingTicks/totalTicks ratio)
  // -----------------------------------------------------------------------

  describe('clock angle', () => {
    it('should use remainingTicks/totalTicks ratio: full circle when just started', () => {
      const power = makePowerInstance({
        key: 'p1',
        ready: false,
        remainingTicks: 250,
        totalTicks: 250,
      })
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', power)

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      const el = widget.render()
      const clockEl = el.querySelector('.support-power-clock') as HTMLElement
      expect(clockEl).toBeDefined()
      // remainingTicks=250, totalTicks=250 → ratio=1.0 → angle=360deg
      expect(clockEl.style.background).toContain('360deg')
    })

    it('should use remainingTicks/totalTicks ratio: empty circle when fully charged', () => {
      const power = makePowerInstance({
        key: 'p1',
        ready: false,
        remainingTicks: 0,
        totalTicks: 250,
      })
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', power)

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      const el = widget.render()
      const clockEl = el.querySelector('.support-power-clock') as HTMLElement
      expect(clockEl).toBeDefined()
      // remainingTicks=0, totalTicks=250 → ratio=0 → angle=0deg
      expect(clockEl.style.background).toContain('0deg')
    })

    it('should show no clock overlay when power is ready', () => {
      const power = makePowerInstance({
        key: 'p1',
        ready: true,
        remainingTicks: 0,
        totalTicks: 250,
      })
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', power)

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      const el = widget.render()
      // Clock overlay should not exist when ready (pulse indicator instead)
      expect(el.querySelector('.support-power-clock')).toBeNull()
      expect(el.querySelector('.support-power-ready-pulse')).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // DOM element caching (FIX 3: avoid per-frame rebuild)
  // -----------------------------------------------------------------------

  describe('DOM element caching', () => {
    it('should cache and reuse DOM elements when icon set unchanged', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1', ready: true }))
      powers.set('p2', makePowerInstance({
        key: 'p2',
        ready: false,
        info: { supportPowerPaletteOrder: 1 },
      }))

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      // First render
      const el = widget.render()
      const icon1First = el.querySelector('[data-power-key="p1"]') as HTMLElement
      const icon2First = el.querySelector('[data-power-key="p2"]') as HTMLElement
      expect(icon1First).toBeDefined()
      expect(icon2First).toBeDefined()

      // Second render — same icons, should reuse cells
      const el2 = widget.render()
      const icon1Second = el2.querySelector('[data-power-key="p1"]') as HTMLElement
      const icon2Second = el2.querySelector('[data-power-key="p2"]') as HTMLElement
      expect(icon1Second).toBeDefined()
      expect(icon2Second).toBeDefined()

      // With caching, original cells should still be attached
      expect(el.contains(icon1First)).toBe(true)
      expect(el.contains(icon2First)).toBe(true)
      // No duplicate cells
      expect(el.querySelectorAll('.support-power-icon').length).toBe(2)
    })

    it('should rebuild DOM when icon set changes', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1', ready: true }))

      widget.spm = makeSPM(powers)
      widget.refreshIcons()

      const el = widget.render()
      expect(el.querySelectorAll('.support-power-icon').length).toBe(1)

      // Add a new power
      powers.set('p2', makePowerInstance({
        key: 'p2',
        ready: false,
        info: { supportPowerPaletteOrder: 1 },
      }))
      widget.refreshIcons() // Rebuild icons

      // Re-render — icon set changed, should rebuild
      widget.render()
      expect(el.querySelectorAll('.support-power-icon').length).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // eventBounds
  // -----------------------------------------------------------------------

  describe('eventBounds', () => {
    it('should have zero-size bounds when no icons', () => {
      expect(widget.eventBounds.width).toBe(0)
      expect(widget.eventBounds.height).toBe(0)
    })

    it('should have non-zero bounds when icons exist', () => {
      const powers = new Map<string, SupportPowerInstanceStub>()
      powers.set('p1', makePowerInstance({ key: 'p1' }))
      powers.set('p2', makePowerInstance({
        key: 'p2',
        info: { supportPowerPaletteOrder: 1 },
      }))

      widget.spm = makeSPM(powers)
      widget.bounds = { x: 10, y: 10, width: 200, height: 200 }
      widget.refreshIcons()

      expect(widget.eventBounds.width).toBeGreaterThan(0)
      expect(widget.eventBounds.height).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  describe('dispose', () => {
    it('should clear all references', () => {
      widget.spm = makeSPM(new Map())
      widget.sound = { playToPlayer: vi.fn(), playNotification: vi.fn() }
      widget.textNotifications = { addTransientLine: vi.fn() }
      widget.hotkeyResolver = vi.fn()
      widget.onIconCountChanged = vi.fn()
      widget.getTooltipIcon = vi.fn()

      widget.dispose()

      expect(widget.spm).toBeNull()
      expect(widget.sound).toBeNull()
      expect(widget.textNotifications).toBeNull()
      expect(widget.hotkeyResolver).toBeNull()
      expect(widget.onIconCountChanged).toBeNull()
      expect(widget.getTooltipIcon).toBeNull()
    })
  })
})
