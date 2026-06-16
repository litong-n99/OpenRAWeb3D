/**
 * main.ts -- 地面单位移动活动人工验收测试
 *
 * 测试目标:
 *   1. 验证 Move 活动 (Move.ts) 的核心行为: 路径跟随、逐格移动、转向
 *   2. 验证 MovePart (MoveFirstHalf / MoveSecondHalf) 的两段式移动
 *   3. 验证 WAngle 朝向系统 (0 = 北, 逆时针递增) 在 3D 场景中的正确映射
 *   4. 验证障碍物绕行和路径重新计算
 *   5. 验证移动速度、进度 carryover 的连续性
 *
 * OpenRA 对照: OpenRA.Mods.Common/Activities/Move/Move.cs
 *   - MoveFirstHalf: fromCell -> betweenCells
 *   - MoveSecondHalf: betweenCells -> toCell center
 *   - WAngle facing: 0 = North (负 Z 方向), 256 = West, 512 = South, 768 = East
 *
 * 本测试使用纯 Babylon.js 模拟移动行为，不依赖实际迁移代码。
 * 所有坐标系约定严格遵循 OpenRA WAngle 规范。
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, LinesMesh, TransformNode,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid Configuration
// ---------------------------------------------------------------------------

const GRID_W = 20
const GRID_H = 20
const CELL_SIZE = 1.0

// ---------------------------------------------------------------------------
// WAngle Constants (OpenRA convention)
//   0 = North (负 Z), 256 = West (负 X), 512 = South (正 Z), 768 = East (正 X)
//   Full circle = 1024 units = 360 degrees
// ---------------------------------------------------------------------------

const WANGLE_NORTH = 0      // -Z direction
const WANGLE_WEST = 256     // -X direction
const WANGLE_SOUTH = 512    // +Z direction
const WANGLE_EAST = 768     // +X direction
const WANGLE_FULL = 1024

/** Convert WAngle to Babylon.js rotation.y (radians, clockwise from +X).
 *  OpenRA WAngle 0 = North (-Z). Babylon rotation.y = 0 faces +Z.
 *  Mapping: WAngle 0 (North/-Z) -> rotation.y = PI (face -Z)
 *           WAngle 256 (West/-X) -> rotation.y = PI/2
 *           WAngle 512 (South/+Z) -> rotation.y = 0
 *           WAngle 768 (East/+X) -> rotation.y = -PI/2 (or 3PI/2)
 */
function wAngleToRotationY(wangle: number): number {
  // WAngle 0 = North (-Z). In Babylon, rotation.y=0 faces +Z.
  // So we need: wangle=0 -> PI, wangle=256 -> PI/2, wangle=512 -> 0, wangle=768 -> -PI/2
  // Formula: PI - (wangle / 1024) * 2 * PI = PI * (1 - wangle / 512)
  return Math.PI * (1 - wangle / 512)
}

/** Convert a cell direction (dx, dy) to WAngle.
 *  Returns WANGLE_NORTH for invalid directions (not a cardinal/diagonal). */
function directionToWAngle(dx: number, dy: number): number {
  // OpenRA: 0 = North (-Y in grid coords, which is -Z in 3D)
  // Grid: Y increases downward (South). So dy=-1 is North, dy=1 is South.
  if (dx === 0 && dy === -1) return WANGLE_NORTH
  if (dx === 0 && dy === 1) return WANGLE_SOUTH
  if (dx === -1 && dy === 0) return WANGLE_WEST
  if (dx === 1 && dy === 0) return WANGLE_EAST
  if (dx === -1 && dy === -1) return 128   // NW
  if (dx === 1 && dy === -1) return 896    // NE
  if (dx === -1 && dy === 1) return 384    // SW
  if (dx === 1 && dy === 1) return 640     // SE
  return WANGLE_NORTH
}

// ---------------------------------------------------------------------------
// Grid State
// ---------------------------------------------------------------------------

interface Cell {
  x: number
  y: number
  walkable: boolean
}

const grid: Cell[][] = []

function initGrid(): void {
  grid.length = 0
  for (let y = 0; y < GRID_H; y++) {
    const row: Cell[] = []
    for (let x = 0; x < GRID_W; x++) {
      row.push({ x, y, walkable: true })
    }
    grid.push(row)
  }
}

function isWalkable(x: number, y: number): boolean {
  if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return false
  return grid[y][x].walkable
}

// ---------------------------------------------------------------------------
// A* Pathfinding (for move target)
// ---------------------------------------------------------------------------

const DIRS_8 = [
  { dx: 0, dy: -1, cost: 1 }, { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 }, { dx: -1, dy: 0, cost: 1 },
  { dx: 1, dy: -1, cost: 1.414 }, { dx: 1, dy: 1, cost: 1.414 },
  { dx: -1, dy: 1, cost: 1.414 }, { dx: -1, dy: -1, cost: 1.414 },
]

interface AStarNode {
  x: number; y: number; g: number; h: number; f: number
  parent: AStarNode | null; closed: boolean; open: boolean
}

function heuristic(x1: number, y1: number, x2: number, y2: number): number {
  const dx = Math.abs(x1 - x2)
  const dy = Math.abs(y1 - y2)
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)
}

function findPath(sx: number, sy: number, tx: number, ty: number): { x: number; y: number }[] {
  if (sx === tx && sy === ty) return []
  if (!isWalkable(tx, ty)) return []

  const nodes: AStarNode[][] = []
  for (let y = 0; y < GRID_H; y++) {
    const row: AStarNode[] = []
    for (let x = 0; x < GRID_W; x++) {
      row.push({ x, y, g: 0, h: 0, f: 0, parent: null, closed: false, open: false })
    }
    nodes.push(row)
  }

  const openList: AStarNode[] = []
  const start = nodes[sy][sx]
  start.g = 0
  start.h = heuristic(sx, sy, tx, ty)
  start.f = start.h
  start.open = true
  openList.push(start)

  let found = false
  const target = nodes[ty][tx]

  while (openList.length > 0) {
    let bestIdx = 0
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[bestIdx].f ||
          (openList[i].f === openList[bestIdx].f && openList[i].h < openList[bestIdx].h)) {
        bestIdx = i
      }
    }
    const current = openList[bestIdx]
    openList.splice(bestIdx, 1)

    if (current === target) { found = true; break }

    current.closed = true
    current.open = false

    for (const d of DIRS_8) {
      const nx = current.x + d.dx
      const ny = current.y + d.dy
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue
      if (!grid[ny][nx].walkable) continue
      if (d.dx !== 0 && d.dy !== 0) {
        if (!grid[current.y][nx].walkable || !grid[ny][current.x].walkable) continue
      }

      const neighbor = nodes[ny][nx]
      if (neighbor.closed) continue

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

  const path: { x: number; y: number }[] = []
  if (found) {
    let cur: AStarNode | null = target
    while (cur) {
      path.unshift({ x: cur.x, y: cur.y })
      cur = cur.parent
    }
  }
  return path
}

// ---------------------------------------------------------------------------
// Unit State (simulates Mobile trait + Move activity)
// ---------------------------------------------------------------------------

interface UnitState {
  // Cell position
  cellX: number
  cellY: number
  // Visual position (world coordinates)
  posX: number
  posZ: number
  // Facing (WAngle, 0-1023)
  facing: number
  // Target facing during turn
  targetFacing: number
  // Movement state
  isMoving: boolean
  path: { x: number; y: number }[]
  pathIndex: number
  // MovePart state: 'idle' | 'turning' | 'firstHalf' | 'secondHalf'
  movePhase: 'idle' | 'turning' | 'firstHalf' | 'secondHalf'
  // Progress within current move part (0 to distance)
  progress: number
  // Carryover progress from previous move
  carryover: number
  // Speed: world units per tick (at 60fps, 1x speed = ~2 cells/sec)
  // Each cell is 1.0 world unit, so 0.033 * 60 = ~2.0 cells/sec
  speed: number
  // Turn speed: WAngle per tick
  turnSpeed: number
  // For firstHalf: fromPos and toPos
  fromPos: { x: number; z: number }
  toPos: { x: number; z: number }
  fromFacing: number
  toFacing: number
  // Total distance of current move part
  distance: number
}

let unit: UnitState = {
  cellX: 2, cellY: 10,
  posX: 2.5, posZ: 10.5,
  facing: WANGLE_NORTH,
  targetFacing: WANGLE_NORTH,
  isMoving: false,
  path: [],
  pathIndex: 0,
  movePhase: 'idle',
  progress: 0,
  carryover: 0,
  speed: 0.033, // ~2.0 cells/sec at 60fps (1 cell = 1.0 world unit)
  turnSpeed: 4, // ~240 WAngle/sec at 60fps = ~84 deg/sec
  fromPos: { x: 0, z: 0 },
  toPos: { x: 0, z: 0 },
  fromFacing: 0,
  toFacing: 0,
  distance: 0,
}

let targetCell: { x: number; y: number } | null = null
let isPaused = false
let speedMultiplier = 1.0

// ---------------------------------------------------------------------------
// 3D Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, antialias: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.2, 28, new Vector3(GRID_W / 2, 0, GRID_H / 2), scene)
camera.attachControl(canvas, true)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 50
camera.panningSensibility = 300

new HemisphericLight('hemi', new Vector3(0.3, 1, 0.3), scene)

// Ground
const groundMat = new StandardMaterial('ground', scene)
groundMat.diffuseColor = new Color3(0.12, 0.15, 0.20)
groundMat.specularColor = new Color3(0, 0, 0)
const ground = MeshBuilder.CreateGround('ground', { width: GRID_W * CELL_SIZE, height: GRID_H * CELL_SIZE }, scene)
ground.position = new Vector3(GRID_W / 2 * CELL_SIZE, -0.05, GRID_H / 2 * CELL_SIZE)
ground.material = groundMat

// Grid texture setup - uses RawTexture for cell coloring
const gridTexCanvas = document.createElement('canvas')
gridTexCanvas.width = GRID_W * 16
gridTexCanvas.height = GRID_H * 16
const gridTexCtx = gridTexCanvas.getContext('2d')!

// Import RawTexture and Texture from Babylon.js
const { RawTexture, Texture } = await import('@babylonjs/core')
const gridTexture = new RawTexture(
  new Uint8Array(gridTexCanvas.width * gridTexCanvas.height * 4),
  gridTexCanvas.width, gridTexCanvas.height,
  5, scene, false, false, Texture.NEAREST_NEAREST
)
gridTexture.wrapU = Texture.CLAMP_ADDRESSMODE
gridTexture.wrapV = Texture.CLAMP_ADDRESSMODE

const overlayMat = new StandardMaterial('overlay', scene)
overlayMat.diffuseTexture = gridTexture
overlayMat.diffuseTexture!.hasAlpha = true
overlayMat.useAlphaFromDiffuseTexture = true
overlayMat.specularColor = new Color3(0, 0, 0)
overlayMat.backFaceCulling = false

const overlayPlane = MeshBuilder.CreateGround('overlayPlane', {
  width: GRID_W * CELL_SIZE, height: GRID_H * CELL_SIZE,
}, scene)
overlayPlane.position = new Vector3(GRID_W / 2 * CELL_SIZE, 0.01, GRID_H / 2 * CELL_SIZE)
overlayPlane.material = overlayMat

// Unit mesh (blue box with arrow indicator)
const unitNode = new TransformNode('unit', scene)
const unitBody = MeshBuilder.CreateBox('unitBody', { width: 0.6, height: 0.3, depth: 0.6 }, scene)
unitBody.parent = unitNode
unitBody.position.y = 0.15
const unitMat = new StandardMaterial('unitMat', scene)
unitMat.diffuseColor = new Color3(0.20, 0.60, 0.95)
unitMat.emissiveColor = new Color3(0.10, 0.30, 0.50)
unitMat.specularColor = new Color3(0, 0, 0)
unitBody.material = unitMat

// Arrow indicator (white triangle showing facing)
const arrowMesh = MeshBuilder.CreateCylinder('arrow', {
  diameterTop: 0, diameterBottom: 0.25, height: 0.4, tessellation: 3,
}, scene)
arrowMesh.parent = unitNode
arrowMesh.position.y = 0.45
arrowMesh.rotation.z = Math.PI / 2
const arrowMat = new StandardMaterial('arrowMat', scene)
arrowMat.diffuseColor = new Color3(1, 1, 1)
arrowMat.emissiveColor = new Color3(0.8, 0.8, 0.8)
arrowMat.specularColor = new Color3(0, 0, 0)
arrowMesh.material = arrowMat

// Path line
let pathLineMesh: LinesMesh | null = null

// Target marker
let targetMarkerMesh: Mesh | null = null

// Start marker
const startMarker = MeshBuilder.CreateSphere('startMarker', { diameter: 0.4 }, scene)
startMarker.position = new Vector3(unit.cellX * CELL_SIZE + CELL_SIZE / 2, 0.3, unit.cellY * CELL_SIZE + CELL_SIZE / 2)
const startMat = new StandardMaterial('startMat', scene)
startMat.diffuseColor = new Color3(0.2, 0.8, 0.2)
startMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
startMat.specularColor = new Color3(0, 0, 0)
startMarker.material = startMat

// Obstacle boxes
const obstacleMeshes: Mesh[] = []

// ---------------------------------------------------------------------------
// Grid Texture Update
// ---------------------------------------------------------------------------

function updateGridTexture(): void {
  const imgData = gridTexCtx.createImageData(gridTexCanvas.width, gridTexCanvas.height)
  const data = imgData.data
  const pw = gridTexCanvas.width / GRID_W
  const ph = gridTexCanvas.height / GRID_H

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      let r = 0.18, g = 0.22, b = 0.28, a = 1

      // Obstacle
      if (!grid[gy][gx].walkable) {
        r = 0.15; g = 0.15; b = 0.15; a = 1
      }
      // Path highlight
      else if (unit.path.some(p => p.x === gx && p.y === gy)) {
        r = 0.95; g = 0.75; b = 0.0; a = 0.7
      }
      // Target cell
      else if (targetCell && targetCell.x === gx && targetCell.y === gy) {
        r = 0.9; g = 0.2; b = 0.2; a = 0.6
      }
      // Start cell
      else if (unit.cellX === gx && unit.cellY === gy && !unit.isMoving) {
        r = 0.2; g = 0.7; b = 0.2; a = 0.5
      }

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

  // Grid lines — draw directly into pixel data to avoid second getImageData
  const gridColor = Math.floor(0.06 * 255)
  for (let gx = 1; gx < GRID_W; gx++) {
    const x = Math.floor(gx * pw)
    for (let y = 0; y < gridTexCanvas.height; y++) {
      const idx = (y * gridTexCanvas.width + x) * 4
      if (idx + 3 < data.length) {
        data[idx] = Math.min(255, data[idx] + gridColor)
        data[idx + 1] = Math.min(255, data[idx + 1] + gridColor)
        data[idx + 2] = Math.min(255, data[idx + 2] + gridColor)
      }
    }
  }
  for (let gy = 1; gy < GRID_H; gy++) {
    const y = Math.floor(gy * ph)
    for (let x = 0; x < gridTexCanvas.width; x++) {
      const idx = (y * gridTexCanvas.width + x) * 4
      if (idx + 3 < data.length) {
        data[idx] = Math.min(255, data[idx] + gridColor)
        data[idx + 1] = Math.min(255, data[idx + 1] + gridColor)
        data[idx + 2] = Math.min(255, data[idx + 2] + gridColor)
      }
    }
  }

  gridTexture.update(data)
}

// ---------------------------------------------------------------------------
// Path Line Visualization
// ---------------------------------------------------------------------------

function updatePathLine(): void {
  if (pathLineMesh) {
    pathLineMesh.dispose()
    pathLineMesh = null
  }

  if (unit.path.length < 2) return

  const points: Vector3[] = []
  for (const p of unit.path) {
    points.push(new Vector3(p.x * CELL_SIZE + CELL_SIZE / 2, 0.05, p.y * CELL_SIZE + CELL_SIZE / 2))
  }

  pathLineMesh = MeshBuilder.CreateLines('pathLine', { points }, scene)
  pathLineMesh.color = new Color3(1, 0.85, 0)
}

// ---------------------------------------------------------------------------
// Target Marker
// ---------------------------------------------------------------------------

function updateTargetMarker(): void {
  if (targetMarkerMesh) {
    targetMarkerMesh.dispose()
    targetMarkerMesh = null
  }

  if (!targetCell) return

  targetMarkerMesh = MeshBuilder.CreateSphere('targetMarker', { diameter: 0.5 }, scene)
  targetMarkerMesh.position = new Vector3(
    targetCell.x * CELL_SIZE + CELL_SIZE / 2, 0.3, targetCell.y * CELL_SIZE + CELL_SIZE / 2
  )
  const mat = new StandardMaterial('targetMat', scene)
  mat.diffuseColor = new Color3(0.9, 0.2, 0.2)
  mat.emissiveColor = new Color3(0.5, 0.1, 0.1)
  mat.specularColor = new Color3(0, 0, 0)
  targetMarkerMesh.material = mat
}

// ---------------------------------------------------------------------------
// Obstacle Visualization
// ---------------------------------------------------------------------------

function updateObstacles(): void {
  for (const m of obstacleMeshes) m.dispose()
  obstacleMeshes.length = 0

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!grid[y][x].walkable) {
        const box = MeshBuilder.CreateBox('obs', { width: 0.9, height: 0.4, depth: 0.9 }, scene)
        box.position = new Vector3(x * CELL_SIZE + CELL_SIZE / 2, 0.2, y * CELL_SIZE + CELL_SIZE / 2)
        const mat = new StandardMaterial('obsMat', scene)
        mat.diffuseColor = new Color3(0.3, 0.3, 0.3)
        mat.specularColor = new Color3(0, 0, 0)
        box.material = mat
        obstacleMeshes.push(box)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Movement Logic (simulates Move.ts + MoveFirstHalf + MoveSecondHalf)
// ---------------------------------------------------------------------------

/** Cell center in world coordinates */
function cellCenter(x: number, y: number): { x: number; z: number } {
  return { x: x * CELL_SIZE + CELL_SIZE / 2, z: y * CELL_SIZE + CELL_SIZE / 2 }
}

/** Calculate between-cell position (lerp between two cell centers at t=0.5) */
function betweenCells(fromX: number, fromY: number, toX: number, toY: number): { x: number; z: number } {
  const from = cellCenter(fromX, fromY)
  const to = cellCenter(toX, toY)
  return { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 }
}

/** Shortest angular difference in WAngle space */
function wAngleDiff(from: number, to: number): number {
  let diff = ((to - from + WANGLE_FULL) % WANGLE_FULL)
  if (diff > WANGLE_FULL / 2) diff -= WANGLE_FULL
  return diff
}

/** Start movement to a target cell */
function startMovement(targetX: number, targetY: number): void {
  const path = findPath(unit.cellX, unit.cellY, targetX, targetY)
  if (path.length === 0) {
    // No path available
    targetCell = { x: targetX, y: targetY }
    updateGridTexture()
    updateTargetMarker()
    return
  }

  unit.path = path
  unit.pathIndex = 1 // Start from the first step after current cell
  unit.isMoving = true
  unit.movePhase = 'idle'
  unit.progress = 0
  unit.carryover = 0
  targetCell = { x: targetX, y: targetY }

  updatePathLine()
  updateGridTexture()
  updateTargetMarker()
}

/** Tick the movement system (called every frame) */
function tickMovement(): void {
  if (!unit.isMoving || isPaused) return

  const speed = unit.speed * speedMultiplier

  switch (unit.movePhase) {
    case 'idle': {
      // Check if we have more path to follow
      if (unit.pathIndex >= unit.path.length) {
        // Reached destination
        unit.isMoving = false
        unit.movePhase = 'idle'
        unit.path = []
        updatePathLine()
        updateGridTexture()
        return
      }

      const nextCell = unit.path[unit.pathIndex]
      const nextFacing = directionToWAngle(nextCell.x - unit.cellX, nextCell.y - unit.cellY)
      const facingDiff = Math.abs(wAngleDiff(unit.facing, nextFacing))

      // If we need to turn significantly, turn first
      if (facingDiff > 8) { // Small threshold to avoid micro-turns
        unit.movePhase = 'turning'
        unit.targetFacing = nextFacing
        unit.fromFacing = unit.facing
      } else {
        // Start MoveFirstHalf
        unit.movePhase = 'firstHalf'
        unit.fromPos = cellCenter(unit.cellX, unit.cellY)
        unit.toPos = betweenCells(unit.cellX, unit.cellY, nextCell.x, nextCell.y)
        unit.fromFacing = unit.facing
        unit.toFacing = nextFacing
        unit.distance = Math.sqrt(
          (unit.toPos.x - unit.fromPos.x) ** 2 +
          (unit.toPos.z - unit.fromPos.z) ** 2
        )
        unit.progress = unit.carryover
        unit.carryover = 0
      }
      break
    }

    case 'turning': {
      const diff = wAngleDiff(unit.facing, unit.targetFacing)
      const turnAmount = Math.min(Math.abs(diff), unit.turnSpeed * speedMultiplier)
      const direction = diff >= 0 ? 1 : -1
      unit.facing = ((unit.facing + turnAmount * direction + WANGLE_FULL) % WANGLE_FULL)

      if (Math.abs(wAngleDiff(unit.facing, unit.targetFacing)) <= unit.turnSpeed * speedMultiplier) {
        unit.facing = unit.targetFacing
        unit.movePhase = 'idle' // Will transition to firstHalf on next tick
      }
      break
    }

    case 'firstHalf': {
      unit.progress += speed

      if (unit.progress >= unit.distance) {
        // MoveFirstHalf complete - transition to MoveSecondHalf
        const nextCell = unit.path[unit.pathIndex]
        unit.movePhase = 'secondHalf'
        unit.fromPos = unit.toPos
        unit.toPos = cellCenter(nextCell.x, nextCell.y)
        unit.fromFacing = unit.facing
        unit.toFacing = unit.toFacing
        unit.distance = Math.sqrt(
          (unit.toPos.x - unit.fromPos.x) ** 2 +
          (unit.toPos.z - unit.fromPos.z) ** 2
        )
        unit.progress = unit.progress - unit.distance
        // enteringCell callback would fire here
      } else {
        // Interpolate position
        const t = unit.distance > 0 ? unit.progress / unit.distance : 1
        unit.posX = unit.fromPos.x + (unit.toPos.x - unit.fromPos.x) * t
        unit.posZ = unit.fromPos.z + (unit.toPos.z - unit.fromPos.z) * t

        // Turn while moving
        const turnDiff = wAngleDiff(unit.facing, unit.toFacing)
        const turnAmount = Math.min(Math.abs(turnDiff), unit.turnSpeed * speedMultiplier)
        const direction = turnDiff >= 0 ? 1 : -1
        unit.facing = ((unit.facing + turnAmount * direction + WANGLE_FULL) % WANGLE_FULL)
      }
      break
    }

    case 'secondHalf': {
      unit.progress += speed

      if (unit.progress >= unit.distance) {
        // MoveSecondHalf complete
        const nextCell = unit.path[unit.pathIndex]
        unit.cellX = nextCell.x
        unit.cellY = nextCell.y
        unit.posX = unit.toPos.x
        unit.posZ = unit.toPos.z
        unit.facing = unit.toFacing
        unit.carryover = unit.progress - unit.distance
        unit.pathIndex++
        unit.movePhase = 'idle'
        // finishedMoving callback would fire here
      } else {
        const t = unit.distance > 0 ? unit.progress / unit.distance : 1
        unit.posX = unit.fromPos.x + (unit.toPos.x - unit.fromPos.x) * t
        unit.posZ = unit.fromPos.z + (unit.toPos.z - unit.fromPos.z) * t

        // Turn while moving
        const turnDiff = wAngleDiff(unit.facing, unit.toFacing)
        const turnAmount = Math.min(Math.abs(turnDiff), unit.turnSpeed * speedMultiplier)
        const direction = turnDiff >= 0 ? 1 : -1
        unit.facing = ((unit.facing + turnAmount * direction + WANGLE_FULL) % WANGLE_FULL)
      }
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Update Unit Visuals
// ---------------------------------------------------------------------------

function updateUnitVisuals(): void {
  unitNode.position.x = unit.posX
  unitNode.position.z = unit.posZ
  unitNode.rotation.y = wAngleToRotationY(unit.facing)
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function updateStatsPanel(): void {
  const stateEl = document.getElementById('stat-state')!
  const cellEl = document.getElementById('stat-cell')!
  const targetEl = document.getElementById('stat-target')!
  const pathLenEl = document.getElementById('stat-path-len')!
  const facingEl = document.getElementById('stat-facing')!
  const progressEl = document.getElementById('stat-progress')!

  const phaseNames: Record<string, string> = {
    idle: unit.isMoving ? '等待' : '空闲',
    turning: '转向中',
    firstHalf: '移动前半段',
    secondHalf: '移动后半段',
  }
  stateEl.textContent = phaseNames[unit.movePhase] || unit.movePhase

  cellEl.textContent = `(${unit.cellX}, ${unit.cellY})`
  targetEl.textContent = targetCell ? `(${targetCell.x}, ${targetCell.y})` : '-'
  pathLenEl.textContent = unit.isMoving ? `${unit.path.length - unit.pathIndex} 格剩余` : '-'
  facingEl.textContent = `${unit.facing} (${Math.round(unit.facing * 360 / 1024)}°)`

  if (unit.movePhase === 'firstHalf' || unit.movePhase === 'secondHalf') {
    const pct = unit.distance > 0 ? Math.round((unit.progress / unit.distance) * 100) : 0
    progressEl.textContent = `${pct}%`
  } else {
    progressEl.textContent = '-'
  }
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
// Scene Presets
// ---------------------------------------------------------------------------

function clearObstacles(): void {
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      grid[y][x].walkable = true
    }
  }
}

function setMaze(): void {
  clearObstacles()
  // Simple maze pattern
  for (let x = 3; x < GRID_W - 3; x += 4) {
    for (let y = 0; y < GRID_H; y++) {
      if (y % 8 !== 0 && y % 8 !== 1) {
        grid[y][x].walkable = false
      }
    }
  }
  for (let y = 3; y < GRID_H - 3; y += 4) {
    for (let x = 0; x < GRID_W; x++) {
      if (x % 8 !== 4 && x % 8 !== 5) {
        grid[y][x].walkable = false
      }
    }
  }
  // Ensure start and some target areas are clear
  grid[unit.cellY][unit.cellX].walkable = true
  grid[unit.cellY][unit.cellX + 1].walkable = true
  grid[unit.cellY + 1][unit.cellX].walkable = true
}

function setRandomObstacles(): void {
  clearObstacles()
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (x === unit.cellX && y === unit.cellY) continue
      grid[y][x].walkable = Math.random() > 0.25
    }
  }
}

// ---------------------------------------------------------------------------
// Click Handling
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  if (e.ctrlKey || e.metaKey) {
    // Toggle obstacle
    const pickResult = scene.pick(e.offsetX, e.offsetY)
    if (pickResult?.pickedPoint) {
      const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
      const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
      if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H) {
        if (gx !== unit.cellX || gy !== unit.cellY) {
          grid[gy][gx].walkable = !grid[gy][gx].walkable
          updateObstacles()
          updateGridTexture()
        }
      }
    }
    return
  }

  // Set movement target
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (pickResult?.pickedPoint) {
    const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
    const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
    if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H) {
      if (grid[gy][gx].walkable) {
        startMovement(gx, gy)
      }
    }
  }
})

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

document.getElementById('btn-pause')!.addEventListener('click', () => {
  isPaused = true
  document.getElementById('btn-pause')!.classList.add('active')
  document.getElementById('btn-resume')!.classList.remove('active')
})

document.getElementById('btn-resume')!.addEventListener('click', () => {
  isPaused = false
  document.getElementById('btn-pause')!.classList.remove('active')
  document.getElementById('btn-resume')!.classList.add('active')
})

for (const [id, mult] of [['btn-speed-1x', 1.0], ['btn-speed-2x', 2.0], ['btn-speed-4x', 4.0]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    speedMultiplier = mult
    for (const b of ['btn-speed-1x', 'btn-speed-2x', 'btn-speed-4x']) {
      document.getElementById(b)!.classList.toggle('active', b === id)
    }
  })
}

document.getElementById('btn-reset-unit')!.addEventListener('click', () => {
  unit.cellX = 2
  unit.cellY = 10
  unit.posX = 2.5
  unit.posZ = 10.5
  unit.facing = WANGLE_NORTH
  unit.isMoving = false
  unit.path = []
  unit.movePhase = 'idle'
  targetCell = null
  startMarker.position = new Vector3(unit.cellX * CELL_SIZE + CELL_SIZE / 2, 0.3, unit.cellY * CELL_SIZE + CELL_SIZE / 2)
  updatePathLine()
  updateTargetMarker()
  updateGridTexture()
})

document.getElementById('btn-clear-path')!.addEventListener('click', () => {
  unit.isMoving = false
  unit.path = []
  unit.movePhase = 'idle'
  targetCell = null
  updatePathLine()
  updateTargetMarker()
  updateGridTexture()
})

document.getElementById('btn-scene-empty')!.addEventListener('click', () => {
  clearObstacles()
  updateObstacles()
  updateGridTexture()
})

document.getElementById('btn-scene-maze')!.addEventListener('click', () => {
  setMaze()
  updateObstacles()
  updateGridTexture()
})

document.getElementById('btn-scene-blocks')!.addEventListener('click', () => {
  setRandomObstacles()
  updateObstacles()
  updateGridTexture()
})

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case ' ': {
      e.preventDefault()
      isPaused = !isPaused
      document.getElementById('btn-pause')!.classList.toggle('active', isPaused)
      document.getElementById('btn-resume')!.classList.toggle('active', !isPaused)
      break
    }
    case '1': speedMultiplier = 1.0; break
    case '2': speedMultiplier = 2.0; break
    case '3': speedMultiplier = 4.0; break
    case 'r': {
      document.getElementById('btn-reset-unit')!.click()
      break
    }
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initGrid()
updateObstacles()
updateGridTexture()

engine.runRenderLoop(() => {
  tickMovement()
  updateUnitVisuals()
  updateStatsPanel()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness
;(window as any).__testHarness = {
  scene, camera, engine, unit, grid,
  getPath: () => unit.path,
  isMoving: () => unit.isMoving,
  getFacing: () => unit.facing,
  getCell: () => ({ x: unit.cellX, y: unit.cellY }),
}
