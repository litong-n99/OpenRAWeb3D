/**
 * TerrainMeshBuilder.ts — 从 CellRamp 数据生成 3D 地形网格
 * OpenRA 对照: 无直接对应 — 3D 迁移架构创新 (ADR-4.3)
 *
 * 核心范式转换:
 * - OpenRA 2D 离散 tile 精灵渲染 → 单一连续 3D 网格，相邻 cell 共享顶点
 * - CPU barycentric height 插值 → 网格生成时烘焙到顶点位置
 * - 2D riser 精灵覆盖 → 3D 垂直 cliff 面四边形
 * - 每 cell 独立 sprite UV → 世界空间纹理坐标
 *
 * NOTE: Phase I (CoordinateTransformer) 未实现，坐标转换逻辑内联于此。
 */

import { Vector3, VertexData, Mesh, Scene } from '@babylonjs/core'
import { Map } from './Map'
import { MapGridType } from './MapGridType'
import { CPos } from '../CPos'
import { MPos } from '../MPos'
import { WPos } from '../WPos'

// ---------------------------------------------------------------------------
// TerrainMeshData — 生成的网格数据接口
// ---------------------------------------------------------------------------

/** 地形网格生成结果。
 *
 * 包含 Babylon.js Mesh 实例和原始顶点数据数组。
 */
export interface TerrainMeshData {
  /** Babylon.js Mesh 实例（已附加到场景或可直接附加）。 */
  readonly mesh: Mesh
  /** 顶点位置 (Float32Array, 每顶点3个值: x,y,z)。 */
  readonly positions: Float32Array
  /** 三角形索引 (Uint32Array)。 */
  readonly indices: Uint32Array
  /** 顶点法线 (Float32Array, 每顶点3个值)。 */
  readonly normals: Float32Array
  /** 纹理 UV (Float32Array, 每顶点2个值: u,v)。 */
  readonly uvs: Float32Array
  /** 顶点数量。 */
  readonly vertexCount: number
  /** 三角形数量。 */
  readonly triangleCount: number
}

/** 地形网格原始数据（不含 Babylon.js Mesh，用于测试和延迟创建）。 */
export interface TerrainMeshRawData {
  /** 顶点位置 (Float32Array, 每顶点3个值: x,y,z)。 */
  readonly positions: Float32Array
  /** 三角形索引 (Uint32Array)。 */
  readonly indices: Uint32Array
  /** 顶点法线 (Float32Array, 每顶点3个值)。 */
  readonly normals: Float32Array
  /** 纹理 UV (Float32Array, 每顶点2个值: u,v)。 */
  readonly uvs: Float32Array
  /** 顶点数量。 */
  readonly vertexCount: number
  /** 三角形数量。 */
  readonly triangleCount: number
}

// ---------------------------------------------------------------------------
// Coordinate Transformation (内联 — Phase I 未实现)
// ---------------------------------------------------------------------------

/** 世界坐标缩放因子：将 OpenRA 世界单位映射到 Babylon.js 场景单位。
 *
 * OpenRA 一个 cell = 1024 (rectangular) / 1448 (isometric) 世界单位。
 * 缩放后一个 cell ≈ 1.0 或可调大小。
 */
const WORLD_SCALE = 1 / 1024

/** 高度缩放因子。 */
const HEIGHT_SCALE = 1 / 1024

/** 将 OpenRA WPos 转换为 Babylon.js Vector3。
 *
 * 坐标系转换:
 *   OpenRA: (X=右, Y=下, Z=上)
 *   Babylon.js: (X=右, Y=上, Z=前)
 * 转换: Babylon(X, Y, Z) = (OpenRA.X * scale, OpenRA.Z * heightScale, OpenRA.Y * scale)
 *
 * 已在 terrain-types 验收测试 (commit 65d7308) 中验证。
 *
 * @param pos — OpenRA 世界位置
 * @returns Babylon.js Vector3
 */
function wPosToVector3(pos: WPos): Vector3 {
  return new Vector3(
    pos.X * WORLD_SCALE,
    pos.Z * HEIGHT_SCALE,
    pos.Y * WORLD_SCALE,
  )
}

/** 计算 cell 角点的世界位置。
 *
 * OpenRA 对照: Map.CenterOfCell(CPos) + CellRamp.Corners[cornerIndex]
 *
 * @param cell — cell 位置
 * @param cornerIndex — 角点索引 (0=TL, 1=TR, 2=BR, 3=BL)
 * @param map — Map 实例
 * @returns 世界位置 (WPos)
 */
function cellCornerToWPos(cell: CPos, cornerIndex: number, map: Map): WPos {
  const center = map.centerOfCell(cell)
  const rampVal = map.ramp.get(cell)
  const ramp = map.grid.ramps[rampVal]
  const cornerOffset = ramp.corners[cornerIndex]

  // 基础高度 = map.height * cellHeightStep
  // CellRamp.corners 已包含 Z offset（相对于 cell 基座），不要再重复加 base height
  // 但 centerOfCell 对矩形网格返回 Z=0（不包含高度），对 isometric 已包含高度
  // 因此矩形网格需要手动添加基座高度
  if (map.grid.type === MapGridType.Rectangular) {
    const baseHeight = map.height.get(cell) * 512
    const centerWithHeight = new WPos(center.X, center.Y, baseHeight)
    return WPos.add(centerWithHeight, cornerOffset)
  }

  return WPos.add(center, cornerOffset)
}

/** 计算 cell 角点的 Babylon.js 位置。
 *
 * @param cell — cell 位置
 * @param cornerIndex — 角点索引 (0=TL, 1=TR, 2=BR, 3=BL)
 * @param map — Map 实例
 * @returns Babylon.js Vector3
 */
function cellCornerToVector3(cell: CPos, cornerIndex: number, map: Map): Vector3 {
  return wPosToVector3(cellCornerToWPos(cell, cornerIndex, map))
}

// ---------------------------------------------------------------------------
// Vertex Deduplication Key
// ---------------------------------------------------------------------------

// NOTE: getRectVertexIndex / setRectVertexIndex inlined into getOrCreateRectVertex
// for performance. Dense Int32Array indexing replaces string deduplication map.

// ---------------------------------------------------------------------------
// Internal Mesh Builder State
// ---------------------------------------------------------------------------

/** 网格构建过程中的可变状态。 */
interface MeshBuildState {
  /** 顶点位置数组 (动态增长)。 */
  positions: number[]
  /** 矩形网格顶点索引查找表 (密集 Int32Array，未设置 = -1)。
   * 仅用于矩形网格，大小 = (width+1) * (height+1)。
   * 替代 Map<string, number> 字符串 deduplication，避免大量字符串分配。
   */
  rectVertexIndices: Int32Array | null
  /** 等轴网格顶点索引映射 (Map<string, number>，key = "x,y,z")。
   * 仅用于等轴网格，因为顶点位置不规则。
   */
  isoVertexMap: globalThis.Map<string, number> | null
  /** 每个顶点相邻的三角形索引列表 (用于法线平均)。 */
  vertexTriangles: number[][]
  /** 三角形索引数组 (flat，每3个值 = 1个三角形)。
   * 替代 number[][] 避免每个三角形创建新数组。
   */
  triangleIndices: number[]
  /** 世界空间 UV 范围。 */
  worldWidth: number
  worldHeight: number
  /** 地图原点在 Babylon 空间中的偏移。 */
  originX: number
  originZ: number
  /** 矩形网格宽度（cell 数），用于顶点索引计算。 */
  gridWidth: number
  /** 矩形网格高度（cell 数），用于顶点索引计算。 */
  gridHeight: number
}

// ---------------------------------------------------------------------------
// TerrainMeshBuilder
// ---------------------------------------------------------------------------

/**
 * 从 Map 数据生成 3D 地形网格。
 *
 * OpenRA 对照: 无直接对应 — 3D 迁移架构创新
 *
 * 生成一个单一连续网格，相邻 cell 共享边顶点，消除裂缝。
 * 支持矩形和等轴网格，CellRamp 斜坡，以及 cliff 面。
 */
export class TerrainMeshBuilder {
  // ---- Static Build Methods -----------------------------------------------

  /**
   * 从 Map 实例构建完整地形网格原始数据（不含 Mesh）。
   *
   * 这是核心生成逻辑，不依赖 Babylon.js Scene，可在测试和 worker 中运行。
   *
   * @param map — Map 实例
   * @returns TerrainMeshRawData 原始网格数据
   */
  static buildRaw(map: Map): TerrainMeshRawData {
    const state = createBuildState(map)

    // 第一步：生成所有顶点和三角形索引
    generateTerrainSurface(map, state)

    // 第二步：计算法线
    const normals = computeNormals(state)

    // 第三步：生成 UV
    const uvs = computeUVs(state)

    // 第四步：打包数组
    const positions = new Float32Array(state.positions)
    const indices = new Uint32Array(state.triangleIndices)

    return {
      positions,
      indices,
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      vertexCount: state.positions.length / 3,
      triangleCount: state.triangleIndices.length / 3,
    }
  }

  /**
   * 从 Map 实例构建完整地形网格（含 Babylon.js Mesh）。
   *
   * @param map — Map 实例
   * @param scene — Babylon.js Scene（用于创建 Mesh）
   * @returns TerrainMeshData 包含 mesh 和原始数据
   */
  static build(map: Map, scene: Scene): TerrainMeshData {
    const raw = this.buildRaw(map)

    const vertexData = new VertexData()
    vertexData.positions = raw.positions
    vertexData.indices = raw.indices
    vertexData.normals = raw.normals
    vertexData.uvs = raw.uvs

    const meshName = `terrain_${map.mapSize.width}x${map.mapSize.height}`
    const mesh = new Mesh(meshName, scene)
    vertexData.applyToMesh(mesh)

    return {
      mesh,
      positions: raw.positions,
      indices: raw.indices,
      normals: raw.normals,
      uvs: raw.uvs,
      vertexCount: raw.vertexCount,
      triangleCount: raw.triangleCount,
    }
  }

  /**
   * 异步构建地形网格（对大地图，让出事件循环）。
   *
   * TODO-4.F.8: 当前实现为同步包装，真正异步分块生成待实现。
   *
   * @param map — Map 实例
   * @param scene — Babylon.js Scene
   * @param onProgress — 进度回调 (0-100)
   * @returns Promise<TerrainMeshData>
   */
  static async buildAsync(
    map: Map,
    scene: Scene,
    onProgress?: (pct: number) => void,
  ): Promise<TerrainMeshData> {
    // 目前同步实现，后续可按行分块异步生成
    if (onProgress) onProgress(0)
    const result = this.build(map, scene)
    if (onProgress) onProgress(100)
    return result
  }

  // ---- Instance Dispose ---------------------------------------------------

  private _mesh: Mesh | null = null

  /** 设置要管理的 Mesh（内部使用）。 */
  _setMesh(mesh: Mesh): void {
    this._mesh = mesh
  }

  /** 释放 GPU 资源。 */
  dispose(): void {
    if (this._mesh) {
      this._mesh.dispose()
      this._mesh = null
    }
  }
}

// ---------------------------------------------------------------------------
// Build State Initialization
// ---------------------------------------------------------------------------

/** 创建网格构建初始状态。 */
function createBuildState(map: Map): MeshBuildState {
  const gridType = map.grid.type
  const w = map.mapSize.width
  const h = map.mapSize.height

  // 计算世界空间范围（用于 UV）
  let worldWidth: number
  let worldHeight: number
  let originX: number
  let originZ: number

  if (gridType === MapGridType.RectangularIsometric) {
    // Isometric: cell size = 1448 x 1448
    worldWidth = w * 1448 * WORLD_SCALE
    worldHeight = h * 1448 * WORLD_SCALE
    originX = 0
    originZ = 0
  } else {
    // Rectangular: cell size = 1024 x 1024
    worldWidth = w * 1024 * WORLD_SCALE
    worldHeight = h * 1024 * WORLD_SCALE
    originX = 0
    originZ = 0
  }

  return {
    positions: [],
    rectVertexIndices: gridType === MapGridType.Rectangular
      ? new Int32Array((w + 1) * (h + 1)).fill(-1)
      : null,
    isoVertexMap: gridType === MapGridType.RectangularIsometric
      ? new globalThis.Map()
      : null,
    vertexTriangles: [],
    triangleIndices: [],
    worldWidth,
    worldHeight,
    originX,
    originZ,
    gridWidth: w,
    gridHeight: h,
  }
}

// ---------------------------------------------------------------------------
// Vertex Management
// ---------------------------------------------------------------------------

/**
 * 获取或创建矩形网格顶点，返回顶点索引。
 *
 * 使用密集 Int32Array 索引替代字符串 deduplication map。
 * 这是防止 mesh cracks 的关键。
 *
 * @param x — grid x 坐标 (0..width)
 * @param y — grid y 坐标 (0..height)
 * @param pos — Babylon.js 位置
 * @param state — 构建状态
 * @returns 顶点索引
 */
function getOrCreateRectVertex(x: number, y: number, pos: Vector3, state: MeshBuildState): number {
  // 使用 gridWidth + 1 作为行宽（顶点网格比 cell 网格大 1）
  const w = state.gridWidth + 1
  const idx = y * w + x
  const existing = state.rectVertexIndices![idx]
  if (existing >= 0) {
    return existing
  }

  const index = state.positions.length / 3
  state.positions.push(pos.x, pos.y, pos.z)
  state.rectVertexIndices![idx] = index
  state.vertexTriangles.push([])
  return index
}

/**
 * 获取或创建等轴网格顶点，返回顶点索引。
 *
 * 等轴网格顶点位置不规则，使用字符串 deduplication map。
 *
 * @param pos — Babylon.js 位置
 * @param state — 构建状态
 * @returns 顶点索引
 */
function getOrCreateIsoVertex(pos: Vector3, state: MeshBuildState): number {
  const key = `${pos.x},${pos.y},${pos.z}`
  const existing = state.isoVertexMap!.get(key)
  if (existing !== undefined) {
    return existing
  }

  const index = state.positions.length / 3
  state.positions.push(pos.x, pos.y, pos.z)
  state.isoVertexMap!.set(key, index)
  state.vertexTriangles.push([])
  return index
}

// ---------------------------------------------------------------------------
// Terrain Surface Generation
// ---------------------------------------------------------------------------

/**
 * 生成地形表面顶点和三角形。
 *
 * 对每个 cell，根据其 CellRamp 形状生成 1-2 个三角形。
 * 相邻 cell 通过共享边顶点实现无缝连接。
 */
function generateTerrainSurface(map: Map, state: MeshBuildState): void {
  const gridType = map.grid.type

  if (gridType === MapGridType.RectangularIsometric) {
    generateIsometricSurface(map, state)
  } else {
    generateRectangularSurface(map, state)
  }

  // TODO-4.F.9: 生成悬崖面（Riser）垂直四边形
  // generateCliffFaces(map, state)
}

// ---------------------------------------------------------------------------
// Cliff Face (Riser) Generation — TODO-4.F.9
// ---------------------------------------------------------------------------

/**
 * 为高度不连续的 cell 边生成垂直 cliff 面四边形。
 *
 * OpenRA 对照: TerrainTileInfo.Riser 编码了 8 个方向的预期高度差。
 *
 * 对每个 cell 边，如果相邻 cell 有高度差：
 * - 生成垂直 quad（2 个三角形）连接较低 cell 的边顶点到较高 cell 的边顶点
 * - Cliff 面法线指向 cell 中心外侧
 * - UV 使用垂直投影
 *
 * TODO-4.F.9: 完整实现 Riser 驱动的 cliff 面生成。
 * 当前为 stub，等待 TerrainInfo Riser 数据集成。
 *
 * @param _map — Map 实例
 * @param _state — 构建状态
 */
// @ts-expect-error — stub for TODO-4.F.9, called via commented-out invocation in generateTerrainSurface
function generateCliffFaces(_map: Map, _state: MeshBuildState): void {
  // Stub: Riser cliff face generation deferred to TODO-4.F.9
  // Implementation plan:
  // 1. Iterate all cell edges (4 per cell: top, right, bottom, left)
  // 2. For each edge, check neighbor cell height difference
  // 3. If height diff > 0, generate vertical quad:
  //    - Lower edge vertices (2) at lower cell's height
  //    - Upper edge vertices (2) at upper cell's height + corner offset
  //    - 2 triangles forming the vertical face
  // 4. Normals point outward from cell center
  // 5. UVs use world-space vertical projection
}

/**
 * 生成矩形网格地形表面。
 *
 * 矩形网格的顶点布局是规则的 (N+1) x (M+1) 网格。
 * 每个 cell 的 4 个角点对应网格中的 4 个顶点。
 */
function generateRectangularSurface(map: Map, state: MeshBuildState): void {
  const w = map.mapSize.width
  const h = map.mapSize.height

  // 对每个 cell 生成三角形
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = new CPos(x, y)
      const rampVal = map.ramp.get(cell)
      const ramp = map.grid.ramps[rampVal]

      // 获取 cell 的 4 个角点顶点索引
      // 矩形网格顶点在 (x,y), (x+1,y), (x+1,y+1), (x,y+1)
      // 使用密集 Int32Array 索引替代字符串 deduplication
      const vTL = getOrCreateRectVertex(x, y, cellCornerToVector3(cell, 0, map), state)
      const vTR = getOrCreateRectVertex(x + 1, y, cellCornerToVector3(cell, 1, map), state)
      const vBR = getOrCreateRectVertex(x + 1, y + 1, cellCornerToVector3(cell, 2, map), state)
      const vBL = getOrCreateRectVertex(x, y + 1, cellCornerToVector3(cell, 3, map), state)

      // 根据 split 模式生成三角形
      if (ramp.polygons.length === 2) {
        // 通过检查第一个三角形的顶点来确定 split 方向
        // X-split: 第一个三角形是 TL-TR-BL (corners 0,1,3)
        // Y-split: 第一个三角形是 TL-TR-BR (corners 0,1,2)
        const p0 = ramp.polygons[0]
        const isYSplit = p0.length === 3 &&
          p0[2] === ramp.corners[2] // 第三个顶点是 BR

        if (isYSplit) {
          // Y-split: TL-TR-BR + TL-BR-BL
          addTriangle(vTL, vTR, vBR, state)
          addTriangle(vTL, vBR, vBL, state)
        } else {
          // X-split: TL-TR-BL + TR-BR-BL
          addTriangle(vTL, vTR, vBL, state)
          addTriangle(vTR, vBR, vBL, state)
        }
      } else {
        // Flat: 2 triangles (0-1-2, 0-2-3) for quad
        addTriangle(vTL, vTR, vBR, state)
        addTriangle(vTL, vBR, vBL, state)
      }
    }
  }
}

/**
 * 生成等轴网格地形表面。
 *
 * 等轴网格的 cell 形成菱形排列。
 * 每个 cell 的 4 个角点在 world space 中位置不同。
 * 相邻 cell 共享边顶点。
 */
function generateIsometricSurface(map: Map, state: MeshBuildState): void {
  const w = map.mapSize.width
  const h = map.mapSize.height

  // Isometric 网格遍历使用 MPos (U,V) 坐标
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const mpos = new MPos(u, v)
      const cell = mpos.toCPos(MapGridType.RectangularIsometric)

      // 对于 isometric 网格，需要检查 cell 是否有效 (X >= Y)
      if (cell.X < cell.Y) continue

      // 检查 cell 是否在 map 范围内
      if (!map.contains(cell)) continue

      const rampVal = map.ramp.get(cell)
      const ramp = map.grid.ramps[rampVal]

      // 获取 cell 的 4 个角点 (等轴网格使用字符串 deduplication)
      const vTL = getOrCreateIsoVertex(cellCornerToVector3(cell, 0, map), state)
      const vTR = getOrCreateIsoVertex(cellCornerToVector3(cell, 1, map), state)
      const vBR = getOrCreateIsoVertex(cellCornerToVector3(cell, 2, map), state)
      const vBL = getOrCreateIsoVertex(cellCornerToVector3(cell, 3, map), state)

      // 根据 split 模式生成三角形
      if (ramp.polygons.length === 2) {
        const p0 = ramp.polygons[0]
        const isYSplit = p0.length === 3 && p0[2] === ramp.corners[2]

        if (isYSplit) {
          addTriangle(vTL, vTR, vBR, state)
          addTriangle(vTL, vBR, vBL, state)
        } else {
          addTriangle(vTL, vTR, vBL, state)
          addTriangle(vTR, vBR, vBL, state)
        }
      } else {
        addTriangle(vTL, vTR, vBR, state)
        addTriangle(vTL, vBR, vBL, state)
      }
    }
  }
}

/**
 * 添加一个三角形并记录顶点-三角形邻接关系。
 *
 * @param v0 — 顶点0索引
 * @param v1 — 顶点1索引
 * @param v2 — 顶点2索引
 * @param state — 构建状态
 */
function addTriangle(v0: number, v1: number, v2: number, state: MeshBuildState): void {
  const triIndex = state.triangleIndices.length / 3
  state.triangleIndices.push(v0, v1, v2)
  state.vertexTriangles[v0]!.push(triIndex)
  state.vertexTriangles[v1]!.push(triIndex)
  state.vertexTriangles[v2]!.push(triIndex)
}

// ---------------------------------------------------------------------------
// Normal Calculation
// ---------------------------------------------------------------------------

/**
 * 计算顶点法线。
 *
 * 先计算每个三角形的面法线，然后在共享顶点处平均。
 * 使用 Babylon.js 左手坐标系。
 *
 * WARNING: Babylon.js 使用左手坐标系，cross product 顺序很重要。
 * 使用 Vector3.Cross(to, from) 或正确的 from->to 顺序。
 * 参考: commit 8be1572 修复了 plane normal 方向。
 *
 * @param state — 构建状态
 * @returns 法线数组 (每顶点3个值)
 */
function computeNormals(state: MeshBuildState): number[] {
  const vertexCount = state.positions.length / 3
  const normals = new Array<number>(vertexCount * 3).fill(0)

  // 第一步：计算每个三角形的面法线并累加到顶点
  const triCount = state.triangleIndices.length / 3
  for (let ti = 0; ti < triCount; ti++) {
    const v0 = state.triangleIndices[ti * 3 + 0]!
    const v1 = state.triangleIndices[ti * 3 + 1]!
    const v2 = state.triangleIndices[ti * 3 + 2]!

    // 获取顶点位置
    const p0x = state.positions[v0 * 3 + 0]!
    const p0y = state.positions[v0 * 3 + 1]!
    const p0z = state.positions[v0 * 3 + 2]!

    const p1x = state.positions[v1 * 3 + 0]!
    const p1y = state.positions[v1 * 3 + 1]!
    const p1z = state.positions[v1 * 3 + 2]!

    const p2x = state.positions[v2 * 3 + 0]!
    const p2y = state.positions[v2 * 3 + 1]!
    const p2z = state.positions[v2 * 3 + 2]!

    // 边向量
    const e0x = p1x - p0x
    const e0y = p1y - p0y
    const e0z = p1z - p0z

    const e1x = p2x - p0x
    const e1y = p2y - p0y
    const e1z = p2z - p0z

    // Cross product: e1 x e0 (左手坐标系)
    // 对于左手坐标系，cross(e1, e0) 给出正确的 outward normal
    // e0 = v1 - v0, e1 = v2 - v0
    // cross = (e1y*e0z - e1z*e0y, e1z*e0x - e1x*e0z, e1x*e0y - e1y*e0x)
    // NOTE: 使用 e1 x e0 (而非 e0 x e1) 确保法线朝上
    let nx = e1y * e0z - e1z * e0y
    let ny = e1z * e0x - e1x * e0z
    let nz = e1x * e0y - e1y * e0x

    // 归一化
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0) {
      nx /= len
      ny /= len
      nz /= len
    }

    // 累加到三个顶点
    normals[v0 * 3 + 0] += nx
    normals[v0 * 3 + 1] += ny
    normals[v0 * 3 + 2] += nz

    normals[v1 * 3 + 0] += nx
    normals[v1 * 3 + 1] += ny
    normals[v1 * 3 + 2] += nz

    normals[v2 * 3 + 0] += nx
    normals[v2 * 3 + 1] += ny
    normals[v2 * 3 + 2] += nz
  }

  // 第二步：归一化每个顶点的法线
  for (let i = 0; i < vertexCount; i++) {
    let nx = normals[i * 3 + 0]!
    let ny = normals[i * 3 + 1]!
    let nz = normals[i * 3 + 2]!
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (len > 0) {
      normals[i * 3 + 0] = nx / len
      normals[i * 3 + 1] = ny / len
      normals[i * 3 + 2] = nz / len
    }
  }

  return normals
}

// ---------------------------------------------------------------------------
// UV Generation
// ---------------------------------------------------------------------------

/**
 * 计算世界空间 UV 坐标。
 *
 * u = (worldX - originX) / worldWidth
 * v = (worldZ - originZ) / worldHeight
 *
 * 使用 world space XZ 平面（Babylon.js 的地面平面）作为 UV 投影。
 *
 * @param state — 构建状态
 * @returns UV 数组 (每顶点2个值)
 */
function computeUVs(state: MeshBuildState): number[] {
  const vertexCount = state.positions.length / 3
  const uvs = new Array<number>(vertexCount * 2)

  for (let i = 0; i < vertexCount; i++) {
    const x = state.positions[i * 3 + 0]!
    const z = state.positions[i * 3 + 2]!

    // 世界空间 UV 映射
    const u = (x - state.originX) / state.worldWidth
    const v = (z - state.originZ) / state.worldHeight

    uvs[i * 2 + 0] = u
    uvs[i * 2 + 1] = v
  }

  return uvs
}

// ---------------------------------------------------------------------------
// Re-export key types
// ---------------------------------------------------------------------------

export { Vector3 }
