/** LoadGameBrowserLogic.test.ts */
import { describe, it, expect, beforeEach } from 'vitest'
import { LoadGameBrowserLogic } from './LoadGameBrowserLogic.js'
import { SaveType, DateType, DurationType, type GameSaveStub, type MapCacheStub } from './BrowserTypes.js'
import { createRecursiveMockWidget } from './__test_utils.js'

function ms(o: Partial<GameSaveStub> = {}): GameSaveStub { return { path: o.path || '/saves/t.orasav', lastWrite: o.lastWrite || new Date(), creationTime: o.creationTime || new Date(), duration: o.duration ?? { totalMinutes: 15 }, mapTitle: o.mapTitle || 'Test', mapUid: o.mapUid || 'map-1', factions: o.factions || ['gdi'], players: o.players || [], slotClients: o.slotClients || new Map(), globalSettings: o.globalSettings || { map: 'map-1' } } }
const mc: MapCacheStub = { maps: [], getMap() { return undefined }, getMapsByClass() { return [] }, getAvailableMaps() { return [] } }
const md = { mapCache: mc, manifest: { id: 'cnc', metadata: { version: '1.0' } } }

describe('LoadGameBrowserLogic', () => {
  let w = createRecursiveMockWidget('LOAD_ROOT')
  beforeEach(() => { w = createRecursiveMockWidget('LOAD_ROOT'); (LoadGameBrowserLogic as unknown as Record<string, unknown>).filter = undefined })

  it('creates', () => { expect(new LoadGameBrowserLogic(w, md)).toBeDefined() })
  it('loadGames populates', () => { const l = new LoadGameBrowserLogic(w, md); l.loadGames([ms()]); expect(l.saves.length).toBe(1) })
  it('selectSave selects path', () => { const l = new LoadGameBrowserLogic(w, md); const s = ms(); l.loadGames([s]); l.selectSave(s.path); expect(l.selectedPath).toBe(s.path) })
  it('selectSave clears on null', () => { const l = new LoadGameBrowserLogic(w, md); l.loadGames([ms()]); l.selectSave('/saves/t.orasav'); l.selectSave(null); expect(l.selectedPath).toBeNull() })
  it('selectFirstVisible picks first visible', () => { const l = new LoadGameBrowserLogic(w, md); const s1 = ms({ path: '/1.orasav' }), s2 = ms({ path: '/2.orasav' }); l.loadGames([s1, s2]); l.selectFirstVisible(); expect(l.selectedPath).toBe('/1.orasav') })
  it('evaluateSaveVisibility returns true with empty filter', () => {
    ;(LoadGameBrowserLogic as unknown as Record<string, unknown>).filter = { type: SaveType.Any, date: DateType.Any, duration: DurationType.Any, saveName: null, mapName: null, faction: null }
    const e = { path: '/t.orasav', lastWrite: new Date(), creationTime: new Date(), mapTitle: 'T', mapUid: '', factions: [], visible: true, save: null }
    expect(LoadGameBrowserLogic.evaluateSaveVisibility(e)).toBe(true)
  })
  it('applyFilter updates visibility based on autosave filter', () => { const l = new LoadGameBrowserLogic(w, md); l.loadGames([ms({ path: '/autosave-1.orasav' }), ms({ path: '/mysave.orasav' })]); (LoadGameBrowserLogic as unknown as Record<string, unknown>).filter = { type: SaveType.Autosave, date: DateType.Any, duration: DurationType.Any, saveName: null, mapName: null, faction: null }; l.applyFilter(); expect(l.saves[0]!.visible).toBe(true); expect(l.saves[1]!.visible).toBe(false) })
  it('rename updates path', () => { const l = new LoadGameBrowserLogic(w, md); l.loadGames([ms({ path: '/saves/old.orasav' })]); l.selectSave('/saves/old.orasav'); l.rename('old', 'new'); expect(l.saves[0]!.path).toContain('new') })
  it('delete removes', () => { const l = new LoadGameBrowserLogic(w, md); l.loadGames([ms()]); l.delete('/saves/t.orasav'); expect(l.saves.length).toBe(0) })
  it('load calls onStart with selected save', () => { let started = false; const l = new LoadGameBrowserLogic(w, md, null, () => { started = true }); const s = ms(); l.loadGames([s]); l.selectSave(s.path); l.load(); expect(started).toBe(true) })
  it('load no-op when no save selected', () => { let started = false; const l = new LoadGameBrowserLogic(w, md, null, () => { started = true }); l.load(); expect(started).toBe(false) })
  it('tick does not throw', () => { expect(() => new LoadGameBrowserLogic(w, md).tick()).not.toThrow() })
  it('dispose works', () => { const l = new LoadGameBrowserLogic(w, md); l.dispose(); expect(l.disposed).toBe(true) })
})
