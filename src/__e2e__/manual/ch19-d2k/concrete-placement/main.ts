/**
 * ch19-d2k/concrete-placement/main.ts — Concrete placement visual acceptance test
 *
 * Verifies:
 * 1. BuildableTerrainLayer concrete slab rendering (grey semi-transparent tiles)
 * 2. D2kActorPreviewPlaceBuildingPreview: green (valid), red (invalid), orange (unsafe/Rock)
 * 3. WithCrumbleOverlay: cracked overlay on low-HP buildings
 * 4. WithDeliveryOverlay: carryall delivery animation overlay
 * 5. DamagesConcreteWarhead: concrete damage and removal
 * 6. Building footprint protection against concrete damage
 *
 * OpenRA coordinate system:
 *   - WAngle 0 = North (negative Z), CCW
 *   - cells at integer coordinates mapped to world space
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
  Mesh,
  TransformNode,
} from '@babylonjs/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CELL_SIZE = 1.0 // 1 Babylon unit = 1 cell = 1024 WDist
const MAX_STRENGTH = 9000
const DAMAGE_PER_HIT = 3000
const GRID_HALF = 8 // 17x17 grid

// Colors
const CONCRETE_COLOR = new Color3(0.5, 0.5, 0.5) // #808080
const VALID_COLOR = new Color3(0, 1, 0) // #00FF00
const INVALID_COLOR = new Color3(1, 0, 0) // #FF0000
const UNSAFE_COLOR = new Color3(1, 0.53, 0) // #FF8800
const CRUMBLE_COLOR = new Color3(0.53, 0.53, 0.53) // #888888
const DELIVERY_COLOR = new Color3(0.4, 0.7, 1) // Delivery blue

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface CellState {
  x: number
  z: number
  hasConcrete: boolean
  strength: number
  isUnsafeTerrain: boolean // Rock terrain
  hasBuilding: boolean
  concreteMesh: Mesh | null
  strengthLabel: Mesh | null
}

const cells: Map<string, CellState> = new Map()
let previewMode = true
let unsafeTerrainEnabled = false
let crumbleActive = false
let deliveryActive = false
let buildingMesh: TransformNode | null = null
let previewMeshes: Mesh[] = []
let crumbleOverlay: Mesh | null = null
let deliveryOverlay: Mesh | null = null
let selectedCellX = 0
let selectedCellZ = 0
const BUILDING_FOOTPRINT: [number, number][] = [
  [0, 0], [1, 0], [2, 0],
  [0, 1], [1, 1], [2, 1],
  [0, 2], [1, 2], [2, 2],
]

// ---------------------------------------------------------------------------
// Babylon.js
// ---------------------------------------------------------------------------

let engine!: Engine
let scene!: Scene

function cellKey(x: number, z: number): string {
  return `${x},${z}`
}

function getCell(x: number, z: number): CellState {
  const key = cellKey(x, z)
  let cell = cells.get(key)
  if (!cell) {
    cell = {
      x, z,
      hasConcrete: false,
      strength: 0,
      isUnsafeTerrain: false,
      hasBuilding: false,
      concreteMesh: null,
      strengthLabel: null,
    }
    cells.set(key, cell)
  }
  return cell
}

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

function setupScene(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false })
  scene = new Scene(engine)
  scene.clearColor = new Color4(0.1, 0.1, 0.15, 1)

  // Camera
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 4, 18, new Vector3(0, 0, 0), scene)
  camera.attachControl(canvas, true)
  camera.lowerRadiusLimit = 5
  camera.upperRadiusLimit = 40

  // Lights
  new HemisphericLight('hemi', new Vector3(0.5, 1, -0.3), scene)

  // Ground
  const groundMat = new StandardMaterial('groundMat', scene)
  groundMat.diffuseColor = new Color3(0.15, 0.13, 0.18)
  groundMat.specularColor = new Color3(0, 0, 0)
  const ground = MeshBuilder.CreateGround('ground', {
    width: GRID_HALF * 2 + 2,
    height: GRID_HALF * 2 + 2,
    subdivisions: GRID_HALF * 2 + 2,
  }, scene)
  ground.position.y = -0.06
  ground.material = groundMat

  // Grid lines
  const gridMat = new StandardMaterial('gridMat', scene)
  gridMat.wireframe = true
  gridMat.diffuseColor = new Color3(0.2, 0.18, 0.25)
  const grid = MeshBuilder.CreateGround('grid', {
    width: GRID_HALF * 2 + 2,
    height: GRID_HALF * 2 + 2,
    subdivisions: GRID_HALF * 2 + 2,
  }, scene)
  grid.position.y = -0.05
  grid.material = gridMat

  // Cell highlight marker
  createCellMarkers()

  // Building model
  createBuildingModel()

  // Place initial concrete at building location
  placeConcreteAtBuilding()
  updatePreview()
}

// ---------------------------------------------------------------------------
// Cell markers (coordinate references)
// ---------------------------------------------------------------------------

function createCellMarkers(): void {
  // Create subtle markers at the center cell and corners
  const markerMat = new StandardMaterial('markerMat', scene)
  markerMat.emissiveColor = new Color3(0.2, 0.2, 0.3)

  for (let x = -GRID_HALF; x <= GRID_HALF; x += 2) {
    for (let z = -GRID_HALF; z <= GRID_HALF; z += 2) {
      const dot = MeshBuilder.CreateSphere(`dot_${x}_${z}`, { diameter: 0.08 }, scene)
      dot.position = new Vector3(x + 0.5, -0.03, z + 0.5)
      dot.material = markerMat
    }
  }
}

// ---------------------------------------------------------------------------
// Building model
// ---------------------------------------------------------------------------

function createBuildingModel(): void {
  if (buildingMesh) buildingMesh.dispose()

  buildingMesh = new TransformNode('buildingRoot', scene)

  // Main structure
  const bodyMat = new StandardMaterial('buildingBody', scene)
  bodyMat.diffuseColor = new Color3(0.4, 0.42, 0.45)
  bodyMat.specularColor = new Color3(0.1, 0.1, 0.1)

  const body = MeshBuilder.CreateBox('buildingBody', {
    width: CELL_SIZE * 3 - 0.2,
    height: 1.8,
    depth: CELL_SIZE * 3 - 0.2,
  }, scene)
  body.position.y = 0.9
  body.material = bodyMat
  body.parent = buildingMesh

  // Roof
  const roofMat = new StandardMaterial('roofMat', scene)
  roofMat.diffuseColor = new Color3(0.3, 0.3, 0.35)

  const roof = MeshBuilder.CreateCylinder('roof', {
    diameter: 1.5,
    height: 0.5,
    tessellation: 4,
  }, scene)
  roof.rotation.y = Math.PI / 4
  roof.position.y = 1.8
  roof.material = roofMat
  roof.parent = buildingMesh

  // Door
  const doorMat = new StandardMaterial('doorMat', scene)
  doorMat.diffuseColor = new Color3(0.2, 0.25, 0.3)
  const door = MeshBuilder.CreateBox('door', { width: 0.6, height: 1.0, depth: 0.1 }, scene)
  door.position = new Vector3(0, 0.5, -1.45)
  door.material = doorMat
  door.parent = buildingMesh

  buildingMesh.position = new Vector3(selectedCellX + 1.5, 0, selectedCellZ + 1.5)
}

// ---------------------------------------------------------------------------
// Concrete tile rendering
// ---------------------------------------------------------------------------

function createConcreteTile(cell: CellState): void {
  if (cell.concreteMesh) return

  const mat = new StandardMaterial(`concrete_${cell.x}_${cell.z}`, scene)
  mat.diffuseColor = CONCRETE_COLOR.clone()
  mat.specularColor = new Color3(0, 0, 0)
  mat.alpha = 0.6

  const tile = MeshBuilder.CreateBox(
    `concreteTile_${cell.x}_${cell.z}`,
    { width: CELL_SIZE - 0.08, height: 0.08, depth: CELL_SIZE - 0.08 },
    scene,
  )
  tile.position = new Vector3(cell.x + 0.5, 0.04, cell.z + 0.5)
  tile.material = mat
  cell.concreteMesh = tile

  // Strength label (small number plane)
  const labelMat = new StandardMaterial(`label_${cell.x}_${cell.z}`, scene)
  labelMat.diffuseColor = new Color3(1, 1, 1)
  labelMat.emissiveColor = new Color3(0.3, 0.3, 0.3)
  labelMat.alpha = 0.8

  const label = MeshBuilder.CreatePlane(
    `strengthLabel_${cell.x}_${cell.z}`,
    { width: 0.8, height: 0.3 },
    scene,
  )
  label.position = new Vector3(cell.x + 0.5, 0.1, cell.z + 0.5)
  label.rotation.x = -Math.PI / 2
  label.material = labelMat
  label.isVisible = false // HACK: can't easily render text, so use tooltip-like visibility
  cell.strengthLabel = label
}

function removeConcreteTile(cell: CellState): void {
  if (cell.concreteMesh) {
    cell.concreteMesh.dispose()
    cell.concreteMesh = null
  }
  if (cell.strengthLabel) {
    cell.strengthLabel.dispose()
    cell.strengthLabel = null
  }
}

function updateConcreteVisual(cell: CellState): void {
  if (cell.hasConcrete) {
    if (!cell.concreteMesh) createConcreteTile(cell)

    // Update color based on strength
    const strengthRatio = cell.strength / MAX_STRENGTH
    if (cell.concreteMesh) {
      const mat = cell.concreteMesh.material as StandardMaterial
      mat.alpha = 0.3 + 0.3 * strengthRatio
      mat.diffuseColor = new Color3(
        0.5 * strengthRatio + 0.2 * (1 - strengthRatio),
        0.5 * strengthRatio + 0.1 * (1 - strengthRatio),
        0.5 * strengthRatio + 0.05 * (1 - strengthRatio),
      )
    }
  } else {
    removeConcreteTile(cell)
  }
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

function clearPreviews(): void {
  for (const mesh of previewMeshes) {
    mesh.dispose()
  }
  previewMeshes = []
}

function updatePreview(): void {
  clearPreviews()
  if (!previewMode) return

  for (const [fx, fz] of BUILDING_FOOTPRINT) {
    const cellX = selectedCellX + fx
    const cellZ = selectedCellZ + fz
    const cell = getCell(cellX, cellZ)

    let color: Color3
    let alpha = 0.5

    if (!cell.hasConcrete) {
      color = INVALID_COLOR.clone()
    } else if (unsafeTerrainEnabled && cell.isUnsafeTerrain) {
      color = UNSAFE_COLOR.clone()
    } else {
      color = VALID_COLOR.clone()
    }

    const mat = new StandardMaterial(`preview_${cellX}_${cellZ}`, scene)
    mat.diffuseColor = color
    mat.emissiveColor = new Color3(color.r * 0.3, color.g * 0.3, color.b * 0.3)
    mat.alpha = alpha

    const previewTile = MeshBuilder.CreateBox(
      `previewTile_${cellX}_${cellZ}`,
      { width: CELL_SIZE - 0.04, height: 0.06, depth: CELL_SIZE - 0.04 },
      scene,
    )
    previewTile.position = new Vector3(cellX + 0.5, 0.12, cellZ + 0.5)
    previewTile.material = mat
    previewMeshes.push(previewTile)
  }
}

// ---------------------------------------------------------------------------
// Crumble overlay
// ---------------------------------------------------------------------------

function showCrumbleOverlay(): void {
  if (crumbleOverlay) {
    crumbleOverlay.dispose()
    crumbleOverlay = null
  }

  if (!buildingMesh) return

  crumbleActive = true

  // Create cracked overlay on top of the building
  const mat = new StandardMaterial('crumbleMat', scene)
  mat.diffuseColor = CRUMBLE_COLOR.clone()
  mat.emissiveColor = new Color3(0.2, 0.2, 0.2)
  mat.alpha = 0.7
  mat.wireframe = true // Simulate crack lines

  crumbleOverlay = MeshBuilder.CreateBox('crumble', {
    width: CELL_SIZE * 3 - 0.15,
    height: 1.85,
    depth: CELL_SIZE * 3 - 0.15,
  }, scene)
  crumbleOverlay.position = buildingMesh.position.clone()
  crumbleOverlay.position.y += 0.95
  crumbleOverlay.material = mat

  // Auto-remove after ~2 seconds (simulating playThen callback)
  setTimeout(() => {
    if (crumbleOverlay) {
      crumbleOverlay.dispose()
      crumbleOverlay = null
      crumbleActive = false
      updateBuildStats()
    }
  }, 2000)

  updateBuildStats()
}

// ---------------------------------------------------------------------------
// Delivery overlay
// ---------------------------------------------------------------------------

function toggleDeliveryOverlay(): void {
  if (deliveryOverlay) {
    deliveryOverlay.dispose()
    deliveryOverlay = null
    deliveryActive = false
  } else if (buildingMesh) {
    deliveryActive = true

    // Create a delivery indicator above the building
    const mat = new StandardMaterial('deliveryMat', scene)
    mat.diffuseColor = DELIVERY_COLOR.clone()
    mat.emissiveColor = new Color3(0.2, 0.4, 0.6)
    mat.alpha = 0.6

    deliveryOverlay = MeshBuilder.CreateTorus('deliveryRing', {
      diameter: 2.5,
      thickness: 0.15,
    }, scene)
    deliveryOverlay.position = buildingMesh.position.clone()
    deliveryOverlay.position.y += 2.5
    deliveryOverlay.rotation.x = Math.PI / 2
    deliveryOverlay.material = mat

    // Delivery unit descending
    const unitMat = new StandardMaterial('deliveryUnit', scene)
    unitMat.diffuseColor = new Color3(0.3, 0.5, 0.8)
    const unit = MeshBuilder.CreateBox('deliveryUnit', {
      width: 0.8,
      height: 0.6,
      depth: 1.2,
    }, scene)
    unit.position = buildingMesh.position.clone()
    unit.position.y += 3.5
    unit.material = unitMat
    unit.parent = deliveryOverlay
  }

  updateBuildStats()
}

// ---------------------------------------------------------------------------
// Concrete operations
// ---------------------------------------------------------------------------

function placeConcreteAtBuilding(): void {
  for (const [fx, fz] of BUILDING_FOOTPRINT) {
    const cellX = selectedCellX + fx
    const cellZ = selectedCellZ + fz
    const cell = getCell(cellX, cellZ)
    cell.hasConcrete = true
    cell.strength = MAX_STRENGTH
    cell.hasBuilding = true
    updateConcreteVisual(cell)
  }
  updatePreview()
}

function damageConcrete(): void {
  for (const [fx, fz] of BUILDING_FOOTPRINT) {
    const cellX = selectedCellX + fx
    const cellZ = selectedCellZ + fz
    const cell = getCell(cellX, cellZ)

    // Buildings block damage to cells under their footprint
    // Create a gap: damage cells at the edge of footprint
    if (fx === 0 || fx === 2 || fz === 0 || fz === 2) {
      if (cell.hasConcrete && cell.strength > 0) {
        cell.strength -= DAMAGE_PER_HIT
        if (cell.strength < 1) {
          cell.hasConcrete = false
          cell.strength = 0
        }
        updateConcreteVisual(cell)
      }
    }
    // Interior cells protected by building
  }
  updatePreview()
}

function removeAllConcrete(): void {
  for (const [fx, fz] of BUILDING_FOOTPRINT) {
    const cellX = selectedCellX + fx
    const cellZ = selectedCellZ + fz
    const cell = getCell(cellX, cellZ)
    cell.hasConcrete = false
    cell.strength = 0
    // hasBuilding persists: removing concrete does not remove the building
    updateConcreteVisual(cell)
  }
  updatePreview()
}

function toggleUnsafeTerrain(): void {
  unsafeTerrainEnabled = !unsafeTerrainEnabled

  if (unsafeTerrainEnabled) {
    // Mark all footprint cells as potentially unsafe (Rock terrain).
    // In the real game, any cell in the footprint can be on unsafe
    // terrain; the preview shows orange for cells on Rock-type terrain.
    for (const [fx, fz] of BUILDING_FOOTPRINT) {
      const cellX = selectedCellX + fx
      const cellZ = selectedCellZ + fz
      const cell = getCell(cellX, cellZ)
      cell.isUnsafeTerrain = true
    }
  } else {
    // Clear unsafe markers
    for (const [fx, fz] of BUILDING_FOOTPRINT) {
      const cellX = selectedCellX + fx
      const cellZ = selectedCellZ + fz
      const cell = getCell(cellX, cellZ)
      cell.isUnsafeTerrain = false
    }
  }
  updatePreview()
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function resetAll(): void {
  removeAllConcrete()
  clearPreviews()

  if (crumbleOverlay) { crumbleOverlay.dispose(); crumbleOverlay = null }
  if (deliveryOverlay) { deliveryOverlay.dispose(); deliveryOverlay = null }

  crumbleActive = false
  deliveryActive = false
  previewMode = true
  unsafeTerrainEnabled = false

  // Clear all unsafe terrain
  for (const cell of cells.values()) {
    cell.isUnsafeTerrain = false
  }

  placeConcreteAtBuilding()

  const previewBtn = document.getElementById('btn-preview')!
  previewBtn.classList.add('active')
  const unsafeBtn = document.getElementById('btn-toggle-unsafe')!
  unsafeBtn.classList.remove('active')

  updateBuildStats()
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateBuildStats(): void {
  document.getElementById('st-mode')!.textContent = previewMode ? '预览模式' : '无预览'
  document.getElementById('st-cell')!.textContent = `(${selectedCellX}, ${selectedCellZ})`
  const cell = getCell(selectedCellX, selectedCellZ)
  document.getElementById('st-strength')!.textContent = cell.hasConcrete ? `${cell.strength}` : '-'
  document.getElementById('st-preview')!.textContent = previewMode ? '显示中' : '隐藏'
  document.getElementById('st-unsafe')!.textContent = unsafeTerrainEnabled ? '启用 (Rock)' : '禁用'
  document.getElementById('st-crumble')!.textContent = crumbleActive ? '活跃 (播放中)' : '非活跃'
  document.getElementById('st-delivery')!.textContent = deliveryActive ? '投送中' : '非活跃'
}

function updateInfoBar(): void {
  document.getElementById('info-ua')!.textContent = navigator.userAgent.split(' ').pop() ?? '-'
  document.getElementById('info-viewport')!.textContent = `${window.innerWidth}x${window.innerHeight}`
  document.getElementById('info-engine')!.textContent = engine.webGLVersion === 2 ? 'WebGL 2.0' : 'WebGL 1.0'
  document.getElementById('info-fps')!.textContent = String(Math.round(engine.getFps()))
  document.getElementById('info-time')!.textContent = new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setupControls(): void {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

  document.getElementById('btn-place-concrete')!.addEventListener('click', () => {
    placeConcreteAtBuilding()
    updateBuildStats()
  })

  document.getElementById('btn-damage-concrete')!.addEventListener('click', () => {
    damageConcrete()
    updateBuildStats()
  })

  document.getElementById('btn-remove-concrete')!.addEventListener('click', () => {
    removeAllConcrete()
    updateBuildStats()
  })

  const previewBtn = document.getElementById('btn-preview')!
  previewBtn.addEventListener('click', () => {
    previewMode = !previewMode
    previewBtn.classList.toggle('active', previewMode)
    updatePreview()
    updateBuildStats()
  })

  const unsafeBtn = document.getElementById('btn-toggle-unsafe')!
  unsafeBtn.addEventListener('click', () => {
    toggleUnsafeTerrain()
    unsafeBtn.classList.toggle('active', unsafeTerrainEnabled)
    updateBuildStats()
  })

  document.getElementById('btn-crumble')!.addEventListener('click', () => {
    showCrumbleOverlay()
  })

  document.getElementById('btn-delivery')!.addEventListener('click', () => {
    toggleDeliveryOverlay()
  })

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    resetAll()
  })

  // Right-click on ground to set building position
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const pickResult = scene.pick(
      e.clientX - rect.left,
      e.clientY - rect.top,
      (mesh) => mesh?.name === 'ground' || mesh?.name === 'grid',
    )
    if (pickResult?.hit && pickResult.pickedPoint) {
      const point = pickResult.pickedPoint
      const newX = Math.round(point.x - 0.5)
      const newZ = Math.round(point.z - 0.5)
      if (newX >= -GRID_HALF && newX <= GRID_HALF - 2 && newZ >= -GRID_HALF && newZ <= GRID_HALF - 2) {
        removeAllConcrete()
        selectedCellX = newX
        selectedCellZ = newZ
        buildingMesh!.position = new Vector3(selectedCellX + 1.5, 0, selectedCellZ + 1.5)
        placeConcreteAtBuilding()
        updateBuildStats()
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

setupScene()
setupControls()
updateBuildStats()

engine.runRenderLoop(() => {
  // Animate delivery overlay
  if (deliveryOverlay && deliveryActive) {
    deliveryOverlay.rotation.z += 0.02
    const childMeshes = deliveryOverlay.getChildMeshes()
    for (const child of childMeshes) {
      if (child.name === 'deliveryUnit') {
        child.position.y = 3.5 + Math.sin(Date.now() * 0.003) * 0.5
      }
    }
  }

  updateInfoBar()
  scene.render()
})

window.addEventListener('resize', () => {
  engine.resize()
})

// Expose for dev tools
;(window as unknown as Record<string, unknown>).__concreteTest = {
  cells,
  previewMode,
  concreteActive: true,
  placeConcreteAtBuilding,
  damageConcrete,
  removeAllConcrete,
  showCrumbleOverlay,
  toggleDeliveryOverlay,
  resetAll,
}
