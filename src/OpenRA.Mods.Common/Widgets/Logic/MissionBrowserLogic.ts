/**
 * MissionBrowserLogic.ts — 战役任务浏览器界面逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/MissionBrowserLogic.cs (631 lines)
 */

import { ChromeLogic, type Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import type { ModDataStub } from './MapChooserLogic.js'
import {
  MapClassification, MapVisibility,
  type MapPreviewStub, type LobbyOptionStub,
} from './BrowserTypes.js'

type DynWidget = Record<string, unknown> & Widget
function asDyn(w: Widget): DynWidget { return w as unknown as DynWidget }

const PlayingVideo = { None: 'None', Info: 'Info', Briefing: 'Briefing', GameStart: 'GameStart' } as const
type PlayingVideo = (typeof PlayingVideo)[keyof typeof PlayingVideo]
const PanelType = { MissionInfo: 'MissionInfo', Options: 'Options' } as const
type PanelType = (typeof PanelType)[keyof typeof PanelType]

export class MissionBrowserLogic extends ChromeLogic {
  readonly modData: ModDataStub
  readonly onStart: (() => void) | null; readonly onExit: (() => void) | null
  readonly missionList: Widget
  selectedMap: MapPreviewStub | null = null
  playingVideo: PlayingVideo = PlayingVideo.None
  panel: PanelType = PanelType.MissionInfo
  missionOptions = new Map<string, string>()
  selectedDifficulty: string | null = null; selectedGameSpeed: string | null = null
  minifiedOptions = true; disposed = false

  constructor(
    widget: Widget, modData: ModDataStub,
    onStart: (() => void) | null = null, onExit: (() => void) | null = null,
    initialMap: string | null = null,
  ) {
    super()
    this.modData = modData; this.onStart = onStart; this.onExit = onExit
    this.missionList = widget.get<Widget>('MISSION_LIST')

    asDyn(widget.get<Widget>('MISSION_INFO')).isVisible = () => this.selectedMap != null

    const allPreviews: MapPreviewStub[] = []
    const missionsByCampaign = new Map<string, MapPreviewStub[]>()
    for (const preview of modData.mapCache.getAvailableMaps()) {
      if (preview.class === MapClassification.System) {
        const campaign = preview.categories[0] || 'Missions'
        if (!missionsByCampaign.has(campaign)) missionsByCampaign.set(campaign, [])
        missionsByCampaign.get(campaign)!.push(preview)
      }
    }
    for (const [campaign, previews] of missionsByCampaign) {
      if (previews.length > 0) { this.createMissionGroup(campaign, previews); allPreviews.push(...previews) }
    }
    const loosePreviews = modData.mapCache.getAvailableMaps().filter(
      (p: MapPreviewStub) => (p.visibility & MapVisibility.MissionSelector) !== 0 && !allPreviews.some(a => a.uid === p.uid))
    if (loosePreviews.length > 0) { this.createMissionGroup('Missions', loosePreviews); allPreviews.push(...loosePreviews) }

    if (allPreviews.length > 0) {
      if (initialMap) {
        const map = modData.mapCache.getMap(initialMap)
        if (map && (map.visibility & MapVisibility.MissionSelector) !== 0) this.selectMap(map)
        else this.selectMap(allPreviews[0]!)
      } else this.selectMap(allPreviews[0]!)
    }

    const sb = asDyn(widget.get<Widget>('STARTGAME_BUTTON'))
    sb.onClick = () => this.startMissionClicked()
    sb.isDisabled = () => this.selectedMap == null

    asDyn(widget.get<Widget>('BACK_BUTTON')).onClick = () => { this.playingVideo = PlayingVideo.None; onExit?.() }

    const tc = asDyn(widget.get<Widget>('MISSION_TABS'))
    tc.isVisible = () => !this.minifiedOptions

    const ot = asDyn(widget.get<Widget>('OPTIONS_TAB'))
    ot.isHighlighted = () => this.panel === PanelType.Options
    ot.onClick = () => { this.panel = PanelType.Options }

    const mt = asDyn(widget.get<Widget>('MISSIONINFO_TAB'))
    mt.isHighlighted = () => this.panel === PanelType.MissionInfo
    mt.onClick = () => { this.panel = PanelType.MissionInfo }
  }

  createMissionGroup(title: string, previews: MapPreviewStub[]): void {
    const header = this.missionList.getOrNull<Widget>('HEADER')?.clone()
    if (header) { asDyn(header).id = `HEADER_${title}`; this.missionList.addChild(header) }
    const tpl = this.missionList.getOrNull<Widget>('TEMPLATE')
    if (!tpl) return
    for (const preview of previews) {
      const item = asDyn(tpl.clone())
      item.isSelected = () => this.selectedMap?.uid === preview.uid
      item.onClick = () => this.selectMap(preview)
      item.onDoubleClick = () => this.startMissionClicked()
      this.missionList.addChild(item)
    }
  }

  selectMap(preview: MapPreviewStub): void { this.selectedMap = preview; this.panel = PanelType.MissionInfo; this.rebuildOptions() }

  rebuildOptions(): void {
    if (!this.selectedMap) return; this.missionOptions.clear()
    const allOptions: LobbyOptionStub[] = []
    this.minifiedOptions = allOptions.length <= 2 && allOptions.every(o => o.id === 'difficulty' || o.id === 'gamespeed')
    if (this.minifiedOptions) this.buildMinifiedOptions(allOptions)
    else this.buildOptions(allOptions, [])
  }

  buildOptions(allOptions: LobbyOptionStub[], _bo: { isChecked?: boolean }[]): void {
    for (const o of allOptions) {
      const isBool = 'isChecked' in (o as unknown as Record<string, unknown>)
      if (isBool) this.missionOptions.set(o.id, o.defaultValue)
    }
    for (const o of allOptions) {
      const isBool = 'isChecked' in (o as unknown as Record<string, unknown>)
      if (!isBool) {
        if (o.id === 'difficulty') this.setMapDifficulty(o)
        else if (o.id === 'gamespeed') this.setMapSpeed(o)
        else this.missionOptions.set(o.id, o.defaultValue)
      }
    }
  }

  buildMinifiedOptions(allOptions: LobbyOptionStub[]): void {
    const md = allOptions.find(o => o.id === 'difficulty'); if (md) this.setMapDifficulty(md)
    const gs = allOptions.find(o => o.id === 'gamespeed'); if (gs) this.setMapSpeed(gs)
  }

  setMapDifficulty(option: LobbyOptionStub): void {
    this.selectedDifficulty ??= option.defaultValue
    const v = option.values instanceof Map ? option.values : new Map(Object.entries(option.values))
    this.missionOptions.set(option.id, this.selectedDifficulty && v.has(this.selectedDifficulty) ? this.selectedDifficulty : option.defaultValue)
  }

  setMapSpeed(option: LobbyOptionStub): void {
    this.selectedGameSpeed ??= option.defaultValue
    const v = option.values instanceof Map ? option.values : new Map(Object.entries(option.values))
    this.missionOptions.set(option.id, this.selectedGameSpeed && v.has(this.selectedGameSpeed) ? this.selectedGameSpeed : option.defaultValue)
  }

  onOptionSelected(optionId: string, value: string): void {
    if (optionId === 'difficulty') this.selectedDifficulty = value
    else if (optionId === 'gamespeed') this.selectedGameSpeed = value
    this.missionOptions.set(optionId, value)
  }

  startMissionClicked(): void { if (!this.selectedMap) { this.onExit?.(); return }; this.playingVideo = PlayingVideo.None; this.onStart?.() }

  tick(): void {}
  override dispose(): void { if (this.disposed) return; this.disposed = true; this.missionOptions.clear(); super.dispose() }
}
