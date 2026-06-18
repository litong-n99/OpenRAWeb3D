/**
 * MapPreviewWidget.ts — 地图预览缩略图 widget（Canvas 2D 渲染）
 * OpenRA 对照: OpenRA.Mods.Common/Widgets/MapPreviewWidget.cs (233 lines)
 *
 * 核心范式转换:
 * - OpenRA Sheet + SpriteRenderer (OpenGL 精灵渲染) → Canvas 2D drawImage
 * - OpenRA WidgetUtils.DrawSprite (精灵绘制) → Canvas drawImage
 * - OpenRA WidgetUtils.FillEllipseWithColor (GPU 椭圆填充) → Canvas arc fill
 * - OpenRA SpriteFont.DrawTextWithContrast (位图文字+阴影) → Canvas fillText + shadow
 * - OpenRA ChromeProvider.GetImage (精灵集查询) → 存根（Canvas 简单几何代替）
 * - OpenRA ChromeMetrics.Get<T> → 默认值常量
 * - OpenRA MouseInput (SDL2 事件) → DOM pointer 事件
 * - OpenRA MapPreview.GetMinimap() → Canvas ImageData（从 terran 数据构建）
 * - OpenRA ConvertToPreview (世界坐标→预览坐标) → 2D Canvas 坐标变换
 */

import { Widget, type WidgetBounds } from '../../OpenRA.Game/Widgets/Widget.js'
import type { WidgetEvent } from '../../OpenRA.Game/Widgets/Widget.js'

// ---------------------------------------------------------------------------
// SpawnOccupant — 出生点占用者信息
// OpenRA 对照: SpawnOccupant class
// ---------------------------------------------------------------------------

/** 出生点占用者信息。
 *
 * OpenRA 对照: class SpawnOccupant
 */
export interface SpawnOccupant {
  /** 玩家颜色。 */
  color: string
  /** 玩家名称。 */
  playerName: string
  /** 队伍编号。 */
  team: number
  /** 阵营 ID。 */
  faction: string | null
  /** 出生点编号 (1-indexed)。 */
  spawnPoint: number
}

// ---------------------------------------------------------------------------
// IMapPreview — MapPreviewWidget 所需的地图预览接口
// OpenRA 对照: MapPreview
// ---------------------------------------------------------------------------

/** 地图预览数据接口。
 *
 * OpenRA 对照: MapPreview
 */
export interface IMapPreviewData {
  /** 地图 UID。 */
  uid: string

  /** 地图边界（以单元格为单位）。 */
  bounds: { left: number; top: number; right: number; bottom: number }

  /** 出生点坐标数组。 */
  spawnPoints: { u: number; v: number }[]

  /** 网格类型。 */
  gridType: 'Rectangular' | 'RectangularIsometric'

  /** 获取小地图像素数据（Uint8Array RGBA）。 */
  getMinimap?(): Uint8Array | null
}

// ---------------------------------------------------------------------------
// CPos 最小接口
// ---------------------------------------------------------------------------

/** 单元格位置。 */
export interface CPos {
  u: number
  v: number
}

// ---------------------------------------------------------------------------
// 默认 ChromeMetrics 值
// ---------------------------------------------------------------------------

const DEFAULT_SPAWN_FONT = '12px monospace'
const DEFAULT_SPAWN_COLOR = '#FFFFFF'
const DEFAULT_SPAWN_CONTRAST_COLOR = '#000000'
const DEFAULT_SPAWN_LABEL_OFFSET = 2

// ---------------------------------------------------------------------------
// MapPreviewWidget
// OpenRA 对照: MapPreviewWidget : Widget
// ---------------------------------------------------------------------------

/**
 * 地图预览缩略图 widget — 使用 Canvas 2D 渲染地形、出生点和玩家标记。
 *
 * 特性:
 * - 从最小地图数据渲染缩放的地形网格
 * - 出生点标记（字母标签 + 颜色圆点）
 * - 出生点悬停检测（tooltip 索引）
 * - 鼠标点击事件支持
 *
 * OpenRA 对照: class MapPreviewWidget : Widget
 */
export class MapPreviewWidget extends Widget {
  /** 是否忽略鼠标输入。OpenRA 对照: IgnoreMouseInput */
  ignoreMouseInput: boolean = false

  /** 是否显示出生点。OpenRA 对照: ShowSpawnPoints */
  showSpawnPoints: boolean = true

  /** 是否显示未占用的出生点。OpenRA 对照: ShowUnoccupiedSpawnpoints */
  showUnoccupiedSpawnpoints: boolean = true

  /** 工具提示容器 ID。 */
  tooltipContainer: string = ''

  /** 工具提示模板 ID。OpenRA 对照: TooltipTemplate */
  tooltipTemplate: string = 'SPAWN_TOOLTIP'

  /** 预览数据委托。OpenRA 对照: Preview */
  preview: () => IMapPreviewData | null = () => null

  /** 出生点占用者委托。OpenRA 对照: SpawnOccupants */
  spawnOccupants: () => Map<number, SpawnOccupant> = () => new Map()

  /** 禁用出生点集合委托。OpenRA 对照: DisabledSpawnPoints */
  disabledSpawnPoints: () => Set<number> = () => new Set()

  /** 鼠标按下回调。OpenRA 对照: OnMouseDown */
  onMouseDown: (pos: { x: number; y: number }) => void = () => {}

  /** 工具提示出生点索引。OpenRA 对照: TooltipSpawnIndex */
  tooltipSpawnIndex: number = -1

  /** 地图预览是否已加载。OpenRA 对照: Loaded */
  get loaded(): boolean {
    return this._minimap !== null
  }

  // ---- 内部状态 ----

  /** 地图矩形（Canvas 坐标）。 */
  private _mapRect: WidgetBounds = { x: 0, y: 0, width: 0, height: 0 }

  /** 预览缩放比例。 */
  private _previewScale: number = 0

  /** 当前小地图像素数据。 */
  private _minimap: Uint8Array | null = null

  /** Canvas 上下文缓存。 */
  private _canvas: HTMLCanvasElement | null = null
  private _ctx: CanvasRenderingContext2D | null = null

  /** 指示是否需要重绘。 */
  private _dirty: boolean = true

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  constructor() {
    super()
    this.ignoreMouseOver = false
  }

  // ---------------------------------------------------------------------------
  // Mouse input
  // OpenRA 对照: HandleMouseInput / MouseEntered / MouseExited
  // ---------------------------------------------------------------------------

  /** 处理鼠标输入。
   *
   * OpenRA 对照: HandleMouseInput(MouseInput)
   */
  override handleEvent(event: WidgetEvent): boolean {
    if (this.ignoreMouseInput) return false

    if (event.type !== 'pointerdown') return false

    const x = (event.clientX ?? 0) as number
    const y = (event.clientY ?? 0) as number
    this.onMouseDown({ x, y })
    return true
  }

  /** 鼠标进入 — 触发工具提示。
   *
   * OpenRA 对照: MouseEntered()
   */
  override mouseEntered(): void {
    // NOTE: TooltipContainerWidget 迁移推迟。
    // 工具提示集成留待 。
  }

  /** 鼠标离开 — 清除工具提示。
   *
   * OpenRA 对照: MouseExited()
   */
  override mouseExited(): void {
    // NOTE: TooltipContainerWidget 迁移推迟。
  }

  // ---------------------------------------------------------------------------
  // Coordinate transform
  // OpenRA 对照: ConvertToPreview(CPos, MapGridType)
  // ---------------------------------------------------------------------------

  /** 将世界单元格坐标转换为 Canvas 像素坐标。
   *
   * OpenRA 对照: ConvertToPreview(CPos, MapGridType)
   *
   * @param cell — 单元格 { u, v } 坐标
   * @param isIsometric — 是否为等距网格
   * @returns Canvas 像素坐标 { x, y }
   */
  convertToPreview(cell: CPos, isIsometric: boolean): { x: number; y: number } {
    const preview = this.preview()
    if (!preview) return { x: 0, y: 0 }

    const cellWidth = isIsometric ? 2 : 1
    const dx = this._previewScale * cellWidth * (cell.u - preview.bounds.left)
    const dy = this._previewScale * (cell.v - preview.bounds.top)

    // 奇数行右移 1px（等距网格）
    let adjustedX = dx
    if ((cell.v & 1) === 1) {
      adjustedX += 1
    }

    return {
      x: this._mapRect.x + adjustedX,
      y: this._mapRect.y + dy,
    }
  }

  // ---------------------------------------------------------------------------
  // DOM rendering
  // OpenRA 对照: Draw()
  // ---------------------------------------------------------------------------

  /** 渲染地图预览到 Canvas 元素。
   *
   * OpenRA 对照: Draw()
   */
  override render(): HTMLElement {
    this._canvas = this.getOrCreateElement('canvas', 'map-preview-widget') as HTMLCanvasElement
    this._canvas.style.position = 'absolute'
    this._canvas.width = this.bounds.width
    this._canvas.height = this.bounds.height

    this._ctx = this._canvas.getContext('2d')

    if (this._dirty) {
      this._drawPreview()
      this._dirty = false
    }

    return this._canvas
  }

  /** 绘制预览内容。 */
  private _drawPreview(): void {
    const ctx = this._ctx
    if (!ctx || !this._canvas) return

    // 清除画布
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)

    const preview = this.preview()
    if (!preview) return

    // 获取小地图数据
    const minimap = preview.getMinimap?.() ?? this._minimap
    this._minimap = minimap as Uint8Array | null
    if (!this._minimap || this._minimap.length === 0) return

    // 计算缩放和地图矩形
    const minimapWidth = Math.floor(Math.sqrt(this._minimap.length / 4)) // RGBA = 4 bytes/pixel
    const minimapHeight = minimapWidth // 假设正方形

    const renderWidth = this.bounds.width
    const renderHeight = this.bounds.height
    this._previewScale = Math.min(renderWidth / minimapWidth, renderHeight / minimapHeight)

    const w = this._previewScale * minimapWidth
    const h = this._previewScale * minimapHeight
    const x = (renderWidth - w) / 2
    const y = (renderHeight - h) / 2
    this._mapRect = { x: Math.floor(x), y: Math.floor(y), width: Math.floor(w), height: Math.floor(h) }

    // 绘制地形（像素网格）
    this._drawTerrain(ctx, minimapWidth, minimapHeight)

    // 绘制出生点
    if (this.showSpawnPoints) {
      this._drawSpawnPoints(ctx, preview)
    }
  }

  /** 绘制地形像素网格。 */
  private _drawTerrain(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this._minimap) return

    ctx.save()
    ctx.translate(this._mapRect.x, this._mapRect.y)
    ctx.scale(this._previewScale, this._previewScale)

    // 使用 imageSmoothingEnabled = false 保持像素清晰
    ctx.imageSmoothingEnabled = false

    // 逐像素绘制
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const idx = (py * width + px) * 4
        const r = this._minimap[idx]
        const g = this._minimap[idx + 1]
        const b = this._minimap[idx + 2]
        const a = this._minimap[idx + 3]

        if (a > 0) {
          ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`
          ctx.fillRect(px, py, 1, 1)
        }
      }
    }

    ctx.restore()
  }

  /** 绘制出生点标记。
   *
   * OpenRA 对照: Draw() 中的 spawn points 循环
   */
  private _drawSpawnPoints(ctx: CanvasRenderingContext2D, preview: IMapPreviewData): void {
    const spawnPoints = preview.spawnPoints
    const occupants = this.spawnOccupants()
    const disabled = this.disabledSpawnPoints()
    const isIsometric = preview.gridType === 'RectangularIsometric'

    this.tooltipSpawnIndex = -1

    for (let i = 0; i < spawnPoints.length; i++) {
      const spawnCell = spawnPoints[i]
      const spawnIndex = i + 1 // 1-indexed

      const occupied = occupants.has(spawnIndex)
      const occupant = occupants.get(spawnIndex)
      const isDisabled = disabled.has(spawnIndex)

      const pos = this.convertToPreview(
        { u: spawnCell.u, v: spawnCell.v },
        isIsometric,
      )

      const markerRadius = 8

      if (isDisabled) {
        // 禁用的出生点 — 灰色
        ctx.fillStyle = 'rgba(128,128,128,0.6)'
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, markerRadius, 0, Math.PI * 2)
        ctx.fill()
      } else if (occupied && occupant) {
        // 已占用的出生点 — 填充玩家颜色
        ctx.fillStyle = occupant.color
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, markerRadius - 1, 0, Math.PI * 2)
        ctx.fill()

        // 外圈
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 1
        ctx.stroke()
      } else {
        // 未占用的出生点 — 白色外圈
        ctx.strokeStyle = '#FFFFFF'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, markerRadius, 0, Math.PI * 2)
        ctx.stroke()
      }

      // 绘制字母标签
      const letter = String.fromCharCode('A'.charCodeAt(0) + i)
      ctx.fillStyle = DEFAULT_SPAWN_COLOR
      ctx.font = DEFAULT_SPAWN_FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // 对比色阴影
      ctx.fillStyle = DEFAULT_SPAWN_CONTRAST_COLOR
      ctx.fillText(letter, pos.x + 1, pos.y + DEFAULT_SPAWN_LABEL_OFFSET + 1)

      ctx.fillStyle = DEFAULT_SPAWN_COLOR
      ctx.fillText(letter, pos.x, pos.y + DEFAULT_SPAWN_LABEL_OFFSET)
    }
  }

  /** 标记需要重绘。 */
  invalidatePreview(): void {
    this._dirty = true
  }

  // ---------------------------------------------------------------------------
  // Widget lifecycle
  // ---------------------------------------------------------------------------

  /** 克隆此 widget。
   *
   * OpenRA 对照: Clone()
   */
  override clone(): MapPreviewWidget {
    const clone = new MapPreviewWidget()
    clone.id = this.id
    clone.bounds = { ...this.bounds }
    clone.preview = this.preview
    clone.spawnOccupants = this.spawnOccupants
    clone.disabledSpawnPoints = this.disabledSpawnPoints
    clone.onMouseDown = this.onMouseDown
    clone.showSpawnPoints = this.showSpawnPoints
    clone.showUnoccupiedSpawnpoints = this.showUnoccupiedSpawnpoints
    clone.ignoreMouseInput = this.ignoreMouseInput
    clone.tooltipContainer = this.tooltipContainer
    clone.tooltipTemplate = this.tooltipTemplate
    return clone
  }
}
