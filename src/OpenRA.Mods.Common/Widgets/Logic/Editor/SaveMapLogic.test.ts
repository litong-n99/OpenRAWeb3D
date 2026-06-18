/**
 * SaveMapLogic.test.ts -- SaveMapLogic migration unit tests
 *
 * Since happy-dom does not support WebGL, @babylonjs/core modules are mocked.
 * Tests focus on: state management, widget wiring, validation logic,
 * overwrite detection, error handling, and lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules before any imports
// ---------------------------------------------------------------------------

vi.mock('@babylonjs/core', () => ({
  Engine: vi.fn(),
  Scene: vi.fn(),
}))

// Mock ConfirmationDialogs to prevent DOM side effects
vi.mock('../../../Widgets/ConfirmationDialogs.js', () => ({
  ConfirmationDialogs: {
    buttonPrompt: vi.fn(),
    textInputPrompt: vi.fn(),
    OVERLAY_CLASS: 'modal-overlay',
    DIALOG_CLASS: 'modal-dialog',
  },
}))

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import {
  SaveMapLogic,
  MapFileType,
} from './SaveMapLogic.js'
import { ConfirmationDialogs } from '../../../Widgets/ConfirmationDialogs.js'
import { Ui } from '../../../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Set up Ui mocks for all constructor tests
// ---------------------------------------------------------------------------

const originalLoadWidget = Ui.loadWidget
const originalCloseWindow = Ui.closeWindow

beforeEach(() => {
  // Mock Ui.loadWidget to return a panel widget
  Ui.loadWidget = vi.fn((_id: string, _parent: any, _args: any) => {
    // Return a widget with children for visibility panel
    const panel: any = {
      id: _id,
      children: [],
      parent: null,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      logic: [],
      logicObjects: [],
      get<T>(id: string): T {
        if (id === 'VISIBILITY_TEMPLATE') {
          return {
            id,
            isChecked: vi.fn(() => false),
            onClick: vi.fn(),
            getText: vi.fn(() => ''),
            clone() { return { ...this, onClick: vi.fn(), getText: vi.fn(), isChecked: vi.fn() } },
            addChild: vi.fn(),
            removeChildren: vi.fn(),
            children: [],
            parent: null,
            bounds: { x: 0, y: 0, width: 100, height: 20 },
          } as any
        }
        throw new Error(`No child ${id}`)
      },
      addChild: vi.fn(),
      removeChildren: vi.fn(),
      clone: vi.fn(),
      render: vi.fn(),
      tick: vi.fn(),
      tickOuter: vi.fn(),
      isVisible: vi.fn(() => true),
      visible: true,
    }
    return panel
  }) as any

  Ui.closeWindow = vi.fn() as any
})

afterEach(() => {
  Ui.loadWidget = originalLoadWidget
  Ui.closeWindow = originalCloseWindow
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Test helpers -- mock widget factories
// ---------------------------------------------------------------------------

/** Create a minimal mock TextFieldWidget. */
function mockTextField(text = ''): any {
  let _text = text
  return {
    id: '',
    get text() { return _text },
    set text(v: string) { _text = v },
    get _text() { return _text },
    set _text(v: string) { _text = v },
    takeKeyboardFocus: vi.fn(),
    getText: null as (() => string) | null,
    setText: null as ((v: string) => void) | null,
    removeInvalidCharacters: vi.fn((v: string) => v),
  }
}

/** Create a minimal mock ButtonWidget. */
function mockButton(): any {
  return {
    id: '',
    isDisabled: vi.fn(() => false),
    onClick: vi.fn(),
    onMouseDown: vi.fn(),
    getText: vi.fn(() => ''),
    isVisible: vi.fn(() => true),
    clone: vi.fn(),
    addChild: vi.fn(),
    removeChildren: vi.fn(),
    attachPanel: vi.fn(),
    removePanel: vi.fn(),
    showDropDown: vi.fn(),
    children: [],
    parent: null,
    bounds: { x: 0, y: 0, width: 200, height: 30 },
  }
}

/** Create a minimal mock DropDownButtonWidget. */
function mockDropdown(): any {
  return {
    ...mockButton(),
    showDropDown: vi.fn(),
    attachPanel: vi.fn(),
    removePanel: vi.fn(),
    getText: vi.fn(() => ''),
    onMouseDown: vi.fn(),
    onClick: vi.fn(),
  }
}

/** Create a mock Widget that holds child widgets by ID. */
function mockRootWidget(children: Record<string, any> = {}): any {
  return {
    id: 'SAVE_MAP_PANEL',
    children: Object.values(children),
    parent: null,
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    logic: [],
    logicObjects: [],
    get<T>(id: string): T {
      if (children[id]) return children[id] as T
      throw new Error(`Widget has no child ${id}`)
    },
    getOrNull<T>(_id: string): T | null {
      return (children[_id] as T) ?? null
    },
    addChild: vi.fn(),
    removeChildren: vi.fn(),
    clone: vi.fn(),
    render: vi.fn(() => document.createElement('div')),
    tick: vi.fn(),
    tickOuter: vi.fn(),
    isVisible: vi.fn(() => true),
    visible: true,
    removePanel: vi.fn(),
    attachPanel: vi.fn(),
    showDropDown: vi.fn(),
  }
}

/** Create a minimal mock Map. */
function mockMap(overrides: Record<string, any> = {}): any {
  return {
    title: 'Test Map',
    author: 'Test Author',
    tileset: 'TEMPERATE',
    visibility: 1, // Lobby
    requiresMod: 'test',
    mapFormat: 11,
    mapSize: { width: 64, height: 64 },
    bounds: { Left: 0, Top: 0, Right: 63, Bottom: 63 },
    lockPreview: false,
    categories: ['Conquest'],
    toJSON() {
      return {
        mapFormat: this.mapFormat,
        requiresMod: this.requiresMod,
        title: this.title,
        author: this.author,
        tileset: this.tileset,
        lockPreview: this.lockPreview,
        bounds: {
          left: this.bounds.Left,
          top: this.bounds.Top,
          right: this.bounds.Right,
          bottom: this.bounds.Bottom,
        },
        visibility: this.visibility,
        categories: this.categories,
        mapSize: { width: this.mapSize.width, height: this.mapSize.height },
        binaryData: 'base64data',
      }
    },
    ...overrides,
  }
}

/** Create a minimal mock ModData. */
function mockModData(overrides: Record<string, any> = {}): any {
  return {
    mapCache: null,
    manifest: { id: 'test-mod' },
    objectCreator: { createObject: vi.fn() },
    ...overrides,
  }
}

/** Create a minimal mock EditorActionManager. */
function mockActionManager(): any {
  return {
    Modified: false,
    SaveFailed: false,
    HasUndos: vi.fn(() => false),
    HasRedos: vi.fn(() => false),
    Add: vi.fn(),
    Undo: vi.fn(),
    Redo: vi.fn(),
    dispose: vi.fn(),
    undoStack: [],
    redoStack: [],
    onItemAdded: vi.fn(),
    onItemRemoved: vi.fn(),
    onChange: vi.fn(),
    offItemAdded: vi.fn(),
    offItemRemoved: vi.fn(),
    offChange: vi.fn(),
    worldLoaded: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Tests: MapFileType enum
// ---------------------------------------------------------------------------

describe('MapFileType', () => {
  it('defines Unpacked and OraMap', () => {
    expect(MapFileType.Unpacked).toBe(0)
    expect(MapFileType.OraMap).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tests: SaveMapLogic constructor and widget wiring
// ---------------------------------------------------------------------------

describe('SaveMapLogic constructor', () => {
  let titleField: any
  let authorField: any
  let filenameField: any
  let visibilityDropdown: any
  let directoryDropdown: any
  let typeDropdown: any
  let backButton: any
  let saveButton: any
  let rootWidget: any
  let map: any
  let modData: any
  let onSave: ReturnType<typeof vi.fn>
  let onExit: ReturnType<typeof vi.fn>
  let actionManager: any

  beforeEach(() => {
    titleField = mockTextField()
    authorField = mockTextField()
    filenameField = mockTextField()
    visibilityDropdown = mockDropdown()
    directoryDropdown = mockDropdown()
    typeDropdown = mockDropdown()
    backButton = mockButton()
    saveButton = mockButton()

    rootWidget = mockRootWidget({
      TITLE: titleField,
      AUTHOR: authorField,
      VISIBILITY_DROPDOWN: visibilityDropdown,
      DIRECTORY_DROPDOWN: directoryDropdown,
      FILENAME: filenameField,
      TYPE_DROPDOWN: typeDropdown,
      BACK_BUTTON: backButton,
      SAVE_BUTTON: saveButton,
    })

    map = mockMap()
    modData = mockModData()
    onSave = vi.fn()
    onExit = vi.fn()
    actionManager = mockActionManager()
  })

  // -----------------------------------------------------------------------
  // Field initialization
  // -----------------------------------------------------------------------

  it('populates title field from map', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager)
    expect(titleField.text).toBe('Test Map')
    logic.dispose()
  })

  it('populates author field from map', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager)
    expect(authorField.text).toBe('Test Author')
    logic.dispose()
  })

  it('clears filename when no package name provided', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager, null, false)
    expect(filenameField.text).toBe('')
    expect(filenameField.takeKeyboardFocus).toHaveBeenCalled()
    logic.dispose()
  })

  it('pre-populates filename from package name (ZIP format)', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager, '/maps/test/mymap.oramap', false)
    expect(filenameField.text).toBe('mymap')
    logic.dispose()
  })

  it('pre-populates filename from package name (unpacked format)', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager, '/maps/test/mymap', true)
    expect(filenameField.text).toBe('mymap')
    logic.dispose()
  })

  // -----------------------------------------------------------------------
  // Save button disabled state
  // -----------------------------------------------------------------------

  it('disables save button when fields are empty', () => {
    titleField.text = ''
    authorField.text = ''
    filenameField.text = ''
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager, null, false)
    expect(saveButton.isDisabled()).toBe(true)
    logic.dispose()
  })

  it('enables save button when all fields are filled', () => {
    // Constructor sets title/author from map, so override after construction
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager, null, false)
    titleField.text = 'My Map'
    authorField.text = 'Me'
    filenameField.text = 'mymap'
    expect(saveButton.isDisabled()).toBe(false)
    logic.dispose()
  })

  it('disables save button when title is whitespace only', () => {
    titleField.text = '   '
    authorField.text = 'Me'
    filenameField.text = 'mymap'
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager)
    expect(saveButton.isDisabled()).toBe(true)
    logic.dispose()
  })

  // -----------------------------------------------------------------------
  // Back button
  // -----------------------------------------------------------------------

  it('back button triggers onExit callback', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager)
    backButton.onClick()
    expect(onExit).toHaveBeenCalledOnce()
    logic.dispose()
  })

  // -----------------------------------------------------------------------
  // File type defaults
  // -----------------------------------------------------------------------

  it('defaults to OraMap file type when not unpacked', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager, null, false)
    expect((logic as any)._fileType).toBe(MapFileType.OraMap)
    logic.dispose()
  })

  it('defaults to Unpacked file type when map is unpacked', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager, null, true)
    expect((logic as any)._fileType).toBe(MapFileType.Unpacked)
    logic.dispose()
  })

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  it('dispose clears internal state', () => {
    const logic = new SaveMapLogic(rootWidget, modData, map, onSave, onExit, actionManager)
    logic.dispose()
    expect((logic as any)._writableDirectories).toEqual([])
    expect((logic as any)._selectedDirectory).toBeNull()
    expect((logic as any)._fileTypes.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: SaveMapLogic.SaveMap (static) -- overwrite detection
// ---------------------------------------------------------------------------

describe('SaveMapLogic.SaveMap', () => {
  let map: any
  let actionManager: any
  let saveMapCallback: ReturnType<typeof vi.fn>

  beforeEach(() => {
    map = mockMap()
    actionManager = mockActionManager()
    saveMapCallback = vi.fn()
    ;(ConfirmationDialogs.buttonPrompt as any).mockClear()
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls saveMap directly when no mapCache and no conflict', () => {
    const modData = mockModData({ mapCache: null })
    SaveMapLogic.SaveMap(modData, map, '/maps/new.oramap', null, actionManager, saveMapCallback)
    expect(saveMapCallback).toHaveBeenCalledWith('/maps/new.oramap')
    expect(actionManager.SaveFailed).toBe(false)
  })

  it('calls saveMap directly when path differs but no existing map', () => {
    // Create MapCache mock that yields no matching maps
    const mapCacheMock = {
      [Symbol.iterator]() {
        let done = false
        return {
          next() {
            if (done) return { done: true, value: undefined }
            done = true
            return { done: false, value: { status: 0, path: '/maps/other.oramap', uid: 'other' } }
          },
        }
      },
      getUpdatedMap: vi.fn(() => null),
      get: vi.fn(),
      mapLocations: new Map(),
    }
    const modData = mockModData({ mapCache: mapCacheMock })

    SaveMapLogic.SaveMap(modData, map, '/maps/new.oramap', '/maps/old.oramap', actionManager, saveMapCallback)

    expect(saveMapCallback).toHaveBeenCalledWith('/maps/new.oramap')
  })

  it('shows overwrite dialog when target path matches existing map', () => {
    // Create MapCache mock that yields a matching map at the target path
    const existingMapPreview = {
      status: 2, // MapStatus.Available
      path: '/maps/existing.oramap',
      uid: 'map:/maps/existing.oramap',
    }
    const mapCacheMock = {
      [Symbol.iterator]() {
        let yielded = false
        return {
          next() {
            if (yielded) return { done: true, value: undefined }
            yielded = true
            return { done: false, value: existingMapPreview }
          },
        }
      },
      getUpdatedMap: vi.fn(() => null),
      get: vi.fn(),
      mapLocations: new Map(),
    }
    const modData = mockModData({ mapCache: mapCacheMock })

    SaveMapLogic.SaveMap(
      modData, map,
      '/maps/existing.oramap', // combinedPath
      '/maps/old.oramap',      // mapPackageName (differs from combinedPath)
      actionManager,
      saveMapCallback,
    )

    // Should detect conflict and NOT call saveMap
    expect(saveMapCallback).not.toHaveBeenCalled()
    expect(actionManager.SaveFailed).toBe(true)
    expect(ConfirmationDialogs.buttonPrompt).toHaveBeenCalledOnce()
  })

  it('shows external modification warning when UID changed', () => {
    const recentUid = 'map:/maps/same-name.oramap:updated'
    const mapCacheMock = {
      [Symbol.iterator]() {
        return { next: () => ({ done: true, value: undefined }) }
      },
      getUpdatedMap: vi.fn((uid: string) =>
        uid === 'map:/maps/same-name.oramap' ? recentUid : null,
      ),
      get: vi.fn((key: string) => ({
        status: 2, // MapStatus.Available
        path: '/maps/same-name.oramap',
        uid: key,
      })),
      mapLocations: new Map(),
    }
    const modData = mockModData({ mapCache: mapCacheMock })

    SaveMapLogic.SaveMap(
      modData, map,
      '/maps/same-name.oramap',       // combinedPath
      '/maps/same-name.oramap',       // mapPackageName (same as combinedPath)
      actionManager,
      saveMapCallback,
    )

    expect(mapCacheMock.getUpdatedMap).toHaveBeenCalledWith('map:/maps/same-name.oramap')
    expect(saveMapCallback).not.toHaveBeenCalled()
    expect(actionManager.SaveFailed).toBe(true)
    expect(ConfirmationDialogs.buttonPrompt).toHaveBeenCalledOnce()
  })

  it('handles undefined actionManager without error', () => {
    const modData = mockModData({ mapCache: null })
    expect(() => {
      SaveMapLogic.SaveMap(modData, map, '/maps/new.oramap', null, undefined, saveMapCallback)
    }).not.toThrow()
    expect(saveMapCallback).toHaveBeenCalledWith('/maps/new.oramap')
  })
})

// ---------------------------------------------------------------------------
// Tests: SaveMapLogic.SaveMapInner (static) -- core save
// ---------------------------------------------------------------------------

describe('SaveMapLogic.SaveMapInner', () => {
  let map: any
  let modData: any
  let actionManager: any

  beforeEach(() => {
    map = mockMap()
    actionManager = mockActionManager()
    modData = mockModData()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes map and resets Modified flag', () => {
    const toJsonSpy = vi.spyOn(map, 'toJSON')
    SaveMapLogic.SaveMapInner(map, null, modData, actionManager)
    expect(toJsonSpy).toHaveBeenCalled()
    expect(actionManager.Modified).toBe(false)
  })

  it('handles save error and logs failure', () => {
    const faultyMap = mockMap({ toJSON() { throw new Error('Serialization failed') } })
    SaveMapLogic.SaveMapInner(faultyMap, null, modData, actionManager)
    expect(console.debug).toHaveBeenCalledWith('Failed to save map.')
  })

  it('succeeds with undefined actionManager', () => {
    const toJsonSpy = vi.spyOn(map, 'toJSON')
    SaveMapLogic.SaveMapInner(map, null, modData, undefined)
    expect(toJsonSpy).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Tests: SaveMapLogic.SaveMapFailed (static) -- error handling
// ---------------------------------------------------------------------------

describe('SaveMapLogic.SaveMapFailed', () => {
  let modData: any
  let actionManager: any

  beforeEach(() => {
    modData = mockModData()
    actionManager = mockActionManager()
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    ;(ConfirmationDialogs.buttonPrompt as any).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets SaveFailed on action manager and logs error', () => {
    const error = new Error('Test error')
    SaveMapLogic.SaveMapFailed(error, modData, actionManager)
    expect(actionManager.SaveFailed).toBe(true)
    expect(console.debug).toHaveBeenCalledWith('Failed to save map.')
    expect(console.debug).toHaveBeenCalledWith(error)
    expect(ConfirmationDialogs.buttonPrompt).toHaveBeenCalled()
  })

  it('handles undefined actionManager gracefully', () => {
    const error = new Error('Test error')
    expect(() => SaveMapLogic.SaveMapFailed(error, modData, undefined)).not.toThrow()
    expect(console.debug).toHaveBeenCalledWith('Failed to save map.')
  })
})

// ---------------------------------------------------------------------------
// Tests: SaveMapLogic.SaveMapMarkerTiles (static) -- deferred stub
// ---------------------------------------------------------------------------

describe('SaveMapLogic.SaveMapMarkerTiles', () => {
  it('is a no-op stub (deferred feature)', () => {
    expect(() => {
      SaveMapLogic.SaveMapMarkerTiles(mockMap(), mockModData(), undefined)
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests: SaveMapLogic static constants
// ---------------------------------------------------------------------------

describe('SaveMapLogic static constants', () => {
  it('exposes all localized string constants', () => {
    expect(SaveMapLogic.SAVE_MAP_FAILED_TITLE).toBe('Save Map Failed')
    expect(SaveMapLogic.SAVE_MAP_FAILED_PROMPT).toBe('The map could not be saved.')
    expect(SaveMapLogic.SAVE_MAP_FAILED_CONFIRM).toBe('OK')
    expect(SaveMapLogic.UNPACKED_LABEL).toBe('Unpacked Map')
    expect(SaveMapLogic.OVERWRITE_MAP_FAILED_TITLE).toBe('Overwrite Map')
    expect(SaveMapLogic.OVERWRITE_MAP_FAILED_PROMPT).toBe('A map with this name already exists. Overwrite?')
    expect(SaveMapLogic.OVERWRITE_MAP_FAILED_CONFIRM).toBe('Overwrite')
    expect(SaveMapLogic.OVERWRITE_MAP_OUTSIDE_EDIT_TITLE).toBe('Map Modified Externally')
    expect(SaveMapLogic.OVERWRITE_MAP_OUTSIDE_EDIT_PROMPT).toBe('This map has been modified outside the editor. Save anyway?')
    expect(SaveMapLogic.SAVE_MAP_OUTSIDE_CONFIRM).toBe('Save')
    expect(SaveMapLogic.SAVE_CURRENT_MAP).toBe('Map saved.')
  })
})

// ---------------------------------------------------------------------------
// Tests: ChromeLogic lifecycle
// ---------------------------------------------------------------------------

describe('SaveMapLogic lifecycle', () => {
  it('tick is a no-op', () => {
    const rootWidget = mockRootWidget({
      TITLE: mockTextField('T'), AUTHOR: mockTextField('A'),
      VISIBILITY_DROPDOWN: mockDropdown(), DIRECTORY_DROPDOWN: mockDropdown(),
      FILENAME: mockTextField('F'), TYPE_DROPDOWN: mockDropdown(),
      BACK_BUTTON: mockButton(), SAVE_BUTTON: mockButton(),
    })
    const logic = new SaveMapLogic(rootWidget, mockModData(), mockMap(), vi.fn(), vi.fn(), mockActionManager())
    expect(() => logic.tick()).not.toThrow()
    logic.dispose()
  })
})
