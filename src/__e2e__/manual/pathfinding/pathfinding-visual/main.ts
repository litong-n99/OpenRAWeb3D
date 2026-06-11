/**
 * pathfinding-visual/main.ts — HPA* 层次路径查找 3D 可视化验收测试
 *
 * OpenRA 对照: OpenRA.Mods.Common/Pathfinder/HierarchicalPathFinder.cs
 *              OpenRA.Mods.Common/Pathfinder/PathSearch.cs
 *
 * NOTE: This page implements standalone A* and HPA* algorithms for visualization purposes.
 * The production pathfinder (HierarchicalPathFinder.ts, PathSearch.ts) is separately
 * validated by 190 unit tests. This test page demonstrates algorithmic behavior visually.
 *
 * 实现自包含的 A* 和 HPA* 算法，在 30x30 网格上可视化展示:
 *   1. A* 基础路径查找 (障碍物绕行)
 *   2. HPA* 层次路径查找 (抽象图 + 抽象节点/边)
 *   3. Domain 连通域可视化 (flood fill)
 *   4. 搜索空间对比 (A* vs HPA* 探索节点数)
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  LinesMesh,
  RawTexture,
  Texture,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid & A* Types
// ---------------------------------------------------------------------------

const GRID_W = 30
const GRID_H = 30
const CELL_SIZE = 1.0
const GRID_SIZE = 10 // HPA* cluster size

interface AStarNode {
  x: number
  y: number
  walkable: boolean
  g: number
  h: number
  f: number
  parent: AStarNode | null
  closed: boolean
  open: boolean
  explored: boolean
}

interface HpaCluster {
  id: number
  cx: number // cluster origin x
  cy: number
  nodes: AStarNode[]
  abstractNode: { x: number; y: number } | null
  domain: number
}

// ---------------------------------------------------------------------------
// Global State
// ---------------------------------------------------------------------------

const grid: AStarNode[][] = []
let startX = 2, startY = 14
let targetX = 27, targetY = 14
let aStarPath: { x: number; y: number }[] = []
let aStarExplored: Set<number> = new Set()
let aStarTime = 0
let hpaPath: { x: number; y: number }[] = []
let hpaExplored: Set<number> = new Set()
let hpaTime = 0
let hpaClusters: HpaCluster[] = []
let hpaEdges: [number, number][] = []
let domains: Map<number, number> = new Map() // cell key -> domain id
let domainColors: Map<number, Color3> = new Map()
type VizMode = 'a' | 'hpa' | 'both' | 'domains' | 'hierarchy'
let vizMode: VizMode = 'a'

function cellKey(x: number, y: number): number { return y * GRID_W + x }

// ---------------------------------------------------------------------------
// Initialize Grid
// ---------------------------------------------------------------------------

function initGrid(): void {
  grid.length = 0
  for (let y = 0; y < GRID_H; y++) {
    const row: AStarNode[] = []
    for (let x = 0; x < GRID_W; x++) {
      row.push({ x, y, walkable: true, g: 0, h: 0, f: 0, parent: null, closed: false, open: false, explored: false })
    }
    grid.push(row)
  }
}

function resetGridState(): void {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const n = grid[y][x]
      n.g = 0; n.h = 0; n.f = 0
      n.parent = null; n.closed = false; n.open = false; n.explored = false
    }
  }
  aStarExplored.clear()
  hpaExplored.clear()
  domains.clear()
  domainColors.clear()
}

function setObstacle(x: number, y: number, blocked: boolean): void {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return
  if ((x === startX && y === startY) || (x === targetX && y === targetY)) return
  grid[y][x].walkable = !blocked
}

// ---------------------------------------------------------------------------
// A* Pathfinding
// ---------------------------------------------------------------------------

const DIRS_8 = [
  { dx: 0, dy: -1, cost: 1 }, { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 }, { dx: -1, dy: 0, cost: 1 },
  { dx: 1, dy: -1, cost: 1.414 }, { dx: 1, dy: 1, cost: 1.414 },
  { dx: -1, dy: 1, cost: 1.414 }, { dx: -1, dy: -1, cost: 1.414 },
]

function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  const dx = Math.abs(x1 - x2)
  const dy = Math.abs(y1 - y2)
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy) // diagonal distance
}

function runAStar(sx: number, sy: number, tx: number, ty: number): { path: {x:number,y:number}[], explored: Set<number>, time: number } {
  const explored = new Set<number>()
  const t0 = performance.now()

  const openList: AStarNode[] = []
  const startNode = grid[sy][sx]
  startNode.g = 0
  startNode.h = heuristic(sx, sy, tx, ty)
  startNode.f = startNode.h
  startNode.open = true
  startNode.parent = null
  openList.push(startNode)

  let found = false
  const targetNode = grid[ty][tx]

  while (openList.length > 0) {
    // Find lowest f
    let bestIdx = 0
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[bestIdx].f ||
          (openList[i].f === openList[bestIdx].f && openList[i].h < openList[bestIdx].h)) {
        bestIdx = i
      }
    }
    const current = openList[bestIdx]
    openList.splice(bestIdx, 1)

    if (current === targetNode) { found = true; break }

    current.closed = true
    current.open = false
    current.explored = true
    explored.add(cellKey(current.x, current.y))

    for (const d of DIRS_8) {
      const nx = current.x + d.dx
      const ny = current.y + d.dy
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue
      const neighbor = grid[ny][nx]
      if (!neighbor.walkable || neighbor.closed) continue

      // Check diagonal movement doesn't cut corners
      // OpenRA rule: diagonal blocked if EITHER adjacent corner cell is impassable
      if (d.dx !== 0 && d.dy !== 0) {
        if (!grid[current.y][nx].walkable || !grid[ny][current.x].walkable) continue
      }

      const tentativeG = current.g + d.cost
      if (!neighbor.open) {
        neighbor.open = true
        neighbor.g = tentativeG
        neighbor.h = heuristic(nx, ny, tx, ty)
        neighbor.f = neighbor.g + neighbor.h
        neighbor.parent = current
        openList.push(neighbor)
      } else if (tentativeG < neighbor.g) {
        neighbor.g = tentativeG
        neighbor.f = neighbor.g + neighbor.h
        neighbor.parent = current
      }
    }
  }

  const t1 = performance.now()

  // Build path
  const path: { x: number; y: number }[] = []
  if (found) {
    let cur: AStarNode | null = targetNode
    while (cur) {
      path.push({ x: cur.x, y: cur.y })
      explored.add(cellKey(cur.x, cur.y))
      cur = cur.parent
    }
    path.reverse()
  }

  return { path, explored, time: t1 - t0 }
}

// ---------------------------------------------------------------------------
// HPA* Simplification (Abstract Graph Construction)
// ---------------------------------------------------------------------------

function buildHpaClusters(): HpaCluster[] {
  const clusters: HpaCluster[] = []
  const clusterGridX = Math.ceil(GRID_W / GRID_SIZE)
  const clusterGridY = Math.ceil(GRID_H / GRID_SIZE)

  for (let cy = 0; cy < clusterGridY; cy++) {
    for (let cx = 0; cx < clusterGridX; cx++) {
      const originX = cx * GRID_SIZE
      const originY = cy * GRID_SIZE
      const nodes: AStarNode[] = []
      for (let dy = 0; dy < GRID_SIZE; dy++) {
        for (let dx = 0; dx < GRID_SIZE; dx++) {
          const gx = originX + dx
          const gy = originY + dy
          if (gx < GRID_W && gy < GRID_H) {
            nodes.push(grid[gy][gx])
          }
        }
      }
      // Find abstract node: center of walkable region
      const walkableNodes = nodes.filter(n => n.walkable)
      let abstractNode: { x: number; y: number } | null = null
      if (walkableNodes.length > 0) {
        const avgX = walkableNodes.reduce((s, n) => s + n.x, 0) / walkableNodes.length
        const avgY = walkableNodes.reduce((s, n) => s + n.y, 0) / walkableNodes.length
        // Pick closest walkable node
        let best = walkableNodes[0]
        let bestDist = Infinity
        for (const n of walkableNodes) {
          const d = (n.x - avgX) ** 2 + (n.y - avgY) ** 2
          if (d < bestDist) { bestDist = d; best = n }
        }
        abstractNode = { x: best.x, y: best.y }
      }
      clusters.push({
        id: cy * clusterGridX + cx,
        cx: originX, cy: originY,
        nodes,
        abstractNode,
        domain: -1,
      })
    }
  }
  return clusters
}

function buildHpaEdges(clusters: HpaCluster[]): [number, number][] {
  const edges: [number, number][] = []
  const clusterGridX = Math.ceil(GRID_W / GRID_SIZE)

  for (const c of clusters) {
    if (!c.abstractNode) continue
    // Check adjacent clusters (right and down)
    const adjDirs = [{ dci: 1, dcj: 0 }, { dci: 0, dcj: 1 }]
    for (const d of adjDirs) {
      const adjCx = Math.floor(c.cx / GRID_SIZE) + d.dci
      const adjCy = Math.floor(c.cy / GRID_SIZE) + d.dcj
      const adjIdx = adjCy * clusterGridX + adjCx
      if (adjIdx >= clusters.length) continue
      const adj = clusters[adjIdx]
      if (!adj.abstractNode) continue

      // Check if any boundary cells between clusters are both walkable
      let connected = false
      if (d.dci === 1) {
        // Right edge of c, left edge of adj
        const bx = c.cx + GRID_SIZE - 1
        for (let dy = 0; dy < GRID_SIZE; dy++) {
          const by = c.cy + dy
          if (by >= GRID_H) break
          if (bx + 1 < GRID_W && grid[by][bx].walkable && grid[by][bx + 1].walkable) {
            connected = true; break
          }
        }
      } else {
        // Bottom edge of c, top edge of adj
        const by = c.cy + GRID_SIZE - 1
        for (let dx = 0; dx < GRID_SIZE; dx++) {
          const bx = c.cx + dx
          if (bx >= GRID_W) break
          if (by + 1 < GRID_H && grid[by][bx].walkable && grid[by + 1][bx].walkable) {
            connected = true; break
          }
        }
      }
      if (connected) {
        edges.push([c.id, adj.id])
      }
    }
  }
  return edges
}

function runHpaStar(sx: number, sy: number, tx: number, ty: number): { path: {x:number,y:number}[], explored: Set<number>, time: number } {
  const t0 = performance.now()
  const explored = new Set<number>()

  // Build HPA* clusters and edges
  const clusters = buildHpaClusters()
  const edges = buildHpaEdges(clusters)
  hpaClusters = clusters
  hpaEdges = edges

  // Find source and target clusters
  const srcCluster = clusters.find(c =>
    sx >= c.cx && sx < c.cx + GRID_SIZE && sy >= c.cy && sy < c.cy + GRID_SIZE
  )!
  const tgtCluster = clusters.find(c =>
    tx >= c.cx && tx < c.cx + GRID_SIZE && ty >= c.cy && ty < c.cy + GRID_SIZE
  )!

  // Build abstract graph adjacency
  const clusterGraph = new Map<number, number[]>()
  for (const [a, b] of edges) {
    if (!clusterGraph.has(a)) clusterGraph.set(a, [])
    if (!clusterGraph.has(b)) clusterGraph.set(b, [])
    clusterGraph.get(a)!.push(b)
    clusterGraph.get(b)!.push(a)
  }

  // A* over abstract graph
  const abstractOpen: { id: number; g: number; h: number; f: number; parent: number | null }[] = []
  const abstractVisited = new Map<number, { g: number; parent: number | null; closed: boolean }>()

  const startId = srcCluster.id
  const targetId = tgtCluster.id
  if (!srcCluster.abstractNode || !tgtCluster.abstractNode) {
    // Try direct local A* as fallback
    const t1 = performance.now()
    const result = runAStar(sx, sy, tx, ty)
    result.time = t1 - t0
    return result
  }

  const startANode = { id: startId, g: 0, h: 0, f: 0, parent: null as number | null }
  startANode.h = heuristic(
    srcCluster.abstractNode!.x, srcCluster.abstractNode!.y,
    tgtCluster.abstractNode!.x, tgtCluster.abstractNode!.y
  ) / GRID_SIZE
  startANode.f = startANode.h
  abstractOpen.push(startANode)
  abstractVisited.set(startId, { g: 0, parent: null, closed: false })

  let abstractFound = false
  while (abstractOpen.length > 0) {
    let bestIdx = 0
    for (let i = 1; i < abstractOpen.length; i++) {
      if (abstractOpen[i].f < abstractOpen[bestIdx].f) bestIdx = i
    }
    const cur = abstractOpen[bestIdx]
    abstractOpen.splice(bestIdx, 1)
    const curInfo = abstractVisited.get(cur.id)!
    curInfo.closed = true

    if (cur.id === targetId) { abstractFound = true; break }

    const neighbors = clusterGraph.get(cur.id) ?? []
    for (const nid of neighbors) {
      const nc = clusters[nid]
      if (!nc.abstractNode) continue
      if (abstractVisited.get(nid)?.closed) continue

      const moveCost = GRID_SIZE
      const g = cur.g + moveCost
      const existing = abstractVisited.get(nid)
      if (existing && !existing.closed && g >= existing.g) continue

      const h = heuristic(
        nc.abstractNode.x, nc.abstractNode.y,
        tgtCluster.abstractNode!.x, tgtCluster.abstractNode!.y
      ) / GRID_SIZE
      abstractVisited.set(nid, { g, parent: cur.id, closed: false })
      abstractOpen.push({ id: nid, g, h, f: g + h * 10, parent: cur.id })
    }
  }

  // Build abstract path cluster sequence
  const clusterPath: number[] = []
  if (abstractFound) {
    let cid: number | null = targetId
    while (cid !== null) {
      clusterPath.unshift(cid)
      cid = abstractVisited.get(cid)?.parent ?? null
    }
  }

  // Record explored for HPA*
  for (const [id, _info] of abstractVisited) {
    const c = clusters[id]
    for (const n of c.nodes) {
      if (n.walkable) explored.add(cellKey(n.x, n.y))
    }
    // Also add boundary cells
    if (c.abstractNode) {
      explored.add(cellKey(c.abstractNode.x, c.abstractNode.y))
    }
  }

  // For visualization: also include ALL cells in visited clusters
  for (const [id] of abstractVisited) {
    const c = clusters[id]
    for (const n of c.nodes) {
      explored.add(cellKey(n.x, n.y))
    }
  }

  // Build actual path: do local A* between consecutive clusters
  const path: { x: number; y: number }[] = []
  if (clusterPath.length >= 2) {
    let curX = sx, curY = sy
    for (let i = 0; i < clusterPath.length - 1; i++) {
      const fromC = clusters[clusterPath[i]]
      const toC = clusters[clusterPath[i + 1]]
      if (!fromC.abstractNode || !toC.abstractNode) continue
      const segResult = runAStar(curX, curY, toC.abstractNode.x, toC.abstractNode.y)
      if (segResult.path.length > 0) {
        if (path.length === 0) path.push(...segResult.path)
        else path.push(...segResult.path.slice(1))
        const last = segResult.path[segResult.path.length - 1]
        curX = last.x; curY = last.y
        for (const k of segResult.explored) explored.add(k)
      }
    }
    // Final segment to target
    const finalResult = runAStar(curX, curY, tx, ty)
    if (finalResult.path.length > 0) {
      if (path.length === 0) path.push(...finalResult.path)
      else path.push(...finalResult.path.slice(1))
      for (const k of finalResult.explored) explored.add(k)
    }
  } else {
    // Fallback to direct A*
    const directResult = runAStar(sx, sy, tx, ty)
    path.push(...directResult.path)
    for (const k of directResult.explored) explored.add(k)
  }

  const t1 = performance.now()
  return { path, explored, time: t1 - t0 }
}

// ---------------------------------------------------------------------------
// Domain Calculation (Flood Fill)
// ---------------------------------------------------------------------------

function computeDomains(): Map<number, number> {
  const visited = new Set<number>()
  const domainMap = new Map<number, number>()
  let domainId = 0

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!grid[y][x].walkable) continue
      const key = cellKey(x, y)
      if (visited.has(key)) continue

      // BFS flood fill
      domainId++
      const stack: [number, number][] = [[x, y]]
      visited.add(key)
      domainMap.set(key, domainId)

      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!
        for (const d of DIRS_8.slice(0, 4)) { // 4-directional
          const nx = cx + d.dx
          const ny = cy + d.dy
          if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue
          if (!grid[ny][nx].walkable) continue
          const nk = cellKey(nx, ny)
          if (visited.has(nk)) continue
          visited.add(nk)
          domainMap.set(nk, domainId)
          stack.push([nx, ny])
        }
      }
    }
  }
  return domainMap
}

// ---------------------------------------------------------------------------
// 3D Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 28, new Vector3(GRID_W / 2, 0, GRID_H / 2), scene)
camera.attachControl(canvas, true)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 60
camera.panningSensibility = 300

new HemisphericLight('hemi', new Vector3(0.3, 1, 0.3), scene)

// Ground plane
const groundMat = new StandardMaterial('ground', scene)
groundMat.diffuseColor = new Color3(0.12, 0.15, 0.20)
groundMat.specularColor = new Color3(0, 0, 0)
const ground = MeshBuilder.CreateGround('ground', {
  width: GRID_W * CELL_SIZE, height: GRID_H * CELL_SIZE,
}, scene)
ground.position = new Vector3(GRID_W / 2 * CELL_SIZE, -0.05, GRID_H / 2 * CELL_SIZE)
ground.material = groundMat

// Grid texture (drawn on canvas)
const gridTexCanvas = document.createElement('canvas')
gridTexCanvas.width = GRID_W * 16
gridTexCanvas.height = GRID_H * 16
const gridTexCtx = gridTexCanvas.getContext('2d')!
const gridTex = new RawTexture(
  new Uint8Array(gridTexCanvas.width * gridTexCanvas.height * 4),
  gridTexCanvas.width, gridTexCanvas.height,
  5, scene, false, false, Texture.NEAREST_NEAREST
)
gridTex.wrapU = Texture.CLAMP_ADDRESSMODE
gridTex.wrapV = Texture.CLAMP_ADDRESSMODE
gridTex.updateSamplingMode(Texture.NEAREST_NEAREST)

const overlayMat = new StandardMaterial('overlay', scene)
overlayMat.diffuseTexture = gridTex
overlayMat.diffuseTexture!.hasAlpha = true
overlayMat.useAlphaFromDiffuseTexture = true
overlayMat.specularColor = new Color3(0, 0, 0)
overlayMat.backFaceCulling = false

const overlayPlane = MeshBuilder.CreateGround('overlayPlane', {
  width: GRID_W * CELL_SIZE, height: GRID_H * CELL_SIZE,
}, scene)
overlayPlane.position = new Vector3(GRID_W / 2 * CELL_SIZE, 0.01, GRID_H / 2 * CELL_SIZE)
overlayPlane.material = overlayMat

// Mesh containers for dynamic elements
const pathShperes: Mesh[] = []        // A* path (yellow)
const hpaPathSpheres: Mesh[] = []     // HPA* path (cyan/teal)
const obstacleBoxes: Mesh[] = []
const abstractNodeSpheres: Mesh[] = []
const abstractEdgeLines: LinesMesh[] = []
const clusterFrameLines: LinesMesh[] = []
const startMarker: Mesh[] = []
const targetMarker: Mesh[] = []

// ---------------------------------------------------------------------------
// Texture Update
// ---------------------------------------------------------------------------

const DOMAIN_PALETTE: Color3[] = [
  new Color3(0.2, 0.6, 0.9), new Color3(0.9, 0.4, 0.2),
  new Color3(0.4, 0.9, 0.3), new Color3(0.9, 0.3, 0.7),
  new Color3(0.3, 0.8, 0.8), new Color3(0.8, 0.7, 0.2),
  new Color3(0.6, 0.4, 0.9), new Color3(0.9, 0.6, 0.3),
  new Color3(0.4, 0.7, 0.5), new Color3(0.7, 0.5, 0.4),
]

function getCellColor(x: number, y: number): [number, number, number, number] {
  const k = cellKey(x, y)

  // Domain mode
  if (vizMode === 'domains') {
    if (!grid[y][x].walkable) return [0.15, 0.15, 0.15, 1]
    const did = domains.get(k)
    if (did !== undefined && did > 0) {
      const c = DOMAIN_PALETTE[(did - 1) % DOMAIN_PALETTE.length]
      return [c.r, c.g, c.b, 1]
    }
    return [0.2, 0.25, 0.3, 1]
  }

  // Hierarchy mode
  if (vizMode === 'hierarchy') {
    const ck = cellKey(Math.floor(x / GRID_SIZE), Math.floor(y / GRID_SIZE))
    const c = DOMAIN_PALETTE[ck % DOMAIN_PALETTE.length]
    if (!grid[y][x].walkable) return [c.r * 0.2, c.g * 0.2, c.b * 0.2, 1]
    return [c.r * 0.6, c.g * 0.6, c.b * 0.6, 1]
  }

  // Default: show explored nodes
  let aExpl = aStarExplored.has(k)
  let hExpl = hpaExplored.has(k)

  // In 'both' mode, show both
  if (vizMode === 'a') {
    if (x === startX && y === startY) return [0.2, 0.8, 0.2, 1]
    if (x === targetX && y === targetY) return [0.9, 0.2, 0.2, 1]
    if (!grid[y][x].walkable) return [0.2, 0.2, 0.2, 1]
    if (isOnPath(x, y, aStarPath)) return [1.0, 0.8, 0.0, 1]
    if (aExpl) return [0.0, 0.7, 0.9, 0.5]
    return [0.18, 0.22, 0.28, 1]
  }

  if (vizMode === 'hpa') {
    if (x === startX && y === startY) return [0.2, 0.8, 0.2, 1]
    if (x === targetX && y === targetY) return [0.9, 0.2, 0.2, 1]
    if (!grid[y][x].walkable) return [0.2, 0.2, 0.2, 1]
    if (isOnPath(x, y, hpaPath)) return [0.0, 0.85, 0.85, 1]  // HPA* path: cyan/teal
    if (hExpl) return [0.7, 0.4, 1.0, 0.5]
    return [0.18, 0.22, 0.28, 1]
  }

  // 'both' mode
  if (x === startX && y === startY) return [0.2, 0.8, 0.2, 1]
  if (x === targetX && y === targetY) return [0.9, 0.2, 0.2, 1]
  if (!grid[y][x].walkable) return [0.2, 0.2, 0.2, 1]
  if (isOnPath(x, y, aStarPath)) return [1.0, 0.8, 0.0, 1]   // A* path: yellow
  if (isOnPath(x, y, hpaPath)) return [0.0, 0.85, 0.85, 1]   // HPA* path: cyan/teal
  // Blend: cyan for A*, purple for HPA*
  if (aExpl && hExpl) return [0.5, 0.6, 1.0, 0.6]
  if (aExpl) return [0.0, 0.7, 0.9, 0.4]
  if (hExpl) return [0.7, 0.4, 1.0, 0.4]
  return [0.18, 0.22, 0.28, 1]
}

function isOnPath(x: number, y: number, path: { x: number; y: number }[]): boolean {
  return path.some(p => p.x === x && p.y === y)
}

function updateGridTexture(): void {
  const imgData = gridTexCtx.createImageData(gridTexCanvas.width, gridTexCanvas.height)
  const data = imgData.data
  const pw = gridTexCanvas.width / GRID_W
  const ph = gridTexCanvas.height / GRID_H

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const [r, g, b, a] = getCellColor(gx, gy)
      const px = Math.floor(gx * pw)
      const py = Math.floor(gy * ph)
      for (let dy = 0; dy < Math.ceil(ph); dy++) {
        for (let dx = 0; dx < Math.ceil(pw); dx++) {
          const idx = ((py + dy) * gridTexCanvas.width + (px + dx)) * 4
          if (idx + 3 < data.length) {
            data[idx] = Math.floor(r * 255)
            data[idx + 1] = Math.floor(g * 255)
            data[idx + 2] = Math.floor(b * 255)
            data[idx + 3] = Math.floor(a * 255)
          }
        }
      }
    }
  }

  // Draw grid lines
  gridTexCtx.putImageData(imgData, 0, 0)
  gridTexCtx.strokeStyle = 'rgba(255,255,255,0.06)'
  gridTexCtx.lineWidth = 0.5
  for (let gx = 1; gx < GRID_W; gx++) {
    const x = gx * pw
    gridTexCtx.beginPath()
    gridTexCtx.moveTo(x, 0)
    gridTexCtx.lineTo(x, gridTexCanvas.height)
    gridTexCtx.stroke()
  }
  for (let gy = 1; gy < GRID_H; gy++) {
    const y = gy * ph
    gridTexCtx.beginPath()
    gridTexCtx.moveTo(0, y)
    gridTexCtx.lineTo(gridTexCanvas.width, y)
    gridTexCtx.stroke()
  }

  gridTex.update(gridTexCtx.getImageData(0, 0, gridTexCanvas.width, gridTexCanvas.height).data)
}

// ---------------------------------------------------------------------------
// 3D Markers
// ---------------------------------------------------------------------------

function createOrUpdateMarker(list: Mesh[], x: number, y: number, color: Color3, size: number, yOffset: number): void {
  // Remove old
  for (const m of list) { m.dispose() }
  list.length = 0

  const sphere = MeshBuilder.CreateSphere('marker', { diameter: size * 0.7 }, scene)
  sphere.position = new Vector3(x * CELL_SIZE + CELL_SIZE / 2, yOffset, y * CELL_SIZE + CELL_SIZE / 2)
  const mat = new StandardMaterial('markerMat', scene)
  mat.diffuseColor = color
  mat.emissiveColor = color
  mat.specularColor = new Color3(0, 0, 0)
  sphere.material = mat
  list.push(sphere)
}

function clearMarkers(): void {
  for (const m of pathShperes) m.dispose()
  pathShperes.length = 0
  for (const m of hpaPathSpheres) m.dispose()
  hpaPathSpheres.length = 0
  for (const m of obstacleBoxes) m.dispose()
  obstacleBoxes.length = 0
  for (const m of abstractNodeSpheres) m.dispose()
  abstractNodeSpheres.length = 0
  for (const l of abstractEdgeLines) l.dispose()
  abstractEdgeLines.length = 0
  for (const l of clusterFrameLines) l.dispose()
  clusterFrameLines.length = 0
}

function buildPathSpheresGeneric(
  path: { x: number; y: number }[],
  container: Mesh[],
  diffuseColor: Color3,
  emissiveColor: Color3,
  diameter: number,
  yOffset: number,
): void {
  for (const p of path) {
    const sphere = MeshBuilder.CreateSphere('pathDot', { diameter }, scene)
    sphere.position = new Vector3(p.x * CELL_SIZE + CELL_SIZE / 2, yOffset, p.y * CELL_SIZE + CELL_SIZE / 2)
    const mat = new StandardMaterial('pathMat', scene)
    mat.diffuseColor = diffuseColor
    mat.emissiveColor = emissiveColor
    mat.specularColor = new Color3(0, 0, 0)
    sphere.material = mat
    container.push(sphere)
  }
}

/** Build A* path spheres (yellow, diameter 0.25). */
function buildPathSpheres(path: { x: number; y: number }[]): void {
  buildPathSpheresGeneric(path, pathShperes, new Color3(1, 0.8, 0), new Color3(0.4, 0.3, 0), 0.25, 0.35)
}

/** Build HPA* path spheres (cyan/teal, diameter 0.30 for visual distinction). */
function buildHpaPathSpheresFunc(path: { x: number; y: number }[]): void {
  buildPathSpheresGeneric(path, hpaPathSpheres, new Color3(0, 0.85, 0.85), new Color3(0, 0.3, 0.3), 0.30, 0.40)
}

function buildObstacleMarkers(): void {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!grid[y][x].walkable) {
        const box = MeshBuilder.CreateBox('obs', { width: 0.85, height: 0.35, depth: 0.85 }, scene)
        box.position = new Vector3(x * CELL_SIZE + CELL_SIZE / 2, 0.175, y * CELL_SIZE + CELL_SIZE / 2)
        const mat = new StandardMaterial('obsMat', scene)
        mat.diffuseColor = new Color3(0.25, 0.25, 0.25)
        mat.specularColor = new Color3(0, 0, 0)
        box.material = mat
        obstacleBoxes.push(box)
      }
    }
  }
}

function buildHpaVisualization(): void {
  // Abstract nodes and edges
  if (hpaClusters.length > 0) {
    for (const c of hpaClusters) {
      if (!c.abstractNode) continue
      const sphere = MeshBuilder.CreateSphere('absNode', { diameter: 0.35 }, scene)
      sphere.position = new Vector3(
        c.abstractNode.x * CELL_SIZE + CELL_SIZE / 2, 0.5,
        c.abstractNode.y * CELL_SIZE + CELL_SIZE / 2)
      const mat = new StandardMaterial('absNodeMat', scene)
      mat.diffuseColor = new Color3(1, 1, 1)
      mat.emissiveColor = new Color3(0.5, 0.5, 0.5)
      mat.specularColor = new Color3(0, 0, 0)
      sphere.material = mat
      abstractNodeSpheres.push(sphere)
    }

    // Edges
    for (const [a, b] of hpaEdges) {
      const ca = hpaClusters[a], cb = hpaClusters[b]
      if (!ca.abstractNode || !cb.abstractNode) continue
      const points = [
        new Vector3(ca.abstractNode.x * CELL_SIZE + CELL_SIZE / 2, 0.45, ca.abstractNode.y * CELL_SIZE + CELL_SIZE / 2),
        new Vector3(cb.abstractNode.x * CELL_SIZE + CELL_SIZE / 2, 0.45, cb.abstractNode.y * CELL_SIZE + CELL_SIZE / 2),
      ]
      const lines = MeshBuilder.CreateLines('absEdge', { points, colors: [new Color4(1,1,1,0.4), new Color4(1,1,1,0.4)] }, scene)
      lines.color = new Color3(1, 1, 1)
      lines.alpha = 0.4
      abstractEdgeLines.push(lines)
    }
  }

  // Cluster grid lines (always shown in hierarchy mode)
  const clusterGridX = Math.ceil(GRID_W / GRID_SIZE)
  const clusterGridY = Math.ceil(GRID_H / GRID_SIZE)
  for (let cy = 0; cy <= clusterGridY; cy++) {
    const y = Math.min(cy * GRID_SIZE, GRID_H) * CELL_SIZE
    const points = [new Vector3(0, 0.02, y), new Vector3(GRID_W * CELL_SIZE, 0.02, y)]
    const line = MeshBuilder.CreateLines('cline', { points }, scene)
    line.color = new Color3(0.2, 0.4, 0.8)
    line.alpha = 0.7
    clusterFrameLines.push(line)
  }
  for (let cx = 0; cx <= clusterGridX; cx++) {
    const x = Math.min(cx * GRID_SIZE, GRID_W) * CELL_SIZE
    const points = [new Vector3(x, 0.02, 0), new Vector3(x, 0.02, GRID_H * CELL_SIZE)]
    const line = MeshBuilder.CreateLines('cline', { points }, scene)
    line.color = new Color3(0.2, 0.4, 0.8)
    line.alpha = 0.7
    clusterFrameLines.push(line)
  }
}

// ---------------------------------------------------------------------------
// Update Everything
// ---------------------------------------------------------------------------

function updateAll(): void {
  resetGridState()

  // Run A*
  const aResult = runAStar(startX, startY, targetX, targetY)
  aStarPath = aResult.path
  aStarExplored = aResult.explored
  aStarTime = aResult.time

  // Run HPA*
  const hResult = runHpaStar(startX, startY, targetX, targetY)
  hpaPath = hResult.path
  hpaExplored = hResult.explored
  hpaTime = hResult.time

  // Compute domains
  domains = computeDomains()

  // Update 3D scene
  clearMarkers()
  // A* path spheres: show in 'a' and 'both' modes
  if (vizMode === 'a' || vizMode === 'both') {
    buildPathSpheres(aStarPath)
  }
  // HPA* path spheres: show in 'hpa' and 'both' modes (cyan/teal for visual distinction)
  if (vizMode === 'hpa' || vizMode === 'both') {
    buildHpaPathSpheresFunc(hpaPath)
  }
  buildObstacleMarkers()
  if (vizMode === 'hierarchy' || vizMode === 'hpa' || vizMode === 'both') {
    buildHpaVisualization()
  }
  createOrUpdateMarker(startMarker, startX, startY, new Color3(0.2, 0.8, 0.2), 0.8, 0.6)
  createOrUpdateMarker(targetMarker, targetX, targetY, new Color3(0.9, 0.2, 0.2), 0.8, 0.6)

  updateGridTexture()
  updateStatsPanel()
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function updateStatsPanel(): void {
  document.getElementById('stat-path-len')!.textContent = String(aStarPath.length)
  document.getElementById('stat-a-explored')!.textContent = String(aStarExplored.size)
  document.getElementById('stat-a-time')!.textContent = aStarTime.toFixed(2) + ' ms'
  document.getElementById('stat-hpa-nodes')!.textContent = String(hpaClusters.filter(c => c.abstractNode).length)
  document.getElementById('stat-hpa-edges')!.textContent = String(hpaEdges.length)
  document.getElementById('stat-hpa-explored')!.textContent = String(hpaExplored.size)
  document.getElementById('stat-hpa-time')!.textContent = hpaTime.toFixed(2) + ' ms'
  const reduction = aStarExplored.size > 0
    ? ((1 - hpaExplored.size / aStarExplored.size) * 100).toFixed(0) + '%'
    : 'N/A'
  const redEl = document.getElementById('stat-reduction')!
  redEl.textContent = reduction
  redEl.className = 'value ' + (parseFloat(reduction) > 0 ? 'good' : 'warn')
  const domainCount = new Set(domains.values()).size
  document.getElementById('stat-domains')!.textContent = String(domainCount)
}

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Click to toggle obstacles
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  if (!e.ctrlKey && !e.metaKey) return
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (pickResult?.pickedPoint) {
    const px = pickResult.pickedPoint.x
    const pz = pickResult.pickedPoint.z
    const gx = Math.floor(px / CELL_SIZE)
    const gy = Math.floor(pz / CELL_SIZE)
    if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H) {
      setObstacle(gx, gy, grid[gy][gx].walkable)
      updateAll()
    }
  }
})

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

const vizButtons = ['btn-viz-a', 'btn-viz-hpa', 'btn-viz-both', 'btn-viz-domains', 'btn-viz-hierarchy'] as const
const vizModes: Record<string, VizMode> = {
  'btn-viz-a': 'a',
  'btn-viz-hpa': 'hpa',
  'btn-viz-both': 'both',
  'btn-viz-domains': 'domains',
  'btn-viz-hierarchy': 'hierarchy',
}

for (const bid of vizButtons) {
  document.getElementById(bid)!.addEventListener('click', () => {
    vizMode = vizModes[bid]
    for (const b of vizButtons) document.getElementById(b)!.classList.toggle('active', b === bid)
    clearMarkers()
    if (vizMode === 'hierarchy' || vizMode === 'hpa' || vizMode === 'both') buildHpaVisualization()
    if (vizMode === 'a' || vizMode === 'both') buildPathSpheres(aStarPath)
    if (vizMode === 'hpa' || vizMode === 'both') buildHpaPathSpheresFunc(hpaPath)
    buildObstacleMarkers()
    updateGridTexture()
  })
}

document.getElementById('btn-clear-obstacles')!.addEventListener('click', () => {
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++)
      grid[y][x].walkable = true
  updateAll()
})

document.getElementById('btn-random-obstacles')!.addEventListener('click', () => {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if ((x === startX && y === startY) || (x === targetX && y === targetY)) continue
      grid[y][x].walkable = Math.random() > 0.3
    }
  }
  // Ensure start/target are walkable
  grid[startY][startX].walkable = true
  grid[targetY][targetX].walkable = true
  updateAll()
})

document.getElementById('btn-reset-cam')!.addEventListener('click', () => {
  camera.alpha = -Math.PI / 4
  camera.beta = Math.PI / 3
  camera.radius = 28
  camera.target = new Vector3(GRID_W / 2, 0, GRID_H / 2)
})

document.getElementById('btn-run')!.addEventListener('click', () => {
  startX = parseInt((document.getElementById('slider-start-x') as HTMLInputElement).value)
  startY = parseInt((document.getElementById('slider-start-y') as HTMLInputElement).value)
  targetX = parseInt((document.getElementById('slider-target-x') as HTMLInputElement).value)
  targetY = parseInt((document.getElementById('slider-target-y') as HTMLInputElement).value)
  updateAll()
})

// Slider value displays
for (const id of ['slider-start-x', 'slider-start-y', 'slider-target-x', 'slider-target-y']) {
  document.getElementById(id)!.addEventListener('input', () => {
    const val = (document.getElementById(id) as HTMLInputElement).value
    const displayId = 'val-' + id.replace('slider-', '')
    const el = document.getElementById(displayId)
    if (el) el.textContent = val
  })
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case '1': vizMode = 'a'; updateVizButtonStates(); break
    case '2': vizMode = 'hpa'; updateVizButtonStates(); break
    case '3': vizMode = 'both'; updateVizButtonStates(); break
    case '4': vizMode = 'domains'; updateVizButtonStates(); break
    case '5': vizMode = 'hierarchy'; updateVizButtonStates(); break
    case 'r':
      document.getElementById('btn-run')!.click()
      break
    case 'c':
      if (!e.ctrlKey && !e.metaKey) {
        document.getElementById('btn-clear-obstacles')!.click()
      }
      break
  }
  if (['1','2','3','4','5'].includes(e.key.toLowerCase())) {
    clearMarkers()
    if (vizMode === 'hierarchy' || vizMode === 'hpa' || vizMode === 'both') buildHpaVisualization()
    if (vizMode === 'a' || vizMode === 'both') buildPathSpheres(aStarPath)
    if (vizMode === 'hpa' || vizMode === 'both') buildHpaPathSpheresFunc(hpaPath)
    buildObstacleMarkers()
    updateGridTexture()
  }
})

function updateVizButtonStates(): void {
  for (const b of vizButtons) {
    document.getElementById(b)!.classList.toggle('active', vizModes[b] === vizMode)
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initGrid()
updateAll()

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness
;(window as any).__testHarness = {
  scene, camera, engine,
  getGrid: () => grid,
  getAStarPath: () => aStarPath,
  getHpaPath: () => hpaPath,
  getAStarExplored: () => aStarExplored.size,
  getHpaExplored: () => hpaExplored.size,
  getDomains: () => domains,
  runUpdate: updateAll,
  getVizMode: () => vizMode,
  setStart: (x: number, y: number) => { startX = x; startY = y; updateAll() },
  setTarget: (x: number, y: number) => { targetX = x; targetY = y; updateAll() },
  toggleObstacle: (x: number, y: number) => { setObstacle(x, y, grid[y]?.[x]?.walkable ?? true); updateAll() },
}
