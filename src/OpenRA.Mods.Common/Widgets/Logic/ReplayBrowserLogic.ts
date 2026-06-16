/**
 * ReplayBrowserLogic.ts — 回放浏览器界面逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/ReplayBrowserLogic.cs (883 lines)
 */

import { ChromeLogic, type Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ModDataStub } from './MapChooserLogic.js'
import { DateType, DurationType, GameType, WinState, MapStatus, type ReplayMetadataStub, type SpawnOccupantStub } from './BrowserTypes.js'

type DynWidget = Record<string, unknown> & Widget
function asDyn(w: Widget): DynWidget { return w as unknown as DynWidget }

interface ReplayState { visible: boolean; item: Widget }
interface Filter { type: GameType; date: DateType; duration: DurationType; outcome: WinState; playerName: string | null; mapName: string | null; faction: string | null }
function emptyFilter(): Filter { return { type: GameType.Any, date: DateType.Any, duration: DurationType.Any, outcome: WinState.Undefined, playerName: null, mapName: null, faction: null } }

export class ReplayBrowserLogic extends ChromeLogic {
  static filter: Filter = emptyFilter()
  readonly panel: Widget; readonly modData: ModDataStub; readonly onStart: (() => void) | null; readonly onExit: (() => void) | null
  readonly replays: ReplayMetadataStub[] = []; readonly replayState = new Map<ReplayMetadataStub, ReplayState>()
  selectedReplay: ReplayMetadataStub | null = null
  mapPreview: { uid: string; title: string; status: string } | null = null
  cancelLoadingReplays = false; disposed = false

  constructor(widget: Widget, modData: ModDataStub, onExit: (() => void) | null = null, onStart: (() => void) | null = null) {
    super()
    this.panel = widget; this.modData = modData; this.onStart = onStart; this.onExit = onExit
    this.mapPreview = null

    asDyn(widget.get<Widget>('CANCEL_BUTTON')).onClick = () => { this.cancelLoadingReplays = true; onExit?.() }

    const wb = asDyn(widget.get<Widget>('WATCH_BUTTON'))
    wb.isDisabled = () => this.selectedReplay == null; wb.onClick = () => this.watchReplay()

    asDyn(widget.get<Widget>('MAP_PREVIEW_ROOT')).isVisible = () => this.selectedReplay != null
    asDyn(widget.get<Widget>('REPLAY_INFO')).isVisible = () => this.selectedReplay != null

    this.setupFilters(); this.setupManagement()
  }

  loadReplays(loadedReplays: ReplayMetadataStub[]): void {
    this.replays.length = 0; this.replayState.clear()
    const sorted = [...loadedReplays].sort((a, b) => b.gameInfo.startTimeUtc.getTime() - a.gameInfo.startTimeUtc.getTime())
    for (const r of sorted) this.addReplay(r)
    this.setupReplayDependentFilters(); this.applyFilter()
  }

  private addReplay(replay: ReplayMetadataStub): void {
    this.replays.push(replay)
    const item = asDyn(this.panel.get<Widget>('REPLAY_TEMPLATE').clone())
    item.itemKey = replay.filePath
    item.isSelected = () => this.selectedReplay === replay
    item.onClick = () => this.selectReplay(replay)
    item.onDoubleClick = () => this.watchReplay()
    this.replayState.set(replay, { visible: true, item })
    item.isVisible = () => this.replayState.get(replay)?.visible ?? false
    this.panel.getOrNull<Widget>('REPLAY_LIST')?.addChild(item)
  }

  setupFilters(): void {
    const f = ReplayBrowserLogic.filter
    const rb = asDyn(this.panel.get<Widget>('FLT_RESET_BUTTON'))
    rb.isDisabled = () => f.type === GameType.Any && f.date === DateType.Any && f.duration === DurationType.Any && f.outcome === WinState.Undefined && !f.playerName && !f.mapName && !f.faction
    rb.onClick = () => { ReplayBrowserLogic.filter = emptyFilter(); this.applyFilter() }
  }

  setupReplayDependentFilters(): void {}

  setupManagement(): void {
    const renb = asDyn(this.panel.get<Widget>('MNG_RENSEL_BUTTON'))
    renb.isDisabled = () => this.selectedReplay == null
    renb.onClick = () => { if (!this.selectedReplay) return; this.renameReplay(this.selectedReplay, this.selectedReplay.filePath.split('/').pop()?.replace('.orarep', '') + '_renamed' || '') }

    const delb = asDyn(this.panel.get<Widget>('MNG_DELSEL_BUTTON'))
    delb.isDisabled = () => this.selectedReplay == null
    delb.onClick = () => { if (!this.selectedReplay) return; this.deleteReplay(this.selectedReplay); if (!this.selectedReplay) this.selectFirstVisibleReplay() }

    const dab = asDyn(this.panel.get<Widget>('MNG_DELALL_BUTTON'))
    dab.isDisabled = () => ![...this.replayState.values()].some((s: ReplayState) => s.visible)
    dab.onClick = () => { for (const r of this.replays.filter((r2: ReplayMetadataStub) => this.replayState.get(r2)?.visible)) this.deleteReplay(r); if (!this.selectedReplay) this.selectFirstVisibleReplay() }
  }

  static evaluateReplayVisibility(replay: ReplayMetadataStub): boolean {
    const f = ReplayBrowserLogic.filter || emptyFilter()
    if (f.type === GameType.Multiplayer && replay.gameInfo.isSinglePlayer) return false
    if (f.type === GameType.Singleplayer && !replay.gameInfo.isSinglePlayer) return false
    if (f.date !== DateType.Any) { let d = 30; switch (f.date) { case DateType.Today: d = 1; break; case DateType.LastWeek: d = 7; break; case DateType.LastFortnight: d = 14; break }; if (replay.gameInfo.startTimeUtc < new Date(Date.now() - d * 86400000)) return false }
    if (f.duration !== DurationType.Any) { const m = replay.gameInfo.duration.totalMinutes; switch (f.duration) { case DurationType.VeryShort: if (m >= 5) return false; break; case DurationType.Short: if (m < 5 || m >= 20) return false; break; case DurationType.Medium: if (m < 20 || m >= 60) return false; break; case DurationType.Long: if (m < 60) return false; break } }
    if (f.mapName && replay.gameInfo.mapTitle.toLowerCase() !== f.mapName.toLowerCase()) return false
    if (f.playerName) {
      const p = replay.gameInfo.players.find((pl: { name: string }) => pl.name.toLowerCase() === f.playerName!.toLowerCase())
      if (!p) return false
      if (f.outcome !== WinState.Undefined && f.outcome !== p.outcome) return false
      if (f.faction && (p as { factionName: string }).factionName.toLowerCase() !== f.faction!.toLowerCase()) return false
    }
    return true
  }

  applyFilter(): void { for (const r of this.replays) { const s = this.replayState.get(r); if (s) s.visible = ReplayBrowserLogic.evaluateReplayVisibility(r) }; if (this.selectedReplay && !this.replayState.get(this.selectedReplay)?.visible) this.selectFirstVisibleReplay() }
  selectFirstVisibleReplay(): void { this.selectReplay(this.replays.find((r: ReplayMetadataStub) => this.replayState.get(r)?.visible) || null) }

  selectReplay(replay: ReplayMetadataStub | null): void {
    this.selectedReplay = replay
    this.mapPreview = replay ? { uid: replay.gameInfo.mapUid, title: replay.gameInfo.mapTitle, status: MapStatus.Available } : null
  }

  renameReplay(_replay: ReplayMetadataStub, _newFilenameWithoutExtension: string): void {}
  deleteReplay(replay: ReplayMetadataStub): void { if (replay === this.selectedReplay) this.selectReplay(null); const i = this.replays.indexOf(replay); if (i >= 0) this.replays.splice(i, 1); this.replayState.delete(replay) }
  watchReplay(): void { if (!this.selectedReplay) return; this.cancelLoadingReplays = true; this.onStart?.() }

  getSpawnOccupants(): Map<number, SpawnOccupantStub> {
    const o = new Map<number, SpawnOccupantStub>(); if (!this.selectedReplay) return o
    for (const p of this.selectedReplay.gameInfo.players) { if (p.spawnPoint !== 0) o.set(p.spawnPoint, { color: p.color, faction: p.factionName, spawnPoint: p.spawnPoint, team: p.team }) }
    return o
  }
  getDisabledSpawnPoints(): number[] { return this.selectedReplay?.gameInfo.disabledSpawnPoints || [] }

  tick(): void {}
  override dispose(): void { if (this.disposed) return; this.disposed = true; this.cancelLoadingReplays = true; this.replays.length = 0; this.replayState.clear(); super.dispose() }
}
