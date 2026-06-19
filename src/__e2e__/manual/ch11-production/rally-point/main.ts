/**
 * rally-point/main.ts -- Rally Point flag + dashed-line visual acceptance test
 *
 * OpenRA对照: OpenRA.Mods.Common/Traits/Buildings/RallyPoint.cs
 *
 * Verifies visual rendering of rally points:
 *   R1. Flag at target cell center (position accuracy ±0.1 world units)
 *   R2. Dashed line connecting building exit to rally flag
 *   R3. Flag animation ≥ 15 distinct positions per second
 *   R4. Multi-rally: per-slot numbered flags with distinct colors
 *   R5. Line updates within 1 frame of rally point change
 *
 * 坐标系约定 (matching CPos cell coordinates):
 *   - CPos(X, Y) → Babylon Vector3(X, flagY, Y)
 *   - 1 cell = 1 world unit (wu) in the 3D scene
 *   - Building center is at the cell's (X, 0, Y) position
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
  DynamicTexture,
  ActionManager,
  ExecuteCodeAction,
  PointerEventTypes,
  type PickingInfo,
} from '@babylonjs/core'

import { CPos } from '../../../../OpenRA.Game/CPos.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Grid dimensions in cells. */
const GRID_MIN_X = 0
const GRID_MAX_X = 9
const GRID_MIN_Y = 0
const GRID_MAX_Y = 9

/** Height offsets for scene elements. */
const GROUND_Y = 0
const BUILDING_HEIGHT = 0.5
const LINE_Y = 0.06
const FLAG_BASE_Y = 0.35
const LABEL_Y = 0.55

/** Dashed line geometry. */
const DASH_LENGTH = 0.35 // Length of each dash segment in wu
const GAP_LENGTH = 0.20  // Length of each gap in wu

/** Flag dimensions. */
const FLAG_WIDTH = 0.18
const FLAG_HEIGHT = 0.24
const POLE_HEIGHT = 0.20
const POLE_RADIUS = 0.015

/** Animation speed base (oscillation frequency factor). */
const ANIM_BASE_SPEED = 6.0 // radians per second at speed factor 1.0

/** Slot colors for visual distinction. */
const SLOT_COLORS: readonly Color3[] = [
  new Color3(1.0, 0.15, 0.15), // Slot 1: Red
  new Color3(1.0, 0.55, 0.0),  // Slot 2: Orange
  new Color3(0.15, 1.0, 0.2),  // Slot 3: Green
]

/** Building definitions. */
interface BuildingDef {
  id: string
  name: string
  cell: CPos      // Building center cell
  color: Color3
}

const BUILDING_DEFS: readonly BuildingDef[] = [
  { id: 'barracks',   name: 'Barracks',     cell: new CPos(2, 3), color: new Color3(0.25, 0.40, 0.90) },
  { id: 'warfactory', name: 'War Factory',  cell: new CPos(6, 3), color: new Color3(0.15, 0.75, 0.30) },
  { id: 'navalyard',  name: 'Naval Yard',   cell: new CPos(3, 7), color: new Color3(0.90, 0.50, 0.15) },
]

// ---------------------------------------------------------------------------
// Babylon.js Scene Setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true })
const scene = new Scene(engine)
scene.clearColor = new Color4(0.08, 0.10, 0.14, 1)

// Arc rotate camera — default top-down-ish view
const camera = new ArcRotateCamera(
  'cam',
  -Math.PI / 2,   // alpha: rotate around Y axis
  Math.PI / 4,     // beta: ~45 deg from horizontal
  18,
  new Vector3(4.5, 0, 4.5),
  scene,
)
camera.lowerRadiusLimit = 5
camera.upperRadiusLimit = 40
camera.attachControl(canvas, true)

// Lighting
const light = new HemisphericLight('hemi', new Vector3(0.4, 1.0, 0.3), scene)
light.intensity = 0.9

// ---------------------------------------------------------------------------
// Shared Materials (pre-allocated, no per-frame creation)
// ---------------------------------------------------------------------------

/** Ground material — dark grid surface. */
const groundMat = new StandardMaterial('groundMat', scene)
groundMat.diffuseColor = new Color3(0.12, 0.15, 0.20)
groundMat.specularColor = new Color3(0, 0, 0)

/** Picking plane material — invisible, only for raycasting. */
const pickMat = new StandardMaterial('pickMat', scene)
pickMat.alpha = 0
pickMat.diffuseColor = new Color3(0, 0, 0)
pickMat.specularColor = new Color3(0, 0, 0)

/** Building materials — one per building. */
const buildingMaterials: Map<string, StandardMaterial> = new Map()

/** Shared dashed line material. */
const dashLineMat = new StandardMaterial('dashLineMat', scene)
dashLineMat.diffuseColor = new Color3(0.3, 0.7, 1.0)
dashLineMat.emissiveColor = new Color3(0.15, 0.35, 0.5)
dashLineMat.specularColor = new Color3(0, 0, 0)
dashLineMat.alpha = 0.85

/** Pole material (shared across all flags). */
const poleMat = new StandardMaterial('poleMat', scene)
poleMat.diffuseColor = new Color3(0.7, 0.7, 0.75)
poleMat.specularColor = new Color3(0, 0, 0)

/** Flag face materials — one per slot, pre-created. */
const flagMaterials: StandardMaterial[] = SLOT_COLORS.map((c, i) => {
  const mat = new StandardMaterial(`flagMat${i + 1}`, scene)
  mat.diffuseColor = c
  mat.emissiveColor = new Color3(c.r * 0.3, c.g * 0.3, c.b * 0.2)
  mat.specularColor = new Color3(0, 0, 0)
  return mat
})

/** Number label textures — pre-created DynamicTextures for slots 1, 2, 3. */
const labelTextures: DynamicTexture[] = []
const labelMaterials: StandardMaterial[] = []
for (let slot = 1; slot <= 3; slot++) {
  const tex = new DynamicTexture(`labelTex${slot}`, { width: 128, height: 128 }, scene, false)
  const ctx = tex.getContext() as CanvasRenderingContext2D
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 80px "Segoe UI", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(slot.toString(), 64, 64)
  tex.update()
  labelTextures.push(tex)

  const mat = new StandardMaterial(`labelMat${slot}`, scene)
  mat.diffuseTexture = tex
  mat.diffuseColor = new Color3(1, 1, 1)
  mat.emissiveColor = new Color3(0.3, 0.3, 0.3)
  mat.specularColor = new Color3(0, 0, 0)
  mat.useAlphaFromDiffuseTexture = true
  mat.backFaceCulling = false
  labelMaterials.push(mat)
}

// ---------------------------------------------------------------------------
// Grid & Ground
// ---------------------------------------------------------------------------

const GRID_SIZE_X = GRID_MAX_X - GRID_MIN_X + 1
const GRID_SIZE_Y = GRID_MAX_Y - GRID_MIN_Y + 1

/** Ground plane — also used for picking. */
const groundPlane = MeshBuilder.CreateGround(
  'ground',
  { width: GRID_SIZE_X, height: GRID_SIZE_Y },
  scene,
)
groundPlane.position.x = (GRID_MIN_X + GRID_MAX_X) / 2
groundPlane.position.z = (GRID_MIN_Y + GRID_MAX_Y) / 2
groundPlane.position.y = GROUND_Y
groundPlane.material = groundMat

/** Invisible picking plane — slightly above ground to receive clicks first. */
const pickPlane = MeshBuilder.CreateGround(
  'pickPlane',
  { width: GRID_SIZE_X, height: GRID_SIZE_Y },
  scene,
)
pickPlane.position.x = (GRID_MIN_X + GRID_MAX_X) / 2
pickPlane.position.z = (GRID_MIN_Y + GRID_MAX_Y) / 2
pickPlane.position.y = GROUND_Y + 0.01
pickPlane.material = pickMat
pickPlane.isPickable = true

/** Grid lines — thin lines at cell boundaries. */
function createGridLines(): void {
  for (let x = GRID_MIN_X; x <= GRID_MAX_X + 1; x++) {
    const line = MeshBuilder.CreateLines('gridZ', {
      points: [
        new Vector3(x, 0.005, GRID_MIN_Y),
        new Vector3(x, 0.005, GRID_MAX_Y + 1),
      ],
    }, scene)
    line.color = new Color3(0.18, 0.22, 0.35)
    line.alpha = x % 5 === 0 ? 0.4 : 0.12
  }
  for (let y = GRID_MIN_Y; y <= GRID_MAX_Y + 1; y++) {
    const line = MeshBuilder.CreateLines('gridX', {
      points: [
        new Vector3(GRID_MIN_X, 0.005, y),
        new Vector3(GRID_MAX_X + 1, 0.005, y),
      ],
    }, scene)
    line.color = new Color3(0.18, 0.22, 0.35)
    line.alpha = y % 5 === 0 ? 0.4 : 0.12
  }
}
createGridLines()

// Cell highlight disc — shown when hovering over a cell
const highlightDisc = MeshBuilder.CreateDisc('highlight', { radius: 0.35, tessellation: 16 }, scene)
highlightDisc.rotation.x = Math.PI / 2
highlightDisc.position.y = 0.008
const highlightMat = new StandardMaterial('highlightMat', scene)
highlightMat.diffuseColor = new Color3(0.3, 0.7, 1.0)
highlightMat.emissiveColor = new Color3(0.2, 0.5, 0.7)
highlightMat.specularColor = new Color3(0, 0, 0)
highlightMat.alpha = 0.5
highlightDisc.material = highlightMat
highlightDisc.setEnabled(false)

// ---------------------------------------------------------------------------
// Building Meshes
// ---------------------------------------------------------------------------

interface BuildingVisual {
  def: BuildingDef
  mesh: Mesh
}

const buildingVisuals: BuildingVisual[] = []

for (const def of BUILDING_DEFS) {
  const mat = new StandardMaterial(`bldgMat_${def.id}`, scene)
  mat.diffuseColor = def.color
  mat.emissiveColor = new Color3(def.color.r * 0.25, def.color.g * 0.25, def.color.b * 0.15)
  mat.specularColor = new Color3(0.05, 0.05, 0.05)
  buildingMaterials.set(def.id, mat)

  const mesh = MeshBuilder.CreateBox(
    `bldg_${def.id}`,
    { width: 0.7, height: BUILDING_HEIGHT, depth: 0.7 },
    scene,
  )
  mesh.position.x = def.cell.X + 0.5
  mesh.position.y = BUILDING_HEIGHT / 2
  mesh.position.z = def.cell.Y + 0.5
  mesh.material = mat
  mesh.isPickable = true
  // Tag the mesh with building ID for UI selection
  ;(mesh as any)._bldgId = def.id

  // Small indicator arrow on top
  const arrow = MeshBuilder.CreateCylinder(
    `arrow_${def.id}`,
    { height: 0.12, diameterTop: 0, diameterBottom: 0.22, tessellation: 6 },
    scene,
  )
  arrow.position.y = BUILDING_HEIGHT / 2 + 0.06
  arrow.parent = mesh
  const arrowMat = new StandardMaterial(`arrowMat_${def.id}`, scene)
  arrowMat.diffuseColor = def.color
  arrowMat.emissiveColor = new Color3(def.color.r * 0.5, def.color.g * 0.5, def.color.b * 0.3)
  arrowMat.specularColor = new Color3(0, 0, 0)
  arrow.material = arrowMat

  // Column marker at each corner of the building cell
  const corners = [
    new Vector3(def.cell.X + 0.15, 0.005, def.cell.Y + 0.15),
    new Vector3(def.cell.X + 0.85, 0.005, def.cell.Y + 0.15),
    new Vector3(def.cell.X + 0.85, 0.005, def.cell.Y + 0.85),
    new Vector3(def.cell.X + 0.15, 0.005, def.cell.Y + 0.85),
    new Vector3(def.cell.X + 0.15, 0.005, def.cell.Y + 0.15),
  ]
  const cornerLine = MeshBuilder.CreateLines(`corner_${def.id}`, { points: corners }, scene)
  cornerLine.color = def.color
  cornerLine.alpha = 0.3

  buildingVisuals.push({ def, mesh })
}

// ---------------------------------------------------------------------------
// Rally Point State
// ---------------------------------------------------------------------------

/**
 * Data for one rally point (one slot of one building).
 */
interface RallyEntry {
  buildingId: string
  slot: number           // 1-based slot number
  targetCell: CPos       // Target cell for the rally point
  /** Set of meshes composing the dashed line from exit to flag. */
  dashMeshes: LinesMesh[]
  /** Flag face mesh (the triangular/rectangular flag). */
  flagMesh: Mesh
  /** Pole mesh (thin cylinder). */
  poleMesh: Mesh
  /** Number label plane. */
  labelMesh: Mesh
  /** Frame counter when last updated (for R5 verification). */
  lastUpdateFrame: number
}

/** All active rally entries, keyed by `${buildingId}:${slot}`. */
const rallyEntries: Map<string, RallyEntry> = new Map()

/** Frame counter, incremented each render loop iteration. */
let frameNumber = 0

/** Animation speed factor (adjustable via slider). */
let animSpeedFactor = 1.5

/** Currently selected building ID. */
let selectedBuilding = 'barracks'

/** Currently selected slot (1-3). */
let selectedSlot = 1

/** Total number of lines update requests this frame (for R5 verification). */
let lineUpdatesThisFrame = 0

// ---------------------------------------------------------------------------
// Coordinate Helpers
// ---------------------------------------------------------------------------

/** Convert CPos cell to Babylon Vector3. Cell center = (X + 0.5, height, Y + 0.5). */
function cellToVector3(cell: CPos, y: number): Vector3 {
  return new Vector3(cell.X + 0.5, y, cell.Y + 0.5)
}

/** Convert Babylon world position to nearest cell CPos. */
function worldToCell(pos: Vector3): CPos {
  const cx = Math.round(pos.x - 0.5)
  const cy = Math.round(pos.z - 0.5)
  return new CPos(
    Math.max(GRID_MIN_X, Math.min(GRID_MAX_X, cx)),
    Math.max(GRID_MIN_Y, Math.min(GRID_MAX_Y, cy)),
  )
}

/**
 * Get building exit point.
 * The exit is the edge of the building cell closest to the target cell.
 * If no target, defaults to building center + 1 cell toward grid center.
 */
function getBuildingExit(bldgCell: CPos, targetCell: CPos): Vector3 {
  const dx = targetCell.X - bldgCell.X
  const dy = targetCell.Y - bldgCell.Y

  // Determine which edge the line should exit from
  let exitX = bldgCell.X + 0.5
  let exitY = bldgCell.Y + 0.5

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Exit from left or right edge
    exitX = dx >= 0 ? bldgCell.X + 1.0 : bldgCell.X + 0.0
    // Clamp Y to building's Y range
    exitY = bldgCell.Y + 0.5 + Math.sign(dy) * 0.3 * Math.min(1, Math.abs(dy) / Math.max(1, Math.abs(dx)))
  } else {
    // Exit from top or bottom edge
    exitY = dy >= 0 ? bldgCell.Y + 1.0 : bldgCell.Y + 0.0
    exitX = bldgCell.X + 0.5 + Math.sign(dx) * 0.3 * Math.min(1, Math.abs(dx) / Math.max(1, Math.abs(dy)))
  }

  return new Vector3(exitX, LINE_Y, exitY)
}

// ---------------------------------------------------------------------------
// Dashed Line Construction
// ---------------------------------------------------------------------------

/**
 * Create dashed line meshes from `from` to `to`.
 * Returns an array of LinesMesh — one per dash segment.
 */
function createDashedLine(from: Vector3, to: Vector3, slot: number): LinesMesh[] {
  const meshes: LinesMesh[] = []
  const direction = to.subtract(from)
  const totalLen = direction.length()

  if (totalLen < 0.01) return meshes

  const dirNorm = direction.normalize()
  const stepLen = DASH_LENGTH + GAP_LENGTH
  let t = 0
  let dashIndex = 0

  while (t < totalLen) {
    const segStart = t
    const segEnd = Math.min(t + DASH_LENGTH, totalLen)
    if (segEnd - segStart > 0.005) {
      const p0 = from.add(dirNorm.scale(segStart))
      const p1 = from.add(dirNorm.scale(segEnd))
      const line = MeshBuilder.CreateLines(`dash_${dashIndex}`, { points: [p0, p1] }, scene)
      line.color = new Color3(0.3, 0.65, 1.0)
      line.alpha = 0.7 + (slot - 1) * 0.1
      meshes.push(line)
      dashIndex++
    }
    t += stepLen
  }

  return meshes
}

/** Dispose all dashes in an array. */
function disposeDashes(dashes: LinesMesh[]): void {
  for (const d of dashes) { d.dispose() }
}

// ---------------------------------------------------------------------------
// Flag Construction
// ---------------------------------------------------------------------------

/**
 * Create flag visual at the target cell.
 * Returns { flagMesh, poleMesh, labelMesh }.
 * Flag is a small isosceles triangle plane attached to a thin pole.
 */
function createFlagVisual(
  cell: CPos,
  slot: number,
): { flagMesh: Mesh; poleMesh: Mesh; labelMesh: Mesh } {
  const basePos = cellToVector3(cell, FLAG_BASE_Y)

  // Pole: thin cylinder from ground to flag height
  const pole = MeshBuilder.CreateCylinder(
    'pole',
    { height: POLE_HEIGHT, diameter: POLE_RADIUS * 2, tessellation: 6 },
    scene,
  )
  pole.position.x = basePos.x
  pole.position.y = FLAG_BASE_Y - POLE_HEIGHT / 2 - 0.05
  pole.position.z = basePos.z
  pole.material = poleMat

  // Create a plane as the flag face, positioned to the right of the pole
  const flagPlane = MeshBuilder.CreatePlane(
    `flag_s${slot}`,
    { width: FLAG_WIDTH, height: FLAG_HEIGHT },
    scene,
  )
  flagPlane.position.x = basePos.x + FLAG_WIDTH / 2
  flagPlane.position.y = FLAG_BASE_Y
  flagPlane.position.z = basePos.z
  flagPlane.material = flagMaterials[slot - 1]!
  // Rotate so it faces the default camera perspective (slightly south-east)
  flagPlane.rotation.y = Math.PI / 6

  // Number label: small plane with DynamicTexture, always facing up
  const label = MeshBuilder.CreatePlane(
    `label_s${slot}`,
    { width: 0.25, height: 0.25 },
    scene,
  )
  label.position.x = basePos.x
  label.position.y = LABEL_Y
  label.position.z = basePos.z
  label.rotation.x = -Math.PI / 2 // Face up toward camera (horizontal)
  label.material = labelMaterials[slot - 1]!
  label.billboardMode = 2 // Billboard mode: use Y as up

  return { flagMesh: flagPlane, poleMesh: pole, labelMesh: label }
}

/** Dispose flag, pole, and label meshes. */
function disposeFlagVisual(entry: RallyEntry): void {
  entry.flagMesh.dispose()
  entry.poleMesh.dispose()
  entry.labelMesh.dispose()
}

// ---------------------------------------------------------------------------
// Rally Point Operations
// ---------------------------------------------------------------------------

/** Build the composite key for rally entries. */
function rallyKey(buildingId: string, slot: number): string {
  return `${buildingId}:${slot}`
}

/**
 * Set (or move) a rally point.
 * If one already exists for this building+slot, it is replaced.
 */
function setRallyPoint(buildingId: string, slot: number, targetCell: CPos): void {
  const key = rallyKey(buildingId, slot)

  // Remove existing entry for this building+slot
  if (rallyEntries.has(key)) {
    removeRallyEntry(key)
  }

  const bldgDef = BUILDING_DEFS.find(d => d.id === buildingId)
  if (!bldgDef) return

  const exit = getBuildingExit(bldgDef.cell, targetCell)
  const target = cellToVector3(targetCell, FLAG_BASE_Y)
  const dashes = createDashedLine(exit, target, slot)
  const { flagMesh, poleMesh, labelMesh } = createFlagVisual(targetCell, slot)

  const entry: RallyEntry = {
    buildingId,
    slot,
    targetCell,
    dashMeshes: dashes,
    flagMesh,
    poleMesh,
    labelMesh,
    lastUpdateFrame: frameNumber,
  }

  rallyEntries.set(key, entry)
  lineUpdatesThisFrame++

  updateDiagnostics()
}

/**
 * Clear rally points for a specific building (all slots).
 */
function clearRallyPoint(buildingId: string): void {
  const toRemove: string[] = []
  for (const [key, entry] of rallyEntries) {
    if (entry.buildingId === buildingId) {
      toRemove.push(key)
    }
  }
  for (const key of toRemove) {
    removeRallyEntry(key)
  }
  updateDiagnostics()
}

/**
 * Clear all rally points.
 */
function clearAllRallyPoints(): void {
  for (const key of rallyEntries.keys()) {
    removeRallyEntry(key)
  }
  rallyEntries.clear()
  updateDiagnostics()
}

/** Remove and dispose a single rally entry. */
function removeRallyEntry(key: string): void {
  const entry = rallyEntries.get(key)
  if (!entry) return
  disposeDashes(entry.dashMeshes)
  disposeFlagVisual(entry)
  rallyEntries.delete(key)
}

/**
 * Reset entire scene to initial state.
 */
function resetScene(): void {
  clearAllRallyPoints()
  selectedBuilding = 'barracks'
  selectedSlot = 1
  frameNumber = 0
  lineUpdatesThisFrame = 0
  syncUIState()
  updateDiagnostics()
}

// ---------------------------------------------------------------------------
// Picking / Click Handling
// ---------------------------------------------------------------------------

/**
 * Handle ground click: if within grid bounds, place rally point at the cell.
 */
function onGroundPick(pickInfo: PickingInfo): void {
  if (!pickInfo.hit || !pickInfo.pickedPoint) return

  const worldPos = pickInfo.pickedPoint
  const cell = worldToCell(worldPos)

  // Clamp to grid
  if (cell.X < GRID_MIN_X || cell.X > GRID_MAX_X || cell.Y < GRID_MIN_Y || cell.Y > GRID_MAX_Y) return

  // Don't place on building cells
  const onBuilding = BUILDING_DEFS.some(d => d.cell.X === cell.X && d.cell.Y === cell.Y)
  if (onBuilding) return

  setRallyPoint(selectedBuilding, selectedSlot, cell)
}

// Register click action on the picking plane
pickPlane.actionManager = new ActionManager(scene)
pickPlane.actionManager.registerAction(
  new ExecuteCodeAction(ActionManager.OnPickDownTrigger, (evt) => {
    onGroundPick(scene.pick(evt.pointerX, evt.pointerY)!)
  }),
)

// Also handle clicks on the ground for fallback
groundPlane.actionManager = new ActionManager(scene)
groundPlane.actionManager.registerAction(
  new ExecuteCodeAction(ActionManager.OnPickDownTrigger, (evt) => {
    // Only process if we didn't already handle via pickPlane
    const pick = scene.pick(evt.pointerX, evt.pointerY)
    if (pick?.hit && pick.pickedMesh === groundPlane) {
      onGroundPick(pick)
    }
  }),
)

// Hover highlight — use onPointerObservable for correct typing
scene.onPointerObservable.add((pointerInfo) => {
  const pickInfo = pointerInfo.pickInfo
  if (pickInfo?.hit && pickInfo.pickedPoint) {
    const cell = worldToCell(pickInfo.pickedPoint)
    if (cell.X >= GRID_MIN_X && cell.X <= GRID_MAX_X && cell.Y >= GRID_MIN_Y && cell.Y <= GRID_MAX_Y) {
      highlightDisc.position.x = cell.X + 0.5
      highlightDisc.position.z = cell.Y + 0.5
      highlightDisc.setEnabled(true)
      return
    }
  }
  highlightDisc.setEnabled(false)
}, PointerEventTypes.POINTERMOVE)

// ---------------------------------------------------------------------------
// Animation (Render Loop)
// ---------------------------------------------------------------------------

let lastTime = performance.now()
let animTime = 0

engine.runRenderLoop(() => {
  const now = performance.now()
  const deltaMs = now - lastTime
  lastTime = now
  const deltaSec = Math.min(deltaMs / 1000, 0.1) // Cap delta to avoid spiral

  animTime += deltaSec * animSpeedFactor
  frameNumber++

  // Animate all flags: bobbing + waving
  for (const entry of rallyEntries.values()) {
    const bobOffset = Math.sin(animTime * ANIM_BASE_SPEED + entry.slot * 2.1) * 0.04
    const waveRotation = Math.sin(animTime * ANIM_BASE_SPEED * 0.7 + entry.slot * 1.5) * 0.15

    // Bob flag mesh
    entry.flagMesh.position.y = FLAG_BASE_Y + bobOffset
    // Wave rotation around Z (flapping)
    entry.flagMesh.rotation.z = waveRotation

    // Bob label too (parent would be simpler but we're keeping them separate for clarity)
    entry.labelMesh.position.y = LABEL_Y + bobOffset

    // Bob pole (scale Y slightly or just reposition top? — just skip pole animation, too subtle)
  }

  scene.render()
  updateInfoBar()
})

// ---------------------------------------------------------------------------
// UI Sync & Diagnostics
// ---------------------------------------------------------------------------

function syncUIState(): void {
  // Update building selectors
  const selTop = document.getElementById('building-select') as HTMLSelectElement
  const selBottom = document.getElementById('building-select-bottom') as HTMLSelectElement
  selTop.value = selectedBuilding
  selBottom.value = selectedBuilding

  // Update slot buttons
  for (let s = 1; s <= 3; s++) {
    const btn = document.getElementById(`slot-${s}`)
    const btnB = document.getElementById(`slot-${s}-b`)
    if (btn) {
      btn.classList.toggle('active-slot', s === selectedSlot)
    }
    if (btnB) {
      btnB.classList.toggle('active-slot', s === selectedSlot)
    }
  }
}

function updateDiagnostics(): void {
  const bldgDef = BUILDING_DEFS.find(d => d.id === selectedBuilding)
  document.getElementById('diag-bldg')!.textContent = bldgDef?.name ?? '-'
  document.getElementById('diag-slot')!.textContent = String(selectedSlot)
  document.getElementById('diag-flagcount')!.textContent = String(rallyEntries.size)

  // Show info for the currently selected building+slot if a rally point exists
  const key = rallyKey(selectedBuilding, selectedSlot)
  const entry = rallyEntries.get(key)
  if (entry) {
    document.getElementById('diag-cell')!.textContent = entry.targetCell.toString()
    const pos = cellToVector3(entry.targetCell, FLAG_BASE_Y)
    document.getElementById('diag-position')!.textContent =
      `(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`
    document.getElementById('diag-dashes')!.textContent = String(entry.dashMeshes.length)
    document.getElementById('diag-lastupdate')!.textContent = `Frame ${entry.lastUpdateFrame}`
  } else {
    document.getElementById('diag-cell')!.textContent = '(none)'
    document.getElementById('diag-position')!.textContent = '-'
    document.getElementById('diag-dashes')!.textContent = '-'
    document.getElementById('diag-lastupdate')!.textContent = '-'
  }

  document.getElementById('diag-frame')!.textContent = String(frameNumber)
}

// ---------------------------------------------------------------------------
// Info Bar
// ---------------------------------------------------------------------------

let lastInfoTimeUpdate = 0
let cachedInfoTime = ''

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent =
    `${window.innerWidth}x${window.innerHeight} (canvas: ${canvas.width}x${canvas.height})`
  document.getElementById('info-engine')!.textContent =
    engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))

  const now = Date.now()
  if (now - lastInfoTimeUpdate > 1000) {
    cachedInfoTime = new Date().toISOString()
    lastInfoTimeUpdate = now
  }
  document.getElementById('info-time')!.textContent = cachedInfoTime
}

// ---------------------------------------------------------------------------
// Resize Handler
// ---------------------------------------------------------------------------

const resizeHandler = () => { engine.resize() }
window.addEventListener('resize', resizeHandler)

// ---------------------------------------------------------------------------
// Button Handlers
// ---------------------------------------------------------------------------

// Building selectors (top sidebar + bottom bar)
document.getElementById('building-select')!.addEventListener('change', (e) => {
  selectedBuilding = (e.target as HTMLSelectElement).value
  syncUIState()
  updateDiagnostics()
})
document.getElementById('building-select-bottom')!.addEventListener('change', (e) => {
  selectedBuilding = (e.target as HTMLSelectElement).value
  syncUIState()
  updateDiagnostics()
})

// Slot buttons (top sidebar)
for (let s = 1; s <= 3; s++) {
  document.getElementById(`slot-${s}`)!.addEventListener('click', () => {
    selectedSlot = s
    syncUIState()
    updateDiagnostics()
  })
}

// Slot buttons (bottom bar)
for (let s = 1; s <= 3; s++) {
  document.getElementById(`slot-${s}-b`)!.addEventListener('click', () => {
    selectedSlot = s
    syncUIState()
    updateDiagnostics()
  })
}

// Clear current building
document.getElementById('btn-clear-building')!.addEventListener('click', () => {
  clearRallyPoint(selectedBuilding)
})

// Clear all
document.getElementById('btn-clear-all')!.addEventListener('click', () => {
  clearAllRallyPoints()
})

// Reset
document.getElementById('btn-reset')!.addEventListener('click', () => {
  resetScene()
})

// Animation speed slider
const animSpeedSlider = document.getElementById('anim-speed') as HTMLInputElement
const animSpeedVal = document.getElementById('anim-speed-val')!
animSpeedSlider.addEventListener('input', () => {
  animSpeedFactor = parseFloat(animSpeedSlider.value)
  animSpeedVal.textContent = animSpeedFactor.toFixed(1)
})

// ---------------------------------------------------------------------------
// Test Harness — exposed on window for Playwright verification
// ---------------------------------------------------------------------------

;(window as any).__testHarness = {
  scene,
  engine,

  /**
   * Set (or move) a rally point for a building to a target cell.
   * @param building — building ID string ('barracks', 'warfactory', 'navalyard')
   * @param cell — { x: number, y: number } in cell coordinates (0-9)
   */
  setRallyPoint(building: string, slot: number, cell: { x: number; y: number }): void {
    setRallyPoint(building, slot, new CPos(cell.x, cell.y))
  },

  /**
   * Get all rally point target positions.
   * @returns Array of { buildingId, slot, cellX, cellY } for each active rally point
   */
  getRallyPositions(): { buildingId: string; slot: number; cellX: number; cellY: number }[] {
    const result: { buildingId: string; slot: number; cellX: number; cellY: number }[] = []
    for (const entry of rallyEntries.values()) {
      result.push({
        buildingId: entry.buildingId,
        slot: entry.slot,
        cellX: entry.targetCell.X,
        cellY: entry.targetCell.Y,
      })
    }
    return result
  },

  /**
   * Get all active rally lines (dashed line data).
   * @returns Array of { buildingId, slot, from, to, dashCount }
   */
  getRallyLines(): { buildingId: string; slot: number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; dashCount: number }[] {
    const result: { buildingId: string; slot: number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; dashCount: number }[] = []
    for (const entry of rallyEntries.values()) {
      const bldgDef = BUILDING_DEFS.find(d => d.id === entry.buildingId)
      if (!bldgDef) continue
      const exit = getBuildingExit(bldgDef.cell, entry.targetCell)
      const target = cellToVector3(entry.targetCell, FLAG_BASE_Y)
      result.push({
        buildingId: entry.buildingId,
        slot: entry.slot,
        from: { x: exit.x, y: exit.y, z: exit.z },
        to: { x: target.x, y: target.y, z: target.z },
        dashCount: entry.dashMeshes.length,
      })
    }
    return result
  },

  /**
   * Get all rally flags currently visible.
   * @returns Array of { buildingId, slot, position, lastUpdateFrame }
   */
  getRallyFlags(): { buildingId: string; slot: number; position: { x: number; y: number; z: number }; lastUpdateFrame: number }[] {
    const result: { buildingId: string; slot: number; position: { x: number; y: number; z: number }; lastUpdateFrame: number }[] = []
    for (const entry of rallyEntries.values()) {
      const pos = cellToVector3(entry.targetCell, FLAG_BASE_Y)
      result.push({
        buildingId: entry.buildingId,
        slot: entry.slot,
        position: { x: pos.x, y: pos.y, z: pos.z },
        lastUpdateFrame: entry.lastUpdateFrame,
      })
    }
    return result
  },

  /**
   * Clear all rally points for a specific building.
   */
  clearRallyPoint(building: string): void {
    clearRallyPoint(building)
  },

  /**
   * Clear all rally points.
   */
  clearAll(): void {
    clearAllRallyPoints()
  },

  /**
   * Get the current frame number (for verifying ≤1 frame update latency).
   */
  getFrameNumber(): number {
    return frameNumber
  },

  /**
   * Get the current animation time (for verifying animation is running).
   */
  getAnimTime(): number {
    return animTime
  },

  /**
   * Get the number of rally entries (total flags).
   */
  getFlagCount(): number {
    return rallyEntries.size
  },

  /**
   * Get current FPS from the engine.
   */
  getFps(): number {
    return Math.round(engine.getFps())
  },

  /**
   * Select a building for subsequent setRallyPoint calls.
   */
  selectBuilding(building: string): void {
    selectedBuilding = building
    syncUIState()
    updateDiagnostics()
  },

  /**
   * Select a production slot for subsequent setRallyPoint calls.
   */
  selectSlot(slot: number): void {
    selectedSlot = slot
    syncUIState()
    updateDiagnostics()
  },

  /**
   * Reset the entire scene.
   */
  reset(): void {
    resetScene()
  },
}

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

syncUIState()

// Place default rally points for demo:
// Barracks slot 1 → cell (5, 1)
setRallyPoint('barracks', 1, new CPos(5, 1))
// Barracks slot 2 → cell (7, 1)
setRallyPoint('barracks', 2, new CPos(7, 1))
// War Factory slot 1 → cell (8, 5)
setRallyPoint('warfactory', 1, new CPos(8, 5))
// Naval Yard slot 1 → cell (1, 9)
setRallyPoint('navalyard', 1, new CPos(1, 9))

updateDiagnostics()
