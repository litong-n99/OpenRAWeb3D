/**
 * MapChooserLogic.ts — 地图选择界面逻辑
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/MapChooserLogic.cs (660 lines)
 */

import { ChromeLogic, type Widget } from '../../../OpenRA.Game/Widgets/Widget.js'
import {
  MapClassification,
  MapVisibility,
  type MapPreviewStub,
  type MapCacheStub,
  type MapGenerationArgsStub,
  type FactionInfoStub,
  fluentGetMessage,
} from './BrowserTypes.js'

// ---------------------------------------------------------------------------
// Dynamic widget property helpers
//
// Widget tree nodes have concrete types (ButtonWidget, ScrollItemWidget, etc.)
// with properties not on the base Widget class. We use dynamic access to wire
// up event handlers, matching OpenRA's runtime duck typing.
// ---------------------------------------------------------------------------

type DynWidget = Record<string, unknown> & Widget

function asDyn(w: Widget): DynWidget {
  return w as unknown as DynWidget
}

// ---------------------------------------------------------------------------
// ModData stub interface
// ---------------------------------------------------------------------------

export interface ModDataStub {
  mapCache: MapCacheStub
  manifest: { id: string; metadata: { version: string }; missions?: string[] }
  factionInfo?: FactionInfoStub[]
}

// ---------------------------------------------------------------------------
// Fluent reference constants
// ---------------------------------------------------------------------------

const AllMaps = 'label-all-maps'
const MapSizeHuge = 'label-map-size-huge'
const MapSizeLarge = 'label-map-size-large'
const MapSizeMedium = 'label-map-size-medium'
const MapSizeSmall = 'label-map-size-small'

// ---------------------------------------------------------------------------
// MapChooserLogic
// ---------------------------------------------------------------------------

export class MapChooserLogic extends ChromeLogic {
  static mapSizeLabel(size: { width: number; height: number }): string {
    const area = size.width * size.height
    const label =
      area >= 120 * 120 ? MapSizeHuge :
      area >= 90 * 90 ? MapSizeLarge :
      area >= 60 * 60 ? MapSizeMedium :
      MapSizeSmall
    return `${size.width}x${size.height} (${fluentGetMessage(label)})`
  }

  readonly widget: Widget
  readonly modData: ModDataStub
  readonly onSelect: ((uid: string) => void) | null
  readonly onSelectGenerated: ((args: MapGenerationArgsStub) => void) | null
  readonly filter: MapVisibility
  readonly remoteMapPool: Set<string> | null

  currentTab: MapClassification = MapClassification.System
  disposed = false

  readonly scrollpanels = new Map<MapClassification, Widget>()
  readonly tabMaps = new Map<MapClassification, MapPreviewStub[]>()
  readonly tabLabels = new Map<MapClassification, string>()

  visibleMapUids: string[] = []
  selectedUid: string = ''

  category: string | null = null
  mapFilter: string | null = null

  orderByFunc: ((m: MapPreviewStub) => number) | null = null

  generatedMapArgs: MapGenerationArgsStub | null = null

  constructor(
    widget: Widget, modData: ModDataStub,
    initialMap: string | null = null,
    initialTab: MapClassification = MapClassification.System,
    onExit: (() => void) | null = null,
    onSelect: ((uid: string) => void) | null = null,
    onSelectGenerated: ((args: MapGenerationArgsStub) => void) | null = null,
    filter: MapVisibility = MapVisibility.None,
    remoteMapPool: Set<string> | null = null,
  ) {
    super()
    this.widget = widget; this.modData = modData; this.onSelect = onSelect
    this.onSelectGenerated = onSelectGenerated; this.filter = filter
    this.remoteMapPool = remoteMapPool

    const approving = () => {
      if (this.currentTab === MapClassification.Generated && this.generatedMapArgs != null) {
        this.onSelectGenerated?.(this.generatedMapArgs)
      } else if (this.currentTab !== MapClassification.Generated) {
        this.onSelect?.(this.selectedUid)
      }
      onExit?.()
    }
    const canceling = () => { onExit?.() }

    // OK button
    const ok = asDyn(widget.get<Widget>('BUTTON_OK'))
    if (onSelect != null) {
      ok.isDisabled = () => this.currentTab === MapClassification.Generated && this.generatedMapArgs == null
    } else ok.disabled = true
    ok.onClick = approving

    // Cancel button
    asDyn(widget.get<Widget>('BUTTON_CANCEL')).onClick = canceling

    // Map filter input
    const mapFilterInput = widget.getOrNull<Widget>('MAPFILTER_INPUT')
    if (mapFilterInput) {
      const fi = asDyn(mapFilterInput)
      fi.onEscKey = () => {
        const txt = (fi.text as string) || ''
        if (txt.length === 0) canceling()
        else { this.mapFilter = null; fi.text = ''; this.enumerateMaps(this.currentTab) }
        return true
      }
      fi.onEnterKey = () => { approving(); return true }
      fi.onTextEdited = () => {
        this.mapFilter = (fi.text as string) || null; this.enumerateMaps(this.currentTab)
      }
    }

    // Random map button
    const rmb = widget.getOrNull<Widget>('RANDOMMAP_BUTTON')
    if (rmb) {
      const r = asDyn(rmb)
      r.onClick = () => {
        if (this.visibleMapUids.length > 0) {
          this.selectedUid = this.visibleMapUids[Math.floor(Math.random() * this.visibleMapUids.length)]!
          this.scrollToItem(this.currentTab, this.selectedUid)
        }
      }
      r.isDisabled = () => this.visibleMapUids.length === 0
      r.isVisible = () => this.currentTab !== MapClassification.Generated
    }

    // Delete map button
    const dmb = widget.getOrNull<Widget>('DELETE_MAP_BUTTON')
    if (dmb) {
      const d = asDyn(dmb)
      d.isDisabled = () => this.currentTab !== MapClassification.User
      d.isVisible = () => this.currentTab === MapClassification.User
      d.onClick = () => this.deleteOneMap(this.selectedUid, (newUid) => {
        this.refreshMaps(this.currentTab); this.enumerateMaps(this.currentTab); this.setupMapTabs()
        if (this.tabMaps.get(this.currentTab)?.length === 0) {
          const e = this.modData.mapCache.getMap(newUid); if (e) this.switchTab(e.class)
        }
      })
    }

    // Delete all maps button
    const damb = widget.getOrNull<Widget>('DELETE_ALL_MAPS_BUTTON')
    if (damb) {
      const da = asDyn(damb)
      da.isVisible = () => this.currentTab === MapClassification.User
      da.onClick = () => this.deleteAllMaps([...this.visibleMapUids], (newUid) => {
        this.refreshMaps(this.currentTab); this.enumerateMaps(this.currentTab); this.setupMapTabs()
        const e = this.modData.mapCache.getMap(newUid); if (e) this.switchTab(e.class)
      })
    }

    // Filter order controls
    const fc = widget.getOrNull<Widget>('FILTER_ORDER_CONTROLS')
    if (fc) asDyn(fc).isVisible = () => this.currentTab !== MapClassification.Generated

    // Setup map panels
    this.setupMapPanel(MapClassification.System, 'SYSTEM_MAPS_TAB')
    this.setupMapPanel(MapClassification.User, 'USER_MAPS_TAB')

    if (remoteMapPool != null) {
      this.tabLabels.set(MapClassification.Remote, 'Remote Maps')
      this.currentTab = MapClassification.Remote; this.selectedUid = initialMap || ''
    } else {
      this.tabLabels.set(MapClassification.System, 'Official Maps')
      this.tabLabels.set(MapClassification.User, 'Custom Maps')
      if (onSelectGenerated != null) {
        this.tabLabels.set(MapClassification.Generated, 'Generated Maps')
        this.setupMapPanel(MapClassification.Generated, 'GENERATE_MAP_TAB')
      }
      if (initialMap) {
        const map = modData.mapCache.getMap(initialMap)
        if (map) {
          if (map.class === MapClassification.Generated && onSelectGenerated) {
            this.currentTab = MapClassification.Generated; this.selectedUid = this.chooseInitialMap(null)
          } else { this.selectedUid = this.chooseInitialMap(initialMap); this.currentTab = map.class }
        } else { this.selectedUid = this.chooseInitialMap(null); this.currentTab = MapClassification.System }
      } else {
        const tabMapsList = modData.mapCache.getMapsByClass(initialTab)
        this.selectedUid = tabMapsList.length > 0
          ? this.chooseInitialMap(tabMapsList[0]!.uid)
          : this.chooseInitialMap(null)
        this.currentTab = tabMapsList.length > 0 ? initialTab : MapClassification.System
      }
    }

    this.enumerateMaps(this.currentTab); this.setupMapTabs(); this.setupOrderByDropdown()
  }

  private chooseInitialMap(preferred: string | null): string {
    if (preferred) return preferred
    const a = this.modData.mapCache.getAvailableMaps()
    return a.length > 0 ? a[0]!.uid : ''
  }

  switchTab(tab: MapClassification): void { this.currentTab = tab; this.enumerateMaps(tab) }

  refreshMaps(tab: MapClassification): void {
    if (tab === MapClassification.System || tab === MapClassification.User) {
      this.tabMaps.set(tab, this.modData.mapCache.getAvailableMaps().filter(
        (m: MapPreviewStub) => m.class === tab && (this.filter === 0 || (m.visibility & this.filter) !== 0)))
    } else this.tabMaps.set(tab, [])
  }

  setupMapTabs(): void {
    for (let i = 0; i < 3; i++) {
      const btn = this.widget.getOrNull<Widget>(`BUTTON${i + 1}`); if (btn) btn.visible = false
    }
    let tabCount = 0
    for (const [tab, label] of this.tabLabels) {
      if (tab === MapClassification.User && (this.tabMaps.get(tab)?.length || 0) === 0) continue
      tabCount++
      const tb = asDyn(this.widget.getOrNull<Widget>(`BUTTON${tabCount}`)!)
      tb.isHighlighted = () => this.currentTab === tab
      tb.onClick = () => this.switchTab(tab)
      tb.visible = true; tb.text = label
    }
  }

  setupMapPanel(tab: MapClassification, tabContainerName: string): void {
    const tc = this.widget.getOrNull<Widget>(tabContainerName)
    if (!tc) return
    asDyn(tc).isVisible = () => this.currentTab === tab
    const ts = tc.getOrNull<Widget>('MAP_LIST')
    if (ts) this.scrollpanels.set(tab, ts)
    this.refreshMaps(tab)
  }

  setupOrderByDropdown(): void {
    const od = this.widget.getOrNull<Widget>('ORDERBY')
    if (!od) return
    const orderByDict = new Map<string, ((m: MapPreviewStub) => number) | null>([
      ['By Player Count', (m: MapPreviewStub) => m.playerCount],
      ['By Title', null],
      ['By Date (Newest)', (m: MapPreviewStub) => -m.modifiedDate.getTime()],
      ['By Size', (m: MapPreviewStub) => m.bounds.width * m.bounds.height],
    ])
    this.orderByFunc = orderByDict.get('By Player Count') || null
    asDyn(od).onClick = () => {}
    asDyn(od).getText = () => {
      for (const [k, v] of orderByDict) if (v === this.orderByFunc) return k
      return 'By Player Count'
    }
  }

  enumerateMaps(tab: MapClassification): void {
    if (tab === MapClassification.Generated) return
    let playerCountFilter = -1
    if (this.mapFilter) { const p = parseInt(this.mapFilter, 10); if (!isNaN(p)) playerCountFilter = p }
    let maps = (this.tabMaps.get(tab) || []).filter((m: MapPreviewStub) => {
      if (this.category && !m.categories.includes(this.category)) return false
      if (this.mapFilter) {
        const mt = m.title.toLowerCase().includes(this.mapFilter.toLowerCase())
        const ma = m.author.toLowerCase().includes(this.mapFilter.toLowerCase())
        if (!mt && !ma && m.playerCount !== playerCountFilter) return false
      }
      return true
    })
    if (this.orderByFunc) {
      maps = [...maps].sort((a, b) => { const va = this.orderByFunc!(a), vb = this.orderByFunc!(b); return va !== vb ? va - vb : a.title.localeCompare(b.title) })
    } else maps = [...maps].sort((a, b) => a.title.localeCompare(b.title))

    const sp = this.scrollpanels.get(tab)
    if (sp) sp.removeChildren()
    if (tab === this.currentTab) {
      this.visibleMapUids = maps.map((m: MapPreviewStub) => m.uid)
      this.setupGameModeDropdown(tab)
    }
    if (this.visibleMapUids.includes(this.selectedUid)) this.scrollToItem(tab, this.selectedUid)
  }

  setupGameModeDropdown(tab: MapClassification): void {
    const dd = this.widget.getOrNull<Widget>('GAMEMODE_FILTER')
    if (!dd) return
    const maps = this.tabMaps.get(tab) || []
    asDyn(dd).getText = () => {
      if (!this.category) return `${fluentGetMessage(AllMaps)} (${maps.length})`
      return `${this.category} (${maps.filter((m: MapPreviewStub) => m.categories.includes(this.category!)).length})`
    }
    asDyn(dd).onClick = () => {}
  }

  private scrollToItem(tab: MapClassification, uid: string): void {
    const sp = this.scrollpanels.get(tab)
    if (sp) (asDyn(sp).scrollToItem as ((u: string) => void) | undefined)?.(uid)
  }

  deleteOneMap(map: string, after: (newUid: string) => void): void { after(this.deleteMap(map)) }
  deleteAllMaps(maps: string[], after: (newUid: string) => void): void { for (const m of maps) this.deleteMap(m); after(this.chooseInitialMap(null)) }

  deleteMap(map: string): string {
    try {
      if (this.selectedUid === map) {
        const tabMapsList = this.tabMaps.get(this.currentTab) || []
        this.selectedUid = this.chooseInitialMap(tabMapsList.find((m: MapPreviewStub) => m.uid !== map)?.uid || null)
      }
    } catch { /* ignore */ }
    return this.selectedUid
  }

  tick(): void {}
  override dispose(): void { this.disposed = true; this.scrollpanels.clear(); this.tabMaps.clear(); this.tabLabels.clear(); super.dispose() }
}
