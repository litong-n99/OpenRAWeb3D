/**
 * main.ts -- Enter + CaptureActor 占领活动人工验收测试
 *
 * 测试目标:
 *   1. 验证 Enter 4 状态状态机：Approaching -> Entering -> Exiting -> Finished
 *   2. 验证 CaptureActor 继承 Enter 后的占领逻辑
 *   3. 验证 tickInner 钩子：取消无效目标（目标死亡、归属变更）
 *   4. 验证 tryStartEnter 钩子：验证占领条件、启动占领流程
 *   5. 验证 onEnterComplete 钩子：完成占领、归属变更、工程师处置
 *   6. 验证目标线颜色：Enter 使用绿色 (#44CC44)
 *   7. 验证消耗式 vs 非消耗式占领模式
 *   8. 验证破坏模式（sabotage）：HP 高时破坏而非占领
 *
 * OpenRA 对照:
 *   - OpenRA.Mods.Common/Activities/Enter.cs
 *   - OpenRA.Mods.Common/Activities/CaptureActor.cs
 *   - EnterState enum: { Approaching=0, Entering=1, Exiting=2, Finished=3 }
 *   - EnterBehaviour enum: { Exit=0, Suicide=1, Dispose=2 }
 *
 * 本测试使用纯 Babylon.js 模拟 Enter + CaptureActor 行为。
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
// EnterState (对应 OpenRA Enter.EnterState)
// ---------------------------------------------------------------------------

const EnterState = {
  Approaching: 0,
  Entering: 1,
  Exiting: 2,
  Finished: 3,
} as const

const EnterStateNames: Record<number, string> = {
  [EnterState.Approaching]: '接近中',
  [EnterState.Entering]: '进入中',
  [EnterState.Exiting]: '退出中',
  [EnterState.Finished]: '已完成',
}

// ---------------------------------------------------------------------------
// EnterBehaviour (对应 OpenRA EnterBehaviour)
// ---------------------------------------------------------------------------

const EnterBehaviour = {
  Exit: 0,    // Enter and exit normally
  Suicide: 1, // Enter and die (consumed)
  Dispose: 2, // Enter and disappear (consumed)
} as const
void EnterBehaviour

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLOR_ENGINEER = new Color3(0.20, 0.60, 0.95)    // #3399F2
const COLOR_ENEMY_BUILDING = new Color3(0.91, 0.27, 0.38) // #E94560
const COLOR_FRIENDLY_BUILDING = new Color3(0.27, 0.80, 0.27) // #44CC44
const COLOR_TARGET_LINE = new Color3(0.27, 0.80, 0.27)   // Green for Enter

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Owner = 'enemy' | 'friendly'

interface EngineerState {
  cellX: number
  cellY: number
  posX: number
  posZ: number
  isAlive: boolean
  isVisible: boolean
  speed: number
  // Enter state machine
  enterState: number
  isMoving: boolean
  movePath: { x: number; y: number }[]
  movePathIndex: number
  moveProgress: number
  moveFrom: { x: number; z: number }
  moveTo: { x: number; z: number }
  moveDistance: number
  // Capture state
  captureStarted: boolean
  captureComplete: boolean
  consumed: boolean     // Whether engineer is consumed after capture
  captureCount: number
}

interface BuildingState {
  cellX: number
  cellY: number
  posX: number
  posZ: number
  hp: number
  maxHp: number
  owner: Owner
  isAlive: boolean
  canBeCaptured: boolean
  captureManager: boolean // Has CaptureManager trait
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
// Create Engineer
// ---------------------------------------------------------------------------

let engineer: EngineerState
let engineerNode: TransformNode

function createEngineer(): void {
  const node = new TransformNode('engineer', scene)
  const center = cellCenter(2, 10)
  node.position.set(center.x, 0, center.z)

  const body = MeshBuilder.CreateBox('engBody', { width: 0.4, height: 0.5, depth: 0.4 }, scene)
  body.parent = node
  body.position.y = 0.25
  const mat = new StandardMaterial('engMat', scene)
  mat.diffuseColor = COLOR_ENGINEER
  mat.emissiveColor = new Color3(0.1, 0.3, 0.5)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  // Engineer label (small sphere on top)
  const label = MeshBuilder.CreateSphere('engLabel', { diameter: 0.15 }, scene)
  label.parent = node
  label.position.y = 0.55
  const labelMat = new StandardMaterial('labelMat', scene)
  labelMat.diffuseColor = new Color3(1, 1, 0)
  labelMat.emissiveColor = new Color3(0.5, 0.5, 0)
  label.material = labelMat

  engineerNode = node
  void body

  engineer = {
    cellX: 2, cellY: 10,
    posX: center.x, posZ: center.z,
    isAlive: true, isVisible: true,
    speed: 0.025,
    enterState: EnterState.Approaching,
    isMoving: false,
    movePath: [],
    movePathIndex: 0,
    moveProgress: 0,
    moveFrom: { x: 0, z: 0 },
    moveTo: { x: 0, z: 0 },
    moveDistance: 0,
    captureStarted: false,
    captureComplete: false,
    consumed: false,
    captureCount: 0,
  }
}

createEngineer()

// ---------------------------------------------------------------------------
// Create Building
// ---------------------------------------------------------------------------

let building: BuildingState
let buildingNode: TransformNode
let buildingBody: Mesh
let buildingHpBar: Mesh

function createBuilding(): void {
  const node = new TransformNode('building', scene)
  const center = cellCenter(10, 10)
  node.position.set(center.x, 0, center.z)

  // Building body (larger than unit)
  const body = MeshBuilder.CreateBox('bldBody', { width: 1.2, height: 0.8, depth: 1.2 }, scene)
  body.parent = node
  body.position.y = 0.4
  const mat = new StandardMaterial('bldMat', scene)
  mat.diffuseColor = COLOR_ENEMY_BUILDING
  mat.emissiveColor = new Color3(0.5, 0.1, 0.1)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  // Building top (flat roof)
  const roof = MeshBuilder.CreateBox('bldRoof', { width: 1.0, height: 0.1, depth: 1.0 }, scene)
  roof.parent = node
  roof.position.y = 0.85
  const roofMat = new StandardMaterial('roofMat', scene)
  roofMat.diffuseColor = new Color3(0.6, 0.6, 0.6)
  roofMat.specularColor = new Color3(0, 0, 0)
  roof.material = roofMat

  // HP bar
  const hpBar = MeshBuilder.CreateBox('bldHpBar', { width: 1.0, height: 0.04, depth: 0.04 }, scene)
  hpBar.parent = node
  hpBar.position.y = 0.95
  const hpMat = new StandardMaterial('bldHpMat', scene)
  hpMat.diffuseColor = new Color3(0.2, 0.8, 0.2)
  hpMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  hpBar.material = hpMat

  buildingNode = node
  buildingBody = body
  buildingHpBar = hpBar

  building = {
    cellX: 10, cellY: 10,
    posX: center.x, posZ: center.z,
    hp: 100, maxHp: 100,
    owner: 'enemy',
    isAlive: true,
    canBeCaptured: true,
    captureManager: true,
  }
}

createBuilding()

// ---------------------------------------------------------------------------
// Target Line (green dashed line from engineer to building)
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
  if (!engineer.isAlive || !building.isAlive) return
  // BUGFIX E6: also hide target line when enter state is Finished (cancel / invalid target)
  if (engineer.captureComplete || engineer.enterState === EnterState.Finished) return

  const from = new Vector3(engineer.posX, 0.3, engineer.posZ)
  const to = new Vector3(building.posX, 0.3, building.posZ)
  targetLineMesh = createDashedLine('targetLine', from, to, COLOR_TARGET_LINE)
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
// Enter + Capture Logic (simulates Enter.ts + CaptureActor.ts)
// ---------------------------------------------------------------------------

let captureMode: 'capture' | 'sabotage' | 'consumed' = 'capture'
let sabotageThreshold = 50 // HP% above which sabotage happens
let sabotageHPRemoval = 25 // % of max HP removed by sabotage

function isAdjacentToBuilding(): boolean {
  const dx = Math.abs(engineer.cellX - building.cellX)
  const dy = Math.abs(engineer.cellY - building.cellY)
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 1 && dy === 1)
}

function isAtBuildingCell(): boolean {
  return engineer.cellX === building.cellX && engineer.cellY === building.cellY
}

function tickEnter(): void {
  if (!engineer.isAlive || !building.isAlive) return
  if (engineer.captureComplete) return

  // tickInner: validate target can still be captured
  if (!building.canBeCaptured || !building.captureManager) {
    // Cancel capture
    engineer.enterState = EnterState.Finished
    engineer.isMoving = false
    return
  }

  // If building owner is friendly, cancel
  if (building.owner === 'friendly') {
    engineer.enterState = EnterState.Finished
    engineer.isMoving = false
    return
  }

  switch (engineer.enterState) {
    case EnterState.Approaching: {
      // Move to building
      if (!engineer.isMoving) {
        const path = findPath(engineer.cellX, engineer.cellY, building.cellX, building.cellY)
        if (path.length > 1) {
          engineer.movePath = path
          engineer.movePathIndex = 1
          engineer.isMoving = true
          engineer.moveProgress = 0
          const from = cellCenter(engineer.cellX, engineer.cellY)
          const to = cellCenter(path[1].x, path[1].y)
          engineer.moveFrom = from
          engineer.moveTo = to
          engineer.moveDistance = Math.sqrt((to.x - from.x) ** 2 + (to.z - from.z) ** 2)
        }
      }

      // Continue moving
      if (engineer.isMoving) {
        engineer.moveProgress += engineer.speed
        if (engineer.moveProgress >= engineer.moveDistance) {
          const nextCell = engineer.movePath[engineer.movePathIndex]
          engineer.cellX = nextCell.x
          engineer.cellY = nextCell.y
          engineer.posX = engineer.moveTo.x
          engineer.posZ = engineer.moveTo.z
          engineer.movePathIndex++
          engineer.moveProgress = 0

          if (engineer.movePathIndex >= engineer.movePath.length) {
            engineer.isMoving = false
          } else {
            const next = engineer.movePath[engineer.movePathIndex]
            engineer.moveFrom = engineer.moveTo
            engineer.moveTo = cellCenter(next.x, next.y)
            engineer.moveDistance = Math.sqrt(
              (engineer.moveTo.x - engineer.moveFrom.x) ** 2 +
              (engineer.moveTo.z - engineer.moveFrom.z) ** 2
            )
          }
        } else {
          const t = engineer.moveProgress / engineer.moveDistance
          engineer.posX = engineer.moveFrom.x + (engineer.moveTo.x - engineer.moveFrom.x) * t
          engineer.posZ = engineer.moveFrom.z + (engineer.moveTo.z - engineer.moveFrom.z) * t
        }
      }

      // Check if adjacent to building
      if (isAdjacentToBuilding() || isAtBuildingCell()) {
        // tryStartEnter: verify we can capture
        if (building.canBeCaptured && building.captureManager && building.owner === 'enemy') {
          engineer.enterState = EnterState.Entering
          engineer.captureStarted = true
        } else {
          engineer.enterState = EnterState.Finished
        }
      }
      break
    }

    case EnterState.Entering: {
      // Move into building cell
      if (!isAtBuildingCell()) {
        // Move one more step into building
        const targetCenter = cellCenter(building.cellX, building.cellY)
        const dx = targetCenter.x - engineer.posX
        const dz = targetCenter.z - engineer.posZ
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist > 0.01) {
          engineer.posX += (dx / dist) * Math.min(engineer.speed, dist)
          engineer.posZ += (dz / dist) * Math.min(engineer.speed, dist)
        } else {
          engineer.posX = targetCenter.x
          engineer.posZ = targetCenter.z
          engineer.cellX = building.cellX
          engineer.cellY = building.cellY
        }
      }

      // Once at building, complete capture
      if (isAtBuildingCell()) {
        engineer.enterState = EnterState.Exiting
        onEnterComplete()
      }
      break
    }

    case EnterState.Exiting: {
      // Return to adjacent cell (if not consumed)
      if (engineer.consumed) {
        engineer.isVisible = false
        engineerNode.setEnabled(false)
        engineer.enterState = EnterState.Finished
      } else {
        // Move back to a free adjacent cell
        const adjacentCells = [
          { x: building.cellX - 1, y: building.cellY },
          { x: building.cellX + 1, y: building.cellY },
          { x: building.cellX, y: building.cellY - 1 },
          { x: building.cellX, y: building.cellY + 1 },
        ].filter(c => c.x >= 0 && c.x < GRID_W && c.y >= 0 && c.y < GRID_H)

        if (adjacentCells.length > 0) {
          const exitCell = adjacentCells[0]
          const exitCenter = cellCenter(exitCell.x, exitCell.y)
          const dx = exitCenter.x - engineer.posX
          const dz = exitCenter.z - engineer.posZ
          const dist = Math.sqrt(dx * dx + dz * dz)
          if (dist > 0.01) {
            engineer.posX += (dx / dist) * Math.min(engineer.speed, dist)
            engineer.posZ += (dz / dist) * Math.min(engineer.speed, dist)
          } else {
            engineer.posX = exitCenter.x
            engineer.posZ = exitCenter.z
            engineer.cellX = exitCell.x
            engineer.cellY = exitCell.y
            engineer.enterState = EnterState.Finished
          }
        } else {
          engineer.enterState = EnterState.Finished
        }
      }
      break
    }

    case EnterState.Finished: {
      // Capture complete, nothing more to do
      break
    }
  }
}

function onEnterComplete(): void {
  // CaptureActor.onEnterComplete simulation
  engineer.captureComplete = true
  engineer.captureCount++

  // Check sabotage
  const hpRatio = (building.hp / building.maxHp) * 100
  if (captureMode === 'sabotage' && hpRatio > sabotageThreshold) {
    // Sabotage: damage building
    const damage = Math.trunc((building.maxHp * sabotageHPRemoval) / 100)
    building.hp = Math.max(0, building.hp - damage)
    showOverlay('SABOTAGED!')

    if (engineer.consumed) {
      engineer.isAlive = false
      engineer.isVisible = false
      engineerNode.setEnabled(false)
    }
  } else {
    // Capture: change ownership
    building.owner = 'friendly'
    showOverlay('CAPTURED!')

    // Change building color
    const bldMat = buildingBody.material as StandardMaterial
    bldMat.diffuseColor = COLOR_FRIENDLY_BUILDING
    bldMat.emissiveColor = new Color3(0.1, 0.4, 0.1)

    if (engineer.consumed) {
      engineer.isAlive = false
      engineer.isVisible = false
      engineerNode.setEnabled(false)
    }
  }

  updateBuildingHpBar()
}

function showOverlay(text: string): void {
  const overlay = document.getElementById('capture-overlay')!
  overlay.textContent = text
  overlay.classList.add('visible')
  setTimeout(() => overlay.classList.remove('visible'), 2000)
}

function updateBuildingHpBar(): void {
  const hpRatio = building.hp / building.maxHp
  buildingHpBar.scaling.x = hpRatio

  const hpMat = buildingHpBar.material as StandardMaterial
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
}

// ---------------------------------------------------------------------------
// Update Visuals
// ---------------------------------------------------------------------------

function updateEngineerVisuals(): void {
  if (!engineer.isVisible) return
  engineerNode.position.x = engineer.posX
  engineerNode.position.z = engineer.posZ
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function updateStatsPanel(): void {
  const stateEl = document.getElementById('stat-engineer-state')!
  if (!engineer.isAlive) {
    stateEl.textContent = '已消耗'
    stateEl.className = 'value captured'
  } else if (engineer.captureComplete) {
    stateEl.textContent = '占领完成'
    stateEl.className = 'value captured'
  } else if (engineer.isMoving) {
    stateEl.textContent = '移动中'
    stateEl.className = 'value approaching'
  } else {
    stateEl.textContent = '空闲'
    stateEl.className = 'value idle'
  }

  const enterStateEl = document.getElementById('stat-enter-state')!
  enterStateEl.textContent = EnterStateNames[engineer.enterState] || '-'
  enterStateEl.className = 'value'
  if (engineer.enterState === EnterState.Approaching) enterStateEl.classList.add('approaching')
  else if (engineer.enterState === EnterState.Entering) enterStateEl.classList.add('entering')
  else if (engineer.enterState === EnterState.Exiting) enterStateEl.classList.add('exiting')
  else if (engineer.enterState === EnterState.Finished) enterStateEl.classList.add('finished')

  document.getElementById('stat-engineer-pos')!.textContent = `(${engineer.cellX}, ${engineer.cellY})`
  document.getElementById('stat-target-building')!.textContent = `(${building.cellX}, ${building.cellY})`

  const ownerEl = document.getElementById('stat-building-owner')!
  ownerEl.textContent = building.owner === 'enemy' ? '敌方' : '己方'
  ownerEl.className = 'value'
  if (building.owner === 'enemy') ownerEl.classList.add('captured')
  else ownerEl.classList.add('approaching')

  document.getElementById('stat-building-hp')!.textContent = `${building.hp}/${building.maxHp}`
  document.getElementById('stat-line-color')!.textContent = engineer.captureComplete ? '无' : '#44CC44 (绿色)'
  document.getElementById('stat-capture-count')!.textContent = String(engineer.captureCount)
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
  engineer.cellX = 2
  engineer.cellY = 10
  const center = cellCenter(2, 10)
  engineer.posX = center.x
  engineer.posZ = center.z
  engineer.isAlive = true
  engineer.isVisible = true
  engineer.enterState = EnterState.Approaching
  engineer.isMoving = false
  engineer.movePath = []
  engineer.movePathIndex = 0
  engineer.captureStarted = false
  engineer.captureComplete = false
  engineer.consumed = false
  engineerNode.setEnabled(true)

  building.cellX = 10
  building.cellY = 10
  const bCenter = cellCenter(10, 10)
  building.posX = bCenter.x
  building.posZ = bCenter.z
  building.hp = 100
  building.owner = 'enemy'
  building.isAlive = true
  building.canBeCaptured = true
  building.captureManager = true
  buildingNode.setEnabled(true)

  // Reset building color
  const bldMat = buildingBody.material as StandardMaterial
  bldMat.diffuseColor = COLOR_ENEMY_BUILDING
  bldMat.emissiveColor = new Color3(0.5, 0.1, 0.1)

  updateBuildingHpBar()
  captureMode = 'capture'
}

function presetConsumed(): void {
  resetScene()
  captureMode = 'consumed'
  engineer.consumed = true
}

function presetSabotage(): void {
  resetScene()
  captureMode = 'sabotage'
  building.hp = 80 // High enough to trigger sabotage
}

function presetCancel(): void {
  resetScene()
  // Simulate target becoming invalid during approach
  building.canBeCaptured = false
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

  // Move engineer to clicked position
  engineer.cellX = gx
  engineer.cellY = gy
  const center = cellCenter(gx, gy)
  engineer.posX = center.x
  engineer.posZ = center.z
  engineer.isMoving = false
  engineer.movePath = []
  // Reset enter state if moving manually
  if (!engineer.captureComplete) {
    engineer.enterState = EnterState.Approaching
  }
})

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (!pickResult?.pickedPoint) return

  const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
  const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return

  // Move building to clicked position
  building.cellX = gx
  building.cellY = gy
  const center = cellCenter(gx, gy)
  building.posX = center.x
  building.posZ = center.z
  buildingNode.position.set(center.x, 0, center.z)
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
document.getElementById('btn-scene-basic')!.addEventListener('click', resetScene)
document.getElementById('btn-scene-consumed')!.addEventListener('click', presetConsumed)
document.getElementById('btn-scene-sabotage')!.addEventListener('click', presetSabotage)
document.getElementById('btn-scene-cancel')!.addEventListener('click', presetCancel)

document.getElementById('btn-start-capture')!.addEventListener('click', () => {
  if (engineer.captureComplete) {
    resetScene()
  }
  engineer.enterState = EnterState.Approaching
  engineer.isMoving = false
  engineer.movePath = []
})

document.getElementById('btn-cancel-capture')!.addEventListener('click', () => {
  engineer.enterState = EnterState.Finished
  engineer.isMoving = false
  engineer.captureStarted = false
})

document.getElementById('btn-owner-enemy')!.addEventListener('click', () => {
  building.owner = 'enemy'
  const bldMat = buildingBody.material as StandardMaterial
  bldMat.diffuseColor = COLOR_ENEMY_BUILDING
  bldMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
  document.getElementById('btn-owner-enemy')!.classList.add('active')
  document.getElementById('btn-owner-friendly')!.classList.remove('active')
})

document.getElementById('btn-owner-friendly')!.addEventListener('click', () => {
  building.owner = 'friendly'
  const bldMat = buildingBody.material as StandardMaterial
  bldMat.diffuseColor = COLOR_FRIENDLY_BUILDING
  bldMat.emissiveColor = new Color3(0.1, 0.4, 0.1)
  document.getElementById('btn-owner-enemy')!.classList.remove('active')
  document.getElementById('btn-owner-friendly')!.classList.add('active')
})

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
    case 'c':
      if (engineer.captureComplete) resetScene()
      else engineer.enterState = EnterState.Approaching
      break
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

resetScene()

engine.runRenderLoop(() => {
  if (!isPaused) {
    const ticks = Math.ceil(speedMultiplier)
    for (let i = 0; i < ticks; i++) {
      tickEnter()
    }
  }
  updateEngineerVisuals()
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
  getEngineer: () => engineer,
  getBuilding: () => building,
  getEnterState: () => engineer.enterState,
  getCaptureComplete: () => engineer.captureComplete,
  getBuildingOwner: () => building.owner,
}
