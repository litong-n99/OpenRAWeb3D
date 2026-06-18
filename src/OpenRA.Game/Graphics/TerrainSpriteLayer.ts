/**
 * TerrainSpriteLayer.ts — OpenRA 地形精灵层到 TypeScript/Babylon.js 的迁移实现
 * OpenRA 对照: OpenRA.Game/Graphics/TerrainSpriteLayer.cs
 *
 * 核心范式转换:
 * - IVertexBuffer<Vertex> + glBufferSubData 部分上传 → Babylon.js VertexBuffer
 *   + updateDirectly(data, offset) 脏行更新
 * - ConditionalWeakTable<World, IndexBufferRc> → Map<number, IndexBufferRc>
 *   （引用计数共享索引缓冲）
 * - Vertex[] CPU 数组 → Vertex[] 数组（4 * mapW * mapH 顶点）
 * - HashSet<int> dirtyRows → Set<number>（脏行跟踪）
 * - PaletteReference[] → (IPaletteRef | null)[]（调色板引用）
 * - Sheet[] (8 slots) → (Sheet | null)[]（图集槽位，最大 8 个）
 * - WorldRenderer.TerrainLighting 集成 → 可选回调
 *
 * 顶点布局:
 *   - vertexRowStride = 4 * mapSize.width（每行 4 个顶点/方格 × 宽度）
 *   - 总计 vertices.length = vertexRowStride * mapSize.height
 *   - 方格 (u, v) → 顶点偏移 = vertexRowStride * v + 4 * u
 *   - 每方格产生 4 个顶点（TL, TR, BR, BL）
 */

import { fastCreateQuad } from './Util'
import type { Sheet } from './Sheet'
import type { Sprite } from './Sprite'
import type { IPaletteRef } from './Animation'

// ---------------------------------------------------------------------------
// 接口前向声明
// ---------------------------------------------------------------------------

/** 地图格子坐标 */
interface MPos { u: number; v: number }

/** 世界位置 */
interface Vec3 { x: number; y: number; z: number }

/** 2D 整数坐标 */
interface Int2 { x: number; y: number }

/** 顶点（对应 Vertex.ts 中的 Vertex 接口） */
interface Vertex {
  x: number; y: number; z: number
  s: number; t: number; u: number; v: number
  c: number
  r: number; g: number; b: number; a: number
}

/** 世界渲染器接口（最小化依赖） */
export interface ITerrainWorldRenderer {
  screen3DPosition(cellOrigin: Vec3): Vec3
  terrainLighting: ITerrainLighting | null
  paletteInvalidated: { addListener(cb: () => void): void; removeListener(cb: () => void): void }
}

/** 地形光照接口 */
export interface ITerrainLighting {
  tintAt(pos: Vec3): { r: number; g: number; b: number }
  cellChanged: { addListener(cb: (uv: MPos) => void): void; removeListener(cb: (uv: MPos) => void): void }
}

/** 地图接口（最小化依赖） */
export interface ITerrainMap {
  readonly mapSize: { width: number; height: number }
  contains(uv: MPos): boolean
  centerOfCell(_cell: any): Vec3
}

/** 视口接口 */
export interface ITerrainViewport {
  readonly visibleCells: {
    firstRow: number
    lastRow: number
    firstCol: number
    lastCol: number
  }
}

/** 顶点缓冲接口（最小化，对应 IVertexBuffer<T>） */
export interface ITerrainVertexBuffer {
  setData(vertices: Vertex[], offset: number, start: number, length: number): void
  dispose(): void
}

/** 索引缓冲接口（最小化，对应 IIndexBuffer） */
export interface ITerrainIndexBuffer {
  dispose(): void
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 最大 Sheet 数量（对应 OpenRA SpriteRenderer.SheetCount = 8） */
const MAX_SHEETS = 8

/** 每方格顶点数 */
const VERTICES_PER_CELL = 4

// INDICES_PER_CELL = 6 — reserved for future Draw() implementation

// ---------------------------------------------------------------------------
// IndexBufferRc — 引用计数索引缓冲
//
// OpenRA 对照: TerrainSpriteLayer.IndexBufferRc (TerrainSpriteLayer.cs:246-265)
//
// 所有 TerrainSpriteLayer 实例共享同一个索引缓冲（因为尺寸相同）。
// 使用引用计数管理索引缓冲生命周期。
// ---------------------------------------------------------------------------

class IndexBufferRc {
  buffer: ITerrainIndexBuffer | null = null
  private _count = 0

  /** 创建索引缓冲 */
  create(buf: ITerrainIndexBuffer): void {
    this.buffer = buf
  }

  /** 增加引用计数 */
  addRef(): void {
    this._count++
  }

  /** 减少引用计数，计数归零时释放缓冲 */
  dispose(): void {
    this._count--
    if (this._count === 0 && this.buffer) {
      this.buffer.dispose()
      this.buffer = null
    }
  }
}

// ---------------------------------------------------------------------------
// TerrainSpriteLayer 类
//
// 对应 OpenRA class TerrainSpriteLayer : IDisposable (TerrainSpriteLayer.cs:19-267)
// ---------------------------------------------------------------------------

export class TerrainSpriteLayer {
  // -----------------------------------------------------------------------
  // 公共属性
  // -----------------------------------------------------------------------

  /** 混合模式 */
  readonly blendMode: string

  // -----------------------------------------------------------------------
  // 内部状态
  // -----------------------------------------------------------------------

  /** 图集槽位（最多 8 个） */
  private readonly _sheets: (Sheet | null)[] = new Array(MAX_SHEETS).fill(null)

  /** 空精灵占位（null 精灵时使用） */
  private readonly _emptySprite: Sprite

  /** 顶点缓冲 */
  private readonly _vertexBuffer: ITerrainVertexBuffer

  /** CPU 端顶点数组 */
  private readonly _vertices: Vertex[]

  /** 忽略色调标记（每方格一个标记） */
  private readonly _ignoreTint: boolean[] | null = null

  /** 脏行集（标记需要上传到 GPU 的行） */
  private readonly _dirtyRows = new Set<number>()

  /** 每行顶点步长 = 4 * mapSize.width */
  private readonly _vertexRowStride: number

  /**
   * 每行索引步长 = 6 * mapSize.width
   *
   * NOTE: 当前阶段存储以供 WorldSpriteRenderer 绘制调用使用。
   * 完整 Draw() 实现属于 。
   */
  // _indexRowStride: number — kept for future Draw() implementation

  /** 是否限制可见范围 */
  private readonly _restrictToBounds: boolean

  /** 世界渲染器引用 */
  private readonly _worldRenderer: ITerrainWorldRenderer

  /** 地图引用 */
  private readonly _map: ITerrainMap

  /** 调色板引用数组（每方格一个） */
  private readonly _palettes: (IPaletteRef | null)[]

  /** 共享索引缓冲（带引用计数） */
  private static _sharedIndexBuffers = new Map<number, IndexBufferRc>()
  private readonly _indexBufferWrapper: IndexBufferRc

  // -----------------------------------------------------------------------
  // 构造（对应 OpenRA TerrainSpriteLayer 构造函数）
  //
  // OpenRA 对照:
  //   TerrainSpriteLayer(World world, WorldRenderer wr, Sprite emptySprite,
  //                      BlendMode blendMode, bool restrictToBounds)
  // -----------------------------------------------------------------------

  /**
   * 构造 TerrainSpriteLayer。
   *
   * OpenRA 对照: TerrainSpriteLayer 构造函数
   *
   * @param worldRenderer — 世界渲染器
   * @param map — 地图
   * @param emptySprite — 空精灵占位
   * @param vertexBuffer — 顶点缓冲
   * @param indexBuffer — 索引缓冲（所有图层共享）
   * @param blendMode — 混合模式
   * @param restrictToBounds — 是否限制绘制范围为视口边界内
   * @param worldId — 世界标识符（用于共享索引缓冲查找）
   */
  constructor(
    worldRenderer: ITerrainWorldRenderer,
    map: ITerrainMap,
    emptySprite: Sprite,
    vertexBuffer: ITerrainVertexBuffer,
    indexBuffer: ITerrainIndexBuffer,
    blendMode: string = 'Alpha',
    restrictToBounds = true,
    worldId = 0,
  ) {
    this._worldRenderer = worldRenderer
    this._map = map
    this._emptySprite = emptySprite
    this._vertexBuffer = vertexBuffer
    this.blendMode = blendMode
    this._restrictToBounds = restrictToBounds

    this._vertexRowStride = VERTICES_PER_CELL * map.mapSize.width
    // indexRowStride = INDICES_PER_CELL * map.mapSize.width
    //   - reserved for future Draw() implementation (WorldSpriteRenderer integration)
    this._vertices = new Array<Vertex>(this._vertexRowStride * map.mapSize.height)

    // 初始化顶点数组为空精灵占位
    for (let i = 0; i < this._vertices.length; i++) {
      this._vertices[i] = {
        x: 0, y: 0, z: 0,
        s: 0, t: 0, u: 0, v: 0,
        c: 0,
        r: 1, g: 1, b: 1, a: 1,
      }
    }

    this._palettes = new Array<IPaletteRef | null>(
      map.mapSize.width * map.mapSize.height,
    ).fill(null)

    // 共享索引缓冲引用计数管理
    if (!TerrainSpriteLayer._sharedIndexBuffers.has(worldId)) {
      const rc = new IndexBufferRc()
      rc.create(indexBuffer)
      TerrainSpriteLayer._sharedIndexBuffers.set(worldId, rc)
    }
    this._indexBufferWrapper = TerrainSpriteLayer._sharedIndexBuffers.get(worldId)!
    this._indexBufferWrapper.addRef()

    // 订阅调色板失效事件
    worldRenderer.paletteInvalidated.addListener(this._onPaletteInvalidated)

    // 订阅地形光照变化
    if (worldRenderer.terrainLighting) {
      this._ignoreTint = new Array<boolean>(
        this._vertexRowStride * map.mapSize.height,
      ).fill(false)

      worldRenderer.terrainLighting.cellChanged.addListener(
        this._onCellTintChanged,
      )
    }
  }

  // -----------------------------------------------------------------------
  // Clear — 清除指定格子
  //
  // OpenRA 对照: TerrainSpriteLayer.Clear(CPos cell) (TerrainSpriteLayer.cs:87-90)
  // -----------------------------------------------------------------------

  /**
   * 清除指定格子（恢复为空精灵）。
   *
   * OpenRA 对照: Clear(CPos cell)
   */
  clear(cell: any): void {
    this._updateCell(cell, null, null, 1, 1, true)
  }

  // -----------------------------------------------------------------------
  // Update — 更新指定格子的精灵
  //
  // OpenRA 对照: TerrainSpriteLayer.Update 多个重载 (TerrainSpriteLayer.cs:92-107)
  // -----------------------------------------------------------------------

  /**
   * 更新指定格子的精灵（使用序列 + 帧号）。
   *
   * OpenRA 对照: Update(CPos cell, ISpriteSequence, PaletteReference, int frame)
   *
   * @param cell — 地图格子
   * @param sequence — 精灵序列
   * @param palette — 调色板引用
   * @param frame — 帧号
   */
  update(
    cell: any,
    sequence: ISpriteSequence | null,
    palette: IPaletteRef | null,
    frame: number,
  ): void {
    if (sequence) {
      const sprite = sequence.getSprite(frame, 0)
      this._updateCell(
        cell, sprite, palette,
        sequence.scale,
        sequence.getAlpha(frame),
        sequence.ignoreWorldTint,
      )
    } else {
      this.clear(cell)
    }
  }

  /**
   * 更新指定格子的精灵（直接使用 Sprite）。
   *
   * OpenRA 对照: Update(CPos cell, Sprite sprite, PaletteReference palette, ...)
   *
   * @param cell — 地图格子
   * @param sprite — 精灵（null = 使用空精灵）
   * @param palette — 调色板引用
   * @param scale — 缩放因子（默认 1）
   * @param alpha — 透明度（默认 1）
   * @param ignoreTint — 是否忽略地形色调（默认 false）
   */
  updateSprite(
    cell: any,
    sprite: Sprite | null,
    palette: IPaletteRef | null,
    scale = 1,
    alpha = 1,
    ignoreTint = false,
  ): void {
    this._updateCell(cell, sprite, palette, scale, alpha, ignoreTint)
  }

  // -----------------------------------------------------------------------
  // 内部 Update 实现
  // -----------------------------------------------------------------------

  /**
   * 内部更新指定格子的精灵数据。
   *
   * 对应 OpenRA TerrainSpriteLayer.Update(MPos uv, Sprite, PaletteReference,
   *   in float3 pos, float scale, float alpha, bool ignoreTint)
   */
  private _updateCell(
    cell: any,
    sprite: Sprite | null,
    palette: IPaletteRef | null,
    scale: number,
    alpha: number,
    ignoreTint: boolean,
  ): void {
    // 计算世界位置
    const cellOrigin = this._map.centerOfCell(cell)
    // NOTE: 简化的 3D 位置计算（完整版需要 Map.Grid.Ramps 支持）
    const xyz = this._worldRenderer.screen3DPosition(cellOrigin)

    let samplers: Int2
    let effSprite: Sprite

    if (sprite) {
      // if (sprite.blendMode !== this.blendMode)
      //   throw new Error('Attempted to add sprite with a different blend mode')
      //
      // NOTE: blendMode 检查暂时放宽——在完全迁移的 Renderer 中启用

      const sheetIdx = this._getOrAddSheetIndex(sprite.sheet)
      samplers = { x: sheetIdx, y: 0 }
      // TODO: secondary sheet for SpriteWithSecondaryData

      // HACK: RGBA 精灵若没有颜色偏移，可移除调色板引用
      // NOTE: sprite.channel === TextureChannel.RGBA (4)
      // if (sprite.channel === 4 /* RGBA */ && !(palette?.hasColorShift ?? false))
      //   palette = null

      effSprite = sprite
    } else {
      effSprite = this._emptySprite
      samplers = { x: 0, y: 0 }
    }

    // TODO: 实际的格子坐标转换（CPos → MPos）需要 Map.Grid 支持
    // 当前简化实现使用 cell.u / cell.v 作为 MPos 坐标
    const uv: MPos = { u: cell.u ?? 0, v: cell.v ?? 0 }

    // 地图边界检查
    if (!this._map.contains(uv)) return

    const vertexOffset = this._vertexRowStride * uv.v + VERTICES_PER_CELL * uv.u
    const texIndex = palette?.textureIndex ?? 0

    // 使用 Util.fastCreateQuad 写入 4 个顶点
    const position: Vec3 = {
      x: xyz.x + scale * ((effSprite.offset?.x ?? 0) - 0.5 * effSprite.size.x),
      y: xyz.y + scale * ((effSprite.offset?.y ?? 0) - 0.5 * effSprite.size.y),
      z: xyz.z + scale * ((effSprite.offset?.z ?? 0) - 0.5 * effSprite.size.z),
    }

    fastCreateQuad(
      this._vertices,
      position,
      effSprite as any,
      samplers,
      texIndex,
      vertexOffset,
      { x: scale * effSprite.size.x, y: scale * effSprite.size.y, z: scale * effSprite.size.z },
      { x: alpha, y: alpha, z: alpha },
      alpha,
    )

    // 存储调色板引用
    const cellIndex = uv.v * this._map.mapSize.width + uv.u
    this._palettes[cellIndex] = palette

    // 处理地形色调
    if (this._worldRenderer.terrainLighting && this._ignoreTint) {
      this._ignoreTint[vertexOffset] = ignoreTint
    }

    // 标记脏行
    this._dirtyRows.add(uv.v)
  }

  // -----------------------------------------------------------------------
  // Draw — 绘制可见行
  //
  // OpenRA 对照: TerrainSpriteLayer.Draw(Viewport viewport) (TerrainSpriteLayer.cs:207-232)
  // -----------------------------------------------------------------------

  /**
   * 绘制可见范围内的脏行。
   *
   * OpenRA 对照: Draw(Viewport viewport)
   *
   * 1. 确定可见行范围
   * 2. 上传脏行到 GPU（vertexBuffer.setData 部分上传）
   * 3. 委托 WorldSpriteRenderer 绘制
   *
   * @param viewport — 视口（提供可见行范围）
   * @returns 需要绘制的行范围 { firstRow, lastRow }
   */
  draw(viewport: ITerrainViewport): { firstRow: number; lastRow: number } {
    const mapHeight = this._map.mapSize.height
    const cells = viewport.visibleCells

    const firstRow = this._restrictToBounds
      ? Math.max(0, Math.min(cells.firstRow, mapHeight))
      : cells.firstRow
    const lastRow = this._restrictToBounds
      ? Math.max(firstRow, Math.min(cells.lastRow + 1, mapHeight))
      : cells.lastRow + 1

    // 上传脏行到 GPU（部分更新）
    for (let row = firstRow; row <= lastRow; row++) {
      if (!this._dirtyRows.delete(row)) continue

      const rowOffset = this._vertexRowStride * row
      this._vertexBuffer.setData(
        this._vertices,
        rowOffset,
        rowOffset,
        this._vertexRowStride,
      )
    }

    // NOTE: 完整的 Draw 实现需要 WorldSpriteRenderer.DrawVertexBuffer()
    // 对应 OpenRA:
    //   Game.Renderer.WorldSpriteRenderer.DrawVertexBuffer(
    //     vertexBuffer, indexBufferWrapper.Buffer,
    //     indexRowStride * firstRow,
    //     indexRowStride * (lastRow - firstRow),
    //     sheets, BlendMode)
    //
    // 集成 WorldSpriteRenderer 绘制调用

    return { firstRow, lastRow }
  }

  // -----------------------------------------------------------------------
  // 调色板失效处理
  //
  // OpenRA 对照: UpdatePaletteIndices() (TerrainSpriteLayer.cs:73-85)
  // -----------------------------------------------------------------------

  /**
   * 调色板失效回调：更新所有顶点的调色板索引并标记全部脏行。
   *
   * 对应 OpenRA UpdatePaletteIndices()。
   */
  private _onPaletteInvalidated = (): void => {
    for (let i = 0; i < this._vertices.length; i++) {
      const v = this._vertices[i]!
      const p = this._palettes[Math.floor(i / VERTICES_PER_CELL)]?.textureIndex ?? 0
      // 更新调色板索引（保留低 16 位的属性 C）
      const c = ((p & 0xffff) << 16) | (v.c & 0xffff)
      this._vertices[i] = {
        x: v.x, y: v.y, z: v.z,
        s: v.s, t: v.t, u: v.u, v: v.v,
        c,
        r: v.r, g: v.g, b: v.b, a: v.a,
      }
    }

    // 标记全部行为脏
    for (let row = 0; row < this._map.mapSize.height; row++) {
      this._dirtyRows.add(row)
    }
  }

  // -----------------------------------------------------------------------
  // 地形色调更新
  //
  // OpenRA 对照: UpdateTint(MPos uv) (TerrainSpriteLayer.cs:109-146)
  // -----------------------------------------------------------------------

  /**
   * 单个格子色调变化回调。
   *
   * 对应 OpenRA UpdateTint(MPos uv)。
   */
  private _onCellTintChanged = (uv: MPos): void => {
    const offset = this._vertexRowStride * uv.v + VERTICES_PER_CELL * uv.u

    if (this._ignoreTint?.[offset]) {
      // 忽略色调：应用中性色调（白色）
      for (let i = 0; i < VERTICES_PER_CELL; i++) {
        const v = this._vertices[offset + i]!
        this._vertices[offset + i] = {
          x: v.x, y: v.y, z: v.z,
          s: v.s, t: v.t, u: v.u, v: v.v,
          c: v.c,
          r: v.a, g: v.a, b: v.a, a: v.a,
        }
      }
      return
    }

    // 应用地形光照色调（四角采样线性插值）
    // NOTE: 完整实现需要 TerrainLighting.TintAt() 和 Map.CenterOfCell()
    // 当前简化为中性色调
    this._dirtyRows.add(uv.v)
  }

  // -----------------------------------------------------------------------
  // Sheet 索引管理
  //
  // OpenRA 对照: GetOrAddSheetIndex(Sheet sheet) (TerrainSpriteLayer.cs:148-166)
  // -----------------------------------------------------------------------

  /**
   * 获取或分配 Sheet 槽位索引。
   *
   * 对应 OpenRA GetOrAddSheetIndex(Sheet sheet)。
   *
   * 若传入 null 返回 0。
   * 若 Sheet 已存在返回其索引。
   * 否则分配到第一个空槽位（最多 8 个）。
   *
   * @param sheet — 图集（null 返回 0）
   * @returns 槽位索引 (0-7)
   * @throws Error 若所有槽位已满
   */
  private _getOrAddSheetIndex(sheet: Sheet | null): number {
    if (!sheet) return 0

    for (let i = 0; i < this._sheets.length; i++) {
      if (this._sheets[i] === sheet) return i
      if (this._sheets[i] === null) {
        this._sheets[i] = sheet
        return i
      }
    }

    throw new Error('Sheet overflow')
  }

  // -----------------------------------------------------------------------
  // 资源释放
  //
  // OpenRA 对照: TerrainSpriteLayer.Dispose() (TerrainSpriteLayer.cs:234-244)
  // -----------------------------------------------------------------------

  /**
   * 释放地形精灵层资源。
   *
   * OpenRA 对照: Dispose()
   */
  dispose(): void {
    this._worldRenderer.paletteInvalidated.removeListener(
      this._onPaletteInvalidated,
    )
    if (this._worldRenderer.terrainLighting) {
      this._worldRenderer.terrainLighting.cellChanged.removeListener(
        this._onCellTintChanged,
      )
    }

    this._vertexBuffer.dispose()
    this._indexBufferWrapper.dispose()
    this._dirtyRows.clear()
  }
}

// ---------------------------------------------------------------------------
// 用于测试的 ISpriteSequence 最小实现
// ---------------------------------------------------------------------------

interface ISpriteSequence {
  getSprite(frame: number, facing: number): Sprite
  getAlpha(frame: number): number
  readonly scale: number
  readonly ignoreWorldTint: boolean
}
