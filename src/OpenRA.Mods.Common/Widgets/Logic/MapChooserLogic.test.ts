/** MapChooserLogic.test.ts */
import { describe, it, expect, beforeEach } from 'vitest'
import { MapChooserLogic } from './MapChooserLogic.js'
import { MapClassification, MapStatus, MapVisibility, type MapPreviewStub, type MapCacheStub } from './BrowserTypes.js'
import { createRecursiveMockWidget } from './__test_utils.js'

function mp(o: Partial<MapPreviewStub> = {}): MapPreviewStub { return { uid: o.uid || 'map-1', title: o.title || 'T', author: o.author || 'A', playerCount: o.playerCount ?? 4, bounds: o.bounds || { width: 80, height: 80 }, status: o.status || MapStatus.Available, class: o.class || MapClassification.System, visibility: o.visibility ?? (MapVisibility.Lobby | MapVisibility.Shellmap), categories: o.categories || ['Conquest'], modifiedDate: o.modifiedDate || new Date('2024-01-01') } }
function mc(maps: MapPreviewStub[] = []): MapCacheStub { return { maps, getMap(u: string) { return maps.find(m => m.uid === u) }, getMapsByClass(c: MapClassification) { return maps.filter(m => m.class === c) }, getAvailableMaps() { return maps.filter(m => m.status === MapStatus.Available) } } }

const sm1 = mp({ uid: 'sys-1', title: 'Alpine Valley', class: MapClassification.System, playerCount: 8, bounds: { width: 120, height: 120 } })
const sm2 = mp({ uid: 'sys-2', title: 'Barren Lands', class: MapClassification.System, playerCount: 4, bounds: { width: 60, height: 60 } })
const um1 = mp({ uid: 'usr-1', title: 'My Map', class: MapClassification.User, playerCount: 6, bounds: { width: 90, height: 90 } })

describe('MapChooserLogic', () => {
  let w = createRecursiveMockWidget('MAP_CHOOSER')
  let cache: MapCacheStub
  let mdata: { mapCache: MapCacheStub; manifest: { id: string; metadata: { version: string } } }
  beforeEach(() => { w = createRecursiveMockWidget('MAP_CHOOSER'); cache = mc([sm1, sm2, um1]); mdata = { mapCache: cache, manifest: { id: 'test', metadata: { version: '1.0' } } } })

  it('creates with defaults', () => { expect(new MapChooserLogic(w, mdata, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null)).toBeDefined() })
  it('uses initial map UID', () => { const l = new MapChooserLogic(w, mdata, 'sys-1', MapClassification.System, () => {}, () => {}, null, MapVisibility.None, null); expect(l.selectedUid).toBe('sys-1') })
  it('switchTab changes tab', () => { const l = new MapChooserLogic(w, mdata, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null); l.switchTab(MapClassification.User); expect(l.currentTab).toBe(MapClassification.User) })
  it('refreshMaps populates system maps', () => { const l = new MapChooserLogic(w, mdata, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null); l.refreshMaps(MapClassification.System); expect(l.tabMaps.get(MapClassification.System)!.length).toBeGreaterThan(0) })
  it('enumerateMaps populates visibleMapUids', () => { const l = new MapChooserLogic(w, mdata, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null); l.enumerateMaps(MapClassification.System); expect(l.visibleMapUids.length).toBeGreaterThan(0) })
  it('filters by name search', () => { const l = new MapChooserLogic(w, mdata, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null); l.mapFilter = 'Alpine'; l.enumerateMaps(MapClassification.System); expect(l.visibleMapUids).toContain('sys-1'); expect(l.visibleMapUids).not.toContain('sys-2') })
  it('skips generated tab enumeration', () => { const l = new MapChooserLogic(w, mdata, null, MapClassification.Generated, () => {}, null, () => {}, MapVisibility.None, null); const b = [...l.visibleMapUids]; l.enumerateMaps(MapClassification.Generated); expect(l.visibleMapUids).toEqual(b) })
  it('mapSizeLabel size strings', () => { expect(MapChooserLogic.mapSizeLabel({ width: 120, height: 120 })).toContain('120x120'); expect(MapChooserLogic.mapSizeLabel({ width: 30, height: 30 })).toContain('30x30') })
  it('deleteMap changes selectedUid', () => { const l = new MapChooserLogic(w, mdata, 'sys-2', MapClassification.System, () => {}, null, null, MapVisibility.None, null); l.tabMaps.set(MapClassification.System, [sm1, sm2]); expect(l.deleteMap('sys-2')).not.toBe('sys-2') })
  it('deleteOneMap calls after', () => { const l = new MapChooserLogic(w, mdata, 'usr-1', MapClassification.User, () => {}, null, null, MapVisibility.None, null); l.tabMaps.set(MapClassification.User, [um1]); let c = false; l.deleteOneMap('usr-1', () => { c = true }); expect(c).toBe(true) })
  it('tick does not throw', () => { expect(() => new MapChooserLogic(w, mdata, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null).tick()).not.toThrow() })
  it('dispose sets disposed', () => { const l = new MapChooserLogic(w, mdata, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null); l.dispose(); expect(l.disposed).toBe(true) })
  it('handles empty cache', () => { const em = { mapCache: mc([]), manifest: { id: 'test', metadata: { version: '1.0' } } }; const l = new MapChooserLogic(w, em, null, MapClassification.System, () => {}, null, null, MapVisibility.None, null); expect(l.visibleMapUids).toEqual([]) })
  it('handles null callbacks', () => { expect(new MapChooserLogic(w, mdata, null, MapClassification.System, null, null, null, MapVisibility.None, null)).toBeDefined() })
})
