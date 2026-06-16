/**
 * RadarWidget.ts — 实时小地图控件: Canvas 2D 像素渲染地形/单位/战争迷雾
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/RadarWidget.cs (530 lines)
 *
 * 核心范式转换:
 * - C# Sheet BGRA unsafe byte pointer 像素操作 → Canvas 2D ImageData Uint8ClampedArray
 * - C# Sprite + WidgetUtils.DrawSprite() GPU 绘制 → Canvas 2D drawImage() / putImageData()
 * - C# Game.Renderer.EnableScissor() 裁剪 → Canvas clip() 或视口矩形 clip rect
 * - C# RgbaColorRenderer.DrawRect/DrawPolygon → Canvas 2D strokeRect/stroke + lineTo
 * - C# radarSheet.CommitBufferedData() → no-op (Canvas 即时)
 * - C# CellToMinimapPixel / MinimapPixelToWorldCoords → 相同数学公式，浮点数
 * - C# radarMinimapHeight 动画 slide → CSS transform scaleY + transition
 * - C# unsafe fixed byte* 颜色写入 → ImageData.data Uint8ClampedArray 像素写入
 * - C# 2x2 grid Sheet layout → 三幅独立 ImageData: terrain, actor, shroud
 * - Dirty rectangle tracking: 每帧增量更新而非全量重建
 */

import { Widget } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetArgs, WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// Color constants
// OpenRA 对照: RadarWidget.ColorFog / ColorShroud
// ---------------------------------------------------------------------------

/** Fog of war color: semi-transparent black (ARGB 0x80000000).
 * OpenRA 对照: ColorFog = Color.FromArgb(128, Color.Black).ToArgb()
 *
 * On Canvas: rgba(0, 0, 0, 0.5) */
const COLOR_FOG_R = 0
const COLOR_FOG_G = 0
const COLOR_FOG_B = 0
const COLOR_FOG_A = 128

/** Shroud color: fully opaque black.
 * OpenRA 对照: ColorShroud = Color.Black.ToArgb() */
const COLOR_SHROUD_R = 0
const COLOR_SHROUD_G = 0
const COLOR_SHROUD_B = 0
const COLOR_SHROUD_A = 255

/** Viewport rectangle color: white. */
const COLOR_VIEWPORT = '#ffffff'

// ---------------------------------------------------------------------------
// Fog/Shroud visibility bitmask — matching Shroud.CellVisibility
// ---------------------------------------------------------------------------

/**
 * Per-cell visibility flags. The minimap uses these to determine
 * fog (explored but not currently visible) vs shroud (unexplored).
 *
 * OpenRA 对照: Shroud.CellVisibility (Flags enum)
 */
export const CellVisibility = {
  /** Cell is not explored at all (full black). */
  None: 0,
  /** Cell has been explored (semi-transparent black = fog). */
  Explored: 1,
  /** Cell is currently visible (no overlay). */
  Visible: 2,
} as const

export type CellVisibilityFlags = number

// ---------------------------------------------------------------------------
// MinimapCellPosition — projected cell coordinate
// OpenRA 对照: PPos (PPos.cs)
// ---------------------------------------------------------------------------

/** Projected cell position (for shroud lookups).
 *
 * OpenRA 对照: PPos
 */
export interface PPos {
  readonly u: number
  readonly v: number
}

// ---------------------------------------------------------------------------
// MinimapMapCell — map cell coordinate
// OpenRA 对照: MPos
// ---------------------------------------------------------------------------

/** Map cell position (unprojected, for terrain/actor lookups).
 *
 * OpenRA 对照: MPos
 */
export interface MPos {
  readonly u: number
  readonly v: number
}

// ---------------------------------------------------------------------------
// MinimapWorldCoords — world position in WPos-like coordinates
// OpenRA 对照: WPos
// ---------------------------------------------------------------------------

/** World-space position (1024 units per cell).
 *
 * OpenRA 对照: WPos
 */
export interface RadarWorldCoords {
  readonly x: number
  readonly y: number
}

// ---------------------------------------------------------------------------
// Map stub interface (minimal map info needed for minimap)
// OpenRA 对照: Map.cs (partial)
// ---------------------------------------------------------------------------

/**
 * Minimal map info interface for the minimap widget.
 *
 * OpenRA 对照: Map (partial — bounds, grid, cell lookup)
 */
export interface RadarMapInfo {
  readonly bounds: { left: number; top: number; right: number; bottom: number }
  readonly mapSize: { width: number; height: number }
  readonly grid: { type: RadarGridType }
  /** Convert CPos to MPos. */
  cellContaining(wpos: RadarWorldCoords): { toMPos: (grid: { type: RadarGridType }) => MPos }
  /** Unproject PPos to MPos array. */
  unproject?(ppos: PPos): MPos[]
}

export const RadarGridType = {
  Rectangular: 0,
  RectangularIsometric: 1,
} as const

export type RadarGridType = (typeof RadarGridType)[keyof typeof RadarGridType]

// ---------------------------------------------------------------------------
// Shroud stub interface
// OpenRA 对照: Shroud (partial)
// ---------------------------------------------------------------------------

/**
 * Minimal shroud interface for the minimap.
 *
 * OpenRA 对照: Shroud
 */
export interface RadarShroudStub {
  /** Get visibility for a projected cell. */
  getVisibility(ppos: PPos): CellVisibilityFlags
  /** Subscribe to shroud changes. Returns unsubscribe function. */
  onShroudChanged(callback: (ppos: PPos) => void): () => void
}

// ---------------------------------------------------------------------------
// Viewport stub for minimap
// OpenRA 对照: Viewport (partial)
// ---------------------------------------------------------------------------

/**
 * Minimal viewport interface for the minimap.
 *
 * OpenRA 对照: Viewport
 */
export interface RadarViewportStub {
  readonly topLeft: RadarWorldCoords
  readonly bottomRight: RadarWorldCoords
  /** Center viewport on world position. */
  center(wpos: RadarWorldCoords): void
  /** Convert world position to screen pixel. */
  worldToViewPx(worldPixel: { x: number; y: number }): { x: number; y: number }
}

// ---------------------------------------------------------------------------
// WorldRenderer stub
// OpenRA 对照: WorldRenderer (partial)
// ---------------------------------------------------------------------------

/**
 * Minimal world renderer interface for the minimap.
 *
 * OpenRA 对照: WorldRenderer
 */
export interface RadarWorldRendererStub {
  readonly viewport: RadarViewportStub
  /** Convert world position to screen pixel. */
  screenPxPosition(wpos: RadarWorldCoords): { x: number; y: number }
  /** Project world position to cell position. */
  projectedPosition(wpos: RadarWorldCoords): { toMPos: (grid: { type: RadarGridType }) => MPos }
}

// ---------------------------------------------------------------------------
// Actor radar signature — unit dots on minimap
// OpenRA 对照: IRadarSignature
// ---------------------------------------------------------------------------

/**
 * Radar cell with color for actor rendering.
 *
 * OpenRA 对照: (CPos Cell, Color Color) tuple
 */
export interface RadarCell {
  readonly cell: { toMPos: (grid: { type: RadarGridType }) => MPos }
  readonly color: { r: number; g: number; b: number; a: number }
}

// ---------------------------------------------------------------------------
// RadarWidget
// OpenRA 对照: RadarWidget : Widget, IDisposable
// ---------------------------------------------------------------------------

/**
 * Minimap widget with terrain, actor, and shroud layers rendered via Canvas 2D.
 *
 * OpenRA 对照: RadarWidget
 *
 * Supports:
 * - Cached terrain layer (rebuilt on map change)
 * - Per-frame actor dot layer
 * - Event-driven shroud layer
 * - Camera viewport rectangle
 * - Click-to-jump camera
 * - Drag-to-pan
 * - Slide-in/out animation
 */
export class RadarWidget extends Widget {
  /** Animation length in frames.
   *
   * OpenRA 对照: RadarWidget.AnimationLength
   */
  animationLength: number = 5

  /** Is-enabled delegate. Returns true when radar is online.
   *
   * OpenRA 对照: RadarWidget.IsEnabled
   */
  isEnabled: (() => boolean) = () => true

  /** Sound callback for radar online.
   *
   * OpenRA 对照: RadarWidget.RadarOnlineSound
   */
  radarOnlineSound: string | null = null

  /** Sound callback for radar offline.
   *
   * OpenRA 对照: RadarWidget.RadarOfflineSound
   */
  radarOfflineSound: string | null = null

  /** Animation progress callback.
   *
   * OpenRA 对照: RadarWidget.Animating
   */
  onAnimating: ((progress: number) => void) | null = null

  /** Callback when radar fully opens.
   *
   * OpenRA 对照: RadarWidget.AfterOpen
   */
  onAfterOpen: (() => void) | null = null

  /** Callback when radar fully closes.
   *
   * OpenRA 对照: RadarWidget.AfterClose
   */
  onAfterClose: (() => void) | null = null

  /** Sound delegate for radar audio. */
  soundDelegate: {
    play: (category: string, sound: string) => void
  } | null = null

  // ---- Map data ----

  /** Reference to the game map.
   *
   * OpenRA 对照: RadarWidget.world.Map
   */
  mapInfo: RadarMapInfo | null = null

  /** Reference to the shroud (null if no shroud/spectator).
   *
   * OpenRA 对照: RadarWidget.shroud
   */
  shroud: RadarShroudStub | null = null

  /** Reference to the viewport.
   *
   * OpenRA 对照: worldRenderer.Viewport
   */
  viewport: RadarViewportStub | null = null

  /** World renderer reference.
   *
   * OpenRA 对照: RadarWidget.worldRenderer
   */
  worldRenderer: RadarWorldRendererStub | null = null

  // ---- Terrain color provider ----

  /** Get terrain colors for a map cell.
   * Returns [leftColor, rightColor] (only left used for rectangular maps,
   * both for isometric).
   *
   * Each color is: { r, g, b, a } (0-255 per channel)
   */
  terrainColorProvider:
    | ((uv: MPos) => { r: number; g: number; b: number; a: number })
    | null = null

  // ---- Actor radar signature provider ----

  /** Get all radar-signature cells for the current frame.
   *
   * OpenRA 对照: world.ActorsWithTrait<IRadarSignature>()
   */
  actorRadarProvider: (() => RadarCell[]) | null = null

  // ---- Order generator interaction ----

  /** The world interaction controller widget ID (for click-through orders).
   *
   * OpenRA 对照: RadarWidget.WorldInteractionController
   */
  worldInteractionController: string | null = null

  /** Delegate for dispatching orders through the minimap click. */
  orderDelegate: ((worldCoords: RadarWorldCoords, button: number) => void) | null = null

  // ---- Internal state ----

  /** Cached terrain ImageData. Rebuilt only on map/player change. */
  private _terrainImageData: ImageData | null = null

  /** Actor layer ImageData. Rebuilt each frame. */
  private _actorImageData: ImageData | null = null

  /** Shroud layer ImageData. Updated per-cell change. */
  private _shroudImageData: ImageData | null = null

  /** Canvas element for compositing layers. */
  private _canvas: HTMLCanvasElement | null = null

  /** Offscreen canvas for terrain (cached). */
  private _terrainCanvas: HTMLCanvasElement | null = null

  /** Offscreen canvas for actors (per-frame). */
  private _actorCanvas: HTMLCanvasElement | null = null

  /** Offscreen canvas for shroud. */
  private _shroudCanvas: HTMLCanvasElement | null = null

  /** Preview origin (top-left corner within the widget). */
  private _previewOrigin: { x: number; y: number } = { x: 0, y: 0 }

  /** Preview scale: pixels per map cell. */
  private _previewScale: number = 1

  /** Map rectangle in widget-local coordinates. */
  private _mapRect: { x: number; y: number; width: number; height: number } = {
    x: 0, y: 0, width: 0, height: 0,
  }

  /** Is the map rectangular isometric? */
  private _isRectangularIsometric: boolean = false

  /** Cell width (1 for rect, 2 for iso). */
  private _cellWidth: number = 1

  /** Preview width in cells. */
  private _previewWidth: number = 0

  /** Preview height in cells. */
  private _previewHeight: number = 0

  /** Animation state: current frame (0 = fully hidden, animationLength = fully shown). */
  private _frame: number = 0

  /** Whether the radar is actually online and rendering. */
  private _hasRadar: boolean = false

  /** Whether radar was enabled last tick. */
  private _cachedEnabled: boolean = false

  /** Minimap height animation progress (0-1). */
  private _radarMinimapHeight: number = 0

  /** Is the user currently dragging the minimap? */
  private _isMinimapMoving: boolean = false

  /** Which button initiated the minimap drag? */
  private _minimapMoveButton: number = -1

  /** Shroud change unsubscribe function. */
  private _unsubscribeShroud: (() => void) | null = null

  /** Track whether the Canvas layers need initialization. */
  private _layersInitialized: boolean = false

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    super()
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // OpenRA 对照: RadarWidget.Initialize(WidgetArgs)
  // ---------------------------------------------------------------------------

  /**
   * Initialize the widget and create canvas layers.
   *
   * OpenRA 对照: RadarWidget.Initialize(WidgetArgs)
   */
  override initialize(args: WidgetArgs): void {
    super.initialize(args)
    this._rebuildMapBounds()
  }

  // ---------------------------------------------------------------------------
  // Map bounds recalculation
  // OpenRA 对照: RadarWidget.MapBoundsChanged()
  // ---------------------------------------------------------------------------

  /**
   * Recalculate map bounds, preview scale, and origin.
   * Called on map change or widget resize.
   *
   * OpenRA 对照: RadarWidget.MapBoundsChanged()
   */
  private _rebuildMapBounds(): void {
    if (!this.mapInfo) return

    const map = this.mapInfo
    this._isRectangularIsometric =
      map.grid.type === RadarGridType.RectangularIsometric
    this._cellWidth = this._isRectangularIsometric ? 2 : 1
    this._previewWidth = map.mapSize.width
    this._previewHeight = map.mapSize.height

    if (this._isRectangularIsometric) {
      this._previewWidth = 2 * this._previewWidth - 1
    }

    const projectedLeft = map.bounds.left
    const projectedRight = map.bounds.right
    const projectedTop = map.bounds.top
    const projectedBottom = map.bounds.bottom

    let top = Infinity
    let bottom = -Infinity
    const left = projectedLeft * this._cellWidth
    const right = projectedRight * this._cellWidth

    if (map.unproject) {
      for (let x = projectedLeft; x < projectedRight; x++) {
        const allTop = map.unproject({ u: x, v: projectedTop })
        const allBottom = map.unproject({ u: x, v: projectedBottom })

        if (allTop.length > 0) {
          top = Math.min(top, allTop.reduce((min, uv) => Math.min(min, uv.v), Infinity))
        } else {
          top = map.bounds.top
        }

        if (allBottom.length > 0) {
          bottom = Math.max(bottom, allBottom.reduce((max, uv) => Math.max(max, uv.v), -Infinity))
        } else {
          bottom = map.bounds.bottom
        }
      }
    } else {
      top = map.bounds.top
      bottom = map.bounds.bottom
    }

    const bWidth = right - left
    const bHeight = bottom - top

    const rbWidth = this.bounds.width
    const rbHeight = this.bounds.height

    this._previewScale = Math.min(
      rbWidth / bWidth,
      rbHeight / bHeight,
    )

    this._previewOrigin = {
      x: Math.round((rbWidth - this._previewScale * bWidth) / 2),
      y: Math.round(
        (rbHeight - this._previewScale * bHeight) / 2,
      ),
    }

    this._mapRect = {
      x: this._previewOrigin.x,
      y: this._previewOrigin.y,
      width: Math.round(this._previewScale * bWidth),
      height: Math.round(this._previewScale * bHeight),
    }

    this._layersInitialized = false
  }

  // ---------------------------------------------------------------------------
  // Layer initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize the three offscreen canvases for terrain, actors, and shroud.
   */
  private _initLayers(): void {
    if (this._layersInitialized) return
    if (!this.mapInfo) return

    const w = this._previewWidth
    const h = this._previewHeight

    // Create canvases; handle environments without full Canvas 2D support
    this._terrainCanvas = document.createElement('canvas')
    this._terrainCanvas.width = w
    this._terrainCanvas.height = h
    const terrainCtx = this._terrainCanvas.getContext('2d')
    if (terrainCtx) {
      this._terrainImageData = terrainCtx.createImageData(w, h)
    }

    this._actorCanvas = document.createElement('canvas')
    this._actorCanvas.width = w
    this._actorCanvas.height = h
    const actorCtx = this._actorCanvas.getContext('2d')
    if (actorCtx) {
      this._actorImageData = actorCtx.createImageData(w, h)
    }

    this._shroudCanvas = document.createElement('canvas')
    this._shroudCanvas.width = w
    this._shroudCanvas.height = h
    const shroudCtx = this._shroudCanvas.getContext('2d')
    if (shroudCtx) {
      this._shroudImageData = shroudCtx.createImageData(w, h)

      // Initialize shroud to fully opaque black (unexplored)
      if (this._shroudImageData) {
        const shroudData = this._shroudImageData.data
        for (let i = 0; i < shroudData.length; i += 4) {
          shroudData[i] = COLOR_SHROUD_R
          shroudData[i + 1] = COLOR_SHROUD_G
          shroudData[i + 2] = COLOR_SHROUD_B
          shroudData[i + 3] = COLOR_SHROUD_A
        }
        shroudCtx.putImageData(this._shroudImageData, 0, 0)
      }
    }

    this._layersInitialized = true
  }

  // ---------------------------------------------------------------------------
  // Set terrain color for a single cell
  // OpenRA 对照: RadarWidget.UpdateTerrainColor(MPos)
  // ---------------------------------------------------------------------------

  /**
   * Update a single terrain cell's color.
   *
   * OpenRA 对照: RadarWidget.UpdateTerrainColor(MPos uv)
   *
   * @param uv — map position
   */
  updateTerrainColor(uv: MPos): void {
    if (!this._terrainImageData || !this.mapInfo) return

    const colorFn = this.terrainColorProvider
    if (!colorFn) return

    const color = colorFn(uv)
    const stride = this._previewWidth
    const data = this._terrainImageData.data

    this._setPixelInImageData(
      data,
      stride,
      uv.u,
      uv.v,
      color.r,
      color.g,
      color.b,
      color.a,
      this._isRectangularIsometric,
    )

    // Upload to canvas
    if (this._terrainCanvas) {
      const ctx = this._terrainCanvas.getContext('2d')!
      ctx.putImageData(this._terrainImageData, 0, 0)
    }
  }

  // ---------------------------------------------------------------------------
  // Update shroud for a single projected cell
  // OpenRA 对照: RadarWidget.UpdateShroudCell(PPos)
  // ---------------------------------------------------------------------------

  /**
   * Update shroud visibility for a projected cell.
   *
   * OpenRA 对照: RadarWidget.UpdateShroudCell(PPos puv)
   *
   * @param puv — projected cell position
   */
  updateShroudCell(puv: PPos): void {
    if (!this._shroudImageData || !this.mapInfo) return
    if (!this.shroud) return

    const visibility = this.shroud.getVisibility(puv)
    let r: number, g: number, b: number, a: number

    if (!(visibility & CellVisibility.Explored)) {
      r = COLOR_SHROUD_R
      g = COLOR_SHROUD_G
      b = COLOR_SHROUD_B
      a = COLOR_SHROUD_A
    } else if (!(visibility & CellVisibility.Visible)) {
      r = COLOR_FOG_R
      g = COLOR_FOG_G
      b = COLOR_FOG_B
      a = COLOR_FOG_A
    } else {
      // Visible: no overlay (= fully transparent)
      r = 0
      g = 0
      b = 0
      a = 0
    }

    const stride = this._previewWidth
    const data = this._shroudImageData.data

    // Unproject PPos to get all map cells this projected cell covers
    const map = this.mapInfo
    if (map.unproject) {
      const cells = map.unproject(puv)
      for (const iuv of cells) {
        this._setPixelInImageData(
          data,
          stride,
          iuv.u,
          iuv.v,
          r,
          g,
          b,
          a,
          this._isRectangularIsometric,
        )
      }
    }

    // Upload to canvas
    if (this._shroudCanvas) {
      const ctx = this._shroudCanvas.getContext('2d')!
      ctx.putImageData(this._shroudImageData, 0, 0)
    }
  }

  // ---------------------------------------------------------------------------
  // Update actor layer for the current frame
  // OpenRA 对照: RadarWidget.Tick() actor layer rebuild
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the entire actor layer from current actor radar signatures.
   *
   * OpenRA 对照: RadarWidget.Tick() — Array.Clear + PopulateRadarSignatureCells
   */
  private _updateActorLayer(): void {
    if (!this._actorImageData || !this._actorCanvas || !this.mapInfo) return

    const stride = this._previewWidth
    const data = this._actorImageData.data

    // Clear actor layer (all transparent)
    data.fill(0)

    if (!this._hasRadar) return

    // Get current actor radar cells
    const cells = this.actorRadarProvider?.() ?? []

    for (const cell of cells) {
      if (!cell.cell) continue

      const uv = cell.cell.toMPos({
        type: this._isRectangularIsometric
          ? RadarGridType.RectangularIsometric
          : RadarGridType.Rectangular,
      })

      const color = cell.color
      this._setPixelInImageData(
        data,
        stride,
        uv.u,
        uv.v,
        color.r,
        color.g,
        color.b,
        color.a,
        this._isRectangularIsometric,
      )
    }

    const ctx = this._actorCanvas.getContext('2d')!
    ctx.putImageData(this._actorImageData, 0, 0)
  }

  // ---------------------------------------------------------------------------
  // Pixel write helper
  // ---------------------------------------------------------------------------

  /**
   * Set a pixel in ImageData, handling isometric row offset.
   *
   * @param data — ImageData.data (Uint8ClampedArray)
   * @param stride — row stride in pixels (canvas width)
   * @param u — cell column
   * @param v — cell row
   * @param r — red (0-255)
   * @param g — green (0-255)
   * @param b — blue (0-255)
   * @param a — alpha (0-255)
   * @param isIsometric — whether the grid is rectangular isometric
   */
  private _setPixelInImageData(
    data: Uint8ClampedArray,
    stride: number,
    u: number,
    v: number,
    r: number,
    g: number,
    b: number,
    a: number,
    isIsometric: boolean,
  ): void {
    if (isIsometric) {
      // Odd rows are shifted right by 1px
      const dx = v & 1
      if (u + dx > 0) {
        const idx = (v * stride + 2 * u + dx - 1) * 4
        if (idx >= 0 && idx + 3 < data.length) {
          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = a
        }
      }
      if (2 * u + dx < stride) {
        const idx = (v * stride + 2 * u + dx) * 4
        if (idx >= 0 && idx + 3 < data.length) {
          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = a
        }
      }
    } else {
      const idx = (v * stride + u) * 4
      if (idx >= 0 && idx + 3 < data.length) {
        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
        data[idx + 3] = a
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Coordinate transforms
  // OpenRA 对照: RadarWidget.CellToMinimapPixel / MinimapPixelToWorldCoords
  // ---------------------------------------------------------------------------

  /**
   * Convert a cell position to minimap pixel coordinates within the widget.
   *
   * OpenRA 对照: RadarWidget.CellToMinimapPixel(CPos p)
   *
   * @param uv — map cell position
   * @returns pixel coordinates (relative to widget)
   */
  cellToMinimapPixel(uv: MPos): { x: number; y: number } {
    if (!this.mapInfo) return { x: 0, y: 0 }

    // NOTE: 使用 Math.trunc() 匹配 C# 的 (int) 截断语义 (RadarWidget.cs:487-488)
    // C#: var dx = (int)(previewScale * cellWidth * (uv.U - world.Map.Bounds.Left));
    // C#: var dy = (int)(previewScale * (uv.V - world.Map.Bounds.Top));
    let dx = Math.trunc(
      this._previewScale * this._cellWidth * (uv.u - this.mapInfo.bounds.left),
    )
    const dy = Math.trunc(
      this._previewScale * (uv.v - this.mapInfo.bounds.top),
    )

    // Odd rows are shifted right by 1px
    if (this._isRectangularIsometric && (uv.v & 1) === 1) {
      dx += 1
    }

    return {
      x: this._mapRect.x + dx,
      y: this._mapRect.y + dy,
    }
  }

  /**
   * Convert minimap pixel coordinates to world coordinates.
   *
   * OpenRA 对照: RadarWidget.MinimapPixelToWorldCoords(int2 pixel)
   *
   * @param pixel — pixel coordinates (relative to widget)
   * @returns world coordinates
   */
  minimapPixelToWorldCoords(pixel: { x: number; y: number }): RadarWorldCoords {
    if (!this.mapInfo) return { x: 0, y: 0 }

    const u =
      (pixel.x - this._mapRect.x) / (this._previewScale * this._cellWidth) +
      this.mapInfo.bounds.left
    const v =
      (pixel.y - this._mapRect.y) / this._previewScale +
      this.mapInfo.bounds.top

    const gridType = this.mapInfo.grid.type

    if (gridType === RadarGridType.Rectangular) {
      return {
        x: 1024 * u + 512,
        y: 1024 * v + 512,
      }
    } else {
      // RectangularIsometric
      //
      // NOTE: 本公式与 C# 源码完全一致 (RadarWidget.cs:502-511):
      //   float y = v / 2.0f - u;
      //   float x = v - y;
      //   return new float2(724 * (x - y), 724 * (x + y));
      //
      // 数学推导 (代入展开验证):
      //   x = v - y = v - (v/2 - u) = v/2 + u
      //   y = v/2 - u
      //   x - y = (v/2 + u) - (v/2 - u) = 2u
      //   x + y = (v/2 + u) + (v/2 - u) = v
      // 因此: worldX = 724 * 2u = 1448*u, worldY = 724 * v
      // (u, v 是经过 mapRect 和 cellWidth 归一化的细胞空间坐标)
      //
      // C# RadarWidget.cs 的 MinimapPixelToWorldCoords 中不包含 screenPxPosition
      // 调用；该调用仅出现在 GetCursor() (C#:295-307) 中用于触发 OrderGenerator
      // 光标查询，与坐标变换无关。
      const y = v / 2.0 - u
      const x = v - y
      return {
        x: 724 * (x - y),
        y: 724 * (x + y),
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse handling
  // OpenRA 对照: RadarWidget.HandleMouseInput(MouseInput)
  // ---------------------------------------------------------------------------

  /**
   * Handle mouse events for the minimap.
   *
   * OpenRA 对照: RadarWidget.HandleMouseInput(MouseInput)
   *
   * Supports:
   * - Click (non-action button): center camera
   * - Drag: pan camera
   * - Click (action button): dispatch order at world position
   *
   * @param event — widget event
   * @returns true if event was handled (within minimap rect)
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (!this.mapInfo) return false

    const posX = (event.clientX ?? 0) as number
    const posY = (event.clientY ?? 0) as number

    // Gate: event must be within mapRect
    const mr = this._mapRect
    if (
      posX < mr.x ||
      posX >= mr.x + mr.width ||
      posY < mr.y ||
      posY >= mr.y + mr.height
    ) {
      return false
    }

    // Block events through minimap area even if no radar
    if (!this._hasRadar) return true

    const worldCoords = this.minimapPixelToWorldCoords({
      x: posX,
      y: posY,
    })

    const button = (event as unknown as { button?: number }).button ?? 0
    const isActionButton = button === 0 // Left click = action button

    if (
      (event.type === 'mousedown' && !isActionButton) ||
      (event.type === 'mousemove' && this._isMinimapMoving && button === this._minimapMoveButton)
    ) {
      // Center camera on click position (non-action button = camera move)
      this.viewport?.center(worldCoords)
      this._isMinimapMoving = true
      this._minimapMoveButton = button
      return true
    }

    if (event.type === 'mousedown' && isActionButton) {
      // Dispatch order through the minimap
      this.orderDelegate?.(worldCoords, button)
      return true
    }

    if (event.type === 'mouseup' && button === this._minimapMoveButton) {
      this._isMinimapMoving = false
      this._minimapMoveButton = -1
    }

    return true
  }

  // ---------------------------------------------------------------------------
  // Cursor
  // OpenRA 对照: RadarWidget.GetCursor(int2)
  // ---------------------------------------------------------------------------

  /**
   * Get cursor for position over minimap.
   *
   * OpenRA 对照: RadarWidget.GetCursor(int2 pos)
   *
   * @param _pos — screen position
   * @returns cursor name or null
   */
  override getCursor(_pos: { x: number; y: number }): string | null {
    if (!this.mapInfo || !this._hasRadar) return null
    return 'default' // Neutral cursor (no order generator integration yet)
  }

  // ---------------------------------------------------------------------------
  // Render
  // OpenRA 对照: RadarWidget.Draw()
  // ---------------------------------------------------------------------------

  /**
   * Render the minimap to a DOM element.
   *
   * OpenRA 对照: RadarWidget.Draw()
   *
   * Composites terrain, actor, and shroud layers onto the visible canvas
   * with the correct scale/position. Draws viewport rectangle on top.
   *
   * @returns HTMLElement — canvas container
   */
  override render(): HTMLElement {
    const el = this.getOrCreateElement('div', 'radar-widget')
    el.style.position = 'absolute'
    el.style.overflow = 'hidden'

    if (!this.mapInfo) {
      el.textContent = 'No map'
      return el
    }

    this._initLayers()

    // Create composited canvas if needed
    if (!this._canvas) {
      this._canvas = document.createElement('canvas')
      this._canvas.width = this.bounds.width
      this._canvas.height = this.bounds.height
    }

    const canvas = this._canvas
    const ctx = canvas.getContext('2d')

    // Always append the canvas, even if ctx is not available
    while (el.lastChild) {
      el.removeChild(el.lastChild)
    }
    el.appendChild(canvas)

    // Skip drawing if no context (e.g., headless test environment)
    if (!ctx) return el

    // Clear compositing canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const mr = this._mapRect
    const minimapHeight = this._radarMinimapHeight

    // Draw layers scissored/transformed to animation height
    ctx.save()
    ctx.beginPath()
    ctx.rect(mr.x, mr.y, mr.width, mr.height * minimapHeight)
    ctx.clip()

    // ---- Terrain layer ----
    if (this._terrainCanvas) {
      ctx.drawImage(
        this._terrainCanvas,
        mr.x,
        mr.y,
        mr.width,
        mr.height * minimapHeight,
      )
    }

    // ---- Actor layer ----
    if (this._actorCanvas) {
      ctx.drawImage(
        this._actorCanvas,
        mr.x,
        mr.y,
        mr.width,
        mr.height * minimapHeight,
      )
    }

    // ---- Shroud layer ----
    if (this.shroud && this._shroudCanvas) {
      ctx.drawImage(
        this._shroudCanvas,
        mr.x,
        mr.y,
        mr.width,
        mr.height * minimapHeight,
      )
    }

    ctx.restore()

    // ---- Viewport rectangle ----
    if (ctx && this._hasRadar && this.viewport && this.mapInfo) {
      this._drawViewportRect(ctx)
    }

    return el
  }

  /**
   * Draw the camera viewport rectangle on the minimap.
   *
   * OpenRA 对照: RadarWidget.Draw() viewport rect section
   */
  private _drawViewportRect(ctx: CanvasRenderingContext2D): void {
    if (!this.viewport || !this.mapInfo || !this.worldRenderer) return

    const tl = this.cellToMinimapPixel(
      this.cellContainingFromWorld(this.viewport.topLeft),
    )
    const br = this.cellToMinimapPixel(
      this.cellContainingFromWorld(this.viewport.bottomRight),
    )

    ctx.save()
    ctx.strokeStyle = COLOR_VIEWPORT
    ctx.lineWidth = 1

    // Constrain to map rect
    const mr = this._mapRect
    ctx.beginPath()
    ctx.rect(mr.x, mr.y, mr.width, mr.height * this._radarMinimapHeight)
    ctx.clip()

    ctx.strokeRect(
      tl.x,
      tl.y,
      br.x - tl.x,
      br.y - tl.y,
    )

    ctx.restore()
  }

  /**
   * Get map cell containing a world position.
   */
  private cellContainingFromWorld(wpos: RadarWorldCoords): MPos {
    if (!this.mapInfo) return { u: 0, v: 0 }
    // Use the projectedPosition helper to get the cell containing the world position
    if (this.worldRenderer) {
      return this.worldRenderer.projectedPosition(wpos).toMPos({
        type: this.mapInfo.grid.type,
      })
    }
    // Fallback: rough estimate using 1024 units per cell
    return {
      u: Math.floor(wpos.x / 1024),
      v: Math.floor(wpos.y / 1024),
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // OpenRA 对照: RadarWidget.Tick()
  // ---------------------------------------------------------------------------

  /**
   * Per-frame update: animation, actor layer rebuild, enable/disable.
   *
   * OpenRA 对照: RadarWidget.Tick()
   */
  override tick(): void {
    // Enable/disable radar
    const enabled = this.isEnabled()
    if (enabled !== this._cachedEnabled) {
      if (this.soundDelegate) {
        const sound = enabled ? this.radarOnlineSound : this.radarOfflineSound
        if (sound) {
          this.soundDelegate.play('UI', sound)
        }
      }
    }
    this._cachedEnabled = enabled

    if (enabled) {
      // Rebuild actor layer every tick
      this._updateActorLayer()
    }

    const targetFrame = enabled ? this.animationLength : 0
    this._hasRadar = enabled && this._frame === this.animationLength

    if (this._frame === targetFrame) return

    this._frame += enabled ? 1 : -1
    this._radarMinimapHeight = this._frame / this.animationLength

    this.onAnimating?.(this._frame / this.animationLength)

    // Animation complete
    if (this._frame === targetFrame) {
      if (enabled) {
        this.onAfterOpen?.()
      } else {
        this.onAfterClose?.()
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Set shroud reference
  // OpenRA 对照: RadarWidget.SetPlayer → shroud subscription
  // ---------------------------------------------------------------------------

  /**
   * Set the shroud reference and subscribe to changes.
   *
   * OpenRA 对照: RadarWidget.SetPlayer — shroud subscription logic
   *
   * @param newShroud — shroud instance or null
   */
  setShroud(newShroud: RadarShroudStub | null): void {
    if (newShroud === this.shroud) return

    // Unsubscribe from old shroud
    if (this._unsubscribeShroud) {
      this._unsubscribeShroud()
      this._unsubscribeShroud = null
    }

    this.shroud = newShroud

    if (newShroud) {
      this._unsubscribeShroud = newShroud.onShroudChanged(
        (puv: PPos) => this.updateShroudCell(puv),
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Rebuild all terrain cells
  // OpenRA 对照: UpdateTerrainColor for all map cells
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the entire terrain layer from map data.
   * Called on map change or render player change.
   */
  rebuildAllTerrain(): void {
    if (!this.mapInfo || !this.terrainColorProvider) return

    const allCells = this._generateAllCells()
    for (const uv of allCells) {
      this.updateTerrainColor(uv)
    }
  }

  /**
   * Generate all map cell positions for iteration.
   */
  private _generateAllCells(): MPos[] {
    if (!this.mapInfo) return []

    const cells: MPos[] = []
    const bounds = this.mapInfo.bounds

    for (let v = bounds.top; v < bounds.bottom; v++) {
      for (let u = bounds.left; u < bounds.right; u++) {
        cells.push({ u, v })
      }
    }
    return cells
  }

  // ---------------------------------------------------------------------------
  // Bounds recalculation helper
  // OpenRA 对照: Widget.Initialize → MapBoundsChanged
  // ---------------------------------------------------------------------------

  /**
   * Set bounds and recalculate map layout.
   *
   * NOTE: Called after initialize() when widget layout changes.
   * Not an override — Widget.bounds is a public property.
   *
   * @param bounds — new bounds
   */
  updateBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds
    this._rebuildMapBounds()
    this._canvas = null // Invalidate compositing canvas
  }

  // ---------------------------------------------------------------------------
  // Removed lifecycle
  // OpenRA 对照: RadarWidget.Removed()
  // ---------------------------------------------------------------------------

  /**
   * Clean up when widget is removed from tree.
   *
   * OpenRA 对照: RadarWidget.Removed()
   */
  override removed(): void {
    // Unsubscribe from shroud
    if (this._unsubscribeShroud) {
      this._unsubscribeShroud()
      this._unsubscribeShroud = null
    }
    super.removed()
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // OpenRA 对照: RadarWidget.Dispose()
  // ---------------------------------------------------------------------------

  /**
   * Dispose all canvas resources.
   *
   * OpenRA 对照: RadarWidget.Dispose()
   */
  override dispose(): void {
    if (this._unsubscribeShroud) {
      this._unsubscribeShroud()
      this._unsubscribeShroud = null
    }

    this._terrainCanvas = null
    this._actorCanvas = null
    this._shroudCanvas = null
    this._canvas = null
    this._terrainImageData = null
    this._actorImageData = null
    this._shroudImageData = null

    this.mapInfo = null
    this.shroud = null
    this.viewport = null
    this.worldRenderer = null
    this.terrainColorProvider = null
    this.actorRadarProvider = null
    this.orderDelegate = null
    this.soundDelegate = null
    this.onAnimating = null
    this.onAfterOpen = null
    this.onAfterClose = null

    super.dispose()
  }
}
