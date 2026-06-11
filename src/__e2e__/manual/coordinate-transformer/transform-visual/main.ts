/**
 * transform-visual/main.ts — WPos <-> Vector3 坐标转换可视化验收测试
 *
 * OpenRA 对照: src/OpenRA.Game/CoordinateTransformer.ts (新文件, 无直接 C# 对照)
 *
 * 可视化展示 OpenRA 世界坐标 (WPos) 与 Babylon.js 3D 世界坐标 (Vector3) 之间的转换:
 *   1. WPos → Vector3: 映射关系 x=X/WORLD_SCALE, y=Z/HEIGHT_SCALE, z=Y/WORLD_SCALE
 *   2. Vector3 → WPos: 反向映射 (含 round)
 *   3. 缓存命中/未命中统计 (LRU 缓存, 最大 1000 条目)
 *   4. 实时滑块控制 WPos 值, 3D 球体同步更新位置
 *
 * 坐标系约定:
 *   - WAngle 0 = 北, 逆时针递增 (在转换中不直接涉及角度)
 *   - OpenRA (X-right, Y-down, Z-height) → Babylon.js (X-right, Y-up, Z-forward)
 *   - WPos.Z (高度) 映射到 Vector3.Y (Babylon.js 世界高度)
 *   - WPos.Y (南-北) 映射到 Vector3.Z (Babylon.js 深度轴)
 */

import {
  Animation,
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
} from '@babylonjs/core'
import { WPos } from '../../../../OpenRA.Game/WPos'
import {
  wPosToVector3,
  vector3ToWPos,
  WORLD_SCALE,
  HEIGHT_SCALE,
  CACHE_SIZE,
  clearCoordinateCaches,
  getCacheSize,
} from '../../../../OpenRA.Game/CoordinateTransformer'

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

const sliderX = document.getElementById('slider-x') as HTMLInputElement
const sliderY = document.getElementById('slider-y') as HTMLInputElement
const sliderZ = document.getElementById('slider-z') as HTMLInputElement
const valX = document.getElementById('val-x')!
const valY = document.getElementById('val-y')!
const valZ = document.getElementById('val-z')!
const wposDisplay = document.getElementById('wpos-display')!
const vec3Display = document.getElementById('vec3-display')!

// ---------------------------------------------------------------------------
// Babylon.js Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 4, 16, new Vector3(5, 1, 5), scene)
camera.attachControl(canvas, true)

// Disable camera keyboard input so arrow keys are free for WPos stepping
// Mouse orbit/zoom remains functional
camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput')

camera.lowerRadiusLimit = 2
camera.upperRadiusLimit = 40

new HemisphericLight('hemi', new Vector3(0.3, 1, 0.3), scene)

// ---------------------------------------------------------------------------
// Reference Grid (5x5 cells, 1024 units each → 5 Babylon units)
// ---------------------------------------------------------------------------

const GRID_CELLS = 10
const GRID_SIZE_BABYLON = GRID_CELLS // each cell = 1024 su = 1 Babylon unit

let gridVisible = true
const gridNodes: (Mesh | LinesMesh)[] = []

function buildReferenceGrid(): void {
  // Ground plane
  const ground = MeshBuilder.CreateGround('refGround', {
    width: GRID_SIZE_BABYLON + 2,
    height: GRID_SIZE_BABYLON + 2,
  }, scene)
  ground.position = new Vector3(GRID_SIZE_BABYLON / 2, -0.01, GRID_SIZE_BABYLON / 2)
  const gmat = new StandardMaterial('gmat', scene)
  gmat.diffuseColor = new Color3(0.14, 0.17, 0.22)
  gmat.specularColor = new Color3(0, 0, 0)
  ground.material = gmat
  gridNodes.push(ground)

  // Grid lines
  for (let i = 0; i <= GRID_CELLS; i++) {
    const x = i * (GRID_SIZE_BABYLON / GRID_CELLS)
    // X-axis lines
    const hLine = MeshBuilder.CreateLines('hline', {
      points: [new Vector3(x, 0.005, 0), new Vector3(x, 0.005, GRID_SIZE_BABYLON)],
    }, scene)
    hLine.color = new Color3(0.3, 0.5, 0.8)
    hLine.alpha = 0.5
    gridNodes.push(hLine)

    // Z-axis lines
    const z = i * (GRID_SIZE_BABYLON / GRID_CELLS)
    const vLine = MeshBuilder.CreateLines('vline', {
      points: [new Vector3(0, 0.005, z), new Vector3(GRID_SIZE_BABYLON, 0.005, z)],
    }, scene)
    vLine.color = new Color3(0.3, 0.5, 0.8)
    vLine.alpha = 0.5
    gridNodes.push(vLine)
  }

  // Cell center markers (small dots at integer Babylon positions)
  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const bx = cx + 0.5 // center of cell
      const bz = cy + 0.5
      const dot = MeshBuilder.CreateSphere('dot', { diameter: 0.06 }, scene)
      dot.position = new Vector3(bx, 0.015, bz)
      const dmat = new StandardMaterial('dmat', scene)
      dmat.diffuseColor = new Color3(0.4, 0.6, 0.9)
      dmat.emissiveColor = new Color3(0.1, 0.2, 0.3)
      dmat.specularColor = new Color3(0, 0, 0)
      dot.material = dmat
      gridNodes.push(dot)
    }
  }

  // Coordinate axes (RGB = XYZ)
  const axisLen = GRID_SIZE_BABYLON + 1.5
  const xAxis = createAxisLine(
    new Vector3(0, 0.01, 0), new Vector3(axisLen, 0.01, 0),
    new Color3(1, 0.2, 0.2),
  )
  gridNodes.push(xAxis)
  const yAxis = createAxisLine(
    new Vector3(0, 0.01, 0), new Vector3(0, axisLen, 0),
    new Color3(0.2, 1, 0.2),
  )
  gridNodes.push(yAxis)
  const zAxis = createAxisLine(
    new Vector3(0, 0.01, 0), new Vector3(0, 0.01, axisLen),
    new Color3(0.2, 0.2, 1),
  )
  gridNodes.push(zAxis)

  // Origin marker
  const originSphere = MeshBuilder.CreateSphere('origin', { diameter: 0.2 }, scene)
  originSphere.position = new Vector3(0, 0.1, 0)
  const omat = new StandardMaterial('omat', scene)
  omat.diffuseColor = new Color3(1, 1, 1)
  omat.emissiveColor = new Color3(0.5, 0.5, 0.5)
  omat.specularColor = new Color3(0, 0, 0)
  originSphere.material = omat
  gridNodes.push(originSphere)

  // Corner cell labels — show WPos values
  for (const [cx, cz] of [[0, 0], [0, GRID_CELLS], [GRID_CELLS, 0], [GRID_CELLS, GRID_CELLS]]) {
    const bx = cx, bz = cz
    const labelSphere = MeshBuilder.CreateSphere('label', { diameter: 0.12 }, scene)
    labelSphere.position = new Vector3(bx, 0.08, bz)
    const lmat = new StandardMaterial('lmat', scene)
    lmat.diffuseColor = new Color3(0.6, 0.6, 0.3)
    lmat.emissiveColor = new Color3(0.2, 0.2, 0.1)
    lmat.specularColor = new Color3(0, 0, 0)
    labelSphere.material = lmat
    gridNodes.push(labelSphere)

    // Small text via additional dots (no GUI text in 3D easily)
    const dot2 = MeshBuilder.CreateSphere('dot2', { diameter: 0.08 }, scene)
    dot2.position = new Vector3(bx, 0.15, bz)
    const d2mat = new StandardMaterial('d2mat', scene)
    d2mat.diffuseColor = new Color3(0.8, 0.8, 0.3)
    d2mat.emissiveColor = new Color3(0.3, 0.3, 0)
    d2mat.specularColor = new Color3(0, 0, 0)
    dot2.material = d2mat
    gridNodes.push(dot2)
  }

  // Height reference line (vertical at origin corner)
  const heightRef = MeshBuilder.CreateLines('hRef', {
    points: Array.from({ length: 33 }, (_, i) => new Vector3(GRID_SIZE_BABYLON + 0.5, i * 0.25, 0)),
  }, scene)
  heightRef.color = new Color3(0.3, 0.7, 0.3)
  heightRef.alpha = 0.4
  gridNodes.push(heightRef)
}

function createAxisLine(from: Vector3, to: Vector3, color: Color3): LinesMesh {
  const line = MeshBuilder.CreateLines('axis', { points: [from, to] }, scene)
  line.color = color
  line.alpha = 0.8
  return line
}

function toggleGrid(): void {
  gridVisible = !gridVisible
  for (const node of gridNodes) {
    node.isVisible = gridVisible
    for (const mat of node.getChildMeshes()) {
      mat.isVisible = gridVisible
    }
  }
}

// ---------------------------------------------------------------------------
// Position Sphere (the WPos → Vector3 location indicator)
// ---------------------------------------------------------------------------

const posSphere = MeshBuilder.CreateSphere('posSphere', { diameter: 0.25 }, scene)
const posMat = new StandardMaterial('posMat', scene)
posMat.diffuseColor = new Color3(1, 0.5, 0.2)
posMat.emissiveColor = new Color3(0.5, 0.2, 0)
posMat.specularColor = new Color3(0.1, 0.1, 0.1)
posSphere.material = posMat

// Dropline from sphere to ground
let dropLine: LinesMesh | null = null
function updateDropLine(pos: Vector3): void {
  if (dropLine) dropLine.dispose()
  dropLine = MeshBuilder.CreateLines('dropline', {
    points: [pos, new Vector3(pos.x, 0.01, pos.z)],
  }, scene)
  dropLine.color = new Color3(1, 0.5, 0.2)
  dropLine.alpha = 0.5
}

// Ghost sphere showing the position on ground plane (Y=0)
const ghostSphere = MeshBuilder.CreateSphere('ghost', { diameter: 0.18 }, scene)
const ghostMat = new StandardMaterial('ghostMat', scene)
ghostMat.diffuseColor = new Color3(1, 0.3, 0.1)
ghostMat.alpha = 0.5
ghostMat.specularColor = new Color3(0, 0, 0)
ghostSphere.material = ghostMat

// ---------------------------------------------------------------------------
// Cache statistics tracking
// ---------------------------------------------------------------------------

let hitCount = 0
let missCount = 0
let totalQueries = 0

// We'll wrap the actual transform functions to track hits/misses
// Since the cache is internal to CoordinateTransformer, we track by
// checking cache size before/after each query
function trackedWPosToVector3(wpos: WPos): Vector3 {
  const cacheBefore = getCacheSize()
  totalQueries++
  const result = wPosToVector3(wpos)
  const cacheAfter = getCacheSize()
  if (cacheAfter === cacheBefore) {
    hitCount++
  } else {
    missCount++
  }
  return result
}

function trackedVector3ToWPos(vec: Vector3): WPos {
  const cacheBefore = getCacheSize()
  totalQueries++
  const result = vector3ToWPos(vec)
  const cacheAfter = getCacheSize()
  if (cacheAfter === cacheBefore) {
    hitCount++
  } else {
    missCount++
  }
  return result
}

// ---------------------------------------------------------------------------
// Update all UI and 3D state from slider values
// ---------------------------------------------------------------------------

let currentWpos: WPos = new WPos(5120, 5120, 512)

function updateFromSliders(): void {
  const wx = parseInt(sliderX.value)
  const wy = parseInt(sliderY.value)
  const wz = parseInt(sliderZ.value)

  valX.textContent = String(wx)
  valY.textContent = String(wy)
  valZ.textContent = String(wz)

  const wpos = new WPos(wx, wy, wz)
  currentWpos = wpos

  // WPos → Vector3
  const vec3 = trackedWPosToVector3(wpos)

  // Update WPos display
  wposDisplay.textContent = `${wpos.X}, ${wpos.Y}, ${wpos.Z}`

  // Update Vector3 display (6 decimal places)
  vec3Display.textContent = `${vec3.x.toFixed(6)}, ${vec3.y.toFixed(6)}, ${vec3.z.toFixed(6)}`

  // Update 3D sphere position
  posSphere.position = vec3
  ghostSphere.position = new Vector3(vec3.x, 0.03, vec3.z)
  updateDropLine(vec3)

  // Smoothly animate camera to look at the new sphere position
  const targetAnim = new Animation(
    'camTargetAnim',
    'target',
    60, // 60 FPS
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT,
  )
  const keys = [
    { frame: 0, value: camera.target.clone() },
    { frame: 30, value: vec3.clone() }, // 0.5 seconds at 60fps
  ]
  targetAnim.setKeys(keys)
  scene.stopAnimation(camera, 'target')
  scene.beginDirectAnimation(camera, [targetAnim], 0, 60, false)

  // Do reverse conversion and verify round-trip (used for cache stats tracking)
  // Round-trip should approximately recover original WPos
  const roundTripped = trackedVector3ToWPos(vec3)
  const rtDelta = Math.abs(roundTripped.X - wpos.X) + Math.abs(roundTripped.Y - wpos.Y) + Math.abs(roundTripped.Z - wpos.Z)

  // Display round-trip error (should be very small, typically 0-3 su due to float rounding)
  const rtEl = document.getElementById('rt-delta')
  if (rtEl) {
    rtEl.textContent = `${rtDelta} su (X:${Math.abs(roundTripped.X - wpos.X)}, Y:${Math.abs(roundTripped.Y - wpos.Y)}, Z:${Math.abs(roundTripped.Z - wpos.Z)})`
  }

  // Update cache stats display
  updateCacheStats()
}

function updateCacheStats(): void {
  const total = hitCount + missCount
  const hitRate = total > 0 ? ((hitCount / total) * 100).toFixed(1) : '0.0'

  document.getElementById('cache-wpos')!.textContent = `${getCacheSize()}`
  document.getElementById('cache-vec')!.textContent = `${hitRate}% hit`
  document.getElementById('cache-cell')!.textContent = `${total} queries`
  document.getElementById('cache-total')!.textContent =
    `CACHE_SIZE=${CACHE_SIZE} | WORLD_SCALE=1/1024 (${WORLD_SCALE.toFixed(6)}) | HEIGHT_SCALE=1/512 (${HEIGHT_SCALE.toFixed(6)})`
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const presets: Record<string, [number, number, number]> = {
  'preset-origin': [0, 0, 0],
  'preset-center': [5120, 5120, 0],
  'preset-corner': [10240, 10240, 0],
  'preset-elevated': [2560, 7680, 2048],
}

for (const [id, [x, y, z]] of Object.entries(presets)) {
  document.getElementById(id)!.addEventListener('click', () => {
    sliderX.value = String(x)
    sliderY.value = String(y)
    sliderZ.value = String(z)
    updateFromSliders()
  })
}

// ---------------------------------------------------------------------------
// Input handlers
// ---------------------------------------------------------------------------

for (const slider of [sliderX, sliderY, sliderZ]) {
  slider.addEventListener('input', updateFromSliders)
}

document.getElementById('btn-toggle-grid')!.addEventListener('click', toggleGrid)

document.getElementById('btn-clear-cache')!.addEventListener('click', () => {
  clearCoordinateCaches()
  hitCount = 0
  missCount = 0
  totalQueries = 0
  // Re-query to populate cache
  updateFromSliders()
})

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
// Keyboard controls
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 256 : 64
  switch (e.key) {
    case 'ArrowLeft': sliderX.value = String(Math.max(0, parseInt(sliderX.value) - step)); break
    case 'ArrowRight': sliderX.value = String(Math.min(10240, parseInt(sliderX.value) + step)); break
    case 'ArrowUp': sliderY.value = String(Math.min(10240, parseInt(sliderY.value) + step)); break
    case 'ArrowDown': sliderY.value = String(Math.max(0, parseInt(sliderY.value) - step)); break
    case 'PageUp': sliderZ.value = String(Math.min(4096, parseInt(sliderZ.value) + step)); break
    case 'PageDown': sliderZ.value = String(Math.max(0, parseInt(sliderZ.value) - step)); break
    case 'g': toggleGrid(); return
    case 'c': document.getElementById('btn-clear-cache')!.click(); return
    default: return
  }
  updateFromSliders()
})

// ---------------------------------------------------------------------------
// Stress test: rapidly query many WPos values to verify cache behavior
// ---------------------------------------------------------------------------

function runStressTest(): void {
  const start = performance.now()
  let count = 0
  for (let i = 0; i < 200; i++) {
    const wpos = new WPos(
      Math.floor(Math.random() * 10240),
      Math.floor(Math.random() * 10240),
      Math.floor(Math.random() * 4096),
    )
    trackedWPosToVector3(wpos)
    count++
  }
  const end = performance.now()
  console.log(`[Stress Test] ${count} conversions in ${(end - start).toFixed(2)}ms (avg ${((end - start) / count).toFixed(3)}ms/conv)`)
  console.log(`[Stress Test] Cache size: ${getCacheSize()}, Hit rate: ${totalQueries > 0 ? ((hitCount / totalQueries) * 100).toFixed(1) : 0}%`)
  updateCacheStats()
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

buildReferenceGrid()
updateFromSliders()

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
  getCurrentWPos: () => currentWpos,
  getCurrentVector3: () => posSphere.position.clone(),
  getCacheSize,
  getHitRate: () => totalQueries > 0 ? (hitCount / totalQueries) * 100 : 0,
  setWPos: (x: number, y: number, z: number) => {
    sliderX.value = String(x)
    sliderY.value = String(y)
    sliderZ.value = String(z)
    updateFromSliders()
  },
  clearCache: () => {
    clearCoordinateCaches()
    hitCount = 0
    missCount = 0
    totalQueries = 0
  },
  runStressTest,
  toggleGrid,
}
