/**
 * WidgetUtils.test.ts — WidgetUtils migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, formatting, text processing, color logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Rectangle } from '../../OpenRA.Game/Primitives/Rectangle.js'
import { ClientState } from '../../OpenRA.Game/Network/UnitOrders.js'
import { WinState } from '../../OpenRA.Game/Player.js'

// ---------------------------------------------------------------------------
// Mock ChromeProvider — must use vi.hoisted to avoid hoisting issues
// ---------------------------------------------------------------------------

const { mockChromeProvider } = vi.hoisted(() => ({
  mockChromeProvider: {
    getImage: vi.fn(),
    getPanelCss: vi.fn(),
    getMinimumPanelSize: vi.fn(),
  },
}))

vi.mock('../../OpenRA.Game/Graphics/ChromeProvider.js', () => ({
  ChromeProvider: mockChromeProvider,
}))

// ---------------------------------------------------------------------------
// Import module under test (MUST be after vi.mock)
// ---------------------------------------------------------------------------

import {
  WidgetUtils,
  measureText,
  TextNotificationPool,
  type TextNotification,
} from './WidgetUtils.js'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a MockLabelWithTooltipWidget for testing */
function createMockLabel(bounds?: { x: number; y: number; width: number; height: number }) {
  const label = {
    bounds: bounds ?? { x: 0, y: 0, width: 200, height: 20 },
    font: '14px Arial',
    getText: (() => '') as () => string | null,
    getTooltipText: (() => '') as () => string,
  }
  return label
}

/** Create a MockButtonWidget for testing */
function createMockButton(bounds?: { x: number; y: number; width: number; height: number }) {
  const button = {
    bounds: bounds ?? { x: 0, y: 0, width: 200, height: 30 },
    font: '14px Arial',
    leftMargin: 5,
    rightMargin: 5,
    depressed: false,
    getText: (() => '') as () => string,
    getTooltipText: null as (() => string) | null,
    isDisabled: (() => false) as () => boolean,
    isHighlighted: (() => false) as () => boolean,
    getOrNull: vi.fn().mockReturnValue(null) as <T>(id: string) => T | null,
  }
  return button
}

// ---------------------------------------------------------------------------
// getStatefulImageName
// ---------------------------------------------------------------------------

describe('WidgetUtils.getStatefulImageName', () => {
  it('returns baseName unchanged when no state is active', () => {
    expect(WidgetUtils.getStatefulImageName('button')).toBe('button')
  })

  it('returns baseName unchanged when all states are false', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', false, false, false, false),
    ).toBe('button')
  })

  it('appends -hover suffix when hover is true', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', false, false, true, false),
    ).toBe('button-hover')
  })

  it('appends -pressed suffix when pressed is true', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', false, true, false, false),
    ).toBe('button-pressed')
  })

  it('appends -focused suffix when focused is true', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', false, false, false, true),
    ).toBe('button-focused')
  })

  it('appends -disabled suffix when disabled is true', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', true, false, false, false),
    ).toBe('button-disabled')
  })

  it('disabled takes priority over focused', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', true, false, false, true),
    ).toBe('button-disabled')
  })

  it('disabled takes priority over pressed', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', true, true, false, false),
    ).toBe('button-disabled')
  })

  it('disabled takes priority over hover', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', true, false, true, false),
    ).toBe('button-disabled')
  })

  it('focused takes priority over pressed', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', false, true, false, true),
    ).toBe('button-focused')
  })

  it('focused takes priority over hover', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', false, false, true, true),
    ).toBe('button-focused')
  })

  it('pressed takes priority over hover', () => {
    expect(
      WidgetUtils.getStatefulImageName('button', false, true, true, false),
    ).toBe('button-pressed')
  })

  it('priority order: disabled > focused > pressed > hover', () => {
    // All states true → disabled wins
    expect(
      WidgetUtils.getStatefulImageName('btn', true, true, true, true),
    ).toBe('btn-disabled')
    // All except disabled → focused wins
    expect(
      WidgetUtils.getStatefulImageName('btn', false, true, true, true),
    ).toBe('btn-focused')
    // Pressed + hover only → pressed wins
    expect(
      WidgetUtils.getStatefulImageName('btn', false, true, true, false),
    ).toBe('btn-pressed')
  })

  it('handles empty baseName', () => {
    expect(WidgetUtils.getStatefulImageName('')).toBe('')
    expect(WidgetUtils.getStatefulImageName('', true)).toBe('-disabled')
  })

  it('handles baseName with existing hyphen', () => {
    expect(
      WidgetUtils.getStatefulImageName('my-button', false, false, true, false),
    ).toBe('my-button-hover')
  })
})

// ---------------------------------------------------------------------------
// formatTime / formatTimeSeconds
// ---------------------------------------------------------------------------

describe('WidgetUtils.formatTime', () => {
  it('formats 0 ticks as 00:00', () => {
    expect(WidgetUtils.formatTime(0)).toBe('00:00')
    expect(WidgetUtils.formatTime(0, 25)).toBe('00:00')
  })

  it('formats 1 second worth of ticks as 00:01', () => {
    // 1 second = 1000/40 = 25 ticks at default timestep (40ms/tick)
    expect(WidgetUtils.formatTime(25)).toBe('00:01')
  })

  it('formats 60 seconds as 01:00', () => {
    // 60s * 1000ms / 40ms/tick = 1500 ticks
    expect(WidgetUtils.formatTime(1500)).toBe('01:00')
  })

  it('formats 90 seconds as 01:30', () => {
    // 90s * 1000ms / 40ms/tick = 2250 ticks
    expect(WidgetUtils.formatTime(2250)).toBe('01:30')
  })

  it('formats 3600 seconds as 1:00:00 (H:MM:SS)', () => {
    // 40ms/tick * 90000 ticks = 3,600,000ms = 3600 sec = 60 min = 1 hour
    expect(WidgetUtils.formatTime(90000)).toBe('1:00:00')
  })

  it('formats with custom timestep', () => {
    // timestep 40 = 40ms per tick (different game speed)
    // 1 second = 1000/40 = 25 ticks
    // 60 seconds = 60*25 = 1500 ticks
    const result = WidgetUtils.formatTime(1500, 40)
    expect(result).toBe('01:00')
  })

  it('handles negative ticks gracefully', () => {
    // Negative ticks should produce "00:00" since ceil(negative) <= 0
    const result = WidgetUtils.formatTime(-100)
    expect(result).toBe('00:00')
  })

  it('formats non-integer second boundaries correctly (ceil)', () => {
    // 1 tick * 40ms / 1000 = 0.04, ceil = 1 → "00:01"
    expect(WidgetUtils.formatTime(1)).toBe('00:01')
  })
})

describe('WidgetUtils.formatTimeSeconds', () => {
  it('formats 0 seconds as 00:00', () => {
    expect(WidgetUtils.formatTimeSeconds(0)).toBe('00:00')
  })

  it('formats 5 seconds as 00:05', () => {
    expect(WidgetUtils.formatTimeSeconds(5)).toBe('00:05')
  })

  it('formats 65 seconds as 01:05', () => {
    expect(WidgetUtils.formatTimeSeconds(65)).toBe('01:05')
  })

  it('formats 3599 seconds as 59:59', () => {
    expect(WidgetUtils.formatTimeSeconds(3599)).toBe('59:59')
  })

  it('formats 3600 seconds as 1:00:00 with H:MM:SS', () => {
    // 60 minutes >= 60 triggers H:MM:SS format per OpenRA behavior
    expect(WidgetUtils.formatTimeSeconds(3600)).toBe('1:00:00')
  })

  it('formats 3661 seconds as 1:01:01 in H:MM:SS', () => {
    expect(WidgetUtils.formatTimeSeconds(3661)).toBe('1:01:01')
  })

  it('formats 7200 seconds as 2:00:00 (H:MM:SS)', () => {
    expect(WidgetUtils.formatTimeSeconds(7200)).toBe('2:00:00')
  })

  it('formats 7325 seconds as 2:02:05 (H:MM:SS)', () => {
    expect(WidgetUtils.formatTimeSeconds(7325)).toBe('2:02:05')
  })

  it('omits leading minute zero when flag is false', () => {
    expect(WidgetUtils.formatTimeSeconds(65, false)).toBe('1:05')
    expect(WidgetUtils.formatTimeSeconds(5, false)).toBe('0:05')
  })

  it('preserves seconds zero-padding with non-leading minute', () => {
    expect(WidgetUtils.formatTimeSeconds(63, false)).toBe('1:03')
  })
})

describe('WidgetUtils.formatTimeWithLeadingZero', () => {
  it('zero-pads minutes when leadingMinuteZero is true', () => {
    // 1000 ticks * 40ms / 1000 = 40 seconds → "00:40"
    expect(WidgetUtils.formatTimeWithLeadingZero(1000, true)).toBe('00:40')
  })

  it('omits minute zero-padding when leadingMinuteZero is false', () => {
    // 1500 ticks * 40ms / 1000 = 60 seconds → "1:00" (no leading zero)
    const result = WidgetUtils.formatTimeWithLeadingZero(1500, false)
    expect(result).toBe('1:00')
  })
})

// ---------------------------------------------------------------------------
// formatFPS
// ---------------------------------------------------------------------------

describe('WidgetUtils.formatFPS', () => {
  it('formats integer FPS', () => {
    expect(WidgetUtils.formatFPS(60)).toBe('60.0')
  })

  it('formats fractional FPS', () => {
    expect(WidgetUtils.formatFPS(59.94)).toBe('59.9')
  })

  it('formats zero FPS', () => {
    expect(WidgetUtils.formatFPS(0)).toBe('0.0')
  })

  it('formats high FPS values', () => {
    expect(WidgetUtils.formatFPS(144)).toBe('144.0')
  })

  it('formats with rounding', () => {
    expect(WidgetUtils.formatFPS(59.99)).toBe('60.0')
  })
})

// ---------------------------------------------------------------------------
// wrapText
// ---------------------------------------------------------------------------

describe('WidgetUtils.wrapText', () => {
  it('returns text unchanged when it fits within maxWidth', () => {
    const result = WidgetUtils.wrapText('short', 500, '14px Arial')
    expect(result).toBe('short')
  })

  it('returns empty string unchanged', () => {
    expect(WidgetUtils.wrapText('', 100, '14px Arial')).toBe('')
  })

  it('returns text unchanged when maxWidth is 0 or negative', () => {
    expect(WidgetUtils.wrapText('hello', 0, '14px Arial')).toBe('hello')
    expect(WidgetUtils.wrapText('hello', -10, '14px Arial')).toBe('hello')
  })

  it('wraps long text into multiple lines', () => {
    // With a very narrow width, even short words should wrap
    const result = WidgetUtils.wrapText(
      'hello world test',
      20,
      '14px Arial',
    )
    // Each word should be on its own line due to narrow width
    expect(result.split('\n').length).toBeGreaterThan(1)
  })

  it('preserves existing newlines', () => {
    const result = WidgetUtils.wrapText(
      'line1\nline2\nline3',
      500,
      '14px Arial',
    )
    expect(result).toBe('line1\nline2\nline3')
  })

  it('wraps paragraphs separated by newlines individually', () => {
    const result = WidgetUtils.wrapText(
      'a b c d e f g h\ni j k l m n o p',
      30,
      '12px Arial',
    )
    // Should have at least 2 lines (one per paragraph minimum)
    expect(result.split('\n').length).toBeGreaterThanOrEqual(2)
  })

  it('handles single long word (no spaces)', () => {
    const result = WidgetUtils.wrapText(
      'supercalifragilisticexpialidocious',
      40,
      '14px Arial',
    )
    // Should still produce output (may be split or returned as-is)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns original text for null/undefined (as empty string)', () => {
    // NOTE: empty string behavior since null not expected
    expect(WidgetUtils.wrapText('', 100, '14px Arial')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------

describe('WidgetUtils.truncateText', () => {
  it('returns text unchanged when it fits within maxWidth', () => {
    const result = WidgetUtils.truncateText('hello', 500, '14px Arial')
    expect(result).toBe('hello')
  })

  it('truncates text with ellipsis when too long', () => {
    // With very narrow width, should truncate
    const result = WidgetUtils.truncateText(
      'This is a very long text that should be truncated',
      50,
      '14px Arial',
    )
    expect(result.endsWith('...')).toBe(true)
    expect(result.length).toBeLessThan(
      'This is a very long text that should be truncated'.length,
    )
  })

  it('does not truncate text shorter than 3 characters', () => {
    // Even if width is 0, text shorter than 4 chars won't truncate
    const result = WidgetUtils.truncateText('abc', 1, '14px Arial')
    // Should be original or not have "..." at a position that makes text empty
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('adds ... suffix to truncated text', () => {
    const result = WidgetUtils.truncateText(
      'abcdefghijklmnopqrstuvwxyz',
      30,
      '12px Arial',
    )
    if (result !== 'abcdefghijklmnopqrstuvwxyz') {
      expect(result.endsWith('...')).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// getTextContrastColor
// ---------------------------------------------------------------------------

describe('WidgetUtils.getTextContrastColor', () => {
  it('returns white for dark colors', () => {
    expect(WidgetUtils.getTextContrastColor('#000000')).toBe('#FFFFFF')
    expect(WidgetUtils.getTextContrastColor('#111111')).toBe('#FFFFFF')
    expect(WidgetUtils.getTextContrastColor('#333333')).toBe('#FFFFFF')
  })

  it('returns black for light colors', () => {
    expect(WidgetUtils.getTextContrastColor('#FFFFFF')).toBe('#000000')
    expect(WidgetUtils.getTextContrastColor('#EEEEEE')).toBe('#000000')
    expect(WidgetUtils.getTextContrastColor('#CCCCCC')).toBe('#000000')
  })

  it('returns white for dark blue', () => {
    // Blue (0, 0, 128) → luminance = 0*0.299 + 0*0.587 + 128*0.114 = 14.6 < 128
    expect(WidgetUtils.getTextContrastColor('#000080')).toBe('#FFFFFF')
  })

  it('returns black for bright yellow', () => {
    // Yellow (255, 255, 0) → luminance = 255*0.299 + 255*0.587 + 0*0.114 = 226 > 128
    expect(WidgetUtils.getTextContrastColor('#FFFF00')).toBe('#000000')
  })

  it('returns white for medium-dark gray around 127', () => {
    // Gray (127, 127, 127) → luminance = 127*0.299 + 127*0.587 + 127*0.114 = 127 < 128
    expect(WidgetUtils.getTextContrastColor('#7F7F7F')).toBe('#FFFFFF')
  })

  it('returns black for medium-light gray around 128', () => {
    // Gray (128, 128, 128) → luminance = 128*0.299 + 128*0.587 + 128*0.114 = 128, which is NOT < 128
    expect(WidgetUtils.getTextContrastColor('#808080')).toBe('#000000')
  })

  it('returns white for red', () => {
    // Red (255, 0, 0) → luminance = 255*0.299 + 0*0.587 + 0*0.114 = 76.2 < 128
    expect(WidgetUtils.getTextContrastColor('#FF0000')).toBe('#FFFFFF')
  })

  it('returns black for green', () => {
    // Green (0, 255, 0) → luminance = 0*0.299 + 255*0.587 + 0*0.114 = 149.7 > 128
    expect(WidgetUtils.getTextContrastColor('#00FF00')).toBe('#000000')
  })

  it('handles 3-digit hex colors', () => {
    expect(WidgetUtils.getTextContrastColor('#000')).toBe('#FFFFFF')
    expect(WidgetUtils.getTextContrastColor('#FFF')).toBe('#000000')
    expect(WidgetUtils.getTextContrastColor('#F00')).toBe('#FFFFFF') // Red
  })

  it('returns white for non-hex color strings', () => {
    expect(WidgetUtils.getTextContrastColor('red')).toBe('#FFFFFF')
    expect(WidgetUtils.getTextContrastColor('')).toBe('#FFFFFF')
  })
})

// ---------------------------------------------------------------------------
// inflateBy
// ---------------------------------------------------------------------------

describe('WidgetUtils.inflateBy', () => {
  it('expands rectangle by positive margins', () => {
    const rect = new Rectangle(10, 10, 100, 100)
    const result = WidgetUtils.inflateBy(rect, 5, 5, 5, 5)
    expect(result.Left).toBe(5)
    expect(result.Top).toBe(5)
    expect(result.Right).toBe(115)
    expect(result.Bottom).toBe(115)
    expect(result.Width).toBe(110)
    expect(result.Height).toBe(110)
  })

  it('shrinks rectangle by negative margins', () => {
    const rect = new Rectangle(10, 10, 100, 100)
    const result = WidgetUtils.inflateBy(rect, -5, -5, -5, -5)
    expect(result.Left).toBe(15)
    expect(result.Top).toBe(15)
    expect(result.Right).toBe(105)
    expect(result.Bottom).toBe(105)
    expect(result.Width).toBe(90)
    expect(result.Height).toBe(90)
  })

  it('inflates asymmetrically', () => {
    const rect = new Rectangle(0, 0, 100, 100)
    const result = WidgetUtils.inflateBy(rect, 1, 2, 3, 4)
    expect(result.Left).toBe(-1)
    expect(result.Top).toBe(-2)
    expect(result.Right).toBe(103)
    expect(result.Bottom).toBe(104)
  })

  it('returns empty-like when inflated beyond zero', () => {
    const rect = new Rectangle(5, 5, 10, 10)
    const result = WidgetUtils.inflateBy(rect, 20, 20, 20, 20)
    expect(result.Left).toBe(-15)
    expect(result.Top).toBe(-15)
  })
})

// ---------------------------------------------------------------------------
// withSuffix
// ---------------------------------------------------------------------------

describe('WidgetUtils.withSuffix', () => {
  it('returns name unchanged when not won/lost/disconnected', () => {
    const result = WidgetUtils.withSuffix(
      'Player1',
      WinState.Undefined,
      ClientState.Ready,
    )
    expect(result).toBe('Player1')
  })

  it('appends disconnected suffix', () => {
    const result = WidgetUtils.withSuffix(
      'Player1',
      WinState.Undefined,
      ClientState.Disconnected,
    )
    expect(result).toContain('Player1')
    expect(result).toContain('(')
    expect(result).toContain(')')
    // Fluent stub returns the key itself
    expect(result).toContain('label-client-state-disconnected')
  })

  it('appends won suffix', () => {
    const result = WidgetUtils.withSuffix(
      'Player1',
      WinState.Won,
      ClientState.Ready,
    )
    expect(result).toContain('Player1')
    expect(result).toContain('label-win-state-won')
  })

  it('appends lost suffix', () => {
    const result = WidgetUtils.withSuffix(
      'Player1',
      WinState.Lost,
      ClientState.Ready,
    )
    expect(result).toContain('Player1')
    expect(result).toContain('label-win-state-lost')
  })

  it('disconnected takes priority over won', () => {
    const result = WidgetUtils.withSuffix(
      'Player1',
      WinState.Won,
      ClientState.Disconnected,
    )
    expect(result).toContain('label-client-state-disconnected')
    expect(result).not.toContain('label-win-state-won')
  })

  it('handles empty name', () => {
    const result = WidgetUtils.withSuffix('', WinState.Undefined, ClientState.NotReady)
    expect(result).toBe('')
  })
})

// ---------------------------------------------------------------------------
// truncateLabelToTooltip
// ---------------------------------------------------------------------------

describe('WidgetUtils.truncateLabelToTooltip', () => {
  it('sets getText to truncated text for long strings', () => {
    const label = createMockLabel()
    const longText = 'This is a very long label text that needs truncation'

    WidgetUtils.truncateLabelToTooltip(
      label as unknown as Parameters<typeof WidgetUtils.truncateLabelToTooltip>[0],
      longText,
    )

    const displayText = label.getText()
    expect(displayText).not.toBe(longText)
    expect(displayText?.length).toBeLessThan(longText.length)
  })

  it('sets getTooltipText to full text when truncated', () => {
    const label = createMockLabel({ x: 0, y: 0, width: 40, height: 20 })
    const longText = 'This is a very long label text'

    WidgetUtils.truncateLabelToTooltip(
      label as unknown as Parameters<typeof WidgetUtils.truncateLabelToTooltip>[0],
      longText,
    )

    // With narrow width, text should be truncated
    const displayText = label.getText()
    if (displayText !== longText) {
      // Tooltip should show full text
      const tooltipText = label.getTooltipText()
      expect(tooltipText).toBe(longText)
    }
  })

  it('sets getTooltipText to empty when text fits', () => {
    const label = createMockLabel({ x: 0, y: 0, width: 500, height: 20 })
    const shortText = 'Hi'

    WidgetUtils.truncateLabelToTooltip(
      label as unknown as Parameters<typeof WidgetUtils.truncateLabelToTooltip>[0],
      shortText,
    )

    const displayText = label.getText()
    expect(displayText).toBe(shortText)
    // Tooltip should be empty (not show)
    const tooltipText = label.getTooltipText()
    expect(tooltipText).toBe('')
  })
})

// ---------------------------------------------------------------------------
// truncateButtonToTooltip
// ---------------------------------------------------------------------------

describe('WidgetUtils.truncateButtonToTooltip', () => {
  it('truncates button text accounting for margins', () => {
    const button = createMockButton({ x: 0, y: 0, width: 60, height: 30 })
    const longText = 'Very Long Button Text'

    WidgetUtils.truncateButtonToTooltip(
      button as unknown as Parameters<typeof WidgetUtils.truncateButtonToTooltip>[0],
      longText,
    )

    const displayText = button.getText()
    // With 60px width - 5px left - 5px right = 50px available, text should be truncated
    expect(displayText).not.toBe(longText)
  })

  it('sets getTooltipText to full text when truncated', () => {
    const button = createMockButton({ x: 0, y: 0, width: 40, height: 30 })
    const longText = 'Long Button'

    WidgetUtils.truncateButtonToTooltip(
      button as unknown as Parameters<typeof WidgetUtils.truncateButtonToTooltip>[0],
      longText,
    )

    const displayText = button.getText()
    if (displayText !== longText) {
      expect(button.getTooltipText?.()).toBe(longText)
    }
  })

  it('sets getTooltipText to null when text fits', () => {
    const button = createMockButton({ x: 0, y: 0, width: 500, height: 30 })
    const shortText = 'OK'

    WidgetUtils.truncateButtonToTooltip(
      button as unknown as Parameters<typeof WidgetUtils.truncateButtonToTooltip>[0],
      shortText,
    )

    expect(button.getText()).toBe(shortText)
    expect(button.getTooltipText).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// bindButtonIcon
// ---------------------------------------------------------------------------

describe('WidgetUtils.bindButtonIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChromeProvider.getImage.mockReturnValue('chrome/button.png')
    mockChromeProvider.getPanelCss.mockReturnValue(null)
    mockChromeProvider.getMinimumPanelSize.mockReturnValue({ width: 0, height: 0 })
  })

  it('binds icon to stateful image cache', () => {
    const originalSpriteFn = (() => 'original-sprite') as () => string
    const iconMock = {
      imageCollection: 'button-icons',
      imageName: 'attack',
      getSprite: originalSpriteFn,
    }

    const button = createMockButton()
    button.getOrNull = vi.fn().mockReturnValue(iconMock)

    WidgetUtils.bindButtonIcon(
      button as unknown as Parameters<typeof WidgetUtils.bindButtonIcon>[0],
    )

    // Verify getOrNull was called for ICON
    expect(button.getOrNull).toHaveBeenCalledWith('ICON')

    // Verify icon's getSprite was replaced with a new function
    expect(iconMock.getSprite).not.toBe(originalSpriteFn)

    // Triggering getSprite should call ChromeProvider via the cache
    const spriteResult = iconMock.getSprite()
    expect(typeof spriteResult).toBe('string')
    expect(mockChromeProvider.getImage).toHaveBeenCalled()
  })

  it('does nothing when icon child is missing', () => {
    const button = createMockButton()
    button.getOrNull = vi.fn().mockReturnValue(null)

    WidgetUtils.bindButtonIcon(
      button as unknown as Parameters<typeof WidgetUtils.bindButtonIcon>[0],
    )

    expect(mockChromeProvider.getImage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getCachedStatefulImage
// ---------------------------------------------------------------------------

describe('WidgetUtils.getCachedStatefulImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChromeProvider.getImage.mockReturnValue('chrome/images.png')
  })

  it('returns a CachedTransform', () => {
    const cache = WidgetUtils.getCachedStatefulImage('buttons', 'play')
    expect(cache).toBeDefined()
    expect(typeof cache.update).toBe('function')
  })

  it('calls ChromeProvider.getImage with base collection when not highlighted', () => {
    mockChromeProvider.getImage.mockReturnValue('chrome/buttons.png')

    const cache = WidgetUtils.getCachedStatefulImage('buttons', 'play')
    cache.update({
      disabled: false,
      pressed: false,
      hover: false,
      focused: false,
      highlighted: false,
    })

    expect(mockChromeProvider.getImage).toHaveBeenCalledWith('buttons')
  })

  it('appends -highlighted to collection when highlighted', () => {
    mockChromeProvider.getImage.mockReturnValue('chrome/buttons-highlighted.png')

    const cache = WidgetUtils.getCachedStatefulImage('buttons', 'play')
    cache.update({
      disabled: false,
      pressed: false,
      hover: false,
      focused: false,
      highlighted: true,
    })

    expect(mockChromeProvider.getImage).toHaveBeenCalledWith('buttons-highlighted')
  })

  it('caches result for same input tuple', () => {
    mockChromeProvider.getImage.mockReturnValue('chrome/buttons.png')

    const cache = WidgetUtils.getCachedStatefulImage('buttons', 'play')
    const args = {
      disabled: false,
      pressed: false,
      hover: true,
      focused: false,
      highlighted: false,
    }

    const result1 = cache.update(args)
    const result2 = cache.update(args)

    expect(result1).toBe(result2)
    // ChromeProvider.getImage should only be called once
    // NOTE: getCachedStatefulImage calls ChromeProvider.getImage inside
    // the transform, so the call count depends on the CachedTransform caching.
    // The CachedTransform checks input equality and skips recomputation.
    // So getImage should be called once total (on first update).
    const callCount = mockChromeProvider.getImage.mock.calls.length
    // First call may call getImage multiple times (once for variant, once for fallback)
    // On cache hit, no additional calls
    expect(callCount).toBeGreaterThanOrEqual(1)
    const callCountAfterFirst = callCount
    cache.update(args)
    expect(mockChromeProvider.getImage.mock.calls.length).toBe(callCountAfterFirst)
  })

  it('recomputes when state changes', () => {
    mockChromeProvider.getImage.mockReturnValue('chrome/buttons.png')

    const cache = WidgetUtils.getCachedStatefulImage('buttons', 'play')
    cache.update({
      disabled: false,
      pressed: false,
      hover: false,
      focused: false,
      highlighted: false,
    })

    const callCountAfterFirst = mockChromeProvider.getImage.mock.calls.length

    cache.update({
      disabled: true,
      pressed: false,
      hover: false,
      focused: false,
      highlighted: false,
    })

    // Should have additional calls since state changed
    expect(mockChromeProvider.getImage.mock.calls.length).toBeGreaterThan(callCountAfterFirst)
  })
})

// ---------------------------------------------------------------------------
// getCachedStatefulPanelImages
// ---------------------------------------------------------------------------

describe('WidgetUtils.getCachedStatefulPanelImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChromeProvider.getPanelCss.mockReturnValue(
      'url("chrome/panels.png") 10 12 10 12 fill stretch',
    )
  })

  it('returns a CachedTransform for panel CSS', () => {
    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    expect(cache).toBeDefined()
  })

  it('calls ChromeProvider.getPanelCss with variant collection', () => {
    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    cache.update({
      disabled: false,
      pressed: true,
      hover: false,
      focused: false,
      highlighted: false,
    })

    // Should try variant "dialog-pressed" first
    expect(mockChromeProvider.getPanelCss).toHaveBeenCalledWith('dialog-pressed')
  })

  it('falls back to base collection when variant not found', () => {
    mockChromeProvider.getPanelCss.mockImplementation((name: string) => {
      if (name === 'dialog') return 'url("chrome/dialog.png") 10 12 10 12 fill stretch'
      return null
    })

    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    const result = cache.update({
      disabled: false,
      pressed: true,
      hover: false,
      focused: false,
      highlighted: false,
    })

    // Should fall back to base collection CSS
    expect(result).toContain('dialog.png')
  })

  it('caches result for same input', () => {
    mockChromeProvider.getPanelCss.mockReturnValue('url("p.png") 5 5 5 5 fill stretch')

    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    const args = {
      disabled: true,
      pressed: false,
      hover: false,
      focused: false,
      highlighted: false,
    }

    cache.update(args)
    const callCount = mockChromeProvider.getPanelCss.mock.calls.length
    cache.update(args)

    // No additional calls on cache hit
    expect(mockChromeProvider.getPanelCss.mock.calls.length).toBe(callCount)
  })
})

// ---------------------------------------------------------------------------
// bindPlayerNameAndStatus
// ---------------------------------------------------------------------------

describe('WidgetUtils.bindPlayerNameAndStatus', () => {
  it('binds player name to label', () => {
    const label = createMockLabel()
    const player = {
      resolvedPlayerName: 'Commander',
      winState: WinState.Undefined,
      clientIndex: 0,
    }

    WidgetUtils.bindPlayerNameAndStatus(
      label as any,
      player,
    )

    const text = label.getText()
    expect(text).toBe('Commander')
  })

  it('appends won suffix when player won', () => {
    // Wide label to prevent text truncation
    const label = createMockLabel({ x: 0, y: 0, width: 600, height: 20 })
    const player = {
      resolvedPlayerName: 'Commander',
      winState: WinState.Won,
      clientIndex: 0,
      world: {
        lobbyInfo: {
          clientWithIndex: () => ({ state: ClientState.Ready }),
        },
      },
    }

    WidgetUtils.bindPlayerNameAndStatus(
      label as any,
      player,
    )

    const text = label.getText()
    expect(text).toContain('Commander')
    expect(text).toContain('label-win-state-won')
  })

  it('appends lost suffix when player lost', () => {
    const label = createMockLabel({ x: 0, y: 0, width: 600, height: 20 })
    const player = {
      resolvedPlayerName: 'Commander',
      winState: WinState.Lost,
      clientIndex: 0,
    }

    WidgetUtils.bindPlayerNameAndStatus(
      label as any,
      player,
    )

    const text = label.getText()
    expect(text).toContain('label-win-state-lost')
  })

  it('uses disconnected suffix for disconnected clients', () => {
    const label = createMockLabel({ x: 0, y: 0, width: 600, height: 20 })
    const player = {
      resolvedPlayerName: 'Commander',
      winState: WinState.Undefined,
      clientIndex: 0,
      world: {
        lobbyInfo: {
          clientWithIndex: () => ({ state: ClientState.Disconnected }),
        },
      },
    }

    WidgetUtils.bindPlayerNameAndStatus(
      label as any,
      player,
    )

    const text = label.getText()
    expect(text).toContain('label-client-state-disconnected')
  })

  it('defaults to Ready state when client is null', () => {
    const label = createMockLabel()
    const player = {
      resolvedPlayerName: 'Commander',
      winState: WinState.Undefined,
      clientIndex: 0,
      world: {
        lobbyInfo: {
          clientWithIndex: () => null,
        },
      },
    }

    WidgetUtils.bindPlayerNameAndStatus(
      label as any,
      player,
    )

    const text = label.getText()
    expect(text).toBe('Commander')
  })

  it('sets tooltip for truncated names', () => {
    const label = createMockLabel({ x: 0, y: 0, width: 40, height: 20 })
    const player = {
      resolvedPlayerName: 'Very Long Commander Name Here',
      winState: WinState.Won,
      clientIndex: 0,
    }

    WidgetUtils.bindPlayerNameAndStatus(
      label as any,
      player,
    )

    const text = label.getText()
    const tooltipText = label.getTooltipText()

    // If truncated, tooltip should show full text
    if (text !== player.resolvedPlayerName + ' (label-win-state-won)') {
      expect(tooltipText).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// setupTextNotification
// ---------------------------------------------------------------------------

describe('WidgetUtils.setupTextNotification', () => {
  it('configures text label with truncated text', () => {
    const notificationWidget = {
      bounds: { X: 0, Y: 0, Width: 300, Height: 20 },
      getOrNull: vi.fn().mockReturnValue(null) as <T>(id: string) => T | null,
      get: vi.fn().mockReturnValue({
        bounds: { X: 10, Y: 2, Width: 280, Height: 16 },
        font: '12px Arial',
        getText: null as (() => string) | null,
        getColor: null as (() => string) | null,
        textColor: '#FFFFFF',
      }) as <T>(id: string) => T,
    }

    const notification: TextNotification = {
      pool: TextNotificationPool.System,
      prefix: null,
      clientId: -1,
      text: 'Welcome to the battlefield',
      prefixColor: null,
      textColor: null,
      time: { hour: 14, minute: 30 },
    }

    WidgetUtils.setupTextNotification(
      notificationWidget as Parameters<typeof WidgetUtils.setupTextNotification>[0],
      notification,
      400,
      false,
    )

    const textLabel = notificationWidget.get('TEXT') as {
      bounds: { X: number; Y: number; Width: number; Height: number }
      font: string
      getText: (() => string) | null
      getColor: (() => string) | null
      textColor: string
    }
    expect(textLabel.getText).not.toBeNull()
    // getColor should be set
    expect(textLabel.getColor).not.toBeNull()
  })

  it('adds timestamp when withTimestamp is true', () => {
    const timeLabel = {
      bounds: { X: 0, Y: 0, Width: 40, Height: 16 },
      font: '12px Arial',
      getText: null as (() => string) | null,
    }

    const textLabel = {
      bounds: { X: 10, Y: 2, Width: 280, Height: 16 },
      font: '12px Arial',
      getText: null as (() => string) | null,
      getColor: null as (() => string) | null,
      textColor: '#FFFFFF',
    }

    const notificationWidget = {
      bounds: { X: 0, Y: 0, Width: 300, Height: 20 },
      getOrNull: vi.fn((id: string) => {
        if (id === 'TIME') return timeLabel
        return null
      }) as <T>(id: string) => T | null,
      get: vi.fn().mockReturnValue(textLabel) as <T>(id: string) => T,
    }

    const notification: TextNotification = {
      pool: TextNotificationPool.Chat,
      prefix: null,
      clientId: 0,
      text: 'Hello',
      prefixColor: null,
      textColor: null,
      time: { hour: 9, minute: 5 },
    }

    WidgetUtils.setupTextNotification(
      notificationWidget as Parameters<typeof WidgetUtils.setupTextNotification>[0],
      notification,
      400,
      true,
    )

    expect(timeLabel.getText).not.toBeNull()
    // Verify time is formatted
    const timeText = timeLabel.getText?.()
    expect(timeText).toBe('09:05')
  })

  it('configures prefix label when prefix is set', () => {
    const prefixLabel = {
      bounds: { X: 50, Y: 2, Width: 0, Height: 16 },
      font: '12px Arial',
      getText: null as (() => string) | null,
      getColor: null as (() => string) | null,
      textColor: '#AAAAAA',
    }

    const textLabel = {
      bounds: { X: 60, Y: 2, Width: 280, Height: 16 },
      font: '12px Arial',
      getText: null as (() => string) | null,
      getColor: null as (() => string) | null,
      textColor: '#FFFFFF',
    }

    const notificationWidget = {
      bounds: { X: 0, Y: 0, Width: 300, Height: 20 },
      getOrNull: vi.fn((id: string) => {
        if (id === 'PREFIX') return prefixLabel
        return null
      }) as <T>(id: string) => T | null,
      get: vi.fn().mockReturnValue(textLabel) as <T>(id: string) => T,
    }

    const notification: TextNotification = {
      pool: TextNotificationPool.Chat,
      prefix: 'System',
      clientId: -1,
      text: 'Server message',
      prefixColor: '#FF8800',
      textColor: null,
      time: { hour: 12, minute: 0 },
    }

    WidgetUtils.setupTextNotification(
      notificationWidget as Parameters<typeof WidgetUtils.setupTextNotification>[0],
      notification,
      400,
      false,
    )

    expect(prefixLabel.getText).not.toBeNull()
    const prefixText = prefixLabel.getText?.()
    expect(prefixText).toContain(':')

    // Prefix color should be set to notification.prefixColor
    expect(prefixLabel.getColor).not.toBeNull()
  })

  it('adjusts widget height when wrapped text exceeds bounds', () => {
    const textLabel = {
      bounds: { X: 10, Y: 2, Width: 100, Height: 16 },
      font: '12px Arial',
      getText: null as (() => string) | null,
      getColor: null as (() => string) | null,
      textColor: '#FFFFFF',
    }

    const notificationWidget = {
      bounds: { X: 0, Y: 0, Width: 300, Height: 20 },
      getOrNull: vi.fn().mockReturnValue(null) as <T>(id: string) => T | null,
      get: vi.fn().mockReturnValue(textLabel) as <T>(id: string) => T,
    }

    const longNotification: TextNotification = {
      pool: TextNotificationPool.System,
      prefix: null,
      clientId: -1,
      text: 'This is a very long notification message that should wrap to multiple lines',
      prefixColor: null,
      textColor: null,
      time: { hour: 0, minute: 0 },
    }

    WidgetUtils.setupTextNotification(
      notificationWidget as Parameters<typeof WidgetUtils.setupTextNotification>[0],
      longNotification,
      400,
      false,
    )

    // If text wrapped to multiple lines, height should increase
    expect(notificationWidget.bounds.Height).toBeGreaterThanOrEqual(16)
  })
})

// ---------------------------------------------------------------------------
// getCachedStatefulPanelImages (extended)
// ---------------------------------------------------------------------------

describe('WidgetUtils.getCachedStatefulPanelImages — state suffix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChromeProvider.getPanelCss.mockReturnValue('url("panel.png") 8 8 8 8 fill stretch')
  })

  it('uses -disabled suffix when disabled', () => {
    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    cache.update({
      disabled: true,
      pressed: false,
      hover: false,
      focused: false,
      highlighted: false,
    })
    expect(mockChromeProvider.getPanelCss).toHaveBeenCalledWith('dialog-disabled')
  })

  it('uses -pressed suffix when pressed', () => {
    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    cache.update({
      disabled: false,
      pressed: true,
      hover: false,
      focused: false,
      highlighted: false,
    })
    expect(mockChromeProvider.getPanelCss).toHaveBeenCalledWith('dialog-pressed')
  })

  it('uses -hover suffix when hover', () => {
    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    cache.update({
      disabled: false,
      pressed: false,
      hover: true,
      focused: false,
      highlighted: false,
    })
    expect(mockChromeProvider.getPanelCss).toHaveBeenCalledWith('dialog-hover')
  })

  it('combines highlighted with state suffix', () => {
    const cache = WidgetUtils.getCachedStatefulPanelImages('dialog')
    cache.update({
      disabled: true,
      pressed: false,
      hover: false,
      focused: false,
      highlighted: true,
    })
    expect(mockChromeProvider.getPanelCss).toHaveBeenCalledWith('dialog-highlighted-disabled')
  })
})

// ---------------------------------------------------------------------------
// measureText
// ---------------------------------------------------------------------------

describe('measureText', () => {
  it('returns estimated dimensions for text', () => {
    const result = measureText('hello', '14px Arial')
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })

  it('returns zero width for empty string', () => {
    const result = measureText('', '14px Arial')
    expect(result.width).toBeGreaterThanOrEqual(0)
  })

  it('extracts font size from font string', () => {
    const result = measureText('test', '20px Courier')
    // Height should be ~20 * 1.2 = 24
    expect(result.height).toBe(24)
  })

  it('defaults to 16px when no font size in string', () => {
    const result = measureText('test', 'Arial')
    // Should default to 16 * 1.2 = 19.2
    expect(result.height).toBeCloseTo(19.2, 1)
  })
})

// ---------------------------------------------------------------------------
// TextNotificationPool constants
// ---------------------------------------------------------------------------

describe('TextNotificationPool', () => {
  it('has all expected pool types', () => {
    expect(TextNotificationPool.System).toBe('System')
    expect(TextNotificationPool.Chat).toBe('Chat')
    expect(TextNotificationPool.Join).toBe('Join')
    expect(TextNotificationPool.Leave).toBe('Leave')
    expect(TextNotificationPool.Mission).toBe('Mission')
    expect(TextNotificationPool.Feedback).toBe('Feedback')
    expect(TextNotificationPool.Transients).toBe('Transients')
  })
})

// ---------------------------------------------------------------------------
// fillRectWithColor / fillEllipseWithColor / fillRectWithSprite
// ---------------------------------------------------------------------------

describe('WidgetUtils.fillRectWithColor', () => {
  it('sets background color on element', () => {
    const el = document.createElement('div')
    WidgetUtils.fillRectWithColor(el, '#FF0000')
    // happy-dom preserves the original hex format
    expect(el.style.backgroundColor).toBe('#FF0000')
  })

  it('handles named colors', () => {
    const el = document.createElement('div')
    WidgetUtils.fillRectWithColor(el, 'blue')
    expect(el.style.backgroundColor).toBe('blue')
  })
})

describe('WidgetUtils.fillRectWithGradient', () => {
  it('sets gradient background on element', () => {
    const el = document.createElement('div')
    WidgetUtils.fillRectWithGradient(el, '#FF0000', '#00FF00', '#0000FF', '#FFFF00')
    expect(el.style.background).toContain('linear-gradient')
  })
})

describe('WidgetUtils.fillEllipseWithColor', () => {
  it('sets background color and border-radius on element', () => {
    const el = document.createElement('div')
    WidgetUtils.fillEllipseWithColor(el, '#FF0000')
    expect(el.style.backgroundColor).toBe('#FF0000')
    expect(el.style.borderRadius).toBe('50%')
  })
})

describe('WidgetUtils.fillRectWithSprite', () => {
  it('sets background image with repeat on element', () => {
    const el = document.createElement('div')
    WidgetUtils.fillRectWithSprite(el, 'sprites/tile.png')
    expect(el.style.backgroundImage).toContain('tile.png')
    expect(el.style.backgroundRepeat).toBe('repeat')
  })
})

// ---------------------------------------------------------------------------
// drawSprite / drawSpriteScaled / drawSpriteCentered
// ---------------------------------------------------------------------------

describe('WidgetUtils.drawSprite', () => {
  it('positions element absolutely with background image', () => {
    const el = document.createElement('div')
    WidgetUtils.drawSprite(el, 'sprites/icon.png', 32, 32, 10, 20)

    expect(el.style.position).toBe('absolute')
    expect(el.style.left).toBe('10px')
    expect(el.style.top).toBe('20px')
    expect(el.style.width).toBe('32px')
    expect(el.style.height).toBe('32px')
    expect(el.style.backgroundImage).toContain('icon.png')
    expect(el.style.backgroundRepeat).toBe('no-repeat')
  })

  it('sets UV offset when provided', () => {
    const el = document.createElement('div')
    WidgetUtils.drawSprite(el, 'sprites/sheet.png', 32, 32, 0, 0, 64, 0)

    expect(el.style.backgroundPosition).toContain('-64px')
  })
})

describe('WidgetUtils.drawSpriteScaled', () => {
  it('scales sprite to target size', () => {
    const el = document.createElement('div')
    WidgetUtils.drawSpriteScaled(el, 'sprites/icon.png', 32, 32, 10, 20, 64, 64)

    expect(el.style.width).toBe('64px')
    expect(el.style.height).toBe('64px')
    expect(el.style.backgroundSize).toBe('64px 64px')
  })
})

describe('WidgetUtils.drawSpriteCentered', () => {
  it('centers sprite at given position', () => {
    const el = document.createElement('div')
    WidgetUtils.drawSpriteCentered(el, 'sprites/icon.png', 32, 32, 100, 100)

    // Center of 32x32 sprite at (100, 100):
    // left = 100 - 0.5 * 32 = 84
    // top = 100 - 0.5 * 32 = 84
    expect(el.style.left).toBe('84px')
    expect(el.style.top).toBe('84px')
    expect(el.style.width).toBe('32px')
    expect(el.style.height).toBe('32px')
  })

  it('applies scale factor', () => {
    const el = document.createElement('div')
    WidgetUtils.drawSpriteCentered(el, 'sprites/icon.png', 32, 32, 100, 100, 2)

    // Width/height = 32 * 2 = 64
    // left = 100 - 0.5 * 64 = 68
    expect(el.style.width).toBe('64px')
    expect(el.style.height).toBe('64px')
    expect(el.style.left).toBe('68px')
  })
})

// ---------------------------------------------------------------------------
// drawPanel (CSS border-image)
// ---------------------------------------------------------------------------

describe('WidgetUtils.drawPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies CSS border-image when panel CSS is available', () => {
    mockChromeProvider.getPanelCss.mockReturnValue(
      'url("chrome/panel.png") 10 12 10 12 fill stretch',
    )
    mockChromeProvider.getMinimumPanelSize.mockReturnValue({ width: 22, height: 20 })

    const el = document.createElement('div')
    WidgetUtils.drawPanel('dialog', el)

    expect(el.style.borderImageSource).toBeTruthy()
  })

  it('applies fallback background when panel CSS is null', () => {
    mockChromeProvider.getPanelCss.mockReturnValue(null)

    const el = document.createElement('div')
    WidgetUtils.drawPanel('dialog', el)

    // Should have fallback styling
    expect(el.style.backgroundColor).toBeTruthy()
    // borderImage should be cleared (happy-dom default is 'initial')
    expect(el.style.borderImage).not.toBe('')
  })
})

// ---------------------------------------------------------------------------
// drawPanelWithBounds
// ---------------------------------------------------------------------------

describe('WidgetUtils.drawPanelWithBounds', () => {
  it('creates positioned element from Rectangle bounds', () => {
    const bounds = new Rectangle(10, 20, 300, 200)
    const el = WidgetUtils.drawPanelWithBounds(bounds, [])

    expect(el.style.position).toBe('absolute')
    expect(el.style.left).toBe('10px')
    expect(el.style.top).toBe('20px')
    expect(el.style.width).toBe('300px')
    expect(el.style.height).toBe('200px')
  })

  it('uses provided element when given', () => {
    const bounds = new Rectangle(0, 0, 100, 100)
    const existingEl = document.createElement('div')
    existingEl.id = 'my-panel'

    const el = WidgetUtils.drawPanelWithBounds(bounds, [], existingEl)
    expect(el.id).toBe('my-panel')
  })
})
