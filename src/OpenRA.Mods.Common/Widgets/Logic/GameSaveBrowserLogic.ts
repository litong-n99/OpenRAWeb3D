/**
 * GameSaveBrowserLogic.ts — 游戏中保存/加载界面逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/GameSaveBrowserLogic.cs (599 lines)
 */

import { ChromeLogic, type Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ModDataStub } from './MapChooserLogic.js'
import { MapStatus, type GameSaveStub, type SlotClientStub, type SpawnOccupantStub } from './BrowserTypes.js'

type DynWidget = Record<string, unknown> & Widget
function asDyn(w: Widget): DynWidget { return w as unknown as DynWidget }

export class GameSaveBrowserLogic extends ChromeLogic {
  readonly panel: Widget; readonly modData: ModDataStub; readonly onExit: (() => void) | null; readonly onStart: (() => void) | null
  readonly games: string[] = []; readonly gameList: Widget; readonly defaultSaveFilename: string
  selectedPath: string | null = null; selectedSave: GameSaveStub | null = null
  mapPreview: { uid: string; title: string; status: string } | null = null; disposed = false

  constructor(widget: Widget, modData: ModDataStub, onExit: (() => void) | null = null, onStart: (() => void) | null = null, mapTitle = 'Map', mapUid = '') {
    super()
    this.panel = widget; this.modData = modData; this.onExit = onExit; this.onStart = onStart
    this.defaultSaveFilename = mapTitle

    asDyn(widget.get<Widget>('CANCEL_BUTTON')).onClick = () => onExit?.()
    this.gameList = widget.get<Widget>('GAME_LIST')

    const sb = asDyn(widget.get<Widget>('SAVE_BUTTON'))
    sb.isDisabled = () => { const tf = widget.getOrNull<Widget>('SAVE_TEXTFIELD'); return !tf || ((asDyn(tf).text as string) || '').trim().length === 0 }
    sb.onClick = () => this.save()
    sb.isVisible = () => true

    asDyn(widget.get<Widget>('SAVE_WIDGETS')).isVisible = () => true
    asDyn(widget.get<Widget>('SAVE_INFO')).isVisible = () => this.selectedPath != null
    asDyn(widget.get<Widget>('MAP_PREVIEW_ROOT')).isVisible = () => true

    this.mapPreview = { uid: mapUid, title: mapTitle, status: MapStatus.Available }

    const reb = asDyn(widget.get<Widget>('RENAME_BUTTON'))
    reb.isDisabled = () => this.selectedSave == null
    reb.onClick = () => { if (!this.selectedPath) return; this.rename(this.selectedPath.split('/').pop()?.replace('.orasav', '') || '', this.selectedPath.split('/').pop()?.replace('.orasav', '') + '_renamed' || '') }

    const deb = asDyn(widget.get<Widget>('DELETE_BUTTON'))
    deb.isDisabled = () => this.selectedSave == null
    deb.onClick = () => { if (!this.selectedPath) return; this.delete(this.selectedPath); this.selectFirstVisible() }

    const dab = asDyn(widget.get<Widget>('DELETE_ALL_BUTTON'))
    dab.isDisabled = () => this.games.length === 0
    dab.onClick = () => { for (const s of [...this.games]) this.delete(s); onExit?.() }

    this.selectFirstVisible()
  }

  loadGames(_saves: GameSaveStub[]): void {
    this.gameList.removeChildren(); this.games.length = 0
    for (const save of _saves) { this.games.push(save.path) }
  }

  rename(oldName: string, newName: string): void {
    const oldPath = this.games.find((p: string) => (p.split('/').pop()?.replace('.orasav', '') || '') === oldName)
    if (!oldPath) return
    const newPath = oldPath.replace(oldName, newName); const i = this.games.indexOf(oldPath)
    if (i >= 0) this.games[i] = newPath; if (this.selectedPath === oldPath) this.selectedPath = newPath
  }

  delete(savePath: string): void { if (savePath === this.selectedPath) this.select(null); const i = this.games.indexOf(savePath); if (i >= 0) this.games.splice(i, 1) }
  selectFirstVisible(): void { this.select(null) }

  select(savePath: string | null): void {
    this.selectedPath = savePath
    this.selectedSave = null
  }

  save(): void { this.onExit?.() }
  getWorldSlotClients(): Map<string, SlotClientStub> { return new Map() }

  getSpawnOccupants(): Map<number, SpawnOccupantStub> {
    const slotClients = this.selectedSave?.slotClients || (this.selectedPath == null ? this.getWorldSlotClients() : null)
    if (!slotClients) return new Map()
    const o = new Map<number, SpawnOccupantStub>()
    const entries: SlotClientStub[] = slotClients instanceof Map ? [...slotClients.values()] : Object.values(slotClients) as SlotClientStub[]
    for (const sc of entries) { if (sc.spawnPoint === 0) continue; o.set(sc.spawnPoint, { color: sc.color, faction: sc.faction, spawnPoint: sc.spawnPoint, team: sc.team }) }
    return o
  }

  tick(): void {}
  override dispose(): void { if (this.disposed) return; this.disposed = true; this.games.length = 0; super.dispose() }
}
