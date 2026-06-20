/**
 * main.ts — Map Loading & Actor Spawning 人工验收测试
 *
 * 测试目标:
 *   1. 地形渲染 — 地面网格代表 map terrain（16x16 cells）
 *   2. Actor 生成可视化 — 6 个彩色方块代表不同 actor 类型
 *   3. Player 颜色编码 — Red=Player1, Blue=Player2
 *   4. 信息面板 — actor count, player count, map metadata
 *   5. 摄像机可旋转 — ArcRotateCamera 完整交互
 *
 * OpenRA 对照:
 *   - Map.ts          — Map binary data parsed → terrain mesh generated (TerrainMeshBuilder)
 *   - TraitFactory.ts — createActor() spawns actors from map entries with traits
 *   - World.ts        — _createPlayers() + loadComplete() fires traits in order
 *
 * 自包含 — 不导入实际 World/TraitFactory/Map，仅使用 Babylon.js 核心 API。
 */

import { Engine } from '@babylonjs/core'
import { Scene } from '@babylonjs/core'
import { ArcRotateCamera } from '@babylonjs/core'
import { HemisphericLight } from '@babylonjs/core'
import { Vector3 } from '@babylonjs/core'
import { Color3, Color4 } from '@babylonjs/core'
import { MeshBuilder } from '@babylonjs/core'
import { StandardMaterial } from '@babylonjs/core'
import { Mesh } from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Map configuration (simulated map metadata)
// ---------------------------------------------------------------------------

const MAP_WIDTH_CELLS = 16
const MAP_HEIGHT_CELLS = 16
const CELL_SIZE = 0.8  // world units per cell
const MAP_WIDTH = MAP_WIDTH_CELLS * CELL_SIZE   // 12.8 units
const MAP_HEIGHT = MAP_HEIGHT_CELLS * CELL_SIZE  // 12.8 units

// ---------------------------------------------------------------------------
// Actor definitions (simulating map actor entries)
// ---------------------------------------------------------------------------

interface ActorDef {
  name: string       // actor type identifier
  owner: 1 | 2       // Player 1 (Red) or Player 2 (Blue)
  position: [number, number]  // cell coordinates (col, row)
  size: [number, number, number]  // box dimensions (width, height, depth)
  offsetY: number    // Y offset above terrain for the box center
}

const ACTORS: ActorDef[] = [
  // Player 1 (Red) units
  { name: 'MCV',       owner: 1, position: [3, 3],   size: [0.9, 0.6, 0.9], offsetY: 0.45 },
  { name: 'Infantry',  owner: 1, position: [5, 1],   size: [0.35, 0.55, 0.35], offsetY: 0.35 },
  { name: 'PowerPlant', owner: 1, position: [1, 5],  size: [1.0, 0.5, 0.8], offsetY: 0.4 },

  // Player 2 (Blue) units
  { name: 'MCV',       owner: 2, position: [12, 12], size: [0.9, 0.6, 0.9], offsetY: 0.45 },
  { name: 'Infantry',  owner: 2, position: [14, 10], size: [0.35, 0.55, 0.35], offsetY: 0.35 },
  { name: 'Barracks',  owner: 2, position: [10, 14], size: [1.0, 0.5, 0.7], offsetY: 0.4 },
]

// ---------------------------------------------------------------------------
// Player color palettes
// ---------------------------------------------------------------------------

const PLAYER_COLORS: Record<number, { diffuse: Color3; emissive: Color3; label: Color3 }> = {
  1: {
    diffuse: new Color3(0.88, 0.18, 0.18),  // Red
    emissive: new Color3(0, 0, 0),
    label: new Color3(0.95, 0.35, 0.35),
  },
  2: {
    diffuse: new Color3(0.18, 0.35, 0.88),  // Blue
    emissive: new Color3(0, 0, 0),
    label: new Color3(0.35, 0.55, 0.95),
  },
}

const HIGHLIGHT_EMISSIVE = new Color3(0.35, 0.35, 0.35)
const HIGHLIGHT_EMISSIVE_OTHER = new Color3(0.02, 0.02, 0.02)

// ---------------------------------------------------------------------------
// Canvas discovery / creation
// ---------------------------------------------------------------------------

let canvas = document.querySelector('#sandbox canvas') as HTMLCanvasElement | null
if (!canvas) {
  canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.outline = 'none'
  canvas.style.touchAction = 'none'
  document.getElementById('sandbox')!.appendChild(canvas)
}

// ---------------------------------------------------------------------------
// Babylon.js initialization
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: false,
  antialias: true,
})

const scene = new Scene(engine)
scene.clearColor = new Color4(0.10, 0.13, 0.18, 1.0)  // dark sky-like background

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

// Center the camera on the map midpoint (7.5 cells from origin at 0.8 units/cell)
const mapCenterX = MAP_WIDTH_CELLS / 2 * CELL_SIZE
const mapCenterZ = MAP_HEIGHT_CELLS / 2 * CELL_SIZE

const camera = new ArcRotateCamera(
  'testCamera',
  -Math.PI / 4,   // alpha: front-right orbit
  Math.PI / 3.5,   // beta: ~51 degrees elevation
  18,              // radius
  new Vector3(mapCenterX, 0, mapCenterZ),
  scene,
)
camera.lowerRadiusLimit = 6
camera.upperRadiusLimit = 45
camera.lowerBetaLimit = 0.15
camera.upperBetaLimit = Math.PI / 2 - 0.05
camera.attachControl(canvas, true)

// Save initial camera state for reset
const INITIAL_CAMERA_ALPHA = -Math.PI / 4
const INITIAL_CAMERA_BETA = Math.PI / 3.5
const INITIAL_CAMERA_RADIUS = 18
const INITIAL_CAMERA_TARGET = new Vector3(mapCenterX, 0, mapCenterZ)

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

const sunLight = new HemisphericLight('sunLight', new Vector3(0.6, 1, 0.4), scene)
sunLight.intensity = 0.9

const fillLight = new HemisphericLight('fillLight', new Vector3(-0.4, 0.15, -0.6), scene)
fillLight.intensity = 0.3
fillLight.diffuse = new Color3(0.5, 0.55, 0.6)

// ---------------------------------------------------------------------------
// Terrain ground plane + grid
// ---------------------------------------------------------------------------

// --- Terrain platform (main ground) ---
const terrainMat = new StandardMaterial('terrainMat', scene)
terrainMat.diffuseColor = new Color3(0.22, 0.35, 0.18)  // terrain green (Clear type)
terrainMat.specularColor = Color3.Black()
terrainMat.backFaceCulling = false

const terrainPlane = MeshBuilder.CreateGround(
  'terrainPlane',
  { width: MAP_WIDTH, height: MAP_HEIGHT, subdivisions: MAP_WIDTH_CELLS },
  scene,
)
terrainPlane.position.set(mapCenterX, -0.02, mapCenterZ)
terrainPlane.material = terrainMat
terrainPlane.receiveShadows = false

// --- Dark border base extending beyond terrain ---
const borderMat = new StandardMaterial('borderMat', scene)
borderMat.diffuseColor = new Color3(0.08, 0.09, 0.11)
borderMat.specularColor = Color3.Black()

const borderPlane = MeshBuilder.CreateGround(
  'borderPlane',
  { width: MAP_WIDTH + 4, height: MAP_HEIGHT + 4, subdivisions: 1 },
  scene,
)
borderPlane.position.set(mapCenterX, -0.1, mapCenterZ)
borderPlane.material = borderMat

// --- Cell grid lines (1-unit spacing = 1 cell) ---
/**
 * Creates grid lines at each cell boundary using BABYLON.CreateLines.
 * Renders 17 horizontal lines (rows 0-16) and 17 vertical lines (cols 0-16)
 * at Y=-0.01 (just above the terrain plane).
 * Line color: rgbsubtle dark green(#2D4024) for visibility against lighter terrain.
 */
function createGridLines(): void {
  const lineColor = new Color3(0.18, 0.25, 0.14)  // subtle darker green for grid
  const lineY = -0.01  // just above terrain

  // X-aligned lines (along the width, at each row)
  for (let z = 0; z <= MAP_HEIGHT_CELLS; z++) {
    const worldZ = z * CELL_SIZE
    const line = MeshBuilder.CreateLines(
      `gridZ_${z}`,
      {
        points: [new Vector3(0, lineY, worldZ), new Vector3(MAP_WIDTH, lineY, worldZ)],
      },
      scene,
    )
    line.color = lineColor
    line.renderingGroupId = 0
  }

  // Z-aligned lines (along the height, at each column)
  for (let x = 0; x <= MAP_WIDTH_CELLS; x++) {
    const worldX = x * CELL_SIZE
    const line = MeshBuilder.CreateLines(
      `gridX_${x}`,
      {
        points: [new Vector3(worldX, lineY, 0), new Vector3(worldX, lineY, MAP_HEIGHT)],
      },
      scene,
    )
    line.color = lineColor
    line.renderingGroupId = 0
  }
}

createGridLines()

// --- Origin corner marker (0,0) ---
const originMarker = MeshBuilder.CreateLines(
  'originMarker',
  {
    points: [
      new Vector3(-0.6, 0.01, 0),
      new Vector3(0.6, 0.01, 0),
      new Vector3(0, 0.01, -0.6),
      new Vector3(0, 0.01, 0.6),
    ],
  },
  scene,
)
originMarker.color = new Color3(0.7, 0.7, 0.7)
originMarker.renderingGroupId = 0

// --- Cell decoration: checkered pattern for visual cell distinction ---
/**
 * Creates a checkered cell-decoration pattern on the terrain surface.
 * Every cell gets a slightly-raised ground plane at Y=-0.005:
 *   - Even (row+col): cellMatA (lighter green #3D5E30)
 *   - Odd  (row+col): cellMatB (darker green #33542B)
 * Both materials are created; cellMatB is NOT dead — applied to alternating cells.
 */
function createCheckeredCells(): void {
  const cellMatA = new StandardMaterial('cellMatA', scene)
  cellMatA.diffuseColor = new Color3(0.24, 0.37, 0.19)  // #3D5E30 slightly lighter green
  cellMatA.specularColor = Color3.Black()
  cellMatA.backFaceCulling = false

  const cellMatB = new StandardMaterial('cellMatB', scene)
  cellMatB.diffuseColor = new Color3(0.20, 0.33, 0.17)  // #33542B slightly darker green
  cellMatB.specularColor = Color3.Black()
  cellMatB.backFaceCulling = false

  const halfSize = CELL_SIZE / 2

  for (let row = 0; row < MAP_HEIGHT_CELLS; row++) {
    for (let col = 0; col < MAP_WIDTH_CELLS; col++) {
      const cx = col * CELL_SIZE + halfSize
      const cz = row * CELL_SIZE + halfSize

      const cellPlane = MeshBuilder.CreateGround(
        `cellDeco_${col}_${row}`,
        { width: CELL_SIZE * 0.96, height: CELL_SIZE * 0.96, subdivisions: 1 },
        scene,
      )
      cellPlane.position.set(cx, -0.005, cz)
      // Alternate colors for checkered pattern
      cellPlane.material = (row + col) % 2 === 0 ? cellMatA : cellMatB
      cellPlane.receiveShadows = false
    }
  }
}

createCheckeredCells()

// ---------------------------------------------------------------------------
// Actor meshes (colored boxes representing spawned game units)
// ---------------------------------------------------------------------------

interface ActorMesh {
  mesh: Mesh
  pillar: Mesh
  labelMesh: Mesh
  actorDef: ActorDef
  material: StandardMaterial
}

const actorMeshList: ActorMesh[] = []

/** Monotonically increasing counter for deterministic mesh names (replaces Date.now()+Math.random()). */
let actorIndex = 0

/**
 * Converts cell coordinates (col, row) to world-space Vector3.
 * Each cell has its center at (col*CELL_SIZE + CELL_SIZE/2, 0, row*CELL_SIZE + CELL_SIZE/2).
 * The Y component is always 0; the caller adds offsetY for the actor's vertical placement.
 */
function cellToWorld(col: number, row: number): Vector3 {
  // Cell (col, row) maps to world position with cell center offset
  return new Vector3(col * CELL_SIZE + CELL_SIZE / 2, 0, row * CELL_SIZE + CELL_SIZE / 2)
}

/**
 * Creates a visual actor representation from an ActorDef:
 *   - A colored box (main mesh) at the world position with offsetY
 *   - A thin cylinder (pillar) connecting the box to the terrain
 *   - A billboard label plane above the box
 * Returns an ActorMesh record that gets pushed into actorMeshList for highlight control.
 */
function createActorMesh(def: ActorDef, scene: Scene): ActorMesh {
  const idx = actorIndex++
  const colors = PLAYER_COLORS[def.owner]
  const worldPos = cellToWorld(def.position[0], def.position[1])

  // --- Main actor box (deterministic name using sequential index) ---
  const mat = new StandardMaterial(`actorMat_${def.name}_P${def.owner}_${idx}`, scene)
  mat.diffuseColor = colors.diffuse.clone()
  mat.specularColor = new Color3(0.15, 0.12, 0.12)
  mat.emissiveColor = colors.emissive.clone()

  const box = MeshBuilder.CreateBox(
    `actor_${def.name}_P${def.owner}_${idx}`,
    { width: def.size[0], height: def.size[1], depth: def.size[2] },
    scene,
  )
  box.position.set(worldPos.x, def.offsetY, worldPos.z)
  box.material = mat
  box.renderingGroupId = 1

  // --- Pillar under actor (connects to terrain) ---
  const pillarMat = new StandardMaterial(`pillar_${def.name}_P${def.owner}_${idx}`, scene)
  pillarMat.diffuseColor = colors.diffuse.clone().scale(0.5)
  pillarMat.specularColor = Color3.Black()

  const pillar = MeshBuilder.CreateCylinder(
    `pillar_${def.name}_P${def.owner}_${idx}`,
    { height: def.offsetY * 1.8, diameter: 0.12 },
    scene,
  )
  pillar.position.set(worldPos.x, def.offsetY * 0.45, worldPos.z)
  pillar.material = pillarMat
  pillar.renderingGroupId = 1

  // --- Label billboard above actor ---
  const labelMat = new StandardMaterial(`label_${def.name}_P${def.owner}_${idx}`, scene)
  labelMat.emissiveColor = colors.label.clone()
  labelMat.disableLighting = true
  labelMat.backFaceCulling = false

  const labelPlane = MeshBuilder.CreatePlane(
    `labelPlane_${def.name}_P${def.owner}_${idx}`,
    { width: 1.2, height: 0.3 },
    scene,
  )
  labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
  labelPlane.position.set(
    worldPos.x,
    def.offsetY + def.size[1] / 2 + 0.25,
    worldPos.z,
  )
  labelPlane.material = labelMat
  labelPlane.renderingGroupId = 1

  const result: ActorMesh = { mesh: box, pillar, labelMesh: labelPlane, actorDef: def, material: mat }
  actorMeshList.push(result)

  console.log(
    `  [Actor] ${def.name} (P${def.owner}) @ cell(${def.position[0]}, ${def.position[1]}) ` +
    `→ world(${worldPos.x.toFixed(2)}, ${def.offsetY}, ${worldPos.z.toFixed(2)})`,
  )

  return result
}

// Create all actor meshes from definitions
for (const def of ACTORS) {
  createActorMesh(def, scene)
}

// ---------------------------------------------------------------------------
// Dynamic actor info panel — populates C3/C4 DOM from actual world positions
// (fixes BLOCKER B1+B2: no more hardcoded/incorrect static HTML positions)
// ---------------------------------------------------------------------------

const C3_P1_SPAN_IDS: Record<string, string> = {
  'MCV': 'stat-p1-mcv',
  'Infantry': 'stat-p1-inf',
  'PowerPlant': 'stat-p1-pp',
}

const C4_P2_SPAN_IDS: Record<string, string> = {
  'MCV': 'stat-p2-mcv',
  'Infantry': 'stat-p2-inf',
  'Barracks': 'stat-p2-bar',
}

function updateActorInfoPanel(): void {
  for (const actor of actorMeshList) {
    const pos = actor.mesh.position
    const cell = actor.actorDef.position
    const text = `cell(${cell[0]},${cell[1]}) world(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`

    if (actor.actorDef.owner === 1) {
      const spanId = C3_P1_SPAN_IDS[actor.actorDef.name]
      if (spanId) document.getElementById(spanId)!.textContent = text
    } else {
      const spanId = C4_P2_SPAN_IDS[actor.actorDef.name]
      if (spanId) document.getElementById(spanId)!.textContent = text
    }
  }
}

// Populate the info panel with actual world positions
updateActorInfoPanel()

// ---------------------------------------------------------------------------
// Player color column indicators at edges of map
// ---------------------------------------------------------------------------

function createPlayerZoneIndicator(owner: 1 | 2, scene: Scene): void {
  const colors = PLAYER_COLORS[owner]
  const isPlayer1 = owner === 1

  // Thin colored strip along the starting edge of each player's zone
  const indicatorPoints = isPlayer1
    ? [new Vector3(0, 0.02, 0), new Vector3(MAP_WIDTH * 0.5, 0.02, 0)]         // top-left edge
    : [new Vector3(MAP_WIDTH * 0.5, 0.02, MAP_HEIGHT), new Vector3(MAP_WIDTH, 0.02, MAP_HEIGHT)]  // bottom-right edge

  const indicator = MeshBuilder.CreateLines(
    `zoneIndicator_P${owner}`,
    { points: indicatorPoints },
    scene,
  )
  indicator.color = colors.diffuse.clone().scale(0.6)
  indicator.renderingGroupId = 0
}

createPlayerZoneIndicator(1, scene)
createPlayerZoneIndicator(2, scene)

// ---------------------------------------------------------------------------
// Coordinate axis reference (X=Red, Z=Blue)
// ---------------------------------------------------------------------------

function createAxisReference(scene: Scene): void {
  // X axis (red, along width)
  const xAxis = MeshBuilder.CreateLines(
    'xAxisRef', { points: [new Vector3(0, 0.03, -0.5), new Vector3(1.5, 0.03, -0.5)] }, scene,
  )
  xAxis.color = new Color3(0.9, 0.2, 0.2)

  // Z axis (blue, along height)
  const zAxis = MeshBuilder.CreateLines(
    'zAxisRef', { points: [new Vector3(-0.5, 0.03, 0), new Vector3(-0.5, 0.03, 1.5)] }, scene,
  )
  zAxis.color = new Color3(0.2, 0.4, 0.9)
}

createAxisReference(scene)

// ---------------------------------------------------------------------------
// Highlight mode state
// ---------------------------------------------------------------------------

type HighlightMode = 'all' | 'p1' | 'p2'

let currentHighlight: HighlightMode = 'all'

/**
 * Switches the highlight mode and updates all actor material emissive colors.
 *   - 'all': no emissive on any actor (normal appearance)
 *   - 'p1':  Player 1 actors get emissive=0.35 glow, Player 2 dimmed to 0.02
 *   - 'p2':  Player 2 actors get emissive=0.35 glow, Player 1 dimmed to 0.02
 * Also toggles the active CSS class on the three highlight buttons.
 */
function setHighlightMode(mode: HighlightMode): void {
  currentHighlight = mode

  for (const actor of actorMeshList) {
    const isOwner = (mode === 'all') ||
      (mode === 'p1' && actor.actorDef.owner === 1) ||
      (mode === 'p2' && actor.actorDef.owner === 2)

    actor.material.emissiveColor = isOwner ? HIGHLIGHT_EMISSIVE.clone() : HIGHLIGHT_EMISSIVE_OTHER.clone()
  }

  // Update button active states
  document.getElementById('btn-highlight-all')!.classList.toggle('active', mode === 'all')
  document.getElementById('btn-highlight-p1')!.classList.toggle('active', mode === 'p1')
  document.getElementById('btn-highlight-p2')!.classList.toggle('active', mode === 'p2')

  updateUIState()
}

// ---------------------------------------------------------------------------
// UI state update
// ---------------------------------------------------------------------------

function updateUIState(): void {
  // Actor count (static in this demo, but updates visually on highlight)
  const p1Count = actorMeshList.filter(a => a.actorDef.owner === 1).length
  const p2Count = actorMeshList.filter(a => a.actorDef.owner === 2).length
  document.getElementById('meta-actors')!.textContent = String(p1Count + p2Count)

  // Highlight mode status (show in actor counts context)
  const modeLabel = currentHighlight === 'all' ? 'All visible' :
    currentHighlight === 'p1' ? 'P1 highlighted' : 'P2 highlighted'
  document.getElementById('meta-actors')!.textContent =
    `${p1Count + p2Count} (${modeLabel})`
}

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  const ua = navigator.userAgent
  document.getElementById('info-ua')!.textContent =
    ua.length > 60 ? ua.slice(0, 57) + '...' : ua
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion >= 2 ? `WebGL ${engine.webGLVersion}.0` : 'Unknown'
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Control bindings
// ---------------------------------------------------------------------------

document.getElementById('btn-highlight-all')!.addEventListener('click', () => {
  setHighlightMode('all')
})

document.getElementById('btn-highlight-p1')!.addEventListener('click', () => {
  setHighlightMode('p1')
})

document.getElementById('btn-highlight-p2')!.addEventListener('click', () => {
  setHighlightMode('p2')
})

document.getElementById('btn-reset')!.addEventListener('click', () => {
  // Reset camera
  camera.alpha = INITIAL_CAMERA_ALPHA
  camera.beta = INITIAL_CAMERA_BETA
  camera.radius = INITIAL_CAMERA_RADIUS
  camera.target.copyFrom(INITIAL_CAMERA_TARGET)

  // Reset highlight
  setHighlightMode('all')
})

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()

  // Update FPS
  document.getElementById('info-fps')!.textContent = engine.getFps().toFixed(0)
})

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

updateInfoBar()
updateUIState()

// Set initial button state
document.getElementById('btn-highlight-all')!.classList.add('active')

// Resize handler
window.addEventListener('resize', () => {
  engine.resize()
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`
})

// Periodic info bar refresh (stored for cleanup on unload)
const infoBarTimer = setInterval(updateInfoBar, 2000)

// ---------------------------------------------------------------------------
// Cleanup on page unload
// ---------------------------------------------------------------------------

window.addEventListener('beforeunload', () => {
  clearInterval(infoBarTimer)
  engine.dispose()
})

console.log('[map-loading] Acceptance test page initialized.')
console.log(`  Map: ${MAP_WIDTH_CELLS}x${MAP_HEIGHT_CELLS} cells (${MAP_WIDTH.toFixed(1)}x${MAP_HEIGHT.toFixed(1)} world units)`)
console.log(`  Terrain: Clear (green #384a2e) with checkered cell decoration`)
console.log(`  Actors: ${ACTORS.length} total (${ACTORS.filter(a => a.owner === 1).length} P1, ${ACTORS.filter(a => a.owner === 2).length} P2)`)
console.log('  Controls: Highlight P1 / P2 / All + Camera reset')
console.log('  Camera: ArcRotateCamera — drag to orbit, scroll to zoom, right-drag to pan')
