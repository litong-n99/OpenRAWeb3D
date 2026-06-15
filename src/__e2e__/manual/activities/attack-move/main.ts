/**
 * main.ts -- 攻击移动 (AttackMove) 人工验收测试
 *
 * 测试目标:
 *   1. 验证 AttackMoveActivity 的核心行为：移动中扫描敌人、发现后中断移动
 *   2. 验证扫描范围可视化（半透明圆环）
 *   3. 验证状态转换：移动中 → 攻击中 → 恢复移动
 *   4. 验证目标线在中断期间保持指向原目标
 *   5. 验证多敌人场景下的行为
 *
 * OpenRA 对照:
 *   - OpenRA.Mods.Common/Activities/Move/AttackMoveActivity.cs
 *   - tick() logic: scanForTarget -> if found, cancel move, queue attack
 *   - after combat, queue new move to resume
 *
 * 本测试使用纯 Babylon.js 模拟 AttackMove 行为。
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
// Colors
// ---------------------------------------------------------------------------

const COLOR_FRIENDLY = new Color3(0.20, 0.60, 0.95)   // #3399F2
const COLOR_ENEMY = new Color3(0.91, 0.27, 0.38)       // #E94560
const COLOR_TARGET_LINE = new Color3(0.91, 0.27, 0.38) // Red for AttackMove
const COLOR_SCAN_SAFE = new Color3(0.27, 0.80, 0.27)   // #44CC44
const COLOR_SCAN_ALERT = new Color3(1.0, 0.8, 0.0)     // #FFCC00
const COLOR_SCAN_COMBAT = new Color3(0.91, 0.27, 0.38) // #E94560
const COLOR_TARGET = new Color3(0.93, 0.20, 0.20)      // #EE3333

// ---------------------------------------------------------------------------
// Unit State
// ---------------------------------------------------------------------------

type UnitState = 'moving' | 'attacking' | 'idle' | 'resuming'

interface Unit {
  cellX: number
  cellY: number
  posX: number
  posZ: number
  targetX: number
  targetY: number
  state: UnitState
  scanRange: number
  speed: number
  attackDuration: number
  attackTimer: number
  interruptCount: number
  node: TransformNode
  body: Mesh
  scanRing: Mesh | null
  scanMat: StandardMaterial | null
}

interface Enemy {
  cellX: number
  cellY: number
  posX: number
  posZ: number
  speed: number
  patrolPath: { x: number; y: number }[]
  patrolIndex: number
  node: TransformNode
  body: Mesh
  alive: boolean
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
// Create Friendly Unit
// ---------------------------------------------------------------------------

let unit: Unit

function createUnit(): void {
  const node = new TransformNode('unit', scene)
  const center = cellCenter(2, 10)
  node.position.set(center.x, 0, center.z)

  const body = MeshBuilder.CreateBox('unitBody', { width: 0.6, height: 0.4, depth: 0.6 }, scene)
  body.parent = node
  body.position.y = 0.2
  const mat = new StandardMaterial('unitMat', scene)
  mat.diffuseColor = COLOR_FRIENDLY
  mat.emissiveColor = new Color3(0.1, 0.3, 0.5)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  // Scan ring (torus)
  const ring = MeshBuilder.CreateTorus('scanRing', { diameter: 1, thickness: 0.03, tessellation: 64 }, scene)
  ring.parent = node
  ring.position.y = 0.05
  ring.rotation.x = Math.PI / 2
  const ringMat = new StandardMaterial('scanMat', scene)
  ringMat.emissiveColor = COLOR_SCAN_SAFE
  ringMat.alpha = 0.3
  ringMat.backFaceCulling = false
  ring.material = ringMat

  unit = {
    cellX: 2, cellY: 10,
    posX: center.x, posZ: center.z,
    targetX: 17, targetY: 10,
    state: 'idle',
    scanRange: 5,
    speed: 0.025,
    attackDuration: 60, // frames (~1 sec at 60fps)
    attackTimer: 0,
    interruptCount: 0,
    node, body,
    scanRing: ring,
    scanMat: ringMat,
  }
}

createUnit()

// ---------------------------------------------------------------------------
// Create Enemies
// ---------------------------------------------------------------------------

const enemies: Enemy[] = []

function createEnemy(id: number, startX: number, startY: number, patrol: { x: number; y: number }[]): Enemy {
  const node = new TransformNode(`enemy_${id}`, scene)
  const center = cellCenter(startX, startY)
  node.position.set(center.x, 0, center.z)

  const body = MeshBuilder.CreateBox(`enemyBody_${id}`, { width: 0.5, height: 0.35, depth: 0.5 }, scene)
  body.parent = node
  body.position.y = 0.175
  const mat = new StandardMaterial(`enemyMat_${id}`, scene)
  mat.diffuseColor = COLOR_ENEMY
  mat.emissiveColor = new Color3(0.5, 0.1, 0.1)
  mat.specularColor = new Color3(0, 0, 0)
  body.material = mat

  const enemy: Enemy = {
    cellX: startX, cellY: startY,
    posX: center.x, posZ: center.z,
    speed: 0.015,
    patrolPath: patrol,
    patrolIndex: 0,
    node, body,
    alive: true,
  }
  enemies.push(enemy)
  return enemy
}

// ---------------------------------------------------------------------------
// Target Line — Optimized: only recreate when target changes, update position when unit moves
// ---------------------------------------------------------------------------

let targetLineMesh: LinesMesh | null = null
let targetMarkerMesh: Mesh | null = null
let lastTargetX = -1
let lastTargetY = -1

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
  const unitPos = new Vector3(unit.posX, 0.3, unit.posZ)
  const targetPos = new Vector3(
    unit.targetX * CELL_SIZE + CELL_SIZE / 2,
    0.05,
    unit.targetY * CELL_SIZE + CELL_SIZE / 2
  )

  // Check if target changed (needs full rebuild)
  const targetChanged = unit.targetX !== lastTargetX || unit.targetY !== lastTargetY

  if (targetChanged) {
    // Dispose old meshes
    if (targetLineMesh) { targetLineMesh.dispose(); targetLineMesh = null }
    if (targetMarkerMesh) { targetMarkerMesh.dispose(); targetMarkerMesh = null }

    lastTargetX = unit.targetX
    lastTargetY = unit.targetY

    // Create new dashed line
    const dir = targetPos.subtract(unitPos)
    const totalLen = dir.length()
    if (totalLen > 0.01) {
      targetLineMesh = createDashedLine('targetLine', unitPos, targetPos, COLOR_TARGET_LINE)
    }

    // Create target marker (only once per target)
    targetMarkerMesh = MeshBuilder.CreateSphere('targetMarker', { diameter: 0.4 }, scene)
    targetMarkerMesh.position = targetPos.clone()
    targetMarkerMesh.position.y = 0.2
    const markerMat = new StandardMaterial('targetMat', scene)
    markerMat.diffuseColor = COLOR_TARGET
    markerMat.emissiveColor = new Color3(0.5, 0.1, 0.1)
    markerMat.specularColor = new Color3(0, 0, 0)
    targetMarkerMesh.material = markerMat
  } else if (targetLineMesh && unit.state !== 'idle') {
    // Unit moved but target unchanged — rebuild line with new start position
    targetLineMesh.dispose()
    targetLineMesh = createDashedLine('targetLine', unitPos, targetPos, COLOR_TARGET_LINE)
  }

  // Hide target line when idle (reached destination)
  if (unit.state === 'idle' && targetLineMesh) {
    targetLineMesh.dispose()
    targetLineMesh = null
  }
  if (unit.state === 'idle' && targetMarkerMesh) {
    targetMarkerMesh.dispose()
    targetMarkerMesh = null
    lastTargetX = -1
    lastTargetY = -1
  }
}

// ---------------------------------------------------------------------------
// Attack Move Logic (simulates AttackMoveActivity.tick)
// ---------------------------------------------------------------------------

function distanceToEnemy(unit: Unit, enemy: Enemy): number {
  const dx = unit.posX - enemy.posX
  const dz = unit.posZ - enemy.posZ
  return Math.sqrt(dx * dx + dz * dz)
}

function findEnemyInRange(unit: Unit): Enemy | null {
  const rangeWorld = unit.scanRange * CELL_SIZE
  for (const enemy of enemies) {
    if (!enemy.alive) continue
    const dist = distanceToEnemy(unit, enemy)
    if (dist <= rangeWorld) {
      return enemy
    }
  }
  return null
}

function tickAttackMove(): void {
  const enemyInRange = findEnemyInRange(unit)

  switch (unit.state) {
    case 'idle': {
      if (enemyInRange) {
        unit.state = 'attacking'
        unit.attackTimer = unit.attackDuration
        unit.interruptCount++
        showAlert()
      } else {
        // Move toward target
        moveTowardTarget()
      }
      break
    }

    case 'moving': {
      if (enemyInRange) {
        // Interrupt: cancel move, start attack
        unit.state = 'attacking'
        unit.attackTimer = unit.attackDuration
        unit.interruptCount++
        showAlert()
      } else {
        // Continue moving
        moveTowardTarget()
      }
      break
    }

    case 'attacking': {
      unit.attackTimer--
      if (unit.attackTimer <= 0) {
        // "Kill" the enemy
        if (enemyInRange) {
          enemyInRange.alive = false
          enemyInRange.node.setEnabled(false)
        }
        // Resume moving
        unit.state = 'resuming'
      }
      break
    }

    case 'resuming': {
      if (enemyInRange && enemyInRange.alive) {
        // Another enemy found, attack again
        unit.state = 'attacking'
        unit.attackTimer = unit.attackDuration
        unit.interruptCount++
        showAlert()
      } else {
        // Resume moving toward original target
        unit.state = 'moving'
        moveTowardTarget()
      }
      break
    }
  }

  // Update scan ring
  updateScanRing(enemyInRange)
}

function moveTowardTarget(): void {
  const targetPos = cellCenter(unit.targetX, unit.targetY)
  const dx = targetPos.x - unit.posX
  const dz = targetPos.z - unit.posZ
  const dist = Math.sqrt(dx * dx + dz * dz)

  if (dist < unit.speed) {
    unit.posX = targetPos.x
    unit.posZ = targetPos.z
    unit.cellX = unit.targetX
    unit.cellY = unit.targetY
    unit.state = 'idle'
  } else {
    unit.posX += (dx / dist) * unit.speed
    unit.posZ += (dz / dist) * unit.speed
    unit.state = 'moving'
  }

  unit.node.position.x = unit.posX
  unit.node.position.z = unit.posZ
}

function updateScanRing(enemyInRange: Enemy | null): void {
  if (!unit.scanRing || !unit.scanMat) return

  // Update ring size based on scan range
  const diameter = unit.scanRange * CELL_SIZE * 2
  unit.scanRing.scaling.set(diameter, diameter, diameter)

  // Update color based on state
  if (unit.state === 'attacking') {
    unit.scanMat.emissiveColor = COLOR_SCAN_COMBAT
    unit.scanMat.alpha = 0.5
  } else if (enemyInRange) {
    unit.scanMat.emissiveColor = COLOR_SCAN_ALERT
    unit.scanMat.alpha = 0.4
  } else {
    unit.scanMat.emissiveColor = COLOR_SCAN_SAFE
    unit.scanMat.alpha = 0.25
  }
}

// ---------------------------------------------------------------------------
// Enemy Patrol Logic
// ---------------------------------------------------------------------------

function tickEnemies(): void {
  for (const enemy of enemies) {
    if (!enemy.alive) continue
    if (enemy.patrolPath.length === 0) continue

    const target = cellCenter(enemy.patrolPath[enemy.patrolIndex].x, enemy.patrolPath[enemy.patrolIndex].y)
    const dx = target.x - enemy.posX
    const dz = target.z - enemy.posZ
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < enemy.speed) {
      enemy.patrolIndex = (enemy.patrolIndex + 1) % enemy.patrolPath.length
    } else {
      enemy.posX += (dx / dist) * enemy.speed
      enemy.posZ += (dz / dist) * enemy.speed
    }

    enemy.node.position.x = enemy.posX
    enemy.node.position.z = enemy.posZ
  }
}

// ---------------------------------------------------------------------------
// Alert UI
// ---------------------------------------------------------------------------

let alertTimer = 0

function showAlert(): void {
  const alertEl = document.getElementById('enemy-alert')!
  alertEl.classList.add('visible')
  alertTimer = 90 // Show for ~1.5 seconds
}

function tickAlert(): void {
  if (alertTimer > 0) {
    alertTimer--
    if (alertTimer <= 0) {
      document.getElementById('enemy-alert')!.classList.remove('visible')
    }
  }
}

// ---------------------------------------------------------------------------
// Stats Panel
// ---------------------------------------------------------------------------

function updateStatsPanel(): void {
  const stateNames: Record<string, string> = {
    idle: '空闲',
    moving: '移动中',
    attacking: '攻击中',
    resuming: '恢复移动',
  }
  document.getElementById('stat-state')!.textContent = stateNames[unit.state] || unit.state

  const stateEl = document.getElementById('stat-state')!
  stateEl.className = 'value'
  if (unit.state === 'attacking') stateEl.classList.add('attack')
  else if (unit.state === 'moving') stateEl.classList.add('move')

  document.getElementById('stat-scan-range')!.textContent = `${unit.scanRange} 格`

  const enemyInRange = findEnemyInRange(unit)
  document.getElementById('stat-enemy-found')!.textContent = enemyInRange ? '是' : '否'
  const enemyEl = document.getElementById('stat-enemy-found')!
  enemyEl.className = 'value'
  if (enemyInRange) enemyEl.classList.add('attack')

  document.getElementById('stat-interrupts')!.textContent = String(unit.interruptCount)

  const activityEl = document.getElementById('stat-activity')!
  activityEl.textContent = 'AttackMove'
  activityEl.className = 'value attack'
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

function clearEnemies(): void {
  for (const enemy of enemies) {
    enemy.node.dispose()
  }
  enemies.length = 0
}

function resetUnit(): void {
  unit.cellX = 2
  unit.cellY = 10
  const center = cellCenter(2, 10)
  unit.posX = center.x
  unit.posZ = center.z
  unit.targetX = 17
  unit.targetY = 10
  unit.state = 'idle'
  unit.attackTimer = 0
  unit.interruptCount = 0
  unit.node.position.set(center.x, 0, center.z)
}

function presetDirect(): void {
  clearEnemies()
  resetUnit()
  unit.targetX = 17
  unit.targetY = 10
  unit.state = 'moving'
}

function presetEnemyMid(): void {
  clearEnemies()
  resetUnit()
  unit.targetX = 17
  unit.targetY = 10
  unit.state = 'moving'
  // Enemy in the middle of the path
  createEnemy(0, 10, 10, [
    { x: 9, y: 10 }, { x: 11, y: 10 },
  ])
}

function presetEnemyFar(): void {
  clearEnemies()
  resetUnit()
  unit.targetX = 17
  unit.targetY = 10
  unit.state = 'moving'
  // Enemy appears later (near target)
  createEnemy(0, 15, 10, [
    { x: 14, y: 10 }, { x: 16, y: 10 },
  ])
}

function presetMultipleEnemies(): void {
  clearEnemies()
  resetUnit()
  unit.targetX = 17
  unit.targetY = 10
  unit.state = 'moving'
  // Multiple enemies patrolling
  createEnemy(0, 8, 8, [{ x: 7, y: 8 }, { x: 9, y: 8 }, { x: 9, y: 12 }, { x: 7, y: 12 }])
  createEnemy(1, 12, 12, [{ x: 11, y: 12 }, { x: 13, y: 12 }, { x: 13, y: 8 }, { x: 11, y: 8 }])
  createEnemy(2, 15, 10, [{ x: 14, y: 10 }, { x: 16, y: 10 }])
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

  unit.targetX = gx
  unit.targetY = gy
  if (unit.state === 'idle') {
    unit.state = 'moving'
  }
})

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

document.getElementById('btn-reset')!.addEventListener('click', () => {
  clearEnemies()
  resetUnit()
  updateTargetLine()
})

document.getElementById('btn-toggle-enemies')!.addEventListener('click', () => {
  for (const enemy of enemies) {
    enemy.node.setEnabled(!enemy.node.isEnabled())
  }
})

for (const [id, range] of [['btn-scan-3', 3], ['btn-scan-5', 5], ['btn-scan-8', 8]] as const) {
  document.getElementById(id)!.addEventListener('click', () => {
    unit.scanRange = range
    for (const b of ['btn-scan-3', 'btn-scan-5', 'btn-scan-8']) {
      document.getElementById(b)!.classList.toggle('active', b === id)
    }
  })
}

document.getElementById('btn-scene-direct')!.addEventListener('click', presetDirect)
document.getElementById('btn-scene-enemy-mid')!.addEventListener('click', presetEnemyMid)
document.getElementById('btn-scene-enemy-far')!.addEventListener('click', presetEnemyFar)
document.getElementById('btn-scene-multiple')!.addEventListener('click', presetMultipleEnemies)

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case 'r': document.getElementById('btn-reset')!.click(); break
    case '1': document.getElementById('btn-scene-direct')!.click(); break
    case '2': document.getElementById('btn-scene-enemy-mid')!.click(); break
    case '3': document.getElementById('btn-scene-enemy-far')!.click(); break
    case '4': document.getElementById('btn-scene-multiple')!.click(); break
  }
})

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

presetEnemyMid()

engine.runRenderLoop(() => {
  tickEnemies()
  tickAttackMove()
  tickAlert()
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
  getUnit: () => unit,
  getEnemies: () => enemies,
  getUnitState: () => unit.state,
  getInterruptCount: () => unit.interruptCount,
  getScanRange: () => unit.scanRange,
}
