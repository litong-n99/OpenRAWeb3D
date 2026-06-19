/**
 * selection-visual/main.ts — SelectionUtils visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Widgets/SelectionUtils.cs (86 lines) +
 *             WorldInteractionControllerWidget (selection interaction logic)
 *
 * Verifies:
 *   E1. Single-click selection highlight (≤1 frame response)
 *   E2. Rubber-band drag selection (white dashed #FFF, 2px, dash=[6,4])
 *   E3. Shift modifier: add/remove from existing selection
 *   E4. Health bars proportional to HP%
 *   E5. Empty-click clears all selections
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
  AbstractMesh,
  CreateBox,
  CreateTorus,
  CreateGround,
  CreateLines,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUND_SIZE = 10

/** Deadzone for drag selection (matches OpenRA default). */
const DEADZONE_PX = 4

/** Selection ring color (gold). */
const SELECTION_COLOR = new Color3(1, 0.843, 0) // #FFD700
const SELECTION_EMISSIVE = new Color3(0.6, 0.5, 0)

/** Bounding box color. */
const BOUNDS_COLOR = new Color3(0, 1, 0) // #00FF00

// ---------------------------------------------------------------------------
// Actor definition
// ---------------------------------------------------------------------------

interface TestActor {
  id: string
  label: string
  position: Vector3
  bodyColor: Color3
  hpPct: number    // 0.0 - 1.0
  priority: number
  radius: number   // body radius in Babylon units
  selectionClass: string  // BLOCKER fix: group for double-click select-all-same-type

  // Babylon.js meshes
  body: Mesh
  groundLabel: Mesh          // small colored disc on ground
  selectionRing: Mesh        // torus (visible when selected)
  healthBarBg: Mesh          // dark red background box
  healthBarFill: Mesh        // green/yellow/red fill box
  boundsFrame: LinesMesh     // wireframe bounding box
}

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const rubberBand = document.getElementById('rubber-band') as HTMLDivElement
const selectionList = document.getElementById('selection-list') as HTMLDivElement
const eventLog = document.getElementById('event-log') as HTMLDivElement
const statCount = document.getElementById('stat-count') as HTMLSpanElement
const statLastAction = document.getElementById('stat-last-action') as HTMLSpanElement
const modShift = document.getElementById('mod-shift') as HTMLSpanElement
const modCtrl = document.getElementById('mod-ctrl') as HTMLSpanElement

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, antialias: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

// Camera: RTS top-down view (matching Viewport.ts)
const camera = new ArcRotateCamera(
  'rtsCam',
  -Math.PI / 2,
  Math.PI / 3,
  20,
  new Vector3(5, 0, 5),
  scene,
)
camera.mode = Camera.ORTHOGRAPHIC_CAMERA
camera.orthoTop = 6
camera.orthoBottom = -6
camera.orthoLeft = -6
camera.orthoRight = 6
camera.lowerRadiusLimit = 3
camera.upperRadiusLimit = 50
camera.inputs.clear()
camera.attachControl(canvas, true)

// Lighting
const light = new HemisphericLight('hemi', new Vector3(0.5, 1, 0.3), scene)
light.intensity = 0.9

// ---------------------------------------------------------------------------
// Ground & Reference Grid
// ---------------------------------------------------------------------------

const ground = CreateGround('ground', { width: GROUND_SIZE + 2, height: GROUND_SIZE + 2 }, scene)
ground.position = new Vector3(GROUND_SIZE / 2, -0.02, GROUND_SIZE / 2)
const gmat = new StandardMaterial('gmat', scene)
gmat.diffuseColor = new Color3(0.12, 0.15, 0.20)
gmat.specularColor = new Color3(0, 0, 0)
ground.material = gmat

// Grid lines
for (let i = 0; i <= GROUND_SIZE; i++) {
  const hLine = CreateLines('hLine', {
    points: [new Vector3(i, 0.005, 0), new Vector3(i, 0.005, GROUND_SIZE)],
  }, scene)
  hLine.color = new Color3(0.2, 0.35, 0.6)
  hLine.alpha = i % 5 === 0 ? 0.5 : 0.2
}
for (let j = 0; j <= GROUND_SIZE; j++) {
  const vLine = CreateLines('vLine', {
    points: [new Vector3(0, 0.005, j), new Vector3(GROUND_SIZE, 0.005, j)],
  }, scene)
  vLine.color = new Color3(0.2, 0.35, 0.6)
  vLine.alpha = j % 5 === 0 ? 0.5 : 0.2
}

// ---------------------------------------------------------------------------
// Create Actor
// ---------------------------------------------------------------------------

const actors: TestActor[] = []

function createActor(
  id: string,
  label: string,
  pos: Vector3,
  bodyColor: Color3,
  hpPct: number,
  priority: number,
  radius: number,
  bodyType: 'sphere' | 'box',
  selectionClass: string,  // BLOCKER fix: for double-click select-all-same-type
): TestActor {
  // Body mesh
  let body: Mesh
  if (bodyType === 'sphere') {
    body = MeshBuilder.CreateSphere(`body_${id}`, { diameter: radius * 2 }, scene)
  } else {
    body = CreateBox(`body_${id}`, { width: radius * 2, height: radius * 1.5, depth: radius * 2 }, scene)
  }
  body.position = pos.clone()
  const bodyMat = new StandardMaterial(`bodyMat_${id}`, scene)
  bodyMat.diffuseColor = bodyColor
  bodyMat.specularColor = new Color3(0.1, 0.1, 0.1)
  bodyMat.emissiveColor = bodyColor.scale(0.15)
  body.material = bodyMat
  body.metadata = { actorId: id }

  // Ground label disc
  const labelDisc = MeshBuilder.CreateDisc(`label_${id}`, { radius: radius * 0.7 }, scene)
  labelDisc.rotation.x = Math.PI / 2
  labelDisc.position = new Vector3(pos.x, 0.01, pos.z)
  const lmat = new StandardMaterial(`lmat_${id}`, scene)
  lmat.diffuseColor = bodyColor.scale(0.7)
  lmat.alpha = 0.6
  lmat.specularColor = new Color3(0, 0, 0)
  labelDisc.material = lmat
  labelDisc.metadata = { actorId: id }

  // Selection ring (torus, hidden by default)
  const ring = CreateTorus(`ring_${id}`, {
    diameter: radius * 2 * 1.2,
    thickness: 0.05,
    tessellation: 32,
  }, scene)
  ring.position = new Vector3(pos.x, 0.05, pos.z)
  ring.rotation.x = Math.PI / 2 // lay flat on ground
  const rmat = new StandardMaterial(`rmat_${id}`, scene)
  rmat.diffuseColor = SELECTION_COLOR
  rmat.emissiveColor = SELECTION_EMISSIVE
  rmat.specularColor = new Color3(0, 0, 0)
  rmat.alpha = 0.9
  ring.material = rmat
  ring.isVisible = false
  ring.isPickable = false

  // Health bar background (box above actor, hidden by default)
  const hbWidth = radius * 2 * 1.5
  const hbHeight = 0.08
  const hbY = pos.y + radius * 1.6
  const hbBg = CreateBox(`hpBg_${id}`, { width: hbWidth, height: hbHeight, depth: 0.04 }, scene)
  hbBg.position = new Vector3(pos.x, hbY, pos.z)
  const hbBgMat = new StandardMaterial(`hbBgMat_${id}`, scene)
  hbBgMat.diffuseColor = new Color3(0.545, 0, 0) // #8B0000 dark red
  hbBgMat.emissiveColor = new Color3(0.15, 0, 0)
  hbBgMat.specularColor = new Color3(0, 0, 0)
  hbBgMat.alpha = 0.85
  hbBg.material = hbBgMat
  hbBg.isVisible = false
  hbBg.isPickable = false

  // Health bar fill (green/yellow/red box, scaled by HP)
  const hbFill = CreateBox(`hpFill_${id}`, { width: hbWidth, height: hbHeight * 0.8, depth: 0.05 }, scene)
  hbFill.position = new Vector3(pos.x - hbWidth * (1 - hpPct) / 2, hbY, pos.z + 0.001)
  hbFill.scaling.x = hpPct
  const hbFillMat = new StandardMaterial(`hbFillMat_${id}`, scene)
  // Color gradient: green (100%) → yellow (50%) → red (25% or less)
  if (hpPct >= 0.75) {
    hbFillMat.diffuseColor = new Color3(0, 1, 0)
    hbFillMat.emissiveColor = new Color3(0, 0.3, 0)
  } else if (hpPct >= 0.4) {
    // Interpolate green → yellow
    const t = (hpPct - 0.4) / 0.35
    hbFillMat.diffuseColor = new Color3(1 - t, 1, 0)
    hbFillMat.emissiveColor = new Color3((1 - t) * 0.3, 0.3, 0)
  } else if (hpPct >= 0.15) {
    // Interpolate yellow → red
    const t = (hpPct - 0.15) / 0.25
    hbFillMat.diffuseColor = new Color3(1, t, 0)
    hbFillMat.emissiveColor = new Color3(0.3, t * 0.3, 0)
  } else {
    hbFillMat.diffuseColor = new Color3(1, 0, 0)
    hbFillMat.emissiveColor = new Color3(0.3, 0, 0)
  }
  hbFillMat.specularColor = new Color3(0, 0, 0)
  hbFillMat.alpha = 0.9
  hbFill.material = hbFillMat
  hbFill.isVisible = false
  hbFill.isPickable = false

  // Bounding box wireframe (hidden by default)
  const bbox = body.getBoundingInfo().boundingBox
  const bbCorners = [
    bbox.minimumWorld,
    new Vector3(bbox.maximumWorld.x, bbox.minimumWorld.y, bbox.minimumWorld.z),
    bbox.maximumWorld,
    new Vector3(bbox.minimumWorld.x, bbox.maximumWorld.y, bbox.maximumWorld.z),
    new Vector3(bbox.minimumWorld.x, bbox.minimumWorld.y, bbox.maximumWorld.z),
    new Vector3(bbox.maximumWorld.x, bbox.maximumWorld.y, bbox.minimumWorld.z),
    new Vector3(bbox.maximumWorld.x, bbox.minimumWorld.y, bbox.maximumWorld.z),
    new Vector3(bbox.minimumWorld.x, bbox.maximumWorld.y, bbox.minimumWorld.z),
  ]
  const boundsFrame = CreateLines(`bounds_${id}`, {
    points: [
      bbCorners[0], bbCorners[1], bbCorners[2], bbCorners[3],
      bbCorners[0], bbCorners[4], bbCorners[5], bbCorners[1],
      bbCorners[2], bbCorners[6], bbCorners[7], bbCorners[3],
      bbCorners[4], bbCorners[7], bbCorners[5], bbCorners[6],
    ],
  }, scene)
  boundsFrame.color = BOUNDS_COLOR
  boundsFrame.alpha = 0.5
  boundsFrame.isVisible = false
  boundsFrame.isPickable = false

  const actor: TestActor = {
    id, label, position: pos.clone(), bodyColor, hpPct, priority, radius, selectionClass,
    body, groundLabel: labelDisc, selectionRing: ring,
    healthBarBg: hbBg, healthBarFill: hbFill, boundsFrame,
  }
  actors.push(actor)
  return actor
}

// ---------------------------------------------------------------------------
// Spawn test actors
// ---------------------------------------------------------------------------

// Marines (infantry) — red-ish spheres, smaller, priority 10
createActor('marine_a', '陆战队员 A', new Vector3(3, 0.3, 3), new Color3(0.88, 0.19, 0.19), 1.00, 10, 0.35, 'sphere', 'infantry')
createActor('marine_b', '陆战队员 B', new Vector3(5, 0.3, 3), new Color3(0.88, 0.19, 0.19), 0.75, 10, 0.35, 'sphere', 'infantry')
createActor('marine_c', '陆战队员 C', new Vector3(7, 0.3, 3), new Color3(0.88, 0.19, 0.19), 1.00, 10, 0.35, 'sphere', 'infantry')
createActor('marine_d', '陆战队员 D', new Vector3(3, 0.3, 6), new Color3(0.88, 0.19, 0.19), 0.25, 10, 0.35, 'sphere', 'infantry')

// Tanks (vehicles) — blue-ish boxes, larger, priority 50
createActor('tank_alpha', '坦克 Alpha', new Vector3(5, 0.35, 6), new Color3(0.19, 0.25, 0.88), 1.00, 50, 0.65, 'box', 'vehicle')
createActor('tank_beta', '坦克 Beta', new Vector3(7, 0.35, 6), new Color3(0.19, 0.25, 0.88), 0.50, 50, 0.65, 'box', 'vehicle')

// ---------------------------------------------------------------------------
// Selection State
// ---------------------------------------------------------------------------

/** Set of currently selected actor IDs. */
const selectedActors = new Set<string>()

let healthBarsVisible = true

// Modifier tracking
let shiftHeld = false
let ctrlHeld = false

// Double-click state (BLOCKER fix: select-all-same-type on dblclick)
let lastClickTime = 0
let lastClickX = 0
let lastClickY = 0
const DBLCLICK_INTERVAL_MS = 300
const DBLCLICK_RADIUS_PX = 5

// Drag state
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let dragCurrentX = 0
let dragCurrentY = 0
let hasExceededDeadzone = false

// ---------------------------------------------------------------------------
// Selection Highlight Helpers
// ---------------------------------------------------------------------------

function setActorSelected(actor: TestActor, selected: boolean): void {
  actor.selectionRing.isVisible = selected
  actor.boundsFrame.isVisible = selected
  if (healthBarsVisible) {
    actor.healthBarBg.isVisible = selected
    actor.healthBarFill.isVisible = selected
  }
}

function selectActor(actorId: string, source: string = 'click'): void {
  if (selectedActors.has(actorId)) return
  selectedActors.add(actorId)
  const actor = actors.find(a => a.id === actorId)
  if (actor) {
    setActorSelected(actor, true)
  }
  logEvent('select', `${source}: +${actorId}`)
  updateSelectionUI()
}

function deselectActor(actorId: string, source: string = 'click'): void {
  if (!selectedActors.has(actorId)) return
  selectedActors.delete(actorId)
  const actor = actors.find(a => a.id === actorId)
  if (actor) {
    setActorSelected(actor, false)
  }
  logEvent('deselect', `${source}: -${actorId}`)
  updateSelectionUI()
}

function clearSelection(source: string = 'clear'): void {
  if (selectedActors.size === 0) return
  const prevCount = selectedActors.size  // MAJOR fix: capture before clear
  for (const actorId of selectedActors) {
    const actor = actors.find(a => a.id === actorId)
    if (actor) {
      setActorSelected(actor, false)
    }
  }
  selectedActors.clear()
  logEvent('deselect', `${source}: 清除所有 (${prevCount}→0)`)
  updateSelectionUI()
}

function selectAll(source: string = 'selectAll'): void {
  for (const actor of actors) {
    if (!selectedActors.has(actor.id)) {
      selectedActors.add(actor.id)
      setActorSelected(actor, true)
    }
  }
  logEvent('select', `${source}: 全选 (${actors.length})`)
  updateSelectionUI()
}

/** BLOCKER fix: Double-click selects all actors of the same selectionClass */
function selectAllOfSameClass(targetClass: string, source: string = 'dblclick'): void {
  const matching = actors.filter(a => a.selectionClass === targetClass)
  for (const actor of matching) {
    if (!selectedActors.has(actor.id)) {
      selectedActors.add(actor.id)
      setActorSelected(actor, true)
    }
  }
  logEvent('select', `${source}: 全选同类 '${targetClass}' (${matching.length})`)
  updateSelectionUI()
}

function toggleActorSelection(actorId: string): void {
  if (selectedActors.has(actorId)) {
    deselectActor(actorId, 'shift-toggle')
  } else {
    selectActor(actorId, 'shift-toggle')
  }
}

// ---------------------------------------------------------------------------
// Rubber-band Box
// ---------------------------------------------------------------------------

function showRubberBand(startX: number, startY: number, currentX: number, currentY: number): void {
  const left = Math.min(startX, currentX)
  const top = Math.min(startY, currentY)
  const width = Math.abs(currentX - startX)
  const height = Math.abs(currentY - startY)

  rubberBand.style.display = 'block'
  rubberBand.style.left = `${left}px`
  rubberBand.style.top = `${top}px`
  rubberBand.style.width = `${width}px`
  rubberBand.style.height = `${height}px`
}

function hideRubberBand(): void {
  rubberBand.style.display = 'none'
}

// ---------------------------------------------------------------------------
// Hit Testing (actors under a screen point or within a screen rect)
// ---------------------------------------------------------------------------

function getActorsAtPoint(screenX: number, screenY: number): TestActor[] {
  const pickInfo = scene.pick(screenX, screenY)
  if (pickInfo?.hit && pickInfo.pickedMesh) {
    // Walk up to find the body mesh with actor metadata
    let mesh: AbstractMesh | null = pickInfo.pickedMesh
    while (mesh) {
      if (mesh.metadata?.actorId) {
        const actor = actors.find(a => a.id === mesh!.metadata.actorId)
        if (actor) return [actor]
      }
      mesh = mesh.parent as AbstractMesh | null
    }
  }
  return []
}

function getActorsInRect(left: number, top: number, right: number, bottom: number): TestActor[] {
  const result: TestActor[] = []
  for (const actor of actors) {
    // Project actor position to screen
    const projected = Vector3.Project(
      actor.body.position,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    )
    if (projected.x >= left && projected.x <= right &&
        projected.y >= top && projected.y <= bottom) {
      result.push(actor)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// UI Update
// ---------------------------------------------------------------------------

function updateSelectionUI(): void {
  statCount.textContent = String(selectedActors.size)

  if (selectedActors.size === 0) {
    selectionList.innerHTML = '<span style="color:#667;">(无)</span>'
  } else {
    selectionList.innerHTML = Array.from(selectedActors)
      .map(id => `<span style="color:#ffd700;">${id}</span>`)
      .join(', ')
  }
}

function updateModifierIndicators(): void {
  modShift.textContent = shiftHeld ? 'ON' : 'OFF'
  modShift.className = 'modifier-indicator' + (shiftHeld ? ' pressed' : '')
  modCtrl.textContent = ctrlHeld ? 'ON' : 'OFF'
  modCtrl.className = 'modifier-indicator' + (ctrlHeld ? ' pressed' : '')
}

// ---------------------------------------------------------------------------
// Event Log
// ---------------------------------------------------------------------------

function logEvent(type: 'select' | 'deselect' | 'box', message: string): void {
  statLastAction.textContent = message.length > 30 ? message.substring(0, 28) + '…' : message

  const entry = document.createElement('div')
  entry.className = `entry ${type}`
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`
  eventLog.insertBefore(entry, eventLog.firstChild)

  // Keep log at reasonable size
  while (eventLog.children.length > 50) {
    eventLog.removeChild(eventLog.lastChild!)
  }
}

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
// Pointer Event Handlers
// ---------------------------------------------------------------------------

function getCanvasRelative(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

canvas.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button !== 0) return // only left button

  const { x, y } = getCanvasRelative(event)

  // Right-click passthrough (context menu handled separately)
  isDragging = true
  dragStartX = x
  dragStartY = y
  dragCurrentX = x
  dragCurrentY = y
  hasExceededDeadzone = false
  hideRubberBand()
}, { passive: false })

canvas.addEventListener('pointermove', (event: PointerEvent) => {
  if (!isDragging) return

  const { x, y } = getCanvasRelative(event)
  dragCurrentX = x
  dragCurrentY = y

  const dx = x - dragStartX
  const dy = y - dragStartY
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist > DEADZONE_PX) {
    if (!hasExceededDeadzone) {
      hasExceededDeadzone = true
      logEvent('box', `开始拖拽框选 (起点: ${dragStartX.toFixed(0)},${dragStartY.toFixed(0)})`)
    }
    showRubberBand(dragStartX, dragStartY, x, y)
  }
}, { passive: false })

canvas.addEventListener('pointerup', (event: PointerEvent) => {
  if (!isDragging || event.button !== 0) return
  isDragging = false

  const dx = dragCurrentX - dragStartX
  const dy = dragCurrentY - dragStartY
  const dist = Math.sqrt(dx * dx + dy * dy)

  hideRubberBand()

  if (dist <= DEADZONE_PX && !hasExceededDeadzone) {
    // Click behavior (point selection)
    const hits = getActorsAtPoint(dragStartX, dragStartY)
    if (hits.length > 0) {
      const actor = hits[0] // highest priority would be selected by SelectionUtils

      // BLOCKER fix: double-click detection for select-all-same-type
      const now = performance.now()
      const isDoubleClick =
        now - lastClickTime < DBLCLICK_INTERVAL_MS &&
        Math.abs(dragStartX - lastClickX) < DBLCLICK_RADIUS_PX &&
        Math.abs(dragStartY - lastClickY) < DBLCLICK_RADIUS_PX

      if (isDoubleClick) {
        selectAllOfSameClass(actor.selectionClass, 'dblclick')
        lastClickTime = 0 // reset to prevent triple-click cascade
      } else if (shiftHeld) {
        toggleActorSelection(actor.id)
      } else {
        // Clear existing and select new (single select)
        clearSelection('click')
        selectActor(actor.id, 'click')
      }

      lastClickTime = now; lastClickX = dragStartX; lastClickY = dragStartY
    } else {
      // Click on empty ground → clear all
      clearSelection('空地点击')
      lastClickTime = 0
    }
  } else {
    // Drag box selection
    const left = Math.min(dragStartX, dragCurrentX)
    const top = Math.min(dragStartY, dragCurrentY)
    const right = Math.max(dragStartX, dragCurrentX)
    const bottom = Math.max(dragStartY, dragCurrentY)

    const actorsInBox = getActorsInRect(left, top, right, bottom)

    if (!shiftHeld) {
      clearSelection('框选')
    }
    for (const actor of actorsInBox) {
      selectActor(actor.id, '框选')
    }
    logEvent('box', `框选完成: ${actorsInBox.length} 个actor (rect: ${left.toFixed(0)}-${right.toFixed(0)}, ${top.toFixed(0)}-${bottom.toFixed(0)})`)
  }
}, { passive: false })

// Prevent context menu on right-click within canvas
canvas.addEventListener('contextmenu', (event: Event) => {
  event.preventDefault()
})

// ---------------------------------------------------------------------------
// Keyboard Handlers
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Shift') {
    shiftHeld = true
    updateModifierIndicators()
  }
  if (event.key === 'Control') {
    ctrlHeld = true
    updateModifierIndicators()
  }
  if (event.key === 'Escape') {
    clearSelection('Esc')
    event.preventDefault()
  }
})

window.addEventListener('keyup', (event: KeyboardEvent) => {
  if (event.key === 'Shift') {
    shiftHeld = false
    updateModifierIndicators()
  }
  if (event.key === 'Control') {
    ctrlHeld = false
    updateModifierIndicators()
  }
})

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-reset')!.addEventListener('click', () => {
  clearSelection('重置按钮')
})

document.getElementById('btn-select-marine-a')!.addEventListener('click', () => {
  if (!shiftHeld) clearSelection('按钮')
  selectActor('marine_a', '按钮')
})

document.getElementById('btn-select-tank-alpha')!.addEventListener('click', () => {
  if (!shiftHeld) clearSelection('按钮')
  selectActor('tank_alpha', '按钮')
})

document.getElementById('btn-select-all')!.addEventListener('click', () => {
  selectAll('按钮')
})

document.getElementById('btn-deselect-all')!.addEventListener('click', () => {
  clearSelection('按钮')
})

document.getElementById('btn-toggle-healthbars')!.addEventListener('click', () => {
  healthBarsVisible = !healthBarsVisible
  const btn = document.getElementById('btn-toggle-healthbars')!
  btn.classList.toggle('active', !healthBarsVisible)
  // Update visibility for all selected actors
  for (const actorId of selectedActors) {
    const actor = actors.find(a => a.id === actorId)
    if (actor) {
      actor.healthBarBg.isVisible = healthBarsVisible
      actor.healthBarFill.isVisible = healthBarsVisible
    }
  }
  logEvent('box', `血量条: ${healthBarsVisible ? '显示' : '隐藏'}`)
})

// ---------------------------------------------------------------------------
// Wheel: Zoom
// ---------------------------------------------------------------------------

canvas.addEventListener('wheel', (event: WheelEvent) => {
  event.preventDefault()
  const zoomDelta = event.deltaY < 0 ? 1.15 : 1 / 1.15
  if (camera.mode === Camera.ORTHOGRAPHIC_CAMERA) {
    const factor = zoomDelta
    camera.orthoTop = (camera.orthoTop ?? 6) * factor
    camera.orthoBottom = (camera.orthoBottom ?? -6) * factor
    camera.orthoLeft = (camera.orthoLeft ?? -6) * factor
    camera.orthoRight = (camera.orthoRight ?? 6) * factor
  } else {
    camera.radius = Math.max(3, Math.min(50, camera.radius * zoomDelta))
  }
}, { passive: false })

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// ---------------------------------------------------------------------------
// Test Harness (for programmatic verification)
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  // Selection operations
  clickActor(id: string): void {
    const actor = actors.find(a => a.id === id)
    if (!actor) throw new Error(`Actor not found: ${id}`)
    if (!shiftHeld) clearSelection('harness')
    selectActor(id, 'harness')
  },

  dragSelect(start: { x: number; y: number }, end: { x: number; y: number }): void {
    const left = Math.min(start.x, end.x)
    const top = Math.min(start.y, end.y)
    const right = Math.max(start.x, end.x)
    const bottom = Math.max(start.y, end.y)

    const actorsInBox = getActorsInRect(left, top, right, bottom)
    if (!shiftHeld) clearSelection('harness-drag')
    for (const actor of actorsInBox) {
      selectActor(actor.id, 'harness-drag')
    }
  },

  getSelectedActors(): string[] {
    return Array.from(selectedActors)
  },

  getSelectionBoxBounds(): { left: number; top: number; right: number; bottom: number } | null {
    if (rubberBand.style.display === 'none') return null
    return {
      left: parseInt(rubberBand.style.left) || 0,
      top: parseInt(rubberBand.style.top) || 0,
      right: (parseInt(rubberBand.style.left) || 0) + (parseInt(rubberBand.style.width) || 0),
      bottom: (parseInt(rubberBand.style.top) || 0) + (parseInt(rubberBand.style.height) || 0),
    }
  },

  getHealthBarVisibility(): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    for (const actor of actors) {
      result[actor.id] = actor.healthBarBg.isVisible
    }
    return result
  },

  reset(): void {
    clearSelection('harness-reset')
    hideRubberBand()
    shiftHeld = false
    ctrlHeld = false
    updateModifierIndicators()
  },

  // Environment access
  scene,
  camera,
  engine,

  // Actor info
  getActors: () => actors.map(a => ({
    id: a.id,
    label: a.label,
    position: a.position.clone(),
    hpPct: a.hpPct,
    priority: a.priority,
    selected: selectedActors.has(a.id),
    bodyColor: a.bodyColor,
  })),

  // Canvas helpers
  getCanvasRect: () => canvas.getBoundingClientRect(),
  getActorsAtPoint,
  getActorsInRect,

  // Modifier state
  isShiftHeld: () => shiftHeld,
  isCtrlHeld: () => ctrlHeld,

  // Health bars toggle
  areHealthBarsVisible: () => healthBarsVisible,

  // Selection helpers
  selectAll,
  clearSelection,
  isSelected: (id: string) => selectedActors.has(id),
}
