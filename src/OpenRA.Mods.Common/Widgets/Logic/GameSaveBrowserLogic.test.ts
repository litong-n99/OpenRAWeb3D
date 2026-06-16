/** GameSaveBrowserLogic.test.ts */
import { describe, it, expect, beforeEach } from 'vitest'
import { GameSaveBrowserLogic } from './GameSaveBrowserLogic.js'
import { MapStatus, type GameSaveStub, type MapCacheStub, type MapPreviewStub } from './BrowserTypes.js'
import { createRecursiveMockWidget } from './__test_utils.js'

function ms(o: Partial<GameSaveStub> = {}): GameSaveStub { return { path: o.path || '/saves/t.orasav', lastWrite: o.lastWrite || new Date(), creationTime: o.creationTime || new Date(), duration: o.duration ?? { totalMinutes: 10 }, mapTitle: o.mapTitle || 'Map', mapUid: o.mapUid || 'm1', factions: o.factions || ['gdi'], players: o.players || [], slotClients: o.slotClients || new Map([['s1', { faction: 'gdi', color: { r: 255, g: 0, b: 0, a: 255 }, spawnPoint: 1, team: 1, bot: null, botName: '', name: 'P1' }]]), globalSettings: o.globalSettings || { map: 'm1' }, lastOrdersFrame: o.lastOrdersFrame || 1000 } }
function mmc(): MapCacheStub { return { maps: [], getMap(u: string): MapPreviewStub | undefined { return u === 'm1' ? { uid: 'm1', title: 'Map', author: '', playerCount: 0, bounds: { width: 0, height: 0 }, status: MapStatus.Available, class: 'System' as const, visibility: 0, categories: [], modifiedDate: new Date() } : undefined }, getMapsByClass() { return [] }, getAvailableMaps() { return [] } } }

describe('GameSaveBrowserLogic', () => {
  let w = createRecursiveMockWidget('GS')
  let md: { mapCache: MapCacheStub; manifest: { id: string; metadata: { version: string } } }
  beforeEach(() => { w = createRecursiveMockWidget('GS'); md = { mapCache: mmc(), manifest: { id: 'cnc', metadata: { version: '1.0' } } } })

  it('creates', () => { expect(new GameSaveBrowserLogic(w, md)).toBeDefined() })
  it('uses custom map title', () => { expect(new GameSaveBrowserLogic(w, md, null, null, 'Alpine Valley').defaultSaveFilename).toBe('Alpine Valley') })
  it('loadGames populates list', () => { const l = new GameSaveBrowserLogic(w, md); l.loadGames([ms()]); expect(l.games.length).toBe(1) })
  it('loadGames handles empty', () => { const l = new GameSaveBrowserLogic(w, md); l.loadGames([]); expect(l.games.length).toBe(0) })
  it('select picks path', () => { const l = new GameSaveBrowserLogic(w, md); const s = ms(); l.loadGames([s]); l.select(s.path); expect(l.selectedPath).toBe(s.path) })
  it('select null clears', () => { const l = new GameSaveBrowserLogic(w, md); l.loadGames([ms()]); l.select('/saves/t.orasav'); l.select(null); expect(l.selectedPath).toBeNull() })
  it('rename updates path', () => { const l = new GameSaveBrowserLogic(w, md); l.loadGames([ms({ path: '/saves/old.orasav' })]); l.rename('old', 'new'); expect(l.games[0]!).toContain('new') })
  it('delete removes', () => { const l = new GameSaveBrowserLogic(w, md); l.loadGames([ms()]); l.delete('/saves/t.orasav'); expect(l.games.length).toBe(0) })
  it('save calls onExit', () => { let e = false; const l = new GameSaveBrowserLogic(w, md, () => { e = true }); l.save(); expect(e).toBe(true) })
  it('getSpawnOccupants returns occupant from selected save', () => { const l = new GameSaveBrowserLogic(w, md); const s = ms(); l.loadGames([s]); l.select(s.path); l.selectedSave = s; expect(l.getSpawnOccupants().size).toBe(1) })
  it('getSpawnOccupants empty when no save', () => { expect(new GameSaveBrowserLogic(w, md).getSpawnOccupants().size).toBe(0) })
  it('tick does not throw', () => { expect(() => new GameSaveBrowserLogic(w, md).tick()).not.toThrow() })
  it('dispose works', () => { const l = new GameSaveBrowserLogic(w, md); l.dispose(); expect(l.disposed).toBe(true) })
})
