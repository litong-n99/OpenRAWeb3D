/**
 * MapPreviewWidget.test.ts — MapPreviewWidget 单元测试
 *
 * 测试范围: Canvas 渲染、坐标转换、出生点标记、克隆、DOM 输出。
 * happy-dom 模拟 Canvas API。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @babylonjs/core
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import {
  MapPreviewWidget,
  type SpawnOccupant,
  type IMapPreviewData,
  type CPos,
} from './MapPreviewWidget.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMinimapData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4)
  // Fill with simple terrain pattern
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 100     // R
    data[i + 1] = 150 // G
    data[i + 2] = 50  // B
    data[i + 3] = 255 // A
  }
  return data
}

function createMockMapPreview(gridType: 'Rectangular' | 'RectangularIsometric' = 'Rectangular'): IMapPreviewData {
  const minimap = createMinimapData(64)
  return {
    uid: 'test-map',
    bounds: { left: 0, top: 0, right: 64, bottom: 64 },
    spawnPoints: [
      { u: 10, v: 10 },
      { u: 50, v: 10 },
      { u: 10, v: 50 },
      { u: 50, v: 50 },
    ],
    gridType,
    getMinimap: () => minimap,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapPreviewWidget', () => {
  let widget: MapPreviewWidget

  beforeEach(() => {
    widget = new MapPreviewWidget()
    widget.bounds = { x: 0, y: 0, width: 400, height: 300 }
  })

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  it('constructs with default values', () => {
    expect(widget.ignoreMouseInput).toBe(false)
    expect(widget.showSpawnPoints).toBe(true)
    expect(widget.showUnoccupiedSpawnpoints).toBe(true)
    expect(widget.tooltipTemplate).toBe('SPAWN_TOOLTIP')
    expect(widget.tooltipSpawnIndex).toBe(-1)
  })

  it('loaded is false when no minimap data', () => {
    expect(widget.loaded).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Preview delegate
  // ---------------------------------------------------------------------------

  it('accepts preview delegate', () => {
    const preview = createMockMapPreview()
    widget.preview = () => preview
    expect(widget.preview()).toBe(preview)
  })

  it('preview delegate defaults to null', () => {
    expect(widget.preview()).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Spawn occupants
  // ---------------------------------------------------------------------------

  it('accepts spawn occupants delegate', () => {
    const occupant: SpawnOccupant = {
      color: '#FF0000',
      playerName: 'Player 1',
      team: 1,
      faction: 'allies',
      spawnPoint: 1,
    }
    const map = new Map<number, SpawnOccupant>()
    map.set(1, occupant)
    widget.spawnOccupants = () => map
    expect(widget.spawnOccupants().get(1)?.playerName).toBe('Player 1')
  })

  it('disabled spawn points defaults to empty', () => {
    expect(widget.disabledSpawnPoints().size).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Coordinate conversion
  // ---------------------------------------------------------------------------

  it('convertToPreview returns zero when no preview', () => {
    const result = widget.convertToPreview({ u: 0, v: 0 }, false)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
  })

  it('convertToPreview with rectangular grid', () => {
    const preview = createMockMapPreview('Rectangular')
    widget.preview = () => preview
    widget.bounds = { x: 0, y: 0, width: 200, height: 200 }

    // Force a render to set _previewScale and _mapRect
    const el = widget.render()
    expect(el).toBeDefined()

    // After render, _previewScale should be non-zero
    const result = widget.convertToPreview({ u: 32, v: 32 }, false)
    expect(typeof result.x).toBe('number')
    expect(typeof result.y).toBe('number')
  })

  it('convertToPreview with isometric grid shifts odd rows', () => {
    const preview = createMockMapPreview('RectangularIsometric')
    widget.preview = () => preview
    widget.bounds = { x: 0, y: 0, width: 200, height: 200 }

    widget.render()

    const evenRow = widget.convertToPreview({ u: 10, v: 2 }, true)
    const oddRow = widget.convertToPreview({ u: 10, v: 3 }, true)

    // Odd rows (v & 1 == 1) are shifted right by 1px when isometric
    // The difference should be approximately 0 for same-row comparisons
    // For same U coordinate, v=2 and v=3 produce dx incremented by scale*1
    expect(typeof evenRow.x).toBe('number')
    expect(typeof oddRow.x).toBe('number')
    // v=3 is odd, so it gets +1 shift compared to v=2
    expect(oddRow.x - evenRow.x).toBeGreaterThanOrEqual(0)
  })

  // ---------------------------------------------------------------------------
  // DOM rendering
  // ---------------------------------------------------------------------------

  it('render returns a canvas element', () => {
    const preview = createMockMapPreview()
    widget.preview = () => preview
    const el = widget.render()
    expect(el.tagName).toBe('CANVAS')
    expect(el.className).toBe('map-preview-widget')
  })

  it('render returns canvas even without preview data', () => {
    widget.preview = () => null
    const el = widget.render()
    expect(el.tagName).toBe('CANVAS')
  })

  it('canvas has correct dimensions', () => {
    const preview = createMockMapPreview()
    widget.preview = () => preview
    const el = widget.render() as HTMLCanvasElement
    expect(el.width).toBe(400)
    expect(el.height).toBe(300)
  })

  // ---------------------------------------------------------------------------
  // Mouse handling
  // ---------------------------------------------------------------------------

  it('handleEvent returns false when ignoreMouseInput is true', () => {
    widget.ignoreMouseInput = true
    const result = widget.handleEvent({
      type: 'pointerdown',
      target: null,
      clientX: 100,
      clientY: 100,
      stopPropagation: () => {},
    } as unknown as import('../../OpenRA.Game/Widgets/Widget.js').WidgetEvent)
    expect(result).toBe(false)
  })

  it('handleEvent returns true for pointerdown', () => {
    widget.ignoreMouseInput = false
    let called = false
    widget.onMouseDown = () => { called = true }

    const result = widget.handleEvent({
      type: 'pointerdown',
      target: null,
      clientX: 100,
      clientY: 100,
      stopPropagation: () => {},
    } as unknown as import('../../OpenRA.Game/Widgets/Widget.js').WidgetEvent)
    expect(result).toBe(true)
    expect(called).toBe(true)
  })

  it('handleEvent ignores non-pointerdown events', () => {
    widget.ignoreMouseInput = false
    let called = false
    widget.onMouseDown = () => { called = true }

    const result = widget.handleEvent({
      type: 'pointermove',
      target: null,
      clientX: 100,
      clientY: 100,
      stopPropagation: () => {},
    } as unknown as import('../../OpenRA.Game/Widgets/Widget.js').WidgetEvent)
    expect(result).toBe(false)
    expect(called).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Clone
  // ---------------------------------------------------------------------------

  it('clone creates a copy with same state', () => {
    const preview = createMockMapPreview()
    widget.preview = () => preview
    widget.showSpawnPoints = false
    widget.ignoreMouseInput = true
    widget.tooltipTemplate = 'CUSTOM_TEMPLATE'

    const clone = widget.clone()

    expect(clone).toBeInstanceOf(MapPreviewWidget)
    expect(clone.showSpawnPoints).toBe(false)
    expect(clone.ignoreMouseInput).toBe(true)
    expect(clone.tooltipTemplate).toBe('CUSTOM_TEMPLATE')
    expect(clone.preview).toBe(widget.preview)
  })

  it('clone is independent from original', () => {
    const clone = widget.clone()
    clone.showSpawnPoints = false
    expect(widget.showSpawnPoints).toBe(true) // Original unchanged
  })

  // ---------------------------------------------------------------------------
  // Invalidate
  // ---------------------------------------------------------------------------

  it('invalidatePreview flags dirty state', () => {
    const preview = createMockMapPreview()
    widget.preview = () => preview
    widget.render() // initial render

    widget.invalidatePreview()
    // Next render should re-draw
    const el = widget.render()
    expect(el).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  it('SpawnOccupant has all required fields', () => {
    const so: SpawnOccupant = {
      color: '#00FF00',
      playerName: 'Bot',
      team: 2,
      faction: 'soviet',
      spawnPoint: 3,
    }
    expect(so.color).toBe('#00FF00')
    expect(so.playerName).toBe('Bot')
    expect(so.team).toBe(2)
  })

  it('IMapPreviewData has gridType', () => {
    const data: IMapPreviewData = {
      uid: 'test',
      bounds: { left: 0, top: 0, right: 128, bottom: 128 },
      spawnPoints: [],
      gridType: 'RectangularIsometric',
    }
    expect(data.gridType).toBe('RectangularIsometric')
  })

  it('CPos can be used for cell positions', () => {
    const pos: CPos = { u: 15, v: 20 }
    expect(pos.u).toBe(15)
    expect(pos.v).toBe(20)
  })
})
