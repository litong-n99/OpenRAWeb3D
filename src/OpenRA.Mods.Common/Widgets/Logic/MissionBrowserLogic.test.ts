/** MissionBrowserLogic.test.ts */
import { describe, it, expect, beforeEach } from 'vitest'
import { MissionBrowserLogic } from './MissionBrowserLogic.js'
import { MapClassification, MapStatus, MapVisibility, type MapPreviewStub, type MapCacheStub, type LobbyOptionStub } from './BrowserTypes.js'
import { createRecursiveMockWidget } from './__test_utils.js'

function mp(o: Partial<MapPreviewStub> = {}): MapPreviewStub { return { uid: o.uid || 'm1', title: o.title || 'T', author: o.author || 'A', playerCount: o.playerCount ?? 2, bounds: o.bounds || { width: 64, height: 64 }, status: o.status || MapStatus.Available, class: o.class || MapClassification.System, visibility: o.visibility ?? MapVisibility.MissionSelector, categories: o.categories || ['Allied'], modifiedDate: o.modifiedDate || new Date() } }
const m1 = mp({ uid: 'm1', title: 'Mission 1' }), m2 = mp({ uid: 'm2', title: 'Mission 2' })
const ms: MapCacheStub = { maps: [m1, m2], getMap(u: string) { return [m1, m2].find(m => m.uid === u) }, getMapsByClass() { return [m1, m2] }, getAvailableMaps() { return [m1, m2] } }

describe('MissionBrowserLogic', () => {
  let w = createRecursiveMockWidget('MISSION_BROWSER')
  beforeEach(() => { w = createRecursiveMockWidget('MISSION_BROWSER') })

  it('creates logic', () => { expect(new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } })).toBeDefined() })
  it('selects first map', () => { const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }); expect(l.selectedMap?.uid).toBe('m1') })
  it('selects specified initial map', () => { const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }, null, null, 'm2'); expect(l.selectedMap?.uid).toBe('m2') })
  it('selectMap updates selection', () => { const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }); l.selectMap(m2); expect(l.selectedMap?.uid).toBe('m2') })
  it('setMapDifficulty assigns default', () => { const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }); const o: LobbyOptionStub = { id: 'difficulty', name: 'D', description: null, defaultValue: 'Normal', values: new Map([['Normal', 'Normal']]), isVisible: true, isLocked: false, displayOrder: 0 }; l.setMapDifficulty(o); expect(l.missionOptions.get('difficulty')).toBe('Normal') })
  it('onOptionSelected remembers values', () => { const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }); l.onOptionSelected('difficulty', 'Hard'); expect(l.selectedDifficulty).toBe('Hard') })
  it('startMissionClicked calls onStart', () => { let s = false; const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }, () => { s = true }); l.selectMap(m1); l.startMissionClicked(); expect(s).toBe(true) })
  it('startMissionClicked calls onExit when no map', () => { let e = false; const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }, null, () => { e = true }); l.selectedMap = null; l.startMissionClicked(); expect(e).toBe(true) })
  it('tick does not throw', () => { expect(() => new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }).tick()).not.toThrow() })
  it('dispose works', () => { const l = new MissionBrowserLogic(w, { mapCache: ms, manifest: { id: 'cnc', metadata: { version: '1.0' } } }); l.dispose(); expect(l.disposed).toBe(true) })
})
