/**
 * main.ts -- Editor Actor 放置与选择 人工验收测试
 *
 * 测试目标:
 *   1. Ghost 预览跟随鼠标 (≤1 帧延迟)
 *   2. 有效放置 (绿色高亮) vs 无效放置 (红色高亮)
 *   3. Grid snap: actor 对齐到 cell center (±0.1wu)
 *   4. 碰撞检测: 障碍物 / OOB / 已有 actor 重叠
 *   5. Rubber-band 选择: 虚线框 + 多选
 *
 * OpenRA 对照:
 *   - OpenRA.Mods.Common/Traits/World/EditorActorLayer.cs
 *   - OpenRA.Mods.Common/Traits/World/EditorActorPreview.cs
 *
 * 坐标约定: 10x10 格网, 每格 1.0 世界单位.
 * Cell (cx, cy) center = (cx + 0.5, 0, cy + 0.5) in world space.
 */

import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
  Mesh, LinesMesh, Matrix, Viewport,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Grid Configuration
// ---------------------------------------------------------------------------

const GRID_W = 10
const GRID_H = 10
const CELL_SIZE = 1.0
const OOB_MARGIN = 3 // Extra cells shown beyond grid for OOB visualization

// ---------------------------------------------------------------------------
// Actor Types
// ---------------------------------------------------------------------------

interface ActorTypeDef {
  readonly name: string
  readonly footprintW: number
  readonly footprintH: number
  readonly color: Color3
  readonly emissive: Color3
  readonly id: string
}

const ACTOR_TYPES: Record<string, ActorTypeDef> = {
  Infantry: {
    name: 'Infantry',
    footprintW: 1,
    footprintH: 1,
    color: new Color3(0.20, 0.60, 0.95),
    emissive: new Color3(0.10, 0.30, 0.50),
    id: 'Infantry',
  },
  Vehicle: {
    name: 'Vehicle',
    footprintW: 1,
    footprintH: 1,
    color: new Color3(0.20, 0.67, 0.90),
    emissive: new Color3(0.10, 0.30, 0.45),
    id: 'Vehicle',
  },
  Building: {
    name: 'Building',
    footprintW: 2,
    footprintH: 2,
    color: new Color3(0.87, 0.87, 0.27),
    emissive: new Color3(0.35, 0.35, 0.10),
    id: 'Building',
  },
}

// ---------------------------------------------------------------------------
// Obstacle cells (blocked for placement)
// ---------------------------------------------------------------------------

const OBSTACLE_CELLS: ReadonlySet<string> = new Set([
  '3,3', '4,3',
  '3,5',
  '6,5', '7,5',
  '4,7', '5,7',
  '8,8',
])

function isObstacle(cx: number, cy: number): boolean {
  return OBSTACLE_CELLS.has(`${cx},${cy}`)
}

function isOOB(cx: number, cy: number): boolean {
  return cx < 0 || cx >= GRID_W || cy < 0 || cy >= GRID_H
}

// ---------------------------------------------------------------------------
// Placed Actor State
// ---------------------------------------------------------------------------

interface PlacedActor {
  type: string
  cellX: number
  cellY: number
  mesh: Mesh
  selectionHighlight: Mesh | null
  selected: boolean
}

const placedActors: PlacedActor[] = []

// ---------------------------------------------------------------------------
// Shared Materials (created once, reused)
// ---------------------------------------------------------------------------

let ghostValidMat: StandardMaterial
let ghostInvalidMat: StandardMaterial
let ghostMesh: Mesh | null = null

// Actor type materials
const actorMaterials: Map<string, StandardMaterial> = new Map()
const actorSelectedMats: Map<string, StandardMaterial> = new Map()

// Obstacle material
let obstacleMat: StandardMaterial

// Ground material
let groundMat: StandardMaterial

// OOB ground material
let oobMat: StandardMaterial

// Selection highlight material
let selectionHighlightMat: StandardMaterial

// Grid line material (not a StandardMaterial — LinesMesh uses color directly)

// ---------------------------------------------------------------------------
// Current State
// ---------------------------------------------------------------------------

let currentActorType: string = 'Infantry'
let hoverCell: { x: number; y: number } | null = null
let ghostIsValid: boolean = false
let rubberBandActive: boolean = false
let rubberBandStart: { x: number; y: number } | null = null
let rubberBandEnd: { x: number; y: number } | null = null
let rubberBandRect: LinesMesh | null = null
let selectModeEnabled: boolean = true

// ---------------------------------------------------------------------------
// Cell center in world space
// ---------------------------------------------------------------------------

function cellCenter(cx: number, cy: number): Vector3 {
  return new Vector3(cx * CELL_SIZE + CELL_SIZE / 2, 0, cy * CELL_SIZE + CELL_SIZE / 2)
}

// ---------------------------------------------------------------------------
// Placement validity check
// ---------------------------------------------------------------------------

function isValidPlacement(cx: number, cy: number, type: string): boolean {
  const def = ACTOR_TYPES[type]
  if (!def) return false

  // Check all cells in footprint
  for (let dy = 0; dy < def.footprintH; dy++) {
    for (let dx = 0; dx < def.footprintW; dx++) {
      const px = cx + dx
      const py = cy + dy

      // OOB check
      if (isOOB(px, py)) return false

      // Obstacle check
      if (isObstacle(px, py)) return false

      // Occupied by another actor
      for (const a of placedActors) {
        const aDef = ACTOR_TYPES[a.type]
        if (!aDef) continue
        if (px >= a.cellX && px < a.cellX + aDef.footprintW &&
            py >= a.cellY && py < a.cellY + aDef.footprintH) {
          return false
        }
      }
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Ghost Preview
// ---------------------------------------------------------------------------

function updateGhostPosition(): void {
  if (!ghostMesh) return

  if (hoverCell && !isOOB(hoverCell.x, hoverCell.y)) {
    const center = cellCenter(hoverCell.x, hoverCell.y)
    const def = ACTOR_TYPES[currentActorType]
    if (def) {
      // Offset center for multi-cell footprints
      const offsetX = (def.footprintW - 1) * CELL_SIZE / 2
      const offsetZ = (def.footprintH - 1) * CELL_SIZE / 2
      ghostMesh.position = new Vector3(center.x + offsetX, 0.06, center.z + offsetZ)
      ghostMesh.scaling = new Vector3(def.footprintW * CELL_SIZE, 0.01, def.footprintH * CELL_SIZE)
      ghostMesh.isVisible = true
    }

    ghostIsValid = isValidPlacement(hoverCell.x, hoverCell.y, currentActorType)
    ghostMesh.material = ghostIsValid ? ghostValidMat : ghostInvalidMat
  } else {
    ghostMesh.isVisible = false
    ghostIsValid = false
  }
}

// ---------------------------------------------------------------------------
// Actor Placement
// ---------------------------------------------------------------------------

function placeActor(cx: number, cy: number, type: string): PlacedActor | null {
  if (!isValidPlacement(cx, cy, type)) return null

  const def = ACTOR_TYPES[type]
  if (!def) return null

  const center = cellCenter(cx, cy)
  const offsetX = (def.footprintW - 1) * CELL_SIZE / 2
  const offsetZ = (def.footprintH - 1) * CELL_SIZE / 2

  // Create actor mesh
  const mesh = MeshBuilder.CreateBox(`actor_${type}_${cx}_${cy}`, {
    width: def.footprintW * CELL_SIZE * 0.9,
    height: 0.35,
    depth: def.footprintH * CELL_SIZE * 0.9,
  }, scene)
  mesh.position = new Vector3(center.x + offsetX, 0.2, center.z + offsetZ)

  const mat = getActorMaterial(type, false)
  mesh.material = mat

  // Selection highlight (hidden by default)
  const highlight = MeshBuilder.CreateGround(`sel_${type}_${cx}_${cy}`, {
    width: def.footprintW * CELL_SIZE * 1.05,
    height: def.footprintH * CELL_SIZE * 1.05,
  }, scene)
  highlight.position = new Vector3(center.x + offsetX, 0.08, center.z + offsetZ)
  highlight.material = selectionHighlightMat
  highlight.isVisible = false

  const actor: PlacedActor = {
    type,
    cellX: cx,
    cellY: cy,
    mesh,
    selectionHighlight: highlight,
    selected: false,
  }
  placedActors.push(actor)

  updatePlacedCount()
  return actor
}

// ---------------------------------------------------------------------------
// Material helpers
// ---------------------------------------------------------------------------

function getActorMaterial(type: string, selected: boolean): StandardMaterial {
  const cache = selected ? actorSelectedMats : actorMaterials
  const key = `${type}_${selected ? 'sel' : 'norm'}`
  if (cache.has(key)) return cache.get(key)!

  const def = ACTOR_TYPES[type]
  const mat = new StandardMaterial(`actorMat_${key}`, scene)
  if (selected) {
    mat.diffuseColor = new Color3(1.0, 0.9, 0.2)
    mat.emissiveColor = new Color3(0.4, 0.35, 0.05)
  } else if (def) {
    mat.diffuseColor = def.color.clone()
    mat.emissiveColor = def.emissive.clone()
  }
  mat.specularColor = new Color3(0, 0, 0)
  cache.set(key, mat)
  return mat
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function selectActor(actor: PlacedActor): void {
  actor.selected = true
  actor.mesh.material = getActorMaterial(actor.type, true)
  if (actor.selectionHighlight) {
    actor.selectionHighlight.isVisible = true
  }
}

function deselectActor(actor: PlacedActor): void {
  actor.selected = false
  actor.mesh.material = getActorMaterial(actor.type, false)
  if (actor.selectionHighlight) {
    actor.selectionHighlight.isVisible = false
  }
}

function deselectAll(): void {
  for (const a of placedActors) {
    deselectActor(a)
  }
  updateSelectedCount()
}

function selectActorsInScreenRect(px1: number, py1: number, px2: number, py2: number): void {
  const left = Math.min(px1, px2)
  const right = Math.max(px1, px2)
  const top = Math.min(py1, py2)
  const bottom = Math.max(py1, py2)

  // If the selection rectangle is too small (< 4px), treat as a click on single actor
  if (right - left < 4 && bottom - top < 4) {
    // Check for click on actor
    const pick = scene.pick(px1, py1)
    if (pick?.hit && pick.pickedMesh) {
      const actor = placedActors.find(a => a.mesh === pick.pickedMesh || a.selectionHighlight === pick.pickedMesh)
      if (actor) {
        deselectAll()
        selectActor(actor)
        updateSelectedCount()
        return
      }
    }
    // Click on empty area: deselect all
    deselectAll()
    updateSelectedCount()
    return
  }

  // Determine which actors fall within the screen rect
  deselectAll()
  const cam = scene.activeCamera
  if (!cam) return
  const transformMatrix = scene.getTransformMatrix()
  const viewport = new Viewport(0, 0, engine.getRenderWidth(), engine.getRenderHeight())
  for (const a of placedActors) {
    // Project actor world position to screen
    const worldPos = a.mesh.position.clone()
    const projected = Vector3.Project(worldPos, Matrix.Identity(), transformMatrix, viewport)

    if (projected.x >= left && projected.x <= right &&
        projected.y >= top && projected.y <= bottom) {
      selectActor(a)
    }
  }
  updateSelectedCount()
}

// ---------------------------------------------------------------------------
// Rubber-band rectangle
// ---------------------------------------------------------------------------

function updateRubberBandRect(): void {
  if (rubberBandRect) {
    rubberBandRect.dispose()
    rubberBandRect = null
  }

  if (!rubberBandActive || !rubberBandStart || !rubberBandEnd) return

  const x1 = rubberBandStart.x
  const y1 = rubberBandStart.y
  const x2 = rubberBandEnd.x
  const y2 = rubberBandEnd.y

  // Create dashed line rectangle in screen-aligned NDC space on a full-screen quad
  // For simplicity, draw a 2D rectangle using screen-space overlay
  const left = Math.min(x1, x2) / engine.getRenderWidth() * 2 - 1
  const right = Math.max(x1, x2) / engine.getRenderWidth() * 2 - 1
  const top = -(Math.min(y1, y2) / engine.getRenderHeight() * 2 - 1)
  const bottom = -(Math.max(y1, y2) / engine.getRenderHeight() * 2 - 1)

  // Create 4 line segments for the rubber-band rectangle
  const points = [
    new Vector3(left, top, 0),
    new Vector3(right, top, 0),
    new Vector3(right, bottom, 0),
    new Vector3(left, bottom, 0),
    new Vector3(left, top, 0),
  ]

  rubberBandRect = MeshBuilder.CreateLines('rubberBand', { points }, scene)
  rubberBandRect.color = new Color3(0.27, 0.67, 1.0)
  rubberBandRect.renderingGroupId = 2 // render on top
  // Make it render in screen space: set as overlay
  rubberBandRect.isPickable = false
}

// ---------------------------------------------------------------------------
// Stats update
// ---------------------------------------------------------------------------

function updatePlacedCount(): void {
  document.getElementById('stat-placed-count')!.textContent = String(placedActors.length)
}

function updateSelectedCount(): void {
  const count = placedActors.filter(a => a.selected).length
  document.getElementById('stat-selected-count')!.textContent = String(count)
}

function updateStatsDisplay(): void {
  document.getElementById('stat-actor-type')!.textContent = currentActorType
  if (hoverCell && !isOOB(hoverCell.x, hoverCell.y)) {
    document.getElementById('stat-hover-cell')!.textContent = `(${hoverCell.x}, ${hoverCell.y})`
    document.getElementById('stat-ghost-state')!.textContent = ghostIsValid ? '有效 (绿色)' : '无效 (红色)'
  } else {
    document.getElementById('stat-hover-cell')!.textContent = hoverCell ? `(${hoverCell.x}, ${hoverCell.y}) [OOB]` : '-'
    document.getElementById('stat-ghost-state')!.textContent = hoverCell ? 'OOB' : '-'
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
// Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, antialias: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

// Camera: overhead view
const totalExtent = (GRID_W + OOB_MARGIN * 2) * CELL_SIZE
const cameraTarget = new Vector3(GRID_W / 2 * CELL_SIZE, 0, GRID_H / 2 * CELL_SIZE)
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 0.15, totalExtent * 0.85, cameraTarget, scene)
camera.attachControl(canvas, true)
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 30
camera.panningSensibility = 500
// Disable default mouse buttons for camera when we handle clicks ourselves
camera.inputs.removeByType('ArcRotateCameraMouseWheelInput' as any)

// Re-add mouse wheel input for zoom
import { ArcRotateCameraMouseWheelInput } from '@babylonjs/core'
camera.inputs.add(new ArcRotateCameraMouseWheelInput())

new HemisphericLight('hemi', new Vector3(0.3, 1, 0.3), scene)

// ---------------------------------------------------------------------------
// Create Materials (shared, no per-frame allocation)
// ---------------------------------------------------------------------------

// Ghost materials
ghostValidMat = new StandardMaterial('ghostValid', scene)
ghostValidMat.diffuseColor = new Color3(0.20, 0.70, 0.20)
ghostValidMat.alpha = 0.55
ghostValidMat.emissiveColor = new Color3(0.10, 0.40, 0.10)
ghostValidMat.specularColor = new Color3(0, 0, 0)

ghostInvalidMat = new StandardMaterial('ghostInvalid', scene)
ghostInvalidMat.diffuseColor = new Color3(0.80, 0.15, 0.15)
ghostInvalidMat.alpha = 0.55
ghostInvalidMat.emissiveColor = new Color3(0.40, 0.05, 0.05)
ghostInvalidMat.specularColor = new Color3(0, 0, 0)

// Selection highlight
selectionHighlightMat = new StandardMaterial('selectionHighlight', scene)
selectionHighlightMat.diffuseColor = new Color3(1.0, 0.9, 0.2)
selectionHighlightMat.alpha = 0.35
selectionHighlightMat.emissiveColor = new Color3(0.5, 0.4, 0.05)
selectionHighlightMat.specularColor = new Color3(0, 0, 0)
selectionHighlightMat.backFaceCulling = false

// ---------------------------------------------------------------------------
// Create Ground
// ---------------------------------------------------------------------------

// Main ground (playable area)
groundMat = new StandardMaterial('ground', scene)
groundMat.diffuseColor = new Color3(0.14, 0.17, 0.22)
groundMat.specularColor = new Color3(0, 0, 0)
const ground = MeshBuilder.CreateGround('ground', {
  width: GRID_W * CELL_SIZE, height: GRID_H * CELL_SIZE,
}, scene)
ground.position = new Vector3(GRID_W / 2 * CELL_SIZE, -0.05, GRID_H / 2 * CELL_SIZE)
ground.material = groundMat

// OOB ground (surrounding area)
oobMat = new StandardMaterial('oob', scene)
oobMat.diffuseColor = new Color3(0.55, 0.35, 0.10)
oobMat.emissiveColor = new Color3(0.15, 0.08, 0.0)
oobMat.specularColor = new Color3(0, 0, 0)
const oobGround = MeshBuilder.CreateGround('oobGround', {
  width: (GRID_W + OOB_MARGIN * 2) * CELL_SIZE,
  height: (GRID_H + OOB_MARGIN * 2) * CELL_SIZE,
}, scene)
oobGround.position = new Vector3(GRID_W / 2 * CELL_SIZE, -0.06, GRID_H / 2 * CELL_SIZE)
oobGround.material = oobMat

// ---------------------------------------------------------------------------
// Grid Lines (on playable area)
// ---------------------------------------------------------------------------

function createGridLines(): LinesMesh {
  const points: Vector3[] = []
  // Vertical lines
  for (let x = 0; x <= GRID_W; x++) {
    points.push(new Vector3(x * CELL_SIZE, 0.01, 0))
    points.push(new Vector3(x * CELL_SIZE, 0.01, GRID_H * CELL_SIZE))
  }
  // Horizontal lines
  for (let y = 0; y <= GRID_H; y++) {
    points.push(new Vector3(0, 0.01, y * CELL_SIZE))
    points.push(new Vector3(GRID_W * CELL_SIZE, 0.01, y * CELL_SIZE))
  }
  const gridLines = MeshBuilder.CreateLines('gridLines', { points }, scene)
  gridLines.color = new Color3(0.20, 0.25, 0.35)
  return gridLines
}

createGridLines()

// ---------------------------------------------------------------------------
// Obstacle Visualization
// ---------------------------------------------------------------------------

const obstacleMeshes: Mesh[] = []

function createObstacles(): void {
  obstacleMat = new StandardMaterial('obstacle', scene)
  obstacleMat.diffuseColor = new Color3(0.30, 0.30, 0.30)
  obstacleMat.specularColor = new Color3(0, 0, 0)

  for (const key of OBSTACLE_CELLS) {
    const [cx, cy] = key.split(',').map(Number)
    const center = cellCenter(cx, cy)
    const box = MeshBuilder.CreateBox(`obs_${cx}_${cy}`, {
      width: CELL_SIZE * 0.85, height: 0.3, depth: CELL_SIZE * 0.85,
    }, scene)
    box.position = new Vector3(center.x, 0.15, center.z)
    box.material = obstacleMat
    obstacleMeshes.push(box)
  }
}

createObstacles()

// ---------------------------------------------------------------------------
// Ghost Mesh
// ---------------------------------------------------------------------------

ghostMesh = MeshBuilder.CreateGround('ghost', {
  width: CELL_SIZE, height: CELL_SIZE,
}, scene)
ghostMesh.position.y = 0.06
ghostMesh.material = ghostValidMat
ghostMesh.isVisible = false
ghostMesh.isPickable = false

// ---------------------------------------------------------------------------
// Mouse Handling
// ---------------------------------------------------------------------------

let isDragging = false
let dragStartX = 0
let dragStartY = 0

function getGridCellFromScreen(screenX: number, screenY: number): { x: number; y: number } | null {
  const pick = scene.pick(screenX, screenY)
  if (pick?.pickedPoint) {
    const gx = Math.floor(pick.pickedPoint.x / CELL_SIZE)
    const gy = Math.floor(pick.pickedPoint.z / CELL_SIZE)
    return { x: gx, y: gy }
  }
  return null
}

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top

  const cell = getGridCellFromScreen(sx, sy)
  hoverCell = cell

  if (isDragging && selectModeEnabled) {
    rubberBandEnd = { x: sx, y: sy }
    rubberBandActive = true
    updateRubberBandRect()
  }

  updateGhostPosition()
  updateStatsDisplay()
})

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return // Left button only

  const rect = canvas.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top

  // Check if clicking on an existing actor
  const pick = scene.pick(sx, sy)
  const clickedActor = placedActors.find(
    a => a.mesh === pick?.pickedMesh || a.selectionHighlight === pick?.pickedMesh,
  )

  if (clickedActor && selectModeEnabled) {
    // Click on actor: select/deselect
    if (!e.ctrlKey && !e.metaKey) {
      deselectAll()
    }
    if (clickedActor.selected) {
      deselectActor(clickedActor)
    } else {
      selectActor(clickedActor)
    }
    updateSelectedCount()
    // Don't start drag
    return
  }

  // Start drag for rubber-band (or placement if select mode off)
  if (selectModeEnabled) {
    isDragging = true
    dragStartX = sx
    dragStartY = sy
    rubberBandStart = { x: sx, y: sy }
    rubberBandEnd = { x: sx, y: sy }
    rubberBandActive = true
    updateRubberBandRect()
  }
})

canvas.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return

  if (isDragging && selectModeEnabled) {
    isDragging = false
    rubberBandActive = false

    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    // If barely moved, treat as click-to-place
    const dist = Math.sqrt((sx - dragStartX) ** 2 + (sy - dragStartY) ** 2)
    if (dist < 4) {
      // Click placement
      if (hoverCell && ghostIsValid && !isOOB(hoverCell.x, hoverCell.y)) {
        placeActor(hoverCell.x, hoverCell.y, currentActorType)
      }
    } else {
      // Rubber-band selection
      selectActorsInScreenRect(dragStartX, dragStartY, sx, sy)
    }

    // Clean up rubber band
    if (rubberBandRect) {
      rubberBandRect.dispose()
      rubberBandRect = null
    }
    rubberBandStart = null
    rubberBandEnd = null
  } else if (!selectModeEnabled) {
    // Direct placement mode: click to place
    if (hoverCell && ghostIsValid && !isOOB(hoverCell.x, hoverCell.y)) {
      placeActor(hoverCell.x, hoverCell.y, currentActorType)
    }
  }
})

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  deselectAll()
  updateSelectedCount()
})

// ---------------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------------

// Actor type buttons
document.getElementById('btn-infantry')!.addEventListener('click', () => {
  currentActorType = 'Infantry'
  updateActorTypeButtons()
  updateGhostPosition()
  updateStatsDisplay()
})

document.getElementById('btn-vehicle')!.addEventListener('click', () => {
  currentActorType = 'Vehicle'
  updateActorTypeButtons()
  updateGhostPosition()
  updateStatsDisplay()
})

document.getElementById('btn-building')!.addEventListener('click', () => {
  currentActorType = 'Building'
  updateActorTypeButtons()
  updateGhostPosition()
  updateStatsDisplay()
})

function updateActorTypeButtons(): void {
  for (const type of ['Infantry', 'Vehicle', 'Building']) {
    const btnId = `btn-${type.toLowerCase()}`
    document.getElementById(btnId)!.classList.toggle('active', currentActorType === type)
  }
}

// Search / filter
document.getElementById('filter-input')!.addEventListener('input', () => {
  const query = (document.getElementById('filter-input') as HTMLInputElement).value.toLowerCase()
  const resultEl = document.getElementById('filter-result')!
  if (!query) {
    resultEl.textContent = ''
    return
  }
  const matches = Object.values(ACTOR_TYPES).filter(t => t.name.toLowerCase().includes(query))
  resultEl.textContent = matches.length > 0
    ? `匹配: ${matches.map(m => m.name).join(', ')}`
    : '无匹配结果'
})

// Reset
document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetAll()
})

// Delete selected
document.getElementById('btn-delete-selected')!.addEventListener('click', () => {
  for (let i = placedActors.length - 1; i >= 0; i--) {
    if (placedActors[i].selected) {
      const a = placedActors[i]
      a.mesh.dispose()
      if (a.selectionHighlight) a.selectionHighlight.dispose()
      placedActors.splice(i, 1)
    }
  }
  updatePlacedCount()
  updateSelectedCount()
  updateGhostPosition()
})

// Random fill
document.getElementById('btn-random-fill')!.addEventListener('click', () => {
  const types = ['Infantry', 'Vehicle', 'Building']
  const placed: { type: string; cx: number; cy: number }[] = []
  let attempts = 0
  while (placed.length < 5 && attempts < 200) {
    attempts++
    const type = types[Math.floor(Math.random() * types.length)]
    const cx = Math.floor(Math.random() * GRID_W)
    const cy = Math.floor(Math.random() * GRID_H)
    if (isValidPlacement(cx, cy, type)) {
      const result = placeActor(cx, cy, type)
      if (result) {
        placed.push({ type, cx, cy })
      }
    }
  }
})

// Select mode toggle
document.getElementById('btn-select-mode')!.addEventListener('click', () => {
  selectModeEnabled = !selectModeEnabled
  const btn = document.getElementById('btn-select-mode')!
  btn.textContent = selectModeEnabled
    ? 'Rubber-band 选择: 开启 (拖拽空白区域)'
    : 'Rubber-band 选择: 关闭 (点击直接放置)'
  btn.classList.toggle('active', selectModeEnabled)
})

// Deselect all
document.getElementById('btn-deselect-all')!.addEventListener('click', () => {
  deselectAll()
  updateSelectedCount()
})

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  switch (e.key.toLowerCase()) {
    case '1': {
      currentActorType = 'Infantry'
      updateActorTypeButtons()
      updateGhostPosition()
      updateStatsDisplay()
      break
    }
    case '2': {
      currentActorType = 'Vehicle'
      updateActorTypeButtons()
      updateGhostPosition()
      updateStatsDisplay()
      break
    }
    case '3': {
      currentActorType = 'Building'
      updateActorTypeButtons()
      updateGhostPosition()
      updateStatsDisplay()
      break
    }
    case 'delete':
    case 'backspace': {
      e.preventDefault()
      document.getElementById('btn-delete-selected')!.click()
      break
    }
    case 'escape': {
      deselectAll()
      updateSelectedCount()
      break
    }
    case 'r': {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        resetAll()
      }
      break
    }
  }
})

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetAll(): void {
  for (const a of placedActors) {
    a.mesh.dispose()
    if (a.selectionHighlight) a.selectionHighlight.dispose()
  }
  placedActors.length = 0
  updatePlacedCount()
  updateSelectedCount()
  updateGhostPosition()
}

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

const testHarness = {
  /**
   * Select an actor type for placement.
   * @param type - 'Infantry' | 'Vehicle' | 'Building'
   */
  selectActor(type: string): void {
    if (ACTOR_TYPES[type]) {
      currentActorType = type
      updateActorTypeButtons()
      updateGhostPosition()
      updateStatsDisplay()
    }
  },

  /**
   * Move the cursor to a specific grid cell (simulates mouse hover).
   * @param cell - { x: number, y: number }
   */
  moveCursorToCell(cell: { x: number; y: number }): void {
    hoverCell = { x: cell.x, y: cell.y }
    updateGhostPosition()
    updateStatsDisplay()
  },

  /**
   * Place an actor at the current hover cell.
   * @returns The placed actor or null if placement failed.
   */
  placeActor(): { type: string; cellX: number; cellY: number } | null {
    if (!hoverCell || !ghostIsValid) return null
    if (isOOB(hoverCell.x, hoverCell.y)) return null
    const result = placeActor(hoverCell.x, hoverCell.y, currentActorType)
    return result ? { type: result.type, cellX: result.cellX, cellY: result.cellY } : null
  },

  /**
   * Get the current ghost color at the hover cell.
   * @returns { r, g, b } values (0-1 range) or null if ghost is not visible.
   */
  getGhostColor(): { r: number; g: number; b: number } | null {
    if (!ghostMesh || !ghostMesh.isVisible) return null
    if (ghostIsValid) {
      return { r: 0.20, g: 0.70, b: 0.20 }
    }
    return { r: 0.80, g: 0.15, b: 0.15 }
  },

  /**
   * Get all placed actors.
   * @returns Array of { type, cellX, cellY } for each placed actor.
   */
  getPlacedActors(): Array<{ type: string; cellX: number; cellY: number }> {
    return placedActors.map(a => ({ type: a.type, cellX: a.cellX, cellY: a.cellY }))
  },

  /**
   * Get the current rubber-band selection bounds.
   * @returns Screen-space bounds or null if no active rubber-band.
   */
  getSelectionBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!rubberBandActive || !rubberBandStart || !rubberBandEnd) return null
    const left = Math.min(rubberBandStart.x, rubberBandEnd.x)
    const top = Math.min(rubberBandStart.y, rubberBandEnd.y)
    const right = Math.max(rubberBandStart.x, rubberBandEnd.x)
    const bottom = Math.max(rubberBandStart.y, rubberBandEnd.y)
    return { x: left, y: top, width: right - left, height: bottom - top }
  },

  /**
   * Reset the entire scene: remove all placed actors.
   */
  reset(): void {
    resetAll()
  },

  /**
   * Get the list of obstacle cell coordinates.
   */
  getObstacles(): Array<{ x: number; y: number }> {
    return [...OBSTACLE_CELLS].map(key => {
      const [x, y] = key.split(',').map(Number)
      return { x, y }
    })
  },

  /**
   * Get the current grid dimensions.
   */
  getGridSize(): { width: number; height: number } {
    return { width: GRID_W, height: GRID_H }
  },

  /**
   * Check if a specific cell is a valid placement for the current actor type.
   */
  isCellValid(cx: number, cy: number): boolean {
    return isValidPlacement(cx, cy, currentActorType)
  },
}

;(window as any).__testHarness = testHarness
