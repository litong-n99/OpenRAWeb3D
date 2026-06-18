/**
 * EditorViewportControllerWidget.test.ts — EditorViewportControllerWidget migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: brush management, mouse event routing, coordinate conversion,
 * grid snap, tooltip management, lifecycle, and integration with EditorCursorLayer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core/Maths/math.vector', () => ({
  Vector3: class {
    x: number; y: number; z: number
    constructor(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z }
  },
  Matrix: {},
}))

vi.mock('@babylonjs/core/Cameras/camera', () => ({
  Camera: class {
    static readonly ORTHOGRAPHIC_CAMERA = 0
    static readonly PERSPECTIVE_CAMERA = 1
  },
}))

vi.mock('@babylonjs/core/Cameras/arcRotateCamera', () => ({}))
vi.mock('@babylonjs/core/Engines/engine', () => ({}))
vi.mock('@babylonjs/core/scene', () => ({}))
vi.mock('@babylonjs/core/Maths/math.color', () => ({
  Color3: class {
    r: number; g: number; b: number
    constructor(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b }
  },
}))
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => ({}))
vi.mock('@babylonjs/core/Materials/standardMaterial', () => ({}))
vi.mock('@babylonjs/core/Meshes/mesh', () => ({}))

// ---------------------------------------------------------------------------
// Mock ChromeMetrics
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Widgets/ChromeMetrics', () => {
  const data: Record<string, unknown> = { DefaultCursor: 'default' }
  return {
    ChromeMetrics: {
      get: <T>(key: string): T => {
        if (key in data) return data[key] as T
        throw new Error(`ChromeMetrics: key '${key}' not found`)
      },
      tryGet: <T>(key: string): T | undefined => data[key] as T | undefined,
      add(key: string, value: unknown): void { data[key] = value },
    },
  }
})

// ---------------------------------------------------------------------------
// Mock IInputHandler types
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Input/IInputHandler', () => ({
  MouseInputEvent: { Down: 0, Move: 1, Up: 2, Scroll: 3 },
  MouseButton: { None: 0, Left: 1, Middle: 2, Right: 4, X1: 8, X2: 16 },
  KeyInputEvent: { Down: 0, Up: 1 },
  Modifiers: { None: 0, Shift: 1, Alt: 2, Ctrl: 4, Meta: 8 },
}))

// ---------------------------------------------------------------------------
// Mock Keycode
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Input/Keycode', () => {
  const KeyCode: Record<string, number> = {
    UNKNOWN: 0, RETURN: 13, ESCAPE: 27, BACKSPACE: 8,
    TAB: 9, SPACE: 32, PAGEUP: 1073741899, PAGEDOWN: 1073741902,
    LEFT: 1073741904, RIGHT: 1073741903, UP: 1073741906, DOWN: 1073741905,
  }
  return { default: KeyCode }
})

// ---------------------------------------------------------------------------
// Mock HotkeyReference
// ---------------------------------------------------------------------------

vi.mock('../../OpenRA.Game/Input/HotkeyReference', () => ({
  HotkeyReference: {
    Invalid: {
      isActivatedBy: () => false,
      getValue: () => ({ key: 0, modifiers: 0 }),
    },
  },
}))

// =============================================================================
// Imports (MUST be after vi.mock)
// =============================================================================

import { EditorViewportControllerWidget, EDITOR_VIEWPORT_SETTINGS } from './EditorViewportControllerWidget'
import { MapGridType } from '../../OpenRA.Game/Map/MapGridType'
import type { IEditorBrush } from '../Editor/IEditorBrush'
import type { EditorCursorLayer } from '../Traits/World/EditorCursorLayer'
import type { Viewport } from '../../OpenRA.Game/Graphics/Viewport'
import { CPos } from '../../OpenRA.Game/CPos'
import { ScrollDirection } from '../../OpenRA.Game/Graphics/Viewport'

// ---------------------------------------------------------------------------
// Helper: create a mock Viewport
// ---------------------------------------------------------------------------

interface MockViewportRef {
  viewToWorldCalls: Array<{ x: number; y: number }>
  unlockMinZoomCalls: number[]
  adjustZoomAtCalls: Array<{ dz: number; center: { x: number; y: number } }>
  adjustZoomCalls: number[]
  scrollCalls: Array<{ delta: { x: number; y: number }; ignoreBorders: boolean }>
  onViewportTickCalls: Array<() => void>
  offViewportTickCalls: Array<() => void>
}

function createMockViewport(): { viewport: Viewport; ref: MockViewportRef } {
  const ref: MockViewportRef = {
    viewToWorldCalls: [],
    unlockMinZoomCalls: [],
    adjustZoomAtCalls: [],
    adjustZoomCalls: [],
    scrollCalls: [],
    onViewportTickCalls: [],
    offViewportTickCalls: [],
  }

  const viewport = {
    viewToWorld: (view: { x: number; y: number }): CPos => {
      ref.viewToWorldCalls.push(view)
      return new CPos(Math.round(view.x / 1024), Math.round(view.y / 1024))
    },
    unlockMinimumZoom: (scale: number): void => {
      ref.unlockMinZoomCalls.push(scale)
    },
    adjustZoomAt: (_dz: number, _center: { x: number; y: number }): void => {
      ref.adjustZoomAtCalls.push({ dz: _dz, center: _center })
    },
    adjustZoom: (dz: number): void => {
      ref.adjustZoomCalls.push(dz)
    },
    scroll: (delta: { x: number; y: number }, ignoreBorders: boolean): void => {
      ref.scrollCalls.push({ delta, ignoreBorders })
    },
    onViewportTick: (cb: () => void): void => {
      ref.onViewportTickCalls.push(cb)
    },
    offViewportTick: (cb: () => void): void => {
      ref.offViewportTickCalls.push(cb)
    },
    get centerPosition(): { x: number; y: number; z: number } {
      return { x: 51200, y: 51200, z: 0 }
    },
    get centerLocation(): { x: number; y: number } {
      return { x: 640, y: 360 }
    },
    get viewportSize(): { x: number; y: number } {
      return { x: 1280, y: 720 }
    },
    getBlockedDirections: (): number => ScrollDirection.None,
    get mapRectBounds(): { Top: number; Left: number; Bottom: number; Right: number } {
      return { Top: 0, Left: 0, Bottom: 7200, Right: 12800 }
    },
    get zoom(): number { return 1 },
    get minZoom(): number { return 1 },
    get maxZoom(): number { return 2 },
    get size(): { width: number; height: number } {
      return { width: 1280, height: 720 }
    },
    centerFloat2: (): void => {},
    tick: (): void => {},
    viewportCenterProvider: null as (() => { x: number; y: number }) | null,
  } as unknown as Viewport

  return { viewport, ref }
}

// ---------------------------------------------------------------------------
// Helper: create a mock EditorCursorLayer
// ---------------------------------------------------------------------------

interface MockCursorLayerRef {
  setBrushCalls: Array<IEditorBrush | null>
  getBrushReturn: IEditorBrush | null
}

function createMockEditorCursorLayer(): { cursorLayer: EditorCursorLayer; ref: MockCursorLayerRef } {
  const ref: MockCursorLayerRef = {
    setBrushCalls: [],
    getBrushReturn: null,
  }

  const cursorLayer = {
    setBrush: (brush: IEditorBrush | null): void => {
      ref.setBrushCalls.push(brush)
      ref.getBrushReturn = brush
    },
    getBrush: (): IEditorBrush | null => ref.getBrushReturn,
    getCursor: (): CPos => CPos.Zero,
    setCursor: (): void => {},
    setCursorColor: (): void => {},
    setCursorVisible: (): void => {},
    ensureCursorMesh: (): unknown => null,
    tickRender: (): void => {},
    renderAboveShroud: (): readonly any[] => [],
    renderAnnotations: (): readonly any[] => [],
    dispose: (): void => {},
    setScene: (): void => {},
    setGrid: (): void => {},
    setCursorHeight: (): void => {},
    getCursorMesh: (): unknown => null,
    get spatiallyPartitionable(): boolean { return false },
    get annotationsSpatiallyPartitionable(): boolean { return false },
  } as unknown as EditorCursorLayer

  return { cursorLayer, ref }
}

// ---------------------------------------------------------------------------
// Helper: create a mock IEditorBrush
// ---------------------------------------------------------------------------

interface MockBrushRef {
  handleMouseInputCalls: unknown[]
  handleMouseInputReturn: boolean
  tickCalls: number
  disposeCalls: number
}

function createMockBrush(handleReturn: boolean = false): { brush: IEditorBrush; ref: MockBrushRef } {
  const ref: MockBrushRef = {
    handleMouseInputCalls: [],
    handleMouseInputReturn: handleReturn,
    tickCalls: 0,
    disposeCalls: 0,
  }

  const brush: IEditorBrush = {
    handleMouseInput: (mi: unknown): boolean => {
      ref.handleMouseInputCalls.push(mi)
      return ref.handleMouseInputReturn
    },
    tick: (): void => {
      ref.tickCalls++
    },
    dispose: (): void => {
      ref.disposeCalls++
    },
    tickRender: (): void => {},
    renderAboveShroud: (): readonly any[] => [],
    renderAnnotations: (): readonly any[] => [],
  } as IEditorBrush

  return { brush, ref }
}

// ---------------------------------------------------------------------------
// Helper: create a minimal WorldRendererStub
// ---------------------------------------------------------------------------

function createMockWorldRenderer(): any {
  return {
    world: {
      worldActor: {
        traitsImplementing: <T>(): T[] => [],
      },
      type: 'EDITOR_WORLD',
    },
    viewport: {} as Viewport,
    tileSize: { width: 1024, height: 1024 },
    tileScale: 1024,
    screenPxPosition: () => ({ x: 0, y: 0 }),
    projectedPosition: () => ({ x: 0, y: 0, z: 0 }),
  }
}

// ---------------------------------------------------------------------------
// Helper: create basic WidgetEvents for testing
// ---------------------------------------------------------------------------

function createMouseMoveEvent(
  clientX: number,
  clientY: number,
  shiftKey = false,
): import('../../OpenRA.Game/Widgets/Widget').WidgetEvent {
  return {
    type: 'mousemove',
    target: null,
    stopPropagation: () => {},
    clientX,
    clientY,
    button: 0,
    deltaX: 0,
    deltaY: 0,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
  }
}

function createMouseDownEvent(
  clientX: number,
  clientY: number,
  button = 0,
  shiftKey = false,
): import('../../OpenRA.Game/Widgets/Widget').WidgetEvent {
  return {
    type: 'mousedown',
    target: null,
    stopPropagation: () => {},
    clientX,
    clientY,
    button,
    deltaX: 0,
    deltaY: 0,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
  }
}

function createMouseUpEvent(
  clientX: number,
  clientY: number,
  button = 0,
): import('../../OpenRA.Game/Widgets/Widget').WidgetEvent {
  return {
    type: 'mouseup',
    target: null,
    stopPropagation: () => {},
    clientX,
    clientY,
    button,
    deltaX: 0,
    deltaY: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('EditorViewportControllerWidget', () => {
  let widget: EditorViewportControllerWidget
  let mockViewport: Viewport
  let mockViewportRef: MockViewportRef
  let mockCursorLayer: EditorCursorLayer
  let mockCursorLayerRef: MockCursorLayerRef
  let mockWorldRenderer: any

  beforeEach(() => {
    const vp = createMockViewport()
    mockViewport = vp.viewport
    mockViewportRef = vp.ref

    const cl = createMockEditorCursorLayer()
    mockCursorLayer = cl.cursorLayer
    mockCursorLayerRef = cl.ref

    mockWorldRenderer = createMockWorldRenderer()

    widget = new EditorViewportControllerWidget(
      mockViewport,
      mockCursorLayer,
      mockWorldRenderer,
      MapGridType.Rectangular,
    )
  })

  afterEach(() => {
    widget?.dispose()
  })

  // ---------------------------------------------------------------------------
  // Construction + Type hierarchy
  // ---------------------------------------------------------------------------

  describe('construction', () => {
    it('extends ViewportControllerWidget', () => {
      expect(widget).toBeInstanceOf(EditorViewportControllerWidget)
      // Parent constructor is ViewportControllerWidget
      expect(typeof widget.viewport).toBe('object')
      expect(typeof widget.settings).toBe('object')
    })

    it('initializes with default selection colors', () => {
      expect(widget.selectionMainColor).toEqual({ r: 255, g: 255, b: 255, a: 255 })
      expect(widget.selectionAltColor).toEqual({ r: 0, g: 0, b: 0, a: 255 })
      expect(widget.pasteColor).toEqual({ r: 76, g: 255, b: 0, a: 255 })
    })

    it('initializes with default brush (stub)', () => {
      expect(widget.currentBrush).toBeDefined()
      expect(widget.defaultBrush).toBe(widget.currentBrush)
    })

    it('unlocks minimum zoom to 0.25 for full map view', () => {
      expect(mockViewportRef.unlockMinZoomCalls).toHaveLength(1)
      expect(mockViewportRef.unlockMinZoomCalls[0]).toBe(0.25)
    })

    it('sets selectionAltOffset for Rectangular grid to (1, 1)', () => {
      expect(widget.selectionAltOffset).toEqual({ x: 1, y: 1 })
    })

    it('sets selectionAltOffset for RectangularIsometric grid to (0, 1)', () => {
      const isoWidget = new EditorViewportControllerWidget(
        mockViewport,
        mockCursorLayer,
        mockWorldRenderer,
        MapGridType.RectangularIsometric,
      )
      expect(isoWidget.selectionAltOffset).toEqual({ x: 0, y: 1 })
      isoWidget.dispose()
    })

    it('registers brush with EditorCursorLayer on construction', () => {
      expect(mockCursorLayerRef.setBrushCalls.length).toBeGreaterThanOrEqual(1)
      expect(mockCursorLayerRef.setBrushCalls[0]).toBe(widget.defaultBrush)
    })

    it('uses EDITOR_VIEWPORT_SETTINGS for 20px edge scroll margin', () => {
      expect(EDITOR_VIEWPORT_SETTINGS.viewportEdgeScrollMargin).toBe(20)
      expect(widget.settings.viewportEdgeScrollMargin).toBe(20)
    })

    it('initializes with gridSnapEnabled = true', () => {
      expect(widget.gridSnapEnabled).toBe(true)
    })

    it('initializes with empty tooltip config', () => {
      expect(widget.tooltipContainer).toBe('TOOLTIP_CONTAINER')
      expect(widget.tooltipTemplate).toBe('EDITOR_TOOLTIP')
    })
  })

  // ---------------------------------------------------------------------------
  // viewportToCell
  // ---------------------------------------------------------------------------

  describe('viewportToCell', () => {
    it('converts screen pixel position to CPos', () => {
      const cell = widget.viewportToCell({ x: 1024, y: 2048 })

      expect(cell).toBeInstanceOf(CPos)
      expect(cell.X).toBe(1)
      expect(cell.Y).toBe(2)
    })

    it('rounds pixel coordinates before conversion', () => {
      const cell = widget.viewportToCell({ x: 1023.7, y: 2047.2 })

      expect(cell.X).toBe(1)
      expect(cell.Y).toBe(2)
    })

    it('handles origin (0, 0) correctly', () => {
      const cell = widget.viewportToCell({ x: 0, y: 0 })

      expect(cell.X).toBe(0)
      expect(cell.Y).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // activeBrush / setBrush / clearBrush
  // ---------------------------------------------------------------------------

  describe('brush management', () => {
    it('get currentBrush returns the active brush', () => {
      expect(widget.currentBrush).toBe(widget.defaultBrush)
    })

    it('setBrush replaces the active brush', () => {
      const { brush } = createMockBrush()

      widget.setBrush(brush)

      expect(widget.currentBrush).toBe(brush)
      expect(widget.currentBrush).not.toBe(widget.defaultBrush)
    })

    it('setBrush(null) restores the default brush (clearBrush)', () => {
      const { brush } = createMockBrush()
      widget.setBrush(brush)

      widget.setBrush(null)

      expect(widget.currentBrush).toBe(widget.defaultBrush)
    })

    it('clearBrush restores the default brush', () => {
      const { brush } = createMockBrush()
      widget.setBrush(brush)

      widget.clearBrush()

      expect(widget.currentBrush).toBe(widget.defaultBrush)
    })

    it('setBrush fires brushChangedCallback', () => {
      const { brush } = createMockBrush()
      let callbackFired = false
      widget.brushChangedCallback = () => { callbackFired = true }

      widget.setBrush(brush)

      expect(callbackFired).toBe(true)
    })

    it('setBrush disposes old brush when it is not the default', () => {
      const { brush: brush1, ref: ref1 } = createMockBrush()
      const { brush: brush2, ref: ref2 } = createMockBrush()

      widget.setBrush(brush1)
      widget.setBrush(brush2)

      // brush1 should be disposed since it was replaced and was not the default
      expect(ref1.disposeCalls).toBe(1)
      // brush2 should NOT be disposed yet
      expect(ref2.disposeCalls).toBe(0)
    })

    it('setBrush updates EditorCursorLayer brush reference', () => {
      const { brush } = createMockBrush()
      const initialCallCount = mockCursorLayerRef.setBrushCalls.length

      widget.setBrush(brush)

      // EditorCursorLayer.setBrush should have been called again
      expect(mockCursorLayerRef.setBrushCalls.length).toBe(initialCallCount + 1)
      expect(mockCursorLayerRef.setBrushCalls[mockCursorLayerRef.setBrushCalls.length - 1]).toBe(brush)
    })
  })

  // ---------------------------------------------------------------------------
  // Mouse event routing to brush
  // ---------------------------------------------------------------------------

  describe('mouse event routing', () => {
    it('routes mouse events to active brush', () => {
      const { brush, ref } = createMockBrush(true)
      widget.setBrush(brush)

      const event = createMouseMoveEvent(500, 300)
      widget.handleEvent(event)

      expect(ref.handleMouseInputCalls.length).toBe(1)
    })

    it('returns true when brush handles the event', () => {
      const { brush, ref } = createMockBrush(true)
      widget.setBrush(brush)

      const event = createMouseDownEvent(100, 200)
      const handled = widget.handleEvent(event)

      expect(handled).toBe(true)
      expect(ref.handleMouseInputCalls.length).toBe(1)
    })

    it('falls through to base class when brush does not consume event', () => {
      const { brush } = createMockBrush(false)
      widget.setBrush(brush)

      // mouseMove without scrolling shouldn't do much in base class
      const event = createMouseMoveEvent(500, 300)
      const handled = widget.handleEvent(event)

      // Should still have called the brush
      expect(handled).toBe(false)
    })

    it('forwards mouse down events to brush', () => {
      const { brush, ref } = createMockBrush(true)
      widget.setBrush(brush)

      const event = createMouseDownEvent(200, 400, 0) // Left click
      widget.handleEvent(event)

      expect(ref.handleMouseInputCalls.length).toBe(1)
    })

    it('forwards mouse up events to brush', () => {
      const { brush, ref } = createMockBrush(true)
      widget.setBrush(brush)

      const event = createMouseUpEvent(200, 400, 0)
      widget.handleEvent(event)

      expect(ref.handleMouseInputCalls.length).toBe(1)
    })

    it('does NOT route keyboard events to brush', () => {
      const { brush, ref } = createMockBrush(true)
      widget.setBrush(brush)

      const keyEvent = {
        type: 'keydown',
        target: null,
        stopPropagation: () => {},
        key: 'ArrowUp',
        keyCode: 1073741906,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
      }
      widget.handleEvent(keyEvent)

      // Brush should NOT receive keyboard events
      expect(ref.handleMouseInputCalls.length).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // Grid snap (Shift key)
  // ---------------------------------------------------------------------------

  describe('grid snap toggle', () => {
    it('defaults to enabled', () => {
      expect(widget.gridSnapEnabled).toBe(true)
    })

    it('disables grid snap when Shift is held during mouse move', () => {
      const event = createMouseMoveEvent(500, 300, true) // shiftKey = true
      widget.handleEvent(event)

      expect(widget.gridSnapEnabled).toBe(false)
    })

    it('enables grid snap when Shift is released', () => {
      // First move with Shift
      widget.handleEvent(createMouseMoveEvent(500, 300, true))
      expect(widget.gridSnapEnabled).toBe(false)

      // Then move without Shift
      widget.handleEvent(createMouseMoveEvent(500, 300, false))
      expect(widget.gridSnapEnabled).toBe(true)
    })

    it('tracks grid snap state during mouse down', () => {
      const event = createMouseDownEvent(500, 300, 0, true) // shiftKey = true
      widget.handleEvent(event)

      expect(widget.gridSnapEnabled).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Scroll edge zone detection
  // ---------------------------------------------------------------------------

  describe('scroll edge zones', () => {
    it('uses 20px edge margin from editor settings', () => {
      expect(widget.settings.viewportEdgeScrollMargin).toBe(20)
    })

    it('configures edge scrolling as enabled', () => {
      expect(widget.settings.viewportEdgeScroll).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Zoom range
  // ---------------------------------------------------------------------------

  describe('zoom range', () => {
    it('unlocks minimum zoom to 0.25 (wider than game mode default of 1.0)', () => {
      expect(mockViewportRef.unlockMinZoomCalls).toHaveLength(1)
      expect(mockViewportRef.unlockMinZoomCalls[0]).toBe(0.25)
    })
  })

  // ---------------------------------------------------------------------------
  // EditorCursorLayer integration
  // ---------------------------------------------------------------------------

  describe('EditorCursorLayer integration', () => {
    it('sets brush on cursor layer during construction', () => {
      expect(mockCursorLayerRef.setBrushCalls[0]).toBe(widget.defaultBrush)
    })

    it('updates cursor layer when brush changes', () => {
      const { brush } = createMockBrush()
      widget.setBrush(brush)

      const lastCall = mockCursorLayerRef.setBrushCalls[mockCursorLayerRef.setBrushCalls.length - 1]
      expect(lastCall).toBe(brush)
    })

    it('sets cursor layer brush to null on dispose', () => {
      widget.dispose()

      const lastCall = mockCursorLayerRef.setBrushCalls[mockCursorLayerRef.setBrushCalls.length - 1]
      expect(lastCall).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // Tooltip management
  // ---------------------------------------------------------------------------

  describe('tooltip management', () => {
    it('setTooltip is a no-op when tooltips are disabled', () => {
      // Tooltips are disabled by default (mouse not entered)
      expect(() => widget.setTooltip('test tooltip')).not.toThrow()
    })

    it('setTooltip(null) is a no-op when tooltips are disabled', () => {
      expect(() => widget.setTooltip(null)).not.toThrow()
    })

    it('enables tooltips on mouseEntered', () => {
      widget.mouseEntered()
      expect(() => widget.setTooltip('test')).not.toThrow()
    })

    it('disables tooltips on mouseExited', () => {
      widget.mouseEntered()
      widget.mouseExited()
      expect(() => widget.setTooltip('test')).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Tick behavior
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('ticks the active brush', () => {
      const { brush, ref } = createMockBrush()
      widget.setBrush(brush)
      const beforeCalls = ref.tickCalls

      widget.tick()

      expect(ref.tickCalls).toBe(beforeCalls + 1)
    })

    it('calls super.tick() for ChromeLogic processing', () => {
      expect(() => widget.tick()).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // Middle-mouse drag panning (delegates to base class)
  // ---------------------------------------------------------------------------

  describe('middle-mouse panning', () => {
    it('delegates to base class when not consumed by brush', () => {
      const { brush } = createMockBrush(false)
      widget.setBrush(brush)

      // Middle mouse button down shouldn't crash
      const event = createMouseDownEvent(500, 300, 1) // Middle button
      expect(() => widget.handleEvent(event)).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // render() output
  // ---------------------------------------------------------------------------

  describe('render', () => {
    it('returns an HTMLElement div', () => {
      const el = widget.render()
      expect(el).toBeInstanceOf(HTMLDivElement)
      expect(el.tagName).toBe('DIV')
    })

    it('sets full-screen absolute positioning', () => {
      const el = widget.render()
      expect(el.style.position).toBe('absolute')
      expect(el.style.width).toBe('100%')
      expect(el.style.height).toBe('100%')
    })

    it('sets data-widget-id when id is configured', () => {
      widget.id = 'editorViewport'
      const el = widget.render()
      expect(el.getAttribute('data-widget-id')).toBe('editorViewport')
    })
  })

  // ---------------------------------------------------------------------------
  // Lifecycle / Dispose
  // ---------------------------------------------------------------------------

  describe('lifecycle and dispose', () => {
    it('dispose cleans up brush resources', () => {
      const { brush, ref } = createMockBrush()
      widget.setBrush(brush)

      widget.dispose()

      // Brush should be disposed
      expect(ref.disposeCalls).toBeGreaterThanOrEqual(1)
    })

    it('dispose sets editorCursorLayer brush to null', () => {
      widget.dispose()

      const lastCall = mockCursorLayerRef.setBrushCalls[mockCursorLayerRef.setBrushCalls.length - 1]
      expect(lastCall).toBeNull()
    })

    it('dispose clears brushChangedCallback', () => {
      widget.brushChangedCallback = () => {}
      widget.dispose()

      expect(widget.brushChangedCallback).toBeNull()
    })

    it('multiple dispose calls do not throw', () => {
      expect(() => {
        widget.dispose()
        widget.dispose()
      }).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // currentMousePos tracking
  // ---------------------------------------------------------------------------

  describe('currentMousePos tracking', () => {
    it('updates currentMousePos on mouse move', () => {
      expect(widget.currentMousePos).toEqual({ x: 0, y: 0 })

      const event = createMouseMoveEvent(640, 360)
      widget.handleEvent(event)

      expect(widget.currentMousePos).toEqual({ x: 640, y: 360 })
    })

    it('updates currentMousePos on mouse down', () => {
      const event = createMouseDownEvent(100, 200, 0)
      widget.handleEvent(event)

      expect(widget.currentMousePos).toEqual({ x: 100, y: 200 })
    })

    it('does NOT update currentMousePos on key events', () => {
      widget.handleEvent(createMouseMoveEvent(640, 360))
      expect(widget.currentMousePos).toEqual({ x: 640, y: 360 })

      const keyEvent = {
        type: 'keydown',
        target: null,
        stopPropagation: () => {},
        key: 'ArrowUp',
        keyCode: 1073741906,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        repeat: false,
      }
      widget.handleEvent(keyEvent)
      // Mouse position should remain at last known mouse position
      expect(widget.currentMousePos).toEqual({ x: 640, y: 360 })
    })
  })
})
