/**
 * world-interaction/bridge/main.ts — WorldInteractionControllerWidget acceptance test
 *
 * OpenRA 对照: OpenRA.Mods.Common.Widgets/WorldInteractionControllerWidget.cs
 *
 * Verifies:
 * 1. Context menu suppression on right-click
 * 2. Single-click raycast entity selection with modifier keys
 * 3. Double-click select-all-of-same-class (within 300ms/5px)
 * 4. Drag-box multi-selection with deadzone fallback to raycast
 * 5. Right-click order dispatch (Attack vs Move depending on entity hit)
 * 6. Mouse-over rollover detection (updates in real-time)
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  Vector3,
  Color4,
  Color3,
  MeshBuilder,
  StandardMaterial,
} from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import { WorldInteractionControllerWidget } from '../../../../OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget'
import type {
  IGameWorld,
  WorldInteractionCallbacks,
  SelectableEntity,
  ModifierState,
  ScreenPoint,
  WorldPosition,
  Order,
} from '../../../../OpenRA.Mods.Common/Widgets/WorldInteractionControllerWidget'

// ---------------------------------------------------------------------------
// Canvas / Engine / Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.12, 0.14, 0.20, 1)

// ---------------------------------------------------------------------------
// Camera (keyboard + wheel control only — no mouse drag to avoid conflict)
// ---------------------------------------------------------------------------

const camera = new ArcRotateCamera(
  'camera',
  -Math.PI / 4,
  Math.PI / 3.3,
  14,
  new Vector3(4.5, 0.3, 4.5),
  scene,
)
camera.lowerRadiusLimit = 2
camera.upperRadiusLimit = 40
camera.lowerBetaLimit = 0.1
camera.upperBetaLimit = Math.PI / 2 - 0.05

// Keyboard camera control
window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowLeft':  camera.alpha -= 0.07; break
    case 'ArrowRight': camera.alpha += 0.07; break
    case 'ArrowUp':    camera.beta  -= 0.07; break
    case 'ArrowDown':  camera.beta  += 0.07; break
    case 'r':
    case 'R':
      camera.alpha = -Math.PI / 4
      camera.beta = Math.PI / 3.3
      camera.radius = 14
      camera.target = new Vector3(4.5, 0.3, 4.5)
      break
  }
})

// Mouse wheel zoom
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  camera.radius += e.deltaY * 0.015
  camera.radius = Math.max(camera.lowerRadiusLimit!, Math.min(camera.upperRadiusLimit!, camera.radius))
}, { passive: false })

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

new HemisphericLight('hemi', new Vector3(0.4, 1, 0.3), scene)
new HemisphericLight('fill', new Vector3(-0.3, -0.2, -0.4), scene).intensity = 0.3

// ---------------------------------------------------------------------------
// Ground Plane
// ---------------------------------------------------------------------------

const groundMesh = MeshBuilder.CreatePlane(
  'ground',
  { width: 14, height: 14 },
  scene,
)
groundMesh.rotation = new Vector3(Math.PI / 2, 0, 0)
groundMesh.position = new Vector3(5, -0.05, 5)
groundMesh.isPickable = true

const groundMat = new StandardMaterial('groundMat', scene)
groundMat.diffuseColor = new Color3(0.28, 0.33, 0.22)
groundMat.specularColor = new Color3(0.05, 0.05, 0.05)
groundMesh.material = groundMat

// ---------------------------------------------------------------------------
// Entity Definitions
// ---------------------------------------------------------------------------

interface EntityDef {
  id: string
  pos: [number, number, number]   // x, y, z
  size: [number, number, number]  // w, h, d
  color: [number, number, number] // r, g, b
  selectionClass: string
  ownerId: string
  priority: number
  label: string
}

const entityDefs: EntityDef[] = [
  { id: 'inf-1', pos: [2.0, 0.45, 2.5], size: [0.6, 0.9, 0.6], color: [0.90, 0.20, 0.20], selectionClass: 'Infantry',  ownerId: 'player', priority: 1, label: 'Infantry A' },
  { id: 'inf-2', pos: [3.5, 0.45, 3.0], size: [0.6, 0.9, 0.6], color: [0.90, 0.20, 0.20], selectionClass: 'Infantry',  ownerId: 'player', priority: 1, label: 'Infantry B' },
  { id: 'veh-1', pos: [2.0, 0.70, 5.5], size: [1.0, 1.4, 1.0], color: [0.12, 0.53, 0.90], selectionClass: 'Vehicle',   ownerId: 'player', priority: 2, label: 'Vehicle A' },
  { id: 'veh-2', pos: [4.0, 0.70, 6.0], size: [1.0, 1.4, 1.0], color: [0.12, 0.53, 0.90], selectionClass: 'Vehicle',   ownerId: 'player', priority: 2, label: 'Vehicle B' },
  { id: 'str-1', pos: [6.5, 1.00, 2.5], size: [1.6, 2.0, 1.6], color: [0.18, 0.63, 0.20], selectionClass: 'Structure', ownerId: 'player', priority: 3, label: 'Structure A' },
  { id: 'str-2', pos: [7.0, 1.00, 5.5], size: [1.6, 2.0, 1.6], color: [0.18, 0.63, 0.20], selectionClass: 'Structure', ownerId: 'player', priority: 3, label: 'Structure B' },
  { id: 'enm-i', pos: [3.5, 0.45, 8.0], size: [0.6, 0.9, 0.6], color: [0.72, 0.11, 0.11], selectionClass: 'Infantry',  ownerId: 'enemy',  priority: 1, label: 'Enemy Inf' },
  { id: 'enm-v', pos: [6.0, 0.70, 8.0], size: [1.0, 1.4, 1.0], color: [0.05, 0.28, 0.63], selectionClass: 'Vehicle',   ownerId: 'enemy',  priority: 2, label: 'Enemy Veh' },
]

// ---------------------------------------------------------------------------
// Create entity boxes in the scene
// ---------------------------------------------------------------------------

interface EntityInstance {
  def: EntityDef
  mesh: Mesh
  selectable: SelectableEntity
}

const entityInstances: EntityInstance[] = []

for (const def of entityDefs) {
  const mesh = MeshBuilder.CreateBox(def.id, {
    width:  def.size[0],
    height: def.size[1],
    depth:  def.size[2],
  }, scene)
  mesh.position = new Vector3(def.pos[0], def.pos[1], def.pos[2])
  mesh.isPickable = true

  const mat = new StandardMaterial(`${def.id}_mat`, scene)
  mat.diffuseColor = new Color3(def.color[0], def.color[1], def.color[2])
  mat.specularColor = new Color3(0.1, 0.1, 0.1)
  mesh.material = mat

  // Compute bounding box from mesh data
  const bb = mesh.getBoundingInfo().boundingBox
  const selectable: SelectableEntity = {
    id: def.id,
    mesh,
    ownerId: def.ownerId,
    selectionClass: def.selectionClass,
    selectionPriority: def.priority,
    boundingBox: {
      minimum: { x: bb.minimum.x, y: bb.minimum.y, z: bb.minimum.z },
      maximum: { x: bb.maximum.x, y: bb.maximum.y, z: bb.maximum.z },
    },
  }

  entityInstances.push({ def, mesh, selectable })
}

// Pre-allocated arrays to avoid per-frame allocations on pointer move (60 Hz)
const selectableEntities: SelectableEntity[] = entityInstances.map((e) => e.selectable)
const eligiblePlayers: string[] = ['player']

// ---------------------------------------------------------------------------
// Modifier Key State
// ---------------------------------------------------------------------------

const modifierState: ModifierState = { shift: false, ctrl: false, alt: false }

function updateModifierKeys(e: KeyboardEvent): void {
  modifierState.shift = e.shiftKey
  modifierState.ctrl  = e.ctrlKey
  modifierState.alt   = e.altKey
}

window.addEventListener('keydown', (e) => {
  updateModifierKeys(e)
  updateModUI()
})
window.addEventListener('keyup', (e) => {
  updateModifierKeys(e)
  updateModUI()
})

function updateModUI(): void {
  const elShift = document.getElementById('mod-shift')!
  const elCtrl  = document.getElementById('mod-ctrl')!
  const elAlt   = document.getElementById('mod-alt')!
  elShift.classList.toggle('active', modifierState.shift)
  elCtrl.classList.toggle('active', modifierState.ctrl)
  elAlt.classList.toggle('active', modifierState.alt)
}

// ---------------------------------------------------------------------------
// Selection state (tracked by the test harness, NOT inside the controller)
// ---------------------------------------------------------------------------

const selectedIds = new Set<string>()
let rolloverIds: string[] = []
let lastAction = '等待交互...'
let lastOrder = '-'

// ---------------------------------------------------------------------------
// Status panel DOM refs
// ---------------------------------------------------------------------------

const stState      = document.getElementById('st-state')!
const stDragbox    = document.getElementById('st-dragbox')!
const stSelection  = document.getElementById('st-selection')!
const stRollover   = document.getElementById('st-rollover')!
const stLastAction = document.getElementById('st-last-action')!
const stLastOrder  = document.getElementById('st-last-order')!

function formatIds(ids: Set<string> | string[]): string {
  const arr = Array.isArray(ids) ? ids : [...ids]
  return arr.length === 0 ? '(无)' : arr.join(', ')
}

function updateStatusPanel(): void {
  stState.textContent = controller.state.toUpperCase()
  stDragbox.textContent = controller.isValidDragbox ? '是 (拖拽中)' : '-'
  stSelection.textContent = formatIds(selectedIds)
  stRollover.textContent = formatIds(rolloverIds)
  stLastAction.textContent = lastAction
  stLastOrder.textContent = lastOrder
}

// ---------------------------------------------------------------------------
// Drag box visual overlay
// ---------------------------------------------------------------------------

const dragBoxEl = document.getElementById('drag-box')!

function updateDragBox(): void {
  if (controller.state === 'dragging' && controller.isValidDragbox) {
    const start = controller.dragStart
    const end   = controller.mousePos
    const minX  = Math.min(start.x, end.x)
    const minY  = Math.min(start.y, end.y)
    const maxX  = Math.max(start.x, end.x)
    const maxY  = Math.max(start.y, end.y)

    dragBoxEl.style.display = 'block'
    dragBoxEl.style.left   = `${minX}px`
    dragBoxEl.style.top    = `${minY}px`
    dragBoxEl.style.width  = `${maxX - minX}px`
    dragBoxEl.style.height = `${maxY - minY}px`
  } else {
    dragBoxEl.style.display = 'none'
  }
}

// ---------------------------------------------------------------------------
// WorldInteractionCallbacks — mock implementation
// ---------------------------------------------------------------------------

const callbacks: WorldInteractionCallbacks = {
  getSelectableEntities(): SelectableEntity[] {
    return selectableEntities
  },

  getEligiblePlayers(): string[] {
    return eligiblePlayers
  },

  getModifierKeys(): ModifierState {
    return { ...modifierState }
  },

  isClassicMouseStyle(): boolean {
    return false
  },

  getActionButton(): number {
    return 0 // left button = action
  },

  inputOverridesSelection(_worldPos: WorldPosition): boolean {
    return false
  },

  applyOrder(order: Order): void {
    const targetDesc = order.targetActorId
      ? `实体 ${order.targetActorId}`
      : `地面 (${order.targetPosition?.x.toFixed(1)}, ${order.targetPosition?.z.toFixed(1)})`
    lastOrder = `${order.orderString} → ${targetDesc}${order.queued ? ' [排队]' : ''}`
    lastAction = `右键命令: ${order.orderString}`
  },

  getCursor(_screenPos: ScreenPoint): string | null {
    // Return null = default cursor; the controller handles actual cursor logic
    return null
  },

  clearSelectionOnLeftClick(): boolean {
    return true
  },

  getSelectionDeadzone(): number {
    return 5
  },

  setRollover(entities: SelectableEntity[]): void {
    rolloverIds = entities.map((e) => e.id)
  },

  combineSelection(entities: SelectableEntity[], add: boolean, isSingleClick: boolean): void {
    const ids = entities.map((e) => e.id)

    if (!add) {
      // add=false can mean "replace" (normal click) or "toggle remove" (Ctrl+click)
      if (modifierState.ctrl && isSingleClick) {
        // Ctrl+click toggle-off: remove from selection
        for (const id of ids) selectedIds.delete(id)
      } else {
        // Normal click or drag: replace selection
        selectedIds.clear()
        for (const id of ids) selectedIds.add(id)
      }
    } else {
      // add=true: add to selection
      for (const id of ids) selectedIds.add(id)
    }

    const mode = isSingleClick ? '单击' : (entities.length > 1 ? '框选/双击' : '单击')
    const modDesc = modifierState.ctrl ? '+Ctrl切换' : modifierState.shift ? '+Shift添加' : ''
    lastAction = `${mode}${modDesc}: ${ids.join(', ') || '(清除选择)'}`
  },

  clearSelection(): void {
    selectedIds.clear()
    lastAction = '清除选择 (点击空地)'
  },

  getSelectedActorIds(): ReadonlySet<string> {
    return selectedIds
  },

  cancelInputMode(): void {
    // No-op in test harness
  },
}

// ---------------------------------------------------------------------------
// IGameWorld — minimal mock
// ---------------------------------------------------------------------------

const mockWorld: IGameWorld = {
  disposing: false,
}

// ---------------------------------------------------------------------------
// Create the controller
// ---------------------------------------------------------------------------

const controller = new WorldInteractionControllerWidget(
  mockWorld,
  scene,
  camera,
  groundMesh,
  callbacks,
)

// Append the render element (transparent overlay for UI tree, pointer-events:none)
const renderEl = controller.render()
renderEl.style.zIndex = '1'
document.body.appendChild(renderEl)

// ---------------------------------------------------------------------------
// Info bar
// ---------------------------------------------------------------------------

const infoUa       = document.getElementById('info-ua')!
const infoViewport = document.getElementById('info-viewport')!
const infoEngine   = document.getElementById('info-engine')!
const infoFps      = document.getElementById('info-fps')!
const infoTime     = document.getElementById('info-time')!

function updateInfoBar(): void {
  infoUa.textContent       = navigator.userAgent.split(' ').pop() ?? '-'
  infoViewport.textContent = `${window.innerWidth}x${window.innerHeight}`
  infoEngine.textContent   = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  infoFps.textContent      = String(Math.round(engine.getFps()))
  infoTime.textContent     = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

document.getElementById('btn-reset-cam')!.addEventListener('click', () => {
  camera.alpha  = -Math.PI / 4
  camera.beta   = Math.PI / 3.3
  camera.radius = 14
  camera.target = new Vector3(4.5, 0.3, 4.5)
})

// ---------------------------------------------------------------------------
// Render Loop
// ---------------------------------------------------------------------------

engine.runRenderLoop(() => {
  scene.render()
  updateDragBox()
  updateStatusPanel()
  updateInfoBar()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// ---------------------------------------------------------------------------
// Test harness export (for dev console access)
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  controller,
  scene,
  camera,
  engine,
  entityInstances,
  getSelectedIds: () => [...selectedIds],
  getRolloverIds: () => rolloverIds,
  getLastAction: () => lastAction,
  getLastOrder: () => lastOrder,
  resetState: () => {
    selectedIds.clear()
    rolloverIds = []
    lastAction = '等待交互...'
    lastOrder = '-'
  },
  getEntityMeshes: () => entityInstances.map((e) => e.mesh),
  getGroundMesh: () => groundMesh,
}

// Suppress "module is not used" in HMR context
if (import.meta.hot) {
  import.meta.hot.accept(() => {})
}
