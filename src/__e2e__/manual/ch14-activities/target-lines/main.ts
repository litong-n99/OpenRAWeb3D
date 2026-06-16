/**
 * main.ts -- 目标线渲染人工验收测试
 *
 * 测试目标:
 *   1. 验证 Move 活动的 targetLineNodes() 渲染: 蓝色虚线从单位到目标
 *   2. 验证 AttackMoveActivity 的 targetLineNodes() 渲染: 红色虚线
 *   3. 验证 TargetLineNode 的颜色与目标配对正确
 *   4. 验证多路径点（waypoint）的线段连接与节点标记
 *   5. 验证目标线在单位移动时的动态更新（实时缩短）
 *   6. 验证目标线到达目标后的淡出消失
 *
 * OpenRA 对照:
 *   - Move.ts: targetLineNodes() returns [TargetLineNode(Target.fromCell(dest), color)]
 *   - AttackMoveActivity.ts: delegates to child activity's targetLineNodes()
 *   - Activity.ts: TargetLineNode class (target, color, tile)
 *   - MoveAdjacentTo.ts: targetLineNodes() with target tracking
 *
 * 本测试使用纯 Babylon.js 模拟目标线渲染行为。
 * 所有颜色值对应 OpenRA 原始颜色常量。
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
// Grid State
// ---------------------------------------------------------------------------

interface Cell { x: number; y: number; walkable: boolean }
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

// ---------------------------------------------------------------------------
// Color Constants (OpenRA reference colors)
// ---------------------------------------------------------------------------

const COLOR_MOVE = new Color3(0.20, 0.60, 0.95)      // #3399F2 - Move target line
const COLOR_ATTACK_MOVE = new Color3(0.91, 0.27, 0.38) // #E94560 - AttackMove target line
const COLOR_WAYPOINT = new Color3(1.0, 0.8, 0.0)       // #FFCC00 - Waypoint nodes
const COLOR_UNIT_A = new Color3(0.27, 0.80, 0.27)      // #44CC44 - Unit A
const COLOR_UNIT_B = new Color3(0.80, 0.27, 0.80)      // #CC44CC - Unit B
const COLOR_TARGET = new Color3(0.93, 0.20, 0.20)       // #EE3333 - Target marker

// Per-unit color state (clones of defaults, to avoid cross-contamination)
const unitColors: Map<string, { move: Color3; attackMove: Color3; waypoint: Color3 }> = new Map()

function initUnitColors(unitId: string): void {
  unitColors.set(unitId, {
    move: COLOR_MOVE.clone(),
    attackMove: COLOR_ATTACK_MOVE.clone(),
    waypoint: COLOR_WAYPOINT.clone(),
  })
}

/** Get the effective color for a unit's current activity type */
function getUnitColor(unit: Unit): Color3 {
  const colors = unitColors.get(unit.id)
  if (!colors) return unit.activityType === 'move' ? COLOR_MOVE : COLOR_ATTACK_MOVE
  return unit.activityType === 'move' ? colors.move : colors.attackMove
}

/** Get the effective waypoint color for a unit */
function getWaypointColor(unit: Unit): Color3 {
  return unitColors.get(unit.id)?.waypoint ?? COLOR_WAYPOINT
}

// ---------------------------------------------------------------------------
// Unit State
// ---------------------------------------------------------------------------

interface Unit {
  id: string
  cellX: number
  cellY: number
  posX: number
  posZ: number
  color: Color3
  node: TransformNode
  body: Mesh
  targetCell: { x: number; y: number } | null
  waypoints: { x: number; y: number }[]
  activityType: 'move' | 'attackMove'
  isMoving: boolean
  moveProgress: number
  path: { x: number; y: number }[]
  pathIndex: number
  speed: number
}

let selectedUnitId = 'A'
let showTargetLines = true
let showWaypoints = true

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
// Create Units
// ---------------------------------------------------------------------------

const units: Map<string, Unit> = new Map()

function createUnit(id: string, cellX: number, cellY: number, color: Color3): Unit {
  const node = new TransformNode(`unit_${id}`, scene)
  const center = cellCenter(cellX, cellY)
  node.position.set(center.x, 0, center.z)

  const body = MeshBuilder.CreateBox(`unitBody_${id}`, { width: 0.6, height: 0.4, depth: 0.6 }, scene)
  body.parent = node
  body.position.y = 0.2
  const mat = new StandardMaterial(`unitMat_${id}`, scene)
  mat.diffuseColor = color
  mat.emissiveColor = new Color3(color.r * 0.5, color.g * 0.5, color.b * 0.5)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  // Selection ring (glow when selected)
  const ring = MeshBuilder.CreateTorus(`ring_${id}`, { diameter: 1.0, thickness: 0.05, tessellation: 32 }, scene)
  ring.parent = node
  ring.position.y = 0.02
  ring.rotation.x = Math.PI / 2
  const ringMat = new StandardMaterial(`ringMat_${id}`, scene)
  ringMat.emissiveColor = new Color3(1, 1, 0)
  ringMat.alpha = id === selectedUnitId ? 0.8 : 0.0
  ring.material = ringMat

  const unit: Unit = {
    id, cellX, cellY, posX: center.x, posZ: center.z,
    color, node, body,
    targetCell: null, waypoints: [],
    activityType: 'move', isMoving: false,
    moveProgress: 0, path: [], pathIndex: 0, speed: 0.03,
  }
  units.set(id, unit)
  return unit
}

createUnit('A', 3, 10, COLOR_UNIT_A)
initUnitColors('A')
createUnit('B', 16, 10, COLOR_UNIT_B)
initUnitColors('B')

// ---------------------------------------------------------------------------
// Target Line Rendering — Optimized: only recreate on data changes
// ---------------------------------------------------------------------------

/** Per-unit cached target line state to avoid per-frame recreation */
interface UnitLineState {
  targetLine: LinesMesh | null
  targetMarker: Mesh | null
  waypointLines: LinesMesh[]
  waypointMarkers: Mesh[]
  lastTargetCell: { x: number; y: number } | null
  lastWaypointCount: number
  lastActivityType: 'move' | 'attackMove'
  lastColorHash: string
  fadeOutTimer: number
}

const unitLineStates: Map<string, UnitLineState> = new Map()

function getUnitLineState(unitId: string): UnitLineState {
  let state = unitLineStates.get(unitId)
  if (!state) {
    state = {
      targetLine: null,
      targetMarker: null,
      waypointLines: [],
      waypointMarkers: [],
      lastTargetCell: null,
      lastWaypointCount: -1,
      lastActivityType: 'move',
      lastColorHash: '',
      fadeOutTimer: 0,
    }
    unitLineStates.set(unitId, state)
  }
  return state
}

/** Hash color for dirty-checking */
function colorHash(c: Color3): string {
  return `${c.r.toFixed(3)},${c.g.toFixed(3)},${c.b.toFixed(3)}`
}

/** Dispose all line meshes for a unit */
function clearUnitLines(unitId: string): void {
  const state = getUnitLineState(unitId)
  if (state.targetLine) { state.targetLine.dispose(); state.targetLine = null }
  if (state.targetMarker) { state.targetMarker.dispose(); state.targetMarker = null }
  for (const line of state.waypointLines) line.dispose()
  state.waypointLines = []
  for (const m of state.waypointMarkers) m.dispose()
  state.waypointMarkers = []
}

/** Create a dashed line from start to end with given color */
function createDashedLine(name: string, from: Vector3, to: Vector3, color: Color3, dashLen: number = 0.3, gapLen: number = 0.15): LinesMesh {
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

/** Check if target line data has changed for a unit (needs full rebuild) */
function isTargetLineDataDirty(unit: Unit, state: UnitLineState): boolean {
  const color = getUnitColor(unit)
  const currentHash = colorHash(color)

  // Check target cell change
  const targetChanged =
    (unit.targetCell === null && state.lastTargetCell !== null) ||
    (unit.targetCell !== null && state.lastTargetCell === null) ||
    (unit.targetCell !== null && state.lastTargetCell !== null &&
      (unit.targetCell.x !== state.lastTargetCell.x || unit.targetCell.y !== state.lastTargetCell.y))

  // Check waypoint count change
  const waypointChanged = unit.waypoints.length !== state.lastWaypointCount

  // Check activity type change
  const activityChanged = unit.activityType !== state.lastActivityType

  // Check color change
  const colorChanged = currentHash !== state.lastColorHash

  return targetChanged || waypointChanged || activityChanged || colorChanged
}

/** Update cached state after rebuild */
function updateLineState(unit: Unit, state: UnitLineState): void {
  state.lastTargetCell = unit.targetCell ? { x: unit.targetCell.x, y: unit.targetCell.y } : null
  state.lastWaypointCount = unit.waypoints.length
  state.lastActivityType = unit.activityType
  state.lastColorHash = colorHash(getUnitColor(unit))
}

/** Full rebuild of target lines for a unit */
function rebuildTargetLines(unit: Unit): void {
  const state = getUnitLineState(unit.id)
  clearUnitLines(unit.id)

  if (!showTargetLines) {
    updateLineState(unit, state)
    return
  }

  const unitPos = new Vector3(unit.posX, 0.3, unit.posZ)
  const color = getUnitColor(unit)

  // Main target line: unit -> target
  if (unit.targetCell) {
    const targetPos = new Vector3(
      unit.targetCell.x * CELL_SIZE + CELL_SIZE / 2,
      0.05,
      unit.targetCell.y * CELL_SIZE + CELL_SIZE / 2
    )
    state.targetLine = createDashedLine(`targetLine_${unit.id}`, unitPos, targetPos, color, 0.25, 0.12)

    // Target marker (red sphere at destination)
    state.targetMarker = MeshBuilder.CreateSphere(`target_${unit.id}`, { diameter: 0.4 }, scene)
    state.targetMarker.position = targetPos.clone()
    state.targetMarker.position.y = 0.2
    const markerMat = new StandardMaterial(`targetMat_${unit.id}`, scene)
    markerMat.diffuseColor = COLOR_TARGET
    markerMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
    markerMat.specularColor = new Color3(0, 0, 0)
    state.targetMarker.material = markerMat
  }

  // Waypoint lines and markers
  if (showWaypoints && unit.waypoints.length > 0) {
    let prevPos = unitPos

    for (let i = 0; i < unit.waypoints.length; i++) {
      const wp = unit.waypoints[i]
      const wpPos = new Vector3(wp.x * CELL_SIZE + CELL_SIZE / 2, 0.05, wp.y * CELL_SIZE + CELL_SIZE / 2)

      // Line from previous to waypoint
      const wpLine = createDashedLine(`wpLine_${unit.id}_${i}`, prevPos, wpPos, color, 0.2, 0.1)
      state.waypointLines.push(wpLine)

      // Waypoint marker (yellow octahedron diamond)
      const diamond = MeshBuilder.CreatePolyhedron(`wp_${unit.id}_${i}`, {
        type: 2, // octahedron = diamond shape
        size: 0.2,
      }, scene)
      diamond.position = wpPos.clone()
      diamond.position.y = 0.3
      const wpMat = new StandardMaterial(`wpMat_${unit.id}_${i}`, scene)
      wpMat.diffuseColor = getWaypointColor(unit)
      wpMat.emissiveColor = new Color3(0.5, 0.4, 0)
      wpMat.specularColor = new Color3(0, 0, 0)
      diamond.material = wpMat
      state.waypointMarkers.push(diamond)

      prevPos = wpPos
    }

    // Final line from last waypoint to target
    if (unit.targetCell) {
      const lastWp = unit.waypoints[unit.waypoints.length - 1]
      const lastWpPos = new Vector3(lastWp.x * CELL_SIZE + CELL_SIZE / 2, 0.05, lastWp.y * CELL_SIZE + CELL_SIZE / 2)
      const targetPos = new Vector3(
        unit.targetCell.x * CELL_SIZE + CELL_SIZE / 2,
        0.05,
        unit.targetCell.y * CELL_SIZE + CELL_SIZE / 2
      )
      const finalLine = createDashedLine(`finalLine_${unit.id}`, lastWpPos, targetPos, color, 0.25, 0.12)
      state.waypointLines.push(finalLine)
    }
  }

  updateLineState(unit, state)
}

/** Update target line positions for unit movement (no recreation) */
function updateTargetLinePositions(unit: Unit): void {
  const state = getUnitLineState(unit.id)
  if (!state.targetLine || !unit.targetCell) return

  // For LinesMesh, we need to rebuild when the start point moves
  // But we can optimize by only rebuilding when unit position changes significantly
  const unitPos = new Vector3(unit.posX, 0.3, unit.posZ)
  const targetPos = new Vector3(
    unit.targetCell.x * CELL_SIZE + CELL_SIZE / 2,
    0.05,
    unit.targetCell.y * CELL_SIZE + CELL_SIZE / 2
  )

  // Rebuild the dashed line with new start position
  state.targetLine.dispose()
  state.targetLine = createDashedLine(`targetLine_${unit.id}`, unitPos, targetPos, getUnitColor(unit), 0.25, 0.12)
}

/** Update all target lines — only rebuilds when data changes */
function updateAllTargetLines(): void {
  for (const unit of units.values()) {
    const state = getUnitLineState(unit.id)

    if (!showTargetLines) {
      if (state.targetLine || state.waypointLines.length > 0) {
        clearUnitLines(unit.id)
      }
      continue
    }

    // Check if we need a full rebuild (target/waypoints/color/activity changed)
    if (isTargetLineDataDirty(unit, state)) {
      rebuildTargetLines(unit)
    } else if (unit.targetCell && unit.isMoving) {
      // Only position changed — update the main target line
      updateTargetLinePositions(unit)
    }

    // Handle fade-out when target reached
    if (!unit.targetCell && !unit.isMoving) {
      if (state.fadeOutTimer === 0) {
        state.fadeOutTimer = 30 // 30 frames ≈ 500ms at 60fps
      }
      if (state.fadeOutTimer > 0) {
        state.fadeOutTimer--
        const alpha = state.fadeOutTimer / 30
        if (state.targetLine) state.targetLine.alpha = alpha
        if (state.targetMarker) state.targetMarker.visibility = alpha
        for (const line of state.waypointLines) line.alpha = alpha
        for (const m of state.waypointMarkers) m.visibility = alpha
        if (state.fadeOutTimer <= 0) {
          clearUnitLines(unit.id)
        }
      }
    } else {
      state.fadeOutTimer = 0
    }
  }
}

// ---------------------------------------------------------------------------
// Selection Ring Update
// ---------------------------------------------------------------------------

function updateSelectionRings(): void {
  for (const unit of units.values()) {
    const ring = scene.getMeshByName(`ring_${unit.id}`)
    if (ring) {
      const mat = ring.material as StandardMaterial
      mat.alpha = unit.id === selectedUnitId ? 0.8 : 0.0
    }
  }
}

// ---------------------------------------------------------------------------
// Simple Movement (for dynamic target line demo)
// ---------------------------------------------------------------------------

function tickUnitMovement(unit: Unit): void {
  if (!unit.isMoving || !unit.targetCell) return

  const targetPos = cellCenter(unit.targetCell.x, unit.targetCell.y)
  const dx = targetPos.x - unit.posX
  const dz = targetPos.z - unit.posZ
  const dist = Math.sqrt(dx * dx + dz * dz)

  if (dist < unit.speed) {
    // Arrived
    unit.posX = targetPos.x
    unit.posZ = targetPos.z
    unit.cellX = unit.targetCell.x
    unit.cellY = unit.targetCell.y
    unit.isMoving = false
    unit.targetCell = null
    unit.moveProgress = 1.0
  } else {
    const moveX = (dx / dist) * unit.speed
    const moveZ = (dz / dist) * unit.speed
    unit.posX += moveX
    unit.posZ += moveZ
    unit.moveProgress = 1.0 - (dist / Math.sqrt(
      (targetPos.x - cellCenter(unit.cellX, unit.cellY).x) ** 2 +
      (targetPos.z - cellCenter(unit.cellX, unit.cellY).z) ** 2
    ))
  }

  unit.node.position.x = unit.posX
  unit.node.position.z = unit.posZ
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function updateStatsPanel(): void {
  const unit = units.get(selectedUnitId)!
  document.getElementById('stat-activity')!.textContent = unit.activityType === 'move' ? 'Move' : 'AttackMove'

  let lineCount = 0
  if (unit.targetCell) lineCount++
  lineCount += unit.waypoints.length
  document.getElementById('stat-line-count')!.textContent = String(lineCount)
  document.getElementById('stat-selected')!.textContent = `Unit ${unit.id}`
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
// Click Handling
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  const pickResult = scene.pick(e.offsetX, e.offsetY)
  if (!pickResult?.pickedPoint) return

  const gx = Math.floor(pickResult.pickedPoint.x / CELL_SIZE)
  const gy = Math.floor(pickResult.pickedPoint.z / CELL_SIZE)
  if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return
  if (!grid[gy][gx].walkable) return

  const unit = units.get(selectedUnitId)!

  if (e.shiftKey) {
    // Add waypoint
    unit.waypoints.push({ x: gx, y: gy })
  } else {
    // Set target (clear waypoints if not shift-clicking)
    unit.targetCell = { x: gx, y: gy }
    unit.isMoving = true
    if (unit.waypoints.length === 0) {
      // Simple direct movement
    }
  }

  // Force rebuild on next frame
  const state = getUnitLineState(unit.id)
  state.lastTargetCell = null // Force dirty
  updateAllTargetLines()
  updateStatsPanel()
})

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

document.getElementById('btn-move')!.addEventListener('click', () => {
  const unit = units.get(selectedUnitId)!
  unit.activityType = 'move'
  document.getElementById('btn-move')!.classList.add('active')
  document.getElementById('btn-attack-move')!.classList.remove('active')
  updateAllTargetLines()
  updateStatsPanel()
})

document.getElementById('btn-attack-move')!.addEventListener('click', () => {
  const unit = units.get(selectedUnitId)!
  unit.activityType = 'attackMove'
  document.getElementById('btn-move')!.classList.remove('active')
  document.getElementById('btn-attack-move')!.classList.add('active')
  updateAllTargetLines()
  updateStatsPanel()
})

document.getElementById('btn-unit-a')!.addEventListener('click', () => {
  selectedUnitId = 'A'
  document.getElementById('btn-unit-a')!.classList.add('active')
  document.getElementById('btn-unit-b')!.classList.remove('active')
  updateSelectionRings()
  updateStatsPanel()
})

document.getElementById('btn-unit-b')!.addEventListener('click', () => {
  selectedUnitId = 'B'
  document.getElementById('btn-unit-a')!.classList.remove('active')
  document.getElementById('btn-unit-b')!.classList.add('active')
  updateSelectionRings()
  updateStatsPanel()
})

document.getElementById('btn-clear-waypoints')!.addEventListener('click', () => {
  const unit = units.get(selectedUnitId)!
  unit.waypoints = []
  updateAllTargetLines()
  updateStatsPanel()
})

document.getElementById('btn-toggle-lines')!.addEventListener('click', () => {
  showTargetLines = !showTargetLines
  updateAllTargetLines()
})

document.getElementById('btn-toggle-waypoints')!.addEventListener('click', () => {
  showWaypoints = !showWaypoints
  // Force rebuild since waypoint visibility changed
  for (const unit of units.values()) {
    const state = getUnitLineState(unit.id)
    state.lastWaypointCount = -1 // Force dirty
  }
  updateAllTargetLines()
})

document.getElementById('btn-add-waypoint')!.addEventListener('click', () => {
  // Add a random waypoint for demo
  const unit = units.get(selectedUnitId)!
  const rx = Math.floor(Math.random() * GRID_W)
  const ry = Math.floor(Math.random() * GRID_H)
  if (grid[ry][rx].walkable) {
    unit.waypoints.push({ x: rx, y: ry })
    updateAllTargetLines()
    updateStatsPanel()
  }
})

// Color pickers - modify per-unit colors to avoid cross-contamination
const colorMoveInput = document.getElementById('color-move') as HTMLInputElement
colorMoveInput.addEventListener('input', () => {
  const hex = colorMoveInput.value
  const colors = unitColors.get(selectedUnitId)
  if (colors) {
    colors.move.r = parseInt(hex.slice(1, 3), 16) / 255
    colors.move.g = parseInt(hex.slice(3, 5), 16) / 255
    colors.move.b = parseInt(hex.slice(5, 7), 16) / 255
  }
  updateAllTargetLines()
})

const colorAttackInput = document.getElementById('color-attack') as HTMLInputElement
colorAttackInput.addEventListener('input', () => {
  const hex = colorAttackInput.value
  const colors = unitColors.get(selectedUnitId)
  if (colors) {
    colors.attackMove.r = parseInt(hex.slice(1, 3), 16) / 255
    colors.attackMove.g = parseInt(hex.slice(3, 5), 16) / 255
    colors.attackMove.b = parseInt(hex.slice(5, 7), 16) / 255
  }
  updateAllTargetLines()
})

const colorWaypointInput = document.getElementById('color-waypoint') as HTMLInputElement
colorWaypointInput.addEventListener('input', () => {
  const hex = colorWaypointInput.value
  const colors = unitColors.get(selectedUnitId)
  if (colors) {
    colors.waypoint.r = parseInt(hex.slice(1, 3), 16) / 255
    colors.waypoint.g = parseInt(hex.slice(3, 5), 16) / 255
    colors.waypoint.b = parseInt(hex.slice(5, 7), 16) / 255
  }
  updateAllTargetLines()
})

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case 'a':
      selectedUnitId = 'A'
      document.getElementById('btn-unit-a')!.click()
      break
    case 'b':
      selectedUnitId = 'B'
      document.getElementById('btn-unit-b')!.click()
      break
    case 'm':
      document.getElementById('btn-move')!.click()
      break
    case 't':
      document.getElementById('btn-attack-move')!.click()
      break
    case 'l':
      showTargetLines = !showTargetLines
      updateAllTargetLines()
      break
    case 'w':
      showWaypoints = !showWaypoints
      // Force rebuild since waypoint visibility changed
      for (const unit of units.values()) {
        const state = getUnitLineState(unit.id)
        state.lastWaypointCount = -1 // Force dirty
      }
      updateAllTargetLines()
      break
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

initGrid()
updateSelectionRings()

// Set initial targets for demo
const unitA = units.get('A')!
unitA.targetCell = { x: 15, y: 5 }
unitA.isMoving = true

const unitB = units.get('B')!
unitB.targetCell = { x: 5, y: 15 }
unitB.activityType = 'attackMove'
unitB.isMoving = true

updateAllTargetLines()

engine.runRenderLoop(() => {
  for (const unit of units.values()) {
    tickUnitMovement(unit)
  }
  updateAllTargetLines()
  updateStatsPanel()
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for test harness
;(window as any).__testHarness = {
  scene, camera, engine, units,
  getSelectedUnit: () => selectedUnitId,
  getTargetLinesVisible: () => showTargetLines,
  getWaypointsVisible: () => showWaypoints,
}
