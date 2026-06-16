/** ReplayBrowserLogic.test.ts */
import { describe, it, expect, beforeEach } from 'vitest'
import { ReplayBrowserLogic } from './ReplayBrowserLogic.js'
import { GameType, DateType, DurationType, WinState, type ReplayMetadataStub, type MapCacheStub } from './BrowserTypes.js'
import { createRecursiveMockWidget } from './__test_utils.js'

function mr(o: Partial<ReplayMetadataStub> = {}): ReplayMetadataStub { return { filePath: o.filePath || '/r.orarep', gameInfo: { mapTitle: o.gameInfo?.mapTitle || 'T', mapUid: o.gameInfo?.mapUid || 'm1', startTimeUtc: o.gameInfo?.startTimeUtc || new Date(), duration: o.gameInfo?.duration || { totalMinutes: 30 }, isSinglePlayer: o.gameInfo?.isSinglePlayer ?? false, players: o.gameInfo?.players || [{ name: 'P1', factionName: 'gdi', factionId: 'gdi', color: { r: 255, g: 0, b: 0, a: 255 }, team: 1, spawnPoint: 1, outcome: WinState.Won }] } } }
const mc: MapCacheStub = { maps: [], getMap() { return { uid: 'm1', title: 'T', author: '', playerCount: 0, bounds: { width: 0, height: 0 }, status: 'Available' as const, class: 'System' as const, visibility: 0, categories: [], modifiedDate: new Date() } }, getMapsByClass() { return [] }, getAvailableMaps() { return [] } }
const md = { mapCache: mc, manifest: { id: 'cnc', metadata: { version: '1.0' } } }

describe('ReplayBrowserLogic', () => {
  let w = createRecursiveMockWidget('RP')
  beforeEach(() => { w = createRecursiveMockWidget('RP'); (ReplayBrowserLogic as unknown as Record<string, unknown>).filter = undefined })

  it('creates', () => { expect(new ReplayBrowserLogic(w, md)).toBeDefined() })
  it('loadReplays populates list', () => { const l = new ReplayBrowserLogic(w, md); l.loadReplays([mr()]); expect(l.replays.length).toBe(1) })
  it('sorts by start time descending', () => { const l = new ReplayBrowserLogic(w, md); l.loadReplays([mr({ filePath: '/old', gameInfo: { startTimeUtc: new Date('2024-01-01'), mapTitle: '', mapUid: '', duration: { totalMinutes: 10 }, isSinglePlayer: false, players: [] } }), mr({ filePath: '/new', gameInfo: { startTimeUtc: new Date('2024-12-01'), mapTitle: '', mapUid: '', duration: { totalMinutes: 10 }, isSinglePlayer: false, players: [] } })]); expect(l.replays[0]!.filePath).toContain('new') })
  it('selectReplay sets selection', () => { const l = new ReplayBrowserLogic(w, md); const r = mr(); l.loadReplays([r]); l.selectReplay(r); expect(l.selectedReplay).toBe(r) })
  it('selectReplay null clears', () => { const l = new ReplayBrowserLogic(w, md); l.loadReplays([mr()]); l.selectReplay(mr()); l.selectReplay(null); expect(l.selectedReplay).toBeNull() })
  it('evaluateReplayVisibility filters SP vs MP', () => {
    ;(ReplayBrowserLogic as unknown as Record<string, unknown>).filter = { type: GameType.Singleplayer, date: DateType.Any, duration: DurationType.Any, outcome: WinState.Undefined, playerName: null, mapName: null, faction: null }
    expect(ReplayBrowserLogic.evaluateReplayVisibility(mr({ gameInfo: { isSinglePlayer: true, startTimeUtc: new Date(), mapTitle: '', mapUid: '', duration: { totalMinutes: 10 }, players: [] } }))).toBe(true)
    expect(ReplayBrowserLogic.evaluateReplayVisibility(mr({ gameInfo: { isSinglePlayer: false, startTimeUtc: new Date(), mapTitle: '', mapUid: '', duration: { totalMinutes: 10 }, players: [] } }))).toBe(false)
  })
  it('applyFilter toggles visibility', () => { const l = new ReplayBrowserLogic(w, md); const sp = mr({ filePath: '/sp', gameInfo: { isSinglePlayer: true, startTimeUtc: new Date(), mapTitle: '', mapUid: '', duration: { totalMinutes: 10 }, players: [] } }); const mp2 = mr({ filePath: '/mp', gameInfo: { isSinglePlayer: false, startTimeUtc: new Date(), mapTitle: '', mapUid: '', duration: { totalMinutes: 10 }, players: [] } }); l.loadReplays([sp, mp2]); (ReplayBrowserLogic as unknown as Record<string, unknown>).filter = { type: GameType.Singleplayer, date: DateType.Any, duration: DurationType.Any, outcome: WinState.Undefined, playerName: null, mapName: null, faction: null }; l.applyFilter(); expect(l.replayState.get(sp)!.visible).toBe(true); expect(l.replayState.get(mp2)!.visible).toBe(false) })
  it('deleteReplay removes', () => { const l = new ReplayBrowserLogic(w, md); const r = mr(); l.loadReplays([r]); l.deleteReplay(r); expect(l.replays.length).toBe(0) })
  it('watchReplay calls onStart', () => { let s = false; const l = new ReplayBrowserLogic(w, md, null, () => { s = true }); l.loadReplays([mr()]); l.selectReplay(mr()); l.watchReplay(); expect(s).toBe(true) })
  it('tick does not throw', () => { expect(() => new ReplayBrowserLogic(w, md).tick()).not.toThrow() })
  it('dispose cleans up', () => { const l = new ReplayBrowserLogic(w, md); l.dispose(); expect(l.disposed).toBe(true) })
})
