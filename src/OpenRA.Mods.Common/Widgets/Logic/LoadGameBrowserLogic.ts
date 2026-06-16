/**
 * LoadGameBrowserLogic.ts — 加载存档浏览器界面逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/LoadGameBrowserLogic.cs (1039 lines)
 *
 * 核心范式转换:
 * - OpenRA DropDownButtonWidget.showDropDown → TypeScript 动态下拉项
 * - OpenRA C# enum SaveType/DateType/DurationType → BrowserTypes const 对象
 * - OpenRA File.GetLastWriteTime / Directory.GetFiles → Date / Uint8Array 内存文件系统
 * - OpenRA FrozenDictionary / LINQ → Map / 数组过滤
 */

import { ChromeLogic, type Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ModDataStub } from './MapChooserLogic.js'
import { SaveType, DateType, DurationType, MapStatus, type GameSaveStub, type SpawnOccupantStub } from './BrowserTypes.js'
import { ConfirmationDialogs } from '../ConfirmationDialogs.js'
import { WidgetUtils } from '../WidgetUtils.js'

// Consolidated dynamic widget access (MAJOR 5 fix)
const asDyn = WidgetUtils.asDyn

interface SaveEntry { path: string; lastWrite: Date; creationTime: Date; duration?: { totalMinutes: number } | null; mapTitle: string; mapUid: string; factions: string[]; visible: boolean; save: GameSaveStub | null }
interface Filter { type: SaveType; date: DateType; duration: DurationType; saveName: string | null; mapName: string | null; faction: string | null }

function emptyFilter(): Filter { return { type: SaveType.Any, date: DateType.Any, duration: DurationType.Any, saveName: null, mapName: null, faction: null } }
function isFilterEmpty(f: Filter): boolean { return f.type === SaveType.Any && f.date === DateType.Any && f.duration === DurationType.Any && !f.saveName && !f.mapName && !f.faction }

export class LoadGameBrowserLogic extends ChromeLogic {
  static filter: Filter = emptyFilter()
  readonly panel: Widget; readonly modData: ModDataStub
  readonly onStart: (() => void) | null; readonly onExit: (() => void) | null
  readonly saves: SaveEntry[] = []; readonly gameList: Widget
  selectedPath: string | null = null; selectedSave: GameSaveStub | null = null
  mapPreview: { uid: string; title: string; status: string } | null = null
  filtersVisible = false; disposed = false

  constructor(widget: Widget, modData: ModDataStub, onExit: (() => void) | null = null, onStart: (() => void) | null = null) {
    super()
    this.panel = widget; this.modData = modData; this.onStart = onStart; this.onExit = onExit
    LoadGameBrowserLogic.filter = emptyFilter()

    asDyn(widget.get<Widget>('CANCEL_BUTTON')).onClick = () => onExit?.()

    const lb = asDyn(widget.get<Widget>('LOAD_BUTTON'))
    lb.isDisabled = () => this.selectedSave == null; lb.onClick = () => this.load()

    this.gameList = widget.get<Widget>('GAME_LIST')
    this.setupFilters(); this.setupManagement()
  }

  loadGames(_saves: GameSaveStub[]): void {
    this.gameList.removeChildren(); this.saves.length = 0
    const byDate = new Map<string, GameSaveStub[]>()
    for (const s of _saves) { const dk = s.lastWrite.toISOString().split('T')[0]!; if (!byDate.has(dk)) byDate.set(dk, []); byDate.get(dk)!.push(s) }
    for (const [, groupSaves] of byDate) {
      for (const save of groupSaves) {
        const entry: SaveEntry = { path: save.path, lastWrite: save.lastWrite, creationTime: save.creationTime, duration: save.duration || null, mapTitle: save.mapTitle, mapUid: save.mapUid, factions: save.factions, visible: true, save }
        this.saves.push(entry)
      }
    }
    this.setupSaveDependentFilters(); this.applyFilter()
  }

  setupFilters(): void {
    const f = LoadGameBrowserLogic.filter
    let ni = this.panel.getOrNull<Widget>('FLT_NAME_INPUT')
    if (ni) {
      const n = asDyn(ni)
      n.onEscKey = () => { f.saveName = null; this.applyFilter(); return true }
      n.onTextEdited = () => { f.saveName = (n.text as string) || null; this.applyFilter() }
    }

    // Save type dropdown
    // OpenRA 对照: FLT_TYPE_DROPDOWNBUTTON (Any / Autosave / Manual)
    {
      const ddb = this.panel.getOrNull<Widget>('FLT_TYPE_DROPDOWNBUTTON')
      if (ddb) {
        const typeOptions: Array<{ value: SaveType; label: string }> = [
          { value: SaveType.Any, label: 'Any' },
          { value: SaveType.Autosave, label: 'Autosave' },
          { value: SaveType.Manual, label: 'Manual' },
        ]
        const typeLookup: Record<string, string> = {}
        for (const o of typeOptions) typeLookup[o.value] = o.label

        const dd = asDyn(ddb)
        dd.getText = () => typeLookup[f.type]
        dd.onMouseDown = () => {
          const showDropDown = (dd as unknown as { showDropDown: (...args: unknown[]) => unknown }).showDropDown.bind(dd)
          showDropDown('LABEL_DROPDOWN_TEMPLATE', 330, typeOptions,
            (option: unknown, _template: unknown) => {
              const opt = option as { value: SaveType; label: string }
              const item = asDyn(_template as Widget)
              const label = item.getOrNull<Widget>('LABEL')
              if (label) asDyn(label).getText = () => opt.label
              return {
                isSelected: () => f.type === opt.value,
                onClick: () => { f.type = opt.value; this.applyFilter() },
              }
            },
          )
        }
      }
    }

    // Date dropdown
    // OpenRA 对照: FLT_DATE_DROPDOWNBUTTON (Any / Today / LastWeek / LastFortnight / LastMonth)
    {
      const ddb = this.panel.getOrNull<Widget>('FLT_DATE_DROPDOWNBUTTON')
      if (ddb) {
        const dateOptions: Array<{ value: DateType; label: string }> = [
          { value: DateType.Any, label: 'Any' },
          { value: DateType.Today, label: 'Today' },
          { value: DateType.LastWeek, label: 'Last Week' },
          { value: DateType.LastFortnight, label: 'Last Fortnight' },
          { value: DateType.LastMonth, label: 'Last Month' },
        ]
        const dateLookup: Record<string, string> = {}
        for (const o of dateOptions) dateLookup[o.value] = o.label

        const dd = asDyn(ddb)
        dd.getText = () => dateLookup[f.date]
        dd.onMouseDown = () => {
          const showDropDown = (dd as unknown as { showDropDown: (...args: unknown[]) => unknown }).showDropDown.bind(dd)
          showDropDown('LABEL_DROPDOWN_TEMPLATE', 330, dateOptions,
            (option: unknown, _template: unknown) => {
              const opt = option as { value: DateType; label: string }
              const item = asDyn(_template as Widget)
              const label = item.getOrNull<Widget>('LABEL')
              if (label) asDyn(label).getText = () => opt.label
              return {
                isSelected: () => f.date === opt.value,
                onClick: () => { f.date = opt.value; this.applyFilter() },
              }
            },
          )
        }
      }
    }

    // Duration dropdown
    // OpenRA 对照: FLT_DURATION_DROPDOWNBUTTON (Any / VeryShort / Short / Medium / Long)
    {
      const ddb = this.panel.getOrNull<Widget>('FLT_DURATION_DROPDOWNBUTTON')
      if (ddb) {
        const durOptions: Array<{ value: DurationType; label: string }> = [
          { value: DurationType.Any, label: 'Any' },
          { value: DurationType.VeryShort, label: 'Very Short (<5m)' },
          { value: DurationType.Short, label: 'Short (5-20m)' },
          { value: DurationType.Medium, label: 'Medium (20-60m)' },
          { value: DurationType.Long, label: 'Long (>60m)' },
        ]
        const durLookup: Record<string, string> = {}
        for (const o of durOptions) durLookup[o.value] = o.label

        const dd = asDyn(ddb)
        dd.getText = () => durLookup[f.duration]
        dd.onMouseDown = () => {
          const showDropDown = (dd as unknown as { showDropDown: (...args: unknown[]) => unknown }).showDropDown.bind(dd)
          showDropDown('LABEL_DROPDOWN_TEMPLATE', 330, durOptions,
            (option: unknown, _template: unknown) => {
              const opt = option as { value: DurationType; label: string }
              const item = asDyn(_template as Widget)
              const label = item.getOrNull<Widget>('LABEL')
              if (label) asDyn(label).getText = () => opt.label
              return {
                isSelected: () => f.duration === opt.value,
                onClick: () => { f.duration = opt.value; this.applyFilter() },
              }
            },
          )
        }
      }
    }

    // Reset button
    const rb = asDyn(this.panel.get<Widget>('FLT_RESET_BUTTON'))
    rb.isDisabled = () => isFilterEmpty(f)
    rb.onClick = () => {
      LoadGameBrowserLogic.filter = emptyFilter()
      if (ni) asDyn(ni).text = ''
      this.setupSaveDependentFilters()
      this.applyFilter()
    }
  }

  setupSaveDependentFilters(): void {}

  static evaluateSaveVisibility(entry: SaveEntry): boolean {
    const f = LoadGameBrowserLogic.filter
    if (f.type !== SaveType.Any) {
      const ia = entry.path.toLowerCase().includes('autosave')
      if (f.type === SaveType.Autosave && !ia) return false
      if (f.type === SaveType.Manual && ia) return false
    }
    if (f.date !== DateType.Any) {
      let d = 30; switch (f.date) { case DateType.Today: d = 1; break; case DateType.LastWeek: d = 7; break; case DateType.LastFortnight: d = 14; break }
      if (entry.lastWrite < new Date(Date.now() - d * 86400000)) return false
    }
    if (f.duration !== DurationType.Any && entry.duration) {
      const m = entry.duration.totalMinutes
      switch (f.duration) { case DurationType.VeryShort: if (m >= 5) return false; break; case DurationType.Short: if (m < 5 || m >= 20) return false; break; case DurationType.Medium: if (m < 20 || m >= 60) return false; break; case DurationType.Long: if (m < 60) return false; break }
    }
    if (f.saveName) { const fn = entry.path.split('/').pop()?.replace('.orasav', '') || ''; if (!fn.toLowerCase().includes(f.saveName.toLowerCase())) return false }
    if (f.mapName && entry.mapTitle.toLowerCase() !== f.mapName.toLowerCase()) return false
    if (f.faction && !entry.factions.some((fa: string) => fa.toLowerCase() === f.faction!.toLowerCase())) return false
    return true
  }

  applyFilter(): void {
    for (const e of this.saves) e.visible = LoadGameBrowserLogic.evaluateSaveVisibility(e)
    if (this.selectedPath && !this.saves.find((s: SaveEntry) => s.path === this.selectedPath && s.visible))
      this.selectSave(this.saves.find((s: SaveEntry) => s.visible)?.path || null)
    else if (!this.selectedPath) this.selectFirstVisible()
  }

  setupManagement(): void {
    const reb = asDyn(this.panel.get<Widget>('RENAME_BUTTON'))
    reb.isDisabled = () => this.selectedPath == null
    reb.onClick = () => { if (!this.selectedPath) return; const fn = this.selectedPath.split('/').pop()?.replace('.orasav', '') || ''; this.rename(fn, fn + '_renamed') }

    const deb = asDyn(this.panel.get<Widget>('DELETE_BUTTON'))
    deb.isDisabled = () => this.selectedPath == null
    deb.onClick = () => {
      if (!this.selectedPath) return
      // OpenRA uses ConfirmationDialogs before delete (MAJOR 4 fix)
      ConfirmationDialogs.buttonPrompt(null, 'Delete Save', 'Delete selected save?',
        () => {
          this.delete(this.selectedPath!)
          this.saves.some((s: SaveEntry) => s.visible) ? this.selectFirstVisible() : this.onExit?.()
        },
        () => { /* cancelled */ },
      )
    }

    const dab = asDyn(this.panel.get<Widget>('DELETE_ALL_BUTTON'))
    dab.isDisabled = () => !this.saves.some((s: SaveEntry) => s.visible)
    dab.onClick = () => {
      // OpenRA uses ConfirmationDialogs before delete all (MAJOR 4 fix)
      ConfirmationDialogs.buttonPrompt(null, 'Delete All Saves', 'Delete all visible saves?',
        () => {
          for (const s of this.saves.filter((sv: SaveEntry) => sv.visible)) this.delete(s.path)
          this.saves.some((s: SaveEntry) => s.visible) ? null : this.onExit?.()
        },
        () => { /* cancelled */ },
      )
    }
  }

  selectFirstVisible(): void { this.selectSave(this.saves.find((s: SaveEntry) => s.visible)?.path || null) }

  selectSave(savePath: string | null): void {
    this.selectedPath = savePath
    if (!savePath) { this.selectedSave = null; this.mapPreview = null; return }
    const entry = this.saves.find((s: SaveEntry) => s.path === savePath)
    this.selectedSave = entry?.save || null
    if (entry) this.mapPreview = { uid: entry.mapUid, title: entry.mapTitle, status: MapStatus.Available }
  }

  getSpawnOccupants(): Map<number, SpawnOccupantStub> {
    const o = new Map<number, SpawnOccupantStub>()
    if (!this.selectedSave) return o
    for (const [, sc] of Object.entries(this.selectedSave.slotClients)) {
      if (sc.spawnPoint === 0) continue
      o.set(sc.spawnPoint, { color: sc.color, faction: sc.faction, spawnPoint: sc.spawnPoint, team: sc.team })
    }
    return o
  }

  rename(oldName: string, newName: string): void {
    const oldPath = this.saves.find((s: SaveEntry) => (s.path.split('/').pop()?.replace('.orasav', '') || '') === oldName)?.path
    if (!oldPath) return
    const newPath = oldPath.replace(oldName, newName)
    const entry = this.saves.find((s: SaveEntry) => s.path === oldPath); if (entry) entry.path = newPath
    if (this.selectedPath === oldPath) this.selectedPath = newPath
  }

  delete(savePath: string): void {
    const idx = this.saves.findIndex((s: SaveEntry) => s.path === savePath); if (idx >= 0) this.saves.splice(idx, 1)
    if (savePath === this.selectedPath) this.selectSave(null)
  }

  load(): void { if (this.selectedSave) this.onStart?.() }
  tick(): void {}
  override dispose(): void { if (this.disposed) return; this.disposed = true; this.saves.length = 0; super.dispose() }
}
