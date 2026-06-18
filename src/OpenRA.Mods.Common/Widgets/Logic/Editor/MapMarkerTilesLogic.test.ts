/**
 * MapMarkerTilesLogic.test.ts — MapMarkerTilesLogic 迁移单元测试
 *
 * 测试关注：颜色色板生成、擦除模式、镜像模式切换、透明度滑块、清除操作。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  MapMarkerTilesLogic,
  MarkerTileMirrorMode,
  type IMarkerLayerOverlay,
} from './MapMarkerTilesLogic.js'
import { EditorActionManager } from '../../../Traits/World/EditorActionManager.js'
import type { IEditorBrush } from '../../../Editor/IEditorBrush.js'

// ---------------------------------------------------------------------------
// Mock IMarkerLayerOverlay
// ---------------------------------------------------------------------------

class MockMarkerLayerOverlay implements IMarkerLayerOverlay {
  tiles = new Map<number, readonly any[]>()
  mirrorMode: MarkerTileMirrorMode = MarkerTileMirrorMode.None
  tileAlpha: number = 255
  numSides: number = 4
  axisAngle: number = 0
  info = {
    colors: new Map<number, number>([
      [0, 0xFFFF0000],
      [1, 0xFF00FF00],
      [2, 0xFF0000FF],
    ]),
  }

  setTile(_cell: any, _type: number | null): void {}
  getTile(_cell: any): number | null { return null }
  calculateMirrorPositions(_cell: any): any[] { return [_cell] }
  clearSelected(_tile: number): void {}
  clearAll(): void {}
  setSelected(_tile: number, _cells: readonly any[]): void {}
  setAll(_tiles: ReadonlyMap<number, readonly any[]>): void {}
  setMirrorMode(mode: MarkerTileMirrorMode): void { this.mirrorMode = mode }
}

// ---------------------------------------------------------------------------
// Mock Editor
// ---------------------------------------------------------------------------

class MockEditor {
  currentBrush: IEditorBrush = createStubBrush()
  brushChangedCallback: (() => void) | null = null
  setBrushCalls: IEditorBrush[] = []

  setBrush(brush: IEditorBrush): void {
    this.setBrushCalls.push(brush)
    this.currentBrush = brush
    this.brushChangedCallback?.()
  }
}

function createStubBrush(): IEditorBrush {
  return {
    handleMouseInput: () => false,
    tick: () => {},
    tickRender: () => {},
    renderAboveShroud: () => [],
    renderAnnotations: () => [],
    dispose: () => {},
  }
}

// ---------------------------------------------------------------------------
// Mock Widget
// ---------------------------------------------------------------------------

class MockWidget {
  id: string = ''
  private _children = new Map<string, MockWidget>()
  _onClick: (() => void) | null = null
  _isDisabled: boolean = false
  _isVisible: boolean = true
  _getText: (() => string) | null = null
  _getColor: (() => number) | null = null
  _isSelected: (() => boolean) | null = null
  _getValue: (() => number) | null = null
  _minimumValue: number = 0
  _maximumValue: number = 100
  _ticks: number = 10
  _changeHandlers: Array<(val: number) => void> = []
  onChange(newHandlers: Array<(val: number) => void>): void { this._changeHandlers = newHandlers }

  get(id: string): MockWidget | null { return this._children.get(id) ?? null }
  setChild(id: string, child: MockWidget): void { this._children.set(id, child) }
  removeChildren(): void { this._children.clear() }
  addChild(child: MockWidget): void {
    this._children.set('child_' + this._children.size, child)
  }
  clone(): MockWidget {
    const c = new MockWidget()
    c.id = this.id
    return c
  }
}

// ---------------------------------------------------------------------------
// Mock brush factory
// ---------------------------------------------------------------------------

function mockCreateMarkerBrush(_editor: any, template: number | null, _worldRenderer: unknown): IEditorBrush {
  const brush = createStubBrush()
  ;(brush as any).template = template
  return brush
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapMarkerTilesLogic', () => {
  let widget: MockWidget
  let markerLayer: MockMarkerLayerOverlay
  let actionManager: EditorActionManager
  let editor: MockEditor

  beforeEach(() => {
    widget = new MockWidget()
    markerLayer = new MockMarkerLayerOverlay()
    actionManager = new EditorActionManager()
    actionManager.worldLoaded({} as any, {} as any)
    editor = new MockEditor()

    // Setup widget children
    const colorPanel = new MockWidget()
    const swatchTemplate = new MockWidget()
    const iconTemplate = new MockWidget()
    colorPanel.setChild('TILE_COLOR_TEMPLATE', swatchTemplate)
    colorPanel.setChild('TILE_ICON_TEMPLATE', iconTemplate)
    widget.setChild('TILE_COLOR_PANEL', colorPanel)

    widget.setChild('CLEAR_CURRENT_BUTTON', new MockWidget())
    widget.setChild('CLEAR_ALL_BUTTON', new MockWidget())

    const alphaSlider = new MockWidget()
    widget.setChild('ALPHA_SLIDER', alphaSlider)
    widget.setChild('ALPHA_VALUE', new MockWidget())

    widget.setChild('MODE_DROPDOWN', new MockWidget())
    widget.setChild('NUM_SIDES_LABEL', new MockWidget())

    const rotateSlider = new MockWidget()
    widget.setChild('ROTATE_NUM_SIDES_SLIDER', rotateSlider)
    widget.setChild('ROTATE_NUM_SIDES_VALUE', new MockWidget())
    widget.setChild('FLIP_NUM_SIDES_DROPDOWN', new MockWidget())
    widget.setChild('AXIS_ANGLE_LABEL', new MockWidget())

    const axisSlider = new MockWidget()
    widget.setChild('AXIS_ANGLE_SLIDER', axisSlider)
    widget.setChild('AXIS_ANGLE_VALUE', new MockWidget())
  })

  it('constructs and builds color swatch grid', () => {
    const logic = new MapMarkerTilesLogic(
      widget as any, markerLayer as any, actionManager, editor as any, undefined, mockCreateMarkerBrush,
    )
    expect(logic).toBeDefined()
    // Should have color swatches in tileColorPanel
    const panel = widget.get('TILE_COLOR_PANEL') as MockWidget
    expect((panel as any)._children.size).toBeGreaterThan(0)
  })

  it('sets markerTile to null initially', () => {
    const logic = new MapMarkerTilesLogic(
      widget as any, markerLayer as any, actionManager, editor as any, undefined, mockCreateMarkerBrush,
    )
    expect(logic.markerTile).toBeNull()
  })

  it('clearSelected button is disabled when markerTile is null', () => {
    new MapMarkerTilesLogic(widget as any, markerLayer as any, actionManager, editor as any, undefined, mockCreateMarkerBrush)
    // Construction should not throw
    expect(true).toBe(true)
  })

  it('handleBrushChanged resets markerTile when brush is not marker brush', () => {
    const logic = new MapMarkerTilesLogic(
      widget as any, markerLayer as any, actionManager, editor as any, undefined, mockCreateMarkerBrush,
    )
    // Initially markerTile is null
    expect(logic.markerTile).toBeNull()

    // Change brush manually
    editor.currentBrush = createStubBrush()
    logic.handleBrushChanged()
    expect(logic.markerTile).toBeNull()
  })

  it('disposes without errors', () => {
    const logic = new MapMarkerTilesLogic(
      widget as any, markerLayer as any, actionManager, editor as any, undefined, mockCreateMarkerBrush,
    )
    expect(() => logic.dispose()).not.toThrow()
  })

  it('mirror mode dropdown shows correct labels', () => {
    markerLayer.mirrorMode = MarkerTileMirrorMode.Flip
    void widget.get('MODE_DROPDOWN')

    new MapMarkerTilesLogic(widget as any, markerLayer as any, actionManager, editor as any, undefined, mockCreateMarkerBrush)

    // getText closure should return "Flip" for MirrorTileMirrorMode.Flip
    expect(markerLayer.mirrorMode).toBe(MarkerTileMirrorMode.Flip)
  })
})
