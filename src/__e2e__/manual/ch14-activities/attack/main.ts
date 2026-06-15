/**
 * main.ts -- Attack 攻击活动人工验收测试
 *
 * 测试目标:
 *   1. 验证 Attack 活动的核心行为：射程检测 → 移动进入射程 → 转向面对目标 → 开火
 *   2. 验证 AttackStatus 状态流转：UnableToAttack → NeedsToMove → NeedsToTurn → Attacking
 *   3. 验证 WAngle 朝向系统 (0=北, 逆时针递增) 在攻击转向中的正确映射
 *   4. 验证目标线 (TargetLineNode) 渲染：红色虚线从单位到目标
 *   5. 验证最小射程行为：目标太近时单位后退
 *   6. 验证移动目标追击：目标移动时单位重新计算路径
 *
 * OpenRA 对照:
 *   - OpenRA.Mods.Common/Activities/Attack.cs
 *   - AttackStatus enum: { UnableToAttack=0, NeedsToTurn=1, NeedsToMove=2, Attacking=3 }
 *   - tickAttack() logic: range check → firing arc check → doAttack()
 *   - WAngle.tickFacing() for rotation
 *
 * 本测试使用纯 Babylon.js 模拟 Attack 行为。
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

function cellCenter(x: number, y: number): { x: number; z: number } {
  return { x: x * CELL_SIZE + CELL_SIZE / 2, z: y * CELL_SIZE + CELL_SIZE / 2 }
}

// ---------------------------------------------------------------------------
// WAngle Constants (OpenRA convention)
//   0 = North (负 Z), 256 = West (负 X), 512 = South (正 Z), 768 = East (正 X)
//   Full circle = 1024 units = 360 degrees
// ---------------------------------------------------------------------------

const WANGLE_NORTH = 0
const WANGLE_SOUTH = 512
const WANGLE_FULL = 1024

/** Convert WAngle to Babylon.js rotation.y (radians).
 *  WAngle 0 (North/-Z) -> rotation.y = PI
 *  WAngle 256 (West/-X) -> rotation.y = PI/2
 *  WAngle 512 (South/+Z) -> rotation.y = 0
 *  WAngle 768 (East/+X) -> rotation.y = -PI/2
 */
function wAngleToRotationY(wangle: number): number {
  return Math.PI * (1 - wangle / 512)
}

/** Shortest angular difference in WAngle space */
function wAngleDiff(from: number, to: number): number {
  let diff = ((to - from + WANGLE_FULL) % WANGLE_FULL)
  if (diff > WANGLE_FULL / 2) diff -= WANGLE_FULL
  return diff
}

/** WAngle.tickFacing simulation */
function tickFacing(current: number, desired: number, step: number): number {
  const diff = wAngleDiff(current, desired)
  if (diff === 0) return current
  const absDiff = Math.abs(diff)
  const move = Math.min(absDiff, step)
  const sign = diff >= 0 ? 1 : -1
  return ((current + sign * move) % WANGLE_FULL + WANGLE_FULL) % WANGLE_FULL
}

// ---------------------------------------------------------------------------
// AttackStatus (对应 OpenRA Attack.AttackStatus)
// ---------------------------------------------------------------------------

const AttackStatus = {
  UnableToAttack: 0,
  NeedsToTurn: 1,
  NeedsToMove: 2,
  Attacking: 3,
} as const

const AttackStatusNames: Record<number, string> = {
  [AttackStatus.UnableToAttack]: '无法攻击',
  [AttackStatus.NeedsToTurn]: '需要转向',
  [AttackStatus.NeedsToMove]: '需要移动',
  [AttackStatus.Attacking]: '攻击中',
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLOR_ATTACKER = new Color3(0.20, 0.60, 0.95)   // #3399F2
const COLOR_TARGET = new Color3(0.91, 0.27, 0.38)      // #E94560
const COLOR_TARGET_LINE = new Color3(0.91, 0.27, 0.38) // Red
const COLOR_RANGE_RING = new Color3(1.0, 0.8, 0.0)    // #FFCC00
const COLOR_MIN_RANGE_RING = new Color3(0.8, 0.4, 0.0) // Orange

// ---------------------------------------------------------------------------
// Unit State
// ---------------------------------------------------------------------------

interface AttackerState {
  cellX: number
  cellY: number
  posX: number
  posZ: number
  facing: number          // WAngle
  turnSpeed: number        // WAngle per tick
  attackRange: number     // cells
  minRange: number        // cells (0 = no minimum)
  fireCooldown: number     // ticks between shots
  fireTimer: number       // current cooldown timer
  fireCount: number        // total shots fired
  attackStatus: number     // AttackStatus value
  isMoving: boolean
  moveSpeed: number        // world units per tick
  targetCellX: number
  targetCellY: number
  // Movement state
  movePath: { x: number; y: number }[]
  movePathIndex: number
  moveProgress: number
  moveFrom: { x: number; z: number }
  moveTo: { x: number; z: number }
  moveDistance: number
}

interface TargetState {
  cellX: number
  cellY: number
  posX: number
  posZ: number
  hp: number
  maxHp: number
  isAlive: boolean
  speed: number           // world units per tick (for moving targets)
  patrolPath: { x: number; y: number }[]
  patrolIndex: number
}

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

// Grid lines
for (let i = 0; i <= GRID_W; i++) {
  const line = MeshBuilder.CreateLines(`gridX_${i}`, {
    points: [new Vector3(i * CELL_SIZE, 0.01, 0), new Vector3(i * CELL_SIZE, 0.01, GRID_H * CELL_SIZE)],
  }, scene)
  line.color = new Color3(0.15, 0.2, 0.3)
}
for (let i = 0; i <= GRID_H; i++) {
  const line = MeshBuilder.CreateLines(`gridZ_${i}`, {
    points: [new Vector3(0, 0.01, i * CELL_SIZE), new Vector3(GRID_W * CELL_SIZE, 0.01, i * CELL_SIZE)],
  }, scene)
  line.color = new Color3(0.15, 0.2, 0.3)
}

// ---------------------------------------------------------------------------
// Create Attacker Unit
// ---------------------------------------------------------------------------

let attacker: AttackerState
let attackerNode: TransformNode
let rangeRing: Mesh
let minRangeRing: Mesh

function createAttacker(): void {
  const node = new TransformNode('attacker', scene)
  const center = cellCenter(2, 10)
  node.position.set(center.x, 0, center.z)

  const body = MeshBuilder.CreateBox('attackerBody', { width: 0.6, height: 0.4, depth: 0.6 }, scene)
  body.parent = node
  body.position.y = 0.2
  const mat = new StandardMaterial('attackerMat', scene)
  mat.diffuseColor = COLOR_ATTACKER
  mat.emissiveColor = new Color3(0.1, 0.3, 0.5)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  // Arrow indicator
  const arrow = MeshBuilder.CreateCylinder('arrow', {
    diameterTop: 0, diameterBottom: 0.25, height: 0.4, tessellation: 3,
  }, scene)
  arrow.parent = node
  arrow.position.y = 0.45
  arrow.rotation.z = Math.PI / 2
  const arrowMat = new StandardMaterial('arrowMat', scene)
  arrowMat.diffuseColor = new Color3(1, 1, 1)
  arrowMat.emissiveColor = new Color3(0.8, 0.8, 0.8)
  arrowMat.specularColor = new Color3(0, 0, 0)
  arrow.material = arrowMat

  // Range ring (torus showing max attack range)
  const ring = MeshBuilder.CreateTorus('rangeRing', { diameter: 1, thickness: 0.02, tessellation: 64 }, scene)
  ring.parent = node
  ring.position.y = 0.05
  ring.rotation.x = Math.PI / 2
  const ringMat = new StandardMaterial('rangeMat', scene)
  ringMat.emissiveColor = COLOR_RANGE_RING
  ringMat.alpha = 0.25
  ringMat.backFaceCulling = false
  ring.material = ringMat

  // Min range ring (inner ring showing minimum range)
  const minRing = MeshBuilder.CreateTorus('minRangeRing', { diameter: 1, thickness: 0.02, tessellation: 64 }, scene)
  minRing.parent = node
  minRing.position.y = 0.06
  minRing.rotation.x = Math.PI / 2
  const minRingMat = new StandardMaterial('minRangeMat', scene)
  minRingMat.emissiveColor = COLOR_MIN_RANGE_RING
  minRingMat.alpha = 0.2
  minRingMat.backFaceCulling = false
  minRing.material = minRingMat

  attackerNode = node
  void body
  void arrow
  rangeRing = ring
  minRangeRing = minRing

  attacker = {
    cellX: 2, cellY: 10,
    posX: center.x, posZ: center.z,
    facing: WANGLE_NORTH,
    turnSpeed: 8,
    attackRange: 5,
    minRange: 0,
    fireCooldown: 20,
    fireTimer: 0,
    fireCount: 0,
    attackStatus: AttackStatus.UnableToAttack,
    isMoving: false,
    moveSpeed: 0.025,
    targetCellX: 10,
    targetCellY: 10,
    movePath: [],
    movePathIndex: 0,
    moveProgress: 0,
    moveFrom: { x: 0, z: 0 },
    moveTo: { x: 0, z: 0 },
    moveDistance: 0,
  }
}

createAttacker()

// ---------------------------------------------------------------------------
// Create Target Unit
// ---------------------------------------------------------------------------

let target: TargetState
let targetNode: TransformNode
let targetBody: Mesh
let targetHpBar: Mesh

function createTarget(): void {
  const node = new TransformNode('target', scene)
  const center = cellCenter(10, 10)
  node.position.set(center.x, 0, center.z)

  const body = MeshBuilder.CreateBox('targetBody', { width: 0.6, height: 0.4, depth: 0.6 }, scene)
  body.parent = node
  body.position.y = 0.2
  const mat = new StandardMaterial('targetMat', scene)
  mat.diffuseColor = COLOR_TARGET
  mat.emissiveColor = new Color3(0.5, 0.1, 0.1)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  // HP bar (small cylinder above unit)
  const hpBar = MeshBuilder.CreateBox('hpBar', { width: 0.5, height: 0.04, depth: 0.04 }, scene)
  hpBar.parent = node
  hpBar.position.y = 0.5
  const hpMat = new StandardMaterial('hpMat', scene)
  hpMat.diffuseColor = new Color3(0.2, 0.8, 0.2)
  hpMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  hpBar.material = hpMat

  targetNode = node
  targetBody = body
  targetHpBar = hpBar

  target = {
    cellX: 10, cellY: 10,
    posX: center.x, posZ: center.z,
    hp: 100, maxHp: 100,
    isAlive: true,
    speed: 0.015,
    patrolPath: [],
    patrolIndex: 0,
  }
}

createTarget()

// ---------------------------------------------------------------------------
// Target Line (red dashed line from attacker to target)
// ---------------------------------------------------------------------------

let targetLineMesh: LinesMesh | null = null

function createDashedLine(name: string, from: Vector3, to: Vector3, color: Color3, dashLen: number = 0.25, gapLen: number = 0.12): LinesMesh {
  const dir = to.subtract(from)
  const totalLen = dir.length()
  if (totalLen < 0.001) {
    return MeshBuilder.CreateLines(name, { points: [from, from.add(new Vector3(0.001, 0, 0))] }, scene)
  }
  dir.normalize()

  const points: Vector3[] = []
  let dist = 0
  let drawing = true

  while (dist < totalLen) {
    const segLen = drawing ? Math.min(dashLen, totalLen - dist) : Math.min(gapLen, totalLen - dist)
    if (drawing) {
      points.push(from.add(dir.scale(dist)))
      points.push(from.add(dir.scale(Math.min(dist + segLen, totalLen))))
    }
    dist += segLen
    drawing = !drawing
  }

  const line = MeshBuilder.CreateLines(name, { points }, scene)
  line.color = color
  return line
}

function updateTargetLine(): void {
  if (targetLineMesh) { targetLineMesh.dispose(); targetLineMesh = null }
  if (!target.isAlive) return

  const from = new Vector3(attacker.posX, 0.3, attacker.posZ)
  const to = new Vector3(target.posX, 0.3, target.posZ)
  targetLineMesh = createDashedLine('targetLine', from, to, COLOR_TARGET_LINE)
}

// ---------------------------------------------------------------------------
// A* Pathfinding (for movement)
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
  if (tx < 0 || tx >= GRID_W || ty < 0 || ty >= GRID_H) return []

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
// Attack Logic (simulates Attack.ts tick behavior)
// ---------------------------------------------------------------------------

function distanceToTarget(): number {
  const dx = attacker.posX - target.posX
  const dz = attacker.posZ - target.posZ
  return Math.sqrt(dx * dx + dz * dz)
}

function directionToTargetWAngle(): number {
  const dx = target.posX - attacker.posX
  const dz = target.posZ - attacker.posZ
  if (dx === 0 && dz === 0) return attacker.facing
  // WAngle: 0 = North (-Z), 256 = West (-X), 512 = South (+Z), 768 = East (+X)
  // atan2(y, x) in standard math: 0 = +X (East), PI/2 = +Y (North)
  // We need: 0 = North (-Z), so we swap and negate
  const angle = Math.atan2(-dx, -dz) // 0 = North, PI/2 = West, PI = South, -PI/2 = East
  let wangle = Math.round((angle * 512) / Math.PI)
  wangle = ((wangle % WANGLE_FULL) + WANGLE_FULL) % WANGLE_FULL
  return wangle
}

function isInRange(): boolean {
  const dist = distanceToTarget()
  const maxRangeWorld = attacker.attackRange * CELL_SIZE
  const minRangeWorld = attacker.minRange * CELL_SIZE
  return dist <= maxRangeWorld && (minRangeWorld === 0 || dist >= minRangeWorld)
}

function isInFiringArc(tolerance: number = 64): boolean {
  const desired = directionToTargetWAngle()
  const diff = Math.abs(wAngleDiff(attacker.facing, desired))
  return diff <= tolerance
}

function tickAttack(): void {
  if (!target.isAlive) {
    attacker.attackStatus = AttackStatus.UnableToAttack
    return
  }

  // Check range
  if (!isInRange()) {
    attacker.attackStatus = AttackStatus.NeedsToMove
    // Move toward target
    moveTowardTarget()
    return
  }

  // Check firing arc
  if (!isInFiringArc(64)) {
    attacker.attackStatus = AttackStatus.NeedsToTurn
    // Turn toward target
    const desired = directionToTargetWAngle()
    attacker.facing = tickFacing(attacker.facing, desired, attacker.turnSpeed)
    return
  }

  // In range and facing target — attack!
  attacker.attackStatus = AttackStatus.Attacking

  // Fire if cooldown ready
  attacker.fireTimer--
  if (attacker.fireTimer <= 0) {
    attacker.fireTimer = attacker.fireCooldown
    attacker.fireCount++
    onFire()
  }
}

function moveTowardTarget(): void {
  if (!attacker.isMoving) {
    // Start moving toward target
    const path = findPath(attacker.cellX, attacker.cellY, attacker.targetCellX, attacker.targetCellY)
    if (path.length > 1) {
      attacker.movePath = path
      attacker.movePathIndex = 1
      attacker.isMoving = true
      attacker.moveProgress = 0
      const from = cellCenter(attacker.cellX, attacker.cellY)
      const to = cellCenter(path[1].x, path[1].y)
      attacker.moveFrom = from
      attacker.moveTo = to
      attacker.moveDistance = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2)
    }
    return
  }

  // Continue moving along path
  attacker.moveProgress += attacker.moveSpeed

  if (attacker.moveProgress >= attacker.moveDistance) {
    // Reached next cell
    const nextCell = attacker.movePath[attacker.movePathIndex]
    attacker.cellX = nextCell.x
    attacker.cellY = nextCell.y
    attacker.posX = attacker.moveTo.x
    attacker.posZ = attacker.moveTo.z
    attacker.movePathIndex++
    attacker.moveProgress = 0

    if (attacker.movePathIndex >= attacker.movePath.length) {
      // Reached destination
      attacker.isMoving = false
      attacker.movePath = []
    } else {
      // Next segment
      const next = attacker.movePath[attacker.movePathIndex]
      attacker.moveFrom = attacker.moveTo
      attacker.moveTo = cellCenter(next.x, next.y)
      attacker.moveDistance = Math.sqrt(
        (attacker.moveTo.x - attacker.moveFrom.x) ** 2 +
        (attacker.moveTo.z - attacker.moveFrom.z) ** 2
      )
    }
  } else {
    // Interpolate position
    const t = attacker.moveProgress / attacker.moveDistance
    attacker.posX = attacker.moveFrom.x + (attacker.moveTo.x - attacker.moveFrom.x) * t
    attacker.posZ = attacker.moveFrom.z + (attacker.moveTo.z - attacker.moveFrom.z) * t
  }

  // Turn while moving toward target
  const desired = directionToTargetWAngle()
  attacker.facing = tickFacing(attacker.facing, desired, attacker.turnSpeed)
}

function onFire(): void {
  // Visual feedback: flash "FIRE" text
  const flash = document.getElementById('attack-flash')!
  flash.classList.add('visible')
  setTimeout(() => flash.classList.remove('visible'), 150)

  // Target takes damage
  target.hp -= 10
  if (target.hp <= 0) {
    target.hp = 0
    target.isAlive = false
    targetNode.setEnabled(false)
  }

  // Update target HP bar color
  const hpRatio = target.hp / target.maxHp
  const hpMat = targetHpBar.material as StandardMaterial
  if (hpRatio > 0.5) {
    hpMat.diffuseColor = new Color3(0.2, 0.8, 0.2)
    hpMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  } else if (hpRatio > 0.25) {
    hpMat.diffuseColor = new Color3(0.9, 0.7, 0.1)
    hpMat.emissiveColor = new Color3(0.5, 0.4, 0)
  } else {
    hpMat.diffuseColor = new Color3(0.9, 0.2, 0.2)
    hpMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
  }

  // Scale HP bar
  targetHpBar.scaling.x = hpRatio

  // Target body flash red
  const targetMat = targetBody.material as StandardMaterial
  targetMat.emissiveColor = new Color3(0.9, 0.1, 0.1)
  setTimeout(() => {
    if (target.isAlive) {
      targetMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
    }
  }, 100)
}

// ---------------------------------------------------------------------------
// Target Patrol Logic
// ---------------------------------------------------------------------------

function tickTarget(): void {
  if (!target.isAlive) return
  if (target.patrolPath.length === 0) return

  const patrolTarget = target.patrolPath[target.patrolIndex]
  const patrolCenter = cellCenter(patrolTarget.x, patrolTarget.y)
  const dx = patrolCenter.x - target.posX
  const dz = patrolCenter.z - target.posZ
  const dist = Math.sqrt(dx * dx + dz * dz)

  if (dist < target.speed) {
    target.patrolIndex = (target.patrolIndex + 1) % target.patrolPath.length
  } else {
    target.posX += (dx / dist) * target.speed
    target.posZ += (dz / dist) * target.speed
  }

  target.cellX = Math.floor(target.posX)
  target.cellY = Math.floor(target.posZ)
  targetNode.position.x = target.posX
  targetNode.position.z = target.posZ
}

// ---------------------------------------------------------------------------
// Update Visuals
// ---------------------------------------------------------------------------

function updateAttackerVisuals(): void {
  attackerNode.position.x = attacker.posX
  attackerNode.position.z = attacker.posZ
  attackerNode.rotation.y = wAngleToRotationY(attacker.facing)

  // Update range ring size
  const maxDiameter = attacker.attackRange * CELL_SIZE * 2
  rangeRing.scaling.set(maxDiameter, maxDiameter, maxDiameter)

  // Update min range ring
  if (attacker.minRange > 0) {
    const minDiameter = attacker.minRange * CELL_SIZE * 2
    minRangeRing.scaling.set(minDiameter, minDiameter, minDiameter)
    minRangeRing.setEnabled(true)
  } else {
    minRangeRing.setEnabled(false)
  }
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function updateStatsPanel(): void {
  const statusEl = document.getElementById('stat-attack-status')!
  statusEl.textContent = AttackStatusNames[attacker.attackStatus] || '未知'
  statusEl.className = 'value'
  if (attacker.attackStatus === AttackStatus.Attacking) statusEl.classList.add('attack')
  else if (attacker.attackStatus === AttackStatus.NeedsToTurn) statusEl.classList.add('turn')
  else if (attacker.attackStatus === AttackStatus.NeedsToMove) statusEl.classList.add('move')
  else statusEl.classList.add('idle')

  document.getElementById('stat-facing')!.textContent = `${attacker.facing} (${Math.round(attacker.facing * 360 / 1024)}°)`
  document.getElementById('stat-target-facing')!.textContent = `${directionToTargetWAngle()} (${Math.round(directionToTargetWAngle() * 360 / 1024)}°)`
  document.getElementById('stat-distance')!.textContent = `${distanceToTarget().toFixed(2)} 格`
  document.getElementById('stat-range')!.textContent = `${attacker.attackRange} 格 (最小 ${attacker.minRange} 格)`
  document.getElementById('stat-fire-count')!.textContent = String(attacker.fireCount)
  document.getElementById('stat-line-color')!.textContent = target.isAlive ? '#E94560 (红色)' : '无目标'
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

let isPaused = false
let speedMultiplier = 1.0

function resetScene(): void {
  attacker.cellX = 2
  attacker.cellY = 10
  const center = cellCenter(2, 10)
  attacker.posX = center.x
  attacker.posZ = center.z
  attacker.facing = WANGLE_NORTH
  attacker.attackStatus = AttackStatus.UnableToAttack
  attacker.isMoving = false
  attacker.movePath = []
  attacker.movePathIndex = 0
  attacker.fireCount = 0
  attacker.fireTimer = 0
  attacker.targetCellX = 10
  attacker.targetCellY = 10

  target.cellX = 10
  target.cellY = 10
  const tCenter = cellCenter(10, 10)
  target.posX = tCenter.x
  target.posZ = tCenter.z
  target.hp = 100
  target.isAlive = true
  target.patrolPath = []
  target.patrolIndex = 0
  targetNode.setEnabled(true)

  // Reset HP bar
  const hpMat = targetHpBar.material as StandardMaterial
  hpMat.diffuseColor = new Color3(0.2, 0.8, 0.2)
  hpMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  targetHpBar.scaling.x = 1

  const targetMat = targetBody.material as StandardMaterial
  targetMat.diffuseColor = COLOR_TARGET
  targetMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
}

function presetInRange(): void {
  resetScene()
  attacker.targetCellX = 6
  attacker.targetCellY = 10
  target.cellX = 6
  target.cellY = 10
  const tCenter = cellCenter(6, 10)
  target.posX = tCenter.x
  target.posZ = tCenter.z
  targetNode.position.set(tCenter.x, 0, tCenter.z)
}

function presetOutOfRange(): void {
  resetScene()
  attacker.targetCellX = 15
  attacker.targetCellY = 10
  target.cellX = 15
  target.cellY = 10
  const tCenter = cellCenter(15, 10)
  target.posX = tCenter.x
  target.posZ = tCenter.z
  targetNode.position.set(tCenter.x, 0, tCenter.z)
}

function presetNeedsTurn(): void {
  resetScene()
  attacker.facing = WANGLE_SOUTH // Face away from target
  attacker.targetCellX = 6
  attacker.targetCellY = 10
  target.cellX = 6
  target.cellY = 10
  const tCenter = cellCenter(6, 10)
  target.posX = tCenter.x
  target.posZ = tCenter.z
  targetNode.position.set(tCenter.x, 0, tCenter.z)
}

function presetMovingTarget(): void {
  resetScene()
  attacker.targetCellX = 10
  attacker.targetCellY = 10
  target.cellX = 10
  target.cellY = 10
  const tCenter = cellCenter(10, 10)
  target.posX = tCenter.x
  target.posZ = tCenter.z
  targetNode.position.set(tCenter.x, 0, tCenter.z)
  target.patrolPath = [
    { x: 8, y: 8 }, { x: 12, y: 8 }, { x: 12, y: 12 }, { x: 8, y: 12 },
  ]
}

function presetMinRange(): void {
  resetScene()
  attacker.minRange = 3
  attacker.targetCellX = 2
  attacker.targetCellY = 10
  target.cellX = 2
  target.cellY = 10
  // Place target very close (within min range)
  target.posX = attacker.posX + 1.5
  target.posZ = attacker.posZ
  targetNode.position.set(target.posX, 0, target.posZ)
}

// ---------------------------------------------------------------------------
// Click Handling
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  if (e.button !== 0) return
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (!pickResult?.pickedPoint) return

  const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
  const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return

  // Set target position
  attacker.targetCellX = gx
  attacker.targetCellY = gy
  target.cellX = gx
  target.cellY = gy
  const tCenter = cellCenter(gx, gy)
  target.posX = tCenter.x
  target.posZ = tCenter.z
  targetNode.position.set(tCenter.x, 0, tCenter.z)
  target.patrolPath = [] // Stop patrol
  target.isAlive = true
  target.hp = 100
  targetNode.setEnabled(true)

  // Reset HP bar
  const hpMat = targetHpBar.material as StandardMaterial
  hpMat.diffuseColor = new Color3(0.2, 0.8, 0.2)
  hpMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  targetHpBar.scaling.x = 1

  const targetMat = targetBody.material as StandardMaterial
  targetMat.diffuseColor = COLOR_TARGET
  targetMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
})

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (!pickResult?.pickedPoint) return

  const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
  const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return

  // Set attacker position
  attacker.cellX = gx
  attacker.cellY = gy
  const center = cellCenter(gx, gy)
  attacker.posX = center.x
  attacker.posZ = center.z
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

document.getElementById('btn-reset')!.addEventListener('click', resetScene)
document.getElementById('btn-scene-in-range')!.addEventListener('click', presetInRange)
document.getElementById('btn-scene-out-range')!.addEventListener('click', presetOutOfRange)
document.getElementById('btn-scene-needs-turn')!.addEventListener('click', presetNeedsTurn)
document.getElementById('btn-scene-moving-target')!.addEventListener('click', presetMovingTarget)
document.getElementById('btn-scene-min-range')!.addEventListener('click', presetMinRange)

for (const [id, range] of [['btn-range-3', 3], ['btn-range-5', 5], ['btn-range-8', 8]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    attacker.attackRange = range
    for (const b of ['btn-range-3', 'btn-range-5', 'btn-range-8']) {
      document.getElementById(b)!.classList.toggle('active', b === id)
    }
  })
}

for (const [id, speed] of [['btn-turn-slow', 4], ['btn-turn-normal', 8], ['btn-turn-fast', 16]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    attacker.turnSpeed = speed
    for (const b of ['btn-turn-slow', 'btn-turn-normal', 'btn-turn-fast']) {
      document.getElementById(b)!.classList.toggle('active', b === id)
    }
  })
}

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case ' ':
      e.preventDefault()
      isPaused = !isPaused
      document.getElementById('btn-pause')!.classList.toggle('active', isPaused)
      document.getElementById('btn-resume')!.classList.toggle('active', !isPaused)
      break
    case '1': speedMultiplier = 1.0; break
    case '2': speedMultiplier = 2.0; break
    case '3': speedMultiplier = 4.0; break
    case 'r': resetScene(); break
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

presetInRange()

engine.runRenderLoop(() => {
  if (!isPaused) {
    // Apply speed multiplier to ticks
    const ticks = Math.ceil(speedMultiplier)
    for (let i = 0; i < ticks; i++) {
      tickAttack()
      tickTarget()
    }
  }
  updateAttackerVisuals()
  updateTargetLine()
  updateStatsPanel()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness
;(window as any).__testHarness = {
  scene, camera, engine,
  getAttacker: () => attacker,
  getTarget: () => target,
  getAttackStatus: () => attacker.attackStatus,
  getFireCount: () => attacker.fireCount,
  isInRange: () => isInRange(),
  isInFiringArc: () => isInFiringArc(),
}
