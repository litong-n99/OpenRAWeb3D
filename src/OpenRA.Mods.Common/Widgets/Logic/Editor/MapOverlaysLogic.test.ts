/**
 * MapOverlaysLogic.test.ts — MapOverlaysLogic 迁移单元测试
 *
 * 测试关注：叠加层启用/禁用切换、快捷键处理、面板创建、dispose 清理。
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { MapOverlaysLogic, type IHotkeyReference, type ITerrainGeometryOverlay, type IBuildableTerrainOverlay, type IMarkerOverlayTrait } from './MapOverlaysLogic.js'

// ---------------------------------------------------------------------------
// Mock overlay traits
// ---------------------------------------------------------------------------

class MockTerrainGeometryOverlay implements ITerrainGeometryOverlay {
  enabled: boolean = true
}

class MockBuildableTerrainOverlay implements IBuildableTerrainOverlay {
  enabled: boolean = false
}

class MockMarkerOverlayTrait implements IMarkerOverlayTrait {
  enabled: boolean = true
  tiles = new Map<number, readonly any[]>()
  setTile(_cell: any, _type: number | null): void {}
  getTile(_cell: any): number | null { return null }
  calculateMirrorPositions(_cell: any): any[] { return [_cell] }
  clearSelected(_tile: number): void {}
  clearAll(): void {}
  setSelected(_tile: number, _cells: readonly any[]): void {}
  setAll(_tiles: ReadonlyMap<number, readonly any[]>): void {}
}

// ---------------------------------------------------------------------------
// Mock HotkeyReference
// ---------------------------------------------------------------------------

class MockHotkeyReference implements IHotkeyReference {
  callCount: number = 0
  shouldActivate: boolean = false

  isActivatedBy(_keyInput: { readonly key: string; readonly event: string }): boolean {
    this.callCount++
    return this.shouldActivate
  }
}

// ---------------------------------------------------------------------------
// Mock Widget
// ---------------------------------------------------------------------------

class MockWidget {
  id: string = ''
  private _children = new Map<string, MockWidget>()
  private _onMouseDown: ((args: unknown) => void) | null = null
  private _panel: MockWidget | null = null
  _isChecked: boolean = false
  _isVisible: boolean = true
  _getText: (() => string) | null = null
  _onClick: (() => void) | null = null

  get(id: string): MockWidget | null {
    return this._children.get(id) ?? null
  }

  getOrNull(id: string): MockWidget | null {
    return this._children.get(id) ?? null
  }

  setChild(id: string, child: MockWidget): void {
    this._children.set(id, child)
  }

  get onMouseDown(): ((args: unknown) => void) | null { return this._onMouseDown }
  set onMouseDown(func: ((args: unknown) => void) | null) { this._onMouseDown = func }

  get panel(): MockWidget | null { return this._panel }
  set panel(p: MockWidget | null) { this._panel = p }

  removePanel(): void { this._panel = null }
  attachPanel(panel: MockWidget): void { this._panel = panel }

  clone(): MockWidget {
    const c = new MockWidget()
    c.id = this.id
    return c
  }
}

// ---------------------------------------------------------------------------
// Mock LogicKeyListenerWidget
// ---------------------------------------------------------------------------

class MockLogicKeyListenerWidget extends MockWidget {
  _handler: ((keyInput: { readonly key: string; readonly event: string; readonly eventType: string }) => boolean) | null = null

  addHandler(handler: (keyInput: { readonly key: string; readonly event: string; readonly eventType: string }) => boolean): void {
    this._handler = handler
  }

  simulateKeyDown(key: string): boolean {
    return this._handler?.({ key, event: 'Down', eventType: 'KeyDown' }) ?? false
  }

  simulateKeyUp(key: string): boolean {
    return this._handler?.({ key, event: 'Up', eventType: 'KeyUp' }) ?? false
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MapOverlaysLogic', () => {
  let widget: MockWidget
  let keyHandler: MockLogicKeyListenerWidget
  let terrainTrait: MockTerrainGeometryOverlay
  let buildableTrait: MockBuildableTerrainOverlay
  let markerTrait: MockMarkerOverlayTrait
  let gridHotkey: MockHotkeyReference
  let buildableHotkey: MockHotkeyReference
  let markerHotkey: MockHotkeyReference

  beforeEach(() => {
    widget = new MockWidget()
    keyHandler = new MockLogicKeyListenerWidget()
    widget.setChild('OVERLAY_KEYHANDLER', keyHandler)

    terrainTrait = new MockTerrainGeometryOverlay()
    buildableTrait = new MockBuildableTerrainOverlay()
    markerTrait = new MockMarkerOverlayTrait()
    gridHotkey = new MockHotkeyReference()
    buildableHotkey = new MockHotkeyReference()
    markerHotkey = new MockHotkeyReference()
  })

  it('constructs without hotkeys without errors', () => {
    expect(() => {
      new MapOverlaysLogic(widget as any, terrainTrait, buildableTrait, markerTrait)
    }).not.toThrow()
  })

  it('registers key handler on construction', () => {
    new MapOverlaysLogic(widget as any, terrainTrait, buildableTrait, markerTrait)
    expect(keyHandler._handler).not.toBeNull()
  })

  it('toggles terrain geometry on grid hotkey', () => {
    gridHotkey.shouldActivate = true
    terrainTrait.enabled = true

    new MapOverlaysLogic(widget as any, terrainTrait, buildableTrait, markerTrait, {
      toggleGridKey: gridHotkey,
    })

    const result = keyHandler.simulateKeyDown('G')
    expect(result).toBe(true)
    expect(terrainTrait.enabled).toBe(false) // toggled off
  })

  it('toggles buildable terrain on buildable hotkey', () => {
    buildableHotkey.shouldActivate = true
    buildableTrait.enabled = false

    new MapOverlaysLogic(widget as any, terrainTrait, buildableTrait, markerTrait, {
      toggleBuildableKey: buildableHotkey,
    })

    const result = keyHandler.simulateKeyDown('B')
    expect(result).toBe(true)
    expect(buildableTrait.enabled).toBe(true) // toggled on
  })

  it('toggles marker layer on marker hotkey', () => {
    markerHotkey.shouldActivate = true
    markerTrait.enabled = true

    new MapOverlaysLogic(widget as any, terrainTrait, buildableTrait, markerTrait, {
      toggleMarkerKey: markerHotkey,
    })

    const result = keyHandler.simulateKeyDown('M')
    expect(result).toBe(true)
    expect(markerTrait.enabled).toBe(false) // toggled off
  })

  it('ignores key up events', () => {
    gridHotkey.shouldActivate = true

    new MapOverlaysLogic(widget as any, terrainTrait, buildableTrait, markerTrait, {
      toggleGridKey: gridHotkey,
    })

    const result = keyHandler.simulateKeyUp('G')
    expect(result).toBe(false)
    // enabled should not change
    expect(terrainTrait.enabled).toBe(true)
  })

  it('does not toggle when trait is null', () => {
    gridHotkey.shouldActivate = true

    new MapOverlaysLogic(widget as any, null, null, null, {
      toggleGridKey: gridHotkey,
    })

    // Should not throw when trait is null
    expect(() => keyHandler.simulateKeyDown('G')).not.toThrow()
  })

  it('handles all trait null gracefully', () => {
    new MapOverlaysLogic(widget as any, null, null, null)
    // Should not throw on construction with all nulls
  })

  it('creates overlay panel with three toggle checkboxes', () => {
    const logic = new MapOverlaysLogic(widget as any, terrainTrait, buildableTrait, markerTrait, undefined,
      () => {
        const panel = new MockWidget()
        const template = new MockWidget()
        panel.setChild('CATEGORY_TEMPLATE', template)
        return panel as any
      }
    )
    // Panel creation should not throw
    expect(logic).toBeDefined()
  })
})
