/**
 * MapEditorData.test.ts — MapEditorData migration unit tests
 *
 * Since happy-dom does not support WebGL, no Babylon.js mocking is needed.
 * Tests focus on: creation, JSON serialization/deserialization, state management.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { MapEditorData, MapEditorDataInfo } from './MapEditorData'
import { CPos } from '../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Tests — MapEditorDataInfo
// ---------------------------------------------------------------------------

describe('MapEditorDataInfo', () => {
  it('creates with default config (all empty arrays)', () => {
    const info = new MapEditorDataInfo()
    expect(info.requireTilesets).toEqual([])
    expect(info.excludeTilesets).toEqual([])
    expect(info.categories).toEqual([])
    expect(info.instanceName).toBeUndefined()
  })

  it('creates with specified tilesets and categories', () => {
    const info = new MapEditorDataInfo({
      requireTilesets: ['TEMPERATE', 'SNOW'],
      excludeTilesets: ['DESERT'],
      categories: ['Building', 'Infantry', 'Vehicle'],
    })
    expect(info.requireTilesets).toEqual(['TEMPERATE', 'SNOW'])
    expect(info.excludeTilesets).toEqual(['DESERT'])
    expect(info.categories).toEqual(['Building', 'Infantry', 'Vehicle'])
  })

  it('creates with instanceName for trait disambiguation', () => {
    const info = new MapEditorDataInfo({
      instanceName: 'editorData1',
      categories: ['Defense'],
    })
    expect(info.instanceName).toBe('editorData1')
    expect(info.categories).toEqual(['Defense'])
  })

  it('parses from JSON with all fields', () => {
    const json = {
      instanceName: 'editor',
      requireTilesets: ['TEMPERATE'],
      excludeTilesets: ['DESERT'],
      categories: ['Building', 'Infantry'],
    }
    const info = MapEditorDataInfo.fromJSON(json)
    expect(info.instanceName).toBe('editor')
    expect(info.requireTilesets).toEqual(['TEMPERATE'])
    expect(info.excludeTilesets).toEqual(['DESERT'])
    expect(info.categories).toEqual(['Building', 'Infantry'])
  })

  it('parses from JSON with missing/empty fields using defaults', () => {
    const info = MapEditorDataInfo.fromJSON({})
    expect(info.instanceName).toBeUndefined()
    expect(info.requireTilesets).toEqual([])
    expect(info.excludeTilesets).toEqual([])
    expect(info.categories).toEqual([])
  })

  it('filters non-string values from JSON arrays', () => {
    const json = {
      requireTilesets: ['TEMPERATE', 42, null, 'SNOW'],
      categories: ['A', true, 'B', {}],
    }
    const info = MapEditorDataInfo.fromJSON(json)
    expect(info.requireTilesets).toEqual(['TEMPERATE', 'SNOW'])
    expect(info.categories).toEqual(['A', 'B'])
  })

  it('serializes to JSON (includes non-empty fields only)', () => {
    const info = new MapEditorDataInfo({
      requireTilesets: ['TEMPERATE'],
      categories: ['Building'],
    })
    const json = info.toJSON()
    expect(json.requireTilesets).toEqual(['TEMPERATE'])
    expect(json.categories).toEqual(['Building'])
    expect(json.excludeTilesets).toBeUndefined()
    expect(json.instanceName).toBeUndefined()
  })

  it('serializes empty info to minimal JSON', () => {
    const info = new MapEditorDataInfo()
    const json = info.toJSON()
    expect(Object.keys(json).length).toBe(0)
  })

  it('toJSON returns new arrays (defensive copy)', () => {
    const info = new MapEditorDataInfo({
      requireTilesets: ['TEMPERATE'],
    })
    const json = info.toJSON()
    json.requireTilesets.push('SNOW')
    // Original should be unaffected
    expect(info.requireTilesets).toEqual(['TEMPERATE'])
  })

  it('round-trip: fromJSON(toJSON()) preserves data', () => {
    const original = new MapEditorDataInfo({
      instanceName: 'test',
      requireTilesets: ['TEMPERATE', 'SNOW'],
      excludeTilesets: ['DESERT'],
      categories: ['Building', 'Infantry', 'Vehicle'],
    })
    const json = original.toJSON()
    const restored = MapEditorDataInfo.fromJSON(json)
    expect(restored.instanceName).toBe(original.instanceName)
    expect(restored.requireTilesets).toEqual(original.requireTilesets)
    expect(restored.excludeTilesets).toEqual(original.excludeTilesets)
    expect(restored.categories).toEqual(original.categories)
  })
})

// ---------------------------------------------------------------------------
// Tests — MapEditorData
// ---------------------------------------------------------------------------

describe('MapEditorData', () => {
  let info: MapEditorDataInfo

  beforeEach(() => {
    info = new MapEditorDataInfo({
      requireTilesets: ['TEMPERATE'],
      categories: ['Building'],
    })
  })

  it('creates with default editor state', () => {
    const data = new MapEditorData(info)
    expect(data.info).toBe(info)
    expect(data.editorConfig).toEqual({})
    expect(data.cameraPosition).toBeNull()
    expect(data.selectedTab).toBe('')
  })

  it('stores and retrieves editorConfig', () => {
    const data = new MapEditorData(info)
    data.editorConfig = {
      cameraPosition: new CPos(10, 20),
      selectedTab: 'tiles',
    }
    expect(data.editorConfig.selectedTab).toBe('tiles')
    expect(data.editorConfig.cameraPosition!.X).toBe(10)
    expect(data.editorConfig.cameraPosition!.Y).toBe(20)
  })

  it('stores and retrieves cameraPosition', () => {
    const data = new MapEditorData(info)
    const pos = new CPos(128, 64)
    data.cameraPosition = pos
    expect(data.cameraPosition).toBe(pos)
    expect(data.cameraPosition!.X).toBe(128)
    expect(data.cameraPosition!.Y).toBe(64)
  })

  it('stores and retrieves selectedTab', () => {
    const data = new MapEditorData(info)
    data.selectedTab = 'actors'
    expect(data.selectedTab).toBe('actors')
  })

  it('cameraPosition round-trip: CPos survives store and retrieve', () => {
    const data = new MapEditorData(info)
    const originalPos = new CPos(42, 99)
    data.cameraPosition = originalPos
    const retrieved = data.cameraPosition
    expect(retrieved).not.toBeNull()
    expect(retrieved!.X).toBe(42)
    expect(retrieved!.Y).toBe(99)
  })

  it('selectedTab persistence: string survives store and retrieve', () => {
    const data = new MapEditorData(info)
    data.selectedTab = 'resources'
    expect(data.selectedTab).toBe('resources')
    // Change it
    data.selectedTab = 'tiles'
    expect(data.selectedTab).toBe('tiles')
  })

  it('parses from JSON with editorConfig', () => {
    const json = {
      requireTilesets: ['TEMPERATE'],
      editorConfig: {
        cameraPosition: { x: 30, y: 40 },
        selectedTab: 'actors',
      },
    }
    const data = MapEditorData.fromJSON(json)
    expect(data.editorConfig.cameraPosition).toBeDefined()
    expect(data.editorConfig.selectedTab).toBe('actors')
  })

  it('parses from JSON with top-level cameraPosition (legacy format)', () => {
    const json = {
      cameraPosition: { x: 50, y: 60 },
      selectedTab: 'tiles',
    }
    const data = MapEditorData.fromJSON(json)
    expect(data.cameraPosition).not.toBeNull()
    expect(data.cameraPosition!.X).toBe(50)
    expect(data.cameraPosition!.Y).toBe(60)
    expect(data.selectedTab).toBe('tiles')
  })

  it('parses from empty JSON gracefully', () => {
    const data = MapEditorData.fromJSON({})
    expect(data.info.requireTilesets).toEqual([])
    expect(data.editorConfig).toEqual({})
    expect(data.cameraPosition).toBeNull()
    expect(data.selectedTab).toBe('')
  })

  it('serializes to JSON with editor state', () => {
    const data = new MapEditorData(info)
    const pos = new CPos(15, 25)
    data.cameraPosition = pos
    data.selectedTab = 'buildings'
    data.editorConfig = { selectedTab: 'buildings' }

    const json = data.toJSON()
    expect(json.cameraPosition).toEqual({ x: 15, y: 25 })
    expect(json.selectedTab).toBe('buildings')
    expect(json.editorConfig).toBeDefined()
  })

  it('serializes empty MapEditorData to minimal JSON', () => {
    const emptyInfo = new MapEditorDataInfo()
    const data = new MapEditorData(emptyInfo)
    const json = data.toJSON()
    expect(json.cameraPosition).toBeUndefined()
    expect(json.selectedTab).toBeUndefined()
    expect(json.editorConfig).toBeUndefined()
    expect(Object.keys(json).length).toBe(0)
  })

  it('round-trip: fromJSON(toJSON()) preserves all state', () => {
    const data = new MapEditorData(info)
    const pos = new CPos(7, 8)
    data.cameraPosition = pos
    data.selectedTab = 'vehicles'
    data.editorConfig = {
      cameraPosition: new CPos(7, 8),
      selectedTab: 'vehicles',
    }

    const json = data.toJSON()
    const restored = MapEditorData.fromJSON(json)

    expect(restored.cameraPosition).not.toBeNull()
    expect(restored.cameraPosition!.X).toBe(7)
    expect(restored.cameraPosition!.Y).toBe(8)
    expect(restored.selectedTab).toBe('vehicles')
    // Note: editorConfig restoration also picks up from top-level fields
  })

  it('isEditorTrait returns true (marker for editor-mode-only traits)', () => {
    expect(MapEditorData.isEditorTrait()).toBe(true)
  })

  it('multiple instances are independent', () => {
    const info1 = new MapEditorDataInfo({ categories: ['A'] })
    const info2 = new MapEditorDataInfo({ categories: ['B'] })
    const data1 = new MapEditorData(info1)
    const data2 = new MapEditorData(info2)

    data1.selectedTab = 'tiles'
    data2.selectedTab = 'actors'

    expect(data1.selectedTab).toBe('tiles')
    expect(data2.selectedTab).toBe('actors')
    expect(data1.info).toBe(info1)
    expect(data2.info).toBe(info2)
  })

  it('null cameraPosition is correctly serialized and restored', () => {
    const data = new MapEditorData(info)
    data.cameraPosition = null

    const json = data.toJSON()
    expect(json.cameraPosition).toBeUndefined()

    const restored = MapEditorData.fromJSON(json)
    expect(restored.cameraPosition).toBeNull()
  })

  it('empty selectedTab is not serialized', () => {
    const data = new MapEditorData(info)
    data.selectedTab = ''

    const json = data.toJSON()
    expect(json.selectedTab).toBeUndefined()
  })
})
