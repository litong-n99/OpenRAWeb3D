/**
 * camera-controls/main.ts — Camera system visual acceptance test
 *
 * OpenRA对照: OpenRA.Game/Graphics/Viewport.cs (441 lines) +
 *             OpenRA.Mods.Common/Widgets/ViewportControllerWidget.cs (506 lines)
 *
 * Verifies:
 *   E1. Coordinate system orientation: alpha=-PI/2, screen-right = world+X
 *   E2. Zoom-to-cursor accuracy: WPos drift ≤ ±2 su at min/max zoom
 *   E3. Edge scrolling + boundary clamping: activate at ≤15px, stop at bounds
 *
 * 坐标系约定 (from Viewport.ts):
 *   - Babylon.js 左手坐标系 (LH): alpha=-PI/2 → camera on -Z side → screen-right=world+X
 *   - WPos (x=east-west, y=north-south, z=height) → Vector3 (x/1024, z/512, y/1024)
 *   - WORLD_SCALE = 1/1024, HEIGHT_SCALE = 1/512
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
  Camera,
  Matrix,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Coordinate conversion constants (matching Viewport.ts)
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1 / 1024
const HEIGHT_SCALE = 1 / 512

/** WPos (OpenRA world position) → Babylon.js Vector3 */
function wPosToVector3(wx: number, wy: number, wz: number): Vector3 {
  return new Vector3(wx * WORLD_SCALE, wz * HEIGHT_SCALE, wy * WORLD_SCALE)
}

/** Babylon.js Vector3 → WPos { x, y, z } */
function vector3ToWPos(v: Vector3): { x: number; y: number; z: number } {
  return {
    x: Math.round(v.x / WORLD_SCALE),
    y: Math.round(v.z / WORLD_SCALE),
    z: Math.round(v.y / HEIGHT_SCALE),
  }
}

// ---------------------------------------------------------------------------
// Map boundary (in Babylon units — represents a 10×10 cell map)
// ---------------------------------------------------------------------------

const MAP_MIN_X = 0
const MAP_MAX_X = 10
const MAP_MIN_Z = 0
const MAP_MAX_Z = 10

/** Clamp a Vector3 target to map bounds (XZ plane) */
function clampToMapBounds(pos: Vector3): Vector3 {
  return new Vector3(
    Math.max(MAP_MIN_X, Math.min(MAP_MAX_X, pos.x)),
    pos.y,
    Math.max(MAP_MIN_Z, Math.min(MAP_MAX_Z, pos.z)),
  )
}

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

// Edge zone elements
const edgeTop = document.getElementById('edge-top')!
const edgeBottom = document.getElementById('edge-bottom')!
const edgeLeft = document.getElementById('edge-left')!
const edgeRight = document.getElementById('edge-right')!

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

// Camera: matching Viewport.ts setupCamera()
// alpha=-PI/2 → camera on -Z side → screen-right = world+X
// beta=PI/3 → 60° tilt from horizontal
// mode=ORTHOGRAPHIC_CAMERA → default RTS top-down view
const camera = new ArcRotateCamera(
  'rtsCam',
  -Math.PI / 2,  // alpha: camera azimuth (around Y axis)
  Math.PI / 3,    // beta: camera elevation (from horizontal)
  20,             // radius (only used in perspective mode)
  new Vector3(5, 0, 5), // target: map center
  scene,
)
camera.mode = Camera.ORTHOGRAPHIC_CAMERA

// Set orthographic frustum so we see the full map + margin
// ortho values represent half the visible area in world units
const BASE_ORTHO_SIZE = 6 // default view covers 12×12 Babylon units
camera.orthoTop = BASE_ORTHO_SIZE
camera.orthoBottom = -BASE_ORTHO_SIZE
camera.orthoLeft = -BASE_ORTHO_SIZE
camera.orthoRight = BASE_ORTHO_SIZE

// Disable default camera controls — we implement our own for the test
camera.inputs.clear()

// Allow mouse orbit (left button drag rotates, right button pans)
// Re-add basic mouse inputs for user exploration
// We use attachControl with specific button mappings
camera.attachControl(canvas, true)

// Override: lock panning to XZ plane
camera.panningAxis = new Vector3(1, 0, 0)

// Radius limits (for perspective mode)
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 50

// Lighting
const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.8

// ---------------------------------------------------------------------------
// Reference Grid
// ---------------------------------------------------------------------------

let gridVisible = true
const gridNodes: (Mesh | LinesMesh)[] = []

function buildReferenceGrid(): void {
  // Ground plane (semi-transparent dark)
  const ground = MeshBuilder.CreateGround('ground', {
    width: MAP_MAX_X + 2,
    height: MAP_MAX_Z + 2,
  }, scene)
  ground.position = new Vector3(MAP_MAX_X / 2, -0.02, MAP_MAX_Z / 2)
  const gmat = new StandardMaterial('gmat', scene)
  gmat.diffuseColor = new Color3(0.12, 0.15, 0.20)
  gmat.specularColor = new Color3(0, 0, 0)
  gmat.alpha = 0.7
  ground.material = gmat
  gridNodes.push(ground)

  // Grid lines every 1 Babylon unit (1024 su = 1 cell)
  for (let i = 0; i <= MAP_MAX_X; i++) {
    const hLine = MeshBuilder.CreateLines('hLine', {
      points: [new Vector3(i, 0.005, 0), new Vector3(i, 0.005, MAP_MAX_Z)],
    }, scene)
    hLine.color = new Color3(0.25, 0.4, 0.7)
    hLine.alpha = i % 5 === 0 ? 0.6 : 0.25
    gridNodes.push(hLine)
  }
  for (let j = 0; j <= MAP_MAX_Z; j++) {
    const vLine = MeshBuilder.CreateLines('vLine', {
      points: [new Vector3(0, 0.005, j), new Vector3(MAP_MAX_X, 0.005, j)],
    }, scene)
    vLine.color = new Color3(0.25, 0.4, 0.7)
    vLine.alpha = j % 5 === 0 ? 0.6 : 0.25
    gridNodes.push(vLine)
  }

  // Coordinate axes (RGB = XYZ in Babylon space)
  const axisLen = MAP_MAX_X + 1
  // X axis (red) — world east-west direction
  const xAxis = MeshBuilder.CreateLines('xAxis', {
    points: [new Vector3(-0.5, 0.01, 0), new Vector3(axisLen, 0.01, 0)],
  }, scene)
  xAxis.color = new Color3(1, 0.2, 0.2)
  xAxis.alpha = 0.8
  gridNodes.push(xAxis)

  // Y axis (green) — world height direction (Babylon Y-up)
  const yAxis = MeshBuilder.CreateLines('yAxis', {
    points: [new Vector3(0, 0.01, 0), new Vector3(0, axisLen, 0)],
  }, scene)
  yAxis.color = new Color3(0.2, 1, 0.2)
  yAxis.alpha = 0.5
  gridNodes.push(yAxis)

  // Z axis (blue) — WPos.Y direction (north-south in OpenRA)
  const zAxis = MeshBuilder.CreateLines('zAxis', {
    points: [new Vector3(0, 0.01, -0.5), new Vector3(0, 0.01, axisLen)],
  }, scene)
  zAxis.color = new Color3(0.2, 0.2, 1)
  zAxis.alpha = 0.8
  gridNodes.push(zAxis)
}

buildReferenceGrid()

// ---------------------------------------------------------------------------
// Coordinate Markers (colored spheres at known positions)
// ---------------------------------------------------------------------------

interface MarkerInfo {
  wpos: { x: number; y: number; z: number }
  vec3: Vector3
  label: string
  color: Color3
  mesh: Mesh
}

const markers: MarkerInfo[] = []

function createMarker(
  wx: number,
  wy: number,
  wz: number,
  color: Color3,
  label: string,
  diameter: number = 0.2,
): MarkerInfo {
  const pos = wPosToVector3(wx, wy, wz)
  const sphere = MeshBuilder.CreateSphere(`marker_${label}`, { diameter }, scene)
  sphere.position = pos
  const mat = new StandardMaterial(`mat_${label}`, scene)
  mat.diffuseColor = color
  mat.emissiveColor = color.scale(0.4)
  mat.specularColor = new Color3(0, 0, 0)
  sphere.material = mat

  // Dropline to ground
  if (wz > 0) {
    const dropLine = MeshBuilder.CreateLines(`drop_${label}`, {
      points: [pos, new Vector3(pos.x, 0.03, pos.z)],
    }, scene)
    dropLine.color = color
    dropLine.alpha = 0.4
  }

  // Label sphere (smaller, above)
  const labelSphere = MeshBuilder.CreateSphere(`lbl_${label}`, { diameter: diameter * 0.6 }, scene)
  labelSphere.position = new Vector3(pos.x, pos.y + diameter * 0.9, pos.z)
  const lmat = new StandardMaterial(`lmat_${label}`, scene)
  lmat.diffuseColor = color.scale(1.2)
  lmat.emissiveColor = color.scale(0.3)
  lmat.specularColor = new Color3(0, 0, 0)
  labelSphere.material = lmat

  const info: MarkerInfo = { wpos: { x: wx, y: wy, z: wz }, vec3: pos, label, color, mesh: sphere }
  markers.push(info)
  return info
}

// E1 verification markers:
// Origin: WPos(0,0,0) = Vector3(0,0,0) — WHITE
createMarker(0, 0, 0, new Color3(1, 1, 1), 'Origin', 0.22)

// +X marker: WPos(5120, 0, 0) = Vector3(5, 0, 0) — RED (should appear RIGHT of origin)
createMarker(5120, 0, 0, new Color3(1, 0.15, 0.15), '+X_Right', 0.2)

// -X marker: WPos(-2560, 0, 0) = Vector3(-2.5, 0, 0) — DARK RED (should appear LEFT of origin)
createMarker(-2560, 0, 0, new Color3(0.6, 0.15, 0.15), '-X_Left', 0.15)

// +Z (WPos.Y+) marker: WPos(0, 5120, 0) = Vector3(0, 0, 5) — BLUE (should appear BELOW origin)
createMarker(0, 5120, 0, new Color3(0.15, 0.15, 1), '+Z_South', 0.2)

// -Z (WPos.Y-) marker: WPos(0, -2560, 0) = Vector3(0, 0, -2.5) — DARK BLUE (should appear ABOVE origin)
createMarker(0, -2560, 0, new Color3(0.15, 0.15, 0.6), '-Z_North', 0.15)

// Height marker: WPos(0, 0, 1024) = Vector3(0, 2, 0) — GREEN (floating above origin)
createMarker(0, 0, 1024, new Color3(0.15, 1, 0.15), '+Height', 0.18)

// Map corner markers
createMarker(10240, 0, 0, new Color3(0.8, 0.5, 0.2), 'MapCorner_X', 0.14)
createMarker(0, 10240, 0, new Color3(0.8, 0.5, 0.2), 'MapCorner_Z', 0.14)
createMarker(10240, 10240, 0, new Color3(0.8, 0.5, 0.2), 'MapCorner_XZ', 0.14)

// ---------------------------------------------------------------------------
// Map Boundary Visualization
// ---------------------------------------------------------------------------

let boundsVisible = true
const boundsNodes: (Mesh | LinesMesh)[] = []

function buildBoundaryVisualization(): void {
  const y = 0.02
  const corners = [
    new Vector3(MAP_MIN_X, y, MAP_MIN_Z),
    new Vector3(MAP_MAX_X, y, MAP_MIN_Z),
    new Vector3(MAP_MAX_X, y, MAP_MAX_Z),
    new Vector3(MAP_MIN_X, y, MAP_MAX_Z),
    new Vector3(MAP_MIN_X, y, MAP_MIN_Z), // close loop
  ]

  const boundLine = MeshBuilder.CreateLines('mapBoundary', {
    points: corners,
  }, scene)
  boundLine.color = new Color3(0.9, 0.8, 0.3)
  boundLine.alpha = 0.7
  boundsNodes.push(boundLine)

  // Corner pillars
  for (const [wx, wz] of [[MAP_MIN_X, MAP_MIN_Z], [MAP_MAX_X, MAP_MIN_Z], [MAP_MAX_X, MAP_MAX_Z], [MAP_MIN_X, MAP_MAX_Z]]) {
    const pillar = MeshBuilder.CreateCylinder(`pillar_${wx}_${wz}`, {
      height: 1.5,
      diameter: 0.12,
    }, scene)
    pillar.position = new Vector3(wx, 0.75, wz)
    const pmat = new StandardMaterial(`pmat_${wx}_${wz}`, scene)
    pmat.diffuseColor = new Color3(0.9, 0.8, 0.3)
    pmat.emissiveColor = new Color3(0.3, 0.25, 0)
    pmat.specularColor = new Color3(0, 0, 0)
    pillar.material = pmat
    boundsNodes.push(pillar)
  }
}

buildBoundaryVisualization()

// ---------------------------------------------------------------------------
// Cursor Tracking & Coordinate Readout
// ---------------------------------------------------------------------------

let lastWPosUnderCursor: { x: number; y: number; z: number } | null = null
let referenceWPosForDrift: { x: number; y: number; z: number } | null = null
let currentZoom = 1.0
let _isRightDragging = false

/** Pick the terrain plane (y=0) at the given screen position */
function pickTerrainAt(screenX: number, screenY: number): Vector3 | null {
  const ray = scene.createPickingRay(
    screenX,
    screenY,
    Matrix.Identity(),
    camera,
  )

  // Intersect with Y=0 plane (terrain surface)
  if (Math.abs(ray.direction.y) < 1e-10) return null

  const t = -ray.origin.y / ray.direction.y
  if (t < 0) return null

  return new Vector3(
    ray.origin.x + t * ray.direction.x,
    0,
    ray.origin.z + t * ray.direction.z,
  )
}

function updateCursorReadout(event?: MouseEvent): void {
  const rect = canvas.getBoundingClientRect()
  const screenX = event ? event.clientX - rect.left : rect.width / 2
  const screenY = event ? event.clientY - rect.top : rect.height / 2

  const terrainHit = pickTerrainAt(screenX, screenY)

  const screenEl = document.getElementById('cursor-screen')!
  const wposEl = document.getElementById('cursor-wpos')!
  const vec3El = document.getElementById('cursor-vec3')!
  const driftEl = document.getElementById('cursor-drift')!

  screenEl.textContent = `(${screenX.toFixed(0)}, ${screenY.toFixed(0)})`

  if (terrainHit) {
    const wpos = vector3ToWPos(terrainHit)
    wposEl.textContent = `(${wpos.x}, ${wpos.y}, ${wpos.z})`
    vec3El.textContent = `(${terrainHit.x.toFixed(4)}, ${terrainHit.y.toFixed(4)}, ${terrainHit.z.toFixed(4)})`
    lastWPosUnderCursor = wpos

    // Compute drift from reference
    if (referenceWPosForDrift) {
      const dx = wpos.x - referenceWPosForDrift.x
      const dy = wpos.y - referenceWPosForDrift.y
      const dz = wpos.z - referenceWPosForDrift.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      driftEl.textContent = `Δ(${dx}, ${dy}, ${dz}) |d|=${dist.toFixed(1)} su`
      if (dist <= 2) {
        driftEl.style.color = '#4f4'
      } else if (dist <= 5) {
        driftEl.style.color = '#fa0'
      } else {
        driftEl.style.color = '#f44'
      }
    } else {
      driftEl.textContent = '(点击"锁定参考点")'
      driftEl.style.color = '#889'
    }
  } else {
    wposEl.textContent = '(无地形命中)'
    vec3El.textContent = '-'
  }
}

// ---------------------------------------------------------------------------
// Edge Scroll Zone Detection
// ---------------------------------------------------------------------------

const EDGE_SCROLL_MARGIN = 15

let edgeZonesVisible = true

function updateEdgeZones(event?: MouseEvent): void {
  if (!edgeZonesVisible) {
    for (const el of [edgeTop, edgeBottom, edgeLeft, edgeRight]) {
      el.classList.remove('active')
    }
    return
  }

  if (!event) return

  const rect = canvas.getBoundingClientRect()
  const relX = event.clientX - rect.left
  const relY = event.clientY - rect.top

  // Update edge zone visibility based on mouse position
  edgeTop.classList.toggle('active', relY <= EDGE_SCROLL_MARGIN)
  edgeBottom.classList.toggle('active', relY >= rect.height - EDGE_SCROLL_MARGIN)
  edgeLeft.classList.toggle('active', relX <= EDGE_SCROLL_MARGIN)
  edgeRight.classList.toggle('active', relX >= rect.width - EDGE_SCROLL_MARGIN)

  // Update the displayed direction in info
  let edgeDir = '无'
  const dirs: string[] = []
  if (relY <= EDGE_SCROLL_MARGIN) dirs.push('上')
  if (relY >= rect.height - EDGE_SCROLL_MARGIN) dirs.push('下')
  if (relX <= EDGE_SCROLL_MARGIN) dirs.push('左')
  if (relX >= rect.width - EDGE_SCROLL_MARGIN) dirs.push('右')
  if (dirs.length > 0) edgeDir = dirs.join('+')

  const edgeDirEl = document.getElementById('stat-edge-dir')
  if (edgeDirEl) edgeDirEl.textContent = edgeDir
}

// ---------------------------------------------------------------------------
// Camera State Display
// ---------------------------------------------------------------------------

function updateCameraStateDisplay(): void {
  document.getElementById('stat-mode')!.textContent =
    camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? '正射 (Ortho)' : '透视 (Persp)'
  document.getElementById('stat-alpha')!.textContent =
    `-PI/2 (${(-Math.PI / 2).toFixed(3)})`
  document.getElementById('stat-beta')!.textContent =
    `PI/3 (${(Math.PI / 3).toFixed(3)})`
  document.getElementById('stat-zoom')!.textContent = `${currentZoom.toFixed(2)}x`
  document.getElementById('stat-target')!.textContent =
    `(${camera.target.x.toFixed(2)}, ${camera.target.y.toFixed(2)}, ${camera.target.z.toFixed(2)})`
  document.getElementById('stat-ortho')!.textContent =
    camera.mode === Camera.ORTHOGRAPHIC_CAMERA
      ? `±${camera.orthoTop!.toFixed(2)}`
      : `r=${camera.radius.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Zoom Management
// ---------------------------------------------------------------------------

function setZoom(factor: number): void {
  currentZoom = Math.max(0.5, Math.min(3.0, factor))

  if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
    // In ortho mode, smaller ortho = more zoomed in
    const orthoSize = BASE_ORTHO_SIZE / currentZoom
    camera.orthoTop = orthoSize
    camera.orthoBottom = -orthoSize
    camera.orthoLeft = -orthoSize
    camera.orthoRight = orthoSize
  } else {
    // In perspective mode, smaller radius = more zoomed in
    camera.radius = 20 / currentZoom
  }

  // Clamp camera target to map bounds
  camera.target = clampToMapBounds(camera.target)

  // Update slider
  const slider = document.getElementById('zoom-slider') as HTMLInputElement
  slider.value = String(currentZoom)
  document.getElementById('zoom-slider-val')!.textContent = currentZoom.toFixed(2)

  updateCameraStateDisplay()
  updateCursorReadout()
}

function zoomAtCursor(factor: number, screenX: number, screenY: number): void {
  // Record world position under cursor before zoom
  const beforeHit = pickTerrainAt(screenX, screenY)

  // Apply zoom
  setZoom(factor)

  // If we have a "before" position, adjust camera target to keep it under cursor
  if (beforeHit) {
    const afterHit = pickTerrainAt(screenX, screenY)
    if (afterHit) {
      // Adjust target so the world position under cursor stays the same
      const delta = beforeHit.subtract(afterHit)
      camera.target = clampToMapBounds(camera.target.add(delta))
    }
  }

  updateCameraStateDisplay()
  updateCursorReadout()
}

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-zoom-in')!.addEventListener('click', () => {
  const rect = canvas.getBoundingClientRect()
  zoomAtCursor(currentZoom * 1.25, rect.width / 2, rect.height / 2)
})

document.getElementById('btn-zoom-out')!.addEventListener('click', () => {
  const rect = canvas.getBoundingClientRect()
  zoomAtCursor(currentZoom / 1.25, rect.width / 2, rect.height / 2)
})

document.getElementById('btn-zoom-reset')!.addEventListener('click', () => {
  const rect = canvas.getBoundingClientRect()
  zoomAtCursor(1.0, rect.width / 2, rect.height / 2)
})

document.getElementById('btn-reset-cam')!.addEventListener('click', () => {
  camera.target = new Vector3(MAP_MAX_X / 2, 0, MAP_MAX_Z / 2)
  camera.alpha = -Math.PI / 2
  camera.beta = Math.PI / 3
  setZoom(1.0)
  referenceWPosForDrift = null
  updateCameraStateDisplay()
  updateCursorReadout()
})

document.getElementById('btn-toggle-mode')!.addEventListener('click', () => {
  if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
    camera.mode = Camera.PERSPECTIVE_CAMERA
    camera.radius = 20 / currentZoom
  } else {
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA
    const orthoSize = BASE_ORTHO_SIZE / currentZoom
    camera.orthoTop = orthoSize
    camera.orthoBottom = -orthoSize
    camera.orthoLeft = -orthoSize
    camera.orthoRight = orthoSize
  }
  updateCameraStateDisplay()
  updateCursorReadout()
})

document.getElementById('btn-toggle-grid')!.addEventListener('click', () => {
  gridVisible = !gridVisible
  for (const node of gridNodes) {
    node.isVisible = gridVisible
  }
  const btn = document.getElementById('btn-toggle-grid')!
  btn.classList.toggle('active', !gridVisible)
})

document.getElementById('btn-toggle-bounds')!.addEventListener('click', () => {
  boundsVisible = !boundsVisible
  for (const node of boundsNodes) {
    node.isVisible = boundsVisible
  }
  const btn = document.getElementById('btn-toggle-bounds')!
  btn.classList.toggle('active', !boundsVisible)
})

document.getElementById('btn-toggle-edge-zones')!.addEventListener('click', () => {
  edgeZonesVisible = !edgeZonesVisible
  if (!edgeZonesVisible) {
    for (const el of [edgeTop, edgeBottom, edgeLeft, edgeRight]) {
      el.classList.remove('active')
    }
  }
  const btn = document.getElementById('btn-toggle-edge-zones')!
  btn.classList.toggle('active', !edgeZonesVisible)
})

// ---------------------------------------------------------------------------
// Zoom Slider
// ---------------------------------------------------------------------------

const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement
zoomSlider.addEventListener('input', () => {
  const factor = parseFloat(zoomSlider.value)
  const rect = canvas.getBoundingClientRect()
  zoomAtCursor(factor, rect.width / 2, rect.height / 2)
})

// ---------------------------------------------------------------------------
// Lock Reference Point for Drift Measurement
// ---------------------------------------------------------------------------

canvas.addEventListener('click', (event) => {
  if (event.shiftKey) {
    // Shift+click: lock reference point
    if (lastWPosUnderCursor) {
      referenceWPosForDrift = { ...lastWPosUnderCursor }
      updateCursorReadout()
      // Flash the drift display
      const driftEl = document.getElementById('cursor-drift')!
      driftEl.classList.add('coord-flash')
      setTimeout(() => driftEl.classList.remove('coord-flash'), 300)
    }
  }
})

// Add reference lock hint to crosshair
canvas.addEventListener('dblclick', (event) => {
  if (!event.shiftKey && lastWPosUnderCursor) {
    referenceWPosForDrift = { ...lastWPosUnderCursor }
    updateCursorReadout()
    const driftEl = document.getElementById('cursor-drift')!
    driftEl.classList.add('coord-flash')
    setTimeout(() => driftEl.classList.remove('coord-flash'), 300)
  }
})

// ---------------------------------------------------------------------------
// Prevent browser context menu and gesture navigation on right-click drag
// contextmenu → blocks right-click popup menu
// pointerdown with button===2 → blocks Chromium back/forward swipe gesture
// ---------------------------------------------------------------------------

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 2) {  // right mouse button
    event.preventDefault()
    _isRightDragging = true
  }
}, { passive: false })

// ---------------------------------------------------------------------------
// Mouse Events for Edge Detection & Cursor Readout
// ---------------------------------------------------------------------------

canvas.addEventListener('mousemove', (event) => {
  updateCursorReadout(event)
  updateEdgeZones(event)
  if (_isRightDragging) {
    event.preventDefault()
    // DEBUG: uncomment to verify gesture prevention is active
    // console.debug('[gesture] prevented at mousemove', event.movementX, event.movementY)
  }
}, { passive: false })

canvas.addEventListener('wheel', (event) => {
  event.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const screenX = event.clientX - rect.left
  const screenY = event.clientY - rect.top

  const zoomDelta = event.deltaY < 0 ? 1.15 : 1 / 1.15
  zoomAtCursor(currentZoom * zoomDelta, screenX, screenY)
}, { passive: false })

canvas.addEventListener('pointerup', (event) => {
  if (event.button === 2) {
    _isRightDragging = false
  }
}, { passive: false })

canvas.addEventListener('pointerleave', () => {
  _isRightDragging = false
})

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (event) => {
  const rect = canvas.getBoundingClientRect()
  const centerX = rect.width / 2
  const centerY = rect.height / 2

  switch (event.key.toLowerCase()) {
    case '=':
    case '+':
      zoomAtCursor(currentZoom * 1.25, centerX, centerY)
      break
    case '-':
      zoomAtCursor(currentZoom / 1.25, centerX, centerY)
      break
    case '0':
      zoomAtCursor(1.0, centerX, centerY)
      break
    case 'm':
      document.getElementById('btn-toggle-mode')!.click()
      break
    case 'g':
      document.getElementById('btn-toggle-grid')!.click()
      break
    case 'b':
      document.getElementById('btn-toggle-bounds')!.click()
      break
    case 'e':
      document.getElementById('btn-toggle-edge-zones')!.click()
      break
    case 'r':
      document.getElementById('btn-reset-cam')!.click()
      break
    case 'l':
      // Lock reference point at center
      if (lastWPosUnderCursor) {
        referenceWPosForDrift = { ...lastWPosUnderCursor }
        updateCursorReadout()
      }
      break
    default:
      return
  }
})

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  // Clamp camera target to map bounds every frame
  const unclamped = camera.target.clone()
  const clamped = clampToMapBounds(unclamped)
  if (!unclamped.equals(clamped)) {
    camera.target = clamped
  }

  scene.render()
  updateCameraStateDisplay()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
  updateCursorReadout()
})

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

updateCameraStateDisplay()
updateCursorReadout()

// ---------------------------------------------------------------------------
// Test Harness (for programmatic verification)
// ---------------------------------------------------------------------------

;(window as any).__cameraTestHarness = {
  scene,
  camera,
  engine,
  getCurrentZoom: () => currentZoom,
  getCameraMode: () => camera.mode === Camera.ORTHOGRAPHIC_CAMERA ? 'ortho' : 'persp',
  getCameraTarget: () => camera.target.clone(),
  getLastWPosUnderCursor: () => lastWPosUnderCursor,
  getReferenceWPos: () => referenceWPosForDrift,
  pickTerrainAt,
  wPosToVector3,
  vector3ToWPos,
  setZoom,
  zoomAtCursor,
  setReferencePoint: (wx: number, wy: number, wz: number) => {
    referenceWPosForDrift = { x: wx, y: wy, z: wz }
    updateCursorReadout()
  },
  getMarkerPositions: () => markers.map(m => ({
    label: m.label,
    wpos: m.wpos,
    vec3: m.vec3.clone(),
    screenPos: (() => {
      const projected = Vector3.Project(
        m.vec3,
        Matrix.Identity(),
        scene.getTransformMatrix(),
        camera.viewport.toGlobal(
          engine.getRenderWidth(),
          engine.getRenderHeight(),
        ),
      )
      return { x: projected.x, y: projected.y }
    })(),
  })),
}
