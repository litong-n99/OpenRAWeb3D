/**
 * MapMarkerTilesLogic.ts — 标记瓷砖放置 UI：颜色色板网格、镜像模式、透明度滑块
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/Logic/Editor/MapMarkerTilesLogic.cs (261 lines)
 *
 * 核心范式转换:
 * - C# MarkerLayerOverlay trait → TypeScript IMarkerLayer 接口 (Phase B stub)
 * - C# MarkerTileMirrorMode { None, Flip, Rotate } → TypeScript const enum
 * - C# ColorBlockWidget.GetColor → TypeScript getColor closure
 * - C# ScrollItemWidget.Setup 模式 → TypeScript clone + wire
 * - C# EditorMarkerLayerBrush 构造 → TypeScript 等效
 * - C# ClearSelectedMarkerTilesEditorAction / ClearAllMarkerTilesEditorAction → TypeScript 等效
 * - C# FluentProvider.GetMessage → 硬编码字符串（TODO-21.C.6-DEFER-1）
 *
 * 配置标记瓷砖笔刷，包含颜色色板、镜像模式控件、透明度滑块和清除按钮。
 * 监听笔刷变更以重置选中的标记索引。
 *
 * Migration: TODO-21.C.6 — Chapter 21 Phase C Wave 3
 */

import { ChromeLogic, type Widget } from '../../../../OpenRA.Game/Widgets/Widget.js'
import type { IMarkerLayer } from '../../../EditorBrushes/MarkerStubs.js'
import type { EditorActionManager } from '../../../Traits/World/EditorActionManager.js'
import { ClearSelectedMarkerTilesEditorAction } from '../../../EditorBrushes/actions/ClearSelectedMarkerTilesEditorAction.js'
import { ClearAllMarkerTilesEditorAction } from '../../../EditorBrushes/actions/ClearAllMarkerTilesEditorAction.js'
import type { IEditorBrush } from '../../../Editor/IEditorBrush.js'

// ---------------------------------------------------------------------------
// Minimal widget types
// ---------------------------------------------------------------------------

type AnyWidget = Widget

// ---------------------------------------------------------------------------
// MarkerTileMirrorMode enum (对应 OpenRA MarkerTileMirrorMode)
// ---------------------------------------------------------------------------

/**
 * Mirror mode for marker tile placement.
 *
 * OpenRA 对照: enum MarkerTileMirrorMode { None, Flip, Rotate }
 */
export const MarkerTileMirrorMode = {
  None: 0,
  Flip: 1,
  Rotate: 2,
} as const

export type MarkerTileMirrorMode = (typeof MarkerTileMirrorMode)[keyof typeof MarkerTileMirrorMode]

// ---------------------------------------------------------------------------
// IMarkerLayerOverlay — extended marker layer interface with UI controls
// ---------------------------------------------------------------------------

/**
 * Extended marker layer interface with UI properties for the marker tiles panel.
 *
 * OpenRA 对照: MarkerLayerOverlay (subset used by MapMarkerTilesLogic)
 *
 * Includes color info, mirror mode, tile alpha, num sides, axis angle,
 * and tiles data. Also provides SetMirrorMode().
 */
export interface IMarkerLayerOverlay extends IMarkerLayer {
  /** Optional color palette info (ColorBlockWidget compatible). */
  readonly info: {
    /** Colors available for marker tiles, keyed by index. */
    readonly colors: ReadonlyMap<number, number>
  }
  /** Mirror mode for placement. */
  mirrorMode: MarkerTileMirrorMode
  /** Alpha transparency for tiles (1-255). */
  tileAlpha: number
  /** Number of sides for rotation/flip symmetry. */
  numSides: number
  /** Axis angle in degrees for flip mode (0-165, step 15). */
  axisAngle: number
  /** Set mirror mode. */
  setMirrorMode(mode: MarkerTileMirrorMode): void
}

// ---------------------------------------------------------------------------
// IEditorMarkerBrush — minimal interface for EditorMarkerLayerBrush
// ---------------------------------------------------------------------------

/** Minimal EditorMarkerLayerBrush interface for type checking.
 *
 * OpenRA 对照: EditorMarkerLayerBrush
 */
export interface IEditorMarkerBrush extends IEditorBrush {
  readonly template: number | null
}

// ---------------------------------------------------------------------------
// Minimal editor viewport interface
// ---------------------------------------------------------------------------

/** Minimal editor for brush access. */
export interface IMarkerEditor {
  readonly currentBrush: IEditorBrush
  readonly brushChangedCallback: (() => void) | null
  setBrush(brush: IEditorBrush): void
}

// ---------------------------------------------------------------------------
// MapMarkerTilesLogic (对应 OpenRA MapMarkerTilesLogic : ChromeLogic)
// ---------------------------------------------------------------------------

/**
 * Configures the marker tile brush with color swatches, mirror mode controls,
 * alpha slider, and clear buttons.
 *
 * OpenRA 对照: MapMarkerTilesLogic : ChromeLogic
 */
export class MapMarkerTilesLogic extends ChromeLogic {
  // ---- Traits ----
  private readonly markerLayerTrait: IMarkerLayerOverlay
  private readonly editorActionManager: EditorActionManager
  private readonly editor: IMarkerEditor

  // ---- Widget references ----
  private readonly tileColorPanel: AnyWidget
  private readonly alphaSlider: AnyWidget | null
  private readonly alphaValueLabel: AnyWidget | null
  private readonly modeDropdown: AnyWidget | null
  private readonly rotateNumSidesSlider: AnyWidget | null
  private readonly rotateNumSidesValueLabel: AnyWidget | null
  private readonly flipNumSidesDropdown: AnyWidget | null
  private readonly numSidesLabel: AnyWidget | null
  private readonly axisAngleLabel: AnyWidget | null
  private readonly axisAngleSlider: AnyWidget | null
  private readonly axisAngleValueLabel: AnyWidget | null
  private readonly clearSelectedButton: AnyWidget | null
  private readonly clearAllButton: AnyWidget | null

  // ---- State ----
  /** Currently selected marker tile index (null = erase mode). */
  markerTile: number | null = null

  // ---- EditorMarkerLayerBrush constructor (injectable for testing) ----
  private readonly createMarkerBrush: (editor: IMarkerEditor, template: number | null, _worldRenderer: unknown) => IEditorBrush

  // ---- Saved brush callback for cleanup (BLOCKER-FIX) ----
  // Stored via (this as any) to avoid TS property inference issues.
  // Read/written in constructor and dispose() exclusively.

  // -------------------------------------------------------------------------
  // Constructor (对应 OpenRA MapMarkerTilesLogic constructor)
  // -------------------------------------------------------------------------

  /**
   * @param widget — the root widget
   * @param markerLayerTrait — the marker layer overlay trait
   * @param editorActionManager — the editor action manager
   * @param editor — the editor viewport controller
   * @param worldRenderer — the world renderer (for brush construction)
   * @param createMarkerBrushFn — factory for creating EditorMarkerLayerBrush instances
   */
  constructor(
    widget: AnyWidget,
    markerLayerTrait: IMarkerLayerOverlay,
    editorActionManager: EditorActionManager,
    editor: IMarkerEditor,
    _worldRenderer: unknown,
    createMarkerBrushFn?: (editor: IMarkerEditor, template: number | null, worldRenderer: unknown) => IEditorBrush,
  ) {
    super()

    this.markerLayerTrait = markerLayerTrait
    this.editorActionManager = editorActionManager
    this.editor = editor
    void _worldRenderer

    // Default brush factory (wraps a stub)
    this.createMarkerBrush = createMarkerBrushFn ?? ((_ed, _tpl, _wr) => {
      return {
        handleMouseInput: () => false,
        tick: () => { },
        tickRender: () => { },
        renderAboveShroud: () => [],
        renderAnnotations: () => [],
        dispose: () => { },
        template: _tpl,
      } as unknown as IEditorBrush & { template: number | null }
    })

    // Wire brush changed listener.
    // BLOCKER-FIX: store the previous callback so we can restore it in dispose().
    // EditorViewportControllerWidget.brushChangedCallback is a single-callback
    // property (not an array), so we must chain it manually.
    ;(this as any)._savedBrushChangedCallback = editor.brushChangedCallback
    ;(editor as any).brushChangedCallback = () => {
      (this as any)._savedBrushChangedCallback?.()
      this.handleBrushChanged()
    }

    // ---- Color swatch grid ----
    this.tileColorPanel = (widget as any).get('TILE_COLOR_PANEL') as AnyWidget

    const colorSwatchTemplate = (this.tileColorPanel as any).get('TILE_COLOR_TEMPLATE') as AnyWidget
    const iconTemplate = (this.tileColorPanel as any).get('TILE_ICON_TEMPLATE') as AnyWidget
    ;(this.tileColorPanel as any).removeChildren?.()

    if (colorSwatchTemplate) {
      const colors = this.markerLayerTrait.info.colors
      let colorIndex = 0
      for (const [idx, color] of colors) {
        const scrollItem = this.setupColorSwatchItem(colorIndex, colorSwatchTemplate, idx, color)
        ;(this.tileColorPanel as any).addChild?.(scrollItem)
        colorIndex++
      }
    }

    if (iconTemplate) {
      const eraseItem = this.setupEraseItem(iconTemplate)
      ;(this.tileColorPanel as any).addChild?.(eraseItem)
    }

    // ---- Clear buttons ----
    this.clearSelectedButton = (widget as any).get('CLEAR_CURRENT_BUTTON') as AnyWidget
    if (this.clearSelectedButton) {
      ;(this.clearSelectedButton as any).isDisabled = () => this.markerTile === null
      ;(this.clearSelectedButton as any).onClick = () => this.clearSelected()
    }

    this.clearAllButton = (widget as any).get('CLEAR_ALL_BUTTON') as AnyWidget
    if (this.clearAllButton) {
      ;(this.clearAllButton as any).onClick = () => this.clearAll()
    }

    // ---- Alpha slider ----
    this.alphaSlider = (widget as any).get('ALPHA_SLIDER') as AnyWidget
    if (this.alphaSlider) {
      ;(this.alphaSlider as any).minimumValue = 1
      ;(this.alphaSlider as any).maximumValue = 255
      ;(this.alphaSlider as any).ticks = 12
      // MAJOR-FIX: use wireSliderOnChange for robust handler wiring
      this.wireSliderOnChange(this.alphaSlider, (val: number) => {
        this.markerLayerTrait.tileAlpha = val | 0
      })
      ;(this.alphaSlider as any).getValue = () => this.markerLayerTrait.tileAlpha
    }

    this.alphaValueLabel = (widget as any).get('ALPHA_VALUE') as AnyWidget
    if (this.alphaValueLabel) {
      ;(this.alphaValueLabel as any).getText = () => this.markerLayerTrait.tileAlpha.toString()
    }

    // ---- Mirror mode dropdown ----
    this.modeDropdown = (widget as any).get('MODE_DROPDOWN') as AnyWidget
    if (this.modeDropdown) {
      ;(this.modeDropdown as any).getText = () => {
        switch (this.markerLayerTrait.mirrorMode) {
          case MarkerTileMirrorMode.None: return 'None'
          case MarkerTileMirrorMode.Flip: return 'Flip'
          case MarkerTileMirrorMode.Rotate: return 'Rotate'
          default: return 'Unknown'
        }
      }
    }

    // ---- Visibility helpers ----
    const isFlipMode = () => this.markerLayerTrait.mirrorMode === MarkerTileMirrorMode.Flip
    const isRotateMode = () => this.markerLayerTrait.mirrorMode === MarkerTileMirrorMode.Rotate

    // ---- Num sides label ----
    this.numSidesLabel = (widget as any).get('NUM_SIDES_LABEL') as AnyWidget
    if (this.numSidesLabel) {
      ;(this.numSidesLabel as any).isVisible = () => isFlipMode() || isRotateMode()
    }

    // ---- Rotate num sides slider ----
    this.rotateNumSidesSlider = (widget as any).get('ROTATE_NUM_SIDES_SLIDER') as AnyWidget
    if (this.rotateNumSidesSlider) {
      ;(this.rotateNumSidesSlider as any).minimumValue = 2
      ;(this.rotateNumSidesSlider as any).maximumValue = 8
      ;(this.rotateNumSidesSlider as any).ticks = 7
      ;(this.rotateNumSidesSlider as any).isVisible = isRotateMode
      // BLOCKER-FIX: wire OnChange handler (C#: slider.OnChange += (val) => markerLayerTrait.NumSides = (int)val)
      this.wireSliderOnChange(this.rotateNumSidesSlider, (val: number) => {
        this.markerLayerTrait.numSides = val | 0
      })
      ;(this.rotateNumSidesSlider as any).getValue = () => this.markerLayerTrait.numSides
    }

    this.rotateNumSidesValueLabel = (widget as any).get('ROTATE_NUM_SIDES_VALUE') as AnyWidget
    if (this.rotateNumSidesValueLabel) {
      ;(this.rotateNumSidesValueLabel as any).isVisible = isRotateMode
      ;(this.rotateNumSidesValueLabel as any).getText = () => this.markerLayerTrait.numSides.toString()
    }

    // ---- Flip num sides dropdown ----
    this.flipNumSidesDropdown = (widget as any).get('FLIP_NUM_SIDES_DROPDOWN') as AnyWidget
    if (this.flipNumSidesDropdown) {
      ;(this.flipNumSidesDropdown as any).isVisible = isFlipMode
      ;(this.flipNumSidesDropdown as any).getText = () => this.markerLayerTrait.numSides.toString()
    }

    // ---- Axis angle slider ----
    this.axisAngleLabel = (widget as any).get('AXIS_ANGLE_LABEL') as AnyWidget
    if (this.axisAngleLabel) {
      ;(this.axisAngleLabel as any).isVisible = isFlipMode
    }

    this.axisAngleSlider = (widget as any).get('AXIS_ANGLE_SLIDER') as AnyWidget
    if (this.axisAngleSlider) {
      ;(this.axisAngleSlider as any).minimumValue = 0
      ;(this.axisAngleSlider as any).maximumValue = 11
      ;(this.axisAngleSlider as any).ticks = 12
      ;(this.axisAngleSlider as any).isVisible = isFlipMode
      // BLOCKER-FIX: wire OnChange handler (C#: slider.OnChange += (val) => markerLayerTrait.AxisAngle = (int)val * 15)
      this.wireSliderOnChange(this.axisAngleSlider, (val: number) => {
        this.markerLayerTrait.axisAngle = (val | 0) * 15
      })
      ;(this.axisAngleSlider as any).getValue = () => this.markerLayerTrait.axisAngle / 15
    }

    this.axisAngleValueLabel = (widget as any).get('AXIS_ANGLE_VALUE') as AnyWidget
    if (this.axisAngleValueLabel) {
      ;(this.axisAngleValueLabel as any).isVisible = isFlipMode
      ;(this.axisAngleValueLabel as any).getText = () => this.markerLayerTrait.axisAngle.toString()
    }
  }

  // -------------------------------------------------------------------------
  // Dispose (对应 OpenRA Dispose)
  // -------------------------------------------------------------------------

  override dispose(): void {
    // BLOCKER-FIX: restore the previous brushChangedCallback to unlink our handler
    if ((this as any)._savedBrushChangedCallback !== undefined) {
      ;(this.editor as any).brushChangedCallback = (this as any)._savedBrushChangedCallback
    }
    super.dispose()
  }

  // -------------------------------------------------------------------------
  // Tick (abstract from ChromeLogic)
  // -------------------------------------------------------------------------

  override tick(): void {
    // Marker tiles logic has no per-frame logic — updates reactively via events
  }

  // -------------------------------------------------------------------------
  // SetupColorSwatchItem (对应 OpenRA SetupColorSwatchItem)
  // -------------------------------------------------------------------------

  /** Create a color swatch scroll item for the given marker index.
   *
   * OpenRA 对照: SetupColorSwatchItem(int index, ScrollItemWidget template)
   */
  private setupColorSwatchItem(
    idx: number,
    template: AnyWidget,
    _colorIndex: number,
    color: number,
  ): AnyWidget {
    const item = (template as any).clone?.() as AnyWidget ?? template

    ;(item as any).isSelected = () => this.markerTile === idx
    ;(item as any).onClick = () => {
      this.markerTile = idx
      this.editor.setBrush(this.createMarkerBrush(this.editor, idx, undefined))
    }

    const preview = (item as any).get('TILE_PREVIEW') as AnyWidget
    if (preview) {
      ;(preview as any).getColor = () => color
    }

    return item
  }

  // -------------------------------------------------------------------------
  // SetupEraseItem (对应 OpenRA SetupEraseItem)
  // -------------------------------------------------------------------------

  /** Create the erase scroll item.
   *
   * OpenRA 对照: SetupEraseItem(ScrollItemWidget template)
   */
  private setupEraseItem(template: AnyWidget): AnyWidget {
    const item = (template as any).clone?.() as AnyWidget ?? template

    ;(item as any).isSelected = () =>
      this.markerTile === null &&
      (this.editor.currentBrush as IEditorMarkerBrush | null)?.template !== undefined

    ;(item as any).onClick = () => {
      this.markerTile = null
      this.editor.setBrush(this.createMarkerBrush(this.editor, null, undefined))
    }

    return item
  }

  // -------------------------------------------------------------------------
  // wireSliderOnChange — robustly wire a SliderWidget's OnChange handler
  // -------------------------------------------------------------------------

  /**
   * Wire an OnChange handler to a slider widget, handling both the
   * array-based (Ch16 SliderWidget) and function-based fallback patterns.
   *
   * MAJOR-FIX: replaces fragile array-vs-function check with a unified approach.
   *
   * @param slider — the slider widget
   * @param handler — the value change handler
   */
  private wireSliderOnChange(slider: AnyWidget, handler: (val: number) => void): void {
    const s = slider as any
    // SliderWidget stores handlers in _changeHandlers array (Ch16 pattern)
    if (s._changeHandlers) {
      s._changeHandlers.push(handler)
    } else if (Array.isArray(s.onChange)) {
      s.onChange.push(handler)
    } else if (typeof s.onChange === 'function') {
      // Single-function fallback: wrap to call both
      const prev = s.onChange as ((v: number) => void) | undefined
      s.onChange = (v: number) => { prev?.(v); handler(v) }
    } else {
      // No handler infrastructure yet — set as the sole handler
      s.onChange = handler
    }
  }

  // -------------------------------------------------------------------------
  // HandleBrushChanged (对应 OpenRA HandleBrushChanged)
  // -------------------------------------------------------------------------

  /** Reset marker tile selection when brush changes away from marker brush.
   *
   * OpenRA 对照: HandleBrushChanged()
   */
  handleBrushChanged(): void {
    const brush = this.editor.currentBrush as IEditorMarkerBrush | null
    if (!brush || brush.template === undefined) {
      this.markerTile = null
    }
  }

  // -------------------------------------------------------------------------
  // ClearSelected (对应 OpenRA ClearSelected)
  // -------------------------------------------------------------------------

  /** Clear all markers of the currently selected type. */
  clearSelected(): void {
    const brush = this.editor.currentBrush as IEditorMarkerBrush | null
    const templateVal = brush?.template
    if (templateVal !== null && templateVal !== undefined) {
      const tiles = this.markerLayerTrait.tiles.get(templateVal)
      if (tiles && tiles.length > 0) {
        this.editorActionManager.Add(
          new ClearSelectedMarkerTilesEditorAction(templateVal, this.markerLayerTrait),
        )
      }
    }
  }

  // -------------------------------------------------------------------------
  // ClearAll (对应 OpenRA ClearAll)
  // -------------------------------------------------------------------------

  /** Clear all marker tiles across all types. */
  clearAll(): void {
    const entries = [...this.markerLayerTrait.tiles.entries()]
    if (entries.length > 0 && entries.some(([, cells]) => cells.length > 0)) {
      this.editorActionManager.Add(
        new ClearAllMarkerTilesEditorAction(this.markerLayerTrait),
      )
    }
  }
}
