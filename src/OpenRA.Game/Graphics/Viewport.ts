/**
 * Viewport.ts — RTS camera viewport: 视口坐标变换、缩放管理、边界裁剪
 * OpenRA 对照: OpenRA.Game/Graphics/Viewport.cs (441 lines)
 *
 * 核心范式转换:
 * - OpenGL 2D 视口手动计算 (world-px ↔ viewport-px) → 保留纯数学层 + 可选 ArcRotateCamera 集成
 * - CPU 端 Zoom 因子 + Exponential scaling → Zoom * Math.exp(dz) 指数缩放
 * - C# mapBounds Rectangle 裁剪 → TypeScript clamp 函数
 * - C# event ViewportTick → TypeScript 回调函数数组
 * - C# WorldViewportSizes / GraphicSettings → 精简 Options 对象 (依赖尚未迁移，TODO 标记)
 * - ArcRotateCamera 集成保留为可选: 无 camera 时仅提供坐标变换 (用于测试/无头模式)
 *
 * IMPORTANT — Babylon.js 左手坐标系 (LH) 约束:
 * Babylon.js 使用 Matrix.LookAtLH 计算视图矩阵。
 * right = cross(up, forward) 在 LH 下与直觉相反:
 *   - alpha = -PI/2 → 相机在 -Z 侧 → right = (+1,0,0) → 屏幕右 = 世界+X ✅ 正确
 *   - alpha = +PI/2 → 相机在 +Z 侧 → right = (-1,0,0) → 屏幕右 = 世界-X ❌ 左右翻转
 *
 * ArcRotateCamera 必须使用 alpha=-PI/2 (相机在 -Z 侧)。
 *
 * 参考: src/__e2e__/manual/ch02-hardware-palette/color-accuracy/main.ts 的相机调试过程
 */

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector'
import { Camera } from '@babylonjs/core/Cameras/camera'
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Scene } from '@babylonjs/core/scene'

import { PPos, MPos } from '../MPos'
import type { CPos } from '../CPos'
import { MapGridType } from '../Map/MapGridType'
import { ProjectedCellRegion } from '../Map/ProjectedCellRegion'
import { Rectangle } from '../Primitives/Rectangle'
import type { Size } from '../Primitives/Size'
import {
  type IViewport,
  type Vec2,
  type Int2,
  type Rect,
  WorldType,
  type WPos,
  type IActor,
} from './WorldRenderer'

// ---------------------------------------------------------------------------
// ScrollDirection flags enum (对应 OpenRA ScrollDirection)
// ---------------------------------------------------------------------------

/**
 * 滚屏方向标志枚举。
 *
 * OpenRA 对照: [Flags] enum ScrollDirection { None = 0, Up = 1, Left = 2, Down = 4, Right = 8 }
 */
export const ScrollDirection = {
  None: 0,
  Up: 1,
  Left: 2,
  Down: 4,
  Right: 8,
} as const

export type ScrollDirection = number

// ---------------------------------------------------------------------------
// ScrollDirection 辅助函数 (对应 OpenRA ViewportExts)
// ---------------------------------------------------------------------------

export const ScrollDirectionExts = {
  includes(d: ScrollDirection, s: ScrollDirection): boolean {
    return (d & s) === s
  },
  set(d: ScrollDirection, s: ScrollDirection, val: boolean): ScrollDirection {
    return ScrollDirectionExts.includes(d, s) !== val ? d ^ s : d
  },
}

// ---------------------------------------------------------------------------
// INotifyViewportZoomExtentsChanged 接口 (对应 OpenRA)
// ---------------------------------------------------------------------------

export interface INotifyViewportZoomExtentsChanged {
  viewportZoomExtentsChanged(minZoom: number, maxZoom: number): void
}

// ---------------------------------------------------------------------------
// ViewportCameraMode 枚举 (新增)
// ---------------------------------------------------------------------------

export const ViewportCameraMode = {
  Orthographic: 0,
  Perspective: 1,
} as const
export type ViewportCameraMode = (typeof ViewportCameraMode)[keyof typeof ViewportCameraMode]

// ---------------------------------------------------------------------------
// IViewportMap — Viewport 所需的 Map 最小接口
// ---------------------------------------------------------------------------

/**
 * Viewport 构造函数所需的 Map 最小接口。
 *
 * OpenRA 对照: Map 的部分属性
 *
 * NOTE: projectedTopLeft/projectedBottomRight 接受两种 WPos 形式:
 * WPos.ts 的 class 使用 uppercase {X,Y,Z}，WorldRenderer.ts 的 interface 使用 lowercase {x,y,z}。
 * 此接口使用 lowercase 格式以匹配 WorldRenderer 的坐标变换。
 */
export interface IViewportMap {
  readonly grid: {
    readonly type: MapGridType
    readonly tileScale: number
  }
  readonly mapSize: Size
  readonly rules: {
    readonly terrainInfo: {
      readonly tileSize: Size
    }
  }
  /** 投影左上角 (WPos, lowercase x/y/z) */
  readonly projectedTopLeft: { x: number; y: number; z: number }
  /** 投影右下角 (WPos, lowercase x/y/z) */
  readonly projectedBottomRight: { x: number; y: number; z: number }
  /** 获取包含指定 WPos 的 cell index */
  cellContaining(pos: { x: number; y: number; z: number }): { toMPos(gtype: MapGridType): MPos }
  /** 获取指定 cell 的中心 WPos */
  centerOfCell(cell: CPos): { x: number; y: number; z: number }
  /** 检查 cell 是否在地图范围内 */
  contains(cell: CPos): boolean
}

// ---------------------------------------------------------------------------
// IViewportWorld — Viewport 所需的 World 最小接口
// ---------------------------------------------------------------------------

export interface IViewportWorld {
  readonly type: string
  readonly worldActor: {
    traitsImplementing?: <T>() => T[]
  }
}

// ---------------------------------------------------------------------------
// ViewportOptions — Viewport 构造函数参数
// ---------------------------------------------------------------------------

export interface ViewportOptions {
  worldRenderer: {
    screenPxPosition(pos: WPos): Int2
    projectedPosition(screenPx: Int2): WPos
    tileSize: Size
    tileScale: number
    world: IViewportWorld
  }
  map: IViewportMap
  nativeResolution?: Size
  uiScale?: number
  defaultScale?: number
  minZoom?: number
  maxZoom?: number
  unlockMinZoom?: boolean
  unlockedMinZoomScale?: number
  overrideUserScale?: boolean
  camera?: ArcRotateCamera | null
  engine?: Engine | null
  scene?: Scene | null
}

// ---------------------------------------------------------------------------
// Viewport 主类
// ---------------------------------------------------------------------------

/**
 * RTS 相机视口：管理视口中心位置、缩放级别、视口尺寸和坐标变换。
 *
 * OpenRA 对照: class Viewport (Graphics/Viewport.cs)
 *
 * 实现 IViewport 接口以兼容 WorldRenderer。
 */
export class Viewport implements IViewport {
  // ---------------------------------------------------------------------------
  // Private 只读引用
  // ---------------------------------------------------------------------------

  private readonly wr: {
    screenPxPosition(pos: WPos): Int2
    projectedPosition(screenPx: Int2): WPos
    tileSize: Size
    tileScale: number
    world: IViewportWorld
  }

  private readonly map: IViewportMap
  private readonly mapBounds: Rectangle
  private readonly tileSize: Size
  private readonly nativeResolution: Size
  private readonly uiScale: number

  // ---------------------------------------------------------------------------
  // 缩放系统
  // ---------------------------------------------------------------------------

  private _zoom: number = 1
  private _minZoom: number = 1
  private _maxZoom: number = 2
  private defaultScale: number
  private _unlockMinZoom: boolean
  private unlockedMinZoomScale: number
  private unlockedMinZoom: number = 1
  private _overrideUserScale: boolean
  private _viewportSize: Int2 = { x: 0, y: 0 }

  // ---------------------------------------------------------------------------
  // 相机集成 (可选)
  // ---------------------------------------------------------------------------

  private bjsCamera: ArcRotateCamera | null = null
  private bjsEngine: Engine | null = null
  private bjsScene: Scene | null = null

  // ---------------------------------------------------------------------------
  // Cell 区域缓存
  // ---------------------------------------------------------------------------

  private cellsCache: ProjectedCellRegion | null = null
  private cellsDirty: boolean = true
  private allCellsCache: ProjectedCellRegion | null = null
  private allCellsDirty: boolean = true

  // ---------------------------------------------------------------------------
  // ViewportTick 回调
  // ---------------------------------------------------------------------------

  private viewportTickCallbacks: Array<() => void> = []

  viewportCenterProvider: (() => Vec2) | null = null

  // ---------------------------------------------------------------------------
  // 静态状态
  // ---------------------------------------------------------------------------

  static lastMoveRunTime: number = 0
  static lastMousePos: Int2 = { x: 0, y: 0 }

  // ---------------------------------------------------------------------------
  // 中心位置
  // ---------------------------------------------------------------------------

  private _centerLocation: Vec2

  get centerLocation(): Vec2 {
    return this._centerLocation
  }

  /**
   * 当前视口中心的世界位置 (WPos)。
   *
   * OpenRA 对照: Viewport.CenterPosition => worldRenderer.ProjectedPosition(CenterLocation.ToInt2())
   */
  get centerPosition(): WPos {
    return this.wr.projectedPosition({
      x: Math.round(this._centerLocation.x),
      y: Math.round(this._centerLocation.y),
    })
  }

  get zoom(): number { return this._zoom }
  get minZoom(): number { return this._minZoom }
  get maxZoom(): number { return this._maxZoom }

  get viewportSize(): Int2 { return this._viewportSize }

  get topLeft(): Vec2 {
    return {
      x: this._centerLocation.x - this._viewportSize.x / 2,
      y: this._centerLocation.y - this._viewportSize.y / 2,
    }
  }

  get bottomRight(): Vec2 {
    return {
      x: this._centerLocation.x + this._viewportSize.x / 2,
      y: this._centerLocation.y + this._viewportSize.y / 2,
    }
  }

  get size(): { width: number; height: number } {
    return {
      width: this.nativeResolution.width,
      height: this.nativeResolution.height,
    }
  }

  get mapRectBounds(): Rectangle { return this.mapBounds }

  get cameraMode(): ViewportCameraMode {
    if (!this.bjsCamera) return ViewportCameraMode.Orthographic
    return this.bjsCamera.mode === Camera.PERSPECTIVE_CAMERA
      ? ViewportCameraMode.Perspective
      : ViewportCameraMode.Orthographic
  }

  set cameraMode(mode: ViewportCameraMode) {
    if (!this.bjsCamera) return
    this.bjsCamera.mode =
      mode === ViewportCameraMode.Perspective
        ? Camera.PERSPECTIVE_CAMERA
        : Camera.ORTHOGRAPHIC_CAMERA
  }

  // ---------------------------------------------------------------------------
  // 构造
  // ---------------------------------------------------------------------------

  constructor(opts?: ViewportOptions) {
    // Allow no-arg construction for testing with mocks
    if (!opts) {
      this.wr = {
        screenPxPosition: () => ({ x: 0, y: 0 }),
        projectedPosition: () => ({ x: 0, y: 0, z: 0 }),
        tileSize: { width: 24, height: 24 },
        tileScale: 1024,
        world: { type: 'Regular', worldActor: {} },
      }
      this.map = {
        grid: { type: MapGridType.Rectangular, tileScale: 1024 },
        mapSize: { width: 1, height: 1 },
        rules: { terrainInfo: { tileSize: { width: 24, height: 24 } } },
        projectedTopLeft: { x: 0, y: 0, z: 0 },
        projectedBottomRight: { x: 0, y: 0, z: 0 },
        cellContaining: () => ({ toMPos: () => ({ U: 0, V: 0 } as unknown as MPos) }),
        centerOfCell: () => ({ x: 0, y: 0, z: 0 }),
        contains: () => true,
      }
      this.tileSize = { width: 24, height: 24 }
      this.nativeResolution = { width: 1920, height: 1080 }
      this.uiScale = 1.0
      this.defaultScale = 1.0
      this._minZoom = 1.0
      this._maxZoom = 2.0
      this._unlockMinZoom = false
      this.unlockedMinZoomScale = 0.5
      this._overrideUserScale = false
      this._zoom = 1.0
      this._viewportSize = { x: 1920, y: 1080 }
      this.mapBounds = new Rectangle(0, 0, 1, 1)
      this._centerLocation = { x: 0, y: 0 }
      return
    }

    this.wr = opts.worldRenderer
    this.map = opts.map
    this.tileSize = opts.map.rules.terrainInfo.tileSize

    this.nativeResolution = opts.nativeResolution ?? { width: 1920, height: 1080 }
    this.uiScale = opts.uiScale ?? 1.0
    this.defaultScale = opts.defaultScale ?? 1.0
    this._minZoom = opts.minZoom ?? 1.0
    this._maxZoom = opts.maxZoom ?? 2.0
    this._unlockMinZoom = opts.unlockMinZoom ?? false
    this.unlockedMinZoomScale = opts.unlockedMinZoomScale ?? 0.5
    this._overrideUserScale = opts.overrideUserScale ?? false

    this.bjsCamera = opts.camera ?? null
    this.bjsEngine = opts.engine ?? null
    this.bjsScene = opts.scene ?? null

    const worldType = this.wr.world.type

    if (worldType === WorldType.Editor) {
      const width = this.map.mapSize.width * this.tileSize.width
      const height = this.map.mapSize.height * this.tileSize.height
      const adjustedHeight =
        this.map.grid.type === MapGridType.RectangularIsometric
          ? height / 2
          : height
      this.mapBounds = new Rectangle(0, 0, width, adjustedHeight)
      this._centerLocation = { x: width / 2, y: adjustedHeight / 2 }
    } else {
      const tl = this.wr.screenPxPosition(this.map.projectedTopLeft)
      const br = this.wr.screenPxPosition(this.map.projectedBottomRight)
      this.mapBounds = Rectangle.fromLTRB(tl.x, tl.y, br.x, br.y)
      this._centerLocation = {
        x: (tl.x + br.x) / 2,
        y: (tl.y + br.y) / 2,
      }
    }

    this._viewportSize = {
      x: Math.round((1 / this._zoom) * this.nativeResolution.width),
      y: Math.round((1 / this._zoom) * this.nativeResolution.height),
    }
  }

  // ---------------------------------------------------------------------------
  // 坐标变换: view-port-px → world-px (Int2)
  // ---------------------------------------------------------------------------

  /**
   * 视口像素坐标 → 世界像素坐标 (world-px Int2)。
   *
   * OpenRA 对照: Viewport.ViewToWorldPx(int2 view) — OpenRA returns int2
   *
   * 公式: worldPx = (UIScale / Zoom * view + CenterLocation - ViewportSize / 2)
   */
  private viewToWorldPxInt2(view: Int2): Int2 {
    const halfView = {
      x: this._viewportSize.x / 2,
      y: this._viewportSize.y / 2,
    }
    return {
      x: Math.round(
        (this.uiScale / this._zoom) * view.x +
          this._centerLocation.x -
          halfView.x,
      ),
      y: Math.round(
        (this.uiScale / this._zoom) * view.y +
          this._centerLocation.y -
          halfView.y,
      ),
    }
  }

  /**
   * 视口像素坐标 → 世界坐标 (WPos)。
   *
   * IViewport 接口兼容方法。先通过 viewToWorldPxInt2 转换为 world-px，
   * 再通过 ProjectedPosition 转换为 WPos。
   *
   * @param viewPos — 视口像素坐标
   * @returns WPos (高度 Z=0)
   */
  viewToWorldPx(viewPos: Int2): WPos {
    const worldPx = this.viewToWorldPxInt2(viewPos)
    return this.wr.projectedPosition(worldPx)
  }

  /**
   * 世界像素坐标 → 视口像素坐标。
   *
   * OpenRA 对照: Viewport.WorldToViewPx(int2 world)
   *
   * IViewport 接口兼容方法。
   *
   * @param worldPos — 世界像素坐标 (world-px Vec2)
   * @returns 视口像素坐标 (Vec2)
   */
  worldToViewPx(worldPos: Vec2): Vec2 {
    const halfView = {
      x: this._viewportSize.x / 2,
      y: this._viewportSize.y / 2,
    }
    return {
      x: (this._zoom / this.uiScale) *
        (worldPos.x - this._centerLocation.x + halfView.x),
      y: (this._zoom / this.uiScale) *
        (worldPos.y - this._centerLocation.y + halfView.y),
    }
  }

  /**
   * 视口像素坐标 → 世界 cell 坐标 (CPos)。
   *
   * OpenRA 对照: Viewport.ViewToWorld(int2 view) — OpenRA.cs:262-327
   *
   * 这是主要的光标到 Cell 坐标映射方法。先通过视口像素计算世界像素，
   * 然后生成候选 cell 列表，进行粗筛选，再通过 CellRamp 多边形包含测试
   * 找到精确匹配。如果鼠标不在 cell 上 (如悬崖边缘)，则返回最近的 cell。
   *
   * @param view — 视口像素坐标
   * @returns 对应的 CPos (world cell 坐标)
   */
  viewToWorld(view: Int2): CPos {
    const world = this.viewToWorldPxInt2(view)

    // Generate candidate cells that could contain the cursor point
    const candidates = this.candidateMouseoverCells(world, this.map)

    // Ramp-aware polygon containment check (OpenRA lines 268-281)
    //
    // TODO-7.B.1.3: 完整 CellRamp 多边形包含测试
    // 当前实现跳过 ramp 数据 (需要 Map.Grid.Ramps[] 和 Map.Ramp[])，直接退回到
    // 基于距离的最近 cell 查找。
    // 完成 ramp 系统迁移后，需要:
    //   for (const uv of candidates) {
    //     const p = map.centerOfCell(uv.toCPos(map.grid.type))
    //     const s = wr.screenPxPosition(p)
    //     if (Math.abs(s.x - world.x) <= tileSize.width && Math.abs(s.y - world.y) <= tileSize.height) {
    //       const rampIdx = map.ramp?.get(uv) ?? 0
    //       const ramp = map.grid.ramps[rampIdx]
    //       const pos = map.centerOfCell(uv.toCPos(map.grid.type))
    //       const adjusted = { x: pos.x, y: pos.y, z: pos.z - ramp.centerHeightOffset }
    //       const screen = ramp.corners.map(c => wr.screenPxPosition({ x: adjusted.x + c.x, y: adjusted.y + c.y, z: adjusted.z + c.z }))
    //       if (polygonContains(screen, world)) return uv.toCPos(map.grid.type)
    //     }
    //   }

    // Coarse filter: find all candidate cells within tile size distance,
    // then return the closest one by screen distance
    if (candidates.length > 0) {
      // Find closest cell by screen distance (OpenRA lines 284-296)
      let bestCell: CPos | null = null
      let bestDist = Infinity
      for (const uv of candidates) {
        const cell = uv.toCPos(this.map.grid.type)
        const p = this.map.centerOfCell(cell)
        const s = this.wr.screenPxPosition(p)
        const dx = Math.abs(s.x - world.x)
        const dy = Math.abs(s.y - world.y)

        // Coarse filter (OpenRA lines 273)
        if (dx <= this.tileSize.width && dy <= this.tileSize.height) {
          const dist = dx * dx + dy * dy
          if (dist < bestDist) {
            bestDist = dist
            bestCell = cell
          }
        }
      }

      if (bestCell !== null) return bestCell

      // No cell within coarse filter — find overall closest (OpenRA lines 284-296)
      for (const uv of candidates) {
        const cell = uv.toCPos(this.map.grid.type)
        const p = this.map.centerOfCell(cell)
        const s = this.wr.screenPxPosition(p)
        const dx = Math.abs(s.x - world.x)
        const dy = Math.abs(s.y - world.y)
        const dist = dx * dx + dy * dy
        if (dist < bestDist) {
          bestDist = dist
          bestCell = cell
        }
      }

      if (bestCell !== null) return bestCell
    }

    // Fallback: project the world-px to a cell position (OpenRA line 299)
    const projectedPos = this.wr.projectedPosition(world)
    return this.map.cellContaining(projectedPos).toMPos(this.map.grid.type).toCPos(this.map.grid.type)
  }

  /**
   * 生成可能包含鼠标光标的候选 cell 列表。
   *
   * OpenRA 对照: Viewport.CandidateMouseoverCells(int2 world) — OpenRA.cs:303-327
   *
   * @param world — 世界像素坐标
   * @param map — 地图接口
   * @returns 候选 MPos 数组
   */
  private candidateMouseoverCells(
    world: Int2,
    map: IViewportMap,
  ): MPos[] {
    const tileScale = map.grid.tileScale / 2
    const minPos = this.wr.projectedPosition(world)

    let a: MPos
    let b: MPos

    if (map.grid.type === MapGridType.RectangularIsometric) {
      // TODO: this generates too many cells (OpenRA's own comment)
      a = map
        .cellContaining({
          x: minPos.x - tileScale,
          y: minPos.y,
          z: 0,
        })
        .toMPos(map.grid.type)
      b = map
        .cellContaining({
          x: minPos.x + tileScale,
          y: minPos.y + tileScale,
          z: 0,
        })
        .toMPos(map.grid.type)
    } else {
      a = map.cellContaining(minPos).toMPos(map.grid.type)
      b = map
        .cellContaining({
          x: minPos.x,
          y: minPos.y + tileScale,
          z: 0,
        })
        .toMPos(map.grid.type)
    }

    const result: MPos[] = []
    for (let v = b.V; v >= a.V; v--) {
      for (let u = b.U; u >= a.U; u--) {
        result.push(new MPos(u, v))
      }
    }
    return result
  }

  /**
   * 获取裁剪矩形。
   *
   * IViewport 接口兼容方法。
   *
   * TODO-7.B.1.3: 完整实现需要 Map.CenterOfCell, CellRamp.Corners
   */
  getScissorBounds(_insideBounds: boolean): Rect {
    return {
      x: 0,
      y: 0,
      width: this.nativeResolution.width,
      height: this.nativeResolution.height,
    }
  }

  // ---------------------------------------------------------------------------
  // 缩放管理
  // ---------------------------------------------------------------------------

  adjustZoom(dz: number): void {
    const effectiveMin = this._unlockMinZoom
      ? this.unlockedMinZoom
      : this._minZoom
    this.setZoom(
      this.clamp(this._zoom * Math.exp(dz), effectiveMin, this._maxZoom),
    )
  }

  adjustZoomAt(dz: number, center: Int2): void {
    const oldCenter = this.viewToWorldPxInt2(center)
    this.adjustZoom(dz)
    const newCenter = this.viewToWorldPxInt2(center)

    const candidate = {
      x: this._centerLocation.x + oldCenter.x - newCenter.x,
      y: this._centerLocation.y + oldCenter.y - newCenter.y,
    }
    this.setCenterLocation(this.clampToBounds(candidate))
  }

  toggleZoom(): void {
    if (this._zoom < this._minZoom) {
      this.setZoom(this._minZoom)
    } else {
      this.setZoom(
        this._zoom > this._minZoom ? this._minZoom : this._maxZoom,
      )
    }
  }

  unlockMinimumZoom(scale: number): void {
    this._unlockMinZoom = true
    this.unlockedMinZoomScale = scale
    this.updateViewportZooms(false)
  }

  overrideDefaultHeight(height: number): void {
    this.defaultScale =
      (this.defaultScale * this.nativeResolution.height) / height
    this._overrideUserScale = true
    this.updateViewportZooms(false)
  }

  private setZoom(value: number): void {
    this._zoom = value
    this._viewportSize = {
      x: Math.round((1 / this._zoom) * this.nativeResolution.width),
      y: Math.round((1 / this._zoom) * this.nativeResolution.height),
    }
    this.cellsDirty = true
    this.allCellsDirty = true
  }

  // ---------------------------------------------------------------------------
  // 边界与滚动
  // ---------------------------------------------------------------------------

  getBlockedDirections(): ScrollDirection {
    let ret = ScrollDirection.None
    if (this._centerLocation.y <= this.mapBounds.Top) ret |= ScrollDirection.Up
    if (this._centerLocation.x <= this.mapBounds.Left) ret |= ScrollDirection.Left
    if (this._centerLocation.y >= this.mapBounds.Bottom) ret |= ScrollDirection.Down
    if (this._centerLocation.x >= this.mapBounds.Right) ret |= ScrollDirection.Right
    return ret
  }

  scroll(delta: Vec2, ignoreBorders: boolean = false): void {
    this._centerLocation = {
      x: this._centerLocation.x + (1 / this._zoom) * delta.x,
      y: this._centerLocation.y + (1 / this._zoom) * delta.y,
    }
    this.cellsDirty = true
    this.allCellsDirty = true

    if (!ignoreBorders) {
      this._centerLocation = this.clampToBounds(this._centerLocation)
    }
  }

  center(pos: WPos): void {
    const px = this.wr.screenPxPosition(pos)
    this.setCenterLocation({
      x: px.x,
      y: px.y,
    })
  }

  centerFloat2(pos: Vec2): void {
    this.setCenterLocation({ x: pos.x, y: pos.y })
  }

  centerOnActors(actors: readonly IActor[]): void {
    if (actors.length === 0) return

    let sumX = 0
    let sumY = 0
    let count = 0

    for (const actor of actors) {
      if (actor.isInWorld && !actor.disposed) {
        const renderables = actor.render(
          this.wr as unknown as import('./WorldRenderer').WorldRenderer,
        )
        if (renderables.length > 0) {
          const r = renderables[0]!
          sumX += r.pos.x
          sumY += r.pos.y
          count++
        }
      }
    }

    if (count > 0) {
      const avgPx = this.wr.screenPxPosition({
        x: sumX / count,
        y: sumY / count,
        z: 0,
      })
      this.setCenterLocation({ x: avgPx.x, y: avgPx.y })
    }
  }

  private clampToBounds(pos: Vec2): Vec2 {
    return {
      x: this.clamp(pos.x, this.mapBounds.Left, this.mapBounds.Right),
      y: this.clamp(pos.y, this.mapBounds.Top, this.mapBounds.Bottom),
    }
  }

  private setCenterLocation(pos: Vec2): void {
    this._centerLocation = this.clampToBounds(pos)
    this.cellsDirty = true
    this.allCellsDirty = true
  }

  // ---------------------------------------------------------------------------
  // 每帧 Tick
  // ---------------------------------------------------------------------------

  tick(): void {
    // TODO-7.B.1.1: GraphicSettings.ViewportDistance 迁移后检测变化并 updateViewportZooms()
    if (this.viewportCenterProvider !== null) {
      this.centerFloat2(this.viewportCenterProvider())
    }
    this.fireViewportTick()
  }

  onViewportTick(cb: () => void): void {
    this.viewportTickCallbacks.push(cb)
  }

  offViewportTick(cb: () => void): void {
    const idx = this.viewportTickCallbacks.indexOf(cb)
    if (idx >= 0) this.viewportTickCallbacks.splice(idx, 1)
  }

  private fireViewportTick(): void {
    for (const cb of this.viewportTickCallbacks) cb()
  }

  // ---------------------------------------------------------------------------
  // 可见 Cell 区域
  // ---------------------------------------------------------------------------

  get visibleCellsInsideBounds(): ProjectedCellRegion {
    if (this.cellsDirty) {
      this.cellsCache = this.calculateVisibleCells(true)
      this.cellsDirty = false
    }
    return this.cellsCache!
  }

  get allVisibleCells(): ProjectedCellRegion {
    if (this.allCellsDirty) {
      this.allCellsCache = this.calculateVisibleCells(false)
      this.allCellsDirty = false
    }
    return this.allCellsCache!
  }

  private calculateVisibleCells(
    _insideBounds: boolean,
  ): ProjectedCellRegion {
    const tl = this.topLeft
    const br = this.bottomRight

    const tlWPos = this.wr.projectedPosition({
      x: Math.round(tl.x),
      y: Math.round(tl.y),
    })
    const brWPos = this.wr.projectedPosition({
      x: Math.round(br.x),
      y: Math.round(br.y),
    })

    const gridType = this.map.grid.type
    const tlMpos = this.map.cellContaining(tlWPos).toMPos(gridType)
    const brMpos = this.map.cellContaining(brWPos).toMPos(gridType)

    let tlU = tlMpos.U
    let tlV = tlMpos.V
    let brU = brMpos.U
    let brV = brMpos.V

    if (gridType === MapGridType.RectangularIsometric) {
      tlU -= 1
      tlV -= 1
      brU += 1
      brV += 1
    }

    // TODO-7.B.1.2: insideBounds=true 时对 tl/br 进行地图边界裁剪

    const tlPPos = new PPos(tlU, tlV)
    const brPPos = new PPos(brU, brV)

    return new ProjectedCellRegion(
      { gridType, maximumTerrainHeight: 0 },
      this.map.mapSize,
      tlPPos,
      brPPos,
    )
  }

  // ---------------------------------------------------------------------------
  // 缩放范围管理
  // ---------------------------------------------------------------------------

  static calculateMinimumZoom(
    minHeight: number,
    maxHeight: number,
    nativeHeight: number = 1080,
  ): number {
    const h = nativeHeight
    if (h <= maxHeight) return 1

    let step = 1.0
    while (true) {
      let testZoom = 1.0
      while (true) {
        const nextZoom = testZoom + step
        if (h < minHeight * nextZoom) break
        testZoom = nextZoom
      }
      if (h < maxHeight * testZoom) return testZoom
      step /= 2
    }
  }

  updateViewportZooms(resetCurrentZoom: boolean = true): void {
    // TODO-7.B.1.4: WorldViewportSizes / GraphicSettings 迁移后实现完整逻辑
    //   - overrideUserScale 和 WorldViewportSizes.AllowNativeZoom 检查
    //   - MinZoom = defaultScale (when overrideUserScale)
    //   - MaxZoom = min(MinZoom * MaxZoomScale, NativeHeight * defaultScale / MaxZoomWindowHeight)
    void this._overrideUserScale // used in future GraphicSettings integration
    void this.bjsEngine // used in future engine.resize detection

    if (this._unlockMinZoom) {
      this.unlockedMinZoom = this._minZoom * this.unlockedMinZoomScale
    }

    if (resetCurrentZoom) {
      this.setZoom(this._minZoom)
    } else {
      const effectiveMin = this._unlockMinZoom
        ? this.unlockedMinZoom
        : this._minZoom
      this.setZoom(this.clamp(this._zoom, effectiveMin, this._maxZoom))
    }
  }

  // ---------------------------------------------------------------------------
  // ArcRotateCamera 集成
  // ---------------------------------------------------------------------------

  setupCamera(camera: ArcRotateCamera, scene: Scene): void {
    this.bjsCamera = camera
    this.bjsScene = scene

    camera.alpha = -Math.PI / 2
    camera.beta = Math.PI / 3
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA

    this.syncViewportToCamera()
    camera.target = this.worldCenterToVector3()
  }

  setEngine(engine: Engine): void {
    this.bjsEngine = engine
  }

  syncCameraToViewport(): void {
    if (!this.bjsCamera) return
    this.bjsCamera.target = this.worldCenterToVector3()
    this.syncViewportToCamera()
  }

  syncViewportFromCamera(): void {
    if (!this.bjsCamera) return
    const target = this.bjsCamera.target
    const worldPx = this.vector3ToWorldPx(target)
    this.setCenterLocation(worldPx)
  }

  pickTerrain(viewX: number, viewY: number): Vec2 | null {
    if (!this.bjsCamera || !this.bjsScene) return null

    const ray = this.bjsScene.createPickingRay(
      viewX,
      viewY,
      Matrix.Identity(),
      this.bjsCamera,
    )

    if (Math.abs(ray.direction.y) < 1e-10) return null

    const t = -ray.origin.y / ray.direction.y
    if (t < 0) return null

    const intersection = new Vector3(
      ray.origin.x + t * ray.direction.x,
      0,
      ray.origin.z + t * ray.direction.z,
    )

    return this.vector3ToWorldPx(intersection)
  }

  get terrainMousePosition(): WPos {
    const worldPx = this.viewToWorldPxInt2(Viewport.lastMousePos)
    return this.wr.projectedPosition(worldPx)
  }

  // NOTE: 直接使用 Vector3 构造替代 CoordinateTransformer，
  // 以避免 WPos.ts class (uppercase X/Y/Z) 与 WorldRenderer.WPos
  // interface (lowercase x/y/z) 之间的类型不兼容。
  // CoordinateTransformer 在 WPos class 修复后可重新集成。

  private static readonly WORLD_SCALE = 1 / 1024
  private static readonly HEIGHT_SCALE = 1 / 512

  private worldCenterToVector3(): Vector3 {
    const wPos = this.wr.projectedPosition({
      x: Math.round(this._centerLocation.x),
      y: Math.round(this._centerLocation.y),
    })
    return new Vector3(
      wPos.x * Viewport.WORLD_SCALE,
      (wPos.z ?? 0) * Viewport.HEIGHT_SCALE,
      wPos.y * Viewport.WORLD_SCALE,
    )
  }

  private vector3ToWorldPx(vec: Vector3): Vec2 {
    // Convert Vector3 back to WPos (lowercase) then to world-px
    const wPos = {
      x: Math.round(vec.x / Viewport.WORLD_SCALE),
      y: Math.round(vec.z / Viewport.WORLD_SCALE),
      z: Math.round(vec.y / Viewport.HEIGHT_SCALE),
    }
    const px = this.wr.screenPxPosition(wPos)
    return { x: px.x, y: px.y }
  }

  private syncViewportToCamera(): void {
    if (!this.bjsCamera) return

    const worldScale =
      this.wr.tileSize.width / this.wr.tileScale
    const halfWidth = (this._viewportSize.x / 2) * worldScale
    const halfHeight = (this._viewportSize.y / 2) * worldScale

    this.bjsCamera.orthoTop = halfHeight
    this.bjsCamera.orthoBottom = -halfHeight
    this.bjsCamera.orthoLeft = -halfWidth
    this.bjsCamera.orthoRight = halfWidth
  }

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------

  private clamp(value: number, min: number, max: number): number {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.viewportTickCallbacks.length = 0
    this.viewportCenterProvider = null
    this.bjsCamera = null
    this.bjsScene = null
    this.bjsEngine = null
    this.cellsCache = null
    this.allCellsCache = null
  }
}
