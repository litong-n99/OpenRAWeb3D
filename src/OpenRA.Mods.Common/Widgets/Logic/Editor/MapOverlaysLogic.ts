/**
 * MapOverlaysLogic.ts — 编辑器叠加层切换面板：复选框 + 快捷键绑定
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/MapOverlaysLogic.cs (130 lines)
 *
 * 核心范式转换:
 * - C# TerrainGeometryOverlay / BuildableTerrainOverlay / MarkerLayerOverlay traits → 接口存根
 * - C# HotkeyReference.IsActivatedBy(KeyInput) → TypeScript 等效
 * - C# LogicKeyListenerWidget.AddHandler → TypeScript 等效
 * - C# Ui.LoadWidget / DropDownButtonWidget.AttachPanel → TypeScript clone + wire
 * - C# [Flags] MapOverlays enum → TypeScript const object
 * - C# .HasFlag() → 位掩码 & 操作
 * - C# FluentProvider.GetMessage → 硬编码字符串（TODO-21.C.7-DEFER-3）
 *
 * 通过下拉面板和键盘快捷键切换编辑器视觉叠加层
 * （地形网格、可建造地形、标记图层）。
 *
 * Migration:  — Chapter 21 Phase C Wave 3
 */

import { ChromeLogic, type Widget, Ui } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { IMarkerLayer } from '../../../EditorBrushes/MarkerStubs.js'
// HotkeyReference type — from Ch7 Input system
// LogicKeyListenerWidget type — from Ch16 Widgets

// ---------------------------------------------------------------------------
// Minimal widget types
// ---------------------------------------------------------------------------

type AnyWidget = Widget

// ---------------------------------------------------------------------------
// MapOverlays flags enum (对应 OpenRA [Flags] MapOverlays enum)
// ---------------------------------------------------------------------------

/**
 * Bit flags for map overlay types.
 *
 * OpenRA 对照: [Flags] enum MapOverlays { None=0, Grid=1, Buildable=2, Marker=4 }
 */
export const MapOverlays = {
  None: 0,
  Grid: 1,
  Buildable: 2,
  Marker: 4,
} as const

export type MapOverlays = number

// ---------------------------------------------------------------------------
// Overlay trait interfaces (TODO-21.C.7-DEFER-1/2)
// ---------------------------------------------------------------------------

/**
 * Terrain geometry overlay trait.
 *
 * OpenRA 对照: TerrainGeometryOverlay
 *
 * TODO-21.C.7-DEFER-1: Full TerrainGeometryOverlay migration
 */
export interface ITerrainGeometryOverlay {
  enabled: boolean
}

/**
 * Buildable terrain overlay trait.
 *
 * OpenRA 对照: BuildableTerrainOverlay
 *
 * TODO-21.C.7-DEFER-2: Full BuildableTerrainOverlay migration
 */
export interface IBuildableTerrainOverlay {
  enabled: boolean
}

/**
 * Marker layer overlay trait (extended for overlay toggle).
 *
 * OpenRA 对照: MarkerLayerOverlay (Enabled property)
 */
export interface IMarkerOverlayTrait extends IMarkerLayer {
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Minimal HotkeyReference interface
// ---------------------------------------------------------------------------

/** Minimal hotkey reference for activation checking.
 *
 * OpenRA 对照: HotkeyReference { IsActivatedBy(KeyInput) }
 */
export interface IHotkeyReference {
  isActivatedBy(keyInput: { readonly key: string; readonly event: string }): boolean
}

// ---------------------------------------------------------------------------
// Minimal LogicKeyListenerWidget interface
// ---------------------------------------------------------------------------

/** Minimal key listener widget for adding keyboard handlers.
 *
 * OpenRA 对照: LogicKeyListenerWidget { AddHandler(Func<KeyInput, bool>) }
 */
export interface ILogicKeyListenerWidget extends AnyWidget {
  addHandler(handler: (keyInput: { readonly key: string; readonly event: string; readonly eventType: string }) => boolean): void
}

/** Key event type constant. */
const KEY_INPUT_EVENT_DOWN = 'Down'

// ---------------------------------------------------------------------------
// MapOverlaysLogic (对应 OpenRA MapOverlaysLogic : ChromeLogic)
// ---------------------------------------------------------------------------

/**
 * Toggles editor visual overlays via both a dropdown panel and keyboard hotkeys.
 *
 * OpenRA 对照: MapOverlaysLogic : ChromeLogic
 */
export class MapOverlaysLogic extends ChromeLogic {
  // ---- Traits ----
  private readonly terrainGeometryTrait: ITerrainGeometryOverlay | null
  private readonly buildableTerrainTrait: IBuildableTerrainOverlay | null
  private readonly markerLayerTrait: IMarkerOverlayTrait | null

  // ---- Hotkeys ----
  private readonly toggleGridKey: IHotkeyReference | null
  private readonly toggleBuildableKey: IHotkeyReference | null
  private readonly toggleMarkerKey: IHotkeyReference | null

  // ---- Panel loader ----
  private readonly uiLoadFn: (name: string, parent: AnyWidget | null, args: unknown[]) => AnyWidget

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA MapOverlaysLogic constructor)
  // -------------------------------------------------------------------------

  /**
   * @param widget — the root widget
   * @param terrainGeometryTrait — terrain grid overlay trait (may be null)
   * @param buildableTerrainTrait — buildable terrain overlay trait (may be null)
   * @param markerLayerTrait — marker layer trait (may be null)
   * @param hotkeys — optional hotkey references for toggling overlays
   * @param uiLoadFn — optional Ui.loadWidget function (for overlay panel creation)
   */
  constructor(
    widget: AnyWidget,
    terrainGeometryTrait: ITerrainGeometryOverlay | null,
    buildableTerrainTrait: IBuildableTerrainOverlay | null,
    markerLayerTrait: IMarkerOverlayTrait | null,
    hotkeys?: {
      toggleGridKey?: IHotkeyReference | null
      toggleBuildableKey?: IHotkeyReference | null
      toggleMarkerKey?: IHotkeyReference | null
    },
    uiLoadFn?: (name: string, parent: AnyWidget | null, args: unknown[]) => AnyWidget,
  ) {
    super()
    this.uiLoadFn = uiLoadFn ?? (Ui.loadWidget?.bind(Ui) as unknown as (name: string, parent: AnyWidget | null, args: unknown[]) => AnyWidget) ?? (() => { throw new Error('Ui.loadWidget not available') })

    this.terrainGeometryTrait = terrainGeometryTrait
    this.buildableTerrainTrait = buildableTerrainTrait
    this.markerLayerTrait = markerLayerTrait

    this.toggleGridKey = hotkeys?.toggleGridKey ?? null
    this.toggleBuildableKey = hotkeys?.toggleBuildableKey ?? null
    this.toggleMarkerKey = hotkeys?.toggleMarkerKey ?? null

    // ---- Key handler registration ----
    const keyHandler = (widget as any).get('OVERLAY_KEYHANDLER') as ILogicKeyListenerWidget | null
    if (!keyHandler || !keyHandler.addHandler) {
      // MAJOR-FIX: warn instead of silently ignoring missing key handler
      console.warn('[MapOverlaysLogic] "OVERLAY_KEYHANDLER" LogicKeyListenerWidget not found — overlay hotkeys will be non-functional')
    } else {
      keyHandler.addHandler((keyInput) => {
        if (keyInput.event !== KEY_INPUT_EVENT_DOWN) return false

        if (this.toggleGridKey?.isActivatedBy(keyInput) && this.terrainGeometryTrait) {
          this.terrainGeometryTrait.enabled = !this.terrainGeometryTrait.enabled
          return true
        }

        if (this.toggleBuildableKey?.isActivatedBy(keyInput) && this.buildableTerrainTrait) {
          this.buildableTerrainTrait.enabled = !this.buildableTerrainTrait.enabled
          return true
        }

        if (this.toggleMarkerKey?.isActivatedBy(keyInput) && this.markerLayerTrait) {
          this.markerLayerTrait.enabled = !this.markerLayerTrait.enabled
          return true
        }

        return false
      })
    }

    // ---- Dropdown panel creation ----
    const overlayPanel = this.createOverlaysPanel()

    const overlayDropdown = (widget as any).getOrNull?.('OVERLAY_BUTTON') as AnyWidget | null
    if (overlayDropdown) {
      const originalOnMouseDown = (overlayDropdown as any).onMouseDown
      ;(overlayDropdown as any).onMouseDown = (_args: unknown) => {
        ;(overlayDropdown as any).removePanel?.()
        ;(overlayDropdown as any).attachPanel?.(overlayPanel)
        originalOnMouseDown?.(_args)
      }
    }
  }

  // -------------------------------------------------------------------------
  // CreateOverlaysPanel (对应 OpenRA CreateOverlaysPanel)
  // -------------------------------------------------------------------------

  /** Create the overlay toggle checkbox panel.
   *
   * OpenRA 对照: CreateOverlaysPanel()
   */
  createOverlaysPanel(): AnyWidget {
    let categoriesPanel: AnyWidget

    try {
      categoriesPanel = this.uiLoadFn('OVERLAY_PANEL', null, [])
    } catch (_e) {
      // Fallback: create a minimal widget for testing
      categoriesPanel = { id: 'OVERLAY_PANEL', addChild: () => {} } as unknown as AnyWidget
      return categoriesPanel
    }

    const categoryTemplate = (categoriesPanel as any).get('CATEGORY_TEMPLATE') as AnyWidget
    if (!categoryTemplate) return categoriesPanel

    const allCategories = [
      { flag: MapOverlays.Grid, label: 'Grid', trait: this.terrainGeometryTrait },
      { flag: MapOverlays.Buildable, label: 'Buildable', trait: this.buildableTerrainTrait },
      { flag: MapOverlays.Marker, label: 'Marker', trait: this.markerLayerTrait },
    ]

    for (const cat of allCategories) {
      const category = (categoryTemplate as any).clone?.() as AnyWidget
      if (!category) continue

      ;(category as any).getText = () => cat.label
      ;(category as any).isVisible = () => true

      if (cat.trait) {
        ;(category as any).isChecked = () => cat.trait!.enabled
        ;(category as any).onClick = () => { cat.trait!.enabled = !cat.trait!.enabled }
      }

      ;(categoriesPanel as any).addChild?.(category)
    }

    return categoriesPanel
  }

  // -------------------------------------------------------------------------
  // Tick (abstract from ChromeLogic)
  // -------------------------------------------------------------------------

  override tick(): void {
    // Overlay logic has no per-frame logic — updates via hotkeys and UI events
  }
}
